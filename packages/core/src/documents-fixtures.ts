import { deflateRawSync, deflateSync } from 'node:zlib';
import type { DocumentFileRef, DocumentRevisionRef } from './documents.js';

const encoder = new TextEncoder();

export function bytes(value: string): Uint8Array { return encoder.encode(value); }

export function documentRef(fileId: string, filename: string, mimeType: string, source: Uint8Array, revisionId = 'revision-1'): DocumentFileRef {
  const revision: DocumentRevisionRef = { version: 1, fileId, revisionId };
  return { fileId, revision, filename, mimeType, size: source.byteLength };
}

export function buildTextPdf(pageTexts: readonly string[], options: { readonly title?: string; readonly hostileActions?: boolean } = {}): Uint8Array {
  if (!pageTexts.length) throw new Error('At least one PDF page is required');
  const fontId = 3 + pageTexts.length * 2;
  const objects: Uint8Array[] = Array.from({ length: fontId }, () => bytes(''));
  const pageIds: number[] = [];
  for (const [index, text] of pageTexts.entries()) {
    const pageId = 3 + index * 2;
    const contentId = pageId + 1;
    pageIds.push(pageId);
    const escaped = text.replace(/[()\\]/g, '\\$&').replace(/\r?\n/g, ' ');
    const content = `BT /F1 12 Tf 72 720 Td (${escaped}) Tj ET`;
    objects[pageId - 1] = bytes(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    objects[contentId - 1] = bytes(`<< /Length ${bytes(content).byteLength} >>\nstream\n${content}\nendstream`);
  }
  objects[0] = bytes(`<< /Type /Catalog /Pages 2 0 R${options.hostileActions ? ' /OpenAction << /S /JavaScript /JS (app.alert(1)) >> /AA << /O << /S /Launch >> >>' : ''} >>`);
  objects[1] = bytes(`<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] >>`);
  objects[fontId - 1] = bytes('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  if (options.title || options.hostileActions) objects.push(bytes(`<< /Title (${(options.title ?? 'Fixture').replace(/[()\\]/g, '\\$&')})${options.hostileActions ? ' /SubmitForm true /EmbeddedFile true /URI (javascript:alert(1)) /GoToR (remote.pdf)' : ''} >>`));
  const chunks: Uint8Array[] = [bytes('%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n')];
  const offsets: number[] = [0];
  let length = chunks[0]!.byteLength;
  for (const [index, object] of objects.entries()) {
    const header = bytes(`${index + 1} 0 obj\n`);
    const footer = bytes('\nendobj\n');
    offsets.push(length);
    chunks.push(header, object, footer);
    length += header.byteLength + object.byteLength + footer.byteLength;
  }
  const xrefOffset = length;
  const xref = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`, ...offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`), `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R${options.title || options.hostileActions ? ` /Info ${objects.length} 0 R` : ''} >>\nstartxref\n${xrefOffset}\n%%EOF\n`];
  chunks.push(bytes(xref.join('')));
  return concat(chunks);
}

export function buildPng(width = 4, height = 3, color: readonly [number, number, number] = [30, 100, 220]): Uint8Array {
  const raw = new Uint8Array(height * (1 + width * 3));
  for (let row = 0; row < height; row += 1) {
    const start = row * (1 + width * 3);
    raw[start] = 0;
    for (let column = 0; column < width; column += 1) raw.set(color, start + 1 + column * 3);
  }
  const header = new Uint8Array(13); writeU32Be(header, 0, width); writeU32Be(header, 4, height); header.set([8, 2, 0, 0, 0], 8);
  return concat([Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk('IHDR', header), pngChunk('IDAT', new Uint8Array(deflateSync(raw))), pngChunk('IEND', new Uint8Array())]);
}

export function buildZip(entries: readonly { readonly path: string; readonly data: Uint8Array; readonly deflate?: boolean }[]): Uint8Array {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = bytes(entry.path);
    const compressed = entry.deflate ? new Uint8Array(deflateRawSync(entry.data)) : entry.data;
    const method = entry.deflate ? 8 : 0;
    const crc = crc32(entry.data);
    const local = new Uint8Array(30 + name.byteLength + compressed.byteLength);
    writeU32(local, 0, 0x04034b50); writeU16(local, 4, 20); writeU16(local, 8, method); writeU32(local, 14, crc); writeU32(local, 18, compressed.byteLength); writeU32(local, 22, entry.data.byteLength); writeU16(local, 26, name.byteLength); local.set(name, 30); local.set(compressed, 30 + name.byteLength);
    localParts.push(local);
    const central = new Uint8Array(46 + name.byteLength);
    writeU32(central, 0, 0x02014b50); writeU16(central, 4, 20); writeU16(central, 6, 20); writeU16(central, 10, method); writeU32(central, 16, crc); writeU32(central, 20, compressed.byteLength); writeU32(central, 24, entry.data.byteLength); writeU16(central, 28, name.byteLength); writeU32(central, 42, offset); central.set(name, 46); centralParts.push(central);
    offset += local.byteLength;
  }
  const directory = concat(centralParts);
  const local = concat(localParts);
  const eocd = new Uint8Array(22);
  writeU32(eocd, 0, 0x06054b50); writeU16(eocd, 8, entries.length); writeU16(eocd, 10, entries.length); writeU32(eocd, 12, directory.byteLength); writeU32(eocd, 16, local.byteLength);
  return concat([local, directory, eocd]);
}

export function epubFixture(): Uint8Array {
  const container = bytes('<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>');
  const opf = bytes('<?xml version="1.0"?><package><metadata><dc:title>Safe Book</dc:title></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine><itemref idref="chapter"/></spine></package>');
  const chapter = bytes('<html><head><title>Chapter One</title><script>alert(1)</script></head><body><h1>Chapter One</h1><p>Hello EPUB <a href="https://example.test/book">link</a> <a href="javascript:evil()">bad</a></p><form action="https://example.test"><input></form></body></html>');
  const nav = bytes('<nav><ol><li><a href="chapter.xhtml">Chapter One</a></li></ol></nav>');
  return buildZip([{ path: 'mimetype', data: bytes('application/epub+zip') }, { path: 'META-INF/container.xml', data: container, deflate: true }, { path: 'OEBPS/content.opf', data: opf, deflate: true }, { path: 'OEBPS/chapter.xhtml', data: chapter, deflate: true }, { path: 'OEBPS/nav.xhtml', data: nav, deflate: true }]);
}

function pngChunk(type: string, data: Uint8Array): Uint8Array { const typeBytes = bytes(type); const output = new Uint8Array(12 + data.byteLength); writeU32Be(output, 0, data.byteLength); output.set(typeBytes, 4); output.set(data, 8); writeU32Be(output, 8 + data.byteLength, crc32(concat([typeBytes, data]))); return output; }
function writeU16(target: Uint8Array, offset: number, value: number): void { target[offset] = value & 0xff; target[offset + 1] = (value >>> 8) & 0xff; }
function writeU32(target: Uint8Array, offset: number, value: number): void { target[offset] = value & 0xff; target[offset + 1] = (value >>> 8) & 0xff; target[offset + 2] = (value >>> 16) & 0xff; target[offset + 3] = (value >>> 24) & 0xff; }
function writeU32Be(target: Uint8Array, offset: number, value: number): void { target[offset] = (value >>> 24) & 0xff; target[offset + 1] = (value >>> 16) & 0xff; target[offset + 2] = (value >>> 8) & 0xff; target[offset + 3] = value & 0xff; }
function crc32(value: Uint8Array): number { let crc = 0xffffffff; for (const byte of value) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); } return (crc ^ 0xffffffff) >>> 0; }
function concat(values: readonly Uint8Array[]): Uint8Array { const output = new Uint8Array(values.reduce((total, value) => total + value.byteLength, 0)); let offset = 0; for (const value of values) { output.set(value, offset); offset += value.byteLength; } return output; }
