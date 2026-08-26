/**
 * R0P72 Adaptive Route Optimization.
 *
 * This module is deliberately a policy/measurement layer below
 * ConnectivityFabric.  It never opens a transport, handles application
 * plaintext, resolves a route to a person, or grants authorization.  The
 * Fabric supplies provider candidates and records locally observed results;
 * this component only filters, ranks and bounds those observations.
 */

import type {
  DeliveryFailureCode,
  DeliveryProfile,
  DeliveryRequirement,
  HostConnectivitySignals,
  TransportAvailability,
  TransportCostClass,
  TransportEnergyClass,
  TransportEndpoint,
  TransportMetrics,
  TransportProvider,
  TransportProviderId,
  TransportCapability,
  TransportProviderType,
  TransportMTU,
} from './connectivity.js';

export const ADAPTIVE_ROUTE_SCHEMA_VERSION = 1 as const;
export const ADAPTIVE_ROUTE_POLICY_VERSION = 1 as const;

export type RoutePathKind = 'LIVE' | 'EVENTUAL';
export type RouteMeasurementSource = 'ADVERTISED' | 'OBSERVED';
export type RouteOutcome =
  | 'ADVERTISEMENT'
  | 'SESSION_OPEN'
  | 'FORWARDED'
  | 'DESTINATION_CONFIRMED'
  | 'SUCCESS'
  | 'TIMEOUT'
  | 'PROVIDER_FAILURE'
  | 'ROUTE_LOST'
  | 'SECURITY_REJECTED'
  | 'RESOURCE_REJECTED'
  | 'PROVIDER_UNAVAILABLE'
  | 'DESTINATION_UNCONFIRMED';
export type RouteSwitchReason =
  | 'INITIAL_SELECTION'
  | 'PRIMARY_FAILED'
  | 'LOWER_LATENCY'
  | 'BETTER_BULK_SUITABILITY'
  | 'METERED_POLICY'
  | 'RESOURCE_PRESSURE'
  | 'BETTER_CONFIDENCE'
  | 'PROVIDER_UNAVAILABLE'
  | 'NO_ELIGIBLE_ROUTE';
export type RouteConfidenceBand = 'UNKNOWN' | 'LOW' | 'MEDIUM' | 'HIGH';
export type RouteResourceProfile = 'BALANCED' | 'BATTERY_SAVER' | 'HIGH_AVAILABILITY';
export type RouteProviderFamily = 'internet' | 'local' | 'nearby' | 'mesh' | 'dtn' | 'gateway' | 'controlled' | 'other';

export interface RouteResourceState {
  readonly profile?: RouteResourceProfile;
  readonly battery?: HostConnectivitySignals['battery'];
  readonly charging?: boolean | 'UNKNOWN';
  readonly thermal?: HostConnectivitySignals['thermal'];
  readonly metered?: boolean | 'UNKNOWN';
  readonly bandwidthBytesPerSecond?: number;
}

export interface RouteMetricView {
  readonly rttMs?: number;
  readonly lossRatio?: number;
  readonly throughputBytesPerSecond?: number;
  readonly stability?: number;
  readonly signalQuality?: number | 'UNKNOWN';
  readonly mtu?: TransportMTU;
  readonly queuePressure?: number;
  readonly cost?: TransportCostClass;
  readonly energy?: TransportEnergyClass;
  readonly metered?: boolean | 'UNKNOWN';
  readonly hops?: number | 'UNKNOWN';
  readonly observedAt?: number;
}

export interface RouteProviderMetadata {
  /** Stable provider family only; never a peer/social identity. */
  readonly family?: RouteProviderFamily | string;
  /** Opaque provider composition markers used only for loop prevention. */
  readonly ancestry?: readonly string[];
  readonly pathKind?: RoutePathKind;
  readonly advertised?: RouteMetricView;
  readonly supportsProfiles?: readonly DeliveryProfile[];
}

export interface RouteCandidate {
  readonly id: string;
  readonly destination: string;
  readonly providerId: TransportProviderId;
  readonly providerType: TransportProviderType;
  readonly providerFamily: RouteProviderFamily | string;
  readonly pathKind: RoutePathKind;
  readonly liveAvailable: boolean;
  readonly eventualAvailable: boolean;
  readonly supportedProfiles: readonly DeliveryProfile[];
  readonly securityEligible: boolean;
  readonly securityReasons: readonly string[];
  readonly availability: TransportAvailability;
  readonly mtu: TransportMTU;
  readonly metered: boolean | 'UNKNOWN';
  readonly energy: TransportEnergyClass;
  readonly hopCount: number | 'UNKNOWN';
  readonly ancestry: readonly string[];
  readonly advertised?: RouteMetricView;
  readonly metrics?: RouteMetricView;
  /** Provider object is kept private to Fabric callers and omitted from
   * diagnostics/snapshots.  It is optional so controlled candidate tests can
   * construct anonymous candidates without exposing a provider. */
  readonly provider?: TransportProvider;
}

export interface RouteObservationInput {
  readonly destination: string;
  readonly providerId: TransportProviderId;
  readonly profile?: DeliveryProfile;
  readonly source?: RouteMeasurementSource;
  readonly metrics?: Partial<TransportMetrics> & { readonly hops?: number | 'UNKNOWN' };
  readonly outcome?: RouteOutcome;
  readonly failureCode?: DeliveryFailureCode;
  readonly durationMs?: number;
  readonly destinationConfirmed?: boolean;
  readonly timestamp?: number;
}

export interface RouteObservation {
  readonly destination: string;
  readonly providerId: TransportProviderId;
  readonly measured?: RouteMetricView;
  readonly advertised?: RouteMetricView;
  readonly attempts: number;
  readonly successes: number;
  readonly failures: number;
  readonly destinationConfirmations: number;
  readonly forwarded: number;
  readonly lastOutcome?: RouteOutcome;
  readonly lastFailureCode?: DeliveryFailureCode;
  readonly lastObservedAt: number;
  readonly confidence: number;
  readonly confidenceBand: RouteConfidenceBand;
  readonly freshness: number;
}

export interface RouteScore {
  readonly policyVersion: typeof ADAPTIVE_ROUTE_POLICY_VERSION;
  readonly profile: DeliveryProfile;
  readonly value: number;
  readonly confidence: number;
  readonly knownMetrics: readonly string[];
  readonly criteria: Readonly<Record<string, number | undefined>>;
}

export interface RouteEligibility {
  readonly eligible: boolean;
  readonly reasons: readonly string[];
}

export interface RouteSelection {
  readonly destination: string;
  readonly profile: DeliveryProfile;
  readonly primary?: RouteCandidate;
  readonly backups: readonly RouteCandidate[];
  readonly eligible: readonly RouteCandidate[];
  readonly scores: readonly { readonly candidateId: string; readonly score: RouteScore }[];
  readonly confidence: number;
  readonly selectedAt: number;
  readonly reason: RouteSwitchReason;
  readonly switched: boolean;
}

export interface RouteCacheEntry {
  readonly destination: string;
  readonly profile: DeliveryProfile;
  readonly primaryId?: string;
  readonly backupIds: readonly string[];
  readonly confidence: number;
  readonly lastSelectedAt: number;
  readonly expiresAt: number;
}

export interface AdaptiveRouteDiagnostics {
  readonly cacheEntries: number;
  readonly observations: number;
  readonly maxCacheEntries: number;
  readonly maxBackups: number;
  readonly candidateEvaluations: number;
  readonly selectionCount: number;
  readonly routeSwitches: number;
  readonly failovers: number;
  readonly probeCount: number;
  readonly probeWindowCount: number;
  readonly activeProbeCandidates: number;
  readonly cleanupCount: number;
  readonly lastSelectionCostMs?: number;
  readonly resourceProfile: RouteResourceProfile;
}

export interface AdaptiveRouteSnapshot {
  readonly version: typeof ADAPTIVE_ROUTE_SCHEMA_VERSION;
  readonly savedAt: number;
  readonly cache: readonly RouteCacheEntry[];
  readonly observations: readonly RouteObservation[];
}

export interface RouteProbeResult {
  readonly metrics?: Partial<TransportMetrics> & { readonly hops?: number | 'UNKNOWN' };
  readonly outcome?: RouteOutcome;
  readonly destinationConfirmed?: boolean;
}

export interface AdaptiveRouteOptimizerOptions {
  readonly now?: () => number;
  readonly maxCacheEntries?: number;
  readonly maxDestinations?: number;
  readonly maxObservations?: number;
  readonly maxBackups?: number;
  readonly cacheTtlMs?: number;
  readonly confidenceHalfLifeMs?: number;
  readonly hysteresisThreshold?: number;
  readonly maxProbesPerWindow?: number;
  readonly probeWindowMs?: number;
  readonly failureBackoffMs?: number;
  readonly resourceProfile?: RouteResourceProfile;
  readonly resourceState?: RouteResourceState;
  readonly probe?: (candidate: RouteCandidate) => Promise<RouteProbeResult | undefined>;
}

interface MutableObservation {
  destination: string;
  providerId: TransportProviderId;
  measured?: RouteMetricView;
  advertised?: RouteMetricView;
  attempts: number;
  successes: number;
  failures: number;
  destinationConfirmations: number;
  forwarded: number;
  lastOutcome?: RouteOutcome;
  lastFailureCode?: DeliveryFailureCode;
  lastObservedAt: number;
  confidence: number;
  lastProbeAt?: number;
  probeBackoffUntil?: number;
}

interface MutableCacheEntry {
  destination: string;
  profile: DeliveryProfile;
  primaryId?: string;
  backupIds: string[];
  confidence: number;
  lastSelectedAt: number;
  expiresAt: number;
}

const DEFAULT_CACHE_ENTRIES = 256;
const DEFAULT_MAX_DESTINATIONS = 128;
const DEFAULT_MAX_OBSERVATIONS = 512;
const DEFAULT_MAX_BACKUPS = 2;
const DEFAULT_CACHE_TTL_MS = 5 * 60_000;
const DEFAULT_CONFIDENCE_HALF_LIFE_MS = 60_000;
const DEFAULT_HYSTERESIS_THRESHOLD = 0.08;
const DEFAULT_PROBE_WINDOW_MS = 60_000;
const DEFAULT_MAX_PROBES_PER_WINDOW = 8;
const DEFAULT_FAILURE_BACKOFF_MS = 5_000;

/** Profile-specific, named policies.  Criteria are deliberately exposed in
 * RouteScore so tuning is reviewable rather than hidden in one opaque score. */
const PROFILE_WEIGHTS: Readonly<Record<DeliveryProfile, Readonly<Record<string, number>>>> = {
  CONTROL: { live: 0.45, success: 0.35, stability: 0.20 },
  INTERACTIVE: { live: 0.25, latency: 0.32, loss: 0.18, stability: 0.14, signal: 0.06, hops: 0.05 },
  REALTIME: { live: 0.20, latency: 0.30, loss: 0.30, stability: 0.15, throughput: 0.05 },
  BULK: { live: 0.15, throughput: 0.35, loss: 0.15, mtu: 0.15, resource: 0.10, stability: 0.10 },
  EVENTUAL: { live: 0.15, success: 0.45, resource: 0.20, stability: 0.10, hops: 0.10 },
  BACKGROUND: { live: 0.10, success: 0.30, resource: 0.35, loss: 0.10, stability: 0.10, signal: 0.05 },
  BEST_EFFORT: { live: 0.25, success: 0.35, latency: 0.15, loss: 0.15, stability: 0.10 },
};

function asFamily(type: TransportProviderType, metadata?: RouteProviderMetadata): RouteProviderFamily | string {
  if (metadata?.family) return metadata.family;
  switch (type) {
    case 'InternetTransport': return 'internet';
    case 'LocalNetworkTransport': return 'local';
    case 'WiFiDirectTransport':
    case 'BluetoothTransport':
    case 'USBTransport':
    case 'ExternalRadioTransport': return 'nearby';
    case 'DelayTolerantTransport': return 'dtn';
    case 'GatewayMeshTransport': return 'gateway';
    case 'ControlledTransport': return 'controlled';
    default: return 'other';
  }
}

function profileSupports(provider: TransportProvider, profile: DeliveryProfile, pathKind: RoutePathKind): boolean {
  if (pathKind === 'EVENTUAL') return profile === 'EVENTUAL' || profile === 'BACKGROUND' || profile === 'BEST_EFFORT' || profile === 'INTERACTIVE';
  let capabilities: Set<TransportCapability>;
  try { capabilities = new Set(provider.capabilities()); } catch { return false; }
  if (profile === 'CONTROL') return capabilities.has('CONTROL');
  if (profile === 'INTERACTIVE') return capabilities.has('INTERACTIVE');
  if (profile === 'REALTIME') return capabilities.has('REALTIME');
  if (profile === 'BULK') return capabilities.has('BULK') || capabilities.has('STREAM');
  if (profile === 'BACKGROUND') return capabilities.has('BACKGROUND') || capabilities.has('CONTROL') || capabilities.has('INTERACTIVE');
  return true;
}

function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }

function validMetrics(input: Partial<TransportMetrics> & { readonly hops?: number | 'UNKNOWN' }): boolean {
  if (input.rttMs !== undefined && (!finite(input.rttMs) || input.rttMs < 0 || input.rttMs > 86_400_000)) return false;
  if (input.lossRatio !== undefined && (!finite(input.lossRatio) || input.lossRatio < 0 || input.lossRatio > 1)) return false;
  if (input.throughputBytesPerSecond !== undefined && (!finite(input.throughputBytesPerSecond) || input.throughputBytesPerSecond < 0 || input.throughputBytesPerSecond > Number.MAX_SAFE_INTEGER)) return false;
  if (input.stability !== undefined && (!finite(input.stability) || input.stability < 0 || input.stability > 1)) return false;
  if (input.signalQuality !== undefined && input.signalQuality !== 'UNKNOWN' && (!finite(input.signalQuality) || input.signalQuality < 0 || input.signalQuality > 1)) return false;
  if (typeof input.mtu === 'number' && (!Number.isSafeInteger(input.mtu) || input.mtu < 256 || input.mtu > 2 ** 31)) return false;
  if (input.queuePressure !== undefined && (!finite(input.queuePressure) || input.queuePressure < 0 || input.queuePressure > 1)) return false;
  if (input.hops !== undefined && input.hops !== 'UNKNOWN' && (!Number.isSafeInteger(input.hops) || input.hops < 0 || input.hops > 64)) return false;
  if (input.observedAt !== undefined && !((finite(input.observedAt) && input.observedAt >= 0) || (typeof input.observedAt === 'string' && Number.isFinite(Date.parse(input.observedAt))))) return false;
  return true;
}

function boundedRouteIdentifier(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 256 && /^[A-Za-z0-9:_-]+$/.test(value); }
function boundedCounter(value: unknown): number | undefined { return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : undefined; }
function safeImportedMetrics(value: unknown): RouteMetricView | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !validMetrics(value as Partial<TransportMetrics> & { readonly hops?: number | 'UNKNOWN' })) return undefined;
  return value as RouteMetricView;
}
function isRouteOutcome(value: unknown): value is RouteOutcome {
  return value === 'ADVERTISEMENT' || value === 'SESSION_OPEN' || value === 'FORWARDED' || value === 'DESTINATION_CONFIRMED' || value === 'SUCCESS' || value === 'TIMEOUT' || value === 'PROVIDER_FAILURE' || value === 'ROUTE_LOST' || value === 'SECURITY_REJECTED' || value === 'RESOURCE_REJECTED' || value === 'PROVIDER_UNAVAILABLE' || value === 'DESTINATION_UNCONFIRMED';
}

function metricView(input: Partial<TransportMetrics> & { readonly hops?: number | 'UNKNOWN' }, observedAt: number): RouteMetricView {
  return {
    ...(input.rttMs === undefined ? {} : { rttMs: input.rttMs }),
    ...(input.lossRatio === undefined ? {} : { lossRatio: input.lossRatio }),
    ...(input.throughputBytesPerSecond === undefined ? {} : { throughputBytesPerSecond: input.throughputBytesPerSecond }),
    ...(input.stability === undefined ? {} : { stability: input.stability }),
    ...(input.signalQuality === undefined ? {} : { signalQuality: input.signalQuality }),
    ...(input.mtu === undefined ? {} : { mtu: input.mtu }),
    ...(input.queuePressure === undefined ? {} : { queuePressure: input.queuePressure }),
    ...(input.cost === undefined ? {} : { cost: input.cost }),
    ...(input.energy === undefined ? {} : { energy: input.energy }),
    ...(input.metered === undefined ? {} : { metered: input.metered }),
    ...(input.hops === undefined ? {} : { hops: input.hops }),
    observedAt,
  };
}

function familyName(value: string): string { return value.trim().toLowerCase(); }
function isDeliveryProfile(value: string): value is DeliveryProfile { return ['CONTROL', 'INTERACTIVE', 'REALTIME', 'EVENTUAL', 'BULK', 'BACKGROUND', 'BEST_EFFORT'].includes(value); }

function candidateKey(destination: string, providerId: TransportProviderId): string { return `${destination}\u0000${providerId}`; }
function selectionKey(destination: string, profile: DeliveryProfile): string { return `${destination}\u0000${profile}`; }

function confidenceBand(value: number): RouteConfidenceBand {
  if (value >= 0.75) return 'HIGH';
  if (value >= 0.45) return 'MEDIUM';
  if (value > 0) return 'LOW';
  return 'UNKNOWN';
}

function pathKindFor(provider: TransportProvider, metadata?: RouteProviderMetadata): RoutePathKind {
  return metadata?.pathKind ?? (provider.queueOpaqueDelivery ? 'EVENTUAL' : 'LIVE');
}

function providerMetadata(provider: TransportProvider): RouteProviderMetadata | undefined {
  const value = provider as unknown as { routeMetadata?: () => RouteProviderMetadata; routeFamily?: RouteProviderFamily | string; routeAncestry?: readonly string[] };
  if (typeof value.routeMetadata === 'function') { try { return value.routeMetadata(); } catch { return undefined; } }
  if (value.routeFamily || value.routeAncestry) return { family: value.routeFamily, ancestry: value.routeAncestry };
  return undefined;
}

function safeProviderCapabilities(provider: TransportProvider): readonly TransportCapability[] {
  try { return provider.capabilities(); } catch { return []; }
}

function safeAdvertisedMetrics(value: RouteMetricView | undefined): RouteMetricView | undefined {
  return value && validMetrics(value as unknown as Partial<TransportMetrics> & { readonly hops?: number | 'UNKNOWN' }) ? value : undefined;
}

/**
 * Deterministic adaptive route policy.  It owns only bounded anonymous route
 * state; the provider object stays with Fabric and is never serialized.
 */
export class AdaptiveRouteOptimizer {
  private readonly now: () => number;
  private readonly maxCacheEntries: number;
  private readonly maxDestinations: number;
  private readonly maxObservations: number;
  private readonly maxBackups: number;
  private readonly cacheTtlMs: number;
  private readonly confidenceHalfLifeMs: number;
  private readonly hysteresisThreshold: number;
  private readonly probeWindowMs: number;
  private readonly maxProbesPerWindow: number;
  private readonly failureBackoffMs: number;
  private resourceProfile: RouteResourceProfile;
  private resourceState: RouteResourceState;
  private readonly cache = new Map<string, MutableCacheEntry>();
  private readonly observations = new Map<string, MutableObservation>();
  private readonly probeWindow: number[] = [];
  private readonly probes = new Map<string, number>();
  private totalProbeCount = 0;
  private candidateEvaluations = 0;
  private selectionCount = 0;
  private routeSwitches = 0;
  private failovers = 0;
  private cleanupCount = 0;
  private probeEpoch = 0;
  private lastSelectionCostMs?: number;

  constructor(private readonly options: AdaptiveRouteOptimizerOptions = {}) {
    this.now = options.now ?? Date.now;
    this.maxCacheEntries = Math.max(1, Math.min(4_096, options.maxCacheEntries ?? DEFAULT_CACHE_ENTRIES));
    this.maxDestinations = Math.max(1, Math.min(this.maxCacheEntries, options.maxDestinations ?? DEFAULT_MAX_DESTINATIONS));
    this.maxObservations = Math.max(1, Math.min(16_384, options.maxObservations ?? DEFAULT_MAX_OBSERVATIONS));
    this.maxBackups = Math.max(0, Math.min(8, options.maxBackups ?? DEFAULT_MAX_BACKUPS));
    this.cacheTtlMs = Math.max(1, Math.min(24 * 60 * 60_000, options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS));
    this.confidenceHalfLifeMs = Math.max(1, Math.min(24 * 60 * 60_000, options.confidenceHalfLifeMs ?? DEFAULT_CONFIDENCE_HALF_LIFE_MS));
    this.hysteresisThreshold = Math.max(0, Math.min(1, options.hysteresisThreshold ?? DEFAULT_HYSTERESIS_THRESHOLD));
    this.probeWindowMs = Math.max(1_000, Math.min(60 * 60_000, options.probeWindowMs ?? DEFAULT_PROBE_WINDOW_MS));
    this.maxProbesPerWindow = Math.max(1, Math.min(1_024, options.maxProbesPerWindow ?? DEFAULT_MAX_PROBES_PER_WINDOW));
    this.failureBackoffMs = Math.max(1_000, Math.min(60 * 60_000, options.failureBackoffMs ?? DEFAULT_FAILURE_BACKOFF_MS));
    this.resourceProfile = options.resourceProfile ?? 'BALANCED';
    this.resourceState = { ...(options.resourceState ?? {}), profile: options.resourceState?.profile ?? this.resourceProfile };
  }

  get profile(): RouteResourceProfile { return this.resourceProfile; }
  setResourceProfile(profile: RouteResourceProfile): void { this.resourceProfile = profile; this.resourceState = { ...this.resourceState, profile }; }
  updateResourceState(state: RouteResourceState): void { this.resourceState = { ...this.resourceState, ...state, profile: state.profile ?? this.resourceProfile }; if (state.profile) this.resourceProfile = state.profile; }
  resourceSnapshot(): RouteResourceState { return { ...this.resourceState }; }

  /** Convert a provider's coarse capabilities into an anonymous candidate. */
  candidateForProvider(provider: TransportProvider, destination: string, requirement: DeliveryRequirement): RouteCandidate {
    const metadata = providerMetadata(provider);
    const pathKind = pathKindFor(provider, metadata);
    const capabilities = new Set(safeProviderCapabilities(provider));
    let health: ReturnType<TransportProvider['health']>;
    try { health = provider.health(); } catch { health = { state: 'FAILED', availability: 'UNAVAILABLE', checkedAt: new Date(this.now()).toISOString(), reason: 'provider health query failed' }; }
    const providerFamily = asFamily(provider.type, metadata);
    const ancestry = [...(metadata?.ancestry ?? [])]
      .filter(value => typeof value === 'string')
      .slice(0, 8)
      .map(value => familyName(value.slice(0, 64)));
    const repeatedFamily = [providerFamily, ...ancestry].map(value => familyName(String(value))).filter((value, index, values) => values.indexOf(value) !== index);
    const supportedProfiles = metadata?.supportsProfiles ?? (['CONTROL', 'INTERACTIVE', 'REALTIME', 'BULK', 'EVENTUAL', 'BACKGROUND', 'BEST_EFFORT'] as readonly DeliveryProfile[]).filter(profile => profileSupports(provider, profile, pathKind));
    const reasons: string[] = [];
    if (!provider.security.opaqueOnly || !provider.security.e2eRequired || provider.security.canDecrypt || provider.security.canAuthorize) reasons.push('provider security boundary is not opaque E2E');
    // Availability and delivery-profile/resource checks are evaluated again
    // by eligibility() so a candidate can safely be reused after a policy or
    // host-resource change. securityReasons contains only static hard-fail
    // properties of the provider/path composition.
    if (ancestry.includes('')) reasons.push('invalid provider ancestry');
    if (repeatedFamily.length || (providerFamily === 'gateway' && ancestry.includes('dtn')) || (providerFamily === 'dtn' && ancestry.includes('gateway'))) reasons.push('recursive provider composition');
    const advertised = safeAdvertisedMetrics(metadata?.advertised);
    return {
      id: candidateKey(destination, provider.id), destination, providerId: provider.id, providerType: provider.type, providerFamily,
      pathKind, liveAvailable: pathKind === 'LIVE' && (health.availability === 'AVAILABLE' || health.availability === 'DEGRADED'), eventualAvailable: pathKind === 'EVENTUAL' && (health.availability === 'AVAILABLE' || health.availability === 'DEGRADED'),
      supportedProfiles, securityEligible: reasons.length === 0, securityReasons: reasons, availability: health.availability,
      mtu: provider.mtu, metered: capabilities.has('METERED') ? true : (advertised?.metered ?? false), energy: capabilities.has('LOW_BANDWIDTH') ? 'LOW' : (advertised?.energy ?? 'UNKNOWN'), hopCount: advertised?.hops ?? 'UNKNOWN', ancestry, advertised, provider,
    };
  }

  /** Public alias used by diagnostics/tests. */
  createCandidate(provider: TransportProvider, destination: string, requirement: DeliveryRequirement): RouteCandidate { return this.candidateForProvider(provider, destination, requirement); }

  eligibility(candidate: RouteCandidate, requirement: DeliveryRequirement): RouteEligibility {
    const reasons = [...candidate.securityReasons];
    if (!candidate.securityEligible && !reasons.length) reasons.push('candidate failed hard security eligibility');
    let capabilities: Set<TransportCapability> | undefined;
    if (candidate.provider) {
      try { capabilities = new Set(candidate.provider.capabilities()); }
      catch { reasons.push('provider capability query failed'); }
    }
    if (candidate.availability !== 'AVAILABLE' && candidate.availability !== 'DEGRADED') reasons.push('provider unavailable');
    if (requirement.requireDirect && capabilities && !capabilities.has('DIRECT')) reasons.push('direct route required');
    if (candidate.metered === true && !requirement.allowMetered) reasons.push('metered route denied by delivery policy');
    if (requirement.allowHighEnergy === false && candidate.energy === 'HIGH') reasons.push('high-energy route denied by delivery policy');
    if (!candidate.supportedProfiles.includes(requirement.profile) && !(candidate.pathKind === 'EVENTUAL' && requirement.profile === 'INTERACTIVE' && requirement.allowDelayTolerant)) reasons.push(`profile ${requirement.profile} unsupported`);
    const family = familyName(String(candidate.providerFamily));
    const ancestry = candidate.ancestry.map(familyName);
    if (ancestry.filter(value => value === family).length > 0 || (family === 'gateway' && ancestry.includes('dtn')) || (family === 'dtn' && ancestry.includes('gateway'))) reasons.push('recursive provider composition');
    if (requirement.profile === 'REALTIME' && candidate.pathKind !== 'LIVE') reasons.push('eventual path is not realtime capable');
    if (candidate.pathKind === 'EVENTUAL' && requirement.profile === 'INTERACTIVE' && !requirement.allowDelayTolerant) reasons.push('interactive policy does not permit delayed acceptance');
    if (candidate.pathKind === 'LIVE' && !candidate.liveAvailable) reasons.push('live route unavailable');
    if (candidate.pathKind === 'EVENTUAL' && !candidate.eventualAvailable) reasons.push('eventual route unavailable');
    // Resource policy is dynamic host state, not an immutable provider
    // security property. Re-evaluate it here so a candidate can be reused
    // safely after charging/thermal/profile changes.
    if (this.resourceProfile === 'BATTERY_SAVER' && requirement.profile === 'BACKGROUND' && candidate.energy === 'HIGH') reasons.push('background high-energy route suppressed');
    return { eligible: reasons.length === 0, reasons };
  }

  eligibleCandidates(candidates: readonly RouteCandidate[], requirement: DeliveryRequirement): readonly RouteCandidate[] {
    return candidates.filter(candidate => this.eligibility(candidate, requirement).eligible);
  }

  /** Rank candidates without discovery or network probing. */
  rankCandidates(candidates: readonly RouteCandidate[], requirement: DeliveryRequirement): readonly RouteCandidate[] {
    const started = this.now();
    const eligible = this.eligibleCandidates(candidates, requirement);
    this.candidateEvaluations += candidates.length;
    const order = new Map(candidates.map((candidate, index) => [candidate.id, index]));
    const ranked = [...eligible].sort((left, right) => {
      const a = this.scoreCandidate(left, requirement); const b = this.scoreCandidate(right, requirement);
      const difference = b.value - a.value;
      if (Math.abs(difference) > 1e-9) return difference;
      return (order.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(right.id) ?? Number.MAX_SAFE_INTEGER) || left.providerId.localeCompare(right.providerId);
    });
    this.lastSelectionCostMs = Math.max(0, this.now() - started);
    return ranked;
  }

  score(candidate: RouteCandidate, requirement: DeliveryRequirement): RouteScore { return this.scoreCandidate(candidate, requirement); }

  select(destination: string, requirement: DeliveryRequirement, candidates: readonly RouteCandidate[]): RouteSelection {
    const started = this.now(); this.sweep();
    const eligible = this.eligibleCandidates(candidates, requirement); this.candidateEvaluations += candidates.length;
    const order = new Map(candidates.map((candidate, index) => [candidate.id, index]));
    const ranked = [...eligible].sort((left, right) => { const a = this.scoreCandidate(left, requirement); const b = this.scoreCandidate(right, requirement); const difference = b.value - a.value; return Math.abs(difference) > 1e-9 ? difference : (order.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(right.id) ?? Number.MAX_SAFE_INTEGER) || left.providerId.localeCompare(right.providerId); });
    const scores = ranked.map(candidate => ({ candidateId: candidate.id, score: this.scoreCandidate(candidate, requirement) }));
    const key = selectionKey(destination, requirement.profile); const previous = this.cache.get(key);
    let primary = ranked[0]; let reason: RouteSwitchReason = primary ? 'INITIAL_SELECTION' : 'NO_ELIGIBLE_ROUTE'; let switched = false;
    const previousCandidate = previous?.primaryId ? candidates.find(value => value.id === previous.primaryId) : undefined;
    if (previousCandidate && this.eligibility(previousCandidate, requirement).eligible) {
      const previousScore = this.scoreCandidate(previousCandidate, requirement); const bestScore = primary ? this.scoreCandidate(primary, requirement) : undefined;
      const previousObservation = this.observations.get(candidateKey(destination, previousCandidate.providerId));
      const failed = previousObservation?.lastOutcome === 'TIMEOUT' || previousObservation?.lastOutcome === 'PROVIDER_FAILURE' || previousObservation?.lastOutcome === 'ROUTE_LOST' || previousObservation?.lastOutcome === 'PROVIDER_UNAVAILABLE';
      const materiallyBetter = !!bestScore && bestScore.value - previousScore.value > this.hysteresisThreshold;
      if (!failed && (!primary || !materiallyBetter)) { primary = previousCandidate; reason = 'BETTER_CONFIDENCE'; }
      else if (failed && primary?.id !== previousCandidate.id) { reason = 'PRIMARY_FAILED'; this.failovers += 1; }
      else if (primary && primary.id !== previousCandidate.id) { reason = this.reasonForSwitch(previousScore, bestScore!); }
    }
    if (previous?.primaryId !== primary?.id && primary) { switched = true; this.routeSwitches += 1; }
    const backups = ranked.filter(candidate => candidate.id !== primary?.id).slice(0, this.maxBackups);
    const confidence = primary ? this.scoreCandidate(primary, requirement).confidence : 0;
    const entry: MutableCacheEntry = { destination, profile: requirement.profile, primaryId: primary?.id, backupIds: backups.map(value => value.id), confidence, lastSelectedAt: this.now(), expiresAt: this.now() + this.cacheTtlMs };
    this.cache.delete(key); this.cache.set(key, entry); this.trimCache(); this.selectionCount += 1; this.lastSelectionCostMs = Math.max(0, this.now() - started);
    return { destination, profile: requirement.profile, primary, backups, eligible: ranked, scores, confidence, selectedAt: this.now(), reason, switched };
  }

  /** Record a trusted local/provider observation. Invalid values are rejected. */
  recordObservation(input: RouteObservationInput): boolean {
    const timestamp = input.timestamp ?? this.now(); if (!Number.isFinite(timestamp) || timestamp < 0) return false;
    if (input.metrics && !validMetrics(input.metrics)) return false;
    const key = candidateKey(input.destination, input.providerId); let state = this.observations.get(key);
    if (!state) { if (this.observations.size >= this.maxObservations) this.trimObservations(); state = { destination: input.destination, providerId: input.providerId, attempts: 0, successes: 0, failures: 0, destinationConfirmations: 0, forwarded: 0, lastObservedAt: timestamp, confidence: 0 }; this.observations.set(key, state); }
    state.lastObservedAt = Math.max(state.lastObservedAt, timestamp);
    if (input.metrics) { const value = metricView(input.metrics, timestamp); if (input.source === 'ADVERTISED') state.advertised = { ...state.advertised, ...value }; else state.measured = { ...state.measured, ...value }; }
    if (input.outcome) { state.lastOutcome = input.outcome; state.attempts += 1; if (input.outcome === 'SUCCESS' || input.outcome === 'DESTINATION_CONFIRMED' || input.outcome === 'FORWARDED') { state.successes += 1; state.forwarded += input.outcome === 'FORWARDED' ? 1 : 0; } if (['TIMEOUT', 'PROVIDER_FAILURE', 'ROUTE_LOST', 'PROVIDER_UNAVAILABLE', 'SECURITY_REJECTED', 'RESOURCE_REJECTED', 'DESTINATION_UNCONFIRMED'].includes(input.outcome)) state.failures += 1; if (input.destinationConfirmed || input.outcome === 'DESTINATION_CONFIRMED') state.destinationConfirmations += 1; if (input.failureCode) state.lastFailureCode = input.failureCode; if (['TIMEOUT', 'PROVIDER_FAILURE', 'ROUTE_LOST', 'PROVIDER_UNAVAILABLE'].includes(input.outcome)) state.probeBackoffUntil = timestamp + this.failureBackoffMs; }
    if (input.durationMs !== undefined && finite(input.durationMs) && input.durationMs >= 0) state.measured = { ...state.measured, rttMs: input.durationMs, observedAt: timestamp };
    state.confidence = this.computeConfidence(state, timestamp);
    return true;
  }

  recordMeasurement(input: RouteObservationInput): boolean { return this.recordObservation({ ...input, source: input.source ?? 'OBSERVED' }); }
  recordAttempt(input: Omit<RouteObservationInput, 'metrics'> & { readonly outcome: RouteOutcome; readonly durationMs?: number }): boolean { return this.recordObservation(input); }
  recordAdvertised(input: Omit<RouteObservationInput, 'source'>): boolean { return this.recordObservation({ ...input, source: 'ADVERTISED' }); }
  recordDestinationConfirmation(destination: string, providerId: TransportProviderId, timestamp = this.now(), durationMs?: number): boolean { return this.recordObservation({ destination, providerId, outcome: 'DESTINATION_CONFIRMED', destinationConfirmed: true, timestamp, durationMs }); }
  invalidateProvider(providerId: TransportProviderId): void {
    const matches = (id: string | undefined): boolean => !!id && (id === providerId || id.endsWith(`\u0000${providerId}`));
    for (const [key, entry] of this.cache) if (matches(entry.primaryId) || entry.backupIds.some(matches)) this.cache.delete(key);
    for (const key of this.observations.keys()) if (key.endsWith(`\u0000${providerId}`)) this.observations.delete(key);
  }
  invalidateDestination(destination: string): void { for (const [key, value] of this.cache) if (value.destination === destination) this.cache.delete(key); for (const [key, value] of this.observations) if (value.destination === destination) this.observations.delete(key); }

  /** Bounded, adaptive active probe. It is inert unless a host supplied a probe callback. */
  async probeCandidate(candidate: RouteCandidate): Promise<RouteObservation | undefined> {
    const probe = this.options.probe; if (!probe || !this.shouldProbe(candidate)) return undefined;
    const now = this.now(); const epoch = this.probeEpoch; this.probeWindow.push(now); this.probes.set(candidate.id, now); this.totalProbeCount += 1; this.trimProbeWindow(now);
    try { const result = await probe(candidate); if (epoch !== this.probeEpoch || !result) return undefined; this.recordObservation({ destination: candidate.destination, providerId: candidate.providerId, metrics: result.metrics, outcome: result.outcome ?? 'SESSION_OPEN', destinationConfirmed: result.destinationConfirmed, timestamp: this.now() }); return this.observation(candidate.destination, candidate.providerId); }
    catch { if (epoch !== this.probeEpoch) return undefined; this.recordObservation({ destination: candidate.destination, providerId: candidate.providerId, outcome: 'PROVIDER_FAILURE', timestamp: this.now() }); return this.observation(candidate.destination, candidate.providerId); }
  }
  async probe(candidate: RouteCandidate): Promise<RouteObservation | undefined> { return this.probeCandidate(candidate); }
  shouldProbe(candidate: RouteCandidate): boolean {
    const now = this.now(); this.trimProbeWindow(now); if (this.probeWindow.length >= this.maxProbesPerWindow) return false;
    const state = this.observations.get(candidateKey(candidate.destination, candidate.providerId)); if (state?.probeBackoffUntil && state.probeBackoffUntil > now) return false;
    const previous = this.probes.get(candidate.id); const stable = state && state.successes > state.failures && state.lastOutcome !== 'TIMEOUT'; const interval = this.resourceProfile === 'BATTERY_SAVER' ? 60_000 : stable ? 30_000 : 5_000;
    return previous === undefined || now - previous >= interval;
  }

  observation(destination: string, providerId: TransportProviderId): RouteObservation | undefined {
    const state = this.observations.get(candidateKey(destination, providerId)); if (!state) return undefined; return this.toObservation(state, this.now());
  }
  observationsSnapshot(): readonly RouteObservation[] { this.sweep(); return [...this.observations.values()].map(value => this.toObservation(value, this.now())); }
  cacheSnapshot(): readonly RouteCacheEntry[] { this.sweep(); return [...this.cache.values()].map(value => ({ ...value, backupIds: [...value.backupIds] })); }
  exportSnapshot(): AdaptiveRouteSnapshot { return { version: ADAPTIVE_ROUTE_SCHEMA_VERSION, savedAt: this.now(), cache: this.cacheSnapshot(), observations: this.observationsSnapshot() }; }
  importSnapshot(snapshot: AdaptiveRouteSnapshot): boolean {
    if (!snapshot || snapshot.version !== ADAPTIVE_ROUTE_SCHEMA_VERSION || !Array.isArray(snapshot.cache) || !Array.isArray(snapshot.observations)) return false;
    this.cache.clear(); this.observations.clear(); const now = this.now();
    for (const value of snapshot.observations.slice(0, this.maxObservations)) {
      if (!value || !boundedRouteIdentifier(value.destination) || !boundedRouteIdentifier(value.providerId) || !Number.isFinite(value.lastObservedAt) || value.lastObservedAt < 0) continue;
      const measured = safeImportedMetrics(value.measured); const advertised = safeImportedMetrics(value.advertised);
      const attempts = boundedCounter(value.attempts); const successes = boundedCounter(value.successes); const failures = boundedCounter(value.failures); const destinationConfirmations = boundedCounter(value.destinationConfirmations); const forwarded = boundedCounter(value.forwarded);
      if (attempts === undefined || successes === undefined || failures === undefined || destinationConfirmations === undefined || forwarded === undefined) continue;
      this.observations.set(candidateKey(value.destination, value.providerId as TransportProviderId), { destination: value.destination, providerId: value.providerId as TransportProviderId, measured, advertised, attempts, successes, failures, destinationConfirmations, forwarded, lastOutcome: isRouteOutcome(value.lastOutcome) ? value.lastOutcome : undefined, lastFailureCode: typeof value.lastFailureCode === 'string' && value.lastFailureCode.length <= 128 ? value.lastFailureCode as DeliveryFailureCode : undefined, lastObservedAt: value.lastObservedAt, confidence: Number.isFinite(value.confidence) ? Math.max(0, Math.min(1, value.confidence)) : 0 });
    }
    for (const value of snapshot.cache.slice(0, this.maxCacheEntries)) {
      if (!value || !boundedRouteIdentifier(value.destination) || typeof value.profile !== 'string' || !isDeliveryProfile(value.profile) || !Array.isArray(value.backupIds) || !Number.isFinite(value.expiresAt) || value.expiresAt <= now || !Number.isFinite(value.lastSelectedAt) || value.lastSelectedAt < 0) continue;
      const backupIds = (value.backupIds as readonly unknown[]).filter((id: unknown): id is string => boundedRouteIdentifier(id)).slice(0, this.maxBackups);
      const primaryId = value.primaryId === undefined ? undefined : boundedRouteIdentifier(value.primaryId) ? value.primaryId : undefined;
      this.cache.set(selectionKey(value.destination, value.profile), { destination: value.destination, profile: value.profile, primaryId, backupIds, confidence: Math.max(0, Math.min(1, Number.isFinite(value.confidence) ? value.confidence : 0)), lastSelectedAt: value.lastSelectedAt, expiresAt: value.expiresAt });
    }
    this.trimCache(); this.trimObservations(); return true;
  }
  snapshot(): AdaptiveRouteSnapshot { return this.exportSnapshot(); }
  restore(snapshot: AdaptiveRouteSnapshot): boolean { return this.importSnapshot(snapshot); }
  /** Drop live primary/backup selections on a Fabric restart while retaining
   * bounded, decaying measurements as non-authoritative hints. */
  resetLiveState(): void { this.probeEpoch += 1; this.cache.clear(); this.probes.clear(); this.probeWindow.length = 0; }

  diagnostics(): AdaptiveRouteDiagnostics { this.sweep(); this.trimProbeWindow(this.now()); return { cacheEntries: this.cache.size, observations: this.observations.size, maxCacheEntries: this.maxCacheEntries, maxBackups: this.maxBackups, candidateEvaluations: this.candidateEvaluations, selectionCount: this.selectionCount, routeSwitches: this.routeSwitches, failovers: this.failovers, probeCount: this.totalProbeCount, probeWindowCount: this.probeWindow.length, activeProbeCandidates: this.probes.size, cleanupCount: this.cleanupCount, lastSelectionCostMs: this.lastSelectionCostMs, resourceProfile: this.resourceProfile }; }
  stop(): void { this.probeEpoch += 1; this.probes.clear(); this.probeWindow.length = 0; }

  private scoreCandidate(candidate: RouteCandidate, requirement: DeliveryRequirement): RouteScore {
    const observation = this.observations.get(candidateKey(candidate.destination, candidate.providerId)); const now = this.now();
    const freshness = observation ? this.freshness(observation.lastObservedAt, now) : 0; const confidence = observation ? this.computeConfidence(observation, now) : 0;
    // Measured values are authoritative while fresh. Once their confidence
    // has decayed below the bounded freshness floor, do not let an old fast
    // sample permanently outrank a newly observed candidate. A current
    // candidate metric or advertisement may still be used as a hint, but
    // stale measurements are no longer treated as present-tense truth.
    const metrics = observation?.measured && freshness >= 0.25
      ? observation.measured
      : candidate.metrics ?? observation?.advertised ?? candidate.advertised;
    const rtt = metrics?.rttMs; const latency = rtt === undefined ? undefined : 1 / (1 + rtt / 100);
    const loss = metrics?.lossRatio === undefined ? undefined : 1 - metrics.lossRatio;
    const throughput = metrics?.throughputBytesPerSecond === undefined ? undefined : metrics.throughputBytesPerSecond / (metrics.throughputBytesPerSecond + 1_000_000);
    const mtuValue = metrics?.mtu ?? candidate.mtu;
    const mtu = typeof mtuValue === 'number' ? Math.min(1, mtuValue / (1024 * 1024)) : undefined;
    const stability = metrics?.stability;
    const signal = typeof metrics?.signalQuality === 'number' ? metrics.signalQuality : undefined;
    const success = observation && observation.attempts > 0 ? (observation.destinationConfirmations > 0 ? Math.min(1, observation.destinationConfirmations / observation.attempts) : observation.successes / observation.attempts) : undefined;
    const hopsValue = metrics?.hops ?? candidate.hopCount;
    const hops = typeof hopsValue === 'number' ? 1 / (1 + hopsValue) : undefined;
    const resource = this.resourceSuitability(candidate, requirement);
    const live = candidate.liveAvailable ? 1 : 0;
    const weights = PROFILE_WEIGHTS[requirement.profile];
    const criteria: Record<string, number | undefined> = { live, latency, loss, throughput, mtu, stability, signal, success, hops, resource, confidence, freshness };
    let value = 0; let total = 0; for (const [name, weight] of Object.entries(weights)) { const criterion = criteria[name]; if (criterion !== undefined) { value += criterion * weight; total += weight; } }
    if (total > 0) value /= total;
    // A route with an old observation remains eligible, but its historical
    // quality must not indefinitely dominate a currently measured route.
    // Keep a non-zero floor for UNKNOWN metrics while making freshness
    // materially affect stale-route ranking.
    if (observation) value *= 0.5 + (0.5 * freshness);
    // Fresh measured observations outrank stale advertisements, but unknown
    // metrics never become a fake zero. The small bounded confidence term is
    // a tie-breaker, not a security penalty or trust score.
    value = value * 0.92 + confidence * 0.08;
    return { policyVersion: ADAPTIVE_ROUTE_POLICY_VERSION, profile: requirement.profile, value, confidence, knownMetrics: Object.entries(criteria).filter(([, metric]) => metric !== undefined).map(([name]) => name), criteria };
  }

  private reasonForSwitch(previous: RouteScore, next: RouteScore): RouteSwitchReason {
    if (next.criteria.resource !== undefined && previous.criteria.resource !== undefined && next.criteria.resource > previous.criteria.resource + 0.15) return 'RESOURCE_PRESSURE';
    if (next.criteria.throughput !== undefined && next.criteria.throughput > (previous.criteria.throughput ?? 0) + 0.15) return 'BETTER_BULK_SUITABILITY';
    if (next.criteria.latency !== undefined && next.criteria.latency > (previous.criteria.latency ?? 0) + 0.15) return 'LOWER_LATENCY';
    if (next.confidence > previous.confidence + 0.15) return 'BETTER_CONFIDENCE';
    return 'PROVIDER_UNAVAILABLE';
  }

  private resourceSuitability(candidate: RouteCandidate, requirement: DeliveryRequirement): number {
    const signals = this.resourceState; let value = 0.65;
    if (this.resourceProfile === 'BATTERY_SAVER') { value += candidate.energy === 'LOW' ? 0.25 : candidate.energy === 'HIGH' ? -0.25 : 0; if (candidate.metered === true) value -= 0.05; }
    if (this.resourceProfile === 'HIGH_AVAILABILITY') value += candidate.liveAvailable ? 0.15 : -0.05;
    if (signals.thermal === 'SERIOUS' || signals.thermal === 'CRITICAL') value += candidate.energy === 'LOW' ? 0.2 : candidate.energy === 'HIGH' ? -0.3 : 0;
    if (signals.battery === 'LOW' || signals.battery === 'CRITICAL') value += candidate.energy === 'LOW' ? 0.1 : candidate.energy === 'HIGH' ? -0.15 : 0;
    if (requirement.profile === 'BULK' && candidate.metered === true) value -= 0.2;
    return Math.max(0, Math.min(1, value));
  }

  private freshness(at: number, now: number): number { if (!Number.isFinite(at) || at > now) return 0; return Math.pow(0.5, Math.max(0, now - at) / this.confidenceHalfLifeMs); }
  private computeConfidence(state: MutableObservation, now: number): number { const sample = Math.min(1, state.attempts / 5); const success = state.attempts ? Math.max(0, Math.min(1, (state.destinationConfirmations > 0 ? state.destinationConfirmations : state.successes) / state.attempts)) : 0; return Math.max(0, Math.min(1, (sample * 0.45 + success * 0.55) * this.freshness(state.lastObservedAt, now))); }
  private toObservation(state: MutableObservation, now: number): RouteObservation { const confidence = this.computeConfidence(state, now); return { destination: state.destination, providerId: state.providerId, measured: state.measured, advertised: state.advertised, attempts: state.attempts, successes: state.successes, failures: state.failures, destinationConfirmations: state.destinationConfirmations, forwarded: state.forwarded, lastOutcome: state.lastOutcome, lastFailureCode: state.lastFailureCode, lastObservedAt: state.lastObservedAt, confidence, confidenceBand: confidenceBand(confidence), freshness: this.freshness(state.lastObservedAt, now) }; }
  private trimProbeWindow(now: number): void {
    const cutoff = now - this.probeWindowMs;
    while (this.probeWindow[0] !== undefined && this.probeWindow[0]! < cutoff) this.probeWindow.shift();
    const retainedUntil = now - Math.max(this.probeWindowMs, this.cacheTtlMs, 24 * 60 * 60_000);
    for (const [id, at] of this.probes) if (at < retainedUntil) this.probes.delete(id);
    while (this.probes.size > this.maxObservations) { const oldest = [...this.probes.entries()].sort((a, b) => a[1] - b[1])[0]; if (!oldest) break; this.probes.delete(oldest[0]); this.cleanupCount += 1; }
  }
  private trimCache(): void {
    while (this.cache.size > this.maxCacheEntries || new Set([...this.cache.values()].map(value => value.destination)).size > this.maxDestinations) { const oldest = [...this.cache.entries()].sort((a, b) => a[1].lastSelectedAt - b[1].lastSelectedAt)[0]; if (!oldest) break; this.cache.delete(oldest[0]); this.cleanupCount += 1; }
  }
  private trimObservations(): void { while (this.observations.size > this.maxObservations) { const oldest = [...this.observations.entries()].sort((a, b) => a[1].lastObservedAt - b[1].lastObservedAt)[0]; if (!oldest) break; this.observations.delete(oldest[0]); this.cleanupCount += 1; } }
  private sweep(): void { const now = this.now(); for (const [key, entry] of this.cache) if (entry.expiresAt <= now) { this.cache.delete(key); this.cleanupCount += 1; } for (const [key, state] of this.observations) if (this.freshness(state.lastObservedAt, now) <= 0.01 && state.attempts === 0) { this.observations.delete(key); this.cleanupCount += 1; } this.trimCache(); this.trimObservations(); this.trimProbeWindow(now); }
}

export const AdaptiveRouteOptimizerService = AdaptiveRouteOptimizer;
export const RouteOptimizer = AdaptiveRouteOptimizer;
