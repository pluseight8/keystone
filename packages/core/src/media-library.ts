/**
 * R0P86 Photos & Personal Media Library.
 *
 * This module owns the private media index and its policy boundaries.  It
 * deliberately does not own a second blob store: original bytes are imported
 * through the R0P74 content boundary and every library record keeps only a
 * content address plus bounded metadata.  Filesystem paths, camera-roll APIs,
 * decoders, transports and publication providers stay behind typed adapters.
 */

import {
  ContentCache,
  createContentManifest,
  sha256,
  type ContentCachePolicy,
  type ContentId,
  type ContentManifest,
} from './social/content.js';
import type {
  NativeHost,
  NativeHostErrorCode,
  NativeHostPrincipal,
  NativeMediaCapability,
} from '@keystone/native-host';

export const MEDIA_LIBRARY_VERSION = 1 as const;
export const MEDIA_DERIVATIVE_VERSION = 1 as const;
export const MEDIA_MAX_ASSET_BYTES = 4 * 1024 * 1024 * 1024;
export const MEDIA_MAX_METADATA_BYTES = 2 * 1024 * 1024;
export const MEDIA_MAX_DIMENSION = 100_000;
export const MEDIA_MAX_PIXELS = 250_000_000;
export const MEDIA_MAX_DERIVATIVE_BYTES = 32 * 1024 * 1024;
export const MEDIA_MAX_IMPORT_ITEMS = 10_000;

export type MediaId = `media:${ContentId}`;
export type MediaKind = 'IMAGE' | 'VIDEO';
export type MediaImportState = 'DISCOVERING' | 'IMPORTING' | 'VERIFYING' | 'IMPORTED' | 'DUPLICATE' | 'SKIPPED' | 'FAILED' | 'CANCELED';
export type MediaAssetState = 'ACTIVE' | 'TRASHED';
export type MediaDerivativeKind = 'THUMBNAIL' | 'PREVIEW' | 'VIDEO_FRAME' | 'EDIT_RENDITION';
export type MediaDerivativeState = 'READY' | 'REGENERATE_REQUIRED' | 'UNAVAILABLE' | 'FAILED';
export type MediaSourceKind = 'LOCAL_FILE' | 'SELECTED_FOLDER' | 'CAMERA_ROLL' | 'WATCHED_FOLDER' | 'RECEIVED_FILE';
export type MediaCaptureTimeSource = 'EMBEDDED_METADATA' | 'FILE_MODIFIED_TIME' | 'USER_SET' | 'UNKNOWN';
export type MediaVisibilityState = 'VISIBLE' | 'HIDDEN' | 'LOCKED';

export interface MediaLocation {
  readonly latitude: number;
  readonly longitude: number;
  readonly altitudeMeters?: number;
  readonly source: 'EMBEDDED_EXIF' | 'EMBEDDED_CONTAINER' | 'USER_SET';
}

export interface MediaMetadata {
  readonly width?: number;
  readonly height?: number;
  readonly durationMs?: number;
  readonly rotationDegrees?: 0 | 90 | 180 | 270;
  readonly orientation?: number;
  readonly captureTime?: string;
  readonly captureTimeSource: MediaCaptureTimeSource;
  readonly cameraMake?: string;
  readonly cameraModel?: string;
  readonly gps?: MediaLocation;
  readonly metadataTruncated: boolean;
  readonly metadataWarnings?: readonly string[];
}
type MutableMediaMetadata = { -readonly [Key in keyof MediaMetadata]?: MediaMetadata[Key] };

export interface MediaAsset {
  readonly version: 1;
  readonly id: MediaId;
  readonly contentId: ContentId;
  readonly filename: string;
  readonly mimeType: string;
  readonly kind: MediaKind;
  readonly byteLength: number;
  readonly importedAt: string;
  readonly state: MediaAssetState;
  readonly capture: MediaMetadata;
  readonly title?: string;
  readonly caption?: string;
  readonly tags: readonly string[];
  readonly favorite: boolean;
  /** A source identifier is safe to persist; an absolute host path is not. */
  readonly source: { readonly kind: MediaSourceKind; readonly selectionId?: string };
}

export interface MediaImportJob {
  readonly version: 1;
  readonly id: string;
  readonly state: MediaImportState;
  readonly filename: string;
  readonly source: MediaSourceKind;
  readonly selectionId?: string;
  readonly mediaId?: MediaId;
  readonly duplicateOf?: MediaId;
  readonly error?: string;
  readonly startedAt: string;
  readonly updatedAt: string;
}

export interface MediaAlbum {
  readonly version: 1;
  readonly id: string;
  readonly name: string;
  readonly assetIds: readonly MediaId[];
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Shared albums carry references only; image/video bytes never enter CRDT state. */
  readonly sharing: 'PRIVATE' | 'SHARED_REFERENCE_ONLY';
}

export interface MediaDerivativeRecord {
  readonly version: 1;
  readonly id: string;
  readonly sourceMediaId: MediaId;
  readonly sourceContentId: ContentId;
  readonly kind: MediaDerivativeKind;
  readonly recipeVersion: number;
  readonly recipeHash: string;
  readonly contentId?: ContentId;
  readonly mimeType?: string;
  readonly byteLength?: number;
  readonly state: MediaDerivativeState;
  readonly updatedAt: string;
  readonly error?: string;
}

export interface MediaPlacementState {
  readonly mediaId: MediaId;
  readonly deviceId: string;
  readonly metadata: 'AVAILABLE' | 'UNAVAILABLE';
  readonly thumbnail: 'AVAILABLE' | 'UNAVAILABLE' | 'PENDING';
  readonly original: 'AVAILABLE' | 'UNAVAILABLE' | 'PENDING' | 'REVOKED';
  readonly updatedAt: string;
}

export interface MediaTombstone {
  readonly mediaId: MediaId;
  readonly contentId: ContentId;
  readonly deletedAt: string;
  readonly reason: 'PERMANENT_DELETE';
}

export interface MediaImportCandidate {
  readonly name: string;
  readonly declaredMimeType?: string;
  readonly size?: number;
  readonly modifiedAt?: string;
  readonly read: (signal?: AbortSignal) => Promise<Uint8Array>;
}

/**
 * The host must create this source only after the owner has selected the
 * concrete file/folder/camera-roll scope.  `list` is bounded by the service;
 * it is not a permission to scan a disk.
 */
export interface MediaImportSource {
  readonly kind: Exclude<MediaSourceKind, 'LOCAL_FILE' | 'RECEIVED_FILE'>;
  readonly selectionId: string;
  readonly list: () => Promise<readonly MediaImportCandidate[]>;
}

export interface MediaContentStore {
  readonly cache?: ContentCache;
  import(bytes: Uint8Array, options: { readonly mimeType: string; readonly name?: string }): Promise<ContentManifest>;
  manifest(contentId: ContentId): ContentManifest | undefined | Promise<ContentManifest | undefined>;
  read?(contentId: ContentId, signal?: AbortSignal): Promise<Uint8Array | undefined>;
  removeLocalCopy?(contentId: ContentId): Promise<boolean>;
}

/** Test/host reference implementation backed by the existing R0P74 cache. */
export class ContentCacheMediaStore implements MediaContentStore {
  constructor(readonly cache = new ContentCache(8 * 1024 * 1024 * 1024)) {}

  async import(bytes: Uint8Array, options: { readonly mimeType: string; readonly name?: string }): Promise<ContentManifest> {
    const manifest = await createContentManifest(bytes, {
      mimeType: options.mimeType,
      ...(options.name ? { name: options.name } : {}),
      contentPolicy: 'PRIVATE_NO_STRANGER_CACHE' satisfies ContentCachePolicy,
    });
    await this.cache.putManifest(manifest);
    for (let index = 0; index < manifest.chunks.length; index++) {
      const start = index * manifest.chunkSize;
      await this.cache.putVerifiedChunk(manifest, index, bytes.subarray(start, Math.min(bytes.length, start + manifest.chunkSize)));
    }
    return manifest;
  }

  manifest(contentId: ContentId): ContentManifest | undefined { return this.cache.manifest(contentId); }
  read(contentId: ContentId): Promise<Uint8Array | undefined> { return this.cache.read(contentId); }
  async removeLocalCopy(contentId: ContentId): Promise<boolean> { return this.cache.remove(contentId); }
}

export interface MediaProbeContext { readonly filename: string; readonly declaredMimeType?: string; readonly maxBytes: number; }
export interface MediaProbeResult {
  readonly kind: MediaKind;
  readonly mimeType: string;
  readonly metadata?: Partial<MediaMetadata>;
}
export interface MediaProbeAdapter { probe(bytes: Uint8Array, context: MediaProbeContext): Promise<MediaProbeResult>; }

export interface MediaDerivativeRequest {
  readonly source: MediaAsset;
  readonly sourceBytes: Uint8Array;
  readonly kind: MediaDerivativeKind;
  readonly recipe: Readonly<Record<string, string | number | boolean>>;
  readonly signal?: AbortSignal;
}
export interface MediaDerivativeAdapter {
  generate(request: MediaDerivativeRequest): Promise<{ readonly bytes: Uint8Array; readonly mimeType: string }>;
  /** Optional host decoder boundary for explicit metadata-stripped exports. */
  stripLocation?(request: MediaDerivativeRequest): Promise<{ readonly bytes: Uint8Array; readonly mimeType: string }>;
}

export type MediaDecoderCapability = NativeMediaCapability;
export interface MediaDecoder extends MediaProbeAdapter, MediaDerivativeAdapter {
  readonly kind: 'PRODUCTION_MEDIA_DECODER';
  capabilities(): readonly MediaDecoderCapability[];
  validateGenerated?(request: MediaDerivativeRequest, generated: { readonly bytes: Uint8Array; readonly mimeType: string }): Promise<void>;
}

export interface MediaVaultVisibilityAdapter { visibility(mediaId: MediaId): MediaVisibilityState | Promise<MediaVisibilityState>; }

export type MediaShareDestination = 'CONTACTS' | 'MESSAGES' | 'SPACES' | 'NEARBY' | 'OWN_DEVICE' | 'PERSONAL_WEB';
export type MediaShareMode = 'COPY' | 'ALBUM_REFERENCE' | 'PUBLISH_RENDITION';
export interface MediaShareRequest {
  readonly mediaId: MediaId;
  readonly destination: MediaShareDestination;
  readonly mode: MediaShareMode;
  readonly ownerConfirmed: boolean;
  readonly targetId?: string;
  readonly stripLocation?: boolean;
  readonly locationConfirmed?: boolean;
  readonly derivative?: MediaDerivativeKind;
}
export interface MediaSharePayload {
  readonly mediaId: MediaId;
  readonly sourceContentId: ContentId;
  readonly contentId: ContentId;
  readonly destination: MediaShareDestination;
  readonly mode: MediaShareMode;
  readonly publicCacheable: boolean;
  readonly metadataPolicy: 'PRESERVE' | 'STRIP_LOCATION';
  readonly targetId?: string;
}
export interface MediaShareReceipt { readonly id: string; readonly destination: MediaShareDestination; readonly mode: MediaShareMode; readonly contentId: ContentId; readonly publicCacheable: boolean; }
export interface MediaShareAdapter { share(payload: MediaSharePayload): Promise<MediaShareReceipt>; }

export type MediaPlacementRequestMode = 'METADATA' | 'THUMBNAIL' | 'ORIGINAL';
export interface MediaPlacementRequest { readonly mediaId: MediaId; readonly targetDeviceId: string; readonly mode: MediaPlacementRequestMode; readonly ownerConfirmed: boolean; readonly allowMetered?: boolean; }
export interface MediaPlacementAdapter { place(request: MediaPlacementRequest & { readonly contentId: ContentId }): Promise<MediaPlacementState>; }

export interface MediaLibraryStateStore { read(): Promise<unknown | undefined>; write(value: unknown): Promise<void>; }
export class InMemoryMediaLibraryStateStore implements MediaLibraryStateStore {
  private value?: unknown;
  async read(): Promise<unknown | undefined> { return this.value === undefined ? undefined : structuredClone(this.value); }
  async write(value: unknown): Promise<void> { this.value = structuredClone(value); }
}

export interface MediaLibraryLimits {
  readonly maxAssets?: number;
  readonly maxImportItems?: number;
  readonly maxAssetBytes?: number;
  readonly maxMetadataBytes?: number;
  readonly maxDerivativeBytes?: number;
  readonly maxDerivativeQueue?: number;
  readonly maxDerivativeWorkers?: number;
}

export interface MediaLibraryOptions {
  readonly content?: MediaContentStore;
  readonly state?: MediaLibraryStateStore;
  /** The only production decoder boundary. Controlled adapters remain explicit test inputs. */
  readonly decoder?: MediaDecoder;
  readonly probe?: MediaProbeAdapter;
  readonly derivatives?: MediaDerivativeAdapter;
  readonly vault?: MediaVaultVisibilityAdapter;
  readonly share?: MediaShareAdapter;
  readonly placement?: MediaPlacementAdapter;
  readonly ownerIdentityId?: string;
  readonly now?: () => number;
  readonly limits?: MediaLibraryLimits;
}

export interface MediaImportInput {
  readonly bytes: Uint8Array;
  readonly filename: string;
  readonly declaredMimeType?: string;
  readonly modifiedAt?: string;
  readonly source?: MediaSourceKind;
  readonly selectionId?: string;
  readonly signal?: AbortSignal;
}
export interface MediaImportResult { readonly job: MediaImportJob; readonly asset?: MediaAsset; readonly duplicateOf?: MediaAsset; }
export interface MediaBatchImportResult { readonly jobs: readonly MediaImportJob[]; readonly imported: number; readonly duplicates: number; readonly failed: number; readonly canceled: number; }

export interface MediaTimelineQuery { readonly cursor?: string; readonly limit?: number; readonly includeFavoritesOnly?: boolean; readonly includeTrash?: boolean; readonly kind?: MediaKind; readonly year?: number; readonly month?: number; }
export interface MediaTimelinePage { readonly items: readonly MediaAsset[]; readonly nextCursor?: string; readonly total: number; readonly groups: readonly MediaTimelineGroup[]; }
export interface MediaTimelineGroup { readonly key: string; readonly year: number; readonly month?: number; readonly day?: number; readonly count: number; }
export interface MediaSearchQuery { readonly query: string; readonly limit?: number; readonly kind?: MediaKind; readonly includeTrash?: boolean; }
export interface MediaSearchResult { readonly asset: MediaAsset; readonly score: number; readonly matchedFields: readonly string[]; }
export interface MediaMapQuery { readonly ownerConfirmed: boolean; readonly includeTrashed?: boolean; }
export interface MediaMapPoint { readonly mediaId: MediaId; readonly contentId: ContentId; readonly capturedAt?: string; readonly location: MediaLocation; }

export interface MediaEditOperation {
  readonly type: 'ROTATE' | 'CROP' | 'FLIP_HORIZONTAL' | 'FLIP_VERTICAL' | 'EXPOSURE';
  readonly degrees?: 90 | 180 | 270;
  readonly left?: number;
  readonly top?: number;
  readonly width?: number;
  readonly height?: number;
  readonly value?: number;
}
export interface MediaEditRecipe { readonly version: 1; readonly operations: readonly MediaEditOperation[]; }
export interface MediaEditedExport { readonly sourceMediaId: MediaId; readonly recipe: MediaEditRecipe; readonly manifest: ContentManifest; readonly contentId: ContentId; }

export interface MediaLibraryDiagnostics {
  readonly assets: number;
  readonly activeAssets: number;
  readonly trashedAssets: number;
  readonly albums: number;
  readonly importJobs: number;
  readonly derivatives: number;
  readonly tombstones: number;
  readonly watchedFolders: number;
  readonly derivativeWorkers: number;
  readonly derivativeQueue: number;
}

export class MediaLibraryError extends Error {
  constructor(readonly code: 'INVALID_INPUT' | 'UNSUPPORTED_MEDIA' | 'RESOURCE_LIMIT' | 'NOT_FOUND' | 'POLICY_DENIED' | 'UNAVAILABLE' | 'CANCELED' | 'CONFLICT' | 'INTEGRITY', message: string) { super(message); this.name = 'MediaLibraryError'; }
}

interface PersistedMediaState {
  readonly version: 1;
  readonly assets: Record<string, MediaAsset>;
  readonly albums: Record<string, MediaAlbum>;
  readonly jobs: Record<string, MediaImportJob>;
  readonly derivatives: Record<string, MediaDerivativeRecord>;
  readonly placements: Record<string, MediaPlacementState>;
  readonly tombstones: Record<string, MediaTombstone>;
  readonly watchedFolders: Record<string, { readonly selectionId: string; readonly enabled: boolean; readonly createdAt: string }>;
}

const IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp', 'image/avif']);
const VIDEO_MIME = new Set(['video/mp4', 'video/webm', 'video/quicktime', 'video/x-matroska', 'video/ogg', 'video/mpeg']);
const TERMINAL_IMPORT_STATES = new Set<MediaImportState>(['IMPORTED', 'DUPLICATE', 'SKIPPED', 'FAILED', 'CANCELED']);

export class MediaLibraryService {
  readonly content: MediaContentStore;
  private readonly stateStore: MediaLibraryStateStore;
  private readonly decoder?: MediaDecoder;
  private readonly probe?: MediaProbeAdapter;
  private readonly derivativeAdapter?: MediaDerivativeAdapter;
  private readonly vault?: MediaVaultVisibilityAdapter;
  private readonly shareAdapter?: MediaShareAdapter;
  private readonly placementAdapter?: MediaPlacementAdapter;
  private readonly ownerIdentityId?: string;
  private readonly now: () => number;
  private readonly maxAssets: number;
  private readonly maxImportItems: number;
  private readonly maxAssetBytes: number;
  private readonly maxMetadataBytes: number;
  private readonly maxDerivativeBytes: number;
  private readonly maxDerivativeQueue: number;
  private readonly maxDerivativeWorkers: number;
  private readonly assets = new Map<MediaId, MediaAsset>();
  private readonly albums = new Map<string, MediaAlbum>();
  private readonly jobs = new Map<string, MediaImportJob>();
  private readonly derivatives = new Map<string, MediaDerivativeRecord>();
  private readonly placements = new Map<string, MediaPlacementState>();
  private readonly tombstones = new Map<MediaId, MediaTombstone>();
  private readonly watchedFolders = new Map<string, { selectionId: string; enabled: boolean; createdAt: string }>();
  private readonly tokenIndex = new Map<string, Set<MediaId>>();
  private readonly derivativeWaiters: Array<() => void> = [];
  private activeDerivativeWorkers = 0;
  private writes: Promise<void> = Promise.resolve();
  private readonly readyPromise: Promise<void>;

  constructor(options: MediaLibraryOptions = {}) {
    this.content = options.content ?? new ContentCacheMediaStore();
    this.stateStore = options.state ?? new InMemoryMediaLibraryStateStore();
    this.decoder = options.decoder;
    this.probe = this.decoder ?? options.probe;
    this.derivativeAdapter = this.decoder ?? options.derivatives;
    this.vault = options.vault;
    this.shareAdapter = options.share;
    this.placementAdapter = options.placement;
    this.ownerIdentityId = options.ownerIdentityId;
    this.now = options.now ?? Date.now;
    this.maxAssets = bounded(options.limits?.maxAssets ?? 100_000, 1, 1_000_000);
    this.maxImportItems = bounded(options.limits?.maxImportItems ?? MEDIA_MAX_IMPORT_ITEMS, 1, MEDIA_MAX_IMPORT_ITEMS);
    this.maxAssetBytes = bounded(options.limits?.maxAssetBytes ?? MEDIA_MAX_ASSET_BYTES, 1, MEDIA_MAX_ASSET_BYTES);
    this.maxMetadataBytes = bounded(options.limits?.maxMetadataBytes ?? MEDIA_MAX_METADATA_BYTES, 16 * 1024, MEDIA_MAX_METADATA_BYTES);
    this.maxDerivativeBytes = bounded(options.limits?.maxDerivativeBytes ?? MEDIA_MAX_DERIVATIVE_BYTES, 1, MEDIA_MAX_DERIVATIVE_BYTES);
    this.maxDerivativeQueue = bounded(options.limits?.maxDerivativeQueue ?? 128, 0, 2_048);
    this.maxDerivativeWorkers = bounded(options.limits?.maxDerivativeWorkers ?? 2, 1, 8);
    this.readyPromise = this.hydrate();
  }

  async ready(): Promise<void> { await this.readyPromise; }

  diagnostics(): MediaLibraryDiagnostics {
    let trashedAssets = 0;
    for (const asset of this.assets.values()) if (asset.state === 'TRASHED') trashedAssets++;
    return { assets: this.assets.size, activeAssets: this.assets.size - trashedAssets, trashedAssets, albums: this.albums.size, importJobs: this.jobs.size, derivatives: this.derivatives.size, tombstones: this.tombstones.size, watchedFolders: this.watchedFolders.size, derivativeWorkers: this.activeDerivativeWorkers, derivativeQueue: this.derivativeWaiters.length };
  }

  async importBytes(input: MediaImportInput): Promise<MediaImportResult> {
    await this.ready();
    const filename = safeFilename(input.filename);
    if (input.signal?.aborted) return this.canceledJob(filename, input.source ?? 'LOCAL_FILE', input.selectionId);
    if (!input.bytes || !(input.bytes instanceof Uint8Array) || input.bytes.byteLength === 0 || input.bytes.byteLength > this.maxAssetBytes) throw new MediaLibraryError('RESOURCE_LIMIT', 'Media bytes exceed the bounded import limit');
    const jobId = id('media-import');
    let job = this.job(jobId, 'DISCOVERING', filename, input.source ?? 'LOCAL_FILE', input.selectionId);
    this.jobs.set(job.id, job); await this.persist();
    try {
      job = this.updateJob(job, 'IMPORTING'); this.jobs.set(job.id, job); await this.persist();
      if (input.signal?.aborted) return this.finishCanceled(job);
      const probe = await this.probeBytes(input.bytes, filename, input.declaredMimeType);
      job = this.updateJob(job, 'VERIFYING'); this.jobs.set(job.id, job); await this.persist();
      const manifest = await this.content.import(input.bytes, { mimeType: probe.mimeType, name: filename });
      if (manifest.byteLength !== input.bytes.byteLength || manifest.contentId !== `sha256-${await sha256(input.bytes)}`) throw new MediaLibraryError('INTEGRITY', 'Content manifest does not match the imported bytes');
      const mediaId = mediaIdFor(manifest.contentId);
      const existing = this.assets.get(mediaId);
      if (this.tombstones.has(mediaId)) throw new MediaLibraryError('CONFLICT', 'A permanently deleted media identity cannot be resurrected');
      if (existing) {
        job = { ...this.updateJob(job, 'DUPLICATE'), duplicateOf: existing.id, mediaId: existing.id };
        this.jobs.set(job.id, job); await this.persist();
        return { job, duplicateOf: clone(existing) };
      }
      if (this.assets.size >= this.maxAssets) throw new MediaLibraryError('RESOURCE_LIMIT', 'Media library asset limit reached');
      const capture: MediaMetadata = { captureTimeSource: probe.metadata?.captureTime ? 'EMBEDDED_METADATA' : input.modifiedAt ? 'FILE_MODIFIED_TIME' : 'UNKNOWN', metadataTruncated: probe.metadata?.metadataTruncated ?? false, ...probe.metadata, ...(input.modifiedAt && !probe.metadata?.captureTime ? { captureTime: input.modifiedAt } : {}) };
      const asset: MediaAsset = { version: 1, id: mediaId, contentId: manifest.contentId, filename, mimeType: probe.mimeType, kind: probe.kind, byteLength: manifest.byteLength, importedAt: new Date(this.now()).toISOString(), state: 'ACTIVE', capture, tags: [], favorite: false, source: { kind: input.source ?? 'LOCAL_FILE', ...(input.selectionId ? { selectionId: input.selectionId } : {}) } };
      this.assets.set(asset.id, asset); this.indexAsset(asset);
      job = { ...this.updateJob(job, 'IMPORTED'), mediaId: asset.id };
      this.jobs.set(job.id, job); await this.persist();
      return { job, asset: clone(asset) };
    } catch (error) {
      const canceled = input.signal?.aborted || (error instanceof MediaLibraryError && error.code === 'CANCELED');
      job = this.updateJob(job, canceled ? 'CANCELED' : 'FAILED', error instanceof Error ? error.message : String(error));
      this.jobs.set(job.id, job); await this.persist();
      if (canceled) return { job };
      throw error;
    }
  }

  async importSource(source: MediaImportSource, options: { readonly signal?: AbortSignal; readonly maxItems?: number } = {}): Promise<MediaBatchImportResult> {
    await this.ready();
    if (!source?.selectionId || !source.list || !['SELECTED_FOLDER', 'CAMERA_ROLL', 'WATCHED_FOLDER'].includes(source.kind)) throw new MediaLibraryError('INVALID_INPUT', 'Media source is not an explicit scoped selection');
    const candidates = await source.list();
    const limit = bounded(options.maxItems ?? this.maxImportItems, 1, this.maxImportItems);
    if (candidates.length > limit) throw new MediaLibraryError('RESOURCE_LIMIT', 'Selected media source exceeds the bounded item limit');
    const jobs: MediaImportJob[] = [];
    let imported = 0; let duplicates = 0; let failed = 0; let canceled = 0;
    for (const candidate of candidates) {
      if (options.signal?.aborted) { const result = this.canceledJob(candidate.name, source.kind, source.selectionId); jobs.push(result.job); canceled++; continue; }
      try {
        const bytes = await candidate.read(options.signal); const result = await this.importBytes({ bytes, filename: candidate.name, declaredMimeType: candidate.declaredMimeType, modifiedAt: candidate.modifiedAt, source: source.kind, selectionId: source.selectionId, signal: options.signal });
        jobs.push(result.job); if (result.job.state === 'IMPORTED') imported++; else if (result.job.state === 'DUPLICATE') duplicates++; else if (result.job.state === 'CANCELED') canceled++; else failed++;
      } catch (error) {
        const job = this.job(id('media-import'), 'FAILED', jobFilename(candidate.name), source.kind, source.selectionId, error instanceof Error ? error.message : String(error)); this.jobs.set(job.id, job); jobs.push(job); failed++; await this.persist();
      }
    }
    return { jobs: jobs.map(clone), imported, duplicates, failed, canceled };
  }

  async registerWatchedFolder(selectionId: string): Promise<void> { await this.ready(); if (!selectionId || selectionId.length > 256) throw new MediaLibraryError('INVALID_INPUT', 'Watched folder selection is invalid'); this.watchedFolders.set(selectionId, { selectionId, enabled: true, createdAt: new Date(this.now()).toISOString() }); await this.persist(); }
  async stopWatchedFolder(selectionId: string): Promise<void> { await this.ready(); const value = this.watchedFolders.get(selectionId); if (value) { this.watchedFolders.set(selectionId, { ...value, enabled: false }); await this.persist(); } }
  watchedFoldersList(): readonly { readonly selectionId: string; readonly enabled: boolean; readonly createdAt: string }[] { return [...this.watchedFolders.values()].map(clone); }
  async recoverInterruptedImports(): Promise<readonly MediaImportJob[]> { await this.ready(); const recovered: MediaImportJob[] = []; for (const job of this.jobs.values()) if (!TERMINAL_IMPORT_STATES.has(job.state)) { const value = this.updateJob(job, 'FAILED', 'Recovered after an interrupted import; no partial asset was exposed'); this.jobs.set(job.id, value); recovered.push(value); } if (recovered.length) await this.persist(); return recovered.map(clone); }

  async getAsset(mediaId: MediaId, options: { readonly includeTrash?: boolean } = {}): Promise<MediaAsset | undefined> { await this.ready(); const value = this.assets.get(mediaId); if (!value || (!options.includeTrash && value.state === 'TRASHED') || !(await this.visible(value))) return undefined; return clone(value); }
  async listAssets(options: { readonly includeTrash?: boolean; readonly limit?: number } = {}): Promise<readonly MediaAsset[]> { await this.ready(); const values: MediaAsset[] = []; const limit = bounded(options.limit ?? this.maxAssets, 1, this.maxAssets); for (const value of this.assets.values()) { if (values.length >= limit) break; if (!options.includeTrash && value.state === 'TRASHED') continue; if (await this.visible(value)) values.push(clone(value)); } return values.sort(compareAssets); }
  async listTimeline(query: MediaTimelineQuery = {}): Promise<MediaTimelinePage> {
    await this.ready(); const limit = bounded(query.limit ?? 100, 1, 200); const all = (await this.listAssets({ includeTrash: query.includeTrash })).filter(asset => (!query.includeFavoritesOnly || asset.favorite) && (!query.kind || asset.kind === query.kind) && inCaptureMonth(asset, query.year, query.month)); const start = parseCursor(query.cursor); const items = all.slice(start, start + limit); const nextCursor = start + items.length < all.length ? String(start + items.length) : undefined; return { items, nextCursor, total: all.length, groups: timelineGroups(all) };
  }

  async createAlbum(name: string, sharing: MediaAlbum['sharing'] = 'PRIVATE'): Promise<MediaAlbum> { await this.ready(); const clean = boundedText(name, 120); if (!clean) throw new MediaLibraryError('INVALID_INPUT', 'Album name is required'); const now = new Date(this.now()).toISOString(); const album: MediaAlbum = { version: 1, id: id('album'), name: clean, assetIds: [], createdAt: now, updatedAt: now, sharing }; this.albums.set(album.id, album); await this.persist(); return clone(album); }
  async listAlbums(): Promise<readonly MediaAlbum[]> { await this.ready(); return [...this.albums.values()].map(clone).sort((left, right) => left.name.localeCompare(right.name)); }
  async addToAlbum(albumId: string, mediaIds: readonly MediaId[]): Promise<MediaAlbum> { await this.ready(); const album = this.albums.get(albumId); if (!album) throw new MediaLibraryError('NOT_FOUND', 'Album not found'); const ids = [...new Set(mediaIds)]; for (const mediaId of ids) if (!this.assets.has(mediaId) || this.tombstones.has(mediaId)) throw new MediaLibraryError('NOT_FOUND', 'Album media reference is unavailable'); const next: MediaAlbum = { ...album, assetIds: [...new Set([...album.assetIds, ...ids])].slice(0, 10_000), updatedAt: new Date(this.now()).toISOString() }; this.albums.set(albumId, next); await this.persist(); return clone(next); }
  async removeFromAlbum(albumId: string, mediaIds: readonly MediaId[]): Promise<MediaAlbum> { await this.ready(); const album = this.albums.get(albumId); if (!album) throw new MediaLibraryError('NOT_FOUND', 'Album not found'); const remove = new Set(mediaIds); const next: MediaAlbum = { ...album, assetIds: album.assetIds.filter(value => !remove.has(value)), updatedAt: new Date(this.now()).toISOString() }; this.albums.set(albumId, next); await this.persist(); return clone(next); }
  async albumAssets(albumId: string): Promise<readonly MediaAsset[]> { await this.ready(); const album = this.albums.get(albumId); if (!album) throw new MediaLibraryError('NOT_FOUND', 'Album not found'); const values: MediaAsset[] = []; for (const mediaId of album.assetIds) { const value = this.assets.get(mediaId); if (value && value.state === 'ACTIVE' && await this.visible(value)) values.push(clone(value)); } return values.sort(compareAssets); }

  async updateAsset(mediaId: MediaId, patch: { readonly title?: string; readonly caption?: string; readonly tags?: readonly string[]; readonly favorite?: boolean }): Promise<MediaAsset> { await this.ready(); const asset = this.requireAsset(mediaId); const next: MediaAsset = { ...asset, ...(patch.title !== undefined ? { title: boundedText(patch.title, 200) || undefined } : {}), ...(patch.caption !== undefined ? { caption: boundedText(patch.caption, 4_000) || undefined } : {}), ...(patch.tags !== undefined ? { tags: normalizeTags(patch.tags) } : {}), ...(patch.favorite !== undefined ? { favorite: patch.favorite } : {}) }; this.assets.set(mediaId, next); this.reindexAsset(asset, next); await this.persist(); return clone(next); }

  async search(query: MediaSearchQuery): Promise<readonly MediaSearchResult[]> {
    await this.ready(); const terms = tokenize(query.query); if (!terms.length) return []; const candidateIds = terms.map(term => this.tokenIndex.get(term) ?? new Set<MediaId>()); const ids = candidateIds.reduce((current, next) => current.size <= next.size ? new Set([...current].filter(value => next.has(value))) : new Set([...next].filter(value => current.has(value)))); const results: MediaSearchResult[] = []; for (const mediaId of ids) { const asset = this.assets.get(mediaId); if (!asset || (!query.includeTrash && asset.state === 'TRASHED') || (query.kind && asset.kind !== query.kind) || !(await this.visible(asset))) continue; const fields = matchedFields(asset, terms); results.push({ asset: clone(asset), score: fields.length * 10 + (asset.favorite ? 1 : 0), matchedFields: fields }); } return results.sort((left, right) => right.score - left.score || compareAssets(left.asset, right.asset)).slice(0, bounded(query.limit ?? 50, 1, 200));
  }

  async mapProjection(query: MediaMapQuery): Promise<readonly MediaMapPoint[]> { await this.ready(); if (query.ownerConfirmed !== true) throw new MediaLibraryError('POLICY_DENIED', 'Embedded media coordinates require an explicit owner action'); const points: MediaMapPoint[] = []; for (const asset of this.assets.values()) { if (!query.includeTrashed && asset.state === 'TRASHED') continue; if (!(await this.visible(asset)) || !asset.capture.gps) continue; points.push({ mediaId: asset.id, contentId: asset.contentId, ...(asset.capture.captureTime ? { capturedAt: asset.capture.captureTime } : {}), location: clone(asset.capture.gps) }); } return points.sort((left, right) => (right.capturedAt ?? '').localeCompare(left.capturedAt ?? '') || left.mediaId.localeCompare(right.mediaId)); }

  async trash(mediaId: MediaId): Promise<MediaAsset> { await this.ready(); const asset = this.requireAsset(mediaId); if (asset.state === 'TRASHED') return clone(asset); const next = { ...asset, state: 'TRASHED' as const }; this.assets.set(mediaId, next); this.reindexAsset(asset, next); await this.persist(); return clone(next); }
  async restore(mediaId: MediaId): Promise<MediaAsset> { await this.ready(); const asset = this.requireAsset(mediaId); if (this.tombstones.has(mediaId)) throw new MediaLibraryError('CONFLICT', 'A permanently deleted media item cannot be restored'); const next = { ...asset, state: 'ACTIVE' as const }; this.assets.set(mediaId, next); this.reindexAsset(asset, next); await this.persist(); return clone(next); }
  async permanentlyDelete(mediaId: MediaId, ownerConfirmed: boolean): Promise<void> { await this.ready(); if (!ownerConfirmed) throw new MediaLibraryError('POLICY_DENIED', 'Permanent media deletion requires owner confirmation'); const asset = this.assets.get(mediaId); if (!asset) throw new MediaLibraryError('NOT_FOUND', 'Media asset not found'); this.assets.delete(mediaId); this.removeFromIndex(asset); this.tombstones.set(mediaId, { mediaId, contentId: asset.contentId, deletedAt: new Date(this.now()).toISOString(), reason: 'PERMANENT_DELETE' }); for (const [albumId, album] of this.albums) if (album.assetIds.includes(mediaId)) this.albums.set(albumId, { ...album, assetIds: album.assetIds.filter(value => value !== mediaId), updatedAt: new Date(this.now()).toISOString() }); await this.content.removeLocalCopy?.(asset.contentId); await this.persist(); }
  tombstone(mediaId: MediaId): MediaTombstone | undefined { const value = this.tombstones.get(mediaId); return value && clone(value); }

  async requestDerivative(mediaId: MediaId, kind: MediaDerivativeKind, recipe: Readonly<Record<string, string | number | boolean>> = {}): Promise<MediaDerivativeRecord> {
    await this.ready(); const asset = this.requireAsset(mediaId); if (asset.state !== 'ACTIVE' || !(await this.visible(asset))) throw new MediaLibraryError('POLICY_DENIED', 'Derivative access is not allowed for this media item'); const recipeHash = await sha256(new TextEncoder().encode(JSON.stringify({ version: MEDIA_DERIVATIVE_VERSION, kind, recipe }))); const derivativeId = `${asset.contentId}:${kind}:${recipeHash}`; const old = this.derivatives.get(derivativeId); if (old?.state === 'READY' && old.contentId && await this.content.read?.(old.contentId)) return clone(old); if (!this.derivativeAdapter) { const unavailable: MediaDerivativeRecord = { version: 1, id: derivativeId, sourceMediaId: mediaId, sourceContentId: asset.contentId, kind, recipeVersion: MEDIA_DERIVATIVE_VERSION, recipeHash, state: 'UNAVAILABLE', updatedAt: new Date(this.now()).toISOString(), error: 'No host decoder/derivative adapter is available' }; this.derivatives.set(derivativeId, unavailable); await this.persist(); return clone(unavailable); }
    return this.withDerivativeSlot(async () => { const refreshed = this.derivatives.get(derivativeId); if (refreshed?.state === 'READY' && refreshed.contentId && await this.content.read?.(refreshed.contentId)) return clone(refreshed); const sourceBytes = await this.content.read?.(asset.contentId); if (!sourceBytes) { const unavailable: MediaDerivativeRecord = { version: 1, id: derivativeId, sourceMediaId: mediaId, sourceContentId: asset.contentId, kind, recipeVersion: MEDIA_DERIVATIVE_VERSION, recipeHash, state: 'UNAVAILABLE', updatedAt: new Date(this.now()).toISOString(), error: 'Original is not locally available' }; this.derivatives.set(derivativeId, unavailable); await this.persist(); return clone(unavailable); } const request = { source: asset, sourceBytes, kind, recipe }; try { const generated = await this.derivativeAdapter!.generate(request); if (!generated.bytes.byteLength || generated.bytes.byteLength > this.maxDerivativeBytes) throw new MediaLibraryError('RESOURCE_LIMIT', 'Generated derivative exceeds the bounded derivative limit'); await this.decoder?.validateGenerated?.(request, generated); const manifest = await this.content.import(generated.bytes, { mimeType: generated.mimeType, name: `${asset.filename}.${kind.toLowerCase()}` }); const record: MediaDerivativeRecord = { version: 1, id: derivativeId, sourceMediaId: mediaId, sourceContentId: asset.contentId, kind, recipeVersion: MEDIA_DERIVATIVE_VERSION, recipeHash, contentId: manifest.contentId, mimeType: manifest.mimeType, byteLength: manifest.byteLength, state: 'READY', updatedAt: new Date(this.now()).toISOString() }; this.derivatives.set(derivativeId, record); await this.persist(); return clone(record); } catch (error) { if (!(error instanceof MediaLibraryError) || (error.code !== 'UNAVAILABLE' && error.code !== 'UNSUPPORTED_MEDIA')) throw error; const unavailable: MediaDerivativeRecord = { version: 1, id: derivativeId, sourceMediaId: mediaId, sourceContentId: asset.contentId, kind, recipeVersion: MEDIA_DERIVATIVE_VERSION, recipeHash, state: 'UNAVAILABLE', updatedAt: new Date(this.now()).toISOString(), error: error.message }; this.derivatives.set(derivativeId, unavailable); await this.persist(); return clone(unavailable); } });
  }

  async exportEdited(mediaId: MediaId, recipe: MediaEditRecipe): Promise<MediaEditedExport> { await this.ready(); const asset = this.requireAsset(mediaId); validateRecipe(recipe, asset); if (!this.derivativeAdapter) throw new MediaLibraryError('UNAVAILABLE', 'No image edit adapter is available'); const sourceBytes = await this.content.read?.(asset.contentId); if (!sourceBytes) throw new MediaLibraryError('UNAVAILABLE', 'Original is not locally available'); const request = { source: asset, sourceBytes, kind: 'EDIT_RENDITION' as const, recipe: recipeToRecord(recipe) }; const generated = await this.derivativeAdapter.generate(request); if (!generated.bytes.byteLength || generated.bytes.byteLength > this.maxDerivativeBytes) throw new MediaLibraryError('RESOURCE_LIMIT', 'Edited export exceeds the bounded derivative limit'); await this.decoder?.validateGenerated?.(request, generated); const manifest = await this.content.import(generated.bytes, { mimeType: generated.mimeType, name: `${asset.filename}.edited` }); return { sourceMediaId: mediaId, recipe: clone(recipe), manifest: clone(manifest), contentId: manifest.contentId };
  }

  async share(request: MediaShareRequest): Promise<MediaShareReceipt> {
    await this.ready(); const asset = this.requireAsset(request.mediaId); if (!this.shareAdapter) throw new MediaLibraryError('UNAVAILABLE', 'No explicit media sharing adapter is connected'); if (request.ownerConfirmed !== true) throw new MediaLibraryError('POLICY_DENIED', 'Media sharing requires explicit owner confirmation'); if (request.mode === 'PUBLISH_RENDITION' && request.destination !== 'PERSONAL_WEB') throw new MediaLibraryError('POLICY_DENIED', 'Publication is only available through the explicit Personal Web destination'); if (request.destination === 'PERSONAL_WEB' && request.mode !== 'PUBLISH_RENDITION') throw new MediaLibraryError('POLICY_DENIED', 'Private originals cannot be published'); if (asset.capture.gps && request.destination !== 'OWN_DEVICE' && request.locationConfirmed !== true) throw new MediaLibraryError('POLICY_DENIED', 'Sharing media with embedded location requires an explicit location decision'); let contentId = asset.contentId; let metadataPolicy: MediaSharePayload['metadataPolicy'] = 'PRESERVE'; if (request.stripLocation) { if (!this.derivativeAdapter?.stripLocation) throw new MediaLibraryError('UNAVAILABLE', 'Metadata stripping is not available on this host'); const sourceBytes = await this.content.read?.(asset.contentId); if (!sourceBytes) throw new MediaLibraryError('UNAVAILABLE', 'Original is not locally available'); const strippedRequest = { source: asset, sourceBytes, kind: request.derivative ?? 'PREVIEW', recipe: { stripLocation: true } }; const stripped = await this.derivativeAdapter.stripLocation(strippedRequest); if (stripped.bytes.byteLength > this.maxDerivativeBytes) throw new MediaLibraryError('RESOURCE_LIMIT', 'Metadata-stripped rendition exceeds the bounded derivative limit'); await this.decoder?.validateGenerated?.(strippedRequest, stripped); contentId = (await this.content.import(stripped.bytes, { mimeType: stripped.mimeType, name: `${asset.filename}.stripped` })).contentId; metadataPolicy = 'STRIP_LOCATION'; }
    if (request.destination === 'PERSONAL_WEB' || request.mode === 'PUBLISH_RENDITION') {
      if (contentId === asset.contentId) {
        const derivative = await this.requestDerivative(asset.id, request.derivative ?? 'PREVIEW', { publication: true });
        if (derivative.state !== 'READY' || !derivative.contentId || derivative.contentId === asset.contentId) throw new MediaLibraryError('UNAVAILABLE', 'A private original cannot be used as a public cacheable rendition');
        contentId = derivative.contentId;
      }
      if (contentId === asset.contentId) throw new MediaLibraryError('UNAVAILABLE', 'A private original cannot be used as a public cacheable rendition');
    }
    return this.shareAdapter.share({ mediaId: asset.id, sourceContentId: asset.contentId, contentId, destination: request.destination, mode: request.mode, publicCacheable: request.destination === 'PERSONAL_WEB' || request.mode === 'PUBLISH_RENDITION', metadataPolicy, ...(request.targetId ? { targetId: request.targetId } : {}) });
  }

  async placeOnDevice(request: MediaPlacementRequest): Promise<MediaPlacementState> { await this.ready(); const asset = this.requireAsset(request.mediaId); if (!this.placementAdapter) throw new MediaLibraryError('UNAVAILABLE', 'No owned-device placement adapter is connected'); if (!request.targetDeviceId || request.ownerConfirmed !== true) throw new MediaLibraryError('POLICY_DENIED', 'Device placement requires a selected trusted device and owner confirmation'); if (request.mode === 'ORIGINAL' && request.allowMetered !== true) { /* Explicitly avoid an automatic large transfer on a metered route. The adapter may still report a pending state. */ } const state = await this.placementAdapter.place({ ...request, contentId: asset.contentId }); this.placements.set(`${asset.id}:${request.targetDeviceId}`, clone(state)); await this.persist(); return clone(state); }
  placement(mediaId: MediaId, deviceId: string): MediaPlacementState | undefined { const value = this.placements.get(`${mediaId}:${deviceId}`); return value && clone(value); }

  async createMapSafeShare(mediaId: MediaId, ownerConfirmed: boolean, stripLocation = true): Promise<MediaDerivativeRecord> { await this.ready(); if (!ownerConfirmed) throw new MediaLibraryError('POLICY_DENIED', 'Location-safe media export requires owner confirmation'); const asset = this.requireAsset(mediaId); if (!stripLocation) throw new MediaLibraryError('POLICY_DENIED', 'This helper only creates a metadata-stripped rendition'); return this.requestDerivative(asset.id, 'PREVIEW', { mapSafe: true, stripLocation: true }); }

  /** Metadata-first remote ingest. It never creates a content blob and refuses tombstoned identities. */
  async ingestRemoteMetadata(asset: MediaAsset, ownerIdentityId?: string): Promise<'IMPORTED' | 'IGNORED_TOMBSTONE' | 'DUPLICATE'> { await this.ready(); if (this.ownerIdentityId && ownerIdentityId !== this.ownerIdentityId) throw new MediaLibraryError('POLICY_DENIED', 'Remote media metadata belongs to another owner'); const parsed = validateAsset(asset); if (this.tombstones.has(parsed.id)) return 'IGNORED_TOMBSTONE'; const existing = this.assets.get(parsed.id); if (existing) return 'DUPLICATE'; if (this.assets.size >= this.maxAssets) throw new MediaLibraryError('RESOURCE_LIMIT', 'Media library asset limit reached'); this.assets.set(parsed.id, parsed); this.indexAsset(parsed); await this.persist(); return 'IMPORTED'; }

  private async probeBytes(bytes: Uint8Array, filename: string, declaredMimeType?: string): Promise<MediaProbeResult> { const safe = bytes.subarray(0, this.maxMetadataBytes); const probeBytes = this.decoder ? bytes : safe; const detected = detectMediaType(bytes, filename); if (!detected) { if (!this.probe) throw new MediaLibraryError('UNSUPPORTED_MEDIA', 'Media type is not recognized by the safe built-in probe'); const result = await this.probe.probe(probeBytes, { filename, ...(declaredMimeType ? { declaredMimeType } : {}), maxBytes: this.decoder ? this.maxAssetBytes : this.maxMetadataBytes }); return validateProbe(result); } if (declaredMimeType && isMediaMime(declaredMimeType) && declaredMimeType.toLowerCase() !== detected.mimeType) throw new MediaLibraryError('UNSUPPORTED_MEDIA', 'Declared media type does not match the file signature'); const builtin = probeMediaMetadata(safe, detected.mimeType); const decoderCapability = detected.kind === 'IMAGE' ? 'IMAGE_METADATA' : 'VIDEO_METADATA'; if (this.decoder && !this.decoder.capabilities().includes(decoderCapability)) return { kind: detected.kind, mimeType: detected.mimeType, metadata: builtin }; if (this.probe) { const custom = validateProbe(await this.probe.probe(probeBytes, { filename, declaredMimeType: detected.mimeType, maxBytes: this.decoder ? this.maxAssetBytes : this.maxMetadataBytes })); if (custom.kind !== detected.kind || custom.mimeType !== detected.mimeType) throw new MediaLibraryError('UNSUPPORTED_MEDIA', 'Host probe disagrees with the safe file signature'); return { kind: detected.kind, mimeType: detected.mimeType, metadata: { ...builtin, ...custom.metadata } }; } return { kind: detected.kind, mimeType: detected.mimeType, metadata: builtin };
  }

  private async visible(asset: MediaAsset): Promise<boolean> { if (!this.vault) return true; const state = await this.vault.visibility(asset.id); return state === 'VISIBLE'; }
  private requireAsset(mediaId: MediaId): MediaAsset { const asset = this.assets.get(mediaId); if (!asset) throw new MediaLibraryError('NOT_FOUND', 'Media asset not found'); return asset; }
  private async withDerivativeSlot<T>(task: () => Promise<T>): Promise<T> { if (this.activeDerivativeWorkers >= this.maxDerivativeWorkers && this.derivativeWaiters.length >= this.maxDerivativeQueue) throw new MediaLibraryError('RESOURCE_LIMIT', 'Derivative queue is full'); if (this.activeDerivativeWorkers >= this.maxDerivativeWorkers) await new Promise<void>(resolve => this.derivativeWaiters.push(resolve)); this.activeDerivativeWorkers++; try { return await task(); } finally { this.activeDerivativeWorkers--; this.derivativeWaiters.shift()?.(); } }
  private async hydrate(): Promise<void> { const value = await this.stateStore.read(); if (!value || typeof value !== 'object' || (value as { version?: unknown }).version !== 1) return; const state = value as Partial<PersistedMediaState>; for (const [key, candidate] of Object.entries(state.tombstones ?? {}).slice(0, this.maxAssets)) { const parsed = safeValidateTombstone(candidate); if (parsed && key === parsed.mediaId) this.tombstones.set(parsed.mediaId, parsed); } for (const [key, candidate] of Object.entries(state.assets ?? {}).slice(0, this.maxAssets)) { const parsed = safeValidateAsset(candidate); if (parsed && parsed.id === key && !this.tombstones.has(parsed.id)) { this.assets.set(parsed.id, parsed); this.indexAsset(parsed); } } for (const [key, candidate] of Object.entries(state.albums ?? {}).slice(0, 1_000)) { const parsed = safeValidateAlbum(candidate); if (parsed && parsed.id === key) this.albums.set(key, parsed); } for (const [key, candidate] of Object.entries(state.jobs ?? {}).slice(0, 10_000)) { const parsed = safeValidateJob(candidate); if (parsed && parsed.id === key) this.jobs.set(key, parsed); } for (const [key, candidate] of Object.entries(state.derivatives ?? {}).slice(0, 10_000)) { const parsed = safeValidateDerivative(candidate); if (parsed && parsed.id === key) this.derivatives.set(key, parsed); } for (const [key, candidate] of Object.entries(state.placements ?? {}).slice(0, 10_000)) { const parsed = safeValidatePlacement(candidate); if (parsed && key === `${parsed.mediaId}:${parsed.deviceId}`) this.placements.set(key, parsed); } for (const [key, candidate] of Object.entries(state.watchedFolders ?? {}).slice(0, 1_000)) if (candidate?.selectionId === key && typeof candidate.enabled === 'boolean' && typeof candidate.createdAt === 'string') this.watchedFolders.set(key, { selectionId: key, enabled: candidate.enabled, createdAt: candidate.createdAt }); let recovered = false; for (const [key, job] of this.jobs) if (!TERMINAL_IMPORT_STATES.has(job.state)) { this.jobs.set(key, this.updateJob(job, 'FAILED', 'Recovered after an interrupted import; no partial asset was exposed')); recovered = true; } if (recovered) await this.persist(); }
  private async persist(): Promise<void> { const state: PersistedMediaState = { version: 1, assets: Object.fromEntries(this.assets), albums: Object.fromEntries(this.albums), jobs: Object.fromEntries(this.jobs), derivatives: Object.fromEntries(this.derivatives), placements: Object.fromEntries(this.placements), tombstones: Object.fromEntries(this.tombstones), watchedFolders: Object.fromEntries(this.watchedFolders) }; const operation = this.writes.then(() => this.stateStore.write(structuredClone(state))); this.writes = operation.catch(() => undefined); await operation; }
  private indexAsset(asset: MediaAsset): void { if (asset.state === 'TRASHED') return; for (const token of assetTokens(asset)) { const ids = this.tokenIndex.get(token) ?? new Set<MediaId>(); ids.add(asset.id); this.tokenIndex.set(token, ids); } }
  private removeFromIndex(asset: MediaAsset): void { for (const token of assetTokens(asset)) { const ids = this.tokenIndex.get(token); ids?.delete(asset.id); if (ids && !ids.size) this.tokenIndex.delete(token); } }
  private reindexAsset(before: MediaAsset, after: MediaAsset): void { this.removeFromIndex(before); this.indexAsset(after); }
  private job(jobId: string, state: MediaImportState, filename: string, source: MediaSourceKind, selectionId?: string, error?: string): MediaImportJob { return { version: 1, id: jobId, state, filename, source, ...(selectionId ? { selectionId } : {}), ...(error ? { error: boundedText(error, 1_000) } : {}), startedAt: new Date(this.now()).toISOString(), updatedAt: new Date(this.now()).toISOString() }; }
  private updateJob(job: MediaImportJob, state: MediaImportState, error?: string): MediaImportJob { return { ...job, state, updatedAt: new Date(this.now()).toISOString(), ...(error ? { error: boundedText(error, 1_000) } : {}) }; }
  private finishCanceled(job: MediaImportJob): MediaImportResult { const value = this.updateJob(job, 'CANCELED', 'Import canceled by the owner'); this.jobs.set(job.id, value); void this.persist(); return { job: clone(value) }; }
  private canceledJob(filename: string, source: MediaSourceKind, selectionId?: string): MediaImportResult { const value = this.job(id('media-import'), 'CANCELED', jobFilename(filename), source, selectionId, 'Import canceled by the owner'); this.jobs.set(value.id, value); void this.persist(); return { job: clone(value) }; }
}

export interface NativeHostMediaDecoderOptions {
  readonly principal?: NativeHostPrincipal;
  readonly maxInputBytes?: number;
  readonly maxOutputBytes?: number;
  readonly maxDimension?: number;
  readonly maxPixels?: number;
}

/**
 * Core-side typed deputy for the NativeHost media boundary.  It contains no
 * process, filesystem or decoder imports; the host owns those details.
 */
export class NativeHostMediaDecoderAdapter implements MediaDecoder {
  readonly kind = 'PRODUCTION_MEDIA_DECODER' as const;
  private readonly principal: NativeHostPrincipal;
  private readonly maxInputBytes: number;
  private readonly maxOutputBytes: number;
  private readonly maxDimension: number;
  private readonly maxPixels: number;

  constructor(private readonly host: NativeHost, options: NativeHostMediaDecoderOptions = {}) {
    this.principal = options.principal ?? { kind: 'CORE_TRUSTED_SUBSYSTEM', id: 'keystone-media-decoder' };
    this.maxInputBytes = bounded(options.maxInputBytes ?? 256 * 1024 * 1024, 1, MEDIA_MAX_ASSET_BYTES);
    this.maxOutputBytes = bounded(options.maxOutputBytes ?? MEDIA_MAX_DERIVATIVE_BYTES, 1, MEDIA_MAX_DERIVATIVE_BYTES);
    this.maxDimension = bounded(options.maxDimension ?? 16_384, 1, MEDIA_MAX_DIMENSION);
    this.maxPixels = bounded(options.maxPixels ?? 100_000_000, 1, MEDIA_MAX_PIXELS);
  }

  capabilities(): readonly MediaDecoderCapability[] { return this.host.media().capabilities(); }

  async probe(bytes: Uint8Array, context: MediaProbeContext): Promise<MediaProbeResult> {
    const result = await this.requestHost('media-metadata', () => this.host.media().probe({
      bytes,
      filename: context.filename,
      ...(context.declaredMimeType ? { declaredMimeType: context.declaredMimeType } : {}),
      maxInputBytes: Math.min(this.maxInputBytes, context.maxBytes),
      maxDimension: this.maxDimension,
      maxPixels: this.maxPixels,
    }));
    return { kind: result.kind, mimeType: result.mimeType, ...(result.metadata ? { metadata: { ...result.metadata } } : {}) };
  }

  async generate(request: MediaDerivativeRequest): Promise<{ readonly bytes: Uint8Array; readonly mimeType: string }> {
    return this.requestHost('media-derivative', () => this.host.media().generate({
      bytes: request.sourceBytes,
      filename: request.source.filename,
      mimeType: request.source.mimeType,
      kind: request.kind,
      recipe: request.recipe,
      maxInputBytes: this.maxInputBytes,
      maxOutputBytes: this.maxOutputBytes,
      maxDimension: this.maxDimension,
      maxPixels: this.maxPixels,
      ...(request.signal ? { signal: request.signal } : {}),
    }));
  }

  async stripLocation(request: MediaDerivativeRequest): Promise<{ readonly bytes: Uint8Array; readonly mimeType: string }> {
    const generated = await this.generate({ ...request, recipe: { ...request.recipe, stripLocation: true } });
    await this.validateGenerated(request, generated);
    return generated;
  }

  async validateGenerated(request: MediaDerivativeRequest, generated: { readonly bytes: Uint8Array; readonly mimeType: string }): Promise<void> {
    if (!(generated.bytes instanceof Uint8Array) || typeof generated.mimeType !== 'string' || generated.bytes.byteLength < 8 || generated.bytes.byteLength > this.maxOutputBytes || generated.mimeType.toLowerCase() !== 'image/png') throw new MediaLibraryError('INTEGRITY', 'Production media derivative is not a bounded PNG');
    const signature = detectMediaType(generated.bytes, 'derivative.png');
    if (!signature || signature.kind !== 'IMAGE' || signature.mimeType !== 'image/png') throw new MediaLibraryError('INTEGRITY', 'Production media derivative signature is invalid');
    const reopened = await this.probe(generated.bytes, { filename: 'derivative.png', declaredMimeType: 'image/png', maxBytes: this.maxOutputBytes });
    if (reopened.kind !== 'IMAGE' || reopened.mimeType !== 'image/png' || !reopened.metadata?.width || !reopened.metadata.height) throw new MediaLibraryError('INTEGRITY', 'Production media derivative could not be reopened');
    const metadata = probeMediaMetadata(generated.bytes, 'image/png');
    if (!metadata.width || !metadata.height || metadata.width > this.maxDimension || metadata.height > this.maxDimension || metadata.width * metadata.height > this.maxPixels) throw new MediaLibraryError('RESOURCE_LIMIT', 'Production media derivative dimensions exceed the safe budget');
    const requested = requestedDerivativeDimension(request.recipe, request.kind);
    if (request.kind !== 'EDIT_RENDITION' && (metadata.width > requested || metadata.height > requested)) throw new MediaLibraryError('INTEGRITY', 'Production media derivative exceeds its requested dimensions');
  }

  private async requestHost<T>(resource: string, operation: () => Promise<T>): Promise<T> {
    const result = await this.host.request({ requestId: id('media-host'), principal: this.principal, capability: 'media.decode', scope: 'media-decoder', resource }, operation);
    if (result.accepted && result.value !== undefined) return result.value;
    throw mapNativeMediaError(result.error);
  }
}

export type ProductionMediaLibraryOptions = Omit<MediaLibraryOptions, 'decoder' | 'probe' | 'derivatives'> & {
  readonly nativeHost: NativeHost;
  readonly decoderOptions?: NativeHostMediaDecoderOptions;
};

export function createProductionMediaLibrary(options: ProductionMediaLibraryOptions): MediaLibraryService {
  const { nativeHost, decoderOptions, ...libraryOptions } = options;
  return new MediaLibraryService({ ...libraryOptions, decoder: new NativeHostMediaDecoderAdapter(nativeHost, decoderOptions) });
}

export class DeterministicMediaDerivativeAdapter implements MediaDerivativeAdapter {
  async generate(request: MediaDerivativeRequest): Promise<{ readonly bytes: Uint8Array; readonly mimeType: string }> { const header = new TextEncoder().encode(`KEYSTONE-MEDIA-DERIVATIVE\n${request.kind}\n${request.source.contentId}\n${JSON.stringify(request.recipe)}\n`); const sample = request.sourceBytes.subarray(0, Math.min(4_096, request.sourceBytes.byteLength)); const output = new Uint8Array(header.byteLength + sample.byteLength); output.set(header); output.set(sample, header.byteLength); return { bytes: output, mimeType: 'application/x-keystone-media-derivative' }; }
  async stripLocation(request: MediaDerivativeRequest): Promise<{ readonly bytes: Uint8Array; readonly mimeType: string }> { return this.generate({ ...request, recipe: { ...request.recipe, stripLocation: true } }); }
}

export function mediaIdFor(contentId: ContentId): MediaId { if (!/^sha256-[a-f0-9]{64}$/i.test(contentId)) throw new MediaLibraryError('INVALID_INPUT', 'Invalid content identity'); return `media:${contentId}`; }
export function detectMediaType(bytes: Uint8Array, _filename = ''): { readonly kind: MediaKind; readonly mimeType: string } | undefined { if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { kind: 'IMAGE', mimeType: 'image/jpeg' }; if (bytes.length >= 8 && bytes.slice(0, 8).every((value, index) => value === [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a][index])) return { kind: 'IMAGE', mimeType: 'image/png' }; if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return { kind: 'IMAGE', mimeType: 'image/webp' }; if (bytes.length >= 6 && (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a')) return { kind: 'IMAGE', mimeType: 'image/gif' }; if (bytes.length >= 12 && ascii(bytes, 4, 8) === 'ftyp') { const brand = ascii(bytes, 8, 12); if (brand === 'avif' || brand === 'avis') return { kind: 'IMAGE', mimeType: 'image/avif' }; return { kind: 'VIDEO', mimeType: brand === 'qt  ' ? 'video/quicktime' : 'video/mp4' }; } if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return { kind: 'VIDEO', mimeType: 'video/webm' }; if (bytes.length >= 4 && ascii(bytes, 0, 4) === 'OggS') return { kind: 'VIDEO', mimeType: 'video/ogg' }; return undefined; }

export function probeMediaMetadata(bytes: Uint8Array, mimeType: string): Partial<MediaMetadata> { let width: number | undefined; let height: number | undefined; if (mimeType === 'image/png') { if (bytes.length < 24) throw new MediaLibraryError('UNSUPPORTED_MEDIA', 'PNG header is truncated'); width = readU32(bytes, 16); height = readU32(bytes, 20); } else if (mimeType === 'image/gif') { if (bytes.length < 10) throw new MediaLibraryError('UNSUPPORTED_MEDIA', 'GIF header is truncated'); width = readU16(bytes, 6, true); height = readU16(bytes, 8, true); } else if (mimeType === 'image/jpeg') { const dimensions = jpegDimensions(bytes); if (!dimensions) throw new MediaLibraryError('UNSUPPORTED_MEDIA', 'JPEG frame header is unavailable'); width = dimensions.width; height = dimensions.height; } else if (mimeType === 'image/webp' && bytes.length >= 30 && bytes[12] === 0x56 && bytes[13] === 0x50 && bytes[14] === 0x38 && bytes[15] === 0x58) { width = 1 + (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16)); height = 1 + (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16)); } if (width !== undefined && height !== undefined && (width < 1 || height < 1 || width > MEDIA_MAX_DIMENSION || height > MEDIA_MAX_DIMENSION || width * height > MEDIA_MAX_PIXELS)) throw new MediaLibraryError('RESOURCE_LIMIT', 'Image dimensions exceed the safe decode budget'); const output: MutableMediaMetadata = { metadataTruncated: bytes.byteLength >= MEDIA_MAX_METADATA_BYTES }; if (width !== undefined && height !== undefined) { output.width = width; output.height = height; } const exif = mimeType === 'image/jpeg' ? parseJpegExif(bytes) : undefined; if (exif) Object.assign(output, exif); return output; }

function parseJpegExif(bytes: Uint8Array): Partial<MediaMetadata> | undefined { let offset = 2; while (offset + 4 <= bytes.length && bytes[offset] === 0xff) { const marker = bytes[offset + 1]!; if (marker === 0xda || marker === 0xd9) break; const length = (bytes[offset + 2]! << 8) | bytes[offset + 3]!; if (length < 2 || offset + 2 + length > bytes.length) break; if (marker === 0xe1 && ascii(bytes, offset + 4, offset + 10) === 'Exif\0\0') return parseExifTiff(bytes.subarray(offset + 10, offset + 2 + length)); offset += 2 + length; } return undefined; }
function parseExifTiff(bytes: Uint8Array): Partial<MediaMetadata> | undefined {
  try {
    if (bytes.length < 8) return undefined;
    const little = ascii(bytes, 0, 2) === 'II';
    if (!little && ascii(bytes, 0, 2) !== 'MM') return undefined;
    const read16 = (offset: number) => readU16(bytes, offset, little);
    const read32 = (offset: number) => readU32(bytes, offset, little);
    if (read16(2) !== 42) return undefined;
    const result: MutableMediaMetadata = { metadataTruncated: false };
    const visited = new Set<number>();
    let latitude: number | undefined;
    let longitude: number | undefined;
    let latitudeRef: string | undefined;
    let longitudeRef: string | undefined;

    const parseIfd = (offset: number, gps = false): void => {
      if (!Number.isSafeInteger(offset) || offset < 0 || offset + 2 > bytes.length || visited.has(offset) || visited.size > 8) return;
      visited.add(offset);
      const count = Math.min(read16(offset), 64);
      for (let index = 0; index < count; index++) {
        const entry = offset + 2 + index * 12;
        if (entry + 12 > bytes.length) return;
        const tag = read16(entry);
        const type = read16(entry + 2);
        const countValue = read32(entry + 4);
        const unit = type === 1 || type === 2 || type === 7 ? 1 : type === 3 ? 2 : type === 4 || type === 9 ? 4 : type === 5 || type === 10 ? 8 : 0;
        if (!unit || countValue > 4_096 || countValue * unit > bytes.length) continue;
        const valueOffset = countValue * unit <= 4 ? entry + 8 : read32(entry + 8);
        if (valueOffset < 0 || valueOffset + countValue * unit > bytes.length) continue;
        if (tag === 0x0112 && type === 3) result.orientation = read16(valueOffset);
        else if ((tag === 0x9003 || tag === 0x0132) && type === 2) {
          const parsed = exifDate(ascii(bytes, valueOffset, valueOffset + Math.min(countValue, 32)).replace(/\0+$/, ''));
          if (parsed) result.captureTime = parsed;
        } else if (tag === 0x010f && type === 2) result.cameraMake = boundedText(ascii(bytes, valueOffset, valueOffset + Math.min(countValue, 64)).replace(/\0+$/, ''), 128);
        else if (tag === 0x0110 && type === 2) result.cameraModel = boundedText(ascii(bytes, valueOffset, valueOffset + Math.min(countValue, 64)).replace(/\0+$/, ''), 128);
        else if (tag === 0x8825 && type === 4) parseIfd(read32(valueOffset), true);
        else if (gps && tag === 1 && type === 2) latitudeRef = ascii(bytes, valueOffset, valueOffset + 1);
        else if (gps && tag === 2 && type === 5) latitude = rationals(bytes, valueOffset, countValue, read32);
        else if (gps && tag === 3 && type === 2) longitudeRef = ascii(bytes, valueOffset, valueOffset + 1);
        else if (gps && tag === 4 && type === 5) longitude = rationals(bytes, valueOffset, countValue, read32);
      }
    };

    parseIfd(read32(4));
    if (latitude !== undefined && longitude !== undefined && latitude >= 0 && latitude <= 90 && longitude >= 0 && longitude <= 180) result.gps = { latitude: latitudeRef === 'S' ? -latitude : latitude, longitude: longitudeRef === 'W' ? -longitude : longitude, source: 'EMBEDDED_EXIF' };
    return result;
  } catch {
    return undefined;
  }
}

function rationals(bytes: Uint8Array, offset: number, count: number, read32: (value: number) => number): number | undefined { if (count < 3) return undefined; const values: number[] = []; for (let index = 0; index < 3; index++) { const base = offset + index * 8; if (base + 8 > bytes.length) return undefined; const denominator = read32(base + 4); if (!denominator) return undefined; values.push(read32(base) / denominator); } return values[0]! + values[1]! / 60 + values[2]! / 3_600; }
function jpegDimensions(bytes: Uint8Array): { width: number; height: number } | undefined { let offset = 2; while (offset + 9 < bytes.length && bytes[offset] === 0xff) { const marker = bytes[offset + 1]!; const length = (bytes[offset + 2]! << 8) | bytes[offset + 3]!; if (length < 2 || offset + length + 2 > bytes.length) return undefined; if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) return { height: (bytes[offset + 5]! << 8) | bytes[offset + 6]!, width: (bytes[offset + 7]! << 8) | bytes[offset + 8]! }; offset += 2 + length; } return undefined; }

function validateMediaMetadata(value: unknown): MediaMetadata {
  const candidate = value as Partial<MediaMetadata>;
  if (!candidate || typeof candidate !== 'object' || !['EMBEDDED_METADATA', 'FILE_MODIFIED_TIME', 'USER_SET', 'UNKNOWN'].includes(candidate.captureTimeSource ?? '') || typeof candidate.metadataTruncated !== 'boolean') throw new MediaLibraryError('INVALID_INPUT', 'Media metadata is invalid');
  const dimensions = [candidate.width, candidate.height];
  if (dimensions.some(dimension => dimension !== undefined && (!Number.isSafeInteger(dimension) || dimension < 1 || dimension > MEDIA_MAX_DIMENSION)) || (candidate.width !== undefined && candidate.height !== undefined && candidate.width * candidate.height > MEDIA_MAX_PIXELS)) throw new MediaLibraryError('RESOURCE_LIMIT', 'Media dimensions exceed the safe decode budget');
  if (candidate.durationMs !== undefined && (!Number.isSafeInteger(candidate.durationMs) || candidate.durationMs < 0 || candidate.durationMs > 31_536_000_000)) throw new MediaLibraryError('RESOURCE_LIMIT', 'Media duration exceeds the safe metadata budget');
  if (candidate.rotationDegrees !== undefined && ![0, 90, 180, 270].includes(candidate.rotationDegrees)) throw new MediaLibraryError('INVALID_INPUT', 'Media rotation metadata is invalid');
  if (candidate.orientation !== undefined && (!Number.isInteger(candidate.orientation) || candidate.orientation < 1 || candidate.orientation > 8)) throw new MediaLibraryError('INVALID_INPUT', 'Media orientation metadata is invalid');
  if (candidate.captureTime !== undefined && !validTimestamp(candidate.captureTime)) throw new MediaLibraryError('INVALID_INPUT', 'Media capture time is invalid');
  if ((candidate.cameraMake !== undefined && (typeof candidate.cameraMake !== 'string' || candidate.cameraMake.length > 128)) || (candidate.cameraModel !== undefined && (typeof candidate.cameraModel !== 'string' || candidate.cameraModel.length > 128))) throw new MediaLibraryError('INVALID_INPUT', 'Media camera metadata is invalid');
  const gps = candidate.gps;
  if (gps !== undefined && (!gps || typeof gps !== 'object' || !Number.isFinite(gps.latitude) || gps.latitude < -90 || gps.latitude > 90 || !Number.isFinite(gps.longitude) || gps.longitude < -180 || gps.longitude > 180 || (gps.altitudeMeters !== undefined && (!Number.isFinite(gps.altitudeMeters) || Math.abs(gps.altitudeMeters) > 100_000)) || !['EMBEDDED_EXIF', 'EMBEDDED_CONTAINER', 'USER_SET'].includes(gps.source ?? ''))) throw new MediaLibraryError('INVALID_INPUT', 'Embedded media location metadata is invalid');
  const warnings = candidate.metadataWarnings;
  if (warnings !== undefined && (!Array.isArray(warnings) || warnings.length > 32 || !warnings.every(warning => typeof warning === 'string' && warning.length <= 256))) throw new MediaLibraryError('INVALID_INPUT', 'Media metadata warnings are invalid');
  return {
    ...(candidate.width !== undefined ? { width: candidate.width } : {}),
    ...(candidate.height !== undefined ? { height: candidate.height } : {}),
    ...(candidate.durationMs !== undefined ? { durationMs: candidate.durationMs } : {}),
    ...(candidate.rotationDegrees !== undefined ? { rotationDegrees: candidate.rotationDegrees } : {}),
    ...(candidate.orientation !== undefined ? { orientation: candidate.orientation } : {}),
    ...(candidate.captureTime !== undefined ? { captureTime: candidate.captureTime } : {}),
    captureTimeSource: candidate.captureTimeSource,
    ...(candidate.cameraMake !== undefined ? { cameraMake: candidate.cameraMake } : {}),
    ...(candidate.cameraModel !== undefined ? { cameraModel: candidate.cameraModel } : {}),
    ...(gps !== undefined ? { gps: { latitude: gps.latitude, longitude: gps.longitude, ...(gps.altitudeMeters !== undefined ? { altitudeMeters: gps.altitudeMeters } : {}), source: gps.source } } : {}),
    metadataTruncated: candidate.metadataTruncated,
    ...(warnings?.length ? { metadataWarnings: warnings.slice(0, 32) } : {}),
  } as MediaMetadata;
}
function validTimestamp(value: unknown): value is string { return typeof value === 'string' && value.length <= 64 && !Number.isNaN(Date.parse(value)); }
function safeOpaqueId(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\0\\/]/.test(value); }
function validateProbe(value: MediaProbeResult): MediaProbeResult { if (!value || (value.kind !== 'IMAGE' && value.kind !== 'VIDEO') || !isMediaMime(value.mimeType)) throw new MediaLibraryError('UNSUPPORTED_MEDIA', 'Media probe result is invalid'); const metadata = value.metadata ? validateMediaMetadata({ captureTimeSource: 'UNKNOWN', metadataTruncated: false, ...value.metadata }) : undefined; return { kind: value.kind, mimeType: value.mimeType.toLowerCase(), ...(metadata ? { metadata } : {}) }; }
function validateAsset(value: unknown): MediaAsset {
  const candidate = value as Partial<MediaAsset>;
  if (!candidate || candidate.version !== 1 || typeof candidate.id !== 'string' || !/^media:sha256-[a-f0-9]{64}$/i.test(candidate.id) || typeof candidate.contentId !== 'string' || mediaIdFor(candidate.contentId as ContentId) !== candidate.id || typeof candidate.filename !== 'string' || !isMediaMime(candidate.mimeType ?? '') || (candidate.kind !== 'IMAGE' && candidate.kind !== 'VIDEO') || (candidate.kind === 'IMAGE' && !IMAGE_MIME.has((candidate.mimeType ?? '').toLowerCase())) || (candidate.kind === 'VIDEO' && !VIDEO_MIME.has((candidate.mimeType ?? '').toLowerCase())) || !Number.isSafeInteger(candidate.byteLength) || (candidate.byteLength as number) < 1 || (candidate.byteLength as number) > MEDIA_MAX_ASSET_BYTES || typeof candidate.importedAt !== 'string' || !validTimestamp(candidate.importedAt) || (candidate.state !== 'ACTIVE' && candidate.state !== 'TRASHED') || !candidate.capture || !Array.isArray(candidate.tags) || candidate.tags.length > 64 || !candidate.tags.every(tag => typeof tag === 'string' && tag.length <= 64) || typeof candidate.favorite !== 'boolean' || !candidate.source) throw new MediaLibraryError('INVALID_INPUT', 'Media asset is invalid');
  const filename = candidate.filename as string;
  const mimeType = candidate.mimeType as string;
  const title = candidate.title;
  const caption = candidate.caption;
  const source = candidate.source as Partial<MediaAsset['source']>;
  if ((title !== undefined && (typeof title !== 'string' || title.length > 200)) || (caption !== undefined && (typeof caption !== 'string' || caption.length > 4_000)) || !['LOCAL_FILE', 'SELECTED_FOLDER', 'CAMERA_ROLL', 'WATCHED_FOLDER', 'RECEIVED_FILE'].includes(source.kind ?? '') || (source.selectionId !== undefined && !safeOpaqueId(source.selectionId))) throw new MediaLibraryError('INVALID_INPUT', 'Media asset metadata is invalid');
  return { ...candidate, capture: validateMediaMetadata(candidate.capture), tags: normalizeTags(candidate.tags), filename: safeFilename(filename), mimeType: mimeType.toLowerCase(), source: { kind: source.kind as MediaSourceKind, ...(source.selectionId ? { selectionId: source.selectionId } : {}) } } as MediaAsset;
}
function safeValidateAsset(value: unknown): MediaAsset | undefined { try { return validateAsset(value); } catch { return undefined; } }
function validateRecipe(recipe: MediaEditRecipe, asset: MediaAsset): void { if (!recipe || recipe.version !== 1 || !Array.isArray(recipe.operations) || recipe.operations.length > 32) throw new MediaLibraryError('INVALID_INPUT', 'Edit recipe is invalid'); for (const operation of recipe.operations) { if (!['ROTATE', 'CROP', 'FLIP_HORIZONTAL', 'FLIP_VERTICAL', 'EXPOSURE'].includes(operation.type)) throw new MediaLibraryError('INVALID_INPUT', 'Edit operation is invalid'); if (operation.type === 'CROP' && (!Number.isFinite(operation.left) || !Number.isFinite(operation.top) || !Number.isFinite(operation.width) || !Number.isFinite(operation.height) || operation.width! <= 0 || operation.height! <= 0 || operation.left! < 0 || operation.top! < 0 || operation.left! + operation.width! > (asset.capture.width ?? Number.MAX_SAFE_INTEGER) || operation.top! + operation.height! > (asset.capture.height ?? Number.MAX_SAFE_INTEGER))) throw new MediaLibraryError('INVALID_INPUT', 'Crop operation is outside image bounds'); } }
function recipeToRecord(recipe: MediaEditRecipe): Readonly<Record<string, string | number | boolean>> { return { recipeVersion: recipe.version, operations: JSON.stringify(recipe.operations) }; }
function safeFilename(value: string): string { const clean = typeof value === 'string' ? value.normalize('NFC').trim() : ''; if (!clean || clean.length > 255 || clean.includes('\0') || clean.includes('/') || clean.includes('\\') || clean === '.' || clean === '..') throw new MediaLibraryError('INVALID_INPUT', 'Media filename is invalid'); return clean; }
function jobFilename(value: string): string { try { return safeFilename(value); } catch { return 'invalid-media-selection'; } }
function boundedText(value: string, max: number): string { return typeof value === 'string' ? value.normalize('NFC').trim().slice(0, max) : ''; }
function normalizeTags(values: readonly string[]): readonly string[] { return [...new Set(values.filter(value => typeof value === 'string').map(value => boundedText(value, 64).toLocaleLowerCase()).filter(Boolean))].slice(0, 64); }
function isMediaMime(value: string): boolean { return IMAGE_MIME.has(value.toLowerCase()) || VIDEO_MIME.has(value.toLowerCase()); }
function ascii(bytes: Uint8Array, start: number, end: number): string { return String.fromCharCode(...bytes.subarray(start, end)); }
function readU16(bytes: Uint8Array, offset: number, little: boolean): number { if (offset < 0 || offset + 2 > bytes.length) throw new Error('out of bounds'); return little ? bytes[offset]! | bytes[offset + 1]! << 8 : bytes[offset]! << 8 | bytes[offset + 1]!; }
function readU32(bytes: Uint8Array, offset: number, little = false): number { if (offset < 0 || offset + 4 > bytes.length) throw new Error('out of bounds'); return little ? (bytes[offset]! | bytes[offset + 1]! << 8 | bytes[offset + 2]! << 16 | bytes[offset + 3]! * 0x1000000) >>> 0 : (bytes[offset]! * 0x1000000 + bytes[offset + 1]! * 0x10000 + bytes[offset + 2]! * 0x100 + bytes[offset + 3]!) >>> 0; }
function exifDate(value: string): string | undefined { const match = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(value); if (!match) return undefined; const date = new Date(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z`); return Number.isNaN(date.valueOf()) ? undefined : date.toISOString(); }
function token(value: string): string[] { return value.toLocaleLowerCase().normalize('NFKC').split(/[^\p{L}\p{N}]+/u).filter(part => part.length > 1).slice(0, 128); }
function tokenize(value: string): string[] { return [...new Set(token(value))].slice(0, 16); }
function assetTokens(asset: MediaAsset): readonly string[] { const values = [asset.filename, asset.title ?? '', asset.caption ?? '', asset.mimeType, asset.kind, asset.capture.captureTime ?? '', asset.capture.cameraMake ?? '', asset.capture.cameraModel ?? '', ...asset.tags]; return [...new Set(values.flatMap(token))]; }
function matchedFields(asset: MediaAsset, terms: readonly string[]): readonly string[] { const fields: string[] = []; const checks: [string, string][] = [['filename', asset.filename], ['title', asset.title ?? ''], ['caption', asset.caption ?? ''], ['tags', asset.tags.join(' ')], ['metadata', [asset.mimeType, asset.kind, asset.capture.cameraMake, asset.capture.cameraModel].filter(Boolean).join(' ')], ['date', asset.capture.captureTime ?? '']]; for (const [field, value] of checks) if (terms.some(term => token(value).includes(term))) fields.push(field); return fields; }
function compareAssets(left: MediaAsset, right: MediaAsset): number { return (right.capture.captureTime ?? right.importedAt).localeCompare(left.capture.captureTime ?? left.importedAt) || left.id.localeCompare(right.id); }
function inCaptureMonth(asset: MediaAsset, year?: number, month?: number): boolean { if (year === undefined && month === undefined) return true; const date = asset.capture.captureTime ? new Date(asset.capture.captureTime) : undefined; return Boolean(date && !Number.isNaN(date.valueOf()) && (year === undefined || date.getUTCFullYear() === year) && (month === undefined || date.getUTCMonth() + 1 === month)); }
function timelineGroups(assets: readonly MediaAsset[]): readonly MediaTimelineGroup[] { const groups = new Map<string, MediaTimelineGroup>(); for (const asset of assets) { const date = new Date(asset.capture.captureTime ?? asset.importedAt); if (Number.isNaN(date.valueOf())) continue; const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`; const current = groups.get(key); groups.set(key, current ? { ...current, count: current.count + 1 } : { key, year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(), count: 1 }); } return [...groups.values()]; }
function parseCursor(value?: string): number { if (!value) return 0; const result = Number(value); return Number.isSafeInteger(result) && result >= 0 ? result : 0; }
function bounded(value: number, min: number, max: number): number { return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.floor(value))) : min; }
function id(prefix: string): string { const uuid = globalThis.crypto?.randomUUID?.(); return `${prefix}:${uuid ?? `${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 10)}`}`; }
function clone<T>(value: T): T { return structuredClone(value); }
function safeValidateAlbum(value: unknown): MediaAlbum | undefined { const candidate = value as Partial<MediaAlbum>; return candidate?.version === 1 && typeof candidate.id === 'string' && typeof candidate.name === 'string' && Array.isArray(candidate.assetIds) && (candidate.sharing === 'PRIVATE' || candidate.sharing === 'SHARED_REFERENCE_ONLY') ? clone(candidate as MediaAlbum) : undefined; }
function safeValidateJob(value: unknown): MediaImportJob | undefined { const candidate = value as Partial<MediaImportJob>; return candidate?.version === 1 && typeof candidate.id === 'string' && typeof candidate.filename === 'string' && typeof candidate.source === 'string' && typeof candidate.state === 'string' && typeof candidate.startedAt === 'string' && typeof candidate.updatedAt === 'string' ? clone(candidate as MediaImportJob) : undefined; }
function safeValidateDerivative(value: unknown): MediaDerivativeRecord | undefined { const candidate = value as Partial<MediaDerivativeRecord>; return candidate?.version === 1 && typeof candidate.id === 'string' && typeof candidate.sourceMediaId === 'string' && typeof candidate.sourceContentId === 'string' && typeof candidate.kind === 'string' && typeof candidate.recipeHash === 'string' && typeof candidate.state === 'string' && typeof candidate.updatedAt === 'string' ? clone(candidate as MediaDerivativeRecord) : undefined; }
function safeValidatePlacement(value: unknown): MediaPlacementState | undefined { const candidate = value as Partial<MediaPlacementState>; return typeof candidate.mediaId === 'string' && typeof candidate.deviceId === 'string' && typeof candidate.metadata === 'string' && typeof candidate.thumbnail === 'string' && typeof candidate.original === 'string' && typeof candidate.updatedAt === 'string' ? clone(candidate as MediaPlacementState) : undefined; }
function safeValidateTombstone(value: unknown): MediaTombstone | undefined { const candidate = value as Partial<MediaTombstone>; return typeof candidate.mediaId === 'string' && typeof candidate.contentId === 'string' && typeof candidate.deletedAt === 'string' && candidate.reason === 'PERMANENT_DELETE' ? clone(candidate as MediaTombstone) : undefined; }
function mapNativeMediaError(code?: NativeHostErrorCode): MediaLibraryError { switch (code) { case 'CANCELLED': return new MediaLibraryError('CANCELED', 'Media operation was canceled'); case 'RESOURCE_EXHAUSTED': return new MediaLibraryError('RESOURCE_LIMIT', 'Media decoder resource limit reached'); case 'INVALID_REQUEST': return new MediaLibraryError('INVALID_INPUT', 'Media decoder request is invalid'); case 'POLICY_DENIED': case 'PERMISSION_DENIED': return new MediaLibraryError('POLICY_DENIED', 'Media decoder policy denied the request'); case 'UNSUPPORTED': return new MediaLibraryError('UNSUPPORTED_MEDIA', 'Media decoder does not support this media'); case 'TEMPORARILY_UNAVAILABLE': return new MediaLibraryError('UNAVAILABLE', 'Media decoder timed out or is temporarily unavailable'); default: return new MediaLibraryError('UNAVAILABLE', 'Production media decoder is unavailable'); } }
function requestedDerivativeDimension(recipe: Readonly<Record<string, string | number | boolean>>, kind: MediaDerivativeKind): number { const value = recipe.width ?? recipe.maxDimension; const requested = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : kind === 'THUMBNAIL' || kind === 'VIDEO_FRAME' ? 320 : kind === 'PREVIEW' ? 1_600 : 4_096; if (!Number.isSafeInteger(requested) || requested < 1 || requested > MEDIA_MAX_DIMENSION) throw new MediaLibraryError('INVALID_INPUT', 'Media derivative dimensions are invalid'); return requested; }
