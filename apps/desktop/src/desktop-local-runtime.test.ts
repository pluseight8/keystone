import { beforeEach, describe, expect, it } from 'vitest';
import { clearLocalDesktopRuntimeState } from './desktop-local-runtime';

function createStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: key => values.get(key) ?? null,
    key: index => [...values.keys()][index] ?? null,
    removeItem: key => { values.delete(key); },
    setItem: (key, value) => { values.set(key, String(value)); },
  };
}

describe('desktop local runtime rollback', () => {
  let storage: Storage;

  beforeEach(() => {
    storage = createStorage();
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: storage } });
  });

  it('removes only state initialized for the failed owner transaction', () => {
    const owner = 'owner-a';
    const otherOwner = 'owner-b';
    storage.setItem('keystone.local.capture.v1:' + owner, '{}');
    storage.setItem('keystone.local.tasks.v1:' + owner, '{}');
    storage.setItem('keystone.local.documents.metadata.v1:' + owner, '{}');
    storage.setItem('keystone.local.ai-settings.v1:' + owner, '{}');
    storage.setItem('keystone.local.discovery.v1:' + owner, '{}');
    storage.setItem('keystone.local.capture.v1:owner-b', '{"keep":true}');
    storage.setItem('keystone.local.documents.files.v1', JSON.stringify([
      { version: 1, fileId: 'local-document:a', filename: 'a.md', mimeType: 'text/markdown', size: 0, contentId: 'sha256-' + 'a'.repeat(64), bytes: '', createdAt: '2026-01-01T00:00:00.000Z', ownerId: owner },
      { version: 1, fileId: 'local-document:b', filename: 'b.md', mimeType: 'text/markdown', size: 0, contentId: 'sha256-' + 'b'.repeat(64), bytes: '', createdAt: '2026-01-01T00:00:00.000Z', ownerId: otherOwner },
    ]));

    clearLocalDesktopRuntimeState({ ownerIdentityId: owner });

    expect(storage.getItem('keystone.local.capture.v1:' + owner)).toBeNull();
    expect(storage.getItem('keystone.local.tasks.v1:' + owner)).toBeNull();
    expect(storage.getItem('keystone.local.documents.metadata.v1:' + owner)).toBeNull();
    expect(storage.getItem('keystone.local.ai-settings.v1:' + owner)).toBeNull();
    expect(storage.getItem('keystone.local.discovery.v1:' + owner)).toBeNull();
    expect(storage.getItem('keystone.local.capture.v1:owner-b')).toBe('{"keep":true}');
    expect(JSON.parse(storage.getItem('keystone.local.documents.files.v1') ?? '[]')).toEqual([
      expect.objectContaining({ fileId: 'local-document:b', ownerId: otherOwner }),
    ]);
  });
});
