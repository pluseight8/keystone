import { describe, expect, it } from 'vitest';
import { LinuxNativeMediaHost } from './media.js';

const onePixelPng = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));

const imageRequest = (signal?: AbortSignal) => ({
  bytes: onePixelPng,
  filename: '--help;$(touch should-not-exist).png',
  declaredMimeType: 'image/png',
  mimeType: 'image/png',
  maxInputBytes: 1024 * 1024,
  maxDimension: 4_096,
  maxPixels: 1_000_000,
  ...(signal ? { signal } : {}),
});

describe('R0P86 NativeHost production media boundary', () => {
  it('probes and reopens a real PNG through bounded non-shell commands', async () => {
    const host = new LinuxNativeMediaHost({ commandTimeoutMs: 10_000, maxConcurrentProcesses: 1 });
    expect(host.capabilities()).toContain('IMAGE_METADATA');
    expect(host.capabilities()).toContain('IMAGE_THUMBNAIL');
    const metadata = await host.probe(imageRequest());
    expect(metadata).toMatchObject({ kind: 'IMAGE', mimeType: 'image/png', metadata: { width: 1, height: 1 } });
    const derivative = await host.generate({ ...imageRequest(), kind: 'THUMBNAIL', recipe: { width: 32 }, maxOutputBytes: 2 * 1024 * 1024 });
    expect(derivative.mimeType).toBe('image/png');
    expect(Array.from(derivative.bytes.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(host.activeProcesses()).toBe(0);
  });

  it('bounds the process queue, cancellation and malformed input without exposing paths', async () => {
    const host = new LinuxNativeMediaHost({ commandTimeoutMs: 10_000, maxConcurrentProcesses: 1, maxQueue: 1 });
    const first = host.generate({ ...imageRequest(), kind: 'THUMBNAIL', recipe: { width: 32 }, maxOutputBytes: 2 * 1024 * 1024 });
    const second = host.generate({ ...imageRequest(), kind: 'THUMBNAIL', recipe: { width: 33 }, maxOutputBytes: 2 * 1024 * 1024 });
    expect(host.activeProcesses()).toBe(1);
    await expect(host.generate({ ...imageRequest(), kind: 'THUMBNAIL', recipe: { width: 34 }, maxOutputBytes: 2 * 1024 * 1024 })).rejects.toMatchObject({ code: 'RESOURCE_EXHAUSTED' });
    await Promise.all([first, second]);
    expect(host.activeProcesses()).toBe(0);

    const controller = new AbortController();
    const canceled = host.generate({ ...imageRequest(controller.signal), kind: 'THUMBNAIL', recipe: { width: 32 }, maxOutputBytes: 2 * 1024 * 1024 });
    controller.abort();
    await expect(canceled).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(host.activeProcesses()).toBe(0);
    await expect(host.probe({ ...imageRequest(), bytes: Uint8Array.from([1, 2, 3]) })).rejects.toMatchObject({ code: 'UNSUPPORTED' });
    const dimensionBomb = onePixelPng.slice();
    new DataView(dimensionBomb.buffer).setUint32(16, 0xffffffff);
    new DataView(dimensionBomb.buffer).setUint32(20, 0xffffffff);
    try { await host.probe({ ...imageRequest(), bytes: dimensionBomb }); throw new Error('dimension bomb unexpectedly decoded'); } catch (error) { expect(['RESOURCE_EXHAUSTED', 'UNSUPPORTED']).toContain((error as { code?: string }).code); }
    expect(host.activeProcesses()).toBe(0);
  });

  it('keeps repeated production decode cycles bounded and leaves no child processes', async () => {
    const host = new LinuxNativeMediaHost({ commandTimeoutMs: 10_000, maxConcurrentProcesses: 2, maxQueue: 128 });
    let peak = 0;
    const poll = setInterval(() => { peak = Math.max(peak, host.activeProcesses()); }, 1);
    try {
      await Promise.all(Array.from({ length: 100 }, (_, index) => host.generate({ ...imageRequest(), kind: 'THUMBNAIL', recipe: { width: 16 + index % 8 }, maxOutputBytes: 2 * 1024 * 1024 })));
    } finally { clearInterval(poll); }
    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThanOrEqual(2);
    expect(host.activeProcesses()).toBe(0);
  });
});
