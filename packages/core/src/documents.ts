/**
 * R0P93 Documents, Reader, annotations, local OCR and document capture.
 *
 * Documents are a view over the canonical Files/content-addressed layer. The
 * service keeps only bounded derived text and private user metadata; it never
 * becomes a second byte store and it never rewrites source Files or Photos.
 */

import { createContentManifest, sha256, type ContentCache, type ContentId } from './social/content.js';
import { FileService } from './social/files.js';
import type { EncryptedFileMetadata, FileObject } from './social/object-model.js';

export const DOCUMENT_PROTOCOL = 'keystone.documents.r0p93' as const;
export const DOCUMENT_STATE_VERSION = 1 as const;
export const DOCUMENT_MAX_SOURCE_BYTES = 512 * 1024 * 1024;
export const DOCUMENT_MAX_TEXT_BYTES = 16 * 1024 * 1024;
export const DOCUMENT_MAX_PAGES = 10_000;
export const DOCUMENT_MAX_CHAPTERS = 10_000;
export const DOCUMENT_MAX_OUTLINE_DEPTH = 32;
export const DOCUMENT_MAX_LINKS = 10_000;
export const DOCUMENT_MAX_RENDER_CACHE = 16;
export const DOCUMENT_MAX_ANNOTATIONS = 100_000;
export const DOCUMENT_MAX_SEARCH_DOCUMENTS = 100_000;
export const DOCUMENT_MAX_OCR_TEXT = 16 * 1024 * 1024;
export const DOCUMENT_MAX_OCR_REGIONS = 100_000;
export const DOCUMENT_MAX_CAPTURE_PAGES = 256;
export const DOCUMENT_MAX_CAPTURE_PAGE_BYTES = 64 * 1024 * 1024;
export const DOCUMENT_MAX_CAPTURE_DRAFTS = 32;

export type DocumentFormat = 'PDF' | 'EPUB' | 'MARKDOWN' | 'PLAIN_TEXT';
export type DocumentId = string & { readonly __documentId: unique symbol };
export type DocumentRevisionId = string & { readonly __documentRevisionId: unique symbol };
export type DocumentAnnotationId = string & { readonly __documentAnnotationId: unique symbol };
export type DocumentCaptureDraftId = string & { readonly __documentCaptureDraftId: unique symbol };

export type DocumentErrorCode =
  | 'INVALID_ARGUMENT'
  | 'NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'UNSUPPORTED'
  | 'MALFORMED'
  | 'RESOURCE_LIMIT'
  | 'INTEGRITY'
  | 'UNAVAILABLE'
  | 'CANCELLED'
  | 'CONFLICT';

export class DocumentError extends Error {
  constructor(readonly code: DocumentErrorCode, message: string) {
    super(message);
    this.name = 'DocumentError';
  }
}

export interface DocumentRevisionRef {
  readonly version: 1;
  readonly fileId: string;
  /** A FileObject content hash is the revision when no mutable File revision exists. */
  readonly revisionId: DocumentRevisionId | string;
  readonly contentId?: ContentId;
}

export interface DocumentFileRef {
  readonly fileId: string;
  readonly revision: DocumentRevisionRef;
  readonly filename: string;
  readonly mimeType: string;
  readonly size: number;
  readonly contentId?: ContentId;
  readonly visibility?: 'private' | 'contacts' | 'community' | 'public';
  readonly ownerId?: string;
  readonly scope?: string;
}

export function createDocumentFileRef(file: FileObject): DocumentFileRef {
  const contentId = file.payload.contentId as ContentId;
  return {
    fileId: file.id,
    revision: { version: 1, fileId: file.id, revisionId: contentId, contentId },
    filename: file.payload.filename,
    mimeType: file.payload.mimeType,
    size: file.payload.size,
    contentId,
    visibility: file.visibility,
    ownerId: file.payload.owner,
  };
}

export interface DocumentFileSource {
  getFile(fileId: string, actorIdentityId?: string): Promise<DocumentFileRef | undefined>;
  readFile(file: DocumentFileRef, options?: { readonly signal?: AbortSignal }): Promise<Uint8Array | undefined>;
  listFiles?(actorIdentityId?: string): Promise<readonly DocumentFileRef[]>;
}

/** Adapter over the existing FileService and R0P74 ContentCache. */
export class ContentCacheDocumentFileSource implements DocumentFileSource {
  constructor(readonly files: FileService, readonly cache: ContentCache) {}

  async getFile(fileId: string): Promise<DocumentFileRef | undefined> {
    const file = await this.files.get(fileId);
    return file ? createDocumentFileRef(file) : undefined;
  }

  async readFile(file: DocumentFileRef): Promise<Uint8Array | undefined> {
    if (!file.contentId) return undefined;
    return this.cache.read(file.contentId);
  }

  async listFiles(): Promise<readonly DocumentFileRef[]> {
    return (await this.files.list()).map(createDocumentFileRef);
  }
}

/** A source adapter for shared-folder or Mail attachment host projections. */
export class StaticDocumentFileSource implements DocumentFileSource {
  private readonly files = new Map<string, DocumentFileRef>();

  constructor(private readonly reader: (file: DocumentFileRef, signal?: AbortSignal) => Promise<Uint8Array | undefined>, refs: readonly DocumentFileRef[] = []) {
    for (const ref of refs) this.files.set(ref.fileId, clone(ref));
  }

  register(ref: DocumentFileRef): void { this.files.set(ref.fileId, clone(ref)); }
  async getFile(fileId: string): Promise<DocumentFileRef | undefined> { return clone(this.files.get(fileId)); }
  readFile(file: DocumentFileRef, options: { readonly signal?: AbortSignal } = {}): Promise<Uint8Array | undefined> { return this.reader(file, options.signal); }
  async listFiles(): Promise<readonly DocumentFileRef[]> { return [...this.files.values()].map(clone); }
}

export interface DocumentFileWriter {
  importDocument(input: { readonly bytes: Uint8Array; readonly filename: string; readonly mimeType: 'application/pdf'; readonly source?: string }): Promise<DocumentFileRef>;
}

export class FileServiceDocumentWriter implements DocumentFileWriter {
  constructor(private readonly files: FileService, private readonly encrypted?: EncryptedFileMetadata) {}

  async importDocument(input: { readonly bytes: Uint8Array; readonly filename: string; readonly mimeType: 'application/pdf'; readonly source?: string }): Promise<DocumentFileRef> {
    if (!this.encrypted) throw new DocumentError('UNAVAILABLE', 'FileService document writes require caller-provided encrypted content metadata');
    const result = await this.files.import({
      bytes: input.bytes,
      filename: input.filename,
      mimeType: input.mimeType,
      description: input.source ? `Created by document capture from ${input.source}` : 'Created by document capture',
      visibility: 'private',
      encrypted: this.encrypted,
    });
    return createDocumentFileRef(result.file);
  }
}

export interface DocumentLocator {
  readonly version: 1;
  readonly revision: DocumentRevisionRef;
  readonly kind: 'DOCUMENT' | 'PDF_PAGE' | 'EPUB_CHAPTER' | 'TEXT_RANGE';
  readonly page?: number;
  readonly chapterId?: string;
  readonly start?: number;
  readonly end?: number;
  readonly quote?: string;
  readonly contextBefore?: string;
  readonly contextAfter?: string;
}

export interface DocumentLink {
  readonly start: number;
  readonly end: number;
  readonly label: string;
  readonly target: string;
  readonly kind: 'EXTERNAL_HTTP' | 'INTERNAL' | 'BLOCKED';
  readonly requiresExplicitAction: true;
}

export type DocumentBlock =
  | { readonly type: 'heading'; readonly id: string; readonly level: 1 | 2 | 3 | 4 | 5 | 6; readonly text: string }
  | { readonly type: 'paragraph'; readonly id: string; readonly text: string; readonly links: readonly DocumentLink[] }
  | { readonly type: 'blockquote'; readonly id: string; readonly text: string }
  | { readonly type: 'list'; readonly id: string; readonly ordered: boolean; readonly items: readonly string[] }
  | { readonly type: 'code'; readonly id: string; readonly language?: string; readonly text: string }
  | { readonly type: 'image'; readonly id: string; readonly sourcePath?: string; readonly alt: string; readonly available: boolean }
  | { readonly type: 'separator'; readonly id: string };

export interface DocumentPage {
  readonly pageNumber: number;
  readonly id: string;
  readonly locator: DocumentLocator;
  readonly text: string;
  readonly blocks: readonly DocumentBlock[];
  readonly links: readonly DocumentLink[];
  readonly width?: number;
  readonly height?: number;
  readonly rotation: 0 | 90 | 180 | 270;
  readonly textLayer: 'EXTRACTED' | 'OCR' | 'NONE';
  readonly imageAvailable: boolean;
}

export interface DocumentChapter {
  readonly id: string;
  readonly index: number;
  readonly title: string;
  readonly href?: string;
  readonly text: string;
  readonly blocks: readonly DocumentBlock[];
  readonly links: readonly DocumentLink[];
  readonly locator: DocumentLocator;
}

export interface DocumentOutlineEntry {
  readonly id: string;
  readonly title: string;
  readonly page?: number;
  readonly chapterId?: string;
  readonly children: readonly DocumentOutlineEntry[];
}

export interface PdfSecurityReport {
  readonly javascript: false;
  readonly launch: false;
  readonly automaticFormSubmission: false;
  readonly embeddedFilesAutoOpened: false;
  readonly externalLinks: readonly DocumentLink[];
  readonly blockedActionCount: number;
  readonly blockedActions: readonly ('JAVASCRIPT' | 'LAUNCH' | 'GOTO_REMOTE' | 'SUBMIT_FORM' | 'IMPORT_DATA' | 'EMBEDDED_FILE' | 'PRIVILEGED_URI')[];
}

export interface DocumentModel {
  readonly format: DocumentFormat;
  readonly title: string;
  readonly pages: readonly DocumentPage[];
  readonly chapters: readonly DocumentChapter[];
  readonly outline: readonly DocumentOutlineEntry[];
  readonly text: string;
  readonly links: readonly DocumentLink[];
  readonly metadata: Readonly<Record<string, string | number | boolean | undefined>>;
  readonly security?: PdfSecurityReport;
  readonly renderPage?: (pageNumber: number, options?: { readonly scale?: number; readonly signal?: AbortSignal }) => Promise<DocumentRenderedPage>;
}

export interface DocumentRenderedPage {
  readonly pageNumber: number;
  readonly mode: 'STATIC_SAFE' | 'RASTER';
  readonly text: string;
  readonly blocks: readonly DocumentBlock[];
  readonly width?: number;
  readonly height?: number;
  readonly rotation: 0 | 90 | 180 | 270;
  readonly mimeType?: 'image/png' | 'image/jpeg';
  readonly imageBytes?: Uint8Array;
  readonly scriptsExecuted: 0;
  readonly formsSubmitted: 0;
}

export interface DocumentDescriptor {
  readonly version: 1;
  readonly documentId: DocumentId;
  readonly file: DocumentFileRef;
  readonly revision: DocumentRevisionRef;
  readonly format: DocumentFormat;
  readonly title: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly size: number;
  readonly pageCount: number;
  readonly chapterCount: number;
  readonly hasTextLayer: boolean;
  readonly ocrStatus: 'NOT_REQUESTED' | 'AVAILABLE' | 'PARTIAL' | 'FAILED';
  readonly openedAt: string;
}

export interface DocumentReaderHandle {
  readonly document: DocumentDescriptor;
  readonly pages: readonly DocumentPage[];
  readonly chapters: readonly DocumentChapter[];
  readonly outline: readonly DocumentOutlineEntry[];
  readonly security?: PdfSecurityReport;
  renderPage(pageNumber: number, options?: { readonly scale?: number; readonly signal?: AbortSignal }): Promise<DocumentRenderedPage>;
  search(query: string, options?: { readonly limit?: number }): Promise<readonly DocumentSearchResult[]>;
  close(): void;
}

export interface DocumentAdapterInput {
  readonly file: DocumentFileRef;
  readonly bytes: Uint8Array;
  readonly signal?: AbortSignal;
}

export interface DocumentAdapter {
  readonly format: DocumentFormat;
  canHandle(file: DocumentFileRef): boolean;
  open(input: DocumentAdapterInput): Promise<DocumentModel>;
}

export interface PdfRuntimePage {
  readonly pageNumber: number;
  readonly text: string;
  readonly width?: number;
  readonly height?: number;
  readonly rotation?: number;
  readonly textLayer?: 'EXTRACTED' | 'NONE';
}

export interface PdfRuntimeInspection {
  readonly pages: readonly PdfRuntimePage[];
  readonly title?: string;
  readonly metadata?: Readonly<Record<string, string | number | boolean | undefined>>;
}

/** Optional production host boundary. It returns bounded models, never a process or file descriptor. */
export interface PdfRuntimeAdapter {
  readonly kind?: string;
  inspect(input: { readonly bytes: Uint8Array; readonly maxPages: number; readonly maxTextBytes: number; readonly signal?: AbortSignal }): Promise<PdfRuntimeInspection>;
  renderPage(input: { readonly bytes: Uint8Array; readonly pageNumber: number; readonly scale?: number; readonly signal?: AbortSignal }): Promise<{ readonly imageBytes: Uint8Array; readonly mimeType: 'image/png' | 'image/jpeg'; readonly width: number; readonly height: number; readonly rotation?: number }>;
}

export interface DocumentAdapterRegistryOptions { readonly adapters?: readonly DocumentAdapter[]; }

export class DocumentAdapterRegistry {
  private readonly adapters: DocumentAdapter[];

  constructor(options: DocumentAdapterRegistryOptions = {}) {
    this.adapters = [...(options.adapters ?? [new PdfDocumentAdapter(), new EpubDocumentAdapter(), new MarkdownDocumentAdapter(), new PlainTextDocumentAdapter()])];
  }

  register(adapter: DocumentAdapter): void {
    if (!adapter || typeof adapter.canHandle !== 'function' || typeof adapter.open !== 'function') throw new DocumentError('INVALID_ARGUMENT', 'Document adapter is incomplete');
    this.adapters.unshift(adapter);
  }

  list(): readonly DocumentAdapter[] { return [...this.adapters]; }

  resolve(file: DocumentFileRef): DocumentAdapter {
    const adapter = this.adapters.find(candidate => candidate.canHandle(file));
    if (!adapter) throw new DocumentError('UNSUPPORTED', `Unsupported document format: ${file.filename}`);
    return adapter;
  }

  async open(input: DocumentAdapterInput): Promise<DocumentModel> {
    const model = await this.resolve(input.file).open(input);
    return validateDocumentModel(model, input.file);
  }
}

export class PdfDocumentAdapter implements DocumentAdapter {
  readonly format = 'PDF' as const;

  constructor(private readonly runtime?: PdfRuntimeAdapter) {}

  canHandle(file: DocumentFileRef): boolean {
    return file.mimeType.toLowerCase() === 'application/pdf' || extension(file.filename) === 'pdf';
  }

  async open(input: DocumentAdapterInput): Promise<DocumentModel> {
    assertSourceBytes(input.bytes);
    const security = inspectPdfSecurity(input.bytes);
    if (this.runtime) {
      const inspected = await this.runtime.inspect({ bytes: input.bytes, maxPages: DOCUMENT_MAX_PAGES, maxTextBytes: DOCUMENT_MAX_TEXT_BYTES, signal: input.signal });
      const pages = inspected.pages.slice(0, DOCUMENT_MAX_PAGES).map((page, index) => {
        const pageNumber = Number.isSafeInteger(page.pageNumber) && page.pageNumber > 0 ? page.pageNumber : index + 1;
        const text = boundedText(page.text, DOCUMENT_MAX_TEXT_BYTES);
        const locator = pdfLocator(input.file.revision, pageNumber, 0, text.length, text.slice(0, 256));
        return pageModel(pageNumber, locator, text, text ? 'EXTRACTED' : 'NONE', [], [], page.width, page.height, normalizeRotation(page.rotation), true);
      });
      if (!pages.length) throw new DocumentError('MALFORMED', 'PDF contains no readable pages');
      const model: DocumentModel = {
        format: 'PDF', title: boundedText(inspected.title ?? pdfInfo(input.bytes).title ?? input.file.filename, 512), pages,
        chapters: [], outline: [], text: pages.map(page => page.text).join('\n\n'), links: security.externalLinks,
        metadata: { ...(inspected.metadata ?? {}), pageCount: pages.length, sourceMetadataUntrusted: true }, security,
        renderPage: async (pageNumber, options = {}) => {
          const rendered = await this.runtime!.renderPage({ bytes: input.bytes, pageNumber, scale: options.scale, signal: options.signal });
          const page = pages[pageNumber - 1];
          if (!page) throw new DocumentError('NOT_FOUND', 'PDF page is not available');
          return { pageNumber, mode: 'RASTER', text: page.text, blocks: page.blocks, width: rendered.width, height: rendered.height, rotation: normalizeRotation(rendered.rotation), mimeType: rendered.mimeType, imageBytes: rendered.imageBytes.slice(), scriptsExecuted: 0, formsSubmitted: 0 };
        },
      };
      return model;
    }
    return parsePdfModel(input.file, input.bytes, security);
  }
}

export class EpubDocumentAdapter implements DocumentAdapter {
  readonly format = 'EPUB' as const;

  canHandle(file: DocumentFileRef): boolean {
    return file.mimeType.toLowerCase() === 'application/epub+zip' || extension(file.filename) === 'epub';
  }

  async open(input: DocumentAdapterInput): Promise<DocumentModel> {
    assertSourceBytes(input.bytes);
    const archive = await readSafeZip(input.bytes);
    const container = archive.get('META-INF/container.xml');
    if (!container) throw new DocumentError('MALFORMED', 'EPUB container.xml is missing');
    const rootfile = attributeFromFirstTag(textDecode(container), 'rootfile', 'full-path');
    if (!rootfile) throw new DocumentError('MALFORMED', 'EPUB rootfile is missing');
    const opfPath = safeArchivePath(rootfile);
    const opf = archive.get(opfPath);
    if (!opf) throw new DocumentError('MALFORMED', 'EPUB package document is missing');
    const packageText = textDecode(opf);
    const manifest = parseEpubManifest(packageText);
    const spine = parseEpubSpine(packageText, manifest);
    if (!spine.length) throw new DocumentError('MALFORMED', 'EPUB spine is empty');
    const base = directoryOf(opfPath);
    const chapters: DocumentChapter[] = [];
    for (const [index, item] of spine.entries()) {
      if (input.signal?.aborted) throw new DocumentError('CANCELLED', 'EPUB open was cancelled');
      const path = safeArchivePath(joinArchivePath(base, item.href));
      const chapterBytes = archive.get(path);
      if (!chapterBytes) continue;
      const parsed = parseSafeEpubHtml(textDecode(chapterBytes), input.file.revision, item.id, archive, path);
      chapters.push({ id: item.id, index: chapters.length, title: parsed.title || item.label || `Chapter ${index + 1}`, href: item.href, text: parsed.text, blocks: parsed.blocks, links: parsed.links, locator: epubLocator(input.file.revision, item.id, 0, parsed.text.length, parsed.text.slice(0, 256)) });
    }
    if (!chapters.length) throw new DocumentError('MALFORMED', 'EPUB has no readable spine content');
    const toc = parseEpubToc(packageText, manifest, archive, base, input.file.revision);
    const pages = chapters.map((chapter, index) => pageModel(index + 1, chapter.locator, chapter.text, chapter.text ? 'EXTRACTED' : 'NONE', chapter.blocks, chapter.links, undefined, undefined, 0, chapter.blocks.some(block => block.type === 'image' && block.available)));
    const text = chapters.map(chapter => chapter.text).join('\n\n');
    return { format: 'EPUB', title: boundedText(textContentFromFirstTag(packageText, 'dc:title') ?? input.file.filename, 512), pages, chapters, outline: toc, text: boundedText(text, DOCUMENT_MAX_TEXT_BYTES), links: chapters.flatMap(chapter => chapter.links).slice(0, DOCUMENT_MAX_LINKS), metadata: { chapterCount: chapters.length, sourceMetadataUntrusted: true }, renderPage: async pageNumber => { const page = pages[pageNumber - 1]; if (!page) throw new DocumentError('NOT_FOUND', 'EPUB chapter is not available'); return { pageNumber, mode: 'STATIC_SAFE', text: page.text, blocks: page.blocks, rotation: 0, scriptsExecuted: 0, formsSubmitted: 0 }; } };
  }
}

export const EPUBDocumentAdapter = EpubDocumentAdapter;

export class MarkdownDocumentAdapter implements DocumentAdapter {
  readonly format = 'MARKDOWN' as const;
  canHandle(file: DocumentFileRef): boolean { return file.mimeType.toLowerCase() === 'text/markdown' || extension(file.filename) === 'md' || extension(file.filename) === 'markdown'; }
  async open(input: DocumentAdapterInput): Promise<DocumentModel> { return parseTextModel(input.file, textDecode(assertSourceBytes(input.bytes)), 'MARKDOWN'); }
}

export class PlainTextDocumentAdapter implements DocumentAdapter {
  readonly format = 'PLAIN_TEXT' as const;
  canHandle(file: DocumentFileRef): boolean { return file.mimeType.toLowerCase().startsWith('text/') || ['txt', 'text', 'log', 'csv'].includes(extension(file.filename)); }
  async open(input: DocumentAdapterInput): Promise<DocumentModel> { return parseTextModel(input.file, textDecode(assertSourceBytes(input.bytes)), 'PLAIN_TEXT'); }
}

export interface DocumentStateStore { read(): Promise<unknown | undefined>; write(value: unknown): Promise<void>; }

export class InMemoryDocumentStateStore implements DocumentStateStore {
  private value?: unknown;
  async read(): Promise<unknown | undefined> { return this.value === undefined ? undefined : structuredClone(this.value); }
  async write(value: unknown): Promise<void> { this.value = structuredClone(value); }
}

export interface DocumentReadingProgress {
  readonly version: 1;
  readonly key: string;
  readonly revision: DocumentRevisionRef;
  readonly locator: DocumentLocator;
  readonly updatedAt: string;
}

export type DocumentAnnotationKind = 'HIGHLIGHT' | 'NOTE' | 'BOOKMARK';
export interface DocumentAnnotation {
  readonly version: 1;
  readonly id: DocumentAnnotationId;
  readonly kind: DocumentAnnotationKind;
  readonly revision: DocumentRevisionRef;
  readonly locator: DocumentLocator;
  readonly selectedText?: string;
  readonly body?: string;
  readonly label?: string;
  readonly color?: 'yellow' | 'green' | 'blue' | 'pink';
  readonly ownerId: string;
  readonly versionNumber: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly deleted?: boolean;
}

export type DocumentBookmark = DocumentAnnotation & { readonly kind: 'BOOKMARK' };

export interface DocumentOcrRegion {
  readonly text: string;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly confidence?: number;
}

export interface DocumentOcrResult {
  readonly version: 1;
  readonly key: string;
  readonly revision: DocumentRevisionRef;
  readonly pageNumber: number;
  readonly imageHash: string;
  readonly text: string;
  readonly regions: readonly DocumentOcrRegion[];
  readonly confidence?: number;
  readonly language: string;
  readonly engine: string;
  readonly engineVersion?: string;
  readonly createdAt: string;
}

export interface DocumentSearchRecord {
  readonly documentId: DocumentId;
  readonly fileId: string;
  readonly revision: DocumentRevisionRef;
  readonly title: string;
  readonly format: DocumentFormat;
  readonly text: string;
  readonly ocrPages: readonly number[];
  readonly updatedAt: string;
}

export interface DocumentMetadataState {
  readonly version: 1;
  readonly ownerId: string;
  readonly progress: Readonly<Record<string, DocumentReadingProgress>>;
  readonly annotations: Readonly<Record<string, DocumentAnnotation>>;
  readonly annotationTombstones: Readonly<Record<string, DocumentAnnotation>>;
  readonly ocr: Readonly<Record<string, DocumentOcrResult>>;
  readonly index: Readonly<Record<string, DocumentSearchRecord>>;
  readonly recent: readonly { readonly documentId: DocumentId; readonly revision: DocumentRevisionRef; readonly at: string }[];
}

function emptyMetadata(ownerId: string): DocumentMetadataState {
  return { version: 1, ownerId, progress: {}, annotations: {}, annotationTombstones: {}, ocr: {}, index: {}, recent: [] };
}

export class DocumentMetadataRepository {
  private state?: DocumentMetadataState;
  private loading?: Promise<void>;
  private writes: Promise<void> = Promise.resolve();

  constructor(private readonly store: DocumentStateStore = new InMemoryDocumentStateStore(), private readonly ownerId = 'local-owner') {}

  async ready(): Promise<void> {
    this.loading ??= this.store.read().then(value => { this.state = parseMetadataState(value, this.ownerId); });
    await this.loading;
  }

  snapshot(): DocumentMetadataState { if (!this.state) throw new DocumentError('UNAVAILABLE', 'Document metadata is not ready'); return clone(this.state); }

  async mutate(mutator: (state: DocumentMetadataState) => DocumentMetadataState): Promise<DocumentMetadataState> {
    await this.ready();
    const next = parseMetadataState(mutator(this.state!), this.ownerId);
    const operation = this.writes.then(() => this.store.write(clone(next)));
    this.writes = operation.catch(() => undefined);
    await operation;
    this.state = next;
    return clone(next);
  }
}

export interface AnnotationServiceOptions {
  readonly repository?: DocumentMetadataRepository;
  readonly stateStore?: DocumentStateStore;
  readonly ownerId?: string;
  readonly now?: () => number;
  readonly maxAnnotations?: number;
}

export interface AddDocumentAnnotationInput {
  readonly kind: DocumentAnnotationKind;
  readonly revision: DocumentRevisionRef;
  readonly locator: DocumentLocator;
  readonly selectedText?: string;
  readonly body?: string;
  readonly label?: string;
  readonly color?: DocumentAnnotation['color'];
}

export class AnnotationService {
  private readonly repository: DocumentMetadataRepository;
  private readonly ownerId: string;
  private readonly now: () => number;
  private readonly maxAnnotations: number;
  private revisionValidator?: (revision: DocumentRevisionRef) => Promise<boolean> | boolean;
  private lastAction?: { readonly kind: 'CREATE' | 'DELETE'; readonly annotation: DocumentAnnotation };

  constructor(options: AnnotationServiceOptions = {}) {
    this.ownerId = safeOwnerId(options.ownerId ?? 'local-owner');
    this.repository = options.repository ?? new DocumentMetadataRepository(options.stateStore, this.ownerId);
    this.now = options.now ?? Date.now;
    this.maxAnnotations = clampInt(options.maxAnnotations ?? DOCUMENT_MAX_ANNOTATIONS, 1, DOCUMENT_MAX_ANNOTATIONS);
  }

  setRevisionValidator(validator: (revision: DocumentRevisionRef) => Promise<boolean> | boolean): void { this.revisionValidator = validator; }
  async ready(): Promise<void> { await this.repository.ready(); }

  async add(input: AddDocumentAnnotationInput): Promise<DocumentAnnotation> {
    await this.ready();
    await this.assertRevision(input.revision);
    const selectedText = input.selectedText === undefined ? undefined : boundedText(input.selectedText, 64 * 1024);
    const body = input.body === undefined ? undefined : boundedText(input.body, 64 * 1024);
    const label = input.label === undefined ? undefined : boundedText(input.label, 512);
    if (input.kind === 'HIGHLIGHT' && !selectedText?.trim()) throw new DocumentError('INVALID_ARGUMENT', 'Highlight text is required');
    if (input.kind === 'NOTE' && !body?.trim()) throw new DocumentError('INVALID_ARGUMENT', 'Note body is required');
    const state = this.repository.snapshot();
    if (Object.values(state.annotations).filter(value => !value.deleted).length >= this.maxAnnotations) throw new DocumentError('RESOURCE_LIMIT', 'Annotation limit exceeded');
    const now = nowIso(this.now);
    const annotation: DocumentAnnotation = { version: 1, id: randomId('annotation') as DocumentAnnotationId, kind: input.kind, revision: clone(input.revision), locator: normalizeLocator(input.locator), ...(selectedText ? { selectedText } : {}), ...(body ? { body } : {}), ...(label ? { label } : {}), ...(input.color ? { color: input.color } : {}), ownerId: this.ownerId, versionNumber: 1, createdAt: now, updatedAt: now };
    await this.repository.mutate(current => ({ ...current, annotations: { ...current.annotations, [annotation.id]: annotation } }));
    this.lastAction = { kind: 'CREATE', annotation };
    return clone(annotation);
  }

  addHighlight(input: Omit<AddDocumentAnnotationInput, 'kind'>): Promise<DocumentAnnotation> { return this.add({ ...input, kind: 'HIGHLIGHT' }); }
  addNote(input: Omit<AddDocumentAnnotationInput, 'kind'>): Promise<DocumentAnnotation> { return this.add({ ...input, kind: 'NOTE' }); }
  addBookmark(input: Omit<AddDocumentAnnotationInput, 'kind'>): Promise<DocumentBookmark> { return this.add({ ...input, kind: 'BOOKMARK' }) as Promise<DocumentBookmark>; }

  async update(id: string, patch: Pick<AddDocumentAnnotationInput, 'body' | 'label' | 'color' | 'selectedText'>): Promise<DocumentAnnotation> {
    await this.ready();
    const current = this.repository.snapshot().annotations[id];
    if (!current || current.deleted || current.ownerId !== this.ownerId) throw new DocumentError('NOT_FOUND', 'Annotation not found');
    const updated: DocumentAnnotation = { ...current, ...(patch.body === undefined ? {} : { body: boundedText(patch.body, 64 * 1024) }), ...(patch.label === undefined ? {} : { label: boundedText(patch.label, 512) }), ...(patch.selectedText === undefined ? {} : { selectedText: boundedText(patch.selectedText, 64 * 1024) }), ...(patch.color === undefined ? {} : { color: patch.color }), versionNumber: current.versionNumber + 1, updatedAt: nowIso(this.now) };
    await this.repository.mutate(state => ({ ...state, annotations: { ...state.annotations, [id]: updated } }));
    return clone(updated);
  }

  async delete(id: string): Promise<void> {
    await this.ready();
    const current = this.repository.snapshot().annotations[id];
    if (!current || current.ownerId !== this.ownerId) throw new DocumentError('NOT_FOUND', 'Annotation not found');
    const tombstone: DocumentAnnotation = { ...current, deleted: true, versionNumber: current.versionNumber + 1, updatedAt: nowIso(this.now) };
    await this.repository.mutate(state => ({ ...state, annotations: { ...state.annotations, [id]: tombstone }, annotationTombstones: { ...state.annotationTombstones, [id]: tombstone } }));
    this.lastAction = { kind: 'DELETE', annotation: current };
  }

  async get(id: string): Promise<DocumentAnnotation | undefined> { await this.ready(); return clone(this.repository.snapshot().annotations[id]); }

  async list(revision?: DocumentRevisionRef, options: { readonly includeDeleted?: boolean } = {}): Promise<readonly DocumentAnnotation[]> {
    await this.ready();
    return Object.values(this.repository.snapshot().annotations).filter(value => (options.includeDeleted || !value.deleted) && (!revision || sameRevision(value.revision, revision))).sort(compareUpdated).map(clone);
  }

  async search(query: string, limit = 64): Promise<readonly DocumentAnnotation[]> {
    await this.ready();
    const terms = tokenize(query);
    if (!terms.length) return [];
    return Object.values(this.repository.snapshot().annotations).filter(value => {
      if (value.deleted) return false;
      const haystack = `${value.selectedText ?? ''} ${value.body ?? ''} ${value.label ?? ''}`.toLocaleLowerCase();
      return terms.every(term => haystack.includes(term));
    }).sort(compareUpdated).slice(0, clampInt(limit, 1, 256)).map(clone);
  }

  async undo(): Promise<DocumentAnnotation | undefined> {
    const action = this.lastAction;
    if (!action) return undefined;
    this.lastAction = undefined;
    if (action.kind === 'CREATE') { await this.delete(action.annotation.id); return undefined; }
    const restored = { ...action.annotation, deleted: undefined, versionNumber: action.annotation.versionNumber + 1, updatedAt: nowIso(this.now) };
    await this.repository.mutate(state => ({ ...state, annotations: { ...state.annotations, [restored.id]: restored }, annotationTombstones: { ...state.annotationTombstones, [restored.id]: { ...restored, deleted: true } } }));
    return clone(restored);
  }

  exportSync(): DocumentPrivateSyncEnvelope {
    const state = this.repository.snapshot();
    return { version: 1, protocol: DOCUMENT_PROTOCOL, ownerId: state.ownerId, progress: Object.values(state.progress).map(clone), annotations: Object.values(state.annotations).filter(value => !value.deleted).map(clone), tombstones: Object.values(state.annotationTombstones).map(clone) };
  }

  async mergeSync(envelope: DocumentPrivateSyncEnvelope): Promise<void> {
    await this.ready();
    if (envelope.version !== 1 || envelope.protocol !== DOCUMENT_PROTOCOL || envelope.ownerId !== this.ownerId) throw new DocumentError('UNAUTHORIZED', 'Document private sync owner mismatch');
    const incomingAnnotations = [...envelope.annotations, ...envelope.tombstones].slice(0, DOCUMENT_MAX_ANNOTATIONS);
    await this.repository.mutate(state => {
      const annotations = { ...state.annotations };
      const tombstones = { ...state.annotationTombstones };
      const progress = { ...state.progress };
      for (const candidate of envelope.progress.slice(0, DOCUMENT_MAX_SEARCH_DOCUMENTS)) {
        if (!candidate || candidate.version !== 1 || typeof candidate.key !== 'string' || !candidate.key || !candidate.revision?.fileId || !candidate.revision.revisionId || !candidate.locator) continue;
        const normalized = { ...candidate, revision: clone(candidate.revision), locator: normalizeLocator(candidate.locator) };
        const current = progress[candidate.key];
        if (!current || current.updatedAt.localeCompare(normalized.updatedAt) < 0) progress[candidate.key] = normalized;
      }
      for (const candidate of incomingAnnotations) {
        if (!isDocumentAnnotation(candidate) || candidate.ownerId !== this.ownerId) continue;
        const current = annotations[candidate.id];
        if (current && compareAnnotationVersion(current, candidate) >= 0) continue;
        annotations[candidate.id] = clone(candidate);
        if (candidate.deleted) tombstones[candidate.id] = clone(candidate);
      }
      return { ...state, progress, annotations, annotationTombstones: tombstones };
    });
  }

  async exportMarkdown(revision: DocumentRevisionRef): Promise<string> {
    const annotations = await this.list(revision);
    return annotations.map(annotation => {
      const citation = formatCitation(annotation.locator);
      if (annotation.kind === 'HIGHLIGHT') return `- **${citation}**: ${annotation.selectedText ?? ''}${annotation.body ? ` — ${annotation.body}` : ''}`;
      if (annotation.kind === 'BOOKMARK') return `- **${citation}**${annotation.label ? `: ${annotation.label}` : ''}`;
      return `- **${citation}**: ${annotation.body ?? ''}`;
    }).join('\n');
  }

  private async assertRevision(revision: DocumentRevisionRef): Promise<void> { if (!revision || revision.version !== 1 || typeof revision.fileId !== 'string' || !revision.fileId || (typeof revision.revisionId !== 'string' && typeof revision.revisionId !== 'number')) throw new DocumentError('INVALID_ARGUMENT', 'Document revision is invalid'); if (revision.contentId !== undefined && typeof revision.contentId !== 'string') throw new DocumentError('INVALID_ARGUMENT', 'Document content revision is invalid'); if (this.revisionValidator && !(await this.revisionValidator(revision))) throw new DocumentError('UNAUTHORIZED', 'Document revision is unavailable'); }
}

export interface DocumentPrivateSyncEnvelope {
  readonly version: 1;
  readonly protocol: typeof DOCUMENT_PROTOCOL;
  readonly ownerId: string;
  readonly progress: readonly DocumentReadingProgress[];
  readonly annotations: readonly DocumentAnnotation[];
  readonly tombstones: readonly DocumentAnnotation[];
}

export interface DocumentSearchResult {
  readonly documentId: DocumentId;
  readonly fileId: string;
  readonly revision: DocumentRevisionRef;
  readonly title: string;
  readonly format: DocumentFormat;
  readonly locator: DocumentLocator;
  readonly snippet: string;
  readonly source: 'TITLE' | 'TEXT' | 'OCR' | 'ANNOTATION';
  readonly score: number;
}

export class DocumentSearchIndex {
  private readonly records = new Map<string, DocumentSearchRecord>();

  constructor(private readonly maxDocuments = DOCUMENT_MAX_SEARCH_DOCUMENTS) {}
  upsert(record: DocumentSearchRecord): void { if (this.records.size >= this.maxDocuments && !this.records.has(record.documentId)) throw new DocumentError('RESOURCE_LIMIT', 'Document search index limit exceeded'); this.records.set(record.documentId, { ...record, text: boundedText(record.text, DOCUMENT_MAX_TEXT_BYTES), ocrPages: record.ocrPages.slice(0, DOCUMENT_MAX_PAGES) }); }
  remove(documentId: string): void { this.records.delete(documentId); }
  size(): number { return this.records.size; }
  recordsList(): readonly DocumentSearchRecord[] { return [...this.records.values()].map(clone); }
  search(query: string, limit = 64): readonly DocumentSearchResult[] {
    const terms = tokenize(query);
    if (!terms.length) return [];
    const results: DocumentSearchResult[] = [];
    for (const record of this.records.values()) {
      const textHaystack = record.text.toLocaleLowerCase();
      const haystack = `${record.title}\n${record.text}`.toLocaleLowerCase();
      const matched = terms.filter(term => haystack.includes(term));
      if (!matched.length) continue;
      const textPosition = textHaystack.indexOf(matched[0]!);
      const titlePosition = record.title.toLocaleLowerCase().indexOf(matched[0]!);
      const position = textPosition >= 0 ? textPosition : Math.max(0, titlePosition);
      const source: DocumentSearchResult['source'] = textPosition >= 0 ? record.ocrPages.length ? 'OCR' : 'TEXT' : titlePosition >= 0 ? 'TITLE' : 'TEXT';
      const start = Math.max(0, position - 80);
      const snippet = safeSnippet(record.text || record.title, start, 240);
      results.push({ documentId: record.documentId, fileId: record.fileId, revision: clone(record.revision), title: record.title, format: record.format, locator: textLocator(record.revision, position, position + matched.join(' ').length, snippet), snippet, source, score: matched.length / terms.length + (source === 'TITLE' ? 0.5 : 0) });
    }
    return results.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, clampInt(limit, 1, 256)).map(clone);
  }
}

export interface OcrAdapterInput {
  readonly imageBytes: Uint8Array;
  readonly mimeType: string;
  readonly language: string;
  readonly maxOutputChars: number;
  readonly maxRegions: number;
  readonly signal?: AbortSignal;
}

export interface OcrAdapter {
  readonly id: string;
  readonly version: string;
  readonly languages: readonly string[];
  recognize(input: OcrAdapterInput): Promise<OcrAdapterResult>;
}

export interface OcrAdapterResult {
  readonly text: string;
  readonly regions?: readonly DocumentOcrRegion[];
  readonly confidence?: number;
  readonly language?: string;
  readonly engineVersion?: string;
}

export class ControlledOcrAdapter implements OcrAdapter {
  readonly id = 'controlled-ocr';
  readonly version = 'test';
  readonly languages: readonly string[];
  constructor(private readonly handler: (input: OcrAdapterInput) => Promise<OcrAdapterResult> | OcrAdapterResult, languages: readonly string[] = ['eng']) { this.languages = [...languages]; }
  recognize(input: OcrAdapterInput): Promise<OcrAdapterResult> { return Promise.resolve(this.handler(input)); }
}

interface OcrQueueItem { readonly id: string; readonly input: OcrAdapterInput; readonly resolve: (value: DocumentOcrResult) => void; readonly reject: (reason?: unknown) => void; readonly cleanup: () => void; }

export class OCRService {
  private readonly queue: OcrQueueItem[] = [];
  private readonly controllers = new Map<string, AbortController>();
  private active = 0;
  private sequence = 0;

  constructor(private readonly adapter: OcrAdapter, options: { readonly maxWorkers?: number; readonly maxQueue?: number; readonly now?: () => number } = {}) {
    if (!adapter || typeof adapter.recognize !== 'function' || !adapter.id) throw new DocumentError('INVALID_ARGUMENT', 'OCR adapter is incomplete');
    this.maxWorkers = clampInt(options.maxWorkers ?? 2, 1, 8);
    this.maxQueue = clampInt(options.maxQueue ?? 64, 0, 512);
    this.now = options.now ?? Date.now;
  }

  private readonly maxWorkers: number;
  private readonly maxQueue: number;
  private readonly now: () => number;

  activeWorkers(): number { return this.active; }
  queuedJobs(): number { return this.queue.length; }
  languages(): readonly string[] { return [...this.adapter.languages]; }

  submit(input: OcrAdapterInput): { readonly jobId: string; readonly promise: Promise<DocumentOcrResult> } {
    if (!(input.imageBytes instanceof Uint8Array) || input.imageBytes.byteLength < 1 || input.imageBytes.byteLength > DOCUMENT_MAX_CAPTURE_PAGE_BYTES) throw new DocumentError('RESOURCE_LIMIT', 'OCR image exceeds the bounded input limit');
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(input.language) || (this.adapter.languages.length && !this.adapter.languages.includes(input.language))) throw new DocumentError('UNSUPPORTED', `OCR language is unavailable: ${input.language}`);
    if (this.queue.length >= this.maxQueue) throw new DocumentError('RESOURCE_LIMIT', 'OCR queue is full');
    const jobId = `ocr-job-${++this.sequence}`;
    const controller = new AbortController();
    const promise = new Promise<DocumentOcrResult>((resolve, reject) => {
      const abortExternal = () => controller.abort();
      if (input.signal?.aborted) { reject(new DocumentError('CANCELLED', 'OCR job was cancelled')); return; }
      input.signal?.addEventListener('abort', abortExternal, { once: true });
      this.queue.push({ id: jobId, input: { ...input, imageBytes: input.imageBytes.slice(), signal: controller.signal }, resolve, reject, cleanup: () => input.signal?.removeEventListener('abort', abortExternal) });
      this.controllers.set(jobId, controller);
      this.drain();
    });
    return { jobId, promise };
  }

  cancel(jobId: string): void { this.controllers.get(jobId)?.abort(); }
  cancelAll(): void { for (const controller of this.controllers.values()) controller.abort(); }

  private drain(): void {
    while (this.active < this.maxWorkers && this.queue.length) {
      const item = this.queue.shift()!;
      const controller = this.controllers.get(item.id);
      if (!controller || controller.signal.aborted) { item.cleanup(); item.reject(new DocumentError('CANCELLED', 'OCR job was cancelled')); this.controllers.delete(item.id); continue; }
      this.active++;
      void this.run(item).finally(() => { item.cleanup(); this.active--; this.controllers.delete(item.id); this.drain(); });
    }
  }

  private async run(item: OcrQueueItem): Promise<void> {
    try {
      const raw = await this.adapter.recognize(item.input);
      const text = boundedText(raw.text, clampInt(item.input.maxOutputChars, 1, DOCUMENT_MAX_OCR_TEXT));
      const regions = (raw.regions ?? []).slice(0, clampInt(item.input.maxRegions, 0, DOCUMENT_MAX_OCR_REGIONS)).map(region => validateOcrRegion(region));
      const confidence = raw.confidence === undefined ? undefined : validateConfidence(raw.confidence);
      item.resolve({ version: 1, key: item.id, revision: { version: 1, fileId: item.id, revisionId: item.id }, pageNumber: 1, imageHash: await sha256(item.input.imageBytes), text, regions, ...(confidence === undefined ? {} : { confidence }), language: raw.language ?? item.input.language, engine: this.adapter.id, ...(raw.engineVersion ?? this.adapter.version ? { engineVersion: raw.engineVersion ?? this.adapter.version } : {}), createdAt: nowIso(this.now) });
    } catch (error) { item.reject(error instanceof DocumentError ? error : new DocumentError('UNAVAILABLE', error instanceof Error ? error.message : 'OCR failed')); }
  }
}

export const OcrService = OCRService;

export interface DocumentOcrJob {
  readonly jobId: string;
  readonly documentId: DocumentId;
  readonly state: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'PARTIAL' | 'CANCELLED' | 'FAILED';
  readonly completedPages: number;
  readonly totalPages: number;
  readonly failedPages: readonly number[];
  readonly updatedAt: string;
  readonly error?: string;
}

export interface DocumentCapturePageInput {
  readonly pageId?: string;
  readonly sourceFile?: DocumentFileRef;
  readonly bytes?: Uint8Array;
  readonly filename?: string;
  readonly mimeType?: string;
}

export interface PageTransform {
  readonly rotation: 0 | 90 | 180 | 270;
  readonly crop?: { readonly left: number; readonly top: number; readonly width: number; readonly height: number };
}

export interface CapturedPage {
  readonly pageId: string;
  readonly sourceFileId?: string;
  readonly sourceRevision?: DocumentRevisionRef;
  readonly filename: string;
  readonly mimeType: string;
  readonly byteLength: number;
  readonly transform: PageTransform;
  readonly position: number;
}

export interface DocumentCaptureDraft {
  readonly version: 1;
  readonly id: DocumentCaptureDraftId;
  readonly title: string;
  readonly pages: readonly CapturedPage[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly state: 'ACTIVE' | 'EXPORTED' | 'CANCELLED';
}

export interface DocumentCaptureServiceOptions {
  readonly source?: DocumentFileSource;
  readonly writer?: DocumentFileWriter;
  readonly now?: () => number;
  readonly maxPages?: number;
  readonly maxPageBytes?: number;
}

interface CapturePageData extends Omit<CapturedPage, 'transform' | 'position'> { transform: PageTransform; position: number; readonly bytes: Uint8Array; }
interface MutableCaptureDraft { readonly id: DocumentCaptureDraftId; title: string; pages: CapturePageData[]; createdAt: string; updatedAt: string; state: DocumentCaptureDraft['state']; }

export class DocumentCaptureService {
  private readonly drafts = new Map<DocumentCaptureDraftId, MutableCaptureDraft>();
  private readonly source?: DocumentFileSource;
  private readonly writer?: DocumentFileWriter;
  private readonly now: () => number;
  private readonly maxPages: number;
  private readonly maxPageBytes: number;

  constructor(options: DocumentCaptureServiceOptions = {}) { this.source = options.source; this.writer = options.writer; this.now = options.now ?? Date.now; this.maxPages = clampInt(options.maxPages ?? DOCUMENT_MAX_CAPTURE_PAGES, 1, DOCUMENT_MAX_CAPTURE_PAGES); this.maxPageBytes = clampInt(options.maxPageBytes ?? DOCUMENT_MAX_CAPTURE_PAGE_BYTES, 1, DOCUMENT_MAX_CAPTURE_PAGE_BYTES); }

  createDraft(title = 'Scanned document'): DocumentCaptureDraft {
    if (this.drafts.size >= DOCUMENT_MAX_CAPTURE_DRAFTS) throw new DocumentError('RESOURCE_LIMIT', 'Too many active capture drafts');
    const now = nowIso(this.now); const draft: MutableCaptureDraft = { id: randomId('capture') as DocumentCaptureDraftId, title: boundedText(title, 240) || 'Scanned document', pages: [], createdAt: now, updatedAt: now, state: 'ACTIVE' }; this.drafts.set(draft.id, draft); return publicDraft(draft);
  }

  getDraft(id: string): DocumentCaptureDraft | undefined { const draft = this.drafts.get(id as DocumentCaptureDraftId); return draft ? publicDraft(draft) : undefined; }

  async addPage(id: DocumentCaptureDraftId, input: DocumentCapturePageInput): Promise<CapturedPage> {
    const draft = this.requireDraft(id); if (draft.pages.length >= this.maxPages) throw new DocumentError('RESOURCE_LIMIT', 'Capture page limit exceeded');
    const bytes = input.bytes ? input.bytes.slice() : input.sourceFile && this.source ? await this.source.readFile(input.sourceFile) : undefined;
    if (!bytes?.byteLength || bytes.byteLength > this.maxPageBytes) throw new DocumentError('RESOURCE_LIMIT', 'Capture page exceeds the bounded image limit');
    const mimeType = (input.mimeType ?? input.sourceFile?.mimeType ?? '').toLowerCase(); if (!mimeType.startsWith('image/')) throw new DocumentError('UNSUPPORTED', 'Capture pages must be images');
    const page: CapturePageData = { pageId: input.pageId?.trim() || randomId('page'), ...(input.sourceFile ? { sourceFileId: input.sourceFile.fileId, sourceRevision: clone(input.sourceFile.revision) } : {}), filename: boundedText(input.filename ?? input.sourceFile?.filename ?? `page-${draft.pages.length + 1}`, 255), mimeType, byteLength: bytes.byteLength, transform: { rotation: 0 }, position: draft.pages.length, bytes }; draft.pages.push(page); touchDraft(draft, this.now); return clone(publicPage(page));
  }

  rotatePage(id: DocumentCaptureDraftId, pageId: string, degrees: 90 | 180 | 270): CapturedPage { const page = this.requirePage(id, pageId); page.transform = { ...page.transform, rotation: ((page.transform.rotation + degrees) % 360) as PageTransform['rotation'] }; touchDraft(this.requireDraft(id), this.now); return clone(publicPage(page)); }
  cropPage(id: DocumentCaptureDraftId, pageId: string, crop: { readonly left: number; readonly top: number; readonly width: number; readonly height: number }): CapturedPage { const page = this.requirePage(id, pageId); if (![crop.left, crop.top, crop.width, crop.height].every(value => Number.isSafeInteger(value) && value >= 0) || crop.width < 1 || crop.height < 1 || crop.left + crop.width > 65_536 || crop.top + crop.height > 65_536) throw new DocumentError('INVALID_ARGUMENT', 'Capture crop is invalid'); page.transform = { ...page.transform, crop: { ...crop } }; touchDraft(this.requireDraft(id), this.now); return clone(publicPage(page)); }
  reorderPage(id: DocumentCaptureDraftId, pageId: string, position: number): readonly CapturedPage[] { const draft = this.requireDraft(id); const index = draft.pages.findIndex(page => page.pageId === pageId); if (index < 0 || !Number.isSafeInteger(position)) throw new DocumentError('NOT_FOUND', 'Capture page not found'); const [page] = draft.pages.splice(index, 1); draft.pages.splice(Math.max(0, Math.min(draft.pages.length, position)), 0, page!); draft.pages.forEach((value, itemIndex) => { value.position = itemIndex; }); touchDraft(draft, this.now); return draft.pages.map(publicPage).map(clone); }
  deletePage(id: DocumentCaptureDraftId, pageId: string): void { const draft = this.requireDraft(id); const index = draft.pages.findIndex(page => page.pageId === pageId); if (index < 0) throw new DocumentError('NOT_FOUND', 'Capture page not found'); draft.pages.splice(index, 1); draft.pages.forEach((value, itemIndex) => { value.position = itemIndex; }); touchDraft(draft, this.now); }

  async exportPdf(id: DocumentCaptureDraftId, options: { readonly filename?: string; readonly saveToFiles?: boolean } = {}): Promise<{ readonly bytes: Uint8Array; readonly file?: DocumentFileRef; readonly pageCount: number }> {
    const draft = this.requireDraft(id); if (!draft.pages.length) throw new DocumentError('INVALID_ARGUMENT', 'Capture draft has no pages'); const bytes = await new PdfExportService().export(draft.pages.map(page => ({ bytes: page.bytes, mimeType: page.mimeType, transform: page.transform })), { title: draft.title }); let file: DocumentFileRef | undefined; if (options.saveToFiles !== false && this.writer) file = await this.writer.importDocument({ bytes, filename: options.filename ?? `${safeFilename(draft.title)}.pdf`, mimeType: 'application/pdf', source: 'document-capture' }); draft.state = 'EXPORTED'; touchDraft(draft, this.now); return { bytes, ...(file ? { file } : {}), pageCount: draft.pages.length };
  }

  cancel(id: DocumentCaptureDraftId): boolean { const draft = this.drafts.get(id); if (!draft) return false; draft.pages.forEach(page => page.bytes.fill(0)); draft.pages = []; draft.state = 'CANCELLED'; this.drafts.delete(id); return true; }
  close(id: DocumentCaptureDraftId): void { this.cancel(id); }
  activeDrafts(): number { return this.drafts.size; }

  private requireDraft(id: DocumentCaptureDraftId): MutableCaptureDraft { const draft = this.drafts.get(id); if (!draft || draft.state !== 'ACTIVE') throw new DocumentError('NOT_FOUND', 'Capture draft is not active'); return draft; }
  private requirePage(id: DocumentCaptureDraftId, pageId: string): CapturePageData { const page = this.requireDraft(id).pages.find(value => value.pageId === pageId); if (!page) throw new DocumentError('NOT_FOUND', 'Capture page not found'); return page; }
}

export class PdfExportService {
  async export(pages: readonly { readonly bytes: Uint8Array; readonly mimeType: string; readonly transform?: PageTransform }[], options: { readonly title?: string } = {}): Promise<Uint8Array> {
    if (!pages.length || pages.length > DOCUMENT_MAX_CAPTURE_PAGES) throw new DocumentError('INVALID_ARGUMENT', 'PDF export page count is invalid');
    const images = await Promise.all(pages.map(page => preparePdfImage(page.bytes, page.mimeType)));
    const objects: Uint8Array[] = [];
    const pageObjectIds: number[] = [];
    const contentObjectIds: number[] = [];
    const imageObjectIds: number[] = [];
    const add = (value: string | Uint8Array): number => { objects.push(typeof value === 'string' ? utf8(value) : value); return objects.length; };
    const catalogId = add(''); const pagesId = add('');
    for (const [index, image] of images.entries()) {
      const imageId = add(pdfImageObject(image)); imageObjectIds.push(imageId);
      const transform = pages[index]!.transform ?? { rotation: 0 as const };
      const crop = transform.crop ?? { left: 0, top: 0, width: image.width, height: image.height };
      if (!Number.isSafeInteger(crop.left) || !Number.isSafeInteger(crop.top) || !Number.isSafeInteger(crop.width) || !Number.isSafeInteger(crop.height) || crop.left < 0 || crop.top < 0 || crop.width < 1 || crop.height < 1 || crop.left + crop.width > image.width || crop.top + crop.height > image.height) throw new DocumentError('INVALID_ARGUMENT', 'Capture crop is outside the source image');
      const rotation = transform.rotation;
      const width = rotation === 90 || rotation === 270 ? crop.height : crop.width;
      const height = rotation === 90 || rotation === 270 ? crop.width : crop.height;
      const content = pdfPageContent(image.width, image.height, crop, rotation);
      const contentId = add(pdfStreamObject(content)); contentObjectIds.push(contentId);
      const pageId = add(''); pageObjectIds.push(pageId);
      objects[pageId - 1] = utf8(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${width} ${height}] /Rotate 0 /Resources << /XObject << /Im1 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    }
    objects[catalogId - 1] = utf8(`<< /Type /Catalog /Pages ${pagesId} 0 R /PageMode /UseNone >>`);
    objects[pagesId - 1] = utf8(`<< /Type /Pages /Count ${pageObjectIds.length} /Kids [${pageObjectIds.map(id => `${id} 0 R`).join(' ')}] >>`);
    return buildPdf(objects, options.title);
  }
}

export interface DocumentIntegrationAdapters {
  readonly vault?: { createNote(input: { readonly title: string; readonly content: string; readonly provenance: DocumentLocator }): Promise<unknown> | unknown };
  readonly tasks?: { createTask(input: { readonly title: string; readonly note: string; readonly reference: DocumentLocator }): Promise<unknown> | unknown };
  readonly workboard?: { createCard(input: { readonly title: string; readonly note: string; readonly reference: DocumentLocator }): Promise<unknown> | unknown };
  readonly share?: { share(input: { readonly document: DocumentFileRef; readonly locator?: DocumentLocator; readonly recipientIds?: readonly string[]; readonly ownerConfirmed: true }): Promise<unknown> | unknown };
  readonly continuity?: { continueOnDevice(input: { readonly document: DocumentFileRef; readonly revision: DocumentRevisionRef; readonly locator?: DocumentLocator; readonly targetDeviceId: string }): Promise<unknown> | unknown };
  readonly nearby?: { sendDocument(input: { readonly document: DocumentFileRef; readonly mode: 'COPY' | 'AUTHORIZED_REFERENCE'; readonly targetId: string; readonly ownerConfirmed: true }): Promise<unknown> | unknown };
  readonly localAi?: { ask(input: { readonly scope: 'SELECTION' | 'PAGE' | 'PAGES' | 'DOCUMENT'; readonly text: string; readonly locator?: DocumentLocator }): Promise<unknown> | unknown };
  readonly externalAi?: never;
}

export interface DocumentServiceOptions {
  readonly files: DocumentFileSource;
  readonly adapters?: DocumentAdapterRegistry;
  readonly stateStore?: DocumentStateStore;
  readonly repository?: DocumentMetadataRepository;
  readonly ownerId?: string;
  readonly now?: () => number;
  readonly ocr?: OCRService;
  readonly integrations?: DocumentIntegrationAdapters;
  readonly maxOpenDocuments?: number;
  readonly maxRenderCache?: number;
}

interface OpenDocument { readonly descriptor: DocumentDescriptor; readonly file: DocumentFileRef; readonly revision: DocumentRevisionRef; readonly bytes: Uint8Array; readonly model: DocumentModel; }

export class DocumentService {
  readonly adapters: DocumentAdapterRegistry;
  readonly annotations: AnnotationService;
  readonly searchIndex: DocumentSearchIndex;
  readonly reader: DocumentReaderService;
  readonly capture: DocumentCaptureService;
  private readonly files: DocumentFileSource;
  private readonly repository: DocumentMetadataRepository;
  private readonly now: () => number;
  private readonly ocr?: OCRService;
  private readonly integrations?: DocumentIntegrationAdapters;
  private readonly maxOpenDocuments: number;
  private readonly maxRenderCache: number;
  private readonly openDocuments = new Map<DocumentId, OpenDocument>();
  private readonly renderCache = new Map<string, DocumentRenderedPage>();
  private readonly ocrJobs = new Map<string, { readonly job: DocumentOcrJob; readonly controller: AbortController }>();
  private sequence = 0;

  constructor(options: DocumentServiceOptions | DocumentFileSource) {
    const normalized = isDocumentServiceOptions(options) ? options : { files: options };
    this.files = normalized.files;
    this.adapters = normalized.adapters ?? new DocumentAdapterRegistry();
    const ownerId = safeOwnerId(normalized.ownerId ?? 'local-owner');
    this.repository = normalized.repository ?? new DocumentMetadataRepository(normalized.stateStore, ownerId);
    this.now = normalized.now ?? Date.now;
    this.annotations = new AnnotationService({ repository: this.repository, ownerId, now: this.now });
    this.annotations.setRevisionValidator(async revision => { for (const open of this.openDocuments.values()) if (sameRevision(open.revision, revision)) return true; const file = await this.files.getFile(revision.fileId); return Boolean(file && sameRevision(file.revision, revision)); });
    this.searchIndex = new DocumentSearchIndex();
    this.reader = new DocumentReaderService(this);
    this.ocr = normalized.ocr;
    this.integrations = normalized.integrations;
    this.maxOpenDocuments = clampInt(normalized.maxOpenDocuments ?? 8, 1, 32);
    this.maxRenderCache = clampInt(normalized.maxRenderCache ?? DOCUMENT_MAX_RENDER_CACHE, 1, DOCUMENT_MAX_RENDER_CACHE);
    this.capture = new DocumentCaptureService({ source: this.files });
  }

  async ready(): Promise<void> { await this.repository.ready(); for (const record of this.repository.snapshot().index ? Object.values(this.repository.snapshot().index) : []) this.searchIndex.upsert(record); await this.annotations.ready(); }

  async open(fileId: string, actorIdentityId?: string): Promise<DocumentReaderHandle> {
    await this.ready();
    const file = await this.files.getFile(fileId, actorIdentityId); if (!file) throw new DocumentError('UNAUTHORIZED', 'Document File is unavailable or access was revoked');
    const bytes = await this.files.readFile(file); if (!bytes) throw new DocumentError('UNAVAILABLE', 'Document content is not available on this device');
    if (bytes.byteLength > DOCUMENT_MAX_SOURCE_BYTES || (file.size >= 0 && bytes.byteLength !== file.size)) throw new DocumentError('INTEGRITY', 'Document content size does not match the canonical File');
    if (file.contentId && /^sha256-[a-f0-9]{64}$/i.test(file.contentId) && `sha256-${await sha256(bytes)}`.toLowerCase() !== file.contentId.toLowerCase()) throw new DocumentError('INTEGRITY', 'Document content hash does not match the canonical File');
    const model = await this.adapters.open({ file, bytes });
    const documentId = `${file.fileId}:${file.revision.revisionId}` as DocumentId;
    if (this.openDocuments.size >= this.maxOpenDocuments && !this.openDocuments.has(documentId)) this.close([...this.openDocuments.keys()][0]!);
    const descriptor: DocumentDescriptor = { version: 1, documentId, file: clone(file), revision: clone(file.revision), format: model.format, title: model.title, filename: file.filename, mimeType: file.mimeType, size: file.size, pageCount: model.pages.length, chapterCount: model.chapters.length, hasTextLayer: model.pages.some(page => page.textLayer === 'EXTRACTED'), ocrStatus: this.ocrStatus(documentId, model.pages), openedAt: nowIso(this.now) };
    const open: OpenDocument = { descriptor, file: clone(file), revision: clone(file.revision), bytes: bytes.slice(), model };
    this.openDocuments.set(documentId, open);
    this.searchIndex.upsert({ documentId, fileId: file.fileId, revision: clone(file.revision), title: model.title, format: model.format, text: model.text, ocrPages: this.ocrPages(documentId), updatedAt: nowIso(this.now) });
    await this.repository.mutate(state => ({ ...state, index: { ...state.index, [documentId]: this.searchIndex.recordsList().find(record => record.documentId === documentId)! }, recent: [{ documentId, revision: clone(file.revision), at: nowIso(this.now) }, ...state.recent.filter(item => item.documentId !== documentId)].slice(0, 128) }));
    return this.createReader(open);
  }

  async openFile(file: DocumentFileRef, actorIdentityId?: string): Promise<DocumentReaderHandle> { const current = await this.files.getFile(file.fileId, actorIdentityId); if (!current || !sameRevision(current.revision, file.revision)) throw new DocumentError('UNAUTHORIZED', 'Document revision is unavailable'); return this.open(file.fileId, actorIdentityId); }
  close(documentId: string): void { const open = this.openDocuments.get(documentId as DocumentId); if (!open) return; open.bytes.fill(0); this.openDocuments.delete(documentId as DocumentId); for (const key of [...this.renderCache.keys()]) if (key.startsWith(`${documentId}:`)) this.renderCache.delete(key); }
  getOpen(documentId: string): DocumentReaderHandle | undefined { const open = this.openDocuments.get(documentId as DocumentId); return open ? this.createReader(open) : undefined; }
  async listSupportedFiles(actorIdentityId?: string): Promise<readonly DocumentFileRef[]> { const files = this.files.listFiles ? await this.files.listFiles(actorIdentityId) : []; return files.filter(file => { try { this.adapters.resolve(file); return true; } catch { return false; } }).slice(0, DOCUMENT_MAX_SEARCH_DOCUMENTS).map(clone); }
  async recent(): Promise<readonly DocumentDescriptor[]> {
    await this.ready();
    const output: DocumentDescriptor[] = [];
    for (const item of this.repository.snapshot().recent) {
      const open = this.openDocuments.get(item.documentId);
      if (open) {
        output.push(clone(open.descriptor));
        continue;
      }
      const file = await this.files.getFile(item.revision.fileId);
      if (!file || !sameRevision(file.revision, item.revision)) continue;
      try {
        const model = await this.adapters.open({ file, bytes: await this.requireBytes(file) });
        output.push({ version: 1, documentId: item.documentId, file, revision: file.revision, format: model.format, title: model.title, filename: file.filename, mimeType: file.mimeType, size: file.size, pageCount: model.pages.length, chapterCount: model.chapters.length, hasTextLayer: model.pages.some(page => page.textLayer === 'EXTRACTED'), ocrStatus: this.ocrStatus(item.documentId, model.pages), openedAt: item.at });
      } catch {
        // Inaccessible or malformed recent entries are omitted.
      }
    }
    return output.slice(0, 128);
  }

  async progress(documentId: string): Promise<DocumentReadingProgress | undefined> { await this.ready(); return clone(this.repository.snapshot().progress[documentId]); }
  async saveProgress(documentId: string, locator: DocumentLocator): Promise<DocumentReadingProgress> { const open = this.requireOpen(documentId); assertSameRevision(open.revision, locator.revision); this.validateLocatorForOpen(open, locator); const progress: DocumentReadingProgress = { version: 1, key: documentId, revision: clone(open.revision), locator: normalizeLocator(locator), updatedAt: nowIso(this.now) }; await this.repository.mutate(state => ({ ...state, progress: { ...state.progress, [documentId]: progress } })); return clone(progress); }
  async exportPrivateSync(): Promise<DocumentPrivateSyncEnvelope> { await this.ready(); return this.annotations.exportSync(); }
  async mergePrivateSync(envelope: DocumentPrivateSyncEnvelope): Promise<void> { await this.annotations.mergeSync(envelope); }

  async addHighlight(documentId: string, input: { readonly locator: DocumentLocator; readonly selectedText: string; readonly color?: DocumentAnnotation['color']; readonly body?: string }): Promise<DocumentAnnotation> { const open = this.requireOpen(documentId); this.validateLocatorForOpen(open, input.locator); return this.annotations.addHighlight({ revision: open.revision, locator: input.locator, selectedText: input.selectedText, color: input.color, body: input.body }); }
  async addNote(documentId: string, input: { readonly locator: DocumentLocator; readonly body: string }): Promise<DocumentAnnotation> { const open = this.requireOpen(documentId); this.validateLocatorForOpen(open, input.locator); return this.annotations.addNote({ revision: open.revision, locator: input.locator, body: input.body }); }
  async addBookmark(documentId: string, input: { readonly locator: DocumentLocator; readonly label?: string }): Promise<DocumentBookmark> { const open = this.requireOpen(documentId); this.validateLocatorForOpen(open, input.locator); return this.annotations.addBookmark({ revision: open.revision, locator: input.locator, label: input.label }); }
  async deleteAnnotation(id: string): Promise<void> { return this.annotations.delete(id); }
  async listAnnotations(documentId: string): Promise<readonly DocumentAnnotation[]> { const open = this.requireOpen(documentId); return this.annotations.list(open.revision); }

  async searchDocument(documentId: string, query: string, limit = 64): Promise<readonly DocumentSearchResult[]> { const open = this.requireOpen(documentId); return searchModel(open, query, limit); }
  async search(query: string, options: { readonly limit?: number; readonly actorIdentityId?: string } = {}): Promise<readonly DocumentSearchResult[]> { await this.ready(); const base = this.searchIndex.search(query, options.limit ?? 64); const authorized: DocumentSearchResult[] = []; for (const result of base) { const file = await this.files.getFile(result.fileId, options.actorIdentityId); if (file && sameRevision(file.revision, result.revision)) authorized.push(result); } const annotations = await this.annotations.search(query, options.limit ?? 64); for (const annotation of annotations) { const file = await this.files.getFile(annotation.revision.fileId, options.actorIdentityId); if (!file || !sameRevision(file.revision, annotation.revision)) continue; const record = this.repository.snapshot().index[`${file.fileId}:${file.revision.revisionId}`]; if (!record) continue; authorized.push({ documentId: record.documentId, fileId: file.fileId, revision: clone(annotation.revision), title: record.title, format: record.format, locator: clone(annotation.locator), snippet: boundedText(annotation.body ?? annotation.selectedText ?? annotation.label ?? '', 240), source: 'ANNOTATION', score: 1.1 }); } return authorized.sort((a, b) => b.score - a.score).slice(0, clampInt(options.limit ?? 64, 1, 256)).map(clone); }

  copyWithSource(documentId: string, input: { readonly text: string; readonly locator: DocumentLocator }): { readonly text: string; readonly citation: string; readonly locator: DocumentLocator } { const open = this.requireOpen(documentId); this.validateLocatorForOpen(open, input.locator); const text = boundedText(input.text, 64 * 1024); return { text, citation: formatCitation(input.locator, open.file.filename), locator: clone(input.locator) }; }

  async createVaultNote(documentId: string, input: { readonly text: string; readonly locator: DocumentLocator; readonly title?: string }): Promise<unknown> { if (!this.integrations?.vault) throw new DocumentError('UNAVAILABLE', 'Vault adapter is not connected'); const open = this.requireOpen(documentId); this.validateLocatorForOpen(open, input.locator); return this.integrations.vault.createNote({ title: boundedText(input.title ?? `Note from ${open.file.filename}`, 240), content: `${boundedText(input.text, 64 * 1024)}\n\nSource: ${formatCitation(input.locator, open.file.filename)}`, provenance: clone(input.locator) }); }
  async createTask(documentId: string, input: { readonly text: string; readonly locator: DocumentLocator; readonly title?: string; readonly ownerConfirmed: true }): Promise<unknown> { if (input.ownerConfirmed !== true || !this.integrations?.tasks) throw new DocumentError('UNAUTHORIZED', 'Creating a task requires an explicit owner action and Task adapter'); const open = this.requireOpen(documentId); this.validateLocatorForOpen(open, input.locator); return this.integrations.tasks.createTask({ title: boundedText(input.title ?? input.text, 4_000), note: `${boundedText(input.text, 64 * 1024)}\n\nSource: ${formatCitation(input.locator, open.file.filename)}`, reference: clone(input.locator) }); }
  async createWorkboardCard(documentId: string, input: { readonly text: string; readonly locator: DocumentLocator; readonly ownerConfirmed: true }): Promise<unknown> { if (input.ownerConfirmed !== true || !this.integrations?.workboard) throw new DocumentError('UNAUTHORIZED', 'Creating a card requires an explicit owner action and Workboard adapter'); const open = this.requireOpen(documentId); this.validateLocatorForOpen(open, input.locator); return this.integrations.workboard.createCard({ title: boundedText(input.text, 240), note: boundedText(input.text, 64 * 1024), reference: clone(input.locator) }); }
  async share(documentId: string, input: { readonly ownerConfirmed: true; readonly recipientIds?: readonly string[]; readonly locator?: DocumentLocator }): Promise<unknown> { if (input.ownerConfirmed !== true || !this.integrations?.share) throw new DocumentError('UNAUTHORIZED', 'Document sharing requires explicit owner action'); const open = this.requireOpen(documentId); if (input.locator) this.validateLocatorForOpen(open, input.locator); return this.integrations.share.share({ document: clone(open.file), ...(input.locator ? { locator: clone(input.locator) } : {}), ...(input.recipientIds ? { recipientIds: input.recipientIds.slice(0, 256) } : {}), ownerConfirmed: true }); }
  async continueOnDevice(documentId: string, input: { readonly targetDeviceId: string; readonly locator?: DocumentLocator }): Promise<unknown> { if (!this.integrations?.continuity) throw new DocumentError('UNAVAILABLE', 'Continuity adapter is not connected'); const open = this.requireOpen(documentId); if (input.locator) this.validateLocatorForOpen(open, input.locator); return this.integrations.continuity.continueOnDevice({ document: clone(open.file), revision: clone(open.revision), ...(input.locator ? { locator: clone(input.locator) } : {}), targetDeviceId: boundedText(input.targetDeviceId, 512) }); }
  async sendNearby(documentId: string, input: { readonly targetId: string; readonly mode: 'COPY' | 'AUTHORIZED_REFERENCE'; readonly ownerConfirmed: true }): Promise<unknown> { if (input.ownerConfirmed !== true || !this.integrations?.nearby) throw new DocumentError('UNAUTHORIZED', 'Nearby document transfer requires explicit owner action'); const open = this.requireOpen(documentId); return this.integrations.nearby.sendDocument({ document: clone(open.file), mode: input.mode, targetId: boundedText(input.targetId, 512), ownerConfirmed: true }); }
  async askLocalAi(documentId: string, input: { readonly scope: 'SELECTION' | 'PAGE' | 'PAGES' | 'DOCUMENT'; readonly text: string; readonly locator?: DocumentLocator }): Promise<unknown> { if (!this.integrations?.localAi) throw new DocumentError('UNAVAILABLE', 'Local AI adapter is not connected'); const open = this.requireOpen(documentId); if (input.locator) this.validateLocatorForOpen(open, input.locator); return this.integrations.localAi.ask({ scope: input.scope, text: boundedText(input.text, DOCUMENT_MAX_TEXT_BYTES), ...(input.locator ? { locator: clone(input.locator) } : {}) }); }

  async recognizePage(documentId: string, pageNumber: number, options: { readonly language?: string; readonly force?: boolean; readonly signal?: AbortSignal } = {}): Promise<DocumentOcrResult> { const open = this.requireOpen(documentId); const page = open.model.pages[pageNumber - 1]; if (!page) throw new DocumentError('NOT_FOUND', 'Document page is not available'); const resultKey = `${open.descriptor.documentId}:${pageNumber}`; const cached = this.repository.snapshot().ocr[resultKey]; if (cached && sameRevision(cached.revision, open.revision) && options.force !== true) return clone(cached); if (page.textLayer === 'EXTRACTED' && options.force !== true) throw new DocumentError('CONFLICT', 'Page already has a text layer; explicit force is required'); if (!this.ocr || !open.model.renderPage) throw new DocumentError('UNAVAILABLE', 'Local OCR or page rasterizer is not connected'); const rendered = await open.model.renderPage(pageNumber, { signal: options.signal, scale: 1 }); if (!rendered.imageBytes || !rendered.mimeType) throw new DocumentError('UNAVAILABLE', 'Page image is not available for OCR'); const language = options.language ?? this.ocr.languages()[0]; if (!language) throw new DocumentError('UNAVAILABLE', 'No local OCR language is available'); const submitted = this.ocr.submit({ imageBytes: rendered.imageBytes, mimeType: rendered.mimeType, language, maxOutputChars: DOCUMENT_MAX_OCR_TEXT, maxRegions: DOCUMENT_MAX_OCR_REGIONS, signal: options.signal }); const raw = await submitted.promise; const result: DocumentOcrResult = { ...raw, key: resultKey, revision: clone(open.revision), pageNumber, imageHash: await sha256(rendered.imageBytes), createdAt: nowIso(this.now) }; await this.repository.mutate(state => ({ ...state, ocr: { ...state.ocr, [result.key]: result } })); await this.refreshIndexWithOcr(open); return clone(result); }

  async recognizeDocument(documentId: string, options: { readonly language?: string; readonly signal?: AbortSignal; readonly onProgress?: (job: DocumentOcrJob) => void } = {}): Promise<DocumentOcrJob> {
    const open = this.requireOpen(documentId);
    if (!this.ocr) throw new DocumentError('UNAVAILABLE', 'Local OCR is not connected');
    const jobId = `document-ocr-${++this.sequence}`;
    const controller = new AbortController();
    const abortExternal = () => controller.abort();
    if (options.signal?.aborted) controller.abort();
    else options.signal?.addEventListener('abort', abortExternal, { once: true });
    const totalPages = open.model.pages.filter(page => page.textLayer !== 'EXTRACTED').length;
    let job: DocumentOcrJob = { jobId, documentId: open.descriptor.documentId, state: 'RUNNING', completedPages: 0, totalPages, failedPages: [], updatedAt: nowIso(this.now) };
    this.ocrJobs.set(jobId, { job, controller });
    options.onProgress?.(job);
    try {
      for (const page of open.model.pages) {
        if (page.textLayer === 'EXTRACTED') continue;
        if (controller.signal.aborted) { job = { ...job, state: 'CANCELLED', updatedAt: nowIso(this.now) }; break; }
        try {
          await this.recognizePage(documentId, page.pageNumber, { language: options.language, signal: controller.signal });
          job = { ...job, completedPages: job.completedPages + 1, updatedAt: nowIso(this.now) };
        } catch (error) {
          if (error instanceof DocumentError && error.code === 'CANCELLED') { job = { ...job, state: 'CANCELLED', updatedAt: nowIso(this.now) }; break; }
          job = { ...job, failedPages: [...job.failedPages, page.pageNumber].slice(0, DOCUMENT_MAX_PAGES), updatedAt: nowIso(this.now), error: error instanceof Error ? error.message : 'OCR failed' };
        }
        options.onProgress?.(job);
      }
      if (job.state === 'RUNNING') job = { ...job, state: job.failedPages.length ? 'PARTIAL' : 'COMPLETED', updatedAt: nowIso(this.now) };
      return clone(job);
    } finally {
      options.signal?.removeEventListener('abort', abortExternal);
      this.ocrJobs.set(jobId, { job, controller });
      options.onProgress?.(job);
    }
  }
  cancelOcr(jobId: string): void { this.ocrJobs.get(jobId)?.controller.abort(); }
  ocrJob(jobId: string): DocumentOcrJob | undefined { return clone(this.ocrJobs.get(jobId)?.job); }
  ocrJobsList(): readonly DocumentOcrJob[] { return [...this.ocrJobs.values()].map(value => clone(value.job)); }

  private createReader(open: OpenDocument): DocumentReaderHandle { return { document: clone(open.descriptor), pages: open.model.pages.map(clone), chapters: open.model.chapters.map(clone), outline: open.model.outline.map(clone), ...(open.model.security ? { security: clone(open.model.security) } : {}), renderPage: (pageNumber, options) => this.renderPage(open.descriptor.documentId, pageNumber, options), search: (query, options) => this.searchDocument(open.descriptor.documentId, query, options?.limit), close: () => this.close(open.descriptor.documentId) }; }
  private async renderPage(documentId: DocumentId, pageNumber: number, options: { readonly scale?: number; readonly signal?: AbortSignal } = {}): Promise<DocumentRenderedPage> { const open = this.openDocuments.get(documentId); if (!open) throw new DocumentError('NOT_FOUND', 'Document is closed'); if (!Number.isSafeInteger(pageNumber) || pageNumber < 1 || pageNumber > open.model.pages.length) throw new DocumentError('NOT_FOUND', 'Document page is unavailable'); const scale = clampNumber(options.scale ?? 1, 0.25, 4); const key = `${documentId}:${pageNumber}:${scale}`; const cached = this.renderCache.get(key); if (cached) return clone(cached); const rendered = open.model.renderPage ? await open.model.renderPage(pageNumber, { scale, signal: options.signal }) : staticRenderedPage(open.model.pages[pageNumber - 1]!); this.renderCache.set(key, clone(rendered)); while (this.renderCache.size > this.maxRenderCache) this.renderCache.delete(this.renderCache.keys().next().value!); return clone(rendered); }
  private requireOpen(documentId: string): OpenDocument { const open = this.openDocuments.get(documentId as DocumentId); if (!open) throw new DocumentError('NOT_FOUND', 'Document is not open'); return open; }
  private async requireBytes(file: DocumentFileRef): Promise<Uint8Array> { const bytes = await this.files.readFile(file); if (!bytes) throw new DocumentError('UNAVAILABLE', 'Document content is unavailable'); return bytes; }
  private validateLocatorForOpen(open: OpenDocument, locator: DocumentLocator): void { assertSameRevision(open.revision, locator.revision); const page = locator.page ? open.model.pages[locator.page - 1] : undefined; if (locator.kind === 'PDF_PAGE' && (!page || open.model.format !== 'PDF')) throw new DocumentError('INVALID_ARGUMENT', 'PDF page locator is invalid'); if (locator.kind === 'EPUB_CHAPTER' && (!locator.chapterId || !open.model.chapters.some(chapter => chapter.id === locator.chapterId))) throw new DocumentError('INVALID_ARGUMENT', 'EPUB chapter locator is invalid'); const textLength = page?.text.length ?? (locator.chapterId ? open.model.chapters.find(chapter => chapter.id === locator.chapterId)?.text.length ?? open.model.text.length : open.model.text.length); if (locator.start !== undefined && (!Number.isSafeInteger(locator.start) || locator.start < 0 || locator.start > textLength)) throw new DocumentError('INVALID_ARGUMENT', 'Document locator start is out of bounds'); if (locator.end !== undefined && (!Number.isSafeInteger(locator.end) || locator.end < (locator.start ?? 0) || locator.end > textLength)) throw new DocumentError('INVALID_ARGUMENT', 'Document locator end is out of bounds'); }
  private ocrPages(documentId: string): number[] { return Object.values(this.repository.snapshot().ocr).filter(result => result.key.startsWith(`${documentId}:`)).map(result => result.pageNumber).slice(0, DOCUMENT_MAX_PAGES); }
  private ocrStatus(documentId: string, pages: readonly DocumentPage[]): DocumentDescriptor['ocrStatus'] { const processed = this.ocrPages(documentId).length; if (!processed) return 'NOT_REQUESTED'; return processed >= pages.filter(page => page.textLayer !== 'EXTRACTED').length ? 'AVAILABLE' : 'PARTIAL'; }
  private async refreshIndexWithOcr(open: OpenDocument): Promise<void> { const record = this.searchIndex.recordsList().find(value => value.documentId === open.descriptor.documentId); if (!record) return; const text = `${open.model.text}\n${Object.values(this.repository.snapshot().ocr).filter(result => result.revision.fileId === open.revision.fileId && sameRevision(result.revision, open.revision)).map(result => result.text).join('\n')}`; const next = { ...record, text: boundedText(text, DOCUMENT_MAX_TEXT_BYTES), ocrPages: this.ocrPages(open.descriptor.documentId), updatedAt: nowIso(this.now) }; this.searchIndex.upsert(next); await this.repository.mutate(state => ({ ...state, index: { ...state.index, [open.descriptor.documentId]: next } })); }
}

export class DocumentReaderService {
  constructor(private readonly documents: DocumentService) {}
  open(fileId: string, actorIdentityId?: string): Promise<DocumentReaderHandle> { return this.documents.open(fileId, actorIdentityId); }
  search(query: string, options?: { readonly limit?: number; readonly actorIdentityId?: string }): Promise<readonly DocumentSearchResult[]> { return this.documents.search(query, options); }
  recent(): Promise<readonly DocumentDescriptor[]> { return this.documents.recent(); }
}

export async function createProductionDocumentService(options: Omit<DocumentServiceOptions, 'files'> & { readonly files: DocumentFileSource }): Promise<DocumentService> { const service = new DocumentService(options); await service.ready(); return service; }

// ---------------------------------------------------------------------------
// Safe PDF parsing and safe EPUB container/render helpers
// ---------------------------------------------------------------------------

function parsePdfModel(file: DocumentFileRef, bytes: Uint8Array, security: PdfSecurityReport): DocumentModel {
  const source = textDecode(bytes);
  if (!source.startsWith('%PDF-')) throw new DocumentError('MALFORMED', 'PDF header is missing');
  const objects = parsePdfObjects(source);
  const pageObjects = objects.filter(object => /\/Type\s*\/Page(?:\s|\/|>)/.test(object.body) && !/\/Type\s*\/Pages(?:\s|\/|>)/.test(object.body)).slice(0, DOCUMENT_MAX_PAGES);
  const pageCount = pageObjects.length || countPdfPages(source);
  if (!pageCount || pageCount > DOCUMENT_MAX_PAGES) throw new DocumentError('RESOURCE_LIMIT', 'PDF page count is outside the supported bound');
  const allStreams = objects.flatMap(object => object.stream ? [decodePdfStream(object.body, object.stream)] : []).map(stream => extractPdfText(stream)).filter(Boolean);
  const pages: DocumentPage[] = [];
  for (let index = 0; index < pageCount; index += 1) {
    const object = pageObjects[index];
    const references = object ? [...object.body.matchAll(/\/Contents\s+(?:\[([^\]]+)\]|(\d+)\s+\d+\s+R)/g)].flatMap(match => { const values = match[1] ? [...match[1].matchAll(/(\d+)\s+\d+\s+R/g)].map(value => Number(value[1])) : match[2] ? [Number(match[2])] : []; return values; }) : [];
    const pageText = references.flatMap(reference => { const target = objects.find(candidate => candidate.id === reference); return target?.stream ? [extractPdfText(decodePdfStream(target.body, target.stream))] : []; }).filter(Boolean).join(' ').trim() || (allStreams[index] ?? (index === 0 ? allStreams.join('\n') : ''));
    const mediaBox = object ? parseMediaBox(object.body) : undefined;
    const rotation = object ? normalizeRotation(Number(object.body.match(/\/Rotate\s+(-?\d+)/)?.[1])) : 0;
    const locator = pdfLocator(file.revision, index + 1, 0, pageText.length, pageText.slice(0, 256));
    const blocks = pageText ? [{ type: 'paragraph' as const, id: `pdf-page-${index + 1}`, text: pageText, links: [] as readonly DocumentLink[] }] : [];
    pages.push(pageModel(index + 1, locator, pageText, pageText ? 'EXTRACTED' : 'NONE', blocks, security.externalLinks.filter(link => link.start < pageText.length || !pageText.length), mediaBox?.width, mediaBox?.height, rotation, false));
  }
  const outline = parsePdfOutline(source, file.revision);
  const title = pdfInfo(bytes).title ?? file.filename;
  return { format: 'PDF', title: boundedText(title, 512), pages, chapters: [], outline, text: boundedText(pages.map(page => page.text).join('\n\n'), DOCUMENT_MAX_TEXT_BYTES), links: security.externalLinks, metadata: { ...pdfInfo(bytes), pageCount, sourceMetadataUntrusted: true }, security, renderPage: async pageNumber => { const page = pages[pageNumber - 1]; if (!page) throw new DocumentError('NOT_FOUND', 'PDF page is unavailable'); return staticRenderedPage(page); } };
}

function inspectPdfSecurity(bytes: Uint8Array): PdfSecurityReport {
  const source = textDecode(bytes);
  const actions: Array<PdfSecurityReport['blockedActions'][number]> = [];
  if (/\/JavaScript\b|\/JS\b/i.test(source)) actions.push('JAVASCRIPT');
  if (/\/Launch\b/i.test(source)) actions.push('LAUNCH');
  if (/\/GoToR\b/i.test(source)) actions.push('GOTO_REMOTE');
  if (/\/SubmitForm\b/i.test(source)) actions.push('SUBMIT_FORM');
  if (/\/ImportData\b/i.test(source)) actions.push('IMPORT_DATA');
  if (/\/EmbeddedFile\b|\/FileAttachment\b/i.test(source)) actions.push('EMBEDDED_FILE');
  const links: DocumentLink[] = [];
  for (const match of source.matchAll(/\/URI\s*(\((?:\\.|[^)])*\)|<[^>]+>)/gi)) {
    const raw = match[1] ?? ''; const target = raw.startsWith('<') ? decodePdfHex(raw.slice(1, -1)) : decodePdfLiteral(raw.slice(1, -1)); const kind = /^https?:\/\//i.test(target) ? 'EXTERNAL_HTTP' : 'BLOCKED'; links.push({ start: 0, end: 0, label: target.slice(0, 512), target: target.slice(0, 2_048), kind, requiresExplicitAction: true }); if (kind === 'BLOCKED' && /^(?:javascript:|keystone:|file:|data:)/i.test(target)) actions.push('PRIVILEGED_URI');
    if (links.length >= DOCUMENT_MAX_LINKS) break;
  }
  return { javascript: false, launch: false, automaticFormSubmission: false, embeddedFilesAutoOpened: false, externalLinks: dedupeLinks(links), blockedActionCount: actions.length, blockedActions: [...new Set(actions)] };
}

function parsePdfObjects(source: string): { readonly id: number; readonly body: string; readonly stream?: string }[] {
  const output: { id: number; body: string; stream?: string }[] = [];
  const expression = /(\d+)\s+\d+\s+obj\s*([\s\S]*?)\s*endobj/g;
  let match: RegExpExecArray | null; let count = 0;
  while ((match = expression.exec(source)) && count < 100_000) { const body = match[2] ?? ''; const streamStart = body.indexOf('stream'); const streamEnd = body.lastIndexOf('endstream'); output.push({ id: Number(match[1]), body, ...(streamStart >= 0 && streamEnd > streamStart ? { stream: body.slice(streamStart + 6, streamEnd).replace(/^\r?\n/, '').replace(/\r?\n$/, '') } : {}) }); count += 1; }
  return output;
}

function decodePdfStream(body: string, stream: string): string {
  if (/\/FlateDecode\b/.test(body)) return stream;
  if (/\/ASCIIHexDecode\b/.test(body)) return decodePdfHex(stream.replace(/\s/g, '').replace(/>.*$/, ''));
  return stream;
}

function extractPdfText(stream: string): string {
  const output: string[] = []; let index = 0;
  while (index < stream.length) {
    const char = stream[index];
    if (char === '(') { const parsed = readPdfLiteral(stream, index); if (!parsed) { index += 1; continue; } index = parsed.next; const after = stream.slice(index).match(/^\s*(Tj|['"])/); if (after) { output.push(parsed.text); index += after[0].length; } continue; }
    if (char === '<' && stream[index + 1] !== '<') { const end = stream.indexOf('>', index + 1); if (end < 0) break; const text = decodePdfHex(stream.slice(index + 1, end)); index = end + 1; if (/^\s*(Tj|['"])/.test(stream.slice(index))) output.push(text); continue; }
    if (char === '[') { const end = findBalanced(stream, index, '[', ']'); if (end < 0) break; const value = stream.slice(index + 1, end); const parts: string[] = []; let partIndex = 0; while (partIndex < value.length) { if (value[partIndex] === '(') { const parsed = readPdfLiteral(value, partIndex); if (parsed) { parts.push(parsed.text); partIndex = parsed.next; continue; } } if (value[partIndex] === '<' && value[partIndex + 1] !== '<') { const hexEnd = value.indexOf('>', partIndex + 1); if (hexEnd >= 0) { parts.push(decodePdfHex(value.slice(partIndex + 1, hexEnd))); partIndex = hexEnd + 1; continue; } } partIndex += 1; } if (/\]\s*TJ/.test(stream.slice(end))) output.push(parts.join('')); index = end + 1; continue; }
    index += 1;
  }
  return boundedText(output.join(' ').replace(/\s+/g, ' ').trim(), DOCUMENT_MAX_TEXT_BYTES);
}

function readPdfLiteral(source: string, start: number): { readonly text: string; readonly next: number } | undefined {
  if (source[start] !== '(') return undefined; let depth = 1; let index = start + 1; let output = '';
  while (index < source.length && depth > 0) { const char = source[index]!; if (char === '\\') { const next = source[index + 1] ?? ''; const escapes: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' }; if (escapes[next] !== undefined) output += escapes[next]; else if (/\d/.test(next)) { const octal = source.slice(index + 1).match(/^\d{1,3}/)?.[0] ?? ''; output += String.fromCharCode(Number.parseInt(octal, 8)); index += octal.length; } else output += next; index += 2; continue; } if (char === '(') depth += 1; else if (char === ')') depth -= 1; if (depth > 0) output += char; index += 1; }
  return depth === 0 ? { text: output, next: index } : undefined;
}

function parseMediaBox(body: string): { readonly width: number; readonly height: number } | undefined { const values = body.match(/\/MediaBox\s*\[\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\]/); if (!values) return undefined; const width = Math.abs(Number(values[3]) - Number(values[1])); const height = Math.abs(Number(values[4]) - Number(values[2])); return width > 0 && width <= 50_000 && height > 0 && height <= 50_000 ? { width, height } : undefined; }
function countPdfPages(source: string): number { return [...source.matchAll(/\/Type\s*\/Page(?:\s|\/|>)/g)].filter(match => !source.slice(Math.max(0, (match.index ?? 0) - 12), (match.index ?? 0) + match[0].length + 2).includes('/Pages')).length; }
function parsePdfOutline(source: string, revision: DocumentRevisionRef): DocumentOutlineEntry[] { const output: DocumentOutlineEntry[] = []; for (const [index, match] of [...source.matchAll(/\/Title\s*(\((?:\\.|[^)])*\)|<[^>]+>)/g)].slice(0, 512).entries()) { const raw = match[1] ?? ''; const title = raw.startsWith('<') ? decodePdfHex(raw.slice(1, -1)) : decodePdfLiteral(raw.slice(1, -1)); if (title.trim()) output.push({ id: `outline-${index + 1}`, title: boundedText(title, 512), children: [] }); } void revision; return output; }
function pdfInfo(bytes: Uint8Array): { readonly title?: string } { const source = textDecode(bytes); const raw = source.match(/\/Title\s*(\((?:\\.|[^)])*\)|<[^>]+>)/)?.[1]; if (!raw) return {}; const title = raw.startsWith('<') ? decodePdfHex(raw.slice(1, -1)) : decodePdfLiteral(raw.slice(1, -1)); return title ? { title: boundedText(title, 512) } : {}; }

interface ZipEntry { readonly path: string; readonly compression: number; readonly compressedSize: number; readonly uncompressedSize: number; readonly dataOffset: number; readonly crc32: number; }

async function readSafeZip(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  if (bytes.byteLength > 128 * 1024 * 1024) throw new DocumentError('RESOURCE_LIMIT', 'EPUB container exceeds the compressed input limit');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); const eocd = findSignature(bytes, 0x06054b50, bytes.length - 4); if (eocd < 0) throw new DocumentError('MALFORMED', 'EPUB ZIP directory is missing');
  const count = view.getUint16(eocd + 10, true); const directorySize = view.getUint32(eocd + 12, true); const directoryOffset = view.getUint32(eocd + 16, true); if (count > 2_048 || directorySize > 16 * 1024 * 1024 || directoryOffset + directorySize > bytes.length) throw new DocumentError('RESOURCE_LIMIT', 'EPUB ZIP directory exceeds bounds');
  const entries: ZipEntry[] = []; let offset = directoryOffset; let expanded = 0;
  for (let index = 0; index < count; index += 1) { if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) throw new DocumentError('MALFORMED', 'EPUB ZIP entry is invalid'); const flags = view.getUint16(offset + 8, true); const compression = view.getUint16(offset + 10, true); const compressedSize = view.getUint32(offset + 20, true); const uncompressedSize = view.getUint32(offset + 24, true); const nameLength = view.getUint16(offset + 28, true); const extraLength = view.getUint16(offset + 30, true); const commentLength = view.getUint16(offset + 32, true); const localOffset = view.getUint32(offset + 42, true); if (flags & 0x1) throw new DocumentError('UNSUPPORTED', 'Encrypted EPUB containers are unsupported'); const path = safeArchivePath(textDecode(bytes.subarray(offset + 46, offset + 46 + nameLength))); if (compressedSize > 64 * 1024 * 1024 || uncompressedSize > 128 * 1024 * 1024 || uncompressedSize > Math.max(1, compressedSize) * 200) throw new DocumentError('RESOURCE_LIMIT', 'EPUB ZIP expansion exceeds bounds'); expanded += uncompressedSize; if (expanded > 128 * 1024 * 1024) throw new DocumentError('RESOURCE_LIMIT', 'EPUB expanded content exceeds bounds'); if (compression !== 0 && compression !== 8) throw new DocumentError('UNSUPPORTED', 'EPUB ZIP compression method is unsupported'); const local = localOffset; if (local + 30 > bytes.length || view.getUint32(local, true) !== 0x04034b50) throw new DocumentError('MALFORMED', 'EPUB local ZIP header is invalid'); const localNameLength = view.getUint16(local + 26, true); const localExtraLength = view.getUint16(local + 28, true); const dataOffset = local + 30 + localNameLength + localExtraLength; if (dataOffset + compressedSize > bytes.length) throw new DocumentError('MALFORMED', 'EPUB ZIP entry escapes container'); entries.push({ path, compression, compressedSize, uncompressedSize, dataOffset, crc32: view.getUint32(offset + 16, true) }); offset += 46 + nameLength + extraLength + commentLength; }
  const output = new Map<string, Uint8Array>(); for (const entry of entries) { const compressed = bytes.subarray(entry.dataOffset, entry.dataOffset + entry.compressedSize); const data = entry.compression === 0 ? compressed.slice() : await inflateRaw(compressed); if (data.byteLength !== entry.uncompressedSize || data.byteLength > 128 * 1024 * 1024 || crc32(data) !== entry.crc32) throw new DocumentError('INTEGRITY', `EPUB ZIP entry failed integrity: ${entry.path}`); output.set(entry.path, data); } return output;
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> { return transformBytes(bytes, 'deflate-raw', 128 * 1024 * 1024, 'EPUB entry expansion exceeds bounds', 'Deflate decompression is unavailable'); }
async function inflateZlib(bytes: Uint8Array): Promise<Uint8Array> { return transformBytes(bytes, 'deflate', 128 * 1024 * 1024, 'PNG expansion exceeds bounds', 'Zlib decompression is unavailable'); }
async function deflateZlib(bytes: Uint8Array): Promise<Uint8Array> { return transformBytes(bytes, 'deflate', 64 * 1024 * 1024, 'PDF image exceeds bounds', 'Zlib compression is unavailable', true); }
async function transformBytes(bytes: Uint8Array, format: string, maxBytes: number, limitMessage: string, unavailableMessage: string, compress = false): Promise<Uint8Array> { const constructors = globalThis as unknown as { DecompressionStream?: new (format: string) => { readonly readable: any; readonly writable: any }; CompressionStream?: new (format: string) => { readonly readable: any; readonly writable: any } }; const Constructor = (compress ? constructors.CompressionStream : constructors.DecompressionStream); if (!Constructor) throw new DocumentError('UNSUPPORTED', unavailableMessage); const stream = new Constructor(format); const reader = stream.readable.getReader(); const partsPromise = (async () => { const parts: Uint8Array[] = []; let size = 0; while (true) { const next = await reader.read(); if (next.done) break; const value = next.value as Uint8Array; size += value.byteLength; if (size > maxBytes) throw new DocumentError('RESOURCE_LIMIT', limitMessage); parts.push(value); } const output = new Uint8Array(size); let offset = 0; for (const part of parts) { output.set(part, offset); offset += part.byteLength; } return output; })(); try { const writer = stream.writable.getWriter(); await writer.write(bytes); await writer.close(); return await partsPromise; } catch (error) { try { await reader.cancel(error); } catch { /* stream already closed */ } throw error; } }

function parseEpubManifest(packageText: string): Map<string, { readonly id: string; readonly href: string; readonly mediaType: string; readonly properties?: string }> { const output = new Map<string, { id: string; href: string; mediaType: string; properties?: string }>(); for (const match of packageText.matchAll(/<item\b([^>]*)>/gi)) { const attrs = parseXmlAttributes(match[1] ?? ''); if (!attrs.id || !attrs.href || !attrs['media-type']) continue; output.set(attrs.id, { id: attrs.id, href: decodeXmlEntities(attrs.href), mediaType: attrs['media-type'].toLowerCase(), ...(attrs.properties ? { properties: attrs.properties } : {}) }); if (output.size >= DOCUMENT_MAX_CHAPTERS) throw new DocumentError('RESOURCE_LIMIT', 'EPUB manifest is too large'); } return output; }
function parseEpubSpine(packageText: string, manifest: Map<string, { readonly id: string; readonly href: string; readonly mediaType: string; readonly properties?: string }>): { readonly id: string; readonly href: string; readonly label?: string }[] { const spine = packageText.match(/<spine\b[^>]*>([\s\S]*?)<\/spine>/i)?.[1] ?? ''; const output: { id: string; href: string; label?: string }[] = []; for (const match of spine.matchAll(/<itemref\b([^>]*)>/gi)) { const attrs = parseXmlAttributes(match[1] ?? ''); const item = attrs.idref ? manifest.get(attrs.idref) : undefined; if (item && /^application\/(?:xhtml\+xml|html)$/i.test(item.mediaType)) output.push({ id: item.id, href: item.href, ...(attrs['linear'] === 'no' ? {} : {}) }); } return output; }
function parseEpubToc(packageText: string, manifest: Map<string, { readonly id: string; readonly href: string; readonly mediaType: string; readonly properties?: string }>, archive: Map<string, Uint8Array>, base: string, revision: DocumentRevisionRef): DocumentOutlineEntry[] { const navItem = [...manifest.values()].find(item => item.properties?.split(/\s+/).includes('nav')); const ncxItem = [...manifest.values()].find(item => item.mediaType === 'application/x-dtbncx+xml'); const source = navItem ? archive.get(safeArchivePath(joinArchivePath(base, navItem.href))) : ncxItem ? archive.get(safeArchivePath(joinArchivePath(base, ncxItem.href))) : undefined; if (!source) return []; const text = textDecode(source); const output: DocumentOutlineEntry[] = []; for (const [index, match] of [...text.matchAll(/<navPoint\b[\s\S]*?<text>([\s\S]*?)<\/text>/gi), ...text.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].slice(0, 512).entries()) { const title = stripMarkup(decodeXmlEntities(match[2] ?? match[1] ?? '')); if (title) output.push({ id: `toc-${index + 1}`, title: boundedText(title, 512), children: [] }); } void packageText; void revision; return output; }

function parseSafeEpubHtml(source: string, revision: DocumentRevisionRef, chapterId: string, archive: Map<string, Uint8Array>, path: string): { readonly title: string; readonly text: string; readonly blocks: readonly DocumentBlock[]; readonly links: readonly DocumentLink[] } {
  const safe = source.replace(/<!--[\s\S]*?-->/g, '').replace(/<\s*(script|style|iframe|object|embed|form)\b[\s\S]*?<\/\s*\1\s*>/gi, '').replace(/<\s*(script|style|iframe|object|embed|form)\b[^>]*\/?\s*>/gi, '').slice(0, DOCUMENT_MAX_TEXT_BYTES * 2); const title = stripMarkup(safe.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? safe.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? ''); const links: DocumentLink[] = []; const blocks: DocumentBlock[] = []; const blockExpression = /<(h[1-6]|p|blockquote|pre|li|img|hr)\b([^>]*)>([\s\S]*?)(?:<\/\1\s*>|(?=<(?:h[1-6]|p|blockquote|pre|li|img|hr)\b)|$)/gi; let match: RegExpExecArray | null; let counter = 0; while ((match = blockExpression.exec(safe)) && blocks.length < 10_000) { const tag = (match[1] ?? '').toLowerCase(); const attrs = parseXmlAttributes(match[2] ?? ''); const raw = match[3] ?? ''; const clean = stripMarkup(decodeXmlEntities(raw)).replace(/\s+/g, ' ').trim(); const id = `epub-${chapterId}-${++counter}`; if (/^h[1-6]$/.test(tag)) { blocks.push({ type: 'heading', id, level: Number(tag.slice(1)) as 1 | 2 | 3 | 4 | 5 | 6, text: clean }); continue; } if (tag === 'img') { const src = attrs.src ? safeArchivePath(joinArchivePath(directoryOf(path), attrs.src)) : undefined; const available = Boolean(src && archive.has(src)); blocks.push({ type: 'image', id, ...(src ? { sourcePath: src } : {}), alt: boundedText(attrs.alt ?? '', 512), available }); continue; } if (tag === 'hr') { blocks.push({ type: 'separator', id }); continue; } if (!clean) continue; const blockLinks = extractHtmlLinks(raw, clean); links.push(...blockLinks); if (tag === 'blockquote') blocks.push({ type: 'blockquote', id, text: clean }); else if (tag === 'pre') blocks.push({ type: 'code', id, text: clean }); else if (tag === 'li') blocks.push({ type: 'list', id, ordered: false, items: [clean] }); else blocks.push({ type: 'paragraph', id, text: clean, links: blockLinks }); }
  const text = boundedText(blocks.map(block => block.type === 'list' ? block.items.join(' ') : 'text' in block ? block.text : '').filter(Boolean).join('\n\n'), DOCUMENT_MAX_TEXT_BYTES); void revision; return { title, text, blocks, links: dedupeLinks(links).slice(0, DOCUMENT_MAX_LINKS) };
}

function extractHtmlLinks(raw: string, text: string): DocumentLink[] { const output: DocumentLink[] = []; for (const match of raw.matchAll(/<a\b[^>]*href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi)) { const target = decodeXmlEntities(match[2] ?? '').trim(); const label = stripMarkup(decodeXmlEntities(match[3] ?? '')).trim(); const kind: DocumentLink['kind'] = /^https?:\/\//i.test(target) ? 'EXTERNAL_HTTP' : /^javascript:|^keystone:|^file:|^data:/i.test(target) ? 'BLOCKED' : 'INTERNAL'; output.push({ start: Math.max(0, text.indexOf(label)), end: Math.max(0, text.indexOf(label)) + label.length, label: boundedText(label, 512), target: boundedText(target, 2_048), kind, requiresExplicitAction: true }); } return output; }

function parseTextModel(file: DocumentFileRef, source: string, format: 'MARKDOWN' | 'PLAIN_TEXT'): DocumentModel { const bounded = boundedText(source, DOCUMENT_MAX_TEXT_BYTES); const blocks = format === 'MARKDOWN' ? parseMarkdownBlocks(bounded) : [{ type: 'paragraph' as const, id: 'text-1', text: bounded, links: [] as readonly DocumentLink[] }]; const headings = blocks.filter((block): block is Extract<DocumentBlock, { type: 'heading' }> => block.type === 'heading'); const links = blocks.flatMap(block => block.type === 'paragraph' ? block.links : []); const text = blocks.map(block => block.type === 'list' ? block.items.join(' ') : 'text' in block ? block.text : '').filter(Boolean).join('\n\n'); const locator = textLocator(file.revision, 0, text.length, text.slice(0, 256)); const page = pageModel(1, locator, text, text ? 'EXTRACTED' : 'NONE', blocks, links, undefined, undefined, 0, false); return { format, title: headings[0]?.text ?? file.filename, pages: [page], chapters: [], outline: headings.map((heading, index) => ({ id: heading.id, title: heading.text, children: [], page: 1 })), text: boundedText(text, DOCUMENT_MAX_TEXT_BYTES), links, metadata: { headingCount: headings.length }, renderPage: async pageNumber => { if (pageNumber !== 1) throw new DocumentError('NOT_FOUND', 'Text document has one virtual page'); return staticRenderedPage(page); } }; }

function parseMarkdownBlocks(source: string): DocumentBlock[] { const output: DocumentBlock[] = []; const lines = source.split(/\r?\n/); let paragraph: string[] = []; let code: string[] | undefined; let codeLanguage: string | undefined; const flush = () => { const text = paragraph.join(' ').trim(); if (text) output.push({ type: 'paragraph', id: `md-${output.length + 1}`, text: safeMarkdownText(text), links: markdownLinks(text) }); paragraph = []; }; for (const line of lines) { if (line.startsWith('```')) { if (code) { output.push({ type: 'code', id: `md-${output.length + 1}`, text: code.join('\n'), ...(codeLanguage ? { language: codeLanguage } : {}) }); code = undefined; codeLanguage = undefined; } else { flush(); code = []; codeLanguage = line.slice(3).trim().slice(0, 32) || undefined; } continue; } if (code) { if (code.join('\n').length < DOCUMENT_MAX_TEXT_BYTES) code.push(line); continue; } const heading = line.match(/^(#{1,6})\s+(.+)$/); if (heading) { flush(); output.push({ type: 'heading', id: `md-${output.length + 1}`, level: heading[1]!.length as 1 | 2 | 3 | 4 | 5 | 6, text: safeMarkdownText(heading[2]!) }); continue; } if (/^\s*[-*+]\s+/.test(line)) { flush(); const items = [line.replace(/^\s*[-*+]\s+/, '')].map(safeMarkdownText); output.push({ type: 'list', id: `md-${output.length + 1}`, ordered: false, items }); continue; } if (/^\s*\d+[.)]\s+/.test(line)) { flush(); const items = [line.replace(/^\s*\d+[.)]\s+/, '')].map(safeMarkdownText); output.push({ type: 'list', id: `md-${output.length + 1}`, ordered: true, items }); continue; } if (/^\s*>\s?/.test(line)) { flush(); output.push({ type: 'blockquote', id: `md-${output.length + 1}`, text: safeMarkdownText(line.replace(/^\s*>\s?/, '')) }); continue; } if (!line.trim()) flush(); else paragraph.push(line); } if (code) output.push({ type: 'code', id: `md-${output.length + 1}`, text: code.join('\n'), ...(codeLanguage ? { language: codeLanguage } : {}) }); flush(); return output.slice(0, 10_000); }

function markdownLinks(source: string): DocumentLink[] { const plain = safeMarkdownText(source); return [...source.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)].slice(0, 128).map(match => { const label = safeMarkdownText(match[1] ?? ''); const target = (match[2] ?? '').trim(); const kind: DocumentLink['kind'] = /^https?:\/\//i.test(target) ? 'EXTERNAL_HTTP' : /^javascript:|^keystone:|^file:|^data:/i.test(target) ? 'BLOCKED' : 'INTERNAL'; const start = Math.max(0, plain.indexOf(label)); return { start, end: start + label.length, label, target: boundedText(target, 2_048), kind, requiresExplicitAction: true }; }); }
function safeMarkdownText(value: string): string { return stripMarkup(decodeXmlEntities(value.replace(/<\s*script\b[\s\S]*?<\/\s*script\s*>/gi, '').replace(/<[^>]*>/g, ''))).replace(/[*_~`]/g, '').replace(/\s+/g, ' ').trim(); }

// ---------------------------------------------------------------------------
// PDF export image helpers. They decode pixels only into a new generated PDF;
// source bytes and source media metadata are never modified.
// ---------------------------------------------------------------------------

interface PdfImage { readonly width: number; readonly height: number; readonly colorSpace: 'DeviceRGB' | 'DeviceGray'; readonly data: Uint8Array; readonly filter: 'DCTDecode' | 'FlateDecode'; }
async function preparePdfImage(bytes: Uint8Array, mimeType: string): Promise<PdfImage> { if (mimeType === 'image/jpeg' || isJpeg(bytes)) { const clean = stripJpegMetadata(bytes); const dimensions = jpegDimensions(clean); if (!dimensions) throw new DocumentError('UNSUPPORTED', 'JPEG dimensions are unavailable'); return { ...dimensions, colorSpace: 'DeviceRGB', data: clean, filter: 'DCTDecode' }; } if (mimeType === 'image/png' || isPng(bytes)) return decodePng(bytes); throw new DocumentError('UNSUPPORTED', 'Only JPEG and PNG capture pages are supported for PDF export'); }
function stripJpegMetadata(bytes: Uint8Array): Uint8Array { if (!isJpeg(bytes)) return bytes.slice(); const output: number[] = [0xff, 0xd8]; let offset = 2; while (offset + 4 <= bytes.length) { if (bytes[offset] !== 0xff) break; const marker = bytes[offset + 1]!; if (marker === 0xda) { output.push(...bytes.subarray(offset)); break; } const length = (bytes[offset + 2]! << 8) | bytes[offset + 3]!; if (length < 2 || offset + 2 + length > bytes.length) break; const keep = marker !== 0xe1 && marker !== 0xe2 && marker !== 0xed && marker !== 0xee; if (keep) output.push(...bytes.subarray(offset, offset + 2 + length)); offset += 2 + length; } return Uint8Array.from(output); }
function jpegDimensions(bytes: Uint8Array): { readonly width: number; readonly height: number } | undefined { let offset = 2; while (offset + 9 < bytes.length) { if (bytes[offset] !== 0xff) { offset += 1; continue; } const marker = bytes[offset + 1]!; if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) return { height: (bytes[offset + 5]! << 8) | bytes[offset + 6]!, width: (bytes[offset + 7]! << 8) | bytes[offset + 8]! }; const length = (bytes[offset + 2]! << 8) | bytes[offset + 3]!; if (length < 2) break; offset += 2 + length; } return undefined; }
async function decodePng(bytes: Uint8Array): Promise<PdfImage> { if (!isPng(bytes)) throw new DocumentError('MALFORMED', 'PNG signature is missing'); const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); let offset = 8; let width = 0; let height = 0; let bitDepth = 0; let colorType = 0; let ended = false; const idat: Uint8Array[] = []; while (offset + 12 <= bytes.length) { const size = view.getUint32(offset, false); const type = textDecode(bytes.subarray(offset + 4, offset + 8)); if (offset + 12 + size > bytes.length) throw new DocumentError('MALFORMED', 'PNG chunk is truncated'); const data = bytes.subarray(offset + 8, offset + 8 + size); if (type === 'IHDR') { width = view.getUint32(offset + 8, false); height = view.getUint32(offset + 12, false); bitDepth = data[8] ?? 0; colorType = data[9] ?? 0; } if (type === 'IDAT') idat.push(data.slice()); offset += 12 + size; if (type === 'IEND') { ended = true; break; } } if (!ended || !width || !height || width > 16_384 || height > 16_384 || width * height > 20_000_000 || width * height * 3 > 64 * 1024 * 1024 || bitDepth !== 8 || ![0, 2, 4, 6].includes(colorType) || !idat.length) throw new DocumentError('UNSUPPORTED', 'PNG pixel format is unsupported or exceeds bounds'); const pixels = await decodePngPixels(idat, width, height, colorType); const data = await deflateZlib(pixels); return { width, height, colorSpace: 'DeviceRGB', data, filter: 'FlateDecode' }; }
async function decodePngPixels(chunks: readonly Uint8Array[], width: number, height: number, colorType: number): Promise<Uint8Array> { const channels = colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 4 ? 2 : 4; const rowBytes = width * channels; const inflated = await inflateZlib(concat(chunks)); if (inflated.byteLength !== (rowBytes + 1) * height) throw new DocumentError('MALFORMED', 'PNG scanline data is invalid'); const unfiltered = new Uint8Array(rowBytes * height); for (let row = 0; row < height; row += 1) { const filter = inflated[row * (rowBytes + 1)]!; const source = inflated.subarray(row * (rowBytes + 1) + 1, row * (rowBytes + 1) + 1 + rowBytes); const target = unfiltered.subarray(row * rowBytes, (row + 1) * rowBytes); const previous = row ? unfiltered.subarray((row - 1) * rowBytes, row * rowBytes) : undefined; for (let column = 0; column < rowBytes; column += 1) { const left = column >= channels ? target[column - channels]! : 0; const up = previous?.[column] ?? 0; const upperLeft = previous && column >= channels ? previous[column - channels]! : 0; const value = source[column]!; if (filter === 0) target[column] = value; else if (filter === 1) target[column] = (value + left) & 0xff; else if (filter === 2) target[column] = (value + up) & 0xff; else if (filter === 3) target[column] = (value + Math.floor((left + up) / 2)) & 0xff; else if (filter === 4) target[column] = (value + paeth(left, up, upperLeft)) & 0xff; else throw new DocumentError('UNSUPPORTED', 'PNG scanline filter is unsupported'); } } if (colorType === 2) return unfiltered; const output = new Uint8Array(width * height * 3); for (let index = 0, out = 0; index < width * height; index += 1) { if (colorType === 0) { const value = unfiltered[index]!; output[out++] = value; output[out++] = value; output[out++] = value; } else if (colorType === 4) { const value = unfiltered[index * 2]!; const alpha = unfiltered[index * 2 + 1]! / 255; output[out++] = Math.round(value * alpha + 255 * (1 - alpha)); output[out++] = Math.round(value * alpha + 255 * (1 - alpha)); output[out++] = Math.round(value * alpha + 255 * (1 - alpha)); } else { const base = index * 4; const alpha = unfiltered[base + 3]! / 255; output[out++] = Math.round(unfiltered[base]! * alpha + 255 * (1 - alpha)); output[out++] = Math.round(unfiltered[base + 1]! * alpha + 255 * (1 - alpha)); output[out++] = Math.round(unfiltered[base + 2]! * alpha + 255 * (1 - alpha)); } } return output; }
function paeth(left: number, up: number, upperLeft: number): number { const p = left + up - upperLeft; const pa = Math.abs(p - left); const pb = Math.abs(p - up); const pc = Math.abs(p - upperLeft); return pa <= pb && pa <= pc ? left : pb <= pc ? up : upperLeft; }
function pdfImageObject(image: PdfImage): Uint8Array { const header = utf8(`<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /${image.colorSpace} /BitsPerComponent 8 /Filter /${image.filter} /Length ${image.data.byteLength} >>\nstream\n`); const footer = utf8('\nendstream'); return concat([header, image.data, footer]); }
function pdfStreamObject(content: string): Uint8Array { const data = utf8(content); return concat([utf8(`<< /Length ${data.byteLength} >>\nstream\n`), data, utf8('\nendstream')]); }
function pdfPageContent(width: number, height: number, crop: { readonly left: number; readonly top: number; readonly width: number; readonly height: number }, rotation: PageTransform['rotation']): string { const angle = rotation === 90 ? `0 1 -1 0 ${crop.height} 0` : rotation === 180 ? `-1 0 0 -1 ${crop.width} ${crop.height}` : rotation === 270 ? `0 -1 1 0 0 ${crop.width}` : '1 0 0 1 0 0'; return `q\n${angle} cm\n${crop.width} 0 0 ${crop.height} ${-crop.left} ${-(height - crop.top - crop.height)} cm\n/Im1 Do\nQ\n`; }
function buildPdf(objects: readonly Uint8Array[], title?: string): Uint8Array { const allObjects = [...objects]; let infoId: number | undefined; if (title) { infoId = allObjects.length + 1; allObjects.push(utf8(`<< /Producer (Keystone) /Title (${escapePdfLiteral(title)}) >>`)); } const chunks: Uint8Array[] = [utf8('%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n')]; const offsets: number[] = [0]; let length = chunks[0]!.byteLength; for (const [index, object] of allObjects.entries()) { offsets.push(length); const header = utf8(`${index + 1} 0 obj\n`); const footer = utf8('\nendobj\n'); chunks.push(header, object, footer); length += header.byteLength + object.byteLength + footer.byteLength; } const xrefOffset = length; const xref = [`xref\n0 ${allObjects.length + 1}\n0000000000 65535 f \n`, ...offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`), `trailer\n<< /Size ${allObjects.length + 1} /Root 1 0 R${infoId ? ` /Info ${infoId} 0 R` : ''} >>\nstartxref\n${xrefOffset}\n%%EOF\n`]; chunks.push(utf8(xref.join(''))); return concat(chunks); }

// ---------------------------------------------------------------------------
// Validation and small pure helpers
// ---------------------------------------------------------------------------

function validateDocumentModel(model: DocumentModel, file: DocumentFileRef): DocumentModel { if (!model || !['PDF', 'EPUB', 'MARKDOWN', 'PLAIN_TEXT'].includes(model.format) || !model.pages.length || model.pages.length > DOCUMENT_MAX_PAGES || model.chapters.length > DOCUMENT_MAX_CHAPTERS || model.text.length > DOCUMENT_MAX_TEXT_BYTES) throw new DocumentError('MALFORMED', 'Document adapter returned an invalid model'); for (const page of model.pages) { if (page.pageNumber < 1 || page.pageNumber > DOCUMENT_MAX_PAGES || page.text.length > DOCUMENT_MAX_TEXT_BYTES) throw new DocumentError('RESOURCE_LIMIT', 'Document page exceeds bounds'); assertSameRevision(file.revision, page.locator.revision); } return model; }
function pageModel(pageNumber: number, locator: DocumentLocator, text: string, textLayer: DocumentPage['textLayer'], blocks: readonly DocumentBlock[], links: readonly DocumentLink[], width: number | undefined, height: number | undefined, rotation: DocumentPage['rotation'], imageAvailable: boolean): DocumentPage { return { pageNumber, id: `page-${pageNumber}`, locator, text: boundedText(text, DOCUMENT_MAX_TEXT_BYTES), blocks: blocks.slice(0, 10_000), links: dedupeLinks(links).slice(0, DOCUMENT_MAX_LINKS), ...(width === undefined ? {} : { width }), ...(height === undefined ? {} : { height }), rotation, textLayer, imageAvailable }; }
function pdfLocator(revision: DocumentRevisionRef, page: number, start: number, end: number, quote?: string): DocumentLocator { return { version: 1, revision: clone(revision), kind: 'PDF_PAGE', page, start, end, ...(quote ? { quote } : {}) }; }
function epubLocator(revision: DocumentRevisionRef, chapterId: string, start: number, end: number, quote?: string): DocumentLocator { return { version: 1, revision: clone(revision), kind: 'EPUB_CHAPTER', chapterId, start, end, ...(quote ? { quote } : {}) }; }
function textLocator(revision: DocumentRevisionRef, start: number, end: number, quote?: string): DocumentLocator { return { version: 1, revision: clone(revision), kind: 'TEXT_RANGE', start, end, ...(quote ? { quote } : {}) }; }
function normalizeLocator(locator: DocumentLocator): DocumentLocator { if (!locator || locator.version !== 1 || !locator.revision?.fileId || !locator.revision.revisionId) throw new DocumentError('INVALID_ARGUMENT', 'Document locator is invalid'); const page = locator.page === undefined ? undefined : clampInt(locator.page, 1, DOCUMENT_MAX_PAGES); const start = locator.start === undefined ? undefined : clampInt(locator.start, 0, DOCUMENT_MAX_TEXT_BYTES); const end = locator.end === undefined ? undefined : clampInt(locator.end, start ?? 0, DOCUMENT_MAX_TEXT_BYTES); return { version: 1, revision: clone(locator.revision), kind: locator.kind, ...(page === undefined ? {} : { page }), ...(locator.chapterId ? { chapterId: boundedText(locator.chapterId, 256) } : {}), ...(start === undefined ? {} : { start }), ...(end === undefined ? {} : { end }), ...(locator.quote ? { quote: boundedText(locator.quote, 4_096) } : {}), ...(locator.contextBefore ? { contextBefore: boundedText(locator.contextBefore, 1_024) } : {}), ...(locator.contextAfter ? { contextAfter: boundedText(locator.contextAfter, 1_024) } : {}) }; }
function assertSameRevision(a: DocumentRevisionRef, b: DocumentRevisionRef): void { if (!sameRevision(a, b)) throw new DocumentError('CONFLICT', 'Document locator belongs to a different File revision'); }
function sameRevision(a: DocumentRevisionRef, b: DocumentRevisionRef): boolean { return Boolean(a && b && a.fileId === b.fileId && a.revisionId === b.revisionId && (!a.contentId || !b.contentId || a.contentId === b.contentId)); }
function isDocumentServiceOptions(value: DocumentServiceOptions | DocumentFileSource): value is DocumentServiceOptions { return Boolean(value && typeof value === 'object' && 'files' in value); }
function isDocumentAnnotation(value: unknown): value is DocumentAnnotation { if (!value || typeof value !== 'object') return false; const candidate = value as Partial<DocumentAnnotation>; return candidate.version === 1 && typeof candidate.id === 'string' && ['HIGHLIGHT', 'NOTE', 'BOOKMARK'].includes(candidate.kind ?? '') && typeof candidate.ownerId === 'string' && Boolean(candidate.revision?.fileId) && Boolean(candidate.revision?.revisionId) && Boolean(candidate.locator); }
function parseMetadataState(value: unknown, ownerId: string): DocumentMetadataState { if (!value || typeof value !== 'object') return emptyMetadata(ownerId); const candidate = value as Partial<DocumentMetadataState>; if (candidate.version !== 1 || typeof candidate.ownerId !== 'string') return emptyMetadata(ownerId); if (candidate.ownerId !== ownerId) throw new DocumentError('UNAUTHORIZED', 'Document metadata owner mismatch'); const annotations: Record<string, DocumentAnnotation> = {}; for (const [id, item] of Object.entries(candidate.annotations ?? {}).slice(0, DOCUMENT_MAX_ANNOTATIONS)) if (isDocumentAnnotation(item) && item.id === id && item.ownerId === ownerId) annotations[id] = clone(item); const tombstones: Record<string, DocumentAnnotation> = {}; for (const [id, item] of Object.entries(candidate.annotationTombstones ?? {}).slice(0, DOCUMENT_MAX_ANNOTATIONS)) if (isDocumentAnnotation(item) && item.id === id && item.ownerId === ownerId) tombstones[id] = clone(item); const progress: Record<string, DocumentReadingProgress> = {}; for (const [id, item] of Object.entries(candidate.progress ?? {}).slice(0, DOCUMENT_MAX_SEARCH_DOCUMENTS)) if (item && typeof item === 'object' && (item as DocumentReadingProgress).version === 1) progress[id] = clone(item); const ocr: Record<string, DocumentOcrResult> = {}; for (const [id, item] of Object.entries(candidate.ocr ?? {}).slice(0, DOCUMENT_MAX_SEARCH_DOCUMENTS)) if (item && typeof item === 'object' && (item as DocumentOcrResult).version === 1 && typeof (item as DocumentOcrResult).text === 'string' && (item as DocumentOcrResult).text.length <= DOCUMENT_MAX_OCR_TEXT) ocr[id] = clone(item); const index: Record<string, DocumentSearchRecord> = {}; for (const [id, item] of Object.entries(candidate.index ?? {}).slice(0, DOCUMENT_MAX_SEARCH_DOCUMENTS)) if (item && typeof item === 'object' && typeof (item as DocumentSearchRecord).documentId === 'string') index[id] = { ...(clone(item) as DocumentSearchRecord), text: boundedText((item as DocumentSearchRecord).text, DOCUMENT_MAX_TEXT_BYTES) }; return { version: 1, ownerId, progress, annotations, annotationTombstones: tombstones, ocr, index, recent: Array.isArray(candidate.recent) ? candidate.recent.slice(0, 128).filter(item => item && typeof item.documentId === 'string').map(clone) : [] }; }
function compareAnnotationVersion(a: DocumentAnnotation, b: DocumentAnnotation): number { return a.versionNumber - b.versionNumber || a.updatedAt.localeCompare(b.updatedAt) || a.id.localeCompare(b.id); }
function compareUpdated(a: { updatedAt: string; id: string }, b: { updatedAt: string; id: string }): number { return b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id); }
function searchModel(open: OpenDocument, query: string, limit = 64): readonly DocumentSearchResult[] { const terms = tokenize(query); if (!terms.length) return []; const output: DocumentSearchResult[] = []; for (const page of open.model.pages) { const haystack = page.text.toLocaleLowerCase(); const matches = terms.filter(term => haystack.includes(term)); if (!matches.length) continue; const position = Math.max(0, haystack.indexOf(matches[0]!)); output.push({ documentId: open.descriptor.documentId, fileId: open.file.fileId, revision: clone(open.revision), title: open.model.title, format: open.model.format, locator: { ...clone(page.locator), start: position, end: position + matches[0]!.length }, snippet: safeSnippet(page.text, position, 240), source: page.textLayer === 'OCR' ? 'OCR' : 'TEXT', score: matches.length / terms.length }); } return output.slice(0, clampInt(limit, 1, 256)).map(clone); }
function staticRenderedPage(page: DocumentPage): DocumentRenderedPage { return { pageNumber: page.pageNumber, mode: 'STATIC_SAFE', text: page.text, blocks: page.blocks.map(clone), ...(page.width === undefined ? {} : { width: page.width }), ...(page.height === undefined ? {} : { height: page.height }), rotation: page.rotation, scriptsExecuted: 0, formsSubmitted: 0 }; }
function publicDraft(draft: MutableCaptureDraft): DocumentCaptureDraft { return { version: 1, id: draft.id, title: draft.title, pages: draft.pages.map(publicPage), createdAt: draft.createdAt, updatedAt: draft.updatedAt, state: draft.state }; }
function publicPage(page: CapturedPage): CapturedPage { return { pageId: page.pageId, ...(page.sourceFileId ? { sourceFileId: page.sourceFileId } : {}), ...(page.sourceRevision ? { sourceRevision: clone(page.sourceRevision) } : {}), filename: page.filename, mimeType: page.mimeType, byteLength: page.byteLength, transform: clone(page.transform), position: page.position }; }
function touchDraft(draft: MutableCaptureDraft, now: () => number): void { draft.updatedAt = nowIso(now); }
function validateOcrRegion(region: DocumentOcrRegion): DocumentOcrRegion { if (!region || ![region.left, region.top, region.width, region.height].every(value => Number.isFinite(value) && value >= 0) || region.width > 100_000 || region.height > 100_000 || region.text.length > 16 * 1024) throw new DocumentError('RESOURCE_LIMIT', 'OCR region is invalid'); const confidence = region.confidence === undefined ? undefined : validateConfidence(region.confidence); return { text: boundedText(region.text, 16 * 1024), left: region.left, top: region.top, width: region.width, height: region.height, ...(confidence === undefined ? {} : { confidence }) }; }
function validateConfidence(value: number): number { if (!Number.isFinite(value) || value < 0 || value > 1) throw new DocumentError('INVALID_ARGUMENT', 'OCR confidence is invalid'); return value; }
function formatCitation(locator: DocumentLocator, filename?: string): string { const source = filename ? filename : locator.revision.fileId; if (locator.kind === 'PDF_PAGE') return `${source}, page ${locator.page ?? '?'}${locator.start !== undefined ? `, characters ${locator.start}-${locator.end ?? locator.start}` : ''}`; if (locator.kind === 'EPUB_CHAPTER') return `${source}, chapter ${locator.chapterId ?? '?'}`; return `${source}${locator.start !== undefined ? `, characters ${locator.start}-${locator.end ?? locator.start}` : ''}`; }
function safeSnippet(source: string, start: number, length: number): string { const from = Math.max(0, Math.min(source.length, start)); return boundedText(source.slice(from, from + length).replace(/\s+/g, ' ').trim(), length); }
function tokenize(value: string): string[] { return boundedText(value, 4_096).toLocaleLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? []; }
function normalizeRotation(value: number | undefined): 0 | 90 | 180 | 270 { if (!Number.isFinite(value)) return 0; const normalized = ((Math.round(value!) % 360) + 360) % 360; return normalized === 90 || normalized === 180 || normalized === 270 ? normalized : 0; }
function assertSourceBytes(bytes: Uint8Array): Uint8Array { if (!(bytes instanceof Uint8Array) || !bytes.byteLength || bytes.byteLength > DOCUMENT_MAX_SOURCE_BYTES) throw new DocumentError('RESOURCE_LIMIT', 'Document source exceeds bounds'); return bytes; }
function safeOwnerId(value: string): string { const output = boundedText(value, 256); if (!output || /[\u0000-\u001f]/.test(output)) throw new DocumentError('INVALID_ARGUMENT', 'Document owner ID is invalid'); return output; }
function boundedText(value: string, max: number): string { return String(value).slice(0, max); }
function safeFilename(value: string): string { const output = boundedText(value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim(), 180); return output || 'document'; }
function extension(value: string): string { return value.toLocaleLowerCase().split('.').pop() ?? ''; }
function nowIso(now: () => number): string { return new Date(now()).toISOString(); }
function randomId(prefix: string): string { const uuid = typeof globalThis.crypto?.randomUUID === 'function' ? globalThis.crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`; return `${prefix}:${uuid}`; }
function clone<T>(value: T): T { return structuredClone(value); }
function clampInt(value: number, min: number, max: number): number { return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.floor(value))) : min; }
function clampNumber(value: number, min: number, max: number): number { return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min; }
function utf8(value: string): Uint8Array { return new TextEncoder().encode(value); }
function textDecode(value: Uint8Array): string { return new TextDecoder('utf-8', { fatal: false }).decode(value); }
function concat(values: readonly Uint8Array[]): Uint8Array { const length = values.reduce((total, value) => total + value.byteLength, 0); const output = new Uint8Array(length); let offset = 0; for (const value of values) { output.set(value, offset); offset += value.byteLength; } return output; }
function decodePdfLiteral(value: string): string { return value.replace(/\\([nrtbf()\\])/g, (_match, code: string) => ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' }[code] ?? code)).replace(/\\(\d{1,3})/g, (_match, octal: string) => String.fromCharCode(Number.parseInt(octal, 8))); }
function decodePdfHex(value: string): string { const clean = value.replace(/\s/g, ''); const padded = clean.length % 2 ? `${clean}0` : clean; const output = new Uint8Array(Math.floor(padded.length / 2)); for (let index = 0; index < output.length; index += 1) output[index] = Number.parseInt(padded.slice(index * 2, index * 2 + 2), 16) || 0; return textDecode(output); }
function escapePdfLiteral(value: string): string { return boundedText(value, 512).replace(/[()\\]/g, '\\$&').replace(/[\u0000-\u001f]/g, ' '); }
function isJpeg(bytes: Uint8Array): boolean { return bytes.length > 2 && bytes[0] === 0xff && bytes[1] === 0xd8; }
function isPng(bytes: Uint8Array): boolean { return bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a; }
function findSignature(bytes: Uint8Array, signature: number, start: number): number { for (let index = Math.min(start, bytes.length - 4); index >= 0; index -= 1) { if (((bytes[index]! | (bytes[index + 1]! << 8) | (bytes[index + 2]! << 16) | (bytes[index + 3]! << 24)) >>> 0) === signature) return index; } return -1; }
function crc32(bytes: Uint8Array): number { let crc = 0xffffffff; for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); } return (crc ^ 0xffffffff) >>> 0; }
function safeArchivePath(value: string): string { const normalized = decodeXmlEntities(value).replaceAll('\\', '/'); if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized) || normalized.split('/').some(part => !part || part === '..' || part === '.')) throw new DocumentError('MALFORMED', 'EPUB path traversal is blocked'); if (normalized.split('/').length > 32 || normalized.length > 1_024 || /[\u0000-\u001f]/.test(normalized)) throw new DocumentError('RESOURCE_LIMIT', 'EPUB path exceeds bounds'); return normalized; }
function directoryOf(value: string): string { const index = value.lastIndexOf('/'); return index < 0 ? '' : value.slice(0, index); }
function joinArchivePath(base: string, value: string): string { const raw = value.replace(/^\.\//, ''); return base ? `${base}/${raw}` : raw; }
function attributeFromFirstTag(source: string, tag: string, attribute: string): string | undefined { const match = source.match(new RegExp(`<${tag}\\b[^>]*\\b${attribute}\\s*=\\s*(["'])(.*?)\\1`, 'i')); return match?.[2] ? decodeXmlEntities(match[2]) : undefined; }
function textContentFromFirstTag(source: string, tag: string): string | undefined { const match = source.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i')); const value = match?.[1] ? stripMarkup(decodeXmlEntities(match[1])) : ''; return value || undefined; }
function parseXmlAttributes(source: string): Record<string, string> { const output: Record<string, string> = {}; for (const match of source.matchAll(/([:\w-]+)\s*=\s*(["'])(.*?)\2/g)) if (Object.keys(output).length < 64) output[match[1]!.toLocaleLowerCase()] = boundedText(decodeXmlEntities(match[3]!), 4_096); return output; }
function decodeXmlEntities(value: string): string { return value.replace(/&(?:amp|lt|gt|quot|apos|nbsp);|&#(?:x[0-9a-f]+|[0-9]+);/gi, match => { const direct: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ' }; if (direct[match.toLocaleLowerCase()]) return direct[match.toLocaleLowerCase()]!; const number = match.toLocaleLowerCase().startsWith('&#x') ? Number.parseInt(match.slice(3, -1), 16) : Number.parseInt(match.slice(2, -1), 10); return Number.isSafeInteger(number) && number >= 0 && number <= 0x10ffff ? String.fromCodePoint(number) : ''; }); }
function stripMarkup(value: string): string { return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(); }
function dedupeLinks(links: readonly DocumentLink[]): DocumentLink[] { return [...new Map(links.map(link => [`${link.target}:${link.label}`, link])).values()]; }
function findBalanced(source: string, start: number, open: string, close: string): number { let depth = 0; for (let index = start; index < source.length; index += 1) { if (source[index] === open) depth += 1; else if (source[index] === close && --depth === 0) return index; } return -1; }
function publicClone<T>(value: T): T { return clone(value); }
