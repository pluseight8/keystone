/** Typed desktop host boundary for R0P93 Documents and Reader.
 *
 * The shell receives document metadata and bounded reader results.  A native
 * bootstrapper installs a DocumentService backed by canonical Files; this
 * module never discovers paths, starts processes, or creates a second byte
 * store in the desktop UI.
 */
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

export interface DesktopDocumentsRuntime {
  readonly documents: DocumentService;
  listSupportedFiles(actorIdentityId?: string): Promise<readonly DocumentFileRef[]>;
  recent(): Promise<readonly DocumentDescriptor[]>;
  open(fileId: string, actorIdentityId?: string): Promise<DocumentReaderHandle>;
  search(query: string, options?: { readonly limit?: number; readonly actorIdentityId?: string }): Promise<readonly DocumentSearchResult[]>;
  progress(documentId: string): Promise<DocumentReadingProgress | undefined>;
  saveProgress(documentId: string, locator: DocumentLocator): Promise<DocumentReadingProgress>;
  listAnnotations(documentId: string): Promise<readonly DocumentAnnotation[]>;
  addHighlight(input: { readonly documentId: string; readonly locator: DocumentLocator; readonly selectedText: string; readonly color?: DocumentAnnotation['color']; readonly body?: string }): Promise<DocumentAnnotation>;
  addNote(input: { readonly documentId: string; readonly locator: DocumentLocator; readonly body: string }): Promise<DocumentAnnotation>;
  addBookmark(input: { readonly documentId: string; readonly locator: DocumentLocator; readonly label?: string }): Promise<DocumentBookmark>;
  recognizePage(documentId: string, pageNumber: number, options?: { readonly language?: string; readonly force?: boolean; readonly signal?: AbortSignal }): Promise<DocumentOcrResult>;
  recognizeDocument(documentId: string, options?: { readonly language?: string; readonly signal?: AbortSignal; readonly onProgress?: (job: DocumentOcrJob) => void }): Promise<DocumentOcrJob>;
  cancelOcr(jobId: string): void;
  exportPrivateSync(): Promise<DocumentPrivateSyncEnvelope>;
  mergePrivateSync(envelope: DocumentPrivateSyncEnvelope): Promise<void>;
  share?(documentId: string, input: { readonly ownerConfirmed: true; readonly recipientIds?: readonly string[]; readonly locator?: DocumentLocator }): Promise<unknown>;
  continueOnDevice?(documentId: string, input: { readonly targetDeviceId: string; readonly locator?: DocumentLocator }): Promise<unknown>;
  sendNearby?(documentId: string, input: { readonly targetId: string; readonly mode: 'COPY' | 'AUTHORIZED_REFERENCE'; readonly ownerConfirmed: true }): Promise<unknown>;
  subscribe?(listener: () => void): () => void;
}

let current: DesktopDocumentsRuntime | undefined;
const listeners = new Set<() => void>();

export function installDesktopDocumentsRuntime(runtime: DesktopDocumentsRuntime | undefined): void {
  current = runtime;
  for (const listener of listeners) listener();
}

export function getDesktopDocumentsRuntime(): DesktopDocumentsRuntime | undefined { return current; }

export function subscribeDesktopDocumentsRuntime(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Creates the projection used by DesktopShell from the canonical service. */
export function createDesktopDocumentsRuntime(service: DocumentService): DesktopDocumentsRuntime {
  return {
    documents: service,
    listSupportedFiles: actorIdentityId => service.listSupportedFiles(actorIdentityId),
    recent: () => service.recent(),
    open: (fileId, actorIdentityId) => service.open(fileId, actorIdentityId),
    search: (query, options) => service.search(query, options),
    progress: documentId => service.progress(documentId),
    saveProgress: (documentId, locator) => service.saveProgress(documentId, locator),
    listAnnotations: documentId => service.listAnnotations(documentId),
    addHighlight: input => service.addHighlight(input.documentId, { locator: input.locator, selectedText: input.selectedText, ...(input.color ? { color: input.color } : {}), ...(input.body ? { body: input.body } : {}) }),
    addNote: input => service.addNote(input.documentId, { locator: input.locator, body: input.body }),
    addBookmark: input => service.addBookmark(input.documentId, { locator: input.locator, ...(input.label ? { label: input.label } : {}) }),
    recognizePage: (documentId, pageNumber, options) => service.recognizePage(documentId, pageNumber, options),
    recognizeDocument: (documentId, options) => service.recognizeDocument(documentId, options),
    cancelOcr: jobId => service.cancelOcr(jobId),
    exportPrivateSync: () => service.exportPrivateSync(),
    mergePrivateSync: envelope => service.mergePrivateSync(envelope),
    share: (documentId, input) => service.share(documentId, input),
    continueOnDevice: (documentId, input) => service.continueOnDevice(documentId, input),
    sendNearby: (documentId, input) => service.sendNearby(documentId, input),
  };
}
