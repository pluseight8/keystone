/**
 * R0P83 Mail & External Communications Bridge.
 *
 * Mail is an external transport.  This module owns the local projection,
 * drafts, search and bounded provider mutations; it never creates a Keystone
 * mailbox, central relay or ConnectivityFabric proxy.  Provider responses are
 * untrusted and credentials cross the provider boundary only through a scoped
 * callback supplied by a secret host.
 */

import type { SecretHandle, SecretReference, SecureSecretHost } from './security/secrets.js';

export const MAIL_VERSION = 1 as const;
export const MAIL_MAX_ACCOUNTS = 20;
export const MAIL_MAX_FOLDERS = 512;
export const MAIL_MAX_MESSAGES = 100_000;
export const MAIL_MAX_THREADS = 25_000;
export const MAIL_MAX_MESSAGE_BYTES = 8 * 1024 * 1024;
export const MAIL_MAX_BODY_BYTES = 4 * 1024 * 1024;
export const MAIL_MAX_RAW_BYTES = 8 * 1024 * 1024;
export const MAIL_MAX_ATTACHMENTS = 64;
export const MAIL_MAX_ATTACHMENT_BYTES = 256 * 1024 * 1024;
export const MAIL_MAX_HEADER_BYTES = 256 * 1024;
export const MAIL_MAX_HEADER_COUNT = 512;
export const MAIL_MAX_MIME_DEPTH = 12;
export const MAIL_MAX_MIME_PARTS = 256;
export const MAIL_MAX_OUTBOX = 2_048;
export const MAIL_MAX_OPERATIONS = 4_096;
export const MAIL_MAX_RECENT_RECIPIENTS = 256;
export const MAIL_MAX_SEARCH_RESULTS = 100;
export const MAIL_MAX_SYNC_MESSAGES = 1_000;
export const MAIL_MAX_SYNC_CONCURRENCY = 4;
export const MAIL_MAX_RETRIES = 8;
export const MAIL_MAX_CONNECT_TIMEOUT_MS = 30_000;
export const MAIL_MAX_READ_TIMEOUT_MS = 60_000;
export const MAIL_MAX_RETRY_DELAY_MS = 30 * 60_000;

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const EMAIL = /^[^\s@<>]{1,254}@[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/;
const MESSAGE_ID = /^<[^<>\s@]{1,240}@[A-Za-z0-9.-]{1,240}>$/;

export type MailErrorCode =
  | 'INVALID_ARGUMENT'
  | 'ACCOUNT_NOT_FOUND'
  | 'FOLDER_NOT_FOUND'
  | 'MESSAGE_NOT_FOUND'
  | 'DRAFT_NOT_FOUND'
  | 'OUTBOX_NOT_FOUND'
  | 'CREDENTIALS_REQUIRED'
  | 'AUTHENTICATION_FAILED'
  | 'PROVIDER_UNAVAILABLE'
  | 'OFFLINE'
  | 'TIMEOUT'
  | 'PROTOCOL_ERROR'
  | 'CONFLICT'
  | 'BOUNDS_EXCEEDED'
  | 'POLICY_DENIED'
  | 'UNKNOWN_SEND_STATE'
  | 'UNSUPPORTED';

export class MailError extends Error {
  constructor(readonly code: MailErrorCode, message: string, readonly transient = false, readonly ambiguous = false) {
    super(message);
    this.name = 'MailError';
  }
}

export type MailProviderKind = 'IMAP_SMTP' | 'JMAP' | 'CONTROLLED';
export type MailAuthKind = 'PASSWORD' | 'APP_PASSWORD' | 'OAUTH2';
export type MailSecurity = 'TLS' | 'STARTTLS';
export type MailTransportName = 'IMAP' | 'SMTP' | 'JMAP';

export interface MailAddress {
  readonly name?: string;
  readonly address: string;
}

export interface MailCredentialReference {
  readonly kind: 'MAIL_CREDENTIAL_REFERENCE';
  readonly handleId: string;
  readonly secretClass: 'PROVIDER_CREDENTIAL' | 'AUTH_TOKEN';
  readonly auth: MailAuthKind;
  readonly accountId: string;
  readonly secretReference?: SecretReference;
  readonly createdAt: string;
}

export interface MailEndpointConfig {
  readonly hostname: string;
  readonly port: number;
  readonly security: MailSecurity;
  /** Private/LAN endpoints are valid only when explicitly configured by the owner. */
  readonly allowPrivateNetwork?: boolean;
}

export interface ImapMailConfig {
  readonly endpoint: MailEndpointConfig;
  readonly username: string;
  readonly initialSyncLimit?: number;
}

export interface SmtpMailConfig {
  readonly endpoint: MailEndpointConfig;
  readonly username: string;
  readonly fromAliases?: readonly MailAddress[];
}

export interface JmapMailConfig {
  readonly endpoint: string;
  readonly username: string;
  readonly apiSessionUrl?: string;
  readonly allowPrivateNetwork?: boolean;
}

export interface ControlledMailConfig {
  readonly adapterId: string;
}

export type MailProviderConfig =
  | { readonly kind: 'IMAP_SMTP'; readonly imap: ImapMailConfig; readonly smtp: SmtpMailConfig; readonly adapterId?: string }
  | { readonly kind: 'JMAP'; readonly jmap: JmapMailConfig; readonly adapterId?: string }
  | { readonly kind: 'CONTROLLED'; readonly controlled: ControlledMailConfig; readonly adapterId?: string };

export type MailFolderRole = 'INBOX' | 'SENT' | 'DRAFTS' | 'ARCHIVE' | 'SPAM' | 'TRASH' | 'CUSTOM';
export interface MailFolder {
  readonly id: string;
  readonly accountId: string;
  readonly name: string;
  readonly path: string;
  readonly role: MailFolderRole;
  readonly selectable: boolean;
  readonly providerUidValidity?: string;
  readonly unreadCount?: number;
  readonly totalCount?: number;
}

export type MailFlag = 'SEEN' | 'STARRED' | 'ANSWERED' | 'DRAFT' | 'DELETED' | 'JUNK';
export interface MailAttachment {
  readonly id: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly contentId?: string;
  readonly disposition: 'ATTACHMENT' | 'INLINE';
  readonly contentAvailable: boolean;
  readonly privateByDefault: true;
}

export interface MailMessage {
  readonly id: string;
  readonly accountId: string;
  readonly folderId: string;
  readonly providerMessageId: string;
  readonly providerUid?: number;
  readonly providerUidValidity?: string;
  readonly messageId?: string;
  readonly inReplyTo?: string;
  readonly references: readonly string[];
  readonly threadId: string;
  readonly from: MailAddress;
  readonly to: readonly MailAddress[];
  readonly cc: readonly MailAddress[];
  /** Bcc is never copied from received message headers into normal display. */
  readonly bcc?: readonly MailAddress[];
  readonly replyTo?: readonly MailAddress[];
  readonly subject: string;
  readonly date?: string;
  readonly receivedAt: string;
  readonly snippet: string;
  readonly bodyText?: string;
  readonly bodyHtml?: string;
  readonly rawSource?: string;
  readonly attachments: readonly MailAttachment[];
  readonly flags: readonly MailFlag[];
  readonly readReceiptRequested: boolean;
  readonly contentState: 'METADATA' | 'CACHED' | 'PARTIAL';
  readonly externalImageUrls: readonly string[];
  readonly providerAuth?: { readonly spf?: string; readonly dkim?: string; readonly dmarc?: string; readonly arc?: string };
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface MailThread {
  readonly id: string;
  readonly accountId: string;
  readonly subject: string;
  readonly messageIds: readonly string[];
  readonly latestMessageId?: string;
  readonly unreadCount: number;
  readonly participants: readonly MailAddress[];
  readonly updatedAt: string;
}

export interface MailDraft {
  readonly id: string;
  readonly accountId: string;
  readonly inReplyToMessageId?: string;
  readonly to: readonly MailAddress[];
  readonly cc: readonly MailAddress[];
  readonly bcc: readonly MailAddress[];
  readonly subject: string;
  readonly bodyText: string;
  readonly bodyHtml?: string;
  readonly attachmentIds: readonly string[];
  readonly signature?: string;
  readonly status: 'DRAFT' | 'QUEUED' | 'SENDING' | 'SENT' | 'FAILED' | 'UNKNOWN';
  readonly stableMessageId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastError?: string;
}

export type MailOutboxState = 'QUEUED' | 'SENDING' | 'SENT' | 'FAILED' | 'UNKNOWN';
export interface MailOutboxEntry {
  readonly id: string;
  readonly accountId: string;
  readonly draftId: string;
  readonly stableMessageId: string;
  readonly state: MailOutboxState;
  readonly attempts: number;
  readonly nextAttemptAt: string;
  readonly lastError?: string;
  readonly ambiguousAt?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type MailMutationKind = 'MARK_READ' | 'SET_STARRED' | 'MOVE' | 'DELETE' | 'RESTORE';
export interface MailPendingMutation {
  readonly id: string;
  readonly accountId: string;
  readonly messageId: string;
  readonly kind: MailMutationKind;
  readonly value?: boolean | string;
  readonly baseFolderId: string;
  readonly createdAt: string;
  readonly attempts: number;
  readonly nextAttemptAt: string;
  readonly state: 'QUEUED' | 'APPLYING' | 'FAILED' | 'CONFLICT';
  readonly lastError?: string;
}

export interface MailFolderSyncState {
  readonly folderId: string;
  readonly uidValidity?: string;
  readonly cursor?: string;
  readonly highestUid?: number;
  readonly baselineEstablished: boolean;
  readonly updatedAt?: string;
}

export interface MailSyncState {
  readonly version: 1;
  readonly folders: Readonly<Record<string, MailFolderSyncState>>;
  readonly lastSuccessfulSync?: string;
  readonly baselineEstablished: boolean;
}

export interface MailAccount {
  readonly version: 1;
  readonly id: string;
  readonly label: string;
  readonly address: MailAddress;
  readonly provider: MailProviderConfig;
  readonly credential?: MailCredentialReference;
  readonly enabled: boolean;
  readonly syncState: MailSyncState;
  readonly lastSuccessfulSync?: string;
  readonly attention?: 'REAUTH_REQUIRED' | 'PROVIDER_UNAVAILABLE' | 'CONFIGURATION' | 'NONE';
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface MailAccountInput {
  readonly id?: string;
  readonly label: string;
  readonly address: MailAddress;
  readonly provider: MailProviderConfig;
  readonly credential?: MailCredentialReference;
  /** Required to make a provider endpoint an owner action rather than remote configuration. */
  readonly ownerConfirmed?: boolean;
}

export interface MailProviderCapabilities {
  readonly receive: boolean;
  readonly send: boolean;
  readonly folders: boolean;
  readonly deltaSync: boolean;
  readonly flags: boolean;
  readonly move: boolean;
  readonly delete: boolean;
  readonly attachments: boolean;
  readonly idle: boolean;
  readonly push: boolean;
  readonly tls: boolean;
  readonly starttls: boolean;
  readonly jmapState?: boolean;
  readonly smtpUtf8?: boolean;
  readonly aliases?: boolean;
}

export interface MailSyncOptions {
  readonly limit?: number;
  readonly fetchBodies?: boolean;
  readonly fetchAttachments?: boolean;
  readonly folderIds?: readonly string[];
  readonly signal?: AbortSignal;
}

export interface MailProviderMessage {
  readonly providerMessageId: string;
  readonly folderId: string;
  readonly providerUid?: number;
  readonly providerUidValidity?: string;
  readonly messageId?: string;
  readonly inReplyTo?: string;
  readonly references?: readonly string[];
  readonly from: MailAddress;
  readonly to?: readonly MailAddress[];
  readonly cc?: readonly MailAddress[];
  readonly bcc?: readonly MailAddress[];
  readonly replyTo?: readonly MailAddress[];
  readonly subject?: string;
  readonly date?: string;
  readonly receivedAt?: string;
  readonly snippet?: string;
  readonly bodyText?: string;
  readonly bodyHtml?: string;
  readonly rawSource?: string;
  readonly attachments?: readonly MailAttachment[];
  readonly flags?: readonly MailFlag[];
  readonly readReceiptRequested?: boolean;
  readonly providerAuth?: MailMessage['providerAuth'];
}

export interface MailSyncDelta {
  readonly folders: readonly MailFolder[];
  readonly messages: readonly MailProviderMessage[];
  readonly removedProviderMessageIds?: readonly string[];
  readonly nextState: MailSyncState;
  readonly complete: boolean;
  readonly baseline: boolean;
}

export interface MailSendInput {
  readonly messageId: string;
  readonly from: MailAddress;
  readonly to: readonly MailAddress[];
  readonly cc: readonly MailAddress[];
  readonly bcc: readonly MailAddress[];
  readonly subject: string;
  readonly bodyText: string;
  readonly bodyHtml?: string;
  readonly attachments: readonly MailAttachment[];
  /** Outbound bytes are ephemeral provider-bound data and are never persisted. */
  readonly attachmentPayloads?: readonly MailAttachmentPayload[];
  readonly serialized: string;
}

export interface MailAttachmentPayload {
  readonly attachment: MailAttachment;
  readonly bytes: Uint8Array;
}

export interface MailSendReceipt {
  readonly accepted: boolean;
  readonly providerMessageId?: string;
  readonly acceptedAt: string;
  readonly duplicate?: boolean;
  readonly ambiguous?: boolean;
}

export interface MailProviderContext {
  readonly account: MailAccount;
  readonly credentials?: MailCredentialAccess;
  readonly signal?: AbortSignal;
}

export interface MailProviderAdapter {
  readonly id: string;
  readonly kind: MailProviderKind;
  capabilities(account: MailAccount): MailProviderCapabilities;
  listFolders(context: MailProviderContext): Promise<readonly MailFolder[]>;
  sync(context: MailProviderContext, state: MailSyncState, options: MailSyncOptions): Promise<MailSyncDelta>;
  fetchMessage?(context: MailProviderContext, message: MailMessage): Promise<MailProviderMessage>;
  fetchAttachment?(context: MailProviderContext, message: MailMessage, attachment: MailAttachment): Promise<Uint8Array>;
  send(context: MailProviderContext, input: MailSendInput): Promise<MailSendReceipt>;
  mutate?(context: MailProviderContext, operation: MailPendingMutation, message: MailMessage): Promise<{ readonly applied: boolean; readonly folderId?: string; readonly flags?: readonly MailFlag[] }>;
  close?(): Promise<void> | void;
}

export interface MailCredentialAccess {
  withSecret<T>(operation: MailTransportName | 'ACCOUNT_TEST', callback: (secret: string) => Promise<T> | T): Promise<T>;
}

export interface MailCredentialBoundary {
  reference(handle: SecretHandle, accountId: string, auth: MailAuthKind): MailCredentialReference;
  access(reference: MailCredentialReference, operation: MailTransportName | 'ACCOUNT_TEST', callback: (secret: string) => Promise<unknown> | unknown): Promise<unknown>;
  revoke?(reference: MailCredentialReference): Promise<void> | void;
}

export interface MailState {
  readonly version: 1;
  readonly accounts: Readonly<Record<string, MailAccount>>;
  readonly folders: Readonly<Record<string, MailFolder>>;
  readonly messages: Readonly<Record<string, MailMessage>>;
  readonly drafts: Readonly<Record<string, MailDraft>>;
  readonly outbox: Readonly<Record<string, MailOutboxEntry>>;
  readonly mutations: Readonly<Record<string, MailPendingMutation>>;
  readonly recentRecipients: readonly MailAddress[];
  readonly externalImagePolicy: 'BLOCK_BY_DEFAULT' | 'ALLOW_EXPLICIT';
}

export interface MailStateStore {
  /** The host must implement this as encrypted/authenticated local storage. */
  read(): Promise<unknown | undefined>;
  write(value: unknown): Promise<void>;
}

export class InMemoryMailStateStore implements MailStateStore {
  private value?: unknown;
  async read(): Promise<unknown | undefined> { return this.value === undefined ? undefined : structuredClone(this.value); }
  async write(value: unknown): Promise<void> { this.value = structuredClone(value); }
}

/** Development/test-only credential boundary. Production uses SecureSecretHost. */
export class ControlledMailCredentialBoundary implements MailCredentialBoundary {
  private readonly values = new Map<string, string>();
  register(handleId: string, secret: string, accountId: string, auth: MailAuthKind = 'PASSWORD'): MailCredentialReference {
    if (!handleId || !secret) throw new MailError('CREDENTIALS_REQUIRED', 'Controlled credential must be non-empty');
    this.values.set(handleId, secret);
    return { kind: 'MAIL_CREDENTIAL_REFERENCE', handleId, secretClass: 'PROVIDER_CREDENTIAL', auth, accountId, createdAt: new Date().toISOString() };
  }
  reference(handle: SecretHandle, accountId: string, auth: MailAuthKind): MailCredentialReference { return this.register(handle.id, `controlled:${handle.id}`, accountId, auth); }
  async access(reference: MailCredentialReference, _operation: MailTransportName | 'ACCOUNT_TEST', callback: (secret: string) => Promise<unknown> | unknown): Promise<unknown> {
    const secret = this.values.get(reference.handleId); if (!secret) throw new MailError('CREDENTIALS_REQUIRED', 'Mail credential is unavailable'); return callback(secret);
  }
  async revoke(reference: MailCredentialReference): Promise<void> { this.values.delete(reference.handleId); }
}

/** Secret-host implementation. Secret bytes never enter MailState or logs. */
export class SecureMailCredentialBoundary implements MailCredentialBoundary {
  private readonly handles = new Map<string, SecretHandle>();
  constructor(private readonly host: SecureSecretHost, private readonly callerId = 'keystone-mail-service') {}
  reference(handle: SecretHandle, accountId: string, auth: MailAuthKind): MailCredentialReference {
    if (handle.reference.secretClass !== 'PROVIDER_CREDENTIAL' && handle.reference.secretClass !== 'AUTH_TOKEN') throw new MailError('POLICY_DENIED', 'Mail credentials require a provider credential or auth token handle');
    this.handles.set(handle.id, handle);
    return { kind: 'MAIL_CREDENTIAL_REFERENCE', handleId: handle.id, secretClass: handle.reference.secretClass, auth, accountId, secretReference: { ...handle.reference }, createdAt: new Date().toISOString() };
  }
  async access(reference: MailCredentialReference, operation: MailTransportName | 'ACCOUNT_TEST', callback: (secret: string) => Promise<unknown> | unknown): Promise<unknown> {
    let handle = this.handles.get(reference.handleId);
    if (!handle && reference.secretReference && this.host.restoreHandle) handle = await this.host.restoreHandle(reference.secretReference);
    if (!handle) throw new MailError('CREDENTIALS_REQUIRED', 'Mail credential handle is unavailable');
    handle.assertUsable('USE');
    if (!this.host.readForScopedAdapter) throw new MailError('POLICY_DENIED', 'Secret host does not expose scoped provider use');
    const secret = this.host.readForScopedAdapter(handle);
    try { return await callback(secret); } finally { handle.assertUsable('USE'); }
  }
  async revoke(reference: MailCredentialReference): Promise<void> { const handle = this.handles.get(reference.handleId); if (handle) await this.host.revoke(handle); this.handles.delete(reference.handleId); }
}

export interface MailNotification {
  readonly id: string;
  readonly accountId: string;
  readonly messageId: string;
  readonly title: string;
  readonly preview?: string;
  readonly sensitive: true;
}

export interface MailNotificationSink { notify(value: MailNotification): Promise<void> | void; }
export interface MailContactsAdapter {
  search(query: string, limit: number): Promise<readonly MailAddress[]> | readonly MailAddress[];
  link?(address: MailAddress, contactId: string): Promise<void> | void;
}
export interface MailFilesAdapter {
  savePrivateAttachment(input: { readonly accountId: string; readonly messageId: string; readonly attachment: MailAttachment; readonly bytes: Uint8Array }): Promise<{ readonly fileId: string }>;
}
export interface MailDailyAdapter {
  replace(sourceId: string, items: readonly MailDailyItem[]): Promise<void> | void;
}
export interface MailDailyItem {
  readonly id: string;
  readonly title: string;
  readonly summary?: string;
  readonly priority: 'communication' | 'time-sensitive' | 'completion';
  readonly requiresAction: boolean;
  readonly canonicalRef: { readonly id: string; readonly type: 'mail' | 'mail-thread' | 'mail-outbox' };
  readonly updatedAt: string;
}

export interface MailServiceOptions {
  readonly store?: MailStateStore;
  readonly adapters?: readonly MailProviderAdapter[];
  readonly credentials?: MailCredentialBoundary;
  readonly notifications?: MailNotificationSink;
  readonly contacts?: MailContactsAdapter;
  readonly files?: MailFilesAdapter;
  readonly daily?: MailDailyAdapter;
  readonly now?: () => number;
  readonly maxMessages?: number;
  readonly maxCacheBytes?: number;
}

export interface MailSearchResult {
  readonly id: string;
  readonly kind: 'mail' | 'mail-thread';
  readonly accountId: string;
  readonly title: string;
  readonly snippet: string;
  readonly score: number;
  readonly updatedAt: string;
}

export interface MailRenderedBody {
  readonly mode: 'TEXT' | 'SANITIZED_HTML';
  readonly value: string;
  readonly blockedExternalImages: readonly string[];
  readonly safeLinks: readonly { readonly url: string; readonly label: string }[];
}

export interface MailExternalLinkGateway {
  open(url: string): Promise<void>;
}

export interface MailProtocolErrorDetail { readonly code?: string; readonly response?: string; readonly transient?: boolean; readonly ambiguous?: boolean; }

function nowIso(now: number): string { return new Date(now).toISOString(); }
function clone<T>(value: T): T { return structuredClone(value); }
function randomId(prefix: string): string { if (!globalThis.crypto?.randomUUID) throw new MailError('PROTOCOL_ERROR', 'Secure randomness is unavailable'); return `${prefix}:${globalThis.crypto.randomUUID()}`; }
async function digest(value: string): Promise<string> { const bytes = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)); return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join(''); }
function bounded(value: unknown, max: number, required = false): string { if (typeof value !== 'string') { if (required) throw new MailError('INVALID_ARGUMENT', 'Expected text'); return ''; } const result = value.slice(0, max); if (required && !result.trim()) throw new MailError('INVALID_ARGUMENT', 'Text must not be empty'); return result; }
function boundedInt(value: unknown, min: number, max: number, fallback: number): number { const result = typeof value === 'number' && Number.isSafeInteger(value) ? value : fallback; if (result < min || result > max) throw new MailError('BOUNDS_EXCEEDED', 'Value is outside the mail bound'); return result; }
function validIso(value: unknown): value is string { return typeof value === 'string' && ISO.test(value) && Number.isFinite(Date.parse(value)); }
function safeEmail(value: unknown): string { if (typeof value !== 'string' || value.length > 254 || !EMAIL.test(value)) throw new MailError('INVALID_ARGUMENT', 'Email address is invalid'); return value.trim().toLowerCase(); }
function normalizeAddress(input: MailAddress): MailAddress { const address = safeEmail(input.address); const name = input.name === undefined ? undefined : bounded(input.name, 160); return name ? { name, address } : { address }; }
function normalizeAddresses(values: readonly MailAddress[] | undefined, max = 256): readonly MailAddress[] { if (!Array.isArray(values)) return []; if (values.length > max) throw new MailError('BOUNDS_EXCEEDED', 'Recipient count exceeds the mail bound'); return values.map(normalizeAddress); }
function addressKey(value: MailAddress): string { return value.address.toLowerCase(); }
function uniqueAddresses(values: readonly MailAddress[]): readonly MailAddress[] { return [...new Map(values.map(value => [addressKey(value), value])).values()]; }
function safeId(value: unknown, label: string, max = 256): string { if (typeof value !== 'string' || !value || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new MailError('INVALID_ARGUMENT', `${label} is invalid`); return value; }
function safeFilename(value: unknown): string { const name = bounded(value, 255, true).replace(/[\\/\u0000-\u001f\u007f]/g, '_').replace(/^\.+$/, '_'); return name || 'attachment'; }
function safeMimeType(value: unknown): string { const candidate = bounded(value, 255, true).split(';', 1)[0]!.trim().toLowerCase(); return /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(candidate) ? candidate : 'application/octet-stream'; }
function normalizeAttachment(value: unknown): MailAttachment {
  if (!value || typeof value !== 'object') throw new MailError('PROTOCOL_ERROR', 'Mail attachment metadata is invalid');
  const item = value as Partial<MailAttachment>;
  const contentId = typeof item.contentId === 'string' && !/[\u0000-\u001f\u007f]/.test(item.contentId) ? bounded(item.contentId, 512) : undefined;
  return { id: safeId(item.id, 'attachment id'), filename: safeFilename(item.filename), mimeType: safeMimeType(item.mimeType), sizeBytes: typeof item.sizeBytes === 'number' && Number.isSafeInteger(item.sizeBytes) ? Math.max(0, Math.min(MAIL_MAX_ATTACHMENT_BYTES, item.sizeBytes)) : 0, ...(contentId ? { contentId } : {}), disposition: item.disposition === 'INLINE' ? 'INLINE' : 'ATTACHMENT', contentAvailable: item.contentAvailable === true, privateByDefault: true };
}
function safeMessageId(value: string): string { if (!MESSAGE_ID.test(value)) throw new MailError('INVALID_ARGUMENT', 'Message-ID is invalid'); return value; }
function normalizeMessageId(value: unknown): string | undefined { if (typeof value !== 'string' || !value) return undefined; const candidate = value.trim(); return MESSAGE_ID.test(candidate) ? candidate : undefined; }
function normalizeFlags(values: readonly MailFlag[] | undefined): readonly MailFlag[] { return [...new Set((values ?? []).filter((value): value is MailFlag => ['SEEN', 'STARRED', 'ANSWERED', 'DRAFT', 'DELETED', 'JUNK'].includes(value)))]; }
function isPrivateHost(hostname: string): boolean { const value = hostname.toLowerCase(); return value === 'localhost' || value === '::1' || /^127\./.test(value) || /^10\./.test(value) || /^192\.168\./.test(value) || /^169\.254\./.test(value) || /^172\.(?:1[6-9]|2\d|3[0-1])\./.test(value) || value.endsWith('.local') || value.endsWith('.internal'); }
function validateEndpoint(value: MailEndpointConfig): MailEndpointConfig { const hostname = bounded(value.hostname, 255, true).trim(); if (/[\u0000-\u001f\u007f/\\?#]/.test(hostname) || hostname.includes('..')) throw new MailError('POLICY_DENIED', 'Mail hostname is unsafe'); const port = boundedInt(value.port, 1, 65_535, 0); if (!['TLS', 'STARTTLS'].includes(value.security)) throw new MailError('INVALID_ARGUMENT', 'Mail transport security is invalid'); if (isPrivateHost(hostname) && value.allowPrivateNetwork !== true) throw new MailError('POLICY_DENIED', 'Private mail endpoints require explicit owner configuration'); return { hostname, port, security: value.security, ...(value.allowPrivateNetwork ? { allowPrivateNetwork: true } : {}) }; }
function validateJmapUrl(value: string, allowPrivateNetwork = false): string { let url: URL; try { url = new URL(value); } catch { throw new MailError('POLICY_DENIED', 'JMAP endpoint is not a valid URL'); } if (url.protocol !== 'https:' && !(allowPrivateNetwork && url.protocol === 'http:')) throw new MailError('POLICY_DENIED', 'JMAP requires HTTPS unless an owner explicitly configured a private test endpoint'); if (url.username || url.password || url.hash || /[\u0000-\u001f\u007f]/.test(value) || isPrivateHost(url.hostname) && !allowPrivateNetwork) throw new MailError('POLICY_DENIED', 'JMAP endpoint is unsafe'); return url.toString(); }
function normalizeProviderConfig(input: MailProviderConfig): MailProviderConfig {
  if (!input || typeof input !== 'object') throw new MailError('PROTOCOL_ERROR', 'Mail provider configuration is invalid');
  const adapterId = input.adapterId === undefined ? undefined : safeId(input.adapterId, 'mail adapter id');
  if (input.kind === 'IMAP_SMTP') {
    const imap = input.imap; const smtp = input.smtp;
    if (!imap || !smtp) throw new MailError('PROTOCOL_ERROR', 'IMAP/SMTP provider configuration is incomplete');
    return { kind: 'IMAP_SMTP', ...(adapterId ? { adapterId } : {}), imap: { ...imap, endpoint: validateEndpoint(imap.endpoint), username: bounded(imap.username, 320, true), ...(imap.initialSyncLimit === undefined ? {} : { initialSyncLimit: boundedInt(imap.initialSyncLimit, 1, MAIL_MAX_SYNC_MESSAGES, MAIL_MAX_SYNC_MESSAGES) }) }, smtp: { ...smtp, endpoint: validateEndpoint(smtp.endpoint), username: bounded(smtp.username, 320, true), ...(smtp.fromAliases ? { fromAliases: normalizeAddresses(smtp.fromAliases, 32) } : {}) } };
  }
  if (input.kind === 'JMAP') {
    const jmap = input.jmap; if (!jmap) throw new MailError('PROTOCOL_ERROR', 'JMAP provider configuration is incomplete');
    const allowPrivateNetwork = jmap.allowPrivateNetwork === true;
    return { kind: 'JMAP', ...(adapterId ? { adapterId } : {}), jmap: { ...jmap, endpoint: validateJmapUrl(jmap.endpoint, allowPrivateNetwork), username: bounded(jmap.username, 320, true), ...(jmap.apiSessionUrl ? { apiSessionUrl: validateJmapUrl(jmap.apiSessionUrl, allowPrivateNetwork) } : {}), ...(allowPrivateNetwork ? { allowPrivateNetwork: true } : {}) } };
  }
  if (input.kind === 'CONTROLLED') return { kind: 'CONTROLLED', ...(adapterId ? { adapterId } : {}), controlled: { ...input.controlled, adapterId: safeId(input.controlled.adapterId, 'controlled adapter id') } };
  throw new MailError('PROTOCOL_ERROR', 'Unknown mail provider kind');
}
function defaultState(): MailState { return { version: 1, accounts: {}, folders: {}, messages: {}, drafts: {}, outbox: {}, mutations: {}, recentRecipients: [], externalImagePolicy: 'BLOCK_BY_DEFAULT' }; }
function transientError(error: unknown): MailError { if (error instanceof MailError) return error; const message = error instanceof Error ? error.message : 'Mail provider failed'; return new MailError('PROVIDER_UNAVAILABLE', message.slice(0, 256), true); }

export interface MailImapSession {
  authenticate(username: string, secret: string): Promise<void>;
  listFolders(): Promise<readonly MailFolder[]>;
  sync(state: MailSyncState, options: MailSyncOptions): Promise<MailSyncDelta>;
  fetchMessage(message: MailMessage): Promise<MailProviderMessage>;
  fetchAttachment(message: MailMessage, attachment: MailAttachment): Promise<Uint8Array>;
  mutate(operation: MailPendingMutation, message: MailMessage): Promise<{ readonly applied: boolean; readonly folderId?: string; readonly flags?: readonly MailFlag[] }>;
  close(): Promise<void> | void;
}

export interface MailImapSessionFactory { connect(endpoint: MailEndpointConfig): Promise<MailImapSession>; }
export interface MailSmtpSession {
  authenticate(username: string, secret: string): Promise<void>;
  send(input: MailSendInput): Promise<MailSendReceipt>;
  close(): Promise<void> | void;
}
export interface MailSmtpSessionFactory { connect(endpoint: MailEndpointConfig): Promise<MailSmtpSession>; }

/** Standards-backed adapter boundary.  The session factory is the host/network
 * implementation, so browser/mobile builds never receive a generic socket
 * primitive and the adapter never routes through ConnectivityFabric. */
export class ImapSmtpMailAdapter implements MailProviderAdapter {
  readonly id: string;
  readonly kind = 'IMAP_SMTP' as const;
  constructor(private readonly imap: MailImapSessionFactory, private readonly smtp: MailSmtpSessionFactory, id = 'imap-smtp') { this.id = id; }
  capabilities(account: MailAccount): MailProviderCapabilities {
    const config = account.provider.kind === 'IMAP_SMTP' ? account.provider : undefined;
    return { receive: true, send: true, folders: true, deltaSync: true, flags: true, move: true, delete: true, attachments: true, idle: false, push: false, tls: config?.imap.endpoint.security === 'TLS' || config?.smtp.endpoint.security === 'TLS', starttls: config?.imap.endpoint.security === 'STARTTLS' || config?.smtp.endpoint.security === 'STARTTLS', aliases: Boolean(config?.smtp.fromAliases?.length) };
  }
  private config(account: MailAccount): Extract<MailProviderConfig, { kind: 'IMAP_SMTP' }> { if (account.provider.kind !== 'IMAP_SMTP') throw new MailError('INVALID_ARGUMENT', 'IMAP/SMTP adapter received another provider kind'); return account.provider; }
  private async withImap<T>(context: MailProviderContext, fn: (session: MailImapSession, config: Extract<MailProviderConfig, { kind: 'IMAP_SMTP' }>) => Promise<T>): Promise<T> {
    const config = this.config(context.account); if (!context.credentials) throw new MailError('CREDENTIALS_REQUIRED', 'IMAP credentials are required');
    return context.credentials.withSecret('IMAP', async secret => { const session = await this.imap.connect(validateEndpoint(config.imap.endpoint)); try { await session.authenticate(config.imap.username, secret); return await fn(session, config); } finally { await session.close(); } });
  }
  async listFolders(context: MailProviderContext): Promise<readonly MailFolder[]> { return this.withImap(context, session => session.listFolders()); }
  async sync(context: MailProviderContext, state: MailSyncState, options: MailSyncOptions): Promise<MailSyncDelta> { return this.withImap(context, session => session.sync(state, { ...options, limit: boundedInt(options.limit, 1, MAIL_MAX_SYNC_MESSAGES, MAIL_MAX_SYNC_MESSAGES) })); }
  async fetchMessage(context: MailProviderContext, message: MailMessage): Promise<MailProviderMessage> { return this.withImap(context, session => session.fetchMessage(message)); }
  async fetchAttachment(context: MailProviderContext, message: MailMessage, attachment: MailAttachment): Promise<Uint8Array> { return this.withImap(context, session => session.fetchAttachment(message, attachment)); }
  async mutate(context: MailProviderContext, operation: MailPendingMutation, message: MailMessage): Promise<{ readonly applied: boolean; readonly folderId?: string; readonly flags?: readonly MailFlag[] }> { return this.withImap(context, session => session.mutate(operation, message)); }
  async send(context: MailProviderContext, input: MailSendInput): Promise<MailSendReceipt> {
    const config = this.config(context.account); if (!context.credentials) throw new MailError('CREDENTIALS_REQUIRED', 'SMTP credentials are required');
    return context.credentials.withSecret('SMTP', async secret => { const session = await this.smtp.connect(validateEndpoint(config.smtp.endpoint)); try { await session.authenticate(config.smtp.username, secret); return await session.send(input); } finally { await session.close(); } });
  }
}

export interface MailJmapResponse { readonly accountId?: string; readonly state?: string; readonly methodResponses?: readonly unknown[]; readonly [key: string]: unknown; }
export interface MailJmapClient { request(url: string, init: { readonly method: 'POST'; readonly headers: Readonly<Record<string, string>>; readonly body: string; readonly signal?: AbortSignal }): Promise<MailJmapResponse>; }
export interface MailJmapClientFactory { create(): MailJmapClient; }

/** Optional JMAP boundary.  It is deliberately capability-detected and never
 * required for an IMAP/SMTP account. */
export class JmapMailAdapter implements MailProviderAdapter {
  readonly id: string;
  readonly kind = 'JMAP' as const;
  constructor(private readonly factory: MailJmapClientFactory, id = 'jmap') { this.id = id; }
  capabilities(): MailProviderCapabilities { return { receive: true, send: true, folders: true, deltaSync: true, flags: true, move: true, delete: true, attachments: true, idle: false, push: false, tls: true, starttls: false, jmapState: true, smtpUtf8: true, aliases: true }; }
  private config(account: MailAccount): Extract<MailProviderConfig, { kind: 'JMAP' }> { if (account.provider.kind !== 'JMAP') throw new MailError('INVALID_ARGUMENT', 'JMAP adapter received another provider kind'); return account.provider; }
  private async request(context: MailProviderContext, methodCalls: readonly unknown[]): Promise<MailJmapResponse> {
    const config = this.config(context.account); if (!context.credentials) throw new MailError('CREDENTIALS_REQUIRED', 'JMAP credentials are required'); const url = validateJmapUrl(config.jmap.apiSessionUrl ?? config.jmap.endpoint, config.jmap.allowPrivateNetwork === true); const client = this.factory.create();
    return context.credentials.withSecret('JMAP', secret => client.request(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` }, body: JSON.stringify({ using: ['urn:ietf:params:jmap:core', 'urn:ietf:params:jmap:mail'], methodCalls }), signal: context.signal }));
  }
  async listFolders(context: MailProviderContext): Promise<readonly MailFolder[]> {
    const response = await this.request(context, [['Mailbox/get', { accountId: 'self', properties: ['id', 'name', 'role', 'totalEmails', 'unreadEmails'] }, 'folders']]); const method = response.methodResponses?.[0] as [string, Record<string, unknown>] | undefined; const list = Array.isArray(method?.[1]?.list) ? method[1].list : [];
    return list.slice(0, MAIL_MAX_FOLDERS).flatMap(value => { if (!value || typeof value !== 'object') return []; const item = value as Record<string, unknown>; const id = typeof item.id === 'string' ? item.id : undefined; const name = typeof item.name === 'string' ? item.name : undefined; if (!id || !name) return []; return [{ id: `${context.account.id}:jmap:${id}`, accountId: context.account.id, name: bounded(name, 200), path: id, role: jmapRole(item.role, name), selectable: true, ...(typeof item.unreadEmails === 'number' ? { unreadCount: Math.max(0, Math.floor(item.unreadEmails)) } : {}), ...(typeof item.totalEmails === 'number' ? { totalCount: Math.max(0, Math.floor(item.totalEmails)) } : {}) }]; });
  }
  async sync(context: MailProviderContext, state: MailSyncState, options: MailSyncOptions): Promise<MailSyncDelta> {
    const response = await this.request(context, [['Email/query', { accountId: 'self', limit: boundedInt(options.limit, 1, MAIL_MAX_SYNC_MESSAGES, 100), sort: [{ property: 'receivedAt', isAscending: false }] }, 'query'], ['Email/get', { accountId: 'self', '#ids': { resultOf: 'query', name: 'Email/query', path: '/ids' }, properties: ['id', 'threadId', 'mailboxIds', 'messageId', 'inReplyTo', 'references', 'from', 'to', 'cc', 'replyTo', 'subject', 'receivedAt', 'preview', 'keywords', 'bodyValues', 'attachments'] }, 'emails']]);
    const responses = response.methodResponses ?? []; const query = responses.find(value => Array.isArray(value) && value[0] === 'Email/query') as [string, Record<string, unknown>] | undefined; const emails = responses.find(value => Array.isArray(value) && value[0] === 'Email/get') as [string, Record<string, unknown>] | undefined; const list = Array.isArray(emails?.[1]?.list) ? emails[1].list : []; const folders = await this.listFolders(context); const messages = list.slice(0, MAIL_MAX_SYNC_MESSAGES).flatMap(value => jmapMessage(value, context.account.id, folders)); const cursor = typeof response.sessionState === 'string' ? response.sessionState : typeof state.lastSuccessfulSync === 'string' ? state.lastSuccessfulSync : undefined; return { folders, messages, nextState: { version: 1, folders: Object.fromEntries(folders.map(folder => [folder.id, { folderId: folder.id, cursor, baselineEstablished: state.baselineEstablished }])), ...(cursor ? { lastSuccessfulSync: cursor } : {}), baselineEstablished: state.baselineEstablished }, complete: !query?.[1]?.position, baseline: !state.baselineEstablished };
  }
  async send(context: MailProviderContext, input: MailSendInput): Promise<MailSendReceipt> { const response = await this.request(context, [['EmailSubmission/set', { accountId: 'self', create: { [input.messageId]: { emailId: input.messageId, envelope: { mailFrom: { email: input.from.address }, rcptTo: [...input.to, ...input.cc, ...input.bcc].map(value => ({ email: value.address })) } } } }, 'send']]); const method = response.methodResponses?.find(value => Array.isArray(value) && value[0] === 'EmailSubmission/set') as [string, Record<string, unknown>] | undefined; if (!method || method[1]?.type === 'error') throw new MailError('PROVIDER_UNAVAILABLE', 'JMAP submission was rejected', true); return { accepted: true, providerMessageId: input.messageId, acceptedAt: new Date().toISOString() }; }
  async mutate(context: MailProviderContext, operation: MailPendingMutation, message: MailMessage): Promise<{ readonly applied: boolean; readonly folderId?: string; readonly flags?: readonly MailFlag[] }> { const config = this.config(context.account); const providerId = message.providerMessageId; const properties: Record<string, unknown> = operation.kind === 'MARK_READ' ? { keywords: { ...(message.flags.includes('SEEN') || operation.value === true ? { '$seen': true } : {}) } } : operation.kind === 'SET_STARRED' ? { keywords: { ...(operation.value === true ? { '$flagged': true } : {}) } } : operation.kind === 'MOVE' ? { mailboxIds: { [String(operation.value)]: true } } : operation.kind === 'DELETE' ? { mailboxIds: { trash: true } } : {}; await this.request(context, [['Email/set', { accountId: 'self', update: { [providerId]: properties } }, 'mutate']]); return { applied: true }; }
}

function jmapRole(role: unknown, name: string): MailFolderRole { if (role === 'inbox' || name.toLowerCase() === 'inbox') return 'INBOX'; if (role === 'sent' || /sent|отправ/i.test(name)) return 'SENT'; if (role === 'drafts' || /draft|чернов/i.test(name)) return 'DRAFTS'; if (role === 'trash' || /trash|корзин/i.test(name)) return 'TRASH'; if (role === 'junk' || /spam|junk/i.test(name)) return 'SPAM'; return 'CUSTOM'; }
function jmapAddress(value: unknown): MailAddress | undefined { if (!value || typeof value !== 'object') return undefined; const candidate = value as Record<string, unknown>; if (typeof candidate.email !== 'string') return undefined; try { return normalizeAddress({ address: candidate.email, ...(typeof candidate.name === 'string' ? { name: candidate.name } : {}) }); } catch { return undefined; } }
 function jmapMessage(value: unknown, accountId: string, folders: readonly MailFolder[]): MailProviderMessage[] { if (!value || typeof value !== 'object') return []; const item = value as Record<string, unknown>; if (typeof item.id !== 'string') return []; const mailboxIds = item.mailboxIds && typeof item.mailboxIds === 'object' ? Object.keys(item.mailboxIds as object) : []; const folder = folders.find(candidate => mailboxIds.includes(candidate.path)) ?? folders.find(candidate => candidate.role === 'INBOX'); if (!folder) return []; const from = Array.isArray(item.from) ? jmapAddress(item.from[0]) : undefined; if (!from) return []; const addresses = (key: string): MailAddress[] => Array.isArray(item[key]) ? item[key].flatMap(value => { const address = jmapAddress(value); return address ? [address] : []; }) : []; const subject = typeof item.subject === 'string' ? item.subject : ''; return [{ providerMessageId: item.id, folderId: folder.id, messageId: Array.isArray(item.messageId) && typeof item.messageId[0] === 'string' ? normalizeMessageId(item.messageId[0]) : undefined, inReplyTo: Array.isArray(item.inReplyTo) && typeof item.inReplyTo[0] === 'string' ? normalizeMessageId(item.inReplyTo[0]) : undefined, references: Array.isArray(item.references) ? item.references.flatMap(value => typeof value === 'string' && MESSAGE_ID.test(value) ? [value] : []) : [], from, to: addresses('to'), cc: addresses('cc'), replyTo: addresses('replyTo'), subject, receivedAt: typeof item.receivedAt === 'string' ? item.receivedAt : undefined, snippet: typeof item.preview === 'string' ? item.preview : '', flags: item.keywords && typeof item.keywords === 'object' ? Object.keys(item.keywords as object).flatMap(value => value === '$seen' ? ['SEEN' as const] : value === '$flagged' ? ['STARRED' as const] : []) : [], attachments: Array.isArray(item.attachments) ? item.attachments.slice(0, MAIL_MAX_ATTACHMENTS).flatMap(value => jmapAttachment(value)) : [] }]; }
function jmapAttachment(value: unknown): MailAttachment[] { if (!value || typeof value !== 'object') return []; const item = value as Record<string, unknown>; if (typeof item.partId !== 'string' || typeof item.name !== 'string' || typeof item.type !== 'string') return []; const size = typeof item.size === 'number' && Number.isSafeInteger(item.size) ? Math.max(0, Math.min(MAIL_MAX_ATTACHMENT_BYTES, item.size)) : 0; return [{ id: item.partId, filename: safeFilename(item.name), mimeType: bounded(item.type, 255, true), sizeBytes: size, ...(typeof item.cid === 'string' ? { contentId: bounded(item.cid, 512) } : {}), disposition: item.disposition === 'inline' ? 'INLINE' : 'ATTACHMENT', contentAvailable: false, privateByDefault: true }]; }

/** Deterministic in-memory provider used by tests and host integration smoke tests. */
export class ControlledMailProvider implements MailProviderAdapter {
  readonly id: string;
  readonly kind = 'CONTROLLED' as const;
  private online = true;
  private readonly folders = new Map<string, MailFolder>();
  private readonly messages = new Map<string, MailProviderMessage>();
  private readonly sent = new Map<string, MailSendReceipt>();
  private readonly sentInputs = new Map<string, MailSendInput>();
  private uidValidity = 'controlled-1';
  private cursor = 0;
  constructor(id = 'controlled', private readonly accountId = 'controlled-account') { this.id = id; this.folders.set(`${accountId}:inbox`, { id: `${accountId}:inbox`, accountId, name: 'Inbox', path: 'INBOX', role: 'INBOX', selectable: true, providerUidValidity: this.uidValidity }); this.folders.set(`${accountId}:sent`, { id: `${accountId}:sent`, accountId, name: 'Sent', path: 'Sent', role: 'SENT', selectable: true, providerUidValidity: this.uidValidity }); this.folders.set(`${accountId}:drafts`, { id: `${accountId}:drafts`, accountId, name: 'Drafts', path: 'Drafts', role: 'DRAFTS', selectable: true, providerUidValidity: this.uidValidity }); this.folders.set(`${accountId}:trash`, { id: `${accountId}:trash`, accountId, name: 'Trash', path: 'Trash', role: 'TRASH', selectable: true, providerUidValidity: this.uidValidity }); }
  capabilities(): MailProviderCapabilities { return { receive: true, send: true, folders: true, deltaSync: true, flags: true, move: true, delete: true, attachments: true, idle: false, push: false, tls: true, starttls: true, aliases: true }; }
  setOnline(value: boolean): void { this.online = value; }
  rotateUidValidity(): void { this.uidValidity = `controlled-${++this.cursor}`; for (const [id, folder] of this.folders) this.folders.set(id, { ...folder, providerUidValidity: this.uidValidity }); }
  addMessage(value: Omit<MailProviderMessage, 'providerUidValidity'> & { readonly providerUid?: number }): void { const uid = value.providerUid ?? this.messages.size + 1; this.messages.set(value.providerMessageId, { ...value, providerUid: uid, providerUidValidity: this.uidValidity, receivedAt: value.receivedAt ?? new Date().toISOString() }); }
  listSent(): readonly MailSendReceipt[] { return [...this.sent.values()].map(clone); }
  listSentInputs(): readonly MailSendInput[] { return [...this.sentInputs.values()].map(clone); }
  private assertOnline(): void { if (!this.online) throw new MailError('OFFLINE', 'Controlled provider is offline', true); }
  async listFolders(_context: MailProviderContext): Promise<readonly MailFolder[]> { this.assertOnline(); return [...this.folders.values()].map(clone); }
  async sync(_context: MailProviderContext, state: MailSyncState, options: MailSyncOptions): Promise<MailSyncDelta> { this.assertOnline(); const limit = boundedInt(options.limit, 1, MAIL_MAX_SYNC_MESSAGES, MAIL_MAX_SYNC_MESSAGES); const folders = [...this.folders.values()]; const existingValidity = Object.values(state.folders).find(value => value.uidValidity)?.uidValidity; const reset = existingValidity !== undefined && existingValidity !== this.uidValidity; const previousHigh = (folderId: string): number => reset ? 0 : state.folders[folderId]?.highestUid ?? 0; const eligible = [...this.messages.values()].filter(value => (!options.folderIds?.length || options.folderIds.includes(value.folderId)) && (value.providerUid ?? 0) > previousHigh(value.folderId)).sort((a, b) => (a.providerUid ?? 0) - (b.providerUid ?? 0)); const values = eligible.slice(0, limit); const messages = options.fetchBodies === false ? values.map(value => { const { bodyText: _bodyText, bodyHtml: _bodyHtml, rawSource: _rawSource, ...metadata } = value; return metadata; }) : values; const more = eligible.length > values.length; const baselineComplete = state.baselineEstablished || (!more && !reset); const next: MailSyncState = { version: 1, folders: Object.fromEntries(folders.map(folder => [folder.id, { folderId: folder.id, uidValidity: this.uidValidity, highestUid: messages.filter(value => value.folderId === folder.id).reduce((max, value) => Math.max(max, value.providerUid ?? 0), previousHigh(folder.id)), cursor: String(this.cursor), baselineEstablished: baselineComplete, updatedAt: new Date().toISOString() }])), lastSuccessfulSync: new Date().toISOString(), baselineEstablished: baselineComplete }; return { folders, messages, nextState: next, complete: !more, baseline: !state.baselineEstablished || reset }; }
  async fetchMessage(_context: MailProviderContext, message: MailMessage): Promise<MailProviderMessage> { this.assertOnline(); const value = this.messages.get(message.providerMessageId); if (!value) throw new MailError('MESSAGE_NOT_FOUND', 'Controlled provider message not found'); return clone(value); }
  async fetchAttachment(_context: MailProviderContext, message: MailMessage, attachment: MailAttachment): Promise<Uint8Array> { this.assertOnline(); return new TextEncoder().encode(`controlled attachment ${message.id}:${attachment.id}`); }
  async send(_context: MailProviderContext, input: MailSendInput): Promise<MailSendReceipt> { this.assertOnline(); const previous = this.sent.get(input.messageId); if (previous) return { ...previous, duplicate: true }; const receipt = { accepted: true as const, providerMessageId: input.messageId, acceptedAt: new Date().toISOString() }; this.sent.set(input.messageId, receipt); this.sentInputs.set(input.messageId, clone(input)); this.addMessage({ providerMessageId: input.messageId, folderId: `${this.accountId}:sent`, messageId: input.messageId, from: input.from, to: input.to, cc: input.cc, bcc: [], subject: input.subject, bodyText: input.bodyText, bodyHtml: input.bodyHtml, attachments: input.attachments, flags: ['SEEN'], snippet: input.bodyText.slice(0, 180) }); return receipt; }
  async mutate(_context: MailProviderContext, operation: MailPendingMutation, message: MailMessage): Promise<{ readonly applied: boolean; readonly folderId?: string; readonly flags?: readonly MailFlag[] }> { this.assertOnline(); const value = this.messages.get(message.providerMessageId); if (!value) return { applied: false }; if (operation.kind === 'MOVE' && typeof operation.value === 'string') return { applied: true, folderId: operation.value }; if (operation.kind === 'DELETE') return { applied: true, folderId: `${this.accountId}:trash`, flags: [...new Set([...(value.flags ?? []), 'DELETED' as const])] }; if (operation.kind === 'MARK_READ') return { applied: true, flags: operation.value === true ? [...new Set([...(value.flags ?? []), 'SEEN' as const])] : (value.flags ?? []).filter(flag => flag !== 'SEEN') }; if (operation.kind === 'SET_STARRED') return { applied: true, flags: operation.value === true ? [...new Set([...(value.flags ?? []), 'STARRED' as const])] : (value.flags ?? []).filter(flag => flag !== 'STARRED') }; return { applied: true }; }
}

export interface MailMimeHeader { readonly name: string; readonly value: string; }
export interface MailMimePart {
  readonly headers: readonly MailMimeHeader[];
  readonly contentType: string;
  readonly disposition?: string;
  readonly filename?: string;
  readonly contentId?: string;
  readonly body: string;
  readonly children: readonly MailMimePart[];
}

export interface MailMimeParseOptions {
  readonly maxBytes?: number;
  readonly maxHeaderBytes?: number;
  readonly maxHeaderCount?: number;
  readonly maxDepth?: number;
  readonly maxParts?: number;
}

/** Bounded MIME parser for display/metadata extraction. It is intentionally
 * not an execution-capable MIME engine. */
export function parseMailMime(source: string, options: MailMimeParseOptions = {}): MailMimePart {
  const maxBytes = options.maxBytes ?? MAIL_MAX_RAW_BYTES; const maxHeaderBytes = options.maxHeaderBytes ?? MAIL_MAX_HEADER_BYTES; const maxHeaderCount = options.maxHeaderCount ?? MAIL_MAX_HEADER_COUNT; const maxDepth = options.maxDepth ?? MAIL_MAX_MIME_DEPTH; const maxParts = options.maxParts ?? MAIL_MAX_MIME_PARTS;
  if (typeof source !== 'string' || new TextEncoder().encode(source).byteLength > maxBytes) throw new MailError('BOUNDS_EXCEEDED', 'MIME source exceeds the bounded parser budget');
  let parts = 0;
  const parse = (value: string, depth: number): MailMimePart => {
    if (depth > maxDepth || ++parts > maxParts) throw new MailError('BOUNDS_EXCEEDED', 'MIME nesting or part count exceeds the bound');
    const split = value.match(/\r?\n\r?\n/); const headerText = (split?.index === undefined ? value : value.slice(0, split.index)).slice(0, maxHeaderBytes); const body = split?.index === undefined ? '' : value.slice(split.index + split[0].length); const headers = parseMailHeaders(headerText, maxHeaderCount); const contentType = headerValue(headers, 'content-type') ?? 'text/plain'; const disposition = headerValue(headers, 'content-disposition'); const params = parseHeaderParameters(contentType); const dispositionParams = parseHeaderParameters(disposition ?? ''); const boundary = params.boundary; const children = boundary ? splitMultipart(body, boundary).map(item => parse(item, depth + 1)) : [];
    return { headers, contentType: params.value, ...(disposition ? { disposition: disposition.split(';', 1)[0]!.trim().toLowerCase() } : {}), ...(dispositionParams.filename || params.name ? { filename: safeFilename(dispositionParams.filename ?? params.name) } : {}), ...(headerValue(headers, 'content-id') ? { contentId: bounded(headerValue(headers, 'content-id'), 512) } : {}), body: children.length ? '' : decodeMimeBody(body, headerValue(headers, 'content-transfer-encoding')), children };
  };
  return parse(source, 0);
}

function parseMailHeaders(source: string, maxCount: number): readonly MailMimeHeader[] {
  const unfolded = source.replace(/\r?\n[ \t]+/g, ' '); const lines = unfolded.split(/\r?\n/); const output: MailMimeHeader[] = []; let current: MailMimeHeader | undefined;
  for (const line of lines) { if (!line) continue; const separator = line.indexOf(':'); if (separator <= 0) continue; const name = line.slice(0, separator).trim().toLowerCase(); if (!/^[a-z0-9-]{1,80}$/.test(name)) continue; const value = line.slice(separator + 1).trim().slice(0, 16_384); current = { name, value }; output.push(current); if (output.length >= maxCount) break; }
  return output;
}
function headerValue(headers: readonly MailMimeHeader[], name: string): string | undefined { return headers.find(value => value.name === name.toLowerCase())?.value; }
function parseHeaderParameters(value: string): { readonly value: string; readonly boundary?: string; readonly name?: string; readonly filename?: string } { const [first, ...rest] = value.split(';'); const params: { value: string; boundary?: string; name?: string; filename?: string } = { value: (first ?? 'text/plain').trim().toLowerCase() }; for (const part of rest) { const separator = part.indexOf('='); if (separator <= 0) continue; const key = part.slice(0, separator).trim().toLowerCase(); const raw = part.slice(separator + 1).trim().replace(/^"|"$/g, '').slice(0, 255); if (key === 'boundary') params.boundary = raw; if (key === 'name') params.name = raw; if (key === 'filename') params.filename = raw; } return params; }
function splitMultipart(body: string, boundary: string): readonly string[] { const marker = `--${boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`; return body.split(new RegExp(`(?:^|\\r?\\n)${marker}(?:--)?(?:\\r?\\n|$)`, 'g')).map(value => value.trim()).filter(Boolean).slice(0, MAIL_MAX_MIME_PARTS); }
function decodeMimeBody(value: string, transferEncoding?: string): string { const normalized = transferEncoding?.toLowerCase(); if (normalized === 'base64') { try { const binary = atob(value.replace(/\s/g, '')); return new TextDecoder().decode(Uint8Array.from(binary, char => char.charCodeAt(0))); } catch { return ''; } } if (normalized === 'quoted-printable') return value.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16))); return value; }

export interface MailHtmlSanitizeOptions { readonly allowExternalImages?: boolean; readonly maxChars?: number; }
export interface MailHtmlSanitizeResult { readonly html: string; readonly externalImageUrls: readonly string[]; readonly links: readonly { readonly url: string; readonly label: string }[]; }

/** Sanitizes HTML into a deliberately narrow, non-executing mail surface. It
 * removes active content and never performs a network request. */
export function sanitizeMailHtml(input: string, options: MailHtmlSanitizeOptions = {}): MailHtmlSanitizeResult {
  const source = bounded(input, options.maxChars ?? MAIL_MAX_BODY_BYTES); const externalImageUrls: string[] = []; const links: { url: string; label: string }[] = [];
  let html = source.replace(/<!--[\s\S]*?-->/g, '').replace(/<\s*(script|iframe|object|embed|form|style|link|meta|base)(?:\s[^>]*)?>[\s\S]*?<\s*\/\s*\1\s*>/gi, '').replace(/<\s*(script|iframe|object|embed|form|style|link|meta|base)(?:\s[^>]*)?\/?\s*>/gi, '');
  html = html.replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '').replace(/\s+(?:style|srcdoc)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  html = html.replace(/\s+(href|action)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi, (_match, attribute: string, double: string, single: string, bare: string) => { const url = (double ?? single ?? bare ?? '').trim(); if (!safeMailLink(url)) return ''; return ` ${attribute.toLowerCase()}="${escapeHtml(url)}"`; });
  html = html.replace(/\s+(?:src|poster)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi, (_match, double: string, single: string, bare: string) => { const url = (double ?? single ?? bare ?? '').trim(); if (/^cid:/i.test(url) || /^data:image\//i.test(url)) return ` src="${escapeHtml(url)}"`; if (/^https?:\/\//i.test(url)) { externalImageUrls.push(url); return options.allowExternalImages === true ? ` src="${escapeHtml(url)}" data-mail-external-image="explicit"` : ' data-mail-external-image="blocked"'; } return ''; });
  html = html.replace(/<\s*([a-z0-9-]+)([^>]*)>/gi, (_match, tag: string, attrs: string) => { const allowed = new Set(['a', 'abbr', 'b', 'blockquote', 'br', 'code', 'div', 'em', 'i', 'li', 'ol', 'p', 'pre', 'small', 'span', 'strong', 'table', 'tbody', 'td', 'th', 'thead', 'tr', 'u', 'ul', 'img']); if (!allowed.has(tag.toLowerCase())) return ''; const cleaned = attrs.replace(/\s+(?:id|class|title|target|rel)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, (value: string) => value.startsWith(' title=') ? value : ''); return `<${tag.toLowerCase()}${cleaned}>`; });
  html = html.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (_match, attrs: string, label: string) => { const href = attrs.match(/\bhref\s*=\s*"([^"]+)"/i)?.[1]; if (href && safeMailLink(href)) links.push({ url: href, label: stripHtml(label).slice(0, 240) }); return href && safeMailLink(href) ? `<a${attrs}>${label}</a>` : label; });
  return { html: html.slice(0, options.maxChars ?? MAIL_MAX_BODY_BYTES), externalImageUrls: [...new Set(externalImageUrls)].slice(0, 64), links: links.slice(0, 256) };
}
function safeMailLink(value: string): boolean { if (value.startsWith('keystone://')) return true; if (/^mailto:/i.test(value)) return /^[a-z][a-z0-9+.-]*:[^\s<>]{1,2048}$/i.test(value); try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !/[\u0000-\u001f\u007f]/.test(value); } catch { return false; } }
function escapeHtml(value: string): string { return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function stripHtml(value: string): string { return value.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim(); }
function plainPreview(value: string): string { return stripHtml(value).replace(/\s+/g, ' ').slice(0, 280); }

export interface MailSyncResult {
  readonly account: MailAccount;
  readonly folders: readonly MailFolder[];
  readonly addedMessageIds: readonly string[];
  readonly updatedMessageIds: readonly string[];
  readonly removedMessageIds: readonly string[];
  readonly baseline: boolean;
}

export interface MailListOptions {
  readonly accountId?: string;
  readonly folderId?: string;
  readonly unreadOnly?: boolean;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface MailDraftInput {
  readonly accountId: string;
  readonly to?: readonly MailAddress[];
  readonly cc?: readonly MailAddress[];
  readonly bcc?: readonly MailAddress[];
  readonly subject?: string;
  readonly bodyText?: string;
  readonly bodyHtml?: string;
  readonly attachmentIds?: readonly string[];
  readonly inReplyToMessageId?: string;
  readonly signature?: string;
}

export interface MailMutationResult {
  readonly message: MailMessage;
  readonly queued: boolean;
  readonly providerApplied: boolean;
}

export interface MailRemoveAccountResult {
  readonly accountId: string;
  readonly mode: 'DISCONNECT' | 'DELETE_LOCAL_CACHE';
  readonly cachedMessagesRetained: boolean;
  readonly providerChanged: false;
}

export class MailService {
  private readonly store: MailStateStore;
  private readonly adapters = new Map<string, MailProviderAdapter>();
  private readonly credentials?: MailCredentialBoundary;
  private readonly notifications?: MailNotificationSink;
  private readonly contacts?: MailContactsAdapter;
  private readonly files?: MailFilesAdapter;
  private readonly daily?: MailDailyAdapter;
  private readonly now: () => number;
  private readonly maxMessages: number;
  private readonly maxCacheBytes: number;
  private state: MailState = defaultState();
  private writes: Promise<void> = Promise.resolve();
  private readonly readyPromise: Promise<void>;
  private closed = false;

  constructor(options: MailServiceOptions = {}) {
    this.store = options.store ?? new InMemoryMailStateStore(); this.credentials = options.credentials; this.notifications = options.notifications; this.contacts = options.contacts; this.files = options.files; this.daily = options.daily; this.now = options.now ?? Date.now;
    this.maxMessages = Math.max(1_000, Math.min(MAIL_MAX_MESSAGES, Math.floor(options.maxMessages ?? MAIL_MAX_MESSAGES))); this.maxCacheBytes = Math.max(1_024 * 1_024, Math.min(2 * 1024 * 1024 * 1024, Math.floor(options.maxCacheBytes ?? 512 * 1024 * 1024)));
    for (const adapter of options.adapters ?? []) this.adapters.set(adapter.id, adapter);
    this.readyPromise = this.hydrate();
  }

  async ready(): Promise<void> { await this.readyPromise; }
  async close(): Promise<void> { this.closed = true; await Promise.all([...this.adapters.values()].map(adapter => Promise.resolve(adapter.close?.()).catch(() => undefined))); await this.writes; }
  settings(): { readonly externalImagePolicy: MailState['externalImagePolicy']; readonly accountCount: number; readonly cachedMessageCount: number; readonly outboxCount: number } { return { externalImagePolicy: this.state.externalImagePolicy, accountCount: Object.keys(this.state.accounts).length, cachedMessageCount: Object.keys(this.state.messages).length, outboxCount: Object.values(this.state.outbox).filter(value => value.state !== 'SENT').length }; }
  accounts(): readonly MailAccount[] { return Object.values(this.state.accounts).map(clone).sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id)); }
  account(accountId: string): MailAccount | undefined { const value = this.state.accounts[accountId]; return value ? clone(value) : undefined; }
  folders(accountId?: string): readonly MailFolder[] { return Object.values(this.state.folders).filter(value => !accountId || value.accountId === accountId).map(clone).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)); }
  outbox(accountId?: string): readonly MailOutboxEntry[] { return Object.values(this.state.outbox).filter(value => !accountId || value.accountId === accountId).map(clone).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  mutations(accountId?: string): readonly MailPendingMutation[] { return Object.values(this.state.mutations).filter(value => !accountId || value.accountId === accountId).map(clone).sort((a, b) => a.createdAt.localeCompare(b.createdAt)); }

  async addAccount(input: MailAccountInput): Promise<MailAccount> {
    await this.ready(); if (Object.keys(this.state.accounts).length >= MAIL_MAX_ACCOUNTS) throw new MailError('BOUNDS_EXCEEDED', 'Mail account limit reached'); const id = safeId(input.id ?? randomId('mail-account'), 'account id'); if (this.state.accounts[id]) throw new MailError('CONFLICT', 'Mail account already exists'); const account = this.normalizeAccount(input, id); this.adapterFor(account);
    this.state = { ...this.state, accounts: { ...this.state.accounts, [id]: account } }; await this.persist(); return clone(account);
  }

  async updateAccount(accountId: string, patch: { readonly label?: string; readonly enabled?: boolean; readonly externalImagePolicy?: MailState['externalImagePolicy'] }): Promise<MailAccount> {
    await this.ready(); const current = this.requireAccount(accountId); const next: MailAccount = { ...current, ...(patch.label !== undefined ? { label: bounded(patch.label, 160, true) } : {}), ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}), updatedAt: nowIso(this.now()) }; if (patch.externalImagePolicy) this.state = { ...this.state, externalImagePolicy: patch.externalImagePolicy }; this.state = { ...this.state, accounts: { ...this.state.accounts, [accountId]: next } }; await this.persist(); return clone(next);
  }

  async removeAccount(accountId: string, mode: 'DISCONNECT' | 'DELETE_LOCAL_CACHE' = 'DISCONNECT'): Promise<MailRemoveAccountResult> {
    await this.ready(); const account = this.requireAccount(accountId); if (this.credentials?.revoke && account.credential) await Promise.resolve(this.credentials.revoke(account.credential)).catch(() => undefined);
    if (mode === 'DISCONNECT') { const next = { ...account, enabled: false, credential: undefined, attention: 'NONE' as const, updatedAt: nowIso(this.now()) }; this.state = { ...this.state, accounts: { ...this.state.accounts, [accountId]: next } }; await this.persist(); return { accountId, mode, cachedMessagesRetained: true, providerChanged: false }; }
    const accounts = { ...this.state.accounts }; delete accounts[accountId]; const folders = Object.fromEntries(Object.entries(this.state.folders).filter(([, value]) => value.accountId !== accountId)); const messages = Object.fromEntries(Object.entries(this.state.messages).filter(([, value]) => value.accountId !== accountId)); const drafts = Object.fromEntries(Object.entries(this.state.drafts).filter(([, value]) => value.accountId !== accountId)); const outbox = Object.fromEntries(Object.entries(this.state.outbox).filter(([, value]) => value.accountId !== accountId)); const mutations = Object.fromEntries(Object.entries(this.state.mutations).filter(([, value]) => value.accountId !== accountId)); this.state = { ...this.state, accounts, folders, messages, drafts, outbox, mutations }; await this.persist(); return { accountId, mode, cachedMessagesRetained: false, providerChanged: false };
  }

  async testAccount(accountId: string): Promise<{ readonly ok: true; readonly capabilities: MailProviderCapabilities; readonly folders: readonly MailFolder[] }> {
    await this.ready(); const account = this.requireEnabledAccount(accountId); const adapter = this.adapterFor(account); try { const folders = await adapter.listFolders(this.context(account)); return { ok: true, capabilities: adapter.capabilities(account), folders: folders.map(clone) }; } catch (error) { throw this.accountError(accountId, error); }
  }

  async sync(accountId: string, options: MailSyncOptions = {}): Promise<MailSyncResult> {
    await this.ready(); const account = this.requireEnabledAccount(accountId); const adapter = this.adapterFor(account); const before = new Set(Object.values(this.state.messages).filter(value => value.accountId === accountId).map(value => value.id));
    try {
      const delta = await adapter.sync(this.context(account, options.signal), account.syncState, { ...options, limit: boundedInt(options.limit, 1, MAIL_MAX_SYNC_MESSAGES, MAIL_MAX_SYNC_MESSAGES) }); this.validateDelta(delta, accountId); const added: string[] = []; const updated: string[] = []; const folderMap = { ...this.state.folders };
      for (const folder of delta.folders) { const normalized = this.normalizeFolder(folder, accountId); folderMap[normalized.id] = normalized; }
      const messages = { ...this.state.messages };
      for (const candidate of delta.messages) { const normalized = this.normalizeProviderMessage(candidate, accountId, folderMap); const previous = messages[normalized.id]; messages[normalized.id] = normalized; if (previous) updated.push(normalized.id); else added.push(normalized.id); }
      const removed: string[] = []; for (const providerId of delta.removedProviderMessageIds ?? []) for (const [id, value] of Object.entries(messages)) if (value.accountId === accountId && value.providerMessageId === providerId) { delete messages[id]; removed.push(id); }
      const nextAccount: MailAccount = { ...account, syncState: delta.nextState, lastSuccessfulSync: nowIso(this.now()), attention: 'NONE', updatedAt: nowIso(this.now()) }; this.state = { ...this.state, accounts: { ...this.state.accounts, [accountId]: nextAccount }, folders: folderMap, messages: this.trimMessages(messages) }; await this.persist();
      if (account.syncState.baselineEstablished && !delta.baseline && this.notifications) for (const id of added) { const message = this.state.messages[id]; const inbox = message && this.state.folders[message.folderId]?.role === 'INBOX'; if (message && inbox) await this.notifications.notify({ id: `mail:${id}`, accountId, messageId: id, title: message.subject || message.from.address, ...(message.snippet ? { preview: message.snippet } : {}), sensitive: true }); }
      await this.updateDaily(); return { account: clone(nextAccount), folders: delta.folders.map(clone), addedMessageIds: added, updatedMessageIds: updated, removedMessageIds: removed, baseline: delta.baseline || !account.syncState.baselineEstablished };
    } catch (error) { const safe = this.accountError(accountId, error); const failed = { ...account, attention: safe.code === 'AUTHENTICATION_FAILED' ? 'REAUTH_REQUIRED' as const : safe.transient ? 'PROVIDER_UNAVAILABLE' as const : 'CONFIGURATION' as const, updatedAt: nowIso(this.now()) }; this.state = { ...this.state, accounts: { ...this.state.accounts, [accountId]: failed } }; await this.persist(); throw safe; }
  }

  private normalizeAccount(input: MailAccountInput, id: string): MailAccount {
    const label = bounded(input.label, 160, true); const address = normalizeAddress(input.address); const provider = normalizeProviderConfig(clone(input.provider)); if (provider.kind === 'IMAP_SMTP') { if ((isPrivateHost(provider.imap.endpoint.hostname) || isPrivateHost(provider.smtp.endpoint.hostname)) && input.ownerConfirmed !== true) throw new MailError('POLICY_DENIED', 'Private mail endpoint requires explicit owner confirmation'); } if (input.credential && input.credential.accountId !== id) throw new MailError('INVALID_ARGUMENT', 'Mail credential is bound to another account'); if (provider.kind !== 'CONTROLLED' && !input.credential) throw new MailError('CREDENTIALS_REQUIRED', 'External mail account requires a secret reference'); const now = nowIso(this.now()); return { version: 1, id, label, address, provider, ...(input.credential ? { credential: clone(input.credential) } : {}), enabled: true, syncState: { version: 1, folders: {}, baselineEstablished: false }, attention: 'NONE', createdAt: now, updatedAt: now };
  }

  private validateDelta(delta: MailSyncDelta, accountId: string): void { if (!delta || typeof delta !== 'object' || !Array.isArray(delta.folders) || !Array.isArray(delta.messages) || !delta.nextState || typeof delta.nextState !== 'object' || delta.nextState.version !== 1) throw new MailError('PROTOCOL_ERROR', 'Mail provider returned an invalid sync delta'); if (delta.folders.length > MAIL_MAX_FOLDERS || delta.messages.length > MAIL_MAX_SYNC_MESSAGES) throw new MailError('BOUNDS_EXCEEDED', 'Mail provider sync delta exceeds bounds'); for (const folder of delta.folders) if (!folder || typeof folder !== 'object' || folder.accountId !== accountId) throw new MailError('PROTOCOL_ERROR', 'Mail provider returned a cross-account folder'); const nextFolders = delta.nextState.folders; if (!nextFolders || typeof nextFolders !== 'object' || Object.keys(nextFolders).length > MAIL_MAX_FOLDERS) throw new MailError('PROTOCOL_ERROR', 'Mail provider returned invalid sync cursor state'); for (const [folderId, state] of Object.entries(nextFolders)) if (!state || state.folderId !== folderId || folderId.length > 256 || (state.highestUid !== undefined && (!Number.isSafeInteger(state.highestUid) || state.highestUid < 0))) throw new MailError('PROTOCOL_ERROR', 'Mail provider returned invalid folder sync state'); if (delta.removedProviderMessageIds && (!Array.isArray(delta.removedProviderMessageIds) || delta.removedProviderMessageIds.length > MAIL_MAX_SYNC_MESSAGES || delta.removedProviderMessageIds.some(value => typeof value !== 'string' || value.length > 256))) throw new MailError('PROTOCOL_ERROR', 'Mail provider returned invalid removed message ids'); }
  private normalizeFolder(value: MailFolder, accountId: string): MailFolder { const id = safeId(value.id, 'folder id'); if (value.accountId !== accountId || value.id.length > 256) throw new MailError('PROTOCOL_ERROR', 'Mail folder account binding is invalid'); return { id, accountId, name: bounded(value.name, 200, true), path: bounded(value.path, 512, true), role: ['INBOX', 'SENT', 'DRAFTS', 'ARCHIVE', 'SPAM', 'TRASH', 'CUSTOM'].includes(value.role) ? value.role : 'CUSTOM', selectable: value.selectable !== false, ...(value.providerUidValidity ? { providerUidValidity: bounded(value.providerUidValidity, 256) } : {}), ...(Number.isSafeInteger(value.unreadCount) ? { unreadCount: Math.max(0, Math.min(MAIL_MAX_MESSAGES, value.unreadCount!)) } : {}), ...(Number.isSafeInteger(value.totalCount) ? { totalCount: Math.max(0, Math.min(MAIL_MAX_MESSAGES, value.totalCount!)) } : {}) }; }
  private normalizeProviderMessage(value: MailProviderMessage, accountId: string, folderMap: Readonly<Record<string, MailFolder>>): MailMessage {
    const providerMessageId = safeId(value.providerMessageId, 'provider message id'); const folder = folderMap[value.folderId]; if (!folder || folder.accountId !== accountId) throw new MailError('PROTOCOL_ERROR', 'Mail provider message folder is invalid'); const uidValidity = value.providerUidValidity ? bounded(value.providerUidValidity, 256) : folder.providerUidValidity; const existing = Object.values(this.state.messages).find(candidate => candidate.accountId === accountId && candidate.providerMessageId === providerMessageId && candidate.providerUidValidity !== uidValidity); if (existing) { const messages = { ...this.state.messages }; delete messages[existing.id]; this.state = { ...this.state, messages }; }
    const id = `${accountId}:message:${providerMessageId}:${uidValidity ?? 'no-uidvalidity'}`; const messageId = normalizeMessageId(value.messageId); const references = [...new Set((value.references ?? []).flatMap(reference => normalizeMessageId(reference) ? [normalizeMessageId(reference)!] : []))].slice(0, 128); const bodyText = value.bodyText === undefined ? undefined : bounded(value.bodyText, MAIL_MAX_BODY_BYTES); const bodyHtml = value.bodyHtml === undefined ? undefined : bounded(value.bodyHtml, MAIL_MAX_BODY_BYTES); const sanitized = bodyHtml ? sanitizeMailHtml(bodyHtml, { allowExternalImages: this.state.externalImagePolicy === 'ALLOW_EXPLICIT' }) : undefined; const attachments = (value.attachments ?? []).slice(0, MAIL_MAX_ATTACHMENTS).map(item => ({ ...item, id: safeId(item.id, 'attachment id'), filename: safeFilename(item.filename), mimeType: bounded(item.mimeType, 255, true), sizeBytes: Math.max(0, Math.min(MAIL_MAX_ATTACHMENT_BYTES, Number.isSafeInteger(item.sizeBytes) ? item.sizeBytes : 0)), contentAvailable: item.contentAvailable === true, privateByDefault: true as const })); const receivedAt = validIso(value.receivedAt) ? value.receivedAt : nowIso(this.now()); const subject = bounded(value.subject ?? '', 998); const snippet = bounded(value.snippet ?? plainPreview(bodyText ?? bodyHtml ?? subject), 280); const contentState = bodyText !== undefined || bodyHtml !== undefined ? (value.rawSource ? 'CACHED' : 'PARTIAL') : 'METADATA'; return { id, accountId, folderId: folder.id, providerMessageId, ...(Number.isSafeInteger(value.providerUid) ? { providerUid: value.providerUid } : {}), ...(uidValidity ? { providerUidValidity: uidValidity } : {}), ...(messageId ? { messageId } : {}), ...(value.inReplyTo && normalizeMessageId(value.inReplyTo) ? { inReplyTo: normalizeMessageId(value.inReplyTo) } : {}), references, threadId: threadIdFor(accountId, subject, messageId, value.inReplyTo, references), from: normalizeAddress(value.from), to: normalizeAddresses(value.to), cc: normalizeAddresses(value.cc), ...(value.bcc ? { bcc: normalizeAddresses(value.bcc) } : {}), ...(value.replyTo ? { replyTo: normalizeAddresses(value.replyTo) } : {}), subject, ...(validIso(value.date) ? { date: value.date } : {}), receivedAt, snippet, ...(bodyText !== undefined ? { bodyText } : {}), ...(bodyHtml !== undefined ? { bodyHtml } : {}), ...(value.rawSource !== undefined ? { rawSource: bounded(value.rawSource, MAIL_MAX_RAW_BYTES) } : {}), attachments, flags: normalizeFlags(value.flags), readReceiptRequested: value.readReceiptRequested === true, contentState, externalImageUrls: sanitized?.externalImageUrls ?? [], ...(value.providerAuth ? { providerAuth: clone(value.providerAuth) } : {}), createdAt: receivedAt, updatedAt: nowIso(this.now()) };
  }

  private trimMessages(messages: Readonly<Record<string, MailMessage>>): Readonly<Record<string, MailMessage>> {
    const values = Object.values(messages).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); const kept = values.slice(0, this.maxMessages); let bytes = 0; const result: Record<string, MailMessage> = {};
    for (const value of kept) { const size = new TextEncoder().encode(JSON.stringify(value)).byteLength; if (bytes + size > this.maxCacheBytes && Object.keys(result).length > 0) continue; result[value.id] = value; bytes += size; }
    return result;
  }

  getMessage(messageId: string): MailMessage | undefined { const value = this.state.messages[messageId]; return value ? clone(value) : undefined; }
  requireMessage(messageId: string): MailMessage { const value = this.getMessage(messageId); if (!value) throw new MailError('MESSAGE_NOT_FOUND', 'Mail message was not found'); return value; }
  listMessages(options: MailListOptions = {}): { readonly items: readonly MailMessage[]; readonly nextCursor?: string } {
    const limit = boundedInt(options.limit, 1, MAIL_MAX_SEARCH_RESULTS, 50); let values = Object.values(this.state.messages).filter(value => (!options.accountId || value.accountId === options.accountId) && (!options.folderId || value.folderId === options.folderId) && (!options.unreadOnly || !value.flags.includes('SEEN'))).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt) || b.id.localeCompare(a.id)); const start = options.cursor ? Math.max(0, values.findIndex(value => value.id === options.cursor) + 1) : 0; values = values.slice(start, start + limit); return { items: values.map(clone), ...(start + limit < Object.values(this.state.messages).length ? { nextCursor: values.at(-1)?.id } : {}) };
  }

  listThreads(accountId?: string): readonly MailThread[] {
    const groups = new Map<string, MailMessage[]>(); for (const message of Object.values(this.state.messages)) if (!accountId || message.accountId === accountId) { const group = groups.get(message.threadId) ?? []; group.push(message); groups.set(message.threadId, group); }
    return [...groups.entries()].map(([id, values]) => { const sorted = values.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)); const participants = uniqueAddresses(values.flatMap(value => [value.from, ...value.to, ...value.cc])); return { id, accountId: sorted[0]!.accountId, subject: sorted[0]!.subject, messageIds: sorted.map(value => value.id), latestMessageId: sorted[0]?.id, unreadCount: values.filter(value => !value.flags.includes('SEEN')).length, participants: participants.slice(0, 64), updatedAt: sorted[0]?.updatedAt ?? nowIso(this.now()) }; }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, MAIL_MAX_THREADS).map(clone);
  }

  thread(threadId: string): MailThread | undefined { return this.listThreads().find(value => value.id === threadId); }

  async fetchMessageBody(messageId: string): Promise<MailMessage> {
    await this.ready(); const message = this.requireMessage(messageId); if (message.contentState === 'CACHED') return message; const account = this.requireEnabledAccount(message.accountId); const adapter = this.adapterFor(account); if (!adapter.fetchMessage) throw new MailError('UNSUPPORTED', 'Provider does not support on-demand message bodies'); try { const provider = await adapter.fetchMessage(this.context(account), message); const normalized = this.normalizeProviderMessage(provider, account.id, this.state.folders); this.state = { ...this.state, messages: { ...this.state.messages, [message.id]: { ...normalized, id: message.id, threadId: message.threadId } } }; await this.persist(); return clone(this.state.messages[message.id]!); } catch (error) { throw this.accountError(account.id, error); }
  }

  renderMessage(messageId: string, options: { readonly allowExternalImages?: boolean } = {}): MailRenderedBody {
    const message = this.requireMessage(messageId); if (message.bodyHtml) { const allowExternalImages = options.allowExternalImages === true && this.state.externalImagePolicy === 'ALLOW_EXPLICIT'; const safe = sanitizeMailHtml(message.bodyHtml, { allowExternalImages }); return { mode: 'SANITIZED_HTML', value: safe.html, blockedExternalImages: allowExternalImages ? [] : safe.externalImageUrls, safeLinks: safe.links }; } return { mode: 'TEXT', value: bounded(message.bodyText ?? message.snippet, MAIL_MAX_BODY_BYTES), blockedExternalImages: [], safeLinks: [] };
  }

  async setExternalImagePolicy(policy: MailState['externalImagePolicy']): Promise<void> { await this.ready(); if (policy !== 'BLOCK_BY_DEFAULT' && policy !== 'ALLOW_EXPLICIT') throw new MailError('INVALID_ARGUMENT', 'Unknown external image policy'); this.state = { ...this.state, externalImagePolicy: policy }; await this.persist(); }
  externalImagePolicy(): MailState['externalImagePolicy'] { return this.state.externalImagePolicy; }

  search(query: string, options: { readonly accountId?: string; readonly limit?: number } = {}): readonly MailSearchResult[] {
    const terms = bounded(query, 256, true).toLocaleLowerCase().split(/\s+/).filter(Boolean); const limit = boundedInt(options.limit, 1, MAIL_MAX_SEARCH_RESULTS, 50); if (!terms.length) return []; const messages = Object.values(this.state.messages).filter(value => !options.accountId || value.accountId === options.accountId); const results: MailSearchResult[] = [];
    for (const message of messages) { const text = [message.subject, message.from.name, message.from.address, ...message.to.map(value => `${value.name ?? ''} ${value.address}`), message.snippet, message.bodyText ?? ''].join(' ').toLocaleLowerCase(); if (!terms.every(term => text.includes(term))) continue; const score = terms.reduce((sum, term) => sum + (message.subject.toLocaleLowerCase().includes(term) ? 5 : 1) + (message.from.address.includes(term) ? 3 : 0), 0); results.push({ id: message.id, kind: 'mail', accountId: message.accountId, title: message.subject || message.from.address, snippet: message.snippet, score, updatedAt: message.updatedAt }); }
    for (const thread of this.listThreads(options.accountId)) { const text = [thread.subject, ...thread.participants.flatMap(value => [value.name ?? '', value.address])].join(' ').toLocaleLowerCase(); if (terms.every(term => text.includes(term))) results.push({ id: thread.id, kind: 'mail-thread', accountId: thread.accountId, title: thread.subject || 'Mail thread', snippet: `${thread.messageIds.length} messages · ${thread.participants.slice(0, 3).map(value => value.address).join(', ')}`, score: terms.reduce((sum, term) => sum + (thread.subject.toLocaleLowerCase().includes(term) ? 4 : 1), 0), updatedAt: thread.updatedAt }); }
    return results.sort((a, b) => b.score - a.score || b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id)).slice(0, limit).map(clone);
  }

  async createDraft(input: MailDraftInput): Promise<MailDraft> {
    await this.ready(); const account = this.requireAccount(input.accountId); const id = randomId('mail-draft'); const now = nowIso(this.now()); const draft: MailDraft = { id, accountId: account.id, ...(input.inReplyToMessageId ? { inReplyToMessageId: safeId(input.inReplyToMessageId, 'reply message id') } : {}), to: normalizeAddresses(input.to), cc: normalizeAddresses(input.cc), bcc: normalizeAddresses(input.bcc), subject: bounded(input.subject ?? '', 998), bodyText: bounded(input.bodyText ?? '', MAIL_MAX_BODY_BYTES), ...(input.bodyHtml !== undefined ? { bodyHtml: bounded(input.bodyHtml, MAIL_MAX_BODY_BYTES) } : {}), attachmentIds: [...new Set((input.attachmentIds ?? []).slice(0, MAIL_MAX_ATTACHMENTS).map(value => safeId(value, 'attachment id')))], ...(input.signature ? { signature: bounded(input.signature, 16_384) } : {}), status: 'DRAFT', stableMessageId: await stableDraftMessageId(id), createdAt: now, updatedAt: now }; this.state = { ...this.state, drafts: { ...this.state.drafts, [id]: draft } }; await this.persist(); return clone(draft);
  }

  async updateDraft(draftId: string, patch: Omit<Partial<MailDraftInput>, 'accountId'>): Promise<MailDraft> {
    await this.ready(); const current = this.requireDraft(draftId); if (current.status === 'SENDING' || current.status === 'SENT') throw new MailError('CONFLICT', 'Sent drafts cannot be edited'); const next: MailDraft = { ...current, ...(patch.to ? { to: normalizeAddresses(patch.to) } : {}), ...(patch.cc ? { cc: normalizeAddresses(patch.cc) } : {}), ...(patch.bcc ? { bcc: normalizeAddresses(patch.bcc) } : {}), ...(patch.subject !== undefined ? { subject: bounded(patch.subject, 998) } : {}), ...(patch.bodyText !== undefined ? { bodyText: bounded(patch.bodyText, MAIL_MAX_BODY_BYTES) } : {}), ...(patch.bodyHtml !== undefined ? { bodyHtml: bounded(patch.bodyHtml, MAIL_MAX_BODY_BYTES) } : {}), ...(patch.attachmentIds ? { attachmentIds: [...new Set(patch.attachmentIds.slice(0, MAIL_MAX_ATTACHMENTS).map(value => safeId(value, 'attachment id')))] } : {}), ...(patch.signature !== undefined ? { signature: bounded(patch.signature, 16_384) } : {}), status: 'DRAFT', updatedAt: nowIso(this.now()), lastError: undefined }; this.state = { ...this.state, drafts: { ...this.state.drafts, [draftId]: next } }; await this.persist(); return clone(next);
  }

  drafts(accountId?: string): readonly MailDraft[] { return Object.values(this.state.drafts).filter(value => !accountId || value.accountId === accountId).map(clone).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
  requireDraft(draftId: string): MailDraft { const value = this.state.drafts[draftId]; if (!value) throw new MailError('DRAFT_NOT_FOUND', 'Mail draft was not found'); return clone(value); }

  async createReplyDraft(messageId: string, replyAll = false): Promise<MailDraft> {
    await this.ready(); const message = this.requireMessage(messageId); const account = this.requireAccount(message.accountId); const recipients = message.replyTo?.length ? message.replyTo : [message.from]; const own = new Set([account.address.address, ...(account.provider.kind === 'IMAP_SMTP' ? (account.provider.smtp.fromAliases ?? []).map(value => value.address) : [])].map(value => value.toLowerCase())); const to = uniqueAddresses([...recipients, ...(replyAll ? message.to : [])].filter(value => !own.has(value.address.toLowerCase()))); const cc = replyAll ? uniqueAddresses(message.cc.filter(value => !own.has(value.address.toLowerCase()) && !to.some(item => item.address === value.address))) : []; const subject = /^re:/i.test(message.subject) ? message.subject : `Re: ${message.subject}`; const quote = message.bodyText ? `\n\nOn ${message.date ?? message.receivedAt}, ${message.from.address} wrote:\n> ${message.bodyText.slice(0, 32_000).replace(/\n/g, '\n> ')}` : ''; return this.createDraft({ accountId: account.id, to, cc, subject, bodyText: quote, inReplyToMessageId: message.id });
  }

  async createForwardDraft(messageId: string, to: readonly MailAddress[] = []): Promise<MailDraft> { await this.ready(); const message = this.requireMessage(messageId); const subject = /^fwd:/i.test(message.subject) ? message.subject : `Fwd: ${message.subject}`; const body = `\n\n---------- Forwarded message ----------\nFrom: ${formatAddress(message.from)}\nSubject: ${message.subject}\n\n${message.bodyText ?? message.snippet}`; return this.createDraft({ accountId: message.accountId, to, subject, bodyText: body, attachmentIds: message.attachments.map(value => value.id) }); }

  private requireAccount(accountId: string): MailAccount { const value = this.state.accounts[accountId]; if (!value) throw new MailError('ACCOUNT_NOT_FOUND', 'Mail account was not found'); return clone(value); }
  private requireEnabledAccount(accountId: string): MailAccount { const value = this.requireAccount(accountId); if (!value.enabled) throw new MailError('POLICY_DENIED', 'Mail account is disabled'); return value; }
  private requireFolder(folderId: string): MailFolder { const value = this.state.folders[folderId]; if (!value) throw new MailError('FOLDER_NOT_FOUND', 'Mail folder was not found'); return clone(value); }
  private adapterFor(account: MailAccount): MailProviderAdapter { const providerId = account.provider.adapterId ?? (account.provider.kind === 'IMAP_SMTP' ? 'imap-smtp' : account.provider.kind === 'JMAP' ? 'jmap' : account.provider.controlled.adapterId); const adapter = this.adapters.get(providerId); if (!adapter || adapter.kind !== account.provider.kind) throw new MailError('UNSUPPORTED', `No ${account.provider.kind} mail adapter is installed`); return adapter; }
  private context(account: MailAccount, signal?: AbortSignal): MailProviderContext { const credentials = account.credential && this.credentials ? { withSecret: <T>(operation: MailTransportName | 'ACCOUNT_TEST', callback: (secret: string) => Promise<T> | T): Promise<T> => this.credentials!.access(account.credential!, operation, callback) as Promise<T> } : undefined; return { account: clone(account), ...(credentials ? { credentials } : {}), ...(signal ? { signal } : {}) }; }
  private accountError(accountId: string, error: unknown): MailError { const safe = transientError(error); if (safe.code === 'AUTHENTICATION_FAILED') return safe; return new MailError(safe.code, `Mail account ${accountId}: ${safe.message}`.slice(0, 512), safe.transient, safe.ambiguous); }
  private async hydrate(): Promise<void> { const raw = await this.store.read(); if (!raw) return; this.state = normalizeMailState(raw); }
  private async persist(): Promise<void> { const snapshot = clone(this.state); const operation = this.writes.then(() => this.store.write(snapshot)); this.writes = operation.catch(() => undefined); await operation; }

  async sendDraft(draftId: string, ownerConfirmed = false): Promise<MailOutboxEntry> {
    await this.ready(); if (!ownerConfirmed) throw new MailError('POLICY_DENIED', 'Sending mail requires an explicit owner action'); const draft = this.requireDraft(draftId); const account = this.requireEnabledAccount(draft.accountId); if (!draft.to.length && !draft.cc.length && !draft.bcc.length) throw new MailError('INVALID_ARGUMENT', 'Mail draft has no recipients'); const existing = Object.values(this.state.outbox).find(value => value.draftId === draft.id && value.state !== 'FAILED' && value.state !== 'UNKNOWN'); if (existing) return clone(existing); const now = nowIso(this.now()); const entry: MailOutboxEntry = { id: randomId('mail-outbox'), accountId: account.id, draftId: draft.id, stableMessageId: safeMessageId(draft.stableMessageId), state: 'QUEUED', attempts: 0, nextAttemptAt: now, createdAt: now, updatedAt: now }; this.state = { ...this.state, drafts: { ...this.state.drafts, [draft.id]: { ...draft, status: 'QUEUED', updatedAt: now } }, outbox: { ...this.state.outbox, [entry.id]: entry } }; await this.persist(); await this.processOutbox(account.id); return clone(this.state.outbox[entry.id] ?? entry);
  }

  async processOutbox(accountId?: string): Promise<readonly MailOutboxEntry[]> {
    await this.ready(); if (this.closed) return this.outbox(accountId); const due = Object.values(this.state.outbox).filter(value => (!accountId || value.accountId === accountId) && value.state === 'QUEUED' && Date.parse(value.nextAttemptAt) <= this.now()).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(0, 8);
    for (const entry of due) await this.processOutboxEntry(entry.id); await this.updateDaily(); return this.outbox(accountId);
  }

  async retryOutbox(outboxId: string, ownerConfirmed = false): Promise<MailOutboxEntry> { await this.ready(); if (!ownerConfirmed) throw new MailError('POLICY_DENIED', 'Retrying external mail requires an explicit owner action'); const entry = this.state.outbox[outboxId]; if (!entry) throw new MailError('OUTBOX_NOT_FOUND', 'Mail outbox entry was not found'); const next: MailOutboxEntry = { ...entry, state: 'QUEUED', nextAttemptAt: nowIso(this.now()), updatedAt: nowIso(this.now()), lastError: undefined }; this.state = { ...this.state, outbox: { ...this.state.outbox, [outboxId]: next } }; await this.persist(); await this.processOutboxEntry(outboxId); return clone(this.state.outbox[outboxId]!); }

  async resolveUnknownSend(outboxId: string, decision: 'MARK_SENT' | 'REQUEUE' | 'MARK_FAILED', ownerConfirmed = false): Promise<MailOutboxEntry> { await this.ready(); if (!ownerConfirmed) throw new MailError('POLICY_DENIED', 'Resolving ambiguous mail requires explicit owner confirmation'); const entry = this.state.outbox[outboxId]; if (!entry || entry.state !== 'UNKNOWN') throw new MailError('OUTBOX_NOT_FOUND', 'Unknown send state was not found'); const state: MailOutboxState = decision === 'MARK_SENT' ? 'SENT' : decision === 'REQUEUE' ? 'QUEUED' : 'FAILED'; const next = { ...entry, state, ...(decision === 'REQUEUE' ? { nextAttemptAt: nowIso(this.now()) } : {}), updatedAt: nowIso(this.now()) }; this.state = { ...this.state, outbox: { ...this.state.outbox, [outboxId]: next } }; await this.persist(); if (state === 'QUEUED') await this.processOutboxEntry(outboxId); return clone(this.state.outbox[outboxId]!); }

  private async processOutboxEntry(outboxId: string): Promise<void> {
    const current = this.state.outbox[outboxId]; if (!current || current.state !== 'QUEUED' || Date.parse(current.nextAttemptAt) > this.now()) return; const draft = this.state.drafts[current.draftId]; const account = this.state.accounts[current.accountId]; if (!draft || !account || !account.enabled) { this.markOutbox(outboxId, { state: 'FAILED', lastError: 'Draft or account is unavailable' }); return; }
    const adapter = this.adapterFor(account); const sending: MailOutboxEntry = { ...current, state: 'SENDING', attempts: current.attempts + 1, updatedAt: nowIso(this.now()) }; this.state = { ...this.state, outbox: { ...this.state.outbox, [outboxId]: sending }, drafts: { ...this.state.drafts, [draft.id]: { ...draft, status: 'SENDING', updatedAt: sending.updatedAt } } }; await this.persist();
    try {
      const receipt = await adapter.send(this.context(account), await this.buildSendInput(account, draft)); if (!receipt.accepted) throw new MailError('PROVIDER_UNAVAILABLE', 'Outgoing mail was not accepted', true, receipt.ambiguous === true); const sent = { ...sending, state: 'SENT' as const, updatedAt: receipt.acceptedAt }; this.state = { ...this.state, outbox: { ...this.state.outbox, [outboxId]: sent }, drafts: { ...this.state.drafts, [draft.id]: { ...draft, status: 'SENT', updatedAt: receipt.acceptedAt } } }; await this.persist(); await this.buildLocalSentMessage(account, draft);
    } catch (error) {
      const safe = transientError(error); const ambiguous = safe.ambiguous || (safe.code === 'TIMEOUT' && sending.attempts > 0); if (ambiguous) { this.markOutbox(outboxId, { state: 'UNKNOWN', ambiguousAt: nowIso(this.now()), lastError: 'Provider acceptance is ambiguous; review before retrying' }); this.state = { ...this.state, drafts: { ...this.state.drafts, [draft.id]: { ...draft, status: 'UNKNOWN', lastError: 'Provider acceptance is ambiguous; review before retrying', updatedAt: nowIso(this.now()) } } }; await this.persist(); return; }
      if (safe.transient && sending.attempts < MAIL_MAX_RETRIES) { const nextAttemptAt = nowIso(this.now() + retryDelay(sending.attempts)); this.markOutbox(outboxId, { state: 'QUEUED', nextAttemptAt, lastError: safe.message }); this.state = { ...this.state, drafts: { ...this.state.drafts, [draft.id]: { ...draft, status: 'QUEUED', lastError: safe.message, updatedAt: nowIso(this.now()) } } }; await this.persist(); return; }
      this.markOutbox(outboxId, { state: 'FAILED', lastError: safe.message }); this.state = { ...this.state, drafts: { ...this.state.drafts, [draft.id]: { ...draft, status: 'FAILED', lastError: safe.message, updatedAt: nowIso(this.now()) } } }; await this.persist();
    }
  }

  private markOutbox(outboxId: string, patch: Partial<MailOutboxEntry>): void { const current = this.state.outbox[outboxId]; if (!current) return; this.state = { ...this.state, outbox: { ...this.state.outbox, [outboxId]: { ...current, ...patch, updatedAt: nowIso(this.now()) } } }; }

  private async buildSendInput(account: MailAccount, draft: MailDraft): Promise<MailSendInput> {
    const from = account.address; const attachments = draft.attachmentIds.map(id => { const source = this.findAttachmentSource(account.id, id); if (!source) throw new MailError('INVALID_ARGUMENT', 'Mail draft attachment is unavailable'); return source.attachment; }); const attachmentPayloads = await this.resolveAttachmentPayloads(account, attachments); const serialized = serializeMailMessage({ messageId: draft.stableMessageId, from, to: draft.to, cc: draft.cc, bcc: draft.bcc, subject: draft.subject, bodyText: draft.bodyText, bodyHtml: draft.bodyHtml, attachments, attachmentPayloads }); return { messageId: draft.stableMessageId, from, to: draft.to, cc: draft.cc, bcc: draft.bcc, subject: draft.subject, bodyText: draft.bodyText, ...(draft.bodyHtml ? { bodyHtml: draft.bodyHtml } : {}), attachments, attachmentPayloads, serialized };
  }
  private async resolveAttachmentPayloads(account: MailAccount, attachments: readonly MailAttachment[]): Promise<readonly MailAttachmentPayload[]> {
    if (!attachments.length) return [];
    const adapter = this.adapterFor(account); if (!adapter.fetchAttachment) throw new MailError('UNSUPPORTED', 'Provider does not support attachment fetch');
    const payloads: MailAttachmentPayload[] = [];
    for (const attachment of attachments) {
      const source = this.findAttachmentSource(account.id, attachment.id); if (!source) throw new MailError('INVALID_ARGUMENT', 'Mail attachment source is unavailable');
      const bytes = await adapter.fetchAttachment(this.context(account), source.message, attachment); const maxBytes = Math.min(MAIL_MAX_ATTACHMENT_BYTES, attachment.sizeBytes + 1_024);
      if (!(bytes instanceof Uint8Array) || bytes.byteLength > maxBytes) throw new MailError('BOUNDS_EXCEEDED', 'Outbound attachment exceeds its declared bound');
      payloads.push({ attachment, bytes });
    }
    return payloads;
  }
  private findAttachment(id: string): MailAttachment | undefined { for (const message of Object.values(this.state.messages)) { const attachment = message.attachments.find(value => value.id === id); if (attachment) return attachment; } return undefined; }
  private findAttachmentSource(accountId: string, id: string): { readonly message: MailMessage; readonly attachment: MailAttachment } | undefined { for (const message of Object.values(this.state.messages)) if (message.accountId === accountId) { const attachment = message.attachments.find(value => value.id === id); if (attachment) return { message, attachment }; } return undefined; }

  async markRead(messageId: string, read = true): Promise<MailMutationResult> { return this.mutateMessage(messageId, 'MARK_READ', read); }
  async setStarred(messageId: string, starred = true): Promise<MailMutationResult> { return this.mutateMessage(messageId, 'SET_STARRED', starred); }
  async moveMessage(messageId: string, folderId: string): Promise<MailMutationResult> { const folder = this.requireFolder(folderId); const message = this.requireMessage(messageId); if (folder.accountId !== message.accountId) throw new MailError('POLICY_DENIED', 'Messages cannot move across mail accounts'); return this.mutateMessage(messageId, 'MOVE', folderId); }
  async deleteMessage(messageId: string): Promise<MailMutationResult> { return this.mutateMessage(messageId, 'DELETE', true); }
  async restoreMessage(messageId: string, folderId?: string): Promise<MailMutationResult> { const message = this.requireMessage(messageId); const folder = folderId ? this.requireFolder(folderId) : this.folders(message.accountId).find(value => value.role === 'INBOX'); if (!folder) throw new MailError('FOLDER_NOT_FOUND', 'No restore folder is available'); return this.mutateMessage(messageId, 'RESTORE', folder.id); }

  private async mutateMessage(messageId: string, kind: MailMutationKind, value?: boolean | string): Promise<MailMutationResult> {
    await this.ready(); const current = this.requireMessage(messageId); let flags = [...current.flags]; let folderId = current.folderId; if (kind === 'MARK_READ') flags = value === true ? [...new Set([...flags, 'SEEN' as const])] : flags.filter(flag => flag !== 'SEEN'); if (kind === 'SET_STARRED') flags = value === true ? [...new Set([...flags, 'STARRED' as const])] : flags.filter(flag => flag !== 'STARRED'); if (kind === 'MOVE' || kind === 'RESTORE') folderId = String(value); if (kind === 'DELETE') { const trash = this.folders(current.accountId).find(folder => folder.role === 'TRASH'); if (trash) folderId = trash.id; flags = [...new Set([...flags, 'DELETED' as const])]; }
    const next: MailMessage = { ...current, folderId, flags, updatedAt: nowIso(this.now()) }; const operation: MailPendingMutation = { id: randomId('mail-mutation'), accountId: current.accountId, messageId, kind, ...(value !== undefined ? { value } : {}), baseFolderId: current.folderId, createdAt: nowIso(this.now()), attempts: 0, nextAttemptAt: nowIso(this.now()), state: 'QUEUED' }; this.state = { ...this.state, messages: { ...this.state.messages, [messageId]: next }, mutations: { ...this.state.mutations, [operation.id]: operation } }; await this.persist(); await this.processMutations(current.accountId); return { message: clone(this.state.messages[messageId]!), queued: Boolean(this.state.mutations[operation.id]), providerApplied: !this.state.mutations[operation.id] };
  }

  async processMutations(accountId?: string): Promise<readonly MailPendingMutation[]> {
    await this.ready(); const due = Object.values(this.state.mutations).filter(value => (!accountId || value.accountId === accountId) && value.state === 'QUEUED' && Date.parse(value.nextAttemptAt) <= this.now()).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(0, 16); for (const value of due) await this.processMutation(value.id); await this.persist(); return this.mutations(accountId);
  }

  private async processMutation(operationId: string): Promise<void> {
    const operation = this.state.mutations[operationId]; if (!operation || operation.state !== 'QUEUED') return; const account = this.state.accounts[operation.accountId]; const message = this.state.messages[operation.messageId]; if (!account || !message || !account.enabled) { this.state = { ...this.state, mutations: { ...this.state.mutations, [operationId]: { ...operation, state: 'FAILED', lastError: 'Account or message is unavailable' } } }; return; } const adapter = this.adapterFor(account); if (!adapter.mutate) return;
    this.state = { ...this.state, mutations: { ...this.state.mutations, [operationId]: { ...operation, state: 'APPLYING', attempts: operation.attempts + 1 } } }; await this.persist(); try { const result = await adapter.mutate(this.context(account), operation, message); if (!result.applied) throw new MailError('CONFLICT', 'Provider refused a stale mailbox mutation'); const current = this.state.messages[message.id]; if (current) this.state = { ...this.state, messages: { ...this.state.messages, [message.id]: { ...current, ...(result.folderId ? { folderId: result.folderId } : {}), ...(result.flags ? { flags: result.flags } : {}), updatedAt: nowIso(this.now()) } } }; const mutations = { ...this.state.mutations }; delete mutations[operationId]; this.state = { ...this.state, mutations }; await this.persist(); } catch (error) { const safe = transientError(error); const nextState: MailPendingMutation['state'] = safe.code === 'CONFLICT' ? 'CONFLICT' : operation.attempts >= MAIL_MAX_RETRIES ? 'FAILED' : 'QUEUED'; this.state = { ...this.state, mutations: { ...this.state.mutations, [operationId]: { ...operation, state: nextState, attempts: operation.attempts + 1, nextAttemptAt: nowIso(this.now() + retryDelay(operation.attempts + 1)), lastError: safe.message } } }; await this.persist(); }
  }

  async downloadAttachment(messageId: string, attachmentId: string): Promise<{ readonly attachment: MailAttachment; readonly bytes: Uint8Array }> {
    await this.ready(); const message = this.requireMessage(messageId); const attachment = message.attachments.find(value => value.id === attachmentId); if (!attachment) throw new MailError('INVALID_ARGUMENT', 'Attachment is not part of the message'); const account = this.requireEnabledAccount(message.accountId); const adapter = this.adapterFor(account); if (!adapter.fetchAttachment) throw new MailError('UNSUPPORTED', 'Provider does not support attachment fetch'); try { const bytes = await adapter.fetchAttachment(this.context(account), message, attachment); if (!(bytes instanceof Uint8Array) || bytes.byteLength > Math.min(MAIL_MAX_ATTACHMENT_BYTES, attachment.sizeBytes + 1_024)) throw new MailError('BOUNDS_EXCEEDED', 'Downloaded attachment exceeds declared bounds'); const nextAttachments = message.attachments.map(value => value.id === attachment.id ? { ...value, contentAvailable: true } : value); this.state = { ...this.state, messages: { ...this.state.messages, [message.id]: { ...message, attachments: nextAttachments, updatedAt: nowIso(this.now()) } } }; await this.persist(); return { attachment: clone(nextAttachments.find(value => value.id === attachment.id)!), bytes }; } catch (error) { throw this.accountError(message.accountId, error); }
  }

  async saveAttachmentToFiles(messageId: string, attachmentId: string): Promise<{ readonly fileId: string }> {
    await this.ready(); if (!this.files) throw new MailError('UNSUPPORTED', 'Files integration is not installed'); const value = await this.downloadAttachment(messageId, attachmentId); return this.files.savePrivateAttachment({ accountId: this.requireMessage(messageId).accountId, messageId, attachment: value.attachment, bytes: value.bytes });
  }

  async recipientSuggestions(query: string, limit = 20): Promise<readonly MailAddress[]> {
    await this.ready(); const boundedLimit = boundedInt(limit, 1, 50, 20); const local = this.state.recentRecipients.filter(value => `${value.name ?? ''} ${value.address}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).slice(0, boundedLimit); const contact = this.contacts ? await this.contacts.search(bounded(query, 256), boundedLimit) : []; return uniqueAddresses([...contact, ...local]).slice(0, boundedLimit).map(clone);
  }

  async openExternalLink(url: string, gateway: MailExternalLinkGateway): Promise<void> { if (!safeMailLink(url) || url.startsWith('keystone://')) throw new MailError('POLICY_DENIED', 'Mail link is not an allowed external destination'); await gateway.open(url); }

  dailyItems(): readonly MailDailyItem[] {
    const values: MailDailyItem[] = []; for (const message of Object.values(this.state.messages).filter(value => !value.flags.includes('SEEN')).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)).slice(0, 64)) values.push({ id: `mail-unread:${message.id}`, title: message.subject || message.from.address, summary: `${message.from.name ?? message.from.address} · ${message.snippet}`, priority: message.flags.includes('STARRED') ? 'time-sensitive' : 'communication', requiresAction: true, canonicalRef: { id: message.id, type: 'mail' }, updatedAt: message.updatedAt }); for (const entry of this.outbox().filter(value => value.state === 'FAILED' || value.state === 'UNKNOWN').slice(0, 32)) values.push({ id: `mail-outbox:${entry.id}`, title: entry.state === 'UNKNOWN' ? 'Mail send needs review' : 'Mail send failed', summary: entry.lastError, priority: 'time-sensitive', requiresAction: true, canonicalRef: { id: entry.id, type: 'mail-outbox' }, updatedAt: entry.updatedAt }); return values.slice(0, 96).map(clone);
  }
  private async updateDaily(): Promise<void> { if (this.daily) await this.daily.replace('mail', this.dailyItems()); }

  private async buildLocalSentMessage(account: MailAccount, draft: MailDraft): Promise<void> {
    const sent = this.folders(account.id).find(value => value.role === 'SENT'); if (!sent) return; const attachments = draft.attachmentIds.flatMap(id => { const attachment = this.findAttachment(id); return attachment ? [attachment] : []; }); const local: MailProviderMessage = { providerMessageId: draft.stableMessageId, folderId: sent.id, messageId: draft.stableMessageId, from: account.address, to: draft.to, cc: draft.cc, bcc: [], subject: draft.subject, bodyText: draft.bodyText, bodyHtml: draft.bodyHtml, attachments, flags: ['SEEN'], snippet: plainPreview(draft.bodyText), receivedAt: nowIso(this.now()) }; const normalized = this.normalizeProviderMessage(local, account.id, this.state.folders); this.state = { ...this.state, messages: this.trimMessages({ ...this.state.messages, [normalized.id]: normalized }) }; await this.persist();
  }

  private async hydrateAndRepair(): Promise<void> { await this.ready(); }
}

function retryDelay(attempt: number): number { return Math.min(MAIL_MAX_RETRY_DELAY_MS, 1_000 * (2 ** Math.min(10, Math.max(0, attempt - 1)))); }
async function stableDraftMessageId(draftId: string): Promise<string> { const hash = await digest(`keystone-mail-message:v1:${draftId}`); return `<mail-${hash.slice(0, 40)}@keystone.local>`; }
function threadIdFor(accountId: string, subject: string, messageId: string | undefined, inReplyTo: string | undefined, references: readonly string[]): string { const root = references[0] ?? inReplyTo ?? messageId ?? (subject.toLocaleLowerCase().replace(/^\s*(re|fw|fwd)\s*:\s*/gi, '').trim().slice(0, 200) || 'empty'); return `${accountId}:thread:${stableThreadKey(root)}`; }
function stableThreadKey(value: string): string { let hash = 2166136261; for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619); return (hash >>> 0).toString(16).padStart(8, '0'); }
function formatAddress(value: MailAddress): string { return value.name ? `${value.name} <${value.address}>` : value.address; }
function encodeHeader(value: string): string { return /[^\x20-\x7e]/.test(value) ? `=?UTF-8?B?${base64(value)}?=` : value.replace(/[\r\n]/g, ' '); }
function base64(value: string): string { const bytes = new TextEncoder().encode(value); let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary); }
function base64Bytes(bytes: Uint8Array): string { let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary); }
function wrapBase64(value: string): string { return value.match(/.{1,76}/g)?.join('\r\n') ?? ''; }
function encodeHeaderParameter(value: string): string { return value.replace(/[\r\n"\\]/g, '_'); }
function serializeMailMessage(input: { readonly messageId: string; readonly from: MailAddress; readonly to: readonly MailAddress[]; readonly cc: readonly MailAddress[]; readonly bcc: readonly MailAddress[]; readonly subject: string; readonly bodyText: string; readonly bodyHtml?: string; readonly attachments: readonly (MailAttachment | undefined)[]; readonly attachmentPayloads?: readonly MailAttachmentPayload[] }): string {
  const headers = [`From: ${formatAddress(input.from)}`, `To: ${input.to.map(formatAddress).join(', ')}`, ...(input.cc.length ? [`Cc: ${input.cc.map(formatAddress).join(', ')}`] : []), `Subject: ${encodeHeader(input.subject)}`, `Date: ${new Date().toUTCString()}`, `Message-ID: ${safeMessageId(input.messageId)}`, 'MIME-Version: 1.0'];
  const payloads = (input.attachmentPayloads ?? []).slice(0, MAIL_MAX_ATTACHMENTS).map(value => ({ attachment: normalizeAttachment(value.attachment), bytes: value.bytes }));
  const alternativeBoundary = `=_keystone_alt_${stableThreadKey(input.messageId)}`;
  const bodyPart = input.bodyHtml ? [`Content-Type: multipart/alternative; boundary="${alternativeBoundary}"`, '', `--${alternativeBoundary}`, 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: 8bit', '', input.bodyText, `--${alternativeBoundary}`, 'Content-Type: text/html; charset=utf-8', 'Content-Transfer-Encoding: 8bit', '', input.bodyHtml, `--${alternativeBoundary}--`] : ['Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: 8bit', '', input.bodyText];
  if (!payloads.length) return `${headers.join('\r\n')}\r\n${bodyPart.join('\r\n')}`;
  const mixedBoundary = `=_keystone_mixed_${stableThreadKey(input.messageId)}`;
  const attachmentParts = payloads.flatMap(({ attachment, bytes }) => [`--${mixedBoundary}`, `Content-Type: ${safeMimeType(attachment.mimeType)}; name="${encodeHeaderParameter(attachment.filename)}"`, `Content-Disposition: ${attachment.disposition === 'INLINE' ? 'inline' : 'attachment'}; filename="${encodeHeaderParameter(attachment.filename)}"`, 'Content-Transfer-Encoding: base64', ...(attachment.contentId ? [`Content-ID: <${encodeHeaderParameter(attachment.contentId)}>`] : []), '', wrapBase64(base64Bytes(bytes))]);
  const body = [`Content-Type: multipart/mixed; boundary="${mixedBoundary}"`, '', `--${mixedBoundary}`, ...bodyPart, ...attachmentParts, `--${mixedBoundary}--`].join('\r\n');
  return `${headers.join('\r\n')}\r\n${body}`;
}

function normalizeMailState(raw: unknown): MailState {
  if (!raw || typeof raw !== 'object') return defaultState(); const value = raw as Partial<MailState>; if (value.version !== 1) throw new MailError('PROTOCOL_ERROR', 'Unsupported mail state version'); const accounts: Record<string, MailAccount> = {}; for (const [id, candidate] of Object.entries(value.accounts ?? {})) { if (!candidate || typeof candidate !== 'object') continue; try { const account = candidate as MailAccount; const safe = { ...account, version: 1 as const, id: safeId(id, 'account id'), label: bounded(account.label, 160, true), address: normalizeAddress(account.address), provider: normalizeProviderConfig(account.provider), enabled: account.enabled !== false, syncState: normalizeSyncState(account.syncState), createdAt: validIso(account.createdAt) ? account.createdAt : nowIso(Date.now()), updatedAt: validIso(account.updatedAt) ? account.updatedAt : nowIso(Date.now()) }; accounts[id] = safe; } catch { /* malformed persisted account is ignored, never activated */ } }
  const folders: Record<string, MailFolder> = {}; for (const [id, candidate] of Object.entries(value.folders ?? {})) { if (!candidate || typeof candidate !== 'object') continue; const folder = candidate as MailFolder; if (typeof folder.accountId === 'string' && accounts[folder.accountId] && typeof folder.name === 'string' && typeof folder.path === 'string') folders[id] = { ...folder, id, name: bounded(folder.name, 200), path: bounded(folder.path, 512), selectable: folder.selectable !== false }; }
  const messages: Record<string, MailMessage> = {}; for (const [id, candidate] of Object.entries(value.messages ?? {})) { if (!candidate || typeof candidate !== 'object') continue; const message = candidate as MailMessage; try { if (accounts[message.accountId] && folders[message.folderId] && typeof message.providerMessageId === 'string' && typeof message.from?.address === 'string') messages[id] = { ...message, id, from: normalizeAddress(message.from), to: normalizeAddresses(message.to), cc: normalizeAddresses(message.cc), references: Array.isArray(message.references) ? message.references.filter(reference => typeof reference === 'string').slice(0, 128) : [], attachments: Array.isArray(message.attachments) ? message.attachments.slice(0, MAIL_MAX_ATTACHMENTS).map(value => ({ ...value, filename: safeFilename(value.filename), privateByDefault: true as const })) : [], flags: normalizeFlags(message.flags), contentState: ['METADATA', 'CACHED', 'PARTIAL'].includes(message.contentState) ? message.contentState : 'METADATA', readReceiptRequested: message.readReceiptRequested === true, externalImageUrls: Array.isArray(message.externalImageUrls) ? message.externalImageUrls.filter(value => typeof value === 'string').slice(0, 64) : [], subject: bounded(message.subject, 998), snippet: bounded(message.snippet, 280), receivedAt: validIso(message.receivedAt) ? message.receivedAt : nowIso(Date.now()), createdAt: validIso(message.createdAt) ? message.createdAt : nowIso(Date.now()), updatedAt: validIso(message.updatedAt) ? message.updatedAt : nowIso(Date.now()) }; } catch { /* malformed cache entry is evicted */ } }
  const drafts: Record<string, MailDraft> = {}; for (const [id, candidate] of Object.entries(value.drafts ?? {})) { if (!candidate || typeof candidate !== 'object') continue; const draft = candidate as MailDraft; try { if (accounts[draft.accountId] && MESSAGE_ID.test(draft.stableMessageId)) drafts[id] = { ...draft, id, to: normalizeAddresses(draft.to), cc: normalizeAddresses(draft.cc), bcc: normalizeAddresses(draft.bcc), subject: bounded(draft.subject, 998), bodyText: bounded(draft.bodyText, MAIL_MAX_BODY_BYTES), attachmentIds: Array.isArray(draft.attachmentIds) ? draft.attachmentIds.slice(0, MAIL_MAX_ATTACHMENTS).filter(value => typeof value === 'string') : [], status: ['DRAFT', 'QUEUED', 'SENDING', 'SENT', 'FAILED', 'UNKNOWN'].includes(draft.status) ? draft.status : 'DRAFT', createdAt: validIso(draft.createdAt) ? draft.createdAt : nowIso(Date.now()), updatedAt: validIso(draft.updatedAt) ? draft.updatedAt : nowIso(Date.now()) }; } catch { /* malformed draft is evicted */ } }
  const outbox: Record<string, MailOutboxEntry> = {}; for (const [id, candidate] of Object.entries(value.outbox ?? {}).slice(-MAIL_MAX_OUTBOX)) { if (!candidate || typeof candidate !== 'object') continue; const entry = candidate as MailOutboxEntry; if (drafts[entry.draftId] && accounts[entry.accountId] && MESSAGE_ID.test(entry.stableMessageId) && ['QUEUED', 'SENDING', 'SENT', 'FAILED', 'UNKNOWN'].includes(entry.state)) outbox[id] = { ...entry, id, attempts: Math.max(0, Math.min(MAIL_MAX_RETRIES, entry.attempts ?? 0)), state: entry.state === 'SENDING' ? 'QUEUED' : entry.state }; }
  const mutations: Record<string, MailPendingMutation> = {}; for (const [id, candidate] of Object.entries(value.mutations ?? {}).slice(-MAIL_MAX_OPERATIONS)) { if (!candidate || typeof candidate !== 'object') continue; const operation = candidate as MailPendingMutation; if (accounts[operation.accountId] && messages[operation.messageId] && ['MARK_READ', 'SET_STARRED', 'MOVE', 'DELETE', 'RESTORE'].includes(operation.kind)) mutations[id] = { ...operation, id, state: operation.state === 'APPLYING' ? 'QUEUED' : operation.state, attempts: Math.max(0, Math.min(MAIL_MAX_RETRIES, operation.attempts ?? 0)) }; }
  return { version: 1, accounts, folders, messages, drafts, outbox, mutations, recentRecipients: Array.isArray(value.recentRecipients) ? value.recentRecipients.flatMap(value => { try { return [normalizeAddress(value)]; } catch { return []; } }).slice(0, MAIL_MAX_RECENT_RECIPIENTS) : [], externalImagePolicy: value.externalImagePolicy === 'ALLOW_EXPLICIT' ? 'ALLOW_EXPLICIT' : 'BLOCK_BY_DEFAULT' };
}
function normalizeSyncState(value: unknown): MailSyncState { if (!value || typeof value !== 'object') return { version: 1, folders: {}, baselineEstablished: false }; const candidate = value as MailSyncState; const folders: Record<string, MailFolderSyncState> = {}; for (const [id, item] of Object.entries(candidate.folders ?? {})) if (item && typeof item === 'object') { const folder = item as MailFolderSyncState; folders[id] = { folderId: id, ...(typeof folder.uidValidity === 'string' ? { uidValidity: folder.uidValidity.slice(0, 256) } : {}), ...(typeof folder.cursor === 'string' ? { cursor: folder.cursor.slice(0, 512) } : {}), ...(typeof folder.highestUid === 'number' && Number.isSafeInteger(folder.highestUid) ? { highestUid: Math.max(0, folder.highestUid) } : {}), baselineEstablished: folder.baselineEstablished === true, ...(validIso(folder.updatedAt) ? { updatedAt: folder.updatedAt } : {}) }; } return { version: 1, folders, ...(validIso(candidate.lastSuccessfulSync) ? { lastSuccessfulSync: candidate.lastSuccessfulSync } : {}), baselineEstablished: candidate.baselineEstablished === true }; }
