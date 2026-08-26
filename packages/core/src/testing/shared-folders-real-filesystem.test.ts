import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NativeFileSystemService, type NativeHostRequest } from '@keystone/native-host';
import { ContentCache } from '../social/content.js';
import { ContentCacheFolderContentStore, FilesystemSyncAdapter, SharedFolderService } from '../shared-folders.js';
import type { NodeId } from '../types.js';

const ownerRequest: NativeHostRequest = { requestId: 'r0p90-filesystem-proof', principal: { kind: 'OWNER_UI', id: 'owner' }, capability: 'filesystem.watch', sessionId: 'filesystem-session' };
const bytes = (value: string): Uint8Array => new TextEncoder().encode(value);

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  throw new Error('Timed out waiting for filesystem watcher proof');
}

describe('R0P90 real scoped filesystem proof', () => {
  it('imports, materializes, watches and removes files without following symlinks', async () => {
    const selectedRoot = await mkdtemp(join(tmpdir(), 'keystone-r0p90-selected-'));
    const outsideRoot = await mkdtemp(join(tmpdir(), 'keystone-r0p90-outside-'));
    const hostRoot = await mkdtemp(join(tmpdir(), 'keystone-r0p90-host-'));
    try {
      await writeFile(join(selectedRoot, 'local.txt'), 'local-v1');
      await writeFile(join(outsideRoot, 'secret.txt'), 'outside-secret');
      await symlink(join(outsideRoot, 'secret.txt'), join(selectedRoot, 'linked.txt'));
      const native = new NativeFileSystemService(hostRoot, () => 'filesystem-session');
      await native.init();
      const binding = await native.bindDirectory(selectedRoot, ownerRequest);
      const listing = await binding.list();
      expect(listing.some(value => value.relativePath === 'linked.txt' && value.kind === 'SYMLINK')).toBe(true);
      expect(listing.every(value => !value.relativePath.includes(selectedRoot))).toBe(true);
      await expect(binding.read('linked.txt')).rejects.toMatchObject({ code: 'POLICY_DENIED' });
      await expect(binding.read('../secret.txt')).rejects.toMatchObject({ code: 'POLICY_DENIED' });
      await expect(binding.writeAtomic('linked.txt/escape.txt', bytes('blocked'))).rejects.toMatchObject({ code: 'POLICY_DENIED' });

      const files = new SharedFolderService({ localIdentityId: 'owner' as NodeId, content: new ContentCacheFolderContentStore(new ContentCache(64 * 1024 * 1024)) });
      const folder = await files.createFolder({ name: 'Selected Files' });
      const sync = new FilesystemSyncAdapter(files, folder.id, binding);
      expect((await sync.preview()).localFiles).toBe(1);
      await sync.start();
      const imported = (await files.listFiles(folder.id)).items.find(value => value.entry.name === 'local.txt');
      expect(imported).toBeDefined();

      await writeFile(join(selectedRoot, 'local.txt'), 'local-v2');
      await waitFor(async () => { await sync.flush(); const current = (await files.listFiles(folder.id)).items.find(value => value.entry.name === 'local.txt'); return Boolean(current && (await files.readFile(current.file.id)).every((value, index) => value === bytes('local-v2')[index])); });

      await files.createFile({ folderId: folder.id, name: 'remote.txt', bytes: bytes('remote'), mimeType: 'text/plain' });
      expect(await sync.exportOnce()).toBeGreaterThanOrEqual(1);
      expect(await readFile(join(selectedRoot, 'remote.txt'), 'utf8')).toBe('remote');
      await writeFile(join(selectedRoot, 'remote.txt'), 'local-conflict');
      const remoteProjection = (await files.listFiles(folder.id)).items.find(value => value.entry.name === 'remote.txt');
      expect(remoteProjection).toBeDefined();
      await files.updateFile(remoteProjection!.file.id, bytes('remote-v2'));
      await sync.exportOnce();
      expect(await readFile(join(selectedRoot, 'remote.txt'), 'utf8')).toBe('local-conflict');
      expect((await files.listConflicts(folder.id)).some(value => value.kind === 'FILESYSTEM')).toBe(true);

      await rm(join(selectedRoot, 'local.txt'));
      await waitFor(async () => { await sync.flush(); return (await files.listFiles(folder.id)).items.every(value => value.entry.name !== 'local.txt'); });
      sync.detach();
      await expect(binding.list()).rejects.toMatchObject({ code: 'HANDLE_INVALID' });
      expect(files.listFolders().some(value => value.id === folder.id)).toBe(true);
    } finally {
      await rm(selectedRoot, { recursive: true, force: true });
      await rm(outsideRoot, { recursive: true, force: true });
      await rm(hostRoot, { recursive: true, force: true });
    }
  }, 180_000);
});
