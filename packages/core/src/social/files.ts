import { canonicalJson, type CryptoProvider, signCanonical, verifyCanonical } from '../crypto.js';
import type { DeviceSessionKeys } from '../identity.js';
import type { NodeId } from '../types.js';
import {
  KEYSTONE_OBJECT_VERSION,
  fileObjectSchema,
  type EncryptedFileMetadata,
  type FileObject,
  type FilePayload,
  type ObjectVisibility,
  unsignedObject,
} from './object-model.js';
import {
  ContentCache,
  type ContentDownloadProgress,
  type ContentId,
  type ContentManifest,
  type ContentProvider,
  contentUri,
  sha256,
} from './content.js';
import { SafetyRuntime, SafetySurfaceGate } from '../security/content-safety.js';
import { MandatorySafetySurfaceRegistry } from '../security/safety-surfaces.js';
import { FileContainmentService } from '../security/untrusted-content.js';

/** A writable local content provider. LocalContentStore and host adapters can implement this boundary. */
export interface WritableFileContentStore {
  readonly cache: ContentCache;
  import(bytes: Uint8Array, options: { mimeType: string; name?: string; chunkSize?: number }): Promise<ContentManifest>;
  manifest(contentId: ContentId): ContentManifest | undefined | Promise<ContentManifest | undefined>;
}

export interface FileImportInput {
  bytes: Uint8Array;
  filename: string;
  mimeType: string;
  owner?: NodeId;
  uploader?: NodeId;
  description?: string;
  visibility?: ObjectVisibility;
  communityId?: string;
  encrypted?: EncryptedFileMetadata;
  chunkSize?: number;
}

export interface FileImportResult { file: FileObject; manifest: ContentManifest; }
/** Host boundary for Phase25's private-content encryptAttachment implementation. */
export interface FileEncryptionAdapter {
  encrypt(bytes: Uint8Array, options: { mimeType: string; name?: string; communityId?: string; chunkSize?: number }): Promise<{ ciphertext: Uint8Array; epoch: number; keyId: string; nonce: string; communityId?: string }>;
}

export interface FileStorage {
  save(value: FileObject): Promise<boolean>;
  get(id: string): Promise<FileObject | undefined>;
  list(): Promise<readonly FileObject[]>;
}

export class InMemoryFileStorage implements FileStorage {
  private readonly values = new Map<string, FileObject>();
  async save(value: FileObject): Promise<boolean> { if (this.values.has(value.id)) return false; this.values.set(value.id, structuredClone(value)); return true; }
  async get(id: string): Promise<FileObject | undefined> { const value = this.values.get(id); return value && structuredClone(value); }
  async list(): Promise<readonly FileObject[]> { return [...this.values.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)).map(value => structuredClone(value)); }
}

export interface EncryptedFileStateStore { read(): Promise<unknown | undefined>; write(value: unknown): Promise<void>; }
type FileState = { version: 1; objects: Record<string, FileObject> };

/** Durable file metadata. Hosts should provide an authenticated encrypted backend. */
export class PersistentFileStorage implements FileStorage {
  private state?: FileState;
  private writes: Promise<void> = Promise.resolve();
  constructor(private readonly backend: EncryptedFileStateStore) {}
  async save(value: FileObject): Promise<boolean> { const state = await this.load(); if (state.objects[value.id]) return false; state.objects[value.id] = structuredClone(value); await this.commit(state); return true; }
  async get(id: string): Promise<FileObject | undefined> { return clone((await this.load()).objects[id]); }
  async list(): Promise<readonly FileObject[]> { return Object.values((await this.load()).objects).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)).map(value => structuredClone(value)); }
  private async load(): Promise<FileState> {
    if (this.state) return this.state;
    const value = await this.backend.read();
    if (!value) return this.state = { version: 1, objects: {} };
    if (!value || typeof value !== 'object' || (value as FileState).version !== 1 || !(value as FileState).objects) throw new Error('Unsupported persistent file state');
    const objects: Record<string, FileObject> = {};
    for (const [id, candidate] of Object.entries((value as FileState).objects)) { const parsed = fileObjectSchema.safeParse(candidate); if (parsed.success && parsed.data.id === id && parsed.data.payload.fileId === id) objects[id] = parsed.data; }
    return this.state = { version: 1, objects };
  }
  private async commit(state: FileState): Promise<void> { const snapshot = structuredClone(state); const operation = this.writes.then(() => this.backend.write(snapshot)); this.writes = operation.catch(() => undefined); await operation; this.state = snapshot; }
}

export class InMemoryEncryptedFileStateStore implements EncryptedFileStateStore { private value?: unknown; async read() { return clone(this.value); } async write(value: unknown) { this.value = structuredClone(value); } }

/** Signed FileObject lifecycle. The bytes are imported once; every surface refers to file.id. */
export class FileService {
  constructor(
    private readonly storage: FileStorage,
    private readonly crypto: CryptoProvider,
    private readonly local: DeviceSessionKeys,
    private readonly content: WritableFileContentStore,
    private readonly now: () => number = () => Date.now(),
    private readonly storagePolicy?: FileStorageManager,
    private readonly protectedSurfaces = new MandatorySafetySurfaceRegistry(new SafetySurfaceGate(new SafetyRuntime())),
    /** Received/shared bytes always enter quarantine; local import never calls this boundary. */
    private readonly containment = new FileContainmentService(),
  ) {}

  async import(input: FileImportInput): Promise<FileImportResult> {
    const filename = input.filename.trim();
    if (!filename || filename.length > 255 || !input.mimeType.trim() || input.mimeType.length > 255) throw new Error('Invalid file metadata');
    if (input.description !== undefined && input.description.length > 4_000) throw new Error('File description is too long');
    const visibility = input.visibility ?? 'private';
    if (visibility !== 'public' && !input.encrypted) throw new Error('Private and community files require encrypted content');
    if (input.encrypted && visibility === 'public') throw new Error('Encrypted file metadata cannot be public');
    if (input.communityId && visibility !== 'community') throw new Error('Community file reference requires community visibility');
    const owner = input.owner ?? this.local.nodeId;
    const uploader = input.uploader ?? this.local.nodeId;
    if (uploader !== this.local.nodeId) throw new Error('Only the local identity can upload a file');
    const manifest = await this.content.import(input.bytes, { mimeType: input.mimeType, name: filename, ...(input.chunkSize ? { chunkSize: input.chunkSize } : {}) });
    if (manifest.byteLength !== input.bytes.length || manifest.mimeType !== input.mimeType) throw new Error('Content manifest does not match file metadata');
    const payloadWithoutId: Omit<FilePayload, 'fileId' | 'contentId' | 'size'> & { contentId: ContentId; size: number } = {
      filename, mimeType: input.mimeType, size: manifest.byteLength, contentId: manifest.contentId, owner, uploader,
      ...(input.description ? { description: input.description } : {}), ...(input.communityId ? { communityId: input.communityId } : {}), ...(input.encrypted ? { encrypted: input.encrypted } : {}),
    };
    const fileId = await deterministicFileId(payloadWithoutId, visibility);
    const payload: FilePayload = { ...payloadWithoutId, fileId };
    const unsigned = { version: KEYSTONE_OBJECT_VERSION as 1, type: 'file_object' as const, id: fileId, author: this.local.nodeId, createdAt: new Date(this.now()).toISOString(), visibility, references: input.communityId ? [{ id: input.communityId, type: 'community' as const }] : [], payload };
    const file = fileObjectSchema.parse({ ...unsigned, signature: await signCanonical(unsigned, canonicalBytes => this.crypto.sign(canonicalBytes, this.local.privateKey)) });
    if (visibility !== 'private' && !(await this.protectedSurfaces.evaluate('FILES', { objectId: file.id, value: file, content: file.payload, text: JSON.stringify(file.payload), domain: visibility === 'public' ? 'PUBLIC' : visibility === 'community' ? 'COMMUNITY' : 'DIRECT_SHARED', sourceType: 'file', verified: true, authorized: true, sharing: true }))) throw new Error('File failed mandatory SafetySurfaceGate');
    const saved = await this.storage.save(file);
    if (!saved) { const existing = await this.storage.get(fileId); if (existing) { await this.storagePolicy?.register(existing, { userOwned: true }); return { file: existing, manifest }; } }
    await this.storagePolicy?.register(file, { userOwned: true });
    return { file, manifest };
  }

  async importEncrypted(input: Omit<FileImportInput, 'bytes' | 'encrypted' | 'visibility'> & { ciphertext: Uint8Array; encrypted: EncryptedFileMetadata; visibility?: 'private' | 'community' }): Promise<FileImportResult> {
    return this.import({ ...input, bytes: input.ciphertext, visibility: input.visibility ?? 'private' });
  }

  /** Materialize bytes received from P2P/browser/shared storage only through
   * the R0P59 quarantine boundary. Metadata-only ingest intentionally does not
   * classify ciphertext or a manifest as plaintext content. */
  async receiveBytes(file: FileObject, bytes: Uint8Array, sourceIdentity = file.payload.uploader): Promise<import('../security/untrusted-content.js').QuarantineEntry | undefined> {
    return this.containment.receive({ version: 1, transferId: `file:${file.id}:${file.payload.contentId}`, sourceIdentity, objectId: file.id, contentId: file.payload.contentId, filename: file.payload.filename, mimeType: file.payload.mimeType, size: bytes.byteLength, visibility: file.visibility, encrypted: Boolean(file.payload.encrypted), provenance: [{ kind: 'P2P_TRANSFER', contentHash: file.payload.contentId, objectId: file.id, transferId: `file:${file.id}:${file.payload.contentId}`, sourceIdentity, at: new Date(this.now()).toISOString() }] }, bytes);
  }
  async importWithEncryption(input: Omit<FileImportInput, 'bytes' | 'encrypted' | 'visibility'> & { plaintext: Uint8Array; visibility?: 'private' | 'community' }, adapter: FileEncryptionAdapter): Promise<FileImportResult> {
    const encrypted = await adapter.encrypt(input.plaintext, { mimeType: input.mimeType, name: input.filename, communityId: input.communityId, chunkSize: input.chunkSize });
    return this.import({ ...input, bytes: encrypted.ciphertext, visibility: input.visibility ?? 'private', encrypted: { epoch: encrypted.epoch, keyId: encrypted.keyId, nonce: encrypted.nonce, ...(encrypted.communityId ? { communityId: encrypted.communityId } : {}) } });
  }

  async ingest(value: unknown): Promise<FileObject | undefined> {
    const parsed = fileObjectSchema.safeParse(value); if (!parsed.success) return undefined;
    const file = parsed.data;
    if (file.payload.fileId !== file.id || file.payload.uploader !== file.author || `sha256-${file.payload.contentId.replace(/^sha256-/, '')}` !== file.payload.contentId) return undefined;
    if (!(await verifyCanonical(unsignedObject(file), file.signature, (canonicalBytes, rawSignature) => this.crypto.verify(canonicalBytes, rawSignature, file.author)))) return undefined;
    if (file.visibility !== 'private' && !await this.protectedSurfaces.evaluate('FILES', { objectId: file.id, value: file, content: file.payload, text: JSON.stringify(file.payload), domain: file.visibility === 'public' ? 'PUBLIC' : 'COMMUNITY', sourceType: 'file', verified: true, authorized: true, sharing: true })) return undefined;
    await this.storage.save(file); return file;
  }
  async get(id: string): Promise<FileObject | undefined> { const value = await this.storage.get(id); if (!value || value.visibility === 'private') return value; return await this.eligible(value) ? value : undefined; }
  async list(): Promise<readonly FileObject[]> { const values = await this.storage.list(); const safe: FileObject[] = []; for (const value of values) if (value.visibility === 'private' || await this.eligible(value)) safe.push(value); return safe; }
  async manifest(file: FileObject): Promise<ContentManifest | undefined> { if (file.visibility !== 'private' && !(await this.eligible(file))) return undefined; return (await this.content.manifest(file.payload.contentId as ContentId)); }
  private async eligible(file: FileObject): Promise<boolean> { return (await this.protectedSurfaces.evaluate('FILES', { objectId: file.id, value: file, content: file.payload, text: JSON.stringify(file.payload), domain: file.visibility === 'public' ? 'PUBLIC' : file.visibility === 'community' ? 'COMMUNITY' : 'DIRECT_SHARED', sourceType: 'file', verified: true, authorized: true, sharing: true })) !== undefined; }
}

export async function deterministicFileId(payload: Omit<FilePayload, 'fileId'>, visibility: ObjectVisibility): Promise<string> {
  return sha256(new TextEncoder().encode(canonicalJson({ version: 1, type: 'file_object', visibility, payload })));
}

export type FileAvailability = 'AVAILABLE LOCAL' | 'AVAILABLE REMOTE' | 'PARTIALLY AVAILABLE' | 'UNAVAILABLE' | 'DOWNLOADING';
export type FileStorageClass = 'cache' | 'pinned' | 'user-owned' | 'temporary';
export interface FileAvailabilityInfo { fileId: string; contentId: ContentId; status: FileAvailability; localChunks: number; totalChunks: number; providerIds: readonly string[]; }
export interface FileStorageRecord { fileId: string; contentId: ContentId; storageClass: FileStorageClass; pinned: boolean; userOwned: boolean; updatedAt: string; }
export interface FileStorageStateStore { read(): Promise<unknown | undefined>; write(value: unknown): Promise<void>; }
type StorageState = { version: 1; records: Record<string, FileStorageRecord> };

/** Cache policy that protects user-owned and pinned data from ordinary eviction. */
export class FileStorageManager {
  private readonly records = new Map<string, FileStorageRecord>();
  private writes: Promise<void> = Promise.resolve();
  private readonly readyPromise: Promise<void>;
  constructor(private readonly cache: ContentCache, private readonly backend?: FileStorageStateStore) { this.readyPromise = this.hydrate(); }
  async ready(): Promise<void> { await this.readyPromise; }
  async register(file: FileObject, options: { userOwned?: boolean; pinned?: boolean; storageClass?: FileStorageClass } = {}): Promise<void> {
    await this.ready();
    const userOwned = options.userOwned ?? true; const pinned = options.pinned ?? false; const storageClass = options.storageClass ?? (userOwned ? 'user-owned' : pinned ? 'pinned' : 'cache');
    const manifest = this.cache.manifest(file.payload.contentId as ContentId); if (manifest && (userOwned || pinned)) this.cache.pin(manifest.contentId, true);
    this.records.set(file.id, { fileId: file.id, contentId: file.payload.contentId as ContentId, storageClass, pinned, userOwned, updatedAt: new Date().toISOString() }); await this.persist();
  }
  async pin(file: FileObject, pinned = true): Promise<void> { await this.ready(); const record = this.records.get(file.id) ?? { fileId: file.id, contentId: file.payload.contentId as ContentId, storageClass: 'cache' as const, pinned: false, userOwned: false, updatedAt: new Date().toISOString() }; record.pinned = pinned; if (pinned) record.storageClass = 'pinned'; else if (!record.userOwned) record.storageClass = 'cache'; const manifest = this.cache.manifest(record.contentId); if (manifest) this.cache.pin(record.contentId, pinned || record.userOwned); this.records.set(file.id, { ...record, updatedAt: new Date().toISOString() }); await this.persist(); }
  async markUserOwned(file: FileObject, owned = true): Promise<void> { await this.ready(); const record = this.records.get(file.id) ?? { fileId: file.id, contentId: file.payload.contentId as ContentId, storageClass: 'cache' as const, pinned: false, userOwned: false, updatedAt: new Date().toISOString() }; record.userOwned = owned; if (owned) record.storageClass = 'user-owned'; else if (!record.pinned) record.storageClass = 'cache'; const manifest = this.cache.manifest(record.contentId); if (manifest) this.cache.pin(record.contentId, owned || record.pinned); this.records.set(file.id, { ...record, updatedAt: new Date().toISOString() }); await this.persist(); }
  async deleteLocalCopy(file: FileObject): Promise<boolean> { await this.ready(); const record = this.records.get(file.id); const removed = this.cache.remove(file.payload.contentId as ContentId); if (record) this.records.set(file.id, { ...record, pinned: false, userOwned: false, storageClass: 'temporary', updatedAt: new Date().toISOString() }); await this.persist(); return removed; }
  record(fileId: string): FileStorageRecord | undefined { const value = this.records.get(fileId); return value && structuredClone(value); }
  recordsList(): readonly FileStorageRecord[] { return [...this.records.values()].map(value => structuredClone(value)); }
  usage(): { usedBytes: number; quotaBytes: number; freeBytes: number } { const usedBytes = this.cache.usageBytes(); return { usedBytes, quotaBytes: this.cache.quotaBytes, freeBytes: Math.max(0, this.cache.quotaBytes - usedBytes) }; }
  async evict(): Promise<void> { await this.ready(); await this.cache.evict(); }
  /** Clears ordinary cache/temp content only; user-owned and pinned content is protected. */
  async clearCache(): Promise<number> { await this.ready(); const protectedIds = new Set([...this.records.values()].filter(record => record.userOwned || record.pinned).map(record => record.contentId)); let cleared = 0; for (const record of this.records.values()) if (!protectedIds.has(record.contentId) && this.cache.remove(record.contentId as ContentId)) { cleared++; record.storageClass = 'temporary'; record.updatedAt = new Date().toISOString(); } await this.persist(); return cleared; }
  async usageByClass(): Promise<Readonly<Record<FileStorageClass, number>>> { await this.ready(); const usage: Record<FileStorageClass, number> = { cache: 0, pinned: 0, 'user-owned': 0, temporary: 0 }; const seen = new Set<string>(); for (const record of this.records.values()) { if (seen.has(record.contentId)) continue; const manifest = this.cache.manifest(record.contentId as ContentId); if (!manifest || this.cache.missing(manifest).length) continue; seen.add(record.contentId); usage[record.storageClass] += manifest.byteLength; } return usage; }
  availability(file: FileObject, manifest: ContentManifest | undefined, providers: readonly ContentProvider[], downloading = false): FileAvailabilityInfo {
    const contentId = file.payload.contentId as ContentId; const totalChunks = manifest?.chunks.length ?? 0; const localChunks = manifest ? totalChunks - this.cache.missing(manifest).length : 0; const providerIds = providers.map(provider => provider.id);
    let status: FileAvailability; if (downloading) status = 'DOWNLOADING'; else if (manifest && localChunks === totalChunks) status = 'AVAILABLE LOCAL'; else if (!providerIds.length) status = 'UNAVAILABLE'; else if (!localChunks) status = 'AVAILABLE REMOTE'; else status = 'PARTIALLY AVAILABLE';
    return { fileId: file.id, contentId, status, localChunks, totalChunks, providerIds };
  }
  private async hydrate(): Promise<void> { if (!this.backend) return; const value = await this.backend.read(); if (!value) return; const parsed = value as Partial<StorageState>; if (parsed.version !== 1 || !parsed.records) throw new Error('Unsupported file storage state'); for (const [id, record] of Object.entries(parsed.records)) if (record?.fileId === id && typeof record.contentId === 'string') this.records.set(id, structuredClone(record)); }
  private async persist(): Promise<void> { const backend = this.backend; if (!backend) return; const snapshot: StorageState = { version: 1, records: Object.fromEntries(this.records) }; const operation = this.writes.then(() => backend.write(structuredClone(snapshot))); this.writes = operation.catch(() => undefined); await operation; }
}

export interface FileProviderDirectory {
  manifest(contentId: ContentId): Promise<ContentManifest | undefined>;
  providers(contentId: ContentId): Promise<readonly ContentProvider[]>;
}
export interface FileDownloadProgress extends ContentDownloadProgress { fileId: string; providerIds: readonly string[]; }
export type FileTransferStatus = 'idle' | 'downloading' | 'paused' | 'complete' | 'cancelled' | 'failed';
export interface FileTransferState { file: FileObject; status: FileTransferStatus; progress?: FileDownloadProgress; availability?: FileAvailabilityInfo; error?: string; }
export interface FileTransferOptions { manifest?: ContentManifest; signal?: AbortSignal; maxParallel?: number; onProgress?: (value: FileDownloadProgress) => void; }

/** Resumable bounded-parallel transfer coordinator. Every chunk is verified before entering ContentCache. */
export class FileTransferManager {
  private readonly states = new Map<string, FileTransferState>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly pauseRequested = new Set<string>();
  private readonly cancelRequested = new Set<string>();
  private readonly listeners = new Set<(state: FileTransferState) => void>();
  private maxParallelTransfers: number;
  private bandwidthLimitBytesPerSecond = 0;
  constructor(private readonly cache: ContentCache, private readonly directory: FileProviderDirectory, private readonly storage?: FileStorageManager, defaultParallel = 3, private readonly protectedSurfaces = new MandatorySafetySurfaceRegistry(new SafetySurfaceGate(new SafetyRuntime())), private readonly containment: FileContainmentService = new FileContainmentService()) { this.maxParallelTransfers = Math.max(1, Math.min(16, Math.floor(defaultParallel))); }
  setMaxParallelTransfers(value: number): void { if (!Number.isInteger(value) || value < 1 || value > 16) throw new Error('Invalid transfer parallelism'); this.maxParallelTransfers = value; }
  getMaxParallelTransfers(): number { return this.maxParallelTransfers; }
  setBandwidthLimit(value: number): void { if (!Number.isFinite(value) || value < 0) throw new Error('Invalid bandwidth limit'); this.bandwidthLimitBytesPerSecond = value; }
  getBandwidthLimit(): number { return this.bandwidthLimitBytesPerSecond; }
  subscribe(listener: (state: FileTransferState) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  state(file: FileObject): FileTransferState { return this.states.get(file.id) ?? { file, status: 'idle' }; }
  async download(file: FileObject, options: FileTransferOptions = {}): Promise<Uint8Array> {
    if (file.visibility !== 'private' && !(await this.protectedSurfaces.evaluate('FILES', { objectId: file.id, value: file, content: file.payload, text: JSON.stringify(file.payload), domain: file.visibility === 'public' ? 'PUBLIC' : file.visibility === 'community' ? 'COMMUNITY' : 'DIRECT_SHARED', sourceType: 'file', verified: true, authorized: true, sharing: true }))) throw new Error('File failed mandatory SafetySurfaceGate');
    this.pauseRequested.delete(file.id); this.cancelRequested.delete(file.id); this.controllers.get(file.id)?.abort(); const controller = new AbortController(); this.controllers.set(file.id, controller); if (options.signal) { if (options.signal.aborted) controller.abort(); else options.signal.addEventListener('abort', () => controller.abort(), { once: true }); }
    const contentId = file.payload.contentId as ContentId; let manifest: ContentManifest | undefined; try { manifest = options.manifest ?? await this.directory.manifest(contentId); } catch (error) { this.set({ file, status: 'failed', error: error instanceof Error ? error.message : String(error) }); throw error; } if (!manifest || manifest.contentId !== contentId || manifest.byteLength !== file.payload.size) { const error = new Error('File manifest is unavailable or mismatched'); this.set({ file, status: 'failed', error: error.message }); throw error; } await this.cache.putManifest(manifest); const record = this.storage?.record(file.id); if (record) await this.storage!.register(file, { userOwned: record.userOwned, pinned: record.pinned, storageClass: record.storageClass }); const maxParallel = Math.max(1, Math.min(16, Math.floor(options.maxParallel ?? this.maxParallelTransfers)));
    const setAvailability = async (downloading: boolean, providers: readonly ContentProvider[] = []) => { const availability = this.storage?.availability(file, manifest, providers, downloading); const current = this.states.get(file.id); this.set({ file, status: current?.status ?? 'downloading', ...(current?.progress ? { progress: current.progress } : {}), ...(availability ? { availability } : {}) }); };
    this.set({ file, status: 'downloading' });
    try {
      const queue = this.cache.missing(manifest); if (!queue.length) { const result = await this.cache.read(contentId); if (!result) throw new Error('File download incomplete'); await this.quarantineCompletedTransfer(file, contentId, result); this.set({ file, status: 'complete', availability: this.storage?.availability(file, manifest, [], false) }); return result; }
      let cursor = 0; let failure: unknown;
      const worker = async (): Promise<void> => {
        while (true) {
          if (controller.signal.aborted) throw new DOMException('Download cancelled', 'AbortError'); const index = queue[cursor++]; if (index === undefined) return;
          let completed = false; let lastError: unknown;
          for (let attempt = 0; attempt < 8 && !completed; attempt++) {
            if (controller.signal.aborted) throw new DOMException('Download cancelled', 'AbortError');
            const providers = await this.directory.providers(contentId); await setAvailability(true, providers); if (!providers.length) { lastError = new Error('No file provider available'); break; }
            for (const provider of providers) {
              try { const bytes = await provider.getChunk(contentId, index, controller.signal); if (await sha256(bytes) !== manifest!.chunks[index]) throw new Error(`Corrupt chunk from provider ${provider.id}`); await this.throttle(bytes.byteLength); await this.cache.putVerifiedChunk(manifest!, index, bytes); completed = true; break; } catch (error) { lastError = error; }
              if (controller.signal.aborted) throw new DOMException('Download cancelled', 'AbortError');
            }
          }
          if (!completed) { failure = lastError ?? new Error('File provider unavailable'); return; }
          const missing = this.cache.missing(manifest); const progress: FileDownloadProgress = { fileId: file.id, contentId, completedChunks: manifest.chunks.length - missing.length, totalChunks: manifest.chunks.length, completedBytes: manifest.byteLength - missing.reduce((sum, item) => sum + chunkLength(manifest!, item), 0), totalBytes: manifest.byteLength, providerIds: (await this.directory.providers(contentId)).map(provider => provider.id) }; this.set({ file, status: 'downloading', progress, availability: this.storage?.availability(file, manifest, [], true) }); options.onProgress?.(progress);
        }
      };
      await Promise.all(Array.from({ length: Math.min(maxParallel, queue.length) }, () => worker())); if (failure) throw failure;
      const result = await this.cache.read(contentId); if (!result) throw new Error('File download incomplete');
      // A completed network transfer is still untrusted bytes. It is placed in
      // quarantine before the caller may choose an explicit inspection path.
      await this.quarantineCompletedTransfer(file, contentId, result);
      const finalProviders = await this.directory.providers(contentId); const progress: FileDownloadProgress = { fileId: file.id, contentId, completedChunks: manifest.chunks.length, totalChunks: manifest.chunks.length, completedBytes: manifest.byteLength, totalBytes: manifest.byteLength, providerIds: finalProviders.map(provider => provider.id) }; this.set({ file, status: 'complete', progress, availability: this.storage?.availability(file, manifest, finalProviders, false) }); options.onProgress?.(progress); return result;
    } catch (error) {
      const paused = this.pauseRequested.has(file.id); const cancelled = this.cancelRequested.has(file.id) || !paused && error instanceof DOMException && error.name === 'AbortError'; const state: FileTransferState = { file, status: paused ? 'paused' : cancelled ? 'cancelled' : 'failed', ...(cancelled || paused ? {} : { error: error instanceof Error ? error.message : String(error) }) }; this.set(state); throw error;
    } finally { if (this.controllers.get(file.id) === controller) this.controllers.delete(file.id); }
  }
  pause(file: FileObject): void { this.pauseRequested.add(file.id); this.controllers.get(file.id)?.abort(); }
  cancel(file: FileObject): void { this.cancelRequested.add(file.id); this.pauseRequested.delete(file.id); this.controllers.get(file.id)?.abort(); }
  resume(file: FileObject, options: FileTransferOptions = {}): Promise<Uint8Array> { this.pauseRequested.delete(file.id); this.cancelRequested.delete(file.id); return this.download(file, options); }
  retry(file: FileObject, options: FileTransferOptions = {}): Promise<Uint8Array> { return this.resume(file, options); }
  private async quarantineCompletedTransfer(file: FileObject, contentId: ContentId, bytes: Uint8Array): Promise<void> {
    if (!this.containment) return;
    const transferId = `p2p:${file.id}:${contentId}`;
    await this.containment.receive({ version: 1, transferId, sourceIdentity: file.payload.uploader, objectId: file.id, contentId, filename: file.payload.filename, mimeType: file.payload.mimeType, size: bytes.byteLength, visibility: file.visibility, encrypted: Boolean(file.payload.encrypted), provenance: [{ kind: 'P2P_TRANSFER', contentHash: contentId, objectId: file.id, transferId, sourceIdentity: file.payload.uploader, at: new Date().toISOString() }] }, bytes);
  }
  private async throttle(bytes: number): Promise<void> { if (!this.bandwidthLimitBytesPerSecond) return; await new Promise<void>(resolve => setTimeout(resolve, Math.max(0, Math.ceil(bytes * 1_000 / this.bandwidthLimitBytesPerSecond)))); }
  private set(state: FileTransferState): void { this.states.set(state.file.id, state); this.listeners.forEach(listener => listener(structuredClone(state))); }
}


export function fileReference(file: FileObject): { id: string; type: 'file_object' } { return { id: file.id, type: 'file_object' }; }
function chunkLength(manifest: ContentManifest, index: number): number { return index === manifest.chunks.length - 1 ? manifest.byteLength - manifest.chunkSize * index : manifest.chunkSize; }
function clone<T>(value: T | undefined): T | undefined { return value === undefined ? undefined : structuredClone(value); }
