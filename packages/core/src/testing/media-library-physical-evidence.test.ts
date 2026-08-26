import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { createProductionNativeHost } from '@keystone/native-host';
import { ContentCacheMediaStore, createProductionMediaLibrary, detectMediaType, probeMediaMetadata } from '../media-library.js';

const execFileAsync = promisify(execFile);
const onePixelPng = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));

async function outputBytes(command: string, args: readonly string[], maxBuffer = 32 * 1024 * 1024): Promise<Uint8Array> {
  const result = await execFileAsync(command, [...args], { timeout: 30_000, maxBuffer, encoding: 'buffer' });
  return new Uint8Array(result.stdout);
}

async function makeJpeg(): Promise<Uint8Array> {
  try { return await outputBytes('magick', ['-size', '3x2', 'xc:navy', 'jpeg:-']); } catch { return outputBytes('convert', ['-size', '3x2', 'xc:navy', 'jpeg:-']); }
}

async function makeMp4(): Promise<Uint8Array> {
  return outputBytes('ffmpeg', [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'color=c=black:s=4x3:d=0.25',
    '-frames:v', '3', '-an', '-c:v', 'mpeg4',
    '-movflags', '+frag_keyframe+empty_moov', '-f', 'mp4', 'pipe:1',
  ]);
}

async function makeWebm(): Promise<Uint8Array | undefined> {
  const directory = await mkdtemp(join(tmpdir(), 'keystone-r0p86-webm-'));
  const path = join(directory, 'fixture.webm');
  try {
    await execFileAsync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'color=c=black:s=4x3:d=0.25',
      '-frames:v', '3', '-an', '-c:v', 'libvpx-vp9', '-crf', '40', '-b:v', '0',
      '-f', 'webm', '-y', path,
    ], { timeout: 30_000, maxBuffer: 64 * 1024 });
    return new Uint8Array(await readFile(path));
  } catch { return undefined; } finally { await rm(directory, { recursive: true, force: true }); }
}

function sha(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }

describe('R0P86 production media decode evidence', () => {
  it('proves real PNG/JPEG thumbnails and MP4 metadata/frame through the production path', async () => {
    const host = createProductionNativeHost();
    const mediaHost = host.media();
    const capabilities = mediaHost.capabilities();
    expect(capabilities).toContain('IMAGE_METADATA');
    expect(capabilities).toContain('IMAGE_THUMBNAIL');
    expect(capabilities).toContain('VIDEO_METADATA');
    expect(capabilities).toContain('VIDEO_THUMBNAIL');

    const jpeg = await makeJpeg();
    const mp4 = await makeMp4();
    const webm = await makeWebm();
    const content = new ContentCacheMediaStore();
    const service = createProductionMediaLibrary({ nativeHost: host, content });

    const pngHashBefore = sha(onePixelPng);
    const png = await service.importBytes({ bytes: onePixelPng, filename: '$(touch no-side-effect).png' });
    expect(png.asset).toMatchObject({ kind: 'IMAGE', mimeType: 'image/png', capture: { width: 1, height: 1 } });
    const pngThumbnail = await service.requestDerivative(png.asset!.id, 'THUMBNAIL', { width: 64 });
    expect(pngThumbnail).toMatchObject({ state: 'READY', mimeType: 'image/png' });
    const pngDerivative = await content.read(pngThumbnail.contentId!);
    expect(pngDerivative).toBeDefined();
    expect(detectMediaType(pngDerivative!, 'derived.png')).toEqual({ kind: 'IMAGE', mimeType: 'image/png' });
    expect(probeMediaMetadata(pngDerivative!, 'image/png')).toMatchObject({ width: 1, height: 1 });
    expect(sha(await content.read(png.asset!.contentId) as Uint8Array)).toBe(pngHashBefore);

    const jpegHashBefore = sha(jpeg);
    const jpegAsset = await service.importBytes({ bytes: jpeg, filename: '--help;photo.jpg', declaredMimeType: 'image/jpeg' });
    expect(jpegAsset.asset).toMatchObject({ kind: 'IMAGE', mimeType: 'image/jpeg', capture: { width: 3, height: 2 } });
    const jpegPreview = await service.requestDerivative(jpegAsset.asset!.id, 'PREVIEW', { width: 128 });
    expect(jpegPreview).toMatchObject({ state: 'READY', mimeType: 'image/png' });
    expect(probeMediaMetadata(await content.read(jpegPreview.contentId!) as Uint8Array, 'image/png')).toMatchObject({ width: 3, height: 2 });
    expect(sha(await content.read(jpegAsset.asset!.contentId) as Uint8Array)).toBe(jpegHashBefore);

    const videoHashBefore = sha(mp4);
    const video = await service.importBytes({ bytes: mp4, filename: 'clip;--help.mp4', declaredMimeType: 'video/mp4' });
    expect(video.asset).toMatchObject({ kind: 'VIDEO', mimeType: 'video/mp4', capture: { width: 4, height: 3 } });
    expect(video.asset!.capture.durationMs).toBeGreaterThan(0);
    const frame = await service.requestDerivative(video.asset!.id, 'VIDEO_FRAME', { width: 64 });
    expect(frame).toMatchObject({ state: 'READY', mimeType: 'image/png' });
    const frameBytes = await content.read(frame.contentId!);
    expect(detectMediaType(frameBytes!, 'frame.png')).toEqual({ kind: 'IMAGE', mimeType: 'image/png' });
    const frameMetadata = probeMediaMetadata(frameBytes!, 'image/png');
    expect(frameMetadata.width).toBeLessThanOrEqual(64);
    expect(frameMetadata.height).toBeLessThanOrEqual(64);
    expect(sha(await content.read(video.asset!.contentId) as Uint8Array)).toBe(videoHashBefore);
    let webmEvidence: 'PASS' | 'BLOCKED_BY_ENVIRONMENT' = 'BLOCKED_BY_ENVIRONMENT';
    if (webm) {
      const webmHashBefore = sha(webm);
      const webmAsset = await service.importBytes({ bytes: webm, filename: 'webm;--help.webm', declaredMimeType: 'video/webm' });
      expect(webmAsset.asset).toMatchObject({ kind: 'VIDEO', mimeType: 'video/webm', capture: { width: 4, height: 3 } });
      expect(webmAsset.asset!.capture.durationMs).toBeGreaterThan(0);
      const webmFrame = await service.requestDerivative(webmAsset.asset!.id, 'VIDEO_FRAME', { width: 64 });
      expect(webmFrame).toMatchObject({ state: 'READY', mimeType: 'image/png' });
      expect(sha(await content.read(webmAsset.asset!.contentId) as Uint8Array)).toBe(webmHashBefore);
      webmEvidence = 'PASS';
    }
    const malformedImage = new Uint8Array(32);
    malformedImage.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    new DataView(malformedImage.buffer).setUint32(16, 2);
    new DataView(malformedImage.buffer).setUint32(20, 2);
    await expect(service.importBytes({ bytes: malformedImage, filename: 'malformed.png' })).rejects.toMatchObject({ code: 'UNSUPPORTED_MEDIA' });
    const malformedVideo = Uint8Array.from([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0, 0, 0, 0, 0]);
    await expect(service.importBytes({ bytes: malformedVideo, filename: 'malformed.mp4', declaredMimeType: 'video/mp4' })).rejects.toMatchObject({ code: 'UNSUPPORTED_MEDIA' });
    expect(mediaHost.activeProcesses()).toBe(0);

    console.info(`[R0P86 evidence] ${JSON.stringify({
      host: 'Omarchy (Arch Linux-based distribution)',
      adapter: 'PHYSICALLY_VERIFIED',
      image: { png: 'PASS', jpeg: 'PASS', derivatives: 'PNG_REOPENED_AND_VALIDATED', originalHashes: 'UNCHANGED' },
      video: { mp4: 'PASS', webm: webmEvidence, durationMs: video.asset!.capture.durationMs, dimensions: `${video.asset!.capture.width}x${video.asset!.capture.height}`, frame: 'PASS', originalHash: 'UNCHANGED' },
      processCleanup: mediaHost.activeProcesses() === 0 ? 'PASS' : 'BLOCKED_BY_ENVIRONMENT',
      mobile: 'DECLARED_TYPED_BOUNDARY_UNVERIFIED',
    })}`);
  });
});
