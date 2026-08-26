import { describe, expect, it } from 'vitest';
import { AdaptiveRouteOptimizer, type RouteCandidate, type RouteResourceProfile } from './adaptive-route.js';
import type { DeliveryProfile, TransportProvider, TransportProviderId } from './connectivity.js';

const profiles: readonly DeliveryProfile[] = ['CONTROL', 'INTERACTIVE', 'REALTIME', 'BULK', 'EVENTUAL', 'BACKGROUND', 'BEST_EFFORT'];
let generatedProvider = 0;

function candidate(overrides: Partial<RouteCandidate> = {}): RouteCandidate {
  const destination = overrides.destination ?? 'destination';
  const providerId = overrides.providerId ?? `provider-${generatedProvider++}` as TransportProviderId;
  return {
    id: `${destination}\u0000${providerId}`,
    destination,
    providerId,
    providerType: 'ControlledTransport',
    providerFamily: 'controlled',
    pathKind: 'LIVE',
    liveAvailable: true,
    eventualAvailable: false,
    supportedProfiles: profiles,
    securityEligible: true,
    securityReasons: [],
    availability: 'AVAILABLE',
    mtu: 64 * 1024,
    metered: false,
    energy: 'LOW',
    hopCount: 1,
    ancestry: [],
    ...overrides,
  };
}

describe('R0P72 AdaptiveRouteOptimizer', () => {
  it('applies security eligibility before performance scoring', () => {
    const optimizer = new AdaptiveRouteOptimizer();
    const insecure = candidate({ providerId: 'fast-insecure' as TransportProviderId, securityEligible: false, securityReasons: ['missing authenticated E2E'], metrics: { rttMs: 1 } });
    const secure = candidate({ providerId: 'slow-secure' as TransportProviderId, metrics: { rttMs: 150 } });
    const selection = optimizer.select('destination', { profile: 'INTERACTIVE' }, [insecure, secure]);
    expect(selection.primary?.providerId).toBe('slow-secure');
    expect(selection.eligible.map(value => value.providerId)).toEqual(['slow-secure']);
  });

  it('uses profile-specific suitability: bulk prefers capacity over tiny latency', () => {
    const optimizer = new AdaptiveRouteOptimizer();
    const nearby = candidate({ providerId: 'nearby' as TransportProviderId, providerType: 'BluetoothTransport', providerFamily: 'nearby', mtu: 512, energy: 'LOW', metrics: { rttMs: 5, throughputBytesPerSecond: 10_000, mtu: 512 } });
    const local = candidate({ providerId: 'local' as TransportProviderId, providerType: 'LocalNetworkTransport', providerFamily: 'local', mtu: 64 * 1024, metrics: { rttMs: 20, throughputBytesPerSecond: 10_000_000, mtu: 64 * 1024 } });
    expect(optimizer.select('destination', { profile: 'BULK' }, [nearby, local]).primary?.providerId).toBe('local');
    expect(optimizer.select('destination', { profile: 'INTERACTIVE' }, [nearby, local]).primary?.providerId).toBe('nearby');
  });

  it('keeps a stable primary during noisy measurements, then switches after degradation', () => {
    let now = 1_000;
    const optimizer = new AdaptiveRouteOptimizer({ now: () => now, hysteresisThreshold: 0.08 });
    const a = candidate({ providerId: 'a' as TransportProviderId, metrics: { rttMs: 49 } });
    const b = candidate({ providerId: 'b' as TransportProviderId, metrics: { rttMs: 50 } });
    expect(optimizer.select('destination', { profile: 'INTERACTIVE' }, [a, b]).primary?.providerId).toBe('a');
    now += 10;
    expect(optimizer.select('destination', { profile: 'INTERACTIVE' }, [candidate({ ...a, metrics: { rttMs: 53 } }), candidate({ ...b, metrics: { rttMs: 48 } })]).primary?.providerId).toBe('a');
    optimizer.recordAttempt({ destination: 'destination', providerId: 'a' as TransportProviderId, outcome: 'TIMEOUT', timestamp: now + 1 });
    now += 2;
    expect(optimizer.select('destination', { profile: 'INTERACTIVE' }, [candidate({ ...a, metrics: { rttMs: 500 } }), candidate({ ...b, metrics: { rttMs: 48 } })]).primary?.providerId).toBe('b');
  });

  it('rejects DTN for realtime but accepts it for eventual delivery', () => {
    const optimizer = new AdaptiveRouteOptimizer();
    const dtn = candidate({ providerId: 'dtn' as TransportProviderId, providerType: 'DelayTolerantTransport', providerFamily: 'dtn', pathKind: 'EVENTUAL', liveAvailable: false, eventualAvailable: true, supportedProfiles: ['EVENTUAL', 'BACKGROUND', 'BEST_EFFORT'], metrics: { rttMs: 1_000 } });
    expect(optimizer.select('destination', { profile: 'REALTIME' }, [dtn]).primary).toBeUndefined();
    expect(optimizer.select('destination', { profile: 'EVENTUAL' }, [dtn]).primary?.providerId).toBe('dtn');
  });

  it('allows a metered route for interactive only when policy permits it', () => {
    const optimizer = new AdaptiveRouteOptimizer();
    const metered = candidate({ providerId: 'metered' as TransportProviderId, metered: true, securityReasons: [], metrics: { rttMs: 5 } });
    expect(optimizer.select('destination', { profile: 'INTERACTIVE', allowMetered: false }, [metered]).primary).toBeUndefined();
    expect(optimizer.select('destination', { profile: 'INTERACTIVE', allowMetered: true }, [metered]).primary?.providerId).toBe('metered');
  });

  it('rejects recursive gateway/DTN composition instead of waiting for a timeout', () => {
    const optimizer = new AdaptiveRouteOptimizer();
    const gatewayLoop = candidate({ providerId: 'gateway-loop' as TransportProviderId, providerType: 'GatewayMeshTransport', providerFamily: 'gateway', ancestry: ['gateway'] });
    const dtnLoop = candidate({ providerId: 'dtn-gateway-loop' as TransportProviderId, providerType: 'DelayTolerantTransport', providerFamily: 'dtn', pathKind: 'EVENTUAL', liveAvailable: false, eventualAvailable: true, supportedProfiles: ['EVENTUAL'], ancestry: ['gateway'] });
    expect(optimizer.eligibility(gatewayLoop, { profile: 'INTERACTIVE' }).eligible).toBe(false);
    expect(optimizer.eligibility(dtnLoop, { profile: 'EVENTUAL' }).eligible).toBe(false);
  });

  it('rejects malformed/hostile measurements and keeps bounded confidence', () => {
    const optimizer = new AdaptiveRouteOptimizer();
    const id = 'provider' as TransportProviderId;
    expect(optimizer.recordMeasurement({ destination: 'd', providerId: id, metrics: { rttMs: -1 } })).toBe(false);
    expect(optimizer.recordMeasurement({ destination: 'd', providerId: id, metrics: { lossRatio: 2 } })).toBe(false);
    expect(optimizer.observation('d', id)).toBeUndefined();
    expect(optimizer.recordMeasurement({ destination: 'd', providerId: id, metrics: { rttMs: 20, lossRatio: 0.1 }, outcome: 'DESTINATION_CONFIRMED' })).toBe(true);
    expect(optimizer.observation('d', id)?.confidence).toBeGreaterThan(0);
  });

  it('isolates a provider that throws during health/capability inspection', () => {
    const optimizer = new AdaptiveRouteOptimizer();
    const broken = {
      id: 'broken' as TransportProviderId,
      type: 'ControlledTransport',
      security: { opaqueOnly: true, e2eRequired: true, canDecrypt: false, canAuthorize: false },
      mtu: 1024,
      health: () => { throw new Error('health failed'); },
      capabilities: () => { throw new Error('capabilities failed'); },
    } as unknown as TransportProvider;
    const route = optimizer.candidateForProvider(broken, 'destination', { profile: 'INTERACTIVE' });
    expect(route.availability).toBe('UNAVAILABLE');
    expect(optimizer.select('destination', { profile: 'INTERACTIVE' }, [route]).primary).toBeUndefined();
  });

  it('keeps route cache/backup state bounded and expires stale entries', () => {
    let now = 0;
    const optimizer = new AdaptiveRouteOptimizer({ now: () => now, maxCacheEntries: 3, maxDestinations: 2, maxBackups: 1, cacheTtlMs: 100 });
    for (const destination of ['a', 'b', 'c', 'd']) optimizer.select(destination, { profile: 'INTERACTIVE' }, [candidate({ destination, providerId: `${destination}-provider` as TransportProviderId })]);
    expect(optimizer.diagnostics().cacheEntries).toBeLessThanOrEqual(3);
    now = 200;
    expect(optimizer.cacheSnapshot()).toHaveLength(0);
  });

  it('bounds active probes and backs off after provider failure', async () => {
    let now = 1_000;
    let calls = 0;
    const optimizer = new AdaptiveRouteOptimizer({ now: () => now, maxProbesPerWindow: 2, probeWindowMs: 1_000, probe: async probe => { calls += 1; return probe.providerId === 'failed' ? { outcome: 'PROVIDER_FAILURE' } : { outcome: 'SESSION_OPEN', metrics: { rttMs: 10 } }; } });
    await optimizer.probe(candidate({ providerId: 'one' as TransportProviderId }));
    await optimizer.probe(candidate({ providerId: 'two' as TransportProviderId }));
    await optimizer.probe(candidate({ providerId: 'three' as TransportProviderId }));
    expect(calls).toBe(2);
    now += 1_000;
    await optimizer.probe(candidate({ providerId: 'failed' as TransportProviderId }));
    expect(await optimizer.probe(candidate({ providerId: 'failed' as TransportProviderId }))).toBeUndefined();
  });

  it('does not commit an in-flight probe after optimizer stop', async () => {
    let release!: (result: { outcome: 'SESSION_OPEN' }) => void;
    const optimizer = new AdaptiveRouteOptimizer({ probe: async () => new Promise(resolve => { release = resolve; }) });
    const pending = optimizer.probe(candidate({ providerId: 'stopping' as TransportProviderId }));
    await Promise.resolve();
    optimizer.stop();
    release({ outcome: 'SESSION_OPEN' });
    expect(await pending).toBeUndefined();
    expect(optimizer.observation('destination', 'stopping' as TransportProviderId)).toBeUndefined();
  });

  it('supports resource profiles without changing security eligibility', () => {
    const optimizer = new AdaptiveRouteOptimizer({ resourceProfile: 'BATTERY_SAVER' as RouteResourceProfile });
    const low = candidate({ providerId: 'low' as TransportProviderId, energy: 'LOW', metrics: { rttMs: 80 } });
    const high = candidate({ providerId: 'high' as TransportProviderId, energy: 'HIGH', metrics: { rttMs: 20 } });
    expect(optimizer.select('destination', { profile: 'BACKGROUND' }, [low, high]).primary?.providerId).toBe('low');
    const interactive = optimizer.select('destination', { profile: 'INTERACTIVE' }, [low, high]);
    expect(interactive.primary?.providerId).toBe('high');
  });

  it('re-evaluates dynamic resource policy when a candidate is reused', () => {
    const optimizer = new AdaptiveRouteOptimizer({ resourceProfile: 'BATTERY_SAVER' });
    const highEnergy = candidate({ providerId: 'high-energy' as TransportProviderId, energy: 'HIGH' });
    expect(optimizer.select('destination', { profile: 'BACKGROUND' }, [highEnergy]).primary).toBeUndefined();
    optimizer.setResourceProfile('BALANCED');
    expect(optimizer.select('destination', { profile: 'BACKGROUND' }, [highEnergy]).primary?.providerId).toBe('high-energy');
  });

  it('lets measured observations override stale provider advertisements', () => {
    let now = 10_000;
    const optimizer = new AdaptiveRouteOptimizer({ now: () => now });
    const advertisedFast = candidate({ providerId: 'advertised-fast' as TransportProviderId, advertised: { rttMs: 2 }, metrics: { rttMs: 2 } });
    const measuredStable = candidate({ providerId: 'measured-stable' as TransportProviderId, advertised: { rttMs: 120 }, metrics: { rttMs: 120 } });
    optimizer.recordAdvertised({ destination: 'destination', providerId: 'advertised-fast' as TransportProviderId, metrics: { rttMs: 2 }, timestamp: now });
    optimizer.recordMeasurement({ destination: 'destination', providerId: 'advertised-fast' as TransportProviderId, metrics: { rttMs: 500 }, timestamp: now });
    optimizer.recordMeasurement({ destination: 'destination', providerId: 'measured-stable' as TransportProviderId, metrics: { rttMs: 30 }, outcome: 'FORWARDED', timestamp: now });
    expect(optimizer.select('destination', { profile: 'INTERACTIVE' }, [advertisedFast, measuredStable]).primary?.providerId).toBe('measured-stable');
    now += 120_000;
    expect(optimizer.observation('destination', 'measured-stable' as TransportProviderId)?.confidence).toBeLessThan(0.2);
  });

  it('does not let an old fast measurement outrank a fresh route forever', () => {
    let now = 0;
    const optimizer = new AdaptiveRouteOptimizer({ now: () => now });
    const oldFast = candidate({ providerId: 'old-fast' as TransportProviderId });
    const fresh = candidate({ providerId: 'fresh' as TransportProviderId });
    optimizer.recordMeasurement({ destination: 'destination', providerId: oldFast.providerId, metrics: { rttMs: 1 }, outcome: 'DESTINATION_CONFIRMED', timestamp: now });
    expect(optimizer.select('destination', { profile: 'INTERACTIVE' }, [oldFast, fresh]).primary?.providerId).toBe('old-fast');
    now += 10 * 60_000;
    optimizer.recordMeasurement({ destination: 'destination', providerId: fresh.providerId, metrics: { rttMs: 30 }, outcome: 'DESTINATION_CONFIRMED', timestamp: now });
    expect(optimizer.select('destination', { profile: 'INTERACTIVE' }, [oldFast, fresh]).primary?.providerId).toBe('fresh');
  });

  it('distinguishes forwarded/courier acceptance from destination confirmation', () => {
    const optimizer = new AdaptiveRouteOptimizer();
    const id = 'route' as TransportProviderId;
    optimizer.recordAttempt({ destination: 'destination', providerId: id, outcome: 'FORWARDED' });
    expect(optimizer.observation('destination', id)?.destinationConfirmations).toBe(0);
    optimizer.recordDestinationConfirmation('destination', id);
    expect(optimizer.observation('destination', id)?.destinationConfirmations).toBe(1);
  });

  it('restores bounded measurements as non-authoritative state and reselects after restart', () => {
    let now = 1_000;
    const first = new AdaptiveRouteOptimizer({ now: () => now });
    const a = candidate({ providerId: 'a' as TransportProviderId, metrics: { rttMs: 10 } });
    first.recordMeasurement({ destination: 'destination', providerId: 'a' as TransportProviderId, metrics: { rttMs: 10 }, outcome: 'FORWARDED', timestamp: now });
    first.select('destination', { profile: 'INTERACTIVE' }, [a]);
    const snapshot = first.exportSnapshot();
    const restarted = new AdaptiveRouteOptimizer({ now: () => now });
    expect(restarted.importSnapshot(snapshot)).toBe(true);
    expect(restarted.observation('destination', 'a' as TransportProviderId)).toBeDefined();
    restarted.resetLiveState();
    expect(restarted.cacheSnapshot()).toHaveLength(0);
    now += 120_000;
    expect(restarted.observation('destination', 'a' as TransportProviderId)?.freshness).toBeLessThan(0.3);
  });

  it('fails closed on tampered route snapshots instead of importing poisoned metrics', () => {
    const optimizer = new AdaptiveRouteOptimizer({ now: () => 1_000 });
    const snapshot = {
      version: 1 as const,
      savedAt: 1_000,
      cache: [{ destination: 'destination', profile: 'INTERACTIVE' as const, primaryId: 'fast', backupIds: [], confidence: NaN, lastSelectedAt: 1_000, expiresAt: 2_000 }],
      observations: [{ destination: 'destination', providerId: 'fast' as TransportProviderId, measured: { rttMs: Number.NaN }, advertised: { throughputBytesPerSecond: Number.POSITIVE_INFINITY }, attempts: 1, successes: 0, failures: 0, destinationConfirmations: 0, forwarded: 0, lastObservedAt: 1_000, confidence: Number.POSITIVE_INFINITY, confidenceBand: 'HIGH' as const, freshness: 1 }],
    };
    expect(optimizer.importSnapshot(snapshot)).toBe(true);
    const observation = optimizer.observation('destination', 'fast' as TransportProviderId);
    expect(observation?.measured).toBeUndefined();
    expect(observation?.advertised).toBeUndefined();
    expect(observation?.attempts).toBe(1);
    expect(optimizer.cacheSnapshot()[0]?.confidence).toBe(0);
    const selection = optimizer.select('destination', { profile: 'INTERACTIVE' }, [candidate({ providerId: 'fast' as TransportProviderId }), candidate({ providerId: 'safe' as TransportProviderId })]);
    expect(selection.scores.every(value => Number.isFinite(value.score.value))).toBe(true);
  });

  it('keeps 100+ candidate evaluation and provider churn bounded', () => {
    const optimizer = new AdaptiveRouteOptimizer({ maxCacheEntries: 8, maxDestinations: 8, maxObservations: 16, maxBackups: 2 });
    const candidates = Array.from({ length: 128 }, (_, index) => candidate({ providerId: `provider-${index}` as TransportProviderId, metrics: { rttMs: index + 1 } }));
    const selection = optimizer.select('destination', { profile: 'INTERACTIVE' }, candidates);
    expect(selection.primary).toBeDefined();
    expect(selection.backups).toHaveLength(2);
    for (const value of candidates) optimizer.recordAttempt({ destination: 'destination', providerId: value.providerId, outcome: 'PROVIDER_FAILURE' });
    expect(optimizer.diagnostics().observations).toBeLessThanOrEqual(16);
    optimizer.invalidateProvider('provider-0' as TransportProviderId);
    expect(optimizer.cacheSnapshot().every(entry => !entry.primaryId?.endsWith('provider-0'))).toBe(true);
  });
});
