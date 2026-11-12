import { sha256, type DocumentFileRef, type DocumentFileSource, type DocumentRevisionRef } from '@keystone/core';
import { DesktopIndexedDbStateStore } from './desktop-browser-state';

export const DOCUMENT_FILES_KEY = 'keystone.local.documents.files.v1';
export const DOCUMENT_FILES_STATE_KEY = 'keystone.local.documents.files.v2';
// The whole library is one IndexedDB value held in memory, so total size is what costs RAM and write time,
// not the number of documents: at most ~128 MiB resident, about twice that while a save is cloned.
const MAX_LOCAL_DOCUMENTS = 1024;
const MAX_LOCAL_DOCUMENT_BYTES = 8 * 1024 * 1024;
const MAX_LOCAL_LIBRARY_BYTES = 128 * 1024 * 1024;

interface PersistedLocalFile {
  readonly version: 1;
  readonly fileId: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly size: number;
  readonly contentId: NonNullable<DocumentFileRef['contentId']>;
  readonly bytes: string;
  readonly createdAt: string;
  readonly ownerId: string;
}

interface IndexedDbLocalFile extends Omit<PersistedLocalFile, 'bytes'> {
  readonly bytes: Uint8Array;
}

function storedSnapshot(value: unknown): { readonly files?: unknown; readonly writeId?: unknown } {
  return value && typeof value === 'object' ? value : {};
}

export class LocalDocumentFileSource implements DocumentFileSource {
  private files = new Map<string, IndexedDbLocalFile>();
  /** Stored entries that failed validation. They are written back untouched so a later build or a manual recovery can still read them. */
  private unreadable: unknown[] = [];
  private writeId: unknown;
  private readonly hydration: Promise<void>;
  private pendingWrite = Promise.resolve();

  constructor(
    private readonly ownerId: string,
    private readonly state: Pick<DesktopIndexedDbStateStore, 'read' | 'update'> = new DesktopIndexedDbStateStore(`${DOCUMENT_FILES_STATE_KEY}:${ownerId}`),
  ) {
    this.hydration = this.hydrate();
  }

  async ready(): Promise<void> { await this.hydration; }

  async register(filename: string, mimeType: string, bytes: Uint8Array): Promise<DocumentFileRef> {
    const fileId = `local-document:${crypto.randomUUID()}`;
    const entry = await this.makeEntry(fileId, filename, mimeType, bytes, new Date().toISOString());
    await this.change(files => {
      if (files.size >= MAX_LOCAL_DOCUMENTS) throw new Error('The local document limit of 1024 has been reached');
      files.set(fileId, entry);
    });
    return this.refFor(entry);
  }

  async getFile(fileId: string): Promise<DocumentFileRef | undefined> {
    await this.ready();
    const entry = this.files.get(fileId);
    return entry && this.refFor(entry);
  }

  async readText(fileId: string): Promise<string | undefined> {
    await this.ready();
    const entry = this.files.get(fileId);
    if (!entry?.mimeType.startsWith('text/')) return undefined;
    try { return new TextDecoder('utf-8', { fatal: true }).decode(entry.bytes); }
    catch { return undefined; }
  }

  async replaceText(fileId: string, baseRevision: DocumentRevisionRef['revisionId'], filename: string, content: string): Promise<DocumentFileRef> {
    await this.ready();
    const previous = this.files.get(fileId);
    if (!previous?.mimeType.startsWith('text/')) throw new Error('Only local text documents can be edited');
    const entry = await this.makeEntry(fileId, filename, previous.mimeType, new TextEncoder().encode(content), previous.createdAt);
    await this.change(files => {
      if (files.get(fileId)?.contentId !== baseRevision) throw new Error('The document changed. Reopen it before saving');
      files.set(fileId, entry);
    });
    return this.refFor(entry);
  }

  async remove(fileId: string): Promise<void> {
    await this.change(files => { files.delete(fileId); });
  }

  async readFile(file: DocumentFileRef): Promise<Uint8Array | undefined> {
    await this.ready();
    const entry = this.files.get(file.fileId);
    return entry?.contentId === file.revision.revisionId ? entry.bytes.slice() : undefined;
  }

  async listFiles(): Promise<readonly DocumentFileRef[]> {
    await this.ready();
    return [...this.files.values()]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map(entry => this.refFor(entry));
  }

  private async makeEntry(fileId: string, filename: string, mimeType: string, input: Uint8Array, createdAt: string): Promise<IndexedDbLocalFile> {
    const name = filename.trim();
    const mime = mimeType.trim();
    if (!name || name.length > 255) throw new Error('Document filename is invalid');
    if (!mime || mime.length > 255) throw new Error('Document MIME type is invalid');
    if (input.byteLength > MAX_LOCAL_DOCUMENT_BYTES) throw new Error('Local document is larger than 8 MiB');
    const bytes = input.slice();
    const contentId = `sha256-${await sha256(bytes)}` as IndexedDbLocalFile['contentId'];
    return { version: 1, fileId, filename: name, mimeType: mime, size: bytes.byteLength, contentId, bytes, createdAt, ownerId: this.ownerId };
  }

  private change(apply: (files: Map<string, IndexedDbLocalFile>) => void): Promise<void> {
    const pending = this.pendingWrite.then(async () => {
      await this.ready();
      const files = new Map(this.files);
      apply(files);
      let total = 0;
      for (const file of files.values()) total += file.size;
      if (total > MAX_LOCAL_LIBRARY_BYTES && total > [...this.files.values()].reduce((sum, file) => sum + file.size, 0)) throw new Error('Local documents would exceed 128 MiB. Delete or export some documents first');
      const writeId = crypto.randomUUID();
      let conflict = false;
      try {
        await this.state.update(current => {
          if (storedSnapshot(current).writeId !== this.writeId) {
            conflict = true;
            throw new Error('Documents changed in another window. Reopen the document before saving');
          }
          return { version: 1, writeId, files: [...files.values()], ...(this.unreadable.length ? { unreadable: this.unreadable } : {}) };
        });
      } catch (reason) {
        if (conflict) await this.hydrate().catch(() => undefined);
        throw reason;
      }
      this.files = files;
      this.writeId = writeId;
    });
    this.pendingWrite = pending.catch(() => undefined);
    return pending;
  }

  private async hydrate(): Promise<void> {
    const stored = await this.state.read();
    const snapshot = storedSnapshot(stored);
    const values = Array.isArray(snapshot.files) ? snapshot.files : this.readLegacyFiles();
    const files = new Map<string, IndexedDbLocalFile>();
    const unreadable: unknown[] = Array.isArray((snapshot as { unreadable?: unknown }).unreadable) ? [...(snapshot as { unreadable: unknown[] }).unreadable] : [];
    for (const value of values) {
      const entry = isIndexedDbLocalFile(value)
        ? value
        : isPersistedLocalFile(value) ? { ...value, bytes: decodeBase64(value.bytes) } : undefined;
      if (entry?.ownerId !== this.ownerId || !entry.bytes || entry.bytes.byteLength !== entry.size || !(await contentMatches(entry.bytes, entry.contentId))) { if (Array.isArray(snapshot.files)) unreadable.push(value); continue; }
      files.set(entry.fileId, { ...entry, bytes: entry.bytes });
    }
    this.files = files;
    this.unreadable = unreadable;
    this.writeId = snapshot.writeId;
  }

  private readLegacyFiles(): readonly unknown[] {
    try {
      const raw = window.localStorage.getItem(DOCUMENT_FILES_KEY);
      const values = raw ? JSON.parse(raw) : undefined;
      return Array.isArray(values) ? values : [];
    } catch {
      return [];
    }
  }

  private refFor(entry: IndexedDbLocalFile): DocumentFileRef {
    return {
      fileId: entry.fileId,
      revision: { version: 1, fileId: entry.fileId, revisionId: entry.contentId, contentId: entry.contentId },
      filename: entry.filename,
      mimeType: entry.mimeType,
      size: entry.size,
      contentId: entry.contentId,
      visibility: 'private',
      ownerId: this.ownerId,
      scope: 'LOCAL_ONLY',
    };
  }
}

export function isPersistedLocalFile(value: unknown): value is PersistedLocalFile {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<PersistedLocalFile>;
  return candidate.version === 1
    && typeof candidate.fileId === 'string' && candidate.fileId.startsWith('local-document:')
    && typeof candidate.filename === 'string' && candidate.filename.length > 0 && candidate.filename.length <= 255
    && typeof candidate.mimeType === 'string' && candidate.mimeType.length > 0 && candidate.mimeType.length <= 255
    && Number.isSafeInteger(candidate.size) && candidate.size! >= 0 && candidate.size! <= MAX_LOCAL_DOCUMENT_BYTES
    && typeof candidate.contentId === 'string' && /^sha256-[a-f0-9]{64}$/i.test(candidate.contentId)
    && typeof candidate.bytes === 'string' && candidate.bytes.length <= MAX_LOCAL_DOCUMENT_BYTES * 2
    && typeof candidate.createdAt === 'string' && typeof candidate.ownerId === 'string';
}

function isIndexedDbLocalFile(value: unknown): value is IndexedDbLocalFile {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<IndexedDbLocalFile>;
  return candidate.version === 1
    && typeof candidate.fileId === 'string' && candidate.fileId.startsWith('local-document:')
    && typeof candidate.filename === 'string' && candidate.filename.length > 0 && candidate.filename.length <= 255
    && typeof candidate.mimeType === 'string' && candidate.mimeType.length > 0 && candidate.mimeType.length <= 255
    && Number.isSafeInteger(candidate.size) && candidate.size! >= 0 && candidate.size! <= MAX_LOCAL_DOCUMENT_BYTES
    && typeof candidate.contentId === 'string' && /^sha256-[a-f0-9]{64}$/i.test(candidate.contentId)
    && candidate.bytes instanceof Uint8Array && candidate.bytes.byteLength <= MAX_LOCAL_DOCUMENT_BYTES
    && typeof candidate.createdAt === 'string' && typeof candidate.ownerId === 'string';
}

async function contentMatches(bytes: Uint8Array, contentId: string): Promise<boolean> {
  return `sha256-${await sha256(bytes)}`.toLowerCase() === contentId.toLowerCase();
}

function decodeBase64(value: string): Uint8Array | undefined {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return undefined;
  }
}
