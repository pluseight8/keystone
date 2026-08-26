import { describe, expect, it } from 'vitest';
import { CaptureService, InMemoryCaptureDestinationRegistry, createFilesCaptureAdapter, parseCaptureDeepLink } from './capture.js';

describe('Capture security boundaries', () => {
  it('never treats untrusted text, HTML or links as executable input', async () => {
    const service = new CaptureService({ clipboard: { read: async () => ({ html: '<script>fetch("https://evil.test")</script><p>safe</p>' }) } });
    await expect(service.captureClipboard({ ownerConfirmed: true })).resolves.toMatchObject({ payload: { kind: 'TEXT', text: 'safe' } });
    for (const url of ['javascript:alert(1)', 'data:text/html,hi', 'file:///tmp/a', 'shell://run', 'intent://open']) await expect(service.captureUrl(url)).rejects.toMatchObject({ code: 'UNSAFE_INPUT' });
    for (const link of ['keystone://capture?command=rm', 'keystone://capture?action=route&text=hello', 'keystone://capture?destination=TASK&text=hello']) await expect(service.captureDeepLink(link)).rejects.toMatchObject({ code: 'UNSAFE_INPUT' });
    expect(() => parseCaptureDeepLink('keystone://other?text=hello')).toThrow();
  });

  it('does not read a file URI or perform a route from a remote-looking reference', async () => {
    let executed = false;
    const service = new CaptureService({ destinations: new InMemoryCaptureDestinationRegistry([createFilesCaptureAdapter({ create: async () => { executed = true; return { type: 'file', id: 'file-1', dataClass: 'PRIVATE' }; } })]) });
    await expect(service.captureUrl('https://example.test/file')).resolves.toBeDefined();
    expect(executed).toBe(false);
    await expect(service.captureReference({ reference: { type: 'remote-command', id: 'run', locator: 'shell://run', dataClass: 'PUBLIC' } })).rejects.toMatchObject({ code: 'UNSAFE_INPUT' });
  });

  it('requires explicit owner confirmation for share-in, routing, cleanup and external disclosure', async () => {
    const service = new CaptureService();
    await expect(service.captureShareIn({ accepted: false, payload: { kind: 'TEXT', text: 'not accepted' } })).rejects.toMatchObject({ code: 'POLICY_DENIED' });
    const item = await service.captureText('private draft');
    await expect(service.delete(item.id, false as true)).rejects.toMatchObject({ code: 'POLICY_DENIED' });
    await expect(service.route(item.id, 'FILES', { ownerConfirmed: false as true })).rejects.toMatchObject({ code: 'POLICY_DENIED' });
  });

  it('does not expose a clipboard history or per-item timer surface', () => {
    const service = new CaptureService();
    expect('watch' in service).toBe(false);
    expect(service.diagnostics()).toMatchObject({ timers: 0, listeners: 0, transientHandles: 0 });
  });
});
