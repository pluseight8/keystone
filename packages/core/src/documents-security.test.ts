import { describe, expect, it } from 'vitest';
import { DocumentService, EpubDocumentAdapter, PdfDocumentAdapter, StaticDocumentFileSource } from './documents.js';
import { buildTextPdf, buildZip, bytes, documentRef, epubFixture } from './documents-fixtures.js';

describe('R0P93 document security boundaries', () => {
  it('detects PDF active-content markers and never executes them', async () => {
    const source = buildTextPdf(['untrusted PDF text'], { title: 'Untrusted', hostileActions: true });
    const model = await new PdfDocumentAdapter().open({ file: documentRef('hostile-pdf', 'hostile.pdf', 'application/pdf', source), bytes: source });
    expect(model.security).toMatchObject({ javascript: false, launch: false, automaticFormSubmission: false, embeddedFilesAutoOpened: false });
    expect(model.security?.blockedActions).toEqual(expect.arrayContaining(['JAVASCRIPT', 'LAUNCH', 'SUBMIT_FORM', 'EMBEDDED_FILE', 'GOTO_REMOTE', 'PRIVILEGED_URI']));
    expect(model.security?.externalLinks.some(link => link.kind === 'BLOCKED' && link.requiresExplicitAction)).toBe(true);
    expect((await model.renderPage?.(1))?.scriptsExecuted).toBe(0);
    expect((await model.renderPage?.(1))?.formsSubmitted).toBe(0);
  });

  it('rejects EPUB traversal, encrypted containers and expansion bombs before rendering', async () => {
    const traversal = buildZip([{ path: 'META-INF/container.xml', data: bytes('<container><rootfiles><rootfile full-path="../evil.opf"/></rootfiles></container>') }]);
    await expect(new EpubDocumentAdapter().open({ file: documentRef('traversal', 'bad.epub', 'application/epub+zip', traversal), bytes: traversal })).rejects.toMatchObject({ code: 'MALFORMED' });
    const bomb = buildZip([{ path: 'bomb', data: new Uint8Array(1_000_000), deflate: true }]);
    await expect(new EpubDocumentAdapter().open({ file: documentRef('bomb', 'bomb.epub', 'application/epub+zip', bomb), bytes: bomb })).rejects.toMatchObject({ code: 'RESOURCE_LIMIT' });
    const valid = epubFixture();
    const forged = valid.slice();
    forged[0] = 0;
    await expect(new EpubDocumentAdapter().open({ file: documentRef('forged', 'forged.epub', 'application/epub+zip', forged), bytes: forged })).rejects.toMatchObject({ code: 'MALFORMED' });
  });

  it('requires exact immutable revisions and explicit owner actions', async () => {
    const markdown = bytes('# Private\n\nOwner text');
    const source = new StaticDocumentFileSource(async file => file.fileId === 'private-md' ? markdown.slice() : undefined, [documentRef('private-md', 'private.md', 'text/markdown', markdown)]);
    const calls: unknown[] = [];
    const service = new DocumentService({ files: source, ownerId: 'owner', integrations: { tasks: { async createTask(value) { calls.push(value); return value; } } } });
    const reader = await service.open('private-md');
    const stale = { ...reader.pages[0]!.locator, revision: { ...reader.document.revision, revisionId: 'stale-revision' } };
    await expect(service.addNote(reader.document.documentId, { locator: stale, body: 'stale' })).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(service.createTask(reader.document.documentId, { text: 'make task', locator: reader.pages[0]!.locator, ownerConfirmed: false as never })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(calls).toHaveLength(0);
  });
});
