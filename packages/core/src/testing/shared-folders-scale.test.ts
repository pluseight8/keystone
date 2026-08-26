import { describe, expect, it } from 'vitest';
import { ContentCache } from '../social/content.js';
import { ContentCacheFolderContentStore, FilesystemSyncAdapter, InMemoryFolderStateStore, SHARED_FOLDERS_PROTOCOL, SharedFolderService, type FolderEntry, type FolderFilesystemWatchEvent, type FolderId, type FolderStateSnapshot, type KeystoneFolder } from '../shared-folders.js';
import type { NodeId } from '../types.js';

describe('R0P90 shared-folder metadata scale', () => {
  it('hydrates and paginates 100,000 bounded folder metadata entries', async () => {
    const createdAt = '2026-08-26T00:00:00.000Z';
    const rootId = 'folder:scale-root' as FolderId;
    const folders: KeystoneFolder[] = [{ version: 1, id: rootId, name: 'Scale Root', ownerIdentityId: 'owner' as NodeId, scope: 'PRIVATE', createdAt, updatedAt: createdAt, revision: 1, epoch: 1 }];
    const entries: FolderEntry[] = [];
    for (let index = 0; index < 99_999; index++) {
      const folderId = `folder:scale-${index}` as FolderId;
      folders.push({ version: 1, id: folderId, name: `Folder ${index.toString().padStart(5, '0')}`, ownerIdentityId: 'owner' as NodeId, scope: 'PRIVATE', parentFolderId: rootId, createdAt, updatedAt: createdAt, revision: 1, epoch: 1 });
      entries.push({ version: 1, id: `entry:scale-${index}` as FolderEntry['id'], parentFolderId: rootId, name: `Folder ${index.toString().padStart(5, '0')}`, kind: 'FOLDER', folderId, state: 'ACTIVE', createdAt, updatedAt: createdAt, revision: 1 });
    }
    const snapshot: FolderStateSnapshot = { version: 1, protocol: SHARED_FOLDERS_PROTOCOL, folders, entries, files: [], revisions: [], memberships: [], invitations: [], changes: [], conflicts: [], dropZones: [], receipts: [], placements: [] };
    const service = new SharedFolderService({ localIdentityId: 'owner' as NodeId, content: new ContentCacheFolderContentStore(new ContentCache(1024 * 1024)), stateStore: new InMemoryFolderStateStore() });
    const store = new InMemoryFolderStateStore();
    await store.write(snapshot);
    const hydrated = new SharedFolderService({ localIdentityId: 'owner' as NodeId, content: new ContentCacheFolderContentStore(new ContentCache(1024 * 1024)), stateStore: store });
    await hydrated.ready();
    expect(hydrated.diagnostics().folders).toBe(100_000);
    expect(hydrated.listFolders()).toHaveLength(100_000);
    const page = await hydrated.listChildren(rootId, { limit: 256 });
    expect(page.items).toHaveLength(256);
    expect(page.total).toBe(99_999);
    expect(page.nextCursor).toBeDefined();
    expect(service.diagnostics().folders).toBe(0);
  }, 180_000);

  it('coalesces 10,000 watcher events behind a bounded queue', async () => {
    let listener: ((event: FolderFilesystemWatchEvent) => void) | undefined;
    const binding = {
      async list() { return []; },
      async read() { return new Uint8Array(); },
      async writeAtomic() {},
      async mkdir() {},
      async remove() {},
      watch(next: (event: FolderFilesystemWatchEvent) => void) { listener = next; return () => { listener = undefined; }; },
    };
    const service = new SharedFolderService({ localIdentityId: 'owner' as NodeId, content: new ContentCacheFolderContentStore(new ContentCache(1024 * 1024)) });
    const folder = await service.createFolder({ name: 'Watcher Scale' });
    const sync = new FilesystemSyncAdapter(service, folder.id, binding);
    await sync.start();
    for (let index = 0; index < 10_000; index++) listener?.({ kind: 'UPDATE', relativePath: `file-${index}.txt` });
    expect(sync.status().pendingEvents).toBeLessThanOrEqual(512);
    expect(sync.status().state).toBe('ERROR');
    sync.detach();
    expect(listener).toBeUndefined();
  }, 180_000);
});
