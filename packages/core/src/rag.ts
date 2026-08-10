import * as Y from 'yjs';
import { create, remove as removeFromIndex, search as searchIndex, upsert as upsertIndex, type AnyOrama } from '@orama/orama';
import type { CrdtSyncAdapter, PersonalEcosystemDocument } from './sync/crdt.js';

export type RAGDocumentType = 'node' | 'note' | 'context_capsule' | string;
export interface RAGDocument { id: string; type: RAGDocumentType; text: string; metadata: Record<string, unknown>; embedding?: number[]; }
export interface RAGHit extends RAGDocument { score: number; }
export interface EmbeddingProvider { embed(text: string): Promise<readonly number[]>; }
type RAGRoots = Pick<PersonalEcosystemDocument, 'lifeMap' | 'notes' | 'contextCapsules'>;

/** Transformers.js embedder. The model is downloaded once and then runs locally. */
export class TransformersEmbeddingProvider implements EmbeddingProvider {
  private extractor?: Promise<(text: string, options?: Record<string, unknown>) => Promise<unknown>>;
  constructor(readonly model = 'Xenova/all-MiniLM-L6-v2') {}
  async embed(text: string): Promise<readonly number[]> {
    this.extractor ??= import('@xenova/transformers').then(({ pipeline }) => pipeline('feature-extraction', this.model, { quantized: true }) as unknown as (text: string, options?: Record<string, unknown>) => Promise<unknown>);
    const output = await (await this.extractor)(text, { pooling: 'mean', normalize: true }) as { data?: ArrayLike<number>; tolist?: () => unknown };
    const list = output.data ? Array.from(output.data) : flattenTensor(output.tolist?.());
    if (!list.length) throw new Error('Embedding model returned an empty vector');
    return normalize(list);
  }
}

/** Optional local Ollama provider, useful when the model is managed outside the app. */
export class OllamaEmbeddingProvider implements EmbeddingProvider {
  constructor(private readonly endpoint = 'http://127.0.0.1:11434/api/embeddings', private readonly model = 'all-minilm') {}
  async embed(text: string): Promise<readonly number[]> {
    const response = await fetch(this.endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: this.model, prompt: text }) });
    if (!response.ok) throw new Error(`Ollama embeddings failed with HTTP ${response.status}`);
    const vector = (await response.json() as { embedding?: unknown }).embedding;
    if (!Array.isArray(vector) || !vector.every(value => typeof value === 'number')) throw new Error('Ollama returned an invalid embedding');
    return normalize(vector);
  }
}

/** Small deterministic offline fallback for tests and environments without a model cache. */
export class LocalHashEmbeddingProvider implements EmbeddingProvider {
  constructor(private readonly dimensions = 384) {}
  async embed(text: string): Promise<readonly number[]> {
    const vector = new Array<number>(this.dimensions).fill(0);
    for (const token of text.toLocaleLowerCase().split(/\s+/).filter(Boolean)) {
      let hash = 2166136261;
      for (let i = 0; i < token.length; i += 1) hash = Math.imul(hash ^ token.charCodeAt(i), 16777619);
      vector[(hash >>> 0) % this.dimensions] += 1;
    }
    return normalize(vector);
  }
}

export interface RAGManagerOptions { embedder?: EmbeddingProvider; maxResults?: number; fallbackToHash?: boolean; }

/** In-memory Orama vector database. Nothing is sent over the network or persisted remotely. */
export class RAGManager {
  private readonly documents = new Map<string, RAGDocument>();
  private database?: AnyOrama;
  private dimensions?: number;
  private readonly embedder: EmbeddingProvider;
  private readonly fallback?: EmbeddingProvider;
  private readonly maxResults: number;
  private detach?: () => void;
  private rebuildVersion = 0;
  private rebuildQueue: Promise<void> = Promise.resolve();
  constructor(options: RAGManagerOptions = {}) {
    this.embedder = options.embedder ?? new TransformersEmbeddingProvider();
    this.fallback = options.fallbackToHash === false ? undefined : new LocalHashEmbeddingProvider();
    this.maxResults = options.maxResults ?? 8;
  }
  async upsert(document: Omit<RAGDocument, 'embedding'> | RAGDocument): Promise<void> {
    const text = document.text.trim(); if (!text) return;
    const suppliedEmbedding = 'embedding' in document ? document.embedding : undefined;
    const embedding = normalize(suppliedEmbedding?.length ? suppliedEmbedding : await this.embed(text));
    if (!embedding.length) throw new Error('Embedding must not be empty');
    this.ensureDatabase(embedding.length);
    const stored = { ...document, text, embedding: [...embedding] };
    this.documents.set(document.id, stored);
    await upsertIndex(this.database!, { id: stored.id, type: stored.type, text: stored.text, embedding: stored.embedding });
  }
  async remove(id: string): Promise<void> { this.documents.delete(id); if (this.database) await removeFromIndex(this.database, id); }
  clear(): void { this.documents.clear(); this.database = undefined; this.dimensions = undefined; }
  size(): number { return this.documents.size; }
  async search(query: string, limit = this.maxResults): Promise<RAGHit[]> {
    if (!query.trim()) return [];
    if (!this.database) return [];
    const vector = await this.embed(query);
    if (vector.length !== this.dimensions) throw new Error(`Embedding dimension mismatch: expected ${this.dimensions}, received ${vector.length}`);
    const results = await searchIndex(this.database, { mode: 'vector', vector: { value: [...normalize(vector)], property: 'embedding' }, similarity: 0, limit });
    return results.hits.flatMap(hit => { const document = this.documents.get(hit.id); return document ? [{ ...document, score: hit.score }] : []; });
  }
  async rebuild(source: RAGRoots | Y.Doc): Promise<void> {
    const document: RAGRoots = source instanceof Y.Doc ? rootsFromDocument(source) : source;
    this.rebuildVersion += 1;
    this.clear();
    for (const [id, value] of entries(document.lifeMap.get('nodes'))) await this.indexValue(`node:${id}`, 'node', value);
    for (const [id, value] of entries(document.notes)) await this.indexValue(`note:${id}`, 'note', value);
    for (const [id, value] of entries(document.contextCapsules)) await this.indexValue(`context_capsule:${id}`, 'context_capsule', value);
  }
  /** Observe deep Yjs changes, including nested node maps and remote CRDT updates. */
  attach(source: CrdtSyncAdapter | PersonalEcosystemDocument | Y.Doc): () => void {
    this.detach?.();
    const doc = source instanceof Y.Doc ? source : 'document' in source ? source.document : undefined;
    const ecosystem: RAGRoots | undefined = source instanceof Y.Doc ? rootsFromDocument(source) : 'document' in source ? undefined : source;
    const roots = ecosystem ?? (doc ? rootsFromDocument(doc) : undefined);
    if (!roots) throw new Error('Unsupported Yjs source');
    const listener = () => { void this.scheduleRebuild(roots).catch(() => undefined); };
    [roots.lifeMap, roots.notes, roots.contextCapsules].forEach(root => root.observeDeep(listener));
    this.detach = () => [roots.lifeMap, roots.notes, roots.contextCapsules].forEach(root => root.unobserveDeep(listener));
    void this.scheduleRebuild(roots);
    return this.detach;
  }
  private async indexValue(id: string, type: RAGDocumentType, value: unknown): Promise<void> { const safe = safeValue(value); const text = valueToText(safe); if (text) await this.upsert({ id, type, text, metadata: isPlainRecord(safe) ? safe : { value: safe } }); }
  private async embed(text: string): Promise<readonly number[]> { try { return await this.embedder.embed(text); } catch (error) { if (!this.fallback) throw error; return this.fallback.embed(text); } }
  private ensureDatabase(dimensions: number): void {
    if (this.dimensions !== undefined && this.dimensions !== dimensions) throw new Error(`Embedding dimension mismatch: expected ${this.dimensions}, received ${dimensions}`);
    if (this.database) return;
    this.dimensions = dimensions;
    this.database = create({ schema: { id: 'string', type: 'string', text: 'string', embedding: `vector[${dimensions}]` } });
  }
  private scheduleRebuild(source: RAGRoots): Promise<void> {
    const version = ++this.rebuildVersion;
    const task = this.rebuildQueue.then(async () => { if (version === this.rebuildVersion) await this.rebuild(source); });
    this.rebuildQueue = task.catch(() => undefined);
    return task;
  }
}

function rootsFromDocument(document: Y.Doc): RAGRoots { return { lifeMap: document.getMap('lifeMap'), notes: document.getMap('notes'), contextCapsules: document.getMap('contextCapsules') }; }

function entries(value: unknown): Array<[string, unknown]> { if (value instanceof Y.Map) return [...value.entries()]; if (value && typeof value === 'object') return Object.entries(value as Record<string, unknown>); return []; }
function valueToText(value: unknown): string { if (typeof value === 'string') return value; if (!value || typeof value !== 'object') return ''; const record = value as Record<string, unknown>; return Object.entries(record).map(([key, child]) => `${key}: ${typeof child === 'string' ? child : JSON.stringify(child)}`).join('\n'); }
const PRIVATE_METADATA_KEY = /^(private|secret|token|password|credential|apiKey)$/i;
function safeValue(value: unknown): unknown {
  if (value instanceof Y.Map) return Object.fromEntries([...value.entries()].filter(([key]) => !PRIVATE_METADATA_KEY.test(key)).map(([key, child]) => [key, safeValue(child)]));
  if (Array.isArray(value)) return value.map(safeValue);
  if (!isPlainRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !PRIVATE_METADATA_KEY.test(key)).map(([key, child]) => [key, safeValue(child)]));
}
function isPlainRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Y.AbstractType); }
function normalize(vector: readonly number[]): number[] { const length = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1; return vector.map(value => value / length); }
function flattenTensor(value: unknown): number[] { if (Array.isArray(value)) return value.flatMap(flattenTensor); return typeof value === 'number' ? [value] : []; }
