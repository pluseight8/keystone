import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearLocalDesktopRuntimeState, DesktopJsonStateStore } from './desktop-local-runtime';
import { DOCUMENT_FILES_KEY, LocalDocumentFileSource } from './desktop-local-document-files';
import { sha256 } from '@keystone/core';

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
    storage.setItem('keystone.local.ai-settings.v1', '{"legacy":true}');
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
    expect(storage.getItem('keystone.local.ai-settings.v1')).toBe('{"legacy":true}');
    expect(JSON.parse(storage.getItem('keystone.local.documents.files.v1') ?? '[]')).toEqual([
      expect.objectContaining({ fileId: 'local-document:b', ownerId: otherOwner }),
    ]);
  });
});

class DocumentState {
  value: unknown;
  failure?: Error;
  async read() { return structuredClone(this.value); }
  async update(transform: (current: unknown) => unknown) {
    if (this.failure) throw this.failure;
    this.value = structuredClone(transform(this.value));
  }
}

describe('desktop local document revisions', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: createStorage() } });
  });

  it('keeps identical drafts as separate documents, edits one by revision, and reloads both', async () => {
    const state = new DocumentState();
    const source = new LocalDocumentFileSource('owner-a', state);
    const bytes = new TextEncoder().encode('# Draft');
    const [first, second] = await Promise.all([
      source.register('a.md', 'text/markdown', bytes),
      source.register('b.md', 'text/markdown', bytes),
    ]);
    expect(first.contentId).toBe(second.contentId);
    expect(first.fileId).not.toBe(second.fileId);
    const edited = await source.replaceText(first.fileId, first.revision.revisionId, 'renamed.md', 'Revision two');
    expect(edited.fileId).toBe(first.fileId);
    expect(edited.revision.revisionId).not.toBe(first.revision.revisionId);
    await expect(source.readFile(first)).resolves.toBeUndefined();
    await expect(source.replaceText(first.fileId, first.revision.revisionId, 'stale.md', 'Old draft')).rejects.toThrow('document changed');

    const restarted = new LocalDocumentFileSource('owner-a', state);
    await expect(restarted.getFile(first.fileId)).resolves.toMatchObject({ filename: 'renamed.md' });
    await expect(restarted.readText(first.fileId)).resolves.toBe('Revision two');
    await expect(restarted.readText(second.fileId)).resolves.toBe('# Draft');
  });

  it('leaves the old revision intact when persistence fails or another window saves first', async () => {
    const state = new DocumentState();
    const first = new LocalDocumentFileSource('owner-a', state);
    const ref = await first.register('a.md', 'text/markdown', new TextEncoder().encode('old'));
    const otherWindow = new LocalDocumentFileSource('owner-a', state);
    await otherWindow.ready();

    state.failure = new Error('Quota reached');
    await expect(first.replaceText(ref.fileId, ref.revision.revisionId, 'a.md', 'unsaved')).rejects.toThrow('Quota reached');
    await expect(first.readText(ref.fileId)).resolves.toBe('old');
    state.failure = undefined;
    await first.replaceText(ref.fileId, ref.revision.revisionId, 'a.md', 'winner');
    await expect(otherWindow.replaceText(ref.fileId, ref.revision.revisionId, 'a.md', 'stale')).rejects.toThrow('another window');
    await expect(otherWindow.readText(ref.fileId)).resolves.toBe('winner');
  });

  it('opens legacy content IDs and does not repopulate a deliberately empty IndexedDB store', async () => {
    const bytes = new TextEncoder().encode('legacy');
    const contentId = `sha256-${await sha256(bytes)}`;
    const fileId = `local-document:${contentId}`;
    window.localStorage.setItem(DOCUMENT_FILES_KEY, JSON.stringify([
      { version: 1, fileId, filename: 'legacy.txt', mimeType: 'text/plain', size: bytes.byteLength, contentId, bytes: btoa('legacy'), createdAt: '2026-01-01T00:00:00.000Z', ownerId: 'owner-a' },
    ]));
    const state = new DocumentState();
    const source = new LocalDocumentFileSource('owner-a', state);
    await expect(source.readText(fileId)).resolves.toBe('legacy');
    await source.remove(fileId);
    const reopened = new LocalDocumentFileSource('owner-a', state);
    await expect(reopened.listFiles()).resolves.toEqual([]);
  });
});

describe('DesktopJsonStateStore', () => {
  const memoryStore = (initial?: unknown, failWrites = false) => {
    let value = initial;
    return { read: async () => value, write: async (next: unknown) => { if (failWrites) throw new Error('quota'); value = next; }, peek: () => value };
  };
  const stubLocalStorage = (entries: Record<string, string>) => {
    const data = new Map(Object.entries(entries));
    vi.stubGlobal('window', { localStorage: { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } } });
    return data;
  };
  afterEach(() => { vi.unstubAllGlobals(); });

  it('rejects a failed write instead of pretending the state was saved', async () => {
    stubLocalStorage({});
    const store = new DesktopJsonStateStore('tasks', memoryStore({ tasks: ['kept'] }, true));
    await expect(store.write({ tasks: ['kept', 'new'] })).rejects.toThrow('quota');
    expect(await store.read()).toEqual({ tasks: ['kept'] });
  });

  it('adopts state written to localStorage by an earlier build and persists it durably on the next write', async () => {
    const legacy = stubLocalStorage({ tasks: JSON.stringify({ tasks: ['old'] }) });
    const durable = memoryStore();
    const store = new DesktopJsonStateStore('tasks', durable);
    expect(await store.read()).toEqual({ tasks: ['old'] });
    await store.write({ tasks: ['old', 'new'] });
    expect(durable.peek()).toEqual({ tasks: ['old', 'new'] });
    expect(legacy.get('tasks')).toBe(JSON.stringify({ tasks: ['old'] }));
  });

  it('keeps unreadable legacy bytes under a backup key before starting clean', async () => {
    const legacy = stubLocalStorage({ tasks: '{"tasks":["half-writ' });
    const store = new DesktopJsonStateStore('tasks', memoryStore());
    expect(await store.read()).toBeUndefined();
    expect(legacy.get('tasks.corrupt')).toBe('{"tasks":["half-writ');
    expect(legacy.get('tasks')).toBe('{"tasks":["half-writ');
  });
});
