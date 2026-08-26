import { describe, expect, it } from 'vitest';
import { WebLibraryService, type WebCaptureAdapter, type WebCapturedPage } from '../web-library.js';

function capturedPage(url: string): WebCapturedPage {
  return { requestedUrl: url, finalUrl: url, title: `Scale article ${url.split('/').at(-1)}`, html: `<article><h1>Scale article</h1><p>Bounded reader content for scale validation.</p></article>` };
}

describe('R0P87 Web Library scale/endurance', () => {
  it('handles 10k metadata/annotations, 100 captures and 1k offline reader opens within bounded resources', async () => {
    const library = new WebLibraryService({ maxEntries: 20_000, maxAnnotations: 20_000, maxRevisionsPerEntry: 8 });
    const metadata = Array.from({ length: 10_000 }, (_, index) => ({ url: `https://scale.example.test/article/${index}`, title: `Scale item ${index}`, tags: [`batch-${index % 20}`] }));
    const started = performance.now();
    const saved = await library.saveBookmarks(metadata);
    expect(saved).toHaveLength(10_000);
    const metadataMs = performance.now() - started;

    const adapter: WebCaptureAdapter = { capture: async request => capturedPage(request.url) };
    for (let index = 0; index < 100; index += 1) {
      const url = `https://scale.example.test/capture/${index}`;
      const outcome = await library.capture({ url, mode: 'READER_SNAPSHOT', ownerConfirmed: true }, adapter);
      expect(outcome.state).toBe('READY');
    }
    const archived = await library.capture({ url: metadata[0]!.url, mode: 'READER_SNAPSHOT', ownerConfirmed: true }, adapter);
    expect(archived.revision).toBeDefined();
    const revision = archived.revision!;
    const notes = await library.addNotes(Array.from({ length: 10_000 }, (_, index) => ({ entryId: archived.entry.id, revisionId: revision.id, body: `scale annotation ${index}` })));
    expect(notes).toHaveLength(10_000);

    let last = await library.render(archived.entry.id);
    for (let index = 0; index < 999; index += 1) last = await library.render(archived.entry.id);
    expect(last?.externalRequestCount).toBe(0);
    expect(last?.scriptsExecuted).toBe(0);
    expect(last?.formsSubmitted).toBe(0);
    const diagnostics = library.diagnostics();
    expect(diagnostics.entries).toBe(10_100);
    expect(diagnostics.annotations).toBe(10_000);
    expect(diagnostics.indexedTerms).toBeGreaterThan(0);
    expect(metadataMs).toBeLessThan(30_000);
  }, 180_000);
});
