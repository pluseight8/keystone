/**
 * R0P69 bounded anonymous multi-hop routing.
 *
 * This module is deliberately below ConnectivityFabric.  It carries the
 * Fabric's already opaque frame over short-lived protected R0P68 neighbor
 * sessions and never resolves a neighbor handle to a Keystone Identity.
 * There is no durable stranger storage, Internet gateway behavior, or global
 * topology in this implementation.
 */

import {
  ConnectivityError,
  ConnectivityResourceGovernor,
  createOpaqueDeliveryEnvelope,
  decodeOpaqueFrame,
  decodeOpaqueBytes,
  encodeOpaqueBytes,
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
import type { AnonymousNearbyTransportProvider } from './nearby.js';

const CONTROL_DESTINATION = 'mesh-route';
const CONTROL_PREFIX = 'mesh-route:';
const CONTROL_VERSION = 1 as const;
const MAX_TOKEN_BYTES = 96;
const MAX_CONTROL_BYTES = 12 * 1024;
const MAX_PAYLOAD_BYTES = 64 * 1024;
const MAX_DIAGNOSTIC_NEIGHBORS = 128;

export const ANONYMOUS_MESH_CONTROL_DESTINATION = CONTROL_DESTINATION;

export type AnonymousMeshResourceClass = 'SMALL' | 'REALTIME' | 'BULK' | 'BACKGROUND';

/** A provider-agnostic anonymous protected-neighbor boundary. */
export interface AnonymousNeighborSessionSource {
  listNeighbors(limit?: number): readonly { readonly handle: string; readonly expiresAt: string }[];
  openNeighbor(handle: string): Promise<TransportSession>;
  sendNeighborFrame(session: TransportSession, frame: OpaqueFrame): Promise<void>;
  onNeighborFrame(handler: (frame: OpaqueFrame, session?: TransportSession) => void | Promise<void>): () => void;
  closeNeighborSession(session: TransportSession): Promise<void>;
  /** Optional reverse lookup used only to avoid forwarding a request back to
   * the incoming anonymous hop.  The value is still an ephemeral handle, not
   * a Social Identity. */
  peerHandleForSession?(session: TransportSession): string | undefined;
  /** Optional lifecycle hooks for sources which own their underlying radio. */
  start?(): Promise<void>;
  stop?(): Promise<void>;
}

/** Adapt the existing R0P68 provider without exposing its provider-specific
 * implementation to the router. */
export function createAnonymousNeighborSessionSource(provider: AnonymousNearbyTransportProvider): AnonymousNeighborSessionSource {
  return {
    listNeighbors: limit => provider.anonymousNeighborHandles(limit),
    openNeighbor: handle => provider.openAnonymousNeighbor(handle as never),
    sendNeighborFrame: (session, frame) => provider.sendOpaqueFrame(session, frame),
    onNeighborFrame: handler => provider.receiveOpaqueFrame(handler),
    closeNeighborSession: session => provider.close(session),
    peerHandleForSession: session => provider.anonymousNeighborPeerHandle(session),
    start: () => provider.start(),
    stop: () => provider.stop(),
  };
}

/** Compatibility alias for hosts that prefer an adapter-oriented name. */
export const nearbyNeighborSessionSource = createAnonymousNeighborSessionSource;

/** Compose multiple anonymous one-hop sources (for example, different
 * physical links) without creating a global peer directory. */
export class CompositeAnonymousNeighborSessionSource implements AnonymousNeighborSessionSource {
  private readonly sourceByProvider = new Map<string, AnonymousNeighborSessionSource>();
  private readonly unsubscribers: (() => void)[] = [];

  constructor(private readonly sources: readonly AnonymousNeighborSessionSource[]) {}

  listNeighbors(limit = MAX_DIAGNOSTIC_NEIGHBORS): readonly { readonly handle: string; readonly expiresAt: string }[] {
    const values: { handle: string; expiresAt: string }[] = [];
    for (let index = 0; index < this.sources.length && values.length < limit; index += 1) {
      for (const neighbor of this.sources[index]!.listNeighbors(Math.max(0, limit - values.length))) {
        values.push({ handle: `source${index}.${neighbor.handle}`, expiresAt: neighbor.expiresAt });
        if (values.length >= limit) break;
      }
    }
    return values;
  }

  async openNeighbor(handle: string): Promise<TransportSession> {
    const separator = handle.indexOf('.');
    if (separator <= 6) throw new ConnectivityError('POLICY_DENIED', 'Anonymous composite neighbor handle is malformed');
    const sourceIndex = Number(handle.slice(6, separator));
    const source = Number.isSafeInteger(sourceIndex) ? this.sources[sourceIndex] : undefined;
    if (!source) throw new ConnectivityError('TRANSPORT_UNAVAILABLE', 'Anonymous composite neighbor source is unavailable');
    const session = await source.openNeighbor(handle.slice(separator + 1));
    this.sourceByProvider.set(session.providerId, source);
    return session;
  }

  sendNeighborFrame(session: TransportSession, frame: OpaqueFrame): Promise<void> {
    const source = this.sourceByProvider.get(session.providerId);
    if (!source) throw new ConnectivityError('TRANSPORT_UNAVAILABLE', 'Anonymous neighbor session source is unavailable');
    return source.sendNeighborFrame(session, frame);
  }

  onNeighborFrame(handler: (frame: OpaqueFrame, session?: TransportSession) => void | Promise<void>): () => void {
    for (const source of this.sources) {
      const unsubscribe = source.onNeighborFrame((frame, session) => {
        if (session) this.sourceByProvider.set(session.providerId, source);
        return handler(frame, session);
      });
      this.unsubscribers.push(unsubscribe);
    }
    return () => {
      for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
      this.sourceByProvider.clear();
    };
  }

  async closeNeighborSession(session: TransportSession): Promise<void> {
    const source = this.sourceByProvider.get(session.providerId);
    if (!source) return;
    await source.closeNeighborSession(session);
  }

  peerHandleForSession(session: TransportSession): string | undefined {
    const source = this.sourceByProvider.get(session.providerId);
    const raw = source?.peerHandleForSession?.(session);
    if (raw === undefined) return undefined;
    const index = this.sources.indexOf(source!);
    return index >= 0 ? `source${index}.${raw}` : raw;
  }

  async start(): Promise<void> { for (const source of this.sources) await source.start?.(); }
  async stop(): Promise<void> { for (const source of this.sources) await source.stop?.(); }
}

interface MeshRequestMessage {
  readonly kind: 'mesh.request';
  readonly version: typeof CONTROL_VERSION;
  readonly requestId: string;
  readonly destinationToken: string;
  readonly expiresAt: string;
  readonly hopsLeft: number;
  readonly fanout: number;
  readonly resourceClass: AnonymousMeshResourceClass;
}

interface MeshReplyMessage {
  readonly kind: 'mesh.reply';
  readonly version: typeof CONTROL_VERSION;
  readonly requestId: string;
  readonly routeId: string;
  readonly destinationToken: string;
  readonly expiresAt: string;
}

interface MeshDataMessage {
  readonly kind: 'mesh.data';
  readonly version: typeof CONTROL_VERSION;
  readonly routeId: string;
  readonly sequence: number;
  /** Base64url bytes of the original OpaqueFrame.  Relays treat this value as
   * an uninterpreted payload; it is never parsed in relay code. */
  readonly payload: string;
  readonly expiresAt: string;
}

interface MeshAckMessage {
  readonly kind: 'mesh.ack';
  readonly version: typeof CONTROL_VERSION;
  readonly routeId: string;
  readonly sequence: number;
  readonly accepted: boolean;
  readonly expiresAt: string;
}

interface MeshCloseMessage {
  readonly kind: 'mesh.close';
  readonly version: typeof CONTROL_VERSION;
  readonly routeId: string;
  readonly expiresAt: string;
}

interface MeshErrorMessage {
  readonly kind: 'mesh.error';
  readonly version: typeof CONTROL_VERSION;
  readonly routeId: string;
  readonly code: 'UNAVAILABLE' | 'EXPIRED' | 'REJECTED' | 'RESOURCE_LIMIT';
  readonly expiresAt: string;
}

type MeshRouteMessage = MeshRequestMessage | MeshReplyMessage | MeshDataMessage | MeshAckMessage | MeshCloseMessage | MeshErrorMessage;

interface MeshRouteState {
  readonly routeId: string;
  readonly destinationToken: string;
  readonly payloadSecret?: string;
  readonly expiresAt: number;
  readonly source: boolean;
  forward?: TransportSession;
  reverse?: TransportSession;
  nextSequence: number;
  readonly seenSequences: Map<number, number>;
  frames: number;
  bytes: number;
  lastActivityAt: number;
}

interface MeshRequestState {
  readonly requestId: string;
  readonly destinationToken: string;
  readonly expiresAt: number;
  readonly incoming?: TransportSession;
  forwarded: boolean;
  localReplies: number;
}

interface DiscoveryWaiter {
  readonly token: string;
  readonly secret: string;
  readonly expiresAt: number;
  readonly resolve: (routeId: string) => void;
  readonly reject: (error: unknown) => void;
  resolved: boolean;
}

export interface AnonymousMeshRouterOptions {
  readonly providerId?: string;
  readonly now?: () => number;
  readonly resources?: ConnectivityResourceGovernor;
  readonly maxHops?: number;
  readonly maxFanout?: number;
  readonly routeTtlMs?: number;
  readonly idleRouteTtlMs?: number;
  readonly discoveryTimeoutMs?: number;
  readonly maxActiveRoutes?: number;
  readonly maxRoutesPerNeighbor?: number;
  readonly maxPendingDiscoveries?: number;
  readonly maxSeenRequests?: number;
  readonly maxDiscoveryPerMinute?: number;
  readonly maxFramesPerRoute?: number;
  readonly maxBytesPerRoute?: number;
  readonly maxFrameBytes?: number;
  readonly ackTimeoutMs?: number;
  /** Maximum number of locally bound rendezvous secrets.  Rendezvous
   * bindings are host-provided bootstrap state, never a global directory. */
  readonly maxRendezvousTokens?: number;
}

export interface AnonymousMeshDiagnostics {
  readonly providerId: TransportProviderId;
  readonly running: boolean;
  readonly activeRoutes: number;
  readonly activeRelays: number;
  readonly pendingDiscoveries: number;
  readonly seenRequests: number;
  readonly discoveredNeighbors: number;
  readonly forwardedFrames: number;
  readonly rejectedFrames: number;
  readonly rejectedRequests: number;
  readonly replayedFrames: number;
  readonly routeFailures: number;
  readonly bytesRelayed: number;
  readonly maxHops: number;
  readonly maxFanout: number;
}

export interface AnonymousMeshRouteInspection {
  readonly routeId: string;
  readonly expiresAt: string;
  readonly destinationToken: string;
  readonly hopCount?: number;
  readonly state: 'ACTIVE' | 'EXPIRED';
}

const MESH_SECURITY: TransportSecurityBoundary = Object.freeze({ opaqueOnly: true, e2eRequired: true, canDecrypt: false, canAuthorize: false });
const MESH_CAPABILITIES: readonly TransportCapability[] = Object.freeze(['MESH', 'DISCOVERY', 'DATAGRAM', 'CONTROL', 'INTERACTIVE', 'REALTIME', 'BACKGROUND', 'LOW_BANDWIDTH', 'SMALL_MTU', 'LOCAL_ONLY']);

function randomId(prefix: string): string { return `${prefix}:${crypto.randomUUID()}`; }
function nowIso(now: () => number): string { return new Date(now()).toISOString(); }
function bounded(value: number | undefined, min: number, max: number, fallback: number): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < min || resolved > max) throw new ConnectivityError('POLICY_DENIED', 'Anonymous mesh resource limit is invalid');
  return resolved;
}
function asProviderId(value: string): TransportProviderId { return value as TransportProviderId; }
function asBase64(value: Uint8Array): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(value).toString('base64url');
  let binary = ''; for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function utf8(value: string): Uint8Array { return new TextEncoder().encode(value); }
function resourceClass(requirement?: DeliveryRequirement): AnonymousMeshResourceClass {
  switch (requirement?.profile) {
    case 'REALTIME': return 'REALTIME';
    case 'BULK': return 'BULK';
    case 'BACKGROUND': return 'BACKGROUND';
    default: return 'SMALL';
  }
}
function sameSession(a: TransportSession | undefined, b: TransportSession | undefined): boolean { return !!a && !!b && a.id === b.id && a.providerId === b.providerId; }
function incomingHandleFor(source: AnonymousNeighborSessionSource, session: TransportSession): string | undefined { return source.peerHandleForSession?.(session); }
function validToken(value: unknown): value is string { return typeof value === 'string' && value.length >= 8 && value.length <= MAX_TOKEN_BYTES && /^[A-Za-z0-9_-]+$/.test(value); }
function validIdentifier(value: unknown, max: number): value is string { return typeof value === 'string' && value.length >= 8 && value.length <= max && /^[A-Za-z0-9:_-]+$/.test(value); }

async function verifyControlEnvelope(envelope: OpaqueFrame, now = Date.now()): Promise<MeshRouteMessage | undefined> {
  if ('kind' in envelope || envelope.destination !== CONTROL_DESTINATION || !envelope.id.startsWith(CONTROL_PREFIX)) return undefined;
  const expected = `sha256:${asBase64(new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(envelope.ciphertext) as unknown as ArrayBuffer)))}`;
  if (expected !== envelope.integrity) throw new ConnectivityError('POLICY_DENIED', 'Anonymous mesh control integrity failed');
  const bytes = decodeOpaqueBytes(envelope.ciphertext);
  if (bytes.byteLength > MAX_CONTROL_BYTES) throw new ConnectivityError('RESOURCE_LIMIT', 'Anonymous mesh control frame exceeds bound');
  let value: unknown;
  try { value = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new ConnectivityError('SESSION_FAILED', 'Anonymous mesh control frame is malformed'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ConnectivityError('SESSION_FAILED', 'Anonymous mesh control message is malformed');
  const item = value as Record<string, unknown>;
  if (item.version !== CONTROL_VERSION || typeof item.kind !== 'string' || !item.kind.startsWith('mesh.') || typeof item.expiresAt !== 'string' || Date.parse(item.expiresAt) <= now) throw new ConnectivityError('POLICY_DENIED', 'Anonymous mesh control message is invalid or expired');
  if (typeof item.requestId === 'string' && !validIdentifier(item.requestId, 160)) throw new ConnectivityError('POLICY_DENIED', 'Anonymous mesh request identifier is invalid');
  if (typeof item.routeId === 'string' && !validIdentifier(item.routeId, 160)) throw new ConnectivityError('POLICY_DENIED', 'Anonymous mesh route identifier is invalid');
  if (item.kind === 'mesh.request') {
    if (typeof item.requestId !== 'string' || typeof item.destinationToken !== 'string' || !validToken(item.destinationToken) || !Number.isSafeInteger(item.hopsLeft) || (item.hopsLeft as number) < 0 || (item.hopsLeft as number) > 16 || !Number.isSafeInteger(item.fanout) || (item.fanout as number) < 1 || (item.fanout as number) > 8 || !['SMALL', 'REALTIME', 'BULK', 'BACKGROUND'].includes(String(item.resourceClass))) throw new ConnectivityError('POLICY_DENIED', 'Anonymous mesh route request is invalid');
  } else if (item.kind === 'mesh.reply') {
    if (typeof item.requestId !== 'string' || typeof item.routeId !== 'string' || typeof item.destinationToken !== 'string' || !validToken(item.destinationToken)) throw new ConnectivityError('POLICY_DENIED', 'Anonymous mesh route reply is invalid');
  } else if (item.kind === 'mesh.data') {
    if (typeof item.routeId !== 'string' || !Number.isSafeInteger(item.sequence) || (item.sequence as number) < 0 || typeof item.payload !== 'string' || item.payload.length > MAX_PAYLOAD_BYTES * 2) throw new ConnectivityError('RESOURCE_LIMIT', 'Anonymous mesh data frame is invalid');
  } else if (item.kind === 'mesh.ack') {
    if (typeof item.routeId !== 'string' || !Number.isSafeInteger(item.sequence) || (item.sequence as number) < 0 || typeof item.accepted !== 'boolean') throw new ConnectivityError('POLICY_DENIED', 'Anonymous mesh acknowledgement is invalid');
  } else if (item.kind === 'mesh.close') {
    if (typeof item.routeId !== 'string') throw new ConnectivityError('POLICY_DENIED', 'Anonymous mesh close frame is invalid');
  } else if (item.kind === 'mesh.error') {
    if (typeof item.routeId !== 'string' || !['UNAVAILABLE', 'EXPIRED', 'REJECTED', 'RESOURCE_LIMIT'].includes(String(item.code))) throw new ConnectivityError('POLICY_DENIED', 'Anonymous mesh route error is invalid');
  } else throw new ConnectivityError('POLICY_DENIED', 'Anonymous mesh control kind is unsupported');
  return item as unknown as MeshRouteMessage;
}

export class AnonymousMeshRouter {
  readonly providerId: TransportProviderId;
  private readonly now: () => number;
  private readonly resources: ConnectivityResourceGovernor;
  private readonly limits: Readonly<{
    maxHops: number; maxFanout: number; routeTtlMs: number; idleRouteTtlMs: number; discoveryTimeoutMs: number;
    maxActiveRoutes: number; maxRoutesPerNeighbor: number; maxPendingDiscoveries: number; maxSeenRequests: number;
    maxDiscoveryPerMinute: number; maxFramesPerRoute: number; maxBytesPerRoute: number; maxFrameBytes: number; ackTimeoutMs: number;
    maxRendezvousTokens: number;
  }>;
  private readonly destinationTokens = new Map<string, string>();
  private readonly destinationPublicTokens = new Map<string, string>();
  private readonly localTokens = new Set<string>();
  private readonly localTokenSecrets = new Set<string>();
  private readonly routes = new Map<string, MeshRouteState>();
  private readonly routeCandidates = new Map<string, string[]>();
  private readonly sessions = new Map<string, TransportSession>();
  private readonly neighborSessions = new Map<string, TransportSession>();
  private readonly sessionReferences = new Map<string, number>();
  private readonly requestStates = new Map<string, MeshRequestState>();
  private readonly seenRequests = new Map<string, number>();
  private readonly discoveryWaiters = new Map<string, DiscoveryWaiter>();
  private readonly ackWaiters = new Map<string, { readonly resolve: (accepted: boolean) => void; readonly reject: (error: unknown) => void; readonly timer: ReturnType<typeof setTimeout> }>();
  private readonly listeners = new Set<(frame: OpaqueFrame, session?: TransportSession) => void | Promise<void>>();
  private unsubscribeNeighbors?: () => void;
  private sweepTimer?: ReturnType<typeof setInterval>;
  private running = false;
  private discoveryWindowAt = 0;
  private discoveryWindowCount = 0;
  private forwardedFrames = 0;
  private rejectedFrames = 0;
  private rejectedRequests = 0;
  private replayedFrames = 0;
  private routeFailures = 0;
  private bytesRelayed = 0;

  private readonly source: AnonymousNeighborSessionSource;
  constructor(source: AnonymousNeighborSessionSource | AnonymousNearbyTransportProvider, options: AnonymousMeshRouterOptions = {}) {
    this.source = 'listNeighbors' in source ? source : createAnonymousNeighborSessionSource(source);
    this.providerId = asProviderId(options.providerId ?? randomId('anonymous-mesh'));
    this.now = options.now ?? Date.now;
    this.resources = options.resources ?? new ConnectivityResourceGovernor();
    this.limits = Object.freeze({
      maxHops: bounded(options.maxHops, 1, 16, 5),
      maxFanout: bounded(options.maxFanout, 1, 8, 3),
      routeTtlMs: bounded(options.routeTtlMs, 5_000, 5 * 60_000, 30_000),
      idleRouteTtlMs: bounded(options.idleRouteTtlMs, 1_000, 5 * 60_000, 15_000),
      discoveryTimeoutMs: bounded(options.discoveryTimeoutMs, 50, 10_000, 1_000),
      maxActiveRoutes: bounded(options.maxActiveRoutes, 1, 1_024, 64),
      maxRoutesPerNeighbor: bounded(options.maxRoutesPerNeighbor, 1, 256, 16),
      maxPendingDiscoveries: bounded(options.maxPendingDiscoveries, 1, 256, 32),
      maxSeenRequests: bounded(options.maxSeenRequests, 32, 16_384, 1_024),
      maxDiscoveryPerMinute: bounded(options.maxDiscoveryPerMinute, 1, 10_000, 60),
      maxFramesPerRoute: bounded(options.maxFramesPerRoute, 1, 65_536, 128),
      maxBytesPerRoute: bounded(options.maxBytesPerRoute, 4 * 1024, 256 * 1024 * 1024, 8 * 1024 * 1024),
      maxFrameBytes: bounded(options.maxFrameBytes, 256, 256 * 1024, 48 * 1024),
      ackTimeoutMs: bounded(options.ackTimeoutMs, 100, 30_000, 5_000),
      maxRendezvousTokens: bounded(options.maxRendezvousTokens, 1, 4_096, 256),
    });
  }

  /** Bind a short-lived opaque rendezvous token.  Callers should distribute
   * the token through an already authorized/bootstrap channel; it is never
   * derived from or equal to a Social Identity. */
  bindOpaqueRendezvous(destination: string, token = createAnonymousRendezvousToken(), options: { readonly local?: boolean } = {}): string {
    if (!destination || !validToken(token)) throw new ConnectivityError('POLICY_DENIED', 'Anonymous mesh rendezvous token is invalid');
    if (!this.destinationTokens.has(destination) && this.destinationTokens.size >= this.limits.maxRendezvousTokens) throw new ConnectivityError('RESOURCE_LIMIT', 'Anonymous mesh rendezvous binding bound exceeded');
    this.destinationTokens.set(destination, token); if (options.local) { this.localTokenSecrets.add(token); void this.publicRendezvousToken(token).then(publicToken => this.localTokens.add(publicToken)); } return token;
  }
  /** Register a token this endpoint recognizes as its own rendezvous.  This
   * is intentionally separate from a sender's destination binding so a
   * source cannot accidentally make itself the route destination. */
  registerLocalRendezvous(token: string): void { if (!validToken(token)) throw new ConnectivityError('POLICY_DENIED', 'Anonymous mesh local rendezvous token is invalid'); if (!this.localTokenSecrets.has(token) && this.localTokenSecrets.size >= this.limits.maxRendezvousTokens) throw new ConnectivityError('RESOURCE_LIMIT', 'Anonymous mesh local rendezvous bound exceeded'); this.localTokenSecrets.add(token); void this.publicRendezvousToken(token).then(publicToken => this.localTokens.add(publicToken)); }
  advertiseOpaqueRendezvous(token: string): void { this.registerLocalRendezvous(token); }
  unbindOpaqueRendezvous(destination: string): void { const token = this.destinationTokens.get(destination); this.destinationTokens.delete(destination); this.destinationPublicTokens.delete(destination); if (token) { this.localTokenSecrets.delete(token); void this.publicRendezvousToken(token).then(publicToken => this.localTokens.delete(publicToken)); } }
  routeInspection(): readonly AnonymousMeshRouteInspection[] { this.sweep(); return [...this.routes.values()].map(route => ({ routeId: route.routeId, expiresAt: new Date(route.expiresAt).toISOString(), destinationToken: route.destinationToken, state: route.expiresAt > this.now() ? 'ACTIVE' : 'EXPIRED' })); }

  async start(): Promise<void> {
    if (this.running) return;
    await this.source.start?.();
    this.unsubscribeNeighbors = this.source.onNeighborFrame((frame, session) => this.receiveNeighborFrame(frame, session));
    this.sweepTimer = setInterval(() => this.sweep(), 1_000); (this.sweepTimer as { unref?: () => void }).unref?.();
    this.running = true;
  }

  async stop(): Promise<void> {
    if (this.sweepTimer) clearInterval(this.sweepTimer); this.sweepTimer = undefined;
    this.unsubscribeNeighbors?.(); this.unsubscribeNeighbors = undefined;
    for (const route of [...this.routes.values()]) await this.teardownRoute(route.routeId);
    for (const session of [...this.sessions.values()]) await this.source.closeNeighborSession(session).catch(() => undefined);
    this.sessions.clear(); this.sessionReferences.clear(); this.requestStates.clear(); this.seenRequests.clear(); this.discoveryWaiters.clear(); this.routeCandidates.clear();
    this.neighborSessions.clear();
    for (const waiter of this.ackWaiters.values()) { clearTimeout(waiter.timer); waiter.reject(new ConnectivityError('CANCELLED', 'Anonymous mesh router stopped')); }
    this.ackWaiters.clear(); await this.source.stop?.(); this.running = false;
  }

  isRunning(): boolean { return this.running; }

  async discover(destination: string, requirement: DeliveryRequirement = { profile: 'INTERACTIVE' }): Promise<TransportEndpoint | undefined> {
    const endpoints = await this.discoverDirectReachability(destination, requirement);
    return endpoints[0];
  }

  async discoverDirectReachability(destination: string, requirement: DeliveryRequirement = { profile: 'BEST_EFFORT' }): Promise<readonly TransportEndpoint[]> {
    this.sweep();
    const secret = this.destinationTokens.get(destination);
    const token = secret ? await this.publicRendezvousToken(secret) : undefined;
    if (!secret || !token || !this.running || requirement.requireDirect) return [];
    this.destinationPublicTokens.set(destination, token);
    const candidateIds = this.routeCandidates.get(token) ?? [];
    while (candidateIds.length && (!this.routes.get(candidateIds[0]!) || this.routes.get(candidateIds[0]!)!.expiresAt <= this.now())) candidateIds.shift();
    const candidate = candidateIds.length ? this.routes.get(candidateIds[0]!) : [...this.routes.values()].find(route => route.source && route.destinationToken === token && route.expiresAt > this.now());
    if (candidate) return [this.endpointForRoute(candidate)];
    if (!this.resources.allowsBackgroundDiscovery() && requirement.profile === 'BACKGROUND') return [];
    if (this.discoveryWaiters.size >= this.limits.maxPendingDiscoveries) return [];
    const at = this.now(); if (at - this.discoveryWindowAt >= 60_000) { this.discoveryWindowAt = at; this.discoveryWindowCount = 0; }
    if (++this.discoveryWindowCount > this.limits.maxDiscoveryPerMinute) return [];
    const requestId = randomId('mesh-request'); const expiresAt = at + this.limits.routeTtlMs;
    // The destination consumes the final hop when it receives the request;
    // initialize the relay budget one below the configured path limit so a
    // maxHops=1 route means exactly one protected neighbor link.
    const request: MeshRequestMessage = { kind: 'mesh.request', version: CONTROL_VERSION, requestId, destinationToken: token, expiresAt: new Date(expiresAt).toISOString(), hopsLeft: Math.max(0, this.effectiveMaxHops() - 1), fanout: this.effectiveFanout(), resourceClass: resourceClass(requirement) };
    const neighbors = this.source.listNeighbors(MAX_DIAGNOSTIC_NEIGHBORS).slice(0, this.effectiveFanout());
    if (!neighbors.length) return [];
    const waiter = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => { this.discoveryWaiters.delete(requestId); reject(new ConnectivityError('TIMEOUT', 'Anonymous mesh route discovery timed out')); }, Math.min(this.limits.discoveryTimeoutMs, Math.max(50, expiresAt - at)));
      (timer as { unref?: () => void }).unref?.(); this.discoveryWaiters.set(requestId, { token, secret, expiresAt, resolve, reject, resolved: false });
    });
    const control = await this.controlEnvelope(request);
    await Promise.all(neighbors.map(async neighbor => {
      try { const session = await this.openNeighborSession(neighbor.handle); await this.sendControl(session, control); }
      catch { /* a neighbor observation is only a hint; other branches continue */ }
    }));
    try {
      const routeId = await waiter;
      const route = this.routes.get(routeId); if (!route) return [];
      return [this.endpointForRoute(route)];
    } catch { return []; }
  }

  isPeerConnected(destination: string): boolean {
    const token = this.destinationPublicTokens.get(destination); if (!token) return false;
    this.sweep(); return [...this.routes.values()].some(route => route.source && route.destinationToken === token && route.expiresAt > this.now());
  }

  async openSession(endpoint: TransportEndpoint): Promise<TransportSession> {
    this.sweep();
    if (endpoint.providerId !== this.providerId || endpoint.providerType !== 'ExternalRadioTransport') throw new ConnectivityError('POLICY_DENIED', 'Anonymous mesh endpoint belongs to another provider');
    const route = this.routes.get(endpoint.routeReference); if (!route || !route.source || route.expiresAt <= this.now()) throw new ConnectivityError('TRANSPORT_UNAVAILABLE', 'Anonymous mesh route is stale');
    const session: TransportSession = { id: randomId('mesh-session'), endpoint, providerId: this.providerId, openedAt: nowIso(this.now), state: 'OPEN' };
    this.sessions.set(session.id, session); return session;
  }

  async sendOpaqueFrame(session: TransportSession, frame: OpaqueFrame): Promise<void> {
    this.sweep();
    const routeSession = this.sessions.get(session.id); if (!routeSession) throw new ConnectivityError('SESSION_FAILED', 'Anonymous mesh session is closed');
    const route = this.routes.get(routeSession.endpoint.routeReference); if (!route || route.expiresAt <= this.now()) throw new ConnectivityError('TRANSPORT_UNAVAILABLE', 'Anonymous mesh route expired');
    if (!route.payloadSecret) throw new ConnectivityError('POLICY_DENIED', 'Anonymous mesh route has no end-to-end payload key');
    const plaintext = new TextEncoder().encode(JSON.stringify('kind' in frame ? frame : { kind: 'envelope', envelope: frame }));
    if (plaintext.byteLength > this.limits.maxFrameBytes) throw new ConnectivityError('MTU_EXCEEDED', 'Anonymous mesh frame exceeds relay bound');
    let current: MeshRouteState | undefined = route;
    let lastError: unknown;
    // At most one bounded alternate is attempted.  The application envelope
    // id remains unchanged, so a late success on the original circuit and a
    // retry on the alternate are deduplicated at the destination.
    for (let attempt = 0; attempt < 2 && current; attempt += 1) {
      try {
        await this.sendOnRoute(current, plaintext);
        return;
      } catch (error) {
        lastError = error; this.routeFailures += 1; const failedRouteId = current.routeId;
        await this.teardownRoute(failedRouteId);
        const candidates = this.routeCandidates.get(route.destinationToken) ?? [];
        current = candidates.map(candidate => this.routes.get(candidate)).find(value => !!value && value.source && value.expiresAt > this.now());
      }
    }
    throw lastError ?? new ConnectivityError('DELIVERY_UNCONFIRMED', 'Anonymous mesh destination acknowledgement failed');
  }

  receiveOpaqueFrame(handler: (frame: OpaqueFrame, session?: TransportSession) => void | Promise<void>): () => void { this.listeners.add(handler); return () => this.listeners.delete(handler); }

  async close(session: TransportSession): Promise<void> { this.sessions.delete(session.id); const routeId = session.endpoint.routeReference; await this.teardownRoute(routeId); }

  async measureLink(_session?: TransportSession): Promise<TransportMetrics> {
    return { mtu: 4 * 1024, signalQuality: 'UNKNOWN', cost: 'FREE', energy: 'MEDIUM', metered: false, queuePressure: this.routes.size / this.limits.maxActiveRoutes, observedAt: nowIso(this.now) };
  }

  diagnostics(): AnonymousMeshDiagnostics {
    this.sweep(); return { providerId: this.providerId, running: this.running, activeRoutes: this.routes.size, activeRelays: [...this.routes.values()].filter(route => !route.source).length, pendingDiscoveries: this.discoveryWaiters.size, seenRequests: this.seenRequests.size, discoveredNeighbors: Math.min(MAX_DIAGNOSTIC_NEIGHBORS, this.source.listNeighbors(MAX_DIAGNOSTIC_NEIGHBORS).length), forwardedFrames: this.forwardedFrames, rejectedFrames: this.rejectedFrames, rejectedRequests: this.rejectedRequests, replayedFrames: this.replayedFrames, routeFailures: this.routeFailures, bytesRelayed: this.bytesRelayed, maxHops: this.limits.maxHops, maxFanout: this.limits.maxFanout };
  }

  private effectiveMaxHops(): number { const profile = this.resources.snapshot(); return profile.battery === 'LOW' || profile.battery === 'CRITICAL' || profile.thermal === 'SERIOUS' || profile.thermal === 'CRITICAL' ? Math.max(1, Math.min(this.limits.maxHops, 3)) : this.limits.maxHops; }
  private effectiveFanout(): number { const profile = this.resources.snapshot(); return profile.battery === 'LOW' || profile.battery === 'CRITICAL' || profile.thermal === 'SERIOUS' || profile.thermal === 'CRITICAL' ? 1 : this.limits.maxFanout; }
  private async publicRendezvousToken(secret: string): Promise<string> {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(secret) as unknown as ArrayBuffer));
    return asBase64(digest.subarray(0, 18));
  }
  private async localSecretForPublicToken(publicToken: string): Promise<string | undefined> {
    for (const secret of this.localTokenSecrets) if (await this.publicRendezvousToken(secret) === publicToken) { this.localTokens.add(publicToken); return secret; }
    return undefined;
  }
  private endpointForRoute(route: MeshRouteState): TransportEndpoint { return { handle: randomId('mesh-endpoint'), providerId: this.providerId, providerType: 'ExternalRadioTransport', routeReference: route.routeId, expiresAt: new Date(route.expiresAt).toISOString(), anonymous: true }; }

  private async openNeighborSession(handle: string): Promise<TransportSession> {
    const existing = this.neighborSessions.get(handle); if (existing) return existing;
    const session = await this.source.openNeighbor(handle); this.sessions.set(session.id, session); this.neighborSessions.set(handle, session); return session;
  }

  private async controlEnvelope(message: MeshRouteMessage): Promise<OpaqueFrame> {
    const encoded = utf8(JSON.stringify(message)); if (encoded.byteLength > MAX_CONTROL_BYTES) throw new ConnectivityError('RESOURCE_LIMIT', 'Anonymous mesh control message exceeds bound');
    return createOpaqueDeliveryEnvelope({ id: randomId(CONTROL_PREFIX.slice(0, -1)), destination: CONTROL_DESTINATION, ciphertext: encoded, replayNonce: randomId('mesh-nonce'), expiresAt: message.expiresAt, requirement: { profile: 'CONTROL' } });
  }
  private async sendControl(session: TransportSession, frame: OpaqueFrame): Promise<void> {
    try { await this.source.sendNeighborFrame(session, frame); }
    catch (error) {
      this.sessions.delete(session.id); this.sessionReferences.delete(session.id);
      for (const [handle, candidate] of this.neighborSessions) if (candidate.id === session.id) this.neighborSessions.delete(handle);
      await this.source.closeNeighborSession(session).catch(() => undefined);
      throw error;
    }
  }
  private async payloadKey(secret: string): Promise<CryptoKey> {
    const digest = await crypto.subtle.digest('SHA-256', utf8(`keystone-r0p69-payload:${secret}`) as unknown as ArrayBuffer);
    return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  }
  private async encryptPayload(secret: string, plaintext: Uint8Array): Promise<string> {
    const nonce = new Uint8Array(12); crypto.getRandomValues(nonce);
    const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, await this.payloadKey(secret), plaintext as unknown as ArrayBuffer));
    const combined = new Uint8Array(nonce.byteLength + cipher.byteLength); combined.set(nonce); combined.set(cipher, nonce.byteLength); return encodeOpaqueBytes(combined);
  }
  private async sendOnRoute(route: MeshRouteState, plaintext: Uint8Array): Promise<void> {
    if (!route.payloadSecret) throw new ConnectivityError('POLICY_DENIED', 'Anonymous mesh route has no end-to-end payload key');
    const payload = await this.encryptPayload(route.payloadSecret, plaintext);
    const payloadBytes = decodeOpaqueBytes(payload);
    if (route.frames >= this.limits.maxFramesPerRoute || route.bytes + payloadBytes.byteLength > this.limits.maxBytesPerRoute) throw new ConnectivityError('RESOURCE_LIMIT', 'Anonymous mesh route quota exceeded');
    const sequence = route.nextSequence++; route.frames += 1; route.bytes += payloadBytes.byteLength; route.lastActivityAt = this.now();
    const message: MeshDataMessage = { kind: 'mesh.data', version: CONTROL_VERSION, routeId: route.routeId, sequence, payload, expiresAt: new Date(route.expiresAt).toISOString() };
    const waiter = this.waitForAck(route.routeId, sequence);
    // A failed forward tears the route down and rejects the waiter before
    // this call can await it.  Attach a rejection sink up front so that
    // transport failure cannot become an unhandled promise rejection.
    void waiter.catch(() => undefined);
    await this.forwardData(route, message); const accepted = await waiter; if (!accepted) throw new ConnectivityError('DELIVERY_UNCONFIRMED', 'Anonymous mesh destination rejected the frame');
  }
  private async decryptPayload(secret: string, encoded: string): Promise<Uint8Array> {
    const combined = decodeOpaqueBytes(encoded); if (combined.byteLength < 12 + 16) throw new ConnectivityError('POLICY_DENIED', 'Anonymous mesh payload is too short');
    const nonce = new Uint8Array(combined.subarray(0, 12)); const cipher = new Uint8Array(combined.subarray(12));
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce as unknown as ArrayBuffer }, await this.payloadKey(secret), cipher as unknown as ArrayBuffer));
  }

  private async receiveNeighborFrame(frame: OpaqueFrame, session?: TransportSession): Promise<void> {
    let message: MeshRouteMessage | undefined;
    try { message = await verifyControlEnvelope(frame, this.now()); } catch { this.rejectedFrames += 1; return; }
    if (!message || !session) return;
    const incomingHandle = this.source.peerHandleForSession?.(session);
    if (incomingHandle && !this.neighborSessions.has(incomingHandle)) this.neighborSessions.set(incomingHandle, session);
    try {
      switch (message.kind) {
        case 'mesh.request': await this.handleRequest(message, session); break;
        case 'mesh.reply': await this.handleReply(message, session); break;
        case 'mesh.data': await this.handleData(message, session); break;
        case 'mesh.ack': await this.handleAck(message, session); break;
        case 'mesh.close': await this.handleClose(message, session); break;
        case 'mesh.error': await this.handleError(message, session); break;
      }
    } catch { this.rejectedFrames += 1; }
  }

  private async handleRequest(message: MeshRequestMessage, incoming: TransportSession): Promise<void> {
    const at = this.now(); if (Date.parse(message.expiresAt) <= at || message.hopsLeft < 0 || message.hopsLeft > this.limits.maxHops || !validToken(message.destinationToken)) { this.rejectedRequests += 1; return; }
    this.sweep();
    const localSecret = await this.localSecretForPublicToken(message.destinationToken);
    const previous = this.requestStates.get(message.requestId);
    if (this.seenRequests.has(message.requestId)) {
      // A destination may receive the same bounded request over two distinct
      // anonymous branches.  Preserve relay replay suppression, but allow at
      // most two endpoint replies so the source has one bounded alternate
      // circuit.  The incoming session is the only local distinction needed;
      // no path or social identity is retained.
      if (localSecret && previous && previous.incoming && !sameSession(previous.incoming, incoming) && previous.localReplies < 2 && this.canAttachRoute(incoming) && this.routes.size < this.limits.maxActiveRoutes) {
        previous.localReplies += 1;
        const routeId = randomId('mesh-circuit'); const route: MeshRouteState = { routeId, destinationToken: message.destinationToken, payloadSecret: localSecret, expiresAt: Math.min(Date.parse(message.expiresAt), at + this.limits.routeTtlMs), source: false, reverse: incoming, nextSequence: 0, seenSequences: new Map(), frames: 0, bytes: 0, lastActivityAt: at };
        this.routes.set(routeId, route); this.retainSession(incoming); await this.sendControl(incoming, await this.controlEnvelope({ kind: 'mesh.reply', version: CONTROL_VERSION, requestId: message.requestId, routeId, destinationToken: message.destinationToken, expiresAt: new Date(route.expiresAt).toISOString() })); return;
      }
      this.replayedFrames += 1; return;
    }
    if (this.seenRequests.size >= this.limits.maxSeenRequests) { this.rejectedRequests += 1; return; }
    this.seenRequests.set(message.requestId, Math.min(Date.parse(message.expiresAt), at + this.limits.routeTtlMs));
    if (this.routes.size >= this.limits.maxActiveRoutes) { this.rejectedRequests += 1; return; }
    const state: MeshRequestState = { requestId: message.requestId, destinationToken: message.destinationToken, expiresAt: Date.parse(message.expiresAt), incoming, forwarded: false, localReplies: 0 };
    this.requestStates.set(message.requestId, state);
    if (localSecret) {
      if (!this.canAttachRoute(incoming)) { this.rejectedRequests += 1; return; }
      state.localReplies = 1;
      const routeId = randomId('mesh-circuit'); const route: MeshRouteState = { routeId, destinationToken: message.destinationToken, payloadSecret: localSecret, expiresAt: Math.min(Date.parse(message.expiresAt), at + this.limits.routeTtlMs), source: false, reverse: incoming, nextSequence: 0, seenSequences: new Map(), frames: 0, bytes: 0, lastActivityAt: at };
      this.routes.set(routeId, route); this.retainSession(incoming); await this.sendControl(incoming, await this.controlEnvelope({ kind: 'mesh.reply', version: CONTROL_VERSION, requestId: message.requestId, routeId, destinationToken: message.destinationToken, expiresAt: new Date(route.expiresAt).toISOString() })); return;
    }
    if (message.hopsLeft === 0) return;
    const neighbors = this.source.listNeighbors(MAX_DIAGNOSTIC_NEIGHBORS).slice(0, Math.min(message.fanout, this.effectiveFanout()));
    const outbound: MeshRouteMessage = { ...message, hopsLeft: message.hopsLeft - 1 };
    for (const neighbor of neighbors) {
      if (incomingHandleFor(this.source, incoming) === neighbor.handle) continue;
      try {
        const next = await this.openNeighborSession(neighbor.handle); if (sameSession(next, incoming)) continue;
        state.forwarded = true; await this.sendControl(next, await this.controlEnvelope(outbound));
      } catch { /* route discovery is opportunistic and bounded */ }
    }
  }

  private async handleReply(message: MeshReplyMessage, incoming: TransportSession): Promise<void> {
    const at = this.now(); if (Date.parse(message.expiresAt) <= at || !validToken(message.destinationToken)) return;
    const waiter = this.discoveryWaiters.get(message.requestId);
    if (waiter) {
      if (waiter.token !== message.destinationToken) return;
      if (this.routes.has(message.routeId)) { this.replayedFrames += 1; return; }
      if (!this.canAttachRoute(incoming)) return;
      const route: MeshRouteState = { routeId: message.routeId, destinationToken: message.destinationToken, payloadSecret: waiter.secret, expiresAt: Math.min(Date.parse(message.expiresAt), at + this.limits.routeTtlMs), source: true, forward: incoming, nextSequence: 0, seenSequences: new Map(), frames: 0, bytes: 0, lastActivityAt: at };
      if (this.routes.size >= this.limits.maxActiveRoutes) return;
      this.routes.set(message.routeId, route); this.retainSession(incoming); const candidates = this.routeCandidates.get(message.destinationToken) ?? []; if (!candidates.includes(message.routeId)) { candidates.push(message.routeId); while (candidates.length > 2) { const stale = candidates.shift(); if (stale) void this.teardownRoute(stale); } this.routeCandidates.set(message.destinationToken, candidates); } if (!waiter.resolved) { waiter.resolved = true; waiter.resolve(message.routeId); } return;
    }
    const request = this.requestStates.get(message.requestId); if (!request || !request.incoming) return;
    if (this.routes.has(message.routeId)) { this.replayedFrames += 1; return; }
    if (!this.canAttachRoute(incoming) || !this.canAttachRoute(request.incoming)) return;
    if (this.routes.size >= this.limits.maxActiveRoutes) return;
    const route: MeshRouteState = { routeId: message.routeId, destinationToken: message.destinationToken, expiresAt: Math.min(Date.parse(message.expiresAt), at + this.limits.routeTtlMs), source: false, forward: incoming, reverse: request.incoming, nextSequence: 0, seenSequences: new Map(), frames: 0, bytes: 0, lastActivityAt: at };
    this.routes.set(message.routeId, route); this.retainSession(incoming); this.retainSession(request.incoming);
    await this.sendControl(request.incoming, await this.controlEnvelope(message));
  }

  private async handleData(message: MeshDataMessage, incoming: TransportSession): Promise<void> {
    const route = this.routes.get(message.routeId); if (!route || route.expiresAt <= this.now()) { await this.tryError(incoming, message.routeId, 'EXPIRED'); return; }
    if (route.seenSequences.has(message.sequence)) { this.replayedFrames += 1; const cached = route.seenSequences.get(message.sequence); if (cached !== undefined) await this.sendAck(route, message.sequence, true, incoming); return; }
    if (message.sequence < 0 || message.payload.length > this.limits.maxFrameBytes * 2) { this.rejectedFrames += 1; await this.tryError(incoming, message.routeId, 'RESOURCE_LIMIT'); return; }
    let payloadBytes: Uint8Array;
    try { payloadBytes = decodeOpaqueBytes(message.payload); } catch { this.rejectedFrames += 1; await this.tryError(incoming, message.routeId, 'REJECTED'); return; }
    if (route.frames >= this.limits.maxFramesPerRoute || route.bytes + payloadBytes.byteLength > this.limits.maxBytesPerRoute) { this.rejectedFrames += 1; await this.tryError(incoming, message.routeId, 'RESOURCE_LIMIT'); return; }
    route.seenSequences.set(message.sequence, this.now()); while (route.seenSequences.size > this.limits.maxFramesPerRoute) route.seenSequences.delete(route.seenSequences.keys().next().value!);
    route.frames += 1; route.bytes += payloadBytes.byteLength; route.lastActivityAt = this.now(); this.bytesRelayed += payloadBytes.byteLength;
    if (route.forward && sameSession(incoming, route.reverse)) {
      try { await this.sendControl(route.forward, await this.controlEnvelope(message)); this.forwardedFrames += 1; }
      catch { this.routeFailures += 1; await this.tryError(route.reverse, route.routeId, 'UNAVAILABLE'); }
      return;
    }
    if (!route.forward) {
      let frame: OpaqueFrame;
      try { if (!route.payloadSecret) throw new ConnectivityError('POLICY_DENIED', 'Anonymous mesh destination has no payload key'); const bytes = await this.decryptPayload(route.payloadSecret, message.payload); if (bytes.byteLength > this.limits.maxFrameBytes) throw new ConnectivityError('RESOURCE_LIMIT', 'Anonymous mesh payload exceeds bound'); frame = decodeOpaqueFrame(bytes); }
      catch { this.rejectedFrames += 1; await this.sendAck(route, message.sequence, false, incoming); return; }
      try { for (const listener of this.listeners) await listener(frame, route.reverse); await this.sendAck(route, message.sequence, true, incoming); }
      catch { await this.sendAck(route, message.sequence, false, incoming); }
      return;
    }
    this.rejectedFrames += 1;
  }

  private async handleAck(message: MeshAckMessage, incoming: TransportSession): Promise<void> {
    const route = this.routes.get(message.routeId); if (!route) return; route.lastActivityAt = this.now();
    if (route.source && route.forward && sameSession(incoming, route.forward)) { const key = `${message.routeId}:${message.sequence}`; const waiter = this.ackWaiters.get(key); if (waiter) { clearTimeout(waiter.timer); this.ackWaiters.delete(key); waiter.resolve(message.accepted); } return; }
    if (route.reverse && route.forward && sameSession(incoming, route.forward)) { await this.sendControl(route.reverse, await this.controlEnvelope(message)); return; }
    if (!route.forward && route.reverse && sameSession(incoming, route.reverse)) return;
  }

  private async handleClose(message: MeshCloseMessage, incoming: TransportSession): Promise<void> { const route = this.routes.get(message.routeId); if (!route) return; if (route.reverse && sameSession(incoming, route.forward)) await this.sendControl(route.reverse, await this.controlEnvelope(message)); else if (route.forward && sameSession(incoming, route.reverse)) await this.sendControl(route.forward, await this.controlEnvelope(message)); await this.teardownRoute(message.routeId); }
  private async handleError(message: MeshErrorMessage, incoming: TransportSession): Promise<void> { const route = this.routes.get(message.routeId); if (!route) return; this.routeFailures += 1; if (route.source && route.forward && sameSession(incoming, route.forward)) { const keyPrefix = `${message.routeId}:`; for (const [key, waiter] of this.ackWaiters) if (key.startsWith(keyPrefix)) { clearTimeout(waiter.timer); this.ackWaiters.delete(key); waiter.reject(new ConnectivityError('TRANSPORT_UNAVAILABLE', `Anonymous mesh route failed: ${message.code}`)); } await this.teardownRoute(message.routeId); } else if (route.reverse && sameSession(incoming, route.forward)) await this.sendControl(route.reverse, await this.controlEnvelope(message)); }

  private async forwardData(route: MeshRouteState, message: MeshDataMessage): Promise<void> { if (!route.forward) throw new ConnectivityError('TRANSPORT_UNAVAILABLE', 'Anonymous mesh route has no next hop'); await this.sendControl(route.forward, await this.controlEnvelope(message)); this.forwardedFrames += 1; }
  private canAttachRoute(session: TransportSession): boolean {
    let count = 0; for (const route of this.routes.values()) if (sameSession(route.forward, session) || sameSession(route.reverse, session)) count += 1;
    return count < this.limits.maxRoutesPerNeighbor;
  }
  private async sendAck(route: MeshRouteState, sequence: number, accepted: boolean, incoming: TransportSession): Promise<void> { const ack: MeshAckMessage = { kind: 'mesh.ack', version: CONTROL_VERSION, routeId: route.routeId, sequence, accepted, expiresAt: new Date(route.expiresAt).toISOString() }; if (route.reverse && sameSession(incoming, route.reverse)) { await this.sendControl(route.reverse, await this.controlEnvelope(ack)); } else if (route.forward && sameSession(incoming, route.forward) && route.reverse) { await this.sendControl(route.reverse, await this.controlEnvelope(ack)); } }
  private async tryError(session: TransportSession | undefined, routeId: string, code: MeshErrorMessage['code']): Promise<void> { if (!session) return; try { await this.sendControl(session, await this.controlEnvelope({ kind: 'mesh.error', version: CONTROL_VERSION, routeId, code, expiresAt: new Date(this.now() + this.limits.routeTtlMs).toISOString() })); } catch { /* peer failure is already handled by route expiry */ } }

  private waitForAck(routeId: string, sequence: number): Promise<boolean> {
    const key = `${routeId}:${sequence}`;
    return new Promise<boolean>((resolve, reject) => { const timer = setTimeout(() => { this.ackWaiters.delete(key); reject(new ConnectivityError('TIMEOUT', 'Anonymous mesh destination acknowledgement timed out')); }, this.limits.ackTimeoutMs); (timer as { unref?: () => void }).unref?.(); this.ackWaiters.set(key, { resolve, reject, timer }); });
  }

  private async teardownRoute(routeId: string): Promise<void> {
    const route = this.routes.get(routeId); if (!route) return; this.routes.delete(routeId);
    const sessions = [route.forward, route.reverse].filter((session): session is TransportSession => !!session);
    for (const session of sessions) await this.releaseSession(session);
    for (const [token, candidates] of this.routeCandidates) { const next = candidates.filter(candidate => candidate !== routeId); if (next.length) this.routeCandidates.set(token, next); else this.routeCandidates.delete(token); }
    for (const [key, waiter] of this.ackWaiters) if (key.startsWith(`${routeId}:`)) { clearTimeout(waiter.timer); this.ackWaiters.delete(key); waiter.reject(new ConnectivityError('TRANSPORT_UNAVAILABLE', 'Anonymous mesh route was torn down')); }
  }

  private retainSession(session: TransportSession): void { this.sessions.set(session.id, session); this.sessionReferences.set(session.id, (this.sessionReferences.get(session.id) ?? 0) + 1); }
  private async releaseSession(session: TransportSession): Promise<void> {
    const next = (this.sessionReferences.get(session.id) ?? 1) - 1;
    if (next > 0) { this.sessionReferences.set(session.id, next); return; }
    this.sessionReferences.delete(session.id); this.sessions.delete(session.id);
    for (const [handle, candidate] of this.neighborSessions) if (candidate.id === session.id) this.neighborSessions.delete(handle);
    await this.source.closeNeighborSession(session).catch(() => undefined);
  }

  private sweep(): void {
    const at = this.now();
    for (const [id, expiresAt] of this.seenRequests) if (expiresAt <= at) this.seenRequests.delete(id);
    for (const [id, state] of this.requestStates) if (state.expiresAt <= at) this.requestStates.delete(id);
    for (const [id, waiter] of this.discoveryWaiters) if (waiter.expiresAt <= at) { if (!waiter.resolved) waiter.reject(new ConnectivityError('TIMEOUT', 'Anonymous mesh discovery expired')); this.discoveryWaiters.delete(id); }
    for (const route of [...this.routes.values()]) if (route.expiresAt <= at || route.lastActivityAt + this.limits.idleRouteTtlMs <= at) void this.teardownRoute(route.routeId);
  }
}

/** A Fabric-compatible production provider.  It intentionally advertises no
 * DIRECT capability: Fabric must use a bounded anonymous route rather than
 * treating the mesh provider as a live direct session. */
export class AnonymousMultiHopTransportProvider implements TransportProvider {
  readonly id: TransportProviderId;
  readonly type = 'ExternalRadioTransport' as const;
  readonly security = MESH_SECURITY;
  readonly mtu = 4 * 1024;
  private availability: TransportAvailability = 'UNKNOWN';
  private checkedAt: string;
  private running = false;
  private healthReason?: string;
  readonly router: AnonymousMeshRouter;
  constructor(router: AnonymousMeshRouter, _providerId?: string);
  constructor(source: AnonymousNeighborSessionSource, options?: AnonymousMeshRouterOptions);
  constructor(options: AnonymousMultiHopTransportProviderOptions);
  constructor(routerOrSource: AnonymousMeshRouter | AnonymousNeighborSessionSource | AnonymousMultiHopTransportProviderOptions, optionsOrProvider?: AnonymousMeshRouterOptions | string) {
    const configuredSource = 'source' in routerOrSource && !(routerOrSource instanceof AnonymousMeshRouter) ? routerOrSource.source : undefined;
    const configuredOptions = configuredSource ? routerOrSource as AnonymousMultiHopTransportProviderOptions : undefined;
    this.router = routerOrSource instanceof AnonymousMeshRouter ? routerOrSource : new AnonymousMeshRouter(configuredSource ?? routerOrSource as AnonymousNeighborSessionSource, configuredOptions ?? (typeof optionsOrProvider === 'string' ? { providerId: optionsOrProvider } : optionsOrProvider));
    this.id = this.router.providerId; this.checkedAt = nowIso(Date.now);
  }
  capabilities(): readonly TransportCapability[] { return MESH_CAPABILITIES; }
  routeMetadata(): { readonly family: 'mesh'; readonly pathKind: 'LIVE' } { return { family: 'mesh', pathKind: 'LIVE' }; }
  async probe(): Promise<TransportAvailability> { this.availability = 'AVAILABLE'; this.checkedAt = nowIso(Date.now); return this.availability; }
  health(): TransportHealth { return { state: this.availability === 'AVAILABLE' ? 'HEALTHY' : this.availability === 'UNKNOWN' ? 'UNKNOWN' : 'FAILED', availability: this.availability, checkedAt: this.checkedAt, ...(this.healthReason ? { reason: this.healthReason } : {}) }; }
  async start(): Promise<void> { if (this.running) return; await this.probe(); await this.router.start(); this.running = true; }
  async stop(): Promise<void> { if (!this.running) return; await this.router.stop(); this.running = false; this.availability = 'UNKNOWN'; }
  isPeerConnected(destination: string): boolean { return this.router.isPeerConnected(destination); }
  discoverDirectReachability(destination: string, requirement?: DeliveryRequirement): Promise<readonly TransportEndpoint[]> { return this.router.discoverDirectReachability(destination, requirement); }
  openSession(endpoint: TransportEndpoint): Promise<TransportSession> { return this.router.openSession(endpoint); }
  sendOpaqueFrame(session: TransportSession, frame: OpaqueFrame): Promise<void> { return this.router.sendOpaqueFrame(session, frame); }
  receiveOpaqueFrame(handler: (frame: OpaqueFrame, session?: TransportSession) => void | Promise<void>): () => void { return this.router.receiveOpaqueFrame(handler); }
  measureLink(session?: TransportSession): Promise<TransportMetrics> { return this.router.measureLink(session); }
  close(session: TransportSession): Promise<void> { return this.router.close(session); }
  bindOpaqueRendezvous(destination: string, token?: string, options?: { readonly local?: boolean }): string { return this.router.bindOpaqueRendezvous(destination, token, options); }
  registerLocalRendezvous(token: string): void { this.router.registerLocalRendezvous(token); }
  advertiseOpaqueRendezvous(token: string): void { this.router.registerLocalRendezvous(token); }
  unbindOpaqueRendezvous(destination: string): void { this.router.unbindOpaqueRendezvous(destination); }
  diagnostics(): AnonymousMeshDiagnostics { return this.router.diagnostics(); }
}

export interface AnonymousMeshNetworkResourceOptions {
  readonly maxHops?: number;
  readonly maxFanout?: number;
  readonly routeTtlMs?: number;
  readonly maxActiveRoutes?: number;
  readonly maxDiscoveryPerMinute?: number;
}

export interface AnonymousMultiHopTransportProviderOptions extends AnonymousMeshRouterOptions { readonly source: AnonymousNeighborSessionSource; }

/** Opaque rendezvous token generator.  The token is intentionally random and
 * not a hash of an Identity or device identifier. */
export function createAnonymousRendezvousToken(): string {
  const bytes = new Uint8Array(24); crypto.getRandomValues(bytes); return asBase64(bytes);
}

/** Small helper for hosts/tests that want a provider and router as one object. */
export function createAnonymousMultiHopProvider(source: AnonymousNeighborSessionSource, options: AnonymousMeshRouterOptions = {}): AnonymousMultiHopTransportProvider {
  const router = new AnonymousMeshRouter(source, options); return new AnonymousMultiHopTransportProvider(router, options.providerId);
}
