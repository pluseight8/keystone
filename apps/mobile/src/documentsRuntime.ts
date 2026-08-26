/** Typed mobile host boundary for R0P93 Documents and Reader. */
import type {
  DocumentAnnotation,
  DocumentBookmark,
  DocumentDescriptor,
  DocumentFileRef,
  DocumentLocator,
  DocumentOcrJob,
  DocumentOcrResult,
  DocumentPrivateSyncEnvelope,
  DocumentReadingProgress,
  DocumentReaderHandle,
  DocumentSearchResult,
  DocumentService,
} from '@keystone/core';

export interface MobileDocumentsRuntime {
  readonly documents: DocumentService;
  listSupportedFiles(actorIdentityId?: string): Promise<readonly DocumentFileRef[]>;
  recent(): Promise<readonly DocumentDescriptor[]>;
  open(fileId: string, actorIdentityId?: string): Promise<DocumentReaderHandle>;
  search(query: string, options?: { readonly limit?: number; readonly actorIdentityId?: string }): Promise<readonly DocumentSearchResult[]>;
  progress(documentId: string): Promise<DocumentReadingProgress | undefined>;
  saveProgress(documentId: string, locator: DocumentLocator): Promise<DocumentReadingProgress>;
  listAnnotations(documentId: string): Promise<readonly DocumentAnnotation[]>;
  addBookmark(input: { readonly documentId: string; readonly locator: DocumentLocator; readonly label?: string }): Promise<DocumentBookmark>;
  addNote(input: { readonly documentId: string; readonly locator: DocumentLocator; readonly body: string }): Promise<DocumentAnnotation>;
  recognizePage(documentId: string, pageNumber: number, options?: { readonly language?: string; readonly force?: boolean; readonly signal?: AbortSignal }): Promise<DocumentOcrResult>;
  recognizeDocument(documentId: string, options?: { readonly language?: string; readonly signal?: AbortSignal; readonly onProgress?: (job: DocumentOcrJob) => void }): Promise<DocumentOcrJob>;
  cancelOcr(jobId: string): void;
  exportPrivateSync(): Promise<DocumentPrivateSyncEnvelope>;
  mergePrivateSync(envelope: DocumentPrivateSyncEnvelope): Promise<void>;
  subscribe?(listener: () => void): () => void;
}

let current: MobileDocumentsRuntime | undefined;
const listeners = new Set<() => void>();

export function installMobileDocumentsRuntime(runtime: MobileDocumentsRuntime | undefined): void {
  current = runtime;
  for (const listener of listeners) listener();
}

export function getMobileDocumentsRuntime(): MobileDocumentsRuntime | undefined { return current; }

export function subscribeMobileDocumentsRuntime(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function createMobileDocumentsRuntime(service: DocumentService): MobileDocumentsRuntime {
  return {
    documents: service,
    listSupportedFiles: actorIdentityId => service.listSupportedFiles(actorIdentityId),
    recent: () => service.recent(),
    open: (fileId, actorIdentityId) => service.open(fileId, actorIdentityId),
    search: (query, options) => service.search(query, options),
    progress: documentId => service.progress(documentId),
    saveProgress: (documentId, locator) => service.saveProgress(documentId, locator),
    listAnnotations: documentId => service.listAnnotations(documentId),
    addBookmark: input => service.addBookmark(input.documentId, { locator: input.locator, ...(input.label ? { label: input.label } : {}) }),
    addNote: input => service.addNote(input.documentId, { locator: input.locator, body: input.body }),
    recognizePage: (documentId, pageNumber, options) => service.recognizePage(documentId, pageNumber, options),
    recognizeDocument: (documentId, options) => service.recognizeDocument(documentId, options),
    cancelOcr: jobId => service.cancelOcr(jobId),
    exportPrivateSync: () => service.exportPrivateSync(),
    mergePrivateSync: envelope => service.mergePrivateSync(envelope),
  };
}
