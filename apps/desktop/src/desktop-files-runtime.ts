/** Typed desktop projection for R0P90 Files / Shared Folders.
 *
 * The shell receives bounded metadata and explicit host actions only. A
 * bootstrapper installs an adapter backed by SharedFolderService and the
 * NativeHost scoped filesystem binding; the browser/Tauri surface never gets
 * an absolute path or an ambient filesystem capability.
 */
import type {
  DropZone,
  FileRevision,
  FolderConflict,
  FolderEntry,
  FolderEntryId,
  FolderFileId,
  FolderFileProjection,
  FolderFilesystemBinding,
  FolderId,
  FolderListResult,
  FolderPlacementState,
  KeystoneFolder,
  SharedFolderService,
} from '@keystone/core';

export interface DesktopFileFolder {
  readonly id: FolderId;
  readonly name: string;
  readonly parentFolderId?: FolderId;
  readonly scope: KeystoneFolder['scope'];
  readonly ownerIdentityId: string;
  readonly revision: number;
  readonly epoch: number;
  readonly deletedAt?: string;
}

export interface DesktopFileEntry {
  readonly id: string;
  readonly parentFolderId: FolderId;
  readonly name: string;
  readonly kind: FolderEntry['kind'];
  readonly childFolderId?: FolderId;
  readonly fileId?: FolderFileId;
  readonly state: FolderEntry['state'];
  readonly revision: number;
}

export interface DesktopFileRevision {
  readonly id: string;
  readonly contentId: string;
  readonly size: number;
  readonly mimeType: string;
  readonly authorIdentityId: string;
  readonly createdAt: string;
  readonly message?: string;
  readonly restoreOf?: string;
}

export interface DesktopFileProjection {
  readonly fileId: FolderFileId;
  readonly entry: DesktopFileEntry;
  readonly revision: DesktopFileRevision;
  readonly availability: FolderFileProjection['availability'];
  readonly revisionCount: number;
}

export interface DesktopFilesystemStatus {
  readonly bindingId: string;
  readonly folderId: FolderId;
  readonly state: 'BOUND' | 'WATCHING' | 'DETACHED' | 'ERROR';
  readonly pendingEvents: number;
  readonly imported: number;
  readonly materialized: number;
  readonly conflicts: number;
  readonly lastError?: string;
}

export interface DesktopFilesystemSyncAdapter {
  start(): Promise<void>;
  status(): DesktopFilesystemStatus;
  detach(): void;
}

export interface DesktopFilesRuntimeFactoryOptions {
  readonly createFilesystemAdapter?: (service: SharedFolderService, folderId: FolderId, binding: FolderFilesystemBinding) => DesktopFilesystemSyncAdapter;
  readonly defaultFolderId?: FolderId;
}

export interface DesktopFilesRuntime {
  readonly files: SharedFolderService;
  folders(options?: { readonly includeTrash?: boolean }): readonly DesktopFileFolder[];
  children(folderId: FolderId, options?: { readonly limit?: number; readonly cursor?: string; readonly includeTrash?: boolean }): Promise<FolderListResult<DesktopFileEntry>>;
  listFiles(folderId: FolderId, options?: { readonly limit?: number; readonly cursor?: string; readonly includeTrash?: boolean }): Promise<FolderListResult<DesktopFileProjection>>;
  search(query: string, options?: { readonly folderId?: FolderId; readonly limit?: number }): Promise<readonly { readonly entry: DesktopFileEntry; readonly folder: DesktopFileFolder; readonly score: number }[]>;
  conflicts(folderId?: FolderId): Promise<readonly FolderConflict[]>;
  history(fileId: FolderFileId): Promise<readonly DesktopFileRevision[]>;
  importFile?(input: { readonly filename: string; readonly mimeType: string; readonly bytes: Uint8Array; readonly folderId?: FolderId }): Promise<DesktopFileProjection>;
  describeFile?(fileId: FolderFileId): Promise<DesktopFileProjection>;
  readFile?(fileId: FolderFileId): Promise<Uint8Array>;
  createFolder?(input: { readonly name: string; readonly parentFolderId?: FolderId }): Promise<DesktopFileFolder>;
  rename?(entryId: string, name: string, ownerConfirmed?: true): Promise<DesktopFileEntry>;
  move?(entryId: string, folderId: FolderId, ownerConfirmed?: true): Promise<DesktopFileEntry>;
  trash?(entryId: string, ownerConfirmed?: true): Promise<void>;
  restore?(entryId: string, ownerConfirmed?: true): Promise<DesktopFileEntry>;
  keepOnDevice?(folderId: FolderId, fileId?: FolderFileId): Promise<FolderPlacementState>;
  createDropZone?(input: { readonly parentFolderId?: FolderId; readonly name: string }): Promise<DropZone>;
  bindFilesystem?(folderId: FolderId, binding: FolderFilesystemBinding): Promise<DesktopFilesystemStatus>;
  detachFilesystem?(folderId: FolderId): Promise<void>;
  filesystemStatus?(folderId: FolderId): DesktopFilesystemStatus | undefined;
  subscribe?(listener: () => void): () => void;
}

let current: DesktopFilesRuntime | undefined;
const listeners = new Set<() => void>();

export function installDesktopFilesRuntime(runtime: DesktopFilesRuntime | undefined): void { current = runtime; for (const listener of listeners) listener(); }
export function getDesktopFilesRuntime(): DesktopFilesRuntime | undefined { return current; }
export function subscribeDesktopFilesRuntime(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener); }

export function createDesktopFilesRuntime(service: SharedFolderService, options: DesktopFilesRuntimeFactoryOptions = {}): DesktopFilesRuntime {
  const bindings = new Map<FolderId, { readonly adapter: DesktopFilesystemSyncAdapter; readonly binding: FolderFilesystemBinding }>();
  const folderProjection = (folder: KeystoneFolder): DesktopFileFolder => ({ id: folder.id, name: folder.name, ...(folder.parentFolderId ? { parentFolderId: folder.parentFolderId } : {}), scope: folder.scope, ownerIdentityId: folder.ownerIdentityId, revision: folder.revision, epoch: folder.epoch, ...(folder.deletedAt ? { deletedAt: folder.deletedAt } : {}) });
  const entryProjection = (entry: FolderEntry): DesktopFileEntry => entry.kind === 'FILE'
    ? { id: entry.id, parentFolderId: entry.parentFolderId, name: entry.name, kind: entry.kind, fileId: entry.fileId, state: entry.state, revision: entry.revision }
    : { id: entry.id, parentFolderId: entry.parentFolderId, name: entry.name, kind: entry.kind, childFolderId: entry.folderId, state: entry.state, revision: entry.revision };
  const revisionProjection = (revision: FileRevision): DesktopFileRevision => ({ id: revision.id, contentId: revision.contentId, size: revision.size, mimeType: revision.mimeType, authorIdentityId: revision.authorIdentityId, createdAt: revision.createdAt, ...(revision.message ? { message: revision.message } : {}), ...(revision.restoreOf ? { restoreOf: revision.restoreOf } : {}) });
  const fileProjection = (value: FolderFileProjection): DesktopFileProjection => ({ fileId: value.file.id, entry: entryProjection(value.entry), revision: revisionProjection(value.revision), availability: value.availability, revisionCount: value.file.revisionIds.length });
  return {
    files: service,
    folders: options => service.listFolders(options).map(folderProjection),
    children: async (folderId, options) => { const page = await service.listChildren(folderId, options); return { items: page.items.map(entryProjection), ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}), total: page.total }; },
    listFiles: async (folderId, options) => { const page = await service.listFiles(folderId, options); return { items: page.items.map(fileProjection), ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}), total: page.total }; },
    search: async (query, options) => (await service.search(query, options)).map(value => ({ entry: entryProjection(value.entry), folder: folderProjection(value.folder), score: value.score })),
    conflicts: folderId => service.listConflicts(folderId),
    history: async fileId => (await service.versionHistory(fileId)).map(revisionProjection),
    createFolder: async input => folderProjection(await service.createFolder(input)),
    importFile: options.defaultFolderId ? async input => fileProjection(await service.createFile({ folderId: input.folderId ?? options.defaultFolderId!, name: input.filename, mimeType: input.mimeType, bytes: input.bytes })) : undefined,
    describeFile: async fileId => fileProjection(await service.describeFile(fileId)),
    readFile: fileId => service.readFile(fileId),
    rename: async (entryId, name, ownerConfirmed) => entryProjection(await service.renameEntry(entryId as FolderEntryId, name, ownerConfirmed ? { ownerConfirmed: true } : {})),
    move: async (entryId, folderId, ownerConfirmed) => entryProjection(await service.moveEntry(entryId as FolderEntryId, folderId, ownerConfirmed ? { ownerConfirmed: true } : {})),
    trash: async (entryId, ownerConfirmed) => service.deleteEntry(entryId as FolderEntryId, ownerConfirmed ? { ownerConfirmed: true } : {}),
    restore: async (entryId, ownerConfirmed) => entryProjection(await service.restoreEntry(entryId as FolderEntryId, ownerConfirmed ? { ownerConfirmed: true } : {})),
    keepOnDevice: (folderId, fileId) => service.setPlacement({ folderId, ...(fileId ? { fileId } : {}), intent: 'OWNED_DEVICES', includeContent: true }),
    createDropZone: async input => service.createDropZone(input),
    bindFilesystem: options.createFilesystemAdapter ? async (folderId, binding) => { const adapter = options.createFilesystemAdapter!(service, folderId, binding); bindings.set(folderId, { adapter, binding }); await adapter.start(); return adapter.status(); } : undefined,
    detachFilesystem: async folderId => { bindings.get(folderId)?.adapter.detach(); bindings.delete(folderId); },
    filesystemStatus: folderId => bindings.get(folderId)?.adapter.status(),
    subscribe: listener => service.subscribe(listener),
  };
}
