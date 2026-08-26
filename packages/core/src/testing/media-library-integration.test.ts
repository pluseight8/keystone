import { describe, expect, it } from 'vitest';
import { ContentCacheMediaStore, DeterministicMediaDerivativeAdapter, MediaLibraryError, MediaLibraryService, type MediaPlacementAdapter, type MediaPlacementRequest, type MediaPlacementState, type MediaShareAdapter, type MediaSharePayload } from '../media-library.js';

const png = (seed = 1) => { const value = new Uint8Array(32); value.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, seed, seed + 1]); new DataView(value.buffer).setUint32(16, 2); new DataView(value.buffer).setUint32(20, 2); return value; };

class OwnedDeviceBridge implements MediaPlacementAdapter {
  offline = false;
  revoked = false;
  private source?: MediaLibraryService;
  constructor(private readonly target: MediaLibraryService) {}
  setSource(source: MediaLibraryService): void { this.source = source; }
  async place(request: MediaPlacementRequest & { readonly contentId: `sha256-${string}` }): Promise<MediaPlacementState> {
    if (this.revoked) throw new MediaLibraryError('POLICY_DENIED', 'Owned-device trust was revoked');
    if (!this.source) throw new MediaLibraryError('UNAVAILABLE', 'Owned-device source is not connected');
    const asset = await this.source.getAsset(request.mediaId, { includeTrash: true });
    if (!asset) throw new MediaLibraryError('NOT_FOUND', 'Source media is unavailable');
    if (this.offline) return { mediaId: request.mediaId, deviceId: request.targetDeviceId, metadata: 'UNAVAILABLE', thumbnail: 'UNAVAILABLE', original: 'PENDING', updatedAt: new Date().toISOString() };
    await this.target.ingestRemoteMetadata(asset, 'owner-alice');
    if (request.mode === 'METADATA') return { mediaId: request.mediaId, deviceId: request.targetDeviceId, metadata: 'AVAILABLE', thumbnail: 'UNAVAILABLE', original: 'UNAVAILABLE', updatedAt: new Date().toISOString() };
    const derivative = await this.source.requestDerivative(request.mediaId, request.mode === 'THUMBNAIL' ? 'THUMBNAIL' : 'PREVIEW');
    if (derivative.state !== 'READY' || !derivative.contentId) throw new MediaLibraryError('UNAVAILABLE', 'Preview is unavailable');
    const derivativeBytes = await this.source.content.read?.(derivative.contentId);
    if (!derivativeBytes) throw new MediaLibraryError('UNAVAILABLE', 'Preview bytes are unavailable');
    await this.target.content.import(derivativeBytes, { mimeType: derivative.mimeType ?? 'application/octet-stream', name: `${asset.filename}.preview` });
    if (request.mode === 'THUMBNAIL') return { mediaId: request.mediaId, deviceId: request.targetDeviceId, metadata: 'AVAILABLE', thumbnail: 'AVAILABLE', original: 'UNAVAILABLE', updatedAt: new Date().toISOString() };
    const original = await this.source.content.read?.(asset.contentId);
    if (!original) throw new MediaLibraryError('UNAVAILABLE', 'Original is unavailable');
    await this.target.content.import(original, { mimeType: asset.mimeType, name: asset.filename });
    return { mediaId: request.mediaId, deviceId: request.targetDeviceId, metadata: 'AVAILABLE', thumbnail: 'AVAILABLE', original: 'AVAILABLE', updatedAt: new Date().toISOString() };
  }
}

class ExplicitSocialBridge implements MediaShareAdapter {
  readonly deliveries: MediaSharePayload[] = [];
  private source?: MediaLibraryService;
  constructor(private readonly receiver: MediaLibraryService) {}
  setSource(source: MediaLibraryService): void { this.source = source; }
  async share(payload: MediaSharePayload) {
    this.deliveries.push(payload);
    if (payload.destination === 'PERSONAL_WEB') return { id: 'publication-1', destination: payload.destination, mode: payload.mode, contentId: payload.contentId, publicCacheable: payload.publicCacheable };
    if (!this.source) throw new MediaLibraryError('UNAVAILABLE', 'Social source is not connected');
    const asset = await this.source.getAsset(payload.mediaId);
    const bytes = await this.source.content.read?.(payload.contentId);
    if (!asset || !bytes) throw new MediaLibraryError('UNAVAILABLE', 'Selected media content is unavailable');
    await this.receiver.importBytes({ bytes, filename: asset.filename, declaredMimeType: payload.metadataPolicy === 'STRIP_LOCATION' ? 'image/png' : asset.mimeType, source: 'RECEIVED_FILE', selectionId: `explicit:${payload.destination}` });
    return { id: `delivery-${payload.destination}`, destination: payload.destination, mode: payload.mode, contentId: payload.contentId, publicCacheable: false };
  }
}

describe('R0P86 owned-device and explicit social integration', () => {
  it('syncs metadata first, preview on request, original on explicit owner action, then respects offline and revocation', async () => {
    const phone = new MediaLibraryService({ ownerIdentityId: 'owner-alice', content: new ContentCacheMediaStore(), derivatives: new DeterministicMediaDerivativeAdapter() });
    const bridge = new OwnedDeviceBridge(phone);
    const withBridge = new MediaLibraryService({ ownerIdentityId: 'owner-alice', content: new ContentCacheMediaStore(), derivatives: new DeterministicMediaDerivativeAdapter(), placement: bridge });
    bridge.setSource(withBridge);
    const imported = await withBridge.importBytes({ bytes: png(5), filename: 'selected.png' });
    const metadata = await withBridge.placeOnDevice({ mediaId: imported.asset!.id, targetDeviceId: 'alice-phone', mode: 'METADATA', ownerConfirmed: true });
    expect(metadata).toMatchObject({ metadata: 'AVAILABLE', thumbnail: 'UNAVAILABLE', original: 'UNAVAILABLE' });
    expect(await phone.getAsset(imported.asset!.id)).toMatchObject({ id: imported.asset!.id });
    expect(await phone.content.read?.(imported.asset!.contentId)).toBeUndefined();
    const preview = await withBridge.placeOnDevice({ mediaId: imported.asset!.id, targetDeviceId: 'alice-phone', mode: 'THUMBNAIL', ownerConfirmed: true });
    expect(preview.thumbnail).toBe('AVAILABLE');
    bridge.offline = true;
    expect((await withBridge.placeOnDevice({ mediaId: imported.asset!.id, targetDeviceId: 'alice-phone', mode: 'ORIGINAL', ownerConfirmed: true })).original).toBe('PENDING');
    bridge.offline = false;
    expect((await withBridge.placeOnDevice({ mediaId: imported.asset!.id, targetDeviceId: 'alice-phone', mode: 'ORIGINAL', ownerConfirmed: true })).original).toBe('AVAILABLE');
    bridge.revoked = true;
    await expect(withBridge.placeOnDevice({ mediaId: imported.asset!.id, targetDeviceId: 'alice-phone', mode: 'ORIGINAL', ownerConfirmed: true })).rejects.toMatchObject({ code: 'POLICY_DENIED' });
  });

  it('delivers only explicitly selected media to Messages/Nearby/Continuity and publishes only a rendition', async () => {
    const receiver = new MediaLibraryService();
    const bridge = new ExplicitSocialBridge(receiver);
    const source = new MediaLibraryService({ share: bridge, derivatives: new DeterministicMediaDerivativeAdapter() });
    bridge.setSource(source);
    const selected = await source.importBytes({ bytes: png(7), filename: 'selected.png' });
    const unselected = await source.importBytes({ bytes: png(8), filename: 'not-selected.png' });
    await source.share({ mediaId: selected.asset!.id, destination: 'MESSAGES', mode: 'COPY', ownerConfirmed: true, targetId: 'bob' });
    await source.share({ mediaId: selected.asset!.id, destination: 'NEARBY', mode: 'COPY', ownerConfirmed: true, targetId: 'bob-nearby' });
    await source.share({ mediaId: selected.asset!.id, destination: 'OWN_DEVICE', mode: 'ALBUM_REFERENCE', ownerConfirmed: true, targetId: 'alice-phone' });
    const publication = await source.share({ mediaId: selected.asset!.id, destination: 'PERSONAL_WEB', mode: 'PUBLISH_RENDITION', ownerConfirmed: true, derivative: 'PREVIEW' });
    expect(bridge.deliveries.map(value => value.mediaId)).toEqual([selected.asset!.id, selected.asset!.id, selected.asset!.id, selected.asset!.id]);
    expect(bridge.deliveries.some(value => value.mediaId === unselected.asset!.id)).toBe(false);
    expect(publication.publicCacheable).toBe(true);
    expect(publication.contentId).not.toBe(selected.asset!.contentId);
    expect(bridge.deliveries.find(value => value.destination === 'PERSONAL_WEB')).toMatchObject({ sourceContentId: selected.asset!.contentId, publicCacheable: true });
    expect(await receiver.getAsset(selected.asset!.id)).toMatchObject({ filename: 'selected.png' });
  });
});
