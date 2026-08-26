/**
 * R0P87 Web Library.
 *
 * A bookmark is only a source reference.  An archive is an immutable,
 * owner-local captured revision.  The capture adapter is the only boundary
 * allowed to talk to a Browser/external-network host; this module never
 * fetches an origin URL, runs page JavaScript, persists session material, or
 * routes origin traffic through ConnectivityFabric.
 */

import {
  ContentCache,
  contentManifestSchema,
  createContentManifest,
  sha256,
  type ContentCachePolicy,
  type ContentId,
  type ContentManifest,
} from './social/content.js';
import type { BrowserAgentRuntime, BrowserCaptureRequest, BrowserCapturedPage } from '@keystone/browser-engine';

export const WEB_LIBRARY_PROTOCOL = 'keystone.web-library.r0p87' as const;
export const WEB_LIBRARY_VERSION = 1 as const;
export const WEB_LIBRARY_URI_SCHEME = 'keystone:' as const;
export const WEB_LIBRARY_URI_HOST = 'web-library' as const;

export const WEB_CAPTURE_MODES = ['BOOKMARK_ONLY', 'READER_SNAPSHOT', 'SAFE_PAGE_ARCHIVE'] as const;
export type WebCaptureMode = (typeof WEB_CAPTURE_MODES)[number];
export const WEB_ENTRY_KINDS = ['BOOKMARK', 'ARCHIVE'] as const;
export type WebLibraryEntryKind = (typeof WEB_ENTRY_KINDS)[number];
export const WEB_READ_STATES = ['UNREAD', 'READ'] as const;
export type WebReadState = (typeof WEB_READ_STATES)[number];
export const WEB_CAPTURE_STATES = ['CAPTURING', 'READY', 'PARTIAL', 'FAILED', 'CANCELED'] as const;
export type WebCaptureState = (typeof WEB_CAPTURE_STATES)[number];
export const WEB_RESOURCE_STATES = ['CAPTURED', 'SKIPPED', 'FAILED', 'UNAVAILABLE'] as const;
export type WebResourceState = (typeof WEB_RESOURCE_STATES)[number];
export const WEB_ANNOTATION_KINDS = ['HIGHLIGHT', 'NOTE'] as const;
export type WebAnnotationKind = (typeof WEB_ANNOTATION_KINDS)[number];

export type WebLibraryId = string & { readonly __brand: 'WebLibraryId' };
export type WebRevisionId = string & { readonly __brand: 'WebRevisionId' };
export type WebAnnotationId = string & { readonly __brand: 'WebAnnotationId' };
export type WebCollectionId = string & { readonly __brand: 'WebCollectionId' };
export type WebResourceId = string & { readonly __brand: 'WebResourceId' };

export type WebLibraryErrorCode =
  | 'INVALID_ARGUMENT'
  | 'INVALID_URL'
  | 'NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'POLICY_DENIED'
  | 'RESOURCE_LIMIT'
  | 'UNAVAILABLE'
  | 'CANCELED'
  | 'INTEGRITY'
  | 'CORRUPT_STATE'
  | 'UNSUPPORTED';

export class WebLibraryError extends Error {
  constructor(readonly code: WebLibraryErrorCode, message: string) {
    super(message);
    this.name = 'WebLibraryError';
  }
}

export interface WebLibraryStateStore {
  read(): Promise<unknown | undefined>;
  write(value: unknown): Promise<void>;
}

export class InMemoryWebLibraryStateStore implements WebLibraryStateStore {
  private value?: unknown;
  async read(): Promise<unknown | undefined> { return this.value === undefined ? undefined : structuredClone(this.value); }
  async write(value: unknown): Promise<void> { this.value = structuredClone(value); }
}

export interface WebStoredContent {
  readonly contentId: ContentId;
  readonly manifest: ContentManifest;
}

/** Content storage is deliberately separate from WebLibrary metadata. */
export interface WebLibraryContentStore {
  put(input: { readonly bytes: Uint8Array; readonly mimeType: string; readonly name?: string; readonly policy?: ContentCachePolicy }): Promise<WebStoredContent>;
  read(contentId: ContentId): Promise<Uint8Array | undefined>;
  manifest?(contentId: ContentId): ContentManifest | undefined;
  remove?(contentId: ContentId): Promise<void> | void;
}

/** R0P74-compatible local content store. Hosts may replace the cache. */
export class ContentCacheWebLibraryStore implements WebLibraryContentStore {
  constructor(readonly cache = new ContentCache(512 * 1024 * 1024)) {}

  async put(input: { readonly bytes: Uint8Array; readonly mimeType: string; readonly name?: string; readonly policy?: ContentCachePolicy }): Promise<WebStoredContent> {
    if (!(input.bytes instanceof Uint8Array)) throw new WebLibraryError('INVALID_ARGUMENT', 'Web content must be bytes');
    const manifest = await createContentManifest(input.bytes, {
      mimeType: input.mimeType,
      ...(input.name ? { name: input.name } : {}),
      contentPolicy: input.policy ?? 'PRIVATE_NO_STRANGER_CACHE',
    });
    await this.cache.putManifest(manifest);
    for (let index = 0; index < manifest.chunks.length; index += 1) {
      const start = index * manifest.chunkSize;
      await this.cache.putVerifiedChunk(manifest, index, input.bytes.subarray(start, Math.min(input.bytes.byteLength, start + manifest.chunkSize)));
    }
    return { contentId: manifest.contentId, manifest };
  }

  read(contentId: ContentId): Promise<Uint8Array | undefined> { return this.cache.read(contentId); }
  manifest(contentId: ContentId): ContentManifest | undefined { return this.cache.manifest(contentId); }
  remove(contentId: ContentId): void { this.cache.remove(contentId); }
}

export interface WebSourceMetadata {
  readonly description?: string;
  readonly siteName?: string;
  readonly author?: string;
  /** This is page-claimed metadata, never the local capture timestamp. */
  readonly claimedPublishedAt?: string;
  readonly language?: string;
}

export interface ReaderLink {
  readonly start: number;
  readonly end: number;
  readonly url: string;
  readonly label: string;
}

export type ReaderBlock =
  | { readonly type: 'heading'; readonly id: string; readonly level: 1 | 2 | 3; readonly text: string; readonly links: readonly ReaderLink[] }
  | { readonly type: 'paragraph'; readonly id: string; readonly text: string; readonly links: readonly ReaderLink[] }
  | { readonly type: 'blockquote'; readonly id: string; readonly text: string; readonly links: readonly ReaderLink[] }
  | { readonly type: 'list'; readonly id: string; readonly ordered: boolean; readonly items: readonly string[] }
  | { readonly type: 'code'; readonly id: string; readonly language?: string; readonly text: string }
  | { readonly type: 'image'; readonly id: string; readonly resourceId?: WebResourceId; readonly originalUrl?: string; readonly alt: string; readonly available: boolean }
  | { readonly type: 'separator'; readonly id: string };

export interface ReaderDocument {
  readonly version: 1;
  readonly title: string;
  readonly byline?: string;
  readonly sourceUrl: string;
  readonly capturedAt: string;
  readonly blocks: readonly ReaderBlock[];
  readonly text: string;
  readonly wordCount: number;
  readonly extraction: 'DETERMINISTIC' | 'EMPTY';
}

export interface WebArchiveResource {
  readonly version: 1;
  readonly resourceId: WebResourceId;
  readonly originalUrl: string;
  readonly mimeType?: string;
  readonly sizeBytes?: number;
  readonly contentId?: ContentId;
  readonly state: WebResourceState;
  readonly reason?: string;
  readonly privateCachePolicy: 'PRIVATE_NO_STRANGER_CACHE';
}

export interface WebArchiveRevision {
  readonly version: 1;
  readonly protocol: typeof WEB_LIBRARY_PROTOCOL;
  readonly id: WebRevisionId;
  readonly entryId: WebLibraryId;
  readonly revisionNumber: number;
  readonly captureMode: Exclude<WebCaptureMode, 'BOOKMARK_ONLY'>;
  readonly state: Exclude<WebCaptureState, 'CAPTURING' | 'CANCELED'>;
  readonly sourceUrl: string;
  readonly finalUrl: string;
  readonly title: string;
  readonly metadata: WebSourceMetadata;
  readonly capturedAt: string;
  readonly readerDocument: ReaderDocument;
  /** Safe static HTML generated from ReaderDocument; never origin HTML. */
  readonly safeHtmlContentId: ContentId;
  readonly resources: readonly WebArchiveResource[];
  readonly privateCachePolicy: 'PRIVATE_NO_STRANGER_CACHE';
  readonly sourceDataClass: 'PRIVATE';
}

export interface WebLibraryEntry {
  readonly version: 1;
  readonly protocol: typeof WEB_LIBRARY_PROTOCOL;
  readonly id: WebLibraryId;
  readonly kind: WebLibraryEntryKind;
  readonly sourceUrl: string;
  readonly title: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly collectionIds: readonly WebCollectionId[];
  readonly tags: readonly string[];
  readonly favorite: boolean;
  readonly readState: WebReadState;
  readonly revisionIds: readonly WebRevisionId[];
  readonly latestRevisionId?: WebRevisionId;
  readonly trashed: boolean;
  readonly private: true;
}

export interface WebLibraryCollection {
  readonly version: 1;
  readonly id: WebCollectionId;
  readonly name: string;
  readonly isSystem: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface WebAnnotation {
  readonly version: 1;
  readonly id: WebAnnotationId;
  readonly entryId: WebLibraryId;
  readonly revisionId: WebRevisionId;
  readonly kind: WebAnnotationKind;
  readonly start?: number;
  readonly end?: number;
  readonly quote?: string;
  readonly body?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface WebLibraryState {
  readonly version: 1;
  readonly entries: Readonly<Record<string, WebLibraryEntry>>;
  readonly revisions: Readonly<Record<string, WebArchiveRevision>>;
  readonly collections: Readonly<Record<string, WebLibraryCollection>>;
  readonly annotations: Readonly<Record<string, WebAnnotation>>;
}

export interface WebLibraryVisibilityBoundary {
  canRead(entry: WebLibraryEntry): boolean | Promise<boolean>;
}

export interface WebLibraryServiceOptions {
  readonly stateStore?: WebLibraryStateStore;
  readonly content?: WebLibraryContentStore;
  readonly visibility?: WebLibraryVisibilityBoundary;
  readonly now?: () => number;
  readonly maxEntries?: number;
  readonly maxRevisionsPerEntry?: number;
  readonly maxCollections?: number;
  readonly maxAnnotations?: number;
  readonly maxTagsPerEntry?: number;
}

export interface SaveBookmarkInput {
  readonly url: string;
  readonly title?: string;
  readonly collectionIds?: readonly string[];
  readonly tags?: readonly string[];
  readonly favorite?: boolean;
}

export interface WebCapturePolicy {
  readonly maxHtmlBytes: number;
  readonly maxReaderTextBytes: number;
  readonly maxBlocks: number;
  readonly maxResources: number;
  readonly maxResourceBytes: number;
  readonly maxTotalResourceBytes: number;
  readonly maxRedirects: number;
  readonly includeImages: boolean;
}

export interface WebCaptureRequest {
  readonly url: string;
  readonly mode: WebCaptureMode;
  readonly title?: string;
  readonly entryId?: WebLibraryId;
  readonly collectionIds?: readonly string[];
  readonly tags?: readonly string[];
  readonly favorite?: boolean;
  readonly policy?: Partial<WebCapturePolicy>;
  /** Capture is a consequence-bearing owner action. */
  readonly ownerConfirmed: true;
}

/** Browser/external-network boundary. It intentionally has no cookie/header/path fields. */
export interface WebCaptureAdapter {
  capture(request: WebCaptureRequest, signal: AbortSignal): Promise<WebCapturedPage>;
}

/** Typed production bridge for the existing BrowserAgentRuntime boundary. */
export interface BrowserRuntimeCaptureClient {
  capturePage(sessionId: string, request: BrowserCaptureRequest, tabId?: string): Promise<BrowserCapturedPage>;
}

export class BrowserRuntimeWebCaptureAdapter implements WebCaptureAdapter {
  constructor(private readonly runtime: BrowserRuntimeCaptureClient | BrowserAgentRuntime, private readonly sessionId: string, private readonly tabId?: string) {}

  async capture(request: WebCaptureRequest, signal: AbortSignal): Promise<WebCapturedPage> {
    if (request.mode === 'BOOKMARK_ONLY') throw new WebLibraryError('UNSUPPORTED', 'Bookmark-only saves do not require a Browser capture');
    if (signal.aborted) throw new WebLibraryError('CANCELED', 'Web capture was canceled');
    const policy = normalizePolicy(request.policy);
    const browserRequest: BrowserCaptureRequest = {
      mode: request.mode,
      ownerConfirmed: true,
      maxHtmlBytes: policy.maxHtmlBytes,
      maxResources: policy.maxResources,
      maxResourceBytes: policy.maxResourceBytes,
      maxTotalResourceBytes: policy.maxTotalResourceBytes,
      maxRedirects: policy.maxRedirects,
      includeImages: policy.includeImages,
      signal,
    };
    const captured = await this.runtime.capturePage(this.sessionId, browserRequest, this.tabId);
    if (signal.aborted) throw new WebLibraryError('CANCELED', 'Web capture was canceled');
    return { requestedUrl: request.url, finalUrl: captured.finalUrl ?? captured.requestedUrl, title: captured.title, html: captured.html, ...(captured.metadata ? { metadata: captured.metadata } : {}), ...(captured.resources ? { resources: captured.resources } : {}), ...(captured.redirectCount !== undefined ? { redirectCount: captured.redirectCount } : {}) };
  }
}

export interface WebCapturedResourceInput {
  readonly originalUrl: string;
  readonly bytes: Uint8Array;
  readonly mimeType: string;
  readonly kind: 'IMAGE' | 'SAFE_STYLE' | 'FONT' | 'OTHER';
}

export interface WebCapturedPage {
  readonly requestedUrl: string;
  readonly finalUrl?: string;
  readonly title: string;
  readonly html: string;
  readonly metadata?: WebSourceMetadata;
  readonly resources?: readonly WebCapturedResourceInput[];
  readonly redirectCount?: number;
}

export interface WebCaptureOutcome {
  readonly state: WebCaptureState;
  readonly entry: WebLibraryEntry;
  readonly revision?: WebArchiveRevision;
  readonly error?: string;
}

export interface WebCaptureDiagnostics {
  readonly activeCaptures: number;
  readonly queuedCaptures: number;
  readonly peakActiveCaptures: number;
  readonly completedCaptures: number;
  readonly failedCaptures: number;
}

export interface WebLibraryListQuery {
  readonly collectionId?: string;
  readonly tag?: string;
  readonly readState?: WebReadState;
  readonly favorite?: boolean;
  readonly includeTrash?: boolean;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface WebLibrarySearchQuery {
  readonly query: string;
  readonly limit?: number;
  readonly cursor?: string;
  readonly includeRead?: boolean;
}

export interface WebLibrarySearchResult {
  readonly entry: WebLibraryEntry;
  readonly score: number;
  readonly matchedFields: readonly ('title' | 'hostname' | 'text' | 'tag' | 'collection' | 'annotation')[];
  readonly snippet: string;
}

export interface WebArchiveRender {
  readonly entry: WebLibraryEntry;
  readonly revision: WebArchiveRevision;
  readonly html: string;
  readonly externalLinks: readonly { readonly url: string; readonly label: string }[];
  readonly missingResources: readonly WebArchiveResource[];
  readonly externalRequestCount: 0;
  readonly scriptsExecuted: 0;
  readonly formsSubmitted: 0;
}

export interface WebRevisionDiffChunk {
  readonly kind: 'UNCHANGED' | 'ADDED' | 'REMOVED';
  readonly text: string;
}

export interface WebRevisionDiff {
  readonly fromRevisionId: WebRevisionId;
  readonly toRevisionId: WebRevisionId;
  readonly chunks: readonly WebRevisionDiffChunk[];
  readonly addedLines: number;
  readonly removedLines: number;
  readonly truncated: boolean;
}

export interface WebSharePlan {
  readonly kind: 'SOURCE_LINK' | 'ARCHIVE_COPY' | 'QUOTE';
  readonly explicit: true;
  readonly private: true;
  readonly sourceUrl: string;
  readonly entryId: WebLibraryId;
  readonly revisionId?: WebRevisionId;
  readonly contentId?: ContentId;
  readonly text?: string;
  readonly provenance: { readonly sourceUrl: string; readonly capturedAt?: string; readonly revisionId?: WebRevisionId };
}

/** Explicit cross-surface boundary.  The Web Library never calls these
 * destinations implicitly and never turns a private archive into a public
 * publication without the destination adapter's own policy. */
export interface WebLibraryShareBoundary {
  share(input: {
    readonly destination: 'OWNED_DEVICE' | 'NEARBY' | 'PERSONAL_WEB';
    readonly targetId?: string;
    readonly plan: WebSharePlan;
    readonly ownerConfirmed: true;
  }): Promise<{ readonly id: string; readonly destination: 'OWNED_DEVICE' | 'NEARBY' | 'PERSONAL_WEB' }>;
}

export interface WebLibraryVaultAdapter {
  createNote(input: { readonly title: string; readonly markdown: string; readonly provenance: WebSharePlan['provenance'] }): Promise<{ readonly noteId: string }>;
}

export interface WebLibraryResolver {
  resolve(uri: string): Promise<WebArchiveRender | undefined>;
}

export const DEFAULT_WEB_CAPTURE_POLICY: WebCapturePolicy = Object.freeze({
  maxHtmlBytes: 2 * 1024 * 1024,
  maxReaderTextBytes: 1 * 1024 * 1024,
  maxBlocks: 10_000,
  maxResources: 128,
  maxResourceBytes: 8 * 1024 * 1024,
  maxTotalResourceBytes: 32 * 1024 * 1024,
  maxRedirects: 5,
  includeImages: true,
});

const READ_LATER_ID = 'read-later' as WebCollectionId;
const MAX_ID_BYTES = 160;

function randomId(prefix: string): string {
  const suffix = typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${suffix}`.slice(0, MAX_ID_BYTES);
}

function clone<T>(value: T): T { return structuredClone(value); }
function iso(now: number): string { return new Date(now).toISOString(); }
function boundedInt(value: unknown, min: number, max: number, fallback: number): number { return Number.isSafeInteger(value) ? Math.max(min, Math.min(max, Number(value))) : fallback; }
function boundedText(value: unknown, max: number, required = false): string {
  if (typeof value !== 'string') { if (required) throw new WebLibraryError('INVALID_ARGUMENT', 'Text value is required'); return ''; }
  const output = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);
  if (required && !output) throw new WebLibraryError('INVALID_ARGUMENT', 'Text value is required');
  return output;
}
function safeId(value: unknown, prefix: string): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > MAX_ID_BYTES || /[\u0000-\u001f\u007f]/.test(value)) throw new WebLibraryError('INVALID_ARGUMENT', 'Invalid Web Library identifier');
  return value.startsWith(`${prefix}-`) || value === READ_LATER_ID ? value : value;
}
function normalizeTags(values: readonly string[] | undefined, max: number): readonly string[] {
  return [...new Set((values ?? []).map(value => boundedText(value, 64)).filter(Boolean))].slice(0, max);
}
function safeUrl(value: string, field = 'URL'): string {
  if (typeof value !== 'string' || value.length > 8_192) throw new WebLibraryError('INVALID_URL', `${field} is invalid`);
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new WebLibraryError('INVALID_URL', `${field} is invalid`); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new WebLibraryError('INVALID_URL', `${field} must be an HTTP(S) URL without credentials`);
  return redactSensitiveQuery(parsed).toString();
}
function redactSensitiveQuery(value: URL): URL {
  const output = new URL(value.toString());
  for (const key of [...output.searchParams.keys()]) if (/^(?:auth|authorization|cookie|key|password|secret|session|sig|signature|token|access_token|refresh_token)$/i.test(key) || /(?:token|secret|password|session|signature)/i.test(key)) output.searchParams.delete(key);
  return output;
}
function safeResourceUrl(value: string): string { return safeUrl(value, 'Resource URL'); }
function safeTitle(value: unknown, fallback: string): string { return boundedText(value, 512) || fallback;
}
function safeMime(value: unknown): string { return typeof value === 'string' && /^[\w.+-]+\/[\w.+-]+(?:;[^\r\n]{0,120})?$/.test(value) ? value.slice(0, 255) : 'application/octet-stream'; }
function tokenize(value: string): readonly string[] { return [...new Set((value.toLocaleLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? []).slice(0, 4_096))]; }
function snippet(value: string, terms: readonly string[]): string { const text = value.replace(/\s+/g, ' ').trim(); if (!text) return ''; const lower = text.toLocaleLowerCase(); const position = terms.map(term => lower.indexOf(term)).filter(value => value >= 0).sort((a, b) => a - b)[0] ?? 0; return `${position > 48 ? '…' : ''}${text.slice(Math.max(0, position - 48), position + 192)}${position + 192 < text.length ? '…' : ''}`; }
function escapeHtml(value: string): string { return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function decodeEntities(value: string): string { return value.replace(/&(?:amp|lt|gt|quot|apos|nbsp);|&#(?:x[0-9a-f]+|[0-9]+);/gi, match => { const map: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ' }; const direct = map[match.toLocaleLowerCase()]; if (direct) return direct; const numeric = match.startsWith('&#x') || match.startsWith('&#X') ? Number.parseInt(match.slice(3, -1), 16) : Number.parseInt(match.slice(2, -1), 10); return Number.isSafeInteger(numeric) ? String.fromCodePoint(Math.min(0x10ffff, numeric)) : ''; }); }
function cleanText(value: string): string { return decodeEntities(value.replace(/\s+/g, ' ')).trim(); }
function lineCount(value: string): number { return value ? value.split('\n').length : 0; }
function contentPolicy(): 'PRIVATE_NO_STRANGER_CACHE' { return 'PRIVATE_NO_STRANGER_CACHE'; }

export interface SanitizedArchiveHtml {
  readonly html: string;
  readonly blockedTags: readonly string[];
  readonly blockedAttributes: number;
  readonly externalUrls: readonly string[];
  readonly formsBlocked: number;
}

/**
 * Sanitizes at the capture boundary.  The returned HTML is only an
 * intermediate representation; the archive renderer later emits HTML from
 * ReaderDocument and never trusts this string as an executable DOM.
 */
export function sanitizeArchivedHtml(input: string, maxBytes = DEFAULT_WEB_CAPTURE_POLICY.maxHtmlBytes, baseUrl?: string): SanitizedArchiveHtml {
  let html = boundedText(input, maxBytes);
  let resolvedBaseUrl: string | undefined;
  if (baseUrl) { try { resolvedBaseUrl = safeUrl(baseUrl, 'Base URL'); } catch { resolvedBaseUrl = undefined; } }
  const blockedTags: string[] = [];
  let formsBlocked = 0;
  const block = (tag: string, replacement: string): void => {
    const pattern = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>|<${tag}\\b[^>]*/?>`, 'gi');
    const before = html;
    html = html.replace(pattern, replacement);
    if (before !== html) blockedTags.push(tag);
  };
  html = html.replace(/<!--[\s\S]*?-->/g, '');
  block('script', '<div data-keystone-blocked="script"></div>');
  block('noscript', '<div data-keystone-blocked="noscript"></div>');
  block('template', '<div data-keystone-blocked="template"></div>');
  block('iframe', '<div data-keystone-blocked="iframe">Embedded content is unavailable offline.</div>');
  block('object', '<div data-keystone-blocked="object">Embedded content is unavailable offline.</div>');
  block('embed', '<div data-keystone-blocked="embed">Embedded content is unavailable offline.</div>');
  block('form', '<div data-keystone-blocked="form">Interactive forms are unavailable in a saved page.</div>');
  formsBlocked = blockedTags.filter(value => value === 'form').length;
  block('applet', '<div data-keystone-blocked="applet"></div>');
  html = html.replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, () => { blockedTags.push('style'); return ''; });
  html = html.replace(/<link\b[^>]*\brel\s*=\s*["']?stylesheet["']?[^>]*>/gi, () => { blockedTags.push('link'); return ''; });
  let blockedAttributes = 0;
  html = html.replace(/\s+on[a-z0-9_-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, () => { blockedAttributes += 1; return ''; });
  html = html.replace(/\s+style\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, () => { blockedAttributes += 1; return ''; });
  const externalUrls: string[] = [];
  html = html.replace(/\s+(href|src)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi, (full, attribute: string, _quoted: string, doubleValue: string | undefined, singleValue: string | undefined, bareValue: string | undefined) => {
    const value = doubleValue ?? singleValue ?? bareValue ?? '';
    let parsed: URL | undefined;
    try { parsed = new URL(value, resolvedBaseUrl); } catch { parsed = undefined; }
    const normalized = parsed && ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password ? redactSensitiveQuery(parsed).toString() : undefined;
    if (attribute.toLocaleLowerCase() === 'href' && normalized) { externalUrls.push(normalized); return ` href="${escapeHtml(normalized)}"`; }
    if (attribute.toLocaleLowerCase() === 'src' && normalized) { externalUrls.push(normalized); return ` data-keystone-external-src="${escapeHtml(normalized)}"`; }
    blockedAttributes += 1;
    return attribute.toLocaleLowerCase() === 'href' ? ' href="#blocked" data-keystone-blocked="unsafe-link"' : ' data-keystone-blocked="unsafe-resource"';
  });
  html = html.replace(/<svg\b[^>]*>[\s\S]*?<\/svg\s*>/gi, () => { blockedTags.push('svg'); return '<div data-keystone-blocked="svg"></div>'; });
  return { html: html.slice(0, maxBytes), blockedTags: [...new Set(blockedTags)], blockedAttributes, externalUrls: [...new Set(externalUrls)].slice(0, 512), formsBlocked };
}

interface MutableReaderBlock {
  readonly tag: string;
  readonly attrs: string;
  text: string;
  links: ReaderLink[];
  activeLink?: { readonly url: string; readonly start: number };
}

function attributeValue(attrs: string, name: string): string | undefined {
  const match = attrs.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return match ? (match[1] ?? match[2] ?? match[3]) : undefined;
}

function addReaderText(block: MutableReaderBlock, raw: string): void {
  const text = decodeEntities(raw.replace(/\s+/g, ' '));
  if (!text) return;
  const start = block.text.length;
  block.text += text;
  if (block.activeLink) block.links.push({ start, end: block.text.length, url: block.activeLink.url, label: text.trim() });
}

function pushReaderBlock(blocks: ReaderBlock[], block: MutableReaderBlock | undefined, maxBlocks: number): void {
  if (!block || blocks.length >= maxBlocks) return;
  const text = cleanText(block.text);
  if (block.tag === 'h1' || block.tag === 'h2' || block.tag === 'h3') {
    if (text) blocks.push({ type: 'heading', id: randomId('reader-heading'), level: Number(block.tag.slice(1)) as 1 | 2 | 3, text, links: block.links.map(link => ({ ...link, start: Math.max(0, link.start), end: Math.min(text.length, link.end) })).filter(link => link.end > link.start) });
  } else if (block.tag === 'blockquote') {
    if (text) blocks.push({ type: 'blockquote', id: randomId('reader-quote'), text, links: block.links });
  } else if (block.tag === 'pre' || block.tag === 'code') {
    if (text) blocks.push({ type: 'code', id: randomId('reader-code'), text });
  } else if (block.tag === 'p' || block.tag === 'div' || block.tag === 'article' || block.tag === 'section') {
    if (text) blocks.push({ type: 'paragraph', id: randomId('reader-paragraph'), text, links: block.links });
  }
}

/** Deterministic bounded HTML-to-ReaderDocument extraction; no DOM or AI is required. */
export function extractReaderDocument(input: {
  readonly html: string;
  readonly sourceUrl: string;
  readonly title?: string;
  readonly byline?: string;
  readonly capturedAt: string;
  readonly maxBytes?: number;
  readonly maxBlocks?: number;
  readonly resourceByUrl?: ReadonlyMap<string, WebArchiveResource>;
}): ReaderDocument {
  const maxBlocks = boundedInt(input.maxBlocks, 1, DEFAULT_WEB_CAPTURE_POLICY.maxBlocks, DEFAULT_WEB_CAPTURE_POLICY.maxBlocks);
  const sanitized = sanitizeArchivedHtml(input.html, input.maxBytes ?? DEFAULT_WEB_CAPTURE_POLICY.maxHtmlBytes, input.sourceUrl).html;
  const blocks: ReaderBlock[] = [];
  let current: MutableReaderBlock | undefined;
  let list: { readonly ordered: boolean; readonly items: string[] } | undefined;
  const tokens = sanitized.match(/<[^>]{1,4096}>|[^<]+/g) ?? [];
  for (const token of tokens.slice(0, maxBlocks * 32)) {
    const closing = token.match(/^<\/\s*([a-z0-9]+)\s*>$/i);
    const opening = token.match(/^<\s*([a-z0-9]+)([^>]*)>$/i);
    if (!closing && !opening) { if (current) addReaderText(current, token); else if (list) list.items.push(cleanText(token)); continue; }
    if (closing) {
      const tag = closing[1]!.toLocaleLowerCase();
      if (tag === 'a' && current?.activeLink) { const link = current.activeLink; current.activeLink = undefined; if (current.text.length > link.start) current.links.push({ start: link.start, end: current.text.length, url: link.url, label: current.text.slice(link.start, current.text.length).trim() }); }
      else if (tag === 'li' && list && current) { const item = cleanText(current.text); if (item) list.items.push(item); current = undefined; }
      else if ((tag === 'ul' || tag === 'ol') && list) { if (list.items.length && blocks.length < maxBlocks) blocks.push({ type: 'list', id: randomId('reader-list'), ordered: list.ordered, items: list.items.slice(0, 512) }); list = undefined; }
      else if (tag === 'br' && current) addReaderText(current, '\n');
      else if (['h1', 'h2', 'h3', 'p', 'blockquote', 'pre', 'code', 'div', 'article', 'section'].includes(tag)) { pushReaderBlock(blocks, current, maxBlocks); current = undefined; }
      continue;
    }
    if (!opening) continue;
    const tag = opening[1]!.toLocaleLowerCase(); const attrs = opening[2] ?? '';
    if (tag === 'ul' || tag === 'ol') { list = { ordered: tag === 'ol', items: [] }; continue; }
    if (tag === 'li') { current = { tag, attrs, text: '', links: [] }; continue; }
    if (tag === 'img') {
      const originalUrl = attributeValue(attrs, 'data-keystone-external-src') ?? attributeValue(attrs, 'src');
      const normalized = originalUrl ? (() => { try { return safeResourceUrl(originalUrl); } catch { return undefined; } })() : undefined;
      const resource = normalized ? input.resourceByUrl?.get(normalized) : undefined;
      blocks.push({ type: 'image', id: randomId('reader-image'), ...(resource ? { resourceId: resource.resourceId } : {}), ...(normalized ? { originalUrl: normalized } : {}), alt: boundedText(attributeValue(attrs, 'alt'), 512), available: resource?.state === 'CAPTURED' });
      continue;
    }
    if (tag === 'hr') { blocks.push({ type: 'separator', id: randomId('reader-separator') }); continue; }
    if (tag === 'a' && current) { const href = attributeValue(attrs, 'href'); try { current.activeLink = href ? { url: safeUrl(href, 'Link URL'), start: current.text.length } : undefined; } catch { current.activeLink = undefined; } continue; }
    if (['h1', 'h2', 'h3', 'p', 'blockquote', 'pre', 'code', 'div', 'article', 'section'].includes(tag)) { if (current) pushReaderBlock(blocks, current, maxBlocks); current = { tag, attrs, text: '', links: [] }; }
  }
  if (current) pushReaderBlock(blocks, current, maxBlocks);
  const title = safeTitle(input.title, blocks.find(block => block.type === 'heading')?.text ?? 'Saved page');
  const text = blocks.map(block => {
    if (block.type === 'list') return block.items.join('\n');
    if (block.type === 'separator') return '';
    if (block.type === 'image') return block.alt;
    return block.text;
  }).filter(Boolean).join('\n\n').slice(0, input.maxBytes ?? DEFAULT_WEB_CAPTURE_POLICY.maxReaderTextBytes);
  return { version: 1, title, ...(input.byline ? { byline: boundedText(input.byline, 256) } : {}), sourceUrl: safeUrl(input.sourceUrl), capturedAt: input.capturedAt, blocks, text, wordCount: tokenize(text).length, extraction: text ? 'DETERMINISTIC' : 'EMPTY' };
}

function safeRenderLink(url: string): string | undefined { try { const normalized = safeUrl(url, 'Link URL'); return normalized; } catch { return undefined; } }

/** Emits static local HTML. It has no scripts, forms, remote src, or live origin. */
export function renderReaderDocument(document: ReaderDocument, resources: readonly WebArchiveResource[] = []): { readonly html: string; readonly externalLinks: readonly { readonly url: string; readonly label: string }[]; readonly missingResources: readonly WebArchiveResource[] } {
  const byId = new Map(resources.map(resource => [resource.resourceId, resource] as const));
  const externalLinks: { url: string; label: string }[] = [];
  const missingResources: WebArchiveResource[] = [];
  const blocks = document.blocks.map(block => {
    if (block.type === 'heading') return `<h${block.level} id="${escapeHtml(block.id)}">${escapeHtml(block.text)}</h${block.level}>`;
    if (block.type === 'paragraph') return `<p>${escapeHtml(block.text)}</p>`;
    if (block.type === 'blockquote') return `<blockquote>${escapeHtml(block.text)}</blockquote>`;
    if (block.type === 'list') return `<${block.ordered ? 'ol' : 'ul'}>${block.items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</${block.ordered ? 'ol' : 'ul'}>`;
    if (block.type === 'code') return `<pre><code>${escapeHtml(block.text)}</code></pre>`;
    if (block.type === 'separator') return '<hr />';
    const resource = block.resourceId ? byId.get(block.resourceId) : undefined;
    if (resource?.state === 'CAPTURED') return `<figure data-keystone-resource="${escapeHtml(resource.resourceId)}"><img alt="${escapeHtml(block.alt)}" data-keystone-resource="${escapeHtml(resource.resourceId)}" /><figcaption>${escapeHtml(block.alt)}</figcaption></figure>`;
    if (resource) missingResources.push(resource);
    return `<figure data-keystone-missing="true"><figcaption>${escapeHtml(block.alt || 'Image unavailable offline')}</figcaption></figure>`;
  });
  for (const block of document.blocks) for (const link of 'links' in block ? block.links : []) { const url = safeRenderLink(link.url); if (url) externalLinks.push({ url, label: link.label }); }
  return { html: `<article data-keystone-archive="true"><header><h1>${escapeHtml(document.title)}</h1>${document.byline ? `<p data-keystone-byline="true">${escapeHtml(document.byline)}</p>` : ''}<p data-keystone-capture="true">Saved revision · ${escapeHtml(document.capturedAt)}</p></header>${blocks.join('')}</article>`, externalLinks, missingResources: [...new Map(missingResources.map(resource => [resource.resourceId, resource])).values()] };
}

export function readerDocumentToMarkdown(document: ReaderDocument): string {
  return [`# ${document.title}`, document.byline ? `_${document.byline}_` : '', '', ...document.blocks.map(block => {
    if (block.type === 'heading') return `${'#'.repeat(block.level)} ${block.text}`;
    if (block.type === 'paragraph') return block.text;
    if (block.type === 'blockquote') return block.text.split('\n').map(line => `> ${line}`).join('\n');
    if (block.type === 'list') return block.items.map((item, index) => `${block.ordered ? `${index + 1}.` : '-'} ${item}`).join('\n');
    if (block.type === 'code') return `\n\`\`\`\n${block.text}\n\`\`\``;
    if (block.type === 'separator') return '---';
    return block.available ? `![${block.alt}](keystone://web-library/resource/${block.resourceId ?? 'missing'})` : `[Image unavailable offline: ${block.alt}]`;
  }), '', `Source: ${document.sourceUrl}`, `Captured: ${document.capturedAt}`].filter(Boolean).join('\n\n');
}

interface MutableWebLibraryState {
  version: 1;
  entries: Record<string, WebLibraryEntry>;
  revisions: Record<string, WebArchiveRevision>;
  collections: Record<string, WebLibraryCollection>;
  annotations: Record<string, WebAnnotation>;
}

function emptyState(now: number): MutableWebLibraryState {
  const timestamp = iso(now);
  return {
    version: 1,
    entries: {},
    revisions: {},
    collections: {
      [READ_LATER_ID]: { version: 1, id: READ_LATER_ID, name: 'Read Later', isSystem: true, createdAt: timestamp, updatedAt: timestamp },
    },
    annotations: {},
  };
}

function parseState(value: unknown, limits: { readonly maxEntries: number; readonly maxRevisions: number; readonly maxCollections: number; readonly maxAnnotations: number }): MutableWebLibraryState {
  const output = emptyState(Date.now());
  if (!value || typeof value !== 'object') return output;
  const candidate = value as Partial<MutableWebLibraryState>;
  if (candidate.version !== 1) return output;
  for (const [id, entry] of Object.entries(candidate.entries ?? {}).slice(0, limits.maxEntries)) if (isEntry(entry) && id === entry.id) output.entries[id] = clone(entry);
  for (const [id, revision] of Object.entries(candidate.revisions ?? {}).slice(0, limits.maxRevisions)) if (isRevision(revision) && id === revision.id && output.entries[revision.entryId]) output.revisions[id] = clone(revision);
  for (const [id, collection] of Object.entries(candidate.collections ?? {}).slice(0, limits.maxCollections)) if (isCollection(collection) && id === collection.id) output.collections[id] = clone(collection);
  for (const [id, annotation] of Object.entries(candidate.annotations ?? {}).slice(0, limits.maxAnnotations)) if (isAnnotation(annotation) && id === annotation.id && output.entries[annotation.entryId] && output.revisions[annotation.revisionId]) output.annotations[id] = clone(annotation);
  if (!output.collections[READ_LATER_ID]) output.collections[READ_LATER_ID] = emptyState(Date.now()).collections[READ_LATER_ID]!;
  for (const [id, entry] of Object.entries(output.entries)) {
    const revisionIds = entry.revisionIds.filter(revisionId => Boolean(output.revisions[revisionId] && output.revisions[revisionId]!.entryId === id));
    const latestRevisionId = entry.latestRevisionId && revisionIds.includes(entry.latestRevisionId) ? entry.latestRevisionId : revisionIds.at(-1);
    output.entries[id] = { ...entry, revisionIds, ...(latestRevisionId ? { latestRevisionId } : { latestRevisionId: undefined }) };
  }
  return output;
}

function isEntry(value: unknown): value is WebLibraryEntry {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<WebLibraryEntry>;
  return candidate.version === 1 && candidate.protocol === WEB_LIBRARY_PROTOCOL && typeof candidate.id === 'string' && typeof candidate.sourceUrl === 'string' && typeof candidate.title === 'string' && (candidate.kind === 'BOOKMARK' || candidate.kind === 'ARCHIVE') && Array.isArray(candidate.collectionIds) && Array.isArray(candidate.tags) && Array.isArray(candidate.revisionIds) && typeof candidate.favorite === 'boolean' && (candidate.readState === 'READ' || candidate.readState === 'UNREAD') && candidate.private === true;
}
function isRevision(value: unknown): value is WebArchiveRevision {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<WebArchiveRevision>;
  return candidate.version === 1 && candidate.protocol === WEB_LIBRARY_PROTOCOL && typeof candidate.id === 'string' && typeof candidate.entryId === 'string' && typeof candidate.revisionNumber === 'number' && Number.isSafeInteger(candidate.revisionNumber) && candidate.revisionNumber > 0 && (candidate.captureMode === 'READER_SNAPSHOT' || candidate.captureMode === 'SAFE_PAGE_ARCHIVE') && (candidate.state === 'READY' || candidate.state === 'PARTIAL' || candidate.state === 'FAILED') && typeof candidate.sourceUrl === 'string' && typeof candidate.finalUrl === 'string' && typeof candidate.title === 'string' && candidate.readerDocument?.version === 1 && typeof candidate.safeHtmlContentId === 'string' && Array.isArray(candidate.resources) && candidate.privateCachePolicy === 'PRIVATE_NO_STRANGER_CACHE' && candidate.sourceDataClass === 'PRIVATE';
}
function isCollection(value: unknown): value is WebLibraryCollection {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<WebLibraryCollection>;
  return candidate.version === 1 && typeof candidate.id === 'string' && typeof candidate.name === 'string' && typeof candidate.isSystem === 'boolean';
}
function isAnnotation(value: unknown): value is WebAnnotation {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<WebAnnotation>;
  return candidate.version === 1 && typeof candidate.id === 'string' && typeof candidate.entryId === 'string' && typeof candidate.revisionId === 'string' && (candidate.kind === 'HIGHLIGHT' || candidate.kind === 'NOTE') && typeof candidate.createdAt === 'string' && typeof candidate.updatedAt === 'string';
}

export class WebLibraryService implements WebLibraryResolver {
  readonly content: WebLibraryContentStore;
  private readonly stateStore: WebLibraryStateStore;
  private readonly visibility?: WebLibraryVisibilityBoundary;
  private readonly now: () => number;
  private readonly maxEntries: number;
  private readonly maxRevisionsPerEntry: number;
  private readonly maxCollections: number;
  private readonly maxAnnotations: number;
  private readonly maxTagsPerEntry: number;
  private state: MutableWebLibraryState;
  private readonly readyPromise: Promise<void>;
  private writes: Promise<void> = Promise.resolve();
  private readonly tokenIndex = new Map<string, Set<string>>();
  private readonly annotationTextByEntry = new Map<string, string>();

  constructor(options: WebLibraryServiceOptions = {}) {
    this.stateStore = options.stateStore ?? new InMemoryWebLibraryStateStore();
    this.content = options.content ?? new ContentCacheWebLibraryStore();
    this.visibility = options.visibility;
    this.now = options.now ?? Date.now;
    this.maxEntries = boundedInt(options.maxEntries, 1, 100_000, 10_000);
    this.maxRevisionsPerEntry = boundedInt(options.maxRevisionsPerEntry, 1, 1_000, 100);
    this.maxCollections = boundedInt(options.maxCollections, 1, 10_000, 1_000);
    this.maxAnnotations = boundedInt(options.maxAnnotations, 1, 100_000, 50_000);
    this.maxTagsPerEntry = boundedInt(options.maxTagsPerEntry, 1, 256, 32);
    this.state = emptyState(this.now());
    this.readyPromise = this.hydrate();
  }

  async ready(): Promise<void> { await this.readyPromise; }
  async flush(): Promise<void> { await this.writes; }
  snapshot(): WebLibraryState { return clone(this.state); }
  diagnostics(): { readonly entries: number; readonly revisions: number; readonly collections: number; readonly annotations: number; readonly indexedTerms: number } { return { entries: Object.keys(this.state.entries).length, revisions: Object.keys(this.state.revisions).length, collections: Object.keys(this.state.collections).length, annotations: Object.keys(this.state.annotations).length, indexedTerms: this.tokenIndex.size }; }

  async saveBookmark(input: SaveBookmarkInput): Promise<WebLibraryEntry> {
    await this.ready();
    const entry = this.saveBookmarkInternal(input);
    await this.persist();
    return clone(entry);
  }

  async saveBookmarks(inputs: readonly SaveBookmarkInput[]): Promise<readonly WebLibraryEntry[]> {
    await this.ready();
    if (inputs.length > this.maxEntries) throw new WebLibraryError('RESOURCE_LIMIT', 'Bulk Web Library input exceeds the entry bound');
    const result: WebLibraryEntry[] = [];
    for (const input of inputs) result.push(this.saveBookmarkInternal(input));
    await this.persist();
    return result.map(clone);
  }

  async capture(request: WebCaptureRequest, adapter: WebCaptureAdapter, signal = new AbortController().signal): Promise<WebCaptureOutcome> {
    await this.ready();
    if (request.ownerConfirmed !== true) throw new WebLibraryError('UNAUTHORIZED', 'Explicit owner confirmation is required to capture a page');
    const normalizedRequestUrl = safeUrl(request.url);
    const entry = request.entryId ? await this.requireReadableEntry(request.entryId) : await this.saveBookmark({ url: normalizedRequestUrl, title: request.title, collectionIds: request.collectionIds, tags: request.tags, favorite: request.favorite });
    if (request.entryId && entry.sourceUrl !== normalizedRequestUrl) throw new WebLibraryError('INVALID_ARGUMENT', 'Capture URL must match the existing Web Library entry');
    if (request.mode === 'BOOKMARK_ONLY') return { state: 'READY', entry };
    if (signal.aborted) return { state: 'CANCELED', entry };
    try {
      const captured = await adapter.capture({ ...request, url: safeUrl(request.url) }, signal);
      if (signal.aborted) return { state: 'CANCELED', entry };
      const revision = await this.commitCapture(entry.id, request, captured);
      return { state: revision.state, entry: clone(this.state.entries[entry.id]!), revision };
    } catch (error) {
      if (signal.aborted || (error instanceof WebLibraryError && error.code === 'CANCELED')) return { state: 'CANCELED', entry: clone(this.state.entries[entry.id]!), error: 'Capture canceled' };
      return { state: 'FAILED', entry: clone(this.state.entries[entry.id]!), error: sanitizeError(error) };
    }
  }

  async refresh(entryId: WebLibraryId, adapter: WebCaptureAdapter, options: Omit<WebCaptureRequest, 'url' | 'entryId' | 'ownerConfirmed'> & { readonly ownerConfirmed: true }, signal?: AbortSignal): Promise<WebCaptureOutcome> {
    const entry = await this.requireEntry(entryId);
    return this.capture({ ...options, entryId, url: entry.sourceUrl, ownerConfirmed: true }, adapter, signal);
  }

  async listEntries(query: WebLibraryListQuery = {}): Promise<readonly WebLibraryEntry[]> {
    await this.ready();
    const offset = boundedInt(query.cursor ? Number(query.cursor) : 0, 0, this.maxEntries, 0);
    const limit = boundedInt(query.limit, 1, 200, 50);
    const values: WebLibraryEntry[] = [];
    for (const entry of Object.values(this.state.entries).sort(compareEntries)) {
      if (!query.includeTrash && entry.trashed) continue;
      if (query.collectionId && !entry.collectionIds.includes(query.collectionId as WebCollectionId)) continue;
      if (query.tag && !entry.tags.includes(boundedText(query.tag, 64))) continue;
      if (query.readState && entry.readState !== query.readState) continue;
      if (query.favorite !== undefined && entry.favorite !== query.favorite) continue;
      if (!(await this.canRead(entry))) continue;
      values.push(clone(entry));
    }
    return values.slice(offset, offset + limit);
  }

  async search(query: WebLibrarySearchQuery): Promise<readonly WebLibrarySearchResult[]> {
    await this.ready();
    const terms = tokenize(boundedText(query.query, 256));
    if (!terms.length) return [];
    const limit = boundedInt(query.limit, 1, 200, 50);
    const offset = boundedInt(query.cursor ? Number(query.cursor) : 0, 0, this.maxEntries, 0);
    const candidates = new Set<string>();
    for (const term of terms) for (const id of this.tokenIndex.get(term) ?? []) candidates.add(id);
    const output: WebLibrarySearchResult[] = [];
    for (const id of candidates) {
      const entry = this.state.entries[id];
      if (!entry || entry.trashed || (!query.includeRead && entry.readState === 'READ') || !(await this.canRead(entry))) continue;
      const fields = matchedSearchFields(this.entrySearchFields(entry), terms);
      output.push({ entry: clone(entry), score: fields.reduce((score, field) => score + (field === 'title' ? 40 : field === 'text' ? 25 : field === 'annotation' ? 20 : 10), 0) + (entry.favorite ? 1 : 0), matchedFields: fields, snippet: snippet(this.entrySearchText(entry), terms) });
    }
    return output.sort((left, right) => right.score - left.score || compareEntries(left.entry, right.entry)).slice(offset, offset + limit);
  }

  async getEntry(entryId: WebLibraryId): Promise<WebLibraryEntry | undefined> { await this.ready(); const entry = this.state.entries[entryId]; return entry && await this.canRead(entry) ? clone(entry) : undefined; }
  async getRevision(entryId: WebLibraryId, revisionId?: WebRevisionId): Promise<WebArchiveRevision | undefined> { await this.ready(); const entry = this.state.entries[entryId]; if (!entry || !(await this.canRead(entry))) return undefined; const id = revisionId ?? entry.latestRevisionId; const revision = id ? this.state.revisions[id] : undefined; return revision && revision.entryId === entryId ? clone(revision) : undefined; }
  async listRevisions(entryId: WebLibraryId): Promise<readonly WebArchiveRevision[]> { await this.ready(); const entry = await this.requireReadableEntry(entryId); return entry.revisionIds.map(id => this.state.revisions[id]).filter((value): value is WebArchiveRevision => Boolean(value)).sort((a, b) => a.revisionNumber - b.revisionNumber).map(clone); }
  async getReaderDocument(entryId: WebLibraryId, revisionId?: WebRevisionId): Promise<ReaderDocument | undefined> { const revision = await this.getRevision(entryId, revisionId); return revision ? clone(revision.readerDocument) : undefined; }

  async render(entryId: WebLibraryId, revisionId?: WebRevisionId): Promise<WebArchiveRender | undefined> {
    const entry = await this.getEntry(entryId); const revision = entry ? await this.getRevision(entryId, revisionId) : undefined;
    if (!entry || !revision) return undefined;
    const rendered = renderReaderDocument(revision.readerDocument, revision.resources);
    return { entry, revision, html: rendered.html, externalLinks: rendered.externalLinks, missingResources: rendered.missingResources, externalRequestCount: 0, scriptsExecuted: 0, formsSubmitted: 0 };
  }

  async createCollection(name: string): Promise<WebLibraryCollection> {
    await this.ready();
    if (Object.keys(this.state.collections).length >= this.maxCollections) throw new WebLibraryError('RESOURCE_LIMIT', 'Collection limit reached');
    const value: WebLibraryCollection = { version: 1, id: randomId('web-collection') as WebCollectionId, name: boundedText(name, 120, true), isSystem: false, createdAt: iso(this.now()), updatedAt: iso(this.now()) };
    this.state.collections[value.id] = value; await this.persist(); return clone(value);
  }
  async listCollections(): Promise<readonly WebLibraryCollection[]> { await this.ready(); return Object.values(this.state.collections).sort((a, b) => a.name.localeCompare(b.name)).map(clone); }
  async setCollections(entryId: WebLibraryId, collectionIds: readonly string[]): Promise<WebLibraryEntry> { await this.ready(); const entry = await this.requireReadableEntry(entryId); const next = this.updateEntry(entryId, { collectionIds }); await this.persist(); return clone(next); }
  async setTags(entryId: WebLibraryId, tags: readonly string[]): Promise<WebLibraryEntry> { await this.ready(); await this.requireReadableEntry(entryId); const next = this.updateEntry(entryId, { tags }); await this.persist(); return clone(next); }
  async setFavorite(entryId: WebLibraryId, favorite: boolean): Promise<WebLibraryEntry> { await this.ready(); await this.requireReadableEntry(entryId); const next = this.updateEntry(entryId, { favorite }); await this.persist(); return clone(next); }
  async setReadState(entryId: WebLibraryId, readState: WebReadState): Promise<WebLibraryEntry> { await this.ready(); await this.requireReadableEntry(entryId); const next = this.updateEntry(entryId, { readState }); await this.persist(); return clone(next); }
  async addToReadLater(entryId: WebLibraryId): Promise<WebLibraryEntry> { await this.ready(); return this.setCollections(entryId, [...(await this.requireReadableEntry(entryId)).collectionIds, READ_LATER_ID]); }

  async addHighlight(input: { readonly entryId: WebLibraryId; readonly revisionId: WebRevisionId; readonly start: number; readonly end: number; readonly quote: string; readonly note?: string }): Promise<WebAnnotation> {
    return this.addAnnotation({ ...input, kind: 'HIGHLIGHT', ...(input.note ? { body: input.note } : {}) });
  }
  async addNote(input: { readonly entryId: WebLibraryId; readonly revisionId: WebRevisionId; readonly body: string; readonly start?: number; readonly end?: number; readonly quote?: string }): Promise<WebAnnotation> { return this.addAnnotation({ ...input, kind: 'NOTE' }); }
  async addNotes(inputs: readonly { readonly entryId: WebLibraryId; readonly revisionId: WebRevisionId; readonly body: string; readonly start?: number; readonly end?: number; readonly quote?: string }[]): Promise<readonly WebAnnotation[]> {
    await this.ready();
    if (inputs.length > this.maxAnnotations || Object.keys(this.state.annotations).length + inputs.length > this.maxAnnotations) throw new WebLibraryError('RESOURCE_LIMIT', 'Bulk annotation input exceeds the annotation bound');
    const output = inputs.map(input => this.addAnnotationInternal({ ...input, kind: 'NOTE' }, true));
    this.rebuildIndex();
    await this.persist();
    return output.map(clone);
  }
  async listAnnotations(entryId: WebLibraryId, revisionId?: WebRevisionId): Promise<readonly WebAnnotation[]> { await this.ready(); await this.requireReadableEntry(entryId); return Object.values(this.state.annotations).filter(value => value.entryId === entryId && (!revisionId || value.revisionId === revisionId)).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(clone); }
  async deleteAnnotation(annotationId: WebAnnotationId): Promise<void> { await this.ready(); if (!this.state.annotations[annotationId]) return; delete this.state.annotations[annotationId]; await this.persist(); }

  async diff(entryId: WebLibraryId, fromRevisionId: WebRevisionId, toRevisionId: WebRevisionId): Promise<WebRevisionDiff> {
    const from = await this.getRevision(entryId, fromRevisionId); const to = await this.getRevision(entryId, toRevisionId);
    if (!from || !to) throw new WebLibraryError('NOT_FOUND', 'Revision not found');
    return boundedLineDiff(from.readerDocument.text, to.readerDocument.text, from.id, to.id);
  }

  async sharePlan(entryId: WebLibraryId, input: { readonly kind: 'SOURCE_LINK' | 'ARCHIVE_COPY' | 'QUOTE'; readonly revisionId?: WebRevisionId; readonly quote?: string }): Promise<WebSharePlan> {
    const entry = await this.requireReadableEntry(entryId); const revision = input.kind === 'SOURCE_LINK' ? undefined : await this.getRevision(entryId, input.revisionId);
    if (input.kind !== 'SOURCE_LINK' && !revision) throw new WebLibraryError('NOT_FOUND', 'Revision not found');
    const text = input.kind === 'QUOTE' ? boundedText(input.quote, 16_384, true) : undefined;
    return { kind: input.kind, explicit: true, private: true, sourceUrl: entry.sourceUrl, entryId, ...(revision ? { revisionId: revision.id, contentId: revision.safeHtmlContentId } : {}), ...(text ? { text } : {}), provenance: { sourceUrl: entry.sourceUrl, ...(revision ? { capturedAt: revision.capturedAt, revisionId: revision.id } : {}) } };
  }

  async share(entryId: WebLibraryId, adapter: WebLibraryShareBoundary, input: { readonly destination: 'OWNED_DEVICE' | 'NEARBY' | 'PERSONAL_WEB'; readonly targetId?: string; readonly revisionId?: WebRevisionId; readonly ownerConfirmed: true }): Promise<{ readonly id: string; readonly destination: 'OWNED_DEVICE' | 'NEARBY' | 'PERSONAL_WEB' }> {
    if (input.ownerConfirmed !== true) throw new WebLibraryError('UNAUTHORIZED', 'Web Library sharing requires explicit owner confirmation');
    const plan = await this.sharePlan(entryId, { kind: 'ARCHIVE_COPY', ...(input.revisionId ? { revisionId: input.revisionId } : {}) });
    if (!plan.contentId) throw new WebLibraryError('NOT_FOUND', 'Archive copy is unavailable');
    return adapter.share({ destination: input.destination, ...(input.targetId ? { targetId: input.targetId } : {}), plan, ownerConfirmed: true });
  }

  async exportToVault(entryId: WebLibraryId, adapter: WebLibraryVaultAdapter, revisionId?: WebRevisionId): Promise<{ readonly noteId: string }> {
    const entry = await this.requireReadableEntry(entryId); const revision = await this.getRevision(entryId, revisionId); if (!revision) throw new WebLibraryError('NOT_FOUND', 'Archive revision not found');
    return adapter.createNote({ title: entry.title, markdown: readerDocumentToMarkdown(revision.readerDocument), provenance: { sourceUrl: entry.sourceUrl, capturedAt: revision.capturedAt, revisionId: revision.id } });
  }

  /**
   * Installs an explicitly supplied archive bundle into this local library.
   * The resolver receives only a content id and its already-validated
   * manifest; no URL, origin, cookie, header, or manifest fetch is performed
   * by this service.  This is the owned-device/Continuity sync boundary.
   */
  async importArchiveBundle(bundle: WebArchiveBundle, resolver: WebArchiveContentResolver): Promise<WebLibraryEntry> {
    await this.ready();
    if (!bundle || bundle.version !== 1 || bundle.protocol !== WEB_LIBRARY_PROTOCOL || !isEntry(bundle.entry) || !Array.isArray(bundle.revisions) || !Array.isArray(bundle.annotations) || !Array.isArray(bundle.manifests)) throw new WebLibraryError('CORRUPT_STATE', 'Web archive bundle is invalid');
    if (bundle.revisions.length > this.maxRevisionsPerEntry || bundle.annotations.length > this.maxAnnotations || bundle.manifests.length > 512) throw new WebLibraryError('RESOURCE_LIMIT', 'Web archive bundle exceeds import bounds');

    const revisions = bundle.revisions.map(clone);
    const revisionIds = new Set<string>();
    for (const revision of revisions) {
      if (!isRevision(revision) || revision.entryId !== bundle.entry.id || revisionIds.has(revision.id) || !bundle.entry.revisionIds.includes(revision.id) || revision.sourceUrl !== bundle.entry.sourceUrl) throw new WebLibraryError('CORRUPT_STATE', 'Web archive revision does not match its entry');
      revisionIds.add(revision.id);
    }
    const collections = bundle.collections ?? [];
    if (collections.length > this.maxCollections) throw new WebLibraryError('RESOURCE_LIMIT', 'Web archive bundle contains too many collections');
    for (const collection of collections) if (!isCollection(collection)) throw new WebLibraryError('CORRUPT_STATE', 'Web archive collection is invalid');
    if (bundle.collections && bundle.entry.collectionIds.some(id => !collections.some(collection => collection.id === id) && !this.state.collections[id])) throw new WebLibraryError('CORRUPT_STATE', 'Web archive entry references a missing collection');

    const manifests = new Map<string, ContentManifest>();
    const referencedContentIds = new Set<string>();
    for (const revision of revisions) {
      referencedContentIds.add(revision.safeHtmlContentId);
      for (const resource of revision.resources) if (resource.contentId) referencedContentIds.add(resource.contentId);
    }
    for (const manifest of bundle.manifests) {
      let parsed: ContentManifest;
      try { parsed = contentManifestSchema.parse(manifest) as ContentManifest; } catch { throw new WebLibraryError('CORRUPT_STATE', 'Web archive content manifest is invalid'); }
      if (parsed.contentPolicy && parsed.contentPolicy !== 'PRIVATE_NO_STRANGER_CACHE') throw new WebLibraryError('POLICY_DENIED', 'Web archive content must remain private');
      if (!referencedContentIds.has(parsed.contentId) || manifests.has(parsed.contentId)) continue;
      manifests.set(parsed.contentId, parsed);
    }
    if ([...referencedContentIds].some(contentId => !manifests.has(contentId))) throw new WebLibraryError('CORRUPT_STATE', 'Web archive bundle is missing referenced content');
    for (const [contentId, manifest] of manifests) {
      let bytes: Uint8Array | undefined;
      try { bytes = await resolver.resolve(contentId as ContentId, manifest); } catch { throw new WebLibraryError('UNAVAILABLE', 'Web archive content resolver failed'); }
      if (!(bytes instanceof Uint8Array) || bytes.byteLength !== manifest.byteLength) throw new WebLibraryError('INTEGRITY', 'Web archive content length does not match its manifest');
      try {
        const stored = await this.content.put({ bytes, mimeType: manifest.mimeType, ...(manifest.name ? { name: manifest.name } : {}), policy: 'PRIVATE_NO_STRANGER_CACHE' });
        if (stored.contentId !== manifest.contentId) throw new WebLibraryError('INTEGRITY', 'Web archive content hash mismatch');
      } catch (error) {
        if (error instanceof WebLibraryError) throw error;
        throw new WebLibraryError('INTEGRITY', 'Web archive content could not be stored');
      }
    }

    const existing = this.state.entries[bundle.entry.id];
    if (existing && existing.sourceUrl !== bundle.entry.sourceUrl) throw new WebLibraryError('INTEGRITY', 'Web archive entry identity conflicts with local state');
    if (!existing && Object.keys(this.state.entries).length >= this.maxEntries) throw new WebLibraryError('RESOURCE_LIMIT', 'Web Library entry limit reached');
    for (const collection of collections) {
      const local = this.state.collections[collection.id];
      if (local && local.name !== collection.name) throw new WebLibraryError('INTEGRITY', 'Web archive collection identity conflicts with local state');
      if (!local) {
        if (Object.keys(this.state.collections).length >= this.maxCollections) throw new WebLibraryError('RESOURCE_LIMIT', 'Collection limit reached');
        this.state.collections[collection.id] = clone(collection);
      }
    }
    for (const revision of revisions) {
      const local = this.state.revisions[revision.id];
      if (local && JSON.stringify(local) !== JSON.stringify(revision)) throw new WebLibraryError('INTEGRITY', 'Web archive revision identity conflicts with local state');
      if (!local) this.state.revisions[revision.id] = revision;
    }
    for (const annotation of bundle.annotations) {
      if (!isAnnotation(annotation) || annotation.entryId !== bundle.entry.id || !bundle.entry.revisionIds.includes(annotation.revisionId)) throw new WebLibraryError('CORRUPT_STATE', 'Web archive annotation does not match its entry');
      if (!this.state.revisions[annotation.revisionId]) throw new WebLibraryError('CORRUPT_STATE', 'Web archive annotation references a missing revision');
      const local = this.state.annotations[annotation.id];
      if (local && JSON.stringify(local) !== JSON.stringify(annotation)) throw new WebLibraryError('INTEGRITY', 'Web archive annotation identity conflicts with local state');
      if (!local) {
        if (Object.keys(this.state.annotations).length >= this.maxAnnotations) throw new WebLibraryError('RESOURCE_LIMIT', 'Annotation limit reached');
        this.state.annotations[annotation.id] = clone(annotation);
      }
    }

    const incomingRevisionIds = revisions.map(revision => revision.id);
    const mergedRevisionIds = [...new Set([...(existing?.revisionIds ?? []), ...incomingRevisionIds])].slice(-this.maxRevisionsPerEntry) as WebRevisionId[];
    const preferredLatest = bundle.entry.latestRevisionId && mergedRevisionIds.includes(bundle.entry.latestRevisionId) ? bundle.entry.latestRevisionId : incomingRevisionIds.at(-1) ?? existing?.latestRevisionId ?? mergedRevisionIds.at(-1);
    const collectionIds = normalizeCollectionIds([...bundle.entry.collectionIds, ...(existing?.collectionIds ?? [])], this.state.collections);
    const importedEntry: WebLibraryEntry = {
      ...clone(bundle.entry),
      kind: mergedRevisionIds.length ? 'ARCHIVE' : 'BOOKMARK',
      collectionIds,
      revisionIds: mergedRevisionIds,
      ...(preferredLatest ? { latestRevisionId: preferredLatest } : { latestRevisionId: undefined }),
      updatedAt: this.now() > Date.parse(bundle.entry.updatedAt) ? iso(this.now()) : bundle.entry.updatedAt,
    };
    this.state.entries[bundle.entry.id] = importedEntry;
    this.rebuildIndex();
    await this.persist();
    return clone(importedEntry);
  }

  async trashEntry(entryId: WebLibraryId): Promise<WebLibraryEntry> { await this.ready(); const entry = await this.requireReadableEntry(entryId); const next = this.updateEntry(entry.id, { trashed: true }); await this.persist(); return clone(next); }
  async restoreEntry(entryId: WebLibraryId): Promise<WebLibraryEntry> { await this.ready(); const entry = await this.requireEntry(entryId); const next = this.updateEntry(entry.id, { trashed: false }); await this.persist(); return clone(next); }
  async deleteRevision(entryId: WebLibraryId, revisionId: WebRevisionId): Promise<void> {
    await this.ready(); const entry = await this.requireReadableEntry(entryId); if (!entry.revisionIds.includes(revisionId)) throw new WebLibraryError('NOT_FOUND', 'Revision not found');
    const revisionIds = entry.revisionIds.filter(id => id !== revisionId); delete this.state.revisions[revisionId]; const latest = revisionIds.at(-1); this.state.entries[entryId] = { ...entry, kind: revisionIds.length ? 'ARCHIVE' : 'BOOKMARK', revisionIds, ...(latest ? { latestRevisionId: latest } : { latestRevisionId: undefined }), updatedAt: iso(this.now()) }; this.rebuildIndex(); await this.persist();
  }
  async deleteEntry(entryId: WebLibraryId, permanent = false): Promise<void> { await this.ready(); const entry = await this.requireEntry(entryId); if (!permanent) { await this.trashEntry(entryId); return; } for (const revisionId of entry.revisionIds) delete this.state.revisions[revisionId]; for (const id of Object.keys(this.state.annotations)) if (this.state.annotations[id]!.entryId === entryId) delete this.state.annotations[id]; delete this.state.entries[entryId]; this.rebuildIndex(); await this.persist(); }

  archiveUri(entryId: WebLibraryId, revisionId?: WebRevisionId): string { return `${WEB_LIBRARY_URI_SCHEME}//${WEB_LIBRARY_URI_HOST}/${encodeURIComponent(entryId)}${revisionId ? `/${encodeURIComponent(revisionId)}` : ''}`; }
  async resolve(uri: string): Promise<WebArchiveRender | undefined> { const parsed = parseArchiveUri(uri); return parsed ? this.render(parsed.entryId, parsed.revisionId) : undefined; }

  private async hydrate(): Promise<void> { const stored = await this.stateStore.read(); this.state = parseState(stored, { maxEntries: this.maxEntries, maxRevisions: this.maxEntries * this.maxRevisionsPerEntry, maxCollections: this.maxCollections, maxAnnotations: this.maxAnnotations }); this.rebuildIndex(); await this.persistIfNew(); }
  private async persistIfNew(): Promise<void> { if (await this.stateStore.read() === undefined) await this.persist(); }
  private async persist(): Promise<void> { const snapshot = clone(this.state); const operation = this.writes.then(() => this.stateStore.write(snapshot)); this.writes = operation.catch(() => undefined); await operation; }
  private async canRead(entry: WebLibraryEntry): Promise<boolean> { if (!this.visibility) return true; try { return await this.visibility.canRead(entry); } catch { return false; } }
  private async requireEntry(entryId: WebLibraryId): Promise<WebLibraryEntry> { const entry = this.state.entries[entryId]; if (!entry) throw new WebLibraryError('NOT_FOUND', 'Web Library entry not found'); return clone(entry); }
  private async requireReadableEntry(entryId: WebLibraryId): Promise<WebLibraryEntry> { const entry = await this.requireEntry(entryId); if (!(await this.canRead(entry))) throw new WebLibraryError('POLICY_DENIED', 'Web Library entry is not available in the current scope'); return entry; }
  private saveBookmarkInternal(input: SaveBookmarkInput): WebLibraryEntry {
    const url = safeUrl(input.url);
    const existing = Object.values(this.state.entries).find(entry => entry.sourceUrl === url && !entry.trashed);
    if (existing) return this.updateEntry(existing.id, { title: input.title, collectionIds: input.collectionIds, tags: input.tags, favorite: input.favorite });
    if (Object.keys(this.state.entries).length >= this.maxEntries) throw new WebLibraryError('RESOURCE_LIMIT', 'Web Library entry limit reached');
    const now = iso(this.now());
    const entry: WebLibraryEntry = {
      version: 1, protocol: WEB_LIBRARY_PROTOCOL, id: randomId('web-entry') as WebLibraryId, kind: 'BOOKMARK', sourceUrl: url,
      title: safeTitle(input.title, new URL(url).hostname), createdAt: now, updatedAt: now,
      collectionIds: normalizeCollectionIds(input.collectionIds, this.state.collections), tags: normalizeTags(input.tags, this.maxTagsPerEntry), favorite: input.favorite === true, readState: 'UNREAD', revisionIds: [], trashed: false, private: true,
    };
    this.state.entries[entry.id] = entry;
    this.indexEntry(entry);
    return entry;
  }
  private updateEntry(entryId: WebLibraryId, patch: { readonly title?: string; readonly collectionIds?: readonly string[]; readonly tags?: readonly string[]; readonly favorite?: boolean; readonly readState?: WebReadState; readonly trashed?: boolean }): WebLibraryEntry {
    const current = this.state.entries[entryId]; if (!current) throw new WebLibraryError('NOT_FOUND', 'Web Library entry not found'); const next: WebLibraryEntry = { ...current, ...(patch.title !== undefined ? { title: safeTitle(patch.title, current.title) } : {}), ...(patch.collectionIds ? { collectionIds: normalizeCollectionIds(patch.collectionIds, this.state.collections) } : {}), ...(patch.tags ? { tags: normalizeTags(patch.tags, this.maxTagsPerEntry) } : {}), ...(patch.favorite === undefined ? {} : { favorite: patch.favorite }), ...(patch.readState ? { readState: patch.readState } : {}), ...(patch.trashed === undefined ? {} : { trashed: patch.trashed }), updatedAt: iso(this.now()) }; this.state.entries[entryId] = next; this.rebuildIndex(); return next;
  }
  private async commitCapture(entryId: WebLibraryId, request: WebCaptureRequest, captured: WebCapturedPage): Promise<WebArchiveRevision> {
    const entry = await this.requireEntry(entryId); const policy = normalizePolicy(request.policy); const sourceUrl = safeUrl(request.url); const finalUrl = safeUrl(captured.finalUrl ?? captured.requestedUrl ?? sourceUrl, 'Final URL'); if (captured.redirectCount !== undefined && (!Number.isSafeInteger(captured.redirectCount) || captured.redirectCount < 0 || captured.redirectCount > policy.maxRedirects)) throw new WebLibraryError('RESOURCE_LIMIT', 'Redirect bound exceeded');
    const html = boundedText(captured.html, policy.maxHtmlBytes); if (!html) throw new WebLibraryError('UNSUPPORTED', 'Capture did not contain a page representation');
    const entryTitle = safeTitle(captured.title || request.title, new URL(sourceUrl).hostname); const inputResources = (captured.resources ?? []).slice(0, policy.maxResources); const resources: WebArchiveResource[] = []; const resourceByUrl = new Map<string, WebArchiveResource>(); let totalBytes = 0;
    for (const input of inputResources) {
      if (request.mode === 'READER_SNAPSHOT' || !policy.includeImages || input.kind !== 'IMAGE') { const skipped: WebArchiveResource = { version: 1, resourceId: randomId('web-resource') as WebResourceId, originalUrl: safeResourceUrl(input.originalUrl), mimeType: safeMime(input.mimeType), sizeBytes: input.bytes?.byteLength ?? 0, state: 'SKIPPED', reason: 'Capture policy excludes this resource', privateCachePolicy: contentPolicy() }; resources.push(skipped); resourceByUrl.set(skipped.originalUrl, skipped); continue; }
      if (!(input.bytes instanceof Uint8Array) || input.bytes.byteLength > policy.maxResourceBytes || totalBytes + input.bytes.byteLength > policy.maxTotalResourceBytes) { const failed: WebArchiveResource = { version: 1, resourceId: randomId('web-resource') as WebResourceId, originalUrl: safeResourceUrl(input.originalUrl), mimeType: safeMime(input.mimeType), sizeBytes: input.bytes instanceof Uint8Array ? input.bytes.byteLength : 0, state: 'FAILED', reason: 'Resource bounds exceeded', privateCachePolicy: contentPolicy() }; resources.push(failed); resourceByUrl.set(failed.originalUrl, failed); continue; }
      try { const stored = await this.content.put({ bytes: input.bytes, mimeType: safeMime(input.mimeType), name: new URL(input.originalUrl).pathname.split('/').at(-1)?.slice(0, 120), policy: contentPolicy() }); const capturedResource: WebArchiveResource = { version: 1, resourceId: randomId('web-resource') as WebResourceId, originalUrl: safeResourceUrl(input.originalUrl), mimeType: stored.manifest.mimeType, sizeBytes: input.bytes.byteLength, contentId: stored.contentId, state: 'CAPTURED', privateCachePolicy: contentPolicy() }; resources.push(capturedResource); resourceByUrl.set(capturedResource.originalUrl, capturedResource); totalBytes += input.bytes.byteLength; } catch { const failed: WebArchiveResource = { version: 1, resourceId: randomId('web-resource') as WebResourceId, originalUrl: safeResourceUrl(input.originalUrl), mimeType: safeMime(input.mimeType), sizeBytes: input.bytes.byteLength, state: 'FAILED', reason: 'Resource storage failed', privateCachePolicy: contentPolicy() }; resources.push(failed); resourceByUrl.set(failed.originalUrl, failed); }
    }
    const capturedAt = iso(this.now()); const reader = extractReaderDocument({ html, sourceUrl, title: entryTitle, byline: captured.metadata?.author, capturedAt, maxBytes: policy.maxReaderTextBytes, maxBlocks: policy.maxBlocks, resourceByUrl }); const rendered = renderReaderDocument(reader, resources); const body = await this.content.put({ bytes: new TextEncoder().encode(rendered.html), mimeType: 'text/html', name: `${entry.id}-revision.html`, policy: contentPolicy() }); const revisionNumber = entry.revisionIds.map(id => this.state.revisions[id]?.revisionNumber ?? 0).reduce((max, value) => Math.max(max, value), 0) + 1; const revision: WebArchiveRevision = { version: 1, protocol: WEB_LIBRARY_PROTOCOL, id: randomId('web-revision') as WebRevisionId, entryId, revisionNumber, captureMode: request.mode === 'BOOKMARK_ONLY' ? 'READER_SNAPSHOT' : request.mode, state: reader.extraction === 'DETERMINISTIC' ? (resources.some(resource => resource.state === 'FAILED') ? 'PARTIAL' : 'READY') : 'PARTIAL', sourceUrl, finalUrl, title: reader.title, metadata: normalizeMetadata(captured.metadata), capturedAt, readerDocument: reader, safeHtmlContentId: body.contentId, resources, privateCachePolicy: contentPolicy(), sourceDataClass: 'PRIVATE' };
    this.state.revisions[revision.id] = revision; const current = this.state.entries[entryId]!; const revisionIds = [...current.revisionIds, revision.id].slice(-this.maxRevisionsPerEntry); for (const removed of current.revisionIds.slice(0, Math.max(0, current.revisionIds.length + 1 - this.maxRevisionsPerEntry))) delete this.state.revisions[removed]; this.state.entries[entryId] = { ...current, kind: 'ARCHIVE', title: revision.title || current.title, updatedAt: capturedAt, revisionIds, latestRevisionId: revision.id }; this.rebuildIndex(); await this.persist(); return clone(revision);
  }
  private entrySearchFields(entry: WebLibraryEntry): { readonly title: string; readonly hostname: string; readonly text: string; readonly tags: readonly string[]; readonly collection: string; readonly annotation: string } {
    const revisions = entry.revisionIds.flatMap(id => {
      const revision = this.state.revisions[id];
      return revision ? [revision.readerDocument.text, revision.title, revision.metadata.siteName ?? ''] : [];
    });
    const annotationText = this.annotationTextByEntry.get(entry.id) ?? '';
    const collections = entry.collectionIds.map(id => this.state.collections[id]?.name ?? '');
    let hostname = '';
    try { hostname = new URL(entry.sourceUrl).hostname; } catch { /* Corrupt state is still searchable by title/text. */ }
    return { title: entry.title, hostname, text: revisions.join(' '), tags: entry.tags, collection: collections.join(' '), annotation: annotationText };
  }
  private entrySearchText(entry: WebLibraryEntry): string {
    const fields = this.entrySearchFields(entry);
    return [fields.title, fields.hostname, ...fields.tags, fields.collection, fields.text, fields.annotation].join(' ');
  }
  private indexEntry(entry: WebLibraryEntry): void { for (const term of tokenize(this.entrySearchText(entry))) { const set = this.tokenIndex.get(term) ?? new Set<string>(); set.add(entry.id); this.tokenIndex.set(term, set); } }
  private rebuildIndex(): void {
    this.tokenIndex.clear();
    this.annotationTextByEntry.clear();
    for (const annotation of Object.values(this.state.annotations)) {
      const value = [annotation.quote ?? '', annotation.body ?? ''].filter(Boolean).join(' ');
      this.annotationTextByEntry.set(annotation.entryId, `${this.annotationTextByEntry.get(annotation.entryId) ?? ''} ${value}`.trim());
    }
    for (const entry of Object.values(this.state.entries)) this.indexEntry(entry);
  }
  private async addAnnotation(input: { readonly entryId: WebLibraryId; readonly revisionId: WebRevisionId; readonly kind: WebAnnotationKind; readonly start?: number; readonly end?: number; readonly quote?: string; readonly body?: string }): Promise<WebAnnotation> {
    await this.ready(); const value = this.addAnnotationInternal(input); this.rebuildIndex(); await this.persist(); return clone(value);
  }
  private addAnnotationInternal(input: { readonly entryId: WebLibraryId; readonly revisionId: WebRevisionId; readonly kind: WebAnnotationKind; readonly start?: number; readonly end?: number; readonly quote?: string; readonly body?: string }, bulk = false): WebAnnotation {
    const entry = this.state.entries[input.entryId]; if (!entry) throw new WebLibraryError('NOT_FOUND', 'Web Library entry not found'); if (!this.state.revisions[input.revisionId] || this.state.revisions[input.revisionId]!.entryId !== entry.id) throw new WebLibraryError('NOT_FOUND', 'Revision not found'); if (!bulk && Object.keys(this.state.annotations).length >= this.maxAnnotations) throw new WebLibraryError('RESOURCE_LIMIT', 'Annotation limit reached'); const revision = this.state.revisions[input.revisionId]!; const text = revision.readerDocument.text; const quote = input.quote === undefined ? undefined : boundedText(input.quote, 16_384, true); const start = input.start === undefined ? undefined : boundedInt(input.start, 0, text.length, 0); const end = input.end === undefined ? undefined : boundedInt(input.end, 0, text.length, 0); if (input.kind === 'HIGHLIGHT' && (start === undefined || end === undefined || end <= start || !quote || text.slice(start, end) !== quote)) throw new WebLibraryError('INVALID_ARGUMENT', 'Highlight anchor does not match the saved revision'); const value: WebAnnotation = { version: 1, id: randomId('web-annotation') as WebAnnotationId, entryId: entry.id, revisionId: revision.id, kind: input.kind, ...(start === undefined ? {} : { start }), ...(end === undefined ? {} : { end }), ...(quote ? { quote } : {}), ...(input.body ? { body: boundedText(input.body, 16_384, true) } : {}), createdAt: iso(this.now()), updatedAt: iso(this.now()) }; this.state.annotations[value.id] = value; return value;
  }
}

function normalizePolicy(input: Partial<WebCapturePolicy> | undefined): WebCapturePolicy { return { maxHtmlBytes: boundedInt(input?.maxHtmlBytes, 1_024, 8 * 1024 * 1024, DEFAULT_WEB_CAPTURE_POLICY.maxHtmlBytes), maxReaderTextBytes: boundedInt(input?.maxReaderTextBytes, 256, 4 * 1024 * 1024, DEFAULT_WEB_CAPTURE_POLICY.maxReaderTextBytes), maxBlocks: boundedInt(input?.maxBlocks, 1, DEFAULT_WEB_CAPTURE_POLICY.maxBlocks, DEFAULT_WEB_CAPTURE_POLICY.maxBlocks), maxResources: boundedInt(input?.maxResources, 0, DEFAULT_WEB_CAPTURE_POLICY.maxResources, DEFAULT_WEB_CAPTURE_POLICY.maxResources), maxResourceBytes: boundedInt(input?.maxResourceBytes, 1, DEFAULT_WEB_CAPTURE_POLICY.maxResourceBytes, DEFAULT_WEB_CAPTURE_POLICY.maxResourceBytes), maxTotalResourceBytes: boundedInt(input?.maxTotalResourceBytes, 1, DEFAULT_WEB_CAPTURE_POLICY.maxTotalResourceBytes, DEFAULT_WEB_CAPTURE_POLICY.maxTotalResourceBytes), maxRedirects: boundedInt(input?.maxRedirects, 0, 20, DEFAULT_WEB_CAPTURE_POLICY.maxRedirects), includeImages: input?.includeImages !== false }; }
function normalizeMetadata(value: WebSourceMetadata | undefined): WebSourceMetadata { return { ...(value?.description ? { description: boundedText(value.description, 2_000) } : {}), ...(value?.siteName ? { siteName: boundedText(value.siteName, 256) } : {}), ...(value?.author ? { author: boundedText(value.author, 256) } : {}), ...(value?.claimedPublishedAt ? { claimedPublishedAt: boundedText(value.claimedPublishedAt, 128) } : {}), ...(value?.language ? { language: boundedText(value.language, 32) } : {}) }; }
function normalizeCollectionIds(values: readonly string[] | undefined, collections: Readonly<Record<string, WebLibraryCollection>>): readonly WebCollectionId[] { return [...new Set((values ?? []).filter(id => Boolean(collections[id])))] as WebCollectionId[]; }
function compareEntries(left: WebLibraryEntry, right: WebLibraryEntry): number { return right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id); }
function matchedSearchFields(fieldsInput: { readonly title: string; readonly hostname: string; readonly text: string; readonly tags: readonly string[]; readonly collection: string; readonly annotation: string }, terms: readonly string[]): WebLibrarySearchResult['matchedFields'] {
  const fields: Array<WebLibrarySearchResult['matchedFields'][number]> = [];
  const matches = (value: string): boolean => terms.some(term => value.toLocaleLowerCase().includes(term));
  if (matches(fieldsInput.title)) fields.push('title');
  if (matches(fieldsInput.hostname)) fields.push('hostname');
  if (matches(fieldsInput.text)) fields.push('text');
  if (fieldsInput.tags.some(matches)) fields.push('tag');
  if (matches(fieldsInput.collection)) fields.push('collection');
  if (matches(fieldsInput.annotation)) fields.push('annotation');
  return fields.length ? fields : ['text'];
}
function sanitizeError(error: unknown): string { const message = error instanceof Error ? error.message : 'Web capture failed'; return message.replace(/https?:\/\/[^\s]+/gi, '[origin]').slice(0, 512); }

function boundedLineDiff(from: string, to: string, fromRevisionId: WebRevisionId, toRevisionId: WebRevisionId): WebRevisionDiff {
  const oldLines = from.split('\n').slice(0, 50_000); const newLines = to.split('\n').slice(0, 50_000); const oldCounts = new Map<string, number>(); for (const line of oldLines) oldCounts.set(line, (oldCounts.get(line) ?? 0) + 1);
  const chunks: WebRevisionDiffChunk[] = []; let addedLines = 0; let removedLines = 0;
  const push = (kind: WebRevisionDiffChunk['kind'], text: string) => { if (!text) return; const previous = chunks.at(-1); if (previous?.kind === kind) chunks[chunks.length - 1] = { kind, text: `${previous.text}\n${text}` }; else chunks.push({ kind, text }); };
  for (const line of newLines) { const count = oldCounts.get(line) ?? 0; if (count > 0) { oldCounts.set(line, count - 1); push('UNCHANGED', line); } else { addedLines += 1; push('ADDED', line); } }
  for (const [line, count] of oldCounts) for (let index = 0; index < count; index += 1) { removedLines += 1; push('REMOVED', line); }
  return { fromRevisionId, toRevisionId, chunks, addedLines, removedLines, truncated: oldLines.length >= 50_000 || newLines.length >= 50_000 };
}

function parseArchiveUri(value: string): { readonly entryId: WebLibraryId; readonly revisionId?: WebRevisionId } | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== WEB_LIBRARY_URI_SCHEME || url.hostname !== WEB_LIBRARY_URI_HOST) return undefined;
    const parts = url.pathname.split('/').filter(Boolean).map(part => decodeURIComponent(part));
    if (parts.length < 1 || parts.length > 2 || parts.some(part => !part || part.length > MAX_ID_BYTES)) return undefined;
    return { entryId: parts[0] as WebLibraryId, ...(parts[1] ? { revisionId: parts[1] as WebRevisionId } : {}) };
  } catch { return undefined; }
}

/** Bounded capture worker queue. It never creates a browser process itself. */
export class WebCaptureService {
  private readonly maxConcurrent: number;
  private readonly maxQueue: number;
  private readonly queue: Array<{ readonly request: WebCaptureRequest; readonly adapter: WebCaptureAdapter; readonly signal: AbortSignal; readonly resolve: (value: WebCaptureOutcome) => void; readonly reject: (reason?: unknown) => void }> = [];
  private active = 0;
  private peak = 0;
  private completed = 0;
  private failed = 0;

  constructor(private readonly library: WebLibraryService, options: { readonly maxConcurrent?: number; readonly maxQueue?: number } = {}) {
    this.maxConcurrent = boundedInt(options.maxConcurrent, 1, 8, 2);
    this.maxQueue = boundedInt(options.maxQueue, 0, 256, 32);
  }

  capture(request: WebCaptureRequest, adapter: WebCaptureAdapter, signal = new AbortController().signal): Promise<WebCaptureOutcome> {
    if (this.active >= this.maxConcurrent && this.queue.length >= this.maxQueue) return Promise.reject(new WebLibraryError('RESOURCE_LIMIT', 'Web capture queue is full'));
    return new Promise<WebCaptureOutcome>((resolve, reject) => { this.queue.push({ request, adapter, signal, resolve, reject }); this.drain(); });
  }

  diagnostics(): WebCaptureDiagnostics { return { activeCaptures: this.active, queuedCaptures: this.queue.length, peakActiveCaptures: this.peak, completedCaptures: this.completed, failedCaptures: this.failed }; }

  private drain(): void {
    while (this.active < this.maxConcurrent && this.queue.length) {
      const job = this.queue.shift()!;
      if (job.signal.aborted) { job.reject(new WebLibraryError('CANCELED', 'Web capture was canceled before it started')); continue; }
      this.active += 1; this.peak = Math.max(this.peak, this.active);
      void this.library.capture(job.request, job.adapter, job.signal).then(value => { this.completed += 1; if (value.state === 'FAILED') this.failed += 1; job.resolve(value); }).catch(error => { this.failed += 1; job.reject(error); }).finally(() => { this.active -= 1; this.drain(); });
    }
  }
}

export interface WebArchiveBundle {
  readonly version: 1;
  readonly protocol: typeof WEB_LIBRARY_PROTOCOL;
  readonly entry: WebLibraryEntry;
  readonly revisions: readonly WebArchiveRevision[];
  readonly annotations: readonly WebAnnotation[];
  readonly manifests: readonly ContentManifest[];
  /** Optional for backwards-compatible bundles created before collection export. */
  readonly collections?: readonly WebLibraryCollection[];
}

/** Metadata-first bundle for an explicit owned-device/share boundary. */
export async function createWebArchiveBundle(library: WebLibraryService, entryId: WebLibraryId, revisionId?: WebRevisionId): Promise<WebArchiveBundle> {
  const entry = await library.getEntry(entryId); if (!entry) throw new WebLibraryError('NOT_FOUND', 'Web Library entry not found'); const revisions = (await library.listRevisions(entryId)).filter(value => !revisionId || value.id === revisionId); if (revisionId && !revisions.length) throw new WebLibraryError('NOT_FOUND', 'Web archive revision not found'); const annotations = await library.listAnnotations(entryId, revisionId); const manifests = revisions.flatMap(revision => [library.content.manifest?.(revision.safeHtmlContentId), ...revision.resources.map(resource => resource.contentId ? library.content.manifest?.(resource.contentId) : undefined)]).filter((value): value is ContentManifest => Boolean(value)); const collections = (await library.listCollections()).filter(collection => entry.collectionIds.includes(collection.id)); return { version: 1, protocol: WEB_LIBRARY_PROTOCOL, entry, revisions, annotations, manifests: [...new Map(manifests.map(manifest => [manifest.contentId, manifest])).values()], collections };
}

export interface WebArchiveContentResolver { resolve(contentId: ContentId, manifest: ContentManifest, signal?: AbortSignal): Promise<Uint8Array | undefined>; }

/** Imports only explicitly supplied bytes; manifests never trigger fetching. */
export async function importWebArchiveBundle(library: WebLibraryService, bundle: WebArchiveBundle, resolver: WebArchiveContentResolver): Promise<WebLibraryEntry> {
  return library.importArchiveBundle(bundle, resolver);
}
