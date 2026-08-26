/**
 * R0P68 anonymous one-hop nearby transport.
 *
 * The radio/link adapter never receives a Keystone social identity. The
 * provider translates a Fabric destination into a short-lived anonymous
 * rendezvous handle locally, establishes an ephemeral X25519 session and
 * carries only encrypted opaque Fabric frames.
 */

import type {
  NativeBluetoothAdvertisementSession,
  NativeBluetoothConnection,
  NativeBluetoothEndpointObservation,
  NativeBluetoothHost,
  NativeBluetoothPhy,
  NativeBluetoothScanSession,
  NativeHostRequest,
} from '@keystone/native-host';
import {
  ConnectivityError,
  ConnectivityResourceGovernor,
  decodeOpaqueFrame,
  encodeOpaqueFrame,
  type DeliveryRequirement,
  type OpaqueFrame,
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

export type AnonymousNearbyPeerHandle = string & { readonly __anonymousNearbyPeerHandle?: never };
export type NearbyEndpointToken = string & { readonly __nearbyEndpointToken?: never };
export type NearbyResourceProfile = 'BALANCED' | 'BATTERY_SAVER' | 'HIGH_AVAILABILITY';
export type NearbyEvidenceLevel = 'CONTROLLED' | 'IMPLEMENTED' | 'RUNTIME_DETECTED' | 'PHYSICALLY_VERIFIED' | 'BLOCKED_BY_ENVIRONMENT' | 'UNAVAILABLE' | 'UNSUPPORTED';

export interface EphemeralTransportIdentity {
  readonly handle: AnonymousNearbyPeerHandle;
  readonly publicKey: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export interface NearbyAdvertisement {
  readonly protocolVersion: 1;
  readonly peerHandle: AnonymousNearbyPeerHandle;
  readonly expiresAt: string;
  readonly flags: number;
}

export interface NearbyLinkCapabilities {
  readonly availability: 'AVAILABLE' | 'PERMISSION_REQUIRED' | 'UNAVAILABLE' | 'UNSUPPORTED';
  readonly scanning: boolean;
  readonly advertising: boolean;
  readonly sessions: boolean;
  readonly maxAdvertisementBytes: number | 'UNKNOWN';
  readonly maxWriteBytes: number | 'UNKNOWN';
  readonly phys: readonly ('LE_1M' | 'LE_2M' | 'LE_CODED' | 'UNKNOWN')[];
  readonly evidence: NearbyEvidenceLevel;
  readonly limitation?: string;
}

export interface NearbyLinkObservation {
  readonly endpointToken: NearbyEndpointToken;
  readonly advertisement: Uint8Array;
  readonly observedAt: string;
  readonly signalQuality?: number | 'UNKNOWN';
  readonly phy?: 'LE_1M' | 'LE_2M' | 'LE_CODED' | 'UNKNOWN';
}

export interface NearbyDutyCycle {
  readonly profile: NearbyResourceProfile;
  readonly scanWindowMs: number;
  readonly scanIntervalMs: number;
  readonly advertisementIntervalMs: number;
  readonly maxResults: number;
}

export const NEARBY_RESOURCE_PROFILES: Readonly<Record<NearbyResourceProfile, NearbyDutyCycle>> = Object.freeze({
  BALANCED: Object.freeze({ profile: 'BALANCED', scanWindowMs: 5_000, scanIntervalMs: 30_000, advertisementIntervalMs: 5_000, maxResults: 64 }),
  BATTERY_SAVER: Object.freeze({ profile: 'BATTERY_SAVER', scanWindowMs: 2_000, scanIntervalMs: 90_000, advertisementIntervalMs: 15_000, maxResults: 32 }),
  HIGH_AVAILABILITY: Object.freeze({ profile: 'HIGH_AVAILABILITY', scanWindowMs: 10_000, scanIntervalMs: 20_000, advertisementIntervalMs: 2_500, maxResults: 96 }),
});

export interface NearbyLinkChannel {
  readonly id: string;
  readonly endpointToken: NearbyEndpointToken;
  readonly openedAt: string;
  readonly maxWriteBytes: number | 'UNKNOWN';
  send(bytes: Uint8Array): Promise<void>;
  onBytes(handler: (bytes: Uint8Array) => void | Promise<void>): () => void;
  onClose(handler: () => void): () => void;
  close(): Promise<void>;
}

/** Generic link boundary. Bluetooth LE is the first native implementation;
 * no application module depends on this interface. */
export interface NearbyLinkAdapter {
  readonly kind: 'CONTROLLED_NEARBY' | 'NATIVE_BLUETOOTH_LE';
  capabilities(): Promise<NearbyLinkCapabilities>;
  startAdvertising(advertisement: Uint8Array, duty: NearbyDutyCycle): Promise<void>;
  updateAdvertisement(advertisement: Uint8Array, duty: NearbyDutyCycle): Promise<void>;
  stopAdvertising(): Promise<void>;
  startScanning(duty: NearbyDutyCycle, onObservation: (observation: NearbyLinkObservation) => void | Promise<void>): Promise<void>;
  stopScanning(): Promise<void>;
  onIncomingChannel(handler: (channel: NearbyLinkChannel) => void | Promise<void>): () => void;
  openChannel(endpointToken: NearbyEndpointToken): Promise<NearbyLinkChannel>;
  stop(): Promise<void>;
}

const ADVERTISEMENT_MAGIC = new Uint8Array([0x4b, 0x4e]); // "KN"
export const NEARBY_ADVERTISEMENT_BYTES = 24;
const MAX_ADVERTISEMENT_LIFETIME_MS = 60 * 60_000;
const HANDSHAKE_WIRE_MAX_BYTES = 2_048;
const DATA_WIRE_OVERHEAD_BYTES = 768;

function bytesToBase64(value: Uint8Array): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(value).toString('base64url');
  let binary = ''; for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64ToBytes(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new ConnectivityError('POLICY_DENIED', 'Nearby base64 value is malformed');
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(value, 'base64url'));
  const raw = atob(value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '='));
  return Uint8Array.from(raw, character => character.charCodeAt(0));
}

function utf8(value: string): Uint8Array { return new TextEncoder().encode(value); }
function decodeUtf8(value: Uint8Array): string { return new TextDecoder().decode(value); }
function nowIso(now: () => number): string { return new Date(now()).toISOString(); }
function randomId(prefix: string): string { return `${prefix}:${crypto.randomUUID()}`; }
function asProviderId(value: string): TransportProviderId { return value as TransportProviderId; }
function asPeerHandle(value: string): AnonymousNearbyPeerHandle { return value as AnonymousNearbyPeerHandle; }
function asEndpointToken(value: string): NearbyEndpointToken { return value as NearbyEndpointToken; }

async function loadSodium(): Promise<any> {
  const { default: sodium } = await import('libsodium-wrappers');
  await sodium.ready;
  return sodium;
}

async function peerHandleForPublicKey(publicKey: Uint8Array): Promise<AnonymousNearbyPeerHandle> {
  const sodium = await loadSodium();
  return asPeerHandle(bytesToBase64(sodium.crypto_generichash(16, publicKey)));
}

interface EphemeralIdentityMaterial extends EphemeralTransportIdentity {
  readonly publicKeyBytes: Uint8Array;
  readonly privateKeyBytes: Uint8Array;
}

class EphemeralIdentityManager {
  private currentValue?: EphemeralIdentityMaterial;
  private readonly previous = new Map<AnonymousNearbyPeerHandle, { material: EphemeralIdentityMaterial; acceptedUntil: number }>();
  constructor(private readonly now: () => number, private readonly lifetimeMs: number, private readonly overlapMs: number) {
    if (!Number.isSafeInteger(lifetimeMs) || lifetimeMs < 10_000 || lifetimeMs > MAX_ADVERTISEMENT_LIFETIME_MS) throw new ConnectivityError('POLICY_DENIED', 'Nearby identity lifetime is invalid');
    if (!Number.isSafeInteger(overlapMs) || overlapMs < 0 || overlapMs >= lifetimeMs) throw new ConnectivityError('POLICY_DENIED', 'Nearby identity overlap is invalid');
  }
  async current(): Promise<EphemeralIdentityMaterial> {
    this.sweep();
    if (!this.currentValue || Date.parse(this.currentValue.expiresAt) <= this.now()) await this.rotate();
    return this.currentValue!;
  }
  async rotate(): Promise<EphemeralIdentityMaterial> {
    const sodium = await loadSodium(); const at = this.now();
    if (this.currentValue) this.previous.set(this.currentValue.handle, { material: this.currentValue, acceptedUntil: at + this.overlapMs });
    const pair = sodium.crypto_kx_keypair();
    const publicKeyBytes = new Uint8Array(pair.publicKey); const privateKeyBytes = new Uint8Array(pair.privateKey);
    const handle = await peerHandleForPublicKey(publicKeyBytes);
    this.currentValue = { handle, publicKey: bytesToBase64(publicKeyBytes), publicKeyBytes, privateKeyBytes, createdAt: new Date(at).toISOString(), expiresAt: new Date(at + this.lifetimeMs).toISOString() };
    this.sweep(); return this.currentValue;
  }
  resolve(handle: AnonymousNearbyPeerHandle): EphemeralIdentityMaterial | undefined {
    this.sweep(); if (this.currentValue?.handle === handle && Date.parse(this.currentValue.expiresAt) > this.now()) return this.currentValue;
    const prior = this.previous.get(handle); return prior && prior.acceptedUntil > this.now() ? prior.material : undefined;
  }
  view(value: EphemeralIdentityMaterial): EphemeralTransportIdentity { return { handle: value.handle, publicKey: value.publicKey, createdAt: value.createdAt, expiresAt: value.expiresAt }; }
  destroy(): void { if (this.currentValue) this.currentValue.privateKeyBytes.fill(0); for (const value of this.previous.values()) value.material.privateKeyBytes.fill(0); this.currentValue = undefined; this.previous.clear(); }
  private sweep(): void { const at = this.now(); for (const [handle, value] of this.previous) if (value.acceptedUntil <= at) { value.material.privateKeyBytes.fill(0); this.previous.delete(handle); } }
}

export function encodeNearbyAdvertisement(identity: Pick<EphemeralTransportIdentity, 'handle' | 'expiresAt'>, flags = 0, now: () => number = Date.now): Uint8Array {
  const handle = base64ToBytes(identity.handle); const expiresAt = Date.parse(identity.expiresAt);
  if (handle.byteLength !== 16 || !Number.isFinite(expiresAt) || expiresAt <= now() || expiresAt - now() > MAX_ADVERTISEMENT_LIFETIME_MS || !Number.isInteger(flags) || flags < 0 || flags > 0x07) throw new ConnectivityError('POLICY_DENIED', 'Nearby advertisement input is invalid');
  const output = new Uint8Array(NEARBY_ADVERTISEMENT_BYTES); output.set(ADVERTISEMENT_MAGIC, 0); output[2] = 1; output[3] = flags;
  new DataView(output.buffer).setUint32(4, Math.floor(expiresAt / 1_000), false); output.set(handle, 8); return output;
}

export function decodeNearbyAdvertisement(bytes: Uint8Array, now: () => number = Date.now): NearbyAdvertisement {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== NEARBY_ADVERTISEMENT_BYTES) throw new ConnectivityError('RESOURCE_LIMIT', 'Nearby advertisement size is invalid');
  if (bytes[0] !== ADVERTISEMENT_MAGIC[0] || bytes[1] !== ADVERTISEMENT_MAGIC[1]) throw new ConnectivityError('POLICY_DENIED', 'Nearby service marker is invalid');
  if (bytes[2] !== 1) throw new ConnectivityError('POLICY_DENIED', 'Nearby protocol version is unsupported');
  const flags = bytes[3]!; if ((flags & ~0x07) !== 0) throw new ConnectivityError('POLICY_DENIED', 'Nearby capability flags are invalid');
  const expiresAtMs = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, false) * 1_000;
  if (expiresAtMs <= now() || expiresAtMs - now() > MAX_ADVERTISEMENT_LIFETIME_MS) throw new ConnectivityError('TIMEOUT', 'Nearby advertisement is expired');
  return { protocolVersion: 1, peerHandle: asPeerHandle(bytesToBase64(bytes.subarray(8, 24))), expiresAt: new Date(expiresAtMs).toISOString(), flags };
}

interface HandshakeInit { readonly kind: 'nearby.handshake.init'; readonly version: 1; readonly sessionId: string; readonly handle: string; readonly publicKey: string; readonly expiresAt: string; }
interface HandshakeResponse { readonly kind: 'nearby.handshake.response'; readonly version: 1; readonly sessionId: string; readonly handle: string; readonly publicKey: string; readonly expiresAt: string; }
interface ProtectedData { readonly kind: 'nearby.data'; readonly version: 1; readonly sessionId: string; readonly sequence: number; readonly nonce: string; readonly ciphertext: string; }
type NearbyWire = HandshakeInit | HandshakeResponse | ProtectedData;

function parseWire(bytes: Uint8Array): NearbyWire {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 2 || bytes.byteLength > HANDSHAKE_WIRE_MAX_BYTES + 256 * 1024) throw new ConnectivityError('RESOURCE_LIMIT', 'Nearby wire frame exceeds bounds');
  let value: unknown; try { value = JSON.parse(decodeUtf8(bytes)); } catch { throw new ConnectivityError('SESSION_FAILED', 'Nearby wire frame is malformed'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ConnectivityError('SESSION_FAILED', 'Nearby wire frame is malformed');
  const item = value as Record<string, unknown>;
  if (item.version !== 1 || typeof item.kind !== 'string' || typeof item.sessionId !== 'string' || item.sessionId.length < 8 || item.sessionId.length > 160) throw new ConnectivityError('SESSION_FAILED', 'Nearby wire header is invalid');
  if (item.kind === 'nearby.handshake.init' || item.kind === 'nearby.handshake.response') {
    if (bytes.byteLength > HANDSHAKE_WIRE_MAX_BYTES || typeof item.handle !== 'string' || typeof item.publicKey !== 'string' || typeof item.expiresAt !== 'string') throw new ConnectivityError('SESSION_FAILED', 'Nearby handshake is invalid');
    return item as unknown as HandshakeInit | HandshakeResponse;
  }
  if (item.kind === 'nearby.data') {
    if (!Number.isSafeInteger(item.sequence) || (item.sequence as number) < 0 || typeof item.nonce !== 'string' || typeof item.ciphertext !== 'string') throw new ConnectivityError('SESSION_FAILED', 'Nearby protected frame is invalid');
    return item as unknown as ProtectedData;
  }
  throw new ConnectivityError('SESSION_FAILED', 'Unknown nearby wire frame');
}

interface ProtectedSessionState {
  readonly public: TransportSession;
  readonly channel: NearbyLinkChannel;
  readonly rxKey: Uint8Array;
  readonly txKey: Uint8Array;
  readonly expiresAt: number;
  readonly peerHandle: AnonymousNearbyPeerHandle;
  sentBytes: number;
  receivedBytes: number;
  nextSequence: number;
  highestReceivedSequence: number;
  pendingFrames: number;
}

interface DiscoveredPeer {
  readonly handle: AnonymousNearbyPeerHandle;
  endpointToken: NearbyEndpointToken;
  expiresAt: number;
  lastSeenAt: number;
  signalQuality?: number | 'UNKNOWN';
  phy?: 'LE_1M' | 'LE_2M' | 'LE_CODED' | 'UNKNOWN';
  failedHandshakes: number;
  backoffUntil: number;
}

export interface AnonymousNearbyTransportProviderOptions {
  readonly providerId?: string;
  readonly adapter: NearbyLinkAdapter;
  readonly now?: () => number;
  readonly resources?: ConnectivityResourceGovernor;
  readonly resourceProfile?: NearbyResourceProfile;
  readonly identityLifetimeMs?: number;
  readonly rotationOverlapMs?: number;
  readonly peerTtlMs?: number;
  readonly sessionLifetimeMs?: number;
  readonly handshakeTimeoutMs?: number;
  readonly maxPeers?: number;
  readonly maxSessions?: number;
  readonly maxActiveHandshakes?: number;
  readonly maxQueuedFramesPerSession?: number;
  readonly maxBytesPerSession?: number;
  readonly maxAdvertisementParsesPerMinute?: number;
  readonly mtu?: number;
}

export interface AnonymousNearbyDiagnostics {
  readonly providerId: TransportProviderId;
  readonly availability: TransportAvailability;
  readonly evidence: NearbyEvidenceLevel;
  readonly resourceProfile: NearbyResourceProfile;
  readonly discoveredPeerCount: number;
  readonly activeSessionCount: number;
  readonly activeHandshakeCount: number;
  readonly rejectedAdvertisements: number;
  readonly rejectedHandshakes: number;
  readonly rejectedFrames: number;
  readonly replayedFrames: number;
  readonly bytesSent: number;
  readonly bytesReceived: number;
}

export interface NearbyPhysicalVerificationReport {
  readonly providerId: TransportProviderId;
  readonly controllerPresent: boolean;
  readonly advertisingAvailable: boolean;
  readonly scanningAvailable: boolean;
  readonly sessionPrimitiveAvailable: boolean;
  readonly peerDiscovered: boolean;
  readonly encryptedSessionOpened: boolean;
  readonly opaqueEnvelopeExchanged: boolean;
  readonly disconnectCompleted: boolean;
  readonly reconnectAttempted: boolean;
  readonly evidence: 'PHYSICALLY_VERIFIED' | 'BLOCKED_BY_ENVIRONMENT' | 'SIMULATED' | 'UNSUPPORTED';
  readonly limitations: readonly string[];
}

const NEARBY_SECURITY: TransportSecurityBoundary = Object.freeze({ opaqueOnly: true, e2eRequired: true, canDecrypt: false, canAuthorize: false });
const NEARBY_CAPABILITIES: readonly TransportCapability[] = Object.freeze(['DIRECT', 'DISCOVERY', 'DATAGRAM', 'CONTROL', 'INTERACTIVE', 'BACKGROUND', 'LOW_BANDWIDTH', 'SMALL_MTU', 'LOCAL_ONLY']);

/** One-hop provider only. It intentionally has no forwarding or route
 * propagation API. */
export class AnonymousNearbyTransportProvider implements TransportProvider {
  readonly id: TransportProviderId;
  readonly type = 'BluetoothTransport' as const;
  readonly security = NEARBY_SECURITY;
  readonly mtu: number;
  private availability: TransportAvailability = 'UNKNOWN';
  private checkedAt: string;
  private evidence: NearbyEvidenceLevel = 'UNAVAILABLE';
  private healthReason?: string;
  private profile: NearbyResourceProfile;
  private readonly now: () => number;
  private readonly resources: ConnectivityResourceGovernor;
  private readonly identities: EphemeralIdentityManager;
  private readonly peers = new Map<AnonymousNearbyPeerHandle, DiscoveredPeer>();
  private readonly rendezvous = new Map<string, AnonymousNearbyPeerHandle>();
  private readonly routes = new Map<string, { peerHandle: AnonymousNearbyPeerHandle; expiresAt: number }>();
  private readonly sessions = new Map<string, ProtectedSessionState>();
  private readonly channelSessions = new Map<string, string>();
  private readonly seenHandshakeIds = new Map<string, number>();
  private readonly listeners = new Set<(frame: OpaqueFrame, session?: TransportSession) => void | Promise<void>>();
  private unsubscribeIncoming?: () => void;
  private rotationTimer?: ReturnType<typeof setTimeout>;
  private activeHandshakes = 0;
  private parseWindowStartedAt = 0;
  private parseWindowCount = 0;
  private running = false;
  private rejectedAdvertisements = 0;
  private rejectedHandshakes = 0;
  private rejectedFrames = 0;
  private replayedFrames = 0;
  private bytesSent = 0;
  private bytesReceived = 0;
  private readonly limits: Required<Pick<AnonymousNearbyTransportProviderOptions, 'peerTtlMs' | 'sessionLifetimeMs' | 'handshakeTimeoutMs' | 'maxPeers' | 'maxSessions' | 'maxActiveHandshakes' | 'maxQueuedFramesPerSession' | 'maxBytesPerSession' | 'maxAdvertisementParsesPerMinute'>>;

  constructor(private readonly options: AnonymousNearbyTransportProviderOptions) {
    this.id = asProviderId(options.providerId ?? 'anonymous-nearby'); this.now = options.now ?? Date.now; this.checkedAt = nowIso(this.now);
    this.resources = options.resources ?? new ConnectivityResourceGovernor(); this.profile = options.resourceProfile ?? 'BALANCED'; this.mtu = Math.max(1_024, Math.min(64 * 1024, options.mtu ?? 4 * 1024));
    this.identities = new EphemeralIdentityManager(this.now, options.identityLifetimeMs ?? 5 * 60_000, options.rotationOverlapMs ?? 30_000);
    this.limits = {
      peerTtlMs: bounded(options.peerTtlMs, 5_000, 30 * 60_000, 2 * 60_000),
      sessionLifetimeMs: bounded(options.sessionLifetimeMs, 10_000, 60 * 60_000, 5 * 60_000),
      handshakeTimeoutMs: bounded(options.handshakeTimeoutMs, 100, 30_000, 5_000),
      maxPeers: bounded(options.maxPeers, 1, 4_096, 128),
      maxSessions: bounded(options.maxSessions, 1, 256, 16),
      maxActiveHandshakes: bounded(options.maxActiveHandshakes, 1, 64, 8),
      maxQueuedFramesPerSession: bounded(options.maxQueuedFramesPerSession, 1, 1_024, 64),
      maxBytesPerSession: bounded(options.maxBytesPerSession, 4 * 1024, 256 * 1024 * 1024, 8 * 1024 * 1024),
      maxAdvertisementParsesPerMinute: bounded(options.maxAdvertisementParsesPerMinute, 8, 100_000, 512),
    };
  }

  capabilities(): readonly TransportCapability[] { return NEARBY_CAPABILITIES; }
  routeMetadata(): { readonly family: 'nearby'; readonly pathKind: 'LIVE' } { return { family: 'nearby', pathKind: 'LIVE' }; }
  async probe(): Promise<TransportAvailability> {
    const capability = await this.options.adapter.capabilities(); this.evidence = capability.evidence; this.checkedAt = nowIso(this.now);
    if (capability.availability === 'UNSUPPORTED') this.availability = 'UNSUPPORTED';
    else if (capability.availability !== 'AVAILABLE' || !capability.scanning || !capability.advertising || !capability.sessions) this.availability = 'UNAVAILABLE';
    else this.availability = 'AVAILABLE';
    this.healthReason = capability.limitation; return this.availability;
  }
  health(): TransportHealth { return { state: this.availability === 'AVAILABLE' ? 'HEALTHY' : this.availability === 'DEGRADED' ? 'DEGRADED' : this.availability === 'UNKNOWN' ? 'UNKNOWN' : 'FAILED', availability: this.availability, checkedAt: this.checkedAt, ...(this.healthReason ? { reason: this.healthReason } : {}) }; }

  async start(): Promise<void> {
    if (this.running) return; await this.probe(); if (this.availability !== 'AVAILABLE') return;
    if (!this.resources.allowsBackgroundDiscovery()) { this.availability = 'DEGRADED'; this.healthReason = 'Nearby activity suppressed by critical host resource pressure'; return; }
    const identity = await this.identities.current(); const duty = NEARBY_RESOURCE_PROFILES[this.effectiveProfile()];
    this.unsubscribeIncoming = this.options.adapter.onIncomingChannel(channel => { this.acceptIncomingChannel(channel); });
    await this.options.adapter.startAdvertising(encodeNearbyAdvertisement(identity, 0, this.now), duty);
    await this.options.adapter.startScanning(duty, observation => this.observe(observation));
    this.running = true; this.scheduleRotation(identity);
  }

  async stop(): Promise<void> {
    if (this.rotationTimer) clearTimeout(this.rotationTimer); this.rotationTimer = undefined; this.unsubscribeIncoming?.(); this.unsubscribeIncoming = undefined;
    for (const session of [...this.sessions.values()]) await this.close(session.public).catch(() => undefined);
    await this.options.adapter.stop(); this.peers.clear(); this.routes.clear(); this.rendezvous.clear(); this.seenHandshakeIds.clear(); this.identities.destroy(); this.running = false;
    if (this.availability === 'AVAILABLE' || this.availability === 'DEGRADED') this.availability = 'UNKNOWN';
  }

  async setResourceProfile(profile: NearbyResourceProfile): Promise<void> {
    this.profile = profile;
    if (!this.running) return;
    const identity = await this.identities.current();
    const duty = NEARBY_RESOURCE_PROFILES[this.effectiveProfile()];
    await this.options.adapter.stopScanning();
    await this.options.adapter.updateAdvertisement(encodeNearbyAdvertisement(identity, 0, this.now), duty);
    await this.options.adapter.startScanning(duty, observation => this.observe(observation));
  }
  /** Re-evaluate host battery/thermal signals without exposing an ordinary
   * product-level disable switch. Critical pressure suspends discovery while
   * leaving existing protected sessions intact; recovery resumes discovery. */
  async refreshResourcePolicy(): Promise<void> {
    const allowed = this.resources.allowsBackgroundDiscovery();
    if (!allowed && this.running) {
      if (this.rotationTimer) clearTimeout(this.rotationTimer);
      this.rotationTimer = undefined;
      this.unsubscribeIncoming?.();
      this.unsubscribeIncoming = undefined;
      await this.options.adapter.stopScanning();
      await this.options.adapter.stopAdvertising();
      this.running = false;
      this.availability = 'DEGRADED';
      this.healthReason = 'Nearby activity suppressed by critical host resource pressure';
      return;
    }
    if (allowed && !this.running) await this.start();
    else if (allowed) await this.setResourceProfile(this.profile);
  }
  resourceProfile(): NearbyResourceProfile { return this.profile; }
  async currentIdentity(): Promise<EphemeralTransportIdentity> { const value = await this.identities.current(); return this.identities.view(value); }
  async rotateIdentity(): Promise<EphemeralTransportIdentity> {
    const value = await this.identities.rotate(); if (this.running) await this.options.adapter.updateAdvertisement(encodeNearbyAdvertisement(value, 0, this.now), NEARBY_RESOURCE_PROFILES[this.effectiveProfile()]); this.scheduleRotation(value); return this.identities.view(value);
  }

  /** Provider-local, non-enumerable translation. The radio sees only the
   * anonymous handle; no reverse Profile/Identity resolver is exposed. */
  bindOpaqueRendezvous(destination: string, peerHandle: AnonymousNearbyPeerHandle): void {
    if (!destination || !peerHandle) throw new ConnectivityError('POLICY_DENIED', 'Nearby rendezvous binding is invalid'); this.rendezvous.set(destination, peerHandle);
  }
  unbindOpaqueRendezvous(destination: string): void { this.rendezvous.delete(destination); }

  async discoverDirectReachability(destination: string): Promise<readonly TransportEndpoint[]> {
    this.sweep(); const handle = this.rendezvous.get(destination); if (!handle) return []; const peer = this.peers.get(handle); if (!peer || peer.expiresAt <= this.now() || peer.backoffUntil > this.now()) return [];
    const routeReference = randomId('nearby-route'); this.routes.set(routeReference, { peerHandle: handle, expiresAt: Math.min(peer.expiresAt, this.now() + 30_000) });
    return [{ handle: randomId('nearby-endpoint'), providerId: this.id, providerType: this.type, routeReference, expiresAt: new Date(Math.min(peer.expiresAt, this.now() + 30_000)).toISOString(), anonymous: true }];
  }

  isPeerConnected(destination: string): boolean { const handle = this.rendezvous.get(destination); if (!handle) return false; return [...this.sessions.values()].some(session => session.peerHandle === handle && session.expiresAt > this.now()); }

  async openSession(endpoint: TransportEndpoint): Promise<TransportSession> {
    this.sweep(); if (this.sessions.size >= this.limits.maxSessions || this.activeHandshakes >= this.limits.maxActiveHandshakes) throw new ConnectivityError('RESOURCE_LIMIT', 'Nearby session/handshake bound exceeded');
    const route = this.routes.get(endpoint.routeReference); if (!route || route.expiresAt <= this.now()) throw new ConnectivityError('TRANSPORT_UNAVAILABLE', 'Nearby route is stale');
    const peer = this.peers.get(route.peerHandle); if (!peer || peer.expiresAt <= this.now() || peer.backoffUntil > this.now()) throw new ConnectivityError('TRANSPORT_UNAVAILABLE', 'Nearby peer is unavailable');
    this.activeHandshakes += 1; let channel: NearbyLinkChannel | undefined;
    try {
      channel = await this.options.adapter.openChannel(peer.endpointToken); const local = await this.identities.current(); const sessionId = randomId('nearby-session');
      const state = await this.initiateHandshake(channel, endpoint, local, peer.handle, sessionId); peer.failedHandshakes = 0; peer.backoffUntil = 0; return state.public;
    } catch (error) {
      peer.failedHandshakes += 1; peer.backoffUntil = this.now() + Math.min(60_000, 250 * (2 ** Math.min(8, peer.failedHandshakes))); this.rejectedHandshakes += 1; await channel?.close().catch(() => undefined); throw error;
    } finally { this.activeHandshakes -= 1; }
  }

  async sendOpaqueFrame(session: TransportSession, frame: OpaqueFrame): Promise<void> {
    const state = this.sessions.get(session.id); if (!state || state.expiresAt <= this.now()) throw new ConnectivityError('SESSION_FAILED', 'Nearby session is closed or expired');
    if (state.pendingFrames >= this.limits.maxQueuedFramesPerSession) throw new ConnectivityError('RESOURCE_LIMIT', 'Nearby frame queue is full');
    const plaintext = encodeOpaqueFrame(frame); if (plaintext.byteLength > this.mtu) throw new ConnectivityError('MTU_EXCEEDED', 'Nearby opaque frame requires Fabric fragmentation');
    if (state.sentBytes + plaintext.byteLength > this.limits.maxBytesPerSession) throw new ConnectivityError('RESOURCE_LIMIT', 'Nearby session byte bound exceeded');
    state.pendingFrames += 1;
    try { const wire = await this.encrypt(state, plaintext); await state.channel.send(utf8(JSON.stringify(wire))); state.sentBytes += plaintext.byteLength; this.bytesSent += plaintext.byteLength; }
    finally { state.pendingFrames -= 1; }
  }

  receiveOpaqueFrame(handler: (frame: OpaqueFrame, session?: TransportSession) => void | Promise<void>): () => void { this.listeners.add(handler); return () => this.listeners.delete(handler); }
  async measureLink(session?: TransportSession): Promise<TransportMetrics> { const state = session ? this.sessions.get(session.id) : undefined; const peer = state ? this.peers.get(state.peerHandle) : undefined; return { mtu: this.mtu, signalQuality: peer?.signalQuality ?? 'UNKNOWN', cost: 'FREE', energy: this.effectiveProfile() === 'HIGH_AVAILABILITY' ? 'MEDIUM' : 'LOW', metered: false, phy: peer?.phy ?? 'UNKNOWN', queuePressure: state ? state.pendingFrames / this.limits.maxQueuedFramesPerSession : 0, observedAt: nowIso(this.now) }; }

  async close(session: TransportSession): Promise<void> { const state = this.sessions.get(session.id); if (!state) return; this.cleanupSession(state); await state.channel.close(); }

  diagnostics(): AnonymousNearbyDiagnostics { this.sweep(); return { providerId: this.id, availability: this.availability, evidence: this.evidence, resourceProfile: this.effectiveProfile(), discoveredPeerCount: this.peers.size, activeSessionCount: this.sessions.size, activeHandshakeCount: this.activeHandshakes, rejectedAdvertisements: this.rejectedAdvertisements, rejectedHandshakes: this.rejectedHandshakes, rejectedFrames: this.rejectedFrames, replayedFrames: this.replayedFrames, bytesSent: this.bytesSent, bytesReceived: this.bytesReceived }; }

  /** Developer-only bounded handles; ordinary UI consumes diagnostics(). */
  developerAnonymousPeers(limit = 32): readonly { readonly handle: AnonymousNearbyPeerHandle; readonly expiresAt: string; readonly signalQuality: number | 'UNKNOWN'; readonly phy: string }[] { this.sweep(); return [...this.peers.values()].slice(0, Math.max(0, Math.min(128, limit))).map(peer => ({ handle: peer.handle, expiresAt: new Date(peer.expiresAt).toISOString(), signalQuality: peer.signalQuality ?? 'UNKNOWN', phy: peer.phy ?? 'UNKNOWN' })); }

  /**
   * Low-level anonymous-neighbor session boundary used by R0P69.  It is
   * deliberately expressed in ephemeral peer handles rather than Keystone
   * Identity IDs.  The method only creates a normal R0P68 protected session;
   * the multi-hop router decides which opaque control/data frames to carry.
   */
  anonymousNeighborHandles(limit = 128): readonly { readonly handle: AnonymousNearbyPeerHandle; readonly expiresAt: string }[] {
    this.sweep();
    return [...this.peers.values()].slice(0, Math.max(0, Math.min(128, limit))).map(peer => ({ handle: peer.handle, expiresAt: new Date(peer.expiresAt).toISOString() }));
  }

  async openAnonymousNeighbor(handle: AnonymousNearbyPeerHandle): Promise<TransportSession> {
    this.sweep();
    const peer = this.peers.get(handle);
    if (!peer || peer.expiresAt <= this.now() || peer.backoffUntil > this.now()) throw new ConnectivityError('TRANSPORT_UNAVAILABLE', 'Anonymous nearby neighbor is unavailable');
    const routeReference = randomId('nearby-anonymous-route');
    this.routes.set(routeReference, { peerHandle: handle, expiresAt: Math.min(peer.expiresAt, this.now() + 30_000) });
    // The route reference is only needed to open the one-hop session.  Once
    // the protected session exists, its lifetime is governed by the session
    // bound rather than by the short discovery refresh window; otherwise an
    // active exchange would be closed while the provider still has a valid
    // encrypted channel for chunk retries/resume.
    const endpoint: TransportEndpoint = { handle: randomId('nearby-anonymous-endpoint'), providerId: this.id, providerType: this.type, routeReference, expiresAt: new Date(this.now() + this.limits.sessionLifetimeMs).toISOString(), anonymous: true };
    return this.openSession(endpoint);
  }

  anonymousNeighborPeerHandle(session: TransportSession): AnonymousNearbyPeerHandle | undefined { return this.sessions.get(session.id)?.peerHandle; }

  /** Alias with a source-oriented name for generic R0P69 adapters. */
  anonymousNeighborSessions(): readonly { readonly handle: AnonymousNearbyPeerHandle; readonly expiresAt: string }[] { return this.anonymousNeighborHandles(); }

  private effectiveProfile(): NearbyResourceProfile { const signals = this.resources.snapshot(); return signals.battery === 'CRITICAL' || signals.battery === 'LOW' || signals.thermal === 'SERIOUS' || signals.thermal === 'CRITICAL' ? 'BATTERY_SAVER' : this.profile; }
  private async observe(observation: NearbyLinkObservation): Promise<void> {
    const at = this.now(); if (at - this.parseWindowStartedAt >= 60_000) { this.parseWindowStartedAt = at; this.parseWindowCount = 0; }
    if (++this.parseWindowCount > this.limits.maxAdvertisementParsesPerMinute) { this.rejectedAdvertisements += 1; return; }
    let advertisement: NearbyAdvertisement; try { advertisement = decodeNearbyAdvertisement(observation.advertisement, this.now); } catch { this.rejectedAdvertisements += 1; return; }
    const local = await this.identities.current(); if (advertisement.peerHandle === local.handle) return;
    const existing = this.peers.get(advertisement.peerHandle); if (!existing && this.peers.size >= this.limits.maxPeers) { this.rejectedAdvertisements += 1; return; }
    this.peers.set(advertisement.peerHandle, { handle: advertisement.peerHandle, endpointToken: observation.endpointToken, expiresAt: Math.min(Date.parse(advertisement.expiresAt), at + this.limits.peerTtlMs), lastSeenAt: at, signalQuality: observation.signalQuality, phy: observation.phy, failedHandshakes: existing?.failedHandshakes ?? 0, backoffUntil: existing?.backoffUntil ?? 0 });
  }

  private acceptIncomingChannel(channel: NearbyLinkChannel): void {
    if (this.sessions.size >= this.limits.maxSessions) { void channel.close(); return; }
    channel.onBytes(bytes => this.receiveChannelBytes(channel, bytes)); channel.onClose(() => this.cleanupChannel(channel.id));
  }

  private async initiateHandshake(channel: NearbyLinkChannel, endpoint: TransportEndpoint, local: EphemeralIdentityMaterial, expectedPeer: AnonymousNearbyPeerHandle, sessionId: string): Promise<ProtectedSessionState> {
    let settled = false; let timeout: ReturnType<typeof setTimeout> | undefined;
    return new Promise<ProtectedSessionState>((resolve, reject) => {
      const fail = (error: unknown) => { if (settled) return; settled = true; if (timeout) clearTimeout(timeout); reject(error); };
      const unsubscribeBytes = channel.onBytes(async bytes => {
        if (settled) return;
        try {
          const wire = parseWire(bytes); if (wire.kind !== 'nearby.handshake.response' || wire.sessionId !== sessionId) throw new ConnectivityError('SESSION_FAILED', 'Nearby handshake response is invalid');
          const remotePublicKey = base64ToBytes(wire.publicKey); if (remotePublicKey.byteLength !== 32 || await peerHandleForPublicKey(remotePublicKey) !== expectedPeer || wire.handle !== expectedPeer || Date.parse(wire.expiresAt) <= this.now()) throw new ConnectivityError('SESSION_FAILED', 'Nearby responder identity is invalid or expired');
          const sodium = await loadSodium(); const keys = sodium.crypto_kx_client_session_keys(local.publicKeyBytes, local.privateKeyBytes, remotePublicKey);
          const publicSession: TransportSession = { id: sessionId, endpoint, providerId: this.id, openedAt: nowIso(this.now), state: 'OPEN' };
          const state: ProtectedSessionState = { public: publicSession, channel, rxKey: new Uint8Array(keys.sharedRx), txKey: new Uint8Array(keys.sharedTx), expiresAt: this.now() + this.limits.sessionLifetimeMs, peerHandle: expectedPeer, sentBytes: 0, receivedBytes: 0, nextSequence: 0, highestReceivedSequence: -1, pendingFrames: 0 };
          settled = true; if (timeout) clearTimeout(timeout); unsubscribeBytes(); this.installSession(state, true); resolve(state);
        } catch (error) { fail(error); }
      });
      channel.onClose(() => fail(new ConnectivityError('SESSION_FAILED', 'Nearby channel closed during handshake')));
      timeout = setTimeout(() => fail(new ConnectivityError('TIMEOUT', 'Nearby handshake timed out')), this.limits.handshakeTimeoutMs); (timeout as { unref?: () => void }).unref?.();
      const init: HandshakeInit = { kind: 'nearby.handshake.init', version: 1, sessionId, handle: local.handle, publicKey: local.publicKey, expiresAt: local.expiresAt };
      void channel.send(utf8(JSON.stringify(init))).catch(fail);
    });
  }

  private async receiveChannelBytes(channel: NearbyLinkChannel, bytes: Uint8Array): Promise<void> {
    try {
      const wire = parseWire(bytes); const sessionId = this.channelSessions.get(channel.id); const state = sessionId ? this.sessions.get(sessionId) : undefined;
      if (state) { if (wire.kind !== 'nearby.data' || wire.sessionId !== state.public.id) throw new ConnectivityError('SESSION_FAILED', 'Unexpected nearby session frame'); await this.receiveProtected(state, wire); return; }
      if (wire.kind !== 'nearby.handshake.init') throw new ConnectivityError('SESSION_FAILED', 'Nearby channel has no valid handshake');
      if (this.activeHandshakes >= this.limits.maxActiveHandshakes || this.sessions.size >= this.limits.maxSessions) throw new ConnectivityError('RESOURCE_LIMIT', 'Nearby handshake/session bound exceeded');
      this.activeHandshakes += 1;
      try { await this.respondToHandshake(channel, wire); }
      finally { this.activeHandshakes -= 1; }
    } catch { this.rejectedHandshakes += this.channelSessions.has(channel.id) ? 0 : 1; this.rejectedFrames += this.channelSessions.has(channel.id) ? 1 : 0; await channel.close().catch(() => undefined); }
  }

  private async respondToHandshake(channel: NearbyLinkChannel, init: HandshakeInit): Promise<void> {
    if (Date.parse(init.expiresAt) <= this.now() || Date.parse(init.expiresAt) - this.now() > MAX_ADVERTISEMENT_LIFETIME_MS) throw new ConnectivityError('TIMEOUT', 'Nearby initiator identity expired');
    const remotePublicKey = base64ToBytes(init.publicKey); if (remotePublicKey.byteLength !== 32 || await peerHandleForPublicKey(remotePublicKey) !== init.handle) throw new ConnectivityError('SESSION_FAILED', 'Nearby initiator key/handle mismatch');
    const remoteHandle = asPeerHandle(init.handle); const peer = this.peers.get(remoteHandle); if (!peer || peer.expiresAt <= this.now() || peer.backoffUntil > this.now()) throw new ConnectivityError('TRANSPORT_UNAVAILABLE', 'Undiscovered nearby initiator rejected');
    this.sweepHandshakeIds();
    if (this.seenHandshakeIds.has(init.sessionId)) throw new ConnectivityError('POLICY_DENIED', 'Nearby handshake replay rejected');
    if (this.seenHandshakeIds.size >= Math.max(64, this.limits.maxSessions * 64)) throw new ConnectivityError('RESOURCE_LIMIT', 'Nearby handshake replay cache is full');
    this.seenHandshakeIds.set(init.sessionId, this.now() + this.limits.sessionLifetimeMs);
    const local = await this.identities.current(); const sodium = await loadSodium(); const keys = sodium.crypto_kx_server_session_keys(local.publicKeyBytes, local.privateKeyBytes, remotePublicKey);
    const endpoint: TransportEndpoint = { handle: randomId('nearby-incoming'), providerId: this.id, providerType: this.type, routeReference: randomId('nearby-incoming-route'), expiresAt: new Date(this.now() + this.limits.sessionLifetimeMs).toISOString(), anonymous: true };
    const publicSession: TransportSession = { id: init.sessionId, endpoint, providerId: this.id, openedAt: nowIso(this.now), state: 'OPEN' };
    const state: ProtectedSessionState = { public: publicSession, channel, rxKey: new Uint8Array(keys.sharedRx), txKey: new Uint8Array(keys.sharedTx), expiresAt: this.now() + this.limits.sessionLifetimeMs, peerHandle: remoteHandle, sentBytes: 0, receivedBytes: 0, nextSequence: 0, highestReceivedSequence: -1, pendingFrames: 0 };
    this.installSession(state, false); const response: HandshakeResponse = { kind: 'nearby.handshake.response', version: 1, sessionId: init.sessionId, handle: local.handle, publicKey: local.publicKey, expiresAt: local.expiresAt }; await channel.send(utf8(JSON.stringify(response)));
  }

  private installSession(state: ProtectedSessionState, installByteListener: boolean): void {
    if (this.sessions.has(state.public.id) || this.channelSessions.has(state.channel.id)) throw new ConnectivityError('POLICY_DENIED', 'Duplicate nearby session rejected');
    this.sessions.set(state.public.id, state); this.channelSessions.set(state.channel.id, state.public.id);
    if (installByteListener) state.channel.onBytes(bytes => this.receiveChannelBytes(state.channel, bytes)); state.channel.onClose(() => this.cleanupSession(state));
  }

  private async encrypt(state: ProtectedSessionState, plaintext: Uint8Array): Promise<ProtectedData> {
    const sodium = await loadSodium(); const sequence = state.nextSequence++; const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES); const additional = utf8(`keystone-nearby-v1:${state.public.id}:${sequence}`);
    const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(plaintext, additional, null, nonce, state.txKey);
    return { kind: 'nearby.data', version: 1, sessionId: state.public.id, sequence, nonce: bytesToBase64(nonce), ciphertext: bytesToBase64(ciphertext) };
  }

  private async receiveProtected(state: ProtectedSessionState, wire: ProtectedData): Promise<void> {
    if (state.expiresAt <= this.now()) throw new ConnectivityError('TIMEOUT', 'Nearby protected session expired');
    if (wire.sequence <= state.highestReceivedSequence) { this.replayedFrames += 1; throw new ConnectivityError('POLICY_DENIED', 'Nearby replay rejected'); }
    const nonce = base64ToBytes(wire.nonce); const ciphertext = base64ToBytes(wire.ciphertext); if (nonce.byteLength !== 24 || ciphertext.byteLength > this.mtu + DATA_WIRE_OVERHEAD_BYTES) throw new ConnectivityError('RESOURCE_LIMIT', 'Nearby protected frame exceeds bounds');
    const sodium = await loadSodium(); const additional = utf8(`keystone-nearby-v1:${state.public.id}:${wire.sequence}`); let plaintext: Uint8Array;
    try { plaintext = new Uint8Array(sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, ciphertext, additional, nonce, state.rxKey)); }
    catch { throw new ConnectivityError('POLICY_DENIED', 'Nearby protected frame authentication failed'); }
    if (state.receivedBytes + plaintext.byteLength > this.limits.maxBytesPerSession) throw new ConnectivityError('RESOURCE_LIMIT', 'Nearby receive byte bound exceeded');
    const frame = decodeOpaqueFrame(plaintext); state.highestReceivedSequence = wire.sequence; state.receivedBytes += plaintext.byteLength; this.bytesReceived += plaintext.byteLength; for (const listener of this.listeners) await listener(frame, state.public);
  }

  private cleanupSession(state: ProtectedSessionState): void { if (this.sessions.get(state.public.id) !== state) return; this.sessions.delete(state.public.id); this.channelSessions.delete(state.channel.id); state.rxKey.fill(0); state.txKey.fill(0); }
  private cleanupChannel(channelId: string): void { const id = this.channelSessions.get(channelId); if (!id) return; const state = this.sessions.get(id); if (state) this.cleanupSession(state); }
  private sweep(): void { const at = this.now(); this.sweepHandshakeIds(); for (const [handle, peer] of this.peers) if (peer.expiresAt <= at || at - peer.lastSeenAt > this.limits.peerTtlMs) this.peers.delete(handle); for (const [route, value] of this.routes) if (value.expiresAt <= at || !this.peers.has(value.peerHandle)) this.routes.delete(route); for (const state of [...this.sessions.values()]) if (state.expiresAt <= at) { this.cleanupSession(state); void state.channel.close(); } }
  private sweepHandshakeIds(): void { const at = this.now(); for (const [id, expiresAt] of this.seenHandshakeIds) if (expiresAt <= at) this.seenHandshakeIds.delete(id); }
  private scheduleRotation(identity: EphemeralIdentityMaterial): void { if (this.rotationTimer) clearTimeout(this.rotationTimer); const overlap = this.options.rotationOverlapMs ?? 30_000; const delay = Math.max(1_000, Date.parse(identity.expiresAt) - this.now() - overlap); this.rotationTimer = setTimeout(() => { void this.rotateIdentity().catch(() => { this.availability = 'DEGRADED'; this.healthReason = 'Nearby identity rotation failed'; }); }, delay); (this.rotationTimer as { unref?: () => void }).unref?.(); }
}

/** Explicit physical-evidence harness. A controlled adapter can exercise the
 * protocol but can never return PHYSICALLY_VERIFIED. */
export class NearbyPhysicalVerificationHarness {
  constructor(private readonly provider: AnonymousNearbyTransportProvider, private readonly adapter: NearbyLinkAdapter) {}
  async run(options: { readonly destination?: string; readonly peerHandle?: AnonymousNearbyPeerHandle; readonly frame?: OpaqueFrame; readonly reconnect?: boolean } = {}): Promise<NearbyPhysicalVerificationReport> {
    const capabilities = await this.adapter.capabilities(); const controllerPresent = capabilities.availability === 'AVAILABLE'; const limitations: string[] = [];
    if (capabilities.limitation) limitations.push(capabilities.limitation);
    await this.provider.start(); const peerDiscovered = this.provider.diagnostics().discoveredPeerCount > 0; let encryptedSessionOpened = false; let opaqueEnvelopeExchanged = false; let disconnectCompleted = false; let reconnectAttempted = false;
    if (options.destination && options.peerHandle && options.frame && peerDiscovered) {
      try {
        this.provider.bindOpaqueRendezvous(options.destination, options.peerHandle); const endpoint = (await this.provider.discoverDirectReachability(options.destination))[0];
        if (endpoint) { const session = await this.provider.openSession(endpoint); encryptedSessionOpened = true; await this.provider.sendOpaqueFrame(session, options.frame); opaqueEnvelopeExchanged = true; await this.provider.close(session); disconnectCompleted = true;
          if (options.reconnect) { reconnectAttempted = true; const next = (await this.provider.discoverDirectReachability(options.destination))[0]; if (next) { const reopened = await this.provider.openSession(next); await this.provider.close(reopened); } }
        }
      } catch (error) { limitations.push(error instanceof Error ? error.message : 'Nearby physical exchange failed'); }
    } else limitations.push('No second physical Keystone peer was available to complete a protected exchange');
    const physical = capabilities.evidence === 'PHYSICALLY_VERIFIED' && peerDiscovered && encryptedSessionOpened && opaqueEnvelopeExchanged;
    const evidence = capabilities.evidence === 'CONTROLLED' ? 'SIMULATED' : capabilities.availability === 'UNSUPPORTED' ? 'UNSUPPORTED' : physical ? 'PHYSICALLY_VERIFIED' : 'BLOCKED_BY_ENVIRONMENT';
    return { providerId: this.provider.id, controllerPresent, advertisingAvailable: capabilities.advertising, scanningAvailable: capabilities.scanning, sessionPrimitiveAvailable: capabilities.sessions, peerDiscovered, encryptedSessionOpened, opaqueEnvelopeExchanged, disconnectCompleted, reconnectAttempted, evidence, limitations };
  }
}

function bounded(value: number | undefined, minimum: number, maximum: number, fallback: number): number { const resolved = value ?? fallback; if (!Number.isSafeInteger(resolved) || resolved < minimum || resolved > maximum) throw new ConnectivityError('POLICY_DENIED', 'Nearby resource limit is invalid'); return resolved; }

// ---------------------------------------------------------------------------
// Deterministic controlled link (CI only)
// ---------------------------------------------------------------------------

class ControlledNearbyChannel implements NearbyLinkChannel {
  readonly openedAt = new Date().toISOString(); readonly maxWriteBytes = 256 * 1024;
  private readonly byteListeners = new Set<(bytes: Uint8Array) => void | Promise<void>>(); private readonly closeListeners = new Set<() => void>(); private peer?: ControlledNearbyChannel; private closed = false;
  constructor(readonly id: string, readonly endpointToken: NearbyEndpointToken, private readonly record: (bytes: Uint8Array) => readonly Uint8Array[]) {}
  pair(peer: ControlledNearbyChannel): void { this.peer = peer; }
  async send(bytes: Uint8Array): Promise<void> { if (this.closed || !this.peer || this.peer.closed) throw new ConnectivityError('SESSION_FAILED', 'Controlled nearby channel is closed'); if (bytes.byteLength > this.maxWriteBytes) throw new ConnectivityError('RESOURCE_LIMIT', 'Controlled nearby write exceeds bound'); for (const delivered of this.record(bytes)) await this.peer.receive(delivered); }
  onBytes(handler: (bytes: Uint8Array) => void | Promise<void>): () => void { this.byteListeners.add(handler); return () => this.byteListeners.delete(handler); }
  onClose(handler: () => void): () => void { this.closeListeners.add(handler); return () => this.closeListeners.delete(handler); }
  async close(): Promise<void> { if (this.closed) return; this.closed = true; for (const listener of this.closeListeners) listener(); const peer = this.peer; if (peer && !peer.closed) { peer.closed = true; for (const listener of peer.closeListeners) listener(); } }
  private async receive(bytes: Uint8Array): Promise<void> { for (const listener of [...this.byteListeners]) await listener(new Uint8Array(bytes)); }
}

export class ControlledNearbyNetwork {
  private readonly adapters = new Map<string, ControlledNearbyLinkAdapter>();
  private readonly advertisements = new Map<string, Uint8Array>();
  private readonly transcriptValues: { from: string; to: string; bytes: Uint8Array }[] = [];
  private fault: 'NONE' | 'CORRUPT_NEXT' | 'DUPLICATE_NEXT' | 'DROP_NEXT' = 'NONE';
  createAdapter(id = randomId('controlled-nearby')): ControlledNearbyLinkAdapter { if (this.adapters.has(id)) throw new ConnectivityError('POLICY_DENIED', 'Controlled nearby adapter id already exists'); const adapter = new ControlledNearbyLinkAdapter(this, id); this.adapters.set(id, adapter); return adapter; }
  transcript(): readonly { readonly from: string; readonly to: string; readonly bytes: Uint8Array }[] { return this.transcriptValues.map(value => ({ ...value, bytes: new Uint8Array(value.bytes) })); }
  corruptNextWrite(): void { this.fault = 'CORRUPT_NEXT'; }
  duplicateNextWrite(): void { this.fault = 'DUPLICATE_NEXT'; }
  dropNextWrite(): void { this.fault = 'DROP_NEXT'; }
  advertise(id: string, bytes: Uint8Array): void { this.advertisements.set(id, new Uint8Array(bytes)); for (const [otherId, adapter] of this.adapters) if (otherId !== id) void adapter.observe(id, bytes); }
  stopAdvertising(id: string): void { this.advertisements.delete(id); }
  scan(id: string): void { const adapter = this.adapters.get(id); if (!adapter) return; for (const [otherId, bytes] of this.advertisements) if (otherId !== id) void adapter.observe(otherId, bytes); }
  async open(from: string, to: string): Promise<NearbyLinkChannel> { const target = this.adapters.get(to); if (!target) throw new ConnectivityError('TRANSPORT_UNAVAILABLE', 'Controlled nearby endpoint disappeared'); const first = new ControlledNearbyChannel(randomId('controlled-channel'), asEndpointToken(to), bytes => this.deliver(from, to, bytes)); const second = new ControlledNearbyChannel(randomId('controlled-channel'), asEndpointToken(from), bytes => this.deliver(to, from, bytes)); first.pair(second); second.pair(first); await target.accept(second); return first; }
  remove(id: string): void { this.advertisements.delete(id); this.adapters.delete(id); }
  private deliver(from: string, to: string, bytes: Uint8Array): readonly Uint8Array[] { const value = new Uint8Array(bytes); this.transcriptValues.push({ from, to, bytes: value }); const fault = this.fault; this.fault = 'NONE'; if (fault === 'DROP_NEXT') return []; if (fault === 'CORRUPT_NEXT') { const corrupted = new Uint8Array(value); corrupted[Math.max(0, corrupted.length - 1)] ^= 0xff; return [corrupted]; } if (fault === 'DUPLICATE_NEXT') return [new Uint8Array(value), new Uint8Array(value)]; return [new Uint8Array(value)]; }
}

export class ControlledNearbyLinkAdapter implements NearbyLinkAdapter {
  readonly kind = 'CONTROLLED_NEARBY' as const; private observer?: (observation: NearbyLinkObservation) => void | Promise<void>; private readonly incoming = new Set<(channel: NearbyLinkChannel) => void | Promise<void>>(); private advertising = false; private duty?: NearbyDutyCycle;
  constructor(private readonly network: ControlledNearbyNetwork, readonly id: string) {}
  async capabilities(): Promise<NearbyLinkCapabilities> { return { availability: 'AVAILABLE', scanning: true, advertising: true, sessions: true, maxAdvertisementBytes: NEARBY_ADVERTISEMENT_BYTES, maxWriteBytes: 256 * 1024, phys: ['UNKNOWN'], evidence: 'CONTROLLED', limitation: 'Deterministic adapter is not physical BLE evidence' }; }
  async startAdvertising(advertisement: Uint8Array, duty: NearbyDutyCycle): Promise<void> { this.advertising = true; this.duty = duty; this.network.advertise(this.id, advertisement); }
  async updateAdvertisement(advertisement: Uint8Array, duty: NearbyDutyCycle): Promise<void> { if (!this.advertising) throw new ConnectivityError('SESSION_FAILED', 'Controlled advertisement is stopped'); this.duty = duty; this.network.advertise(this.id, advertisement); }
  async stopAdvertising(): Promise<void> { this.advertising = false; this.network.stopAdvertising(this.id); }
  async startScanning(duty: NearbyDutyCycle, onObservation: (observation: NearbyLinkObservation) => void | Promise<void>): Promise<void> { this.duty = duty; this.observer = onObservation; this.network.scan(this.id); }
  async stopScanning(): Promise<void> { this.observer = undefined; }
  onIncomingChannel(handler: (channel: NearbyLinkChannel) => void | Promise<void>): () => void { this.incoming.add(handler); return () => this.incoming.delete(handler); }
  openChannel(endpointToken: NearbyEndpointToken): Promise<NearbyLinkChannel> { return this.network.open(this.id, endpointToken); }
  async stop(): Promise<void> { await this.stopScanning(); await this.stopAdvertising(); this.incoming.clear(); }
  lastDutyCycle(): NearbyDutyCycle | undefined { return this.duty ? { ...this.duty } : undefined; }
  async observe(adapterId: string, advertisement: Uint8Array): Promise<void> { await this.observer?.({ endpointToken: asEndpointToken(adapterId), advertisement: new Uint8Array(advertisement), observedAt: new Date().toISOString(), signalQuality: 'UNKNOWN', phy: 'UNKNOWN' }); }
  async accept(channel: NearbyLinkChannel): Promise<void> { for (const listener of [...this.incoming]) await listener(channel); }
}

// ---------------------------------------------------------------------------
// Native Bluetooth LE adapter boundary
// ---------------------------------------------------------------------------

export interface NativeBluetoothNearbyLinkAdapterOptions {
  readonly host: NativeBluetoothHost;
  readonly request: (capability: 'bluetooth.scan' | 'bluetooth.advertise' | 'bluetooth.connect' | 'bluetooth.exchange') => NativeHostRequest;
  readonly evidence?: NearbyEvidenceLevel;
}

class NativeNearbyChannel implements NearbyLinkChannel {
  readonly id: string; readonly endpointToken: NearbyEndpointToken; readonly openedAt = new Date().toISOString(); readonly maxWriteBytes: number | 'UNKNOWN';
  private readonly closeListeners = new Set<() => void>(); private readonly unsubscribers: (() => void)[] = [];
  constructor(private readonly host: NativeBluetoothHost, readonly connection: NativeBluetoothConnection, endpointToken: NearbyEndpointToken, maxWriteBytes: number | 'UNKNOWN', private readonly request: () => NativeHostRequest) { this.id = connection.id; this.endpointToken = endpointToken; this.maxWriteBytes = maxWriteBytes; this.unsubscribers.push(host.onDisconnect(connection, () => { for (const listener of this.closeListeners) listener(); })); }
  async send(bytes: Uint8Array): Promise<void> { if (typeof this.maxWriteBytes === 'number' && bytes.byteLength > this.maxWriteBytes) throw new ConnectivityError('RESOURCE_LIMIT', 'Native nearby write exceeds host bound'); await this.host.send(this.connection, bytes, this.request()); }
  onBytes(handler: (bytes: Uint8Array) => void | Promise<void>): () => void { const unsubscribe = this.host.receive(this.connection, handler); this.unsubscribers.push(unsubscribe); return unsubscribe; }
  onClose(handler: () => void): () => void { this.closeListeners.add(handler); return () => this.closeListeners.delete(handler); }
  async close(): Promise<void> { for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe(); await this.host.close(this.connection); for (const listener of this.closeListeners) listener(); this.closeListeners.clear(); }
}

export class NativeBluetoothNearbyLinkAdapter implements NearbyLinkAdapter {
  readonly kind = 'NATIVE_BLUETOOTH_LE' as const; private scanSession?: NativeBluetoothScanSession; private advertisementSession?: NativeBluetoothAdvertisementSession; private scanTimer?: ReturnType<typeof setTimeout>; private advertisementTimer?: ReturnType<typeof setTimeout>; private scanGeneration = 0; private advertisementGeneration = 0; private readonly endpointIds = new Map<NearbyEndpointToken, string>(); private readonly incoming = new Set<(channel: NearbyLinkChannel) => void | Promise<void>>(); private unsubscribeIncoming?: () => void; private capability?: NearbyLinkCapabilities;
  constructor(private readonly options: NativeBluetoothNearbyLinkAdapterOptions) {}
  async capabilities(): Promise<NearbyLinkCapabilities> { const state = await this.options.host.state(this.options.request('bluetooth.scan')); const availability = state.adapter === 'POWERED_ON' ? 'AVAILABLE' : state.adapter === 'PERMISSION_REQUIRED' ? 'PERMISSION_REQUIRED' : state.adapter === 'UNAVAILABLE' ? 'UNSUPPORTED' : 'UNAVAILABLE'; this.capability = { availability, scanning: state.capability.scanning, advertising: state.capability.advertising, sessions: state.capability.connections, maxAdvertisementBytes: state.capability.maxAdvertisementBytes ?? 'UNKNOWN', maxWriteBytes: state.capability.maxWriteBytes ?? 'UNKNOWN', phys: state.capability.phys ?? ['UNKNOWN'], evidence: this.options.evidence ?? (availability === 'AVAILABLE' ? 'RUNTIME_DETECTED' : availability === 'UNSUPPORTED' ? 'UNSUPPORTED' : 'BLOCKED_BY_ENVIRONMENT') }; return this.capability; }
  async startAdvertising(advertisement: Uint8Array, duty: NearbyDutyCycle): Promise<void> { const caps = this.capability ?? await this.capabilities(); if (typeof caps.maxAdvertisementBytes === 'number' && advertisement.byteLength > caps.maxAdvertisementBytes) throw new ConnectivityError('RESOURCE_LIMIT', 'Nearby advertisement exceeds native host bound'); const generation = ++this.advertisementGeneration; await this.startAdvertisementCycle(new Uint8Array(advertisement), duty, generation); }
  async updateAdvertisement(advertisement: Uint8Array, duty: NearbyDutyCycle): Promise<void> { await this.stopAdvertising(); await this.startAdvertising(advertisement, duty); }
  async stopAdvertising(): Promise<void> { this.advertisementGeneration += 1; if (this.advertisementTimer) clearTimeout(this.advertisementTimer); this.advertisementTimer = undefined; if (this.advertisementSession) await this.options.host.stopAdvertising(this.advertisementSession); this.advertisementSession = undefined; }
  async startScanning(duty: NearbyDutyCycle, onObservation: (observation: NearbyLinkObservation) => void | Promise<void>): Promise<void> { const generation = ++this.scanGeneration; this.unsubscribeIncoming?.(); this.unsubscribeIncoming = this.options.host.onIncomingConnection(connection => this.acceptNative(connection)); await this.startScanCycle(duty, onObservation, generation); }
  async stopScanning(): Promise<void> { this.scanGeneration += 1; if (this.scanTimer) clearTimeout(this.scanTimer); this.scanTimer = undefined; if (this.scanSession) await this.options.host.stopScan(this.scanSession); this.scanSession = undefined; this.unsubscribeIncoming?.(); this.unsubscribeIncoming = undefined; }
  onIncomingChannel(handler: (channel: NearbyLinkChannel) => void | Promise<void>): () => void { this.incoming.add(handler); return () => this.incoming.delete(handler); }
  async openChannel(endpointToken: NearbyEndpointToken): Promise<NearbyLinkChannel> { const endpointId = this.endpointIds.get(endpointToken); if (!endpointId) throw new ConnectivityError('TRANSPORT_UNAVAILABLE', 'Native nearby endpoint expired'); const connection = await this.options.host.connect(endpointId, this.options.request('bluetooth.connect')); return this.channel(connection, endpointToken); }
  async stop(): Promise<void> { await this.stopScanning(); await this.stopAdvertising(); this.endpointIds.clear(); this.incoming.clear(); }
  private async observeNative(endpoint: NativeBluetoothEndpointObservation, handler: (observation: NearbyLinkObservation) => void | Promise<void>): Promise<void> { const token = asEndpointToken(randomId('native-nearby-endpoint')); this.endpointIds.set(token, endpoint.endpointId); if (this.endpointIds.size > 256) this.endpointIds.delete(this.endpointIds.keys().next().value!); await handler({ endpointToken: token, advertisement: new Uint8Array(endpoint.advertisement), observedAt: endpoint.observedAt, signalQuality: endpoint.signalQuality, phy: endpoint.phy }); }
  private async acceptNative(connection: NativeBluetoothConnection): Promise<void> { const token = asEndpointToken(randomId('native-nearby-incoming')); const channel = this.channel(connection, token); for (const listener of [...this.incoming]) await listener(channel); }
  private channel(connection: NativeBluetoothConnection, token: NearbyEndpointToken): NearbyLinkChannel { return new NativeNearbyChannel(this.options.host, connection, token, this.capability?.maxWriteBytes ?? 'UNKNOWN', () => this.options.request('bluetooth.exchange')); }
  private async startAdvertisementCycle(advertisement: Uint8Array, duty: NearbyDutyCycle, generation: number): Promise<void> {
    if (generation !== this.advertisementGeneration) return;
    if (this.advertisementSession) await this.options.host.stopAdvertising(this.advertisementSession);
    const durationMs = Math.max(60_000, duty.scanIntervalMs * 2);
    this.advertisementSession = await this.options.host.advertise(advertisement, { durationMs, intervalMs: duty.advertisementIntervalMs }, this.options.request('bluetooth.advertise'));
    this.advertisementTimer = setTimeout(() => { void this.startAdvertisementCycle(advertisement, duty, generation).catch(() => undefined); }, Math.max(1_000, durationMs - 1_000));
    (this.advertisementTimer as { unref?: () => void }).unref?.();
  }
  private async startScanCycle(duty: NearbyDutyCycle, handler: (observation: NearbyLinkObservation) => void | Promise<void>, generation: number): Promise<void> {
    if (generation !== this.scanGeneration) return;
    if (this.scanSession) await this.options.host.stopScan(this.scanSession);
    this.scanSession = await this.options.host.scan({ durationMs: duty.scanWindowMs, maxResults: duty.maxResults }, this.options.request('bluetooth.scan'), endpoint => this.observeNative(endpoint, handler));
    this.scanTimer = setTimeout(() => { void this.startScanCycle(duty, handler, generation).catch(() => undefined); }, duty.scanIntervalMs);
    (this.scanTimer as { unref?: () => void }).unref?.();
  }
}
