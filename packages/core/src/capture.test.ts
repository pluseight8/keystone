import { describe, expect, it } from 'vitest';
import {
  CAPTURE_ARCHITECTURE_POLICY,
  CaptureError,
  CaptureService,
  InMemoryCaptureDestinationRegistry,
  InMemoryCaptureStateStore,
  createFilesCaptureAdapter,
  createTaskCaptureAdapter,
  parseCaptureDeepLink,
} from './capture.js';

const ref = (type: string, id: string, dataClass: 'PUBLIC' | 'USER_EXPLICIT' | 'PRIVATE' | 'SECRET' = 'PRIVATE') => ({ type, id, dataClass });

describe('CaptureService', () => {
  it('persists a private tray, deduplicates, paginates and restores dismissed drafts', async () => {
    const state = new InMemoryCaptureStateStore();
    const first = new CaptureService({ state, ownerIdentityId: 'alice', deviceId: 'desktop' });
    const item = await first.captureText({ text: 'Remember the local-first design', source: { kind: 'MANUAL' } });
    const duplicate = await first.captureText('Remember the local-first design');
    expect(duplicate.id).toBe(item.id);
    expect(duplicate.duplicateCount).toBe(2);
    await first.dismiss(item.id);
    expect((await first.list({ state: 'DISMISSED' })).total).toBe(1);
    expect((await first.restore(item.id)).state).toBe('READY');
    const second = new CaptureService({ state, ownerIdentityId: 'alice', deviceId: 'desktop' });
    expect((await second.get(item.id))?.title).toBe('Remember the local-first design');
    for (let index = 0; index < 5; index += 1) await second.captureText(`entry ${index}`);
    const page = await second.list({ limit: 2 });
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toBeDefined();
    expect((await second.search('entry')).total).toBe(5);
  });

  it('takes clipboard and browser input only through explicit one-shot boundaries', async () => {
    let reads = 0;
    const service = new CaptureService({
      clipboard: { read: async () => { reads += 1; return { html: '<b>hello</b><script>alert(1)</script>' }; } },
      browser: { currentPage: async () => ({ url: 'https://example.test/article', title: 'Article', excerpt: 'bounded excerpt' }), selection: async () => ({ selectedText: 'selected', url: 'https://example.test/article', title: 'Article' }) },
    });
    await expect(service.captureClipboard({ ownerConfirmed: true })).resolves.toMatchObject({ payload: { kind: 'TEXT', text: 'hello' } });
    expect(reads).toBe(1);
    await expect(service.captureBrowserPage({ ownerConfirmed: true })).resolves.toMatchObject({ payload: { kind: 'BROWSER_PAGE', url: 'https://example.test/article' } });
    await expect(service.captureBrowserSelection({ ownerConfirmed: true })).resolves.toMatchObject({ payload: { kind: 'BROWSER_SELECTION', selectedText: 'selected' } });
  });

  it('previews and routes to a canonical adapter only after confirmation, with idempotency', async () => {
    let writes = 0;
    const registry = new InMemoryCaptureDestinationRegistry([createTaskCaptureAdapter({
      supports: item => item.payload.kind === 'TEXT',
      create: async ({ item }) => { writes += 1; return ref('task', `task-${item.id}`); },
    })]);
    const service = new CaptureService({ destinations: registry });
    const item = await service.captureText('todo: review the release gate');
    expect((await service.suggestions(item.id))[0]?.destination).toBe('TASK');
    expect((await service.previewRoute(item.id, 'TASK')).requiresOwnerConfirmation).toBe(true);
    await expect(service.route(item.id, 'TASK', { ownerConfirmed: true })).resolves.toMatchObject({ reference: { type: 'task' } });
    await expect(service.route(item.id, 'TASK', { ownerConfirmed: true })).resolves.toMatchObject({ reference: { type: 'task' } });
    expect(writes).toBe(1);
    expect((await service.get(item.id))?.state).toBe('ROUTED');
  });

  it('routes an opaque file handle without persisting its bytes', async () => {
    let readCount = 0;
    const registry = new InMemoryCaptureDestinationRegistry([createFilesCaptureAdapter({ create: async ({ item, readFile }) => { const file = item.payload.kind === 'FILE' ? item.payload.file : undefined; expect(file).toBeDefined(); const content = await readFile(file!.id); readCount += 1; expect(new TextDecoder().decode(content)).toBe('file body'); return ref('file', 'file-1'); } })]);
    const state = new InMemoryCaptureStateStore(); const service = new CaptureService({ state, destinations: registry });
    const item = await service.captureFile({ name: 'note.txt', mimeType: 'text/plain', bytes: new TextEncoder().encode('file body') });
    await service.route(item.id, 'FILES', { ownerConfirmed: true });
    expect(readCount).toBe(1);
    const persisted = await state.read();
    expect(JSON.stringify(persisted)).not.toContain('file body');
  });

  it('exports and merges own-device metadata without replaying routes', async () => {
    const first = new CaptureService({ ownerIdentityId: 'alice', deviceId: 'desktop' }); const item = await first.captureText('shared draft'); const envelope = await first.exportPrivateSync();
    const second = new CaptureService({ ownerIdentityId: 'alice', deviceId: 'phone', sync: { trustedDeviceIds: ['desktop'] } });
    expect(await second.mergePrivateSync(envelope)).toBe(1);
    expect((await second.get(item.id))?.payload).toMatchObject({ kind: 'TEXT', text: 'shared draft' });
  });
});

describe('Capture boundary contracts', () => {
  it('rejects unsafe URLs and executable deep-link actions', async () => {
    const service = new CaptureService();
    await expect(service.captureUrl('javascript:alert(1)')).rejects.toBeInstanceOf(CaptureError);
    await expect(service.captureUrl('file:///etc/passwd')).rejects.toBeInstanceOf(CaptureError);
    await expect(service.captureDeepLink('keystone://capture?action=publish&text=x')).rejects.toMatchObject({ code: 'UNSAFE_INPUT' });
    expect(parseCaptureDeepLink('keystone://capture?text=hello')).toMatchObject({ protocol: 'keystone.capture.v1', text: 'hello' });
  });

  it('makes the no-second-store and no-monitoring policy executable', () => {
    expect(CAPTURE_ARCHITECTURE_POLICY.secondUniversalInbox).toBe(false);
    expect(CAPTURE_ARCHITECTURE_POLICY.secondTaskInbox).toBe(false);
    expect(CAPTURE_ARCHITECTURE_POLICY.clipboardMonitoring).toBe(false);
    expect(CAPTURE_ARCHITECTURE_POLICY.externalAiByDefault).toBe(false);
  });
});
