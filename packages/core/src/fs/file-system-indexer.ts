import type { RAGManager } from '../rag.js';
import { DocumentParser, isSupportedDocument, type DocumentInput } from '../ai/parsers/index.js';
import { RecursiveCharacterTextSplitter } from '../ai/parsers/recursive-character-text-splitter.js';

export interface FileEntry { path: string; size: number; modifiedAt?: number; mimeType?: string; }
export interface FileSystemAdapter {
  scan(root: string): Promise<FileEntry[]>;
  read(entry: FileEntry): Promise<DocumentInput>;
}
export interface IndexProgress { root: string; completed: number; total: number; currentPath?: string; skipped: number; }

export class FileSystemIndexer {
  private paused = false;
  private readonly resumeWaiters = new Set<() => void>();
  constructor(private readonly rag: RAGManager, private readonly adapter: FileSystemAdapter, private readonly parser = new DocumentParser(), private readonly splitter = new RecursiveCharacterTextSplitter()) {}

  /** Cooperatively pauses between files/chunks; active I/O is allowed to finish safely. */
  pause(): void { this.paused = true; }
  resume(): void { this.paused = false; for (const wake of this.resumeWaiters) wake(); this.resumeWaiters.clear(); }
  isPaused(): boolean { return this.paused; }

  async indexDirectory(root: string, onProgress?: (progress: IndexProgress) => void): Promise<IndexProgress> {
    const files = (await this.adapter.scan(root)).filter(entry => isSupportedDocument(entry.path));
    const progress: IndexProgress = { root, completed: 0, total: files.length, skipped: 0 };
    for (const entry of files) {
      await this.waitUntilResumed();
      progress.currentPath = entry.path;
      try { await this.indexFile(entry); } catch { progress.skipped += 1; }
      progress.completed += 1; onProgress?.({ ...progress });
    }
    return progress;
  }

  async indexFile(entry: FileEntry): Promise<number> {
    const document = await this.parser.parse(await this.adapter.read(entry));
    const chunks = this.splitter.splitText(document.text);
    for (const chunk of chunks) { await this.waitUntilResumed(); await this.rag.upsert({
      id: `local-file:${stableHash(entry.path)}:${chunk.index}`,
      type: 'local_file', text: chunk.text,
      metadata: { ...document.metadata, path: entry.path, chunk: chunk.index, start: chunk.start, end: chunk.end, modifiedAt: entry.modifiedAt },
    }); }
    return chunks.length;
  }

  private waitUntilResumed(): Promise<void> {
    if (!this.paused) return Promise.resolve();
    return new Promise(resolve => this.resumeWaiters.add(resolve));
  }
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(36);
}
