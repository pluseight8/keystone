import type { DocumentInput, ParsedDocument, PdfTextExtractor, SupportedDocumentExtension } from './types.js';

const decoder = new TextDecoder('utf-8', { fatal: false });
const supported = new Set<SupportedDocumentExtension>(['.md', '.txt', '.csv', '.pdf']);

export function documentExtension(path: string): string {
  const clean = path.split(/[?#]/, 1)[0] ?? path;
  const name = clean.slice(Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\')) + 1);
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot).toLocaleLowerCase();
}

export function isSupportedDocument(path: string): boolean {
  return supported.has(documentExtension(path) as SupportedDocumentExtension);
}

/** Rejects NUL-heavy/binary payloads before they enter parsers or embedding models. */
export function looksLikeBinary(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, Math.min(bytes.length, 8_192));
  if (!sample.length) return false;
  let nul = 0, controls = 0;
  for (const byte of sample) {
    if (byte === 0) nul += 1;
    if (byte < 7 || (byte > 13 && byte < 32)) controls += 1;
  }
  return nul > 0 || controls / sample.length > 0.08;
}

export class DocumentParser {
  constructor(private readonly pdf?: PdfTextExtractor) {}

  async parse(input: DocumentInput): Promise<ParsedDocument> {
    const extension = documentExtension(input.path);
    if (!isSupportedDocument(input.path)) throw new Error(`Unsupported document type: ${extension || 'unknown'}`);
    if (extension !== '.pdf' && looksLikeBinary(input.bytes)) throw new Error('Binary content was rejected');

    const text = extension === '.pdf'
      ? await this.parsePdf(input)
      : extension === '.csv'
        ? csvToText(decoder.decode(input.bytes))
        : normalizeText(decoder.decode(input.bytes));
    return { path: input.path, text, metadata: { source: input.path, extension, mimeType: input.mimeType } };
  }

  private async parsePdf(input: DocumentInput): Promise<string> {
    if (!this.pdf) throw new Error('PDF extraction is not available on this platform');
    // A document name is metadata only.  Never hand a remote path (including
    // traversal, drive or UNC components) to a host PDF boundary.
    return normalizeText(await this.pdf.extract(input.bytes, safeDocumentName(input.path)));
  }
}

/** Preserves row meaning without retaining CSV punctuation in every embedding. */
export function csvToText(csv: string): string {
  const rows = parseCsv(csv);
  if (!rows.length) return '';
  const header = rows[0]!;
  return rows.slice(1).map((row, rowIndex) => header.map((key, column) => `${key.trim() || `column_${column + 1}`}: ${(row[column] ?? '').trim()}`).join(' | ') || `row: ${rowIndex + 1}`).join('\n');
}

function parseCsv(value: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], field = '', quoted = false;
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i]!;
    if (char === '"' && quoted && value[i + 1] === '"') { field += '"'; i += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) { row.push(field); field = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && value[i + 1] === '\n') i += 1;
      row.push(field); if (row.some(cell => cell.length)) rows.push(row); row = []; field = '';
    } else field += char;
  }
  row.push(field); if (row.some(cell => cell.length)) rows.push(row);
  return rows;
}

function normalizeText(value: string): string {
  return value.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim();
}

function safeDocumentName(value: string): string {
  const base = value.split(/[?#]/, 1)[0]!.split(/[\\/]/).pop() ?? 'document';
  const normalized = base.normalize('NFKC').replace(/[^\p{L}\p{N}._-]/gu, '_').trim();
  if (normalized === '.' || normalized === '..') return 'document';
  return normalized.slice(0, 255) || 'document';
}

export type { DocumentInput, ParsedDocument, PdfTextExtractor, SupportedDocumentExtension } from './types.js';
