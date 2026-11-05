import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

import { decodeDesktopAudio, probeDesktopVideo, signDesktopPayload, TauriSecureSecretHost } from './desktop-host-bridge';

describe('desktop identity host boundary', () => {
  beforeEach(() => invokeMock.mockReset());

  it('wraps identity provisioning in the native command payload', async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    const host = new TauriSecureSecretHost('device:test');

    await host.importSecret({
      secretClass: 'IDENTITY_PRIVATE_KEY',
      scope: 'IDENTITY',
      algorithm: 'ED25519',
    }, new Uint8Array(64));

    expect(invokeMock).toHaveBeenCalledWith('desktop_identity_provision', {
      payload: { deviceId: 'device:test', privateKey: Array.from(new Uint8Array(64)) },
    });
  });

  it('wraps signing requests in the native command payload', async () => {
    invokeMock.mockResolvedValueOnce('signature');

    await expect(signDesktopPayload('device:test', '{"domain":"test"}')).resolves.toBe('signature');
    expect(invokeMock).toHaveBeenCalledWith('desktop_identity_sign', {
      payload: { deviceId: 'device:test', message: '{"domain":"test"}' },
    });
  });

  it('keeps local audio decoding behind the typed native host boundary', async () => {
    invokeMock.mockResolvedValueOnce({ sampleRate: 48_000, channels: 2, durationMs: 2_000, pcmBase64: 'AAAA' });

    await expect(decodeDesktopAudio(new Uint8Array([1, 2, 3]), 'audio/mpeg')).resolves.toMatchObject({ sampleRate: 48_000, channels: 2, durationMs: 2_000 });
    expect(invokeMock).toHaveBeenCalledWith('decode_local_audio', {
      payload: { mimeType: 'audio/mpeg', bytes: [1, 2, 3] },
    });
  });

  it('keeps native video probing behind the typed host boundary', async () => {
    invokeMock.mockResolvedValueOnce({ durationMs: 2_000, width: 320, height: 180, videoCodec: 'vp9', container: 'matroska,webm' });

    await expect(probeDesktopVideo(new Uint8Array([1, 2, 3]), 'video/webm')).resolves.toMatchObject({ width: 320, height: 180, videoCodec: 'vp9' });
    expect(invokeMock).toHaveBeenCalledWith('probe_local_video', {
      payload: { mimeType: 'video/webm', bytes: [1, 2, 3] },
    });
  });
});
