/**
 * R0P85 Nearby Exchange.
 *
 * This is the application exchange boundary above the R0P68 anonymous nearby
 * provider.  A nearby endpoint is a short-lived session, never a Keystone
 * Identity, Contact, owned device or location.  Accepted file content uses
 * the R0P74 manifest/chunk scheduler; the provider only carries encrypted
 * opaque frames.
 */

import type { NodeId } from './types.js';
import {
  AnonymousNearbyTransportProvider,
  type AnonymousNearbyPeerHandle,
  type EphemeralTransportIdentity,
  type NearbyEvidenceLevel,
} from './nearby.js';
import {
  createOpaqueDeliveryEnvelope,
  decodeOpaqueBytes,
  encodeOpaqueBytes,
  type KeystoneDeliveryInterface,
  type OpaqueDeliveryEnvelope,
  type OpaqueFrame,
  type TransportSession,
} from './connectivity.js';
import {
  ContentCache,
  createContentManifest,
  contentManifestSchema,
  type ContentId,
  type ContentManifest,
} from './social/content.js';
import {
  DistributedContentService,
  type DistributedContentSource,
  type ContentTransferSession,
  type ContentTransferStateStore,
} from './social/distributed-content.js';
import { parseBoundedJson } from './security/protocol-security.js';

export const NEARBY_EXCHANGE_PROTOCOL = 'keystone.nearby.exchange.r0p85' as const;
export const NEARBY_EXCHANGE_VERSION = 1 as const;
export const NEARBY_EXCHANGE_MAX_TTL_MS = 10 * 60_000;
export const NEARBY_EXCHANGE_MAX_ALIAS_BYTES = 96;
export const NEARBY_EXCHANGE_MAX_TEXT_BYTES = 16 * 1024;
export const NEARBY_EXCHANGE_MAX_PREVIEW_BYTES = 4 * 1024;
export const NEARBY_EXCHANGE_MAX_WIRE_BYTES = 512 * 1024;
export const NEARBY_EXCHANGE_MAX_CONTENT_BYTES = 64 * 1024 * 1024;
export const NEARBY_EXCHANGE_MAX_OFFERS_PER_SESSION = 64;
export const NEARBY_EXCHANGE_MAX_PENDING_OFFERS = 256;
export const NEARBY_EXCHANGE_MAX_ENDPOINTS = 256;
export const NEARBY_EXCHANGE_MAX_BATCH_FILES = 100;
export const NEARBY_EXCHANGE_MAX_HISTORY = 256;
export const NEARBY_EXCHANGE_MAX_DEDUP = 4_096;
export const NEARBY_EXCHANGE_MAX_SESSIONS = 256;

export type NearbyReceivePolicy = 'NOT_ACCEPTING' | 'CONTACTS_ONLY' | 'TEMPORARILY_VISIBLE' | 'ASK_EVERY_TIME';
export type NearbyEndpointSocialState = 'ANONYMOUS' | 'IDENTITY_DISCLOSED' | 'KNOWN_CONTACT' | 'OWN_DEVICE';
export type NearbyExchangeObjectType = 'file' | 'text' | 'url' | 'place' | 'route' | 'publication' | 'contact' | 'collaboration' | 'document';
export type NearbyExchangeTransferStatus =
  | 'OFFERED'
  | 'ACCEPTED'
  | 'TRANSFERRING'
  | 'PAUSED_WAITING_ROUTE'
  | 'VERIFYING'
  | 'RECEIVED'
  | 'REJECTED'
  | 'CANCELED'
  | 'FAILED'
  | 'EXPIRED';
export type NearbyExchangeDirection = 'OUTGOING' | 'INCOMING';

export interface NearbyFileExchangeObject {
  readonly version: 1;
  readonly type: 'file';
  readonly contentId: ContentId;
  readonly byteLength: number;
  readonly mimeType: string;
  readonly name: string;
  readonly fileId?: string;
  /** A nearby file is always a copy; it never grants access to the source. */
  readonly mode: 'COPY';
}

export interface NearbyTextExchangeObject {
  readonly version: 1;
  readonly type: 'text';
  readonly text: string;
}

export interface NearbyUrlExchangeObject {
  readonly version: 1;
  readonly type: 'url';
  readonly url: string;
  readonly hostname: string;
  readonly title?: string;
}

export interface NearbyPlaceExchangeObject {
  readonly version: 1;
  readonly type: 'place';
  readonly placeId: string;
  readonly displayName: string;
  readonly address?: string;
  readonly category?: string;
  readonly approximateRegion?: string;
  /** A shared place snapshot is not a sender live-location fix. */
  readonly coordinates?: { readonly latitude: number; readonly longitude: number };
}

export interface NearbyRouteExchangeObject {
  readonly version: 1;
  readonly type: 'route';
  readonly routeId?: string;
  readonly mode: 'WALKING' | 'DRIVING' | 'CYCLING' | 'TRANSIT';
  readonly label?: string;
  readonly origin?: { readonly label?: string; readonly placeId?: string; readonly coordinates?: { readonly latitude: number; readonly longitude: number } };
  readonly destination?: { readonly label?: string; readonly placeId?: string; readonly coordinates?: { readonly latitude: number; readonly longitude: number } };
  readonly points?: readonly { readonly latitude: number; readonly longitude: number }[];
}

export interface NearbyPublicationExchangeObject {
  readonly version: 1;
  readonly type: 'publication';
  readonly publicationId: string;
  readonly revisionAddress?: string;
  readonly title?: string;
}

export type NearbyContactField = 'displayName' | 'identityId' | 'avatarUri' | 'collaborationEmail' | 'phoneNumber' | 'publicLinks';
export interface NearbyContactExchangeObject {
  readonly version: 1;
  readonly type: 'contact';
  readonly selectedFields: readonly NearbyContactField[];
  readonly fields: Readonly<Partial<Record<NearbyContactField, string | readonly { readonly label: string; readonly url: string }[]>>>;
}

export interface NearbyCollaborationExchangeObject {
  readonly version: 1;
  readonly type: 'collaboration';
  readonly invitationId: string;
  readonly objectId: string;
  readonly objectKind?: string;
  readonly spaceId?: string;
  readonly role?: 'viewer' | 'commenter' | 'editor';
  readonly mode: 'COPY' | 'GRANT_ACCESS';
  readonly label?: string;
}

export interface NearbyDocumentExchangeObject {
  readonly version: 1;
  readonly type: 'document';
  readonly objectId: string;
  readonly label?: string;
  readonly mode: 'COPY' | 'GRANT_ACCESS';
  readonly revision?: string;
}

export type NearbyExchangeObject =
  | NearbyFileExchangeObject
  | NearbyTextExchangeObject
  | NearbyUrlExchangeObject
  | NearbyPlaceExchangeObject
  | NearbyRouteExchangeObject
  | NearbyPublicationExchangeObject
  | NearbyContactExchangeObject
  | NearbyCollaborationExchangeObject
  | NearbyDocumentExchangeObject;

export interface NearbyOfferPreview {
  readonly version: 1;
  readonly type: NearbyExchangeObjectType;
  readonly title: string;
  readonly subtitle?: string;
  readonly textPreview?: string;
  readonly hostname?: string;
  readonly byteLength?: number;
  readonly fileCount?: number;
}

export interface NearbyEndpoint {
  /** Ephemeral local session identifier; not a Profile or transport handle. */
  readonly endpointId: string;
  readonly alias: string;
  readonly capabilities: readonly NearbyExchangeObjectType[];
  readonly verificationCode: string;
  readonly expiresAt: string;
  readonly discoveredAt: string;
  readonly socialState: NearbyEndpointSocialState;
  readonly visible: boolean;
}

export interface NearbyOffer {
  readonly version: 1;
  readonly offerId: string;
  readonly endpointId: string;
  readonly direction: NearbyExchangeDirection;
  readonly objectType: NearbyExchangeObjectType;
  readonly preview: NearbyOfferPreview;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly status: NearbyExchangeTransferStatus;
  readonly verificationCode: string;
  readonly updatedAt: string;
}

export interface NearbyExchangeReceipt {
  readonly version: 1;
  readonly transferId: string;
  readonly offerId: string;
  readonly status: 'ACCEPTED' | 'RECEIVED' | 'REJECTED' | 'CANCELED' | 'FAILED';
  readonly contentId?: ContentId;
  readonly verifiedAt?: string;
  readonly reason?: string;
}

export interface NearbyTransfer {
  readonly version: 1;
  readonly transferId: string;
  readonly offerId: string;
  readonly endpointId: string;
  readonly direction: NearbyExchangeDirection;
  readonly objectType: NearbyExchangeObjectType;
  readonly status: NearbyExchangeTransferStatus;
  readonly completedBytes: number;
  readonly totalBytes?: number;
  readonly progress: number;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly updatedAt: string;
  readonly object?: NearbyExchangeObject;
  readonly receipt?: NearbyExchangeReceipt;
  readonly lastError?: string;
}

export interface NearbyIdentityDisclosure {
  readonly version: 1;
  readonly kind: 'IDENTITY_DISCLOSURE';
  readonly identityId?: NodeId;
  readonly displayName?: string;
  readonly avatarUri?: string;
  readonly collaborationEmail?: string;
  readonly phoneNumber?: string;
  readonly publicLinks?: readonly { readonly label: string; readonly url: string }[];
  readonly disclosedFields: readonly NearbyContactField[];
}

export interface NearbyReceiveQrPayload {
  readonly protocol: typeof NEARBY_EXCHANGE_PROTOCOL;
  readonly version: 1;
  readonly kind: 'RECEIVE_QR';
  readonly token: string;
  readonly endpointHandle: string;
  readonly endpointPublicKey: string;
  readonly expiresAt: string;
  readonly scope: 'ONE_TIME_RECEIVE';
}

export interface NearbyQrParseResult {
  readonly accepted: boolean;
  readonly payload?: NearbyReceiveQrPayload;
  readonly reason?: string;
}

export interface NearbyExchangeDiagnostics {
  readonly running: boolean;
  readonly receivePolicy: NearbyReceivePolicy;
  readonly receivingUntil?: string;
  readonly endpointCount: number;
  readonly sessionCount: number;
  readonly pendingOffers: number;
  readonly activeTransfers: number;
  readonly historyCount: number;
  readonly dedupCount: number;
  readonly fragmentCount: number;
  readonly nearbyEvidence: NearbyEvidenceLevel;
  readonly nearbyProviderId: string;
  readonly fabricAvailable: boolean;
}

export type NearbyExchangeEvent =
  | { readonly type: 'endpoint'; readonly endpoint: NearbyEndpoint }
  | { readonly type: 'offer'; readonly offer: NearbyOffer }
  | { readonly type: 'transfer'; readonly transfer: NearbyTransfer }
  | { readonly type: 'identity'; readonly endpointId: string; readonly disclosure: NearbyIdentityDisclosure }
  | { readonly type: 'policy'; readonly policy: NearbyReceivePolicy; readonly active: boolean };

export interface NearbyExchangeStorage {
  read(): Promise<unknown | undefined>;
  write(value: unknown): Promise<void>;
}

export class InMemoryNearbyExchangeStorage implements NearbyExchangeStorage {
  private value?: unknown;
  async read(): Promise<unknown | undefined> { return this.value === undefined ? undefined : structuredClone(this.value); }
  async write(value: unknown): Promise<void> { this.value = structuredClone(value); }
}

/** Social identity is a separate, explicit host action. */
export interface NearbySocialDisclosureAdapter {
  disclose(input: { readonly selectedFields: readonly NearbyContactField[]; readonly endpointId: string }): Promise<NearbyIdentityDisclosure>;
  addContact?(input: { readonly endpointId: string; readonly disclosure: NearbyIdentityDisclosure }): Promise<{ readonly contactId?: string }>;
}

/** The Fabric owns route/provider choice. A host may expose a faster source
 * through this adapter; NearbyExchangeService only composes eligible sources. */
export interface NearbyExchangeBulkSourceAdapter {
  sourceFor(input: {
    readonly transferId: string;
    readonly offerId: string;
    readonly manifest: ContentManifest;
    readonly authorizationGrant: string;
    readonly endpointId: string;
  }): Promise<DistributedContentSource | undefined>;
}

export interface NearbyExchangeServiceOptions {
  readonly nearby: AnonymousNearbyTransportProvider;
  /** Optional canonical Fabric boundary used by a host bulk adapter. */
  readonly delivery?: KeystoneDeliveryInterface;
  readonly storage?: NearbyExchangeStorage;
  readonly contentCache?: ContentCache;
  readonly transferState?: ContentTransferStateStore;
  readonly social?: NearbySocialDisclosureAdapter;
  readonly bulkSource?: NearbyExchangeBulkSourceAdapter;
  readonly localAlias?: string;
  readonly localCapabilities?: readonly NearbyExchangeObjectType[];
  readonly now?: () => number;
  readonly manageNearbyLifecycle?: boolean;
  readonly onIncoming?: (offer: NearbyOffer) => void | Promise<void>;
  readonly onReceived?: (input: { readonly transfer: NearbyTransfer; readonly object: NearbyExchangeObject; readonly contentId?: ContentId }) => void | Promise<void>;
  readonly maxEndpoints?: number;
  readonly maxSessions?: number;
  readonly maxPendingOffers?: number;
  readonly maxHistory?: number;
  readonly maxDedup?: number;
  readonly maxContentBytes?: number;
}

export type NearbyExchangeErrorCode =
  | 'INVALID_ARGUMENT'
  | 'UNAVAILABLE'
  | 'POLICY_DENIED'
  | 'RESOURCE_LIMIT'
  | 'EXPIRED'
  | 'REPLAY'
  | 'MALFORMED'
  | 'INTEGRITY'
  | 'CANCELED'
  | 'FAILED'
  | 'NOT_FOUND';

export class NearbyExchangeError extends Error {
  constructor(readonly code: NearbyExchangeErrorCode, message: string) {
    super(message);
    this.name = 'NearbyExchangeError';
  }
}

interface ExchangeSessionState {
  readonly sessionId: string;
  readonly endpointId: string;
  readonly peerHandle: AnonymousNearbyPeerHandle;
  readonly transportSession: TransportSession;
  readonly createdAt: number;
  expiresAt: number;
  alias: string;
  capabilities: readonly NearbyExchangeObjectType[];
  verificationCode: string;
  socialState: NearbyEndpointSocialState;
  visible: boolean;
  helloReceived: boolean;
  helloSent: boolean;
  bootstrapToken?: string;
  closed: boolean;
}

interface LocalOfferRecord {
  readonly offer: NearbyOffer;
  readonly object: NearbyExchangeObject;
  readonly manifest?: ContentManifest;
  readonly authorizationGrant: string;
  status: NearbyExchangeTransferStatus;
  transferId: string;
  updatedAt: number;
  receipt?: NearbyExchangeReceipt;
}

interface IncomingOfferRecord {
  readonly offer: NearbyOffer;
  readonly objectType: NearbyExchangeObjectType;
  status: NearbyExchangeTransferStatus;
  transferId: string;
  updatedAt: number;
  object?: NearbyExchangeObject;
  manifest?: ContentManifest;
  authorizationGrant?: string;
  receipt?: NearbyExchangeReceipt;
}

interface PendingChunk {
  readonly transferId: string;
  readonly contentId: ContentId;
  readonly resolve: (bytes: Uint8Array) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

interface FragmentState {
  readonly sessionId: string;
  readonly fragmentId: string;
  readonly count: number;
  readonly expiresAt: number;
  readonly parts: Map<number, Uint8Array>;
  totalBytes: number;
}

interface PersistedState {
  readonly version: 1;
  readonly offers: readonly { readonly offer: NearbyOffer; readonly direction: NearbyExchangeDirection; readonly objectType: NearbyExchangeObjectType; readonly status: NearbyExchangeTransferStatus; readonly transferId: string; readonly updatedAt: number }[];
  readonly transfers: readonly NearbyTransfer[];
  readonly history: readonly NearbyTransfer[];
}

type ExchangeWireKind =
  | 'HELLO'
  | 'HELLO_ACK'
  | 'OFFER'
  | 'OFFER_RESPONSE'
  | 'OBJECT_DETAILS'
  | 'CHUNK_REQUEST'
  | 'CHUNK_RESPONSE'
  | 'RECEIPT'
  | 'CANCEL'
  | 'IDENTITY_DISCLOSURE'
  | 'IDENTITY_ACK'
  | 'FRAGMENT';

interface ExchangeWireBase {
  readonly protocol: typeof NEARBY_EXCHANGE_PROTOCOL;
  readonly version: 1;
  readonly kind: ExchangeWireKind;
  readonly sessionId: string;
  readonly messageId: string;
  readonly expiresAt: string;
}

type ExchangeWire = ExchangeHelloWire | ExchangeHelloAckWire | ExchangeOfferWire | ExchangeOfferResponseWire | ExchangeObjectDetailsWire | ExchangeChunkRequestWire | ExchangeChunkResponseWire | ExchangeReceiptWire | ExchangeCancelWire | ExchangeIdentityWire | ExchangeIdentityAckWire | ExchangeFragmentWire;

interface ExchangeHelloWire extends ExchangeWireBase {
  readonly kind: 'HELLO';
  readonly alias?: string;
  readonly capabilities: readonly NearbyExchangeObjectType[];
  readonly bootstrapToken?: string;
}
interface ExchangeHelloAckWire extends ExchangeWireBase {
  readonly kind: 'HELLO_ACK';
  readonly visible: boolean;
  readonly alias?: string;
  readonly capabilities: readonly NearbyExchangeObjectType[];
  readonly verificationCode: string;
  readonly socialState: NearbyEndpointSocialState;
}
interface ExchangeOfferWire extends ExchangeWireBase {
  readonly kind: 'OFFER';
  readonly offer: NearbyOffer;
  /** Shared exchange id; it is not a social or transport identity. */
  readonly transferId: string;
}
interface ExchangeOfferResponseWire extends ExchangeWireBase {
  readonly kind: 'OFFER_RESPONSE';
  readonly offerId: string;
  readonly transferId: string;
  readonly accepted: boolean;
  readonly reason?: string;
}
interface ExchangeObjectDetailsWire extends ExchangeWireBase {
  readonly kind: 'OBJECT_DETAILS';
  readonly offerId: string;
  readonly transferId: string;
  readonly object: NearbyExchangeObject;
  readonly manifest?: ContentManifest;
  readonly authorizationGrant?: string;
}
interface ExchangeChunkRequestWire extends ExchangeWireBase {
  readonly kind: 'CHUNK_REQUEST';
  readonly requestId: string;
  readonly offerId: string;
  readonly transferId: string;
  readonly contentId: ContentId;
  readonly index: number;
  readonly authorizationGrant: string;
}
interface ExchangeChunkResponseWire extends ExchangeWireBase {
  readonly kind: 'CHUNK_RESPONSE';
  readonly transferId: string;
  readonly requestId: string;
  readonly contentId: ContentId;
  readonly index: number;
  readonly bytes: string;
}
interface ExchangeReceiptWire extends ExchangeWireBase {
  readonly kind: 'RECEIPT';
  readonly receipt: NearbyExchangeReceipt;
}
interface ExchangeCancelWire extends ExchangeWireBase {
  readonly kind: 'CANCEL';
  readonly offerId: string;
  readonly transferId: string;
  readonly reason?: string;
}
interface ExchangeIdentityWire extends ExchangeWireBase {
  readonly kind: 'IDENTITY_DISCLOSURE';
  readonly endpointId: string;
  readonly disclosure: NearbyIdentityDisclosure;
}
interface ExchangeIdentityAckWire extends ExchangeWireBase {
  readonly kind: 'IDENTITY_ACK';
  readonly endpointId: string;
  readonly accepted: boolean;
}
interface ExchangeFragmentWire extends ExchangeWireBase {
  readonly kind: 'FRAGMENT';
  readonly fragmentId: string;
  readonly index: number;
  readonly count: number;
  readonly payload: string;
}

const DEFAULT_CAPABILITIES: readonly NearbyExchangeObjectType[] = Object.freeze(['file', 'text', 'url', 'place', 'route', 'publication', 'contact', 'collaboration', 'document']);
const DEFAULT_ALIAS = 'Пользователь поблизости';
const CONTROL_DESTINATION = 'nearby-exchange';
const MAX_CHUNK_RESPONSE_BYTES = 16 * 1024;
const CHUNK_REQUEST_TIMEOUT_MS = 15_000;

function nowIso(now: () => number): string { return new Date(now()).toISOString(); }
function randomId(prefix: string): string { return `${prefix}:${crypto.randomUUID()}`; }
function byteLength(value: string): number { return new TextEncoder().encode(value).byteLength; }
function clone<T>(value: T): T { return structuredClone(value); }
function asPeerHandle(value: string): AnonymousNearbyPeerHandle { return value as AnonymousNearbyPeerHandle; }
function safeAlias(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!normalized || byteLength(normalized) > NEARBY_EXCHANGE_MAX_ALIAS_BYTES) throw new NearbyExchangeError('INVALID_ARGUMENT', 'Nearby alias is empty or too long');
  return normalized.slice(0, 64);
}
function safeString(value: unknown, max: number, field: string): string {
  if (typeof value !== 'string' || !value.trim() || byteLength(value) > max) throw new NearbyExchangeError('MALFORMED', `${field} is invalid`);
  return value;
}
function safeId(value: unknown, field: string, max = 256): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > max || !/^[A-Za-z0-9:_./@-]+$/.test(value)) throw new NearbyExchangeError('MALFORMED', `${field} is invalid`);
  return value;
}
function isFiniteCoordinate(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
function assertCoordinate(value: { readonly latitude: number; readonly longitude: number } | undefined): void {
  if (!value) return;
  if (!isFiniteCoordinate(value.latitude) || !isFiniteCoordinate(value.longitude) || value.latitude < -90 || value.latitude > 90 || value.longitude < -180 || value.longitude > 180) throw new NearbyExchangeError('MALFORMED', 'Place/route coordinates are invalid');
}
function safeExternalUrl(value: string): URL {
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new NearbyExchangeError('POLICY_DENIED', 'Nearby URL is invalid'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.hostname.length > 253) throw new NearbyExchangeError('POLICY_DENIED', 'Nearby URL is not an approved external destination');
  return parsed;
}
function sanitizeFilename(value: string): string {
  const normalized = value.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, '').replace(/[\\/]/g, '_').replace(/\.\.+/g, '.').trim();
  const safe = normalized.replace(/^\.+$/, '_').slice(0, 255);
  return safe || 'received-file';
}
function clampInt(value: number | undefined, min: number, max: number, fallback: number): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < min || resolved > max) throw new NearbyExchangeError('INVALID_ARGUMENT', 'Nearby resource bound is invalid');
  return resolved;
}
function expiresAtFor(now: () => number, ttlMs = NEARBY_EXCHANGE_MAX_TTL_MS): string {
  const ttl = clampInt(ttlMs, 1_000, NEARBY_EXCHANGE_MAX_TTL_MS, NEARBY_EXCHANGE_MAX_TTL_MS);
  return new Date(now() + ttl).toISOString();
}
function isExpired(value: string, now: () => number): boolean { const at = Date.parse(value); return !Number.isFinite(at) || at <= now(); }
function boundedProgress(completed: number, total: number | undefined): number { return total && total > 0 ? Math.max(0, Math.min(1, completed / total)) : 0; }
function base64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64url');
  let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function fromBase64(value: string): Uint8Array {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]*$/.test(value)) throw new NearbyExchangeError('MALFORMED', 'Base64 payload is invalid');
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(value, 'base64url'));
  const raw = atob(value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '='));
  return Uint8Array.from(raw, item => item.charCodeAt(0));
}
async function verificationCode(sessionId: string, left: string, right: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`keystone:nearby-verification:v1:${sessionId}:${[left, right].sort().join(':')}`));
  const value = [...new Uint8Array(digest)].slice(0, 4).reduce((result, byte) => (result * 256) + byte, 0) % 1_000_000;
  return value.toString().padStart(6, '0').replace(/(\d{3})(\d{3})/, '$1 $2');
}
function isObject(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function jsonBytes(value: unknown): number { try { return byteLength(JSON.stringify(value)); } catch { return Number.MAX_SAFE_INTEGER; } }
function requiredCapability(type: NearbyExchangeObjectType): NearbyExchangeObjectType { return type; }

function objectPreview(object: NearbyExchangeObject): NearbyOfferPreview {
  switch (object.type) {
    case 'file': return { version: 1, type: 'file', title: sanitizeFilename(object.name), subtitle: `${object.mimeType} · ${formatBytes(object.byteLength)}`, byteLength: object.byteLength, fileCount: 1 };
    case 'text': return { version: 1, type: 'text', title: 'Text', textPreview: object.text.slice(0, 240) };
    case 'url': return { version: 1, type: 'url', title: object.title?.slice(0, 120) || object.hostname, subtitle: object.hostname, hostname: object.hostname };
    case 'place': return { version: 1, type: 'place', title: object.displayName.slice(0, 120), subtitle: object.address ?? object.approximateRegion ?? object.category };
    case 'route': return { version: 1, type: 'route', title: object.label?.slice(0, 120) || 'Route', subtitle: object.mode };
    case 'publication': return { version: 1, type: 'publication', title: object.title?.slice(0, 120) || 'Publication', subtitle: object.publicationId };
    case 'contact': return { version: 1, type: 'contact', title: 'Contact card', subtitle: object.selectedFields.join(', ') };
    case 'collaboration': return { version: 1, type: 'collaboration', title: object.label?.slice(0, 120) || 'Collaboration invitation', subtitle: object.mode === 'COPY' ? 'Copy' : 'Access invitation' };
    case 'document': return { version: 1, type: 'document', title: object.label?.slice(0, 120) || 'Document', subtitle: object.mode === 'COPY' ? 'Copy' : 'Access invitation' };
  }
}

function validateObject(input: unknown, allowContentId = true): NearbyExchangeObject {
  if (!isObject(input) || input.version !== 1 || typeof input.type !== 'string') throw new NearbyExchangeError('MALFORMED', 'Nearby exchange object is malformed');
  const candidate = input as Record<string, unknown>;
  switch (candidate.type) {
    case 'file': {
      const contentId = safeString(candidate.contentId, 128, 'contentId');
      if (allowContentId && !/^sha256-[a-f0-9]{64}$/i.test(contentId)) throw new NearbyExchangeError('MALFORMED', 'File contentId is invalid');
      if (!Number.isSafeInteger(candidate.byteLength) || (candidate.byteLength as number) < 0 || (candidate.byteLength as number) > NEARBY_EXCHANGE_MAX_CONTENT_BYTES) throw new NearbyExchangeError('RESOURCE_LIMIT', 'File size exceeds nearby bound');
      const mimeType = safeString(candidate.mimeType, 255, 'mimeType');
      const name = safeString(candidate.name, 255, 'file name');
      return { version: 1, type: 'file', contentId: contentId as ContentId, byteLength: candidate.byteLength as number, mimeType, name: sanitizeFilename(name), ...(typeof candidate.fileId === 'string' ? { fileId: candidate.fileId.slice(0, 256) } : {}), mode: 'COPY' };
    }
    case 'text': {
      const text = safeString(candidate.text, NEARBY_EXCHANGE_MAX_TEXT_BYTES, 'text');
      return { version: 1, type: 'text', text };
    }
    case 'url': {
      const url = safeExternalUrl(safeString(candidate.url, 2_048, 'url'));
      return { version: 1, type: 'url', url: url.toString(), hostname: url.hostname, ...(typeof candidate.title === 'string' ? { title: candidate.title.slice(0, 160) } : {}) };
    }
    case 'place': {
      const placeId = safeId(candidate.placeId, 'placeId'); const displayName = safeString(candidate.displayName, 240, 'place display name');
      if (candidate.coordinates !== undefined && (!isObject(candidate.coordinates) || !isFiniteCoordinate(candidate.coordinates.latitude) || !isFiniteCoordinate(candidate.coordinates.longitude))) throw new NearbyExchangeError('MALFORMED', 'Place coordinates are invalid');
      assertCoordinate(candidate.coordinates as { latitude: number; longitude: number } | undefined);
      return { version: 1, type: 'place', placeId, displayName: displayName.slice(0, 240), ...(typeof candidate.address === 'string' ? { address: candidate.address.slice(0, 512) } : {}), ...(typeof candidate.category === 'string' ? { category: candidate.category.slice(0, 120) } : {}), ...(typeof candidate.approximateRegion === 'string' ? { approximateRegion: candidate.approximateRegion.slice(0, 120) } : {}), ...(candidate.coordinates ? { coordinates: { latitude: candidate.coordinates.latitude as number, longitude: candidate.coordinates.longitude as number } } : {}) };
    }
    case 'route': {
      if (!['WALKING', 'DRIVING', 'CYCLING', 'TRANSIT'].includes(String(candidate.mode))) throw new NearbyExchangeError('MALFORMED', 'Route mode is invalid');
      const points = Array.isArray(candidate.points) ? candidate.points.slice(0, 2_048).map(value => { if (!isObject(value) || !isFiniteCoordinate(value.latitude) || !isFiniteCoordinate(value.longitude)) throw new NearbyExchangeError('MALFORMED', 'Route point is invalid'); assertCoordinate({ latitude: value.latitude, longitude: value.longitude }); return { latitude: value.latitude, longitude: value.longitude }; }) : undefined;
      return { version: 1, type: 'route', mode: candidate.mode as NearbyRouteExchangeObject['mode'], ...(typeof candidate.routeId === 'string' ? { routeId: candidate.routeId.slice(0, 256) } : {}), ...(typeof candidate.label === 'string' ? { label: candidate.label.slice(0, 240) } : {}), ...(isObject(candidate.origin) ? { origin: validateRouteEndpoint(candidate.origin) } : {}), ...(isObject(candidate.destination) ? { destination: validateRouteEndpoint(candidate.destination) } : {}), ...(points ? { points } : {}) };
    }
    case 'publication': return { version: 1, type: 'publication', publicationId: safeId(candidate.publicationId, 'publicationId'), ...(typeof candidate.revisionAddress === 'string' ? { revisionAddress: candidate.revisionAddress.slice(0, 512) } : {}), ...(typeof candidate.title === 'string' ? { title: candidate.title.slice(0, 240) } : {}) };
    case 'contact': {
      const fields = Array.isArray(candidate.selectedFields) ? [...new Set(candidate.selectedFields.filter(value => typeof value === 'string'))] as NearbyContactField[] : [];
      if (!fields.length || fields.some(value => !['displayName', 'identityId', 'avatarUri', 'collaborationEmail', 'phoneNumber', 'publicLinks'].includes(value))) throw new NearbyExchangeError('MALFORMED', 'Contact field selection is invalid');
      if (!isObject(candidate.fields)) throw new NearbyExchangeError('MALFORMED', 'Contact fields are missing');
      const output: Partial<Record<NearbyContactField, string | readonly { readonly label: string; readonly url: string }[]>> = {};
      for (const field of fields) {
        const value = candidate.fields[field];
        if (field === 'publicLinks') { if (!Array.isArray(value) || value.length > 16) throw new NearbyExchangeError('MALFORMED', 'Contact links are invalid'); output.publicLinks = value.map(item => { if (!isObject(item) || typeof item.label !== 'string' || typeof item.url !== 'string') throw new NearbyExchangeError('MALFORMED', 'Contact link is invalid'); const url = safeExternalUrl(item.url); return { label: item.label.slice(0, 80), url: url.toString() }; }); }
        else if (typeof value === 'string' && byteLength(value) <= 512) output[field] = value;
        else throw new NearbyExchangeError('MALFORMED', `Contact field ${field} is invalid`);
      }
      return { version: 1, type: 'contact', selectedFields: fields, fields: output };
    }
    case 'collaboration': {
      if (candidate.mode !== 'COPY' && candidate.mode !== 'GRANT_ACCESS') throw new NearbyExchangeError('MALFORMED', 'Collaboration mode is invalid');
      return { version: 1, type: 'collaboration', invitationId: safeId(candidate.invitationId, 'invitationId'), objectId: safeId(candidate.objectId, 'objectId'), ...(typeof candidate.objectKind === 'string' ? { objectKind: candidate.objectKind.slice(0, 120) } : {}), ...(typeof candidate.spaceId === 'string' ? { spaceId: candidate.spaceId.slice(0, 256) } : {}), ...(candidate.role === 'viewer' || candidate.role === 'commenter' || candidate.role === 'editor' ? { role: candidate.role } : {}), mode: candidate.mode, ...(typeof candidate.label === 'string' ? { label: candidate.label.slice(0, 240) } : {}) };
    }
    case 'document': {
      if (candidate.mode !== 'COPY' && candidate.mode !== 'GRANT_ACCESS') throw new NearbyExchangeError('MALFORMED', 'Document mode is invalid');
      return { version: 1, type: 'document', objectId: safeId(candidate.objectId, 'objectId'), ...(typeof candidate.label === 'string' ? { label: candidate.label.slice(0, 240) } : {}), mode: candidate.mode, ...(typeof candidate.revision === 'string' ? { revision: candidate.revision.slice(0, 256) } : {}) };
    }
    default: throw new NearbyExchangeError('MALFORMED', 'Nearby exchange object type is unsupported');
  }
}

function validateRouteEndpoint(value: Record<string, unknown>): NonNullable<NearbyRouteExchangeObject['origin']> {
  if (value.coordinates !== undefined && (!isObject(value.coordinates) || !isFiniteCoordinate(value.coordinates.latitude) || !isFiniteCoordinate(value.coordinates.longitude))) throw new NearbyExchangeError('MALFORMED', 'Route endpoint coordinates are invalid');
  assertCoordinate(value.coordinates as { latitude: number; longitude: number } | undefined);
  return { ...(typeof value.label === 'string' ? { label: value.label.slice(0, 160) } : {}), ...(typeof value.placeId === 'string' ? { placeId: value.placeId.slice(0, 256) } : {}), ...(value.coordinates ? { coordinates: { latitude: value.coordinates.latitude as number, longitude: value.coordinates.longitude as number } } : {}) };
}

function formatBytes(value: number): string {
  if (value < 1_024) return `${value} B`;
  if (value < 1_024 * 1_024) return `${(value / 1_024).toFixed(1)} KB`;
  if (value < 1_024 * 1_024 * 1_024) return `${(value / 1_024 / 1_024).toFixed(1)} MB`;
  return `${(value / 1_024 / 1_024 / 1_024).toFixed(1)} GB`;
}

function validatePreview(value: unknown): NearbyOfferPreview {
  if (!isObject(value) || value.version !== 1 || typeof value.type !== 'string' || typeof value.title !== 'string' || byteLength(value.title) > 256 || jsonBytes(value) > NEARBY_EXCHANGE_MAX_PREVIEW_BYTES) throw new NearbyExchangeError('MALFORMED', 'Nearby offer preview is invalid');
  if (!['file', 'text', 'url', 'place', 'route', 'publication', 'contact', 'collaboration', 'document'].includes(value.type)) throw new NearbyExchangeError('MALFORMED', 'Nearby offer preview type is invalid');
  if (value.byteLength !== undefined && (!Number.isSafeInteger(value.byteLength) || (value.byteLength as number) < 0 || (value.byteLength as number) > NEARBY_EXCHANGE_MAX_CONTENT_BYTES)) throw new NearbyExchangeError('RESOURCE_LIMIT', 'Nearby preview size is invalid');
  return { version: 1, type: value.type as NearbyExchangeObjectType, title: value.title.slice(0, 160), ...(typeof value.subtitle === 'string' ? { subtitle: value.subtitle.slice(0, 256) } : {}), ...(typeof value.textPreview === 'string' ? { textPreview: value.textPreview.slice(0, 240) } : {}), ...(typeof value.hostname === 'string' ? { hostname: value.hostname.slice(0, 253) } : {}), ...(typeof value.byteLength === 'number' ? { byteLength: value.byteLength } : {}), ...(typeof value.fileCount === 'number' ? { fileCount: Math.min(NEARBY_EXCHANGE_MAX_BATCH_FILES, Math.max(1, Math.floor(value.fileCount))) } : {}) };
}

function validateDisclosure(value: unknown): NearbyIdentityDisclosure {
  if (!isObject(value) || value.version !== 1 || value.kind !== 'IDENTITY_DISCLOSURE' || !Array.isArray(value.disclosedFields)) throw new NearbyExchangeError('MALFORMED', 'Identity disclosure is invalid');
  const disclosedFields = [...new Set(value.disclosedFields.filter(item => typeof item === 'string'))] as NearbyContactField[];
  if (!disclosedFields.length || disclosedFields.some(item => !['displayName', 'identityId', 'avatarUri', 'collaborationEmail', 'phoneNumber', 'publicLinks'].includes(item))) throw new NearbyExchangeError('MALFORMED', 'Identity disclosure fields are invalid');
  if (value.identityId !== undefined && (typeof value.identityId !== 'string' || value.identityId.length < 32 || value.identityId.length > 256)) throw new NearbyExchangeError('MALFORMED', 'Identity disclosure identity is invalid');
  if (value.publicLinks !== undefined && (!Array.isArray(value.publicLinks) || value.publicLinks.length > 16)) throw new NearbyExchangeError('MALFORMED', 'Identity disclosure links are invalid');
  const publicLinks = value.publicLinks?.map(item => { if (!isObject(item) || typeof item.label !== 'string' || typeof item.url !== 'string') throw new NearbyExchangeError('MALFORMED', 'Identity disclosure link is invalid'); return { label: item.label.slice(0, 80), url: safeExternalUrl(item.url).toString() }; });
  return { version: 1, kind: 'IDENTITY_DISCLOSURE', disclosedFields, ...(typeof value.identityId === 'string' ? { identityId: value.identityId as NodeId } : {}), ...(typeof value.displayName === 'string' ? { displayName: value.displayName.slice(0, 120) } : {}), ...(typeof value.avatarUri === 'string' ? { avatarUri: value.avatarUri.slice(0, 2_048) } : {}), ...(typeof value.collaborationEmail === 'string' ? { collaborationEmail: value.collaborationEmail.slice(0, 320) } : {}), ...(typeof value.phoneNumber === 'string' ? { phoneNumber: value.phoneNumber.slice(0, 64) } : {}), ...(publicLinks ? { publicLinks } : {}) };
}

function validateOffer(value: unknown, now: () => number): NearbyOffer {
  if (!isObject(value) || value.version !== 1 || typeof value.offerId !== 'string' || typeof value.endpointId !== 'string' || (value.direction !== 'INCOMING' && value.direction !== 'OUTGOING') || typeof value.objectType !== 'string' || typeof value.preview !== 'object' || typeof value.createdAt !== 'string' || typeof value.expiresAt !== 'string' || typeof value.status !== 'string' || typeof value.verificationCode !== 'string' || typeof value.updatedAt !== 'string') throw new NearbyExchangeError('MALFORMED', 'Nearby offer is malformed');
  safeId(value.offerId, 'offerId'); safeId(value.endpointId, 'endpointId'); validatePreview(value.preview);
  if (!['file', 'text', 'url', 'place', 'route', 'publication', 'contact', 'collaboration', 'document'].includes(value.objectType)) throw new NearbyExchangeError('MALFORMED', 'Nearby offer type is invalid');
  if (isExpired(value.expiresAt, now) || Date.parse(value.expiresAt) - now() > NEARBY_EXCHANGE_MAX_TTL_MS) throw new NearbyExchangeError('EXPIRED', 'Nearby offer is expired');
  if (!['OFFERED', 'ACCEPTED', 'TRANSFERRING', 'PAUSED_WAITING_ROUTE', 'VERIFYING', 'RECEIVED', 'REJECTED', 'CANCELED', 'FAILED', 'EXPIRED'].includes(value.status)) throw new NearbyExchangeError('MALFORMED', 'Nearby offer status is invalid');
  if (!/^\d{3} \d{3}$/.test(value.verificationCode)) throw new NearbyExchangeError('MALFORMED', 'Nearby verification code is invalid');
  return { version: 1, offerId: value.offerId, endpointId: value.endpointId, direction: value.direction, objectType: value.objectType as NearbyExchangeObjectType, preview: validatePreview(value.preview), createdAt: value.createdAt, expiresAt: value.expiresAt, status: value.status as NearbyExchangeTransferStatus, verificationCode: value.verificationCode, updatedAt: value.updatedAt };
}

function validateManifest(value: unknown): ContentManifest {
  const parsed = contentManifestSchema.safeParse(value);
  if (!parsed.success || parsed.data.byteLength > NEARBY_EXCHANGE_MAX_CONTENT_BYTES || parsed.data.chunks.length > 16_384) throw new NearbyExchangeError('MALFORMED', 'Nearby content manifest is invalid or too large');
  return parsed.data as ContentManifest;
}

function emptyPersistedState(): PersistedState { return { version: 1, offers: [], transfers: [], history: [] }; }

export function encodeNearbyReceiveQr(payload: NearbyReceiveQrPayload): string {
  validateQrPayload(payload);
  return `keystone-nearby:${base64(new TextEncoder().encode(JSON.stringify(payload)))}`;
}

export function parseNearbyReceiveQr(value: string, now: () => number = Date.now): NearbyQrParseResult {
  try {
    if (typeof value !== 'string' || !value.startsWith('keystone-nearby:')) return { accepted: false, reason: 'This is not a Nearby Receive QR' };
    const payload = parseBoundedJson<unknown>(fromBase64(value.slice('keystone-nearby:'.length)), { maxDepth: 8, maxCollectionItems: 32, maxStringBytes: 4_096, maxNodes: 128 });
    validateQrPayload(payload);
    if (isExpired(payload.expiresAt, now)) return { accepted: false, reason: 'Nearby Receive QR has expired' };
    return { accepted: true, payload };
  } catch (error) { return { accepted: false, reason: error instanceof Error ? error.message : 'Nearby Receive QR is invalid' }; }
}

function validateQrPayload(value: unknown): asserts value is NearbyReceiveQrPayload {
  if (!isObject(value) || value.protocol !== NEARBY_EXCHANGE_PROTOCOL || value.version !== 1 || value.kind !== 'RECEIVE_QR' || value.scope !== 'ONE_TIME_RECEIVE' || typeof value.token !== 'string' || !/^[A-Za-z0-9:_-]{16,256}$/.test(value.token) || typeof value.endpointHandle !== 'string' || typeof value.endpointPublicKey !== 'string' || typeof value.expiresAt !== 'string') throw new NearbyExchangeError('MALFORMED', 'Nearby Receive QR payload is invalid');
  if (fromBase64(value.endpointHandle).byteLength !== 16 || fromBase64(value.endpointPublicKey).byteLength !== 32) throw new NearbyExchangeError('MALFORMED', 'Nearby Receive QR key material is invalid');
}

export class NearbyExchangeService {
  readonly nearby: AnonymousNearbyTransportProvider;
  readonly delivery?: KeystoneDeliveryInterface;
  private readonly storage: NearbyExchangeStorage;
  private readonly contentCache: ContentCache;
  private readonly content: DistributedContentService;
  private readonly social?: NearbySocialDisclosureAdapter;
  private readonly bulkSource?: NearbyExchangeBulkSourceAdapter;
  private readonly now: () => number;
  private readonly localCapabilities: readonly NearbyExchangeObjectType[];
  private alias?: string;
  private readonly manageNearbyLifecycle: boolean;
  private readonly onIncoming?: NearbyExchangeServiceOptions['onIncoming'];
  private readonly onReceived?: NearbyExchangeServiceOptions['onReceived'];
  private readonly limits: { readonly endpoints: number; readonly sessions: number; readonly pendingOffers: number; readonly history: number; readonly dedup: number; readonly contentBytes: number };
  private readonly sessions = new Map<string, ExchangeSessionState>();
  private readonly sessionsByPeer = new Map<AnonymousNearbyPeerHandle, string>();
  private readonly localOffers = new Map<string, LocalOfferRecord>();
  private readonly incomingOffersMap = new Map<string, IncomingOfferRecord>();
  private readonly transfers = new Map<string, NearbyTransfer>();
  private readonly historyEntries: NearbyTransfer[] = [];
  private readonly pendingChunks = new Map<string, PendingChunk>();
  private readonly chunkRequestCounts = new Map<string, number>();
  private readonly fragments = new Map<string, FragmentState>();
  private readonly seenMessages = new Map<string, number>();
  private readonly qrTokens = new Map<string, { readonly expiresAt: number; used: boolean }>();
  private readonly disclosures = new Map<string, NearbyIdentityDisclosure>();
  private readonly subscriptions = new Set<(event: NearbyExchangeEvent) => void>();
  private readonly unsubscribeNearby: () => void;
  private readyPromise: Promise<void>;
  private sweepTimer?: ReturnType<typeof setInterval>;
  private localIdentity?: EphemeralTransportIdentity;
  private started = false;
  private closed = false;
  private receivePolicy: NearbyReceivePolicy = 'ASK_EVERY_TIME';
  private receivingUntil?: number;

  constructor(options: NearbyExchangeServiceOptions) {
    if (!options?.nearby) throw new NearbyExchangeError('INVALID_ARGUMENT', 'NearbyExchangeService requires the existing R0P68 provider');
    this.nearby = options.nearby;
    this.delivery = options.delivery;
    this.storage = options.storage ?? new InMemoryNearbyExchangeStorage();
    this.now = options.now ?? Date.now;
    this.social = options.social;
    this.bulkSource = options.bulkSource;
    this.alias = safeAlias(options.localAlias);
    this.localCapabilities = [...new Set(options.localCapabilities ?? DEFAULT_CAPABILITIES)].filter(value => DEFAULT_CAPABILITIES.includes(value));
    this.manageNearbyLifecycle = options.manageNearbyLifecycle ?? true;
    this.onIncoming = options.onIncoming;
    this.onReceived = options.onReceived;
    this.limits = {
      endpoints: clampInt(options.maxEndpoints, 1, NEARBY_EXCHANGE_MAX_ENDPOINTS, NEARBY_EXCHANGE_MAX_ENDPOINTS),
      sessions: clampInt(options.maxSessions, 1, NEARBY_EXCHANGE_MAX_SESSIONS, NEARBY_EXCHANGE_MAX_SESSIONS),
      pendingOffers: clampInt(options.maxPendingOffers, 1, NEARBY_EXCHANGE_MAX_PENDING_OFFERS, NEARBY_EXCHANGE_MAX_PENDING_OFFERS),
      history: clampInt(options.maxHistory, 1, NEARBY_EXCHANGE_MAX_HISTORY, NEARBY_EXCHANGE_MAX_HISTORY),
      dedup: clampInt(options.maxDedup, 1, NEARBY_EXCHANGE_MAX_DEDUP, NEARBY_EXCHANGE_MAX_DEDUP),
      contentBytes: clampInt(options.maxContentBytes, 16 * 1024, NEARBY_EXCHANGE_MAX_CONTENT_BYTES, NEARBY_EXCHANGE_MAX_CONTENT_BYTES),
    };
    this.contentCache = options.contentCache ?? new ContentCache(this.limits.contentBytes, this.now);
    this.content = new DistributedContentService({ cache: this.contentCache, transferState: options.transferState, maxActiveTransfers: 2, maxActiveSources: 4, maxInFlightChunks: 4, maxRequestsPerSource: 2, maxRetriesPerChunk: 3, resourceProfile: 'BALANCED', now: this.now });
    this.unsubscribeNearby = this.nearby.receiveOpaqueFrame((frame, session) => { void this.receiveFrame(frame, session).catch(() => undefined); });
    this.readyPromise = this.hydrate();
  }

  async ready(): Promise<void> { await this.readyPromise; }

  async start(): Promise<void> {
    await this.ready();
    if (this.closed) throw new NearbyExchangeError('FAILED', 'NearbyExchangeService is closed');
    if (this.started) return;
    if (this.manageNearbyLifecycle) await this.nearby.start();
    this.started = true;
    this.sweepTimer = setInterval(() => { void this.sweep(); }, 30_000);
    (this.sweepTimer as { unref?: () => void }).unref?.();
    await this.refreshDiscovery();
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = undefined;
    for (const pending of this.pendingChunks.values()) { clearTimeout(pending.timer); pending.reject(new NearbyExchangeError('CANCELED', 'Nearby service stopped')); }
    this.pendingChunks.clear();
    for (const session of [...this.sessions.values()]) await this.closeSession(session).catch(() => undefined);
    this.fragments.clear();
    if (this.manageNearbyLifecycle) await this.nearby.stop();
  }

  close(): Promise<void> {
    this.closed = true;
    this.unsubscribeNearby();
    return this.stop();
  }

  subscribe(listener: (event: NearbyExchangeEvent) => void): () => void { this.subscriptions.add(listener); return () => this.subscriptions.delete(listener); }

  async startReceive(input: { readonly policy?: NearbyReceivePolicy; readonly alias?: string; readonly durationMs?: number } = {}): Promise<void> {
    await this.ready();
    if (input.policy) this.receivePolicy = input.policy;
    if (input.alias !== undefined) this.alias = safeAlias(input.alias);
    const duration = clampInt(input.durationMs, 30_000, 30 * 60_000, 10 * 60_000);
    this.receivingUntil = this.now() + duration;
    this.emit({ type: 'policy', policy: this.receivePolicy, active: true });
    if (!this.started) await this.start();
    await this.refreshDiscovery();
  }

  async stopReceive(): Promise<void> {
    this.receivingUntil = undefined;
    this.qrTokens.clear();
    this.emit({ type: 'policy', policy: this.receivePolicy, active: false });
  }

  receiveMode(): { readonly policy: NearbyReceivePolicy; readonly active: boolean; readonly until?: string } {
    const active = this.isReceiving();
    return { policy: this.receivePolicy, active, ...(active && this.receivingUntil ? { until: new Date(this.receivingUntil).toISOString() } : {}) };
  }

  async setReceivePolicy(policy: NearbyReceivePolicy): Promise<void> {
    if (!['NOT_ACCEPTING', 'CONTACTS_ONLY', 'TEMPORARILY_VISIBLE', 'ASK_EVERY_TIME'].includes(policy)) throw new NearbyExchangeError('INVALID_ARGUMENT', 'Unknown nearby receive policy');
    this.receivePolicy = policy;
    this.emit({ type: 'policy', policy, active: this.isReceiving() });
  }

  async refreshDiscovery(): Promise<readonly NearbyEndpoint[]> {
    await this.ready();
    if (!this.started || this.sessions.size >= this.limits.sessions) return this.endpoints();
    const peers = this.nearby.anonymousNeighborHandles(this.limits.endpoints);
    for (const peer of peers.slice(0, this.limits.endpoints)) {
      if (this.sessionsByPeer.has(peer.handle) || this.sessions.size >= this.limits.sessions) continue;
      try {
        const transportSession = await this.nearby.openAnonymousNeighbor(peer.handle);
        const resolvedPeer = this.nearby.anonymousNeighborPeerHandle(transportSession) ?? peer.handle;
        const state = await this.createSession(transportSession, resolvedPeer);
        await this.sendHello(state);
      } catch {
        // A rotating/expired nearby endpoint is a normal discovery race. The
        // next bounded scan can establish a new session.
      }
    }
    await this.sweep();
    return this.endpoints();
  }

  async listNearby(): Promise<readonly NearbyEndpoint[]> {
    if (!this.started) await this.start();
    return this.refreshDiscovery();
  }

  endpoints(): readonly NearbyEndpoint[] {
    void this.sweep();
    return [...this.sessions.values()].filter(value => value.visible && !value.closed && value.expiresAt > this.now()).slice(0, this.limits.endpoints).map(value => this.endpointView(value));
  }

  endpoint(endpointId: string): NearbyEndpoint | undefined {
    const state = this.sessions.get(endpointId);
    return state && state.visible && !state.closed && state.expiresAt > this.now() ? this.endpointView(state) : undefined;
  }

  async createReceiveQr(ttlMs = 5 * 60_000): Promise<string> {
    if (!this.isReceiving() || this.receivePolicy === 'NOT_ACCEPTING') throw new NearbyExchangeError('POLICY_DENIED', 'Nearby receive mode must be active before showing a QR');
    if (!this.started) await this.start();
    const identity = this.localIdentity ?? (this.localIdentity = await this.nearby.currentIdentity());
    const expiresAt = expiresAtFor(this.now, Math.min(ttlMs, 5 * 60_000));
    const token = randomId('nearby-qr');
    this.qrTokens.set(token, { expiresAt: Date.parse(expiresAt), used: false });
    return encodeNearbyReceiveQr({ protocol: NEARBY_EXCHANGE_PROTOCOL, version: 1, kind: 'RECEIVE_QR', token, endpointHandle: identity.handle, endpointPublicKey: identity.publicKey, expiresAt, scope: 'ONE_TIME_RECEIVE' });
  }

  async bootstrapFromQr(value: string): Promise<NearbyEndpoint | undefined> {
    const parsed = parseNearbyReceiveQr(value, this.now);
    if (!parsed.accepted || !parsed.payload) throw new NearbyExchangeError('MALFORMED', parsed.reason ?? 'Nearby Receive QR is invalid');
    if (!this.started) await this.start();
    const matching = this.nearby.anonymousNeighborHandles(this.limits.endpoints).find(peer => peer.handle === asPeerHandle(parsed.payload!.endpointHandle));
    if (!matching) return undefined;
    let state = this.sessions.get(this.sessionsByPeer.get(matching.handle) ?? '');
    if (!state) {
      const transportSession = await this.nearby.openAnonymousNeighbor(matching.handle);
      const resolvedPeer = this.nearby.anonymousNeighborPeerHandle(transportSession) ?? matching.handle;
      state = await this.createSession(transportSession, resolvedPeer);
    }
    state.bootstrapToken = parsed.payload.token;
    await this.sendHello(state);
    return this.endpoint(state.endpointId);
  }

  async createOffer(input: {
    readonly endpointId: string;
    readonly object: NearbyExchangeObject;
    readonly bytes?: Uint8Array;
    readonly manifest?: ContentManifest;
    readonly ttlMs?: number;
  }): Promise<NearbyOffer> {
    await this.ready();
    const session = this.requireSession(input.endpointId);
    if (!session.visible || session.expiresAt <= this.now()) throw new NearbyExchangeError('UNAVAILABLE', 'Nearby endpoint is no longer visible');
    this.compactBoundedState();
    if (this.pendingOfferCount() >= this.limits.pendingOffers) throw new NearbyExchangeError('RESOURCE_LIMIT', 'Nearby pending offer bound exceeded');
    let object = validateObject(input.object);
    let manifest: ContentManifest | undefined;
    if (object.type === 'file') {
      if (input.bytes) {
        if (input.bytes.byteLength > this.limits.contentBytes) throw new NearbyExchangeError('RESOURCE_LIMIT', 'Nearby file exceeds the local content bound');
        manifest = await createContentManifest(input.bytes, { mimeType: object.mimeType, name: sanitizeFilename(object.name), chunkSize: Math.min(64 * 1024, Math.max(16 * 1024, input.manifest?.chunkSize ?? 64 * 1024)), contentPolicy: 'PRIVATE_NO_STRANGER_CACHE' });
        object = { ...object, contentId: manifest.contentId, byteLength: manifest.byteLength, name: manifest.name ?? object.name, mimeType: manifest.mimeType };
      } else if (input.manifest) {
        manifest = validateManifest(input.manifest);
        if (manifest.contentId !== object.contentId || manifest.byteLength !== object.byteLength) throw new NearbyExchangeError('INTEGRITY', 'File object does not match its content manifest');
      } else throw new NearbyExchangeError('INVALID_ARGUMENT', 'File offers require content bytes or a verified manifest');
      await this.contentCache.putManifest(manifest);
      if (input.bytes) for (let index = 0; index < manifest.chunks.length; index += 1) {
        const start = index * manifest.chunkSize;
        await this.contentCache.putVerifiedChunk(manifest, index, input.bytes.subarray(start, Math.min(input.bytes.byteLength, start + manifest.chunkSize)));
      }
    }
    const createdAt = this.now();
    const offerId = randomId('nearby-offer');
    const transferId = randomId('nearby-transfer');
    const offer: NearbyOffer = { version: 1, offerId, endpointId: session.endpointId, direction: 'OUTGOING', objectType: object.type, preview: objectPreview(object), createdAt: new Date(createdAt).toISOString(), expiresAt: expiresAtFor(this.now, input.ttlMs), status: 'OFFERED', verificationCode: session.verificationCode, updatedAt: new Date(createdAt).toISOString() };
    const record: LocalOfferRecord = { offer, object, ...(manifest ? { manifest } : {}), authorizationGrant: randomId('nearby-grant'), status: 'OFFERED', transferId, updatedAt: createdAt };
    this.localOffers.set(offerId, record);
    this.setTransfer({ version: 1, transferId, offerId, endpointId: session.endpointId, direction: 'OUTGOING', objectType: object.type, status: 'OFFERED', completedBytes: 0, ...(object.type === 'file' ? { totalBytes: object.byteLength } : {}), progress: 0, createdAt: offer.createdAt, expiresAt: offer.expiresAt, updatedAt: offer.updatedAt, object });
    await this.sendWire(session, { ...this.baseWire('OFFER', session, offer.expiresAt), kind: 'OFFER', offer, transferId });
    await this.persist();
    return clone(offer);
  }

  async createBatchOffer(input: { readonly endpointId: string; readonly files: readonly { readonly object: NearbyFileExchangeObject; readonly bytes: Uint8Array }[]; readonly ttlMs?: number }): Promise<readonly NearbyOffer[]> {
    if (!Array.isArray(input.files) || input.files.length < 1 || input.files.length > NEARBY_EXCHANGE_MAX_BATCH_FILES) throw new NearbyExchangeError('RESOURCE_LIMIT', 'Nearby file batch exceeds the bounded file count');
    const offers: NearbyOffer[] = [];
    // Keep the batch bounded at the exchange boundary.  Promise.all would
    // turn a valid 100-file selection into an unbounded burst against the
    // provider's small-MTU queue and would make consent ordering ambiguous.
    for (const file of input.files) offers.push(await this.createOffer({ endpointId: input.endpointId, object: file.object, bytes: file.bytes, ttlMs: input.ttlMs }));
    return offers;
  }

  async incomingOffers(): Promise<readonly NearbyOffer[]> { await this.ready(); await this.sweep(); return [...this.incomingOffersMap.values()].filter(value => !terminal(value.status)).map(value => clone(value.offer)); }
  async outgoingOffers(): Promise<readonly NearbyOffer[]> { await this.ready(); await this.sweep(); return [...this.localOffers.values()].map(value => clone({ ...value.offer, status: value.status, updatedAt: new Date(value.updatedAt).toISOString() })); }
  async transfersList(): Promise<readonly NearbyTransfer[]> { await this.ready(); await this.sweep(); return [...this.transfers.values()].map(clone); }
  async history(): Promise<readonly NearbyTransfer[]> { await this.ready(); return this.historyEntries.map(clone); }

  async acceptOffer(offerId: string): Promise<NearbyTransfer> {
    await this.ready();
    const record = this.incomingOffersMap.get(offerId);
    if (!record) throw new NearbyExchangeError('NOT_FOUND', 'Nearby offer was not found');
    if (isExpired(record.offer.expiresAt, this.now)) { await this.expireIncoming(record); throw new NearbyExchangeError('EXPIRED', 'Nearby offer has expired'); }
    if (!this.canAcceptFrom(this.requireSession(record.offer.endpointId))) throw new NearbyExchangeError('POLICY_DENIED', 'Nearby receive policy requires explicit visibility/consent');
    if (record.status !== 'OFFERED') throw new NearbyExchangeError('POLICY_DENIED', 'Nearby offer is no longer awaiting consent');
    record.status = 'ACCEPTED'; record.updatedAt = this.now();
    this.updateTransfer(record.transferId, { status: 'ACCEPTED' });
    const session = this.requireSession(record.offer.endpointId);
    await this.sendWire(session, { ...this.baseWire('OFFER_RESPONSE', session, record.offer.expiresAt), kind: 'OFFER_RESPONSE', offerId, transferId: record.transferId, accepted: true });
    return this.requireTransfer(record.transferId);
  }

  async rejectOffer(offerId: string, reason = 'Rejected by recipient'): Promise<NearbyTransfer> {
    await this.ready();
    const record = this.incomingOffersMap.get(offerId);
    if (!record) throw new NearbyExchangeError('NOT_FOUND', 'Nearby offer was not found');
    record.status = 'REJECTED'; record.updatedAt = this.now();
    this.updateTransfer(record.transferId, { status: 'REJECTED', lastError: reason });
    const session = this.sessions.get(record.offer.endpointId);
    if (session) await this.sendWire(session, { ...this.baseWire('OFFER_RESPONSE', session, record.offer.expiresAt), kind: 'OFFER_RESPONSE', offerId, transferId: record.transferId, accepted: false, reason }).catch(() => undefined);
    await this.persist();
    return this.requireTransfer(record.transferId);
  }

  async cancelOffer(offerId: string, reason = 'Canceled by user'): Promise<NearbyTransfer> {
    await this.ready();
    const local = this.localOffers.get(offerId); const incoming = this.incomingOffersMap.get(offerId); const record = local ?? incoming;
    if (!record) throw new NearbyExchangeError('NOT_FOUND', 'Nearby offer was not found');
    if (terminal(record.status)) return this.requireTransfer(record.transferId);
    record.status = 'CANCELED'; record.updatedAt = this.now();
    this.updateTransfer(record.transferId, { status: 'CANCELED', lastError: reason });
    const session = this.sessions.get(record.offer.endpointId);
    if (session) await this.sendWire(session, { ...this.baseWire('CANCEL', session, record.offer.expiresAt), kind: 'CANCEL', offerId, transferId: record.transferId, reason }).catch(() => undefined);
    await this.persist();
    return this.requireTransfer(record.transferId);
  }

  async cancelTransfer(transferId: string, reason = 'Canceled by user'): Promise<NearbyTransfer> {
    await this.ready();
    const transfer = this.requireTransfer(transferId);
    return this.cancelOffer(transfer.offerId, reason);
  }

  async resumeTransfer(transferId: string): Promise<NearbyTransfer> {
    await this.ready();
    const transfer = this.requireTransfer(transferId); const record = this.incomingOffersMap.get(transfer.offerId);
    if (!record?.manifest || !record.object || record.object.type !== 'file') throw new NearbyExchangeError('NOT_FOUND', 'No resumable nearby file transfer exists');
    const session = this.sessions.get(record.offer.endpointId);
    if (!session || session.closed || session.expiresAt <= this.now()) { await this.refreshDiscovery(); throw new NearbyExchangeError('UNAVAILABLE', 'Nearby sender is no longer reachable'); }
    await this.receiveFileContent(record, session);
    return this.requireTransfer(transferId);
  }

  async discloseIdentity(endpointId: string, selectedFields: readonly NearbyContactField[]): Promise<NearbyIdentityDisclosure> {
    if (!this.social) throw new NearbyExchangeError('UNAVAILABLE', 'No social disclosure adapter is installed');
    const fields = [...new Set(selectedFields)] as NearbyContactField[];
    if (!fields.length || fields.some(value => !['displayName', 'identityId', 'avatarUri', 'collaborationEmail', 'phoneNumber', 'publicLinks'].includes(value))) throw new NearbyExchangeError('INVALID_ARGUMENT', 'Identity disclosure selection is invalid');
    const session = this.requireSession(endpointId);
    const disclosure = validateDisclosure(await this.social.disclose({ selectedFields: fields, endpointId }));
    if (disclosure.disclosedFields.some(value => !fields.includes(value))) throw new NearbyExchangeError('POLICY_DENIED', 'Social adapter returned fields outside the explicit selection');
    session.socialState = 'IDENTITY_DISCLOSED';
    this.disclosures.set(endpointId, clone(disclosure));
    await this.sendWire(session, { ...this.baseWire('IDENTITY_DISCLOSURE', session), kind: 'IDENTITY_DISCLOSURE', endpointId, disclosure });
    this.emit({ type: 'identity', endpointId, disclosure: clone(disclosure) });
    return clone(disclosure);
  }

  async addContact(endpointId: string): Promise<{ readonly contactId?: string }> {
    if (!this.social?.addContact) throw new NearbyExchangeError('UNAVAILABLE', 'No canonical Contact adapter is installed');
    const session = this.requireSession(endpointId);
    if (session.socialState !== 'IDENTITY_DISCLOSED' && session.socialState !== 'KNOWN_CONTACT') throw new NearbyExchangeError('POLICY_DENIED', 'Identity must be explicitly disclosed before adding a Contact');
    const disclosure = this.latestDisclosure(endpointId);
    if (!disclosure) throw new NearbyExchangeError('POLICY_DENIED', 'No explicit identity disclosure is available');
    const result = await this.social.addContact({ endpointId, disclosure });
    session.socialState = 'KNOWN_CONTACT';
    this.emit({ type: 'endpoint', endpoint: this.endpointView(session) });
    return result;
  }

  async readReceivedContent(contentId: ContentId): Promise<Uint8Array | undefined> { await this.ready(); return this.contentCache.read(contentId); }

  diagnostics(): NearbyExchangeDiagnostics {
    void this.sweep();
    return { running: this.started, receivePolicy: this.receivePolicy, ...(this.isReceiving() && this.receivingUntil ? { receivingUntil: new Date(this.receivingUntil).toISOString() } : {}), endpointCount: this.endpoints().length, sessionCount: this.sessions.size, pendingOffers: this.pendingOfferCount(), activeTransfers: [...this.transfers.values()].filter(value => !terminal(value.status)).length, historyCount: this.historyEntries.length, dedupCount: this.seenMessages.size, fragmentCount: this.fragments.size, nearbyEvidence: this.nearby.diagnostics().evidence, nearbyProviderId: String(this.nearby.id), fabricAvailable: !!this.delivery };
  }

  private async createSession(transportSession: TransportSession, peerHandle: AnonymousNearbyPeerHandle): Promise<ExchangeSessionState> {
    if (this.sessions.size >= this.limits.sessions) { await this.nearby.close(transportSession); throw new NearbyExchangeError('RESOURCE_LIMIT', 'Nearby session bound exceeded'); }
    const existing = this.sessions.get(transportSession.id);
    if (existing) return existing;
    const local = this.localIdentity ?? (this.localIdentity = await this.nearby.currentIdentity());
    const createdAt = this.now(); const expiresAt = Math.min(Date.parse(transportSession.endpoint.expiresAt ?? ''), createdAt + NEARBY_EXCHANGE_MAX_TTL_MS);
    const state: ExchangeSessionState = { sessionId: transportSession.id, endpointId: randomId('nearby-endpoint'), peerHandle, transportSession, createdAt, expiresAt: Number.isFinite(expiresAt) ? expiresAt : createdAt + NEARBY_EXCHANGE_MAX_TTL_MS, alias: DEFAULT_ALIAS, capabilities: [], verificationCode: await verificationCode(transportSession.id, local.handle, peerHandle), socialState: 'ANONYMOUS', visible: false, helloReceived: false, helloSent: false, closed: false };
    this.sessions.set(state.endpointId, state); this.sessionsByPeer.set(peerHandle, state.endpointId);
    return state;
  }

  private async sendHello(state: ExchangeSessionState): Promise<void> {
    if (state.closed) return;
    const wire: ExchangeHelloWire = { ...this.baseWire('HELLO', state), kind: 'HELLO', ...(this.canAdvertiseToPeer() ? { alias: this.alias } : {}), capabilities: this.localCapabilities, ...(state.bootstrapToken ? { bootstrapToken: state.bootstrapToken } : {}) };
    await this.sendWire(state, wire); state.helloSent = true;
  }

  private baseWire(kind: ExchangeWireKind, state: ExchangeSessionState, expiresAt?: string): ExchangeWireBase {
    return { protocol: NEARBY_EXCHANGE_PROTOCOL, version: 1, kind, sessionId: state.sessionId, messageId: crypto.randomUUID(), expiresAt: expiresAt ?? expiresAtFor(this.now, Math.min(5 * 60_000, Math.max(30_000, state.expiresAt - this.now()))) };
  }

  private async sendWire(state: ExchangeSessionState, wire: ExchangeWire): Promise<void> {
    if (state.closed || state.expiresAt <= this.now()) throw new NearbyExchangeError('UNAVAILABLE', 'Nearby session is expired');
    if (jsonBytes(wire) > NEARBY_EXCHANGE_MAX_WIRE_BYTES) throw new NearbyExchangeError('RESOURCE_LIMIT', 'Nearby control message exceeds the bounded wire size');
    const raw = new TextEncoder().encode(JSON.stringify(wire));
    const mtu = typeof this.nearby.mtu === 'number' ? this.nearby.mtu : 4 * 1024;
    // `AnonymousNearbyTransportProvider.mtu` applies to the encoded opaque
    // envelope, not just to the exchange JSON.  The envelope carries a
    // base64url copy of the fragment plus its integrity/replay metadata, so a
    // 1 KiB radio frame needs a deliberately small payload.  Keep the lower
    // bound high enough to avoid pathological fragment counts while leaving
    // room for that outer envelope.
    const partBytes = Math.max(48, Math.min(768, Math.floor((mtu - 768) / 3)));
    if (raw.byteLength <= partBytes) { await this.sendRawWire(state, wire); return; }
    const count = Math.ceil(raw.byteLength / partBytes);
    if (count > 4_096) throw new NearbyExchangeError('RESOURCE_LIMIT', 'Nearby fragmented message exceeds the fragment bound');
    const fragmentId = randomId('nearby-fragment');
    for (let index = 0; index < count; index += 1) {
      const fragment: ExchangeFragmentWire = { protocol: NEARBY_EXCHANGE_PROTOCOL, version: 1, kind: 'FRAGMENT', sessionId: state.sessionId, messageId: wire.messageId, expiresAt: wire.expiresAt, fragmentId, index, count, payload: base64(raw.subarray(index * partBytes, Math.min(raw.byteLength, (index + 1) * partBytes))) };
      await this.sendRawWire(state, fragment);
    }
  }

  private async sendRawWire(state: ExchangeSessionState, wire: ExchangeWire): Promise<void> {
    const envelope: OpaqueDeliveryEnvelope = await createOpaqueDeliveryEnvelope({ id: `nearby-control-${wire.kind.toLowerCase()}-${wire.messageId}`, destination: CONTROL_DESTINATION, ciphertext: encodeOpaqueBytes(new TextEncoder().encode(JSON.stringify(wire))), replayNonce: randomId('nearby-replay'), expiresAt: wire.expiresAt, requirement: { profile: 'CONTROL', requireDirect: true, maxAttempts: 2 } });
    await this.nearby.sendOpaqueFrame(state.transportSession, envelope);
  }

  private async receiveFrame(frame: OpaqueFrame, transportSession?: TransportSession): Promise<void> {
    if (!transportSession || 'kind' in frame) return;
    const envelope = frame as OpaqueDeliveryEnvelope;
    if (envelope.destination !== CONTROL_DESTINATION) return;
    let wire: ExchangeWire;
    try { wire = validateWire(parseBoundedJson<unknown>(decodeOpaqueBytes(envelope.ciphertext), { maxDepth: 24, maxCollectionItems: 4_096, maxStringBytes: NEARBY_EXCHANGE_MAX_WIRE_BYTES, maxNodes: 65_536 }), this.now); }
    catch { return; }
    const peerHandle = this.nearby.anonymousNeighborPeerHandle(transportSession);
    if (!peerHandle) return;
    let state = this.sessions.get(this.sessionsByPeer.get(peerHandle) ?? '');
    if (!state) { try { state = await this.createSession(transportSession, peerHandle); } catch { return; } }
    if (wire.sessionId !== state.sessionId) return;
    if (wire.kind === 'FRAGMENT') { await this.receiveFragment(state, wire); return; }
    if (this.seenMessages.has(`${state.sessionId}:${wire.messageId}`)) return;
    this.rememberSeen(`${state.sessionId}:${wire.messageId}`, Date.parse(wire.expiresAt));
    await this.handleWire(state, wire);
  }

  private async receiveFragment(state: ExchangeSessionState, wire: ExchangeFragmentWire): Promise<void> {
    const key = `${state.sessionId}:${wire.fragmentId}`;
    let value = this.fragments.get(key);
    if (!value) {
      if (this.fragments.size >= this.limits.dedup || wire.count > 4_096) return;
      value = { sessionId: state.sessionId, fragmentId: wire.fragmentId, count: wire.count, expiresAt: Date.parse(wire.expiresAt), parts: new Map(), totalBytes: 0 };
      this.fragments.set(key, value);
    }
    if (value.count !== wire.count || wire.index < 0 || wire.index >= wire.count || value.parts.has(wire.index)) return;
    let bytes: Uint8Array;
    try { bytes = fromBase64(wire.payload); } catch { this.fragments.delete(key); return; }
    if (value.totalBytes + bytes.byteLength > NEARBY_EXCHANGE_MAX_WIRE_BYTES) { this.fragments.delete(key); return; }
    value.parts.set(wire.index, bytes); value.totalBytes += bytes.byteLength;
    if (value.parts.size !== value.count) return;
    const raw = new Uint8Array(value.totalBytes); let offset = 0;
    for (let index = 0; index < value.count; index += 1) { const part = value.parts.get(index); if (!part) { this.fragments.delete(key); return; } raw.set(part, offset); offset += part.byteLength; }
    this.fragments.delete(key);
    try {
      const inner = validateWire(parseBoundedJson<unknown>(raw, { maxDepth: 24, maxCollectionItems: 4_096, maxStringBytes: NEARBY_EXCHANGE_MAX_WIRE_BYTES, maxNodes: 65_536 }), this.now);
      if (inner.kind === 'FRAGMENT' || inner.sessionId !== state.sessionId || this.seenMessages.has(`${state.sessionId}:${inner.messageId}`)) return;
      this.rememberSeen(`${state.sessionId}:${inner.messageId}`, Date.parse(inner.expiresAt));
      await this.handleWire(state, inner);
    } catch { /* malformed fragments are discarded without a session upgrade */ }
  }

  private async handleWire(state: ExchangeSessionState, wire: Exclude<ExchangeWire, ExchangeFragmentWire>): Promise<void> {
    switch (wire.kind) {
      case 'HELLO': return this.handleHello(state, wire);
      case 'HELLO_ACK': return this.handleHelloAck(state, wire);
      case 'OFFER': return this.handleOffer(state, wire);
      case 'OFFER_RESPONSE': return this.handleOfferResponse(state, wire);
      case 'OBJECT_DETAILS': return this.handleObjectDetails(state, wire);
      case 'CHUNK_REQUEST': return this.handleChunkRequest(state, wire);
      case 'CHUNK_RESPONSE': return this.handleChunkResponse(wire);
      case 'RECEIPT': return this.handleReceipt(state, wire);
      case 'CANCEL': return this.handleCancel(state, wire);
      case 'IDENTITY_DISCLOSURE': return this.handleIdentityDisclosure(state, wire);
      case 'IDENTITY_ACK': return;
    }
  }

  private async handleHello(state: ExchangeSessionState, wire: ExchangeHelloWire): Promise<void> {
    const token = wire.bootstrapToken ? this.qrTokens.get(wire.bootstrapToken) : undefined;
    const qrAccepted = !!token && !token.used && token.expiresAt > this.now();
    if (token && qrAccepted) { token.used = true; this.qrTokens.delete(wire.bootstrapToken!); }
    state.helloReceived = true;
    state.alias = safeAlias(wire.alias) ?? DEFAULT_ALIAS;
    state.capabilities = sanitizeCapabilities(wire.capabilities);
    state.visible = qrAccepted || this.canAdvertiseToPeer();
    const response: ExchangeHelloAckWire = { ...this.baseWire('HELLO_ACK', state), kind: 'HELLO_ACK', visible: state.visible, ...(state.visible ? { alias: this.alias } : {}), capabilities: state.visible ? this.localCapabilities : [], verificationCode: state.verificationCode, socialState: 'ANONYMOUS' };
    await this.sendWire(state, response).catch(() => undefined);
    if (state.visible) this.emit({ type: 'endpoint', endpoint: this.endpointView(state) });
  }

  private async handleHelloAck(state: ExchangeSessionState, wire: ExchangeHelloAckWire): Promise<void> {
    state.visible = wire.visible;
    state.alias = safeAlias(wire.alias) ?? DEFAULT_ALIAS;
    state.capabilities = sanitizeCapabilities(wire.capabilities);
    if (/^\d{3} \d{3}$/.test(wire.verificationCode)) state.verificationCode = wire.verificationCode;
    if (!state.visible) return;
    this.emit({ type: 'endpoint', endpoint: this.endpointView(state) });
  }

  private async handleOffer(state: ExchangeSessionState, wire: ExchangeOfferWire): Promise<void> {
    let offer: NearbyOffer;
    try { offer = validateOffer(wire.offer, this.now); } catch { return; }
    if (offer.direction !== 'OUTGOING' || offer.expiresAt !== wire.expiresAt || offer.objectType !== offer.preview.type) return;
    this.compactBoundedState();
    const existingForSession = [...this.incomingOffersMap.values()].filter(value => value.offer.endpointId === state.endpointId && !terminal(value.status)).length;
    if (existingForSession >= NEARBY_EXCHANGE_MAX_OFFERS_PER_SESSION || this.pendingOfferCount() >= this.limits.pendingOffers || !this.canAcceptFrom(state)) {
      await this.sendWire(state, { ...this.baseWire('OFFER_RESPONSE', state, offer.expiresAt), kind: 'OFFER_RESPONSE', offerId: offer.offerId, transferId: randomId('nearby-rejected-transfer'), accepted: false, reason: 'Nearby receiving is not accepting this offer' }).catch(() => undefined);
      return;
    }
    const localOffer: NearbyOffer = { ...offer, endpointId: state.endpointId, direction: 'INCOMING', status: 'OFFERED', updatedAt: nowIso(this.now) };
    if (typeof wire.transferId !== 'string' || wire.transferId.length > 160) return;
    const record: IncomingOfferRecord = { offer: localOffer, objectType: offer.objectType, status: 'OFFERED', transferId: wire.transferId, updatedAt: this.now() };
    this.incomingOffersMap.set(localOffer.offerId, record);
    this.setTransfer({ version: 1, transferId: record.transferId, offerId: localOffer.offerId, endpointId: state.endpointId, direction: 'INCOMING', objectType: localOffer.objectType, status: 'OFFERED', completedBytes: 0, ...(localOffer.preview.byteLength !== undefined ? { totalBytes: localOffer.preview.byteLength } : {}), progress: 0, createdAt: localOffer.createdAt, expiresAt: localOffer.expiresAt, updatedAt: localOffer.updatedAt });
    this.emit({ type: 'offer', offer: clone(localOffer) });
    await this.onIncoming?.(clone(localOffer));
    await this.persist();
  }

  private async handleOfferResponse(state: ExchangeSessionState, wire: ExchangeOfferResponseWire): Promise<void> {
    const record = this.localOffers.get(wire.offerId); if (!record || record.transferId !== wire.transferId || terminal(record.status)) return;
    if (!wire.accepted) { record.status = 'REJECTED'; record.updatedAt = this.now(); record.receipt = { version: 1, transferId: record.transferId, offerId: record.offer.offerId, status: 'REJECTED', reason: wire.reason }; this.updateTransfer(record.transferId, { status: 'REJECTED', receipt: record.receipt, lastError: wire.reason }); await this.persist(); return; }
    record.status = 'ACCEPTED'; record.updatedAt = this.now(); this.updateTransfer(record.transferId, { status: 'ACCEPTED' });
    const objectDetails: ExchangeObjectDetailsWire = { ...this.baseWire('OBJECT_DETAILS', state, record.offer.expiresAt), kind: 'OBJECT_DETAILS', offerId: record.offer.offerId, transferId: record.transferId, object: record.object, ...(record.manifest ? { manifest: record.manifest, authorizationGrant: record.authorizationGrant } : {}) };
    await this.sendWire(state, objectDetails);
  }

  private async handleObjectDetails(state: ExchangeSessionState, wire: ExchangeObjectDetailsWire): Promise<void> {
    const record = this.incomingOffersMap.get(wire.offerId); if (!record || record.transferId !== wire.transferId || record.status !== 'ACCEPTED') return;
    let object: NearbyExchangeObject;
    try { object = validateObject(wire.object); } catch { await this.failIncoming(record, state, 'Malformed nearby object'); return; }
    if (object.type !== record.objectType) { await this.failIncoming(record, state, 'Nearby object type does not match offer'); return; }
    record.object = object;
    if (object.type !== 'file') {
      record.status = 'VERIFYING'; record.updatedAt = this.now(); this.updateTransfer(record.transferId, { status: 'VERIFYING', object });
      await this.completeIncoming(record, state);
      return;
    }
    let manifest: ContentManifest;
    try { manifest = validateManifest(wire.manifest); if (manifest.contentId !== object.contentId || manifest.byteLength !== object.byteLength) throw new NearbyExchangeError('INTEGRITY', 'Nearby file manifest does not match the offer'); if (!wire.authorizationGrant || wire.authorizationGrant.length > 256) throw new NearbyExchangeError('MALFORMED', 'Nearby file authorization is missing'); }
    catch (error) { await this.failIncoming(record, state, error instanceof Error ? error.message : 'Invalid nearby file manifest'); return; }
    record.manifest = manifest; record.authorizationGrant = wire.authorizationGrant!; record.status = 'ACCEPTED'; record.updatedAt = this.now(); this.updateTransfer(record.transferId, { status: 'ACCEPTED', object, totalBytes: manifest.byteLength });
    await this.receiveFileContent(record, state);
  }

  private async receiveFileContent(record: IncomingOfferRecord, state: ExchangeSessionState): Promise<void> {
    if (!record.manifest || !record.object || record.object.type !== 'file' || !record.authorizationGrant) throw new NearbyExchangeError('MALFORMED', 'Nearby file transfer state is incomplete');
    record.status = 'TRANSFERRING'; record.updatedAt = this.now(); this.updateTransfer(record.transferId, { status: 'TRANSFERRING', object: record.object, totalBytes: record.manifest.byteLength });
    const nearbySource: DistributedContentSource = { id: `nearby-session:${state.sessionId}:${record.transferId}`, scope: 'AUTHORIZED_GROUP', getChunk: (contentId, index, signal) => this.requestChunk(state, record, contentId, index, record.authorizationGrant!, signal) };
    const sources: DistributedContentSource[] = [];
    if (this.bulkSource) { const faster = await this.bulkSource.sourceFor({ transferId: record.transferId, offerId: record.offer.offerId, manifest: record.manifest, authorizationGrant: record.authorizationGrant, endpointId: state.endpointId }).catch(() => undefined); if (faster) sources.push(faster); }
    sources.push(nearbySource);
    const authorization = { scope: 'AUTHORIZED_GROUP' as const, grant: record.authorizationGrant, subjectId: `nearby:${record.transferId}` };
    try {
      const session: ContentTransferSession = await this.content.downloadTo({ manifest: record.manifest, sources, authorization, priority: 'BULK', onProgress: progress => { this.updateTransfer(record.transferId, { status: 'TRANSFERRING', completedBytes: progress.completedBytes, totalBytes: progress.totalBytes, progress: boundedProgress(progress.completedBytes, progress.totalBytes) }); } }, async () => undefined);
      if (session.state.state !== 'COMPLETE') throw new NearbyExchangeError('UNAVAILABLE', 'Nearby content transfer is waiting for a route');
      this.updateTransfer(record.transferId, { status: 'VERIFYING', completedBytes: record.manifest.byteLength, totalBytes: record.manifest.byteLength, progress: 1 });
      // ContentCache has already verified every chunk. read() performs the
      // final content-address check without exposing the bytes to the wire.
      const verified = await this.contentCache.read(record.manifest.contentId);
      if (!verified) throw new NearbyExchangeError('INTEGRITY', 'Nearby content did not complete verification');
      await this.completeIncoming(record, state, record.manifest.contentId);
    } catch (error) {
      if (String(record.status) === 'CANCELED' || String(record.status) === 'REJECTED') return;
      const message = error instanceof Error ? error.message : 'Nearby content transfer failed';
      const waiting = error instanceof NearbyExchangeError && ['UNAVAILABLE', 'FAILED'].includes(error.code) || /route|available|timeout|session/i.test(message);
      record.status = waiting ? 'PAUSED_WAITING_ROUTE' : 'FAILED'; record.updatedAt = this.now(); this.updateTransfer(record.transferId, { status: record.status, lastError: message }); await this.persist();
    }
  }

  private async requestChunk(state: ExchangeSessionState, record: IncomingOfferRecord, contentId: ContentId, index: number, authorizationGrant: string, signal?: AbortSignal): Promise<Uint8Array> {
    if (signal?.aborted) throw new NearbyExchangeError('CANCELED', 'Nearby content request was canceled');
    if (!record.manifest || contentId !== record.manifest.contentId || !Number.isSafeInteger(index) || index < 0 || index >= record.manifest.chunks.length) throw new NearbyExchangeError('MALFORMED', 'Nearby chunk request is invalid');
    const countKey = record.transferId; const count = (this.chunkRequestCounts.get(countKey) ?? 0) + 1; if (count > record.manifest.chunks.length * 8) throw new NearbyExchangeError('RESOURCE_LIMIT', 'Nearby chunk request retry bound exceeded'); this.chunkRequestCounts.set(countKey, count);
    const requestId = crypto.randomUUID();
    const promise = new Promise<Uint8Array>((resolve, reject) => {
      const timer = setTimeout(() => { this.pendingChunks.delete(requestId); reject(new NearbyExchangeError('UNAVAILABLE', 'Nearby chunk request timed out')); }, CHUNK_REQUEST_TIMEOUT_MS);
      (timer as { unref?: () => void }).unref?.(); this.pendingChunks.set(requestId, { transferId: record.transferId, contentId, resolve, reject, timer });
    });
    try {
      await this.sendWire(state, { ...this.baseWire('CHUNK_REQUEST', state, record.offer.expiresAt), kind: 'CHUNK_REQUEST', requestId, offerId: record.offer.offerId, transferId: record.transferId, contentId, index, authorizationGrant });
      return await promise;
    } finally { const pending = this.pendingChunks.get(requestId); if (pending) { clearTimeout(pending.timer); this.pendingChunks.delete(requestId); } }
  }

  private async handleChunkRequest(state: ExchangeSessionState, wire: ExchangeChunkRequestWire): Promise<void> {
    const record = this.localOffers.get(wire.offerId); if (!record || record.transferId !== wire.transferId || !['ACCEPTED', 'TRANSFERRING'].includes(record.status) || record.object.type !== 'file' || !record.manifest || record.authorizationGrant !== wire.authorizationGrant || record.object.contentId !== wire.contentId) return;
    if (!Number.isSafeInteger(wire.index) || wire.index < 0 || wire.index >= record.manifest.chunks.length) return;
    const bytes = this.contentCache.chunk(wire.contentId, wire.index); if (!bytes || bytes.byteLength > 256 * 1024) return;
    const response: ExchangeChunkResponseWire = { ...this.baseWire('CHUNK_RESPONSE', state, record.offer.expiresAt), kind: 'CHUNK_RESPONSE', transferId: record.transferId, requestId: wire.requestId, contentId: wire.contentId, index: wire.index, bytes: base64(bytes) };
    record.status = 'TRANSFERRING'; record.updatedAt = this.now(); this.updateTransfer(record.transferId, { status: 'TRANSFERRING', completedBytes: Math.min(record.object.byteLength, this.transferCompletedBytes(record.transferId) + bytes.byteLength), totalBytes: record.object.byteLength });
    await this.sendWire(state, response).catch(() => undefined);
  }

  private async handleChunkResponse(wire: ExchangeChunkResponseWire): Promise<void> {
    const pending = this.pendingChunks.get(wire.requestId); if (!pending || pending.transferId !== wire.transferId || pending.contentId !== wire.contentId) return;
    try { const bytes = fromBase64(wire.bytes); if (bytes.byteLength > 256 * 1024) throw new NearbyExchangeError('RESOURCE_LIMIT', 'Nearby chunk response is too large'); pending.resolve(bytes); }
    catch (error) { pending.reject(error instanceof Error ? error : new NearbyExchangeError('MALFORMED', 'Nearby chunk response is invalid')); }
    clearTimeout(pending.timer); this.pendingChunks.delete(wire.requestId);
  }

  private async handleReceipt(_state: ExchangeSessionState, wire: ExchangeReceiptWire): Promise<void> {
    const receipt = validateReceipt(wire.receipt, this.now); const record = this.localOffers.get(receipt.offerId); if (!record || record.transferId !== receipt.transferId) return;
    record.receipt = receipt; record.status = receipt.status === 'RECEIVED' ? 'RECEIVED' : receipt.status === 'ACCEPTED' ? 'ACCEPTED' : receipt.status === 'REJECTED' ? 'REJECTED' : receipt.status === 'CANCELED' ? 'CANCELED' : 'FAILED'; record.updatedAt = this.now(); this.updateTransfer(record.transferId, { status: record.status, receipt, ...(record.status === 'RECEIVED' ? { completedBytes: record.object.type === 'file' ? record.object.byteLength : 0, progress: 1 } : {}), ...(receipt.reason ? { lastError: receipt.reason } : {}) }); await this.persist();
  }

  private async handleCancel(state: ExchangeSessionState, wire: ExchangeCancelWire): Promise<void> {
    const local = this.localOffers.get(wire.offerId); const incoming = this.incomingOffersMap.get(wire.offerId); const record = local ?? incoming; if (!record || record.transferId !== wire.transferId || terminal(record.status)) return;
    record.status = 'CANCELED'; record.updatedAt = this.now(); this.updateTransfer(record.transferId, { status: 'CANCELED', lastError: wire.reason });
    for (const [requestId, pending] of this.pendingChunks) if (pending.transferId === record.transferId) { clearTimeout(pending.timer); pending.reject(new NearbyExchangeError('CANCELED', 'Sender canceled the nearby transfer')); this.pendingChunks.delete(requestId); }
    const receipt: NearbyExchangeReceipt = { version: 1, transferId: record.transferId, offerId: record.offer.offerId, status: 'CANCELED', reason: wire.reason };
    await this.sendWire(state, { ...this.baseWire('RECEIPT', state, record.offer.expiresAt), kind: 'RECEIPT', receipt }).catch(() => undefined);
    await this.persist();
  }

  private async handleIdentityDisclosure(state: ExchangeSessionState, wire: ExchangeIdentityWire): Promise<void> {
    const disclosure = validateDisclosure(wire.disclosure); state.socialState = 'IDENTITY_DISCLOSED'; this.disclosures.set(state.endpointId, clone(disclosure)); this.emit({ type: 'identity', endpointId: state.endpointId, disclosure: clone(disclosure) });
    await this.sendWire(state, { ...this.baseWire('IDENTITY_ACK', state), kind: 'IDENTITY_ACK', endpointId: state.endpointId, accepted: true }).catch(() => undefined);
  }

  private async completeIncoming(record: IncomingOfferRecord, state: ExchangeSessionState, contentId?: ContentId): Promise<void> {
    if (!record.object) return;
    record.status = 'RECEIVED'; record.updatedAt = this.now(); const receipt: NearbyExchangeReceipt = { version: 1, transferId: record.transferId, offerId: record.offer.offerId, status: 'RECEIVED', ...(contentId ? { contentId, verifiedAt: nowIso(this.now) } : {}) }; record.receipt = receipt;
    this.updateTransfer(record.transferId, { status: 'RECEIVED', object: record.object, ...(contentId ? { completedBytes: record.object.type === 'file' ? record.object.byteLength : 0, totalBytes: record.object.type === 'file' ? record.object.byteLength : undefined, progress: 1 } : { progress: 1 }), receipt });
    const transfer = this.requireTransfer(record.transferId); await this.onReceived?.({ transfer, object: clone(record.object), ...(contentId ? { contentId } : {}) });
    await this.sendWire(state, { ...this.baseWire('RECEIPT', state, record.offer.expiresAt), kind: 'RECEIPT', receipt }).catch(() => undefined);
    this.pushHistory(transfer); await this.persist();
  }

  private async failIncoming(record: IncomingOfferRecord, state: ExchangeSessionState, message: string): Promise<void> {
    record.status = 'FAILED'; record.updatedAt = this.now(); this.updateTransfer(record.transferId, { status: 'FAILED', lastError: message });
    const receipt: NearbyExchangeReceipt = { version: 1, transferId: record.transferId, offerId: record.offer.offerId, status: 'FAILED', reason: message }; record.receipt = receipt;
    await this.sendWire(state, { ...this.baseWire('RECEIPT', state, record.offer.expiresAt), kind: 'RECEIPT', receipt }).catch(() => undefined); await this.persist();
  }

  private async expireIncoming(record: IncomingOfferRecord): Promise<void> { record.status = 'EXPIRED'; record.updatedAt = this.now(); this.updateTransfer(record.transferId, { status: 'EXPIRED' }); await this.persist(); }

  private canAcceptFrom(state: ExchangeSessionState): boolean {
    if (!this.isReceiving()) return false;
    if (this.receivePolicy === 'NOT_ACCEPTING' || this.receivePolicy === 'CONTACTS_ONLY') return state.socialState === 'KNOWN_CONTACT';
    return state.visible;
  }

  private canAdvertiseToPeer(): boolean { return this.isReceiving() && this.receivePolicy !== 'NOT_ACCEPTING' && this.receivePolicy !== 'CONTACTS_ONLY'; }
  private isReceiving(): boolean { return this.receivingUntil !== undefined && this.receivingUntil > this.now(); }

  private endpointView(state: ExchangeSessionState): NearbyEndpoint {
    return { endpointId: state.endpointId, alias: state.alias || DEFAULT_ALIAS, capabilities: [...state.capabilities], verificationCode: state.verificationCode, expiresAt: new Date(state.expiresAt).toISOString(), discoveredAt: new Date(state.createdAt).toISOString(), socialState: state.socialState, visible: state.visible };
  }

  private requireSession(endpointId: string): ExchangeSessionState { const state = this.sessions.get(endpointId); if (!state || state.closed || state.expiresAt <= this.now()) throw new NearbyExchangeError('UNAVAILABLE', 'Nearby endpoint/session is unavailable'); return state; }
  private requireTransfer(transferId: string): NearbyTransfer { const transfer = this.transfers.get(transferId); if (!transfer) throw new NearbyExchangeError('NOT_FOUND', 'Nearby transfer was not found'); return clone(transfer); }
  private transferCompletedBytes(transferId: string): number { return this.transfers.get(transferId)?.completedBytes ?? 0; }

  private setTransfer(value: NearbyTransfer): void {
    this.transfers.set(value.transferId, clone(value)); this.emit({ type: 'transfer', transfer: clone(value) });
  }

  private updateTransfer(transferId: string, patch: Partial<NearbyTransfer>): void {
    const current = this.transfers.get(transferId); if (!current) return;
    const next = { ...current, ...patch, updatedAt: nowIso(this.now), ...(patch.completedBytes !== undefined || patch.totalBytes !== undefined ? { progress: patch.progress ?? boundedProgress(patch.completedBytes ?? current.completedBytes, patch.totalBytes ?? current.totalBytes) } : {}) } as NearbyTransfer;
    this.transfers.set(transferId, clone(next)); this.emit({ type: 'transfer', transfer: clone(next) });
    if (terminal(next.status)) this.pushHistory(next);
  }

  private pushHistory(value: NearbyTransfer): void {
    const index = this.historyEntries.findIndex(item => item.transferId === value.transferId);
    if (index >= 0) this.historyEntries.splice(index, 1);
    this.historyEntries.push(clone(value)); while (this.historyEntries.length > this.limits.history) this.historyEntries.shift();
  }

  private pendingOfferCount(): number {
    let count = 0;
    for (const record of this.localOffers.values()) if (!terminal(record.status)) count += 1;
    for (const record of this.incomingOffersMap.values()) if (!terminal(record.status)) count += 1;
    return count;
  }

  /** Keep terminal projections bounded without dropping an active consent or
   * transfer state.  A completed transfer remains available through the
   * bounded history projection, while the offer maps are only live queues. */
  private compactBoundedState(): void {
    const pruneOffers = (records: Map<string, LocalOfferRecord | IncomingOfferRecord>): void => {
      for (const [id, record] of records) {
        if (records.size <= this.limits.pendingOffers) break;
        if (terminal(record.status)) records.delete(id);
      }
    };
    pruneOffers(this.localOffers);
    pruneOffers(this.incomingOffersMap);
    const keepHistory = new Set(this.historyEntries.map(value => value.transferId));
    const terminalTransfers = [...this.transfers.entries()]
      .filter(([, value]) => terminal(value.status) && !keepHistory.has(value.transferId))
      .sort(([, left], [, right]) => Date.parse(left.updatedAt) - Date.parse(right.updatedAt));
    const activeCount = [...this.transfers.values()].filter(value => !terminal(value.status)).length;
    const allowedTerminal = Math.max(0, this.limits.history - keepHistory.size - activeCount);
    while (terminalTransfers.length > allowedTerminal) {
      const item = terminalTransfers.shift();
      if (item) this.transfers.delete(item[0]);
    }
  }

  private emit(event: NearbyExchangeEvent): void { for (const listener of this.subscriptions) listener(event); }

  private rememberSeen(key: string, expiresAt: number): void {
    if (this.seenMessages.size >= this.limits.dedup && !this.seenMessages.has(key)) this.seenMessages.delete(this.seenMessages.keys().next().value as string);
    this.seenMessages.set(key, Number.isFinite(expiresAt) ? expiresAt : this.now() + NEARBY_EXCHANGE_MAX_TTL_MS);
  }

  private latestDisclosure(_endpointId: string): NearbyIdentityDisclosure | undefined {
    // The disclosure event is intentionally not a persistent anonymous-peer
    // history. A host adapter can retain the selected Profile locally; this
    // short-lived service only needs the last explicit event for Add Contact.
    return this.disclosures.get(_endpointId);
  }

  private async closeSession(state: ExchangeSessionState): Promise<void> {
    if (state.closed) return; state.closed = true; this.sessions.delete(state.endpointId); if (this.sessionsByPeer.get(state.peerHandle) === state.endpointId) this.sessionsByPeer.delete(state.peerHandle); await this.nearby.close(state.transportSession).catch(() => undefined);
    for (const [requestId, pending] of this.pendingChunks) if (pending.transferId && this.transfers.get(pending.transferId)?.endpointId === state.endpointId) { clearTimeout(pending.timer); pending.reject(new NearbyExchangeError('UNAVAILABLE', 'Nearby session closed')); this.pendingChunks.delete(requestId); }
  }

  private async sweep(): Promise<void> {
    const at = this.now();
    if (this.receivingUntil !== undefined && this.receivingUntil <= at) { this.receivingUntil = undefined; this.qrTokens.clear(); this.emit({ type: 'policy', policy: this.receivePolicy, active: false }); }
    for (const [key, expiresAt] of this.seenMessages) if (expiresAt <= at) this.seenMessages.delete(key);
    for (const [key, value] of this.fragments) if (value.expiresAt <= at) this.fragments.delete(key);
    for (const [token, value] of this.qrTokens) if (value.expiresAt <= at || value.used) this.qrTokens.delete(token);
    for (const record of this.localOffers.values()) if (!terminal(record.status) && isExpired(record.offer.expiresAt, this.now)) { record.status = 'EXPIRED'; record.updatedAt = at; this.updateTransfer(record.transferId, { status: 'EXPIRED' }); }
    for (const record of this.incomingOffersMap.values()) if (!terminal(record.status) && isExpired(record.offer.expiresAt, this.now)) { record.status = 'EXPIRED'; record.updatedAt = at; this.updateTransfer(record.transferId, { status: 'EXPIRED' }); }
    for (const state of [...this.sessions.values()]) if (state.expiresAt <= at || state.closed) await this.closeSession(state);
    this.compactBoundedState();
    await this.persist();
  }

  private async hydrate(): Promise<void> {
    const value = await this.storage.read();
    if (!isObject(value) || value.version !== 1) return;
    const history = Array.isArray(value.history) ? value.history.slice(-this.limits.history) : [];
    for (const item of history) {
      try { const transfer = validatePersistedTransfer(item, this.now); if (!terminal(transfer.status)) continue; this.historyEntries.push(transfer); this.transfers.set(transfer.transferId, transfer); }
      catch { /* persisted state is untrusted and is ignored */ }
    }
  }

  private async persist(): Promise<void> {
    const history = this.historyEntries.slice(-this.limits.history).map(clone);
    const transfers = [...this.transfers.values()].filter(value => terminal(value.status)).slice(-this.limits.history).map(value => ({ ...clone(value), object: undefined }));
    const offers = [...this.localOffers.values(), ...this.incomingOffersMap.values()].filter(value => terminal(value.status)).slice(-this.limits.history).map(value => ({ offer: clone({ ...value.offer, status: value.status }), direction: value.offer.direction, objectType: value.offer.objectType, status: value.status, transferId: value.transferId, updatedAt: value.updatedAt }));
    await this.storage.write({ version: 1, offers, transfers, history } satisfies PersistedState);
  }
}

function terminal(status: NearbyExchangeTransferStatus): boolean { return ['RECEIVED', 'REJECTED', 'CANCELED', 'FAILED', 'EXPIRED'].includes(status); }
function sanitizeCapabilities(value: unknown): readonly NearbyExchangeObjectType[] { return Array.isArray(value) ? [...new Set(value.filter(item => typeof item === 'string' && DEFAULT_CAPABILITIES.includes(item as NearbyExchangeObjectType)))].slice(0, DEFAULT_CAPABILITIES.length) as NearbyExchangeObjectType[] : []; }
function validateReceipt(value: unknown, now: () => number): NearbyExchangeReceipt {
  if (!isObject(value) || value.version !== 1 || typeof value.transferId !== 'string' || typeof value.offerId !== 'string' || !['ACCEPTED', 'RECEIVED', 'REJECTED', 'CANCELED', 'FAILED'].includes(String(value.status))) throw new NearbyExchangeError('MALFORMED', 'Nearby receipt is invalid');
  if (value.contentId !== undefined && (typeof value.contentId !== 'string' || !/^sha256-[a-f0-9]{64}$/i.test(value.contentId))) throw new NearbyExchangeError('MALFORMED', 'Nearby receipt contentId is invalid');
  if (value.verifiedAt !== undefined && (typeof value.verifiedAt !== 'string' || isExpired(value.verifiedAt, () => now() - NEARBY_EXCHANGE_MAX_TTL_MS))) throw new NearbyExchangeError('MALFORMED', 'Nearby receipt timestamp is invalid');
  return { version: 1, transferId: value.transferId, offerId: value.offerId, status: value.status as NearbyExchangeReceipt['status'], ...(typeof value.contentId === 'string' ? { contentId: value.contentId as ContentId } : {}), ...(typeof value.verifiedAt === 'string' ? { verifiedAt: value.verifiedAt } : {}), ...(typeof value.reason === 'string' ? { reason: value.reason.slice(0, 512) } : {}) };
}
function validatePersistedTransfer(value: unknown, now: () => number): NearbyTransfer {
  if (!isObject(value) || value.version !== 1 || typeof value.transferId !== 'string' || typeof value.offerId !== 'string' || typeof value.endpointId !== 'string' || !['INCOMING', 'OUTGOING'].includes(String(value.direction)) || typeof value.objectType !== 'string' || typeof value.status !== 'string' || !Number.isSafeInteger(value.completedBytes) || (value.completedBytes as number) < 0 || (value.totalBytes !== undefined && (!Number.isSafeInteger(value.totalBytes) || (value.totalBytes as number) < 0)) || typeof value.progress !== 'number' || typeof value.createdAt !== 'string' || typeof value.expiresAt !== 'string' || typeof value.updatedAt !== 'string') throw new NearbyExchangeError('MALFORMED', 'Persisted nearby transfer is invalid');
  if (!DEFAULT_CAPABILITIES.includes(value.objectType as NearbyExchangeObjectType) || !['OFFERED', 'ACCEPTED', 'TRANSFERRING', 'PAUSED_WAITING_ROUTE', 'VERIFYING', 'RECEIVED', 'REJECTED', 'CANCELED', 'FAILED', 'EXPIRED'].includes(value.status)) throw new NearbyExchangeError('MALFORMED', 'Persisted nearby transfer enum is invalid');
  const object = value.object === undefined ? undefined : validateObject(value.object);
  const item = value as Record<string, unknown>;
  return { version: 1, transferId: item.transferId as string, offerId: item.offerId as string, endpointId: item.endpointId as string, direction: item.direction as NearbyExchangeDirection, objectType: item.objectType as NearbyExchangeObjectType, status: item.status as NearbyExchangeTransferStatus, completedBytes: item.completedBytes as number, ...(typeof item.totalBytes === 'number' ? { totalBytes: item.totalBytes } : {}), progress: Math.max(0, Math.min(1, item.progress as number)), createdAt: item.createdAt as string, expiresAt: item.expiresAt as string, updatedAt: item.updatedAt as string, ...(object ? { object } : {}), ...(item.receipt ? { receipt: validateReceipt(item.receipt, now) } : {}), ...(typeof item.lastError === 'string' ? { lastError: item.lastError.slice(0, 512) } : {}) };
}

function validateWire(value: unknown, now: () => number): ExchangeWire {
  if (!isObject(value) || value.protocol !== NEARBY_EXCHANGE_PROTOCOL || value.version !== 1 || typeof value.kind !== 'string' || typeof value.sessionId !== 'string' || typeof value.messageId !== 'string' || typeof value.expiresAt !== 'string' || isExpired(value.expiresAt, now) || Date.parse(value.expiresAt) - now() > NEARBY_EXCHANGE_MAX_TTL_MS) throw new NearbyExchangeError('MALFORMED', 'Nearby wire header is invalid');
  safeId(value.sessionId, 'wire sessionId', 160); safeId(value.messageId, 'wire messageId', 160);
  if (value.kind === 'FRAGMENT') {
    const fragment = value as Record<string, unknown>;
    if (typeof fragment.fragmentId !== 'string' || !Number.isSafeInteger(fragment.index) || !Number.isSafeInteger(fragment.count) || (fragment.index as number) < 0 || (fragment.count as number) < 1 || (fragment.count as number) > 4_096 || (fragment.index as number) >= (fragment.count as number) || typeof fragment.payload !== 'string') throw new NearbyExchangeError('MALFORMED', 'Nearby fragment is invalid');
    safeId(fragment.fragmentId, 'fragmentId', 160);
    const payload = fromBase64(fragment.payload);
    if (payload.byteLength > 8 * 1024) throw new NearbyExchangeError('RESOURCE_LIMIT', 'Nearby fragment payload is too large');
    return value as unknown as ExchangeFragmentWire;
  }
  if (!['HELLO', 'HELLO_ACK', 'OFFER', 'OFFER_RESPONSE', 'OBJECT_DETAILS', 'CHUNK_REQUEST', 'CHUNK_RESPONSE', 'RECEIPT', 'CANCEL', 'IDENTITY_DISCLOSURE', 'IDENTITY_ACK'].includes(value.kind)) throw new NearbyExchangeError('MALFORMED', 'Nearby wire kind is unsupported');
  if (value.kind === 'HELLO') {
    if (value.alias !== undefined && typeof value.alias !== 'string') throw new NearbyExchangeError('MALFORMED', 'Nearby hello alias is invalid');
    if (value.alias !== undefined) safeAlias(value.alias);
    if (!Array.isArray(value.capabilities) || value.capabilities.length > DEFAULT_CAPABILITIES.length || value.capabilities.some(item => typeof item !== 'string')) throw new NearbyExchangeError('MALFORMED', 'Nearby hello capabilities are invalid');
    if (value.bootstrapToken !== undefined) safeId(value.bootstrapToken, 'bootstrapToken', 256);
  }
  if (value.kind === 'HELLO_ACK') {
    if (typeof value.visible !== 'boolean' || !Array.isArray(value.capabilities) || value.capabilities.length > DEFAULT_CAPABILITIES.length || value.capabilities.some(item => typeof item !== 'string') || typeof value.verificationCode !== 'string' || !/^\d{3} \d{3}$/.test(value.verificationCode) || !['ANONYMOUS', 'IDENTITY_DISCLOSED', 'KNOWN_CONTACT', 'OWN_DEVICE'].includes(String(value.socialState))) throw new NearbyExchangeError('MALFORMED', 'Nearby hello acknowledgement is invalid');
    if (value.alias !== undefined && typeof value.alias !== 'string') throw new NearbyExchangeError('MALFORMED', 'Nearby hello acknowledgement alias is invalid');
    if (value.alias !== undefined) safeAlias(value.alias);
  }
  if (value.kind === 'OFFER') { validateOffer(value.offer, now); if (typeof value.transferId !== 'string' || value.transferId.length < 1 || value.transferId.length > 160) throw new NearbyExchangeError('MALFORMED', 'Nearby offer transfer id is invalid'); }
  if (value.kind === 'OFFER_RESPONSE') { safeId(value.offerId, 'offerId', 160); safeId(value.transferId, 'transferId', 160); if (typeof value.accepted !== 'boolean' || (value.reason !== undefined && (typeof value.reason !== 'string' || byteLength(value.reason) > 512))) throw new NearbyExchangeError('MALFORMED', 'Nearby offer response is invalid'); }
  if (value.kind === 'OBJECT_DETAILS') {
    safeId(value.offerId, 'offerId', 160); safeId(value.transferId, 'transferId', 160);
    const object = validateObject(value.object);
    if (value.manifest !== undefined) validateManifest(value.manifest);
    if (value.authorizationGrant !== undefined && (typeof value.authorizationGrant !== 'string' || value.authorizationGrant.length < 1 || value.authorizationGrant.length > 256)) throw new NearbyExchangeError('MALFORMED', 'Nearby object authorization is invalid');
    if (object.type === 'file' && (value.manifest === undefined || value.authorizationGrant === undefined)) throw new NearbyExchangeError('MALFORMED', 'Nearby file details are incomplete');
  }
  if (value.kind === 'CHUNK_REQUEST' || value.kind === 'CHUNK_RESPONSE') {
    if (typeof value.requestId !== 'string' || typeof value.transferId !== 'string' || typeof value.contentId !== 'string' || !/^sha256-[a-f0-9]{64}$/i.test(value.contentId) || !Number.isSafeInteger(value.index) || (value.index as number) < 0) throw new NearbyExchangeError('MALFORMED', 'Nearby chunk wire is invalid');
    safeId(value.requestId, 'requestId', 160); safeId(value.transferId, 'transferId', 160);
    if (value.kind === 'CHUNK_REQUEST') { safeId(value.offerId, 'offerId', 160); if (typeof value.authorizationGrant !== 'string' || value.authorizationGrant.length < 1 || value.authorizationGrant.length > 256) throw new NearbyExchangeError('MALFORMED', 'Nearby chunk authorization is invalid'); }
  }
  if (value.kind === 'CHUNK_RESPONSE') {
    if (typeof value.bytes !== 'string') throw new NearbyExchangeError('MALFORMED', 'Nearby chunk response is invalid');
    const bytes = fromBase64(value.bytes); if (bytes.byteLength > 256 * 1024) throw new NearbyExchangeError('RESOURCE_LIMIT', 'Nearby chunk response is too large');
  }
  if (value.kind === 'IDENTITY_DISCLOSURE') validateDisclosure(value.disclosure);
  if (value.kind === 'IDENTITY_DISCLOSURE') safeId(value.endpointId, 'endpointId', 160);
  if (value.kind === 'IDENTITY_ACK') { safeId(value.endpointId, 'endpointId', 160); if (typeof value.accepted !== 'boolean') throw new NearbyExchangeError('MALFORMED', 'Nearby identity acknowledgement is invalid'); }
  if (value.kind === 'RECEIPT') validateReceipt(value.receipt, now);
  if (value.kind === 'CANCEL') { safeId(value.offerId, 'offerId', 160); safeId(value.transferId, 'transferId', 160); if (value.reason !== undefined && (typeof value.reason !== 'string' || byteLength(value.reason) > 512)) throw new NearbyExchangeError('MALFORMED', 'Nearby cancel reason is invalid'); }
  if (jsonBytes(value) > NEARBY_EXCHANGE_MAX_WIRE_BYTES) throw new NearbyExchangeError('RESOURCE_LIMIT', 'Nearby wire is too large');
  return value as unknown as Exclude<ExchangeWire, ExchangeFragmentWire>;
}
