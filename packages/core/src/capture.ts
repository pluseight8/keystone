/**
 * R0P94 Universal Capture.
 *
 * Capture is an intake boundary and a private, local-first tray.  It is not a
 * second Tasks, Files, Vault, Web Library, Photos or Documents database.  A
 * capture becomes authoritative only after an explicit destination adapter
 * writes it to the existing canonical service.
 */

export const CAPTURE_PROTOCOL = 'keystone.capture.v1' as const;
export const CAPTURE_VERSION = 1 as const;
export const CAPTURE_MAX_ITEMS = 100_000;
export const CAPTURE_MAX_BULK_ITEMS = 1_000;
export const CAPTURE_MAX_TEXT_BYTES = 256 * 1024;
export const CAPTURE_MAX_URL_LENGTH = 8 * 1024;
export const CAPTURE_MAX_FILE_BYTES = 4 * 1024 * 1024 * 1024;
export const CAPTURE_MAX_REFERENCE_BYTES = 16 * 1024;
export const CAPTURE_MAX_PAGE_EXCERPT_BYTES = 64 * 1024;
export const CAPTURE_MAX_ERROR_BYTES = 2 * 1024;

export type CaptureItemId = `capture:${string}`;
export type CaptureOperationId = `capture-op:${string}`;
export type CaptureState = 'DRAFT' | 'READY' | 'PROCESSING' | 'ROUTED' | 'FAILED' | 'DISMISSED';
export type CaptureDataClass = 'PUBLIC' | 'USER_EXPLICIT' | 'PRIVATE' | 'SECRET';

export type CaptureSourceKind =
  | 'MANUAL'
  | 'CLIPBOARD'
  | 'BROWSER_PAGE'
  | 'BROWSER_SELECTION'
  | 'FILE_DROP'
  | 'FOLDER_DROP'
  | 'OS_SHARE'
  | 'PHOTO'
  | 'DOCUMENT_SELECTION'
  | 'MAIL_REFERENCE'
  | 'MESSAGE_REFERENCE'
  | 'CONTACT'
  | 'PLACE'
  | 'ROUTE'
  | 'CALENDAR_EVENT'
  | 'TASK_REFERENCE'
  | 'WORKBOARD_REFERENCE'
  | 'NEARBY'
  | 'CONTINUITY'
  | 'KEYSTONE_DEEP_LINK'
  | 'KEYSTONE_OBJECT';

export type CaptureDestinationKind =
  | 'TASK'
  | 'VAULT'
  | 'WEB_LIBRARY'
  | 'FILES'
  | 'PHOTOS'
  | 'DOCUMENTS'
  | 'CONTACTS'
  | 'CALENDAR'
  | 'WORKBOARD'
  | 'SHARED_FOLDER';

export interface CaptureReference {
  readonly type: string;
  readonly id: string;
  readonly label?: string;
  readonly revision?: string;
  readonly locator?: string;
  readonly dataClass: CaptureDataClass;
  readonly ownerId?: string;
}

export interface CaptureSource {
  readonly kind: CaptureSourceKind;
  readonly ref?: CaptureReference;
  readonly label?: string;
  readonly application?: string;
}

export interface CaptureProvenance {
  readonly source: CaptureSource;
  readonly capturedAt: string;
  readonly sourceRevision?: string;
  readonly dataClass: CaptureDataClass;
  readonly userInitiated: true;
}

export interface CaptureFileRef {
  readonly id: string;
  readonly name: string;
  readonly mimeType: string;
  readonly size: number;
  readonly modifiedAt?: string;
  readonly contentId?: string;
  readonly handleState: 'AVAILABLE' | 'METADATA_ONLY' | 'MISSING';
}

export interface CaptureTextPayload { readonly kind: 'TEXT'; readonly text: string; }
export interface CaptureUrlPayload { readonly kind: 'URL'; readonly url: string; readonly title?: string; }
export interface CaptureImagePayload { readonly kind: 'IMAGE'; readonly file: CaptureFileRef; readonly altText?: string; }
export interface CaptureFilePayload { readonly kind: 'FILE'; readonly file: CaptureFileRef; }
export interface CaptureDocumentPayload { readonly kind: 'DOCUMENT'; readonly file: CaptureFileRef; readonly page?: number; readonly selectedText?: string; }
export interface CaptureReferencePayload { readonly kind: 'REFERENCE'; readonly reference: CaptureReference; }
export interface CaptureContactCardPayload { readonly kind: 'CONTACT_CARD'; readonly vCard: string; }
export interface CaptureBrowserPagePayload { readonly kind: 'BROWSER_PAGE'; readonly url: string; readonly title: string; readonly excerpt?: string; readonly pageRevision?: number; }
export interface CaptureBrowserSelectionPayload { readonly kind: 'BROWSER_SELECTION'; readonly selectedText: string; readonly url?: string; readonly title?: string; readonly pageRevision?: number; }
export type CaptureAtomicPayload = CaptureTextPayload | CaptureUrlPayload | CaptureImagePayload | CaptureFilePayload | CaptureDocumentPayload | CaptureReferencePayload | CaptureContactCardPayload | CaptureBrowserPagePayload | CaptureBrowserSelectionPayload;
export interface CaptureMultiPayload { readonly kind: 'MULTI'; readonly items: readonly CaptureAtomicPayload[]; }
export type CapturePayload = CaptureAtomicPayload | CaptureMultiPayload;

export interface CaptureItem {
  readonly version: 1;
  readonly id: CaptureItemId;
  readonly state: CaptureState;
  readonly title: string;
  readonly payload: CapturePayload;
  readonly provenance: CaptureProvenance;
  readonly fingerprint: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly routedAt?: string;
  readonly dismissedAt?: string;
  readonly resultRefs: readonly CaptureReference[];
  readonly failure?: { readonly code: string; readonly message: string; readonly at: string };
  readonly duplicateCount?: number;
}

export interface CaptureFileHandle {
  readonly id?: string;
  readonly read: (signal?: AbortSignal) => Promise<Uint8Array>;
  readonly close?: () => void | Promise<void>;
}

export interface CaptureFileInput {
  readonly name: string;
  readonly mimeType?: string;
  readonly size?: number;
  readonly modifiedAt?: string;
  readonly contentId?: string;
  readonly bytes?: Uint8Array;
  readonly handle?: CaptureFileHandle;
  readonly read?: (signal?: AbortSignal) => Promise<Uint8Array>;
  readonly source?: CaptureSource;
  readonly dataClass?: CaptureDataClass;
  readonly image?: boolean;
  readonly document?: boolean;
  readonly page?: number;
  readonly selectedText?: string;
  readonly title?: string;
}

export interface CaptureReferenceInput {
  readonly reference: CaptureReference;
  readonly source?: CaptureSource;
  readonly title?: string;
}

export interface CaptureTextInput {
  readonly text: string;
  readonly source?: CaptureSource;
  readonly title?: string;
  readonly dataClass?: CaptureDataClass;
  readonly state?: Extract<CaptureState, 'DRAFT' | 'READY'>;
}

export interface CaptureClipboardValue {
  readonly text?: string;
  readonly html?: string;
  readonly mimeType?: string;
}

export interface CaptureClipboardBoundary {
  /** One explicit read initiated by the owner. There is intentionally no subscribe/watch API. */
  readonly read: (request: { readonly maxBytes: number; readonly signal?: AbortSignal }) => Promise<CaptureClipboardValue | undefined>;
}

export interface CaptureBrowserPage {
  readonly url: string;
  readonly title: string;
  readonly excerpt?: string;
  readonly pageRevision?: number;
  readonly dataClass?: CaptureDataClass;
}

export interface CaptureBrowserSelection {
  readonly selectedText: string;
  readonly url?: string;
  readonly title?: string;
  readonly pageRevision?: number;
  readonly dataClass?: CaptureDataClass;
}

export interface CaptureBrowserBoundary {
  readonly currentPage: (request: { readonly signal?: AbortSignal }) => Promise<CaptureBrowserPage | undefined>;
  readonly selection: (request: { readonly signal?: AbortSignal }) => Promise<CaptureBrowserSelection | undefined>;
}

export interface CaptureShareInInput {
  readonly accepted: boolean;
  readonly payload: CapturePayload;
  readonly source?: CaptureSource;
  readonly title?: string;
  readonly dataClass?: CaptureDataClass;
}

export interface CaptureDeepLinkProposal {
  readonly protocol: typeof CAPTURE_PROTOCOL;
  readonly text?: string;
  readonly url?: string;
  readonly reference?: CaptureReference;
  readonly title?: string;
}

export interface CaptureContinuityAdapter {
  readonly send: (input: { readonly captureId: CaptureItemId; readonly draft: CaptureItem; readonly targetDeviceId: string }) => Promise<{ readonly receiptId: string; readonly status: 'QUEUED' | 'DELIVERED' | 'OFFLINE' }>;
}

export interface CaptureSyncEnvelope {
  readonly version: 1;
  readonly protocol: typeof CAPTURE_PROTOCOL;
  readonly ownerIdentityId: string;
  readonly sourceDeviceId: string;
  readonly recipientDeviceId?: string;
  readonly createdAt: string;
  readonly items: readonly CaptureItem[];
}

export interface CaptureSyncAdapter {
  readonly trustedDeviceIds?: readonly string[];
  readonly publish?: (envelope: CaptureSyncEnvelope) => Promise<void>;
}

export interface CaptureDestinationPreview {
  readonly destination: CaptureDestinationKind;
  readonly title: string;
  readonly summary: string;
  readonly disclosure: 'PRIVATE' | 'REFERENCE_ONLY' | 'SHARED' | 'PUBLIC';
  readonly requiresOwnerConfirmation: true;
  readonly warnings: readonly string[];
}

export interface CaptureDestinationResult {
  readonly reference: CaptureReference;
  readonly created?: boolean;
  readonly details?: string;
}

export interface CaptureDestinationExecutionContext {
  readonly item: CaptureItem;
  readonly operationId: CaptureOperationId;
  readonly idempotencyKey: string;
  readonly ownerConfirmed: true;
  readonly readFile: (fileId: string, signal?: AbortSignal) => Promise<Uint8Array>;
}

export interface CaptureDestinationAdapter {
  readonly destinationKind: CaptureDestinationKind;
  readonly supports?: (item: CaptureItem) => boolean | Promise<boolean>;
  readonly preview: (input: { readonly item: CaptureItem }) => CaptureDestinationPreview | Promise<CaptureDestinationPreview>;
  readonly execute: (input: CaptureDestinationExecutionContext) => Promise<CaptureDestinationResult>;
  readonly resolve?: (input: { readonly item: CaptureItem; readonly operationId: CaptureOperationId }) => Promise<CaptureDestinationResult | undefined>;
  readonly undo?: (input: { readonly item: CaptureItem; readonly operationId: CaptureOperationId; readonly result: CaptureDestinationResult; readonly ownerConfirmed: true }) => Promise<void>;
}

export interface CaptureDestinationRegistry {
  readonly get: (destination: CaptureDestinationKind) => CaptureDestinationAdapter | undefined;
  readonly list: () => readonly CaptureDestinationAdapter[];
}

export class InMemoryCaptureDestinationRegistry implements CaptureDestinationRegistry {
  private readonly adapters = new Map<CaptureDestinationKind, CaptureDestinationAdapter>();
  constructor(adapters: readonly CaptureDestinationAdapter[] = []) { for (const adapter of adapters) this.register(adapter); }
  register(adapter: CaptureDestinationAdapter): void { if (!adapter || !adapter.destinationKind || !adapter.preview || !adapter.execute) throw new CaptureError('INVALID_ARGUMENT', 'Capture destination adapter is invalid'); this.adapters.set(adapter.destinationKind, adapter); }
  get(destination: CaptureDestinationKind): CaptureDestinationAdapter | undefined { return this.adapters.get(destination); }
  list(): readonly CaptureDestinationAdapter[] { return [...this.adapters.values()]; }
}

export interface CaptureSuggestion {
  readonly destination: CaptureDestinationKind;
  readonly confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  readonly reason: string;
  readonly requiresOwnerConfirmation: true;
}

export interface CaptureListQuery {
  readonly state?: CaptureState;
  readonly source?: CaptureSourceKind;
  readonly query?: string;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface CapturePage {
  readonly items: readonly CaptureItem[];
  readonly total: number;
  readonly nextCursor?: string;
}

export interface CaptureDiagnostics {
  readonly items: number;
  readonly activeItems: number;
  readonly routedItems: number;
  readonly failedItems: number;
  readonly transientHandles: number;
  readonly listeners: number;
  readonly timers: 0;
  readonly persistence: 'READY' | 'PENDING' | 'FAILED';
}

export interface CaptureStateStore {
  readonly read: () => Promise<unknown | undefined>;
  readonly write: (value: unknown) => Promise<void>;
}

export class InMemoryCaptureStateStore implements CaptureStateStore {
  private value?: unknown;
  async read(): Promise<unknown | undefined> { return this.value === undefined ? undefined : structuredClone(this.value); }
  async write(value: unknown): Promise<void> { this.value = structuredClone(value); }
  corrupt(value: unknown): void { this.value = structuredClone(value); }
}

export class CaptureError extends Error {
  constructor(readonly code: 'INVALID_ARGUMENT' | 'RESOURCE_LIMIT' | 'NOT_FOUND' | 'POLICY_DENIED' | 'UNAVAILABLE' | 'CONFLICT' | 'UNSAFE_INPUT', message: string) { super(message); this.name = 'CaptureError'; }
}

export const CAPTURE_ARCHITECTURE_POLICY = Object.freeze({
  canonicalDestinationStoresRemainAuthoritative: true,
  secondUniversalInbox: false,
  secondTaskInbox: false,
  secondFileStore: false,
  secondVaultStore: false,
  secondWebLibraryStore: false,
  secondPhotosStore: false,
  secondDocumentsStore: false,
  automaticRouting: false,
  automaticTaskCreation: false,
  automaticContactCreation: false,
  automaticCalendarCreation: false,
  automaticPublication: false,
  automaticExternalShare: false,
  automaticMemoryWrite: false,
  clipboardMonitoring: false,
  clipboardHistory: false,
  automaticExternalIngestion: false,
  externalAiByDefault: false,
  remoteCommandExecution: false,
  arbitraryFileUri: false,
} as const);

interface PersistedCaptureState {
  readonly version: 1;
  readonly items: Record<string, CaptureItem>;
  readonly operations: Record<string, CaptureOperationRecord>;
}
interface CaptureOperationRecord {
  readonly version: 1;
  readonly operationId: CaptureOperationId;
  readonly itemId: CaptureItemId;
  readonly destination: CaptureDestinationKind;
  readonly status: 'PROCESSING' | 'COMPLETED' | 'FAILED';
  readonly idempotencyKey: string;
  readonly result?: CaptureDestinationResult;
  readonly error?: string;
  readonly updatedAt: string;
}

export interface CaptureServiceOptions {
  readonly ownerIdentityId?: string;
  readonly deviceId?: string;
  readonly state?: CaptureStateStore;
  readonly destinations?: CaptureDestinationRegistry;
  readonly clipboard?: CaptureClipboardBoundary;
  readonly browser?: CaptureBrowserBoundary;
  readonly continuity?: CaptureContinuityAdapter;
  readonly sync?: CaptureSyncAdapter;
  readonly now?: () => number;
  readonly maxItems?: number;
  readonly maxTextBytes?: number;
  readonly maxFileBytes?: number;
}

type Listener = (event: { readonly type: 'CAPTURED' | 'UPDATED' | 'ROUTED' | 'DISMISSED' | 'RESTORED' | 'DELETED'; readonly itemId?: CaptureItemId }) => void;

function clone<T>(value: T): T { return structuredClone(value); }
function id(prefix: string): string { return `${prefix}:${typeof crypto?.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`; }
function iso(now: () => number): string { return new Date(now()).toISOString(); }
function bytes(value: string): number { return new TextEncoder().encode(value).byteLength; }
function boundedText(value: unknown, max: number, required = false): string {
  if (typeof value !== 'string' || value.length > max || bytes(value) > max || value.includes('\u0000') || (required && !value.trim())) throw new CaptureError('INVALID_ARGUMENT', 'Capture text is invalid or exceeds the bounded limit');
  return value.trim();
}
function safeId(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\u0000-\u001f\u007f]/.test(value); }
function safeMime(value: string | undefined): string { const mime = (value ?? 'application/octet-stream').trim().toLowerCase(); if (!/^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/.test(mime)) throw new CaptureError('INVALID_ARGUMENT', 'File MIME type is invalid'); return mime.slice(0, 200); }
function safeDataClass(value: unknown): CaptureDataClass { if (value === 'PUBLIC' || value === 'USER_EXPLICIT' || value === 'PRIVATE' || value === 'SECRET') return value; throw new CaptureError('INVALID_ARGUMENT', 'Capture data class is invalid'); }
function safePageRevision(value: unknown): number | undefined { if (value === undefined) return undefined; if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 1_000_000_000_000) throw new CaptureError('INVALID_ARGUMENT', 'Capture page revision is invalid'); return value as number; }
function safePageNumber(value: unknown): number | undefined { if (value === undefined) return undefined; if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 1_000_000) throw new CaptureError('INVALID_ARGUMENT', 'Capture page number is invalid'); return value as number; }
function safeUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > CAPTURE_MAX_URL_LENGTH || /[\u0000-\u0020]/.test(value)) throw new CaptureError('UNSAFE_INPUT', 'URL is invalid');
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new CaptureError('UNSAFE_INPUT', 'URL is invalid'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new CaptureError('UNSAFE_INPUT', 'Only credential-free HTTP(S) URLs can enter Capture');
  return parsed.toString();
}
function safeReference(value: CaptureReference): CaptureReference {
  if (!value || !safeId(value.type) || !safeId(value.id) || !['PUBLIC', 'USER_EXPLICIT', 'PRIVATE', 'SECRET'].includes(value.dataClass)) throw new CaptureError('INVALID_ARGUMENT', 'Typed Capture reference is invalid');
  for (const candidate of [value.label, value.revision, value.locator, value.ownerId]) if (candidate !== undefined && !safeId(candidate)) throw new CaptureError('INVALID_ARGUMENT', 'Capture reference metadata is invalid');
  if (value.locator && /^(javascript|data|file|shell|intent):/i.test(value.locator)) throw new CaptureError('UNSAFE_INPUT', 'Unsafe reference locator');
  return clone({ ...value, ...(value.label ? { label: value.label.slice(0, 240) } : {}) });
}
function safeSource(value: CaptureSource | undefined, fallback: CaptureSourceKind): CaptureSource {
  const source = value ?? { kind: fallback };
  if (!source || !['MANUAL', 'CLIPBOARD', 'BROWSER_PAGE', 'BROWSER_SELECTION', 'FILE_DROP', 'FOLDER_DROP', 'OS_SHARE', 'PHOTO', 'DOCUMENT_SELECTION', 'MAIL_REFERENCE', 'MESSAGE_REFERENCE', 'CONTACT', 'PLACE', 'ROUTE', 'CALENDAR_EVENT', 'TASK_REFERENCE', 'WORKBOARD_REFERENCE', 'NEARBY', 'CONTINUITY', 'KEYSTONE_DEEP_LINK', 'KEYSTONE_OBJECT'].includes(source.kind)) throw new CaptureError('INVALID_ARGUMENT', 'Capture source is invalid');
  return { kind: source.kind, ...(source.ref ? { ref: safeReference(source.ref) } : {}), ...(source.label ? { label: boundedText(source.label, 240) } : {}), ...(source.application ? { application: boundedText(source.application, 120) } : {}) };
}
function cleanHtml(value: string, max: number): string {
  return boundedText(value.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' '), max);
}
function payloadKey(payload: CapturePayload): string {
  if (payload.kind === 'TEXT') return `text:${payload.text}`;
  if (payload.kind === 'URL') return `url:${payload.url}`;
  if (payload.kind === 'REFERENCE') return `ref:${payload.reference.type}:${payload.reference.id}:${payload.reference.revision ?? ''}`;
  if (payload.kind === 'CONTACT_CARD') return `contact:${payload.vCard}`;
  if (payload.kind === 'BROWSER_PAGE') return `page:${payload.url}:${payload.pageRevision ?? ''}`;
  if (payload.kind === 'BROWSER_SELECTION') return `selection:${payload.url ?? ''}:${payload.selectedText}`;
  if (payload.kind === 'MULTI') return `multi:${payload.items.map(payloadKey).join('|')}`;
  return `file:${payload.kind}:${payload.file.contentId ?? payload.file.id}:${payload.file.size}`;
}
function titleFor(payload: CapturePayload): string {
  if (payload.kind === 'TEXT') return payload.text.split(/\r?\n/)[0]!.slice(0, 120) || 'Captured text';
  if (payload.kind === 'URL') return payload.title?.trim().slice(0, 120) || new URL(payload.url).hostname;
  if (payload.kind === 'REFERENCE') return payload.reference.label?.slice(0, 120) || `${payload.reference.type} · ${payload.reference.id}`;
  if (payload.kind === 'CONTACT_CARD') return 'Contact card';
  if (payload.kind === 'BROWSER_PAGE') return payload.title.slice(0, 120) || new URL(payload.url).hostname;
  if (payload.kind === 'BROWSER_SELECTION') return payload.selectedText.split(/\r?\n/)[0]!.slice(0, 120) || 'Browser selection';
  if (payload.kind === 'MULTI') return `${payload.items.length} captured items`;
  return payload.file.name.slice(0, 120);
}
function pageOffset(cursor: string | undefined): number { if (!cursor) return 0; const value = Number.parseInt(cursor, 10); return Number.isSafeInteger(value) && value >= 0 ? value : 0; }
function resultReference(value: unknown): CaptureReference {
  if (!value || typeof value !== 'object') throw new CaptureError('INVALID_ARGUMENT', 'Destination returned an invalid reference');
  const candidate = value as Partial<CaptureReference>;
  return safeReference({ type: String(candidate.type ?? ''), id: String(candidate.id ?? ''), ...(candidate.label ? { label: String(candidate.label) } : {}), ...(candidate.revision ? { revision: String(candidate.revision) } : {}), ...(candidate.locator ? { locator: String(candidate.locator) } : {}), dataClass: candidate.dataClass as CaptureDataClass, ...(candidate.ownerId ? { ownerId: String(candidate.ownerId) } : {}) });
}

export class CaptureService {
  private readonly stateStore: CaptureStateStore;
  private readonly destinations: CaptureDestinationRegistry;
  private readonly clipboard?: CaptureClipboardBoundary;
  private readonly browser?: CaptureBrowserBoundary;
  private readonly continuity?: CaptureContinuityAdapter;
  private readonly sync?: CaptureSyncAdapter;
  private readonly ownerIdentityId: string;
  private readonly deviceId: string;
  private readonly now: () => number;
  private readonly maxItems: number;
  private readonly maxTextBytes: number;
  private readonly maxFileBytes: number;
  private readonly items = new Map<CaptureItemId, CaptureItem>();
  private readonly operations = new Map<string, CaptureOperationRecord>();
  private readonly fingerprintIndex = new Map<string, CaptureItemId>();
  private readonly fileHandles = new Map<string, CaptureFileHandle>();
  private readonly listeners = new Set<Listener>();
  private batchDepth = 0;
  private batchDirty = false;
  private writes: Promise<void> = Promise.resolve();
  private persistence: CaptureDiagnostics['persistence'] = 'PENDING';
  private readonly readyPromise: Promise<void>;

  constructor(options: CaptureServiceOptions = {}) {
    this.stateStore = options.state ?? new InMemoryCaptureStateStore();
    this.destinations = options.destinations ?? new InMemoryCaptureDestinationRegistry();
    this.clipboard = options.clipboard; this.browser = options.browser; this.continuity = options.continuity; this.sync = options.sync;
    this.ownerIdentityId = options.ownerIdentityId ?? 'local-owner'; this.deviceId = options.deviceId ?? 'local-device'; this.now = options.now ?? Date.now;
    this.maxItems = Math.max(1, Math.min(CAPTURE_MAX_ITEMS, options.maxItems ?? CAPTURE_MAX_ITEMS)); this.maxTextBytes = Math.max(1_024, Math.min(CAPTURE_MAX_TEXT_BYTES, options.maxTextBytes ?? CAPTURE_MAX_TEXT_BYTES)); this.maxFileBytes = Math.max(1, Math.min(CAPTURE_MAX_FILE_BYTES, options.maxFileBytes ?? CAPTURE_MAX_FILE_BYTES));
    this.readyPromise = this.hydrate();
  }

  async ready(): Promise<void> { await this.readyPromise; }
  subscribe(listener: Listener): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  diagnostics(): CaptureDiagnostics { let activeItems = 0; let routedItems = 0; let failedItems = 0; for (const item of this.items.values()) { if (item.state !== 'DISMISSED') activeItems++; if (item.state === 'ROUTED') routedItems++; if (item.state === 'FAILED') failedItems++; } return { items: this.items.size, activeItems, routedItems, failedItems, transientHandles: this.fileHandles.size, listeners: this.listeners.size, timers: 0, persistence: this.persistence }; }

  async captureText(input: CaptureTextInput | string): Promise<CaptureItem> {
    const value = typeof input === 'string' ? { text: input } : input; const text = boundedText(value.text, this.maxTextBytes, true);
    return this.capturePayload({ kind: 'TEXT', text }, { source: safeSource(value.source, 'MANUAL'), title: value.title, dataClass: safeDataClass(value.dataClass ?? value.source?.ref?.dataClass ?? 'USER_EXPLICIT'), state: value.state });
  }

  async captureUrl(url: string, options: Omit<CaptureTextInput, 'text'> & { readonly title?: string } = {}): Promise<CaptureItem> {
    const normalized = safeUrl(url); return this.capturePayload({ kind: 'URL', url: normalized, ...(options.title ? { title: boundedText(options.title, 240) } : {}) }, { source: safeSource(options.source, 'MANUAL'), title: options.title, dataClass: safeDataClass(options.dataClass ?? options.source?.ref?.dataClass ?? 'USER_EXPLICIT') });
  }

  async captureClipboard(request: { readonly ownerConfirmed: true; readonly boundary?: CaptureClipboardBoundary; readonly maxBytes?: number; readonly signal?: AbortSignal } ): Promise<CaptureItem> {
    if (request.ownerConfirmed !== true) throw new CaptureError('POLICY_DENIED', 'Clipboard capture requires explicit owner confirmation');
    const boundary = request.boundary ?? this.clipboard; if (!boundary) throw new CaptureError('UNAVAILABLE', 'Explicit clipboard boundary is not connected');
    const maxBytes = Math.max(1_024, Math.min(this.maxTextBytes, request.maxBytes ?? this.maxTextBytes)); const value = await boundary.read({ maxBytes, signal: request.signal }); if (!value) throw new CaptureError('NOT_FOUND', 'Clipboard is empty');
    const text = value.text?.trim() || (value.html ? cleanHtml(value.html, maxBytes) : ''); if (!text) throw new CaptureError('INVALID_ARGUMENT', 'Clipboard does not contain bounded text');
    const source: CaptureSource = { kind: 'CLIPBOARD', label: value.mimeType ? `Clipboard · ${value.mimeType}` : 'Clipboard' };
    return /^https?:\/\//i.test(text) ? this.capturePayload({ kind: 'URL', url: safeUrl(text) }, { source, dataClass: 'USER_EXPLICIT' }) : this.capturePayload({ kind: 'TEXT', text: boundedText(text, maxBytes, true) }, { source, dataClass: 'USER_EXPLICIT' });
  }

  async captureFile(input: CaptureFileInput): Promise<CaptureItem> {
    const name = boundedText(input.name, 512, true); const mimeType = safeMime(input.mimeType); let size = input.size ?? input.bytes?.byteLength;
    if (size !== undefined && (!Number.isSafeInteger(size) || size < 0 || size > this.maxFileBytes)) throw new CaptureError('RESOURCE_LIMIT', 'Capture file exceeds the bounded size limit');
    const fileId = id('capture-file'); const handle = input.handle ?? (input.read ? { read: input.read } : input.bytes ? { read: async () => input.bytes!.slice() } : undefined);
    if (!handle && size === undefined) throw new CaptureError('INVALID_ARGUMENT', 'Capture file requires an opaque handle, reader or bounded size');
    if (handle) this.fileHandles.set(fileId, handle); if (size === undefined && input.bytes) size = input.bytes.byteLength; size = size ?? 0;
    const file: CaptureFileRef = { id: fileId, name, mimeType, size, ...(input.modifiedAt ? { modifiedAt: boundedText(input.modifiedAt, 80) } : {}), ...(input.contentId ? { contentId: boundedText(input.contentId, 512) } : {}), handleState: handle ? 'AVAILABLE' : 'METADATA_ONLY' };
    const page = input.page === undefined ? undefined : safePageNumber(input.page);
    const payload: CapturePayload = input.document ? { kind: 'DOCUMENT', file, ...(page !== undefined ? { page } : {}), ...(input.selectedText ? { selectedText: boundedText(input.selectedText, this.maxTextBytes) } : {}) } : input.image || mimeType.startsWith('image/') ? { kind: 'IMAGE', file } : { kind: 'FILE', file };
    return this.capturePayload(payload, { source: safeSource(input.source, input.document ? 'DOCUMENT_SELECTION' : input.image || mimeType.startsWith('image/') ? 'PHOTO' : 'FILE_DROP'), title: input.title, dataClass: safeDataClass(input.dataClass ?? 'USER_EXPLICIT') });
  }

  async captureReference(input: CaptureReferenceInput): Promise<CaptureItem> { const reference = safeReference(input.reference); return this.capturePayload({ kind: 'REFERENCE', reference }, { source: safeSource(input.source, 'KEYSTONE_OBJECT'), title: input.title ?? reference.label, dataClass: reference.dataClass }); }

  async captureBrowserPage(request: { readonly ownerConfirmed: true; readonly page?: CaptureBrowserPage; readonly boundary?: CaptureBrowserBoundary; readonly signal?: AbortSignal }): Promise<CaptureItem> {
    if (request.ownerConfirmed !== true) throw new CaptureError('POLICY_DENIED', 'Browser capture requires explicit owner confirmation'); const page = request.page ?? await (request.boundary ?? this.browser)?.currentPage({ signal: request.signal }); if (!page) throw new CaptureError('UNAVAILABLE', 'Browser page boundary is unavailable');
    const url = safeUrl(page.url); const title = boundedText(page.title, 240, true); const excerpt = page.excerpt ? boundedText(page.excerpt, CAPTURE_MAX_PAGE_EXCERPT_BYTES) : undefined; const pageRevision = safePageRevision(page.pageRevision);
    return this.capturePayload({ kind: 'BROWSER_PAGE', url, title, ...(excerpt ? { excerpt } : {}), ...(pageRevision !== undefined ? { pageRevision } : {}) }, { source: { kind: 'BROWSER_PAGE', label: title }, dataClass: safeDataClass(page.dataClass ?? 'USER_EXPLICIT'), title });
  }

  async captureBrowserSelection(request: { readonly ownerConfirmed: true; readonly selection?: CaptureBrowserSelection; readonly boundary?: CaptureBrowserBoundary; readonly signal?: AbortSignal }): Promise<CaptureItem> {
    if (request.ownerConfirmed !== true) throw new CaptureError('POLICY_DENIED', 'Browser selection capture requires explicit owner confirmation'); const selection = request.selection ?? await (request.boundary ?? this.browser)?.selection({ signal: request.signal }); if (!selection) throw new CaptureError('NOT_FOUND', 'No browser selection is available');
    const selectedText = boundedText(selection.selectedText, this.maxTextBytes, true); const url = selection.url ? safeUrl(selection.url) : undefined; const pageRevision = safePageRevision(selection.pageRevision); return this.capturePayload({ kind: 'BROWSER_SELECTION', selectedText, ...(url ? { url } : {}), ...(selection.title ? { title: boundedText(selection.title, 240) } : {}), ...(pageRevision !== undefined ? { pageRevision } : {}) }, { source: { kind: 'BROWSER_SELECTION', label: selection.title?.slice(0, 240) }, dataClass: safeDataClass(selection.dataClass ?? 'USER_EXPLICIT'), title: selection.title });
  }

  async captureShareIn(input: CaptureShareInInput): Promise<CaptureItem> {
    if (input.accepted !== true) throw new CaptureError('POLICY_DENIED', 'Share-In must be explicitly accepted before entering the private tray'); const payload = this.validatePayload(input.payload); return this.capturePayload(payload, { source: safeSource(input.source, 'OS_SHARE'), title: input.title, dataClass: safeDataClass(input.dataClass ?? 'USER_EXPLICIT') });
  }

  async captureDeepLink(link: string): Promise<CaptureItem> {
    const proposal = parseCaptureDeepLink(link); if (proposal.text !== undefined) return this.captureText({ text: proposal.text, source: { kind: 'KEYSTONE_DEEP_LINK' }, title: proposal.title }); if (proposal.url) return this.captureUrl(proposal.url, { source: { kind: 'KEYSTONE_DEEP_LINK' }, title: proposal.title }); if (proposal.reference) return this.captureReference({ reference: proposal.reference, source: { kind: 'KEYSTONE_DEEP_LINK' }, title: proposal.title }); throw new CaptureError('INVALID_ARGUMENT', 'Capture deep link contains no safe proposal');
  }

  async captureBulk(inputs: readonly CaptureBulkInput[]): Promise<readonly CaptureItem[]> {
    if (!Array.isArray(inputs) || inputs.length > CAPTURE_MAX_BULK_ITEMS) throw new CaptureError('RESOURCE_LIMIT', 'Capture bulk input exceeds the bounded item limit'); const result: CaptureItem[] = [];
    this.batchDepth++;
    try {
      for (const input of inputs) { if (input.kind === 'TEXT') result.push(await this.captureText(input)); else if (input.kind === 'URL') result.push(await this.captureUrl(input.url, input)); else if (input.kind === 'REFERENCE') result.push(await this.captureReference(input)); else result.push(await this.captureFile(input)); }
      return result;
    } finally {
      this.batchDepth--;
      if (this.batchDepth === 0 && this.batchDirty) { this.batchDirty = false; await this.persist(); }
    }
  }

  async get(idValue: CaptureItemId | string): Promise<CaptureItem | undefined> { await this.ready(); const item = this.items.get(idValue as CaptureItemId); return item ? clone(item) : undefined; }
  async list(query: CaptureListQuery = {}): Promise<CapturePage> {
    await this.ready(); const rawNeedle = query.query?.trim(); const needle = rawNeedle ? boundedText(rawNeedle, 1_024).toLocaleLowerCase() : undefined; const all = [...this.items.values()].filter(item => (!query.state || item.state === query.state) && (!query.source || item.provenance.source.kind === query.source) && (!needle || `${item.title} ${this.searchText(item.payload)} ${item.provenance.source.label ?? ''}`.toLocaleLowerCase().includes(needle))).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id)); const start = pageOffset(query.cursor); const limit = Math.max(1, Math.min(200, query.limit ?? 50)); const items = all.slice(start, start + limit).map(clone); return { items, total: all.length, ...(start + items.length < all.length ? { nextCursor: String(start + items.length) } : {}) };
  }
  async search(query: string, options: Omit<CaptureListQuery, 'query'> = {}): Promise<CapturePage> { return this.list({ ...options, query }); }

  async updateDraft(idValue: CaptureItemId | string, patch: { readonly text?: string; readonly title?: string }): Promise<CaptureItem> {
    await this.ready(); const item = this.require(idValue); if (!['DRAFT', 'READY', 'FAILED'].includes(item.state)) throw new CaptureError('CONFLICT', 'Only an editable Capture draft can be changed'); const payload = patch.text === undefined ? item.payload : item.payload.kind === 'TEXT' ? { kind: 'TEXT' as const, text: boundedText(patch.text, this.maxTextBytes, true) } : item.payload.kind === 'BROWSER_SELECTION' ? { ...item.payload, selectedText: boundedText(patch.text, this.maxTextBytes, true) } : item.payload;
    const next: CaptureItem = { ...item, payload, title: patch.title === undefined ? titleFor(payload) : boundedText(patch.title, 240, true), state: 'READY', updatedAt: iso(this.now), failure: undefined }; this.items.set(item.id, next); await this.persist(); this.emit({ type: 'UPDATED', itemId: item.id }); return clone(next);
  }
  async dismiss(idValue: CaptureItemId | string): Promise<CaptureItem> { await this.ready(); const item = this.require(idValue); const next: CaptureItem = { ...item, state: 'DISMISSED', dismissedAt: iso(this.now), updatedAt: iso(this.now) }; this.items.set(item.id, next); this.fingerprintIndex.delete(item.fingerprint); await this.persist(); this.emit({ type: 'DISMISSED', itemId: item.id }); return clone(next); }
  async restore(idValue: CaptureItemId | string): Promise<CaptureItem> { await this.ready(); const item = this.require(idValue); if (item.state !== 'DISMISSED') return clone(item); const next: CaptureItem = { ...item, state: 'READY', dismissedAt: undefined, updatedAt: iso(this.now) }; this.items.set(item.id, next); this.fingerprintIndex.set(next.fingerprint, next.id); await this.persist(); this.emit({ type: 'RESTORED', itemId: item.id }); return clone(next); }
  async delete(idValue: CaptureItemId | string, ownerConfirmed: true): Promise<void> { await this.ready(); if (ownerConfirmed !== true) throw new CaptureError('POLICY_DENIED', 'Deleting Capture history requires owner confirmation'); const item = this.require(idValue); this.items.delete(item.id); this.fingerprintIndex.delete(item.fingerprint); for (const file of this.payloadFiles(item.payload)) { const handle = this.fileHandles.get(file.id); this.fileHandles.delete(file.id); await handle?.close?.(); } for (const [key, operation] of this.operations) if (operation.itemId === item.id) this.operations.delete(key); await this.persist(); this.emit({ type: 'DELETED', itemId: item.id }); }
  async cleanup(before: string, ownerConfirmed: true): Promise<number> { await this.ready(); if (ownerConfirmed !== true || !Number.isFinite(Date.parse(before))) throw new CaptureError('POLICY_DENIED', 'Capture cleanup requires owner confirmation and a valid cutoff'); const candidates = [...this.items.values()].filter(item => item.state === 'DISMISSED' && item.updatedAt < before); for (const item of candidates) await this.delete(item.id, true); return candidates.length; }
  async clearHistory(ownerConfirmed: true): Promise<number> { return this.cleanup('9999-12-31T23:59:59.999Z', ownerConfirmed); }

  suggestions(idValue: CaptureItemId | string): readonly CaptureSuggestion[] { const item = this.items.get(idValue as CaptureItemId); if (!item) throw new CaptureError('NOT_FOUND', 'Capture item not found'); return suggestPayload(item.payload); }
  async suggest(idValue: CaptureItemId | string): Promise<readonly CaptureSuggestion[]> { await this.ready(); return this.suggestions(idValue); }
  async previewRoute(idValue: CaptureItemId | string, destination: CaptureDestinationKind): Promise<CaptureDestinationPreview> { await this.ready(); const item = this.require(idValue); const adapter = this.destinations.get(destination); if (!adapter) throw new CaptureError('UNAVAILABLE', `No ${destination} destination adapter is connected`); if (adapter.supports && !(await adapter.supports(item))) throw new CaptureError('INVALID_ARGUMENT', `Destination ${destination} does not support this Capture payload`); return clone(await adapter.preview({ item: clone(item) })); }
  async route(idValue: CaptureItemId | string, destination: CaptureDestinationKind, request: { readonly ownerConfirmed: true; readonly operationId?: CaptureOperationId }): Promise<CaptureDestinationResult> {
    await this.ready(); if (request.ownerConfirmed !== true) throw new CaptureError('POLICY_DENIED', 'Routing requires explicit owner confirmation'); const item = this.require(idValue); const adapter = this.destinations.get(destination); if (!adapter) throw new CaptureError('UNAVAILABLE', `No ${destination} destination adapter is connected`); if (adapter.supports && !(await adapter.supports(item))) throw new CaptureError('INVALID_ARGUMENT', `Destination ${destination} does not support this Capture payload`);
    const key = `${item.id}:${destination}`; const old = this.operations.get(key); if (old?.status === 'COMPLETED' && old.result) return clone(old.result); if (old?.status === 'PROCESSING') throw new CaptureError('CONFLICT', 'Capture routing is already in progress'); const operationId = request.operationId ?? (`capture-op:${key.replace(/[^A-Za-z0-9:_-]/g, '-')}` as CaptureOperationId); const processing: CaptureOperationRecord = { version: 1, operationId, itemId: item.id, destination, status: 'PROCESSING', idempotencyKey: key, updatedAt: iso(this.now) }; this.operations.set(key, processing); this.items.set(item.id, { ...item, state: 'PROCESSING', updatedAt: processing.updatedAt, failure: undefined }); await this.persist();
    try {
      const result = await adapter.execute({ item: clone(item), operationId, idempotencyKey: key, ownerConfirmed: true, readFile: (fileId, signal) => this.readFile(fileId, signal) }); const normalized: CaptureDestinationResult = { reference: resultReference(result.reference), ...(result.created !== undefined ? { created: result.created } : {}), ...(result.details ? { details: boundedText(result.details, 2_000) } : {}) }; const completed: CaptureOperationRecord = { ...processing, status: 'COMPLETED', result: normalized, updatedAt: iso(this.now) }; this.operations.set(key, completed); const routed: CaptureItem = { ...this.require(item.id), state: 'ROUTED', routedAt: completed.updatedAt, updatedAt: completed.updatedAt, resultRefs: [...this.require(item.id).resultRefs, normalized.reference] }; this.items.set(item.id, routed); await this.persist(); this.emit({ type: 'ROUTED', itemId: item.id }); return clone(normalized);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error); const failed: CaptureOperationRecord = { ...processing, status: 'FAILED', error: message.slice(0, CAPTURE_MAX_ERROR_BYTES), updatedAt: iso(this.now) }; this.operations.set(key, failed); this.items.set(item.id, { ...this.require(item.id), state: 'FAILED', updatedAt: failed.updatedAt, failure: { code: error instanceof CaptureError ? error.code : 'DESTINATION_FAILED', message: failed.error!, at: failed.updatedAt } }); await this.persist(); throw error;
    }
  }
  async undoRoute(idValue: CaptureItemId | string, destination: CaptureDestinationKind, ownerConfirmed: true): Promise<CaptureItem> { await this.ready(); if (ownerConfirmed !== true) throw new CaptureError('POLICY_DENIED', 'Undo requires explicit owner confirmation'); const item = this.require(idValue); const operation = this.operations.get(`${item.id}:${destination}`); const adapter = this.destinations.get(destination); if (!operation?.result || operation.status !== 'COMPLETED' || !adapter?.undo) throw new CaptureError('UNAVAILABLE', 'This destination does not expose a reversible route'); await adapter.undo({ item: clone(item), operationId: operation.operationId, result: clone(operation.result), ownerConfirmed: true }); const next: CaptureItem = { ...item, state: 'READY', routedAt: undefined, updatedAt: iso(this.now), resultRefs: item.resultRefs.filter(ref => ref.id !== operation.result!.reference.id) }; this.items.set(item.id, next); this.operations.delete(`${item.id}:${destination}`); await this.persist(); this.emit({ type: 'UPDATED', itemId: item.id }); return clone(next); }

  async continueOnDevice(idValue: CaptureItemId | string, targetDeviceId: string): Promise<{ readonly receiptId: string; readonly status: 'QUEUED' | 'DELIVERED' | 'OFFLINE' }> { await this.ready(); if (!this.continuity) throw new CaptureError('UNAVAILABLE', 'Continuity adapter is not connected'); const item = this.require(idValue); if (!safeId(targetDeviceId)) throw new CaptureError('INVALID_ARGUMENT', 'Target device is invalid'); return this.continuity.send({ captureId: item.id, draft: clone({ ...item, payload: this.stripTransientPayload(item.payload) }), targetDeviceId }); }
  async exportPrivateSync(): Promise<CaptureSyncEnvelope> { await this.ready(); return { version: 1, protocol: CAPTURE_PROTOCOL, ownerIdentityId: this.ownerIdentityId, sourceDeviceId: this.deviceId, createdAt: iso(this.now), items: [...this.items.values()].map(item => clone({ ...item, payload: this.stripTransientPayload(item.payload) })) }; }
  async publishPrivateSync(): Promise<void> { if (!this.sync?.publish) throw new CaptureError('UNAVAILABLE', 'Capture sync adapter is not connected'); await this.sync.publish(await this.exportPrivateSync()); }
  async mergePrivateSync(envelope: unknown): Promise<number> {
    await this.ready(); if (!envelope || typeof envelope !== 'object') throw new CaptureError('INVALID_ARGUMENT', 'Capture sync envelope is invalid'); const value = envelope as Partial<CaptureSyncEnvelope>; if (value.version !== 1 || value.protocol !== CAPTURE_PROTOCOL || value.ownerIdentityId !== this.ownerIdentityId || !safeId(value.sourceDeviceId) || (value.recipientDeviceId && value.recipientDeviceId !== this.deviceId) || !Array.isArray(value.items)) throw new CaptureError('POLICY_DENIED', 'Capture sync envelope is not for this owner/device'); if (this.sync?.trustedDeviceIds && !this.sync.trustedDeviceIds.includes(value.sourceDeviceId)) throw new CaptureError('POLICY_DENIED', 'Capture sync source device is not trusted'); let merged = 0;
    for (const candidate of value.items.slice(0, this.maxItems)) { const item = this.safePersistedItem(candidate); if (!item) continue; const current = this.items.get(item.id); if (!current || item.updatedAt > current.updatedAt) { this.items.set(item.id, item); if (item.state !== 'DISMISSED') this.fingerprintIndex.set(item.fingerprint, item.id); merged++; } }
    if (merged) { await this.persist(); this.emit({ type: 'UPDATED' }); } return merged;
  }

  private async capturePayload(payload: CapturePayload, metadata: { readonly source: CaptureSource; readonly title?: string; readonly dataClass: CaptureDataClass; readonly state?: Extract<CaptureState, 'DRAFT' | 'READY'> }): Promise<CaptureItem> {
    await this.ready(); if (this.fingerprintIndex.size < this.items.size) for (const item of this.items.values()) if (item.state !== 'DISMISSED') this.fingerprintIndex.set(item.fingerprint, item.id); const normalized = this.validatePayload(payload); const fingerprint = payloadKey(normalized); const duplicateId = this.fingerprintIndex.get(fingerprint); const duplicate = duplicateId ? this.items.get(duplicateId) : undefined; if (duplicate && duplicate.state !== 'DISMISSED') { const updated: CaptureItem = { ...duplicate, duplicateCount: (duplicate.duplicateCount ?? 1) + 1, updatedAt: iso(this.now) }; this.items.set(duplicate.id, updated); if (this.batchDepth > 0) this.batchDirty = true; else await this.persist(); return clone(updated); }
    if (this.items.size >= this.maxItems) throw new CaptureError('RESOURCE_LIMIT', 'Capture Tray item limit reached'); if (metadata.state !== undefined && metadata.state !== 'DRAFT' && metadata.state !== 'READY') throw new CaptureError('INVALID_ARGUMENT', 'Capture state is invalid'); const createdAt = iso(this.now); const item: CaptureItem = { version: 1, id: id('capture') as CaptureItemId, state: metadata.state ?? 'READY', title: metadata.title ? boundedText(metadata.title, 240, true) : titleFor(normalized), payload: normalized, provenance: { source: metadata.source, capturedAt: createdAt, ...(metadata.source.ref?.revision ? { sourceRevision: metadata.source.ref.revision } : {}), dataClass: safeDataClass(metadata.dataClass), userInitiated: true }, fingerprint, createdAt, updatedAt: createdAt, resultRefs: [] }; this.items.set(item.id, item); if (item.state !== 'DISMISSED') this.fingerprintIndex.set(item.fingerprint, item.id); if (this.batchDepth > 0) this.batchDirty = true; else await this.persist(); this.emit({ type: 'CAPTURED', itemId: item.id }); return clone(item);
  }
  private validatePayload(payload: CapturePayload): CapturePayload {
    if (!payload || typeof payload !== 'object') throw new CaptureError('INVALID_ARGUMENT', 'Capture payload is invalid');
    if (payload.kind === 'TEXT') return { kind: 'TEXT', text: boundedText(payload.text, this.maxTextBytes, true) };
    if (payload.kind === 'URL') return { kind: 'URL', url: safeUrl(payload.url), ...(payload.title ? { title: boundedText(payload.title, 240) } : {}) };
    if (payload.kind === 'REFERENCE') return { kind: 'REFERENCE', reference: safeReference(payload.reference) };
    if (payload.kind === 'CONTACT_CARD') return { kind: 'CONTACT_CARD', vCard: boundedText(payload.vCard, CAPTURE_MAX_REFERENCE_BYTES, true) };
    if (payload.kind === 'BROWSER_PAGE') return { kind: 'BROWSER_PAGE', url: safeUrl(payload.url), title: boundedText(payload.title, 240, true), ...(payload.excerpt ? { excerpt: boundedText(payload.excerpt, CAPTURE_MAX_PAGE_EXCERPT_BYTES) } : {}), ...(payload.pageRevision !== undefined ? { pageRevision: payload.pageRevision } : {}) };
    if (payload.kind === 'BROWSER_SELECTION') return { kind: 'BROWSER_SELECTION', selectedText: boundedText(payload.selectedText, this.maxTextBytes, true), ...(payload.url ? { url: safeUrl(payload.url) } : {}), ...(payload.title ? { title: boundedText(payload.title, 240) } : {}), ...(payload.pageRevision !== undefined ? { pageRevision: payload.pageRevision } : {}) };
    if (payload.kind === 'MULTI') { if (payload.items.length === 0 || payload.items.length > CAPTURE_MAX_BULK_ITEMS) throw new CaptureError('RESOURCE_LIMIT', 'Multi-capture bound exceeded'); return { kind: 'MULTI', items: payload.items.map(item => this.validatePayload(item) as CaptureAtomicPayload) }; }
    if (payload.kind === 'IMAGE' || payload.kind === 'FILE' || payload.kind === 'DOCUMENT') return { ...payload, file: this.validateFileRef(payload.file), ...(payload.kind === 'DOCUMENT' && payload.selectedText ? { selectedText: boundedText(payload.selectedText, this.maxTextBytes) } : {}) };
    throw new CaptureError('INVALID_ARGUMENT', 'Unknown Capture payload kind');
  }
  private validateFileRef(file: CaptureFileRef): CaptureFileRef { if (!file || !safeId(file.id) || !safeId(file.name) || !safeMime(file.mimeType) || !Number.isSafeInteger(file.size) || file.size < 0 || file.size > this.maxFileBytes || !['AVAILABLE', 'METADATA_ONLY', 'MISSING'].includes(file.handleState)) throw new CaptureError('INVALID_ARGUMENT', 'Capture file reference is invalid'); return clone(file); }
  private searchText(payload: CapturePayload): string { if (payload.kind === 'TEXT') return payload.text; if (payload.kind === 'URL') return `${payload.url} ${payload.title ?? ''}`; if (payload.kind === 'REFERENCE') return `${payload.reference.type} ${payload.reference.id} ${payload.reference.label ?? ''}`; if (payload.kind === 'CONTACT_CARD') return payload.vCard; if (payload.kind === 'BROWSER_PAGE') return `${payload.url} ${payload.title} ${payload.excerpt ?? ''}`; if (payload.kind === 'BROWSER_SELECTION') return `${payload.selectedText} ${payload.url ?? ''} ${payload.title ?? ''}`; if (payload.kind === 'MULTI') return payload.items.map(item => this.searchText(item)).join(' '); return `${payload.file.name} ${payload.file.mimeType}`; }
  private payloadFiles(payload: CapturePayload): readonly CaptureFileRef[] { if (payload.kind === 'IMAGE' || payload.kind === 'FILE' || payload.kind === 'DOCUMENT') return [payload.file]; if (payload.kind === 'MULTI') return payload.items.flatMap(item => this.payloadFiles(item)); return []; }
  private stripTransientPayload(payload: CapturePayload): CapturePayload { if (payload.kind === 'MULTI') return { kind: 'MULTI', items: payload.items.map(item => this.stripTransientPayload(item) as CaptureAtomicPayload) }; if (payload.kind === 'IMAGE' || payload.kind === 'FILE' || payload.kind === 'DOCUMENT') return { ...payload, file: { ...payload.file, handleState: payload.file.contentId ? 'METADATA_ONLY' : 'MISSING' } }; return clone(payload); }
  private async readFile(fileId: string, signal?: AbortSignal): Promise<Uint8Array> { const handle = this.fileHandles.get(fileId); if (!handle) throw new CaptureError('UNAVAILABLE', 'Capture file handle is no longer available'); const value = await handle.read(signal); if (!(value instanceof Uint8Array) || value.byteLength > this.maxFileBytes) throw new CaptureError('RESOURCE_LIMIT', 'Capture file reader exceeded the bounded limit'); return value; }
  private require(idValue: CaptureItemId | string): CaptureItem { const item = this.items.get(idValue as CaptureItemId); if (!item) throw new CaptureError('NOT_FOUND', 'Capture item not found'); return item; }
  private emit(event: Parameters<Listener>[0]): void { for (const listener of this.listeners) { try { listener(event); } catch { /* listeners cannot break Capture state */ } } }
  private async persist(): Promise<void> { this.persistence = 'PENDING'; const state: PersistedCaptureState = { version: 1, items: Object.fromEntries(this.items), operations: Object.fromEntries(this.operations) }; const operation = this.writes.then(() => this.stateStore.write(clone(state))); this.writes = operation.then(() => undefined, () => undefined); try { await operation; this.persistence = 'READY'; } catch { this.persistence = 'FAILED'; throw new CaptureError('UNAVAILABLE', 'Capture state could not be persisted'); } }
  private async hydrate(): Promise<void> {
    try {
      const value = await this.stateStore.read();
      if (!value || typeof value !== 'object' || (value as { version?: unknown }).version !== 1) { this.persistence = 'READY'; return; }
      const state = value as Partial<PersistedCaptureState>;
      for (const [key, candidate] of Object.entries(state.items ?? {}).slice(0, this.maxItems)) {
        const parsed = this.safePersistedItem(candidate); if (parsed && parsed.id === key) this.items.set(parsed.id, parsed);
      }
      for (const [key, candidate] of Object.entries(state.operations ?? {}).slice(0, this.maxItems * 2)) {
        if (candidate && typeof candidate === 'object' && candidate.itemId && candidate.destination && candidate.operationId && ['PROCESSING', 'COMPLETED', 'FAILED'].includes(candidate.status as string)) this.operations.set(key, clone(candidate));
      }
      let recovered = false;
      for (const [key, operation] of this.operations) if (operation.status === 'PROCESSING') {
        this.operations.set(key, { ...operation, status: 'FAILED', error: 'Recovered after interrupted routing', updatedAt: iso(this.now) }); recovered = true;
        const item = this.items.get(operation.itemId); if (item?.state === 'PROCESSING') this.items.set(item.id, { ...item, state: 'FAILED', updatedAt: iso(this.now), failure: { code: 'INTERRUPTED', message: 'Routing was interrupted before a durable receipt was recorded', at: iso(this.now) } });
      }
      if (recovered) await this.persist(); else this.persistence = 'READY';
    } catch { this.persistence = 'FAILED'; }
  }
  private safePersistedItem(value: unknown): CaptureItem | undefined { try { if (!value || typeof value !== 'object') return undefined; const candidate = value as Partial<CaptureItem>; if (candidate.version !== 1 || !safeId(candidate.id) || !['DRAFT', 'READY', 'PROCESSING', 'ROUTED', 'FAILED', 'DISMISSED'].includes(candidate.state as string) || !candidate.provenance || !candidate.payload || !safeId(candidate.fingerprint) || typeof candidate.createdAt !== 'string' || typeof candidate.updatedAt !== 'string' || !Array.isArray(candidate.resultRefs)) return undefined; const payload = this.validatePayload(candidate.payload); const provenance = candidate.provenance as CaptureProvenance; const source = safeSource(provenance.source, 'KEYSTONE_OBJECT'); return { version: 1, id: candidate.id as CaptureItemId, state: candidate.state as CaptureState, title: boundedText(candidate.title ?? titleFor(payload), 240, true), payload: this.stripTransientPayload(payload), provenance: { source, capturedAt: boundedText(provenance.capturedAt, 80, true), ...(provenance.sourceRevision ? { sourceRevision: boundedText(provenance.sourceRevision, 512) } : {}), dataClass: ['PUBLIC', 'USER_EXPLICIT', 'PRIVATE', 'SECRET'].includes(provenance.dataClass) ? provenance.dataClass : 'USER_EXPLICIT', userInitiated: true }, fingerprint: boundedText(candidate.fingerprint, 1_024, true), createdAt: boundedText(candidate.createdAt, 80, true), updatedAt: boundedText(candidate.updatedAt, 80, true), ...(candidate.routedAt ? { routedAt: boundedText(candidate.routedAt, 80) } : {}), ...(candidate.dismissedAt ? { dismissedAt: boundedText(candidate.dismissedAt, 80) } : {}), resultRefs: candidate.resultRefs.slice(0, 32).flatMap(ref => { try { return [safeReference(ref)]; } catch { return []; } }), ...(candidate.duplicateCount ? { duplicateCount: Math.min(1_000_000, candidate.duplicateCount) } : {}) }; } catch { return undefined; } }
}

export type CaptureBulkInput = (CaptureTextInput & { readonly kind: 'TEXT' }) | ({ readonly kind: 'URL'; readonly url: string; readonly source?: CaptureSource; readonly title?: string; readonly dataClass?: CaptureDataClass }) | (CaptureReferenceInput & { readonly kind: 'REFERENCE' }) | (CaptureFileInput & { readonly kind: 'FILE' });

function suggestPayload(payload: CapturePayload): readonly CaptureSuggestion[] {
  if (payload.kind === 'URL' || payload.kind === 'BROWSER_PAGE' || payload.kind === 'BROWSER_SELECTION') return [{ destination: 'WEB_LIBRARY', confidence: 'HIGH', reason: 'The capture contains an explicit web page or URL.', requiresOwnerConfirmation: true }, { destination: 'VAULT', confidence: 'MEDIUM', reason: 'Save a bounded link or excerpt as a private Markdown note.', requiresOwnerConfirmation: true }];
  if (payload.kind === 'IMAGE') return [{ destination: 'PHOTOS', confidence: 'HIGH', reason: 'The payload is an image file.', requiresOwnerConfirmation: true }, { destination: 'FILES', confidence: 'MEDIUM', reason: 'Keep the image as a canonical private file.', requiresOwnerConfirmation: true }];
  if (payload.kind === 'DOCUMENT') return [{ destination: 'DOCUMENTS', confidence: 'HIGH', reason: 'The payload is a document or document selection.', requiresOwnerConfirmation: true }, { destination: 'VAULT', confidence: 'LOW', reason: 'Save the selected text as a private note.', requiresOwnerConfirmation: true }];
  if (payload.kind === 'FILE') return [{ destination: 'FILES', confidence: 'HIGH', reason: 'The payload is an explicit file handle.', requiresOwnerConfirmation: true }];
  if (payload.kind === 'CONTACT_CARD') return [{ destination: 'CONTACTS', confidence: 'HIGH', reason: 'The payload is a contact card; importing remains explicit.', requiresOwnerConfirmation: true }];
  if (payload.kind === 'REFERENCE') { if (payload.reference.type.toLowerCase().includes('task')) return [{ destination: 'TASK', confidence: 'HIGH', reason: 'The source is already a typed Task reference.', requiresOwnerConfirmation: true }]; return [{ destination: 'VAULT', confidence: 'LOW', reason: 'Keep the typed reference in a private note.', requiresOwnerConfirmation: true }, { destination: 'TASK', confidence: 'LOW', reason: 'Create a Task only after reviewing the proposed title.', requiresOwnerConfirmation: true }]; }
  if (payload.kind === 'MULTI') return [{ destination: 'FILES', confidence: 'LOW', reason: 'Bulk items require an explicit destination review.', requiresOwnerConfirmation: true }];
  const taskWords = /(^|\s)(todo|task|задача|сделать)(?:\b|:)/i.test(payload.text); return taskWords ? [{ destination: 'TASK', confidence: 'HIGH', reason: 'The text contains an explicit task cue.', requiresOwnerConfirmation: true }, { destination: 'VAULT', confidence: 'LOW', reason: 'Keep the text as a private note instead.', requiresOwnerConfirmation: true }] : [{ destination: 'VAULT', confidence: 'MEDIUM', reason: 'Plain text is safest as a private Markdown note.', requiresOwnerConfirmation: true }, { destination: 'TASK', confidence: 'LOW', reason: 'Review the text before creating a Task.', requiresOwnerConfirmation: true }];
}

export function parseCaptureDeepLink(link: string): CaptureDeepLinkProposal {
  if (typeof link !== 'string' || link.length > 64 * 1024) throw new CaptureError('UNSAFE_INPUT', 'Capture deep link is too large'); let url: URL;
  try { url = new URL(link); } catch { throw new CaptureError('UNSAFE_INPUT', 'Capture deep link is invalid'); }
  if (url.protocol !== 'keystone:' || url.hostname !== 'capture' || url.username || url.password || url.port || !['', '/'].includes(url.pathname)) throw new CaptureError('UNSAFE_INPUT', 'Only keystone://capture is accepted');
  for (const key of url.searchParams.keys()) if (!['text', 'url', 'title', 'type', 'id', 'revision', 'dataClass'].includes(key)) throw new CaptureError('UNSAFE_INPUT', `Unsupported Capture deep-link field: ${key}`);
  if (url.searchParams.has('command') || url.searchParams.has('action') || url.searchParams.has('execute') || url.searchParams.has('destination')) throw new CaptureError('UNSAFE_INPUT', 'Deep-link actions are not executable');
  const title = url.searchParams.get('title') ? boundedText(url.searchParams.get('title'), 240) : undefined; const text = url.searchParams.get('text'); const rawUrl = url.searchParams.get('url'); if (text !== null && rawUrl !== null) throw new CaptureError('INVALID_ARGUMENT', 'Deep link must contain one proposal');
  if (text !== null) return { protocol: CAPTURE_PROTOCOL, text: boundedText(text, CAPTURE_MAX_TEXT_BYTES, true), ...(title ? { title } : {}) }; if (rawUrl !== null) return { protocol: CAPTURE_PROTOCOL, url: safeUrl(rawUrl), ...(title ? { title } : {}) };
  const type = url.searchParams.get('type'); const objectId = url.searchParams.get('id'); if (!type || !objectId) throw new CaptureError('INVALID_ARGUMENT', 'Deep link has no safe capture proposal'); const dataClass = url.searchParams.get('dataClass') as CaptureDataClass | null; const reference = safeReference({ type, id: objectId, ...(url.searchParams.get('revision') ? { revision: url.searchParams.get('revision')! } : {}), dataClass: dataClass && ['PUBLIC', 'USER_EXPLICIT', 'PRIVATE', 'SECRET'].includes(dataClass) ? dataClass : 'USER_EXPLICIT' }); return { protocol: CAPTURE_PROTOCOL, reference, ...(title ? { title } : {}) };
}

export interface CaptureWriterInput { readonly item: CaptureItem; readonly operationId: CaptureOperationId; readonly readFile: (fileId: string, signal?: AbortSignal) => Promise<Uint8Array>; }
export interface CaptureWriterPort { readonly create: (input: CaptureWriterInput) => Promise<CaptureReference>; readonly supports?: (item: CaptureItem) => boolean | Promise<boolean>; readonly undo?: (input: { readonly item: CaptureItem; readonly operationId: CaptureOperationId; readonly result: CaptureDestinationResult }) => Promise<void>; }
function writerAdapter(destinationKind: CaptureDestinationKind, port: CaptureWriterPort): CaptureDestinationAdapter { return { destinationKind, supports: port.supports, preview: ({ item }) => ({ destination: destinationKind, title: `Route to ${destinationKind}`, summary: item.title, disclosure: destinationKind === 'SHARED_FOLDER' ? 'SHARED' : 'PRIVATE', requiresOwnerConfirmation: true, warnings: destinationKind === 'SHARED_FOLDER' ? ['This destination discloses the selected payload to a shared folder.'] : [] }), execute: async input => ({ reference: await port.create({ item: input.item, operationId: input.operationId, readFile: input.readFile }), created: true }), ...(port.undo ? { undo: async input => port.undo!({ item: input.item, operationId: input.operationId, result: input.result }) } : {}) }; }
export const createTaskCaptureAdapter = (port: CaptureWriterPort): CaptureDestinationAdapter => writerAdapter('TASK', port);
export const createVaultCaptureAdapter = (port: CaptureWriterPort): CaptureDestinationAdapter => writerAdapter('VAULT', port);
export const createWebLibraryCaptureAdapter = (port: CaptureWriterPort): CaptureDestinationAdapter => writerAdapter('WEB_LIBRARY', port);
export const createFilesCaptureAdapter = (port: CaptureWriterPort): CaptureDestinationAdapter => writerAdapter('FILES', port);
export const createPhotosCaptureAdapter = (port: CaptureWriterPort): CaptureDestinationAdapter => writerAdapter('PHOTOS', port);
export const createDocumentsCaptureAdapter = (port: CaptureWriterPort): CaptureDestinationAdapter => writerAdapter('DOCUMENTS', port);
export const createContactsCaptureAdapter = (port: CaptureWriterPort): CaptureDestinationAdapter => writerAdapter('CONTACTS', port);
export const createCalendarCaptureAdapter = (port: CaptureWriterPort): CaptureDestinationAdapter => writerAdapter('CALENDAR', port);
export const createWorkboardCaptureAdapter = (port: CaptureWriterPort): CaptureDestinationAdapter => writerAdapter('WORKBOARD', port);
export const createSharedFolderCaptureAdapter = (port: CaptureWriterPort): CaptureDestinationAdapter => writerAdapter('SHARED_FOLDER', port);

export interface CaptureDestinationPorts {
  readonly task?: CaptureWriterPort;
  readonly vault?: CaptureWriterPort;
  readonly webLibrary?: CaptureWriterPort;
  readonly files?: CaptureWriterPort;
  readonly photos?: CaptureWriterPort;
  readonly documents?: CaptureWriterPort;
  readonly contacts?: CaptureWriterPort;
  readonly calendar?: CaptureWriterPort;
  readonly workboard?: CaptureWriterPort;
  readonly sharedFolder?: CaptureWriterPort;
}
export function createCaptureDestinationRegistry(ports: CaptureDestinationPorts): InMemoryCaptureDestinationRegistry {
  const adapters: CaptureDestinationAdapter[] = []; if (ports.task) adapters.push(createTaskCaptureAdapter(ports.task)); if (ports.vault) adapters.push(createVaultCaptureAdapter(ports.vault)); if (ports.webLibrary) adapters.push(createWebLibraryCaptureAdapter(ports.webLibrary)); if (ports.files) adapters.push(createFilesCaptureAdapter(ports.files)); if (ports.photos) adapters.push(createPhotosCaptureAdapter(ports.photos)); if (ports.documents) adapters.push(createDocumentsCaptureAdapter(ports.documents)); if (ports.contacts) adapters.push(createContactsCaptureAdapter(ports.contacts)); if (ports.calendar) adapters.push(createCalendarCaptureAdapter(ports.calendar)); if (ports.workboard) adapters.push(createWorkboardCaptureAdapter(ports.workboard)); if (ports.sharedFolder) adapters.push(createSharedFolderCaptureAdapter(ports.sharedFolder)); return new InMemoryCaptureDestinationRegistry(adapters);
}
