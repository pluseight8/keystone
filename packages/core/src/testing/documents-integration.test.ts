import { describe, expect, it } from 'vitest';
import { SodiumCryptoProvider } from '../crypto.js';
import { IdentityManager } from '../identity.js';
import { ContentCacheDocumentFileSource, DocumentCaptureService, DocumentService, FileServiceDocumentWriter, PdfDocumentAdapter } from '../documents.js';
import { ContentCache } from '../social/content.js';
import { InMemoryFileStorage, FileService } from '../social/files.js';
import { LocalContentStore } from '../social/music.js';
import { buildPng, buildTextPdf } from '../documents-fixtures.js';

describe('R0P93 canonical Files integration', () => {
  it('reads and writes through FileService and ContentCache without a second byte store', async () => {
    const identity = await IdentityManager.generate();
    const keys = await identity.sessionKeys('documents-integration');
    const cache = new ContentCache(32 * 1024 * 1024);
    const content = new LocalContentStore(keys.nodeId, cache);
    const files = new FileService(new InMemoryFileStorage(), new SodiumCryptoProvider(), keys, content);
    const original = buildTextPdf(['canonical Files bytes']);
    const imported = await files.import({ bytes: original, filename: 'canonical.pdf', mimeType: 'application/pdf', visibility: 'private', encrypted: { epoch: 1, keyId: 'local-test-key', nonce: 'local-test-nonce' } });
    const source = new ContentCacheDocumentFileSource(files, cache);
    const service = new DocumentService({ files: source, ownerId: keys.nodeId });
    const reader = await service.open(imported.file.id);
    expect(reader.document).toMatchObject({ file: { fileId: imported.file.id }, revision: { contentId: imported.file.payload.contentId }, format: 'PDF' });
    expect(reader.pages[0]?.text).toContain('canonical Files bytes');
    expect(await cache.read(imported.manifest.contentId)).toEqual(original);

    const capture = new DocumentCaptureService({ writer: new FileServiceDocumentWriter(files, { epoch: 1, keyId: 'capture-local-key', nonce: 'capture-local-nonce' }) });
    const draft = capture.createDraft('Receipt');
    await capture.addPage(draft.id, { bytes: buildPng(), filename: 'receipt.png', mimeType: 'image/png' });
    const exported = await capture.exportPdf(draft.id);
    expect(exported.file?.contentId).toBeDefined();
    const generated = await service.open(exported.file!.fileId);
    expect(generated.document.format).toBe('PDF');
    expect(generated.document.pageCount).toBe(1);
    expect(await cache.read(imported.manifest.contentId)).toEqual(original);
  });

  it('can be configured with a production PDF runtime while retaining safe core parsing as fallback', async () => {
    const sourceBytes = buildTextPdf(['runtime boundary']);
    let inspected = 0;
    const runtime = {
      kind: 'TEST_PDF_RUNTIME',
      async inspect() { inspected += 1; return { pages: [{ pageNumber: 1, text: 'runtime text', width: 612, height: 792, textLayer: 'EXTRACTED' as const }] }; },
      async renderPage() { return { imageBytes: buildPng(2, 2), mimeType: 'image/png' as const, width: 2, height: 2, rotation: 0 }; },
    };
    const file = { fileId: 'runtime-pdf', revision: { version: 1 as const, fileId: 'runtime-pdf', revisionId: 'runtime-1' }, filename: 'runtime.pdf', mimeType: 'application/pdf', size: sourceBytes.byteLength };
    const model = await new PdfDocumentAdapter(runtime).open({ file, bytes: sourceBytes });
    expect(model.pages[0]?.text).toBe('runtime text');
    expect((await model.renderPage?.(1))?.mode).toBe('RASTER');
    expect(inspected).toBe(1);
  });
});
