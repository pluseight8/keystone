import type { RAGManager } from '../../rag.js';
import { DocumentParser, type DocumentInput } from './index.js';
import { RecursiveCharacterTextSplitter } from './recursive-character-text-splitter.js';

/** Parses one picker/watcher payload and streams its chunks into Orama. */
export async function indexDocumentInput(input: DocumentInput, rag: RAGManager, options: {
  parser?: DocumentParser; splitter?: RecursiveCharacterTextSplitter; documentId?: string;
} = {}): Promise<number> {
  const parser = options.parser ?? new DocumentParser();
  const splitter = options.splitter ?? new RecursiveCharacterTextSplitter();
  const parsed = await parser.parse(input);
  const id = options.documentId ?? hash(input.path);
  const chunks = splitter.splitText(parsed.text);
  for (const chunk of chunks) await rag.upsert({ id: `local-file:${id}:${chunk.index}`, type: 'local_file', text: chunk.text, metadata: { ...parsed.metadata, chunk: chunk.index, start: chunk.start, end: chunk.end } });
  return chunks.length;
}

function hash(value: string): string { let result = 2166136261; for (let index = 0; index < value.length; index += 1) result = Math.imul(result ^ value.charCodeAt(index), 16777619); return (result >>> 0).toString(36); }
