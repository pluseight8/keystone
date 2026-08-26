import { describe, expect, it } from 'vitest';
import { LinuxNativeClipboardCapture, UnavailableNativeShareInBoundary } from './capture.js';
import type { NativeHostRequest } from './index.js';

const request: NativeHostRequest = { requestId: 'capture-test', principal: { kind: 'OWNER_UI', id: 'owner' }, capability: 'clipboard.read' };

describe('Linux capture boundary', () => {
  it('uses a fixed non-shell Wayland command with bounded output and no watcher', async () => {
    let command = ''; let args: readonly string[] = []; let maxBytes = 0;
    const clipboard = new LinuxNativeClipboardCapture({ command: '/usr/bin/wl-paste', runner: async (value, argv, options) => { command = value; args = argv; maxBytes = options.maxBytes; return { code: 0, stdout: new TextEncoder().encode(' hello from clipboard\n'), stderr: new Uint8Array() }; } });
    await expect(clipboard.read(request)).resolves.toMatchObject({ text: 'hello from clipboard', mimeType: 'text/plain' });
    expect(command).toBe('/usr/bin/wl-paste');
    expect(args).toEqual(['--no-newline', '--type', 'text/plain']);
    expect(maxBytes).toBe(256 * 1024);
    expect('watch' in clipboard).toBe(false);
  });

  it('denies non-owner clipboard access and has an honest unavailable share-in boundary', async () => {
    const clipboard = new LinuxNativeClipboardCapture({ command: '/usr/bin/wl-paste', runner: async () => ({ code: 0, stdout: new Uint8Array(), stderr: new Uint8Array() }) });
    await expect(clipboard.read({ ...request, principal: { kind: 'REMOTE_PEER', id: 'peer' } })).rejects.toMatchObject({ code: 'POLICY_DENIED' });
    expect(new UnavailableNativeShareInBoundary().status()).toBe('UNAVAILABLE');
  });
});
