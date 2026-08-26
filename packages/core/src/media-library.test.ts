import { describe, expect, it } from 'vitest';
import {
  ContentCacheMediaStore,
  DeterministicMediaDerivativeAdapter,
  InMemoryMediaLibraryStateStore,
  MediaLibraryError,
  MediaLibraryService,
  mediaIdFor,
  type MediaPlacementAdapter,
  type MediaShareAdapter,
} from './media-library.js';

function png(width = 2, height = 3): Uint8Array {
  const value = new Uint8Array(32);
  value.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  new DataView(value.buffer).setUint32(16, width);
  new DataView(value.buffer).setUint32(20, height);
  return value;
}

function mp4(): Uint8Array {
  const value = new Uint8Array(20);
  value.set([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
  return value;
}

describe('R0P86 private media library', () => {
  it('imports images and videos through content identity and reports exact duplicates', async () => {
    const content = new ContentCacheMediaStore();
    const service = new MediaLibraryService({ content });
    const image = await service.importBytes({ bytes: png(), filename: 'trip.png', declaredMimeType: 'image/png', modifiedAt: '2026-01-02T00:00:00.000Z' });
    const duplicate = await service.importBytes({ bytes: png(), filename: 'renamed.png', declaredMimeType: 'image/png' });
    const video = await service.importBytes({ bytes: mp4(), filename: 'clip.mp4', declaredMimeType: 'video/mp4' });
    expect(image.job.state).toBe('IMPORTED');
    expect(image.asset).toMatchObject({ kind: 'IMAGE', mimeType: 'image/png', capture: { width: 2, height: 3 } });
    expect(duplicate.job.state).toBe('DUPLICATE');
    expect(duplicate.duplicateOf?.id).toBe(image.asset?.id);
    expect(video.asset?.kind).toBe('VIDEO');
    expect(content.cache.manifest(image.asset!.contentId)?.contentPolicy).toBe('PRIVATE_NO_STRANGER_CACHE');
    expect(service.diagnostics()).toMatchObject({ activeAssets: 2, importJobs: 3 });
  });

  it('imports only explicitly selected folder/camera-roll candidates and preserves partial failures', async () => {
    const service = new MediaLibraryService();
    const result = await service.importSource({
      kind: 'SELECTED_FOLDER',
      selectionId: 'owner-selection-1',
      async list() {
        return [
          { name: 'ok.png', read: async () => png() },
          { name: '../path.png', read: async () => png() },
          { name: 'video.mp4', read: async () => mp4() },
        ];
      },
    });
    expect(result.imported).toBe(2);
    expect(result.failed).toBe(1);
    expect(new Set((await service.listAssets()).map(value => value.filename))).toEqual(new Set(['video.mp4', 'ok.png']));
    expect(service.watchedFoldersList()).toEqual([]);
    await service.registerWatchedFolder('owner-selection-1');
    await service.stopWatchedFolder('owner-selection-1');
    expect(service.watchedFoldersList()[0]).toMatchObject({ selectionId: 'owner-selection-1', enabled: false });
  });

  it('keeps albums, favorites, tags and search local, and exposes embedded GPS only by explicit map action', async () => {
    const service = new MediaLibraryService({ probe: { async probe() { return { kind: 'IMAGE', mimeType: 'image/png', metadata: { gps: { latitude: 55.75, longitude: 37.61, source: 'EMBEDDED_EXIF' }, captureTime: '2026-02-03T04:05:06.000Z' } }; } } });
    const imported = await service.importBytes({ bytes: png(), filename: 'Moscow trip.png', declaredMimeType: 'image/png' });
    const asset = await service.updateAsset(imported.asset!.id, { favorite: true, tags: ['Trip', 'city'], caption: 'Morning walk' });
    const album = await service.createAlbum('Trip');
    await service.addToAlbum(album.id, [asset.id]);
    expect((await service.search({ query: 'morning city', limit: 10 }))[0]?.asset.id).toBe(asset.id);
    await expect(service.mapProjection({ ownerConfirmed: false })).rejects.toMatchObject({ code: 'POLICY_DENIED' });
    expect(await service.mapProjection({ ownerConfirmed: true })).toMatchObject([{ mediaId: asset.id, location: { latitude: 55.75, longitude: 37.61 } }]);
    expect((await service.albumAssets(album.id))[0]?.favorite).toBe(true);
  });

  it('regenerates a missing derivative, supports non-destructive edit recipes and never changes the original', async () => {
    const content = new ContentCacheMediaStore();
    const service = new MediaLibraryService({ content, derivatives: new DeterministicMediaDerivativeAdapter() });
    const imported = await service.importBytes({ bytes: png(), filename: 'edit.png' });
    const first = await service.requestDerivative(imported.asset!.id, 'THUMBNAIL', { width: 160, height: 160 });
    expect(first.state).toBe('READY');
    await content.removeLocalCopy(first.contentId!);
    const regenerated = await service.requestDerivative(imported.asset!.id, 'THUMBNAIL', { width: 160, height: 160 });
    expect(regenerated.state).toBe('READY');
    const edited = await service.exportEdited(imported.asset!.id, { version: 1, operations: [{ type: 'ROTATE', degrees: 90 }, { type: 'CROP', left: 0, top: 0, width: 1, height: 2 }] });
    expect(edited.contentId).not.toBe(imported.asset!.contentId);
    expect((await service.getAsset(imported.asset!.id))?.contentId).toBe(imported.asset!.contentId);
  });

  it('enforces explicit sharing, keeps private originals out of public cache and uses selected-device placement', async () => {
    const shares: unknown[] = [];
    const share: MediaShareAdapter = { async share(payload) { shares.push(payload); return { id: 'receipt-1', destination: payload.destination, mode: payload.mode, contentId: payload.contentId, publicCacheable: payload.publicCacheable }; } };
    const placement: MediaPlacementAdapter = { async place(request) { return { mediaId: request.mediaId, deviceId: request.targetDeviceId, metadata: 'AVAILABLE', thumbnail: request.mode === 'THUMBNAIL' ? 'AVAILABLE' : 'UNAVAILABLE', original: request.mode === 'ORIGINAL' ? 'PENDING' : 'UNAVAILABLE', updatedAt: new Date(0).toISOString() }; } };
    const service = new MediaLibraryService({ share, placement, derivatives: new DeterministicMediaDerivativeAdapter() });
    const imported = await service.importBytes({ bytes: png(), filename: 'share.png' });
    await expect(service.share({ mediaId: imported.asset!.id, destination: 'MESSAGES', mode: 'COPY', ownerConfirmed: false })).rejects.toMatchObject({ code: 'POLICY_DENIED' });
    const receipt = await service.share({ mediaId: imported.asset!.id, destination: 'PERSONAL_WEB', mode: 'PUBLISH_RENDITION', ownerConfirmed: true, derivative: 'PREVIEW' });
    expect(receipt.publicCacheable).toBe(true);
    expect(receipt.contentId).not.toBe(imported.asset!.contentId);
    expect(shares[0]).toMatchObject({ sourceContentId: imported.asset!.contentId, publicCacheable: true });
    const placementState = await service.placeOnDevice({ mediaId: imported.asset!.id, targetDeviceId: 'phone-1', mode: 'THUMBNAIL', ownerConfirmed: true });
    expect(placementState.thumbnail).toBe('AVAILABLE');
  });

  it('uses trash tombstones to prevent stale remote resurrection and supports restore before permanent deletion', async () => {
    const state = new InMemoryMediaLibraryStateStore();
    const first = new MediaLibraryService({ state });
    const imported = await first.importBytes({ bytes: png(), filename: 'delete.png' });
    await first.trash(imported.asset!.id);
    expect((await first.getAsset(imported.asset!.id))?.state).toBeUndefined();
    expect((await first.getAsset(imported.asset!.id, { includeTrash: true }))?.state).toBe('TRASHED');
    await first.restore(imported.asset!.id);
    expect((await first.getAsset(imported.asset!.id))?.state).toBe('ACTIVE');
    await first.trash(imported.asset!.id);
    await first.permanentlyDelete(imported.asset!.id, true);
    expect(first.tombstone(imported.asset!.id)?.reason).toBe('PERMANENT_DELETE');
    const restarted = new MediaLibraryService({ state });
    await restarted.ready();
    expect(await restarted.ingestRemoteMetadata(imported.asset!, undefined)).toBe('IGNORED_TOMBSTONE');
  });

  it('recovers interrupted jobs without exposing a half-imported asset', async () => {
    const state = new InMemoryMediaLibraryStateStore();
    await state.write({ version: 1, assets: {}, albums: {}, jobs: { 'job-1': { version: 1, id: 'job-1', state: 'IMPORTING', filename: 'partial.png', source: 'SELECTED_FOLDER', startedAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString() } }, derivatives: {}, placements: {}, tombstones: {}, watchedFolders: {} });
    const service = new MediaLibraryService({ state });
    await service.ready();
    const snapshot = await state.read() as { jobs: Record<string, { state: string; error?: string }> };
    expect(snapshot.jobs['job-1']).toMatchObject({ state: 'FAILED' });
    expect(service.diagnostics().activeAssets).toBe(0);
  });

  it('rejects hostile signatures, traversal names and decompression-bomb dimensions', async () => {
    const service = new MediaLibraryService();
    await expect(service.importBytes({ bytes: Uint8Array.from([0xff, 0xd8, 0xff]), filename: 'broken.jpg' })).rejects.toMatchObject({ code: 'UNSUPPORTED_MEDIA' });
    await expect(service.importBytes({ bytes: png(100_001, 100_001), filename: 'huge.png' })).rejects.toMatchObject({ code: 'RESOURCE_LIMIT' });
    await expect(service.importBytes({ bytes: png(), filename: '../escape.png' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(mediaIdFor('sha256-' + 'a'.repeat(64) as `sha256-${string}`)).toMatch(/^media:sha256-/);
    expect(() => mediaIdFor('sha256-forged' as `sha256-${string}`)).toThrow(MediaLibraryError);
  });
});
