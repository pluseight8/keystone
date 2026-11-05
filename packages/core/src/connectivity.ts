/**
 * R0P67 Connectivity Fabric.
 *
 * The fabric is deliberately below application authorization and above
 * physical transports.  Providers only ever receive opaque protected bytes;
 * they do not receive Keystone object plaintext, content keys, profiles or
 * social identities.  R0P68+ can add discovery/relay implementations without
 * changing the application delivery API defined here.
 */

import type { NodeId } from './types.js';
import type { Envelope, EnvelopeSecurity, Transport } from './transport.js';
import { DEFAULT_PROTOCOL_SECURITY_PROFILE, parseBoundedJson, validateProtocolEnvelope } from './security/protocol-security.js';
import { canonicalJson } from './crypto.js';
import { LocalNetworkTransport, type LocalNetworkConnection } from '@keystone/native-host';
import { AdaptiveRouteOptimizer, type AdaptiveRouteOptimizerOptions, type RouteCandidate, type RouteOutcome, type RouteProviderMetadata } from './adaptive-route.js';

// Protocol frame types are re-exported from the Fabric boundary so application
// packages do not need to depend on the low-level Transport module merely to
// describe a signed delivery envelope.  The implementation remains below the
// Fabric and is intentionally not re-exported as a runtime constructor here.
export type { Envelope, EnvelopeSecurity, UnsignedEnvelope } from './transport.js';

// ---------------------------------------------------------------------------
// Typed connectivity and delivery model
// ---------------------------------------------------------------------------

export type ConnectivityState =
  | 'DEVICE_ONLY'
  | 'NEARBY'
  | 'LOCAL_NETWORK'
  | 'RESTRICTED_NETWORK'
  | 'GLOBAL_NETWORK'
  | 'NEARBY_MESH'
  | 'LONG_RANGE_MESH'
  | 'RELAYED_GLOBAL'
  | 'DELAY_TOLERANT';

export type ReachabilityClass = 'DIRECT' | 'RELAYED' | 'EVENTUALLY' | 'UNAVAILABLE' | 'UNKNOWN';
export type DeliveryLatencyClass = 'REALTIME' | 'INTERACTIVE' | 'EVENTUAL' | 'DELAY_TOLERANT' | 'UNKNOWN';
export type DeliveryAvailability = 'AVAILABLE' | 'TEMPORARILY_UNAVAILABLE' | 'UNAVAILABLE' | 'UNKNOWN';
export type DeliveryProfile = 'CONTROL' | 'INTERACTIVE' | 'REALTIME' | 'EVENTUAL' | 'BULK' | 'BACKGROUND' | 'BEST_EFFORT';

/**
 * Reachability is not a live session.  `isPeerConnected` observations are
 * bounded, best-effort hints for diagnostics and compatibility code only;
 * they are never an authorization decision, a delivery guarantee, or a
 * reason to synchronously block a local application operation.
 */

export interface ConnectivityStateSnapshot {
  readonly state: ConnectivityState;
  readonly reachability: ReachabilityClass;
  readonly internetAvailable: boolean | 'UNKNOWN';
  readonly localNetworkAvailable: boolean | 'UNKNOWN';
  readonly nearbyAvailable: boolean | 'UNKNOWN';
  readonly availableProviders: readonly TransportProviderId[];
  readonly observedAt: string;
}

/**
 * Canonical application delivery seam.
 *
 * Application and replication packages depend on this name rather than on a
 * physical transport implementation.  It is intentionally structurally
 * compatible with the historic Transport contract so controlled fixtures and
 * migration adapters can still be injected without weakening production
 * security.  Production hosts must provide a FabricTransport (or another
 * Fabric-backed implementation); low-level Transport remains a provider
 * implementation detail.
 */
export interface KeystoneDeliveryInterface extends Transport {}

export type TransportProviderId = string & { readonly __transportProviderId?: never };
export type TransportProviderType =
  | 'InternetTransport'
  | 'LocalNetworkTransport'
  | 'WiFiDirectTransport'
  | 'BluetoothTransport'
  | 'USBTransport'
  | 'ExternalRadioTransport'
  /** A bounded provider which accepts opaque parcels for later encounters. */
  | 'DelayTolerantTransport'
  /** A bounded opaque bridge between Keystone-compatible provider domains. */
  | 'GatewayMeshTransport'
  | 'ControlledTransport';

export type TransportCapability =
  | 'DIRECT'
  | 'DISCOVERY'
  | 'STREAM'
  | 'DATAGRAM'
  | 'BROADCAST'
  | 'CONTROL'
  | 'INTERACTIVE'
  | 'REALTIME'
  | 'BULK'
  | 'LOW_BANDWIDTH'
  | 'LONG_RANGE'
  | 'METERED'
  | 'BACKGROUND'
  | 'SMALL_MTU'
  | 'LOCAL_ONLY'
  /** The provider carries opaque frames over bounded anonymous multi-hop
   * circuits.  This is a capability marker, not an application routing
   * selector or a trust signal. */
  | 'MESH'
  | 'GLOBAL_REACH'
  | 'STORE_FORWARD_FUTURE';

export type TransportAvailability = 'AVAILABLE' | 'DEGRADED' | 'UNAVAILABLE' | 'UNSUPPORTED' | 'UNKNOWN';
export type TransportHealthState = 'HEALTHY' | 'DEGRADED' | 'FAILED' | 'UNKNOWN';
export type TransportCostClass = 'FREE' | 'METERED' | 'UNKNOWN';
export type TransportEnergyClass = 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN';
export type TransportMTU = number | 'UNKNOWN';

export interface TransportHealth {
  readonly state: TransportHealthState;
  readonly availability: TransportAvailability;
  readonly checkedAt: string;
  readonly reason?: string;
}

export interface TransportMetrics {
  readonly rttMs?: number;
  readonly lossRatio?: number;
  readonly throughputBytesPerSecond?: number;
  readonly stability?: number;
  readonly signalQuality?: number | 'UNKNOWN';
  readonly mtu: TransportMTU;
  readonly queuePressure?: number;
  readonly cost: TransportCostClass;
  readonly energy: TransportEnergyClass;
  readonly metered: boolean | 'UNKNOWN';
  readonly phy?: 'LE_1M' | 'LE_2M' | 'LE_CODED' | 'UNKNOWN';
  readonly observedAt: string;
}

export interface HostConnectivitySignals { readonly battery?: 'CRITICAL' | 'LOW' | 'NORMAL' | 'FULL' | 'UNKNOWN'; readonly charging?: boolean | 'UNKNOWN'; readonly thermal?: 'NOMINAL' | 'FAIR' | 'SERIOUS' | 'CRITICAL' | 'UNKNOWN'; readonly cpuUtilization?: number; readonly gpuUtilization?: number; readonly ramPressure?: number; readonly vramPressure?: number; readonly foregroundHeavyApp?: boolean; }
export interface ConnectivityResourcePolicy { readonly suppressDiscoveryOnCriticalBattery?: boolean; readonly maxConcurrentTransfers?: number; readonly maxPendingSessions?: number; }
export class ConnectivityResourceGovernor {
  private signals: HostConnectivitySignals = {};
  constructor(private readonly policy: ConnectivityResourcePolicy = {}) {}
  update(signals: HostConnectivitySignals): void { this.signals = { ...signals }; }
  snapshot(): HostConnectivitySignals { return { ...this.signals }; }
  allowsBackgroundDiscovery(): boolean { return !(this.policy.suppressDiscoveryOnCriticalBattery !== false && (this.signals.battery === 'CRITICAL' || this.signals.thermal === 'CRITICAL')); }
  maxConcurrentTransfers(): number { return Math.max(1, Math.min(64, this.policy.maxConcurrentTransfers ?? 8)); }
}

/**
 * An endpoint is a transport route handle, never a social identity.  The
 * opaque routeReference is provider-owned and may expire.  It must not be
 * used as a Profile, contact, device or authorization lookup key.
 */
export interface TransportEndpoint {
  readonly handle: string;
  readonly providerId: TransportProviderId;
  readonly providerType: TransportProviderType;
  readonly routeReference: string;
  readonly expiresAt?: string;
  readonly anonymous: true;
}
export type TransportEndpointHandle = TransportEndpoint;

export interface TransportSession {
  readonly id: string;
  readonly endpoint: TransportEndpoint;
  readonly providerId: TransportProviderId;
  readonly openedAt: string;
  readonly state: 'OPEN' | 'CLOSED';
}

export interface DeliveryRequirement {
  readonly profile: DeliveryProfile;
  readonly maxLatencyMs?: number;
  readonly allowMetered?: boolean;
  readonly allowHighEnergy?: boolean;
  readonly requireDirect?: boolean;
  readonly maxAttempts?: number;
  /** Explicitly permits local acceptance for a future route.  Realtime and
   * ordinary interactive traffic remain live-route only unless this bit is
   * set by the delivery policy. */
  readonly allowDelayTolerant?: boolean;
}

export interface OpaqueDeliveryEnvelope {
  readonly id: string;
  readonly protocolVersion: 1;
  /** Opaque routing reference. It is not interpreted as an application ID. */
  readonly destination: string;
  /** Base64url ciphertext/protected Keystone envelope, never plaintext. */
  readonly ciphertext: string;
  readonly integrity: string;
  readonly replayNonce: string;
  readonly expiresAt: string;
  readonly requirement: DeliveryRequirement;
}

export interface CreateOpaqueDeliveryEnvelopeInput {
  readonly id?: string;
  readonly destination: string;
  readonly ciphertext: Uint8Array | string;
  readonly replayNonce: string;
  readonly expiresAt: string;
  readonly requirement: DeliveryRequirement;
}

export interface OpaqueDeliveryFragment {
  readonly kind: 'fragment';
  readonly transferId: string;
  readonly envelopeId: string;
  readonly index: number;
  readonly count: number;
  readonly payload: string;
  readonly integrity: string;
  readonly expiresAt: string;
}
export type OpaqueFrame = OpaqueDeliveryEnvelope | OpaqueDeliveryFragment;

export interface DeliveryRequest {
  readonly id: string;
  readonly destination: string;
  readonly envelope: OpaqueDeliveryEnvelope;
  readonly requirement: DeliveryRequirement;
  readonly createdAt?: string;
}

export type DeliveryPathClass = 'INTERNET' | 'LOCAL_NETWORK' | 'WIFI_DIRECT' | 'BLUETOOTH' | 'USB' | 'EXTERNAL_RADIO' | 'DELAY_TOLERANT' | 'RELAYED_GLOBAL' | 'CONTROLLED' | 'UNKNOWN';
export type DeliveryFailureCode = 'TRANSPORT_UNAVAILABLE' | 'NO_COMPATIBLE_TRANSPORT' | 'SESSION_FAILED' | 'TIMEOUT' | 'MTU_EXCEEDED' | 'RESOURCE_LIMIT' | 'POLICY_DENIED' | 'CAPABILITY_EXPIRED' | 'TEMPORARILY_UNAVAILABLE' | 'DELIVERY_UNCONFIRMED' | 'CANCELLED';
export interface DeliveryFailure { readonly code: DeliveryFailureCode; readonly providerId?: TransportProviderId; readonly message: string; }
export interface DeliveryAttempt { readonly providerId: TransportProviderId; readonly path: DeliveryPathClass; readonly startedAt: string; readonly endedAt: string; readonly ok: boolean; readonly failure?: DeliveryFailure; readonly fragments: number; }
export interface DeliveryReceipt { readonly requestId: string; readonly envelopeId: string; readonly providerId: TransportProviderId; readonly acceptedAt: string; readonly path: DeliveryPathClass; }
export interface DeliveryResult { readonly ok: boolean; readonly requestId: string; readonly availability: DeliveryAvailability; readonly reachability: ReachabilityClass; readonly attempts: readonly DeliveryAttempt[]; readonly receipt?: DeliveryReceipt; readonly failure?: DeliveryFailure; }
export interface ReachabilityResult { readonly destination: string; readonly reachability: ReachabilityClass; readonly availability: DeliveryAvailability; readonly state: ConnectivityState; readonly providers: readonly TransportProviderId[]; readonly checkedAt: string; readonly reason?: string; }

export interface ConnectivitySession extends TransportSession { readonly requestId?: string; }
export interface ConnectivityEvent {
  readonly type: 'provider_available' | 'provider_unavailable' | 'metrics_changed' | 'session_opened' | 'session_closed' | 'reachability_changed' | 'delivery_state' | 'resource_pressure';
  readonly at: string;
  readonly providerId?: TransportProviderId;
  readonly sessionId?: string;
  readonly requestId?: string;
  readonly state?: string;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}
export class ConnectivityError extends Error {
  constructor(readonly code: DeliveryFailureCode, message: string) { super(message); this.name = 'ConnectivityError'; }
}

export interface TransportSecurityBoundary {
  /** True only when the provider receives protected bytes and no keys. */
  readonly opaqueOnly: true;
  readonly e2eRequired: true;
  readonly canDecrypt: false;
  readonly canAuthorize: false;
}

export interface TransportProvider {
  readonly id: TransportProviderId;
  readonly type: TransportProviderType;
  readonly security: TransportSecurityBoundary;
  readonly mtu: TransportMTU;
  probe(): Promise<TransportAvailability>;
  start(): Promise<void>;
  stop(): Promise<void>;
  health(): TransportHealth;
  capabilities(): readonly TransportCapability[];
  /** Optional coarse route metadata. It is consumed only by the local
   * AdaptiveRouteOptimizer and must never contain peer/social identities or
   * a physical topology. */
  routeMetadata?(): RouteProviderMetadata;
  /** Optional live-session observation used by compatibility queues. It is a
   * connectivity hint only; delivery still performs a Fabric route attempt. */
  isPeerConnected?(destination: string): boolean;
  discoverDirectReachability(destination: string, requirement?: DeliveryRequirement): Promise<readonly TransportEndpoint[]>;
  openSession(endpoint: TransportEndpoint): Promise<TransportSession>;
  sendOpaqueFrame(session: TransportSession, frame: OpaqueFrame): Promise<void>;
  /** Optional bounded local acceptance for a future route.  This is the only
   * provider hook that can report eventual delivery without claiming a live
   * session.  Applications never call it directly; ConnectivityFabric owns
   * provider selection. */
  queueOpaqueDelivery?(request: DeliveryRequest): Promise<DeliveryResult>;
  receiveOpaqueFrame(handler: (frame: OpaqueFrame, session?: TransportSession) => void | Promise<void>): () => void;
  measureLink(session?: TransportSession): Promise<TransportMetrics>;
  close(session: TransportSession): Promise<void>;
}

const OPAQUE_SECURITY: TransportSecurityBoundary = Object.freeze({ opaqueOnly: true, e2eRequired: true, canDecrypt: false, canAuthorize: false });
const nowIso = (): string => new Date().toISOString();
const randomId = (prefix: string): string => `${prefix}:${crypto.randomUUID()}`;
const MAX_SEEN_ENVELOPES = 32_768;
function seenKeyForEnvelope(envelope: Pick<OpaqueDeliveryEnvelope, 'id' | 'destination' | 'integrity'>): string { return `${envelope.id}\u0000${envelope.destination}\u0000${envelope.integrity}`; }
const asProviderId = (value: string): TransportProviderId => value as TransportProviderId;

/** R0P67-only diagnostics. Disabled unless explicitly requested by the real
 * network harness; this must never turn timing into routing behavior. */
function networkDiagnostic(event: string, fields: Readonly<Record<string, unknown>> = {}): void {
  if ((globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.KEYSTONE_NETWORK_TIMELINE !== '1') return;
  const payload = Object.entries(fields).map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`).join(' ');
  console.error(`[R0P67-TIMELINE] ${nowIso()} ${event}${payload ? ` ${payload}` : ''}`);
}

function pathClass(type: TransportProviderType): DeliveryPathClass {
  switch (type) {
    case 'InternetTransport': return 'INTERNET';
    case 'LocalNetworkTransport': return 'LOCAL_NETWORK';
    case 'WiFiDirectTransport': return 'WIFI_DIRECT';
    case 'BluetoothTransport': return 'BLUETOOTH';
    case 'USBTransport': return 'USB';
    case 'ExternalRadioTransport': return 'EXTERNAL_RADIO';
    case 'DelayTolerantTransport': return 'DELAY_TOLERANT';
    case 'GatewayMeshTransport': return 'RELAYED_GLOBAL';
    case 'ControlledTransport': return 'CONTROLLED';
  }
}

function profileCapabilities(profile: DeliveryProfile): readonly TransportCapability[] {
  switch (profile) {
    case 'CONTROL': return ['CONTROL'];
    case 'INTERACTIVE': return ['INTERACTIVE'];
    case 'REALTIME': return ['REALTIME'];
    case 'BULK': return ['BULK', 'STREAM'];
    case 'EVENTUAL': return [];
    case 'BACKGROUND': return ['BACKGROUND'];
    case 'BEST_EFFORT': return [];
  }
}

function requirementFor(request: DeliveryRequest): DeliveryRequirement {
  return { ...request.requirement, profile: request.requirement.profile ?? request.envelope.requirement.profile };
}

function supports(provider: TransportProvider, requirement: DeliveryRequirement): boolean {
  try {
    const available = provider.health().availability;
    if (available !== 'AVAILABLE' && available !== 'DEGRADED') return false;
    const capabilities = new Set(provider.capabilities());
    if (requirement.requireDirect && !capabilities.has('DIRECT')) return false;
    if (profileCapabilities(requirement.profile).some(capability => !capabilities.has(capability))) return false;
    if (!requirement.allowMetered && capabilities.has('METERED')) return false;
    return true;
  } catch {
    // A broken provider is isolated as unavailable; it cannot poison the
    // optimizer or make another secure provider unusable.
    return false;
  }
}

function safeCapabilities(provider: TransportProvider): readonly TransportCapability[] {
  try { return provider.capabilities(); } catch { return []; }
}

function bytesToBase64(value: Uint8Array): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(value).toString('base64url');
  let binary = ''; for (const byte of value) binary += String.fromCharCode(byte); return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function base64ToBytes(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) throw new ConnectivityError('MTU_EXCEEDED', 'Opaque payload encoding is invalid');
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(value, 'base64url'));
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')); return Uint8Array.from(binary, char => char.charCodeAt(0));
}
function utf8(value: string): Uint8Array { return new TextEncoder().encode(value); }
function text(value: Uint8Array): string { return new TextDecoder().decode(value); }
export function encodeOpaqueBytes(value: Uint8Array): string { return bytesToBase64(value); }
export function decodeOpaqueBytes(value: string): Uint8Array { return base64ToBytes(value); }

/** Build the only supported form of an opaque envelope.  The integrity hash
 * authenticates the ciphertext bytes; it is not a substitute for Keystone
 * application signatures or encryption. */
export async function createOpaqueDeliveryEnvelope(input: CreateOpaqueDeliveryEnvelopeInput): Promise<OpaqueDeliveryEnvelope> {
  if (!input.destination || !input.replayNonce || !Number.isFinite(Date.parse(input.expiresAt)) || Date.parse(input.expiresAt) <= Date.now()) throw new ConnectivityError('POLICY_DENIED', 'Opaque delivery envelope input is invalid');
  const ciphertext = typeof input.ciphertext === 'string' ? input.ciphertext : bytesToBase64(input.ciphertext);
  if (!ciphertext) throw new ConnectivityError('POLICY_DENIED', 'Opaque ciphertext cannot be empty');
  const envelope = { id: input.id ?? randomId('delivery'), protocolVersion: 1 as const, destination: input.destination, ciphertext, integrity: `sha256:${await digestString(ciphertext)}`, replayNonce: input.replayNonce, expiresAt: input.expiresAt, requirement: { ...input.requirement } };
  validateOpaqueDeliveryEnvelope(envelope);
  return envelope;
}

/** Stable, bounded wire representation. It includes only opaque ciphertext. */
export function encodeOpaqueFrame(frame: OpaqueFrame): Uint8Array {
  if (isOpaqueEnvelope(frame)) validateOpaqueDeliveryEnvelope(frame);
  const value = isOpaqueEnvelope(frame) ? { kind: 'envelope', envelope: frame } : frame;
  return utf8(JSON.stringify(value));
}
export function decodeOpaqueFrame(bytes: Uint8Array): OpaqueFrame {
  if (bytes.byteLength > 16 * 1024 * 1024) throw new ConnectivityError('RESOURCE_LIMIT', 'Opaque frame exceeds the protocol bound');
  let value: unknown; try { value = JSON.parse(text(bytes)); } catch { throw new ConnectivityError('SESSION_FAILED', 'Opaque frame is not valid JSON'); }
  if (!value || typeof value !== 'object') throw new ConnectivityError('SESSION_FAILED', 'Opaque frame is malformed');
  const candidate = value as Record<string, unknown>;
  if (candidate.kind === 'envelope' && candidate.envelope && typeof candidate.envelope === 'object') { validateOpaqueDeliveryEnvelope(candidate.envelope); return candidate.envelope as OpaqueDeliveryEnvelope; }
  if (candidate.kind === 'fragment') { validateOpaqueFragment(candidate); return candidate as unknown as OpaqueDeliveryFragment; }
  throw new ConnectivityError('SESSION_FAILED', 'Unknown opaque frame kind');
}
function isOpaqueEnvelope(value: OpaqueFrame): value is OpaqueDeliveryEnvelope { return !('kind' in value); }
function validateOpaqueDeliveryEnvelope(value: unknown): asserts value is OpaqueDeliveryEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ConnectivityError('POLICY_DENIED', 'Opaque delivery envelope is malformed');
  const item = value as Record<string, unknown>;
  if (item.protocolVersion !== 1 || typeof item.id !== 'string' || !boundedOpaqueIdentifier(item.id, 256) || typeof item.destination !== 'string' || !boundedOpaqueIdentifier(item.destination, 256) || typeof item.ciphertext !== 'string' || !item.ciphertext || typeof item.integrity !== 'string' || typeof item.replayNonce !== 'string' || !boundedOpaqueIdentifier(item.replayNonce, 256) || typeof item.expiresAt !== 'string' || !item.requirement || typeof item.requirement !== 'object' || Array.isArray(item.requirement)) throw new ConnectivityError('POLICY_DENIED', 'Opaque delivery envelope is incomplete');
  const expiresAt = Date.parse(item.expiresAt as string); const now = Date.now();
  if (!Number.isFinite(expiresAt) || expiresAt <= now) throw new ConnectivityError('TIMEOUT', 'Opaque delivery envelope is expired');
  if (expiresAt - now > DEFAULT_PROTOCOL_SECURITY_PROFILE.limits.maxLifetimeMs) throw new ConnectivityError('POLICY_DENIED', 'Opaque delivery envelope lifetime exceeds the protocol bound');
  if (item.ciphertext.length > Math.ceil((DEFAULT_PROTOCOL_SECURITY_PROFILE.limits.maxEnvelopeBytes * 4) / 3) + 8 || !/^[A-Za-z0-9_-]+$/.test(item.ciphertext as string)) throw new ConnectivityError('RESOURCE_LIMIT', 'Opaque ciphertext exceeds the protocol bound');
  if (!/^sha256:[A-Za-z0-9_-]+$/.test(item.integrity as string)) throw new ConnectivityError('POLICY_DENIED', 'Opaque envelope integrity is missing or malformed');
  const forbidden = ['plaintext', 'contentKey', 'privateKey', 'profile', 'username', 'socialIdentity', 'gps', 'secret'];
  for (const key of Object.keys(item)) if (forbidden.includes(key)) throw new ConnectivityError('POLICY_DENIED', `Forbidden clear transport field: ${key}`);
  const requirement = item.requirement as Record<string, unknown>; if (!isDeliveryProfile(requirement.profile)) throw new ConnectivityError('POLICY_DENIED', 'Delivery profile is required');
  for (const key of ['allowMetered', 'allowHighEnergy', 'requireDirect', 'allowDelayTolerant']) if (requirement[key] !== undefined && typeof requirement[key] !== 'boolean') throw new ConnectivityError('POLICY_DENIED', 'Delivery requirement contains an invalid policy flag');
  for (const key of ['maxLatencyMs', 'maxAttempts']) if (requirement[key] !== undefined && (!Number.isSafeInteger(requirement[key]) || (requirement[key] as number) < 0)) throw new ConnectivityError('POLICY_DENIED', 'Delivery requirement contains an invalid bound');
  if (requirement.maxAttempts !== undefined && (requirement.maxAttempts as number) > 8) throw new ConnectivityError('RESOURCE_LIMIT', 'Delivery attempt bound exceeds the protocol limit');
}
function boundedOpaqueIdentifier(value: unknown, max: number): value is string { return typeof value === 'string' && value.length > 0 && value.length <= max && /^[A-Za-z0-9:_-]+$/.test(value); }
function isDeliveryProfile(value: unknown): value is DeliveryProfile { return value === 'CONTROL' || value === 'INTERACTIVE' || value === 'REALTIME' || value === 'EVENTUAL' || value === 'BULK' || value === 'BACKGROUND' || value === 'BEST_EFFORT'; }
function validateOpaqueFragment(value: unknown): asserts value is OpaqueDeliveryFragment {
  const item = value as Record<string, unknown>;
  const index = item.index; const count = item.count;
  if (item.kind !== 'fragment' || typeof item.transferId !== 'string' || typeof item.envelopeId !== 'string' || !Number.isSafeInteger(index) || !Number.isSafeInteger(count) || (index as number) < 0 || (count as number) < 1 || (count as number) > 4_096 || (index as number) >= (count as number) || typeof item.payload !== 'string' || typeof item.integrity !== 'string' || typeof item.expiresAt !== 'string') throw new ConnectivityError('RESOURCE_LIMIT', 'Opaque fragment is malformed or exceeds bounds');
  if (Date.parse(item.expiresAt as string) <= Date.now()) throw new ConnectivityError('TIMEOUT', 'Opaque fragment is expired');
}

async function digest(value: Uint8Array): Promise<string> { const hash = await crypto.subtle.digest('SHA-256', value as unknown as ArrayBuffer); return bytesToBase64(new Uint8Array(hash)); }
async function digestString(value: string): Promise<string> { return digest(utf8(value)); }
async function verifyOpaqueIntegrity(envelope: OpaqueDeliveryEnvelope): Promise<void> { const expected = `sha256:${await digestString(envelope.ciphertext)}`; if (envelope.integrity !== expected) throw new ConnectivityError('POLICY_DENIED', 'Opaque envelope integrity check failed'); }

/** Create bounded fragments without changing the logical envelope identity. */
export async function fragmentOpaqueEnvelope(envelope: OpaqueDeliveryEnvelope, mtu: number, maxFragments = 4_096): Promise<readonly OpaqueDeliveryFragment[]> {
  validateOpaqueDeliveryEnvelope(envelope); if (!Number.isSafeInteger(mtu) || mtu < 256) throw new ConnectivityError('MTU_EXCEEDED', 'Transport MTU is too small');
  const encoded = encodeOpaqueFrame(envelope); const payloadSize = Math.max(1, mtu - 512); const count = Math.ceil(encoded.byteLength / payloadSize); if (count > maxFragments) throw new ConnectivityError('RESOURCE_LIMIT', 'Fragment count exceeds the local bound');
  const transferId = randomId('transfer'); const fragments: OpaqueDeliveryFragment[] = [];
  for (let index = 0; index < count; index += 1) { const chunk = encoded.subarray(index * payloadSize, Math.min(encoded.byteLength, (index + 1) * payloadSize)); const payload = bytesToBase64(chunk); fragments.push({ kind: 'fragment', transferId, envelopeId: envelope.id, index, count, payload, integrity: await digest(chunk), expiresAt: envelope.expiresAt }); }
  return fragments;
}

export class OpaqueFragmentReassembler {
  private readonly transfers = new Map<string, { envelopeId: string; count: number; expiresAt: number; bytes: number; values: Map<number, Uint8Array> }>();
  constructor(private readonly options: { readonly maxTransfers?: number; readonly maxBytes?: number; readonly now?: () => number } = {}) {}
  async add(fragment: OpaqueDeliveryFragment): Promise<OpaqueDeliveryEnvelope | undefined> {
    validateOpaqueFragment(fragment); this.sweep(); const maxTransfers = this.options.maxTransfers ?? 64; const maxBytes = this.options.maxBytes ?? 32 * 1024 * 1024;
    let state = this.transfers.get(fragment.transferId); if (!state) { if (this.transfers.size >= maxTransfers) throw new ConnectivityError('RESOURCE_LIMIT', 'Too many pending fragment transfers'); state = { envelopeId: fragment.envelopeId, count: fragment.count, expiresAt: Date.parse(fragment.expiresAt), bytes: 0, values: new Map() }; this.transfers.set(fragment.transferId, state); }
    if (state.envelopeId !== fragment.envelopeId || state.count !== fragment.count) throw new ConnectivityError('POLICY_DENIED', 'Fragment transfer metadata changed');
    if (state.values.has(fragment.index)) return undefined;
    if (fragment.payload.length > Math.ceil((maxBytes * 4) / 3) + 8) throw new ConnectivityError('RESOURCE_LIMIT', 'Fragment payload exceeds the local bound');
    const bytes = base64ToBytes(fragment.payload); if (await digest(bytes) !== fragment.integrity) throw new ConnectivityError('POLICY_DENIED', 'Fragment integrity check failed'); if (bytes.byteLength > maxBytes - state.bytes) throw new ConnectivityError('RESOURCE_LIMIT', 'Fragment reassembly memory bound exceeded');
    state.bytes += bytes.byteLength; state.values.set(fragment.index, bytes); if (state.values.size !== state.count) return undefined;
    const joined = new Uint8Array(state.bytes); let offset = 0; for (let index = 0; index < state.count; index += 1) { const chunk = state.values.get(index); if (!chunk) throw new ConnectivityError('SESSION_FAILED', 'Fragment is missing'); joined.set(chunk, offset); offset += chunk.byteLength; }
    this.transfers.delete(fragment.transferId); const frame = decodeOpaqueFrame(joined); if (!isOpaqueEnvelope(frame) || frame.id !== fragment.envelopeId) throw new ConnectivityError('POLICY_DENIED', 'Reassembled envelope identity mismatch'); return frame;
  }
  clear(): void { this.transfers.clear(); }
  pending(): number { this.sweep(); return this.transfers.size; }
  private sweep(): void { const now = (this.options.now ?? Date.now)(); for (const [id, state] of this.transfers) if (!Number.isFinite(state.expiresAt) || state.expiresAt <= now) this.transfers.delete(id); }
}

// ---------------------------------------------------------------------------
// Provider implementations
// ---------------------------------------------------------------------------

abstract class BaseTransportProvider implements TransportProvider {
  readonly security = OPAQUE_SECURITY;
  protected readonly listeners = new Set<(frame: OpaqueFrame, session?: TransportSession) => void | Promise<void>>();
  protected readonly sessions = new Map<string, TransportSession>();
  protected availability: TransportAvailability;
  protected checkedAt = nowIso();
  constructor(readonly id: TransportProviderId, readonly type: TransportProviderType, readonly mtu: TransportMTU, availability: TransportAvailability, private readonly caps: readonly TransportCapability[]) { this.availability = availability; }
  async probe(): Promise<TransportAvailability> { return this.availability; }
  async start(): Promise<void> { if (this.availability !== 'UNSUPPORTED') this.availability = this.availability === 'UNKNOWN' ? 'AVAILABLE' : this.availability; this.checkedAt = nowIso(); }
  async stop(): Promise<void> { for (const session of this.sessions.values()) await this.close(session); }
  health(): TransportHealth { return { state: this.availability === 'AVAILABLE' ? 'HEALTHY' : this.availability === 'DEGRADED' ? 'DEGRADED' : this.availability === 'UNSUPPORTED' || this.availability === 'UNAVAILABLE' ? 'FAILED' : 'UNKNOWN', availability: this.availability, checkedAt: this.checkedAt }; }
  capabilities(): readonly TransportCapability[] { return this.caps; }
  receiveOpaqueFrame(handler: (frame: OpaqueFrame, session?: TransportSession) => void | Promise<void>): () => void { this.listeners.add(handler); return () => this.listeners.delete(handler); }
  protected emit(frame: OpaqueFrame, session?: TransportSession): void { for (const listener of this.listeners) void listener(frame, session); }
  protected makeSession(endpoint: TransportEndpoint): TransportSession { const session = { id: randomId('session'), endpoint, providerId: this.id, openedAt: nowIso(), state: 'OPEN' as const }; this.sessions.set(session.id, session); return session; }
  async measureLink(): Promise<TransportMetrics> { return { mtu: this.mtu, cost: this.caps.includes('METERED') ? 'METERED' : 'UNKNOWN', energy: this.caps.includes('LOW_BANDWIDTH') ? 'LOW' : 'UNKNOWN', metered: this.caps.includes('METERED'), observedAt: nowIso() }; }
  abstract discoverDirectReachability(destination: string, requirement?: DeliveryRequirement): Promise<readonly TransportEndpoint[]>;
  abstract openSession(endpoint: TransportEndpoint): Promise<TransportSession>;
  abstract sendOpaqueFrame(session: TransportSession, frame: OpaqueFrame): Promise<void>;
  async close(session: TransportSession): Promise<void> { this.sessions.delete(session.id); }
}

export interface HyperswarmTransportProviderOptions { readonly providerId?: string; readonly sender: NodeId; readonly security: EnvelopeSecurity; readonly ownsTransport?: boolean; readonly now?: () => number; }
/** Adapter over the existing signed/replay-protected Hyperswarm Transport. */
export class HyperswarmTransportProvider extends BaseTransportProvider {
  private readonly unsubscribe: () => void;
  private readonly now: () => number;
  private readonly routes = new Map<string, string>();
  private readonly failedRoutes = new Map<string, number>();
  constructor(private readonly transport: Transport, private readonly options: HyperswarmTransportProviderOptions) {
    super(asProviderId(options.providerId ?? 'internet-hyperswarm'), 'InternetTransport', 16 * 1024 * 1024, 'AVAILABLE', ['DIRECT', 'STREAM', 'DATAGRAM', 'CONTROL', 'INTERACTIVE', 'REALTIME', 'BULK', 'BACKGROUND', 'GLOBAL_REACH']);
    this.now = options.now ?? Date.now;
    this.unsubscribe = transport.onMessage(envelope => { void this.receive(envelope); });
  }
  async start(): Promise<void> { await (this.transport as Transport & { start?: () => Promise<void> }).start?.(); await super.start(); }
  async stop(): Promise<void> { this.unsubscribe(); await super.stop(); if (this.options.ownsTransport) await this.transport.close(); }
  isPeerConnected(destination: string): boolean { return this.transport.isPeerConnected?.(destination) ?? false; }
  async discoverDirectReachability(destination: string): Promise<readonly TransportEndpoint[]> {
    if (!destination) return [];
    const failedUntil = this.failedRoutes.get(destination);
    if (failedUntil !== undefined) { if (failedUntil > this.now()) return []; this.failedRoutes.delete(destination); }
    const handle = randomId('endpoint'); this.routes.set(handle, destination); return [{ handle, providerId: this.id, providerType: this.type, routeReference: randomId('route'), anonymous: true }];
  }
  async openSession(endpoint: TransportEndpoint): Promise<TransportSession> {
    const destination = this.routes.get(endpoint.handle); if (!destination) throw new ConnectivityError('TRANSPORT_UNAVAILABLE', 'Hyperswarm endpoint has expired');
    if (this.transport.isPeerConnected?.(destination)) { networkDiagnostic('provider.connect.skip-live', { provider: this.id, destination }); return this.makeSession({ ...endpoint, routeReference: destination }); }
    const started = Date.now(); networkDiagnostic('provider.connect.start', { provider: this.id, destination });
    try { await this.transport.connect(destination); this.failedRoutes.delete(destination); networkDiagnostic('provider.connect.ok', { provider: this.id, destination, durationMs: Date.now() - started }); }
    catch (error) { this.failedRoutes.set(destination, this.now() + 5_000); networkDiagnostic('provider.connect.failure', { provider: this.id, destination, durationMs: Date.now() - started, message: error instanceof Error ? error.message : String(error) }); throw error; }
    return this.makeSession({ ...endpoint, routeReference: destination });
  }
  async sendOpaqueFrame(session: TransportSession, frame: OpaqueFrame): Promise<void> {
    if (!this.sessions.has(session.id)) throw new ConnectivityError('SESSION_FAILED', 'Hyperswarm session is closed');
    const destination = session.endpoint.routeReference; const unsigned: Omit<Envelope, 'signature'> = { version: 1, type: 'connectivity.opaque', id: randomId('envelope'), sender: this.options.sender, recipient: destination, nonce: randomId('nonce'), expiresAt: new Date(this.now() + 60_000).toISOString(), body: { wireVersion: 1, frame: bytesToBase64(encodeOpaqueFrame(frame)) } };
    const envelope: Envelope = { ...unsigned, signature: await this.options.security.sign(unsigned) }; await this.transport.send(destination, envelope);
  }
  private async receive(envelope: Envelope): Promise<void> { if (envelope.type !== 'connectivity.opaque' || !envelope.body || typeof envelope.body !== 'object') return; if (envelope.recipient !== this.options.sender || !(await this.options.security.verify(envelope))) return; const body = envelope.body as Record<string, unknown>; if (body.wireVersion !== 1 || typeof body.frame !== 'string') return; try { const frame = decodeOpaqueFrame(base64ToBytes(body.frame)); this.emit(frame); } catch { /* malformed opaque frames are rejected by the provider */ } }
}

export interface LocalNetworkTransportProviderOptions { readonly providerId?: string; readonly transport?: LocalNetworkTransport; readonly endpoints?: Readonly<Record<string, { readonly host: string; readonly port: number }>>; readonly mtu?: number; }
/** Infrastructure Wi-Fi and Ethernet share this single provider. */
export class LocalNetworkTransportProvider extends BaseTransportProvider {
  private readonly transport: LocalNetworkTransport;
  private readonly endpoints: Readonly<Record<string, { readonly host: string; readonly port: number }>>;
  private readonly connections = new Map<string, LocalNetworkConnection>();
  private readonly incomingSessions = new Map<string, TransportSession>();
  private readonly routes = new Map<string, { readonly host: string; readonly port: number }>();
  private listener?: { readonly close: () => Promise<void>; readonly port: number };
  constructor(options: LocalNetworkTransportProviderOptions = {}) { super(asProviderId(options.providerId ?? 'local-network'), 'LocalNetworkTransport', options.mtu ?? 64 * 1024, 'AVAILABLE', ['DIRECT', 'STREAM', 'DATAGRAM', 'CONTROL', 'INTERACTIVE', 'BULK', 'LOCAL_ONLY']); this.transport = options.transport ?? new LocalNetworkTransport({ maxFrameBytes: options.mtu ?? 64 * 1024 }); this.endpoints = { ...(options.endpoints ?? {}) }; }
  registerEndpoint(routeReference: string, host: string, port: number): void { if (!routeReference || !host || !Number.isInteger(port) || port < 1 || port > 65_535) throw new ConnectivityError('POLICY_DENIED', 'Local endpoint is invalid'); (this.endpoints as Record<string, { host: string; port: number }>)[routeReference] = { host, port }; }
  async discoverDirectReachability(destination: string): Promise<readonly TransportEndpoint[]> { const value = this.endpoints[destination]; if (!value) return []; const handle = randomId('endpoint'); this.routes.set(handle, value); return [{ handle, providerId: this.id, providerType: this.type, routeReference: randomId('route'), anonymous: true }]; }
  async openSession(endpoint: TransportEndpoint): Promise<TransportSession> { const address = this.routes.get(endpoint.handle); if (!address) throw new ConnectivityError('TRANSPORT_UNAVAILABLE', 'Local endpoint has expired'); const session = this.makeSession({ ...endpoint, routeReference: randomId('local-route') }); const connection = await this.transport.connect(address.host, address.port, (_connection, bytes) => { try { this.emit(decodeOpaqueFrame(bytes), session); } catch { /* bounded provider parser rejects malformed bytes */ } }); this.connections.set(session.id, connection); return session; }
  /** Start a bounded TCP listener for a real/same-host LocalNetwork test or a
   * host adapter.  It carries only opaque frames and never advertises identity. */
  async listen(options: { readonly host?: string; readonly port?: number } = {}): Promise<{ readonly port: number; readonly close: () => Promise<void> }> {
    if (this.listener) return this.listener;
    const listener = await this.transport.listen((connection, bytes) => { try { let session = this.incomingSessions.get(connection.id); if (!session) { if (this.incomingSessions.size >= 64) return; session = this.makeSession({ handle: randomId('endpoint'), providerId: this.id, providerType: this.type, routeReference: randomId('incoming-route'), anonymous: true }); this.incomingSessions.set(connection.id, session); } this.emit(decodeOpaqueFrame(bytes), session); } catch { /* malformed frames are dropped */ } }, options);
    this.listener = listener; return listener;
  }
  async sendOpaqueFrame(session: TransportSession, frame: OpaqueFrame): Promise<void> { const connection = this.connections.get(session.id); if (!connection) throw new ConnectivityError('SESSION_FAILED', 'Local network session is closed'); const encoded = encodeOpaqueFrame(frame); if (this.mtu !== 'UNKNOWN' && encoded.byteLength > this.mtu) throw new ConnectivityError('MTU_EXCEEDED', 'Frame must be fragmented before local-network send'); this.transport.send(connection, encoded); }
  async stop(): Promise<void> { if (this.listener) { await this.listener.close(); this.listener = undefined; } await super.stop(); }
  async close(session: TransportSession): Promise<void> { const connection = this.connections.get(session.id); if (connection) await this.transport.close(connection); this.connections.delete(session.id); await super.close(session); }
  isPeerConnected(): boolean { return false; }
}

/** Deterministic in-memory provider used only by controlled tests. */
export class ControlledTransportProvider extends BaseTransportProvider {
  private readonly peers = new Map<string, ControlledTransportProvider>();
  constructor(id = 'controlled', mtu = 4 * 1024) { super(asProviderId(id), 'ControlledTransport', mtu, 'AVAILABLE', ['DIRECT', 'STREAM', 'DATAGRAM', 'CONTROL', 'INTERACTIVE', 'REALTIME', 'BULK', 'BACKGROUND']); }
  connectPeer(routeReference: string, peer: ControlledTransportProvider): void { this.peers.set(routeReference, peer); }
  isPeerConnected(destination: string): boolean { return this.peers.has(destination); }
  async discoverDirectReachability(destination: string): Promise<readonly TransportEndpoint[]> { return this.peers.has(destination) ? [{ handle: randomId('endpoint'), providerId: this.id, providerType: this.type, routeReference: destination, anonymous: true }] : []; }
  async openSession(endpoint: TransportEndpoint): Promise<TransportSession> { if (!this.peers.has(endpoint.routeReference)) throw new ConnectivityError('TRANSPORT_UNAVAILABLE', 'Controlled peer unavailable'); return this.makeSession(endpoint); }
  async sendOpaqueFrame(session: TransportSession, frame: OpaqueFrame): Promise<void> { const peer = this.peers.get(session.endpoint.routeReference); if (!peer) throw new ConnectivityError('TRANSPORT_UNAVAILABLE', 'Controlled peer unavailable'); queueMicrotask(() => peer.emit(structuredClone(frame))); }
}

export interface PlaceholderTransportProviderOptions { readonly availability?: TransportAvailability; readonly capabilities?: readonly TransportCapability[]; readonly mtu?: number; }
abstract class PlaceholderTransportProvider extends BaseTransportProvider {
  constructor(id: string, type: TransportProviderType, caps: readonly TransportCapability[], options: PlaceholderTransportProviderOptions = {}) { super(asProviderId(id), type, options.mtu ?? 'UNKNOWN', options.availability ?? 'UNSUPPORTED', options.capabilities ?? caps); }
  async discoverDirectReachability(): Promise<readonly TransportEndpoint[]> { return []; }
  async openSession(): Promise<TransportSession> { throw new ConnectivityError('TRANSPORT_UNAVAILABLE', `${this.type} is not available in this runtime`); }
  async sendOpaqueFrame(): Promise<void> { throw new ConnectivityError('TRANSPORT_UNAVAILABLE', `${this.type} has no verified endpoint`); }
  isPeerConnected(): boolean { return false; }
}
export class WiFiDirectTransportProvider extends PlaceholderTransportProvider { constructor(options?: PlaceholderTransportProviderOptions) { super('wifi-direct', 'WiFiDirectTransport', ['DIRECT', 'DISCOVERY', 'INTERACTIVE', 'REALTIME'], options); } }
export class BluetoothTransportProvider extends PlaceholderTransportProvider { constructor(options?: PlaceholderTransportProviderOptions) { super('bluetooth', 'BluetoothTransport', ['DIRECT', 'DISCOVERY', 'DATAGRAM', 'CONTROL', 'INTERACTIVE', 'LOW_BANDWIDTH', 'SMALL_MTU'], options); } }
export class USBTransportProvider extends PlaceholderTransportProvider { constructor(options?: PlaceholderTransportProviderOptions) { super('usb', 'USBTransport', ['DIRECT', 'STREAM', 'CONTROL', 'INTERACTIVE', 'BULK'], options); } }
export class ExternalRadioTransportProvider extends PlaceholderTransportProvider { constructor(options?: PlaceholderTransportProviderOptions) { super('external-radio', 'ExternalRadioTransport', ['DIRECT', 'DATAGRAM', 'CONTROL', 'LOW_BANDWIDTH', 'LONG_RANGE', 'SMALL_MTU', 'BACKGROUND', 'STORE_FORWARD_FUTURE'], options); } }

// ---------------------------------------------------------------------------
// Fabric, deterministic selection and reachability
// ---------------------------------------------------------------------------

export interface ConnectivityFabricOptions {
  readonly now?: () => number;
  readonly maxProviders?: number;
  readonly maxAttempts?: number;
  readonly maxEvents?: number;
  readonly maxPendingRequests?: number;
  readonly resources?: ConnectivityResourceGovernor;
  /** Inject a deterministic optimizer in tests/host diagnostics. The Fabric
   * remains the sole owner of provider selection in production. */
  readonly routeOptimizer?: AdaptiveRouteOptimizer;
  readonly adaptiveRoute?: AdaptiveRouteOptimizerOptions;
}
export interface ConnectivityFabricSnapshot {
  readonly version: 1;
  readonly providers: readonly { readonly id: TransportProviderId; readonly type: TransportProviderType; readonly enabled: boolean }[];
}
export class ConnectivityFabric {
  private readonly providers = new Map<TransportProviderId, TransportProvider>();
  private readonly subscriptions = new Set<(event: ConnectivityEvent) => void>();
  private readonly envelopeSubscriptions = new Set<(envelope: OpaqueDeliveryEnvelope, providerId?: TransportProviderId) => void | Promise<void>>();
  private readonly duplicateSubscriptions = new Set<(envelope: OpaqueDeliveryEnvelope) => void | Promise<void>>();
  private readonly providerUnsubscribers = new Map<TransportProviderId, () => void>();
  private readonly reassembler = new OpaqueFragmentReassembler();
  private readonly seen = new Map<string, number>();
  private readonly pendingRequests = new Set<string>();
  private readonly events: ConnectivityEvent[] = [];
  private readonly now: () => number;
  private readonly options: Required<Pick<ConnectivityFabricOptions, 'maxProviders' | 'maxAttempts' | 'maxEvents' | 'maxPendingRequests'>>;
  private running = false;
  readonly resources: ConnectivityResourceGovernor;
  readonly routeOptimizer: AdaptiveRouteOptimizer;
  constructor(options: ConnectivityFabricOptions = {}) { this.now = options.now ?? Date.now; this.resources = options.resources ?? new ConnectivityResourceGovernor(); this.routeOptimizer = options.routeOptimizer ?? new AdaptiveRouteOptimizer({ ...(options.adaptiveRoute ?? {}), now: options.adaptiveRoute?.now ?? this.now, resourceState: options.adaptiveRoute?.resourceState ?? { ...this.resources.snapshot() } }); this.options = { maxProviders: options.maxProviders ?? 32, maxAttempts: options.maxAttempts ?? 2, maxEvents: options.maxEvents ?? 512, maxPendingRequests: options.maxPendingRequests ?? 256 }; }
  registerProvider(provider: TransportProvider): void { if (this.providers.has(provider.id) && this.providers.get(provider.id) !== provider) throw new ConnectivityError('POLICY_DENIED', `Provider ID is already registered: ${provider.id}`); if (!provider.security.opaqueOnly || !provider.security.e2eRequired || provider.security.canDecrypt || provider.security.canAuthorize) throw new ConnectivityError('POLICY_DENIED', 'Provider does not meet opaque E2E security boundary'); if (this.providers.size >= this.options.maxProviders && !this.providers.has(provider.id)) throw new ConnectivityError('RESOURCE_LIMIT', 'Provider registry bound exceeded'); this.providers.set(provider.id, provider); this.emit({ type: 'provider_available', at: nowIso(), providerId: provider.id }); }
  removeProvider(id: TransportProviderId): boolean { const removed = this.providers.delete(id); if (removed) { this.routeOptimizer.invalidateProvider(id); this.emit({ type: 'provider_unavailable', at: nowIso(), providerId: id }); } return removed; }
  provider(id: TransportProviderId): TransportProvider | undefined { return this.providers.get(id); }
  /** Register a provider after startup without opening an idle scan loop. */
  async addProvider(provider: TransportProvider): Promise<void> { this.registerProvider(provider); if (this.running) { await provider.start(); this.providerUnsubscribers.set(provider.id, provider.receiveOpaqueFrame((frame, session) => this.receive(frame, provider.id, session))); } }
  providersList(): readonly TransportProvider[] { return [...this.providers.values()]; }
  subscribe(listener: (event: ConnectivityEvent) => void): () => void { this.subscriptions.add(listener); return () => this.subscriptions.delete(listener); }
  onOpaqueEnvelope(listener: (envelope: OpaqueDeliveryEnvelope, providerId?: TransportProviderId) => void | Promise<void>): () => void { this.envelopeSubscriptions.add(listener); return () => this.envelopeSubscriptions.delete(listener); }
  /** Envelopes dropped by receive-side deduplication; never delivered to applications. */
  onDuplicateOpaqueEnvelope(listener: (envelope: OpaqueDeliveryEnvelope) => void | Promise<void>): () => void { this.duplicateSubscriptions.add(listener); return () => this.duplicateSubscriptions.delete(listener); }
  eventHistory(): readonly ConnectivityEvent[] { return this.events.map(event => structuredClone(event)); }
  snapshotConfiguration(): ConnectivityFabricSnapshot { return { version: 1, providers: this.providersList().map(provider => ({ id: provider.id, type: provider.type, enabled: provider.health().availability !== 'UNSUPPORTED' })) }; }
  async start(): Promise<void> { if (this.running) return; for (const provider of this.providers.values()) { await provider.start(); this.providerUnsubscribers.set(provider.id, provider.receiveOpaqueFrame((frame, session) => this.receive(frame, provider.id, session))); } this.running = true; }
  async stop(): Promise<void> { if (!this.running) return; for (const unsubscribe of this.providerUnsubscribers.values()) unsubscribe(); this.providerUnsubscribers.clear(); for (const provider of this.providers.values()) await provider.stop(); this.running = false; this.reassembler.clear(); this.routeOptimizer.resetLiveState(); }
  isRunning(): boolean { return this.running; }
  async deliver(request: DeliveryRequest): Promise<DeliveryResult> {
    if (!request?.id || !request.destination || !request.envelope) throw new ConnectivityError('POLICY_DENIED', 'Delivery request is malformed');
    validateOpaqueDeliveryEnvelope(request.envelope); if (request.envelope.destination !== request.destination) throw new ConnectivityError('POLICY_DENIED', 'Delivery destination does not match protected envelope');
    // A logical request id is single-use while in flight. A completed request
    // is also idempotent: callers retrying after an uncertain provider result
    // must not create a second application-level operation.
    // `request.id` is an in-flight attempt guard, not an application replay
    // key. A durable queue may explicitly retry the same protected envelope;
    // receive-side envelope-id deduplication is the authority for the logical
    // operation and must remain in place across provider fallback/restarts.
    if (this.pendingRequests.has(request.id)) throw new ConnectivityError('POLICY_DENIED', 'Duplicate delivery request');
    if (this.pendingRequests.size >= this.options.maxPendingRequests) throw new ConnectivityError('RESOURCE_LIMIT', 'Pending delivery request bound exceeded');
    this.pendingRequests.add(request.id);
    try {
      // Reserve the logical request before the asynchronous integrity check.
      // Otherwise two callers can race on digest() and both enter the
      // provider path, defeating the in-flight duplicate guard.
      await verifyOpaqueIntegrity(request.envelope);
      const requirement = requirementFor(request); this.routeOptimizer.updateResourceState(this.resources.snapshot()); const candidates = this.providersList().filter(provider => supports(provider, requirement));
      const attempts: DeliveryAttempt[] = [];
      if (!candidates.length) return { ok: false, requestId: request.id, availability: 'UNAVAILABLE', reachability: 'UNAVAILABLE', attempts, failure: { code: 'NO_COMPATIBLE_TRANSPORT', message: 'No secure provider satisfies the delivery profile' } };
      // Route selection is local and synchronous over bounded cached state. It
      // never performs discovery/probing here; provider attempts below remain
      // the only source of live delivery truth.
      const routeCandidates = candidates.map(provider => { try { return this.routeOptimizer.candidateForProvider(provider, request.destination, requirement); } catch { return undefined; } }).filter((candidate): candidate is RouteCandidate => candidate !== undefined);
      const selection = this.routeOptimizer.select(request.destination, requirement, routeCandidates);
      const orderedCandidates = selection.eligible.map(candidate => candidate.provider).filter((provider): provider is TransportProvider => provider !== undefined);
      // A live route always wins.  Providers which only offer durable local
      // acceptance are considered after all contemporaneous providers so a
      // queued parcel never masks an available direct/multi-hop delivery.
      const ordered = orderedCandidates.filter(provider => !provider.queueOpaqueDelivery).slice(0, Math.min(this.options.maxAttempts, candidates.length));
      const delayed = orderedCandidates.filter(provider => !!provider.queueOpaqueDelivery);
      networkDiagnostic('fabric.deliver.start', { requestId: request.id, destination: request.destination, providers: ordered.map(value => value.id) });
      for (const provider of ordered) {
        const started = nowIso(); try {
          const discoveryStarted = Date.now(); const endpoints = await provider.discoverDirectReachability(request.destination, requirement); networkDiagnostic('fabric.discovery', { requestId: request.id, provider: provider.id, durationMs: Date.now() - discoveryStarted, endpoints: endpoints.length }); if (!endpoints.length) throw new ConnectivityError('TRANSPORT_UNAVAILABLE', 'Destination is not directly reachable'); const sessionStarted = Date.now(); const session = await provider.openSession(endpoints[0]!); networkDiagnostic('fabric.openSession', { requestId: request.id, provider: provider.id, durationMs: Date.now() - sessionStarted, sessionId: session.id }); this.emit({ type: 'session_opened', at: nowIso(), providerId: provider.id, sessionId: session.id, requestId: request.id });
          const mtu = provider.mtu; let fragments = 1; if (typeof mtu === 'number' && encodeOpaqueFrame(request.envelope).byteLength > mtu) { const values = await fragmentOpaqueEnvelope(request.envelope, mtu); fragments = values.length; for (const fragment of values) await provider.sendOpaqueFrame(session, fragment); } else await provider.sendOpaqueFrame(session, request.envelope);
          const durationMs = Date.now() - Date.parse(started);
          this.routeOptimizer.recordAttempt({ destination: request.destination, providerId: provider.id, outcome: 'FORWARDED', durationMs, timestamp: this.now() });
          // Provider instrumentation is passive feedback. A broken metrics
          // hook cannot turn a successful delivery into a failure or block the
          // application send path.
          void provider.measureLink(session).then(metrics => { this.routeOptimizer.recordMeasurement({ destination: request.destination, providerId: provider.id, metrics, timestamp: this.now() }); this.emit({ type: 'metrics_changed', at: nowIso(), providerId: provider.id, requestId: request.id, metadata: { measured: true } }); }).catch(() => undefined);
          await provider.close(session); this.rememberSeen(seenKeyForEnvelope(request.envelope)); this.emit({ type: 'delivery_state', at: nowIso(), providerId: provider.id, requestId: request.id, state: 'DELIVERED' }); const attempt: DeliveryAttempt = { providerId: provider.id, path: pathClass(provider.type), startedAt: started, endedAt: nowIso(), ok: true, fragments }; attempts.push(attempt); networkDiagnostic('fabric.deliver.ok', { requestId: request.id, provider: provider.id, durationMs }); const reachability = provider.type === 'GatewayMeshTransport' ? 'RELAYED' as const : 'DIRECT' as const; return { ok: true, requestId: request.id, availability: 'AVAILABLE', reachability, attempts, receipt: { requestId: request.id, envelopeId: request.envelope.id, providerId: provider.id, acceptedAt: nowIso(), path: pathClass(provider.type) } };
        } catch (error) { const failure = asFailure(error, provider.id); const outcome = routeOutcomeForFailure(failure.code); this.routeOptimizer.recordAttempt({ destination: request.destination, providerId: provider.id, outcome, failureCode: failure.code, durationMs: Date.now() - Date.parse(started), timestamp: this.now() }); networkDiagnostic('fabric.deliver.failure', { requestId: request.id, provider: provider.id, durationMs: Date.now() - Date.parse(started), code: failure.code, message: failure.message }); attempts.push({ providerId: provider.id, path: pathClass(provider.type), startedAt: started, endedAt: nowIso(), ok: false, failure, fragments: 0 }); }
      }
      const delayAllowed = requirement.profile !== 'REALTIME' && requirement.profile !== 'CONTROL' && (requirement.allowDelayTolerant === true || requirement.profile === 'EVENTUAL' || requirement.profile === 'BACKGROUND' || requirement.profile === 'BEST_EFFORT');
      if (delayAllowed) {
        for (const provider of delayed.slice(0, Math.min(this.options.maxAttempts, delayed.length))) {
          const started = nowIso();
          try {
            const accepted = await provider.queueOpaqueDelivery!(request);
            this.routeOptimizer.recordAttempt({ destination: request.destination, providerId: provider.id, outcome: accepted.ok ? 'FORWARDED' : 'DESTINATION_UNCONFIRMED', failureCode: accepted.failure?.code, timestamp: this.now() });
            const attempt: DeliveryAttempt = { providerId: provider.id, path: 'DELAY_TOLERANT', startedAt: started, endedAt: nowIso(), ok: accepted.ok, failure: accepted.failure, fragments: 1 };
            attempts.push(attempt);
            if (accepted.ok) {
              this.emit({ type: 'delivery_state', at: nowIso(), providerId: provider.id, requestId: request.id, state: 'ACCEPTED_FOR_LATER' });
              return { ok: true, requestId: request.id, availability: 'TEMPORARILY_UNAVAILABLE', reachability: 'EVENTUALLY', attempts, receipt: { requestId: request.id, envelopeId: request.envelope.id, providerId: provider.id, acceptedAt: nowIso(), path: 'DELAY_TOLERANT' } };
            }
          } catch (error) {
            const failure = asFailure(error, provider.id); this.routeOptimizer.recordAttempt({ destination: request.destination, providerId: provider.id, outcome: routeOutcomeForFailure(failure.code), failureCode: failure.code, timestamp: this.now() }); attempts.push({ providerId: provider.id, path: 'DELAY_TOLERANT', startedAt: started, endedAt: nowIso(), ok: false, failure, fragments: 0 });
          }
        }
      }
      return { ok: false, requestId: request.id, availability: 'TEMPORARILY_UNAVAILABLE', reachability: 'UNAVAILABLE', attempts, failure: attempts.at(-1)?.failure ?? { code: 'DELIVERY_UNCONFIRMED', message: 'All compatible providers failed' } };
    } finally { this.pendingRequests.delete(request.id); this.sweepSeen(); }
  }
  async reachability(destination: string, requirement: DeliveryRequirement = { profile: 'BEST_EFFORT' }): Promise<ReachabilityResult> {
    if (requirement.profile === 'BACKGROUND' && !this.resources.allowsBackgroundDiscovery()) return { destination, reachability: 'UNAVAILABLE', availability: 'TEMPORARILY_UNAVAILABLE', state: this.snapshot().state, providers: [], checkedAt: nowIso(), reason: 'Background discovery suppressed by host resource policy' };
    const providers: TransportProviderId[] = []; let relayed = false;
    const available = this.providersList().filter(provider => supports(provider, requirement));
    const routeCandidates = available.map(provider => { try { return this.routeOptimizer.candidateForProvider(provider, destination, requirement); } catch { return undefined; } }).filter((candidate): candidate is RouteCandidate => candidate !== undefined);
    const ranked = this.routeOptimizer.select(destination, requirement, routeCandidates).eligible;
    const ordered = ranked.map(candidate => candidate.provider).filter((provider): provider is TransportProvider => provider !== undefined);
    for (const provider of ordered) {
      try {
        const endpoints = await provider.discoverDirectReachability(destination, requirement);
        if (endpoints.length) { providers.push(provider.id); if (provider.type === 'GatewayMeshTransport') relayed = true; }
        else this.routeOptimizer.recordAttempt({ destination, providerId: provider.id, outcome: 'PROVIDER_UNAVAILABLE', timestamp: this.now() });
      } catch { this.routeOptimizer.recordAttempt({ destination, providerId: provider.id, outcome: 'PROVIDER_FAILURE', timestamp: this.now() }); }
    }
    const state = this.snapshot().state;
    if (providers.length) return { destination, reachability: relayed && providers.every(id => this.providers.get(id)?.type === 'GatewayMeshTransport') ? 'RELAYED' : 'DIRECT', availability: 'AVAILABLE', state, providers, checkedAt: nowIso() };
    const delayAllowed = requirement.profile !== 'REALTIME' && requirement.profile !== 'CONTROL' && (requirement.allowDelayTolerant === true || requirement.profile === 'EVENTUAL' || requirement.profile === 'BACKGROUND' || requirement.profile === 'BEST_EFFORT');
    const delayed = delayAllowed ? this.providersList().filter(provider => supports(provider, requirement) && !!provider.queueOpaqueDelivery).map(provider => provider.id) : [];
    return delayed.length ? { destination, reachability: 'EVENTUALLY', availability: 'TEMPORARILY_UNAVAILABLE', state: state === 'DEVICE_ONLY' ? 'DELAY_TOLERANT' : state, providers: delayed, checkedAt: nowIso(), reason: 'No live route; bounded opaque custody may advance on a future encounter' } : { destination, reachability: 'UNAVAILABLE', availability: 'UNAVAILABLE', state, providers: [], checkedAt: nowIso(), reason: 'No direct secure provider currently reports reachability' };
  }
  snapshot(): ConnectivityStateSnapshot {
    const available = this.providersList().filter(provider => { try { const availability = provider.health().availability; return availability === 'AVAILABLE' || availability === 'DEGRADED'; } catch { return false; } }); const ids = available.map(provider => provider.id); const gateway = available.some(provider => provider.type === 'GatewayMeshTransport'); const directIds = available.filter(provider => provider.type !== 'GatewayMeshTransport' && !safeCapabilities(provider).includes('STORE_FORWARD_FUTURE')).map(provider => provider.id); const internet = available.some(provider => provider.type === 'InternetTransport'); const local = available.some(provider => provider.type === 'LocalNetworkTransport'); const mesh = available.some(provider => safeCapabilities(provider).includes('MESH')); const nearby = available.some(provider => provider.type === 'BluetoothTransport' || provider.type === 'WiFiDirectTransport' || mesh); const delayed = available.some(provider => safeCapabilities(provider).includes('STORE_FORWARD_FUTURE')); let state: ConnectivityState = 'DEVICE_ONLY'; if (internet) state = 'GLOBAL_NETWORK'; else if (local) state = 'LOCAL_NETWORK'; else if (gateway) state = 'RELAYED_GLOBAL'; else if (mesh) state = 'NEARBY_MESH'; else if (nearby) state = 'NEARBY'; else if (delayed) state = 'DELAY_TOLERANT'; else if (ids.length) state = 'RESTRICTED_NETWORK'; return { state, reachability: directIds.length ? 'DIRECT' : gateway ? 'RELAYED' : delayed ? 'EVENTUALLY' : 'UNAVAILABLE', internetAvailable: internet, localNetworkAvailable: local, nearbyAvailable: nearby, availableProviders: ids, observedAt: nowIso() };
  }
  private async receive(frame: OpaqueFrame, providerId: TransportProviderId, session?: TransportSession): Promise<void> { let envelope: OpaqueDeliveryEnvelope | undefined; try { envelope = isOpaqueEnvelope(frame) ? frame : await this.reassembler.add(frame); if (envelope) { validateOpaqueDeliveryEnvelope(envelope); await verifyOpaqueIntegrity(envelope); } } catch { this.emit({ type: 'resource_pressure', at: nowIso(), providerId, sessionId: session?.id, metadata: { rejected: true } }); return; } if (!envelope || Date.parse(envelope.expiresAt) <= this.now()) return; const seenKey = seenKeyForEnvelope(envelope); const seenAt = this.seen.get(seenKey); if (seenAt !== undefined) { for (const listener of this.duplicateSubscriptions) await listener(envelope); return; } this.rememberSeen(seenKey); for (const listener of this.envelopeSubscriptions) await listener(envelope, providerId); this.emit({ type: 'delivery_state', at: nowIso(), providerId, sessionId: session?.id, state: 'RECEIVED' }); }
  private rememberSeen(key: string): void { this.sweepSeen(); if (!this.seen.has(key) && this.seen.size >= MAX_SEEN_ENVELOPES) { const oldest = this.seen.keys().next().value as string | undefined; if (oldest) this.seen.delete(oldest); } this.seen.set(key, this.now()); }
  private sweepSeen(): void { const cutoff = this.now() - 7 * 24 * 60 * 60_000; for (const [id, at] of this.seen) if (at < cutoff) this.seen.delete(id); }
  private emit(event: ConnectivityEvent): void { this.events.push(event); if (this.events.length > this.options.maxEvents) this.events.shift(); for (const listener of this.subscriptions) listener(event); }
}

function routeOutcomeForFailure(code: DeliveryFailureCode): RouteOutcome {
  if (code === 'TIMEOUT') return 'TIMEOUT';
  if (code === 'POLICY_DENIED' || code === 'CAPABILITY_EXPIRED') return 'SECURITY_REJECTED';
  if (code === 'RESOURCE_LIMIT' || code === 'MTU_EXCEEDED') return 'RESOURCE_REJECTED';
  if (code === 'TRANSPORT_UNAVAILABLE' || code === 'NO_COMPATIBLE_TRANSPORT' || code === 'TEMPORARILY_UNAVAILABLE') return 'PROVIDER_UNAVAILABLE';
  if (code === 'DELIVERY_UNCONFIRMED') return 'DESTINATION_UNCONFIRMED';
  return 'PROVIDER_FAILURE';
}
function asFailure(error: unknown, providerId?: TransportProviderId): DeliveryFailure { if (error instanceof ConnectivityError) return { code: error.code, providerId, message: error.message }; return { code: 'SESSION_FAILED', providerId, message: error instanceof Error ? error.message : 'Transport provider failed' }; }

export class UniversalReachabilityService {
  constructor(private readonly fabric: ConnectivityFabric) {}
  state(): ConnectivityStateSnapshot { return this.fabric.snapshot(); }
  query(destination: string, requirement: DeliveryRequirement = { profile: 'BEST_EFFORT' }): Promise<ReachabilityResult> { return this.fabric.reachability(destination, requirement); }
  canDeliver(requirement: DeliveryRequirement): boolean { return this.fabric.providersList().some(provider => supports(provider, requirement)); }
}

export interface FabricTransportOptions {
  readonly fabric: ConnectivityFabric;
  readonly localNodeId: NodeId;
  /** Existing R0P58 signing/replay verifier. Fabric refuses an unverified
   * application envelope rather than creating a security downgrade path. */
  readonly applicationSecurity: EnvelopeSecurity;
  readonly defaultRequirement?: DeliveryRequirement;
  readonly requirementForEnvelope?: (envelope: Envelope) => DeliveryRequirement;
  /** Delays before resending an envelope the destination has not acknowledged.
   * An empty list disables destination acknowledgements. */
  readonly retransmitDelaysMs?: readonly number[];
}

/** Destination receipt for application envelopes (delivery level 5 in docs/connectivity.md). */
export const FABRIC_DELIVERY_ACK_TYPE = 'keystone.delivery.ack';
const DEFAULT_RETRANSMIT_DELAYS_MS: readonly number[] = [2_000, 4_000, 8_000, 16_000];
const MAX_UNACKNOWLEDGED_ENVELOPES = 1_024;
const MAX_REACKNOWLEDGEMENTS = 4;

export function deliveryProfileForEnvelope(envelope: Pick<Envelope, 'type'>): DeliveryRequirement {
  const type = envelope.type.toLowerCase();
  // A content chunk is an active request/response on an already selected
  // session. Keep the logical transfer bulk-classified at the service level,
  // but use the interactive live-session profile for this small control/data
  // exchange so a provider does not defer individual chunks behind a bulk
  // queue.
  if (type === 'content.chunk.request' || type === 'content.chunk.response') return { profile: 'INTERACTIVE' };
  if (type.includes('live') || type.includes('stream')) return { profile: 'REALTIME' };
  if (type.includes('file') || type.includes('content') || type.includes('video') || type.includes('music')) return { profile: 'BULK' };
  if (type.includes('calendar') || type.includes('automation') || type.includes('backup')) return { profile: 'EVENTUAL' };
  if (type.includes('background') || type.includes('recommendation') || type.includes('memory')) return { profile: 'BACKGROUND' };
  // A signed user message is safe to accept locally and deliver after an
  // encounter, while typing/presence/read acknowledgements remain live-only
  // at their callers' explicit policy boundary.
  if (type === 'social.message' || type === 'social.conversation_event') return { profile: 'INTERACTIVE', allowDelayTolerant: true };
  return { profile: 'INTERACTIVE' };
}

/**
 * Compatibility adapter for existing application services.  It preserves the
 * current `Transport` contract while routing its frames through the Fabric.
 * The Fabric/provider sees only base64 protected bytes.  Application envelope
 * validation/signature verification remains mandatory on the receiving side.
 */
export class FabricTransport implements Transport {
  private readonly handlers = new Set<(envelope: Envelope) => void | Promise<void>>();
  private readonly connected = new Set<NodeId>();
  private readonly unacknowledged = new Map<string, { readonly peer: NodeId; readonly envelope: Envelope; attempt: number; timer?: ReturnType<typeof setTimeout> }>();
  private readonly reacknowledged = new Map<string, number>();
  private readonly unsubscribe: () => void;
  private closed = false;
  constructor(private readonly options: FabricTransportOptions) {
    if (!options.applicationSecurity) throw new ConnectivityError('POLICY_DENIED', 'FabricTransport requires application envelope security');
    const unsubscribeEnvelope = options.fabric.onOpaqueEnvelope((protectedEnvelope) => this.receive(protectedEnvelope));
    const unsubscribeDuplicate = options.fabric.onDuplicateOpaqueEnvelope((protectedEnvelope) => this.receiveDuplicate(protectedEnvelope));
    // Provider removal is an unambiguous lifecycle signal.  Drop all
    // historical hints rather than trying to associate a provider event with
    // a peer (the cache is deliberately aggregate); a later live-state query
    // can repopulate a hint from another provider without doing discovery.
    const unsubscribeFabric = options.fabric.subscribe(event => {
      if (event.type === 'provider_unavailable') this.connected.clear();
    });
    this.unsubscribe = () => { unsubscribeEnvelope(); unsubscribeDuplicate(); unsubscribeFabric(); };
  }
  /** The compatibility facade is intentionally branded for architecture
   * checks and diagnostics.  Application services should receive this
   * interface, never a physical provider or raw Transport. */
  readonly authority = 'ConnectivityFabric' as const;
  /** Diagnostic access only; application services must use the delivery
   * interface and cannot select providers through this reference. */
  get fabric(): ConnectivityFabric { return this.options.fabric; }
  async start(): Promise<void> { this.closed = false; await this.options.fabric.start(); }
  async connect(peer: NodeId): Promise<void> {
    if (this.closed) throw new ConnectivityError('SESSION_FAILED', 'Fabric transport is closed');
    /* `Transport.connect` is retained for source compatibility. Fabric owns
     * route discovery/session establishment at send time; doing a blocking
     * preflight here would make every offline queue probe the Internet and
     * serialize unrelated service flushes behind an 8-second socket timeout.
     * A successful delivery is the only event that marks a peer connected. */
    void peer;
  }
  async send(peerId: NodeId, envelope: Envelope): Promise<void>;
  async send(envelope: Envelope): Promise<void>;
  async send(peerOrEnvelope: NodeId | Envelope, maybeEnvelope?: Envelope): Promise<void> {
    const envelope = maybeEnvelope ?? peerOrEnvelope as Envelope; const peer = maybeEnvelope ? peerOrEnvelope as NodeId : envelope.recipient;
    if (envelope.recipient !== peer) throw new ConnectivityError('POLICY_DENIED', 'Fabric recipient does not match application envelope');
    if (this.closed) throw new ConnectivityError('SESSION_FAILED', 'Fabric transport is closed');
    await this.deliverEnvelope(peer, envelope, envelope.id);
    if (envelope.type !== FABRIC_DELIVERY_ACK_TYPE) this.awaitAcknowledgement(peer, envelope);
  }

  private async deliverEnvelope(peer: NodeId, envelope: Envelope, requestId: string): Promise<void> {
    const serialized = JSON.stringify(envelope); if (!serialized) throw new ConnectivityError('POLICY_DENIED', 'Application envelope is not serializable');
    const protectedEnvelope = await createOpaqueDeliveryEnvelope({ id: envelope.id, destination: peer, ciphertext: encodeOpaqueBytes(utf8(serialized)), replayNonce: envelope.nonce, expiresAt: envelope.expiresAt, requirement: this.requirementFor(envelope) });
    // The application envelope id is the logical operation/replay key.  A
    // duplicate explicit resend is handled by the Fabric's receive-side
    // deduplication and the service's R0P58 nonce/object guards.
    let result: DeliveryResult;
    try {
      result = await this.options.fabric.deliver({ id: requestId, destination: peer, envelope: protectedEnvelope, requirement: this.requirementFor(envelope) });
    } catch (error) {
      this.connected.delete(peer);
      throw error;
    }
    if (!result.ok) { this.connected.delete(peer); throw new ConnectivityError(result.failure?.code ?? 'DELIVERY_UNCONFIRMED', result.failure?.message ?? 'Fabric delivery failed'); }
    this.connected.add(peer);
  }

  /**
   * A provider accepting a frame is not proof the destination got it: a frame
   * written to a socket that is being replaced (e.g. Hyperswarm dropping a
   * duplicate connection after both peers restart) is lost silently. Resend
   * the same envelope until the destination acknowledges it, it expires, or
   * the bounded schedule ends. The receiver's envelope-id deduplication keeps
   * a resend from becoming a second operation.
   */
  private awaitAcknowledgement(peer: NodeId, envelope: Envelope): void {
    const delays = this.options.retransmitDelaysMs ?? DEFAULT_RETRANSMIT_DELAYS_MS;
    if (!delays.length || this.closed) return;
    if (this.unacknowledged.size >= MAX_UNACKNOWLEDGED_ENVELOPES) { const oldest = this.unacknowledged.keys().next().value as string | undefined; if (oldest) this.forgetAcknowledgement(oldest); }
    this.forgetAcknowledgement(envelope.id);
    const entry: { readonly peer: NodeId; readonly envelope: Envelope; attempt: number; timer?: ReturnType<typeof setTimeout> } = { peer, envelope, attempt: 0 };
    this.unacknowledged.set(envelope.id, entry);
    const schedule = (): void => {
      const delay = delays[entry.attempt];
      if (delay === undefined || this.closed) { this.unacknowledged.delete(envelope.id); return; }
      entry.timer = setTimeout(() => {
        if (this.unacknowledged.get(envelope.id) !== entry) return;
        if (Date.parse(envelope.expiresAt) <= Date.now()) { this.unacknowledged.delete(envelope.id); return; }
        entry.attempt += 1;
        void this.deliverEnvelope(peer, envelope, `${envelope.id}#resend-${entry.attempt}`).catch(() => undefined).finally(() => { if (this.unacknowledged.get(envelope.id) === entry) schedule(); });
      }, delay);
      (entry.timer as { unref?: () => void }).unref?.();
    };
    schedule();
  }

  private forgetAcknowledgement(id: string): void { const entry = this.unacknowledged.get(id); if (entry?.timer) clearTimeout(entry.timer); this.unacknowledged.delete(id); }

  /** Number of sent envelopes still waiting for a destination receipt (diagnostics and tests). */
  get unacknowledgedCount(): number { return this.unacknowledged.size; }

  private async acknowledge(envelope: Envelope): Promise<void> {
    const unsigned = { version: 1 as const, type: FABRIC_DELIVERY_ACK_TYPE, id: crypto.randomUUID(), sender: this.options.localNodeId, recipient: envelope.sender, nonce: crypto.randomUUID(), expiresAt: new Date(Date.now() + 60_000).toISOString(), body: { ids: [envelope.id] } };
    const ack: Envelope = { ...unsigned, signature: await this.options.applicationSecurity.sign(unsigned) };
    await this.deliverEnvelope(envelope.sender, ack, ack.id);
  }
  on(event: 'message', handler: (envelope: Envelope) => void | Promise<void>): () => void { if (event !== 'message') throw new Error(`Unsupported event: ${event}`); this.handlers.add(handler); return () => this.handlers.delete(handler); }
  onMessage(handler: (envelope: Envelope) => void | Promise<void>): () => void { return this.on('message', handler); }
  /**
   * Return a best-effort live connectivity observation.
   *
   * `connected` is intentionally only a historical hint: it is populated
   * after a successful delivery and cannot observe a socket disappearing.
   * Providers that expose `isPeerConnected` are the bounded source of live
   * state.  A provider scan is cheap (the Fabric registry is bounded) and
   * does not perform discovery, polling, or network I/O.  If at least one
   * provider exposes the capability and none reports the peer as connected,
   * discard the stale compatibility hint.  When no provider can observe
   * live state, retain the historical hint for legacy/test providers.
   */
  isPeerConnected(peer: NodeId): boolean {
    const observers = this.options.fabric.providersList().filter(provider => typeof provider.isPeerConnected === 'function');
    if (!observers.length) return this.connected.has(peer);
    const live = observers.some(provider => {
      try { return provider.isPeerConnected?.(peer) === true; }
      catch { return false; }
    });
    if (live) this.connected.add(peer);
    else this.connected.delete(peer);
    return live;
  }
  async reconnect(peer: NodeId): Promise<void> { this.connected.delete(peer); await this.connect(peer); }
  async close(): Promise<void> { this.closed = true; this.connected.clear(); for (const id of [...this.unacknowledged.keys()]) this.forgetAcknowledgement(id); this.unsubscribe(); await this.options.fabric.stop(); }
  private requirementFor(envelope: Envelope | undefined): DeliveryRequirement { return envelope ? this.options.requirementForEnvelope?.(envelope) ?? this.options.defaultRequirement ?? deliveryProfileForEnvelope(envelope) : this.options.defaultRequirement ?? { profile: 'INTERACTIVE' }; }
  /** Parse, bind and verify an incoming application envelope; undefined when it must be ignored. */
  private async decode(protectedEnvelope: OpaqueDeliveryEnvelope): Promise<Envelope | undefined> { if (protectedEnvelope.destination !== this.options.localNodeId) return undefined; let envelope: Envelope; try { const bytes = base64ToBytes(protectedEnvelope.ciphertext); envelope = parseBoundedJson<Envelope>(bytes, { maxDepth: 32, maxCollectionItems: 4_096, maxStringBytes: 1 * 1024 * 1024, maxNodes: 32_768 }); validateProtocolEnvelope(envelope); } catch { return undefined; } if (envelope.recipient !== this.options.localNodeId || envelope.id !== protectedEnvelope.id || envelope.nonce !== protectedEnvelope.replayNonce) return undefined; if (this.options.applicationSecurity && !(await this.options.applicationSecurity.verify(envelope))) return undefined; return envelope; }

  /**
   * The first acknowledgement can be lost too. A resend is then dropped by
   * Fabric deduplication before it reaches the application, so confirm it
   * again here (bounded per envelope) without running any handler twice.
   */
  private async receiveDuplicate(protectedEnvelope: OpaqueDeliveryEnvelope): Promise<void> {
    if (!(this.options.retransmitDelaysMs ?? DEFAULT_RETRANSMIT_DELAYS_MS).length) return;
    const envelope = await this.decode(protectedEnvelope); if (!envelope || envelope.type === FABRIC_DELIVERY_ACK_TYPE) return;
    const count = (this.reacknowledged.get(envelope.id) ?? 0) + 1; if (count > MAX_REACKNOWLEDGEMENTS) return;
    if (!this.reacknowledged.has(envelope.id) && this.reacknowledged.size >= MAX_UNACKNOWLEDGED_ENVELOPES) { const oldest = this.reacknowledged.keys().next().value as string | undefined; if (oldest) this.reacknowledged.delete(oldest); }
    this.reacknowledged.set(envelope.id, count);
    await this.acknowledge(envelope).catch(() => undefined);
  }

  private async receive(protectedEnvelope: OpaqueDeliveryEnvelope): Promise<void> { const envelope = await this.decode(protectedEnvelope); if (!envelope) return;
    if (envelope.type === FABRIC_DELIVERY_ACK_TYPE) {
      // Only the destination of an envelope can confirm it; the ack is signed and verified like any envelope.
      const ids = (envelope.body as { ids?: unknown } | undefined)?.ids;
      if (Array.isArray(ids)) for (const id of ids.slice(0, 64)) if (typeof id === 'string' && this.unacknowledged.get(id)?.peer === envelope.sender) this.forgetAcknowledgement(id);
      return;
    }
    // A handler failure is an application decision about the content; the envelope itself still arrived.
    try { for (const handler of this.handlers) await handler(envelope); }
    finally { if ((this.options.retransmitDelaysMs ?? DEFAULT_RETRANSMIT_DELAYS_MS).length) void this.acknowledge(envelope).catch(() => undefined); }
  }
}

/** Simple provider factory useful to hosts and plugin adapters. */
export function createConnectivityFabric(providers: readonly TransportProvider[] = [], options?: ConnectivityFabricOptions): ConnectivityFabric { const fabric = new ConnectivityFabric(options); for (const provider of providers) fabric.registerProvider(provider); return fabric; }
