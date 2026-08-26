/**
 * R0P71 opportunistic gateway mesh.
 *
 * A gateway is a low-level provider bridge, not an application service.  The
 * client and bridge exchange only short-lived control envelopes over an
 * anonymous protected-neighbor source.  A bridge then submits the original
 * opaque Fabric envelope to its own ConnectivityFabric.  It never receives
 * application keys, plaintext or application authority, and it has no API
 * for arbitrary sockets, HTTP or LAN forwarding.
 */

import {
  ConnectivityError,
  ConnectivityFabric,
  createOpaqueDeliveryEnvelope,
  decodeOpaqueBytes,
  decodeOpaqueFrame,
  encodeOpaqueBytes,
  encodeOpaqueFrame,
  fragmentOpaqueEnvelope,
  OpaqueFragmentReassembler,
  type DeliveryAvailability,
  type DeliveryProfile,
  type DeliveryRequirement,
  type DeliveryResult,
  type OpaqueDeliveryEnvelope,
  type OpaqueFrame,
  type ReachabilityClass,
  type TransportAvailability,
  type TransportCapability,
  type TransportEndpoint,
  type TransportHealth,
  type TransportMetrics,
  type TransportProvider,
  type TransportProviderId,
  type TransportSecurityBoundary,
  type TransportSession,
} from './connectivity.js';
import type { AnonymousNeighborSessionSource } from './mesh-routing.js';

const VERSION = 1 as const;
const CONTROL_DESTINATION = 'keystone-gateway-control-v1';
const MAX_CONTROL_BYTES = 512 * 1024;
const CONTROL_MTU = 48 * 1024;
const MAX_GATEWAY_FRAME_BYTES = 256 * 1024;
const MAX_GATEWAY_HOPS = 8;
const MAX_CAPABILITY_TTL_MS = 5 * 60_000;
const MIN_CAPABILITY_TTL_MS = 1_000;
const MAX_REQUEST_TTL_MS = 5 * 60_000;
const MAX_NEIGHBORS = 32;
const DEFAULT_CLIENT_IDLE_MS = 30_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;
const DEFAULT_DISCOVERY_TIMEOUT_MS = 2_000;
const DEFAULT_INTERVAL_MS = 60_000;
const MAX_PENDING_GATEWAY_RESULTS = 256;
// A request result is retained only to make retries idempotent.  Bound the
// replay cache independently of the per-client/frame quotas so a rotating set
// of valid-looking request IDs cannot grow bridge memory until TTL cleanup.
const MAX_COMPLETED_GATEWAY_RESULTS = 4_096;

const GATEWAY_SECURITY: TransportSecurityBoundary = Object.freeze({ opaqueOnly: true, e2eRequired: true, canDecrypt: false, canAuthorize: false });

export type GatewayResourceProfile = 'BALANCED' | 'BATTERY_SAVER' | 'HIGH_AVAILABILITY';
export type GatewayPathClass = 'WIDER_REACHABILITY_AVAILABLE' | 'LOCAL_NETWORK' | 'MESH' | 'DELAY_TOLERANT';

/** Stranger-visible gateway metadata.  None of these fields identify a
 * person, device, host or network.  The token is scoped to this capability
 * epoch and is never a stable gateway identifier. */
export interface GatewayCapability {
  readonly version: typeof VERSION;
  readonly token: string;
  readonly expiresAt: string;
  readonly pathClass: GatewayPathClass;
  readonly profiles: readonly DeliveryProfile[];
  readonly metered: boolean | 'UNKNOWN';
  readonly resourceProfile: GatewayResourceProfile;
  readonly maxFrameBytes: number;
  readonly maxUses: number;
}

export interface GatewayLimits {
  readonly maxClients?: number;
  readonly maxCircuits?: number;
  readonly maxBytesPerInterval?: number;
  readonly maxFramesPerInterval?: number;
  readonly maxBytesPerClient?: number;
  readonly maxFramesPerClient?: number;
  readonly maxPendingRequests?: number;
  readonly maxCapabilityCandidates?: number;
  readonly maxClientIdleMs?: number;
  readonly intervalMs?: number;
  readonly maxHopCount?: number;
}

export interface GatewayBridgeOptions {
  readonly source: AnonymousNeighborSessionSource;
  /** The bridge's own Fabric.  It is the only authority allowed to choose a
   * wider provider and aggregate the delivery result. */
  readonly upstream: ConnectivityFabric;
  readonly providerId?: string;
  readonly now?: () => number;
  readonly resourceProfile?: GatewayResourceProfile;
  readonly metered?: boolean | 'UNKNOWN';
  readonly capabilityTtlMs?: number;
  readonly capabilityMaxUses?: number;
  readonly limits?: GatewayLimits;
  /** Hosts may narrow what counts as a wider Keystone provider.  The default
   * excludes gateway and delayed providers and accepts a live provider with
   * DIRECT/GLOBAL_REACH/MESH capability. */
  readonly isWiderProvider?: (provider: TransportProvider) => boolean;
}

export interface GatewayMeshTransportProviderOptions {
  readonly source: AnonymousNeighborSessionSource;
  readonly providerId?: string;
  readonly now?: () => number;
  readonly resourceProfile?: GatewayResourceProfile;
  readonly requestTimeoutMs?: number;
  readonly discoveryTimeoutMs?: number;
  readonly maxCapabilityCandidates?: number;
  readonly maxSessions?: number;
  readonly metered?: boolean | 'UNKNOWN';
}

export interface GatewayRouteSnapshot {
  readonly handle: string;
  readonly expiresAt: string;
  readonly pathClass: GatewayPathClass;
  readonly profiles: readonly DeliveryProfile[];
  readonly metered: boolean | 'UNKNOWN';
}

export interface GatewayBridgeDiagnostics {
  readonly running: boolean;
  readonly capabilityAvailable: boolean;
  readonly capabilityExpiresAt?: string;
  readonly activeClients: number;
  readonly activeCircuits: number;
  readonly bytesForwarded: number;
  readonly framesForwarded: number;
  readonly rejectedFrames: number;
  readonly duplicateRequests: number;
  readonly upstreamFailures: number;
  readonly resourceProfile: GatewayResourceProfile;
}

export interface GatewayProviderDiagnostics {
  readonly running: boolean;
  readonly candidateCount: number;
  readonly routeCount: number;
  readonly activeSessions: number;
  readonly rejectedFrames: number;
  readonly capabilityFailures: number;
  readonly resourceProfile: GatewayResourceProfile;
}

interface CapabilityRequestMessage {
  readonly version: typeof VERSION;
  readonly kind: 'gateway.capability.request';
  readonly requestId: string;
  readonly expiresAt: string;
}

interface CapabilityResponseMessage {
  readonly version: typeof VERSION;
  readonly kind: 'gateway.capability';
  readonly requestId: string;
  readonly expiresAt: string;
  readonly available: boolean;
  readonly capability?: GatewayCapability;
}

interface ForwardMessage {
  readonly version: typeof VERSION;
  readonly kind: 'gateway.forward';
  readonly requestId: string;
  readonly capabilityToken: string;
  readonly circuitId: string;
  readonly expiresAt: string;
  readonly hopCount: number;
  /** The sender's bounded delivery declaration. Fragments use BULK
   * conservatively because their original envelope metadata is not repeated
   * in each fragment. */
  readonly requirement: DeliveryRequirement;
  readonly frame: OpaqueFrame;
}

interface ForwardResultMessage {
  readonly version: typeof VERSION;
  readonly kind: 'gateway.result';
  readonly requestId: string;
  readonly expiresAt: string;
  readonly accepted: boolean;
  readonly destinationConfirmed: false;
  readonly availability: DeliveryAvailability;
  readonly reachability: ReachabilityClass;
  readonly failureCode?: string;
}

type GatewayMessage = CapabilityRequestMessage | CapabilityResponseMessage | ForwardMessage | ForwardResultMessage;

interface GatewayClientState {
  readonly session: TransportSession;
  lastUsedAt: number;
  bytes: number;
  frames: number;
  circuits: Set<string>;
}

interface CachedForwardResult {
  readonly result: ForwardResultMessage;
  readonly expiresAt: number;
}

interface GatewayRoute {
  readonly handle: string;
  readonly sourceSession: TransportSession;
  readonly capability: GatewayCapability;
  readonly expiresAt: number;
}

interface PendingResult {
  readonly resolve: (value: ForwardResultMessage) => void;
  readonly reject: (error: unknown) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

interface PendingCapability {
  readonly resolve: (value: CapabilityResponseMessage) => void;
  readonly reject: (error: unknown) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

const asProviderId = (value: string): TransportProviderId => value as TransportProviderId;
const iso = (at: number): string => new Date(at).toISOString();
const randomToken = (prefix: string): string => {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let value = '';
  if (typeof Buffer !== 'undefined') value = Buffer.from(bytes).toString('base64url');
  else { let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte); value = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  return `${prefix}:${value}`;
};
const boundedInt = (value: number | undefined, min: number, max: number, fallback: number): number => {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < min || resolved > max) throw new ConnectivityError('POLICY_DENIED', 'Gateway resource limit is invalid');
  return resolved;
};
const validToken = (value: unknown): value is string => typeof value === 'string' && value.length >= 24 && value.length <= 160 && /^[A-Za-z0-9:_-]+$/.test(value);
const validRequestId = (value: unknown): value is string => typeof value === 'string' && value.length >= 12 && value.length <= 160 && /^[A-Za-z0-9:_-]+$/.test(value);
const validDate = (value: unknown, now: number): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value)) && Date.parse(value) > now;
const validRequirement = (value: unknown): value is DeliveryRequirement => !!value && typeof value === 'object' && ['CONTROL', 'INTERACTIVE', 'REALTIME', 'EVENTUAL', 'BULK', 'BACKGROUND', 'BEST_EFFORT'].includes(String((value as { profile?: unknown }).profile));
const utf8 = (value: string): Uint8Array => new TextEncoder().encode(value);
const text = (value: Uint8Array): string => new TextDecoder('utf-8', { fatal: true }).decode(value);

function profileAllowed(capability: GatewayCapability, requirement: DeliveryRequirement): boolean {
  if (requirement.profile === 'REALTIME') return false;
  if (!capability.profiles.includes(requirement.profile)) return false;
  if (capability.metered === true && requirement.allowMetered === false) return false;
  if (capability.metered === true && requirement.profile === 'BULK') return false;
  return true;
}

function gatewayProfiles(profile: GatewayResourceProfile, metered: boolean | 'UNKNOWN'): readonly DeliveryProfile[] {
  if (profile === 'BATTERY_SAVER') return ['CONTROL', 'INTERACTIVE', 'EVENTUAL', 'BEST_EFFORT'];
  if (profile === 'HIGH_AVAILABILITY' && metered !== true) return ['CONTROL', 'INTERACTIVE', 'EVENTUAL', 'BACKGROUND', 'BULK', 'BEST_EFFORT'];
  return ['CONTROL', 'INTERACTIVE', 'EVENTUAL', 'BACKGROUND', 'BEST_EFFORT'];
}

function defaultWiderProvider(provider: TransportProvider): boolean {
  if (provider.type === 'GatewayMeshTransport' || provider.type === 'DelayTolerantTransport') return false;
  const availability = provider.health().availability;
  if (availability !== 'AVAILABLE' && availability !== 'DEGRADED') return false;
  const capabilities = new Set(provider.capabilities());
  return capabilities.has('GLOBAL_REACH') || capabilities.has('DIRECT') || capabilities.has('MESH');
}

function normalizeLimits(limits: GatewayLimits | undefined): Required<GatewayLimits> {
  return {
    maxClients: boundedInt(limits?.maxClients, 1, 256, 16),
    maxCircuits: boundedInt(limits?.maxCircuits, 1, 512, 64),
    maxBytesPerInterval: boundedInt(limits?.maxBytesPerInterval, 1_024, 512 * 1024 * 1024, 8 * 1024 * 1024),
    maxFramesPerInterval: boundedInt(limits?.maxFramesPerInterval, 1, 100_000, 512),
    maxBytesPerClient: boundedInt(limits?.maxBytesPerClient, 1_024, 256 * 1024 * 1024, 2 * 1024 * 1024),
    maxFramesPerClient: boundedInt(limits?.maxFramesPerClient, 1, 20_000, 128),
    maxPendingRequests: boundedInt(limits?.maxPendingRequests, 1, 512, 64),
    maxCapabilityCandidates: boundedInt(limits?.maxCapabilityCandidates, 1, MAX_NEIGHBORS, 8),
    maxClientIdleMs: boundedInt(limits?.maxClientIdleMs, 1_000, 10 * 60_000, DEFAULT_CLIENT_IDLE_MS),
    intervalMs: boundedInt(limits?.intervalMs, 1_000, 10 * 60_000, DEFAULT_INTERVAL_MS),
    maxHopCount: boundedInt(limits?.maxHopCount, 1, MAX_GATEWAY_HOPS, MAX_GATEWAY_HOPS),
  };
}

function validateCapability(value: unknown, now: number): asserts value is GatewayCapability {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ConnectivityError('POLICY_DENIED', 'Gateway capability is malformed');
  const item = value as Record<string, unknown>;
  if (item.version !== VERSION || !validToken(item.token) || item.pathClass !== 'WIDER_REACHABILITY_AVAILABLE' || !validDate(item.expiresAt, now) || typeof item.metered !== 'boolean' && item.metered !== 'UNKNOWN' || !Array.isArray(item.profiles) || item.profiles.some(profile => !['CONTROL', 'INTERACTIVE', 'EVENTUAL', 'BACKGROUND', 'BULK', 'BEST_EFFORT', 'REALTIME'].includes(profile as string)) || !Number.isSafeInteger(item.maxFrameBytes) || (item.maxFrameBytes as number) < 1 || (item.maxFrameBytes as number) > MAX_GATEWAY_FRAME_BYTES || !Number.isSafeInteger(item.maxUses) || (item.maxUses as number) < 1 || (item.maxUses as number) > 100_000 || !['BALANCED', 'BATTERY_SAVER', 'HIGH_AVAILABILITY'].includes(item.resourceProfile as string)) throw new ConnectivityError('POLICY_DENIED', 'Gateway capability fields are invalid');
}

function validateMessage(value: unknown, now: number): value is GatewayMessage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  if (item.version !== VERSION || typeof item.kind !== 'string' || !validRequestId(item.requestId) || !validDate(item.expiresAt, now)) return false;
  if (item.kind === 'gateway.capability.request') return true;
  if (item.kind === 'gateway.capability') {
    if (typeof item.available !== 'boolean') return false;
    if (item.available) { try { validateCapability(item.capability, now); } catch { return false; } }
    return true;
  }
  if (item.kind === 'gateway.result') return typeof item.accepted === 'boolean' && item.destinationConfirmed === false && typeof item.availability === 'string' && typeof item.reachability === 'string';
  if (item.kind === 'gateway.forward') return validToken(item.capabilityToken) && validToken(item.circuitId) && Number.isSafeInteger(item.hopCount) && (item.hopCount as number) >= 0 && (item.hopCount as number) <= MAX_GATEWAY_HOPS && validRequirement(item.requirement) && item.frame !== undefined;
  return false;
}

async function encodeControl(message: GatewayMessage, now: number, expiresAt?: string): Promise<OpaqueDeliveryEnvelope> {
  const expiry = expiresAt ?? iso(Math.min(now + MAX_REQUEST_TTL_MS, Date.parse(message.expiresAt)));
  const encoded = JSON.stringify(message);
  if (utf8(encoded).byteLength > MAX_CONTROL_BYTES) throw new ConnectivityError('RESOURCE_LIMIT', 'Gateway control frame exceeds bound');
  return createOpaqueDeliveryEnvelope({ destination: CONTROL_DESTINATION, ciphertext: utf8(encoded), replayNonce: randomToken('gateway-nonce'), expiresAt: expiry, requirement: { profile: 'CONTROL' } });
}

async function decodeControl(frame: OpaqueFrame, now: number): Promise<GatewayMessage | undefined> {
  try {
    if ('kind' in frame || frame.destination !== CONTROL_DESTINATION || !validDate(frame.expiresAt, now)) return undefined;
    const expected = `sha256:${await digestControl(frame.ciphertext)}`;
    if (expected !== frame.integrity) return undefined;
    const message = JSON.parse(text(decodeOpaqueBytes(frame.ciphertext))) as unknown;
    return validateMessage(message, now) ? message : undefined;
  } catch { return undefined; }
}

async function digestControl(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(value) as unknown as ArrayBuffer));
  let encoded: string;
  if (typeof Buffer !== 'undefined') encoded = Buffer.from(bytes).toString('base64url');
  else { let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte); encoded = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  return encoded;
}

async function decodeGatewayControl(frame: OpaqueFrame, reassembler: OpaqueFragmentReassembler, now: number): Promise<GatewayMessage | undefined> {
  const envelope = 'kind' in frame ? await reassembler.add(frame) : frame;
  return envelope ? decodeControl(envelope, now) : undefined;
}

async function sendGatewayControl(source: AnonymousNeighborSessionSource, session: TransportSession, message: GatewayMessage, now: number, expiresAt?: string): Promise<void> {
  const envelope = await encodeControl(message, now, expiresAt);
  if (encodeOpaqueFrame(envelope).byteLength <= CONTROL_MTU) { await source.sendNeighborFrame(session, envelope); return; }
  const fragments = await fragmentOpaqueEnvelope(envelope, CONTROL_MTU);
  for (const fragment of fragments) await source.sendNeighborFrame(session, fragment);
}

function frameBytes(frame: OpaqueFrame): number {
  try { return encodeOpaqueFrame(frame).byteLength; } catch { return Number.POSITIVE_INFINITY; }
}

/** Bridge half hosted by a node which has a wider Keystone provider. */
export class GatewayBridge {
  readonly id: TransportProviderId;
  private readonly source: AnonymousNeighborSessionSource;
  private readonly upstream: ConnectivityFabric;
  private readonly now: () => number;
  private readonly limits: Required<GatewayLimits>;
  private resourceProfile: GatewayResourceProfile;
  private readonly metered: boolean | 'UNKNOWN';
  private readonly capabilityTtlMs: number;
  private readonly capabilityMaxUses: number;
  private readonly isWiderProvider: (provider: TransportProvider) => boolean;
  private readonly clients = new Map<string, GatewayClientState>();
  private readonly completed = new Map<string, CachedForwardResult>();
  private readonly inFlight = new Set<string>();
  private readonly reassembler = new OpaqueFragmentReassembler({ maxTransfers: 64, maxBytes: 32 * 1024 * 1024 });
  private readonly controlReassembler = new OpaqueFragmentReassembler({ maxTransfers: 64, maxBytes: 2 * 1024 * 1024 });
  private unsubscribe?: () => void;
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private capability?: GatewayCapability;
  private capabilityUses = 0;
  private intervalStartedAt = 0;
  private intervalBytes = 0;
  private intervalFrames = 0;
  private bytesForwarded = 0;
  private framesForwarded = 0;
  private rejectedFrames = 0;
  private duplicateRequests = 0;
  private upstreamFailures = 0;
  private pendingRequests = 0;
  private instanceToken = randomToken('gateway-instance');

  constructor(options: GatewayBridgeOptions) {
    this.id = asProviderId(options.providerId ?? 'gateway-bridge');
    this.source = options.source; this.upstream = options.upstream; this.now = options.now ?? Date.now;
    this.resourceProfile = options.resourceProfile ?? 'BALANCED'; this.metered = options.metered ?? 'UNKNOWN';
    this.capabilityTtlMs = boundedInt(options.capabilityTtlMs, MIN_CAPABILITY_TTL_MS, MAX_CAPABILITY_TTL_MS, 60_000);
    this.capabilityMaxUses = boundedInt(options.capabilityMaxUses, 1, 100_000, 256);
    this.limits = normalizeLimits(options.limits); this.isWiderProvider = options.isWiderProvider ?? defaultWiderProvider;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.unsubscribe = this.source.onNeighborFrame((frame, session) => { void this.receive(frame, session); });
    await this.source.start?.(); this.running = true; this.intervalStartedAt = this.now();
    this.timer = setInterval(() => this.maintenance(), 1_000); (this.timer as { unref?: () => void }).unref?.();
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false; if (this.timer) clearInterval(this.timer); this.timer = undefined; this.unsubscribe?.(); this.unsubscribe = undefined;
    for (const state of this.clients.values()) await this.source.closeNeighborSession(state.session).catch(() => undefined);
    this.clients.clear(); this.completed.clear(); this.inFlight.clear(); this.reassembler.clear(); this.controlReassembler.clear(); this.capability = undefined; this.capabilityUses = 0; this.instanceToken = randomToken('gateway-instance');
    await this.source.stop?.();
  }

  setResourceProfile(profile: GatewayResourceProfile): void { if (this.resourceProfile === profile) return; this.resourceProfile = profile; this.rotateCapability(); }

  rotateCapability(): void { this.capability = undefined; this.capabilityUses = 0; }

  /** Local bridge-host inspection only. It is not a social/profile lookup and
   * must not be surfaced as a stable public gateway identity. */
  advertisedCapability(): GatewayCapability | undefined { const value = this.currentCapability(); return value ? { ...value, profiles: [...value.profiles] } : undefined; }

  diagnostics(): GatewayBridgeDiagnostics {
    const capability = this.currentCapability();
    return { running: this.running, capabilityAvailable: capability !== undefined, ...(capability ? { capabilityExpiresAt: capability.expiresAt } : {}), activeClients: this.clients.size, activeCircuits: [...this.clients.values()].reduce((count, state) => count + state.circuits.size, 0), bytesForwarded: this.bytesForwarded, framesForwarded: this.framesForwarded, rejectedFrames: this.rejectedFrames, duplicateRequests: this.duplicateRequests, upstreamFailures: this.upstreamFailures, resourceProfile: this.resourceProfile };
  }

  private widerAvailable(): boolean {
    // A provider may remain registered after the upstream Fabric has been
    // stopped.  Registration alone is not evidence that the bridge can
    // forward traffic, so capability advertisement must fail closed until
    // the canonical Fabric is running again.
    return this.running && this.upstream.isRunning() && this.upstream.providersList().some(provider => this.isWiderProviderCandidate(provider));
  }

  private isWiderProviderCandidate(provider: TransportProvider): boolean {
    // Even a host-supplied predicate cannot opt a gateway/DTN provider back
    // into upstream selection: doing so would create a second opaque bridge
    // hop with a reset hop budget and could form a forwarding loop.
    if (provider.type === 'GatewayMeshTransport' || provider.type === 'DelayTolerantTransport') return false;
    return this.isWiderProvider(provider);
  }

  private currentCapability(): GatewayCapability | undefined {
    if (!this.widerAvailable()) { this.capability = undefined; this.capabilityUses = 0; return undefined; }
    const at = this.now();
    if (this.capability && Date.parse(this.capability.expiresAt) > at && this.capabilityUses < this.capability.maxUses) return this.capability;
    this.capability = { version: VERSION, token: randomToken('gateway-capability'), expiresAt: iso(at + this.capabilityTtlMs), pathClass: 'WIDER_REACHABILITY_AVAILABLE', profiles: gatewayProfiles(this.resourceProfile, this.metered), metered: this.metered, resourceProfile: this.resourceProfile, maxFrameBytes: MAX_GATEWAY_FRAME_BYTES, maxUses: this.capabilityMaxUses };
    this.capabilityUses = 0; return this.capability;
  }

  private async receive(frame: OpaqueFrame, session?: TransportSession): Promise<void> {
    const message = await decodeGatewayControl(frame, this.controlReassembler, this.now()); if (!message || !session || !this.running) { if (message === undefined && session && !('kind' in frame)) this.rejectedFrames += 1; return; }
    if (message.kind === 'gateway.capability.request') await this.handleCapabilityRequest(message, session);
    else if (message.kind === 'gateway.forward') await this.handleForward(message, session);
  }

  private async reply(session: TransportSession, message: GatewayMessage): Promise<void> {
    try { await sendGatewayControl(this.source, session, message, this.now()); } catch { this.rejectedFrames += 1; }
  }

  private async handleCapabilityRequest(message: CapabilityRequestMessage, session: TransportSession): Promise<void> {
    const capability = this.currentCapability();
    await this.reply(session, { version: VERSION, kind: 'gateway.capability', requestId: message.requestId, expiresAt: iso(Math.min(Date.parse(message.expiresAt), this.now() + MAX_REQUEST_TTL_MS)), available: capability !== undefined, ...(capability ? { capability } : {}) });
  }

  private rejectResult(message: ForwardMessage, code: string): ForwardResultMessage {
    return { version: VERSION, kind: 'gateway.result', requestId: message.requestId, expiresAt: iso(Math.min(Date.parse(message.expiresAt), this.now() + MAX_REQUEST_TTL_MS)), accepted: false, destinationConfirmed: false, availability: 'TEMPORARILY_UNAVAILABLE', reachability: 'UNAVAILABLE', failureCode: code };
  }

  private async handleForward(message: ForwardMessage, session: TransportSession): Promise<void> {
    const now = this.now();
    let result: ForwardResultMessage | undefined;
    const cached = this.completed.get(message.requestId);
    if (cached && cached.expiresAt > now) { this.duplicateRequests += 1; await this.reply(session, cached.result); return; }
    if (this.inFlight.has(message.requestId)) { this.duplicateRequests += 1; await this.reply(session, this.rejectResult(message, 'DUPLICATE_REQUEST')); return; }
    this.inFlight.add(message.requestId);
    if (this.pendingRequests >= this.limits.maxPendingRequests || !validToken(message.capabilityToken) || !validToken(message.circuitId) || message.hopCount >= this.limits.maxHopCount || !validDate(message.expiresAt, now) || frameBytes(message.frame) > MAX_GATEWAY_FRAME_BYTES) result = this.rejectResult(message, 'RESOURCE_LIMIT');
    const capability = this.currentCapability();
    if (!result && (!capability || capability.token !== message.capabilityToken || this.capabilityUses >= capability.maxUses)) result = this.rejectResult(message, 'CAPABILITY_EXPIRED');
    if (!result) {
      const requirement = 'kind' in message.frame ? message.requirement : message.frame.requirement;
      if (!requirement || !profileAllowed(capability!, requirement)) result = this.rejectResult(message, 'POLICY_DENIED');
    }
    let client = this.clients.get(session.id);
    if (!result && !client && this.clients.size >= this.limits.maxClients) result = this.rejectResult(message, 'RESOURCE_LIMIT');
    if (!result) {
      client ??= { session, lastUsedAt: now, bytes: 0, frames: 0, circuits: new Set() };
      const bytes = frameBytes(message.frame);
      if (client.bytes + bytes > this.limits.maxBytesPerClient || client.frames + 1 > this.limits.maxFramesPerClient || this.intervalBytes + bytes > this.limits.maxBytesPerInterval || this.intervalFrames + 1 > this.limits.maxFramesPerInterval || client.circuits.size >= this.limits.maxCircuits) result = this.rejectResult(message, 'RESOURCE_LIMIT');
      else { client.lastUsedAt = now; client.bytes += bytes; client.frames += 1; client.circuits.add(message.circuitId); this.clients.set(session.id, client); this.capabilityUses += 1; this.intervalBytes += bytes; this.intervalFrames += 1; }
    }
    if (!result) {
      this.pendingRequests += 1;
      try {
        let envelope: OpaqueDeliveryEnvelope | undefined;
        if ('kind' in message.frame) envelope = await this.reassembler.add(message.frame);
        else envelope = message.frame;
        if (!envelope) result = { version: VERSION, kind: 'gateway.result', requestId: message.requestId, expiresAt: iso(Math.min(Date.parse(message.expiresAt), now + MAX_REQUEST_TTL_MS)), accepted: true, destinationConfirmed: false, availability: 'TEMPORARILY_UNAVAILABLE', reachability: 'EVENTUALLY' };
        else {
          const delivery = await this.forwardToUpstream(envelope);
          result = this.resultFromDelivery(message, delivery);
        }
      } catch (error) { this.upstreamFailures += 1; result = this.rejectResult(message, error instanceof ConnectivityError ? error.code : 'SESSION_FAILED'); }
      finally { this.pendingRequests = Math.max(0, this.pendingRequests - 1); }
    }
    if (this.completed.size >= MAX_COMPLETED_GATEWAY_RESULTS) {
      const oldest = this.completed.keys().next().value as string | undefined;
      if (oldest) this.completed.delete(oldest);
    }
    this.completed.set(message.requestId, { result: result!, expiresAt: Math.min(Date.parse(message.expiresAt), now + MAX_REQUEST_TTL_MS) }); this.inFlight.delete(message.requestId);
    this.framesForwarded += result!.accepted ? 1 : 0; this.bytesForwarded += result!.accepted ? frameBytes(message.frame) : 0;
    await this.reply(session, result!);
  }

  private async forwardToUpstream(envelope: OpaqueDeliveryEnvelope): Promise<DeliveryResult> {
    // The bridge submits the original protected envelope to the existing
    // Fabric. It never re-signs, decrypts, unwraps or synthesizes an ACK.
    return this.upstream.deliver({ id: envelope.id, destination: envelope.destination, envelope, requirement: envelope.requirement });
  }

  private resultFromDelivery(message: ForwardMessage, delivery: DeliveryResult): ForwardResultMessage {
    return { version: VERSION, kind: 'gateway.result', requestId: message.requestId, expiresAt: iso(Math.min(Date.parse(message.expiresAt), this.now() + MAX_REQUEST_TTL_MS)), accepted: delivery.ok, destinationConfirmed: false, availability: delivery.availability, reachability: delivery.reachability, ...(delivery.ok ? {} : { failureCode: delivery.failure?.code ?? 'DELIVERY_UNCONFIRMED' }) };
  }

  private maintenance(): void {
    const now = this.now();
    if (now - this.intervalStartedAt >= this.limits.intervalMs) { this.intervalStartedAt = now; this.intervalBytes = 0; this.intervalFrames = 0; }
    for (const [id, state] of this.clients) if (state.lastUsedAt + this.limits.maxClientIdleMs <= now) { this.clients.delete(id); void this.source.closeNeighborSession(state.session).catch(() => undefined); }
    for (const [id, value] of this.completed) if (value.expiresAt <= now) this.completed.delete(id);
    if (this.capability && Date.parse(this.capability.expiresAt) <= now) this.capability = undefined;
  }
}

/** Client half of the gateway bridge, exposed as an ordinary Fabric provider. */
export class GatewayMeshTransportProvider implements TransportProvider {
  readonly id: TransportProviderId;
  readonly type = 'GatewayMeshTransport' as const;
  readonly security = GATEWAY_SECURITY;
  readonly mtu = MAX_GATEWAY_FRAME_BYTES;
  private readonly source: AnonymousNeighborSessionSource;
  private readonly now: () => number;
  private resourceProfile: GatewayResourceProfile;
  private readonly requestTimeoutMs: number;
  private readonly discoveryTimeoutMs: number;
  private readonly maxCapabilityCandidates: number;
  private readonly maxSessions: number;
  private readonly metered: boolean | 'UNKNOWN';
  private readonly routes = new Map<string, GatewayRoute>();
  private readonly routeByHandle = new Map<string, GatewayRoute>();
  private readonly sessions = new Map<string, { readonly logical: TransportSession; readonly route: GatewayRoute }>();
  private readonly pendingResults = new Map<string, PendingResult>();
  private readonly pendingCapabilities = new Map<string, PendingCapability>();
  private readonly listeners = new Set<(frame: OpaqueFrame, session?: TransportSession) => void | Promise<void>>();
  private readonly controlReassembler = new OpaqueFragmentReassembler({ maxTransfers: 64, maxBytes: 2 * 1024 * 1024 });
  private readonly neighbors = new Map<string, string>();
  private unsubscribe?: () => void;
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private availability: TransportAvailability = 'UNKNOWN';
  private checkedAt = iso(Date.now());
  private rejectedFrames = 0;
  private capabilityFailures = 0;

  constructor(options: GatewayMeshTransportProviderOptions) {
    this.id = asProviderId(options.providerId ?? `gateway:${crypto.randomUUID()}`); this.source = options.source; this.now = options.now ?? Date.now; this.resourceProfile = options.resourceProfile ?? 'BALANCED';
    this.requestTimeoutMs = boundedInt(options.requestTimeoutMs, 1_000, 120_000, DEFAULT_REQUEST_TIMEOUT_MS); this.discoveryTimeoutMs = boundedInt(options.discoveryTimeoutMs, 250, 30_000, DEFAULT_DISCOVERY_TIMEOUT_MS); this.maxCapabilityCandidates = boundedInt(options.maxCapabilityCandidates, 1, MAX_NEIGHBORS, 8); this.maxSessions = boundedInt(options.maxSessions, 1, 128, 16); this.metered = options.metered ?? 'UNKNOWN';
  }

  capabilities(): readonly TransportCapability[] {
    const capabilities: TransportCapability[] = ['DISCOVERY', 'DATAGRAM', 'CONTROL', 'INTERACTIVE', 'BULK', 'BACKGROUND', 'LOW_BANDWIDTH', 'MESH', 'GLOBAL_REACH'];
    if (this.metered === true) capabilities.push('METERED');
    return capabilities;
  }
  routeMetadata(): { readonly family: 'gateway'; readonly pathKind: 'LIVE' } { return { family: 'gateway', pathKind: 'LIVE' }; }

  async probe(): Promise<TransportAvailability> { this.availability = 'AVAILABLE'; this.checkedAt = iso(this.now()); return this.availability; }
  health(): TransportHealth { return { state: this.availability === 'AVAILABLE' ? 'HEALTHY' : this.availability === 'UNKNOWN' ? 'UNKNOWN' : 'DEGRADED', availability: this.availability, checkedAt: this.checkedAt }; }

  async start(): Promise<void> {
    if (this.running) return;
    this.unsubscribe = this.source.onNeighborFrame((frame, session) => { void this.receive(frame, session); });
    await this.source.start?.(); this.running = true; await this.probe(); this.timer = setInterval(() => this.maintenance(), 1_000); (this.timer as { unref?: () => void }).unref?.();
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false; if (this.timer) clearInterval(this.timer); this.timer = undefined; this.unsubscribe?.(); this.unsubscribe = undefined; this.availability = 'UNKNOWN';
    for (const pending of this.pendingResults.values()) { clearTimeout(pending.timer); pending.reject(new ConnectivityError('SESSION_FAILED', 'Gateway provider stopped')); }
    for (const pending of this.pendingCapabilities.values()) { clearTimeout(pending.timer); pending.reject(new ConnectivityError('SESSION_FAILED', 'Gateway provider stopped')); }
    this.pendingResults.clear(); this.pendingCapabilities.clear();
    for (const route of this.routeByHandle.values()) await this.source.closeNeighborSession(route.sourceSession).catch(() => undefined);
    this.routes.clear(); this.routeByHandle.clear(); this.sessions.clear(); this.neighbors.clear(); this.controlReassembler.clear(); await this.source.stop?.();
  }

  isPeerConnected(_destination: string): boolean { return false; }

  setResourceProfile(profile: GatewayResourceProfile): void {
    if (this.resourceProfile === profile) return;
    this.resourceProfile = profile;
    for (const route of this.routeByHandle.values()) this.invalidateRoute(route);
    this.routes.clear();
  }

  async discoverDirectReachability(_destination: string, requirement: DeliveryRequirement = { profile: 'BEST_EFFORT' }): Promise<readonly TransportEndpoint[]> {
    if (!this.running || requirement.profile === 'REALTIME') return [];
    this.maintenance();
    const now = this.now(); const observations = this.source.listNeighbors(this.maxCapabilityCandidates).filter(value => validDate(value.expiresAt, now)).slice(0, this.maxCapabilityCandidates);
    const candidates: TransportEndpoint[] = [];
    // A bounded parallel probe avoids serially blocking application callers
    // while retaining a strict candidate cap and no unbounded discovery work.
    const values = await Promise.all(observations.map(async observation => {
      try {
        const route = await this.ensureRoute(observation.handle, observation.expiresAt);
        if (!profileAllowed(route.capability, requirement)) return undefined;
        const handle = randomToken('gateway-endpoint'); const endpoint: TransportEndpoint = { handle, providerId: this.id, providerType: this.type, routeReference: handle, expiresAt: route.capability.expiresAt, anonymous: true }; this.routes.set(handle, route); return endpoint;
      } catch { this.capabilityFailures += 1; return undefined; }
    }));
    for (const endpoint of values) if (endpoint) candidates.push(endpoint);
    return candidates;
  }

  async openSession(endpoint: TransportEndpoint): Promise<TransportSession> {
    if (!this.running || endpoint.providerId !== this.id || endpoint.providerType !== this.type) throw new ConnectivityError('POLICY_DENIED', 'Gateway endpoint is invalid');
    const route = this.routes.get(endpoint.routeReference); if (!route || route.expiresAt <= this.now()) throw new ConnectivityError('TRANSPORT_UNAVAILABLE', 'Gateway capability has expired');
    if (this.sessions.size >= this.maxSessions) throw new ConnectivityError('RESOURCE_LIMIT', 'Gateway session bound exceeded');
    const logical: TransportSession = { id: randomToken('gateway-session'), endpoint, providerId: this.id, openedAt: iso(this.now()), state: 'OPEN' };
    this.sessions.set(logical.id, { logical, route }); return logical;
  }

  async sendOpaqueFrame(session: TransportSession, frame: OpaqueFrame): Promise<void> {
    const binding = this.sessions.get(session.id); if (!binding || session.state !== 'OPEN') throw new ConnectivityError('SESSION_FAILED', 'Gateway session is closed');
    const routes = [binding.route, ...[...this.routeByHandle.values()].filter(route => route.handle !== binding.route.handle)].slice(0, 2);
    let lastError: unknown;
    for (const route of routes) {
      try { await this.sendViaRoute(route, frame); return; } catch (error) { lastError = error; if (error instanceof ConnectivityError && (error.code === 'CAPABILITY_EXPIRED' || error.code === 'TRANSPORT_UNAVAILABLE' || error.code === 'TIMEOUT')) this.invalidateRoute(route); }
    }
    throw lastError instanceof Error ? lastError : new ConnectivityError('DELIVERY_UNCONFIRMED', 'All bounded gateway routes failed');
  }

  private async sendViaRoute(route: GatewayRoute, frame: OpaqueFrame): Promise<void> {
    if (route.expiresAt <= this.now()) throw new ConnectivityError('TRANSPORT_UNAVAILABLE', 'Gateway route has expired');
    if (frameBytes(frame) > route.capability.maxFrameBytes) throw new ConnectivityError('MTU_EXCEEDED', 'Gateway frame exceeds capability bound');
    if (this.pendingResults.size >= MAX_PENDING_GATEWAY_RESULTS) throw new ConnectivityError('RESOURCE_LIMIT', 'Gateway pending result bound exceeded');
    const requestId = randomToken('gateway-forward'); const message: ForwardMessage = { version: VERSION, kind: 'gateway.forward', requestId, capabilityToken: route.capability.token, circuitId: randomToken('gateway-circuit'), expiresAt: frame.expiresAt, hopCount: 0, requirement: 'kind' in frame ? { profile: 'BULK', allowMetered: false } : frame.requirement, frame };
    const resultPromise = new Promise<ForwardResultMessage>((resolve, reject) => { const timer = setTimeout(() => { this.pendingResults.delete(requestId); reject(new ConnectivityError('TIMEOUT', 'Gateway forwarding timed out')); }, this.requestTimeoutMs); this.pendingResults.set(requestId, { resolve, reject, timer }); });
    try { await sendGatewayControl(this.source, route.sourceSession, message, this.now(), message.expiresAt); } catch (error) { this.pendingResults.delete(requestId); throw error; }
    const result = await resultPromise;
    if (result.destinationConfirmed) throw new ConnectivityError('POLICY_DENIED', 'Gateway cannot claim a destination receipt');
    if (!result.accepted) throw new ConnectivityError((result.failureCode as 'TRANSPORT_UNAVAILABLE' | 'POLICY_DENIED' | 'CAPABILITY_EXPIRED' | 'RESOURCE_LIMIT' | 'TIMEOUT' | 'DELIVERY_UNCONFIRMED') || 'DELIVERY_UNCONFIRMED', 'Gateway did not accept the opaque delivery');
  }

  private invalidateRoute(route: GatewayRoute): void { this.routeByHandle.delete(route.handle); this.neighbors.delete(route.handle); void this.source.closeNeighborSession(route.sourceSession).catch(() => undefined); }

  receiveOpaqueFrame(handler: (frame: OpaqueFrame, session?: TransportSession) => void | Promise<void>): () => void { this.listeners.add(handler); return () => this.listeners.delete(handler); }
  async measureLink(_session?: TransportSession): Promise<TransportMetrics> { return { mtu: this.mtu, queuePressure: this.pendingResults.size / 64, cost: this.metered === true ? 'METERED' : 'UNKNOWN', energy: 'MEDIUM', metered: this.metered, observedAt: iso(this.now()) }; }
  async close(session: TransportSession): Promise<void> { this.sessions.delete(session.id); }
  diagnostics(): GatewayProviderDiagnostics { return { running: this.running, candidateCount: this.neighbors.size, routeCount: this.routeByHandle.size, activeSessions: this.sessions.size, rejectedFrames: this.rejectedFrames, capabilityFailures: this.capabilityFailures, resourceProfile: this.resourceProfile }; }
  knownRoutes(): readonly GatewayRouteSnapshot[] { this.maintenance(); return [...this.routeByHandle.values()].map(route => ({ handle: route.handle, expiresAt: iso(route.expiresAt), pathClass: route.capability.pathClass, profiles: route.capability.profiles, metered: route.capability.metered })); }

  private async ensureRoute(handle: string, observedExpiry: string): Promise<GatewayRoute> {
    const now = this.now(); const existing = this.routeByHandle.get(handle); let reusable = existing;
    if (reusable && reusable.expiresAt <= now) { await this.source.closeNeighborSession(reusable.sourceSession).catch(() => undefined); this.routeByHandle.delete(handle); reusable = undefined; }
    if (!reusable && this.routeByHandle.size >= this.maxCapabilityCandidates) throw new ConnectivityError('RESOURCE_LIMIT', 'Gateway candidate bound exceeded');
    const sourceSession = reusable?.sourceSession ?? await this.source.openNeighbor(handle);
    const response = await this.requestCapability(sourceSession, now).catch(async error => { await this.source.closeNeighborSession(sourceSession).catch(() => undefined); this.routeByHandle.delete(handle); throw error; });
    if (!response.available || !response.capability) { await this.source.closeNeighborSession(sourceSession).catch(() => undefined); this.routeByHandle.delete(handle); throw new ConnectivityError('TRANSPORT_UNAVAILABLE', 'Gateway has no wider path'); }
    validateCapability(response.capability, now); const route: GatewayRoute = { handle, sourceSession, capability: response.capability, expiresAt: Math.min(Date.parse(response.capability.expiresAt), Date.parse(observedExpiry)) }; this.routeByHandle.set(handle, route); this.neighbors.set(handle, response.capability.token); return route;
  }

  private async requestCapability(sourceSession: TransportSession, now: number): Promise<CapabilityResponseMessage> {
    const requestId = randomToken('gateway-capability');
    if (this.pendingCapabilities.size >= this.maxCapabilityCandidates) throw new ConnectivityError('RESOURCE_LIMIT', 'Gateway capability probe bound exceeded');
    const responsePromise = new Promise<CapabilityResponseMessage>((resolve, reject) => {
      const timer = setTimeout(() => { this.pendingCapabilities.delete(requestId); reject(new ConnectivityError('TIMEOUT', 'Gateway capability request timed out')); }, this.discoveryTimeoutMs);
      this.pendingCapabilities.set(requestId, { resolve, reject, timer });
    });
    try { await sendGatewayControl(this.source, sourceSession, { version: VERSION, kind: 'gateway.capability.request', requestId, expiresAt: iso(now + this.discoveryTimeoutMs) }, now); }
    catch (error) { this.pendingCapabilities.delete(requestId); throw error; }
    return responsePromise;
  }

  private async receive(frame: OpaqueFrame, session?: TransportSession): Promise<void> {
    const message = await decodeGatewayControl(frame, this.controlReassembler, this.now()); if (!message || !session) { if (session && !('kind' in frame)) this.rejectedFrames += 1; return; }
    if (message.kind === 'gateway.capability') { const pending = this.pendingCapabilities.get(message.requestId); if (pending) { this.pendingCapabilities.delete(message.requestId); clearTimeout(pending.timer); pending.resolve(message); } return; }
    if (message.kind === 'gateway.result') { const pending = this.pendingResults.get(message.requestId); if (pending) { this.pendingResults.delete(message.requestId); clearTimeout(pending.timer); pending.resolve(message); } return; }
  }

  private maintenance(): void {
    const now = this.now();
    for (const [handle, route] of this.routeByHandle) if (route.expiresAt <= now) { this.routeByHandle.delete(handle); this.neighbors.delete(handle); void this.source.closeNeighborSession(route.sourceSession).catch(() => undefined); }
    for (const [handle, route] of this.routes) if (route.expiresAt <= now) this.routes.delete(handle);
  }
}

/** Adapter for hosts that already expose R0P69 anonymous neighbor sources. */
export function createGatewayMeshTransportProvider(source: AnonymousNeighborSessionSource, options: Omit<GatewayMeshTransportProviderOptions, 'source'> = {}): GatewayMeshTransportProvider {
  return new GatewayMeshTransportProvider({ ...options, source });
}

export const GATEWAY_CONTROL_DESTINATION = CONTROL_DESTINATION;
export const GATEWAY_MAX_HOPS = MAX_GATEWAY_HOPS;
