import { describe, expect, it } from 'vitest';
import { InMemoryMediaLibraryStateStore, MediaLibraryService, mediaIdFor, type MediaAsset } from '../media-library.js';
import type { ContentId } from '../social/content.js';

function contentId(index: number): ContentId { return `sha256-${index.toString(16).padStart(64, '0')}` as ContentId; }
function asset(index: number): MediaAsset { const content = contentId(index + 1); return { version: 1, id: mediaIdFor(content), contentId: content, filename: `asset-${index}.png`, mimeType: 'image/png', kind: 'IMAGE', byteLength: 128, importedAt: new Date(1_700_000_000_000 + index).toISOString(), state: 'ACTIVE', capture: { width: 2, height: 2, captureTime: new Date(1_700_000_000_000 + index).toISOString(), captureTimeSource: 'EMBEDDED_METADATA', metadataTruncated: false }, tags: index % 2 === 0 ? ['scale', 'even'] : ['scale', 'odd'], favorite: index % 10 === 0, source: { kind: 'LOCAL_FILE' } }; }

describe('R0P86 media scale and bounded metadata indexing', () => {
  it('hydrates and queries 100k metadata records without original bytes or per-asset timers', async () => {
    const assets = Object.fromEntries(Array.from({ length: 100_000 }, (_, index) => { const value = asset(index); return [value.id, value]; }));
    const state = new InMemoryMediaLibraryStateStore();
    await state.write({ version: 1, assets, albums: {}, jobs: {}, derivatives: {}, placements: {}, tombstones: {}, watchedFolders: {} });
    const service = new MediaLibraryService({ state });
    await service.ready();
    const page = await service.listTimeline({ limit: 100 });
    const results = await service.search({ query: 'asset 99999', limit: 5 });
    expect(page.total).toBe(100_000);
    expect(page.items).toHaveLength(100);
    expect(results).toHaveLength(1);
    expect(results[0]?.asset.filename).toBe('asset-99999.png');
    expect(service.diagnostics()).toMatchObject({ assets: 100_000, activeAssets: 100_000, derivativeWorkers: 0, derivativeQueue: 0 });
  }, 60_000);

  it('keeps 1000 album references bounded and does not duplicate content records', async () => {
    const assets = Object.fromEntries(Array.from({ length: 10_000 }, (_, index) => { const value = asset(index); return [value.id, value]; }));
    const albums = Object.fromEntries(Array.from({ length: 1_000 }, (_, index) => { const ids = Array.from({ length: 10 }, (_, offset) => asset(index * 10 + offset).id); const value = { version: 1 as const, id: `album-${index}`, name: `Album ${index}`, assetIds: ids, createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(), sharing: 'PRIVATE' as const }; return [value.id, value]; }));
    const state = new InMemoryMediaLibraryStateStore();
    await state.write({ version: 1, assets, albums, jobs: {}, derivatives: {}, placements: {}, tombstones: {}, watchedFolders: {} });
    const service = new MediaLibraryService({ state });
    await service.ready();
    expect((await service.listAlbums())).toHaveLength(1_000);
    expect((await service.albumAssets('album-999'))).toHaveLength(10);
    expect(service.diagnostics()).toMatchObject({ assets: 10_000, albums: 1_000 });
  }, 60_000);
});
