/**
 * R0P90 Files / Shared Folders / Distributed Drive.
 *
 * This module extends the canonical Files and content-addressed layers.  It
 * owns folder state, authorization, revisions and local-first change
 * application; it deliberately does not own a transport or choose a route.
 * Large bodies are handed to the injected R0P74 delivery boundary and own
 * device placement is handed to the R0P73 boundary.
 */
import type { CryptoProvider } from './crypto.js';
import { signCanonical, verifyCanonical } from './crypto.js';
import type { NodeId } from './types.js';
import {
  ContentCache,
  createContentManifest,
  sha256,
  type ContentId,
  type ContentManifest,
} from './social/content.js';
import type { ContentAuthorization, DistributedContentService, ContentTransferPriority } from './social/distributed-content.js';
import type { DevicePlacementPolicy, PersonalDeviceMesh } from './personal-device-mesh.js';
import type { SharedSpace } from './social/spaces.js';
import type {
  InboxActionDescriptor,
  InboxActionKind,
  InboxActionResult,
  InboxAdapterEvent,
  InboxAdapterListInput,
  InboxDataClass,
  InboxItemKind,
  InboxProjectionAdapter,
  InboxSourceProjection,
  InboxSourceRef,
} from './inbox.js';

export const SHARED_FOLDERS_PROTOCOL = 'keystone.shared-folders.r0p90' as const;
export const SHARED_FOLDERS_VERSION = 1 as const;
export const SHARED_FOLDER_MAX_NAME = 255;
export const SHARED_FOLDER_MAX_DEPTH = 128;
export const SHARED_FOLDER_MAX_ENTRIES = 100_000;
export const SHARED_FOLDER_MAX_PAGE = 256;
export const SHARED_FOLDER_MAX_JOURNAL = 10_000;
export const SHARED_FOLDER_MAX_REVISIONS = 256;
export const SHARED_FOLDER_MAX_CONFLICTS = 4_096;
export const SHARED_FOLDER_MAX_INVITATIONS = 4_096;
export const SHARED_FOLDER_MAX_UPLOADS = 10_000;
export const SHARED_FOLDER_MAX_FILE_BYTES = 2 ** 40;
export const SHARED_FOLDER_MAX_RELATIVE_PATH = 4_096;
export const SHARED_FOLDER_MAX_WATCH_BATCH = 512;

export type FolderId = string & { readonly __folderId: unique symbol };
export type FolderEntryId = string & { readonly __folderEntryId: unique symbol };
export type FolderFileId = string & { readonly __folderFileId: unique symbol };
export type FileRevisionId = string & { readonly __fileRevisionId: unique symbol };
export type FolderChangeId = string & { readonly __folderChangeId: unique symbol };
export type FolderInvitationId = string & { readonly __folderInvitationId: unique symbol };
export type DropZoneId = string & { readonly __dropZoneId: unique symbol };
export type FilesystemBindingId = string & { readonly __filesystemBindingId: unique symbol };

export type FolderScope = 'PRIVATE' | 'SHARED' | 'DROP_ZONE';
export type FolderRole = 'VIEWER' | 'CONTRIBUTOR' | 'EDITOR' | 'OWNER' | 'UPLOAD_ONLY';
export type FolderMembershipSubject = 'IDENTITY' | 'SPACE';
export type FolderMembershipState = 'PENDING' | 'ACTIVE' | 'REVOKED' | 'REJECTED';
export type FolderEntryState = 'ACTIVE' | 'TRASHED';
export type FolderFileKind = 'BINARY' | 'TEXT' | 'COLLABORATIVE';
export type FolderFileAvailability = 'METADATA_ONLY' | 'PARTIAL' | 'AVAILABLE' | 'VERIFYING' | 'UNAVAILABLE' | 'FAILED';
export type FolderTransferState = 'IDLE' | 'QUEUED' | 'TRANSFERRING' | 'PAUSED' | 'COMPLETE' | 'FAILED' | 'CANCELLED';
export type FolderChangeKind = 'CREATE_FOLDER' | 'CREATE_FILE' | 'UPDATE_CONTENT' | 'RENAME' | 'MOVE' | 'DELETE' | 'RESTORE' | 'MEMBERSHIP';
export type FolderConflictKind = 'CONTENT' | 'DELETE_EDIT' | 'RENAME' | 'MOVE' | 'NAME_COLLISION' | 'FILESYSTEM';
export type FolderConflictState = 'OPEN' | 'RESOLVED';
export type FolderPermission = 'READ' | 'CREATE' | 'EDIT' | 'RENAME' | 'MOVE' | 'DELETE' | 'MANAGE_MEMBERS' | 'UPLOAD';

export interface KeystoneFolder {
  readonly version: 1;
  readonly id: FolderId;
  readonly name: string;
  readonly ownerIdentityId: NodeId;
  readonly scope: FolderScope;
  readonly parentFolderId?: FolderId;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly revision: number;
  readonly epoch: number;
  readonly deletedAt?: string;
}

export interface FolderEntryBase {
  readonly version: 1;
  readonly id: FolderEntryId;
  readonly parentFolderId: FolderId;
  readonly name: string;
  readonly state: FolderEntryState;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly revision: number;
  readonly deletedAt?: string;
}

export type FolderEntry =
  | (FolderEntryBase & { readonly kind: 'FOLDER'; readonly folderId: FolderId })
  | (FolderEntryBase & { readonly kind: 'FILE'; readonly fileId: FolderFileId });

export interface FileRevision {
  readonly version: 1;
  readonly id: FileRevisionId;
  readonly fileId: FolderFileId;
  readonly contentId: ContentId;
  readonly manifest: ContentManifest;
  readonly size: number;
  readonly mimeType: string;
  readonly kind: FolderFileKind;
  readonly authorIdentityId: NodeId;
  readonly authorDeviceId?: string;
  readonly createdAt: string;
  readonly parents: readonly FileRevisionId[];
  readonly message?: string;
  readonly restoreOf?: FileRevisionId;
}

export interface FolderFile {
  readonly version: 1;
  readonly id: FolderFileId;
  readonly currentRevisionId: FileRevisionId;
  readonly revisionIds: readonly FileRevisionId[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly deletedAt?: string;
}

export interface FolderMembership {
  readonly version: 1;
  readonly folderId: FolderId;
  readonly subjectType: FolderMembershipSubject;
  readonly subjectId: string;
  readonly role: FolderRole;
  readonly state: FolderMembershipState;
  readonly epoch: number;
  readonly invitedBy: NodeId;
  readonly invitedAt: string;
  readonly acceptedAt?: string;
  readonly revokedAt?: string;
}

export interface FolderInvitation {
  readonly version: 1;
  readonly id: FolderInvitationId;
  readonly folderId: FolderId;
  readonly folder: Pick<KeystoneFolder, 'id' | 'name' | 'ownerIdentityId' | 'scope' | 'epoch'>;
  readonly recipientIdentityId?: NodeId;
  readonly spaceId?: string;
  readonly role: Exclude<FolderRole, 'OWNER' | 'UPLOAD_ONLY'>;
  readonly inviterIdentityId: NodeId;
  readonly epoch: number;
  readonly createdAt: string;
  readonly expiresAt?: string;
  readonly state: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED';
  readonly signature?: string;
}

export interface DropZonePolicy {
  readonly allowedIdentityIds?: readonly NodeId[];
  readonly allowedSpaceIds?: readonly string[];
  readonly maxUploadBytes: number;
  readonly maxUploads: number;
}

export interface DropZone {
  readonly version: 1;
  readonly id: DropZoneId;
  readonly folderId: FolderId;
  readonly policy: DropZonePolicy;
  readonly ownerIdentityId: NodeId;
  readonly createdAt: string;
  readonly revokedIdentityIds: readonly NodeId[];
}

export interface DropZoneReceipt {
  readonly version: 1;
  readonly id: string;
  readonly zoneId: DropZoneId;
  readonly uploaderIdentityId: NodeId;
  readonly state: 'ACCEPTED' | 'QUEUED' | 'VERIFIED' | 'REJECTED';
  readonly fileId?: FolderFileId;
  readonly receivedAt: string;
}

export interface FolderConflict {
  readonly version: 1;
  readonly id: string;
  readonly folderId: FolderId;
  readonly fileId?: FolderFileId;
  readonly entryId?: FolderEntryId;
  readonly kind: FolderConflictKind;
  readonly state: FolderConflictState;
  readonly revisionIds?: readonly FileRevisionId[];
  readonly details: string;
  readonly createdAt: string;
  readonly resolvedAt?: string;
  readonly resolution?: 'KEEP_CURRENT' | 'KEEP_REVISION' | 'SAVE_BOTH' | 'RENAME' | 'RESTORE';
}

export interface FolderChange {
  readonly version: 1;
  readonly protocol: typeof SHARED_FOLDERS_PROTOCOL;
  readonly id: FolderChangeId;
  readonly folderId: FolderId;
  readonly objectId: string;
  readonly kind: FolderChangeKind;
  readonly actorIdentityId: NodeId;
  readonly actorDeviceId?: string;
  readonly epoch: number;
  readonly baseRevisionId?: FileRevisionId;
  readonly createdAt: string;
  readonly payload: unknown;
  readonly signature?: string;
}

export interface FolderPlacementState {
  readonly folderId: FolderId;
  readonly fileId?: FolderFileId;
  readonly intent: 'LOCAL_ONLY' | 'OWNED_DEVICES' | 'SELECTED_DEVICES' | 'HIGH_AVAILABILITY' | 'METADATA_ONLY' | 'ON_DEMAND';
  readonly selectedDeviceIds?: readonly NodeId[];
  readonly includeContent: boolean;
  readonly updatedAt: string;
}

export interface FolderTransferProgress {
  readonly fileId: FolderFileId;
  readonly state: FolderTransferState;
  readonly completedBytes: number;
  readonly totalBytes: number;
  readonly completedChunks: number;
  readonly totalChunks: number;
  readonly sourceIds: readonly string[];
}

export interface FolderFileProjection {
  readonly file: FolderFile;
  readonly entry: FolderEntry & { readonly kind: 'FILE'; readonly fileId: FolderFileId };
  readonly revision: FileRevision;
  readonly availability: FolderFileAvailability;
  readonly transfer?: FolderTransferProgress;
}

export interface FolderStateSnapshot {
  readonly version: 1;
  readonly protocol: typeof SHARED_FOLDERS_PROTOCOL;
  readonly folders: readonly KeystoneFolder[];
  readonly entries: readonly FolderEntry[];
  readonly files: readonly FolderFile[];
  readonly revisions: readonly FileRevision[];
  readonly memberships: readonly FolderMembership[];
  readonly invitations: readonly FolderInvitation[];
  readonly changes: readonly FolderChange[];
  readonly conflicts: readonly FolderConflict[];
  readonly dropZones: readonly DropZone[];
  readonly receipts: readonly DropZoneReceipt[];
  readonly placements: readonly FolderPlacementState[];
}

export interface FolderStateStore {
  read(): Promise<unknown | undefined>;
  write(value: unknown): Promise<void>;
}

export class InMemoryFolderStateStore implements FolderStateStore {
  private value?: unknown;
  async read(): Promise<unknown | undefined> { return this.value === undefined ? undefined : structuredClone(this.value); }
  async write(value: unknown): Promise<void> { this.value = structuredClone(value); }
}

export interface FolderContentStore {
  import(bytes: Uint8Array, options: { readonly mimeType: string; readonly name?: string; readonly contentPolicy?: 'PRIVATE_NO_STRANGER_CACHE' | 'OWNED_DEVICES' | 'AUTHORIZED_GROUP' }): Promise<ContentManifest>;
  manifest(contentId: ContentId): ContentManifest | undefined | Promise<ContentManifest | undefined>;
  read(contentId: ContentId): Promise<Uint8Array | undefined>;
}

/** Uses the canonical R0P74 ContentCache; it is not a second Files store. */
export class ContentCacheFolderContentStore implements FolderContentStore {
  constructor(readonly cache: ContentCache) {}
  async import(bytes: Uint8Array, options: { readonly mimeType: string; readonly name?: string; readonly contentPolicy?: 'PRIVATE_NO_STRANGER_CACHE' | 'OWNED_DEVICES' | 'AUTHORIZED_GROUP' }): Promise<ContentManifest> {
    if (bytes.byteLength > SHARED_FOLDER_MAX_FILE_BYTES) throw new SharedFolderError('RESOURCE_LIMIT', 'File exceeds the shared-folder size bound');
    const manifest = await createContentManifest(bytes, { mimeType: options.mimeType, name: options.name, contentPolicy: options.contentPolicy });
    await this.cache.putManifest(manifest);
    for (let index = 0; index < manifest.chunks.length; index++) {
      const start = index * manifest.chunkSize;
      await this.cache.putVerifiedChunk(manifest, index, bytes.subarray(start, Math.min(bytes.byteLength, start + manifest.chunkSize)));
    }
    return manifest;
  }
  manifest(contentId: ContentId): ContentManifest | undefined { return this.cache.manifest(contentId); }
  async read(contentId: ContentId): Promise<Uint8Array | undefined> { return this.cache.read(contentId); }
}

export interface FolderContentDelivery {
  acquire(input: {
    readonly manifest: ContentManifest;
    readonly authorization: ContentAuthorization;
    readonly priority: ContentTransferPriority;
    readonly signal?: AbortSignal;
    readonly onProgress?: (progress: FolderTransferProgress) => void;
  }): Promise<Uint8Array | undefined>;
}

/** Adapter to R0P74.  It passes authorization separately from the content hash. */
export class DistributedContentFolderDelivery implements FolderContentDelivery {
  constructor(private readonly service: DistributedContentService) {}
  async acquire(input: Parameters<FolderContentDelivery['acquire']>[0]): Promise<Uint8Array> {
    return this.service.download({
      manifest: input.manifest,
      authorization: input.authorization,
      priority: input.priority,
      signal: input.signal,
      onProgress: progress => input.onProgress?.({
        fileId: 'unknown' as FolderFileId,
        state: 'TRANSFERRING',
        completedBytes: progress.completedBytes,
        totalBytes: progress.totalBytes,
        completedChunks: progress.completedChunks,
        totalChunks: progress.totalChunks,
        sourceIds: progress.activeSources,
      }),
    });
  }
}

export interface FolderPlacementAdapter {
  place(input: {
    readonly objectId: string;
    readonly objectType: 'folder' | 'folder_file';
    readonly objectVersion: string;
    readonly contentHash?: ContentId;
    readonly sizeBytes: number;
    readonly policy: DevicePlacementPolicy;
  }): Promise<unknown>;
}

export class PersonalDeviceFolderPlacement implements FolderPlacementAdapter {
  constructor(private readonly mesh: PersonalDeviceMesh) {}
  place(input: Parameters<FolderPlacementAdapter['place']>[0]): Promise<unknown> {
    return this.mesh.replicate({
      objectId: input.objectId,
      objectType: input.objectType,
      objectVersion: input.objectVersion,
      sizeBytes: input.sizeBytes,
      policy: input.policy,
      metadata: { objectId: input.objectId, objectType: input.objectType, objectVersion: input.objectVersion, ...(input.contentHash ? { contentHash: input.contentHash } : {}) },
      priority: 'BACKGROUND',
    });
  }
}

export interface FolderSigner {
  sign(payload: unknown): Promise<string>;
  verify(payload: unknown, signature: string, signer: NodeId): Promise<boolean>;
}

export class CryptoFolderSigner implements FolderSigner {
  constructor(private readonly crypto: CryptoProvider, private readonly privateKey: string) {}
  sign(payload: unknown): Promise<string> { return signCanonical(payload, canonicalBytes => this.crypto.sign(canonicalBytes, this.privateKey)); }
  verify(payload: unknown, signature: string, signer: NodeId): Promise<boolean> { return verifyCanonical(payload, signature, (canonicalBytes, rawSignature) => this.crypto.verify(canonicalBytes, rawSignature, signer)); }
}

export interface FolderSpaceAccessProvider {
  isMember(spaceId: string, identityId: NodeId): boolean | Promise<boolean>;
}

/** Explicit Space role mapping.  Space membership does not become folder edit authority by itself. */
export function createSharedSpaceFolderAccessProvider(getSpace: (spaceId: string) => SharedSpace | undefined): FolderSpaceAccessProvider {
  return { isMember: (spaceId, identityId) => Boolean(getSpace(spaceId)?.members.some(member => member.identityId === identityId && !member.removedAt && member.kind === 'human')) };
}

export interface SharedFolderServiceOptions {
  readonly localIdentityId: NodeId;
  readonly localDeviceId?: string;
  readonly content: FolderContentStore;
  readonly stateStore?: FolderStateStore;
  readonly contentDelivery?: FolderContentDelivery;
  readonly placement?: FolderPlacementAdapter;
  readonly spaceAccess?: FolderSpaceAccessProvider;
  readonly signer?: FolderSigner;
  readonly requireSignedChanges?: boolean;
  readonly now?: () => number;
  readonly maxJournalEntries?: number;
}

export type SharedFolderErrorCode = 'INVALID_ARGUMENT' | 'NOT_FOUND' | 'NOT_AUTHORIZED' | 'STALE_EPOCH' | 'REPLAY' | 'CONFLICT' | 'INVALID_STATE' | 'RESOURCE_LIMIT' | 'UNAVAILABLE' | 'INTEGRITY' | 'POLICY_DENIED' | 'PATH_UNSAFE';

export class SharedFolderError extends Error {
  constructor(readonly code: SharedFolderErrorCode, message: string) { super(message); this.name = 'SharedFolderError'; }
}

export interface FolderListOptions { readonly limit?: number; readonly cursor?: string; readonly includeTrash?: boolean; }
export interface FolderListResult<T> { readonly items: readonly T[]; readonly nextCursor?: string; readonly total: number; }
export interface FolderSearchResult { readonly entry: FolderEntry; readonly folder: KeystoneFolder; readonly score: number; readonly matchedFields: readonly string[]; readonly snippet?: string; }

type InternalState = {
  folders: Map<FolderId, KeystoneFolder>;
  entries: Map<FolderEntryId, FolderEntry>;
  files: Map<FolderFileId, FolderFile>;
  revisions: Map<FileRevisionId, FileRevision>;
  memberships: Map<string, FolderMembership>;
  invitations: Map<FolderInvitationId, FolderInvitation>;
  changes: Map<FolderChangeId, FolderChange>;
  conflicts: Map<string, FolderConflict>;
  dropZones: Map<DropZoneId, DropZone>;
  receipts: Map<string, DropZoneReceipt>;
  placements: Map<string, FolderPlacementState>;
  tombstones: Map<string, { readonly kind: 'FOLDER' | 'FILE' | 'ENTRY'; readonly revision: number; readonly deletedAt: string }>;
};

export class SharedFolderService {
  private readonly localIdentityId: NodeId;
  private readonly localDeviceId?: string;
  private readonly content: FolderContentStore;
  private readonly stateStore: FolderStateStore;
  private readonly contentDelivery?: FolderContentDelivery;
  private readonly placement?: FolderPlacementAdapter;
  private readonly spaceAccess?: FolderSpaceAccessProvider;
  private readonly signer?: FolderSigner;
  private readonly requireSignedChanges: boolean;
  private readonly now: () => number;
  private readonly maxJournalEntries: number;
  private readonly state: InternalState = {
    folders: new Map(), entries: new Map(), files: new Map(), revisions: new Map(), memberships: new Map(), invitations: new Map(), changes: new Map(), conflicts: new Map(), dropZones: new Map(), receipts: new Map(), placements: new Map(), tombstones: new Map(),
  };
  private readonly transfer = new Map<FolderFileId, FolderTransferProgress>();
  private readonly subscribers = new Set<() => void>();
  private writes: Promise<void> = Promise.resolve();
  private readonly readyPromise: Promise<void>;

  constructor(options: SharedFolderServiceOptions) {
    if (!options.localIdentityId || !options.content) throw new SharedFolderError('INVALID_ARGUMENT', 'Shared Folder service requires a local identity and content store');
    this.localIdentityId = options.localIdentityId; this.localDeviceId = options.localDeviceId; this.content = options.content; this.stateStore = options.stateStore ?? new InMemoryFolderStateStore(); this.contentDelivery = options.contentDelivery; this.placement = options.placement; this.spaceAccess = options.spaceAccess; this.signer = options.signer; this.requireSignedChanges = options.requireSignedChanges ?? Boolean(options.signer); this.now = options.now ?? Date.now; this.maxJournalEntries = clampInt(options.maxJournalEntries, 256, SHARED_FOLDER_MAX_JOURNAL, SHARED_FOLDER_MAX_JOURNAL); this.readyPromise = this.hydrate();
  }

  async ready(): Promise<void> { await this.readyPromise; }
  subscribe(listener: () => void): () => void { this.subscribers.add(listener); return () => this.subscribers.delete(listener); }
  diagnostics(): { readonly folders: number; readonly entries: number; readonly files: number; readonly revisions: number; readonly journal: number; readonly conflicts: number; readonly pendingTransfers: number; readonly bindings: number } { return { folders: this.state.folders.size, entries: this.state.entries.size, files: this.state.files.size, revisions: this.state.revisions.size, journal: this.state.changes.size, conflicts: [...this.state.conflicts.values()].filter(value => value.state === 'OPEN').length, pendingTransfers: [...this.transfer.values()].filter(value => value.state === 'QUEUED' || value.state === 'TRANSFERRING').length, bindings: 0 }; }

  async createFolder(input: { readonly name: string; readonly parentFolderId?: FolderId; readonly scope?: FolderScope; readonly internalDropZone?: true }): Promise<KeystoneFolder> {
    await this.ready(); const name = validateName(input.name); const parent = input.parentFolderId ? this.requireFolder(input.parentFolderId) : undefined; if (parent) await this.assertPermission(parent, 'CREATE'); if (parent && parent.scope !== (input.scope ?? parent.scope)) throw new SharedFolderError('POLICY_DENIED', 'Nested folder scope must follow its parent'); const scope = input.scope ?? parent?.scope ?? 'PRIVATE'; if (scope === 'DROP_ZONE' && input.internalDropZone !== true) throw new SharedFolderError('POLICY_DENIED', 'Create Drop Zone through createDropZone'); const now = iso(this.now()); const folder: KeystoneFolder = { version: 1, id: id('folder') as FolderId, name, ownerIdentityId: this.localIdentityId, scope, ...(parent ? { parentFolderId: parent.id } : {}), createdAt: now, updatedAt: now, revision: 1, epoch: 1 }; const entry: FolderEntry | undefined = parent ? { version: 1, id: id('entry') as FolderEntryId, parentFolderId: parent.id, name, kind: 'FOLDER', folderId: folder.id, state: 'ACTIVE', createdAt: now, updatedAt: now, revision: 1 } : undefined; await this.commit(this.makeChange(parent?.id ?? folder.id, folder.id, 'CREATE_FOLDER', { folder, ...(entry ? { entry } : {}) }, parent?.epoch ?? 1)); return clone(this.requireFolder(folder.id));
  }

  async createFile(input: { readonly folderId: FolderId; readonly name: string; readonly bytes: Uint8Array; readonly mimeType: string; readonly kind?: FolderFileKind; readonly message?: string }): Promise<FolderFileProjection> {
    await this.ready(); const folder = this.requireFolder(input.folderId); await this.assertPermission(folder, 'CREATE'); const name = validateName(input.name); if (input.bytes.byteLength > SHARED_FOLDER_MAX_FILE_BYTES) throw new SharedFolderError('RESOURCE_LIMIT', 'File exceeds the shared-folder size bound'); const manifest = await this.content.import(input.bytes, { mimeType: validateMime(input.mimeType), name, contentPolicy: folder.scope === 'PRIVATE' ? 'PRIVATE_NO_STRANGER_CACHE' : folder.scope === 'SHARED' ? 'AUTHORIZED_GROUP' : 'AUTHORIZED_GROUP' }); const now = iso(this.now()); const fileId = id('file') as FolderFileId; const revisionId = id('revision') as FileRevisionId; const revision: FileRevision = { version: 1, id: revisionId, fileId, contentId: manifest.contentId, manifest, size: manifest.byteLength, mimeType: manifest.mimeType, kind: input.kind ?? (manifest.mimeType.startsWith('text/') ? 'TEXT' : 'BINARY'), authorIdentityId: this.localIdentityId, ...(this.localDeviceId ? { authorDeviceId: this.localDeviceId } : {}), createdAt: now, parents: [], ...(input.message ? { message: input.message.slice(0, 1_000) } : {}) }; const file: FolderFile = { version: 1, id: fileId, currentRevisionId: revisionId, revisionIds: [revisionId], createdAt: now, updatedAt: now }; const entry: FolderEntry = { version: 1, id: id('entry') as FolderEntryId, parentFolderId: folder.id, name, kind: 'FILE', fileId, state: 'ACTIVE', createdAt: now, updatedAt: now, revision: 1 }; await this.commit(this.makeChange(folder.id, fileId, 'CREATE_FILE', { file, revision, entry }, folder.epoch)); return this.describeFile(fileId);
  }

  async createFolderFromDescriptor(folder: KeystoneFolder, actorIdentityId = this.localIdentityId): Promise<KeystoneFolder> { await this.ready(); if (folder.version !== 1 || !folder.id || folder.ownerIdentityId !== actorIdentityId && actorIdentityId !== this.localIdentityId) throw new SharedFolderError('INVALID_ARGUMENT', 'Folder descriptor is invalid'); if (!this.state.folders.has(folder.id)) this.state.folders.set(folder.id, clone(folder)); await this.persist(); return clone(folder); }

  getFolder(folderId: FolderId): KeystoneFolder | undefined { const value = this.state.folders.get(folderId); return value ? clone(value) : undefined; }
  listFolders(options: { readonly includeTrash?: boolean } = {}): readonly KeystoneFolder[] { return [...this.state.folders.values()].filter(value => options.includeTrash || !value.deletedAt).sort(compareFolders).map(clone); }

  async listChildren(folderId: FolderId, options: FolderListOptions = {}): Promise<FolderListResult<FolderEntry>> { await this.ready(); const folder = this.requireFolder(folderId); await this.assertPermission(folder, 'READ'); const includeTrash = options.includeTrash === true; const values = [...this.state.entries.values()].filter(value => value.parentFolderId === folderId && (includeTrash || value.state === 'ACTIVE')).sort(compareEntries); const page = paginate(values, options); return { items: page.items.map(clone), ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}), total: values.length }; }
  async describeFile(fileId: FolderFileId, actorIdentityId = this.localIdentityId): Promise<FolderFileProjection> { await this.ready(); const file = this.requireFile(fileId); const entry = this.findFileEntry(fileId); if (!entry) throw new SharedFolderError('NOT_FOUND', 'File entry not found'); const folder = this.requireFolder(entry.parentFolderId); await this.assertPermission(folder, 'READ', actorIdentityId); const revision = this.requireRevision(file.currentRevisionId); return { file: clone(file), entry: clone(entry), revision: clone(revision), availability: await this.availability(revision) }; }
  async listFiles(folderId: FolderId, options: FolderListOptions = {}): Promise<FolderListResult<FolderFileProjection>> { const entries = await this.listChildren(folderId, options); const items: FolderFileProjection[] = []; for (const entry of entries.items) if (entry.kind === 'FILE') items.push(await this.describeFile(entry.fileId)); return { items, ...(entries.nextCursor ? { nextCursor: entries.nextCursor } : {}), total: entries.total }; }

  async renameEntry(entryId: FolderEntryId, name: string, options: { readonly ownerConfirmed?: true } = {}): Promise<FolderEntry> { await this.ready(); const entry = this.requireEntry(entryId); const folder = this.requireFolder(entry.parentFolderId); await this.assertPermission(folder, 'RENAME'); validateName(name); this.assertBoundaryName(folder.id, name, entry.id); if (entry.name === name) return clone(entry); if (folder.scope !== 'PRIVATE' && options.ownerConfirmed !== true && entry.kind === 'FILE') throw new SharedFolderError('POLICY_DENIED', 'Renaming shared content requires explicit owner confirmation'); const change = this.makeChange(folder.id, entry.id, 'RENAME', { entryId, name: validateName(name), baseEntryRevision: entry.revision }, folder.epoch); await this.commit(change); return clone(this.requireEntry(entryId)); }

  async moveEntry(entryId: FolderEntryId, destinationFolderId: FolderId, options: { readonly ownerConfirmed?: true } = {}): Promise<FolderEntry> { await this.ready(); const entry = this.requireEntry(entryId); const source = this.requireFolder(entry.parentFolderId); const destination = this.requireFolder(destinationFolderId); await this.assertPermission(source, 'MOVE'); await this.assertPermission(destination, 'CREATE'); if (entry.kind === 'FOLDER' && (entry.folderId === destination.id || await this.isDescendant(destination.id, entry.folderId))) throw new SharedFolderError('INVALID_ARGUMENT', 'Folder move would create a directory cycle'); if (source.scope !== destination.scope && options.ownerConfirmed !== true) throw new SharedFolderError('POLICY_DENIED', 'Moving across a privacy boundary requires explicit owner confirmation'); if (source.scope !== 'PRIVATE' && destination.scope === 'PRIVATE' && source.ownerIdentityId !== this.localIdentityId) throw new SharedFolderError('NOT_AUTHORIZED', 'Only the folder owner may move content out of a shared folder'); const change = this.makeChange(source.id, entry.id, 'MOVE', { entryId, destinationFolderId, baseEntryRevision: entry.revision }, source.epoch); await this.commit(change); return clone(this.requireEntry(entryId)); }

  async deleteEntry(entryId: FolderEntryId, options: { readonly ownerConfirmed?: true } = {}): Promise<void> { await this.ready(); const entry = this.requireEntry(entryId); const folder = this.requireFolder(entry.parentFolderId); await this.assertPermission(folder, 'DELETE'); if (folder.scope !== 'PRIVATE' && options.ownerConfirmed !== true) throw new SharedFolderError('POLICY_DENIED', 'Deleting shared content requires explicit owner confirmation'); const baseRevisionId = entry.kind === 'FILE' ? this.requireFile(entry.fileId).currentRevisionId : undefined; await this.commit(this.makeChange(folder.id, entry.id, 'DELETE', { entryId, baseRevisionId }, folder.epoch)); }
  async restoreEntry(entryId: FolderEntryId, options: { readonly ownerConfirmed?: true } = {}): Promise<FolderEntry> { await this.ready(); const entry = this.requireEntry(entryId, true); const folder = this.requireFolder(entry.parentFolderId, true); await this.assertPermission(folder, 'EDIT'); if (folder.scope !== 'PRIVATE' && options.ownerConfirmed !== true) throw new SharedFolderError('POLICY_DENIED', 'Restoring shared content requires explicit owner confirmation'); await this.commit(this.makeChange(folder.id, entry.id, 'RESTORE', { entryId }, folder.epoch)); return clone(this.requireEntry(entryId)); }
  listTrash(folderId?: FolderId): readonly FolderEntry[] { return [...this.state.entries.values()].filter(value => value.state === 'TRASHED' && (!folderId || value.parentFolderId === folderId)).sort(compareEntries).map(clone); }
  async permanentlyDelete(entryId: FolderEntryId, ownerConfirmed: true): Promise<void> { await this.ready(); if (!ownerConfirmed) throw new SharedFolderError('POLICY_DENIED', 'Permanent deletion requires explicit owner confirmation'); const entry = this.requireEntry(entryId, true); const folder = this.requireFolder(entry.parentFolderId, true); if (folder.ownerIdentityId !== this.localIdentityId) throw new SharedFolderError('NOT_AUTHORIZED', 'Only the folder owner may permanently delete content'); if (entry.kind === 'FOLDER') for (const child of [...this.state.entries.values()].filter(value => value.parentFolderId === entry.folderId)) await this.permanentlyDelete(child.id, true); this.state.entries.delete(entry.id); if (entry.kind === 'FILE') { const file = this.state.files.get(entry.fileId); if (file) { for (const revisionId of file.revisionIds) this.state.revisions.delete(revisionId); this.state.files.delete(file.id); } } this.state.tombstones.set(entry.id, { kind: 'ENTRY', revision: entry.revision, deletedAt: iso(this.now()) }); await this.persist(); this.emit(); }

  async updateFile(fileId: FolderFileId, bytes: Uint8Array, input: { readonly baseRevisionId?: FileRevisionId; readonly message?: string; readonly mimeType?: string } = {}): Promise<FolderFileProjection> { await this.ready(); const file = this.requireFile(fileId); const entry = this.findFileEntry(fileId); if (!entry) throw new SharedFolderError('NOT_FOUND', 'File entry not found'); const folder = this.requireFolder(entry.parentFolderId); await this.assertPermission(folder, 'EDIT'); const current = this.requireRevision(file.currentRevisionId); const incomingHash = `sha256-${await sha256(bytes)}` as ContentId; if (incomingHash === current.contentId && !(input.message && input.message.trim())) return this.describeFile(fileId); const baseRevisionId = input.baseRevisionId ?? current.id; const manifest = await this.content.import(bytes, { mimeType: input.mimeType ?? current.mimeType, name: entry.name, contentPolicy: folder.scope === 'PRIVATE' ? 'PRIVATE_NO_STRANGER_CACHE' : 'AUTHORIZED_GROUP' }); const now = iso(this.now()); const revision: FileRevision = { version: 1, id: id('revision') as FileRevisionId, fileId, contentId: manifest.contentId, manifest, size: manifest.byteLength, mimeType: manifest.mimeType, kind: current.kind, authorIdentityId: this.localIdentityId, ...(this.localDeviceId ? { authorDeviceId: this.localDeviceId } : {}), createdAt: now, parents: [baseRevisionId], ...(input.message ? { message: input.message.slice(0, 1_000) } : {}) }; await this.commit(this.makeChange(folder.id, fileId, 'UPDATE_CONTENT', { fileId, revision }, folder.epoch, baseRevisionId)); return this.describeFile(fileId); }

  async versionHistory(fileId: FolderFileId): Promise<readonly FileRevision[]> { await this.ready(); const file = this.requireFile(fileId); const entry = this.findFileEntry(fileId); if (!entry) throw new SharedFolderError('NOT_FOUND', 'File entry not found'); await this.assertPermission(this.requireFolder(entry.parentFolderId), 'READ'); return file.revisionIds.map(id => this.requireRevision(id)).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)).slice(0, SHARED_FOLDER_MAX_REVISIONS).map(clone); }
  async restoreRevision(fileId: FolderFileId, revisionId: FileRevisionId, ownerConfirmed: true): Promise<FolderFileProjection> { await this.ready(); if (!ownerConfirmed) throw new SharedFolderError('POLICY_DENIED', 'Restoring a version requires explicit owner confirmation'); const file = this.requireFile(fileId); const selected = this.requireRevision(revisionId); if (selected.fileId !== fileId) throw new SharedFolderError('INVALID_ARGUMENT', 'Revision belongs to another file'); const entry = this.findFileEntry(fileId); if (!entry) throw new SharedFolderError('NOT_FOUND', 'File entry not found'); const folder = this.requireFolder(entry.parentFolderId); await this.assertPermission(folder, 'EDIT'); const now = iso(this.now()); const restored: FileRevision = { ...selected, id: id('revision') as FileRevisionId, authorIdentityId: this.localIdentityId, ...(this.localDeviceId ? { authorDeviceId: this.localDeviceId } : {}), createdAt: now, parents: [file.currentRevisionId], restoreOf: selected.id, message: `Restore ${selected.id}` }; await this.commit(this.makeChange(folder.id, fileId, 'UPDATE_CONTENT', { fileId, revision: restored }, folder.epoch, file.currentRevisionId)); return this.describeFile(fileId); }

  async listConflicts(folderId?: FolderId): Promise<readonly FolderConflict[]> { await this.ready(); return [...this.state.conflicts.values()].filter(value => value.state === 'OPEN' && (!folderId || value.folderId === folderId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(clone); }
  async resolveConflict(conflictId: string, resolution: 'KEEP_CURRENT' | 'KEEP_REVISION' | 'SAVE_BOTH', revisionId?: FileRevisionId, ownerConfirmed: true = true): Promise<FolderConflict> { await this.ready(); const conflict = this.state.conflicts.get(conflictId); if (!conflict) throw new SharedFolderError('NOT_FOUND', 'Conflict not found'); if (!ownerConfirmed) throw new SharedFolderError('POLICY_DENIED', 'Conflict resolution requires explicit owner confirmation'); if (conflict.fileId) { const entry = this.findFileEntry(conflict.fileId); if (!entry) throw new SharedFolderError('NOT_FOUND', 'Conflict file entry not found'); await this.assertPermission(this.requireFolder(entry.parentFolderId), 'EDIT'); if (resolution === 'KEEP_REVISION') { if (!revisionId || !conflict.revisionIds?.includes(revisionId)) throw new SharedFolderError('INVALID_ARGUMENT', 'Selected revision is not part of the conflict'); const file = this.requireFile(conflict.fileId); const selected = this.requireRevision(revisionId); const now = iso(this.now()); const next: FileRevision = { ...selected, id: id('revision') as FileRevisionId, authorIdentityId: this.localIdentityId, ...(this.localDeviceId ? { authorDeviceId: this.localDeviceId } : {}), createdAt: now, parents: [file.currentRevisionId], message: `Resolve ${conflict.id}` }; await this.commit(this.makeChange(entry.parentFolderId, conflict.fileId, 'UPDATE_CONTENT', { fileId: conflict.fileId, revision: next }, this.requireFolder(entry.parentFolderId).epoch, file.currentRevisionId)); } } const resolved: FolderConflict = { ...conflict, state: 'RESOLVED', resolvedAt: iso(this.now()), resolution }; this.state.conflicts.set(conflict.id, resolved); await this.persist(); this.emit(); return clone(resolved); }

  async invite(folderId: FolderId, input: { readonly recipientIdentityId?: NodeId; readonly spaceId?: string; readonly role: Exclude<FolderRole, 'OWNER' | 'UPLOAD_ONLY'>; readonly expiresAt?: string }): Promise<FolderInvitation> { await this.ready(); const folder = this.requireFolder(folderId); if (folder.ownerIdentityId !== this.localIdentityId) throw new SharedFolderError('NOT_AUTHORIZED', 'Only the folder owner may invite members'); if (!['VIEWER', 'CONTRIBUTOR', 'EDITOR'].includes(input.role)) throw new SharedFolderError('INVALID_ARGUMENT', 'Invitation role is invalid'); if ((!input.recipientIdentityId && !input.spaceId) || (input.recipientIdentityId && input.spaceId)) throw new SharedFolderError('INVALID_ARGUMENT', 'Invitation needs exactly one identity or Space target'); if (input.expiresAt && !validFutureDate(input.expiresAt, this.now)) throw new SharedFolderError('INVALID_ARGUMENT', 'Invitation expiry is invalid'); const now = iso(this.now()); const sharedScope = folder.scope === 'PRIVATE' ? 'SHARED' as const : folder.scope; const invitationUnsigned: Omit<FolderInvitation, 'signature'> = { version: 1, id: id('invite') as FolderInvitationId, folderId, folder: { id: folder.id, name: folder.name, ownerIdentityId: folder.ownerIdentityId, scope: sharedScope, epoch: folder.epoch + 1 }, ...(input.recipientIdentityId ? { recipientIdentityId: input.recipientIdentityId } : {}), ...(input.spaceId ? { spaceId: input.spaceId } : {}), role: input.role, inviterIdentityId: this.localIdentityId, epoch: folder.epoch + 1, createdAt: now, ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}), state: 'PENDING' }; const invitation: FolderInvitation = { ...invitationUnsigned, ...(this.signer ? { signature: await this.signer.sign(invitationUnsigned) } : {}) }; this.state.invitations.set(invitation.id, invitation); const member: FolderMembership = { version: 1, folderId, subjectType: input.recipientIdentityId ? 'IDENTITY' : 'SPACE', subjectId: input.recipientIdentityId ?? input.spaceId!, role: input.role, state: 'PENDING', epoch: invitation.epoch, invitedBy: this.localIdentityId, invitedAt: now }; this.state.memberships.set(membershipKey(member), member); this.state.folders.set(folder.id, { ...folder, scope: sharedScope, epoch: invitation.epoch, revision: folder.revision + 1, updatedAt: now }); await this.persist(); this.emit(); return clone(invitation); }
  async receiveInvitation(invitation: FolderInvitation): Promise<void> { await this.ready(); this.validateInvitation(invitation); if (invitation.recipientIdentityId !== this.localIdentityId) throw new SharedFolderError('NOT_AUTHORIZED', 'Invitation recipient does not match this device'); if (invitation.expiresAt && Date.parse(invitation.expiresAt) <= this.now()) throw new SharedFolderError('POLICY_DENIED', 'Invitation has expired'); if (this.signer && (!invitation.signature || !(await this.signer.verify(stripSignature(invitation), invitation.signature, invitation.inviterIdentityId)))) throw new SharedFolderError('INTEGRITY', 'Invitation signature rejected'); this.state.invitations.set(invitation.id, clone(invitation)); await this.persist(); this.emit(); }
  async acceptInvitation(invitationId: FolderInvitationId): Promise<FolderMembership> { await this.ready(); const invitation = this.state.invitations.get(invitationId); if (!invitation) throw new SharedFolderError('NOT_FOUND', 'Invitation not found'); if (invitation.recipientIdentityId !== this.localIdentityId) throw new SharedFolderError('NOT_AUTHORIZED', 'Invitation recipient does not match this identity'); if (invitation.state !== 'PENDING') throw new SharedFolderError('POLICY_DENIED', 'Invitation is not pending'); if (invitation.expiresAt && Date.parse(invitation.expiresAt) <= this.now()) throw new SharedFolderError('POLICY_DENIED', 'Invitation has expired'); const existing = this.state.folders.get(invitation.folderId); if (!existing) this.state.folders.set(invitation.folderId, { version: 1, ...invitation.folder, createdAt: invitation.createdAt, updatedAt: invitation.createdAt, revision: 1 }); const now = iso(this.now()); const membership: FolderMembership = { version: 1, folderId: invitation.folderId, subjectType: 'IDENTITY', subjectId: this.localIdentityId, role: invitation.role, state: 'ACTIVE', epoch: invitation.epoch, invitedBy: invitation.inviterIdentityId, invitedAt: invitation.createdAt, acceptedAt: now }; this.state.memberships.set(membershipKey(membership), membership); this.state.invitations.set(invitation.id, { ...invitation, state: 'ACCEPTED' }); await this.persist(); this.emit(); return clone(membership); }
  async confirmInvitationAcceptance(invitationId: FolderInvitationId): Promise<FolderMembership> { await this.ready(); const invitation = this.state.invitations.get(invitationId); if (!invitation || !invitation.recipientIdentityId) throw new SharedFolderError('NOT_FOUND', 'Identity invitation not found'); const member = this.state.memberships.get(`${invitation.folderId}:IDENTITY:${invitation.recipientIdentityId}`); if (!member || member.state !== 'PENDING') throw new SharedFolderError('POLICY_DENIED', 'Invitation has not been accepted by the recipient'); const folder = this.requireFolder(invitation.folderId); if (folder.ownerIdentityId !== this.localIdentityId) throw new SharedFolderError('NOT_AUTHORIZED', 'Only the owner may confirm membership'); const active = { ...member, state: 'ACTIVE' as const, acceptedAt: iso(this.now()) }; this.state.memberships.set(membershipKey(active), active); await this.persist(); this.emit(); return clone(active); }
  async rejectInvitation(invitationId: FolderInvitationId): Promise<void> { await this.ready(); const invitation = this.state.invitations.get(invitationId); if (!invitation || invitation.recipientIdentityId !== this.localIdentityId) throw new SharedFolderError('NOT_AUTHORIZED', 'Invitation recipient does not match this identity'); this.state.invitations.set(invitationId, { ...invitation, state: 'REJECTED' }); await this.persist(); this.emit(); }
  async revokeMember(folderId: FolderId, subjectId: string, ownerConfirmed: true): Promise<void> { await this.ready(); if (!ownerConfirmed) throw new SharedFolderError('POLICY_DENIED', 'Revocation requires explicit owner confirmation'); const folder = this.requireFolder(folderId); if (folder.ownerIdentityId !== this.localIdentityId) throw new SharedFolderError('NOT_AUTHORIZED', 'Only the owner may revoke a member'); const keys = [`${folderId}:IDENTITY:${subjectId}`, `${folderId}:SPACE:${subjectId}`]; const existing = keys.map(key => this.state.memberships.get(key)).find(value => value?.state === 'ACTIVE'); if (!existing) throw new SharedFolderError('NOT_FOUND', 'Active folder member not found'); const now = iso(this.now()); const next: FolderMembership = { ...existing, state: 'REVOKED', revokedAt: now, epoch: folder.epoch + 1 }; this.state.memberships.set(membershipKey(next), next); this.state.folders.set(folder.id, { ...folder, epoch: folder.epoch + 1, revision: folder.revision + 1, updatedAt: now }); await this.persist(); this.emit(); }
  listMembers(folderId: FolderId): readonly FolderMembership[] { return [...this.state.memberships.values()].filter(value => value.folderId === folderId).sort((a, b) => a.subjectId.localeCompare(b.subjectId)).map(clone); }
  async shareWithSpace(folderId: FolderId, spaceId: string, role: Exclude<FolderRole, 'OWNER' | 'UPLOAD_ONLY'>): Promise<FolderMembership> { const invitation = await this.invite(folderId, { spaceId, role }); const member: FolderMembership = { version: 1, folderId, subjectType: 'SPACE', subjectId: spaceId, role, state: 'ACTIVE', epoch: invitation.epoch, invitedBy: this.localIdentityId, invitedAt: invitation.createdAt, acceptedAt: invitation.createdAt }; this.state.memberships.set(membershipKey(member), member); this.state.invitations.set(invitation.id, { ...invitation, state: 'ACCEPTED' }); await this.persist(); return clone(member); }

  async createDropZone(input: { readonly parentFolderId?: FolderId; readonly name: string; readonly allowedIdentityIds?: readonly NodeId[]; readonly allowedSpaceIds?: readonly string[]; readonly maxUploadBytes?: number; readonly maxUploads?: number }): Promise<DropZone> { await this.ready(); const folder = await this.createFolder({ name: input.name, parentFolderId: input.parentFolderId, scope: 'DROP_ZONE', internalDropZone: true }); const zone: DropZone = { version: 1, id: id('drop-zone') as DropZoneId, folderId: folder.id, ownerIdentityId: this.localIdentityId, createdAt: iso(this.now()), policy: { ...(input.allowedIdentityIds ? { allowedIdentityIds: [...new Set(input.allowedIdentityIds)].slice(0, 100) } : {}), ...(input.allowedSpaceIds ? { allowedSpaceIds: [...new Set(input.allowedSpaceIds)].slice(0, 100) } : {}), maxUploadBytes: clampInt(input.maxUploadBytes, 1, SHARED_FOLDER_MAX_FILE_BYTES, 256 * 1024 * 1024), maxUploads: clampInt(input.maxUploads, 1, SHARED_FOLDER_MAX_UPLOADS, SHARED_FOLDER_MAX_UPLOADS) }, revokedIdentityIds: [] }; this.state.dropZones.set(zone.id, zone); await this.persist(); this.emit(); return clone(zone); }
  async uploadToDropZone(zoneId: DropZoneId, input: { readonly uploaderIdentityId: NodeId; readonly name: string; readonly bytes: Uint8Array; readonly mimeType: string }): Promise<DropZoneReceipt> { await this.ready(); const zone = this.state.dropZones.get(zoneId); if (!zone) throw new SharedFolderError('NOT_FOUND', 'Drop Zone not found'); if (!(await this.canUpload(zone, input.uploaderIdentityId))) throw new SharedFolderError('NOT_AUTHORIZED', 'Uploader is not authorized for this Drop Zone'); const previous = [...this.state.receipts.values()].filter(value => value.zoneId === zoneId && value.state !== 'REJECTED'); if (previous.length >= zone.policy.maxUploads || input.bytes.byteLength > zone.policy.maxUploadBytes) throw new SharedFolderError('RESOURCE_LIMIT', 'Drop Zone upload bound exceeded'); const projection = await this.createFile({ folderId: zone.folderId, name: input.name, bytes: input.bytes, mimeType: input.mimeType }); const receipt: DropZoneReceipt = { version: 1, id: id('drop-receipt'), zoneId, uploaderIdentityId: input.uploaderIdentityId, state: 'VERIFIED', fileId: projection.file.id, receivedAt: iso(this.now()) }; this.state.receipts.set(receipt.id, receipt); await this.persist(); this.emit(); return { ...clone(receipt), fileId: undefined }; }
  async listDropZone(zoneId: DropZoneId): Promise<readonly FolderFileProjection[]> { await this.ready(); const zone = this.state.dropZones.get(zoneId); if (!zone) throw new SharedFolderError('NOT_FOUND', 'Drop Zone not found'); if (zone.ownerIdentityId !== this.localIdentityId) throw new SharedFolderError('NOT_AUTHORIZED', 'Only the Drop Zone owner may enumerate received files'); return (await this.listFiles(zone.folderId, { limit: SHARED_FOLDER_MAX_PAGE })).items; }
  async revokeDropUploader(zoneId: DropZoneId, identityId: NodeId, ownerConfirmed: true): Promise<void> { await this.ready(); const zone = this.state.dropZones.get(zoneId); if (!zone || zone.ownerIdentityId !== this.localIdentityId || !ownerConfirmed) throw new SharedFolderError('NOT_AUTHORIZED', 'Drop Zone revocation requires the owner'); this.state.dropZones.set(zoneId, { ...zone, revokedIdentityIds: [...new Set([...zone.revokedIdentityIds, identityId])] }); await this.persist(); this.emit(); }

  async search(query: string, options: { readonly limit?: number; readonly folderId?: FolderId } = {}): Promise<readonly FolderSearchResult[]> { await this.ready(); const terms = normalizeQuery(query); if (!terms.length) return []; const limit = clampInt(options.limit, 1, SHARED_FOLDER_MAX_PAGE, 64); const results: FolderSearchResult[] = []; for (const entry of this.state.entries.values()) { if (entry.state !== 'ACTIVE' || options.folderId && entry.parentFolderId !== options.folderId) continue; const folder = this.state.folders.get(entry.parentFolderId); if (!folder || folder.deletedAt || !(await this.can(folder, this.localIdentityId, 'READ'))) continue; const haystack = entry.name.toLocaleLowerCase(); const matched = terms.filter(term => haystack.includes(term)); if (!matched.length) continue; results.push({ entry: clone(entry), folder: clone(folder), score: matched.length / terms.length, matchedFields: ['name'] }); } return results.sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name) || a.entry.id.localeCompare(b.entry.id)).slice(0, limit).map(clone); }

  async setPlacement(input: { readonly folderId: FolderId; readonly fileId?: FolderFileId; readonly intent: FolderPlacementState['intent']; readonly selectedDeviceIds?: readonly NodeId[]; readonly includeContent?: boolean }): Promise<FolderPlacementState> { await this.ready(); const folder = this.requireFolder(input.folderId); await this.assertPermission(folder, 'READ'); const key = placementKey(input.folderId, input.fileId); const state: FolderPlacementState = { folderId: input.folderId, ...(input.fileId ? { fileId: input.fileId } : {}), intent: input.intent, ...(input.selectedDeviceIds ? { selectedDeviceIds: [...new Set(input.selectedDeviceIds)].slice(0, 50) } : {}), includeContent: input.includeContent ?? (input.intent !== 'METADATA_ONLY' && input.intent !== 'ON_DEMAND'), updatedAt: iso(this.now()) }; this.state.placements.set(key, state); const file = input.fileId ? this.requireFile(input.fileId) : undefined; if (this.placement) await this.placement.place({ objectId: input.fileId ?? input.folderId, objectType: input.fileId ? 'folder_file' : 'folder', objectVersion: file?.currentRevisionId ?? String(folder.revision), ...(file ? { contentHash: this.requireRevision(file.currentRevisionId).contentId } : {}), sizeBytes: file ? this.requireRevision(file.currentRevisionId).size : 0, policy: { intent: input.intent, ...(input.selectedDeviceIds ? { selectedDeviceIds: input.selectedDeviceIds } : {}), includeContent: state.includeContent } }); await this.persist(); this.emit(); return clone(state); }
  placementState(folderId: FolderId, fileId?: FolderFileId): FolderPlacementState | undefined { const value = this.state.placements.get(placementKey(folderId, fileId)); return value ? clone(value) : undefined; }

  async readFile(fileId: FolderFileId, options: { readonly actorIdentityId?: NodeId; readonly signal?: AbortSignal; readonly priority?: ContentTransferPriority; readonly onProgress?: (progress: FolderTransferProgress) => void } = {}): Promise<Uint8Array> { await this.ready(); const projection = await this.describeFile(fileId, options.actorIdentityId ?? this.localIdentityId); const local = await this.content.read(projection.revision.contentId); if (local) return local; const authorization = await this.contentAuthorization(projection.entry.parentFolderId, options.actorIdentityId ?? this.localIdentityId); if (!authorization || !this.contentDelivery) throw new SharedFolderError('UNAVAILABLE', 'Original content is not available on this device or an authorized source'); const start: FolderTransferProgress = { fileId, state: 'QUEUED', completedBytes: 0, totalBytes: projection.revision.size, completedChunks: 0, totalChunks: projection.revision.manifest.chunks.length, sourceIds: [] }; this.transfer.set(fileId, start); options.onProgress?.(start); try { const bytes = await this.contentDelivery.acquire({ manifest: projection.revision.manifest, authorization, priority: options.priority ?? 'INTERACTIVE', signal: options.signal, onProgress: progress => { const next = { ...progress, fileId }; this.transfer.set(fileId, next); options.onProgress?.(next); } }); if (bytes) { const imported = await this.content.import(bytes, { mimeType: projection.revision.mimeType, name: projection.entry.name, contentPolicy: projection.entry.parentFolderId ? 'AUTHORIZED_GROUP' : 'PRIVATE_NO_STRANGER_CACHE' }); if (imported.contentId !== projection.revision.contentId) throw new SharedFolderError('INTEGRITY', 'Downloaded content hash does not match the authorized revision'); } const final = await this.content.read(projection.revision.contentId); if (!final) throw new SharedFolderError('INTEGRITY', 'Content transfer did not produce a complete local object'); const done: FolderTransferProgress = { fileId, state: 'COMPLETE', completedBytes: final.byteLength, totalBytes: projection.revision.size, completedChunks: projection.revision.manifest.chunks.length, totalChunks: projection.revision.manifest.chunks.length, sourceIds: [] }; this.transfer.set(fileId, done); options.onProgress?.(done); return final; } catch (error) { const failed: FolderTransferProgress = { ...start, state: 'FAILED' }; this.transfer.set(fileId, failed); options.onProgress?.(failed); throw error; } }
  transferState(fileId: FolderFileId): FolderTransferProgress | undefined { const value = this.transfer.get(fileId); return value ? clone(value) : undefined; }

  exportChanges(cursor?: string): FolderListResult<FolderChange> { const values = [...this.state.changes.values()].sort(compareChanges); const page = paginate(values, { cursor, limit: SHARED_FOLDER_MAX_PAGE }); return { items: page.items.map(clone), ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}), total: values.length }; }
  async applyChange(change: FolderChange): Promise<void> { await this.ready(); if (this.state.changes.has(change.id)) return; this.validateChange(change); if (this.signer && change.signature && !(await this.signer.verify(stripSignature(change), change.signature, change.actorIdentityId))) throw new SharedFolderError('INTEGRITY', 'Folder change signature rejected'); if (this.requireSignedChanges && change.actorIdentityId !== this.localIdentityId && !change.signature) throw new SharedFolderError('INTEGRITY', 'Unsigned remote folder change rejected'); const target = this.state.folders.get(change.folderId); if (change.kind !== 'CREATE_FOLDER' && !target) throw new SharedFolderError('NOT_FOUND', 'Folder change references an unknown folder'); const permission: FolderPermission = change.kind === 'CREATE_FOLDER' || change.kind === 'CREATE_FILE' ? 'CREATE' : change.kind === 'RENAME' ? 'RENAME' : change.kind === 'MOVE' ? 'MOVE' : change.kind === 'DELETE' ? 'DELETE' : 'EDIT'; const rootCreate = change.kind === 'CREATE_FOLDER' && change.folderId === change.objectId; if (target && change.kind !== 'MEMBERSHIP' && !(await this.can(target, change.actorIdentityId, permission))) throw new SharedFolderError('NOT_AUTHORIZED', 'Folder change actor is not authorized'); if (target && change.kind !== 'MEMBERSHIP' && !rootCreate && !(await this.can(target, this.localIdentityId, 'READ'))) throw new SharedFolderError('NOT_AUTHORIZED', 'Receiving identity is not a folder member'); if (target && change.kind !== 'MEMBERSHIP' && !rootCreate && change.epoch !== target.epoch) throw new SharedFolderError('STALE_EPOCH', 'Folder change epoch is stale'); switch (change.kind) { case 'CREATE_FOLDER': this.applyCreateFolder(change); break; case 'CREATE_FILE': this.applyCreateFile(change); break; case 'UPDATE_CONTENT': await this.applyUpdateContent(change); break; case 'RENAME': this.applyRename(change); break; case 'MOVE': await this.applyMove(change); break; case 'DELETE': await this.applyDelete(change); break; case 'RESTORE': this.applyRestore(change); break; case 'MEMBERSHIP': this.applyMembership(change); break; default: throw new SharedFolderError('INVALID_ARGUMENT', 'Unknown folder change kind'); } this.state.changes.set(change.id, clone(change)); this.trim(); await this.persist(); this.emit(); }

  async importExternalFile(folderId: FolderId, relativePath: string, bytes: Uint8Array, mimeType: string, options: { readonly allowUpdate?: boolean; readonly baseRevisionId?: FileRevisionId } = {}): Promise<FolderFileProjection> { const safe = validateRelativePath(relativePath); const segments = safe.split('/'); const name = segments.pop()!; let parent = this.requireFolder(folderId); for (const segment of segments) { const child = [...this.state.entries.values()].find(entry => entry.parentFolderId === parent.id && entry.kind === 'FOLDER' && entry.state === 'ACTIVE' && entry.name === segment); if (child?.kind === 'FOLDER') parent = this.requireFolder(child.folderId); else parent = await this.createFolder({ name: segment, parentFolderId: parent.id }); } const existing = [...this.state.entries.values()].find(entry => entry.parentFolderId === parent.id && entry.name === name && entry.kind === 'FILE' && entry.state === 'ACTIVE'); if (existing?.kind === 'FILE') { const hash = `sha256-${await sha256(bytes)}` as ContentId; const current = this.requireRevision(this.requireFile(existing.fileId).currentRevisionId); if (current.contentId === hash) return this.describeFile(existing.fileId); if (options.allowUpdate) return this.updateFile(existing.fileId, bytes, { mimeType, baseRevisionId: options.baseRevisionId ?? current.id }); this.recordConflict({ folderId: parent.id, fileId: existing.fileId, entryId: existing.id, kind: 'FILESYSTEM', details: 'Initial filesystem binding found different local and Keystone bytes' }); return this.describeFile(existing.fileId); } return this.createFile({ folderId: parent.id, name, bytes, mimeType }); }
  async materializeFile(fileId: FolderFileId, binding: FolderFilesystemBinding, baseline?: { readonly contentId?: ContentId; readonly revisionId?: FileRevisionId }): Promise<'WRITTEN' | 'UNCHANGED' | 'CONFLICT'> { const projection = await this.describeFile(fileId); const path = this.relativePathOf(projection.entry); const existing = await binding.read(path).catch(() => undefined); const existingHash = existing ? (`sha256-${await sha256(existing)}` as ContentId) : undefined; if (existingHash === projection.revision.contentId) return 'UNCHANGED'; if (existing && (!baseline?.contentId || existingHash !== baseline.contentId)) { this.recordConflict({ folderId: projection.entry.parentFolderId, fileId, kind: 'FILESYSTEM', details: `Local file changed while revision ${projection.revision.id} was materializing` }); return 'CONFLICT'; } const bytes = await this.readFile(fileId, { priority: 'INTERACTIVE' }); await binding.mkdir(parentPath(path)); await binding.writeAtomic(path, bytes); return 'WRITTEN'; }
  relativePathOf(entry: FolderEntry): string { const parts = [entry.name]; let folderId = entry.parentFolderId; let depth = 0; while (depth++ < SHARED_FOLDER_MAX_DEPTH) { const folder = this.requireFolder(folderId); if (!folder.parentFolderId) break; const parentEntry = [...this.state.entries.values()].find(value => value.kind === 'FOLDER' && value.folderId === folder.id && value.parentFolderId === folder.parentFolderId && value.state === 'ACTIVE'); parts.unshift(folder.name); folderId = folder.parentFolderId; if (!parentEntry && depth > 1) break; } return parts.join('/'); }

  private makeChange(folderId: FolderId, objectId: string, kind: FolderChangeKind, payload: unknown, epoch: number, baseRevisionId?: FileRevisionId): FolderChange { const unsigned: Omit<FolderChange, 'signature'> = { version: 1, protocol: SHARED_FOLDERS_PROTOCOL, id: id('change') as FolderChangeId, folderId, objectId, kind, actorIdentityId: this.localIdentityId, ...(this.localDeviceId ? { actorDeviceId: this.localDeviceId } : {}), epoch, ...(baseRevisionId ? { baseRevisionId } : {}), createdAt: iso(this.now()), payload }; return unsigned as FolderChange; }
  private async commit(change: FolderChange): Promise<void> { const signed = this.signer ? { ...change, signature: await this.signer.sign(stripSignature(change)) } : change; await this.applyChange(signed); }
  private applyCreateFolder(change: FolderChange): void {
    const payload = change.payload as { folder?: KeystoneFolder; entry?: FolderEntry };
    const folder = payload.folder;
    if (!folder || folder.id !== change.objectId || !validFolder(folder)) throw new SharedFolderError('INVALID_ARGUMENT', 'Malformed folder creation');
    if (this.state.tombstones.has(folder.id)) throw new SharedFolderError('CONFLICT', 'Deleted folder cannot be resurrected by stale create');
    const existing = this.state.folders.get(folder.id);
    if (existing) {
      if (existing.ownerIdentityId !== folder.ownerIdentityId || existing.parentFolderId !== folder.parentFolderId || portableNameKey(existing.name) !== portableNameKey(folder.name)) throw new SharedFolderError('CONFLICT', 'Folder identity already exists with different metadata');
      if (!folder.parentFolderId) {
        const ownerMembership: FolderMembership = { version: 1, folderId: folder.id, subjectType: 'IDENTITY', subjectId: folder.ownerIdentityId, role: 'OWNER', state: 'ACTIVE', epoch: Math.max(existing.epoch, folder.epoch), invitedBy: folder.ownerIdentityId, invitedAt: folder.createdAt };
        this.state.memberships.set(membershipKey(ownerMembership), ownerMembership);
      } else if (payload.entry && !this.state.entries.has(payload.entry.id)) {
        this.state.entries.set(payload.entry.id, clone(payload.entry));
      }
      return;
    }
    if (folder.parentFolderId) {
      const parent = this.requireFolder(folder.parentFolderId);
      this.assertNameAvailable(parent.id, folder.name);
    }
    this.state.folders.set(folder.id, clone(folder));
    if (!folder.parentFolderId) {
      const ownerMembership: FolderMembership = { version: 1, folderId: folder.id, subjectType: 'IDENTITY', subjectId: folder.ownerIdentityId, role: 'OWNER', state: 'ACTIVE', epoch: folder.epoch, invitedBy: folder.ownerIdentityId, invitedAt: folder.createdAt };
      this.state.memberships.set(membershipKey(ownerMembership), ownerMembership);
    }
    if (folder.parentFolderId) {
      const entry = payload.entry;
      if (!entry || entry.kind !== 'FOLDER' || entry.folderId !== folder.id || entry.parentFolderId !== folder.parentFolderId) throw new SharedFolderError('INVALID_ARGUMENT', 'Folder entry descriptor is missing');
      this.state.entries.set(entry.id, clone(entry));
    }
  }
  private applyCreateFile(change: FolderChange): void { const payload = change.payload as { file?: FolderFile; revision?: FileRevision; entry?: FolderEntry }; if (!payload.file || !payload.revision || !payload.entry || payload.entry.kind !== 'FILE' || payload.entry.fileId !== payload.file.id || payload.revision.fileId !== payload.file.id || !validFile(payload.file) || !validRevision(payload.revision)) throw new SharedFolderError('INVALID_ARGUMENT', 'Malformed file creation'); const parent = this.requireFolder(payload.entry.parentFolderId); this.assertNameAvailable(parent.id, payload.entry.name); if (this.state.files.has(payload.file.id) || this.state.tombstones.has(payload.file.id)) throw new SharedFolderError('CONFLICT', 'File identity already exists or was deleted'); this.state.revisions.set(payload.revision.id, clone(payload.revision)); this.state.files.set(payload.file.id, clone(payload.file)); this.state.entries.set(payload.entry.id, clone(payload.entry)); }
  private async applyUpdateContent(change: FolderChange): Promise<void> { const payload = change.payload as { fileId?: FolderFileId; revision?: FileRevision }; if (!payload.fileId || !payload.revision || payload.revision.fileId !== payload.fileId || !validRevision(payload.revision)) throw new SharedFolderError('INVALID_ARGUMENT', 'Malformed file revision'); const file = this.requireFile(payload.fileId); const entry = this.findFileEntry(payload.fileId); if (!entry) throw new SharedFolderError('NOT_FOUND', 'File entry not found'); if (this.state.tombstones.has(payload.fileId) || entry.state === 'TRASHED') { this.recordConflict({ folderId: entry.parentFolderId, fileId: payload.fileId, kind: 'DELETE_EDIT', revisionIds: [file.currentRevisionId, payload.revision.id], details: 'File was deleted while another valid revision was edited' }); this.state.revisions.set(payload.revision.id, clone(payload.revision)); if (!file.revisionIds.includes(payload.revision.id)) this.state.files.set(file.id, { ...file, revisionIds: [...file.revisionIds, payload.revision.id], updatedAt: payload.revision.createdAt }); return; } this.state.revisions.set(payload.revision.id, clone(payload.revision)); const current = this.requireRevision(file.currentRevisionId); const base = change.baseRevisionId ?? payload.revision.parents[0]; const nextRevisions = file.revisionIds.includes(payload.revision.id) ? file.revisionIds : [...file.revisionIds, payload.revision.id]; if (base && base !== current.id) { const conflict = this.recordConflict({ folderId: entry.parentFolderId, fileId: file.id, kind: 'CONTENT', revisionIds: [current.id, payload.revision.id], details: 'Concurrent file revisions were retained; no last-arrival overwrite was applied' }); void conflict; this.state.files.set(file.id, { ...file, revisionIds: nextRevisions, updatedAt: payload.revision.createdAt }); return; } this.state.files.set(file.id, { ...file, currentRevisionId: payload.revision.id, revisionIds: nextRevisions.slice(-SHARED_FOLDER_MAX_REVISIONS), updatedAt: payload.revision.createdAt }); }
  private applyRename(change: FolderChange): void { const payload = change.payload as { entryId?: FolderEntryId; name?: string; baseEntryRevision?: number }; if (!payload.entryId || !payload.name || !validName(payload.name)) throw new SharedFolderError('INVALID_ARGUMENT', 'Malformed rename'); const entry = this.requireEntry(payload.entryId); if (payload.baseEntryRevision !== undefined && payload.baseEntryRevision !== entry.revision) { this.recordConflict({ folderId: entry.parentFolderId, entryId: entry.id, kind: 'RENAME', details: 'Concurrent renames require review' }); return; } const name = this.uniqueName(entry.parentFolderId, payload.name, entry.id); this.state.entries.set(entry.id, { ...entry, name, revision: entry.revision + 1, updatedAt: iso(this.now()) }); }
  private async applyMove(change: FolderChange): Promise<void> { const payload = change.payload as { entryId?: FolderEntryId; destinationFolderId?: FolderId; baseEntryRevision?: number }; if (!payload.entryId || !payload.destinationFolderId) throw new SharedFolderError('INVALID_ARGUMENT', 'Malformed move'); const entry = this.requireEntry(payload.entryId); const destination = this.requireFolder(payload.destinationFolderId); if (payload.baseEntryRevision !== undefined && payload.baseEntryRevision !== entry.revision) { this.recordConflict({ folderId: entry.parentFolderId, entryId: entry.id, kind: 'MOVE', details: 'Concurrent moves require review' }); return; } if (entry.kind === 'FOLDER' && (entry.folderId === destination.id || await this.isDescendant(destination.id, entry.folderId))) throw new SharedFolderError('INVALID_ARGUMENT', 'Directory cycle rejected'); const name = this.uniqueName(destination.id, entry.name, entry.id); this.state.entries.set(entry.id, { ...entry, parentFolderId: destination.id, name, revision: entry.revision + 1, updatedAt: iso(this.now()) }); }
  private async applyDelete(change: FolderChange): Promise<void> { const payload = change.payload as { entryId?: FolderEntryId; baseRevisionId?: FileRevisionId }; if (!payload.entryId) throw new SharedFolderError('INVALID_ARGUMENT', 'Malformed deletion'); const entry = this.requireEntry(payload.entryId); if (entry.kind === 'FILE' && payload.baseRevisionId && payload.baseRevisionId !== this.requireFile(entry.fileId).currentRevisionId) { this.recordConflict({ folderId: entry.parentFolderId, fileId: entry.fileId, entryId: entry.id, kind: 'DELETE_EDIT', revisionIds: [this.requireFile(entry.fileId).currentRevisionId, payload.baseRevisionId], details: 'Delete raced with a valid edit' }); return; } const deletedAt = iso(this.now()); this.markDeleted(entry, deletedAt); }
  private applyRestore(change: FolderChange): void { const payload = change.payload as { entryId?: FolderEntryId }; if (!payload.entryId) throw new SharedFolderError('INVALID_ARGUMENT', 'Malformed restore'); const entry = this.requireEntry(payload.entryId, true); const parent = this.requireFolder(entry.parentFolderId, true); this.assertNameAvailable(parent.id, entry.name, entry.id); this.state.entries.set(entry.id, { ...entry, state: 'ACTIVE', deletedAt: undefined, revision: entry.revision + 1, updatedAt: iso(this.now()) }); if (entry.kind === 'FILE') { const file = this.requireFile(entry.fileId); this.state.files.set(file.id, { ...file, deletedAt: undefined, updatedAt: iso(this.now()) }); } }
  private applyMembership(change: FolderChange): void { const payload = change.payload as { membership?: FolderMembership; folder?: KeystoneFolder }; if (!payload.membership || !validMembership(payload.membership)) throw new SharedFolderError('INVALID_ARGUMENT', 'Malformed membership change'); const folder = this.requireFolder(change.folderId); if (folder.ownerIdentityId !== change.actorIdentityId) throw new SharedFolderError('NOT_AUTHORIZED', 'Only the folder owner may change membership'); this.state.memberships.set(membershipKey(payload.membership), clone(payload.membership)); this.state.folders.set(folder.id, { ...folder, epoch: Math.max(folder.epoch, payload.membership.epoch), revision: folder.revision + 1, updatedAt: iso(this.now()) }); }
  private markDeleted(entry: FolderEntry, deletedAt: string): void { this.state.entries.set(entry.id, { ...entry, state: 'TRASHED', deletedAt, revision: entry.revision + 1, updatedAt: deletedAt }); this.state.tombstones.set(entry.id, { kind: 'ENTRY', revision: entry.revision + 1, deletedAt }); if (entry.kind === 'FILE') { const file = this.requireFile(entry.fileId); this.state.files.set(file.id, { ...file, deletedAt, updatedAt: deletedAt }); this.state.tombstones.set(file.id, { kind: 'FILE', revision: file.revisionIds.length, deletedAt }); } else { for (const child of [...this.state.entries.values()].filter(value => value.parentFolderId === entry.folderId && value.state === 'ACTIVE')) this.markDeleted(child, deletedAt); const folder = this.requireFolder(entry.folderId); this.state.folders.set(folder.id, { ...folder, deletedAt, updatedAt: deletedAt, revision: folder.revision + 1 }); } }
  private recordConflict(input: { readonly folderId: FolderId; readonly fileId?: FolderFileId; readonly entryId?: FolderEntryId; readonly kind: FolderConflictKind; readonly revisionIds?: readonly FileRevisionId[]; readonly details: string }): FolderConflict { const conflict: FolderConflict = { version: 1, id: id('conflict'), folderId: input.folderId, ...(input.fileId ? { fileId: input.fileId } : {}), ...(input.entryId ? { entryId: input.entryId } : {}), kind: input.kind, state: 'OPEN', ...(input.revisionIds ? { revisionIds: input.revisionIds.slice(0, 4) } : {}), details: input.details.slice(0, 2_000), createdAt: iso(this.now()) }; this.state.conflicts.set(conflict.id, conflict); while (this.state.conflicts.size > SHARED_FOLDER_MAX_CONFLICTS) this.state.conflicts.delete(this.state.conflicts.keys().next().value as string); return conflict; }

  private async availability(revision: FileRevision): Promise<FolderFileAvailability> { const manifest = await Promise.resolve(this.content.manifest(revision.contentId)); if (!manifest) return 'METADATA_ONLY'; const bytes = await this.content.read(revision.contentId); if (bytes) return 'AVAILABLE'; return 'PARTIAL'; }
  private async contentAuthorization(folderId: FolderId, actor: NodeId): Promise<ContentAuthorization | undefined> { const folder = this.requireFolder(folderId); if (!(await this.can(folder, actor, 'READ'))) return undefined; return { scope: actor === folder.ownerIdentityId ? 'OWNER' : 'AUTHORIZED_GROUP', grant: `${folder.id}:epoch:${folder.epoch}`, subjectId: actor }; }
  private async can(folder: KeystoneFolder, actor: NodeId, permission: FolderPermission): Promise<boolean> { if (folder.deletedAt) return false; if (actor === folder.ownerIdentityId) return true; const direct = this.state.memberships.get(`${folder.id}:IDENTITY:${actor}`); if (direct?.state === 'ACTIVE' && direct.epoch <= folder.epoch && roleAllows(direct.role, permission)) return true; for (const member of this.state.memberships.values()) if (member.folderId === folder.id && member.subjectType === 'SPACE' && member.state === 'ACTIVE' && member.epoch <= folder.epoch && roleAllows(member.role, permission) && this.spaceAccess && await this.spaceAccess.isMember(member.subjectId, actor)) return true; return false; }
  private async assertPermission(folder: KeystoneFolder, permission: FolderPermission, actor = this.localIdentityId): Promise<void> { if (!(await this.can(folder, actor, permission))) throw new SharedFolderError('NOT_AUTHORIZED', `Folder permission ${permission} is required`); }
  private async isDescendant(candidateParentId: FolderId, folderId: FolderId): Promise<boolean> { let current: FolderId | undefined = candidateParentId; for (let depth = 0; current && depth++ < SHARED_FOLDER_MAX_DEPTH;) { if (current === folderId) return true; current = this.requireFolder(current, true).parentFolderId; } return false; }
  private assertNameAvailable(parentFolderId: FolderId, name: string, excludeEntryId?: FolderEntryId): void { if ([...this.state.entries.values()].some(value => value.parentFolderId === parentFolderId && value.state === 'ACTIVE' && value.id !== excludeEntryId && portableNameKey(value.name) === portableNameKey(name))) throw new SharedFolderError('CONFLICT', 'An entry with the same portable name already exists'); }
  private assertBoundaryName(parentFolderId: FolderId, name: string, excludeEntryId?: FolderEntryId): void { if (this.state.folders.get(parentFolderId)?.scope !== 'PRIVATE') return; try { this.assertNameAvailable(parentFolderId, name, excludeEntryId); } catch (error) { if (error instanceof SharedFolderError) throw error; throw error; } }
  private uniqueName(parentFolderId: FolderId, requested: string, excludeEntryId?: FolderEntryId): string { try { this.assertNameAvailable(parentFolderId, requested, excludeEntryId); return requested; } catch { const base = requested.slice(0, Math.max(1, SHARED_FOLDER_MAX_NAME - 22)); let index = 1; let value = `${base} (conflict ${index})`; while (index < 10_000) { try { this.assertNameAvailable(parentFolderId, value, excludeEntryId); return value; } catch { index++; value = `${base} (conflict ${index})`; } } throw new SharedFolderError('RESOURCE_LIMIT', 'Unable to allocate a safe collision name'); } }
  private requireFolder(idValue: FolderId, includeTrash = false): KeystoneFolder { const value = this.state.folders.get(idValue); if (!value || !includeTrash && value.deletedAt) throw new SharedFolderError('NOT_FOUND', 'Folder not found'); return value; }
  private requireEntry(idValue: FolderEntryId, includeTrash = false): FolderEntry { const value = this.state.entries.get(idValue); if (!value || !includeTrash && value.state !== 'ACTIVE') throw new SharedFolderError('NOT_FOUND', 'Folder entry not found'); return value; }
  private requireFile(idValue: FolderFileId): FolderFile { const value = this.state.files.get(idValue); if (!value) throw new SharedFolderError('NOT_FOUND', 'File not found'); return value; }
  private requireRevision(idValue: FileRevisionId): FileRevision { const value = this.state.revisions.get(idValue); if (!value) throw new SharedFolderError('NOT_FOUND', 'File revision not found'); return value; }
  private findFileEntry(fileId: FolderFileId): (FolderEntry & { readonly kind: 'FILE'; readonly fileId: FolderFileId }) | undefined { const value = [...this.state.entries.values()].find(entry => entry.kind === 'FILE' && entry.fileId === fileId); return value?.kind === 'FILE' ? value : undefined; }
  private relativePathOfFile(fileId: FolderFileId): string { const entry = this.findFileEntry(fileId); if (!entry) throw new SharedFolderError('NOT_FOUND', 'File entry not found'); return this.relativePathOf(entry); }
  listPendingInvitations(): readonly FolderInvitation[] { return [...this.state.invitations.values()].filter(value => value.state === 'PENDING' && value.recipientIdentityId === this.localIdentityId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(clone); }
  getInvitation(idValue: FolderInvitationId): FolderInvitation | undefined { const value = this.state.invitations.get(idValue); return value ? clone(value) : undefined; }
  private async canUpload(zone: DropZone, identityId: NodeId): Promise<boolean> { if (zone.revokedIdentityIds.includes(identityId)) return false; if (zone.policy.allowedIdentityIds?.includes(identityId)) return true; if (zone.policy.allowedSpaceIds && this.spaceAccess) for (const spaceId of zone.policy.allowedSpaceIds) if (await this.spaceAccess.isMember(spaceId, identityId)) return true; return zone.policy.allowedIdentityIds === undefined && zone.policy.allowedSpaceIds === undefined && identityId === this.localIdentityId; }
  private validateInvitation(invitation: FolderInvitation): void { if (invitation.version !== 1 || !invitation.id || !invitation.folderId || !invitation.inviterIdentityId || !validFolderDescriptor(invitation.folder)) throw new SharedFolderError('INVALID_ARGUMENT', 'Invitation is malformed'); }
  private validateChange(change: FolderChange): void { if (change.version !== 1 || change.protocol !== SHARED_FOLDERS_PROTOCOL || !change.id || !change.folderId || !change.objectId || !change.actorIdentityId || !Number.isSafeInteger(change.epoch) || change.epoch < 1 || !Number.isFinite(Date.parse(change.createdAt))) throw new SharedFolderError('INVALID_ARGUMENT', 'Folder change is malformed'); }
  private trim(): void { while (this.state.changes.size > this.maxJournalEntries) this.state.changes.delete(this.state.changes.keys().next().value as FolderChangeId); while (this.state.invitations.size > SHARED_FOLDER_MAX_INVITATIONS) this.state.invitations.delete(this.state.invitations.keys().next().value as FolderInvitationId); while (this.state.receipts.size > SHARED_FOLDER_MAX_UPLOADS) this.state.receipts.delete(this.state.receipts.keys().next().value as string); }
  private snapshot(): FolderStateSnapshot { return { version: 1, protocol: SHARED_FOLDERS_PROTOCOL, folders: [...this.state.folders.values()].map(clone), entries: [...this.state.entries.values()].map(clone), files: [...this.state.files.values()].map(clone), revisions: [...this.state.revisions.values()].map(clone), memberships: [...this.state.memberships.values()].map(clone), invitations: [...this.state.invitations.values()].map(clone), changes: [...this.state.changes.values()].map(clone), conflicts: [...this.state.conflicts.values()].map(clone), dropZones: [...this.state.dropZones.values()].map(clone), receipts: [...this.state.receipts.values()].map(clone), placements: [...this.state.placements.values()].map(clone) }; }
  private async persist(): Promise<void> { const operation = this.writes.then(() => this.stateStore.write(this.snapshot())); this.writes = operation.catch(() => undefined); await operation; }
  private async hydrate(): Promise<void> { const raw = await this.stateStore.read(); if (!raw) return; const snapshot = parseSnapshot(raw); for (const value of snapshot.folders) this.state.folders.set(value.id, value); for (const value of snapshot.entries) this.state.entries.set(value.id, value); for (const value of snapshot.files) this.state.files.set(value.id, value); for (const value of snapshot.revisions) this.state.revisions.set(value.id, value); for (const value of snapshot.memberships) this.state.memberships.set(membershipKey(value), value); for (const value of snapshot.invitations) this.state.invitations.set(value.id, value); for (const value of snapshot.changes) this.state.changes.set(value.id, value); for (const value of snapshot.conflicts) this.state.conflicts.set(value.id, value); for (const value of snapshot.dropZones) this.state.dropZones.set(value.id, value); for (const value of snapshot.receipts) this.state.receipts.set(value.id, value); for (const value of snapshot.placements) this.state.placements.set(placementKey(value.folderId, value.fileId), value); }
  private emit(): void { for (const listener of this.subscribers) listener(); }
}

export type FolderFilesystemEntryKind = 'FILE' | 'DIRECTORY' | 'SYMLINK' | 'OTHER';
export interface FolderFilesystemEntry { readonly relativePath: string; readonly kind: FolderFilesystemEntryKind; readonly size: number; readonly modifiedAt: string; }
export interface FolderFilesystemWatchEvent { readonly kind: 'CREATE' | 'UPDATE' | 'RENAME' | 'DELETE' | 'UNKNOWN'; readonly relativePath: string; }
export interface FolderFilesystemBinding {
  list(): Promise<readonly FolderFilesystemEntry[]>;
  read(relativePath: string): Promise<Uint8Array>;
  writeAtomic(relativePath: string, bytes: Uint8Array): Promise<void>;
  mkdir(relativePath: string): Promise<void>;
  remove(relativePath: string): Promise<void>;
  watch(listener: (event: FolderFilesystemWatchEvent) => void): () => void;
  close?(): void;
}

export interface FilesystemSyncStatus { readonly bindingId: FilesystemBindingId; readonly folderId: FolderId; readonly state: 'BOUND' | 'WATCHING' | 'DETACHED' | 'ERROR'; readonly pendingEvents: number; readonly imported: number; readonly materialized: number; readonly conflicts: number; readonly lastError?: string; }

/** Event-driven, root-scoped adapter.  It never scans a developer's home by itself. */
export class FilesystemSyncAdapter {
  private readonly known = new Map<string, ContentId>();
  private readonly baseline = new Map<string, { readonly contentId: ContentId; readonly revisionId: FileRevisionId }>();
  private readonly queued = new Set<string>();
  private unsubscribe?: () => void;
  private flushTimer?: ReturnType<typeof setTimeout>;
  private closed = false;
  private stateValue: FilesystemSyncStatus;
  constructor(private readonly service: SharedFolderService, private readonly folderId: FolderId, private readonly binding: FolderFilesystemBinding, private readonly bindingId: FilesystemBindingId = id('binding') as FilesystemBindingId) { this.stateValue = { bindingId, folderId, state: 'BOUND', pendingEvents: 0, imported: 0, materialized: 0, conflicts: 0 }; }
  status(): FilesystemSyncStatus { return clone(this.stateValue); }
  async preview(): Promise<{ readonly localFiles: number; readonly localBytes: number; readonly remoteEntries: number; readonly conflicts: number }> { const local = await this.binding.list(); const remote = await this.service.listChildren(this.folderId, { limit: SHARED_FOLDER_MAX_PAGE, includeTrash: false }); return { localFiles: local.filter(value => value.kind === 'FILE').length, localBytes: local.filter(value => value.kind === 'FILE').reduce((sum, value) => sum + value.size, 0), remoteEntries: remote.total, conflicts: 0 }; }
  async importOnce(): Promise<number> { const files = (await this.binding.list()).filter(value => value.kind === 'FILE').slice(0, SHARED_FOLDER_MAX_WATCH_BATCH); let imported = 0; for (const file of files) { const safe = validateRelativePath(file.relativePath); const bytes = await this.binding.read(safe); const mimeType = mimeFromName(safe); await this.service.importExternalFile(this.folderId, safe, bytes, mimeType, { allowUpdate: false }); const hash = `sha256-${await sha256(bytes)}` as ContentId; this.known.set(safe, hash); imported++; } this.stateValue = { ...this.stateValue, imported: this.stateValue.imported + imported }; return imported; }
  async exportOnce(): Promise<number> { const files = (await this.service.listFiles(this.folderId, { limit: SHARED_FOLDER_MAX_PAGE })).items; let materialized = 0; for (const file of files) { const result = await this.service.materializeFile(file.file.id, this.binding, this.baseline.get(this.service.relativePathOf(file.entry))); const path = this.service.relativePathOf(file.entry); if (result !== 'CONFLICT') { this.baseline.set(path, { contentId: file.revision.contentId, revisionId: file.revision.id }); this.known.set(path, file.revision.contentId); materialized += Number(result === 'WRITTEN'); } else this.stateValue = { ...this.stateValue, conflicts: this.stateValue.conflicts + 1 }; } this.stateValue = { ...this.stateValue, materialized: this.stateValue.materialized + materialized }; return materialized; }
  async start(): Promise<void> { if (this.closed) throw new SharedFolderError('POLICY_DENIED', 'Filesystem binding is detached'); await this.importOnce(); this.unsubscribe = this.binding.watch(event => { if (this.closed || !event.relativePath) return; if (!this.queued.has(event.relativePath) && this.queued.size >= SHARED_FOLDER_MAX_WATCH_BATCH) { this.stateValue = { ...this.stateValue, state: 'ERROR', lastError: 'Filesystem watcher queue bound reached; run an explicit rescan/import before continuing' }; return; } this.queued.add(event.relativePath); this.stateValue = { ...this.stateValue, state: 'WATCHING', pendingEvents: this.queued.size }; if (!this.flushTimer) this.flushTimer = setTimeout(() => { this.flushTimer = undefined; void this.flush(); }, 40); }); this.stateValue = { ...this.stateValue, state: 'WATCHING' }; }
  async flush(): Promise<void> { const queued = [...this.queued].slice(0, SHARED_FOLDER_MAX_WATCH_BATCH); for (const path of queued) this.queued.delete(path); this.stateValue = { ...this.stateValue, pendingEvents: this.queued.size }; for (const rawPath of queued) { let path: string; try { path = validateRelativePath(rawPath); } catch { continue; } const localEntry = (await this.binding.list()).find(value => value.relativePath === path); const remoteFiles = (await this.service.listFiles(this.folderId, { limit: SHARED_FOLDER_MAX_PAGE })).items; const remote = remoteFiles.find(value => this.service.relativePathOf(value.entry) === path); if (!localEntry || localEntry.kind !== 'FILE') { if (remote && this.known.has(path)) { await this.service.deleteEntry(remote.entry.id, { ownerConfirmed: true }); this.known.delete(path); } continue; } const bytes = await this.binding.read(path); const hash = `sha256-${await sha256(bytes)}` as ContentId; if (this.known.get(path) === hash) continue; await this.service.importExternalFile(this.folderId, path, bytes, mimeFromName(path), { allowUpdate: true, ...(remote ? { baseRevisionId: remote.revision.id } : {}) }); this.known.set(path, hash); this.stateValue = { ...this.stateValue, imported: this.stateValue.imported + 1 }; } }
  detach(): void { this.closed = true; this.unsubscribe?.(); this.unsubscribe = undefined; if (this.flushTimer) clearTimeout(this.flushTimer); this.binding.close?.(); this.stateValue = { ...this.stateValue, state: 'DETACHED', pendingEvents: 0 }; }
}

export function createSharedFolderInboxAdapter(service: SharedFolderService): InboxProjectionAdapter<FolderInvitation | FolderConflict> {
  const list = async (_input: InboxAdapterListInput): Promise<readonly (FolderInvitation | FolderConflict)[]> => [...service.listPendingInvitations(), ...(await service.listConflicts())];
  return {
    sourceKind: 'files', trust: 'CORE', list,
    refOf: value => value.version === 1 && 'folderId' in value && 'inviterIdentityId' in value ? ({ source: 'files', id: value.id, folderId: value.folderId, recordKind: 'invitation' } as InboxSourceRef) : ({ source: 'files', id: value.id, folderId: value.folderId, recordKind: 'conflict' } as InboxSourceRef),
    project: value => { const invitation = 'inviterIdentityId' in value; const source = invitation ? { source: 'files', id: value.id, folderId: value.folderId, recordKind: 'invitation' } : { source: 'files', id: value.id, folderId: value.folderId, recordKind: 'conflict' }; return { source: source as InboxSourceRef, kind: (invitation ? 'INVITATION' : 'FILE_CONFLICT') as InboxItemKind, sourceVersion: invitation ? value.createdAt : value.createdAt, presentation: { title: invitation ? `Folder invitation: ${value.folder.name}` : `File conflict in ${service.getFolder(value.folderId)?.name ?? 'Files'}`, snippet: invitation ? `Role: ${value.role}` : value.details, sender: invitation ? value.inviterIdentityId : undefined, receivedAt: value.createdAt, updatedAt: value.createdAt, groupKey: `files:${value.folderId}`, reasons: [invitation ? 'Shared Folder invitation requires a decision' : 'Concurrent file work requires review'], priority: invitation ? 'time-sensitive' : 'completion', requiresAction: true, dataClass: 'private' as InboxDataClass }, actions: invitation ? [{ id: 'files-accept' as never, kind: 'ACCEPT_FOLDER_INVITATION' as InboxActionKind, label: 'Accept folder invitation', requiresOwnerConfirmation: true, sourceVersion: value.createdAt } as InboxActionDescriptor, { id: 'files-reject' as never, kind: 'DECLINE_INVITATION', label: 'Reject', requiresOwnerConfirmation: true, sourceVersion: value.createdAt }] : [{ id: 'files-open-conflict' as never, kind: 'OPEN_FOLDER_CONFLICT' as InboxActionKind, label: 'Review conflict', requiresOwnerConfirmation: false, sourceVersion: value.createdAt }] }; },
    resolve: async ref => ref.source === 'files' ? (ref.recordKind === 'invitation' ? service.getInvitation(ref.id as FolderInvitationId) : (await service.listConflicts()).find(value => value.id === ref.id)) : undefined,
    execute: async input => { if (input.action === 'OPEN_SOURCE' || input.action === 'OPEN_FOLDER_CONFLICT') return { status: 'OPENED' } satisfies InboxActionResult; if (input.action === 'ACCEPT_FOLDER_INVITATION') { if (!input.ownerConfirmed) throw new SharedFolderError('POLICY_DENIED', 'Accepting a folder invitation requires owner confirmation'); await service.acceptInvitation(input.item.source.id as FolderInvitationId); return { status: 'ACCEPTED' } satisfies InboxActionResult; } if (input.action === 'DECLINE_INVITATION') { if (!input.ownerConfirmed) throw new SharedFolderError('POLICY_DENIED', 'Rejecting a folder invitation requires owner confirmation'); await service.rejectInvitation(input.item.source.id as FolderInvitationId); return { status: 'DECLINED' } satisfies InboxActionResult; } throw new SharedFolderError('POLICY_DENIED', 'Unsupported Files Inbox action'); },
    subscribe: listener => service.subscribe(() => { void list({ limit: SHARED_FOLDER_MAX_PAGE }).then(values => values.forEach(value => listener({ kind: 'UPSERT', source: value } as InboxAdapterEvent<FolderInvitation | FolderConflict>))).catch(() => undefined); }),
  };
}

// Methods used by the Inbox adapter are intentionally small read projections.
export interface SharedFolderService {
  listPendingInvitations(): readonly FolderInvitation[];
  getInvitation(idValue: FolderInvitationId): FolderInvitation | undefined;
}

function roleAllows(role: FolderRole, permission: FolderPermission): boolean { if (role === 'OWNER') return true; if (role === 'VIEWER') return permission === 'READ'; if (role === 'CONTRIBUTOR') return permission === 'READ' || permission === 'CREATE' || permission === 'UPLOAD'; if (role === 'EDITOR') return permission !== 'MANAGE_MEMBERS'; return permission === 'UPLOAD'; }
function validateName(value: string): string { if (!validName(value)) throw new SharedFolderError('INVALID_ARGUMENT', 'File or folder name is invalid'); return value.normalize('NFC'); }
function validName(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= SHARED_FOLDER_MAX_NAME && !/[/\\\0\u0000\u0001-\u001f\u007f]/.test(value) && value !== '.' && value !== '..' && !/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(value) && !/^[A-Za-z]:/.test(value); }
function validateMime(value: string): string { if (typeof value !== 'string' || !value.trim() || value.length > 255 || /[\0\u0000-\u001f]/.test(value)) throw new SharedFolderError('INVALID_ARGUMENT', 'MIME type is invalid'); return value.trim().toLowerCase(); }
function validateRelativePath(value: string): string { if (typeof value !== 'string' || value.length === 0 || value.length > SHARED_FOLDER_MAX_RELATIVE_PATH || value.includes('\0') || value.startsWith('/') || value.startsWith('\\') || /^[A-Za-z]:/.test(value)) throw new SharedFolderError('PATH_UNSAFE', 'Filesystem path is outside the authorized root'); const segments = value.replaceAll('\\', '/').split('/'); if (segments.some(segment => !segment || segment === '.' || segment === '..' || !validName(segment))) throw new SharedFolderError('PATH_UNSAFE', 'Filesystem path contains an unsafe segment'); return segments.map(segment => segment.normalize('NFC')).join('/'); }
function parentPath(value: string): string { const index = value.lastIndexOf('/'); return index < 0 ? '' : value.slice(0, index); }
function mimeFromName(value: string): string { const extension = value.toLocaleLowerCase().split('.').pop(); return extension === 'txt' || extension === 'md' || extension === 'json' || extension === 'csv' ? 'text/plain' : extension === 'html' ? 'text/html' : extension === 'pdf' ? 'application/pdf' : 'application/octet-stream'; }
function portableNameKey(value: string): string { return value.normalize('NFC').toLocaleLowerCase(); }
function normalizeQuery(value: string): readonly string[] { return value.normalize('NFC').toLocaleLowerCase().split(/\s+/).filter(Boolean).slice(0, 16); }
function validFutureDate(value: string, now: () => number): boolean { const parsed = Date.parse(value); return Number.isFinite(parsed) && parsed > now() && parsed <= now() + 30 * 24 * 60 * 60_000; }
function iso(value: number): string { return new Date(value).toISOString(); }
function id(prefix: string): string { return `${prefix}:${crypto.randomUUID()}`; }
function clone<T>(value: T): T { return structuredClone(value); }
function stripSignature<T extends { readonly signature?: string }>(value: T): Omit<T, 'signature'> { const { signature: _signature, ...rest } = value; return rest; }
function membershipKey(value: Pick<FolderMembership, 'folderId' | 'subjectType' | 'subjectId'>): string { return `${value.folderId}:${value.subjectType}:${value.subjectId}`; }
function placementKey(folderId: FolderId, fileId?: FolderFileId): string { return `${folderId}:${fileId ?? ''}`; }
function compareFolders(a: KeystoneFolder, b: KeystoneFolder): number { return a.name.localeCompare(b.name) || a.id.localeCompare(b.id); }
function compareEntries(a: FolderEntry, b: FolderEntry): number { return Number(a.kind !== b.kind) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id); }
function compareChanges(a: FolderChange, b: FolderChange): number { return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id); }
function clampInt(value: number | undefined, min: number, max: number, fallback: number): number { return Number.isSafeInteger(value) ? Math.max(min, Math.min(max, value!)) : fallback; }
function paginate<T extends { readonly id: string }>(values: readonly T[], options: { readonly limit?: number; readonly cursor?: string }): { readonly items: readonly T[]; readonly nextCursor?: string } { const limit = clampInt(options.limit, 1, SHARED_FOLDER_MAX_PAGE, SHARED_FOLDER_MAX_PAGE); const start = options.cursor ? Math.max(0, values.findIndex(value => value.id === options.cursor) + 1) : 0; const items = values.slice(start, start + limit); return { items, ...(start + limit < values.length && items.length ? { nextCursor: items[items.length - 1]!.id } : {}) }; }
function validFolder(value: KeystoneFolder): boolean { return value.version === 1 && Boolean(value.id) && validName(value.name) && Boolean(value.ownerIdentityId) && ['PRIVATE', 'SHARED', 'DROP_ZONE'].includes(value.scope) && Number.isSafeInteger(value.revision) && value.revision > 0 && Number.isSafeInteger(value.epoch) && value.epoch > 0 && Number.isFinite(Date.parse(value.createdAt)) && Number.isFinite(Date.parse(value.updatedAt)); }
function validFolderDescriptor(value: FolderInvitation['folder']): boolean { return Boolean(value && value.id && validName(value.name) && value.ownerIdentityId && ['PRIVATE', 'SHARED', 'DROP_ZONE'].includes(value.scope) && Number.isSafeInteger(value.epoch)); }
function validFile(value: FolderFile): boolean { return value.version === 1 && Boolean(value.id) && Boolean(value.currentRevisionId) && Array.isArray(value.revisionIds) && value.revisionIds.includes(value.currentRevisionId) && Number.isFinite(Date.parse(value.createdAt)) && Number.isFinite(Date.parse(value.updatedAt)); }
function validRevision(value: FileRevision): boolean { return value.version === 1 && Boolean(value.id) && Boolean(value.fileId) && /^sha256-[a-f0-9]{64}$/i.test(value.contentId) && value.manifest.contentId === value.contentId && value.size === value.manifest.byteLength && value.size <= SHARED_FOLDER_MAX_FILE_BYTES && validName(value.manifest.name ?? 'x') && Number.isFinite(Date.parse(value.createdAt)) && Array.isArray(value.parents) && value.parents.length <= 4; }
function validMembership(value: FolderMembership): boolean { return value.version === 1 && Boolean(value.folderId) && ['IDENTITY', 'SPACE'].includes(value.subjectType) && Boolean(value.subjectId) && ['VIEWER', 'CONTRIBUTOR', 'EDITOR', 'OWNER', 'UPLOAD_ONLY'].includes(value.role) && ['PENDING', 'ACTIVE', 'REVOKED', 'REJECTED'].includes(value.state) && Number.isSafeInteger(value.epoch) && Boolean(value.invitedBy) && Number.isFinite(Date.parse(value.invitedAt)); }
function parseSnapshot(value: unknown): FolderStateSnapshot { if (!value || typeof value !== 'object' || (value as { version?: unknown }).version !== 1 || (value as { protocol?: unknown }).protocol !== SHARED_FOLDERS_PROTOCOL) throw new SharedFolderError('INVALID_STATE', 'Shared Folder state version is invalid'); const candidate = value as Partial<FolderStateSnapshot>; const arrays: (keyof FolderStateSnapshot)[] = ['folders', 'entries', 'files', 'revisions', 'memberships', 'invitations', 'changes', 'conflicts', 'dropZones', 'receipts', 'placements']; for (const key of arrays) if (!Array.isArray(candidate[key])) throw new SharedFolderError('INVALID_STATE', `Shared Folder state field ${key} is invalid`); const folders = (candidate.folders as readonly KeystoneFolder[]).slice(0, SHARED_FOLDER_MAX_ENTRIES).filter(validFolder); const entries = (candidate.entries as readonly FolderEntry[]).slice(0, SHARED_FOLDER_MAX_ENTRIES).filter(value => value && value.version === 1 && Boolean(value.id) && Boolean(value.parentFolderId) && validName(value.name) && (value.kind === 'FILE' && Boolean(value.fileId) || value.kind === 'FOLDER' && Boolean(value.folderId))); const files = (candidate.files as readonly FolderFile[]).slice(0, SHARED_FOLDER_MAX_ENTRIES).filter(validFile); const revisions = (candidate.revisions as readonly FileRevision[]).slice(0, SHARED_FOLDER_MAX_REVISIONS * 4_096).filter(validRevision); const memberships = (candidate.memberships as readonly FolderMembership[]).slice(0, SHARED_FOLDER_MAX_ENTRIES).filter(validMembership); return { version: 1, protocol: SHARED_FOLDERS_PROTOCOL, folders, entries, files, revisions, memberships, invitations: (candidate.invitations as readonly FolderInvitation[]).slice(0, SHARED_FOLDER_MAX_INVITATIONS), changes: (candidate.changes as readonly FolderChange[]).slice(-SHARED_FOLDER_MAX_JOURNAL), conflicts: (candidate.conflicts as readonly FolderConflict[]).slice(-SHARED_FOLDER_MAX_CONFLICTS), dropZones: (candidate.dropZones as readonly DropZone[]).slice(0, SHARED_FOLDER_MAX_ENTRIES), receipts: (candidate.receipts as readonly DropZoneReceipt[]).slice(-SHARED_FOLDER_MAX_UPLOADS), placements: (candidate.placements as readonly FolderPlacementState[]).slice(0, SHARED_FOLDER_MAX_ENTRIES) }; }
