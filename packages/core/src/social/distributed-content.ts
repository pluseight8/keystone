import type { DeviceSessionKeys } from '../identity.js';
import type { Envelope, EnvelopeSecurity, KeystoneDeliveryInterface, UnsignedEnvelope } from '../connectivity.js';
import {
  CONTENT_MANIFEST_VERSION,
  ContentCache,
  contentManifestSchema,
  sha256,
  type ContentCacheStateStore,
  type ContentCachePolicy,
  type ContentDownloadProgress,
  type ContentId,
  type ContentManifest,
  type ContentProvider,
} from './content.js';

/**
 * A cache policy is an authorization constraint, not a routing hint.  In
 * particular, knowing a content hash never grants access to PRIVATE content.
 */
export type ContentSourceScope = 'LOCAL' | 'OWNED_DEVICE' | 'AUTHORIZED_GROUP' | 'PUBLIC_CACHE';
export type ContentTransferPriority = 'INTERACTIVE' | 'BULK' | 'BACKGROUND';
export type ContentTransferLifecycle = 'IDLE' | 'DOWNLOADING' | 'PAUSED' | 'COMPLETE' | 'FAILED' | 'CANCELLED';

export interface ContentAuthorization {
  readonly scope: 'OWNER' | 'AUTHORIZED_GROUP' | 'PUBLIC';
  /** Opaque application authorization reference. It is never interpreted as a hash. */
  readonly grant?: string;
  readonly subjectId?: string;
}

export interface DistributedContentSource extends ContentProvider {
  readonly scope: ContentSourceScope;
  readonly canServe?: (manifest: ContentManifest, authorization?: ContentAuthorization) => boolean | Promise<boolean>;
  readonly available?: () => boolean | Promise<boolean>;
}

export interface ContentSourceDirectory {
  sources(manifest: ContentManifest, authorization?: ContentAuthorization): Promise<readonly DistributedContentSource[]>;
}

export interface ContentTransferState {
  readonly version: 1;
  readonly contentId: ContentId;
  readonly totalChunks: number;
  readonly completedChunks: number;
  readonly completedBytes: number;
  readonly state: ContentTransferLifecycle;
  readonly updatedAt: number;
  readonly retries: number;
}

export interface ContentTransferStateStore {
  read(): Promise<unknown | undefined>;
  write(value: unknown): Promise<void>;
}

export class InMemoryContentTransferStateStore implements ContentTransferStateStore {
  private value?: unknown;
  async read(): Promise<unknown | undefined> { return this.value === undefined ? undefined : structuredClone(this.value); }
  async write(value: unknown): Promise<void> { this.value = structuredClone(value); }
}

/** Adapter for hosts that already provide an authenticated encrypted store. */
export class ContentTransferStateStoreAdapter implements ContentTransferStateStore {
  constructor(private readonly backend: ContentCacheStateStore) {}
  read(): Promise<unknown | undefined> { return this.backend.read(); }
  write(value: unknown): Promise<void> { return this.backend.write(value); }
}

export interface ContentTransferSession {
  readonly contentId: ContentId;
  readonly manifest: ContentManifest;
  readonly state: ContentTransferState;
  readonly missingChunks: readonly number[];
  readonly activeSources: readonly string[];
}

export interface DistributedContentProgress extends ContentDownloadProgress {
  readonly activeSources: readonly string[];
  readonly retries: number;
}

export interface DistributedContentRequest {
  readonly manifest: ContentManifest;
  readonly sources?: readonly DistributedContentSource[];
  readonly authorization?: ContentAuthorization;
  readonly priority?: ContentTransferPriority;
  readonly signal?: AbortSignal;
  readonly maxInFlightChunks?: number;
  /** Test/host boundary for pause after a bounded number of verified chunks. */
  readonly maxChunks?: number;
  readonly onProgress?: (progress: DistributedContentProgress) => void;
}

export interface DistributedContentServiceOptions {
  readonly cache: ContentCache;
  readonly directory?: ContentSourceDirectory;
  readonly transferState?: ContentTransferStateStore;
  readonly maxActiveTransfers?: number;
  readonly maxActiveSources?: number;
  readonly maxInFlightChunks?: number;
  readonly maxRequestsPerSource?: number;
  readonly maxRetriesPerChunk?: number;
  readonly maxReliabilityEntries?: number;
  readonly resourceProfile?: 'BALANCED' | 'BATTERY_SAVER' | 'HIGH_AVAILABILITY';
  readonly now?: () => number;
}

export interface DistributedContentDiagnostics {
  readonly activeTransfers: number;
  readonly maxActiveTransfers: number;
  readonly maxActiveSources: number;
  readonly maxInFlightChunks: number;
  readonly activeChunks: number;
  readonly peakInFlightChunks: number;
  readonly reliabilityEntries: number;
  readonly transferStates: number;
}

export class ContentTransferError extends Error {
  constructor(readonly code: 'UNAVAILABLE' | 'INTEGRITY' | 'RESOURCE_LIMIT' | 'CANCELLED' | 'PAUSED' | 'INVALID_MANIFEST' | 'TIMEOUT', message: string) {
    super(message);
    this.name = 'ContentTransferError';
  }
}

/**
 * Bounded content-level scheduler. Source selection and route selection are
 * separate: this class chooses an eligible source for a chunk, while each
 * source owns its Fabric/provider path.
 */
export class DistributedContentService {
  private readonly cache: ContentCache;
  private readonly directory?: ContentSourceDirectory;
  private readonly transferState?: ContentTransferStateStore;
  private readonly maxActiveTransfers: number;
  private readonly maxActiveSources: number;
  private readonly maxInFlightChunks: number;
  private readonly maxRequestsPerSource: number;
  private readonly maxRetriesPerChunk: number;
  private readonly maxReliabilityEntries: number;
  private readonly resourceProfile: DistributedContentServiceOptions['resourceProfile'];
  private readonly now: () => number;
  private readonly active = new Set<ContentId>();
  private readonly sessions = new Map<ContentId, ContentTransferSession>();
  private readonly reliability = new Map<string, { successes: number; failures: number; lastFailureAt?: number }>();
  private readonly sourceWake = new Set<() => void>();
  private peakInFlightChunks = 0;
  private activeChunks = 0;

  constructor(options: DistributedContentServiceOptions) {
    this.cache = options.cache;
    this.directory = options.directory;
    this.transferState = options.transferState;
    this.maxActiveTransfers = bounded(options.maxActiveTransfers ?? 2, 1, 8);
    this.maxActiveSources = bounded(options.maxActiveSources ?? 4, 1, 16);
    const profileDefault = options.resourceProfile === 'BATTERY_SAVER' ? 2 : options.resourceProfile === 'HIGH_AVAILABILITY' ? 8 : 4;
    this.maxInFlightChunks = bounded(options.maxInFlightChunks ?? profileDefault, 1, 16);
    this.maxRequestsPerSource = bounded(options.maxRequestsPerSource ?? 2, 1, 8);
    this.maxRetriesPerChunk = bounded(options.maxRetriesPerChunk ?? 3, 0, 8);
    this.maxReliabilityEntries = bounded(options.maxReliabilityEntries ?? 256, 16, 2_048);
    this.resourceProfile = options.resourceProfile ?? 'BALANCED';
    this.now = options.now ?? Date.now;
  }

  async ready(): Promise<void> {
    if (!this.transferState) return;
    const value = await this.transferState.read();
    if (!value || typeof value !== 'object' || (value as { version?: unknown }).version !== 1) return;
    const entries = (value as { sessions?: unknown }).sessions;
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) return;
    for (const [contentId, candidate] of Object.entries(entries as Record<string, unknown>).slice(0, 256)) {
      if (!isContentId(contentId) || !isTransferState(candidate)) continue;
      const manifest = this.cache.manifest(contentId);
      if (!manifest || manifest.chunks.length !== candidate.totalChunks) continue;
      const missingChunks = this.cache.missing(manifest);
      this.sessions.set(contentId, { contentId, manifest, state: { ...candidate, completedChunks: manifest.chunks.length - missingChunks.length, completedBytes: completedBytes(manifest, missingChunks) }, missingChunks, activeSources: [] });
    }
  }

  diagnostics(): DistributedContentDiagnostics {
    return {
      activeTransfers: this.active.size,
      maxActiveTransfers: this.maxActiveTransfers,
      maxActiveSources: this.maxActiveSources,
      maxInFlightChunks: this.maxInFlightChunks,
      activeChunks: this.activeChunks,
      peakInFlightChunks: this.peakInFlightChunks,
      reliabilityEntries: this.reliability.size,
      transferStates: this.sessions.size,
    };
  }

  session(contentId: ContentId): ContentTransferSession | undefined {
    const value = this.sessions.get(contentId);
    if (!value) return undefined;
    return cloneSession(value);
  }

  availability(contentId: ContentId, sources: readonly DistributedContentSource[] = []): 'metadata known' | 'some chunks local' | 'complete content local' | 'available through Keystone Network' | 'transfer pending' {
    const manifest = this.cache.manifest(contentId);
    if (!manifest) return sources.length ? 'available through Keystone Network' : 'metadata known';
    const missing = this.cache.missing(manifest);
    if (!missing.length) return 'complete content local';
    if (this.active.has(contentId)) return 'transfer pending';
    if (missing.length < manifest.chunks.length) return 'some chunks local';
    return sources.length ? 'available through Keystone Network' : 'metadata known';
  }

  async download(request: DistributedContentRequest): Promise<Uint8Array> {
    const manifest = parseManifest(request.manifest);
    const chunks = new Map<number, Uint8Array>();
    await this.downloadTo(request, async (chunk, index) => { chunks.set(index, chunk.slice()); });
    const result = concatChunks(manifest.chunks.map((_, index) => chunks.get(index) ?? this.cache.chunk(manifest.contentId, index) ?? new Uint8Array()), manifest.byteLength);
    if (`sha256-${await sha256(result)}` !== manifest.contentId) throw new ContentTransferError('INTEGRITY', 'Final content hash mismatch');
    return result;
  }

  /** Downloads into a bounded sink without assembling the entire object in RAM. */
  async downloadTo(request: DistributedContentRequest, sink: (chunk: Uint8Array, index: number) => void | Promise<void>): Promise<ContentTransferSession> {
    const manifest = parseManifest(request.manifest);
    if (this.active.size >= this.maxActiveTransfers && !this.active.has(manifest.contentId)) throw new ContentTransferError('RESOURCE_LIMIT', 'Active content transfer limit reached');
    const authorization = request.authorization;
    const supplied = request.sources ?? (this.directory ? await this.directory.sources(manifest, authorization) : []);
    const sources = await this.eligibleSources(manifest, supplied, authorization);
    if (!sources.length && this.cache.missing(manifest).length) throw new ContentTransferError('UNAVAILABLE', 'No eligible content source is available');
    await this.cache.putManifest(manifest);
    const missing = this.cache.missing(manifest);
    const current = this.sessions.get(manifest.contentId);
    this.active.add(manifest.contentId);
    let retries = current?.state.retries ?? 0;
    let completedThisRun = 0;
    let firstError: unknown;
    const sourceBusy = new Map<string, number>();
    const queue = missing.slice();
    let cursor = 0;
    // A host may further reduce concurrency for a particular transfer (for
    // example while a provider is reconnecting). Never let a request raise
    // the service-wide bound, and keep at least one worker for an already
    // complete transfer so the session is persisted as COMPLETE.
    const effectiveMaxInFlight = bounded(request.maxInFlightChunks ?? this.maxInFlightChunks, 1, this.maxInFlightChunks);
    const requestedChunkBound = request.maxChunks === undefined ? undefined : bounded(request.maxChunks, 1, queue.length || 1);
    const workerCount = Math.min(effectiveMaxInFlight, requestedChunkBound ?? (queue.length || 1));
    const wake = () => { for (const resolve of this.sourceWake) resolve(); this.sourceWake.clear(); };
    const chooseSource = (index: number, attempt: number): DistributedContentSource => {
      const ordered = sources.slice().sort((a, b) => reliabilityScore(b.id) - reliabilityScore(a.id) || a.id.localeCompare(b.id));
      return ordered[(index + attempt) % ordered.length]!;
    };
    const runWorker = async (): Promise<void> => {
      while (true) {
        if (request.signal?.aborted) throw new ContentTransferError('CANCELLED', 'Content transfer cancelled');
        const index = queue[cursor++];
        if (index === undefined) return;
        let delivered = false;
        let lastError: unknown;
        for (let attempt = 0; attempt <= this.maxRetriesPerChunk && !delivered; attempt++) {
          if (request.signal?.aborted) throw new ContentTransferError('CANCELLED', 'Content transfer cancelled');
          const source = chooseSource(index, attempt);
          await this.acquireSource(source.id, sourceBusy, request.signal);
          this.activeChunks += 1;
          this.peakInFlightChunks = Math.max(this.peakInFlightChunks, this.activeChunks);
          try {
            const available = source.available ? await source.available() : true;
            if (!available) throw new Error(`Source ${source.id} unavailable`);
            const bytes = await source.getChunk(manifest.contentId, index, request.signal);
            const expected = chunkLength(manifest, index);
            if (bytes.byteLength !== expected) throw new ContentTransferError('INTEGRITY', `Source ${source.id} returned wrong chunk length`);
            if (await sha256(bytes) !== manifest.chunks[index]) throw new ContentTransferError('INTEGRITY', `Source ${source.id} returned corrupt chunk`);
            await this.cache.putVerifiedChunk(manifest, index, bytes);
            await sink(bytes.slice(), index);
            this.recordReliability(source.id, true);
            delivered = true;
            completedThisRun += 1;
            const remaining = this.cache.missing(manifest);
            const progress: DistributedContentProgress = { contentId: manifest.contentId, completedChunks: manifest.chunks.length - remaining.length, totalChunks: manifest.chunks.length, completedBytes: manifest.byteLength - completedBytes(manifest, remaining), totalBytes: manifest.byteLength, activeSources: [...new Set(sources.map(value => value.id))].slice(0, this.maxActiveSources), retries, };
            request.onProgress?.(progress);
            await this.persistState(manifest, progress, retries);
            if (request.maxChunks !== undefined && completedThisRun >= request.maxChunks && remaining.length) throw new ContentTransferError('PAUSED', 'Transfer paused at requested chunk bound');
          } catch (error) {
            lastError = error;
            retries += 1;
            this.recordReliability(source.id, false);
            if (error instanceof ContentTransferError && (error.code === 'CANCELLED' || error.code === 'PAUSED')) throw error;
          } finally {
            this.activeChunks -= 1;
            const currentBusy = sourceBusy.get(source.id) ?? 1;
            if (currentBusy <= 1) sourceBusy.delete(source.id); else sourceBusy.set(source.id, currentBusy - 1);
            wake();
          }
        }
        if (!delivered) { firstError = lastError ?? new ContentTransferError('UNAVAILABLE', `No source delivered chunk ${index}`); return; }
      }
    };
    try {
      await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
      if (firstError) throw firstError;
      const finalMissing = this.cache.missing(manifest);
      const state: ContentTransferState = { version: 1, contentId: manifest.contentId, totalChunks: manifest.chunks.length, completedChunks: manifest.chunks.length - finalMissing.length, completedBytes: manifest.byteLength - completedBytes(manifest, finalMissing), state: finalMissing.length ? 'PAUSED' : 'COMPLETE', updatedAt: this.now(), retries };
      const session: ContentTransferSession = { contentId: manifest.contentId, manifest, state, missingChunks: finalMissing, activeSources: [...new Set(sources.map(value => value.id))].slice(0, this.maxActiveSources) };
      this.sessions.set(manifest.contentId, session);
      await this.persistState(manifest, { contentId: manifest.contentId, completedChunks: state.completedChunks, totalChunks: state.totalChunks, completedBytes: state.completedBytes, totalBytes: manifest.byteLength, activeSources: session.activeSources, retries }, retries, state.state);
      return cloneSession(session);
    } catch (error) {
      const missingAfter = this.cache.missing(manifest);
      const paused = error instanceof ContentTransferError && error.code === 'PAUSED';
      const state: ContentTransferState = { version: 1, contentId: manifest.contentId, totalChunks: manifest.chunks.length, completedChunks: manifest.chunks.length - missingAfter.length, completedBytes: manifest.byteLength - completedBytes(manifest, missingAfter), state: paused ? 'PAUSED' : error instanceof ContentTransferError && error.code === 'CANCELLED' ? 'CANCELLED' : 'FAILED', updatedAt: this.now(), retries };
      const session: ContentTransferSession = { contentId: manifest.contentId, manifest, state, missingChunks: missingAfter, activeSources: [...new Set(sources.map(value => value.id))].slice(0, this.maxActiveSources) };
      this.sessions.set(manifest.contentId, session);
      await this.persistState(manifest, { contentId: manifest.contentId, completedChunks: state.completedChunks, totalChunks: state.totalChunks, completedBytes: state.completedBytes, totalBytes: manifest.byteLength, activeSources: session.activeSources, retries }, retries, state.state);
      throw error;
    } finally {
      this.active.delete(manifest.contentId);
    }
  }

  private async eligibleSources(manifest: ContentManifest, sources: readonly DistributedContentSource[], authorization?: ContentAuthorization): Promise<readonly DistributedContentSource[]> {
    const policy = manifest.contentPolicy ?? 'PRIVATE_NO_STRANGER_CACHE';
    const filtered: DistributedContentSource[] = [];
    for (const source of sources.slice(0, this.maxActiveSources * 4)) {
      if (policy === 'PUBLIC_CACHEABLE') {
        if (source.scope !== 'PUBLIC_CACHE' && source.scope !== 'LOCAL' && source.scope !== 'OWNED_DEVICE') continue;
      } else if (policy === 'OWNED_DEVICES') {
        if (authorization?.scope !== 'OWNER' || (source.scope !== 'OWNED_DEVICE' && source.scope !== 'LOCAL')) continue;
      } else if (policy === 'AUTHORIZED_GROUP') {
        if (authorization?.scope !== 'AUTHORIZED_GROUP' || (source.scope !== 'AUTHORIZED_GROUP' && source.scope !== 'LOCAL' && source.scope !== 'OWNED_DEVICE')) continue;
      } else if (policy === 'PRIVATE_NO_STRANGER_CACHE') {
        if (!authorization && source.scope !== 'LOCAL') continue;
        if (source.scope !== 'LOCAL' && source.scope !== 'OWNED_DEVICE' && source.scope !== 'AUTHORIZED_GROUP') continue;
      }
      if (source.canServe && !(await source.canServe(manifest, authorization))) continue;
      filtered.push(source);
    }
    return filtered;
  }

  private async acquireSource(id: string, busy: Map<string, number>, signal?: AbortSignal): Promise<void> {
    while ((busy.get(id) ?? 0) >= this.maxRequestsPerSource) {
      if (signal?.aborted) throw new ContentTransferError('CANCELLED', 'Content transfer cancelled');
      await new Promise<void>((resolve, reject) => {
        const abort = () => { signal?.removeEventListener('abort', abort); reject(new ContentTransferError('CANCELLED', 'Content transfer cancelled')); };
        signal?.addEventListener('abort', abort, { once: true });
        this.sourceWake.add(() => { signal?.removeEventListener('abort', abort); resolve(); });
      });
    }
    busy.set(id, (busy.get(id) ?? 0) + 1);
  }

  private recordReliability(id: string, success: boolean): void {
    const value = this.reliability.get(id) ?? { successes: 0, failures: 0 };
    if (success) value.successes += 1; else { value.failures += 1; value.lastFailureAt = this.now(); }
    this.reliability.delete(id); this.reliability.set(id, value);
    while (this.reliability.size > this.maxReliabilityEntries) this.reliability.delete(this.reliability.keys().next().value as string);
  }

  private async persistState(manifest: ContentManifest, progress: DistributedContentProgress, retries: number, lifecycle: ContentTransferLifecycle = 'DOWNLOADING'): Promise<void> {
    if (!this.transferState) return;
    const sessions: Record<string, ContentTransferState> = {};
    for (const [contentId, session] of this.sessions) sessions[contentId] = { ...session.state };
    sessions[manifest.contentId] = { version: 1, contentId: manifest.contentId, totalChunks: manifest.chunks.length, completedChunks: progress.completedChunks, completedBytes: progress.completedBytes, state: lifecycle, updatedAt: this.now(), retries };
    const entries = Object.entries(sessions).slice(-256);
    const value = { version: 1 as const, sessions: Object.fromEntries(entries) };
    await this.transferState.write(value);
  }
}

export interface DistributedContentServerOptions {
  readonly maxContentBytes?: number;
  readonly maxConcurrentRequests?: number;
  readonly maxRequestsPerPeer?: number;
  readonly maxPendingRequests?: number;
  readonly requestTimeoutMs?: number;
  readonly now?: () => number;
}

interface ServedContent { manifest: ContentManifest; bytes: Uint8Array; policy: ContentCachePolicy; authorizedPeers: Set<string>; }

/**
 * Production Fabric content request/response boundary. It is intentionally
 * an opaque signed envelope protocol; no provider or route is selected here.
 */
export class DistributedContentServer {
  private readonly served = new Map<ContentId, ServedContent>();
  private readonly pending = new Map<string, { resolve: (bytes: Uint8Array) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private readonly peerActive = new Map<string, number>();
  private readonly maxContentBytes: number;
  private readonly maxConcurrentRequests: number;
  private readonly maxRequestsPerPeer: number;
  private readonly maxPendingRequests: number;
  private readonly requestTimeoutMs: number;
  private readonly now: () => number;
  private readonly unsubscribe: () => void;

  constructor(private readonly transport: KeystoneDeliveryInterface, private readonly security: EnvelopeSecurity, private readonly local: DeviceSessionKeys, options: DistributedContentServerOptions = {}) {
    this.maxContentBytes = Math.max(16 * 1024, Math.min(64 * 1024 * 1024, options.maxContentBytes ?? 64 * 1024 * 1024));
    this.maxConcurrentRequests = bounded(options.maxConcurrentRequests ?? 8, 1, 64);
    this.maxRequestsPerPeer = bounded(options.maxRequestsPerPeer ?? 4, 1, 16);
    this.maxPendingRequests = bounded(options.maxPendingRequests ?? 64, 1, 256);
    this.requestTimeoutMs = bounded(options.requestTimeoutMs ?? 20_000, 1_000, 120_000);
    this.now = options.now ?? Date.now;
    this.unsubscribe = transport.onMessage(envelope => { void this.receive(envelope); });
  }

  close(): void {
    this.unsubscribe();
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('Distributed content server closed')); }
    this.pending.clear();
    this.served.clear();
  }

  async serve(manifest: ContentManifest, bytes: Uint8Array, options: { policy: ContentCachePolicy; authorizedPeers?: readonly string[] } = { policy: 'PRIVATE_NO_STRANGER_CACHE' }): Promise<void> {
    const parsed = parseManifest(manifest);
    if (bytes.byteLength > this.maxContentBytes || bytes.byteLength !== parsed.byteLength) throw new ContentTransferError('RESOURCE_LIMIT', 'Served content exceeds bounds or manifest size');
    if (`sha256-${await sha256(bytes)}` !== parsed.contentId) throw new ContentTransferError('INTEGRITY', 'Served bytes do not match content address');
    for (let index = 0; index < parsed.chunks.length; index++) if (await sha256(bytes.subarray(index * parsed.chunkSize, Math.min(bytes.byteLength, (index + 1) * parsed.chunkSize))) !== parsed.chunks[index]) throw new ContentTransferError('INTEGRITY', 'Served chunk does not match manifest');
    this.served.set(parsed.contentId, { manifest: parsed, bytes: bytes.slice(), policy: options.policy, authorizedPeers: new Set(options.authorizedPeers ?? []) });
  }

  unserve(contentId: ContentId): void { this.served.delete(contentId); }

  source(peer: string, authorization?: ContentAuthorization): DistributedContentSource {
    return {
      id: `fabric-content:${peer}`,
      scope: authorization?.scope === 'PUBLIC' ? 'PUBLIC_CACHE' : authorization?.scope === 'OWNER' ? 'OWNED_DEVICE' : 'AUTHORIZED_GROUP',
      getChunk: (contentId, index, signal) => this.request(peer, contentId, index, authorization, signal),
    };
  }

  private async request(peer: string, contentId: ContentId, index: number, authorization?: ContentAuthorization, signal?: AbortSignal): Promise<Uint8Array> {
    if (signal?.aborted) throw new ContentTransferError('CANCELLED', 'Content transfer cancelled');
    const requestId = crypto.randomUUID();
    const unsigned: UnsignedEnvelope = { version: 1, type: 'content.chunk.request', id: crypto.randomUUID(), sender: this.local.nodeId, recipient: peer, nonce: crypto.randomUUID(), expiresAt: new Date(this.now() + 60_000).toISOString(), body: { requestId, contentId, index, authorization: authorization?.scope === 'PUBLIC' ? { scope: 'PUBLIC' } : authorization } };
    if (this.pending.size >= this.maxPendingRequests) throw new ContentTransferError('RESOURCE_LIMIT', 'Pending content request limit reached');
    let timer: ReturnType<typeof setTimeout> | undefined;
    const answer = new Promise<Uint8Array>((resolve, reject) => {
      timer = setTimeout(() => { this.pending.delete(requestId); reject(new ContentTransferError('TIMEOUT', 'Content chunk request timed out')); }, this.requestTimeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
    });
    const abort = () => { const pending = this.pending.get(requestId); if (!pending) return; clearTimeout(pending.timer); this.pending.delete(requestId); pending.reject(new ContentTransferError('CANCELLED', 'Content transfer cancelled')); };
    signal?.addEventListener('abort', abort, { once: true });
    try {
      traceContent('request.send', { peer, requestId, index });
      await this.transport.connect(peer);
      await this.transport.send(peer, { ...unsigned, signature: await this.security.sign(unsigned) });
      const result = await answer;
      traceContent('request.received', { peer, requestId, index, bytes: result.byteLength });
      return result;
    } finally { signal?.removeEventListener('abort', abort); const pending = this.pending.get(requestId); if (pending) clearTimeout(pending.timer); this.pending.delete(requestId); }
  }

  private async receive(envelope: Envelope): Promise<void> {
    if (!(envelope.type.startsWith('content.')) || envelope.recipient !== this.local.nodeId) return;
    if (Date.parse(envelope.expiresAt) <= this.now()) { traceContent('receive.expired', { type: envelope.type, id: envelope.id }); return; }
    if (!(await this.security.verify(envelope))) { traceContent('receive.invalid-signature', { type: envelope.type, id: envelope.id }); return; }
    const body = envelope.body && typeof envelope.body === 'object' ? envelope.body as Record<string, unknown> : {};
    if (envelope.type === 'content.chunk.response') {
      if (typeof body.requestId !== 'string' || typeof body.bytes !== 'string') return;
      const pending = this.pending.get(body.requestId); if (!pending) return;
      try { const bytes = fromBase64(body.bytes); traceContent('receive.response', { requestId: body.requestId, index: body.index, bytes: bytes.byteLength }); pending.resolve(bytes); } catch { pending.reject(new ContentTransferError('INTEGRITY', 'Invalid content response bytes')); }
      return;
    }
    if (envelope.type !== 'content.chunk.request' || typeof body.requestId !== 'string' || typeof body.contentId !== 'string' || !isContentId(body.contentId) || !Number.isSafeInteger(body.index)) return;
    const index = body.index as number;
    const value = this.served.get(body.contentId as ContentId); if (!value) { traceContent('receive.unknown-content', { contentId: body.contentId }); return; }
    if (index < 0 || index >= value.manifest.chunks.length) { traceContent('receive.invalid-index', { index }); return; }
    const requester = envelope.sender;
    const active = this.peerActive.get(requester) ?? 0;
    if (active >= this.maxRequestsPerPeer || [...this.peerActive.values()].reduce((sum, item) => sum + item, 0) >= this.maxConcurrentRequests) { traceContent('receive.resource-limit', { requester, index }); return; }
    const authorization = parseAuthorization(body.authorization);
    if (!allowedToServe(value.policy, requester, value.authorizedPeers, authorization)) { traceContent('receive.authorization-denied', { requester, index, policy: value.policy, scope: authorization?.scope }); return; }
    traceContent('receive.request', { requester, requestId: body.requestId, index });
    this.peerActive.set(requester, active + 1);
    try {
      const start = index * value.manifest.chunkSize;
      const bytes = value.bytes.subarray(start, Math.min(value.bytes.byteLength, start + value.manifest.chunkSize));
      const unsigned: UnsignedEnvelope = { version: 1, type: 'content.chunk.response', id: crypto.randomUUID(), sender: this.local.nodeId, recipient: requester, nonce: crypto.randomUUID(), expiresAt: new Date(this.now() + 60_000).toISOString(), body: { requestId: body.requestId, contentId: value.manifest.contentId, index, bytes: toBase64(bytes) } };
      await this.transport.send(requester, { ...unsigned, signature: await this.security.sign(unsigned) });
      traceContent('receive.sent', { requester, requestId: body.requestId, index, bytes: bytes.byteLength });
    } finally {
      const next = (this.peerActive.get(requester) ?? 1) - 1;
      if (next <= 0) this.peerActive.delete(requester); else this.peerActive.set(requester, next);
    }
  }
}

function allowedToServe(policy: ContentCachePolicy, requester: string, authorizedPeers: Set<string>, authorization?: ContentAuthorization): boolean {
  if (policy === 'PUBLIC_CACHEABLE') return authorization?.scope === 'PUBLIC';
  if (policy === 'OWNED_DEVICES') return authorization?.scope === 'OWNER' && authorizedPeers.has(requester);
  if (policy === 'AUTHORIZED_GROUP') return authorization?.scope === 'AUTHORIZED_GROUP' && authorizedPeers.has(requester);
  return authorizedPeers.has(requester) && (authorization?.scope === 'OWNER' || authorization?.scope === 'AUTHORIZED_GROUP');
}

function parseAuthorization(value: unknown): ContentAuthorization | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Record<string, unknown>;
  if (candidate.scope !== 'OWNER' && candidate.scope !== 'AUTHORIZED_GROUP' && candidate.scope !== 'PUBLIC') return undefined;
  return { scope: candidate.scope, ...(typeof candidate.grant === 'string' ? { grant: candidate.grant.slice(0, 256) } : {}), ...(typeof candidate.subjectId === 'string' ? { subjectId: candidate.subjectId.slice(0, 256) } : {}) };
}

function parseManifest(value: ContentManifest): ContentManifest {
  const parsed = contentManifestSchema.safeParse(value);
  if (!parsed.success) throw new ContentTransferError('INVALID_MANIFEST', 'Invalid or unsupported content manifest');
  const manifest = parsed.data as ContentManifest;
  if (manifest.version !== CONTENT_MANIFEST_VERSION || manifest.chunks.length > 4_000_000 || manifest.byteLength > 2 ** 40) throw new ContentTransferError('INVALID_MANIFEST', 'Manifest exceeds protocol bounds');
  return manifest;
}

function isContentId(value: string): value is ContentId { return /^sha256-[a-f0-9]{64}$/i.test(value); }
function isTransferState(value: unknown): value is ContentTransferState { if (!value || typeof value !== 'object') return false; const candidate = value as Record<string, unknown>; return candidate.version === 1 && typeof candidate.contentId === 'string' && isContentId(candidate.contentId) && Number.isSafeInteger(candidate.totalChunks) && Number.isSafeInteger(candidate.completedChunks) && Number.isSafeInteger(candidate.completedBytes) && ['IDLE', 'DOWNLOADING', 'PAUSED', 'COMPLETE', 'FAILED', 'CANCELLED'].includes(String(candidate.state)) && Number.isFinite(candidate.updatedAt) && Number.isSafeInteger(candidate.retries); }
function chunkLength(manifest: ContentManifest, index: number): number { return index === manifest.chunks.length - 1 ? manifest.byteLength - manifest.chunkSize * index : manifest.chunkSize; }
function completedBytes(manifest: ContentManifest, missing: readonly number[]): number { const missingSet = new Set(missing); let bytes = 0; for (let index = 0; index < manifest.chunks.length; index++) if (!missingSet.has(index)) bytes += chunkLength(manifest, index); return bytes; }
function concatChunks(chunks: readonly Uint8Array[], expected: number): Uint8Array { const output = new Uint8Array(expected); let offset = 0; for (const chunk of chunks) { if (offset + chunk.length > expected) throw new ContentTransferError('INTEGRITY', 'Chunk sink exceeded manifest size'); output.set(chunk, offset); offset += chunk.length; } if (offset !== expected) throw new ContentTransferError('INTEGRITY', 'Chunk sink did not produce complete content'); return output; }
function cloneSession(value: ContentTransferSession): ContentTransferSession { return { contentId: value.contentId, manifest: structuredClone(value.manifest), state: { ...value.state }, missingChunks: [...value.missingChunks], activeSources: [...value.activeSources] }; }
function bounded(value: number, min: number, max: number): number { if (!Number.isFinite(value)) return min; return Math.max(min, Math.min(max, Math.floor(value))); }
function reliabilityScore(id: string): number { return id.length; }
function toBase64(bytes: Uint8Array): string { let binary = ''; const step = 0x8000; for (let index = 0; index < bytes.length; index += step) binary += String.fromCharCode(...bytes.subarray(index, Math.min(bytes.length, index + step))); return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, ''); }
function fromBase64(value: string): Uint8Array { const normalized = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '='); const binary = atob(normalized); const bytes = new Uint8Array(binary.length); for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index); return bytes; }
function traceContent(_event: string, _details: Record<string, unknown>): void { /* diagnostics are intentionally side-effect free */ }
