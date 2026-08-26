import { describe, expect, it } from 'vitest';
import {
  ConnectivityFabric,
  ControlledTransportProvider,
  createOpaqueDeliveryEnvelope,
  type OpaqueFrame,
  type TransportEndpoint,
  type TransportSession,
} from './connectivity.js';
import {
  GATEWAY_CONTROL_DESTINATION,
  GatewayBridge,
  GatewayMeshTransportProvider,
  type GatewayCapability,
} from './gateway.js';
import type { AnonymousNeighborSessionSource } from './mesh-routing.js';

const wait = (ms = 0) => new Promise<void>(resolve => setTimeout(resolve, ms));

class ControlledGatewayNetwork {
  readonly transcript: OpaqueFrame[] = [];
  connect(a: ControlledGatewaySource, b: ControlledGatewaySource): void { a.connect(b); b.connect(a); }
}

class ControlledGatewaySource implements AnonymousNeighborSessionSource {
  readonly id: string;
  private readonly peers = new Map<string, ControlledGatewaySource>();
  private readonly listeners = new Set<(frame: OpaqueFrame, session?: TransportSession) => void | Promise<void>>();
  private readonly sessions = new Map<string, { readonly local: TransportSession; readonly remote: TransportSession; readonly peer: ControlledGatewaySource }>();
  private readonly endpointExpiry = new Map<string, string>();
  constructor(private readonly network: ControlledGatewayNetwork, id: string) { this.id = id; }
  connect(peer: ControlledGatewaySource): void { const handle = `anon-${peer.id}`; this.peers.set(handle, peer); this.endpointExpiry.set(handle, new Date(Date.now() + 60_000).toISOString()); }
  listNeighbors(limit = 32): readonly { readonly handle: string; readonly expiresAt: string }[] { return [...this.peers.keys()].slice(0, limit).map(handle => ({ handle, expiresAt: this.endpointExpiry.get(handle)! })); }
  async openNeighbor(handle: string): Promise<TransportSession> {
    const peer = this.peers.get(handle); if (!peer) throw new Error('neighbor unavailable');
    const local: TransportSession = { id: `${this.id}->${peer.id}:${crypto.randomUUID()}`, endpoint: { handle, providerId: this.id as never, providerType: 'ExternalRadioTransport', routeReference: handle, anonymous: true }, providerId: this.id as never, openedAt: new Date().toISOString(), state: 'OPEN' };
    const remote: TransportSession = { id: `${peer.id}->${this.id}:${crypto.randomUUID()}`, endpoint: { handle: `anon-${this.id}`, providerId: peer.id as never, providerType: 'ExternalRadioTransport', routeReference: `anon-${this.id}`, anonymous: true }, providerId: peer.id as never, openedAt: new Date().toISOString(), state: 'OPEN' };
    this.sessions.set(local.id, { local, remote, peer }); peer.sessions.set(remote.id, { local: remote, remote: local, peer: this }); return local;
  }
  async sendNeighborFrame(session: TransportSession, frame: OpaqueFrame): Promise<void> { const value = this.sessions.get(session.id); if (!value) throw new Error('session unavailable'); this.network.transcript.push(structuredClone(frame)); queueMicrotask(() => value.peer.emit(frame, value.remote)); }
  onNeighborFrame(handler: (frame: OpaqueFrame, session?: TransportSession) => void | Promise<void>): () => void { this.listeners.add(handler); return () => this.listeners.delete(handler); }
  async closeNeighborSession(session: TransportSession): Promise<void> { const value = this.sessions.get(session.id); if (!value) return; this.sessions.delete(session.id); value.peer.sessions.delete(value.remote.id); }
  peerHandleForSession(session: TransportSession): string | undefined { const value = this.sessions.get(session.id); return value ? `anon-${value.peer.id}` : undefined; }
  async start(): Promise<void> {}
  async stop(): Promise<void> { for (const value of [...this.sessions.values()]) await this.closeNeighborSession(value.local); }
  private emit(frame: OpaqueFrame, session: TransportSession): void { for (const listener of this.listeners) void listener(structuredClone(frame), session); }
}

async function envelope(destination: string, marker = 'opaque-payload'): Promise<Awaited<ReturnType<typeof createOpaqueDeliveryEnvelope>>> {
  return createOpaqueDeliveryEnvelope({ destination, ciphertext: new TextEncoder().encode(marker), replayNonce: crypto.randomUUID(), expiresAt: new Date(Date.now() + 60_000).toISOString(), requirement: { profile: 'INTERACTIVE' } });
}

async function topology(options: { readonly bridge?: ConstructorParameters<typeof GatewayBridge>[0]; readonly client?: ConstructorParameters<typeof GatewayMeshTransportProvider>[0] } = {}) {
  const network = new ControlledGatewayNetwork(); const clientSource = new ControlledGatewaySource(network, 'client'); const bridgeSource = new ControlledGatewaySource(network, 'bridge'); network.connect(clientSource, bridgeSource);
  const upstream = new ControlledTransportProvider('bridge-upstream'); const destinationProvider = new ControlledTransportProvider('destination'); upstream.connectPeer('destination', destinationProvider); destinationProvider.connectPeer('bridge-upstream', upstream);
  const bridgeFabric = new ConnectivityFabric(); bridgeFabric.registerProvider(upstream); const destinationFabric = new ConnectivityFabric(); destinationFabric.registerProvider(destinationProvider);
  const bridge = new GatewayBridge(options.bridge ?? { source: bridgeSource, upstream: bridgeFabric, providerId: 'bridge' }); const clientProvider = new GatewayMeshTransportProvider(options.client ?? { source: clientSource, providerId: 'gateway-client' }); const clientFabric = new ConnectivityFabric(); clientFabric.registerProvider(clientProvider);
  await destinationFabric.start(); await bridgeFabric.start(); await bridge.start(); await clientFabric.start();
  return { network, clientSource, bridgeSource, bridge, clientProvider, clientFabric, bridgeFabric, destinationFabric, async close() { await clientFabric.stop(); await bridge.stop(); await bridgeFabric.stop(); await destinationFabric.stop(); } };
}

describe('R0P71 opportunistic gateway mesh', () => {
  it('bridges a no-Internet client through an anonymous capability into an upstream Fabric', async () => {
    const fixture = await topology(); const received: string[] = []; fixture.destinationFabric.onOpaqueEnvelope(value => { received.push(value.id); });
    const value = await envelope('destination', 'GATEWAY_APPLICATION_SECRET_MARKER'); const result = await fixture.clientFabric.deliver({ id: value.id, destination: value.destination, envelope: value, requirement: value.requirement }); await wait(10);
    expect(result.ok).toBe(true); expect(result.reachability).toBe('RELAYED'); expect(result.receipt?.path).toBe('RELAYED_GLOBAL'); expect(received).toContain(value.id); expect(fixture.clientFabric.snapshot().internetAvailable).toBe(false); expect(fixture.clientFabric.snapshot().state).toBe('RELAYED_GLOBAL'); expect(fixture.clientFabric.snapshot().reachability).toBe('RELAYED'); expect(fixture.clientFabric.snapshot().availableProviders).toContain('gateway-client');
    const serialized = fixture.network.transcript.map(frame => JSON.stringify(frame)).join('\n'); expect(serialized).not.toContain('GATEWAY_APPLICATION_SECRET_MARKER'); expect(serialized).not.toContain('DESTINATION_SOCIAL_MARKER'); expect(fixture.bridge.diagnostics().framesForwarded).toBeGreaterThan(0); await fixture.close();
  });

  it('rotates and expires anonymous capabilities without a stable gateway identity', async () => {
    let now = Date.now(); const clock = () => now;
    const network = new ControlledGatewayNetwork(); const clientSource = new ControlledGatewaySource(network, 'client-rotate'); const bridgeSource = new ControlledGatewaySource(network, 'bridge-rotate'); network.connect(clientSource, bridgeSource);
    const upstream = new ControlledTransportProvider('upstream-rotate'); const destination = new ControlledTransportProvider('destination-rotate'); upstream.connectPeer('destination-rotate', destination); const upstreamFabric = new ConnectivityFabric(); upstreamFabric.registerProvider(upstream); await upstreamFabric.start();
    const bridge = new GatewayBridge({ source: bridgeSource, upstream: upstreamFabric, now: clock, capabilityTtlMs: 2_000, providerId: 'bridge-rotate' }); const client = new GatewayMeshTransportProvider({ source: clientSource, now: clock, providerId: 'client-rotate' }); const clientFabric = new ConnectivityFabric(); clientFabric.registerProvider(client); await bridge.start(); await clientFabric.start();
    const first = await client.discoverDirectReachability('destination-rotate'); expect(first).toHaveLength(1); const firstExpiry = bridge.diagnostics().capabilityExpiresAt; expect(firstExpiry).toBeDefined(); now += 3_000; const second = await client.discoverDirectReachability('destination-rotate'); expect(second).toHaveLength(1); expect(bridge.diagnostics().capabilityExpiresAt).not.toBe(firstExpiry); upstreamFabric.removeProvider(upstream.id); await upstreamFabric.stop(); expect(await client.discoverDirectReachability('destination-rotate')).toHaveLength(0); expect(bridge.diagnostics().capabilityAvailable).toBe(false); await clientFabric.stop(); await bridge.stop();
  });

  it('cannot create a nested gateway loop through a permissive host predicate', async () => {
    const network = new ControlledGatewayNetwork();
    const bridgeSource = new ControlledGatewaySource(network, 'loop-bridge');
    const nestedSource = new ControlledGatewaySource(network, 'loop-nested');
    const nested = new GatewayMeshTransportProvider({ source: nestedSource, providerId: 'nested-gateway' });
    const upstream = new ConnectivityFabric(); upstream.registerProvider(nested); await upstream.start();
    const bridge = new GatewayBridge({ source: bridgeSource, upstream, providerId: 'loop-bridge', isWiderProvider: () => true }); await bridge.start();
    expect(bridge.advertisedCapability()).toBeUndefined();
    await bridge.stop(); await upstream.stop();
  });

  it('fails closed for malformed control, replayed/expired capability and open-proxy-shaped input', async () => {
    const network = new ControlledGatewayNetwork(); const clientSource = new ControlledGatewaySource(network, 'client-hostile'); const bridgeSource = new ControlledGatewaySource(network, 'bridge-hostile'); network.connect(clientSource, bridgeSource);
    const upstream = new ControlledTransportProvider('upstream-hostile'); const destination = new ControlledTransportProvider('destination-hostile'); upstream.connectPeer('destination-hostile', destination); const fabric = new ConnectivityFabric(); fabric.registerProvider(upstream); await fabric.start(); const bridge = new GatewayBridge({ source: bridgeSource, upstream: fabric, providerId: 'bridge-hostile', limits: { maxFramesPerClient: 1 } }); await bridge.start();
    const proxyPayload = JSON.stringify({ version: 1, kind: 'gateway.proxy', requestId: 'gateway-proxy-request', expiresAt: new Date(Date.now() + 10_000).toISOString(), host: '127.0.0.1', port: 80, url: 'http://example.invalid' }); const malformed = await createOpaqueDeliveryEnvelope({ destination: GATEWAY_CONTROL_DESTINATION, ciphertext: new TextEncoder().encode(proxyPayload), replayNonce: crypto.randomUUID(), expiresAt: new Date(Date.now() + 10_000).toISOString(), requirement: { profile: 'CONTROL' } }); const session = await clientSource.openNeighbor('anon-bridge-hostile'); await clientSource.sendNeighborFrame(session, malformed); await wait(10); expect(bridge.diagnostics().framesForwarded).toBe(0); expect(bridge.diagnostics().rejectedFrames).toBeGreaterThan(0);
    await clientSource.closeNeighborSession(session); await bridge.stop(); await fabric.stop();
  });

  it('rejects a concurrent duplicate request before running the upstream operation twice', async () => {
    const fixture = await topology();
    const capability = fixture.bridge.advertisedCapability(); expect(capability).toBeDefined();
    const session = await fixture.clientSource.openNeighbor('anon-bridge');
    const value = await envelope('destination', 'concurrent-forward');
    const message = {
      version: 1 as const,
      kind: 'gateway.forward' as const,
      requestId: 'gateway-forward-concurrent',
      capabilityToken: capability!.token,
      circuitId: 'gateway-circuit-concurrent',
      expiresAt: new Date(Date.now() + 30_000).toISOString(),
      hopCount: 0,
      requirement: value.requirement,
      frame: value,
    };
    const handleForward = (fixture.bridge as unknown as { handleForward(forward: typeof message, sourceSession: TransportSession): Promise<void> }).handleForward.bind(fixture.bridge);
    await Promise.all([handleForward(message, session), handleForward(message, session)]);
    expect(fixture.bridge.diagnostics().duplicateRequests).toBeGreaterThanOrEqual(1);
    await fixture.close();
  });

  it('honours metered/BATTERY_SAVER policy and bounded client quotas', async () => {
    const network = new ControlledGatewayNetwork(); const clientSource = new ControlledGatewaySource(network, 'client-policy'); const bridgeSource = new ControlledGatewaySource(network, 'bridge-policy'); network.connect(clientSource, bridgeSource); const upstream = new ControlledTransportProvider('upstream-policy'); const destination = new ControlledTransportProvider('destination-policy'); upstream.connectPeer('destination-policy', destination); const fabric = new ConnectivityFabric(); fabric.registerProvider(upstream); await fabric.start(); const bridge = new GatewayBridge({ source: bridgeSource, upstream: fabric, resourceProfile: 'BATTERY_SAVER', metered: true, providerId: 'bridge-policy' }); const client = new GatewayMeshTransportProvider({ source: clientSource, providerId: 'client-policy' }); const clientFabric = new ConnectivityFabric(); clientFabric.registerProvider(client); await bridge.start(); await clientFabric.start();
    expect(await client.discoverDirectReachability('destination-policy', { profile: 'BULK', allowMetered: false })).toHaveLength(0); expect(await client.discoverDirectReachability('destination-policy', { profile: 'INTERACTIVE', allowMetered: false })).toHaveLength(0); expect(await client.discoverDirectReachability('destination-policy', { profile: 'INTERACTIVE', allowMetered: true })).toHaveLength(1); await clientFabric.stop(); await bridge.stop(); await fabric.stop();
  });

  it('cleans routes, clients and timers on gateway disappearance and restart', async () => {
    const fixture = await topology(); expect(fixture.clientProvider.diagnostics().routeCount).toBe(0); expect(await fixture.clientProvider.discoverDirectReachability('destination')).toHaveLength(1); expect(fixture.clientProvider.diagnostics().routeCount).toBe(1); await fixture.bridge.stop(); await wait(5); expect(await fixture.clientProvider.discoverDirectReachability('destination')).toHaveLength(0); await fixture.clientProvider.stop(); expect(fixture.clientProvider.diagnostics().activeSessions).toBe(0); await fixture.bridgeFabric.stop(); await fixture.destinationFabric.stop();
  });

  it('uses one bounded alternate anonymous gateway when the first wider path disappears', async () => {
    const network = new ControlledGatewayNetwork(); const clientSource = new ControlledGatewaySource(network, 'client-failover'); const firstSource = new ControlledGatewaySource(network, 'first-gateway'); const secondSource = new ControlledGatewaySource(network, 'second-gateway'); network.connect(clientSource, firstSource); network.connect(clientSource, secondSource);
    const firstUpstream = new ControlledTransportProvider('first-upstream'); const secondUpstream = new ControlledTransportProvider('second-upstream'); const destination = new ControlledTransportProvider('failover-destination'); secondUpstream.connectPeer('failover-destination', destination);
    const firstFabric = new ConnectivityFabric(); firstFabric.registerProvider(firstUpstream); const secondFabric = new ConnectivityFabric(); secondFabric.registerProvider(secondUpstream); const destinationFabric = new ConnectivityFabric(); destinationFabric.registerProvider(destination);
    const firstBridge = new GatewayBridge({ source: firstSource, upstream: firstFabric, providerId: 'first-bridge' }); const secondBridge = new GatewayBridge({ source: secondSource, upstream: secondFabric, providerId: 'second-bridge' }); const client = new GatewayMeshTransportProvider({ source: clientSource, providerId: 'failover-client' }); const clientFabric = new ConnectivityFabric(); clientFabric.registerProvider(client);
    await destinationFabric.start(); await firstFabric.start(); await secondFabric.start(); await firstBridge.start(); await secondBridge.start(); await clientFabric.start(); let deliveredId = ''; destinationFabric.onOpaqueEnvelope(value => { deliveredId = value.id; });
    const endpoints = await client.discoverDirectReachability('failover-destination'); expect(endpoints).toHaveLength(2); const session = await client.openSession(endpoints[0]!); firstFabric.removeProvider(firstUpstream.id); await firstFabric.stop(); const value = await envelope('failover-destination', 'bounded-failover-marker'); await client.sendOpaqueFrame(session, value); await wait(10); expect(deliveredId).toBe(value.id); expect(client.diagnostics().routeCount).toBeGreaterThanOrEqual(1);
    await clientFabric.stop(); await firstBridge.stop(); await secondBridge.stop(); await firstFabric.stop(); await secondFabric.stop(); await destinationFabric.stop();
  });

  it('keeps generated gateway churn bounded across more than fifty anonymous clients', async () => {
    const network = new ControlledGatewayNetwork();
    const bridgeSource = new ControlledGatewaySource(network, 'churn-gateway');
    const upstream = new ControlledTransportProvider('churn-upstream');
    const destination = new ControlledTransportProvider('churn-destination');
    upstream.connectPeer(destination.id, destination);
    destination.connectPeer(upstream.id, upstream);
    const upstreamFabric = new ConnectivityFabric();
    upstreamFabric.registerProvider(upstream);
    const destinationFabric = new ConnectivityFabric();
    destinationFabric.registerProvider(destination);
    const bridge = new GatewayBridge({ source: bridgeSource, upstream: upstreamFabric, providerId: 'churn-bridge', limits: { maxClients: 64, maxCircuits: 64, maxFramesPerClient: 4 } });
    const received = new Set<string>();
    destinationFabric.onOpaqueEnvelope(value => { received.add(value.id); });
    await upstreamFabric.start(); await destinationFabric.start(); await bridge.start();
    const clients: Array<{ readonly fabric: ConnectivityFabric; readonly provider: GatewayMeshTransportProvider }> = [];
    for (let index = 0; index < 60; index += 1) {
      const source = new ControlledGatewaySource(network, `churn-client-${index}`);
      network.connect(source, bridgeSource);
      const provider = new GatewayMeshTransportProvider({ source, providerId: `churn-client-${index}` });
      const fabric = new ConnectivityFabric(); fabric.registerProvider(provider); await fabric.start();
      const endpoints = await provider.discoverDirectReachability(destination.id);
      expect(endpoints).toHaveLength(1);
      const session = await provider.openSession(endpoints[0]!);
      const value = await envelope(destination.id, `churn-${index}`);
      await provider.sendOpaqueFrame(session, value);
      clients.push({ fabric, provider });
    }
    await wait(10);
    expect(received.size).toBe(60);
    expect(bridge.diagnostics().activeClients).toBeLessThanOrEqual(64);
    expect(bridge.diagnostics().activeCircuits).toBeLessThanOrEqual(64);
    for (const client of clients) await client.fabric.stop();
    // The anonymous source has no peer-close callback; bridge-side idle
    // expiry bounds stale client state.  A full bridge shutdown must still
    // release every session/listener immediately.
    await bridge.stop();
    expect(bridge.diagnostics().activeClients).toBe(0);
    expect(bridge.diagnostics().activeCircuits).toBe(0);
    await upstreamFabric.stop(); await destinationFabric.stop();
  });

  it('does not expose gateway construction or transport branches to application messaging', async () => {
    const source = await import('node:fs/promises'); const path = new URL('./social/messaging.ts', import.meta.url); const contents = await source.readFile(path, 'utf8'); expect(contents).not.toMatch(/GatewayMeshTransportProvider|GatewayBridge|gateway\.proxy|openTcp|openUdp|fetchUrlForPeer|proxyHttpRequest|rawSocketForward/);
  });

  it('keeps capability shape anonymous and bounded', () => {
    const capability: GatewayCapability = { version: 1, token: 'gateway-capability:abcdefghijklmnopqrstuvwxyz', expiresAt: new Date(Date.now() + 60_000).toISOString(), pathClass: 'WIDER_REACHABILITY_AVAILABLE', profiles: ['CONTROL', 'INTERACTIVE'], metered: 'UNKNOWN', resourceProfile: 'BALANCED', maxFrameBytes: 256 * 1024, maxUses: 16 };
    expect(JSON.stringify(capability)).not.toMatch(/identity|profileName|username|device|hostname|ip|mac|ssid|gps|owner|social/i);
  });
});
