import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { createTestNativeHost } from '@keystone/native-host';
import { ContentCacheMediaStore, DeterministicMediaDerivativeAdapter, MediaLibraryError, MediaLibraryService, NativeHostMediaDecoderAdapter, type MediaAsset, type MediaContentStore, type MediaShareAdapter } from './media-library.js';

const png = (width = 2, height = 2) => { const value = new Uint8Array(32); value.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); new DataView(value.buffer).setUint32(16, width); new DataView(value.buffer).setUint32(20, height); return value; };

describe('R0P86 media security boundaries', () => {
  it('rejects fake extensions, malformed image structure, giant dimensions and path traversal', async () => {
    const service = new MediaLibraryService();
    await expect(service.importBytes({ bytes: png(), filename: 'fake.jpg', declaredMimeType: 'image/jpeg' })).rejects.toMatchObject({ code: 'UNSUPPORTED_MEDIA' });
    await expect(service.importBytes({ bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47]), filename: 'truncated.png' })).rejects.toMatchObject({ code: 'UNSUPPORTED_MEDIA' });
    await expect(service.importBytes({ bytes: png(0xffffffff, 0xffffffff), filename: 'bomb.png' })).rejects.toMatchObject({ code: 'RESOURCE_LIMIT' });
    await expect(service.importBytes({ bytes: png(), filename: 'folder\\..\\asset.png' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('does not leak Vault-hidden assets to ordinary list, search, map or derivative surfaces', async () => {
    let hidden = false;
    const service = new MediaLibraryService({ vault: { visibility: async () => hidden ? 'HIDDEN' : 'VISIBLE' }, derivatives: new DeterministicMediaDerivativeAdapter() });
    const imported = await service.importBytes({ bytes: png(), filename: 'private.png' });
    hidden = true;
    expect(await service.getAsset(imported.asset!.id)).toBeUndefined();
    expect(await service.listAssets()).toEqual([]);
    expect(await service.search({ query: 'private' })).toEqual([]);
    expect(await service.mapProjection({ ownerConfirmed: true })).toEqual([]);
    await expect(service.requestDerivative(imported.asset!.id, 'THUMBNAIL')).rejects.toMatchObject({ code: 'POLICY_DENIED' });
  });

  it('bounds hostile decoder output and prevents private originals from becoming public cache', async () => {
    const content = new ContentCacheMediaStore();
    const hostile = { async generate() { return { bytes: new Uint8Array(33 * 1024 * 1024), mimeType: 'image/png' }; } };
    const service = new MediaLibraryService({ content, derivatives: hostile });
    const imported = await service.importBytes({ bytes: png(), filename: 'hostile.png' });
    await expect(service.requestDerivative(imported.asset!.id, 'PREVIEW')).rejects.toMatchObject({ code: 'RESOURCE_LIMIT' });
    const share: MediaShareAdapter = { async share(payload) { return { id: 'share', destination: payload.destination, mode: payload.mode, contentId: payload.contentId, publicCacheable: payload.publicCacheable }; } };
    const privateService = new MediaLibraryService({ share });
    const privateAsset = await privateService.importBytes({ bytes: png(), filename: 'private-original.png' });
    await expect(privateService.share({ mediaId: privateAsset.asset!.id, destination: 'PERSONAL_WEB', mode: 'PUBLISH_RENDITION', ownerConfirmed: true })).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  });

  it('fails closed for unauthorized owner metadata and stale remote resurrection', async () => {
    const service = new MediaLibraryService({ ownerIdentityId: 'alice' });
    const imported = await service.importBytes({ bytes: png(), filename: 'alice.png' });
    await expect(service.ingestRemoteMetadata(imported.asset!, 'bob')).rejects.toMatchObject({ code: 'POLICY_DENIED' });
    await service.trash(imported.asset!.id);
    await service.permanentlyDelete(imported.asset!.id, true);
    await expect(service.ingestRemoteMetadata(imported.asset!, 'alice')).resolves.toBe('IGNORED_TOMBSTONE');
  });

  it('keeps metadata and content boundaries separate', async () => {
    const content = new ContentCacheMediaStore();
    const service = new MediaLibraryService({ content });
    const imported = await service.importBytes({ bytes: png(), filename: 'one.png' });
    const asset = imported.asset as MediaAsset;
    expect(asset).not.toHaveProperty('bytes');
    expect(asset).not.toHaveProperty('absolutePath');
    expect(content.cache.manifest(asset.contentId)?.contentPolicy).toBe('PRIVATE_NO_STRANGER_CACHE');
    expect((await content.read(asset.contentId))?.byteLength).toBeGreaterThan(0);
  });

  it('preserves an original when a platform has no decoder capability and never uses the controlled adapter as fallback', async () => {
    const content = new ContentCacheMediaStore();
    const service = new MediaLibraryService({ content, decoder: new NativeHostMediaDecoderAdapter(createTestNativeHost()) });
    const bytes = png();
    const imported = await service.importBytes({ bytes, filename: 'unsupported-preview.png' });
    expect(imported.asset).toMatchObject({ kind: 'IMAGE', capture: { width: 2, height: 2 } });
    const derivative = await service.requestDerivative(imported.asset!.id, 'THUMBNAIL');
    expect(derivative.state).toBe('UNAVAILABLE');
    expect(await content.read(imported.asset!.contentId)).toEqual(bytes);
    expect(derivative.mimeType).toBeUndefined();
  });

  it('keeps process and decoder implementation details out of platform-neutral Core', async () => {
    const source = await readFile(new URL('./media-library.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/node:child_process|node:fs|ffmpeg|ffprobe|ImageMagick|(^|[^a-z])magick([^a-z]|$)|shell\s*:\s*true/);
  });
});
