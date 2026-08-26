import type { FileContainmentService, FileService, FileStorageManager, FileTransferManager, FolderFileId, FolderFileProjection, FolderId, KeystoneFolder, SharedFolderService } from '@keystone/core';

export interface MobileSharedFoldersRuntime {
  readonly sharedFolders?: SharedFolderService;
  folders(options?: { readonly includeTrash?: boolean }): readonly KeystoneFolder[];
  listFiles(folderId: FolderId, options?: { readonly limit?: number; readonly cursor?: string; readonly includeTrash?: boolean }): Promise<{ readonly items: readonly FolderFileProjection[]; readonly nextCursor?: string; readonly total: number }>;
  search?(query: string, options?: { readonly folderId?: FolderId; readonly limit?: number }): Promise<readonly { readonly entry: { readonly id: string; readonly name: string }; readonly folder: KeystoneFolder; readonly score: number }[]>;
  keepOnDevice?(folderId: FolderId, fileId?: FolderFileId): Promise<unknown>;
  subscribe?(listener: () => void): () => void;
}

/** Native host installs storage/provider adapters after identity bootstrap. */
export interface MobileFilesRuntime { files: FileService; storage: FileStorageManager; transfer?: FileTransferManager; containment?: FileContainmentService; ownerIdentityId?: string; sharedFolders?: MobileSharedFoldersRuntime; }
let current: MobileFilesRuntime | undefined;
const listeners = new Set<() => void>();
export function installMobileFilesRuntime(runtime: MobileFilesRuntime | undefined): void { current = runtime; listeners.forEach(listener => listener()); }
export function getMobileFilesRuntime(): MobileFilesRuntime | undefined { return current; }
export function subscribeMobileFilesRuntime(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener); }
