import type { FileService, FileStorageManager, FileTransferManager } from '@keystone/core';

/** Native host installs storage/provider adapters after identity bootstrap. */
export interface MobileFilesRuntime { files: FileService; storage: FileStorageManager; transfer?: FileTransferManager; }
let current: MobileFilesRuntime | undefined;
const listeners = new Set<() => void>();
export function installMobileFilesRuntime(runtime: MobileFilesRuntime | undefined): void { current = runtime; listeners.forEach(listener => listener()); }
export function getMobileFilesRuntime(): MobileFilesRuntime | undefined { return current; }
export function subscribeMobileFilesRuntime(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener); }
