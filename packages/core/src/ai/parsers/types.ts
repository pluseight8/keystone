export type SupportedDocumentExtension = '.md' | '.txt' | '.csv' | '.pdf';

export interface DocumentInput {
  path: string;
  bytes: Uint8Array;
  mimeType?: string;
}

export interface ParsedDocument {
  path: string;
  text: string;
  metadata: Record<string, unknown>;
}

export interface PdfTextExtractor {
  extract(bytes: Uint8Array, path: string): Promise<string>;
}
