import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { LinuxNativeOcrAdapter, LinuxPdfRuntimeAdapter } from '@keystone/native-host';
import { DocumentAdapterRegistry, DocumentCaptureService, DocumentService, OCRService, PdfDocumentAdapter, StaticDocumentFileSource } from '../documents.js';

const execFileAsync = promisify(execFile);

async function makeTextPng(): Promise<Uint8Array> {
  const args = ['-size', '1400x260', 'xc:white', '-fill', 'black', '-font', 'Liberation-Sans', '-pointsize', '74', '-gravity', 'center', '-annotate', '+0+0', 'KEYSTONE SCANNER OCR', 'png:-'];
  try { const result = await execFileAsync('magick', args, { timeout: 30_000, maxBuffer: 16 * 1024 * 1024, encoding: 'buffer' }); return new Uint8Array(result.stdout); } catch { const result = await execFileAsync('convert', args, { timeout: 30_000, maxBuffer: 16 * 1024 * 1024, encoding: 'buffer' }); return new Uint8Array(result.stdout); }
}

describe('R0P93 real Omarchy document runtime evidence', () => {
  it('proves scanner image -> generated PDF -> Poppler Reader -> local OCR -> Search', async () => {
    const image = await makeTextPng();
    const capture = new DocumentCaptureService();
    const draft = capture.createDraft('Scanner evidence');
    const page = await capture.addPage(draft.id, { bytes: image, filename: 'scanner-page.png', mimeType: 'image/png' });
    const exported = await capture.exportPdf(draft.id, { saveToFiles: false });
    expect(exported.pageCount).toBe(1);
    expect(image.byteLength).toBeGreaterThan(0);

    const pdfRuntime = new LinuxPdfRuntimeAdapter({ commandTimeoutMs: 30_000, maxConcurrentProcesses: 1 });
    const ocrAdapter = new LinuxNativeOcrAdapter({ commandTimeoutMs: 30_000, maxConcurrentProcesses: 1 });
    expect(pdfRuntime.available()).toBe(true);
    expect(ocrAdapter.available()).toBe(true);
    await ocrAdapter.ready();
    const ref = { fileId: 'scanner-generated-pdf', revision: { version: 1 as const, fileId: 'scanner-generated-pdf', revisionId: 'scanner-revision' }, filename: 'scanner-evidence.pdf', mimeType: 'application/pdf', size: exported.bytes.byteLength };
    const source = new StaticDocumentFileSource(async file => file.fileId === ref.fileId ? exported.bytes.slice() : undefined, [ref]);
    const service = new DocumentService({ files: source, adapters: new DocumentAdapterRegistry({ adapters: [new PdfDocumentAdapter(pdfRuntime)] }), ocr: new OCRService(ocrAdapter, { maxWorkers: 1, maxQueue: 4 }), ownerId: 'owner-omarchy' });
    const reader = await service.open(ref.fileId);
    expect(reader.document).toMatchObject({ format: 'PDF', pageCount: 1, hasTextLayer: false });
    const rendered = await reader.renderPage(1, { scale: 1 });
    expect(rendered).toMatchObject({ mode: 'RASTER', mimeType: 'image/png', scriptsExecuted: 0, formsSubmitted: 0 });
    const recognized = await service.recognizePage(reader.document.documentId, 1, { language: 'eng' });
    expect(recognized.text.toUpperCase()).toContain('KEYSTONE');
    expect(recognized.text.toUpperCase()).toContain('OCR');
    expect((await service.search('scanner OCR', { actorIdentityId: 'owner-omarchy' })).some(result => result.source === 'OCR')).toBe(true);
    expect(capture.getDraft(draft.id)?.pages[0]?.pageId).toBe(page.pageId);
    expect(pdfRuntime.activeProcesses()).toBe(0);
    expect(ocrAdapter.activeProcesses()).toBe(0);
  });
});
