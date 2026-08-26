import type { RAGManager } from '../../rag.js';
import { DocumentParser, type DocumentInput } from './index.js';
import { RecursiveCharacterTextSplitter } from './recursive-character-text-splitter.js';
import type { FileContainmentService } from '../../security/untrusted-content.js';
import { sha256 } from '../../social/content.js';

/** Parses one picker/watcher payload and streams its chunks into Orama. */
export async function indexDocumentInput(input: DocumentInput, rag: RAGManager, options: {
  parser?: DocumentParser; splitter?: RecursiveCharacterTextSplitter; documentId?: string; containment?: FileContainmentService; sourceIdentity?: string;
} = {}): Promise<number> {
  if (options.containment) {
    const entry = await options.containment.receive({ version: 1, transferId: `rag:${options.documentId ?? input.path}`, sourceIdentity: options.sourceIdentity ?? 'local-host', objectId: options.documentId ?? `local-file:${input.path}`, filename: input.path, mimeType: input.mimeType, size: input.bytes.byteLength, visibility: 'private' }, input.bytes);
    const preview = await options.containment.inspectAndPreview(entry.metadata.entryId);
    if (!preview) throw new Error('Document is not eligible for a bounded preview');
    const text = typeof (preview.value as { text?: unknown })?.text === 'string' ? (preview.value as { text: string }).text : typeof (preview.value as { sanitizedMarkup?: unknown })?.sanitizedMarkup === 'string' ? (preview.value as { sanitizedMarkup: string }).sanitizedMarkup : undefined;
    if (text === undefined) throw new Error('Document preview did not produce safe text');
    input = { ...input, bytes: new TextEncoder().encode(text) };
  }
  const parser = options.parser ?? new DocumentParser();
  const splitter = options.splitter ?? new RecursiveCharacterTextSplitter();
  const sourceHash = `sha256-${await sha256(input.bytes)}`;
  const parsed = await parser.parse(input);
  const id = options.documentId ?? hash(input.path);
  const chunks = splitter.splitText(parsed.text);
  for (const chunk of chunks) await rag.upsert({ id: `local-file:${id}:${chunk.index}`, type: 'local_file', text: chunk.text, metadata: { ...parsed.metadata, chunk: chunk.index, start: chunk.start, end: chunk.end, sourceHash, contentTrust: 'UNTRUSTED_CONTENT', promptInjectionUntrusted: true } });
  return chunks.length;
}

function hash(value: string): string { let result = 2166136261; for (let index = 0; index < value.length; index += 1) result = Math.imul(result ^ value.charCodeAt(index), 16777619); return (result >>> 0).toString(36); }
