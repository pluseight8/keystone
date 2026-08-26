import { describe, expect, it } from 'vitest';
import { DocumentAdapterRegistry, DocumentError, DocumentSearchIndex, DocumentService, PdfDocumentAdapter, StaticDocumentFileSource } from '../documents.js';
import { buildPng, bytes, documentRef } from '../documents-fixtures.js';

describe('R0P93 bounded document scale surfaces', () => {
  it('keeps global search records bounded and returns bounded results', () => {
    const index = new DocumentSearchIndex(128);
    for (let indexNumber = 0; indexNumber < 128; indexNumber += 1) index.upsert({ documentId: `document-${indexNumber}` as never, fileId: `file-${indexNumber}`, revision: { version: 1, fileId: `file-${indexNumber}`, revisionId: 'revision-1' }, title: `Document ${indexNumber}`, format: 'PLAIN_TEXT', text: 'bounded search term', ocrPages: [], updatedAt: new Date(0).toISOString() });
    expect(index.size()).toBe(128);
    expect(() => index.upsert({ documentId: 'overflow' as never, fileId: 'overflow', revision: { version: 1, fileId: 'overflow', revisionId: 'revision-1' }, title: 'Overflow', format: 'PLAIN_TEXT', text: 'bounded search term', ocrPages: [], updatedAt: new Date(0).toISOString() })).toThrow(DocumentError);
    expect(index.search('bounded search term', 10)).toHaveLength(10);
  });

  it('keeps page render cache bounded while preserving the reader contract', async () => {
    const sourceBytes = bytes('%PDF-1.4\nplaceholder');
    const ref = documentRef('scale-pdf', 'scale.pdf', 'application/pdf', sourceBytes);
    let renders = 0;
    const runtime = {
      async inspect() { return { pages: Array.from({ length: 16 }, (_, index) => ({ pageNumber: index + 1, text: `page ${index + 1}`, textLayer: 'EXTRACTED' as const })) }; },
      async renderPage() { renders += 1; return { imageBytes: buildPng(2, 2), mimeType: 'image/png' as const, width: 2, height: 2 }; },
    };
    const service = new DocumentService({ files: new StaticDocumentFileSource(async file => file.fileId === ref.fileId ? sourceBytes.slice() : undefined, [ref]), adapters: new DocumentAdapterRegistry({ adapters: [new PdfDocumentAdapter(runtime)] }), maxRenderCache: 2 });
    const reader = await service.open(ref.fileId);
    await reader.renderPage(1); await reader.renderPage(2); await reader.renderPage(3); await reader.renderPage(1);
    expect(renders).toBe(4);
  });
});
