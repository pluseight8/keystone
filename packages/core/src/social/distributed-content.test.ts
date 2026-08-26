import { describe, expect, it } from 'vitest';
import {
  ContentCache,
  createContentManifest,
  sha256,
  type ContentId,
  type ContentManifest,
} from './content.js';
import {
  ContentTransferError,
  DistributedContentService,
  InMemoryContentTransferStateStore,
  type DistributedContentSource,
} from './distributed-content.js';

const bytes = (size: number): Uint8Array => Uint8Array.from({ length: size }, (_, index) => index % 251);

class Source implements DistributedContentSource {
  active = 0;
  peak = 0;
  calls = 0;
  constructor(readonly id: string, readonly scope: DistributedContentSource['scope'], private readonly value: Uint8Array, private readonly manifest: ContentManifest, private readonly corrupt = false, private readonly fail: ReadonlySet<number> = new Set()) {}
  async getChunk(_contentId: ContentId, index: number): Promise<Uint8Array> {
    this.calls++; this.active++; this.peak = Math.max(this.peak, this.active);
    try {
      if (this.fail.has(index)) throw new Error(`${this.id} unavailable`);
      const start = index * this.manifest.chunkSize;
      const part = this.value.subarray(start, Math.min(this.value.length, start + this.manifest.chunkSize));
      await new Promise(resolve => setTimeout(resolve, 1));
      return this.corrupt ? Uint8Array.from(part, byte => byte ^ 0xff) : part;
    } finally { this.active--; }
  }
}

describe('DistributedContentService', () => {
  it('creates a bounded multi-source transfer and verifies every chunk/final hash', async () => {
    const source = bytes(160 * 1024);
    const manifest = await createContentManifest(source, { mimeType: 'application/octet-stream', chunkSize: 16 * 1024, contentPolicy: 'PUBLIC_CACHEABLE' });
    const corrupt = new Source('cache-corrupt', 'PUBLIC_CACHE', source, manifest, true);
    const healthy = new Source('cache-healthy', 'PUBLIC_CACHE', source, manifest);
    const service = new DistributedContentService({ cache: new ContentCache(source.length * 2), maxInFlightChunks: 4, maxRequestsPerSource: 2 });
    const result = await service.download({ manifest, sources: [corrupt, healthy], authorization: { scope: 'PUBLIC' } });
    expect(result).toEqual(source);
    expect(corrupt.calls).toBeGreaterThan(0);
    expect(healthy.calls).toBeGreaterThan(0);
    expect(Math.max(corrupt.peak, healthy.peak)).toBeLessThanOrEqual(2);
    expect(service.diagnostics().peakInFlightChunks).toBeLessThanOrEqual(4);
    expect(service.session(manifest.contentId)?.state.state).toBe('COMPLETE');
  });

  it('keeps private hashes from acting as authorization and allows owned-device scope only', async () => {
    const source = bytes(40_000);
    const manifest = await createContentManifest(source, { mimeType: 'application/octet-stream', chunkSize: 16 * 1024, contentPolicy: 'OWNED_DEVICES' });
    const provider = new Source('owned-laptop', 'OWNED_DEVICE', source, manifest);
    const service = new DistributedContentService({ cache: new ContentCache(100_000) });
    await expect(service.download({ manifest, sources: [provider] })).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    await expect(service.download({ manifest, sources: [provider], authorization: { scope: 'AUTHORIZED_GROUP' } })).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    await expect(service.download({ manifest, sources: [provider], authorization: { scope: 'OWNER', subjectId: 'alice' } })).resolves.toEqual(source);
  });

  it('persists verified partial progress and resumes after a service/cache restart', async () => {
    const source = bytes(96 * 1024);
    const manifest = await createContentManifest(source, { mimeType: 'application/octet-stream', chunkSize: 16 * 1024, contentPolicy: 'PUBLIC_CACHEABLE' });
    const cacheState = new InMemoryContentTransferStateStore();
    const cache = new ContentCache(source.length * 2);
    const provider = new Source('origin', 'PUBLIC_CACHE', source, manifest);
    const first = new DistributedContentService({ cache, transferState: cacheState, maxInFlightChunks: 1 });
    await expect(first.download({ manifest, sources: [provider], authorization: { scope: 'PUBLIC' }, maxChunks: 2 })).rejects.toMatchObject({ code: 'PAUSED' });
    expect(cache.missing(manifest).length).toBe(manifest.chunks.length - 2);
    const restarted = new DistributedContentService({ cache, transferState: cacheState, maxInFlightChunks: 2 });
    await restarted.ready();
    const resumed = await restarted.download({ manifest, sources: [provider], authorization: { scope: 'PUBLIC' } });
    expect(resumed).toEqual(source);
    expect(provider.calls).toBeLessThan(manifest.chunks.length + 2);
    expect(restarted.session(manifest.contentId)?.state.state).toBe('COMPLETE');
  });

  it('fails closed on malformed manifests and wrong source lengths', async () => {
    const source = bytes(40_000);
    const manifest = await createContentManifest(source, { mimeType: 'application/octet-stream', chunkSize: 16 * 1024, contentPolicy: 'PUBLIC_CACHEABLE' });
    const malformed = { ...manifest, chunks: [...manifest.chunks, manifest.chunks[0]] } as ContentManifest;
    const service = new DistributedContentService({ cache: new ContentCache(100_000) });
    await expect(service.download({ manifest: malformed, sources: [], authorization: { scope: 'PUBLIC' } })).rejects.toMatchObject({ code: 'INVALID_MANIFEST' });
    const wrongLength: DistributedContentSource = { id: 'wrong-length', scope: 'PUBLIC_CACHE', async getChunk() { return new Uint8Array(1); } };
    await expect(service.download({ manifest, sources: [wrongLength], authorization: { scope: 'PUBLIC' } })).rejects.toBeInstanceOf(ContentTransferError);
  });

  it('supports a bounded sink without retaining a whole-content assembly buffer', async () => {
    const source = bytes(128 * 1024);
    const manifest = await createContentManifest(source, { mimeType: 'application/octet-stream', chunkSize: 16 * 1024, contentPolicy: 'PUBLIC_CACHEABLE' });
    const provider = new Source('origin', 'PUBLIC_CACHE', source, manifest);
    const service = new DistributedContentService({ cache: new ContentCache(source.length * 2), maxInFlightChunks: 2 });
    const received = new Map<number, Uint8Array>();
    await service.downloadTo({ manifest, sources: [provider], authorization: { scope: 'PUBLIC' } }, async (chunk, index) => { received.set(index, chunk); });
    const rebuilt = new Uint8Array(source.length); for (let index = 0; index < manifest.chunks.length; index++) rebuilt.set(received.get(index)!, index * manifest.chunkSize);
    expect(`sha256-${await sha256(rebuilt)}`).toBe(manifest.contentId);
    expect(received.size).toBe(manifest.chunks.length);
  });
});
