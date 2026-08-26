import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { LinuxNativeOcrAdapter, LinuxPdfRuntimeAdapter } from './documents.js';

const execFileAsync = promisify(execFile);

async function makeTextPng(): Promise<Uint8Array> {
  const args = ['-size', '1400x260', 'xc:white', '-fill', 'black', '-font', 'Liberation-Sans', '-pointsize', '74', '-gravity', 'center', '-annotate', '+0+0', 'KEYSTONE LOCAL OCR', 'png:-'];
  try { const result = await execFileAsync('magick', args, { timeout: 30_000, maxBuffer: 16 * 1024 * 1024, encoding: 'buffer' }); return new Uint8Array(result.stdout); } catch { const result = await execFileAsync('convert', args, { timeout: 30_000, maxBuffer: 16 * 1024 * 1024, encoding: 'buffer' }); return new Uint8Array(result.stdout); }
}

function textPdf(text: string): Uint8Array {
  const content = `BT /F1 24 Tf 72 720 Td (${text.replace(/[()\\]/g, '\\$&')}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Count 1 /Kids [3 0 R] >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${new TextEncoder().encode(content).byteLength} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [encoder.encode('%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n')];
  const offsets: number[] = [0];
  let length = chunks[0]!.byteLength;
  for (const [index, object] of objects.entries()) { const header = encoder.encode(`${index + 1} 0 obj\n`); const body = encoder.encode(object); const footer = encoder.encode('\nendobj\n'); offsets.push(length); chunks.push(header, body, footer); length += header.byteLength + body.byteLength + footer.byteLength; }
  const xrefOffset = length;
  const xref = encoder.encode(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);
  chunks.push(xref);
  const output = new Uint8Array(chunks.reduce((total, value) => total + value.byteLength, 0)); let offset = 0; for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; } return output;
}

describe('R0P93 Linux production PDF/OCR boundary', () => {
  it('inspects and rasterizes real PDF bytes through Poppler', async () => {
    const runtime = new LinuxPdfRuntimeAdapter({ commandTimeoutMs: 30_000, maxConcurrentProcesses: 1 });
    expect(runtime.available()).toBe(true);
    const source = textPdf('REAL PDF RUNTIME');
    const inspected = await runtime.inspect({ bytes: source, maxPages: 10, maxTextBytes: 1_000_000 });
    expect(inspected.pages).toHaveLength(1);
    expect(inspected.pages[0]?.text).toContain('REAL PDF RUNTIME');
    const rendered = await runtime.renderPage({ bytes: source, pageNumber: 1, scale: 1 });
    expect(rendered).toMatchObject({ mimeType: 'image/png', width: 612, height: 792 });
    expect(Array.from(rendered.imageBytes.slice(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });

  it('recognizes a locally rendered text image with Tesseract and no network boundary', async () => {
    const ocr = new LinuxNativeOcrAdapter({ commandTimeoutMs: 30_000, maxConcurrentProcesses: 1 });
    expect(ocr.available()).toBe(true);
    await ocr.ready();
    expect(ocr.languages).toContain('eng');
    const image = await makeTextPng();
    const result = await ocr.recognize({ imageBytes: image, mimeType: 'image/png', language: 'eng', maxOutputChars: 10_000, maxRegions: 100 });
    expect(result.text.toUpperCase()).toContain('KEYSTONE');
    expect(result.text.toUpperCase()).toContain('OCR');
    expect(ocr.activeProcesses()).toBe(0);
  });

  it('rejects malformed input and preserves bounded process cleanup', async () => {
    const runtime = new LinuxPdfRuntimeAdapter({ commandTimeoutMs: 10_000, maxConcurrentProcesses: 1 });
    await expect(runtime.inspect({ bytes: Uint8Array.from([1, 2, 3]), maxPages: 10, maxTextBytes: 10_000 })).rejects.toMatchObject({ code: 'UNSUPPORTED' });
    const ocr = new LinuxNativeOcrAdapter({ commandTimeoutMs: 10_000, maxConcurrentProcesses: 1 });
    await expect(ocr.recognize({ imageBytes: Uint8Array.from([1, 2, 3]), mimeType: 'application/pdf', language: 'eng', maxOutputChars: 100, maxRegions: 1 })).rejects.toMatchObject({ code: 'UNSUPPORTED' });
    expect(runtime.activeProcesses()).toBe(0);
    expect(ocr.activeProcesses()).toBe(0);
  });
});
