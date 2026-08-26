import { describe, expect, it } from 'vitest';
import { ConnectivityFabric, ControlledTransportProvider, FabricTransport, type KeystoneDeliveryInterface, createOpaqueDeliveryEnvelope } from './connectivity.js';
import { CONNECTIVITY_USE_INVENTORY, FABRIC_APPLICATION_MODULES, LOW_LEVEL_PROVIDER_MODULES, NETWORK_CAPABLE_PRODUCTION_MODULES, connectivityUse } from './connectivity-architecture.js';
import { KeystoneEngine } from './engine.js';
import { testCrypto } from './testing.js';
import type { AIModelAdapter } from './ai.js';
import type { Envelope } from './transport.js';

const model: AIModelAdapter = { kind: 'local', async complete() { return { name: 'noop', arguments: {} }; } };
const security = { sign: async (_: Omit<Envelope, 'signature'>) => 'test-signature', verify: async (_: Envelope) => true };

function peerTransport(): { delivery: KeystoneDeliveryInterface; peer: ControlledTransportProvider; fabric: ConnectivityFabric } {
  const provider = new ControlledTransportProvider('alice');
  const peer = new ControlledTransportProvider('bob');
  provider.connectPeer('bob', peer); peer.connectPeer('alice', provider);
  const fabric = new ConnectivityFabric(); fabric.registerProvider(provider);
  return { delivery: new FabricTransport({ fabric, localNodeId: 'alice', applicationSecurity: security }), peer, fabric };
}

/** A deterministic provider whose live-session observation can change without
 * changing the historical route used by the controlled transport. */
class MutableConnectivityProvider extends ControlledTransportProvider {
  private readonly livePeers = new Set<string>();
  override connectPeer(routeReference: string, peer: ControlledTransportProvider): void { super.connectPeer(routeReference, peer); this.livePeers.add(routeReference); }
  disconnectPeer(routeReference: string): void { this.livePeers.delete(routeReference); }
  override isPeerConnected(destination: string): boolean { return this.livePeers.has(destination); }
}

describe('R0P67 Fabric authority invariants', () => {
  it('requires explicit Fabric-backed production engine wiring', () => {
    expect(() => new KeystoneEngine({ model })).toThrow(/Fabric|FabricTransport/i);
  });

  it('exposes a low-level provider only beneath FabricTransport', async () => {
    const { delivery, fabric } = peerTransport();
    expect(delivery).toBeInstanceOf(FabricTransport);
    await (delivery as KeystoneDeliveryInterface & { start?: () => Promise<void> }).start?.();
    const envelope: Envelope = { version: 1, type: 'authority.test', id: 'authority-1', sender: 'alice', recipient: 'bob', nonce: 'authority-nonce', expiresAt: new Date(Date.now() + 60_000).toISOString(), body: { public: true }, signature: 'test-signature' };
    await delivery.connect('bob'); await delivery.send('bob', envelope);
    expect(fabric.snapshot().availableProviders).toContain('alice');
    await delivery.close();
  });

  it('does not expose plaintext through the provider-facing envelope', async () => {
    const value = await createOpaqueDeliveryEnvelope({ destination: 'bob', ciphertext: new TextEncoder().encode('secret application bytes'), replayNonce: 'opaque-nonce', expiresAt: new Date(Date.now() + 60_000).toISOString(), requirement: { profile: 'INTERACTIVE' } });
    expect(value).not.toHaveProperty('plaintext'); expect(value).not.toHaveProperty('contentKey'); expect(value.ciphertext).not.toContain('secret application bytes');
  });

  it('keeps controlled providers available as an explicit deterministic seam', () => {
    const provider = new ControlledTransportProvider('test-controlled'); const fabric = new ConnectivityFabric(); fabric.registerProvider(provider);
    expect(fabric.provider('test-controlled')?.type).toBe('ControlledTransport');
  });

  it('keeps a complete, classified inventory for every network-capable production module', () => {
    expect(CONNECTIVITY_USE_INVENTORY.length).toBeGreaterThan(20);
    expect(FABRIC_APPLICATION_MODULES.every(module => connectivityUse(module)?.classification === 'FABRIC_MIGRATED')).toBe(true);
    expect(LOW_LEVEL_PROVIDER_MODULES.every(module => connectivityUse(module)?.classification === 'LOW_LEVEL_PROVIDER')).toBe(true);
    expect(CONNECTIVITY_USE_INVENTORY.every(value => value.classification && value.reason.length > 0)).toBe(true);
    expect(connectivityUse('sync/capsule.ts')?.classification).toBe('FABRIC_MIGRATED');
    expect(NETWORK_CAPABLE_PRODUCTION_MODULES.every(module => module.includes('/') || module.endsWith('.ts'))).toBe(true);
  });

  it('does not silently turn a provider failure into a legacy direct send', async () => {
    const provider = new ControlledTransportProvider('provider');
    const peer = new ControlledTransportProvider('peer');
    provider.connectPeer('peer', peer);
    const fabric = new ConnectivityFabric(); fabric.registerProvider(provider);
    const delivery = new FabricTransport({ fabric, localNodeId: 'provider', applicationSecurity: security });
    await delivery.start();
    await expect(delivery.send('missing', { version: 1, type: 'authority.failure', id: 'failure-1', sender: 'provider', recipient: 'missing', nonce: 'n', expiresAt: new Date(Date.now() + 60_000).toISOString(), body: {}, signature: 'test-signature' })).rejects.toThrow(/No secure provider|route|transport|reachable/i);
    await delivery.close();
  });

  it('purges stale connected hints while preserving another provider live route', async () => {
    const primary = new MutableConnectivityProvider('primary');
    const secondary = new MutableConnectivityProvider('secondary');
    primary.connectPeer('bob', new ControlledTransportProvider('bob-primary'));
    secondary.connectPeer('bob', new ControlledTransportProvider('bob-secondary'));
    const fabric = new ConnectivityFabric(); fabric.registerProvider(primary); fabric.registerProvider(secondary);
    const delivery = new FabricTransport({ fabric, localNodeId: 'alice', applicationSecurity: security });
    await delivery.start();
    const envelope: Envelope = { version: 1, type: 'authority.connectivity', id: 'connectivity-hint-1', sender: 'alice', recipient: 'bob', nonce: 'connectivity-hint-nonce', expiresAt: new Date(Date.now() + 60_000).toISOString(), body: { public: true }, signature: 'test-signature' };

    await delivery.send('bob', envelope);
    expect(delivery.isPeerConnected('bob')).toBe(true);

    primary.disconnectPeer('bob');
    // A successful historical send must not keep the compatibility hint alive
    // once every provider reports the route gone.
    expect(delivery.isPeerConnected('bob')).toBe(true); // secondary remains live
    secondary.disconnectPeer('bob');
    expect(delivery.isPeerConnected('bob')).toBe(false);

    await delivery.close();
  });

  it('recreates a Fabric-backed runtime without stale provider handles', async () => {
    const first = peerTransport();
    await (first.delivery as KeystoneDeliveryInterface & { start?: () => Promise<void> }).start?.();
    expect(first.fabric.isRunning()).toBe(true);
    await first.delivery.close();
    expect(first.fabric.isRunning()).toBe(false);
    const provider = new ControlledTransportProvider('alice-restarted');
    const peer = new ControlledTransportProvider('bob-restarted');
    provider.connectPeer('bob', peer); peer.connectPeer('alice', provider);
    const fabric = new ConnectivityFabric(); fabric.registerProvider(provider);
    const delivery = new FabricTransport({ fabric, localNodeId: 'alice', applicationSecurity: security });
    await delivery.start();
    const envelope: Envelope = { version: 1, type: 'authority.restart', id: 'restart-1', sender: 'alice', recipient: 'bob', nonce: 'restart-nonce', expiresAt: new Date(Date.now() + 60_000).toISOString(), body: { public: true }, signature: 'test-signature' };
    await delivery.send('bob', envelope);
    expect(fabric.isRunning()).toBe(true);
    await delivery.close();
  });

  it('rejects an unclassified legacy Transport at the production engine boundary', () => {
    const transport = new (class extends ControlledTransportProvider {})('unclassified');
    expect(() => new KeystoneEngine({ model, transport: transport as unknown as import('./transport.js').Transport })).toThrow(/unclassified legacy Transport/i);
    expect(() => new KeystoneEngine({ model, transport: transport as unknown as import('./transport.js').Transport, legacyTransportPurpose: 'TEST' })).not.toThrow();
  });
});
