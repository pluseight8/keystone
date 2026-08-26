import { createSocket } from 'node:dgram';
import { describe, expect, it } from 'vitest';
import DHT from 'hyperdht';
import Hyperswarm from 'hyperswarm';
import { IdentityManager, type DeviceSessionKeys } from '../identity.js';
import { ContactEnvelopeSecurity, DirectMessageService, InMemorySocialStorage, SodiumDirectMessageCipher, type SocialContact } from '../social/messaging.js';
import { ConnectivityFabric, ControlledTransportProvider, createOpaqueDeliveryEnvelope, FabricTransport, HyperswarmTransportProvider, type OpaqueFrame, type TransportEndpoint, type TransportSession } from '../connectivity.js';
import { SodiumCryptoProvider } from '../crypto.js';
import { HyperswarmTransport } from '../transport.js';
import { GatewayBridge, GatewayMeshTransportProvider } from '../gateway.js';
import type { AnonymousNeighborSessionSource } from '../mesh-routing.js';

class LocalGatewaySourceNetwork {
  readonly transcript: OpaqueFrame[] = [];
  connect(a: LocalGatewaySource, b: LocalGatewaySource): void { a.connect(b); b.connect(a); }
}

class LocalGatewaySource implements AnonymousNeighborSessionSource {
  private readonly peers = new Map<string, LocalGatewaySource>();
  private readonly listeners = new Set<(frame: OpaqueFrame, session?: TransportSession) => void | Promise<void>>();
  private readonly sessions = new Map<string, { readonly local: TransportSession; readonly remote: TransportSession; readonly peer: LocalGatewaySource }>();
  constructor(private readonly network: LocalGatewaySourceNetwork, private readonly name: string) {}
  connect(peer: LocalGatewaySource): void { this.peers.set(`anon-${peer.name}`, peer); }
  listNeighbors(limit = 16): readonly { readonly handle: string; readonly expiresAt: string }[] { return [...this.peers.keys()].slice(0, limit).map(handle => ({ handle, expiresAt: new Date(Date.now() + 60_000).toISOString() })); }
  async openNeighbor(handle: string): Promise<TransportSession> { const peer = this.peers.get(handle); if (!peer) throw new Error('anonymous peer unavailable'); const local: TransportSession = { id: `${this.name}:${crypto.randomUUID()}`, endpoint: { handle, providerId: this.name as never, providerType: 'ExternalRadioTransport', routeReference: handle, anonymous: true }, providerId: this.name as never, openedAt: new Date().toISOString(), state: 'OPEN' }; const remote: TransportSession = { id: `${peer.name}:${crypto.randomUUID()}`, endpoint: { handle: `anon-${this.name}`, providerId: peer.name as never, providerType: 'ExternalRadioTransport', routeReference: `anon-${this.name}`, anonymous: true }, providerId: peer.name as never, openedAt: new Date().toISOString(), state: 'OPEN' }; this.sessions.set(local.id, { local, remote, peer }); peer.sessions.set(remote.id, { local: remote, remote: local, peer: this }); return local; }
  async sendNeighborFrame(session: TransportSession, frame: OpaqueFrame): Promise<void> { const value = this.sessions.get(session.id); if (!value) throw new Error('anonymous session unavailable'); this.network.transcript.push(structuredClone(frame)); queueMicrotask(() => value.peer.emit(frame, value.remote)); }
  onNeighborFrame(handler: (frame: OpaqueFrame, session?: TransportSession) => void | Promise<void>): () => void { this.listeners.add(handler); return () => this.listeners.delete(handler); }
  async closeNeighborSession(session: TransportSession): Promise<void> { const value = this.sessions.get(session.id); if (!value) return; this.sessions.delete(session.id); value.peer.sessions.delete(value.remote.id); }
  async start(): Promise<void> {}
  async stop(): Promise<void> { for (const value of [...this.sessions.values()]) await this.closeNeighborSession(value.local); }
  private emit(frame: OpaqueFrame, session: TransportSession): void { for (const listener of this.listeners) void listener(structuredClone(frame), session); }
}

function contact(keys: DeviceSessionKeys): SocialContact { return { nodeId: keys.nodeId, signingPublicKey: keys.publicKey, encryptionPublicKey: keys.encryptionPublicKey }; }
async function freeUdpPort(): Promise<number> { const socket = createSocket('udp4'); await new Promise<void>((resolve, reject) => { socket.once('error', reject); socket.bind(0, '127.0.0.1', () => resolve()); }); const address = socket.address(); socket.close(); return typeof address === 'string' ? 0 : address.port; }

describe('R0P71 real wider-leg gateway validation', () => {
  it('carries an opaque envelope from a no-Internet client over a real Hyperswarm/Noise wider leg', async () => {
    const port = await freeUdpPort(); const bootstrap = DHT.bootstrapper(port, '127.0.0.1');
    const bridgeKeys = await (await IdentityManager.generate()).sessionKeys('gateway-bridge'); const destinationKeys = await (await IdentityManager.generate()).sessionKeys('gateway-destination');
    const bridgeSecurity = new ContactEnvelopeSecurity(bridgeKeys, [contact(destinationKeys)]); const destinationSecurity = new ContactEnvelopeSecurity(destinationKeys, [contact(bridgeKeys)]);
    const bridgeRaw = new HyperswarmTransport(Buffer.from(bridgeKeys.publicKey, 'base64url'), () => new Hyperswarm({ dht: new DHT({ bootstrap: [`127.0.0.1:${port}`] }) })); const destinationRaw = new HyperswarmTransport(Buffer.from(destinationKeys.publicKey, 'base64url'), () => new Hyperswarm({ dht: new DHT({ bootstrap: [`127.0.0.1:${port}`] }) }));
    const bridgeFabric = new ConnectivityFabric(); bridgeFabric.registerProvider(new HyperswarmTransportProvider(bridgeRaw, { sender: bridgeKeys.nodeId, security: bridgeSecurity, ownsTransport: true })); const destinationFabric = new ConnectivityFabric(); destinationFabric.registerProvider(new HyperswarmTransportProvider(destinationRaw, { sender: destinationKeys.nodeId, security: destinationSecurity, ownsTransport: true }));
    const localNetwork = new LocalGatewaySourceNetwork(); const clientSource = new LocalGatewaySource(localNetwork, 'client'); const bridgeSource = new LocalGatewaySource(localNetwork, 'bridge'); localNetwork.connect(clientSource, bridgeSource);
    const bridge = new GatewayBridge({ source: bridgeSource, upstream: bridgeFabric, providerId: 'real-gateway-bridge' }); const clientProvider = new GatewayMeshTransportProvider({ source: clientSource, providerId: 'real-gateway-client' }); const clientFabric = new ConnectivityFabric(); clientFabric.registerProvider(clientProvider);
    // Hybrid proof: a second controlled candidate is visible to the same
    // Fabric, but its measured quality is deliberately worse. The real
    // gateway/wider-leg candidate must be selected without application route
    // branching; the controlled provider remains an ordinary low-level peer.
    const controlledFallback = new ControlledTransportProvider('controlled-fallback');
    clientFabric.registerProvider(controlledFallback);
    clientFabric.routeOptimizer.recordMeasurement({ destination: destinationKeys.nodeId, providerId: controlledFallback.id, metrics: { rttMs: 500, lossRatio: 0.4, stability: 0.2, throughputBytesPerSecond: 10_000, mtu: controlledFallback.mtu, cost: 'UNKNOWN', energy: 'LOW', metered: false, observedAt: new Date().toISOString() }, outcome: 'FORWARDED' });
    clientFabric.routeOptimizer.recordMeasurement({ destination: destinationKeys.nodeId, providerId: clientProvider.id, metrics: { rttMs: 20, lossRatio: 0.01, stability: 0.95, throughputBytesPerSecond: 1_000_000, mtu: clientProvider.mtu, cost: 'UNKNOWN', energy: 'MEDIUM', metered: false, observedAt: new Date().toISOString() }, outcome: 'FORWARDED' });
    const received: string[] = []; destinationFabric.onOpaqueEnvelope(value => { received.push(value.id); });
    try {
      await destinationFabric.start(); await bridgeFabric.start(); await bridge.start(); await clientFabric.start();
      const value = await createOpaqueDeliveryEnvelope({ destination: destinationKeys.nodeId, ciphertext: new TextEncoder().encode('REAL_GATEWAY_APPLICATION_CIPHERTEXT_MARKER'), replayNonce: crypto.randomUUID(), expiresAt: new Date(Date.now() + 60_000).toISOString(), requirement: { profile: 'INTERACTIVE' } });
      const started = Date.now(); const result = await clientFabric.deliver({ id: value.id, destination: value.destination, envelope: value, requirement: value.requirement }); const durationMs = Date.now() - started;
      expect(result.ok).toBe(true); expect(result.receipt?.path).toBe('RELAYED_GLOBAL'); expect(result.receipt?.providerId).toBe('real-gateway-client'); await new Promise(resolve => setTimeout(resolve, 50)); expect(received).toContain(value.id); expect(clientFabric.snapshot().internetAvailable).toBe(false); expect(localNetwork.transcript.map(frame => JSON.stringify(frame)).join('\n')).not.toContain('REAL_GATEWAY_APPLICATION_CIPHERTEXT_MARKER'); expect(localNetwork.transcript.map(frame => JSON.stringify(frame)).join('\n')).not.toContain(destinationKeys.nodeId);
      const aliceKeys = await (await IdentityManager.generate()).sessionKeys('gateway-alice'); const aliceAppSecurity = new ContactEnvelopeSecurity(aliceKeys, [contact(destinationKeys)]); const destinationAppSecurity = new ContactEnvelopeSecurity(destinationKeys, [contact(aliceKeys)]); const aliceDelivery = new FabricTransport({ fabric: clientFabric, localNodeId: aliceKeys.nodeId, applicationSecurity: aliceAppSecurity }); const destinationDelivery = new FabricTransport({ fabric: destinationFabric, localNodeId: destinationKeys.nodeId, applicationSecurity: destinationAppSecurity }); const cryptoProvider = new SodiumCryptoProvider(); const aliceMessages = new DirectMessageService(aliceDelivery, new InMemorySocialStorage(), cryptoProvider, aliceKeys, [contact(destinationKeys)], aliceAppSecurity, new SodiumDirectMessageCipher()); const destinationMessages = new DirectMessageService(destinationDelivery, new InMemorySocialStorage(), cryptoProvider, destinationKeys, [contact(aliceKeys)], destinationAppSecurity, new SodiumDirectMessageCipher());
      const sent = await aliceMessages.sendText(destinationKeys.nodeId, 'signed DirectMessage through real gateway'); await aliceMessages.flush(destinationKeys.nodeId); const conversation = await destinationMessages.createConversation(aliceKeys.nodeId); const until = Date.now() + 10_000; while (Date.now() < until && !(await destinationMessages.history(conversation.id)).some(message => message.id === sent.id)) await new Promise(resolve => setTimeout(resolve, 50)); expect((await destinationMessages.history(conversation.id)).some(message => message.id === sent.id)).toBe(true); aliceMessages.close(); destinationMessages.close(); await aliceDelivery.close(); await destinationDelivery.close();
    } finally { await clientFabric.stop(); await bridge.stop(); await bridgeFabric.stop(); await destinationFabric.stop(); await bootstrap.destroy(); }
  }, 120_000);
});
