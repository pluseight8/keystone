import { describe, expect, it } from 'vitest';
import {
  ConnectivityFabric,
  ControlledTransportProvider,
  createOpaqueDeliveryEnvelope,
  type OpaqueDeliveryEnvelope,
} from './connectivity.js';
import {
  DEFAULT_PROTOCOL_LIMITS,
  MonotonicStateGuard,
  NetworkResourceGovernor,
} from './security/protocol-security.js';
import { CONNECTIVITY_USE_INVENTORY, FABRIC_APPLICATION_MODULES, LOW_LEVEL_PROVIDER_MODULES, connectivityUse } from './connectivity-architecture.js';

class InjectableProvider extends ControlledTransportProvider {
  inject(frame: OpaqueDeliveryEnvelope): void {
    (this as unknown as { emit: (value: OpaqueDeliveryEnvelope) => void }).emit(frame);
  }
}

describe('R0P75 connectivity security red team invariants', () => {
  it('keeps exact opaque replays deduplicated while validating the envelope first', async () => {
    const provider = new InjectableProvider('red-team-provider');
    const fabric = new ConnectivityFabric(); fabric.registerProvider(provider); await fabric.start();
    const value = await createOpaqueDeliveryEnvelope({ destination: 'red-team-destination', ciphertext: new TextEncoder().encode('ciphertext'), replayNonce: 'red-team-nonce', expiresAt: new Date(Date.now() + 60_000).toISOString(), requirement: { profile: 'INTERACTIVE' } });
    let deliveries = 0; fabric.onOpaqueEnvelope(() => { deliveries += 1; });
    provider.inject(value); provider.inject({ ...value }); await new Promise(resolve => setTimeout(resolve, 0));
    expect(deliveries).toBe(1); await fabric.stop();
  });

  it('deduplicates one semantic envelope arriving through primary and failover providers', async () => {
    const primary = new InjectableProvider('red-team-primary');
    const failover = new InjectableProvider('red-team-failover');
    const fabric = new ConnectivityFabric(); fabric.registerProvider(primary); fabric.registerProvider(failover); await fabric.start();
    const value = await createOpaqueDeliveryEnvelope({ destination: 'cross-layer-destination', ciphertext: new TextEncoder().encode('cross-layer-ciphertext'), replayNonce: 'cross-layer-nonce', expiresAt: new Date(Date.now() + 60_000).toISOString(), requirement: { profile: 'INTERACTIVE' } });
    let deliveries = 0; fabric.onOpaqueEnvelope(() => { deliveries += 1; });
    primary.inject(value); failover.inject({ ...value }); await new Promise(resolve => setTimeout(resolve, 0));
    expect(deliveries).toBe(1); await fabric.stop();
  });

  it('bounds hostile connection/frame pressure and escalates only local resource state', () => {
    const governor = new NetworkResourceGovernor({ limits: { connection: { maxConnectionsPerPeer: 1, maxConnectionAttemptsPerWindow: 2, windowMs: 60_000 }, maxFramesPerSecond: 1 }, strikeThreshold: 2, quarantineThreshold: 3 });
    expect(governor.admitConnection('hostile-peer')).toBe('ALLOW');
    expect(governor.admitConnection('hostile-peer')).not.toBe('ALLOW');
    expect(governor.admitFrame('hostile-peer', DEFAULT_PROTOCOL_LIMITS.maxFrameBytes + 1)).not.toBe('ALLOW');
    governor.strike('hostile-peer', 'malformed'); governor.strike('hostile-peer', 'replay'); governor.strike('hostile-peer', 'signature');
    expect(governor.isQuarantined('hostile-peer')).toBe(true);
    expect(governor.metrics().replayRejects).toBeGreaterThanOrEqual(1);
  });

  it('does not permit persisted monotonic authority state to roll back', () => {
    const guard = new MonotonicStateGuard();
    expect(guard.accept('device', { revision: 4, epoch: 2 })).toBe(true);
    expect(guard.accept('device', { revision: 3, epoch: 1 })).toBe(false);
    expect(guard.markTombstone('device', 5, 3)).toBe(true);
    expect(guard.accept('device', { revision: 6, epoch: 4, tombstoned: false })).toBe(false);
  });

  it('bounds the cross-provider replay cache under unique-envelope pressure', () => {
    const fabric = new ConnectivityFabric();
    const rememberSeen = (fabric as unknown as { rememberSeen(key: string): void }).rememberSeen.bind(fabric);
    for (let index = 0; index < 32_769; index += 1) rememberSeen(`attacker-envelope-${index}`);
    const seen = (fabric as unknown as { seen: Map<string, number> }).seen;
    expect(seen.size).toBeLessThanOrEqual(32_768);
  });

  it('keeps the Fabric authority inventory complete with no legacy bypass', () => {
    expect(CONNECTIVITY_USE_INVENTORY.filter(entry => entry.classification === 'LEGACY_BYPASS')).toHaveLength(0);
    expect(FABRIC_APPLICATION_MODULES.every(module => connectivityUse(module)?.classification === 'FABRIC_MIGRATED')).toBe(true);
    expect(LOW_LEVEL_PROVIDER_MODULES.every(module => connectivityUse(module)?.classification === 'LOW_LEVEL_PROVIDER')).toBe(true);
    expect(CONNECTIVITY_USE_INVENTORY.every(entry => entry.classification && entry.reason.length > 0)).toBe(true);
  });
});
