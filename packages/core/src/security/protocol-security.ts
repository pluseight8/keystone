import { canonicalJson } from '../crypto.js';

/**
 * Protocol security is deliberately independent from product examples.  A
 * peer is treated as an untrusted byte source until every stage below has
 * completed:
 *
 * bounded frame -> bounded parse -> signature -> replay -> protocol state ->
 * authorization -> subsystem validation.
 */

export const PROTOCOL_SECURITY_VERSION = 'keystone-protocol-security-v1' as const;

export const PROTOCOL_CRYPTO_SUITES = ['ed25519+x25519+xchacha20poly1305', 'ed25519+xsalsa20poly1305'] as const;
export type ProtocolCryptoSuite = (typeof PROTOCOL_CRYPTO_SUITES)[number];
export type ProtocolVersion = number;
export type ProtocolCapability =
  | 'ENVELOPE_V1'
  | 'ED25519_SIGNATURES'
  | 'REPLAY_WINDOW'
  | 'MONOTONIC_REVISIONS'
  | 'BOUNDED_FRAMING'
  | 'NO_COMPRESSION'
  | 'XCHACHA20POLY1305'
  | 'XSALSA20POLY1305';

export interface ConnectionQuota {
  readonly maxConnectionsPerPeer: number;
  readonly maxConnectionAttemptsPerWindow: number;
  readonly windowMs: number;
}

export interface ObjectQuota {
  readonly maxObjectsPerWindow: number;
  readonly maxObjectBytes: number;
  readonly windowMs: number;
}

export interface BandwidthBudget {
  readonly maxBytesPerSecond: number;
  readonly burstBytes: number;
}

export interface PendingRequestBudget {
  readonly maxPendingRequests: number;
  readonly maxPendingInvitations: number;
  readonly maxConcurrentTransfers: number;
}

export interface ProtocolLimits {
  readonly maxFrameBytes: number;
  readonly maxEnvelopeBytes: number;
  readonly maxPendingBytesPerConnection: number;
  readonly maxNestingDepth: number;
  readonly maxCollectionItems: number;
  readonly maxStringBytes: number;
  readonly maxNodes: number;
  readonly maxDecompressedBytes: number;
  readonly maxCompressionRatio: number;
  readonly maxClockSkewMs: number;
  readonly maxLifetimeMs: number;
  readonly maxFramesPerSecond: number;
  readonly connection: ConnectionQuota;
  readonly objects: ObjectQuota;
  readonly bandwidth: BandwidthBudget;
  readonly pending: PendingRequestBudget;
}

export const DEFAULT_PROTOCOL_LIMITS: ProtocolLimits = Object.freeze({
  // 16 MiB is a hard upper bound for the framed protocol. Product objects
  // are normally much smaller; file bytes use the content provider protocol.
  maxFrameBytes: 16 * 1024 * 1024,
  maxEnvelopeBytes: 16 * 1024 * 1024,
  maxPendingBytesPerConnection: 32 * 1024 * 1024,
  maxNestingDepth: 32,
  maxCollectionItems: 4_096,
  maxStringBytes: 1 * 1024 * 1024,
  maxNodes: 32_768,
  maxDecompressedBytes: 16 * 1024 * 1024,
  maxCompressionRatio: 100,
  maxClockSkewMs: 5 * 60_000,
  // Long-lived durable mailbox envelopes are valid for up to seven days;
  // individual subsystems may and do choose shorter lifetimes.
  maxLifetimeMs: 7 * 24 * 60 * 60_000,
  maxFramesPerSecond: 256,
  connection: Object.freeze({ maxConnectionsPerPeer: 2, maxConnectionAttemptsPerWindow: 64, windowMs: 60_000 }),
  objects: Object.freeze({ maxObjectsPerWindow: 1_024, maxObjectBytes: 512 * 1024, windowMs: 60_000 }),
  bandwidth: Object.freeze({ maxBytesPerSecond: 8 * 1024 * 1024, burstBytes: 16 * 1024 * 1024 }),
  pending: Object.freeze({ maxPendingRequests: 256, maxPendingInvitations: 128, maxConcurrentTransfers: 8 }),
});

export interface ProtocolSecurityRequirement {
  readonly minimumEnvelopeVersion: ProtocolVersion;
  readonly cryptographicSuite: ProtocolCryptoSuite;
  readonly signatureRequired: boolean;
  readonly replayProtectionRequired: boolean;
  readonly monotonicRevisionsRequired: boolean;
  readonly limits: ProtocolLimits;
}

export interface ProtocolSecurityProfile {
  readonly id: string;
  readonly profileVersion: string;
  readonly supportedEnvelopeVersions: readonly ProtocolVersion[];
  readonly minimumEnvelopeVersion: ProtocolVersion;
  readonly supportedCryptoSuites: readonly ProtocolCryptoSuite[];
  readonly minimumCryptoSuite: ProtocolCryptoSuite;
  readonly signatureAlgorithms: readonly ('ed25519')[];
  readonly signatureRequired: boolean;
  readonly replayProtection: boolean;
  readonly requiredRevisionSemantics: 'monotonic' | 'causal';
  readonly capabilities: readonly ProtocolCapability[];
  readonly limits: ProtocolLimits;
  readonly compression: { readonly enabled: false; readonly maxOutputBytes: number; readonly maxRatio: number };
  readonly requirements?: ProtocolSecurityRequirement;
}

export const DEFAULT_PROTOCOL_SECURITY_PROFILE: ProtocolSecurityProfile = Object.freeze({
  id: 'keystone-default',
  profileVersion: PROTOCOL_SECURITY_VERSION,
  supportedEnvelopeVersions: Object.freeze([1]),
  minimumEnvelopeVersion: 1,
  supportedCryptoSuites: Object.freeze([...PROTOCOL_CRYPTO_SUITES]),
  minimumCryptoSuite: PROTOCOL_CRYPTO_SUITES[1],
  signatureAlgorithms: Object.freeze(['ed25519'] as const),
  signatureRequired: true,
  replayProtection: true,
  requiredRevisionSemantics: 'monotonic',
  capabilities: Object.freeze(['ENVELOPE_V1', 'ED25519_SIGNATURES', 'REPLAY_WINDOW', 'MONOTONIC_REVISIONS', 'BOUNDED_FRAMING', 'NO_COMPRESSION', 'XCHACHA20POLY1305', 'XSALSA20POLY1305'] as const),
  limits: DEFAULT_PROTOCOL_LIMITS,
  compression: Object.freeze({ enabled: false, maxOutputBytes: DEFAULT_PROTOCOL_LIMITS.maxDecompressedBytes, maxRatio: DEFAULT_PROTOCOL_LIMITS.maxCompressionRatio }),
  requirements: Object.freeze({ minimumEnvelopeVersion: 1, cryptographicSuite: PROTOCOL_CRYPTO_SUITES[1], signatureRequired: true, replayProtectionRequired: true, monotonicRevisionsRequired: true, limits: DEFAULT_PROTOCOL_LIMITS }),
});

export type ProtocolCompatibilityDecision = 'ACCEPT' | 'REJECT_DOWNGRADE' | 'REJECT_INCOMPATIBLE' | 'REJECT_LIMITS' | 'REJECT_SIGNATURES';
export interface ProtocolNegotiationResult {
  readonly accepted: boolean;
  readonly decision: ProtocolCompatibilityDecision;
  readonly selectedVersion?: ProtocolVersion;
  readonly selectedCryptoSuite?: ProtocolCryptoSuite;
  readonly profileVersion: string;
  readonly limits?: ProtocolLimits;
  readonly reason: string;
}

/**
 * Selects the strongest mutually supported mode while never selecting a mode
 * below either side's declared minimum. A remote "legacy" flag is metadata,
 * not an override of the local MandatoryPolicyRoot.
 */
export function negotiateProtocolSecurity(local: ProtocolSecurityProfile, remote: ProtocolSecurityProfile): ProtocolNegotiationResult {
  const localMin = local.minimumEnvelopeVersion;
  const remoteMin = remote.minimumEnvelopeVersion;
  const minimumVersion = Math.max(localMin, remoteMin);
  const versions = local.supportedEnvelopeVersions.filter(value => remote.supportedEnvelopeVersions.includes(value)).filter(value => value >= minimumVersion);
  if (!versions.length) return { accepted: false, decision: 'REJECT_DOWNGRADE', profileVersion: local.profileVersion, reason: `No envelope version meets local/remote minimum ${minimumVersion}` };
  const suites = local.supportedCryptoSuites.filter(value => remote.supportedCryptoSuites.includes(value)).filter(value => cryptoSuiteAtLeast(value, local.minimumCryptoSuite) && cryptoSuiteAtLeast(value, remote.minimumCryptoSuite));
  if (!suites.length) return { accepted: false, decision: 'REJECT_DOWNGRADE', profileVersion: local.profileVersion, reason: 'No cryptographic suite meets the mandatory minimum' };
  if (local.signatureRequired && (!remote.signatureRequired || !remote.signatureAlgorithms.includes('ed25519'))) return { accepted: false, decision: 'REJECT_SIGNATURES', profileVersion: local.profileVersion, reason: 'Remote peer does not meet the mandatory signature requirement' };
  if (local.replayProtection && !remote.replayProtection) return { accepted: false, decision: 'REJECT_INCOMPATIBLE', profileVersion: local.profileVersion, reason: 'Replay protection is mandatory' };
  if (local.requiredRevisionSemantics === 'monotonic' && remote.requiredRevisionSemantics !== 'monotonic') return { accepted: false, decision: 'REJECT_INCOMPATIBLE', profileVersion: local.profileVersion, reason: 'Monotonic revision semantics are mandatory' };
  const selectedVersion = Math.max(...versions);
  const selectedCryptoSuite = suites.sort((a, b) => cryptoSuiteRank(b) - cryptoSuiteRank(a))[0]!;
  const limits = intersectProtocolLimits(local.limits, remote.limits);
  if (limits.maxFrameBytes < 1_024 || limits.maxEnvelopeBytes < 1_024 || limits.maxPendingBytesPerConnection < limits.maxFrameBytes) return { accepted: false, decision: 'REJECT_LIMITS', profileVersion: local.profileVersion, reason: 'Negotiated protocol limits are unusable' };
  return { accepted: true, decision: 'ACCEPT', selectedVersion, selectedCryptoSuite, profileVersion: local.profileVersion, limits, reason: 'Compatible security profile selected' };
}

function intersectProtocolLimits(a: ProtocolLimits, b: ProtocolLimits): ProtocolLimits {
  return { maxFrameBytes: Math.min(a.maxFrameBytes, b.maxFrameBytes), maxEnvelopeBytes: Math.min(a.maxEnvelopeBytes, b.maxEnvelopeBytes), maxPendingBytesPerConnection: Math.min(a.maxPendingBytesPerConnection, b.maxPendingBytesPerConnection), maxNestingDepth: Math.min(a.maxNestingDepth, b.maxNestingDepth), maxCollectionItems: Math.min(a.maxCollectionItems, b.maxCollectionItems), maxStringBytes: Math.min(a.maxStringBytes, b.maxStringBytes), maxNodes: Math.min(a.maxNodes, b.maxNodes), maxDecompressedBytes: Math.min(a.maxDecompressedBytes, b.maxDecompressedBytes), maxCompressionRatio: Math.min(a.maxCompressionRatio, b.maxCompressionRatio), maxClockSkewMs: Math.min(a.maxClockSkewMs, b.maxClockSkewMs), maxLifetimeMs: Math.min(a.maxLifetimeMs, b.maxLifetimeMs), maxFramesPerSecond: Math.min(a.maxFramesPerSecond, b.maxFramesPerSecond), connection: { maxConnectionsPerPeer: Math.min(a.connection.maxConnectionsPerPeer, b.connection.maxConnectionsPerPeer), maxConnectionAttemptsPerWindow: Math.min(a.connection.maxConnectionAttemptsPerWindow, b.connection.maxConnectionAttemptsPerWindow), windowMs: Math.min(a.connection.windowMs, b.connection.windowMs) }, objects: { maxObjectsPerWindow: Math.min(a.objects.maxObjectsPerWindow, b.objects.maxObjectsPerWindow), maxObjectBytes: Math.min(a.objects.maxObjectBytes, b.objects.maxObjectBytes), windowMs: Math.min(a.objects.windowMs, b.objects.windowMs) }, bandwidth: { maxBytesPerSecond: Math.min(a.bandwidth.maxBytesPerSecond, b.bandwidth.maxBytesPerSecond), burstBytes: Math.min(a.bandwidth.burstBytes, b.bandwidth.burstBytes) }, pending: { maxPendingRequests: Math.min(a.pending.maxPendingRequests, b.pending.maxPendingRequests), maxPendingInvitations: Math.min(a.pending.maxPendingInvitations, b.pending.maxPendingInvitations), maxConcurrentTransfers: Math.min(a.pending.maxConcurrentTransfers, b.pending.maxConcurrentTransfers) } };
}
function cryptoSuiteRank(value: ProtocolCryptoSuite): number { return value.startsWith('ed25519+x25519') ? 2 : 1; }
function cryptoSuiteAtLeast(value: ProtocolCryptoSuite, minimum: ProtocolCryptoSuite): boolean { return cryptoSuiteRank(value) >= cryptoSuiteRank(minimum); }

export class ProtocolBoundsError extends Error {
  constructor(readonly code: 'FRAME_TOO_LARGE' | 'PENDING_BYTES_EXCEEDED' | 'TRUNCATED_FRAME' | 'JSON_TOO_LARGE' | 'JSON_DEPTH_EXCEEDED' | 'JSON_COLLECTION_TOO_LARGE' | 'JSON_STRING_TOO_LARGE' | 'JSON_NODE_BUDGET_EXCEEDED' | 'DUPLICATE_JSON_KEY' | 'INVALID_JSON', message: string) { super(message); this.name = 'ProtocolBoundsError'; }
}

export interface BoundedFrameDecoderOptions { readonly maxFrameBytes?: number; readonly maxPendingBytes?: number; }
export interface BoundedFrame { readonly declaredLength: number; readonly bytes: Uint8Array; }

/** Incremental frame parser. It rejects an unchecked declared length before a
 * larger buffer can be allocated and bounds partial frames per connection. */
export class BoundedFrameDecoder {
  private pending = new Uint8Array(0);
  readonly maxFrameBytes: number;
  readonly maxPendingBytes: number;
  constructor(options: BoundedFrameDecoderOptions = {}) { this.maxFrameBytes = positiveInt(options.maxFrameBytes ?? DEFAULT_PROTOCOL_LIMITS.maxFrameBytes); this.maxPendingBytes = positiveInt(options.maxPendingBytes ?? Math.max(this.maxFrameBytes, DEFAULT_PROTOCOL_LIMITS.maxPendingBytesPerConnection)); if (this.maxPendingBytes < this.maxFrameBytes) throw new Error('maxPendingBytes must not be below maxFrameBytes'); }
  get pendingBytes(): number { return this.pending.byteLength; }
  push(chunk: Uint8Array): readonly BoundedFrame[] {
    if (!(chunk instanceof Uint8Array) || chunk.byteLength > this.maxPendingBytes || this.pending.byteLength > this.maxPendingBytes - chunk.byteLength) throw new ProtocolBoundsError('PENDING_BYTES_EXCEEDED', 'Connection pending bytes exceed the local protocol budget');
    const merged = new Uint8Array(this.pending.byteLength + chunk.byteLength); merged.set(this.pending); merged.set(chunk, this.pending.byteLength); this.pending = merged;
    const result: BoundedFrame[] = []; let offset = 0;
    while (this.pending.byteLength - offset >= 4) {
      const length = new DataView(this.pending.buffer, this.pending.byteOffset + offset, 4).getUint32(0);
      if (length === 0 || length > this.maxFrameBytes) { this.pending = new Uint8Array(0); throw new ProtocolBoundsError('FRAME_TOO_LARGE', `Frame length ${length} exceeds the local limit`); }
      if (this.pending.byteLength - offset < length + 4) break;
      result.push({ declaredLength: length, bytes: this.pending.slice(offset + 4, offset + 4 + length) }); offset += 4 + length;
    }
    this.pending = this.pending.slice(offset); if (this.pending.byteLength > this.maxPendingBytes) throw new ProtocolBoundsError('PENDING_BYTES_EXCEEDED', 'Partial frame exceeds the local protocol budget');
    return result;
  }
  finalize(): void { if (this.pending.byteLength) throw new ProtocolBoundsError('TRUNCATED_FRAME', 'Connection closed with a truncated protocol frame'); }
  reset(): void { this.pending = new Uint8Array(0); }
}

export function encodeBoundedFrame(value: Uint8Array, maxFrameBytes = DEFAULT_PROTOCOL_LIMITS.maxFrameBytes): Uint8Array {
  if (!(value instanceof Uint8Array) || value.byteLength === 0 || value.byteLength > maxFrameBytes) throw new ProtocolBoundsError('FRAME_TOO_LARGE', 'Local frame exceeds the protocol limit');
  const frame = new Uint8Array(value.byteLength + 4); new DataView(frame.buffer).setUint32(0, value.byteLength); frame.set(value, 4); return frame;
}

export interface JsonBudget { readonly maxDepth?: number; readonly maxCollectionItems?: number; readonly maxStringBytes?: number; readonly maxNodes?: number; }
const DEFAULT_JSON_BUDGET: Required<JsonBudget> = { maxDepth: DEFAULT_PROTOCOL_LIMITS.maxNestingDepth, maxCollectionItems: DEFAULT_PROTOCOL_LIMITS.maxCollectionItems, maxStringBytes: DEFAULT_PROTOCOL_LIMITS.maxStringBytes, maxNodes: DEFAULT_PROTOCOL_LIMITS.maxNodes };

/** Parse JSON only after a duplicate-key and structural budget pass. */
export function parseBoundedJson<T = unknown>(input: Uint8Array | string, budget: JsonBudget = {}): T {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input; const limits = { ...DEFAULT_JSON_BUDGET, ...budget };
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > limits.maxStringBytes * 16) throw new ProtocolBoundsError('JSON_TOO_LARGE', 'JSON payload exceeds the protocol budget');
  let text: string; try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new ProtocolBoundsError('INVALID_JSON', 'JSON is not valid UTF-8'); }
  if (text.length === 0) throw new ProtocolBoundsError('INVALID_JSON', 'JSON payload is empty');
  scanJson(text, limits); let parsed: unknown; try { parsed = JSON.parse(text); } catch { throw new ProtocolBoundsError('INVALID_JSON', 'JSON payload is malformed'); }
  validateJsonValue(parsed, limits, 0, { value: 0 }); return parsed as T;
}

function validateJsonValue(value: unknown, limits: Required<JsonBudget>, depth: number, nodes: { value: number }): void {
  if (++nodes.value > limits.maxNodes) throw new ProtocolBoundsError('JSON_NODE_BUDGET_EXCEEDED', 'JSON node budget exceeded');
  if (depth > limits.maxDepth) throw new ProtocolBoundsError('JSON_DEPTH_EXCEEDED', 'JSON nesting depth exceeded');
  if (typeof value === 'string') { if (new TextEncoder().encode(value).byteLength > limits.maxStringBytes) throw new ProtocolBoundsError('JSON_STRING_TOO_LARGE', 'JSON string exceeds the protocol budget'); return; }
  if (Array.isArray(value)) { if (value.length > limits.maxCollectionItems) throw new ProtocolBoundsError('JSON_COLLECTION_TOO_LARGE', 'JSON array exceeds the protocol budget'); value.forEach(item => validateJsonValue(item, limits, depth + 1, nodes)); return; }
  if (value && typeof value === 'object') { const entries = Object.entries(value); if (entries.length > limits.maxCollectionItems) throw new ProtocolBoundsError('JSON_COLLECTION_TOO_LARGE', 'JSON object exceeds the protocol budget'); for (const [key, item] of entries) { if (new TextEncoder().encode(key).byteLength > limits.maxStringBytes) throw new ProtocolBoundsError('JSON_STRING_TOO_LARGE', 'JSON key exceeds the protocol budget'); validateJsonValue(item, limits, depth + 1, nodes); } }
}

function scanJson(text: string, limits: Required<JsonBudget>): void {
  let index = 0; let nodes = 0;
  const whitespace = () => { while (/\s/.test(text[index] ?? '')) index += 1; };
  const string = (): string => { const start = index; if (text[index] !== '"') throw new ProtocolBoundsError('INVALID_JSON', 'Expected JSON string'); index += 1; for (;;) { if (index >= text.length) throw new ProtocolBoundsError('INVALID_JSON', 'Unterminated JSON string'); const char = text[index++]; if (char === '\\') { if (index >= text.length) throw new ProtocolBoundsError('INVALID_JSON', 'Invalid JSON escape'); index += 1; } else if (char === '"') break; else if (char.charCodeAt(0) < 0x20) throw new ProtocolBoundsError('INVALID_JSON', 'Control character in JSON string'); } let value: unknown; try { value = JSON.parse(text.slice(start, index)); } catch { throw new ProtocolBoundsError('INVALID_JSON', 'Invalid JSON string'); } const result = String(value); if (new TextEncoder().encode(result).byteLength > limits.maxStringBytes) throw new ProtocolBoundsError('JSON_STRING_TOO_LARGE', 'JSON string exceeds the protocol budget'); return result; };
  const value = (depth: number): void => { if (++nodes > limits.maxNodes) throw new ProtocolBoundsError('JSON_NODE_BUDGET_EXCEEDED', 'JSON node budget exceeded'); if (depth > limits.maxDepth) throw new ProtocolBoundsError('JSON_DEPTH_EXCEEDED', 'JSON nesting depth exceeded'); whitespace(); const char = text[index]; if (char === '"') { string(); return; } if (char === '{') { index += 1; whitespace(); const keys = new Set<string>(); let count = 0; if (text[index] === '}') { index += 1; return; } for (;;) { whitespace(); const key = string(); if (keys.has(key)) throw new ProtocolBoundsError('DUPLICATE_JSON_KEY', `Duplicate JSON key: ${key}`); keys.add(key); if (++count > limits.maxCollectionItems) throw new ProtocolBoundsError('JSON_COLLECTION_TOO_LARGE', 'JSON object exceeds the protocol budget'); whitespace(); if (text[index++] !== ':') throw new ProtocolBoundsError('INVALID_JSON', 'Expected JSON object separator'); value(depth + 1); whitespace(); if (text[index] === '}') { index += 1; return; } if (text[index++] !== ',') throw new ProtocolBoundsError('INVALID_JSON', 'Expected JSON object comma'); } } if (char === '[') { index += 1; whitespace(); let count = 0; if (text[index] === ']') { index += 1; return; } for (;;) { if (++count > limits.maxCollectionItems) throw new ProtocolBoundsError('JSON_COLLECTION_TOO_LARGE', 'JSON array exceeds the protocol budget'); value(depth + 1); whitespace(); if (text[index] === ']') { index += 1; return; } if (text[index++] !== ',') throw new ProtocolBoundsError('INVALID_JSON', 'Expected JSON array comma'); } } const rest = text.slice(index); const match = /^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(rest); if (!match) throw new ProtocolBoundsError('INVALID_JSON', 'Invalid JSON value'); index += match[0].length; };
  value(0); whitespace(); if (index !== text.length) throw new ProtocolBoundsError('INVALID_JSON', 'Trailing JSON data');
}

export interface ProtocolEnvelopeShape { readonly version: number; readonly type: string; readonly id: string; readonly sender: string; readonly recipient: string; readonly nonce: string; readonly expiresAt: string; readonly body: unknown; readonly signature: string; }
export interface ParsedEnvelope<T extends ProtocolEnvelopeShape = ProtocolEnvelopeShape> { readonly envelope: T; readonly bytes: number; readonly parsedAt: number; }
export interface CryptographicallyVerifiedEnvelope<T extends ProtocolEnvelopeShape = ProtocolEnvelopeShape> extends ParsedEnvelope<T> { readonly signatureVerified: true; readonly signer: string; readonly signatureDomain: string; }
export interface ReplayCheckedEnvelope<T extends ProtocolEnvelopeShape = ProtocolEnvelopeShape> extends CryptographicallyVerifiedEnvelope<T> { readonly replayChecked: true; readonly replayKey: ReplayKey; }
export interface AuthorizedProtocolObject<T extends ProtocolEnvelopeShape = ProtocolEnvelopeShape> extends ReplayCheckedEnvelope<T> { readonly authorized: true; }

export function validateProtocolEnvelope<T extends ProtocolEnvelopeShape>(value: unknown, options: { readonly profile?: ProtocolSecurityProfile; readonly now?: number } = {}): ParsedEnvelope<T> {
  const profile = options.profile ?? DEFAULT_PROTOCOL_SECURITY_PROFILE; if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ProtocolSecurityError('INVALID_MESSAGE', 'Malformed protocol envelope');
  const candidate = value as Record<string, unknown>; const keys = new Set(['version', 'type', 'id', 'sender', 'recipient', 'nonce', 'expiresAt', 'body', 'signature']); for (const key of Object.keys(candidate)) if (!keys.has(key) && !key.startsWith('x-')) throw new ProtocolSecurityError('INVALID_MESSAGE', 'Unknown critical protocol envelope field');
  if (candidate.version !== 1 || !profile.supportedEnvelopeVersions.includes(candidate.version as number) || (candidate.version as number) < profile.minimumEnvelopeVersion) throw new ProtocolSecurityError('PROTOCOL_DOWNGRADE', 'Envelope version is below the local security minimum');
  for (const field of ['type', 'id', 'sender', 'recipient', 'nonce', 'expiresAt', 'signature'] as const) if (typeof candidate[field] !== 'string' || new TextEncoder().encode(candidate[field] as string).byteLength > profile.limits.maxStringBytes) throw new ProtocolSecurityError('INVALID_MESSAGE', 'Protocol envelope field is malformed');
  const now = options.now ?? Date.now(); const expiry = Date.parse(candidate.expiresAt as string); if (!Number.isFinite(expiry) || expiry <= now || expiry - now > profile.limits.maxLifetimeMs + profile.limits.maxClockSkewMs) throw new ProtocolSecurityError('EXPIRED_MESSAGE', 'Protocol message is outside the local time window');
  let encodedBody: string; try { encodedBody = JSON.stringify(candidate.body ?? null) ?? 'null'; } catch { throw new ProtocolSecurityError('INVALID_MESSAGE', 'Protocol envelope body is not serializable'); } const bodyBytes = new TextEncoder().encode(encodedBody).byteLength; if (bodyBytes > profile.limits.maxEnvelopeBytes) throw new ProtocolSecurityError('OBJECT_TOO_LARGE', 'Protocol envelope body exceeds the local limit');
  try { validateJsonValue(candidate.body, { maxDepth: profile.limits.maxNestingDepth, maxCollectionItems: profile.limits.maxCollectionItems, maxStringBytes: profile.limits.maxStringBytes, maxNodes: profile.limits.maxNodes }, 0, { value: 0 }); } catch (error) { if (error instanceof ProtocolBoundsError) throw new ProtocolSecurityError('INVALID_MESSAGE', 'Protocol body exceeds structural limits'); throw error; }
  return { envelope: candidate as T, bytes: bodyBytes, parsedAt: now };
}

export type ProtocolSecurityErrorCode = 'INVALID_MESSAGE' | 'INVALID_SIGNATURE' | 'REPLAY' | 'STALE_REVISION' | 'UNAUTHORIZED' | 'EXPIRED_MESSAGE' | 'PROTOCOL_DOWNGRADE' | 'OBJECT_TOO_LARGE' | 'RATE_LIMITED' | 'QUARANTINED' | 'STATE_VIOLATION';
export class ProtocolSecurityError extends Error { constructor(readonly code: ProtocolSecurityErrorCode, message = 'Protocol message rejected') { super(message); this.name = 'ProtocolSecurityError'; } }

export function protocolSignatureDomain(objectType: string, version = 1): string { if (!/^[A-Za-z0-9._:-]{1,128}$/.test(objectType)) throw new ProtocolSecurityError('INVALID_MESSAGE', 'Invalid signature domain'); return `keystone:protocol:${objectType}:v${version}`; }
export function protocolSignedPayload(domain: string, value: unknown): string { const resolved = domain.startsWith('keystone:protocol:') ? domain : protocolSignatureDomain(domain); return canonicalJson({ domain: resolved, payload: value }); }
export function unsignedProtocolObject<T extends { readonly signature?: string }>(value: T): Omit<T, 'signature'> { const { signature: _signature, ...unsigned } = value; return unsigned; }
export async function verifyProtocolObject<T extends { readonly signature?: string }>(value: T, domain: string, verify: (payload: string, signature: string) => Promise<boolean> | boolean): Promise<boolean> { return Boolean(value.signature && await verify(protocolSignedPayload(domain, unsignedProtocolObject(value)), value.signature)); }

export interface ReplayKey { readonly sender: string; readonly nonce?: string; readonly messageId?: string; readonly objectType?: string; readonly protocolEpoch?: number; }
export interface ReplayWindowOptions { readonly maxEntries?: number; readonly windowMs?: number; readonly now?: () => number; }
export class ReplayWindow {
  private readonly entries = new Map<string, number>(); private readonly maxEntries: number; private readonly windowMs: number; private readonly now: () => number;
  constructor(options: ReplayWindowOptions = {}) { this.maxEntries = positiveInt(options.maxEntries ?? 16_384); this.windowMs = positiveInt(options.windowMs ?? DEFAULT_PROTOCOL_LIMITS.maxLifetimeMs); this.now = options.now ?? Date.now; }
  key(value: ReplayKey): string { return canonicalJson({ sender: value.sender, nonce: value.nonce ?? '', messageId: value.messageId ?? '', objectType: value.objectType ?? '', protocolEpoch: value.protocolEpoch ?? 0 }); }
  has(value: ReplayKey): boolean { this.sweep(); return this.entries.has(this.key(value)); }
  checkAndRecord(value: ReplayKey): boolean { this.sweep(); const key = this.key(value); if (this.entries.has(key)) return false; if (this.entries.size >= this.maxEntries) this.evictOldest(); this.entries.set(key, this.now()); return true; }
  size(): number { this.sweep(); return this.entries.size; }
  clear(): void { this.entries.clear(); }
  private sweep(): void { const cutoff = this.now() - this.windowMs; for (const [key, timestamp] of this.entries) if (timestamp < cutoff) this.entries.delete(key); }
  private evictOldest(): void { const first = this.entries.keys().next().value as string | undefined; if (first) this.entries.delete(first); }
}

export interface ProtocolPipelineOptions<T extends ProtocolEnvelopeShape = ProtocolEnvelopeShape> {
  readonly profile?: ProtocolSecurityProfile;
  readonly now?: () => number;
  readonly replay?: ReplayWindow;
  readonly verifySignature?: (envelope: T, domain: string) => Promise<boolean> | boolean;
  readonly authorize?: (envelope: CryptographicallyVerifiedEnvelope<T>) => Promise<boolean> | boolean;
}

/** Completes the typed zero-trust pipeline for callers that own identity and
 * authorization lookup. It never returns an object before replay is recorded. */
export async function validateRemoteEnvelope<T extends ProtocolEnvelopeShape>(value: unknown, options: ProtocolPipelineOptions<T> = {}): Promise<AuthorizedProtocolObject<T>> {
  const now = options.now ?? Date.now; const parsed = validateProtocolEnvelope<T>(value, { profile: options.profile, now: now() }); const domain = protocolSignatureDomain(parsed.envelope.type, parsed.envelope.version); const verify = options.verifySignature ? await options.verifySignature(parsed.envelope, domain) : false;
  if (!verify) throw new ProtocolSecurityError('INVALID_SIGNATURE');
  const verified: CryptographicallyVerifiedEnvelope<T> = { ...parsed, signatureVerified: true, signer: parsed.envelope.sender, signatureDomain: domain };
  const replayKey: ReplayKey = { sender: parsed.envelope.sender, nonce: parsed.envelope.nonce, messageId: parsed.envelope.id, objectType: parsed.envelope.type };
  const replay = options.replay ?? new ReplayWindow({ now }); if (!replay.checkAndRecord(replayKey)) throw new ProtocolSecurityError('REPLAY');
  if (options.authorize && !(await options.authorize(verified))) throw new ProtocolSecurityError('UNAUTHORIZED');
  return { ...verified, replayChecked: true, replayKey, authorized: true };
}

export interface RevisionRecord { readonly revision: number; readonly tombstoned?: boolean; readonly epoch?: number; }
/** Reusable monotonic guard for revocations, tombstones and membership epochs. */
export class MonotonicStateGuard {
  private readonly states = new Map<string, RevisionRecord>();
  constructor(private readonly maxEntries = 32_768) {}
  accept(id: string, next: RevisionRecord): boolean { if (!id || !Number.isSafeInteger(next.revision) || next.revision < 0 || (next.epoch !== undefined && (!Number.isSafeInteger(next.epoch) || next.epoch < 0))) return false; const current = this.states.get(id); if (current && (next.revision < current.revision || (next.revision === current.revision && !!next.tombstoned !== !!current.tombstoned) || (current.tombstoned && !next.tombstoned) || (current.epoch !== undefined && next.epoch !== undefined && next.epoch < current.epoch))) return false; if (!current && this.states.size >= this.maxEntries) return false; this.states.set(id, { ...next }); return true; }
  markTombstone(id: string, revision: number, epoch?: number): boolean { return this.accept(id, { revision, epoch, tombstoned: true }); }
  get(id: string): RevisionRecord | undefined { const value = this.states.get(id); return value && { ...value }; }
  isTombstoned(id: string): boolean { return this.states.get(id)?.tombstoned === true; }
  size(): number { return this.states.size; }
}

export interface StateTransition<S extends string, E extends string> { readonly from: S; readonly event: E; readonly to: S; }
export class ProtocolStateMachineGuard<S extends string, E extends string> {
  private state: S;
  constructor(initial: S, private readonly transitions: readonly StateTransition<S, E>[]) { this.state = initial; }
  current(): S { return this.state; }
  can(event: E, next: S): boolean { return this.transitions.some(value => value.from === this.state && value.event === event && value.to === next); }
  transition(event: E, next: S): S { if (!this.can(event, next)) throw new ProtocolSecurityError('STATE_VIOLATION', 'Protocol state transition is not allowed'); this.state = next; return this.state; }
  assert(event: E, next: S): void { if (!this.can(event, next)) throw new ProtocolSecurityError('STATE_VIOLATION', 'Protocol state transition is not allowed'); }
}

export interface PeerStrikeState { readonly peer: string; readonly strikes: number; readonly lastStrikeAt?: number; readonly quarantined: boolean; readonly disconnected: boolean; }
export interface NetworkResourceGovernorOptions { readonly limits?: Partial<ProtocolLimits>; readonly maxTrackedPeers?: number; readonly strikeThreshold?: number; readonly quarantineThreshold?: number; readonly now?: () => number; }
export interface NetworkSecurityMetrics { readonly rejectedMalformedFrames: number; readonly signatureFailures: number; readonly replayRejects: number; readonly staleRevisionRejects: number; readonly quotaRejects: number; readonly disconnectedHostilePeers: number; readonly protocolDowngradeRejects: number; readonly resourcePressureEvents: number; }
export type ResourceDecision = 'ALLOW' | 'REJECT' | 'DISCONNECT' | 'QUARANTINE';

/** Local-only resource governor. Unknown peers are intentionally bounded by
 * maxTrackedPeers; no identity is treated as scarce or human-unique. */
export class NetworkResourceGovernor {
  readonly limits: ProtocolLimits; private readonly maxTrackedPeers: number; private readonly strikeThreshold: number; private readonly quarantineThreshold: number; private readonly now: () => number; private readonly peers = new Map<string, { connections: number; attempts: number[]; frames: number[]; bytes: number[]; objects: number[]; pending: number; strikes: number; lastStrikeAt?: number; quarantined: boolean; disconnected: boolean }>(); private readonly metricsState: Record<keyof NetworkSecurityMetrics, number> = { rejectedMalformedFrames: 0, signatureFailures: 0, replayRejects: 0, staleRevisionRejects: 0, quotaRejects: 0, disconnectedHostilePeers: 0, protocolDowngradeRejects: 0, resourcePressureEvents: 0 };
  constructor(options: NetworkResourceGovernorOptions = {}) { this.limits = mergeLimits(DEFAULT_PROTOCOL_LIMITS, options.limits ?? {}); this.maxTrackedPeers = positiveInt(options.maxTrackedPeers ?? 4_096); this.strikeThreshold = positiveInt(options.strikeThreshold ?? 3); this.quarantineThreshold = positiveInt(options.quarantineThreshold ?? 5); this.now = options.now ?? Date.now; }
  admitConnection(peer: string): ResourceDecision { const state = this.state(peer); if (!state || state.quarantined || state.disconnected) return state?.quarantined ? 'QUARANTINE' : 'REJECT'; this.sweep(state); if (state.connections >= this.limits.connection.maxConnectionsPerPeer || state.attempts.length >= this.limits.connection.maxConnectionAttemptsPerWindow) return this.reject('quota'); state.attempts.push(this.now()); state.connections += 1; return 'ALLOW'; }
  releaseConnection(peer: string): void { const state = this.peers.get(peer); if (state) state.connections = Math.max(0, state.connections - 1); }
  admitFrame(peer: string, bytes: number): ResourceDecision { const state = this.state(peer); if (!state || state.quarantined || state.disconnected || !Number.isSafeInteger(bytes) || bytes < 0 || bytes > this.limits.maxFrameBytes) return 'REJECT'; this.sweep(state); if (state.frames.length >= this.limits.maxFramesPerSecond || sum(state.bytes) + bytes > Math.min(this.limits.bandwidth.maxBytesPerSecond, this.limits.bandwidth.burstBytes)) return this.reject('pressure', peer); state.frames.push(this.now()); state.bytes.push(bytes); return 'ALLOW'; }
  admitObject(peer: string, bytes: number): ResourceDecision { const state = this.state(peer); if (!state || state.quarantined || state.disconnected || bytes < 0 || bytes > this.limits.objects.maxObjectBytes) return 'REJECT'; this.sweep(state); if (state.objects.length >= this.limits.objects.maxObjectsPerWindow) return this.reject('quota', peer); state.objects.push(this.now()); if (bytes > this.limits.objects.maxObjectBytes) return this.reject('quota', peer); return 'ALLOW'; }
  reservePending(peer: string, kind: 'request' | 'invitation' | 'transfer' = 'request'): ResourceDecision { const state = this.state(peer); if (!state || state.quarantined || state.disconnected) return 'REJECT'; const limit = kind === 'request' ? this.limits.pending.maxPendingRequests : kind === 'invitation' ? this.limits.pending.maxPendingInvitations : this.limits.pending.maxConcurrentTransfers; if (state.pending >= limit) return this.reject('quota', peer); state.pending += 1; return 'ALLOW'; }
  releasePending(peer: string): void { const state = this.peers.get(peer); if (state) state.pending = Math.max(0, state.pending - 1); }
  strike(peer: string, reason: 'malformed' | 'signature' | 'replay' | 'stale' | 'downgrade' | 'quota' = 'malformed'): ResourceDecision { const state = this.state(peer); if (!state) return 'REJECT'; state.strikes += 1; state.lastStrikeAt = this.now(); if (reason === 'malformed') this.metricsState.rejectedMalformedFrames += 1; if (reason === 'signature') this.metricsState.signatureFailures += 1; if (reason === 'replay') this.metricsState.replayRejects += 1; if (reason === 'stale') this.metricsState.staleRevisionRejects += 1; if (reason === 'downgrade') this.metricsState.protocolDowngradeRejects += 1; if (reason === 'quota') this.metricsState.quotaRejects += 1; if (state.strikes >= this.quarantineThreshold) { state.quarantined = true; this.metricsState.resourcePressureEvents += 1; return 'QUARANTINE'; } if (state.strikes >= this.strikeThreshold) { state.disconnected = true; this.metricsState.disconnectedHostilePeers += 1; return 'DISCONNECT'; } return 'REJECT'; }
  isQuarantined(peer: string): boolean { return this.peers.get(peer)?.quarantined === true; }
  isDisconnected(peer: string): boolean { return this.peers.get(peer)?.disconnected === true; }
  peerState(peer: string): PeerStrikeState | undefined { const value = this.peers.get(peer); return value && { peer, strikes: value.strikes, ...(value.lastStrikeAt === undefined ? {} : { lastStrikeAt: value.lastStrikeAt }), quarantined: value.quarantined, disconnected: value.disconnected }; }
  metrics(): NetworkSecurityMetrics { return { ...this.metricsState }; }
  trackedPeers(): number { return this.peers.size; }
  private state(peer: string): { connections: number; attempts: number[]; frames: number[]; bytes: number[]; objects: number[]; pending: number; strikes: number; lastStrikeAt?: number; quarantined: boolean; disconnected: boolean } | undefined { if (!peer || peer.length > 256) return undefined; let state = this.peers.get(peer); if (state) return state; if (this.peers.size >= this.maxTrackedPeers) { this.metricsState.quotaRejects += 1; return undefined; } state = { connections: 0, attempts: [], frames: [], bytes: [], objects: [], pending: 0, strikes: 0, quarantined: false, disconnected: false }; this.peers.set(peer, state); return state; }
  private sweep(state: { attempts: number[]; frames: number[]; bytes: number[]; objects: number[] }): void { const now = this.now(); const frameCutoff = now - 1_000; const objectCutoff = now - this.limits.objects.windowMs; const retainedFrames: number[] = []; const retainedBytes: number[] = []; state.frames.forEach((value, index) => { if (value >= frameCutoff) { retainedFrames.push(value); retainedBytes.push(state.bytes[index] ?? 0); } }); state.frames = retainedFrames; state.bytes = retainedBytes; state.attempts = state.attempts.filter(value => value >= now - this.limits.connection.windowMs); state.objects = state.objects.filter(value => value >= objectCutoff); }
  private reject(kind: 'quota' | 'pressure', peer?: string): ResourceDecision { this.metricsState[kind === 'quota' ? 'quotaRejects' : 'resourcePressureEvents'] += 1; if (peer) return this.strike(peer, kind === 'quota' ? 'quota' : 'malformed'); return 'REJECT'; }
}

export interface FileChunkInput { readonly transferId: string; readonly objectId: string; readonly index: number; readonly totalChunks: number; readonly totalSize: number; readonly chunkSize: number; readonly contentHash: string; readonly bytes: Uint8Array; }
export interface FileTransferLimits { readonly maxChunkBytes: number; readonly maxFileBytes: number; readonly maxChunks: number; readonly maxParallelTransfers: number; }
export const DEFAULT_FILE_TRANSFER_LIMITS: FileTransferLimits = Object.freeze({ maxChunkBytes: 4 * 1024 * 1024, maxFileBytes: 4 * 1024 * 1024 * 1024, maxChunks: 1_048_576, maxParallelTransfers: 8 });
export function validateFileChunk(value: unknown, limits: FileTransferLimits = DEFAULT_FILE_TRANSFER_LIMITS): FileChunkInput {
  if (!value || typeof value !== 'object') throw new ProtocolSecurityError('INVALID_MESSAGE', 'File chunk is malformed'); const candidate = value as Partial<FileChunkInput>; const index = candidate.index; const totalChunks = candidate.totalChunks; const totalSize = candidate.totalSize; const chunkSize = candidate.chunkSize; const bytes = candidate.bytes; if (typeof candidate.transferId !== 'string' || typeof candidate.objectId !== 'string' || typeof candidate.contentHash !== 'string' || !(bytes instanceof Uint8Array) || !Number.isSafeInteger(index) || !Number.isSafeInteger(totalChunks) || !Number.isSafeInteger(totalSize) || !Number.isSafeInteger(chunkSize) || (index as number) < 0 || (totalChunks as number) < 1 || (totalChunks as number) > limits.maxChunks || (index as number) >= (totalChunks as number) || (totalSize as number) < 0 || (totalSize as number) > limits.maxFileBytes || (chunkSize as number) < 1 || (chunkSize as number) > limits.maxChunkBytes || bytes.byteLength > limits.maxChunkBytes || bytes.byteLength > (chunkSize as number) || !/^[a-f0-9]{64}$/i.test(candidate.contentHash)) throw new ProtocolSecurityError('OBJECT_TOO_LARGE', 'File chunk is outside the transfer budget'); return { ...candidate, index: index as number, totalChunks: totalChunks as number, totalSize: totalSize as number, chunkSize: chunkSize as number, bytes } as FileChunkInput;
}

export function validateCompressionMetadata(value: unknown, limits: ProtocolLimits = DEFAULT_PROTOCOL_LIMITS): void { if (value === undefined || value === null) return; if (!value || typeof value !== 'object') throw new ProtocolSecurityError('INVALID_MESSAGE', 'Compression metadata is malformed'); const candidate = value as Record<string, unknown>; if (candidate.algorithm !== 'none') throw new ProtocolSecurityError('PROTOCOL_DOWNGRADE', 'Compression is not enabled by this protocol profile'); if (candidate.declaredSize !== undefined && (!Number.isSafeInteger(candidate.declaredSize) || (candidate.declaredSize as number) < 0 || (candidate.declaredSize as number) > limits.maxDecompressedBytes)) throw new ProtocolSecurityError('OBJECT_TOO_LARGE', 'Decompression output exceeds the local budget'); }

export interface HostileInputResult { readonly accepted: boolean; readonly crashed: boolean; readonly errorCode?: string; }
export function generateHostileProtocolInputs(count = 64): readonly Uint8Array[] { const values: Uint8Array[] = [new Uint8Array(0), new Uint8Array([0xff, 0xfe, 0xfd]), new TextEncoder().encode('{'), new TextEncoder().encode('{"a":1,"a":2}'), new TextEncoder().encode(`[${'0,'.repeat(4_100)}0]`), new TextEncoder().encode('{"nested":'.concat('['.repeat(40), '0', ']'.repeat(40), '}'))]; const huge = new Uint8Array(4); new DataView(huge.buffer).setUint32(0, 0xffffffff); values.push(huge); const random = new Uint8Array(96); let state = 0x9e3779b9; for (let index = 0; index < random.length; index += 1) { state = Math.imul(state ^ (state >>> 15), 0x85ebca6b); random[index] = state & 0xff; } values.push(random); return Array.from({ length: Math.max(0, Math.min(count, 512)) }, (_, index) => values[index % values.length]!); }
export class ProtocolFuzzHarness {
  constructor(private readonly decoderFactory: () => BoundedFrameDecoder = () => new BoundedFrameDecoder()) {}
  run(inputs: readonly Uint8Array[] = generateHostileProtocolInputs()): readonly HostileInputResult[] { return inputs.map(input => { const decoder = this.decoderFactory(); try { decoder.push(input); return { accepted: true, crashed: false }; } catch (error) { return { accepted: false, crashed: false, ...(error instanceof ProtocolBoundsError || error instanceof ProtocolSecurityError ? { errorCode: error.code } : {}) }; } }); }
}
export class HostilePeerHarness {
  constructor(private readonly receiver: (input: Uint8Array) => Promise<unknown> | unknown) {}
  async send(inputs: readonly Uint8Array[]): Promise<readonly HostileInputResult[]> { const results: HostileInputResult[] = []; for (const input of inputs) { try { await this.receiver(input); results.push({ accepted: true, crashed: false }); } catch (error) { results.push({ accepted: false, crashed: false, ...(error instanceof ProtocolBoundsError || error instanceof ProtocolSecurityError ? { errorCode: error.code } : {}) }); } } return results; }
}

function mergeLimits(base: ProtocolLimits, patch: Partial<ProtocolLimits>): ProtocolLimits { return { ...base, ...patch, connection: { ...base.connection, ...(patch.connection ?? {}) }, objects: { ...base.objects, ...(patch.objects ?? {}) }, bandwidth: { ...base.bandwidth, ...(patch.bandwidth ?? {}) }, pending: { ...base.pending, ...(patch.pending ?? {}) } }; }
function positiveInt(value: number): number { if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Protocol limit must be a positive integer'); return value; }
function sum(values: readonly number[]): number { return values.reduce((total, value) => total + value, 0); }
