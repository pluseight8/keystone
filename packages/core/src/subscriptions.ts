/**
 * R0P89 Feeds, Subscriptions & Podcasts.
 *
 * A subscription is an explicit owner relationship with an external source.
 * The source is fetched directly through FeedFetchClient; Keystone-owned
 * metadata and explicitly downloaded content remain local/owned-device state.
 * This module deliberately does not provide a central aggregator, a generic
 * proxy, a crawler, recommendation ranking, telemetry, or implicit AI access.
 */

import { ContentCache, createContentManifest, sha256, type ContentId, type ContentManifest } from './social/content.js';
import { extractReaderDocument, sanitizeArchivedHtml } from './web-library.js';
import type { DailyContextItem, DailyContextSource, DailyContextOwnerContext, DailyContextWindow } from './daily-layer.js';
import type { InboxActionId, InboxActionKind, InboxActionResult, InboxAdapterEvent, InboxAdapterListInput, InboxItemKind, InboxProjectionAdapter, InboxSourceActionInput, InboxSourceProjection, InboxSourceRef } from './inbox.js';

export const SUBSCRIPTIONS_PROTOCOL = 'keystone.subscriptions.r0p89' as const;
export const SUBSCRIPTIONS_VERSION = 1 as const;
export const SUBSCRIPTIONS_MAX_SUBSCRIPTIONS = 10_000;
export const SUBSCRIPTIONS_MAX_ENTRIES = 100_000;
export const SUBSCRIPTIONS_MAX_ENTRIES_PER_FEED = 2_000;
export const SUBSCRIPTIONS_MAX_FETCH_BYTES = 2 * 1024 * 1024;
export const SUBSCRIPTIONS_MAX_DECOMPRESSED_BYTES = 2 * 1024 * 1024;
export const SUBSCRIPTIONS_MAX_ENTRY_COUNT = 1_000;
export const SUBSCRIPTIONS_MAX_TITLE = 512;
export const SUBSCRIPTIONS_MAX_TEXT = 512 * 1024;
export const SUBSCRIPTIONS_MAX_HTML = 512 * 1024;
export const SUBSCRIPTIONS_MAX_URL = 8_192;
export const SUBSCRIPTIONS_MAX_REDIRECTS = 5;
export const SUBSCRIPTIONS_MAX_XML_DEPTH = 32;
export const SUBSCRIPTIONS_MAX_XML_ELEMENTS = 100_000;
export const SUBSCRIPTIONS_MAX_XML_ATTRIBUTES = 64;
export const SUBSCRIPTIONS_MAX_JSON_DEPTH = 64;
export const SUBSCRIPTIONS_MAX_OPML_BYTES = 4 * 1024 * 1024;
export const SUBSCRIPTIONS_MAX_OPML_OUTLINES = 10_000;
export const SUBSCRIPTIONS_MAX_OPML_DEPTH = 32;
export const SUBSCRIPTIONS_MAX_ENCLOSURE_BYTES = 4 * 1024 * 1024 * 1024;
export const SUBSCRIPTIONS_MAX_REFRESH_CONCURRENCY = 4;
export const SUBSCRIPTIONS_DEFAULT_REFRESH_MS = 30 * 60_000;
export const SUBSCRIPTIONS_MIN_REFRESH_MS = 5 * 60_000;
export const SUBSCRIPTIONS_MAX_REFRESH_MS = 7 * 24 * 60 * 60_000;

export type SubscriptionId = string & { readonly __subscriptionId: unique symbol };
export type FeedFolderId = string & { readonly __feedFolderId: unique symbol };
export type FeedEntryId = string & { readonly __feedEntryId: unique symbol };
export type FeedEnclosureId = string & { readonly __feedEnclosureId: unique symbol };

export type FeedFormat = 'RSS_2_0' | 'ATOM_1_0' | 'JSON_FEED';
export type SubscriptionStatus = 'ACTIVE' | 'PAUSED' | 'ERROR' | 'AUTH_REQUIRED' | 'DISABLED';
export type SubscriptionOrigin = 'MANUAL' | 'DISCOVERY' | 'OPML';
export type FeedReadState = 'UNREAD' | 'READ';
export type FeedEnclosureKind = 'AUDIO' | 'VIDEO' | 'OTHER';
export type FeedDownloadState = 'QUEUED' | 'DOWNLOADING' | 'PAUSED' | 'DOWNLOADED' | 'FAILED';

export type SubscriptionErrorCode =
  | 'INVALID_ARGUMENT'
  | 'INVALID_URL'
  | 'UNSUPPORTED_FORMAT'
  | 'MALFORMED_FEED'
  | 'MALFORMED_OPML'
  | 'BOUNDS_EXCEEDED'
  | 'SOURCE_UNAVAILABLE'
  | 'TIMEOUT'
  | 'TLS_ERROR'
  | 'AUTH_REQUIRED'
  | 'RATE_LIMITED'
  | 'REDIRECT_LOOP'
  | 'INSECURE_REDIRECT'
  | 'SSRF_BLOCKED'
  | 'UNSAFE_URL'
  | 'OFFLINE'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'POLICY_DENIED'
  | 'INTEGRITY'
  | 'CORRUPT_STATE'
  | 'UNSUPPORTED'
  | 'UNAVAILABLE';

export class SubscriptionError extends Error {
  constructor(readonly code: SubscriptionErrorCode, message: string, readonly transient = false, readonly status?: number) {
    super(message);
    this.name = 'SubscriptionError';
  }
}

export interface SubscriptionStateStore {
  read(): Promise<unknown | undefined>;
  write(value: unknown): Promise<void>;
}

export class InMemorySubscriptionStateStore implements SubscriptionStateStore {
  private value?: unknown;
  async read(): Promise<unknown | undefined> { return this.value === undefined ? undefined : structuredClone(this.value); }
  async write(value: unknown): Promise<void> { this.value = structuredClone(value); }
}

export interface FeedRefreshPolicy {
  readonly enabled: boolean;
  readonly notifyOnNewItems: boolean;
  readonly autoDownloadEpisodes: boolean;
  readonly maxAutoDownloadEpisodes: number;
  readonly refreshIntervalMs: number;
}

export interface FeedSubscription {
  readonly version: 1;
  readonly protocol: typeof SUBSCRIPTIONS_PROTOCOL;
  readonly id: SubscriptionId;
  readonly canonicalUrl: string;
  readonly hostname: string;
  readonly title: string;
  readonly format?: FeedFormat;
  readonly origin: SubscriptionOrigin;
  readonly state: SubscriptionStatus;
  /** Persisted intent only. Runtime private-network authorization is separate. */
  readonly privateNetworkRequested: boolean;
  readonly folderIds: readonly FeedFolderId[];
  readonly refresh: FeedRefreshPolicy;
  readonly etag?: string;
  readonly lastModified?: string;
  readonly lastAttemptAt?: string;
  readonly lastSuccessfulRefreshAt?: string;
  readonly nextRefreshAt?: string;
  readonly lastError?: { readonly code: SubscriptionErrorCode; readonly message: string; readonly at: string };
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly revision: { readonly clock: number; readonly deviceId: string };
}

export interface FeedFolder {
  readonly version: 1;
  readonly id: FeedFolderId;
  readonly name: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type FeedEntryContent =
  | { readonly kind: 'HTML'; readonly html: string; readonly text: string; readonly externalRequestCount: 0; readonly scriptsExecuted: 0; readonly formsSubmitted: 0 }
  | { readonly kind: 'TEXT'; readonly text: string; readonly externalRequestCount: 0; readonly scriptsExecuted: 0; readonly formsSubmitted: 0 }
  | { readonly kind: 'SUMMARY'; readonly text: string; readonly externalRequestCount: 0; readonly scriptsExecuted: 0; readonly formsSubmitted: 0 };

export interface FeedEnclosure {
  readonly version: 1;
  readonly id: FeedEnclosureId;
  readonly url: string;
  readonly mimeType?: string;
  readonly lengthBytes?: number;
  readonly title?: string;
  readonly durationMs?: number;
  readonly kind: FeedEnclosureKind;
}

export interface FeedEnclosureDownload {
  readonly state: FeedDownloadState;
  readonly bytesDownloaded: number;
  readonly totalBytes?: number;
  readonly contentId?: ContentId;
  readonly contentHash?: string;
  readonly mimeType?: string;
  readonly playbackPositionMs?: number;
  readonly updatedAt: string;
  readonly error?: string;
}

export interface FeedEntry {
  readonly version: 1;
  readonly protocol: typeof SUBSCRIPTIONS_PROTOCOL;
  readonly id: FeedEntryId;
  readonly subscriptionId: SubscriptionId;
  readonly sourceItemId: string;
  readonly sourceNamespace: string;
  readonly title: string;
  readonly url?: string;
  readonly externalUrl?: string;
  readonly author?: string;
  readonly publishedAt?: string;
  readonly updatedAt?: string;
  readonly firstSeenAt: string;
  readonly sortTime: string;
  readonly categories: readonly string[];
  readonly tags: readonly string[];
  readonly content: FeedEntryContent;
  readonly enclosures: readonly FeedEnclosure[];
  readonly readState: FeedReadState;
  readonly favorite: boolean;
  readonly savedWebLibraryEntryId?: string;
  readonly downloads: Readonly<Record<string, FeedEnclosureDownload>>;
  readonly revision: number;
}

export interface SubscriptionState {
  readonly version: 1;
  readonly protocol: typeof SUBSCRIPTIONS_PROTOCOL;
  readonly subscriptions: Readonly<Record<string, FeedSubscription>>;
  readonly folders: Readonly<Record<string, FeedFolder>>;
  readonly entries: Readonly<Record<string, FeedEntry>>;
}

export interface FeedHttpRequest {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
}

export type FeedResponseBody = Uint8Array | string | ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>;

export interface FeedHttpResponse {
  readonly status: number;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>> | Headers;
  readonly body?: FeedResponseBody;
}

/** The only HTTP boundary used by FeedFetchClient. It carries no cookies or Keystone identity. */
export interface FeedHttpTransport {
  request(input: FeedHttpRequest): Promise<FeedHttpResponse>;
}

export class FetchFeedHttpTransport implements FeedHttpTransport {
  constructor(private readonly fetchImpl: typeof fetch = globalThis.fetch) {}

  async request(input: FeedHttpRequest): Promise<FeedHttpResponse> {
    if (typeof this.fetchImpl !== 'function') throw new SubscriptionError('SOURCE_UNAVAILABLE', 'The external HTTP host is unavailable', true);
    try {
      const response = await this.fetchImpl(input.url, {
        method: 'GET',
        headers: input.headers,
        redirect: 'manual',
        credentials: 'omit',
        signal: input.signal ?? new AbortController().signal,
      });
      return { status: response.status, url: response.url || input.url, headers: response.headers, body: response.body ?? undefined };
    } catch (error) {
      if (input.signal?.aborted) throw new SubscriptionError('TIMEOUT', 'Feed request timed out or was canceled', true);
      const message = error instanceof Error ? error.message : 'External feed request failed';
      if (/certificate|tls|ssl/i.test(message)) throw new SubscriptionError('TLS_ERROR', 'The feed certificate is invalid', false);
      throw new SubscriptionError('SOURCE_UNAVAILABLE', 'The feed source is temporarily unavailable', true);
    }
  }
}

export interface FeedFetchInput {
  readonly url: string;
  readonly etag?: string;
  readonly lastModified?: string;
  readonly allowPrivateNetwork?: boolean;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
}

export interface FeedFetchResult {
  readonly status: 'OK' | 'NOT_MODIFIED';
  readonly finalUrl: string;
  readonly contentType?: string;
  readonly etag?: string;
  readonly lastModified?: string;
  readonly bytes?: Uint8Array;
  readonly receivedBytes: number;
}

export interface FeedStreamResult {
  readonly status: 'OK' | 'NOT_MODIFIED';
  readonly finalUrl: string;
  readonly contentType?: string;
  readonly etag?: string;
  readonly lastModified?: string;
  readonly receivedBytes: number;
  readonly statusCode: number;
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const RETRY_AFTER = /^\s*(\d+)\s*$/;

/** Bounded direct external fetch; redirect, TLS, SSRF and compression limits live here. */
export class FeedFetchClient {
  private readonly transport: FeedHttpTransport;
  constructor(transport: FeedHttpTransport = new FetchFeedHttpTransport(), private readonly defaults: { readonly maxRedirects?: number; readonly timeoutMs?: number; readonly maxBytes?: number } = {}) { this.transport = transport; }

  async fetch(input: FeedFetchInput): Promise<FeedFetchResult> {
    const chunks: Uint8Array[] = []; let total = 0;
    const response = await this.stream(input, async chunk => { chunks.push(chunk.slice()); total += chunk.byteLength; });
    if (response.status === 'NOT_MODIFIED') return response;
    if (!total) throw new SubscriptionError('MALFORMED_FEED', 'The feed response was empty');
    const bytes = new Uint8Array(total); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return { ...response, bytes, receivedBytes: total };
  }

  async stream(input: FeedFetchInput, onChunk: (chunk: Uint8Array) => Promise<void> | void): Promise<FeedStreamResult> {
    const initialUrl = canonicalFeedUrl(input.url);
    const maxRedirects = Math.max(0, Math.min(SUBSCRIPTIONS_MAX_REDIRECTS, Math.floor(this.defaults.maxRedirects ?? SUBSCRIPTIONS_MAX_REDIRECTS)));
    const maxBytes = Math.max(1, Math.min(SUBSCRIPTIONS_MAX_DECOMPRESSED_BYTES, Math.floor(input.maxBytes ?? this.defaults.maxBytes ?? SUBSCRIPTIONS_MAX_FETCH_BYTES)));
    let url = initialUrl;
    let redirects = 0;
    let etag = input.etag;
    let lastModified = input.lastModified;
    while (true) {
      if (!input.allowPrivateNetwork && isPrivateFeedUrl(url)) throw new SubscriptionError('SSRF_BLOCKED', 'Private-network feed access requires explicit owner authorization');
      const response = await this.requestWithTimeout({
        url,
        headers: {
          accept: 'application/rss+xml, application/atom+xml, application/feed+json, application/json, text/xml, application/xml;q=0.9, */*;q=0.1',
          'user-agent': 'Keystone/0.1 (local-first feed reader; +https://keystone.local/feeds)',
          ...(etag ? { 'if-none-match': etag } : {}),
          ...(lastModified ? { 'if-modified-since': lastModified } : {}),
        },
        signal: input.signal ?? new AbortController().signal,
      }, input.timeoutMs ?? this.defaults.timeoutMs ?? 30_000);
      if (REDIRECTS.has(response.status)) {
        if (redirects >= maxRedirects) throw new SubscriptionError('REDIRECT_LOOP', 'Feed redirect limit exceeded');
        const location = header(response.headers, 'location');
        if (!location) throw new SubscriptionError('SOURCE_UNAVAILABLE', 'Feed redirect has no destination');
        const next = safeRedirectUrl(url, location, input.allowPrivateNetwork === true);
        if (next === url) throw new SubscriptionError('REDIRECT_LOOP', 'Feed redirect loop detected');
        url = next; redirects += 1; continue;
      }
      const contentType = header(response.headers, 'content-type');
      const responseEtag = header(response.headers, 'etag');
      const responseLastModified = header(response.headers, 'last-modified');
      etag = responseEtag ?? etag;
      lastModified = responseLastModified ?? lastModified;
      if (response.status === 304) return { status: 'NOT_MODIFIED', finalUrl: url, ...(contentType ? { contentType } : {}), ...(etag ? { etag } : {}), ...(lastModified ? { lastModified } : {}), receivedBytes: 0, statusCode: response.status };
      if (response.status === 401 || response.status === 403) throw new SubscriptionError('AUTH_REQUIRED', 'This feed requires authentication that is not configured', false, response.status);
      if (response.status === 429) { const retryAfter = header(response.headers, 'retry-after'); throw new SubscriptionError('RATE_LIMITED', retryAfter && RETRY_AFTER.test(retryAfter) ? `Feed rate limited; retry after ${retryAfter}s` : 'Feed rate limited', true, response.status); }
      if (response.status === 408 || response.status >= 500) throw new SubscriptionError('SOURCE_UNAVAILABLE', 'The feed source is temporarily unavailable', true, response.status);
      if (response.status < 200 || response.status >= 300) throw new SubscriptionError('SOURCE_UNAVAILABLE', `Feed source returned HTTP ${response.status}`, false, response.status);
      const length = Number(header(response.headers, 'content-length'));
      if (Number.isSafeInteger(length) && length > maxBytes) throw new SubscriptionError('BOUNDS_EXCEEDED', 'Feed response exceeds the bounded response limit');
      let receivedBytes = 0;
      await consumeBody(response.body, async (chunk) => { receivedBytes += chunk.byteLength; if (receivedBytes > maxBytes) throw new SubscriptionError('BOUNDS_EXCEEDED', 'Feed response exceeds the bounded decompressed limit'); await onChunk(chunk); });
      return { status: 'OK', finalUrl: url, ...(contentType ? { contentType } : {}), ...(etag ? { etag } : {}), ...(lastModified ? { lastModified } : {}), receivedBytes, statusCode: response.status };
    }
  }

  async download(input: FeedFetchInput & { readonly rangeStart?: number; readonly onChunk: (chunk: Uint8Array) => Promise<void> | void; readonly onResponse?: (status: number) => Promise<void> | void; readonly maxBytes?: number }): Promise<FeedStreamResult> {
    // Enclosure downloads use the same boundary as feed refreshes. Redirects
    // are revalidated at every hop and Range is never sent to an unsafe hop.
    const maxRedirects = Math.max(0, Math.min(SUBSCRIPTIONS_MAX_REDIRECTS, Math.floor(this.defaults.maxRedirects ?? SUBSCRIPTIONS_MAX_REDIRECTS)));
    const maxBytes = Math.max(1, Math.min(SUBSCRIPTIONS_MAX_ENCLOSURE_BYTES, Math.floor(input.maxBytes ?? SUBSCRIPTIONS_MAX_ENCLOSURE_BYTES)));
    const requestSignal = input.signal ?? new AbortController().signal;
    const allowPrivateNetwork = input.allowPrivateNetwork === true;
    let url = canonicalFeedUrl(input.url);
    let redirects = 0;
    while (true) {
      if (!allowPrivateNetwork && isPrivateFeedUrl(url)) throw new SubscriptionError('SSRF_BLOCKED', 'Private-network enclosure access requires explicit owner authorization');
      const response = await this.requestWithTimeout({ url, headers: { accept: '*/*', 'user-agent': 'Keystone/0.1 (local-first feed reader)', ...(input.rangeStart && input.rangeStart > 0 ? { range: `bytes=${Math.floor(input.rangeStart)}-` } : {}) }, signal: requestSignal }, input.timeoutMs ?? this.defaults.timeoutMs ?? 60_000);
      if (REDIRECTS.has(response.status)) {
        if (redirects >= maxRedirects) throw new SubscriptionError('REDIRECT_LOOP', 'Enclosure redirect limit exceeded');
        const location = header(response.headers, 'location');
        if (!location) throw new SubscriptionError('SOURCE_UNAVAILABLE', 'Enclosure redirect has no destination');
        const next = safeRedirectUrl(url, location, allowPrivateNetwork);
        if (next === url) throw new SubscriptionError('REDIRECT_LOOP', 'Enclosure redirect loop detected');
        url = next; redirects += 1; continue;
      }
      await input.onResponse?.(response.status);
      if (response.status === 206 || response.status === 200) {
        const length = Number(header(response.headers, 'content-length'));
        if (Number.isSafeInteger(length) && length > maxBytes) throw new SubscriptionError('BOUNDS_EXCEEDED', 'Enclosure exceeds the bounded download limit');
        let receivedBytes = 0;
        await consumeBody(response.body, async chunk => { receivedBytes += chunk.byteLength; if (receivedBytes > maxBytes) throw new SubscriptionError('BOUNDS_EXCEEDED', 'Enclosure exceeds the bounded download limit'); await input.onChunk(chunk); });
        const contentType = header(response.headers, 'content-type');
        return { status: 'OK', finalUrl: url, ...(contentType ? { contentType } : {}), ...(header(response.headers, 'etag') ? { etag: header(response.headers, 'etag') } : {}), receivedBytes, statusCode: response.status };
      }
      if (response.status === 416) throw new SubscriptionError('CONFLICT', 'Enclosure range is no longer valid', true, response.status);
      if (response.status === 401 || response.status === 403) throw new SubscriptionError('AUTH_REQUIRED', 'This enclosure requires authentication that is not configured', false, response.status);
      if (response.status >= 500 || response.status === 408) throw new SubscriptionError('SOURCE_UNAVAILABLE', 'Enclosure source is temporarily unavailable', true, response.status);
      throw new SubscriptionError('SOURCE_UNAVAILABLE', `Enclosure source returned HTTP ${response.status}`, false, response.status);
    }
  }

  private async requestWithTimeout(request: FeedHttpRequest, timeoutMs: number): Promise<FeedHttpResponse> {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, Math.max(1, Math.min(180_000, timeoutMs)));
    const onAbort = () => controller.abort();
    request.signal.addEventListener('abort', onAbort, { once: true });
    try { return await this.transport.request({ ...request, signal: controller.signal }); } catch (error) { if (timedOut) throw new SubscriptionError('TIMEOUT', 'Feed request timed out', true); throw error; }
    finally { clearTimeout(timer); request.signal.removeEventListener('abort', onAbort); }
  }
}

interface XmlNode { readonly name: string; readonly localName: string; readonly attrs: Readonly<Record<string, string>>; readonly children: XmlNode[]; text: string; }
interface ParsedFeedEntry { sourceItemId?: string; title: string; url?: string; externalUrl?: string; author?: string; publishedAt?: string; updatedAt?: string; summary?: string; contentHtml?: string; contentText?: string; categories: string[]; enclosures: Omit<FeedEnclosure, 'id' | 'version'>[]; }
export interface ParsedFeed { readonly format: FeedFormat; readonly title: string; readonly homePageUrl?: string; readonly feedUrl?: string; readonly description?: string; readonly language?: string; readonly entries: readonly ParsedFeedEntry[]; readonly warnings: readonly string[]; }

export interface FeedParserOptions { readonly maxBytes?: number; readonly maxEntries?: number; readonly maxXmlDepth?: number; readonly maxXmlElements?: number; readonly maxFieldBytes?: number; }

/** Format detection and parsing happen after bounded response collection. */
export class FeedParser {
  constructor(private readonly options: FeedParserOptions = {}) {}
  parse(bytes: Uint8Array, contentType?: string, sourceUrl = 'https://invalid.local/feed'): ParsedFeed {
    const maxBytes = Math.min(SUBSCRIPTIONS_MAX_FETCH_BYTES, this.options.maxBytes ?? SUBSCRIPTIONS_MAX_FETCH_BYTES);
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > maxBytes) throw new SubscriptionError('BOUNDS_EXCEEDED', 'Feed document exceeds the parser limit');
    const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes).replace(/^\uFEFF/, '').trim();
    if (!text) throw new SubscriptionError('MALFORMED_FEED', 'Feed document is empty');
    if (text.startsWith('<')) return this.parseXml(text, sourceUrl);
    if (text.startsWith('{') || /json/i.test(contentType ?? '')) return this.parseJson(text, sourceUrl);
    throw new SubscriptionError('UNSUPPORTED_FORMAT', 'Feed format is not recognized from its content');
  }

  private parseXml(text: string, sourceUrl: string): ParsedFeed {
    if (/<!DOCTYPE|<!ENTITY|<!NOTATION|<!\[(?!CDATA\[)/i.test(text)) throw new SubscriptionError('MALFORMED_FEED', 'XML DTD and external entities are disabled');
    const root = parseXmlDocument(text, { maxDepth: this.options.maxXmlDepth ?? SUBSCRIPTIONS_MAX_XML_DEPTH, maxElements: this.options.maxXmlElements ?? SUBSCRIPTIONS_MAX_XML_ELEMENTS, maxAttributes: SUBSCRIPTIONS_MAX_XML_ATTRIBUTES, maxTextBytes: this.options.maxFieldBytes ?? SUBSCRIPTIONS_MAX_TEXT });
    if (root.localName === 'rss' || root.localName === 'rdf' || root.localName === 'RDF'.toLocaleLowerCase()) return parseRss(root, sourceUrl, this.options);
    if (root.localName === 'feed') return parseAtom(root, sourceUrl, this.options);
    throw new SubscriptionError('UNSUPPORTED_FORMAT', 'XML document is not an RSS or Atom feed');
  }

  private parseJson(text: string, sourceUrl: string): ParsedFeed {
    const maxDepth = this.options.maxXmlDepth ?? SUBSCRIPTIONS_MAX_JSON_DEPTH;
    scanJsonDepth(text, maxDepth);
    let value: unknown;
    try { value = JSON.parse(text); } catch { throw new SubscriptionError('MALFORMED_FEED', 'JSON Feed document is malformed'); }
    if (!isRecord(value) || typeof value.version !== 'string' || !/^https:\/\/jsonfeed\.org\/version\//i.test(value.version) || !Array.isArray(value.items)) throw new SubscriptionError('UNSUPPORTED_FORMAT', 'JSON document is not a supported JSON Feed');
    if (value.items.length > (this.options.maxEntries ?? SUBSCRIPTIONS_MAX_ENTRY_COUNT)) throw new SubscriptionError('BOUNDS_EXCEEDED', 'JSON Feed contains too many entries');
    const fieldMax = this.options.maxFieldBytes ?? SUBSCRIPTIONS_MAX_TEXT;
    const entries: ParsedFeedEntry[] = [];
    for (const raw of value.items) {
      if (!isRecord(raw)) continue;
      const title = boundedText(raw.title, SUBSCRIPTIONS_MAX_TITLE) || 'Untitled entry';
      const contentHtml = boundedText(raw.content_html, Math.min(SUBSCRIPTIONS_MAX_HTML, fieldMax));
      const contentText = boundedText(raw.content_text, Math.min(SUBSCRIPTIONS_MAX_TEXT, fieldMax));
      const url = optionalSafeUrl(raw.url, sourceUrl);
      const externalUrl = optionalSafeUrl(raw.external_url, sourceUrl);
      const attachments: Omit<FeedEnclosure, 'id' | 'version'>[] = [];
      if (Array.isArray(raw.attachments)) for (const attachment of raw.attachments.slice(0, 32)) if (isRecord(attachment)) { const attachmentUrl = optionalSafeUrl(attachment.url, sourceUrl); if (attachmentUrl) attachments.push(enclosureFrom(attachmentUrl, attachment.mime_type, attachment.title, attachment.size_in_bytes, attachment.duration_in_seconds)); }
      entries.push({ sourceItemId: boundedText(raw.id, 512) || undefined, title, ...(url ? { url } : {}), ...(externalUrl ? { externalUrl } : {}), ...(jsonAuthor(raw.authors) ? { author: jsonAuthor(raw.authors) } : {}), ...(safeDate(raw.date_published) ? { publishedAt: safeDate(raw.date_published) } : {}), ...(safeDate(raw.date_modified) ? { updatedAt: safeDate(raw.date_modified) } : {}), ...(contentHtml ? { contentHtml: sanitizeFeedHtml(contentHtml, sourceUrl) } : {}), ...(contentText ? { contentText } : {}), ...(boundedText(raw.summary, fieldMax) ? { summary: boundedText(raw.summary, fieldMax) } : {}), categories: arrayText(raw.tags, 64, 160), enclosures: attachments });
    }
    return { format: 'JSON_FEED', title: boundedText(value.title, SUBSCRIPTIONS_MAX_TITLE) || new URL(sourceUrl).hostname, ...(optionalSafeUrl(value.home_page_url, sourceUrl) ? { homePageUrl: optionalSafeUrl(value.home_page_url, sourceUrl) } : {}), ...(optionalSafeUrl(value.feed_url, sourceUrl) ? { feedUrl: optionalSafeUrl(value.feed_url, sourceUrl) } : {}), ...(boundedText(value.description, fieldMax) ? { description: boundedText(value.description, fieldMax) } : {}), entries, warnings: [] };
  }
}

export function parseFeed(bytes: Uint8Array, contentType?: string, sourceUrl?: string, options?: FeedParserOptions): ParsedFeed { return new FeedParser(options).parse(bytes, contentType, sourceUrl); }

function parseRss(root: XmlNode, sourceUrl: string, options: FeedParserOptions): ParsedFeed {
  const channel = child(root, 'channel') ?? root;
  const entries = children(channel, 'item').slice(0, options.maxEntries ?? SUBSCRIPTIONS_MAX_ENTRY_COUNT).map(item => {
    const link = optionalSafeUrl(textOf(child(item, 'link')), sourceUrl);
    const content = textOf(childLocal(item, 'encoded'));
    const description = textOf(child(item, 'description'));
    const descriptionHtml = description.includes('<') ? sanitizeFeedHtml(description, sourceUrl) : undefined;
    const categories = children(item, 'category').map(value => boundedText(textOf(value), 160)).filter(Boolean).slice(0, 64);
    const enclosures = children(item, 'enclosure').slice(0, 16).flatMap(value => { const url = optionalSafeUrl(value.attrs.url, sourceUrl); return url ? [enclosureFrom(url, value.attrs.type, value.attrs.title, numberValue(value.attrs.length), numberValue(value.attrs.duration))] : []; });
    const publishedAt = safeDate(textOf(child(item, 'pubdate')));
    return { sourceItemId: boundedText(textOf(child(item, 'guid')), 512) || undefined, title: boundedText(textOf(child(item, 'title')), SUBSCRIPTIONS_MAX_TITLE) || 'Untitled entry', ...(link ? { url: link } : {}), ...(boundedText(textOf(childLocal(item, 'author')) || textOf(childLocal(item, 'creator')), 320) ? { author: boundedText(textOf(childLocal(item, 'author')) || textOf(childLocal(item, 'creator')), 320) } : {}), ...(publishedAt ? { publishedAt } : {}), ...(content ? { contentHtml: sanitizeFeedHtml(content, sourceUrl) } : descriptionHtml ? { contentHtml: descriptionHtml } : {}), ...(description && !descriptionHtml && !content ? { summary: description } : {}), categories, enclosures } satisfies ParsedFeedEntry;
  });
  const title = boundedText(textOf(child(channel, 'title')), SUBSCRIPTIONS_MAX_TITLE) || new URL(sourceUrl).hostname;
  const link = optionalSafeUrl(textOf(child(channel, 'link')), sourceUrl);
  return { format: 'RSS_2_0', title, ...(link ? { homePageUrl: link } : {}), ...(boundedText(textOf(child(channel, 'description')), SUBSCRIPTIONS_MAX_TEXT) ? { description: boundedText(textOf(child(channel, 'description')), SUBSCRIPTIONS_MAX_TEXT) } : {}), ...(boundedText(textOf(child(channel, 'language')), 64) ? { language: boundedText(textOf(child(channel, 'language')), 64) } : {}), entries, warnings: entries.length === 0 ? ['Feed contains no entries'] : [] };
}

function parseAtom(root: XmlNode, sourceUrl: string, options: FeedParserOptions): ParsedFeed {
  const entries = children(root, 'entry').slice(0, options.maxEntries ?? SUBSCRIPTIONS_MAX_ENTRY_COUNT).map(entry => {
    const alternate = children(entry, 'link').find(value => !value.attrs.rel || value.attrs.rel === 'alternate') ?? child(entry, 'link');
    const link = optionalSafeUrl(alternate?.attrs.href ?? textOf(alternate), sourceUrl);
    const contentNode = child(entry, 'content');
    const content = textOf(contentNode);
    const contentType = (contentNode?.attrs.type ?? '').toLocaleLowerCase();
    const summary = textOf(child(entry, 'summary'));
    const categories = children(entry, 'category').map(value => boundedText(value.attrs.term ?? textOf(value), 160)).filter(Boolean).slice(0, 64);
    const enclosures = children(entry, 'link').filter(value => value.attrs.rel === 'enclosure').slice(0, 16).flatMap(value => { const url = optionalSafeUrl(value.attrs.href, sourceUrl); return url ? [enclosureFrom(url, value.attrs.type, value.attrs.title, numberValue(value.attrs.length), numberValue(value.attrs.duration))] : []; });
    const publishedAt = safeDate(textOf(child(entry, 'published')));
    const updatedAt = safeDate(textOf(child(entry, 'updated')));
    const author = boundedText(textOf(child(child(entry, 'author'), 'name')), 320);
    return { sourceItemId: boundedText(textOf(child(entry, 'id')), 512) || undefined, title: boundedText(textOf(child(entry, 'title')), SUBSCRIPTIONS_MAX_TITLE) || 'Untitled entry', ...(link ? { url: link } : {}), ...(author ? { author } : {}), ...(publishedAt ? { publishedAt } : {}), ...(updatedAt ? { updatedAt } : {}), ...(content && contentType !== 'text' ? { contentHtml: sanitizeFeedHtml(content, sourceUrl) } : {}), ...(content && contentType === 'text' ? { contentText: boundedText(content, SUBSCRIPTIONS_MAX_TEXT) } : {}), ...(summary ? { summary } : {}), categories, enclosures } satisfies ParsedFeedEntry;
  });
  const title = boundedText(textOf(child(root, 'title')), SUBSCRIPTIONS_MAX_TITLE) || new URL(sourceUrl).hostname;
  const linkNode = children(root, 'link').find(value => !value.attrs.rel || value.attrs.rel === 'alternate') ?? child(root, 'link');
  const link = optionalSafeUrl(linkNode?.attrs.href ?? textOf(linkNode), sourceUrl);
  return { format: 'ATOM_1_0', title, ...(link ? { homePageUrl: link } : {}), ...(boundedText(textOf(child(root, 'subtitle')), SUBSCRIPTIONS_MAX_TEXT) ? { description: boundedText(textOf(child(root, 'subtitle')), SUBSCRIPTIONS_MAX_TEXT) } : {}), entries, warnings: entries.length === 0 ? ['Feed contains no entries'] : [] };
}

function parseXmlDocument(input: string, limits: { readonly maxDepth: number; readonly maxElements: number; readonly maxAttributes: number; readonly maxTextBytes: number }): XmlNode {
  const root: XmlNode = { name: '#root', localName: '#root', attrs: {}, children: [], text: '' };
  const stack: XmlNode[] = [root];
  let position = 0;
  let elements = 0;
  while (position < input.length) {
    const start = input.indexOf('<', position);
    if (start < 0) { appendXmlText(stack[stack.length - 1]!, input.slice(position), limits.maxTextBytes); break; }
    if (start > position) appendXmlText(stack[stack.length - 1]!, input.slice(position, start), limits.maxTextBytes);
    if (input.startsWith('<!--', start)) { const end = input.indexOf('-->', start + 4); if (end < 0) throw new SubscriptionError('MALFORMED_FEED', 'Unterminated XML comment'); position = end + 3; continue; }
    if (input.startsWith('<![CDATA[', start)) { const end = input.indexOf(']]>', start + 9); if (end < 0) throw new SubscriptionError('MALFORMED_FEED', 'Unterminated XML CDATA'); appendXmlText(stack[stack.length - 1]!, input.slice(start + 9, end), limits.maxTextBytes); position = end + 3; continue; }
    if (input.startsWith('<?', start)) { const end = input.indexOf('?>', start + 2); if (end < 0) throw new SubscriptionError('MALFORMED_FEED', 'Unterminated XML declaration'); position = end + 2; continue; }
    if (/^<!DOCTYPE|^<!ENTITY|^<!NOTATION|^<!/i.test(input.slice(start, start + 16))) throw new SubscriptionError('MALFORMED_FEED', 'Unsafe XML declaration is disabled');
    const end = findXmlTagEnd(input, start + 1); if (end < 0) throw new SubscriptionError('MALFORMED_FEED', 'Unterminated XML tag');
    const raw = input.slice(start + 1, end).trim(); position = end + 1;
    if (!raw) throw new SubscriptionError('MALFORMED_FEED', 'Empty XML tag');
    if (raw.startsWith('/')) { const name = raw.slice(1).trim().toLocaleLowerCase(); const current = stack.pop(); if (!current || current === root || current.name.toLocaleLowerCase() !== name) throw new SubscriptionError('MALFORMED_FEED', 'Mismatched XML closing tag'); continue; }
    const selfClosing = /\/\s*$/.test(raw); const withoutSlash = selfClosing ? raw.replace(/\/\s*$/, '').trim() : raw; const nameMatch = withoutSlash.match(/^([^\s/>]+)/); if (!nameMatch) throw new SubscriptionError('MALFORMED_FEED', 'Invalid XML element');
    const name = nameMatch[1]!; const attrs = parseXmlAttributes(withoutSlash.slice(name.length), limits.maxAttributes); if (stack.length >= limits.maxDepth + 1) throw new SubscriptionError('BOUNDS_EXCEEDED', 'XML nesting limit exceeded');
    elements += 1; if (elements > limits.maxElements) throw new SubscriptionError('BOUNDS_EXCEEDED', 'XML element limit exceeded');
    const node: XmlNode = { name, localName: local(name), attrs, children: [], text: '' }; stack[stack.length - 1]!.children.push(node); if (!selfClosing) stack.push(node);
  }
  if (stack.length !== 1) throw new SubscriptionError('MALFORMED_FEED', 'Unclosed XML element');
  const documentRoot = root.children.find(value => value.name !== '#text'); if (!documentRoot) throw new SubscriptionError('MALFORMED_FEED', 'XML has no root element'); return documentRoot;
}

function findXmlTagEnd(input: string, start: number): number { let quote = ''; for (let index = start; index < input.length; index += 1) { const char = input[index]!; if (quote) { if (char === quote) quote = ''; } else if (char === '"' || char === "'") quote = char; else if (char === '>') return index; } return -1; }
function parseXmlAttributes(input: string, maxAttributes: number): Readonly<Record<string, string>> { const attrs: Record<string, string> = {}; let position = 0; let count = 0; while (position < input.length) { while (/\s/.test(input[position] ?? '')) position += 1; if (position >= input.length) break; const match = input.slice(position).match(/^([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/); if (!match) throw new SubscriptionError('MALFORMED_FEED', 'Invalid XML attribute'); count += 1; if (count > maxAttributes) throw new SubscriptionError('BOUNDS_EXCEEDED', 'XML attribute limit exceeded'); const key = local(match[1]!).toLocaleLowerCase(); attrs[key] = decodeXmlEntities(match[3] ?? match[4] ?? '').slice(0, 4_096); position += match[0].length; } return attrs; }
function appendXmlText(node: XmlNode, value: string, maxTextBytes: number): void { const decoded = decodeXmlEntities(value); if (new TextEncoder().encode(decoded).byteLength > maxTextBytes) throw new SubscriptionError('BOUNDS_EXCEEDED', 'XML text field exceeds the bounded limit'); node.text = `${node.text}${decoded}`.slice(0, maxTextBytes); }
function decodeXmlEntities(value: string): string { return value.replace(/&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos|nbsp);/gi, (match, token: string) => { if (token.toLocaleLowerCase() === 'amp') return '&'; if (token.toLocaleLowerCase() === 'lt') return '<'; if (token.toLocaleLowerCase() === 'gt') return '>'; if (token.toLocaleLowerCase() === 'quot') return '"'; if (token.toLocaleLowerCase() === 'apos') return "'"; if (token.toLocaleLowerCase() === 'nbsp') return ' '; const valueNumber = token.toLocaleLowerCase().startsWith('#x') ? Number.parseInt(token.slice(2), 16) : Number.parseInt(token.slice(1), 10); return Number.isSafeInteger(valueNumber) && valueNumber >= 0 && valueNumber <= 0x10ffff && !(valueNumber >= 0xd800 && valueNumber <= 0xdfff) ? String.fromCodePoint(valueNumber) : ''; }); }
function local(name: string): string { return name.split(':').at(-1)!.toLocaleLowerCase(); }
function child(node: XmlNode | undefined, name: string): XmlNode | undefined { return node?.children.find(value => value.localName === name.toLocaleLowerCase()); }
function children(node: XmlNode | undefined, name: string): XmlNode[] { return node?.children.filter(value => value.localName === name.toLocaleLowerCase()) ?? []; }
function childLocal(node: XmlNode | undefined, name: string): XmlNode | undefined { return child(node, name); }
function textOf(node: XmlNode | undefined): string { return boundedText(node ? `${node.text}${node.children.map(value => textOf(value)).join(' ')}` : '', SUBSCRIPTIONS_MAX_TEXT); }

function parseXmlDuration(value: string): number | undefined { const parts = value.split(':').map(Number); if (parts.length === 3 && parts.every(Number.isFinite)) return Math.round((parts[0]! * 3600 + parts[1]! * 60 + parts[2]!) * 1000); const seconds = Number(value); return Number.isFinite(seconds) && seconds >= 0 && seconds <= 24 * 60 * 60 * 10 ? Math.round(seconds * 1000) : undefined; }
function numberValue(value: string | undefined): number | undefined { if (!value) return undefined; const number = Number(value); return Number.isSafeInteger(number) && number >= 0 ? number : undefined; }
function enclosureFrom(url: string, mime: unknown, title: unknown, length: unknown, duration: unknown): Omit<FeedEnclosure, 'id' | 'version'> { const mimeType = typeof mime === 'string' && /^[\w.+-]+\/[\w.+-]+/.test(mime) ? mime.slice(0, 255).toLocaleLowerCase() : undefined; const kind: FeedEnclosureKind = mimeType?.startsWith('audio/') ? 'AUDIO' : mimeType?.startsWith('video/') ? 'VIDEO' : 'OTHER'; const durationMs = typeof duration === 'number' ? (duration > 100_000 ? duration : Math.round(duration * 1000)) : typeof duration === 'string' ? parseXmlDuration(duration) : undefined; return { url, ...(mimeType ? { mimeType } : {}), ...(typeof length === 'number' && Number.isSafeInteger(length) && length >= 0 ? { lengthBytes: Math.min(length, SUBSCRIPTIONS_MAX_ENCLOSURE_BYTES) } : {}), ...(boundedText(title, SUBSCRIPTIONS_MAX_TITLE) ? { title: boundedText(title, SUBSCRIPTIONS_MAX_TITLE) } : {}), ...(durationMs !== undefined ? { durationMs } : {}), kind }; }
function jsonAuthor(value: unknown): string | undefined { if (!Array.isArray(value)) return undefined; const names = value.slice(0, 4).flatMap(item => isRecord(item) ? [boundedText(item.name, 320) || boundedText(item.url, 320)] : []); return names.filter(Boolean).join(', ') || undefined; }
function arrayText(value: unknown, maxItems: number, maxLength: number): string[] { return Array.isArray(value) ? [...new Set(value.slice(0, maxItems).map(item => boundedText(item, maxLength)).filter(Boolean))] : []; }
function scanJsonDepth(text: string, maxDepth: number): void { let depth = 0; let quoted = false; let escaped = false; for (const char of text) { if (quoted) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') quoted = false; continue; } if (char === '"') quoted = true; else if (char === '{' || char === '[') { depth += 1; if (depth > maxDepth) throw new SubscriptionError('BOUNDS_EXCEEDED', 'JSON nesting limit exceeded'); } else if (char === '}' || char === ']') depth -= 1; } }

export function canonicalFeedUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > SUBSCRIPTIONS_MAX_URL) throw new SubscriptionError('INVALID_URL', 'Feed URL is invalid');
  let parsed: URL; try { parsed = new URL(value.trim()); } catch { throw new SubscriptionError('INVALID_URL', 'Feed URL is invalid'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new SubscriptionError('INVALID_URL', 'Feed URL must be HTTP(S) without credentials');
  for (const key of parsed.searchParams.keys()) if (/^(?:auth|authorization|cookie|password|secret|session|sig|signature|token|access_token|refresh_token)$/i.test(key) || /(?:token|secret|password|session|signature)/i.test(key)) throw new SubscriptionError('INVALID_URL', 'Feed URL cannot persist credential-like query parameters');
  parsed.hash = '';
  return parsed.toString();
}

export function isPrivateFeedUrl(value: string): boolean { let url: URL; try { url = new URL(value); } catch { return true; } const host = url.hostname.toLocaleLowerCase().replace(/^\[|\]$/g, ''); if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host === '::1' || host === '0.0.0.0' || host === '::' || host.startsWith('127.') || host.startsWith('169.254.') || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:') || host.startsWith('::ffff:127.') || host.startsWith('::ffff:10.') || host.startsWith('::ffff:192.168.')) return true; const parts = host.split('.').map(Number); if (parts.length === 4 && parts.every(part => Number.isInteger(part) && part >= 0 && part <= 255)) return parts[0] === 10 || parts[0] === 127 || (parts[0] === 172 && parts[1]! >= 16 && parts[1]! <= 31) || (parts[0] === 192 && parts[1] === 168) || (parts[0] === 169 && parts[1] === 254); return false; }
function safeRedirectUrl(current: string, location: string, allowPrivateNetwork: boolean): string { let next: URL; try { next = new URL(location, current); } catch { throw new SubscriptionError('UNSAFE_URL', 'Feed redirect URL is invalid'); } if (!['http:', 'https:'].includes(next.protocol) || next.username || next.password) throw new SubscriptionError('UNSAFE_URL', 'Feed redirect scheme is not allowed'); const currentUrl = new URL(current); if (currentUrl.protocol === 'https:' && next.protocol !== 'https:') throw new SubscriptionError('INSECURE_REDIRECT', 'Secure feed subscription cannot downgrade to HTTP'); const normalized = canonicalFeedUrl(next.toString()); if (!allowPrivateNetwork && isPrivateFeedUrl(normalized)) throw new SubscriptionError('SSRF_BLOCKED', 'Feed redirect to a private network is not authorized'); return normalized; }
function header(headers: Readonly<Record<string, string>> | Headers, name: string): string | undefined { if (headers instanceof Headers) return headers.get(name) ?? undefined; const key = Object.keys(headers).find(value => value.toLocaleLowerCase() === name.toLocaleLowerCase()); return key ? headers[key] : undefined; }
async function consumeBody(body: FeedResponseBody | undefined, onChunk: (chunk: Uint8Array) => Promise<void> | void): Promise<void> { if (!body) return; if (body instanceof Uint8Array) { await onChunk(body); return; } if (typeof body === 'string') { await onChunk(new TextEncoder().encode(body)); return; } if (typeof (body as ReadableStream<Uint8Array>).getReader === 'function') { const reader = (body as ReadableStream<Uint8Array>).getReader(); try { while (true) { const next = await reader.read(); if (next.done) break; if (next.value?.byteLength) await onChunk(next.value); } } finally { reader.releaseLock(); } return; } for await (const chunk of body as AsyncIterable<Uint8Array>) if (chunk?.byteLength) await onChunk(chunk); }
function boundedText(value: unknown, max: number): string { return typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, Math.max(1, max)) : ''; }
function optionalSafeUrl(value: unknown, base?: string): string | undefined { if (typeof value !== 'string' || !value.trim()) return undefined; try { const candidate = new URL(value, base); return canonicalFeedUrl(candidate.toString()); } catch { return undefined; } }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }
function sanitizeFeedHtml(value: string, sourceUrl: string): string { const sanitized = sanitizeArchivedHtml(value, SUBSCRIPTIONS_MAX_HTML, sourceUrl); return sanitized.html; }

export interface FeedDiscoveryCandidate {
  readonly url: string;
  readonly title?: string;
  readonly formatHint: FeedFormat;
  readonly sourcePageUrl: string;
}

/** Discovery is a proposal-only boundary. It never subscribes or fetches. */
export class FeedDiscoveryService {
  discover(input: { readonly pageUrl: string; readonly html: string }): readonly FeedDiscoveryCandidate[] {
    const pageUrl = canonicalFeedUrl(input.pageUrl);
    if (typeof input.html !== 'string' || input.html.length > SUBSCRIPTIONS_MAX_HTML) throw new SubscriptionError('BOUNDS_EXCEEDED', 'Discovery page HTML exceeds the bounded limit');
    const candidates: FeedDiscoveryCandidate[] = [];
    const linkPattern = /<link\b([^>]{0,4096})>/gi;
    for (const match of input.html.matchAll(linkPattern)) {
      const attrs = parseLooseAttributes(match[1] ?? '');
      const rel = attrs.rel?.toLocaleLowerCase().split(/\s+/).filter(Boolean) ?? [];
      const type = attrs.type?.toLocaleLowerCase() ?? '';
      if (!rel.includes('alternate')) continue;
      const formatHint = type.includes('json') ? 'JSON_FEED' : type.includes('atom') ? 'ATOM_1_0' : type.includes('rss') || type.includes('xml') ? 'RSS_2_0' : undefined;
      if (!formatHint || !attrs.href) continue;
      const url = optionalSafeUrl(attrs.href, pageUrl);
      if (!url || candidates.some(candidate => candidate.url === url)) continue;
      candidates.push({ url, formatHint, sourcePageUrl: pageUrl, ...(boundedText(attrs.title, SUBSCRIPTIONS_MAX_TITLE) ? { title: boundedText(attrs.title, SUBSCRIPTIONS_MAX_TITLE) } : {}) });
      if (candidates.length >= 32) break;
    }
    return candidates;
  }
}

export interface OpmlOutline {
  readonly title: string;
  readonly text?: string;
  readonly xmlUrl?: string;
  readonly htmlUrl?: string;
  readonly folderPath: readonly string[];
  readonly valid: boolean;
  readonly reason?: string;
}

export interface OpmlPreview {
  readonly feedCount: number;
  readonly validCount: number;
  readonly invalidCount: number;
  readonly folders: readonly string[];
  readonly duplicateUrls: readonly string[];
  readonly invalidUrls: readonly string[];
  readonly outlines: readonly OpmlOutline[];
}

export interface OpmlImportResult {
  readonly subscriptions: readonly FeedSubscription[];
  readonly createdFolders: readonly FeedFolder[];
  readonly skippedDuplicates: readonly string[];
  readonly invalidUrls: readonly string[];
}

export class OpmlService {
  preview(input: string | Uint8Array): OpmlPreview {
    const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > SUBSCRIPTIONS_MAX_OPML_BYTES) throw new SubscriptionError('BOUNDS_EXCEEDED', 'OPML document exceeds the bounded limit');
    const text = new TextDecoder().decode(bytes);
    if (/<!DOCTYPE|<!ENTITY|<!\[|<!NOTATION/i.test(text)) throw new SubscriptionError('MALFORMED_OPML', 'OPML DTD and external entities are disabled');
    const root = parseXmlDocument(text, { maxDepth: SUBSCRIPTIONS_MAX_OPML_DEPTH, maxElements: SUBSCRIPTIONS_MAX_OPML_OUTLINES * 2, maxAttributes: 32, maxTextBytes: 16 * 1024 });
    if (root.localName !== 'opml') throw new SubscriptionError('MALFORMED_OPML', 'Document is not OPML');
    const outlines: OpmlOutline[] = [];
    collectOpmlOutlines(child(root, 'body') ?? root, [], outlines);
    const seen = new Set<string>(); const duplicateUrls = new Set<string>(); const folders = new Set<string>(); const invalidUrls: string[] = [];
    for (const outline of outlines) { for (let index = 1; index <= outline.folderPath.length; index += 1) folders.add(outline.folderPath.slice(0, index).join('/')); if (outline.xmlUrl) { if (seen.has(outline.xmlUrl)) duplicateUrls.add(outline.xmlUrl); else seen.add(outline.xmlUrl); } else if (!outline.valid) invalidUrls.push(outline.reason ?? outline.title); }
    return { feedCount: outlines.length, validCount: outlines.filter(value => value.valid).length, invalidCount: outlines.filter(value => !value.valid).length, folders: [...folders].sort(), duplicateUrls: [...duplicateUrls].sort(), invalidUrls: invalidUrls.slice(0, 1_000), outlines };
  }

  export(subscriptions: readonly FeedSubscription[], folders: readonly FeedFolder[] = []): string {
    const byFolder = new Map<string, FeedSubscription[]>(); const unfiled: FeedSubscription[] = [];
    for (const subscription of subscriptions) { const folder = subscription.folderIds[0]; if (folder) (byFolder.get(folder) ?? (byFolder.set(folder, []), byFolder.get(folder)!)).push(subscription); else unfiled.push(subscription); }
    const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const outline = (subscription: FeedSubscription) => `<outline type="rss" text="${escape(subscription.title)}" title="${escape(subscription.title)}" xmlUrl="${escape(subscription.canonicalUrl)}"/>`;
    const folderXml = folders.slice(0, 10_000).map(folder => { const values = byFolder.get(String(folder.id)) ?? []; return `<outline text="${escape(folder.name)}" title="${escape(folder.name)}">${values.map(outline).join('')}</outline>`; }).join('');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0"><head><title>Keystone subscriptions</title></head><body>${folderXml}${unfiled.map(outline).join('')}</body></opml>`;
  }
}

function collectOpmlOutlines(node: XmlNode, folderPath: readonly string[], output: OpmlOutline[]): void {
  for (const outline of children(node, 'outline')) {
    if (output.length >= SUBSCRIPTIONS_MAX_OPML_OUTLINES) throw new SubscriptionError('BOUNDS_EXCEEDED', 'OPML contains too many outlines');
    const title = boundedText(outline.attrs.title ?? outline.attrs.text, SUBSCRIPTIONS_MAX_TITLE) || 'Untitled folder';
    const xmlUrl = outline.attrs.xmlurl ? (() => { try { return canonicalFeedUrl(outline.attrs.xmlurl); } catch { return undefined; } })() : undefined;
    const hasUrl = Boolean(outline.attrs.xmlurl);
    const path = xmlUrl ? folderPath : [...folderPath, title].slice(0, SUBSCRIPTIONS_MAX_OPML_DEPTH);
    if (hasUrl || !outline.children.some(value => value.localName === 'outline')) output.push({ title, ...(outline.attrs.text ? { text: boundedText(outline.attrs.text, SUBSCRIPTIONS_MAX_TITLE) } : {}), ...(xmlUrl ? { xmlUrl } : {}), ...(outline.attrs.htmlurl ? { htmlUrl: boundedText(outline.attrs.htmlurl, SUBSCRIPTIONS_MAX_URL) } : {}), folderPath, valid: Boolean(xmlUrl), ...(!xmlUrl ? { reason: 'Invalid or missing xmlUrl' } : {}) });
    if (outline.children.some(value => value.localName === 'outline')) collectOpmlOutlines(outline, path, output);
  }
}

export interface FeedEnclosureStoredContent { readonly contentId: ContentId; readonly byteLength: number; readonly contentHash: string; readonly mimeType: string; }
export interface FeedEnclosureWriter { readonly bytesWritten: number; append(chunk: Uint8Array): Promise<number>; complete(metadata: { readonly mimeType: string; readonly name?: string }): Promise<FeedEnclosureStoredContent>; abort(): Promise<void>; }
export interface FeedEnclosureStore { begin(input: { readonly key: string; readonly existingBytes: number; readonly maxBytes: number }): Promise<FeedEnclosureWriter>; read(contentId: ContentId): Promise<Uint8Array | undefined>; remove?(contentId: ContentId): Promise<void> | void; }

/** Small deterministic test/host fallback. Production hosts can implement this with Files/content streaming. */
export class InMemoryFeedEnclosureStore implements FeedEnclosureStore {
  private readonly partial = new Map<string, Uint8Array>();
  private readonly completed = new Map<ContentId, Uint8Array>();
  async begin(input: { readonly key: string; readonly existingBytes: number; readonly maxBytes: number }): Promise<FeedEnclosureWriter> {
    let bytes = this.partial.get(input.key) ?? new Uint8Array();
    if (input.existingBytes !== bytes.byteLength) bytes = new Uint8Array();
    const savePartial = (value: Uint8Array): void => { this.partial.set(input.key, value.slice()); };
    let active = true;
    return {
      get bytesWritten() { return bytes.byteLength; },
      append: async chunk => { if (!active) throw new SubscriptionError('CONFLICT', 'Enclosure writer is closed'); if (!(chunk instanceof Uint8Array)) throw new SubscriptionError('INVALID_ARGUMENT', 'Enclosure chunk is invalid'); if (bytes.byteLength + chunk.byteLength > input.maxBytes) throw new SubscriptionError('BOUNDS_EXCEEDED', 'Enclosure exceeds the bounded limit'); const merged = new Uint8Array(bytes.byteLength + chunk.byteLength); merged.set(bytes); merged.set(chunk, bytes.byteLength); bytes = merged; savePartial(bytes); return bytes.byteLength; },
      complete: async metadata => { if (!active) throw new SubscriptionError('CONFLICT', 'Enclosure writer is closed'); if (!bytes.byteLength) throw new SubscriptionError('INTEGRITY', 'Downloaded enclosure is empty'); const manifest = await createContentManifest(bytes, { mimeType: metadata.mimeType, name: metadata.name, contentPolicy: 'PRIVATE_NO_STRANGER_CACHE' }); this.completed.set(manifest.contentId, bytes.slice()); this.partial.delete(input.key); active = false; return { contentId: manifest.contentId, byteLength: bytes.byteLength, contentHash: manifest.contentId.slice('sha256-'.length), mimeType: manifest.mimeType }; },
      abort: async () => { active = false; savePartial(bytes); },
    };
  }
  async read(contentId: ContentId): Promise<Uint8Array | undefined> { const value = this.completed.get(contentId); return value?.slice(); }
  remove(contentId: ContentId): void { this.completed.delete(contentId); }
}

/** R0P74-compatible content boundary for explicitly downloaded episodes. */
export class ContentCacheFeedEnclosureStore implements FeedEnclosureStore {
  private readonly staging = new InMemoryFeedEnclosureStore();
  constructor(readonly cache = new ContentCache(512 * 1024 * 1024)) {}
  async begin(input: { readonly key: string; readonly existingBytes: number; readonly maxBytes: number }): Promise<FeedEnclosureWriter> {
    const writer = await this.staging.begin(input);
    return {
      get bytesWritten() { return writer.bytesWritten; },
      append: chunk => writer.append(chunk),
      complete: async metadata => { const stored = await writer.complete(metadata); const bytes = await this.staging.read(stored.contentId); if (!bytes) throw new SubscriptionError('INTEGRITY', 'Completed enclosure is not readable'); const manifest = await createContentManifest(bytes, { mimeType: stored.mimeType, ...(metadata.name ? { name: metadata.name } : {}), contentPolicy: 'PRIVATE_NO_STRANGER_CACHE' }); await this.cache.putManifest(manifest); for (let index = 0; index < manifest.chunks.length; index += 1) { const start = index * manifest.chunkSize; await this.cache.putVerifiedChunk(manifest, index, bytes.subarray(start, Math.min(bytes.byteLength, start + manifest.chunkSize))); } return { contentId: manifest.contentId, byteLength: manifest.byteLength, contentHash: manifest.contentId.slice('sha256-'.length), mimeType: manifest.mimeType }; },
      abort: () => writer.abort(),
    };
  }
  read(contentId: ContentId): Promise<Uint8Array | undefined> { return this.cache.read(contentId); }
  remove(contentId: ContentId): void { this.cache.remove(contentId); }
}

export interface FeedMediaRuntime {
  play(input: { readonly contentId: ContentId; readonly mimeType: string; readonly title: string; readonly positionMs: number }): Promise<void>;
  pause?(): Promise<void>;
  seek?(positionMs: number): Promise<void>;
}

export interface FeedWebLibraryBoundary {
  saveArticle(input: { readonly url: string; readonly title: string; readonly ownerConfirmed: true }): Promise<{ readonly entryId: string }>;
}

export interface FeedLinkBoundary {
  openOriginal(url: string): Promise<void>;
  shareLink(url: string): Promise<void>;
}

export interface FeedContinuityBoundary {
  continue(input: { readonly entryId: FeedEntryId; readonly title: string; readonly positionMs?: number; readonly kind: 'ARTICLE' | 'PODCAST'; readonly enclosureId?: FeedEnclosureId }): Promise<void>;
}

export interface FeedNotificationBoundary {
  deliver(input: { readonly subscriptionId: SubscriptionId; readonly subscriptionTitle: string; readonly itemIds: readonly FeedEntryId[]; readonly count: number; readonly latestTitles: readonly string[] }): Promise<void> | void;
}

export interface FeedSubscriptionSyncSnapshot {
  readonly version: 1;
  readonly protocol: typeof SUBSCRIPTIONS_PROTOCOL;
  readonly deviceId: string;
  readonly subscriptions: readonly FeedSubscription[];
  readonly folders: readonly FeedFolder[];
  readonly entries: readonly FeedEntry[];
}

export interface FeedSubscriptionSyncBoundary {
  publish(snapshot: FeedSubscriptionSyncSnapshot): Promise<void> | void;
  subscribe(listener: (snapshot: FeedSubscriptionSyncSnapshot) => void): () => void;
}

export class InMemoryFeedSubscriptionSync implements FeedSubscriptionSyncBoundary {
  private readonly listeners = new Set<(snapshot: FeedSubscriptionSyncSnapshot) => void>();
  async publish(snapshot: FeedSubscriptionSyncSnapshot): Promise<void> { for (const listener of this.listeners) listener(structuredClone(snapshot)); }
  subscribe(listener: (snapshot: FeedSubscriptionSyncSnapshot) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
}

export interface SubscriptionListQuery {
  readonly folderId?: FeedFolderId;
  readonly subscriptionId?: SubscriptionId;
  readonly readState?: FeedReadState;
  readonly favorite?: boolean;
  readonly podcastsOnly?: boolean;
  readonly query?: string;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface SubscriptionPage { readonly items: readonly FeedEntry[]; readonly nextCursor?: string; readonly total: number; readonly unreadCount: number; }
export interface SubscriptionSearchResult { readonly entry: FeedEntry; readonly subscription: FeedSubscription; readonly score: number; readonly matchedFields: readonly ('title' | 'content' | 'author' | 'category' | 'tag' | 'feed')[]; readonly snippet: string; }

export type FeedRefreshResult =
  | { readonly status: 'UPDATED'; readonly subscription: FeedSubscription; readonly newEntryIds: readonly FeedEntryId[]; readonly updatedEntryIds: readonly FeedEntryId[]; readonly newItemCount: number; readonly notificationDelivered: boolean }
  | { readonly status: 'NOT_MODIFIED'; readonly subscription: FeedSubscription; readonly newEntryIds: readonly []; readonly updatedEntryIds: readonly []; readonly newItemCount: 0; readonly notificationDelivered: false }
  | { readonly status: 'ERROR'; readonly subscription: FeedSubscription; readonly error: { readonly code: SubscriptionErrorCode; readonly message: string; readonly transient: boolean }; readonly newEntryIds: readonly []; readonly updatedEntryIds: readonly []; readonly newItemCount: 0; readonly notificationDelivered: false };

export interface SubscriptionServiceOptions {
  readonly stateStore?: SubscriptionStateStore;
  readonly feedClient?: FeedFetchClient;
  readonly parser?: FeedParser;
  readonly opml?: OpmlService;
  readonly discovery?: FeedDiscoveryService;
  readonly enclosureStore?: FeedEnclosureStore;
  readonly media?: FeedMediaRuntime;
  readonly webLibrary?: FeedWebLibraryBoundary;
  readonly links?: FeedLinkBoundary;
  readonly continuity?: FeedContinuityBoundary;
  readonly notifications?: FeedNotificationBoundary;
  readonly sync?: FeedSubscriptionSyncBoundary;
  readonly deviceId?: string;
  readonly now?: () => number;
  readonly maxSubscriptions?: number;
  readonly maxEntries?: number;
  readonly maxEntriesPerFeed?: number;
  readonly refreshConcurrency?: number;
}

export interface FeedSubscriptionDiagnostics {
  readonly subscriptions: number;
  readonly folders: number;
  readonly entries: number;
  readonly unread: number;
  readonly favorites: number;
  readonly downloadedEnclosures: number;
  readonly authorizedPrivateSubscriptions: number;
  readonly activeRefreshes: number;
  readonly listenerCount: number;
}

const EMPTY_STATE: SubscriptionState = { version: 1, protocol: SUBSCRIPTIONS_PROTOCOL, subscriptions: {}, folders: {}, entries: {} };

/** Local-first canonical service. External origins remain authoritative for feed content. */
export class SubscriptionService {
  private readonly store: SubscriptionStateStore;
  private readonly feedClient: FeedFetchClient;
  private readonly parser: FeedParser;
  private readonly opml: OpmlService;
  private readonly discovery: FeedDiscoveryService;
  private readonly enclosureStore: FeedEnclosureStore;
  private readonly media?: FeedMediaRuntime;
  private readonly webLibrary?: FeedWebLibraryBoundary;
  private readonly links?: FeedLinkBoundary;
  private readonly continuity?: FeedContinuityBoundary;
  private readonly notifications?: FeedNotificationBoundary;
  private readonly sync?: FeedSubscriptionSyncBoundary;
  private readonly now: () => number;
  private readonly deviceId: string;
  private readonly maxSubscriptions: number;
  private readonly maxEntries: number;
  private readonly maxEntriesPerFeed: number;
  private readonly refreshConcurrency: number;
  private state: SubscriptionState = structuredClone(EMPTY_STATE);
  private readonly authorizedPrivateSubscriptions = new Set<SubscriptionId>();
  private readonly listeners = new Set<() => void>();
  private readonly entriesBySourceKey = new Map<string, FeedEntryId>();
  private readonly refreshes = new Set<SubscriptionId>();
  private writeChain: Promise<void> = Promise.resolve();
  private readonly readyPromise: Promise<void>;
  private syncUnsubscribe?: () => void;

  constructor(options: SubscriptionServiceOptions = {}) {
    this.store = options.stateStore ?? new InMemorySubscriptionStateStore();
    this.feedClient = options.feedClient ?? new FeedFetchClient();
    this.parser = options.parser ?? new FeedParser();
    this.opml = options.opml ?? new OpmlService();
    this.discovery = options.discovery ?? new FeedDiscoveryService();
    this.enclosureStore = options.enclosureStore ?? new ContentCacheFeedEnclosureStore();
    this.media = options.media; this.webLibrary = options.webLibrary; this.links = options.links; this.continuity = options.continuity; this.notifications = options.notifications; this.sync = options.sync;
    this.now = options.now ?? Date.now; this.deviceId = boundedText(options.deviceId ?? 'local-device', 128) || 'local-device';
    this.maxSubscriptions = clampInt(options.maxSubscriptions, 1, SUBSCRIPTIONS_MAX_SUBSCRIPTIONS, SUBSCRIPTIONS_MAX_SUBSCRIPTIONS);
    this.maxEntries = clampInt(options.maxEntries, 100, SUBSCRIPTIONS_MAX_ENTRIES, SUBSCRIPTIONS_MAX_ENTRIES);
    this.maxEntriesPerFeed = clampInt(options.maxEntriesPerFeed, 10, SUBSCRIPTIONS_MAX_ENTRIES_PER_FEED, SUBSCRIPTIONS_MAX_ENTRIES_PER_FEED);
    this.refreshConcurrency = clampInt(options.refreshConcurrency, 1, SUBSCRIPTIONS_MAX_REFRESH_CONCURRENCY, SUBSCRIPTIONS_MAX_REFRESH_CONCURRENCY);
    this.readyPromise = this.hydrate();
    if (this.sync) this.syncUnsubscribe = this.sync.subscribe(snapshot => { void this.applySync(snapshot); });
  }

  async ready(): Promise<void> { await this.readyPromise; }
  async flush(): Promise<void> { await this.writeChain; }
  onChange(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  snapshot(): SubscriptionState { return structuredClone(this.state); }
  diagnostics(): FeedSubscriptionDiagnostics { const entries = Object.values(this.state.entries); return { subscriptions: Object.keys(this.state.subscriptions).length, folders: Object.keys(this.state.folders).length, entries: entries.length, unread: entries.filter(value => value.readState === 'UNREAD').length, favorites: entries.filter(value => value.favorite).length, downloadedEnclosures: entries.reduce((total, value) => total + Object.values(value.downloads).filter(download => download.state === 'DOWNLOADED').length, 0), authorizedPrivateSubscriptions: this.authorizedPrivateSubscriptions.size, activeRefreshes: this.refreshes.size, listenerCount: this.listeners.size }; }

  async listSubscriptions(): Promise<readonly FeedSubscription[]> { await this.ready(); return Object.values(this.state.subscriptions).sort(compareSubscriptions).map(value => structuredClone(value)); }
  async getSubscription(id: SubscriptionId): Promise<FeedSubscription | undefined> { await this.ready(); const value = this.state.subscriptions[id]; return value ? structuredClone(value) : undefined; }
  async listFolders(): Promise<readonly FeedFolder[]> { await this.ready(); return Object.values(this.state.folders).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)).map(value => structuredClone(value)); }

  async createFolder(name: string): Promise<FeedFolder> {
    await this.ready(); const normalized = boundedText(name, 160); if (!normalized) throw new SubscriptionError('INVALID_ARGUMENT', 'Folder name is required'); if (Object.keys(this.state.folders).length >= 1_000) throw new SubscriptionError('BOUNDS_EXCEEDED', 'Folder limit reached'); const now = iso(this.now()); const folder: FeedFolder = { version: 1, id: `folder:${randomId()}` as FeedFolderId, name: normalized, createdAt: now, updatedAt: now }; this.state = { ...this.state, folders: { ...this.state.folders, [folder.id]: folder } }; await this.persistAndEmit(); return structuredClone(folder);
  }

  async setSubscriptionFolders(subscriptionId: SubscriptionId, folderIds: readonly FeedFolderId[]): Promise<FeedSubscription> {
    await this.ready(); const current = this.requireSubscription(subscriptionId); const valid = [...new Set(folderIds)].filter(id => Boolean(this.state.folders[id])).slice(0, 32); const next = this.bumpSubscription({ ...current, folderIds: valid, updatedAt: iso(this.now()) }); this.state = { ...this.state, subscriptions: { ...this.state.subscriptions, [subscriptionId]: next } }; await this.persistAndEmit(); return structuredClone(next);
  }

  async subscribe(input: { readonly url: string; readonly title?: string; readonly folderIds?: readonly FeedFolderId[]; readonly origin?: SubscriptionOrigin; readonly ownerConfirmed: true; readonly allowPrivateNetwork?: true; readonly notifyOnNewItems?: boolean; readonly autoDownloadEpisodes?: boolean; readonly refreshIntervalMs?: number }): Promise<FeedSubscription> {
    await this.ready(); if (input.ownerConfirmed !== true) throw new SubscriptionError('POLICY_DENIED', 'Adding a feed requires explicit owner confirmation'); const url = canonicalFeedUrl(input.url); const privateNetwork = isPrivateFeedUrl(url); if (privateNetwork && input.allowPrivateNetwork !== true) throw new SubscriptionError('SSRF_BLOCKED', 'A local or private feed requires explicit owner authorization'); const existing = Object.values(this.state.subscriptions).find(value => value.canonicalUrl === url); if (existing) throw new SubscriptionError('CONFLICT', 'This feed is already subscribed'); if (Object.keys(this.state.subscriptions).length >= this.maxSubscriptions) throw new SubscriptionError('BOUNDS_EXCEEDED', 'Subscription limit reached'); const now = iso(this.now()); const parsed = new URL(url); const subscription: FeedSubscription = { version: 1, protocol: SUBSCRIPTIONS_PROTOCOL, id: `subscription:${randomId()}` as SubscriptionId, canonicalUrl: url, hostname: parsed.hostname, title: boundedText(input.title, SUBSCRIPTIONS_MAX_TITLE) || parsed.hostname, ...(input.origin ? { origin: input.origin } : { origin: 'MANUAL' }), state: 'ACTIVE', privateNetworkRequested: privateNetwork || input.allowPrivateNetwork === true, folderIds: [...new Set((input.folderIds ?? []).filter(id => Boolean(this.state.folders[id])))].slice(0, 32), refresh: { enabled: true, notifyOnNewItems: input.notifyOnNewItems === true, autoDownloadEpisodes: input.autoDownloadEpisodes === true, maxAutoDownloadEpisodes: 2, refreshIntervalMs: clampInt(input.refreshIntervalMs, SUBSCRIPTIONS_MIN_REFRESH_MS, SUBSCRIPTIONS_MAX_REFRESH_MS, SUBSCRIPTIONS_DEFAULT_REFRESH_MS) }, createdAt: now, updatedAt: now, revision: { clock: 1, deviceId: this.deviceId } };
    const next = { ...this.state.subscriptions, [subscription.id]: subscription }; this.state = { ...this.state, subscriptions: next }; if (privateNetwork || input.allowPrivateNetwork === true) this.authorizedPrivateSubscriptions.add(subscription.id); await this.persistAndEmit(); return structuredClone(subscription);
  }

  async authorizePrivateNetwork(subscriptionId: SubscriptionId, ownerConfirmed: true): Promise<FeedSubscription> { await this.ready(); if (ownerConfirmed !== true) throw new SubscriptionError('POLICY_DENIED', 'Private feed access requires explicit owner confirmation'); const subscription = this.requireSubscription(subscriptionId); if (!subscription.privateNetworkRequested && !isPrivateFeedUrl(subscription.canonicalUrl)) throw new SubscriptionError('INVALID_ARGUMENT', 'Subscription does not target a private network'); this.authorizedPrivateSubscriptions.add(subscriptionId); return structuredClone(subscription); }
  async pause(subscriptionId: SubscriptionId): Promise<FeedSubscription> { return this.setSubscriptionState(subscriptionId, 'PAUSED'); }
  async resume(subscriptionId: SubscriptionId): Promise<FeedSubscription> { return this.setSubscriptionState(subscriptionId, 'ACTIVE'); }
  async unsubscribe(subscriptionId: SubscriptionId, options: { readonly keepEntries?: boolean } = {}): Promise<void> { await this.ready(); this.requireSubscription(subscriptionId); const subscriptions = { ...this.state.subscriptions }; delete subscriptions[subscriptionId]; const entries = options.keepEntries === false ? Object.fromEntries(Object.entries(this.state.entries).filter(([, value]) => value.subscriptionId !== subscriptionId)) : this.state.entries; this.state = { ...this.state, subscriptions, entries }; this.authorizedPrivateSubscriptions.delete(subscriptionId); this.rebuildIndex(); await this.persistAndEmit(); }

  async previewFeed(input: { readonly url: string; readonly ownerConfirmed: true; readonly allowPrivateNetwork?: true }): Promise<FeedSubscriptionPreview> {
    if (input.ownerConfirmed !== true) throw new SubscriptionError('POLICY_DENIED', 'Preview requires explicit owner confirmation'); const url = canonicalFeedUrl(input.url); if (isPrivateFeedUrl(url) && input.allowPrivateNetwork !== true) throw new SubscriptionError('SSRF_BLOCKED', 'Private feed preview requires explicit owner authorization'); const fetched = await this.feedClient.fetch({ url, allowPrivateNetwork: input.allowPrivateNetwork === true || !isPrivateFeedUrl(url) }); if (fetched.status !== 'OK' || !fetched.bytes) throw new SubscriptionError('SOURCE_UNAVAILABLE', 'Feed preview returned no content'); const parsed = this.parser.parse(fetched.bytes, fetched.contentType, fetched.finalUrl); return { canonicalUrl: fetched.finalUrl, hostname: new URL(fetched.finalUrl).hostname, format: parsed.format, title: parsed.title, recentItemCount: parsed.entries.length, warnings: parsed.warnings };
  }

  async refresh(subscriptionId: SubscriptionId, options: { readonly signal?: AbortSignal; readonly force?: boolean } = {}): Promise<FeedRefreshResult> {
    await this.ready(); const current = this.requireSubscription(subscriptionId); if (current.state === 'PAUSED' || current.state === 'DISABLED') return { status: 'ERROR', subscription: structuredClone(current), error: { code: 'POLICY_DENIED', message: 'Feed refresh is paused', transient: false }, newEntryIds: [], updatedEntryIds: [], newItemCount: 0, notificationDelivered: false }; if (this.refreshes.has(subscriptionId)) return { status: 'ERROR', subscription: structuredClone(current), error: { code: 'CONFLICT', message: 'Feed refresh is already running', transient: true }, newEntryIds: [], updatedEntryIds: [], newItemCount: 0, notificationDelivered: false };
    this.refreshes.add(subscriptionId); const attemptAt = iso(this.now()); const attempted = this.bumpSubscription({ ...current, lastAttemptAt: attemptAt, updatedAt: attemptAt }); this.state = { ...this.state, subscriptions: { ...this.state.subscriptions, [subscriptionId]: attempted } }; await this.persistAndEmit();
    try {
      const allowPrivateNetwork = this.authorizedPrivateSubscriptions.has(subscriptionId) && (current.privateNetworkRequested || isPrivateFeedUrl(current.canonicalUrl));
      const fetched = await this.feedClient.fetch({ url: current.canonicalUrl, etag: current.etag, lastModified: current.lastModified, allowPrivateNetwork, signal: options.signal });
      if (fetched.status === 'NOT_MODIFIED') { const next = this.bumpSubscription({ ...this.requireSubscription(subscriptionId), state: 'ACTIVE', etag: fetched.etag ?? current.etag, lastModified: fetched.lastModified ?? current.lastModified, lastSuccessfulRefreshAt: attemptAt, nextRefreshAt: iso(this.now() + current.refresh.refreshIntervalMs), lastError: undefined, updatedAt: iso(this.now()) }); this.state = { ...this.state, subscriptions: { ...this.state.subscriptions, [subscriptionId]: next } }; await this.persistAndEmit(); return { status: 'NOT_MODIFIED', subscription: structuredClone(next), newEntryIds: [], updatedEntryIds: [], newItemCount: 0, notificationDelivered: false };
      }
      if (!fetched.bytes) throw new SubscriptionError('MALFORMED_FEED', 'Feed response has no body'); const parsed = this.parser.parse(fetched.bytes, fetched.contentType, fetched.finalUrl); const result = await this.mergeParsedFeed(subscriptionId, parsed, fetched, attemptAt); return result;
    } catch (error) {
      const normalized = toSubscriptionError(error); const currentError = this.requireSubscription(subscriptionId); const state: SubscriptionState = { ...this.state, subscriptions: { ...this.state.subscriptions, [subscriptionId]: this.bumpSubscription({ ...currentError, state: normalized.code === 'AUTH_REQUIRED' ? 'AUTH_REQUIRED' : 'ERROR', lastError: { code: normalized.code, message: normalized.message, at: iso(this.now()) }, nextRefreshAt: iso(this.now() + backoffMs(currentError)), updatedAt: iso(this.now()) }) } }; this.state = state; await this.persistAndEmit(); return { status: 'ERROR', subscription: structuredClone(state.subscriptions[subscriptionId]!), error: { code: normalized.code, message: normalized.message, transient: normalized.transient }, newEntryIds: [], updatedEntryIds: [], newItemCount: 0, notificationDelivered: false };
    } finally { this.refreshes.delete(subscriptionId); }
  }

  async refreshDue(now = this.now()): Promise<readonly FeedRefreshResult[]> { await this.ready(); const due = Object.values(this.state.subscriptions).filter(value => value.state === 'ACTIVE' && (!value.nextRefreshAt || Date.parse(value.nextRefreshAt) <= now)).sort(compareSubscriptions); return runBounded(due, this.refreshConcurrency, subscription => this.refresh(subscription.id)); }
  createRefreshScheduler(): FeedRefreshScheduler { return new FeedRefreshScheduler(this); }

  async listEntries(query: SubscriptionListQuery = {}): Promise<SubscriptionPage> { await this.ready(); const limit = clampInt(query.limit, 1, 128, 50); const values = Object.values(this.state.entries).filter(value => this.matchesEntry(value, query)).sort(compareEntries); const start = query.cursor ? Math.max(0, values.findIndex(value => value.id === query.cursor) + 1) : 0; const page = values.slice(start, start + limit); return { items: page.map(value => structuredClone(value)), ...(start + limit < values.length ? { nextCursor: page.at(-1)!.id } : {}), total: values.length, unreadCount: values.filter(value => value.readState === 'UNREAD').length };
  }

  async search(query: string, options: Omit<SubscriptionListQuery, 'query'> = {}): Promise<readonly SubscriptionSearchResult[]> { await this.ready(); const terms = tokenize(query); if (!terms.length) return []; const folders = this.state.folders; const output: SubscriptionSearchResult[] = []; for (const entry of Object.values(this.state.entries)) { if (!this.matchesEntry(entry, options)) continue; const subscription = this.state.subscriptions[entry.subscriptionId]; if (!subscription) continue; const haystacks: Record<string, string> = { title: entry.title, content: `${entry.content.kind === 'HTML' ? entry.content.text : entry.content.text}`, author: entry.author ?? '', category: entry.categories.join(' '), tag: entry.tags.join(' '), feed: `${subscription.title} ${subscription.hostname} ${subscription.folderIds.map(id => folders[id]?.name ?? '').join(' ')}` }; const matched = (Object.entries(haystacks) as [SubscriptionSearchResult['matchedFields'][number], string][]).filter(([, value]) => terms.some(term => value.toLocaleLowerCase().includes(term))); if (!matched.length || !terms.every(term => Object.values(haystacks).some(value => value.toLocaleLowerCase().includes(term)))) continue; const score = matched.length * 10 + (terms.every(term => entry.title.toLocaleLowerCase().includes(term)) ? 30 : 0); output.push({ entry: structuredClone(entry), subscription: structuredClone(subscription), score, matchedFields: matched.map(value => value[0]), snippet: snippetFor(entry.content.kind === 'HTML' ? entry.content.text : entry.content.text, terms) }); }
    return output.sort((a, b) => b.score - a.score || compareEntries(a.entry, b.entry)).slice(0, Math.min(128, options.limit ?? 128));
  }

  async getEntry(id: FeedEntryId): Promise<FeedEntry | undefined> { await this.ready(); const value = this.state.entries[id]; return value ? structuredClone(value) : undefined; }
  async markRead(id: FeedEntryId, read = true): Promise<FeedEntry> { return this.updateEntryOrganization(id, { readState: read ? 'READ' : 'UNREAD' }); }
  async setFavorite(id: FeedEntryId, favorite: boolean): Promise<FeedEntry> { return this.updateEntryOrganization(id, { favorite }); }
  async markAllRead(query: Omit<SubscriptionListQuery, 'readState' | 'limit' | 'cursor'> = {}): Promise<number> { await this.ready(); let changed = 0; const entries = { ...this.state.entries }; for (const [id, value] of Object.entries(entries)) if (value.readState === 'UNREAD' && this.matchesEntry(value, query)) { entries[id] = { ...value, readState: 'READ', revision: value.revision + 1 }; changed += 1; } if (changed) { this.state = { ...this.state, entries }; await this.persistAndEmit(); } return changed; }

  render(entryId: FeedEntryId): FeedRenderedEntry { const entry = this.state.entries[entryId]; if (!entry) throw new SubscriptionError('NOT_FOUND', 'Feed entry not found'); return { entry: structuredClone(entry), safeHtml: entry.content.kind === 'HTML' ? entry.content.html : `<p>${escapeHtml(entry.content.text)}</p>`, externalRequestCount: 0, scriptsExecuted: 0, formsSubmitted: 0 }; }
  async openOriginal(entryId: FeedEntryId): Promise<void> { const entry = this.requireEntry(entryId); const url = entry.externalUrl ?? entry.url; if (!url || !this.links) throw new SubscriptionError('UNSUPPORTED', 'No external-link host is connected'); await this.links.openOriginal(url); }
  async shareEntry(entryId: FeedEntryId): Promise<void> { const entry = this.requireEntry(entryId); const url = entry.externalUrl ?? entry.url; if (!url || !this.links) throw new SubscriptionError('UNSUPPORTED', 'No sharing host is connected'); await this.links.shareLink(url); }
  async saveArticle(entryId: FeedEntryId): Promise<FeedEntry> { const entry = this.requireEntry(entryId); const url = entry.externalUrl ?? entry.url; if (!url || !this.webLibrary) throw new SubscriptionError('UNSUPPORTED', 'Web Library capture host is not connected'); const saved = await this.webLibrary.saveArticle({ url, title: entry.title, ownerConfirmed: true }); const next = { ...entry, savedWebLibraryEntryId: saved.entryId, revision: entry.revision + 1 }; this.state = { ...this.state, entries: { ...this.state.entries, [entry.id]: next } }; await this.persistAndEmit(); return structuredClone(next); }
  async continueEntry(entryId: FeedEntryId, input: { readonly kind: 'ARTICLE' | 'PODCAST'; readonly positionMs?: number; readonly enclosureId?: FeedEnclosureId }): Promise<void> { const entry = this.requireEntry(entryId); if (!this.continuity) throw new SubscriptionError('UNSUPPORTED', 'Continuity host is not connected'); await this.continuity.continue({ entryId: entry.id, title: entry.title, kind: input.kind, ...(input.positionMs !== undefined ? { positionMs: input.positionMs } : {}), ...(input.enclosureId ? { enclosureId: input.enclosureId } : {}) }); }

  async setNotificationPolicy(subscriptionId: SubscriptionId, notifyOnNewItems: boolean): Promise<FeedSubscription> { await this.ready(); const current = this.requireSubscription(subscriptionId); const next = this.bumpSubscription({ ...current, refresh: { ...current.refresh, notifyOnNewItems }, updatedAt: iso(this.now()) }); this.state = { ...this.state, subscriptions: { ...this.state.subscriptions, [subscriptionId]: next } }; await this.persistAndEmit(); return structuredClone(next); }
  async setAutoDownloadPolicy(subscriptionId: SubscriptionId, enabled: boolean, maxEpisodes = 2): Promise<FeedSubscription> { await this.ready(); const current = this.requireSubscription(subscriptionId); const next = this.bumpSubscription({ ...current, refresh: { ...current.refresh, autoDownloadEpisodes: enabled, maxAutoDownloadEpisodes: clampInt(maxEpisodes, 1, 20, 2) }, updatedAt: iso(this.now()) }); this.state = { ...this.state, subscriptions: { ...this.state.subscriptions, [subscriptionId]: next } }; await this.persistAndEmit(); return structuredClone(next); }

  async downloadEnclosure(entryId: FeedEntryId, enclosureId: FeedEnclosureId, options: { readonly signal?: AbortSignal; readonly maxBytes?: number } = {}): Promise<FeedEntry> {
    await this.ready(); const entry = this.requireEntry(entryId); const enclosure = entry.enclosures.find(value => value.id === enclosureId); if (!enclosure) throw new SubscriptionError('NOT_FOUND', 'Feed enclosure not found'); if (enclosure.kind === 'OTHER' || !enclosure.mimeType || (!enclosure.mimeType.startsWith('audio/') && !enclosure.mimeType.startsWith('video/'))) throw new SubscriptionError('UNSUPPORTED', 'Enclosure is not an audio or video resource'); const subscription = this.state.subscriptions[entry.subscriptionId]; const allowPrivateNetwork = subscription ? this.authorizedPrivateSubscriptions.has(subscription.id) && (subscription.privateNetworkRequested || isPrivateFeedUrl(subscription.canonicalUrl)) : false; const old = entry.downloads[enclosureId]; const existingBytes = old?.bytesDownloaded ?? 0; let writer = await this.enclosureStore.begin({ key: String(enclosureId), existingBytes, maxBytes: Math.min(SUBSCRIPTIONS_MAX_ENCLOSURE_BYTES, options.maxBytes ?? SUBSCRIPTIONS_MAX_ENCLOSURE_BYTES) }); const mark = (download: FeedEnclosureDownload) => { const current = this.requireEntry(entryId); const next = { ...current, downloads: { ...current.downloads, [enclosureId]: download }, revision: current.revision + 1 }; this.state = { ...this.state, entries: { ...this.state.entries, [entryId]: next } }; return next; }; mark({ state: 'DOWNLOADING', bytesDownloaded: existingBytes, ...(enclosure.lengthBytes ? { totalBytes: enclosure.lengthBytes } : {}), ...(enclosure.mimeType ? { mimeType: enclosure.mimeType } : {}), updatedAt: iso(this.now()) }); await this.persistAndEmit(); try { const fetched = await this.feedClient.download({ url: enclosure.url, rangeStart: existingBytes, allowPrivateNetwork, signal: options.signal, maxBytes: options.maxBytes, onResponse: async status => { if (existingBytes > 0 && status === 200) { await writer.abort(); writer = await this.enclosureStore.begin({ key: String(enclosureId), existingBytes: 0, maxBytes: Math.min(SUBSCRIPTIONS_MAX_ENCLOSURE_BYTES, options.maxBytes ?? SUBSCRIPTIONS_MAX_ENCLOSURE_BYTES) }); } }, onChunk: async chunk => { await writer.append(chunk); } }); const responseMime = fetched.contentType?.split(';', 1)[0]?.trim().toLocaleLowerCase(); if (responseMime && /^(?:text\/html|text\/javascript|application\/javascript|application\/x-sh|application\/x-httpd-php)$/.test(responseMime)) throw new SubscriptionError('UNSUPPORTED', 'Executable enclosure content is not allowed'); const stored = await writer.complete({ mimeType: enclosure.mimeType, ...(enclosure.title ? { name: safeFileName(enclosure.title) } : {}) }); const final = mark({ state: 'DOWNLOADED', bytesDownloaded: stored.byteLength, totalBytes: enclosure.lengthBytes ?? stored.byteLength, contentId: stored.contentId, contentHash: stored.contentHash, mimeType: stored.mimeType, updatedAt: iso(this.now()) }); await this.persistAndEmit(); return structuredClone(final);
    } catch (error) { await writer.abort().catch(() => undefined); const normalized = toSubscriptionError(error); const final = mark({ state: normalized.transient ? 'PAUSED' : 'FAILED', bytesDownloaded: writer.bytesWritten, ...(enclosure.lengthBytes ? { totalBytes: enclosure.lengthBytes } : {}), ...(enclosure.mimeType ? { mimeType: enclosure.mimeType } : {}), updatedAt: iso(this.now()), error: normalized.message }); await this.persistAndEmit(); void final; throw normalized;
    }
  }

  async playEnclosure(entryId: FeedEntryId, enclosureId: FeedEnclosureId): Promise<void> { const entry = this.requireEntry(entryId); const enclosure = entry.enclosures.find(value => value.id === enclosureId); const download = entry.downloads[enclosureId]; if (!enclosure || !download?.contentId || download.state !== 'DOWNLOADED' || !this.media) throw new SubscriptionError('UNAVAILABLE', 'Downloaded media or playback host is unavailable'); await this.media.play({ contentId: download.contentId, mimeType: download.mimeType ?? enclosure.mimeType ?? 'application/octet-stream', title: entry.title, positionMs: download.playbackPositionMs ?? 0 }); }
  async setPlaybackPosition(entryId: FeedEntryId, enclosureId: FeedEnclosureId, positionMs: number): Promise<FeedEntry> { if (!Number.isSafeInteger(positionMs) || positionMs < 0) throw new SubscriptionError('INVALID_ARGUMENT', 'Playback position is invalid'); await this.ready(); const entry = this.requireEntry(entryId); const current = entry.downloads[enclosureId]; if (!current) throw new SubscriptionError('NOT_FOUND', 'Enclosure download state not found'); const next = { ...entry, downloads: { ...entry.downloads, [enclosureId]: { ...current, playbackPositionMs: positionMs, updatedAt: iso(this.now()) } }, revision: entry.revision + 1 }; this.state = { ...this.state, entries: { ...this.state.entries, [entryId]: next } }; await this.persistAndEmit(); return structuredClone(next); }

  previewOpml(input: string | Uint8Array): OpmlPreview { return this.opml.preview(input); }
  async importOpml(preview: OpmlPreview, ownerConfirmed: true): Promise<OpmlImportResult> { await this.ready(); if (ownerConfirmed !== true) throw new SubscriptionError('POLICY_DENIED', 'OPML import requires explicit owner confirmation'); const createdFolders: FeedFolder[] = []; const folderByPath = new Map<string, FeedFolder>(); for (const path of preview.folders.slice(0, 1_000)) { const parts = path.split('/').filter(Boolean); let parent = ''; for (const part of parts) { parent = parent ? `${parent}/${part}` : part; if (!folderByPath.has(parent)) { const folder = await this.createFolder(part); folderByPath.set(parent, folder); createdFolders.push(folder); } } }
    const subscriptions: FeedSubscription[] = []; const skippedDuplicates: string[] = []; const invalidUrls = [...preview.invalidUrls]; for (const outline of preview.outlines) { if (!outline.xmlUrl || !outline.valid) continue; const existing = Object.values(this.state.subscriptions).find(value => value.canonicalUrl === outline.xmlUrl); if (existing) { skippedDuplicates.push(outline.xmlUrl); continue; } const folder = outline.folderPath.length ? folderByPath.get(outline.folderPath.join('/')) : undefined; try { subscriptions.push(await this.subscribe({ url: outline.xmlUrl, title: outline.title, origin: 'OPML', ownerConfirmed: true, ...(folder ? { folderIds: [folder.id] } : {}) })); } catch (error) { const normalized = toSubscriptionError(error); invalidUrls.push(`${outline.xmlUrl}: ${normalized.message}`); } }
    return { subscriptions, createdFolders, skippedDuplicates, invalidUrls: invalidUrls.slice(0, 1_000) };
  }
  exportOpml(): string { return this.opml.export(Object.values(this.state.subscriptions), Object.values(this.state.folders)); }
  discoverFromPage(input: { readonly pageUrl: string; readonly html: string }): readonly FeedDiscoveryCandidate[] { return this.discovery.discover(input); }

  async syncSnapshot(): Promise<FeedSubscriptionSyncSnapshot> { await this.ready(); return { version: 1, protocol: SUBSCRIPTIONS_PROTOCOL, deviceId: this.deviceId, subscriptions: Object.values(this.state.subscriptions).map(value => structuredClone(value)), folders: Object.values(this.state.folders).map(value => structuredClone(value)), entries: Object.values(this.state.entries).map(value => structuredClone(value)) }; }
  async publishSync(): Promise<void> { if (this.sync) await this.sync.publish(await this.syncSnapshot()); }
  async applySync(snapshot: FeedSubscriptionSyncSnapshot): Promise<void> { await this.ready(); if (!isValidSyncSnapshot(snapshot)) return; let changed = false; const subscriptions = { ...this.state.subscriptions }; for (const remote of snapshot.subscriptions.slice(0, this.maxSubscriptions)) { const local = subscriptions[remote.id]; if (!local || compareRevision(remote.revision, local.revision) > 0) { subscriptions[remote.id] = sanitizeSubscription(remote); changed = true; } } const folders = { ...this.state.folders }; for (const remote of snapshot.folders.slice(0, 1_000)) { const local = folders[remote.id]; if (!local || remote.updatedAt > local.updatedAt) { folders[remote.id] = sanitizeFolder(remote); changed = true; } } const entries = { ...this.state.entries }; for (const remote of snapshot.entries.slice(0, this.maxEntries)) { const local = entries[remote.id]; if (local && remote.revision > local.revision) { entries[remote.id] = { ...local, readState: remote.readState, favorite: remote.favorite, ...(remote.savedWebLibraryEntryId ? { savedWebLibraryEntryId: remote.savedWebLibraryEntryId } : {}), downloads: sanitizeDownloads(remote.downloads), revision: remote.revision }; changed = true; } else if (!local) { entries[remote.id] = sanitizeEntry(remote); changed = true; } } if (changed) { this.state = { ...this.state, subscriptions, folders, entries }; this.rebuildIndex(); await this.persistAndEmit(); } }

  /** Bounded Daily Layer projection; it is only useful when the owner enables feed source. */
  dailyItems(limit = 64): readonly FeedEntry[] { return Object.values(this.state.entries).filter(value => value.readState === 'UNREAD' && this.state.subscriptions[value.subscriptionId]?.refresh.notifyOnNewItems).sort(compareEntries).slice(0, Math.min(64, limit)).map(value => structuredClone(value)); }
  private async mergeParsedFeed(subscriptionId: SubscriptionId, parsed: ParsedFeed, fetched: FeedFetchResult, attemptAt: string): Promise<FeedRefreshResult> {
    const current = this.requireSubscription(subscriptionId); const priorEntries = Object.values(this.state.entries).filter(value => value.subscriptionId === subscriptionId); const hadBaseline = Boolean(current.lastSuccessfulRefreshAt); const entries = { ...this.state.entries }; const newEntryIds: FeedEntryId[] = []; const updatedEntryIds: FeedEntryId[] = [];
    for (const raw of parsed.entries.slice(0, this.maxEntriesPerFeed)) { const sourceItemId = raw.sourceItemId || `${raw.url ?? ''}|${raw.publishedAt ?? ''}|${raw.title}|${raw.contentText ?? raw.summary ?? raw.contentHtml ?? ''}`.slice(0, 1_000); const sourceKey = `${subscriptionId}:${sourceItemId}`; const entryId = this.entriesBySourceKey.get(sourceKey) ?? (`entry:${stableHash(sourceKey)}` as FeedEntryId); const previous = entries[entryId]; const entry = toFeedEntry(raw, subscriptionId, entryId, sourceItemId, current.canonicalUrl, this.now, previous, !hadBaseline); entries[entryId] = entry; this.entriesBySourceKey.set(sourceKey, entryId); if (!previous) newEntryIds.push(entryId); else if (previous.revision !== entry.revision) updatedEntryIds.push(entryId); }
    const feedEntries = Object.values(entries).filter(value => value.subscriptionId === subscriptionId).sort(compareEntries); for (const old of feedEntries.slice(this.maxEntriesPerFeed)) if (old.favorite || old.savedWebLibraryEntryId || Object.values(old.downloads).some(download => download.state === 'DOWNLOADED')) continue; else delete entries[old.id]; for (const value of Object.values(entries)) if (!value.favorite && !value.savedWebLibraryEntryId && Object.values(value.downloads).every(download => download.state !== 'DOWNLOADED')) { const all = Object.values(entries).filter(candidate => candidate.subscriptionId === value.subscriptionId); if (all.length > this.maxEntriesPerFeed) { const keep = new Set(all.sort(compareEntries).slice(0, this.maxEntriesPerFeed).map(candidate => candidate.id)); for (const candidate of all) if (!keep.has(candidate.id)) delete entries[candidate.id]; } }
    const next = this.bumpSubscription({ ...current, title: parsed.title || current.title, format: parsed.format, canonicalUrl: fetched.finalUrl, hostname: new URL(fetched.finalUrl).hostname, state: 'ACTIVE', etag: fetched.etag, lastModified: fetched.lastModified, lastSuccessfulRefreshAt: attemptAt, nextRefreshAt: iso(this.now() + current.refresh.refreshIntervalMs), lastError: undefined, updatedAt: iso(this.now()) }); this.state = { ...this.state, subscriptions: { ...this.state.subscriptions, [subscriptionId]: next }, entries }; this.rebuildIndex(); await this.persistAndEmit();
    const notificationIds = hadBaseline && next.refresh.notifyOnNewItems ? newEntryIds : []; let notificationDelivered = false; if (notificationIds.length && this.notifications) { await this.notifications.deliver({ subscriptionId, subscriptionTitle: next.title, itemIds: notificationIds.slice(0, 128), count: notificationIds.length, latestTitles: notificationIds.slice(0, 5).map(id => entries[id]!.title) }); notificationDelivered = true; }
    if (hadBaseline && next.refresh.autoDownloadEpisodes) { const candidates = newEntryIds.map(id => entries[id]!).flatMap(entry => entry.enclosures.filter(enclosure => enclosure.kind === 'AUDIO').map(enclosure => ({ entry, enclosure }))).slice(0, next.refresh.maxAutoDownloadEpisodes); for (const candidate of candidates) await this.downloadEnclosure(candidate.entry.id, candidate.enclosure.id).catch(() => undefined); }
    return { status: 'UPDATED', subscription: structuredClone(this.requireSubscription(subscriptionId)), newEntryIds, updatedEntryIds, newItemCount: newEntryIds.length, notificationDelivered };
  }
  private matchesEntry(entry: FeedEntry, query: SubscriptionListQuery): boolean { const subscription = this.state.subscriptions[entry.subscriptionId]; if (!subscription) return false; if (query.subscriptionId && entry.subscriptionId !== query.subscriptionId) return false; if (query.readState && entry.readState !== query.readState) return false; if (query.favorite !== undefined && entry.favorite !== query.favorite) return false; if (query.folderId && !subscription.folderIds.includes(query.folderId)) return false; if (query.podcastsOnly && !entry.enclosures.some(value => value.kind === 'AUDIO' || value.kind === 'VIDEO')) return false; if (query.query && !this.entryMatchesText(entry, subscription, query.query)) return false; return true; }
  private entryMatchesText(entry: FeedEntry, subscription: FeedSubscription, query: string): boolean { const haystack = `${entry.title} ${entry.author ?? ''} ${entry.content.kind === 'HTML' ? entry.content.text : entry.content.text} ${entry.categories.join(' ')} ${entry.tags.join(' ')} ${subscription.title} ${subscription.hostname}`.toLocaleLowerCase(); return tokenize(query).every(term => haystack.includes(term)); }
  private async updateEntryOrganization(id: FeedEntryId, patch: { readonly readState?: FeedReadState; readonly favorite?: boolean }): Promise<FeedEntry> { await this.ready(); const entry = this.requireEntry(id); const next = { ...entry, ...(patch.readState ? { readState: patch.readState } : {}), ...(patch.favorite !== undefined ? { favorite: patch.favorite } : {}), revision: entry.revision + 1 }; this.state = { ...this.state, entries: { ...this.state.entries, [id]: next } }; await this.persistAndEmit(); return structuredClone(next); }
  private async setSubscriptionState(id: SubscriptionId, state: SubscriptionStatus): Promise<FeedSubscription> { await this.ready(); const current = this.requireSubscription(id); const next = this.bumpSubscription({ ...current, state, updatedAt: iso(this.now()), nextRefreshAt: state === 'ACTIVE' ? iso(this.now()) : current.nextRefreshAt }); this.state = { ...this.state, subscriptions: { ...this.state.subscriptions, [id]: next } }; await this.persistAndEmit(); return structuredClone(next); }
  private requireSubscription(id: SubscriptionId): FeedSubscription { const value = this.state.subscriptions[id]; if (!value) throw new SubscriptionError('NOT_FOUND', 'Subscription not found'); return value; }
  private requireEntry(id: FeedEntryId): FeedEntry { const value = this.state.entries[id]; if (!value) throw new SubscriptionError('NOT_FOUND', 'Feed entry not found'); return value; }
  private bumpSubscription(value: FeedSubscription): FeedSubscription { return { ...value, revision: { clock: value.revision.clock + 1, deviceId: this.deviceId } }; }
  private rebuildIndex(): void { this.entriesBySourceKey.clear(); for (const entry of Object.values(this.state.entries)) this.entriesBySourceKey.set(`${entry.subscriptionId}:${entry.sourceItemId}`, entry.id); }
  private async hydrate(): Promise<void> { const stored = await this.store.read(); this.state = sanitizeState(stored, this.maxSubscriptions, this.maxEntries); this.rebuildIndex(); }
  private async persistAndEmit(): Promise<void> { await this.persist(); for (const listener of this.listeners) listener(); if (this.sync) await this.sync.publish(await this.syncSnapshot()); }
  private async persist(): Promise<void> { const snapshot = structuredClone(this.state); const operation = this.writeChain.then(() => this.store.write(snapshot)); this.writeChain = operation.catch(() => undefined); await operation; }
  close(): void { this.syncUnsubscribe?.(); this.listeners.clear(); }
}

export class FeedRefreshScheduler {
  constructor(private readonly service: SubscriptionService) {}
  runDue(now = Date.now()): Promise<readonly FeedRefreshResult[]> { return this.service.refreshDue(now); }
  async nextWakeAt(now = Date.now()): Promise<number | undefined> { const values = await this.service.listSubscriptions(); const candidates = values.filter(value => value.state === 'ACTIVE' && value.refresh.enabled).map(value => value.nextRefreshAt ? Date.parse(value.nextRefreshAt) : now).filter(value => Number.isFinite(value) && value >= now); return candidates.length ? Math.min(...candidates) : undefined; }
}

/** Optional Universal Inbox projection. It is intentionally opt-in through
 * the host's adapter registry and only exposes owner-enabled unread feeds. */
export function createSubscriptionsInboxAdapter(service: SubscriptionService): InboxProjectionAdapter<FeedEntry> {
  const list = async (input: InboxAdapterListInput): Promise<readonly FeedEntry[]> => {
    const page = await service.listEntries({ readState: 'UNREAD', limit: Math.min(64, input.limit), ...(input.cursor ? { cursor: input.cursor } : {}) });
    const enabled = new Set((await service.listSubscriptions()).filter(value => value.refresh.notifyOnNewItems).map(value => value.id));
    return page.items.filter(entry => enabled.has(entry.subscriptionId));
  };
  const sourceOf = (entry: FeedEntry): InboxSourceRef => ({ source: 'subscriptions', id: `subscriptions:${entry.subscriptionId}:${entry.id}`, subscriptionId: entry.subscriptionId, entryId: entry.id, feedUrl: entry.sourceNamespace });
  const projection = (entry: FeedEntry): InboxSourceProjection => {
    const source = sourceOf(entry);
    const action: { readonly id: InboxActionId; readonly kind: InboxActionKind; readonly label: string; readonly requiresOwnerConfirmation: boolean; readonly sourceVersion: string } = { id: `open:${entry.id}` as InboxActionId, kind: 'OPEN_SUBSCRIPTION', label: 'Open feed item', requiresOwnerConfirmation: false, sourceVersion: String(entry.revision) };
    return { source, kind: 'FEED_ITEM' satisfies InboxItemKind, sourceVersion: String(entry.revision), presentation: { title: entry.title, snippet: entry.content.text.slice(0, 280), receivedAt: entry.firstSeenAt, updatedAt: entry.updatedAt ?? entry.firstSeenAt, groupKey: `subscriptions:${entry.subscriptionId}`, reasons: ['New item in an enabled subscription'], priority: 'informational', requiresAction: false, dataClass: 'private' }, actions: [action] };
  };
  const emitCurrent = (listener: (event: InboxAdapterEvent<FeedEntry>) => void): void => { void list({ limit: 64 }).then(entries => { for (const entry of entries) listener({ kind: 'UPSERT', source: entry }); }).catch(() => undefined); };
  return {
    sourceKind: 'subscriptions', trust: 'CORE', list,
    refOf: sourceOf,
    project: projection,
    subscribe: listener => service.onChange(() => emitCurrent(listener)),
    refresh: async ref => ref.source === 'subscriptions' ? service.getEntry(ref.entryId as FeedEntryId) : undefined,
    resolve: async ref => ref.source === 'subscriptions' ? service.getEntry(ref.entryId as FeedEntryId) : undefined,
    execute: async (input: InboxSourceActionInput): Promise<InboxActionResult> => { if (input.action !== 'OPEN_SUBSCRIPTION' && input.action !== 'OPEN_SOURCE') throw new SubscriptionError('UNSUPPORTED', 'Subscription Inbox supports navigation only'); return { status: 'OPENED' }; },
  };
}

export interface FeedSubscriptionPreview { readonly canonicalUrl: string; readonly hostname: string; readonly format: FeedFormat; readonly title: string; readonly recentItemCount: number; readonly warnings: readonly string[]; }
export interface FeedRenderedEntry { readonly entry: FeedEntry; readonly safeHtml: string; readonly externalRequestCount: 0; readonly scriptsExecuted: 0; readonly formsSubmitted: 0; }

function toFeedEntry(raw: ParsedFeedEntry, subscriptionId: SubscriptionId, id: FeedEntryId, sourceItemId: string, sourceNamespace: string, now: () => number, previous: FeedEntry | undefined, initial: boolean): FeedEntry {
  const firstSeenAt = previous?.firstSeenAt ?? iso(now()); const publishedAt = safeDate(raw.publishedAt); const updatedAt = safeDate(raw.updatedAt); const sortTime = saneSortDate(updatedAt ?? publishedAt) ?? firstSeenAt; const content = feedContent(raw, sourceNamespace, firstSeenAt); const enclosures = raw.enclosures.slice(0, 16).map(enclosure => ({ version: 1 as const, ...enclosure, id: `enclosure:${stableHash(`${id}:${enclosure.url}`)}` as FeedEnclosureId })); const changed = !previous || previous.title !== raw.title || JSON.stringify(previous.content) !== JSON.stringify(content) || JSON.stringify(previous.enclosures) !== JSON.stringify(enclosures) || previous.url !== raw.url;
  return { version: 1, protocol: SUBSCRIPTIONS_PROTOCOL, id, subscriptionId, sourceItemId: boundedText(sourceItemId, 1_024), sourceNamespace, title: boundedText(raw.title, SUBSCRIPTIONS_MAX_TITLE) || 'Untitled entry', ...(raw.url ? { url: raw.url } : {}), ...(raw.externalUrl ? { externalUrl: raw.externalUrl } : {}), ...(raw.author ? { author: boundedText(raw.author, 320) } : {}), ...(publishedAt ? { publishedAt } : {}), ...(updatedAt ? { updatedAt } : {}), firstSeenAt, sortTime, categories: [...new Set(raw.categories.map(value => boundedText(value, 160)).filter(Boolean))].slice(0, 64), tags: [], content, enclosures, readState: previous?.readState ?? (initial ? 'READ' : 'UNREAD'), favorite: previous?.favorite ?? false, ...(previous?.savedWebLibraryEntryId ? { savedWebLibraryEntryId: previous.savedWebLibraryEntryId } : {}), downloads: previous?.downloads ?? {}, revision: previous ? previous.revision + (changed ? 1 : 0) : 1 };
}
function feedContent(raw: ParsedFeedEntry, sourceUrl: string, capturedAt: string): FeedEntryContent { if (raw.contentHtml) { const html = sanitizeFeedHtml(raw.contentHtml, sourceUrl); let text = raw.contentText || raw.summary || ''; try { text = extractReaderDocument({ html, sourceUrl, capturedAt, title: raw.title }).text || text; } catch { /* already bounded/sanitized fallback */ } return { kind: 'HTML', html, text: boundedText(text, SUBSCRIPTIONS_MAX_TEXT), externalRequestCount: 0, scriptsExecuted: 0, formsSubmitted: 0 }; } if (raw.contentText) return { kind: 'TEXT', text: boundedText(raw.contentText, SUBSCRIPTIONS_MAX_TEXT), externalRequestCount: 0, scriptsExecuted: 0, formsSubmitted: 0 }; return { kind: 'SUMMARY', text: boundedText(raw.summary, SUBSCRIPTIONS_MAX_TEXT), externalRequestCount: 0, scriptsExecuted: 0, formsSubmitted: 0 }; }
function saneSortDate(value: string | undefined): string | undefined { if (!value) return undefined; const parsed = Date.parse(value); const now = Date.now(); if (!Number.isFinite(parsed) || parsed < 0 || parsed > now + 366 * 24 * 60 * 60_000) return undefined; return new Date(parsed).toISOString(); }
function parseLooseAttributes(value: string): Record<string, string> { const output: Record<string, string> = {}; const pattern = /([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g; for (const match of value.matchAll(pattern)) output[match[1]!.toLocaleLowerCase()] = match[3] ?? match[4] ?? ''; return output; }
function compareSubscriptions(a: FeedSubscription, b: FeedSubscription): number { return a.title.localeCompare(b.title) || a.id.localeCompare(b.id); }
function compareEntries(a: FeedEntry, b: FeedEntry): number { return b.sortTime.localeCompare(a.sortTime) || b.firstSeenAt.localeCompare(a.firstSeenAt) || a.id.localeCompare(b.id); }
function tokenize(value: string): readonly string[] { return [...new Set((value.toLocaleLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? []).slice(0, 32))]; }
function snippetFor(value: string, terms: readonly string[]): string { const clean = value.replace(/\s+/g, ' ').trim(); const lower = clean.toLocaleLowerCase(); const position = terms.map(term => lower.indexOf(term)).filter(value => value >= 0).sort((a, b) => a - b)[0] ?? 0; return `${position > 32 ? '…' : ''}${clean.slice(Math.max(0, position - 32), position + 192)}${position + 192 < clean.length ? '…' : ''}`; }
function iso(now: number): string { return new Date(now).toISOString(); }
function randomId(): string { return typeof crypto?.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`; }
function stableHash(value: string): string { let hash = 2166136261; for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 16777619); } return `${(hash >>> 0).toString(16).padStart(8, '0')}-${value.length.toString(16)}`; }
function clampInt(value: unknown, min: number, max: number, fallback: number): number { return Number.isSafeInteger(value) ? Math.max(min, Math.min(max, Number(value))) : fallback; }
function backoffMs(subscription: FeedSubscription): number { const failures = subscription.lastError ? 2 : 1; return Math.min(SUBSCRIPTIONS_MAX_REFRESH_MS, Math.max(subscription.refresh.refreshIntervalMs, subscription.refresh.refreshIntervalMs * failures)); }
function safeDate(value: unknown): string | undefined { if (typeof value !== 'string') return undefined; const parsed = Date.parse(value); return Number.isFinite(parsed) && parsed >= 0 && parsed <= Date.now() + 366 * 24 * 60 * 60_000 ? new Date(parsed).toISOString() : undefined; }
function safeFileName(value: string): string { const clean = value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim().slice(0, 180); return clean || 'episode'; }
function escapeHtml(value: string): string { return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function toSubscriptionError(error: unknown): SubscriptionError { return error instanceof SubscriptionError ? error : new SubscriptionError('SOURCE_UNAVAILABLE', error instanceof Error ? error.message.slice(0, 256) : 'Subscription operation failed', true); }
function compareRevision(a: { readonly clock: number; readonly deviceId: string }, b: { readonly clock: number; readonly deviceId: string }): number { return a.clock - b.clock || a.deviceId.localeCompare(b.deviceId); }
function sanitizeState(value: unknown, maxSubscriptions: number, maxEntries: number): SubscriptionState {
  const output: SubscriptionState = structuredClone(EMPTY_STATE);
  if (!isRecord(value) || value.version !== 1 || value.protocol !== SUBSCRIPTIONS_PROTOCOL) return output;
  const subscriptions: Record<string, FeedSubscription> = {}; for (const [id, candidate] of Object.entries(value.subscriptions ?? {}).slice(0, maxSubscriptions)) { const parsed = safeSubscription(candidate); if (parsed && parsed.id === id) subscriptions[id] = parsed; }
  const folders: Record<string, FeedFolder> = {}; for (const [id, candidate] of Object.entries(value.folders ?? {}).slice(0, 1_000)) { const parsed = safeFolder(candidate); if (parsed && parsed.id === id) folders[id] = parsed; }
  const entries: Record<string, FeedEntry> = {}; for (const [id, candidate] of Object.entries(value.entries ?? {}).slice(0, maxEntries)) { const parsed = safeEntry(candidate); if (parsed && parsed.id === id && subscriptions[parsed.subscriptionId]) entries[id] = parsed; }
  return { version: 1, protocol: SUBSCRIPTIONS_PROTOCOL, subscriptions, folders, entries };
}
function safeSubscription(value: unknown): FeedSubscription | undefined { if (!isRecord(value) || value.version !== 1 || value.protocol !== SUBSCRIPTIONS_PROTOCOL || typeof value.id !== 'string' || typeof value.canonicalUrl !== 'string') return undefined; let url: string; try { url = canonicalFeedUrl(value.canonicalUrl); } catch { return undefined; } const state = ['ACTIVE', 'PAUSED', 'ERROR', 'AUTH_REQUIRED', 'DISABLED'].includes(String(value.state)) ? value.state as SubscriptionStatus : 'ERROR'; const refresh = isRecord(value.refresh) ? { enabled: value.refresh.enabled === true, notifyOnNewItems: value.refresh.notifyOnNewItems === true, autoDownloadEpisodes: value.refresh.autoDownloadEpisodes === true, maxAutoDownloadEpisodes: clampInt(value.refresh.maxAutoDownloadEpisodes, 1, 20, 2), refreshIntervalMs: clampInt(value.refresh.refreshIntervalMs, SUBSCRIPTIONS_MIN_REFRESH_MS, SUBSCRIPTIONS_MAX_REFRESH_MS, SUBSCRIPTIONS_DEFAULT_REFRESH_MS) } : { enabled: true, notifyOnNewItems: false, autoDownloadEpisodes: false, maxAutoDownloadEpisodes: 2, refreshIntervalMs: SUBSCRIPTIONS_DEFAULT_REFRESH_MS }; const revision = isRecord(value.revision) && Number.isSafeInteger(value.revision.clock) && typeof value.revision.deviceId === 'string' ? { clock: Math.max(0, Number(value.revision.clock)), deviceId: boundedText(value.revision.deviceId, 128) || 'remote-device' } : { clock: 0, deviceId: 'recovered' }; return { version: 1, protocol: SUBSCRIPTIONS_PROTOCOL, id: value.id as SubscriptionId, canonicalUrl: url, hostname: boundedText(value.hostname, 320) || new URL(url).hostname, title: boundedText(value.title, SUBSCRIPTIONS_MAX_TITLE) || new URL(url).hostname, ...(value.format === 'RSS_2_0' || value.format === 'ATOM_1_0' || value.format === 'JSON_FEED' ? { format: value.format } : {}), origin: value.origin === 'DISCOVERY' || value.origin === 'OPML' ? value.origin : 'MANUAL', state, privateNetworkRequested: value.privateNetworkRequested === true, folderIds: Array.isArray(value.folderIds) ? value.folderIds.filter(id => typeof id === 'string').slice(0, 32) as FeedFolderId[] : [], refresh, ...(typeof value.etag === 'string' ? { etag: value.etag.slice(0, 512) } : {}), ...(typeof value.lastModified === 'string' ? { lastModified: value.lastModified.slice(0, 512) } : {}), ...(typeof value.lastAttemptAt === 'string' ? { lastAttemptAt: value.lastAttemptAt } : {}), ...(typeof value.lastSuccessfulRefreshAt === 'string' ? { lastSuccessfulRefreshAt: value.lastSuccessfulRefreshAt } : {}), ...(typeof value.nextRefreshAt === 'string' ? { nextRefreshAt: value.nextRefreshAt } : {}), ...(isRecord(value.lastError) && typeof value.lastError.code === 'string' && typeof value.lastError.message === 'string' && typeof value.lastError.at === 'string' ? { lastError: { code: value.lastError.code as SubscriptionErrorCode, message: boundedText(value.lastError.message, 256), at: value.lastError.at } } : {}), createdAt: typeof value.createdAt === 'string' ? value.createdAt : iso(Date.now()), updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : iso(Date.now()), revision };
}
function sanitizeSubscription(value: FeedSubscription): FeedSubscription { const parsed = safeSubscription(value); if (!parsed) throw new SubscriptionError('CORRUPT_STATE', 'Invalid synchronized subscription state'); return parsed; }
function safeFolder(value: unknown): FeedFolder | undefined { if (!isRecord(value) || value.version !== 1 || typeof value.id !== 'string' || typeof value.name !== 'string') return undefined; return { version: 1, id: value.id as FeedFolderId, name: boundedText(value.name, 160) || 'Folder', createdAt: typeof value.createdAt === 'string' ? value.createdAt : iso(Date.now()), updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : iso(Date.now()) }; }
function sanitizeFolder(value: FeedFolder): FeedFolder { const parsed = safeFolder(value); if (!parsed) throw new SubscriptionError('CORRUPT_STATE', 'Invalid synchronized folder state'); return parsed; }
function safeContent(value: unknown): FeedEntryContent | undefined { if (!isRecord(value) || !['HTML', 'TEXT', 'SUMMARY'].includes(String(value.kind)) || typeof value.text !== 'string') return undefined; const kind = value.kind as FeedEntryContent['kind']; if (kind === 'HTML' && typeof value.html !== 'string') return undefined; return kind === 'HTML' ? { kind, html: sanitizeFeedHtml(value.html as string, 'https://invalid.local/feed'), text: boundedText(value.text, SUBSCRIPTIONS_MAX_TEXT), externalRequestCount: 0, scriptsExecuted: 0, formsSubmitted: 0 } : { kind, text: boundedText(value.text, SUBSCRIPTIONS_MAX_TEXT), externalRequestCount: 0, scriptsExecuted: 0, formsSubmitted: 0 }; }
function safeDownloads(value: unknown): Readonly<Record<string, FeedEnclosureDownload>> { const output: Record<string, FeedEnclosureDownload> = {}; if (!isRecord(value)) return output; for (const [id, candidate] of Object.entries(value).slice(0, 32)) if (isRecord(candidate) && ['QUEUED', 'DOWNLOADING', 'PAUSED', 'DOWNLOADED', 'FAILED'].includes(String(candidate.state)) && Number.isSafeInteger(candidate.bytesDownloaded) && Number(candidate.bytesDownloaded) >= 0) output[id] = { state: candidate.state as FeedDownloadState, bytesDownloaded: Math.min(SUBSCRIPTIONS_MAX_ENCLOSURE_BYTES, Number(candidate.bytesDownloaded)), ...(Number.isSafeInteger(candidate.totalBytes) ? { totalBytes: Math.min(SUBSCRIPTIONS_MAX_ENCLOSURE_BYTES, Number(candidate.totalBytes)) } : {}), ...(typeof candidate.contentId === 'string' && /^sha256-[a-f0-9]{64}$/i.test(candidate.contentId) ? { contentId: candidate.contentId as ContentId } : {}), ...(typeof candidate.contentHash === 'string' ? { contentHash: candidate.contentHash.slice(0, 128) } : {}), ...(typeof candidate.mimeType === 'string' ? { mimeType: candidate.mimeType.slice(0, 255) } : {}), ...(Number.isSafeInteger(candidate.playbackPositionMs) && Number(candidate.playbackPositionMs) >= 0 ? { playbackPositionMs: Number(candidate.playbackPositionMs) } : {}), updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : iso(Date.now()), ...(typeof candidate.error === 'string' ? { error: boundedText(candidate.error, 256) } : {}) }; return output; }
function sanitizeDownloads(value: Readonly<Record<string, FeedEnclosureDownload>>): Readonly<Record<string, FeedEnclosureDownload>> { return safeDownloads(value); }
function safeEntry(value: unknown): FeedEntry | undefined { if (!isRecord(value) || value.version !== 1 || value.protocol !== SUBSCRIPTIONS_PROTOCOL || typeof value.id !== 'string' || typeof value.subscriptionId !== 'string' || typeof value.sourceItemId !== 'string' || typeof value.title !== 'string' || typeof value.firstSeenAt !== 'string' || typeof value.sortTime !== 'string' || !Number.isSafeInteger(value.revision)) return undefined; const content = safeContent(value.content); if (!content || !Array.isArray(value.enclosures)) return undefined; const enclosures: FeedEnclosure[] = value.enclosures.slice(0, 16).flatMap(candidate => { if (!isRecord(candidate) || candidate.version !== 1 || typeof candidate.id !== 'string' || typeof candidate.url !== 'string') return []; try { return [{ version: 1, id: candidate.id as FeedEnclosureId, url: canonicalFeedUrl(candidate.url), ...(typeof candidate.mimeType === 'string' ? { mimeType: candidate.mimeType.slice(0, 255) } : {}), ...(Number.isSafeInteger(candidate.lengthBytes) ? { lengthBytes: Math.min(SUBSCRIPTIONS_MAX_ENCLOSURE_BYTES, Number(candidate.lengthBytes)) } : {}), ...(typeof candidate.title === 'string' ? { title: boundedText(candidate.title, SUBSCRIPTIONS_MAX_TITLE) } : {}), ...(Number.isSafeInteger(candidate.durationMs) ? { durationMs: Math.max(0, Number(candidate.durationMs)) } : {}), kind: candidate.kind === 'AUDIO' || candidate.kind === 'VIDEO' ? candidate.kind : 'OTHER' }]; } catch { return []; } }); return { version: 1, protocol: SUBSCRIPTIONS_PROTOCOL, id: value.id as FeedEntryId, subscriptionId: value.subscriptionId as SubscriptionId, sourceItemId: boundedText(value.sourceItemId, 1_024), sourceNamespace: boundedText(value.sourceNamespace, SUBSCRIPTIONS_MAX_URL), title: boundedText(value.title, SUBSCRIPTIONS_MAX_TITLE) || 'Untitled entry', ...(typeof value.url === 'string' ? { url: value.url } : {}), ...(typeof value.externalUrl === 'string' ? { externalUrl: value.externalUrl } : {}), ...(typeof value.author === 'string' ? { author: boundedText(value.author, 320) } : {}), ...(typeof value.publishedAt === 'string' ? { publishedAt: value.publishedAt } : {}), ...(typeof value.updatedAt === 'string' ? { updatedAt: value.updatedAt } : {}), firstSeenAt: value.firstSeenAt, sortTime: value.sortTime, categories: arrayText(value.categories, 64, 160), tags: arrayText(value.tags, 64, 160), content, enclosures, readState: value.readState === 'UNREAD' ? 'UNREAD' : 'READ', favorite: value.favorite === true, ...(typeof value.savedWebLibraryEntryId === 'string' ? { savedWebLibraryEntryId: boundedText(value.savedWebLibraryEntryId, 512) } : {}), downloads: safeDownloads(value.downloads), revision: Math.max(0, Number(value.revision)) };
}
function sanitizeEntry(value: FeedEntry): FeedEntry { const parsed = safeEntry(value); if (!parsed) throw new SubscriptionError('CORRUPT_STATE', 'Invalid synchronized entry state'); return parsed; }
function isValidSyncSnapshot(value: unknown): value is FeedSubscriptionSyncSnapshot { return isRecord(value) && value.version === 1 && value.protocol === SUBSCRIPTIONS_PROTOCOL && typeof value.deviceId === 'string' && Array.isArray(value.subscriptions) && Array.isArray(value.folders) && Array.isArray(value.entries) && value.subscriptions.slice(0, SUBSCRIPTIONS_MAX_SUBSCRIPTIONS).every(item => Boolean(safeSubscription(item))) && value.folders.slice(0, 1_000).every(item => Boolean(safeFolder(item))) && value.entries.slice(0, SUBSCRIPTIONS_MAX_ENTRIES).every(item => Boolean(safeEntry(item))); }

export function createSubscriptionsDailySource(service: SubscriptionService): DailyContextSource {
  return {
    sourceType: 'feed',
    trust: 'owner',
    collect: async (window: DailyContextWindow, owner: DailyContextOwnerContext): Promise<readonly DailyContextItem[]> => {
      if (!owner.sourceEnabled('feed')) return [];
      const values = service.dailyItems(Math.min(64, window.limit));
      return values.slice(0, Math.min(64, window.limit)).map(entry => ({ id: `daily:subscriptions:${entry.id}`, sourceType: 'feed', sourceId: entry.subscriptionId, canonicalRef: { id: entry.id, type: 'feed-entry' }, title: entry.title, ...(entry.content.text ? { summary: entry.content.text.slice(0, 280) } : {}), reason: 'New material in a selected subscription', createdAt: entry.firstSeenAt, updatedAt: entry.updatedAt ?? entry.firstSeenAt, priority: 'informational', dataClass: 'PRIVATE', dedupKey: `subscriptions:${entry.id}`, action: { kind: 'open-object', object: { id: entry.id, type: 'feed-entry' } } } satisfies DailyContextItem));
    },
  };
}

 async function runBounded<T, R>(values: readonly T[], concurrency: number, task: (value: T) => Promise<R>): Promise<readonly R[]> { const output: R[] = []; let cursor = 0; const worker = async () => { while (cursor < values.length) { const index = cursor++; output[index] = await task(values[index]!); } }; await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker())); return output; }
