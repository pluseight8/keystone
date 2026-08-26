import { z } from 'zod';

export const CONTENT_MANIFEST_VERSION = 1;
export const DEFAULT_CHUNK_SIZE = 256 * 1024;
export const MAX_CHUNK_SIZE = 1024 * 1024;
export const MAX_CONTENT_BYTES = 2 ** 40;
export const MAX_MANIFEST_CHUNKS = 4_000_000;
export const CONTENT_CACHE_POLICIES = ['PRIVATE_NO_STRANGER_CACHE', 'OWNED_DEVICES', 'AUTHORIZED_GROUP', 'PUBLIC_CACHEABLE', 'EPHEMERAL_CACHE'] as const;
export type ContentCachePolicy = typeof CONTENT_CACHE_POLICIES[number];
export type ContentId = `sha256-${string}`;
const hash = z.string().regex(/^[a-f0-9]{64}$/i);
export const contentManifestSchema = z.object({ version: z.literal(CONTENT_MANIFEST_VERSION), contentId: z.string().regex(/^sha256-[a-f0-9]{64}$/i), byteLength: z.number().int().nonnegative().max(MAX_CONTENT_BYTES), mimeType: z.string().min(1).max(255), name: z.string().max(255).optional(), chunkSize: z.number().int().min(16 * 1024).max(MAX_CHUNK_SIZE), chunks: z.array(hash).min(1).max(MAX_MANIFEST_CHUNKS), contentPolicy: z.enum(CONTENT_CACHE_POLICIES).optional() }).strict().superRefine((value, ctx) => { if (Math.max(1, Math.ceil(value.byteLength / value.chunkSize)) !== value.chunks.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Chunk count does not match byte length' }); });
export type ContentManifest = Omit<z.infer<typeof contentManifestSchema>, 'contentId'> & { contentId: ContentId };
export interface ContentProvider { id: string; getChunk(contentId: ContentId, index: number, signal?: AbortSignal): Promise<Uint8Array>; }
export interface ContentDownloadProgress { contentId: ContentId; completedChunks: number; totalChunks: number; completedBytes: number; totalBytes: number; }
export interface ContentCacheStateStore { read(): Promise<unknown | undefined>; write(value: unknown): Promise<void>; }

export function contentUri(contentId: ContentId): string { return `keystone://content/${contentId}`; }
export function parseContentUri(value: string): ContentId { const url = new URL(value); if (url.protocol !== 'keystone:' || url.hostname !== 'content' || !/^sha256-[a-f0-9]{64}$/i.test(url.pathname.slice(1))) throw new Error('Invalid Keystone content URI'); return url.pathname.slice(1) as ContentId; }
export async function createContentManifest(bytes: Uint8Array, options: { mimeType: string; name?: string; chunkSize?: number; contentPolicy?: ContentCachePolicy }): Promise<ContentManifest> { const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE; if (!Number.isInteger(chunkSize) || chunkSize < 16 * 1024 || chunkSize > MAX_CHUNK_SIZE || !options.mimeType || options.mimeType.length > 255 || bytes.byteLength > MAX_CONTENT_BYTES) throw new Error('Invalid content manifest options'); const chunks: string[] = []; for (let offset = 0; offset < bytes.length; offset += chunkSize) chunks.push(await sha256(bytes.subarray(offset, Math.min(bytes.length, offset + chunkSize)))); if (!chunks.length) chunks.push(await sha256(new Uint8Array())); const manifest = { version: CONTENT_MANIFEST_VERSION as 1, contentId: `sha256-${await sha256(bytes)}` as ContentId, byteLength: bytes.length, mimeType: options.mimeType, ...(options.name ? { name: options.name } : {}), chunkSize, chunks, ...(options.contentPolicy ? { contentPolicy: options.contentPolicy } : {}) }; return contentManifestSchema.parse(manifest) as ContentManifest; }
export async function sha256(bytes: Uint8Array): Promise<string> { const input = new Uint8Array(bytes.length); input.set(bytes); const digest = await crypto.subtle.digest('SHA-256', input.buffer); return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join(''); }

/** Local cache only; hosts may map this to files/SQLite but no remote store is required. */
export class ContentCache {
  protected readonly manifests = new Map<ContentId, ContentManifest>(); protected readonly chunks = new Map<string, Uint8Array>(); protected readonly pins = new Set<ContentId>(); protected readonly access = new Map<ContentId, number>(); protected used = 0;
  constructor(public quotaBytes: number, private readonly now: () => number = () => Date.now()) { if (!Number.isSafeInteger(quotaBytes) || quotaBytes < 0) throw new Error('Invalid cache quota'); }
  setQuotaBytes(value: number): void { if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid cache quota'); this.quotaBytes = value; void this.evict(); }
  async putManifest(manifest: ContentManifest): Promise<void> { this.manifests.set(manifest.contentId, contentManifestSchema.parse(manifest) as ContentManifest); this.touch(manifest.contentId); }
  manifest(contentId: ContentId): ContentManifest | undefined { const value = this.manifests.get(contentId); if (value) this.touch(contentId); return value ? structuredClone(value) : undefined; }
  pin(contentId: ContentId, pinned = true): void { if (!this.manifests.has(contentId)) throw new Error('Unknown content'); if (pinned) this.pins.add(contentId); else this.pins.delete(contentId); }
  isPinned(contentId: ContentId): boolean { return this.pins.has(contentId); }
  usageBytes(): number { return this.used; }
  hasChunk(contentId: ContentId, index: number): boolean { return this.chunks.has(key(contentId, index)); }
  /** Returns one verified cached chunk for streaming without forcing a whole-content read. */
  chunk(contentId: ContentId, index: number): Uint8Array | undefined { const manifest = this.manifests.get(contentId); const value = this.chunks.get(key(contentId, index)); if (!manifest || !value || !Number.isInteger(index) || index < 0 || index >= manifest.chunks.length) return undefined; this.touch(contentId); return value.slice(); }
  missing(manifest: ContentManifest): number[] { return manifest.chunks.flatMap((_, index) => this.hasChunk(manifest.contentId, index) ? [] : [index]); }
  async putVerifiedChunk(manifest: ContentManifest, index: number, bytes: Uint8Array): Promise<void> { this.assertChunk(manifest, index, bytes); const chunkKey = key(manifest.contentId, index); if (this.chunks.has(chunkKey)) return; await this.putManifest(manifest); await this.makeRoom(bytes.length, manifest.contentId); if (this.used + bytes.length > this.quotaBytes) throw new Error('Cache quota exceeded'); this.chunks.set(chunkKey, bytes.slice()); this.used += bytes.length; this.touch(manifest.contentId); }
  async read(contentId: ContentId): Promise<Uint8Array | undefined> { const manifest = this.manifest(contentId); if (!manifest || this.missing(manifest).length) return undefined; const output = new Uint8Array(manifest.byteLength); let offset = 0; for (let index = 0; index < manifest.chunks.length; index++) { const part = this.chunks.get(key(contentId, index)); if (!part) return undefined; output.set(part, offset); offset += part.length; } if (`sha256-${await sha256(output)}` !== contentId) throw new Error('Cached content integrity check failed'); this.touch(contentId); return output; }
  /** Explicitly removes a local copy. Policy decisions (pinned/user-owned) belong to the file layer. */
  remove(contentId: ContentId): boolean { if (!this.manifests.has(contentId)) return false; this.removeInternal(contentId); return true; }
  async evict(): Promise<void> { await this.makeRoom(0); }
  private assertChunk(manifest: ContentManifest, index: number, bytes: Uint8Array): void { contentManifestSchema.parse(manifest); if (!Number.isInteger(index) || index < 0 || index >= manifest.chunks.length) throw new Error('Invalid chunk index'); const expectedLength = index === manifest.chunks.length - 1 ? manifest.byteLength - manifest.chunkSize * index : manifest.chunkSize; if (bytes.length !== expectedLength) throw new Error('Invalid chunk length'); }
  private async makeRoom(incoming: number, keep?: ContentId): Promise<void> { while (this.used + incoming > this.quotaBytes) { const candidate = [...this.manifests.keys()].filter(contentId => contentId !== keep && !this.pins.has(contentId)).sort((a, b) => (this.access.get(a) ?? 0) - (this.access.get(b) ?? 0))[0]; if (!candidate) return; this.removeInternal(candidate); } }
  protected removeInternal(contentId: ContentId): void { const manifest = this.manifests.get(contentId); if (!manifest) return; for (let index = 0; index < manifest.chunks.length; index++) { const value = this.chunks.get(key(contentId, index)); if (value) { this.used -= value.length; this.chunks.delete(key(contentId, index)); } } this.manifests.delete(contentId); this.access.delete(contentId); this.pins.delete(contentId); }
  protected touch(contentId: ContentId): void { this.access.set(contentId, this.now()); }
}

/** Optional disk-backed cache boundary for hosts that need partial chunks to survive process restart. */
export class PersistentContentCache extends ContentCache {
  private readonly readyPromise: Promise<void>;
  private writes: Promise<void> = Promise.resolve();
  constructor(quotaBytes: number, private readonly backend: ContentCacheStateStore, now: () => number = () => Date.now()) { super(quotaBytes, now); this.readyPromise = this.hydrate(); }
  async ready(): Promise<void> { await this.readyPromise; }
  override async putManifest(manifest: ContentManifest): Promise<void> { await this.ready(); await super.putManifest(manifest); await this.persist(); }
  override async putVerifiedChunk(manifest: ContentManifest, index: number, bytes: Uint8Array): Promise<void> { await this.ready(); await super.putVerifiedChunk(manifest, index, bytes); await this.persist(); }
  override pin(contentId: ContentId, pinned = true): void { super.pin(contentId, pinned); void this.persist(); }
  override remove(contentId: ContentId): boolean { const removed = super.remove(contentId); void this.persist(); return removed; }
  private async hydrate(): Promise<void> {
    const value = await this.backend.read(); if (!value || typeof value !== 'object') return;
    const state = value as { version?: number; manifests?: Record<string, ContentManifest>; chunks?: Record<string, number[]>; pins?: string[]; access?: Record<string, number> };
    if (state.version !== 1 || !state.manifests || !state.chunks || typeof state.manifests !== 'object' || typeof state.chunks !== 'object') return;
    // Persistence is a host boundary: malformed or rolled-back state must not
    // be allowed to allocate beyond the configured cache budget while it is
    // being hydrated.  Keep metadata bounded even when a backend returns a
    // hostile object with many entries.
    for (const [id, manifest] of Object.entries(state.manifests).slice(0, 4_096)) {
      const parsed = contentManifestSchema.safeParse(manifest);
      if (parsed.success && id === parsed.data.contentId) this.manifests.set(id as ContentId, parsed.data as ContentManifest);
    }
    const maxHydratedChunks = Math.min(16_384, Math.floor(this.quotaBytes / (16 * 1024)) || 0);
    let hydratedChunks = 0;
    for (const [chunkKey, bytes] of Object.entries(state.chunks)) {
      if (hydratedChunks >= maxHydratedChunks || this.used >= this.quotaBytes) break;
      const separator = chunkKey.lastIndexOf(':'); const contentId = separator > 0 ? chunkKey.slice(0, separator) : ''; const index = separator > 0 ? Number(chunkKey.slice(separator + 1)) : -1;
      const manifest = this.manifests.get(contentId as ContentId);
      if (!manifest || !Number.isInteger(index) || index < 0 || index >= manifest.chunks.length || !Array.isArray(bytes)) continue;
      const expectedLength = index === manifest.chunks.length - 1 ? manifest.byteLength - manifest.chunkSize * index : manifest.chunkSize;
      if (bytes.length !== expectedLength || bytes.length > this.quotaBytes - this.used || bytes.length > MAX_CHUNK_SIZE || !bytes.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255)) continue;
      const candidate = Uint8Array.from(bytes); if (await sha256(candidate) !== manifest.chunks[index]) continue;
      this.chunks.set(chunkKey, candidate); this.used += candidate.length; hydratedChunks += 1;
    }
    for (const id of (Array.isArray(state.pins) ? state.pins.slice(0, 4_096) : [])) if (typeof id === 'string' && this.manifests.has(id as ContentId)) this.pins.add(id as ContentId);
    for (const [id, timestamp] of Object.entries(state.access ?? {}).slice(0, 4_096)) if (this.manifests.has(id as ContentId) && Number.isFinite(timestamp)) this.access.set(id as ContentId, timestamp);
  }
  private async persist(): Promise<void> { const snapshot = { version: 1 as const, manifests: Object.fromEntries(this.manifests), chunks: Object.fromEntries([...this.chunks.entries()].map(([chunkKey, bytes]) => [chunkKey, [...bytes]])), pins: [...this.pins], access: Object.fromEntries(this.access) }; const operation = this.writes.then(() => this.backend.write(snapshot)); this.writes = operation.catch(() => undefined); await operation; }
}
export class InMemoryContentCacheStateStore implements ContentCacheStateStore { private value?: unknown; async read() { return structuredClone(this.value); } async write(value: unknown) { this.value = structuredClone(value); } }

/** Resumes from cached verified chunks and may switch providers per chunk without trusting either provider. */
export class ContentFetcher {
  constructor(private readonly cache: ContentCache) {}
  async download(manifestInput: ContentManifest, providers: readonly ContentProvider[], options: { signal?: AbortSignal; onProgress?: (value: ContentDownloadProgress) => void } = {}): Promise<Uint8Array> {
    const manifest = contentManifestSchema.parse(manifestInput) as ContentManifest; if (!providers.length) throw new Error('No content providers'); await this.cache.putManifest(manifest);
    for (const index of this.cache.missing(manifest)) { if (options.signal?.aborted) throw new DOMException('Download cancelled', 'AbortError'); let lastError: unknown;
      for (let attempt = 0; attempt < providers.length; attempt++) { const provider = providers[(index + attempt) % providers.length]!; try { const bytes = await provider.getChunk(manifest.contentId, index, options.signal); if (await sha256(bytes) !== manifest.chunks[index]) throw new Error(`Corrupt chunk from provider ${provider.id}`); await this.cache.putVerifiedChunk(manifest, index, bytes); lastError = undefined; break; } catch (error) { lastError = error; } }
      if (lastError) throw lastError; const missing = this.cache.missing(manifest); options.onProgress?.({ contentId: manifest.contentId, completedChunks: manifest.chunks.length - missing.length, totalChunks: manifest.chunks.length, completedBytes: manifest.byteLength - missing.reduce((total, item) => total + (item === manifest.chunks.length - 1 ? manifest.byteLength - manifest.chunkSize * item : manifest.chunkSize), 0), totalBytes: manifest.byteLength });
    }
    const result = await this.cache.read(manifest.contentId); if (!result) throw new Error('Content download incomplete'); return result;
  }
}
function key(contentId: ContentId, index: number): string { return `${contentId}:${index}`; }
