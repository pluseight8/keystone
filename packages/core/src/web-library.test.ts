import { describe, expect, it } from 'vitest';
import {
  ContentCacheWebLibraryStore,
  InMemoryWebLibraryStateStore,
  WebCaptureService,
  WebLibraryError,
  WebLibraryService,
  createWebArchiveBundle,
  importWebArchiveBundle,
  sanitizeArchivedHtml,
  type WebCaptureAdapter,
  type WebCapturedPage,
  type WebLibraryShareBoundary,
} from './web-library.js';

const URL_VALUE = 'https://example.test/articles/keystone?utm_source=test&token=should-not-persist';

function page(input: Partial<WebCapturedPage> = {}): WebCapturedPage {
  return {
    requestedUrl: URL_VALUE,
    finalUrl: 'https://example.test/articles/keystone',
    title: 'Keystone Reader',
    html: '<article><h1>Keystone Reader</h1><p>Hello from the local archive.</p></article>',
    ...input,
  };
}

function adapterFrom(factory: (count: number) => WebCapturedPage | Promise<WebCapturedPage>): WebCaptureAdapter {
  let count = 0;
  return { capture: async () => factory(count++) };
}

describe('WebLibraryService', () => {
  it('keeps bookmark-only saves metadata-only and supports organization/search', async () => {
    const library = new WebLibraryService({ stateStore: new InMemoryWebLibraryStateStore() });
    const collection = await library.createCollection('Research');
    const entry = await library.saveBookmark({ url: URL_VALUE, title: 'Keystone Reader', collectionIds: [collection.id], tags: ['reference'], favorite: true });
    await library.addToReadLater(entry.id);

    expect(entry.kind).toBe('BOOKMARK');
    expect(entry.revisionIds).toHaveLength(0);
    expect(entry.sourceUrl).not.toContain('token=');
    expect((await library.listEntries({ collectionId: collection.id }))).toHaveLength(1);
    expect((await library.listEntries({ collectionId: 'read-later' }))).toHaveLength(1);
    expect((await library.search({ query: 'reference', includeRead: true }))[0]?.matchedFields).toContain('tag');
    expect((await library.search({ query: 'example.test', includeRead: true }))[0]?.matchedFields).toContain('hostname');
  });

  it('captures an explicit safe archive and renders only static local content', async () => {
    const library = new WebLibraryService({ content: new ContentCacheWebLibraryStore() });
    const malicious = page({
      html: `<!doctype html><html><head><style>body { background: url(https://tracker.test/pixel) }</style></head><body>
        <h1>Safe article</h1><p onclick="window.executed = true">Hello <a href="https://outside.test/read">outside</a></p>
        <script>window.executed = true</script><iframe src="https://evil.test/frame"></iframe>
        <form action="https://evil.test/submit"><input name="secret" value="x"></form>
        <img src="https://example.test/hero.png" onerror="window.executed = true" alt="Hero">
        <img src="javascript:alert(1)" alt="Unsafe">
      </body></html>`,
      resources: [{ originalUrl: 'https://example.test/hero.png', bytes: new TextEncoder().encode('image'), mimeType: 'image/png', kind: 'IMAGE' }],
    });
    const result = await library.capture({ url: URL_VALUE, mode: 'SAFE_PAGE_ARCHIVE', ownerConfirmed: true }, { capture: async () => malicious });
    expect(result.state).toBe('READY');
    expect(result.revision).toBeDefined();
    const render = await library.render(result.entry.id);
    expect(render).toBeDefined();
    expect(render?.html).toContain('Safe article');
    expect(render?.html).toContain('data-keystone-resource');
    expect(render?.html).not.toMatch(/<script|<form|<iframe|onclick|onerror|javascript:|src=/i);
    expect(render?.externalRequestCount).toBe(0);
    expect(render?.scriptsExecuted).toBe(0);
    expect(render?.formsSubmitted).toBe(0);
    expect(render?.missingResources).toHaveLength(0);
    expect(render?.externalLinks.map(link => link.url)).toContain('https://outside.test/read');
  });

  it('creates immutable revisions and bounded text diffs', async () => {
    const library = new WebLibraryService();
    const capture = adapterFrom(count => page({ html: `<article><h1>Revision ${count + 1}</h1><p>${count === 0 ? 'first text' : 'second text'}</p></article>` }));
    const first = await library.capture({ url: URL_VALUE, mode: 'READER_SNAPSHOT', ownerConfirmed: true }, capture);
    const second = await library.refresh(first.entry.id, capture, { mode: 'READER_SNAPSHOT', ownerConfirmed: true });
    expect(second.revision).toBeDefined();
    const revisions = await library.listRevisions(first.entry.id);
    expect(revisions).toHaveLength(2);
    expect(revisions[0]?.readerDocument.text).toContain('first text');
    expect(revisions[1]?.readerDocument.text).toContain('second text');
    const diff = await library.diff(first.entry.id, revisions[0]!.id, revisions[1]!.id);
    expect(diff.addedLines + diff.removedLines).toBeGreaterThan(0);
    expect((await library.getRevision(first.entry.id, revisions[0]!.id))?.readerDocument.text).toContain('first text');
  });

  it('anchors highlights to an exact revision and indexes notes', async () => {
    const library = new WebLibraryService();
    const captured = await library.capture({ url: URL_VALUE, mode: 'READER_SNAPSHOT', ownerConfirmed: true }, { capture: async () => page() });
    const revision = captured.revision!;
    const text = revision.readerDocument.text;
    const quote = 'Hello from the local archive.';
    const start = text.indexOf(quote);
    const highlight = await library.addHighlight({ entryId: captured.entry.id, revisionId: revision.id, start, end: start + quote.length, quote, note: 'Keep this detail' });
    await library.addNote({ entryId: captured.entry.id, revisionId: revision.id, body: 'Follow up on this source' });
    expect(highlight.kind).toBe('HIGHLIGHT');
    expect(await library.listAnnotations(captured.entry.id, revision.id)).toHaveLength(2);
    expect((await library.search({ query: 'Follow up', includeRead: true }))[0]?.matchedFields).toContain('annotation');
    await expect(library.addHighlight({ entryId: captured.entry.id, revisionId: revision.id, start, end: start + 2, quote: 'nope' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('round-trips an explicit private archive bundle between independent libraries', async () => {
    const source = new WebLibraryService();
    const captured = await source.capture({ url: URL_VALUE, mode: 'SAFE_PAGE_ARCHIVE', ownerConfirmed: true }, { capture: async () => page({ resources: [{ originalUrl: 'https://example.test/hero.png', bytes: new TextEncoder().encode('image'), mimeType: 'image/png', kind: 'IMAGE' }] }) });
    const bundle = await createWebArchiveBundle(source, captured.entry.id);
    const target = new WebLibraryService();
    const imported = await importWebArchiveBundle(target, bundle, { resolve: async contentId => source.content.read(contentId) });
    expect(imported.id).toBe(captured.entry.id);
    expect((await target.listRevisions(imported.id))).toHaveLength(1);
    const render = await target.render(imported.id);
    expect(render?.html).toContain('Keystone Reader');
    expect(render?.externalRequestCount).toBe(0);
    expect(bundle.manifests.every(manifest => manifest.contentPolicy === 'PRIVATE_NO_STRANGER_CACHE')).toBe(true);
  });

  it('keeps owned-device, nearby, personal-web and Vault transfer behind explicit adapters', async () => {
    const library = new WebLibraryService();
    const captured = await library.capture({ url: URL_VALUE, mode: 'SAFE_PAGE_ARCHIVE', ownerConfirmed: true }, { capture: async () => page() });
    const destinations: Array<'OWNED_DEVICE' | 'NEARBY' | 'PERSONAL_WEB'> = ['OWNED_DEVICE', 'NEARBY', 'PERSONAL_WEB'];
    const shares: Array<{ destination: string; contentId?: string; ownerConfirmed: boolean }> = [];
    const shareBoundary: WebLibraryShareBoundary = {
      share: async input => {
        shares.push({ destination: input.destination, contentId: input.plan.contentId, ownerConfirmed: input.ownerConfirmed });
        return { id: `${input.destination.toLowerCase()}-copy`, destination: input.destination };
      },
    };

    for (const destination of destinations) {
      await expect(library.share(captured.entry.id, shareBoundary, { destination, targetId: 'explicit-target', ownerConfirmed: true })).resolves.toMatchObject({ destination });
    }
    expect(shares).toHaveLength(3);
    expect(shares.every(value => value.ownerConfirmed && value.contentId)).toBe(true);

    const vaultCalls: Array<{ title: string; markdown: string; sourceUrl: string }> = [];
    await expect(library.exportToVault(captured.entry.id, {
      createNote: async input => {
        vaultCalls.push({ title: input.title, markdown: input.markdown, sourceUrl: input.provenance.sourceUrl });
        return { noteId: 'vault-note-1' };
      },
    })).resolves.toEqual({ noteId: 'vault-note-1' });
    expect(vaultCalls[0]).toMatchObject({ title: 'Keystone Reader', sourceUrl: 'https://example.test/articles/keystone?utm_source=test' });
    expect(vaultCalls[0]?.markdown).toContain('Hello from the local archive.');

    await expect(library.share(captured.entry.id, shareBoundary, { destination: 'NEARBY', ownerConfirmed: false as true })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('fails closed for unsafe URLs, malformed resources, and sanitizer execution primitives', async () => {
    const library = new WebLibraryService();
    await expect(library.saveBookmark({ url: 'file:///etc/passwd' })).rejects.toMatchObject({ code: 'INVALID_URL' });
    await expect(library.saveBookmark({ url: 'javascript:alert(1)' })).rejects.toMatchObject({ code: 'INVALID_URL' });
    await expect(library.saveBookmark({ url: 'https://user:password@example.test/' })).rejects.toMatchObject({ code: 'INVALID_URL' });
    const sanitized = sanitizeArchivedHtml('<script>bad()</script><form action="https://evil.test"><input></form><svg onload="bad()"></svg><p onmouseover="bad()">text</p>');
    expect(sanitized.blockedTags).toEqual(expect.arrayContaining(['script', 'form', 'svg']));
    expect(sanitized.formsBlocked).toBeGreaterThan(0);
    expect(sanitized.html).not.toMatch(/<(?:script|form|svg)\b|on(?:load|mouseover)\s*=/i);
    const failed = await library.capture({ url: URL_VALUE, mode: 'SAFE_PAGE_ARCHIVE', ownerConfirmed: true }, { capture: async () => page({ resources: [{ originalUrl: 'file:///secret', bytes: new Uint8Array([1]), mimeType: 'image/png', kind: 'IMAGE' }] }) });
    expect(failed.state).toBe('FAILED');
    expect(failed.error).not.toContain('/secret');
  });

  it('bounds queued captures and rejects pre-start cancellation without a fake entry', async () => {
    const library = new WebLibraryService();
    let release!: () => void;
    const firstStarted = new Promise<void>(resolve => { release = resolve; });
    const slow: WebCaptureAdapter = { capture: async () => { await firstStarted; return page(); } };
    const first = new WebCaptureService(library, { maxConcurrent: 1, maxQueue: 1 });
    const firstJob = first.capture({ url: URL_VALUE, mode: 'READER_SNAPSHOT', ownerConfirmed: true }, slow);
    const controller = new AbortController();
    const secondJob = first.capture({ url: 'https://example.test/second', mode: 'READER_SNAPSHOT', ownerConfirmed: true }, slow, controller.signal);
    controller.abort();
    release();
    await expect(secondJob).rejects.toMatchObject({ code: 'CANCELED' });
    await expect(firstJob).resolves.toMatchObject({ state: 'READY' });
    expect((await library.listEntries({ includeTrash: true }))).toHaveLength(1);
  });
});

describe('WebLibraryError surface', () => {
  it('keeps errors typed', () => {
    const error = new WebLibraryError('INVALID_ARGUMENT', 'invalid');
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('INVALID_ARGUMENT');
  });
});
