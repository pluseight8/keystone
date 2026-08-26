import { describe, expect, it } from 'vitest';
import {
  ControlledOcrAdapter,
  DocumentCaptureService,
  DocumentError,
  DocumentService,
  InMemoryDocumentStateStore,
  OCRService,
  PdfDocumentAdapter,
  StaticDocumentFileSource,
} from './documents.js';
import { buildPng, buildTextPdf, bytes, documentRef, epubFixture } from './documents-fixtures.js';

function sourceFor(entries: readonly { readonly fileId: string; readonly filename: string; readonly mimeType: string; readonly bytes: Uint8Array }[]): StaticDocumentFileSource {
  const content = new Map(entries.map(entry => [entry.fileId, entry.bytes.slice()]));
  const refs = entries.map(entry => documentRef(entry.fileId, entry.filename, entry.mimeType, entry.bytes));
  return new StaticDocumentFileSource(async file => content.get(file.fileId)?.slice(), refs);
}

describe('R0P93 Documents, Reader and safe formats', () => {
  it('opens PDF, EPUB and Markdown through one bounded reader contract', async () => {
    const pdf = buildTextPdf(['Hello from the PDF reader'], { title: 'Reader Fixture' });
    const epub = epubFixture();
    const markdown = bytes('# Local Notes\n\nHello **reader** [site](https://example.test) [blocked](javascript:evil())\n\n<script>alert(1)</script>');
    const source = sourceFor([
      { fileId: 'pdf-1', filename: 'reader.pdf', mimeType: 'application/pdf', bytes: pdf },
      { fileId: 'book-1', filename: 'book.epub', mimeType: 'application/epub+zip', bytes: epub },
      { fileId: 'notes-1', filename: 'notes.md', mimeType: 'text/markdown', bytes: markdown },
    ]);
    const service = new DocumentService({ files: source, ownerId: 'owner-1' });

    const pdfReader = await service.open('pdf-1');
    expect(pdfReader.document).toMatchObject({ format: 'PDF', pageCount: 1, title: 'Reader Fixture' });
    expect(pdfReader.pages[0]?.text).toContain('Hello from the PDF reader');
    expect(pdfReader.outline[0]?.title).toBe('Reader Fixture');
    expect((await pdfReader.renderPage(1)).scriptsExecuted).toBe(0);
    const progress = await service.saveProgress(pdfReader.document.documentId, pdfReader.pages[0]!.locator);
    const highlight = await service.addHighlight(pdfReader.document.documentId, { locator: pdfReader.pages[0]!.locator, selectedText: 'Hello from the PDF reader' });
    expect(progress.revision.revisionId).toBe(pdfReader.document.revision.revisionId);
    expect(highlight.locator.revision.fileId).toBe('pdf-1');
    pdfReader.close();

    const epubReader = await service.open('book-1');
    expect(epubReader.document).toMatchObject({ format: 'EPUB', chapterCount: 1, title: 'Safe Book' });
    expect(epubReader.chapters[0]?.text).toContain('Hello EPUB');
    expect(epubReader.outline[0]?.title).toBe('Chapter One');
    expect(epubReader.chapters[0]?.links.some(link => link.kind === 'EXTERNAL_HTTP')).toBe(true);
    expect(epubReader.chapters[0]?.links.some(link => link.kind === 'BLOCKED')).toBe(true);
    expect((await epubReader.renderPage(1)).mode).toBe('STATIC_SAFE');

    const markdownReader = await service.open('notes-1');
    expect(markdownReader.pages[0]?.text).toContain('Local Notes');
    expect(markdownReader.pages[0]?.text).not.toContain('<script>');
    expect(markdownReader.pages[0]?.links.some(link => link.kind === 'BLOCKED')).toBe(true);
    expect((await service.search('Hello reader', { actorIdentityId: 'owner-1' })).length).toBeGreaterThanOrEqual(2);
    const pdfRef = await source.getFile('pdf-1');
    expect(pdfRef).toBeDefined();
    expect(await source.readFile(pdfRef!)).toEqual(pdf);
  });

  it('keeps progress and annotations revision-bound and merges private owner-device state', async () => {
    const markdown = bytes('# Sync target\n\nPrivate selection text');
    const source = sourceFor([{ fileId: 'sync-1', filename: 'sync.md', mimeType: 'text/markdown', bytes: markdown }]);
    const first = new DocumentService({ files: source, ownerId: 'owner-1', stateStore: new InMemoryDocumentStateStore() });
    const firstReader = await first.open('sync-1');
    await first.saveProgress(firstReader.document.documentId, firstReader.pages[0]!.locator);
    await first.addNote(firstReader.document.documentId, { locator: firstReader.pages[0]!.locator, body: 'Keep this private' });
    const envelope = await first.exportPrivateSync();

    const second = new DocumentService({ files: source, ownerId: 'owner-1', stateStore: new InMemoryDocumentStateStore() });
    await second.mergePrivateSync(envelope);
    const secondReader = await second.open('sync-1');
    expect(await second.progress(secondReader.document.documentId)).toMatchObject({ revision: secondReader.document.revision });
    expect(await second.listAnnotations(secondReader.document.documentId)).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'NOTE', body: 'Keep this private' })]));
    await expect(second.mergePrivateSync({ ...envelope, ownerId: 'different-owner' })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('captures ordered image pages into a new PDF without changing source bytes', async () => {
    const firstBytes = buildPng(4, 3, [220, 30, 30]);
    const secondBytes = buildPng(5, 2, [30, 180, 80]);
    const capture = new DocumentCaptureService();
    const draft = capture.createDraft('Trip receipts');
    const first = await capture.addPage(draft.id, { bytes: firstBytes, filename: 'one.png', mimeType: 'image/png' });
    const second = await capture.addPage(draft.id, { bytes: secondBytes, filename: 'two.png', mimeType: 'image/png' });
    capture.cropPage(draft.id, first.pageId, { left: 1, top: 0, width: 2, height: 3 });
    capture.rotatePage(draft.id, second.pageId, 90);
    const reordered = capture.reorderPage(draft.id, second.pageId, 0);
    expect(reordered.map(page => page.pageId)).toEqual([second.pageId, first.pageId]);
    const exported = await capture.exportPdf(draft.id, { saveToFiles: false });
    expect(exported).toMatchObject({ pageCount: 2 });
    expect(exported.bytes.slice(0, 8)).toEqual(bytes('%PDF-1.4'));
    const ref = documentRef('scan-1', 'trip-receipts.pdf', 'application/pdf', exported.bytes);
    const model = await new PdfDocumentAdapter().open({ file: ref, bytes: exported.bytes });
    expect(model.pages).toHaveLength(2);
    expect(firstBytes).toEqual(buildPng(4, 3, [220, 30, 30]));
    expect(secondBytes).toEqual(buildPng(5, 2, [30, 180, 80]));
  });

  it('bounds local OCR workers and validates adapter output', async () => {
    let calls = 0;
    const adapter = new ControlledOcrAdapter(async input => {
      calls += 1;
      await new Promise(resolve => setTimeout(resolve, 5));
      if (input.signal?.aborted) throw new DocumentError('CANCELLED', 'OCR cancelled');
      return { text: 'local OCR text', confidence: 0.9 };
    });
    const service = new OCRService(adapter, { maxWorkers: 1, maxQueue: 1 });
    const first = service.submit({ imageBytes: buildPng(), mimeType: 'image/png', language: 'eng', maxOutputChars: 1_000, maxRegions: 10 });
    const second = service.submit({ imageBytes: buildPng(), mimeType: 'image/png', language: 'eng', maxOutputChars: 1_000, maxRegions: 10 });
    expect(service.activeWorkers()).toBe(1);
    expect(service.queuedJobs()).toBe(1);
    expect(() => service.submit({ imageBytes: buildPng(), mimeType: 'image/png', language: 'eng', maxOutputChars: 1_000, maxRegions: 10 })).toThrow(/queue/i);
    await expect(first.promise).resolves.toMatchObject({ text: 'local OCR text', confidence: 0.9, engine: 'controlled-ocr' });
    await expect(second.promise).resolves.toMatchObject({ text: 'local OCR text' });
    expect(calls).toBe(2);
    expect(service.activeWorkers()).toBe(0);
  });

});
