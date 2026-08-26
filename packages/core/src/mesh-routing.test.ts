import { describe, expect, it } from 'vitest';
import { ConnectivityFabric, FabricTransport, createOpaqueDeliveryEnvelope, type OpaqueDeliveryEnvelope } from './connectivity.js';
import { AnonymousNearbyTransportProvider, ControlledNearbyNetwork } from './nearby.js';
import { AnonymousMeshRouter, AnonymousMultiHopTransportProvider, CompositeAnonymousNeighborSessionSource, createAnonymousNeighborSessionSource, createAnonymousRendezvousToken } from './mesh-routing.js';
import { IdentityManager } from './identity.js';
import { ContactEnvelopeSecurity, DirectMessageService, InMemorySocialStorage, SodiumDirectMessageCipher, type SocialContact } from './social/messaging.js';
import { SodiumCryptoProvider } from './crypto.js';

const tick = () => new Promise(resolve => setTimeout(resolve, 5));

async function edge(name: string) {
  const network = new ControlledNearbyNetwork();
  const left = new AnonymousNearbyTransportProvider({ adapter: network.createAdapter(`${name}-left`), providerId: `${name}-left` });
  const right = new AnonymousNearbyTransportProvider({ adapter: network.createAdapter(`${name}-right`), providerId: `${name}-right` });
  await left.start(); await right.start(); await tick();
  return { network, left, right, leftSource: createAnonymousNeighborSessionSource(left), rightSource: createAnonymousNeighborSessionSource(right), async close() { await left.stop(); await right.stop(); } };
}

async function line() {
  const ab = await edge('ab'); const bc = await edge('bc'); const cd = await edge('cd');
  const routers = [
    new AnonymousMeshRouter(ab.leftSource, { providerId: 'mesh-a', discoveryTimeoutMs: 500, ackTimeoutMs: 500 }),
    new AnonymousMeshRouter(new CompositeAnonymousNeighborSessionSource([ab.rightSource, bc.leftSource]), { providerId: 'mesh-b', discoveryTimeoutMs: 500, ackTimeoutMs: 500 }),
    new AnonymousMeshRouter(new CompositeAnonymousNeighborSessionSource([bc.rightSource, cd.leftSource]), { providerId: 'mesh-c', discoveryTimeoutMs: 500, ackTimeoutMs: 500 }),
    new AnonymousMeshRouter(cd.rightSource, { providerId: 'mesh-d', discoveryTimeoutMs: 500, ackTimeoutMs: 500 }),
  ];
  const providers = routers.map(router => new AnonymousMultiHopTransportProvider(router));
  await Promise.all(providers.map(provider => provider.start()));
  return { routers, providers, edges: [ab, bc, cd], async close() { await Promise.all(providers.map(provider => provider.stop())); await Promise.all([ab.close(), bc.close(), cd.close()]); } };
}

async function diamond() {
  const ab = await edge('diamond-ab'); const ac = await edge('diamond-ac'); const bd = await edge('diamond-bd'); const cd = await edge('diamond-cd');
  const routers = [
    new AnonymousMeshRouter(new CompositeAnonymousNeighborSessionSource([ab.leftSource, ac.leftSource]), { providerId: 'mesh-diamond-a', discoveryTimeoutMs: 500, ackTimeoutMs: 500 }),
    new AnonymousMeshRouter(new CompositeAnonymousNeighborSessionSource([ab.rightSource, bd.leftSource]), { providerId: 'mesh-diamond-b', discoveryTimeoutMs: 500, ackTimeoutMs: 500 }),
    new AnonymousMeshRouter(new CompositeAnonymousNeighborSessionSource([ac.rightSource, cd.leftSource]), { providerId: 'mesh-diamond-c', discoveryTimeoutMs: 500, ackTimeoutMs: 500 }),
    new AnonymousMeshRouter(new CompositeAnonymousNeighborSessionSource([bd.rightSource, cd.rightSource]), { providerId: 'mesh-diamond-d', discoveryTimeoutMs: 500, ackTimeoutMs: 500 }),
  ];
  const providers = routers.map(router => new AnonymousMultiHopTransportProvider(router));
  await Promise.all(providers.map(provider => provider.start()));
  return { routers, providers, edges: [ab, ac, bd, cd], async close() { await Promise.all(providers.map(provider => provider.stop())); await Promise.all([ab.close(), ac.close(), bd.close(), cd.close()]); } };
}


describe('R0P69 anonymous multi-hop routing', () => {
  it('discovers and delivers an opaque frame over A-B-C-D without an Internet provider', async () => {
    const fixture = await line(); const token = createAnonymousRendezvousToken(); fixture.routers[0]!.bindOpaqueRendezvous('destination-d', token); fixture.routers[3]!.registerLocalRendezvous(token);
    const received: OpaqueDeliveryEnvelope[] = []; fixture.providers[3]!.receiveOpaqueFrame(frame => { if (!('kind' in frame)) { received.push(frame); } });
    const envelope = await createOpaqueDeliveryEnvelope({ destination: 'destination-d', ciphertext: new TextEncoder().encode('application-ciphertext'), replayNonce: crypto.randomUUID(), expiresAt: new Date(Date.now() + 30_000).toISOString(), requirement: { profile: 'INTERACTIVE' } });
    const fabricA = new ConnectivityFabric(); const fabricD = new ConnectivityFabric(); fabricA.registerProvider(fixture.providers[0]!); fabricD.registerProvider(fixture.providers[3]!); await fabricA.start(); await fabricD.start(); fabricD.onOpaqueEnvelope(value => { received.push(value); });
    const result = await fabricA.deliver({ id: envelope.id, destination: envelope.destination, envelope, requirement: { profile: 'INTERACTIVE' } });
    expect(result.ok).toBe(true); expect(result.receipt?.providerId).toBe('mesh-a'); await tick(); expect(received.map(item => item.id)).toContain(envelope.id); expect(fabricA.snapshot().state).toBe('NEARBY_MESH');
    const relayText = fixture.edges.flatMap(item => item.network.transcript()).map(item => new TextDecoder().decode(item.bytes)).join('\n'); expect(relayText).not.toContain('destination-d'); expect(relayText).not.toContain('application-ciphertext');
    await fabricA.stop(); await fabricD.stop(); await fixture.close(); expect(fixture.routers.every(router => router.diagnostics().activeRoutes === 0)).toBe(true);
  });

  it('terminates on bounded duplicate discovery', async () => {
    const fixture = await line(); const token = createAnonymousRendezvousToken(); fixture.routers[0]!.bindOpaqueRendezvous('D', token); fixture.routers[3]!.registerLocalRendezvous(token);
    const endpoint = await fixture.routers[0]!.discover('D'); expect(endpoint).toBeDefined(); expect(fixture.routers[1]!.diagnostics().seenRequests + fixture.routers[2]!.diagnostics().seenRequests).toBeGreaterThan(0); await fixture.routers[0]!.stop(); expect(fixture.routers[0]!.diagnostics().activeRoutes).toBe(0); await fixture.close();
  });

  it('keeps DirectMessageService transport-independent across anonymous relays', async () => {
    const fixture = await line(); const token = createAnonymousRendezvousToken();
    const aliceKeys = await (await IdentityManager.generate()).sessionKeys('mesh-message-a'); const bobKeys = await (await IdentityManager.generate()).sessionKeys('mesh-message-d');
    fixture.routers[0]!.bindOpaqueRendezvous(bobKeys.nodeId, token); fixture.routers[3]!.registerLocalRendezvous(token);
    const aliceContact: SocialContact = { nodeId: bobKeys.nodeId, signingPublicKey: bobKeys.publicKey, encryptionPublicKey: bobKeys.encryptionPublicKey }; const bobContact: SocialContact = { nodeId: aliceKeys.nodeId, signingPublicKey: aliceKeys.publicKey, encryptionPublicKey: aliceKeys.encryptionPublicKey };
    const aliceFabric = new ConnectivityFabric(); const bobFabric = new ConnectivityFabric(); const aliceDelivery = new FabricTransport({ fabric: aliceFabric, localNodeId: aliceKeys.nodeId, applicationSecurity: new ContactEnvelopeSecurity(aliceKeys, [aliceContact]) }); const bobDelivery = new FabricTransport({ fabric: bobFabric, localNodeId: bobKeys.nodeId, applicationSecurity: new ContactEnvelopeSecurity(bobKeys, [bobContact]) });
    aliceFabric.registerProvider(fixture.providers[0]!); bobFabric.registerProvider(fixture.providers[3]!); const cryptoProvider = new SodiumCryptoProvider(); const cipher = new SodiumDirectMessageCipher(); const alice = new DirectMessageService(aliceDelivery, new InMemorySocialStorage(), cryptoProvider, aliceKeys, [aliceContact], new ContactEnvelopeSecurity(aliceKeys, [aliceContact]), cipher); const bob = new DirectMessageService(bobDelivery, new InMemorySocialStorage(), cryptoProvider, bobKeys, [bobContact], new ContactEnvelopeSecurity(bobKeys, [bobContact]), cipher);
    await aliceDelivery.start(); await bobDelivery.start(); const sent = await alice.sendText(bobKeys.nodeId, 'multi-hop protected message'); await alice.flush(bobKeys.nodeId); await tick(); const conversation = await bob.createConversation(aliceKeys.nodeId); expect((await bob.history(conversation.id)).map(value => value.id)).toContain(sent.id);
    await aliceDelivery.close(); await bobDelivery.close(); alice.close(); bob.close(); await fixture.close();
  });

  it('uses one bounded alternate circuit when the selected relay disappears', async () => {
    const fixture = await diamond(); const token = createAnonymousRendezvousToken(); fixture.routers[0]!.bindOpaqueRendezvous('destination-d', token); fixture.routers[3]!.registerLocalRendezvous(token);
    const received: OpaqueDeliveryEnvelope[] = []; fixture.providers[3]!.receiveOpaqueFrame(frame => { if (!('kind' in frame)) received.push(frame); });
    const endpoints = await fixture.providers[0]!.discoverDirectReachability('destination-d', { profile: 'INTERACTIVE' }); expect(endpoints).toHaveLength(1); await new Promise(resolve => setTimeout(resolve, 30));
    expect(fixture.routers[0]!.routeInspection()).toHaveLength(2);
    const primary = (fixture.routers[0] as unknown as { routes: Map<string, { forward?: { providerId: string } }> }).routes.get(endpoints[0]!.routeReference); expect(primary?.forward?.providerId).toBeDefined();
    const failedRelay = primary!.forward!.providerId.includes('diamond-ab-left') ? 1 : 2; await fixture.routers[failedRelay]!.stop();
    const envelope = await createOpaqueDeliveryEnvelope({ destination: 'destination-d', ciphertext: new TextEncoder().encode('alternate-circuit-ciphertext'), replayNonce: crypto.randomUUID(), expiresAt: new Date(Date.now() + 30_000).toISOString(), requirement: { profile: 'INTERACTIVE' } });
    const session = await fixture.providers[0]!.openSession(endpoints[0]!); await fixture.providers[0]!.sendOpaqueFrame(session, envelope); await new Promise(resolve => setTimeout(resolve, 10));
    expect(received.map(item => item.id)).toContain(envelope.id); expect(fixture.routers[0]!.diagnostics().routeFailures).toBeGreaterThan(0);
    await fixture.providers[0]!.close(session); await fixture.close();
  });

  it('rejects a corrupted route frame without reaching the application listener', async () => {
    const fixture = await line(); const token = createAnonymousRendezvousToken(); fixture.routers[0]!.bindOpaqueRendezvous('destination-d', token); fixture.routers[3]!.registerLocalRendezvous(token);
    const received: OpaqueDeliveryEnvelope[] = []; fixture.providers[3]!.receiveOpaqueFrame(frame => { if (!('kind' in frame)) received.push(frame); });
    const endpoint = (await fixture.providers[0]!.discoverDirectReachability('destination-d', { profile: 'INTERACTIVE' }))[0]; expect(endpoint).toBeDefined(); const session = await fixture.providers[0]!.openSession(endpoint!);
    const envelope = await createOpaqueDeliveryEnvelope({ destination: 'destination-d', ciphertext: new TextEncoder().encode('corrupted-route-ciphertext'), replayNonce: crypto.randomUUID(), expiresAt: new Date(Date.now() + 30_000).toISOString(), requirement: { profile: 'INTERACTIVE' } });
    fixture.edges[0]!.network.corruptNextWrite(); await expect(fixture.providers[0]!.sendOpaqueFrame(session, envelope)).rejects.toBeDefined(); expect(received.map(item => item.id)).not.toContain(envelope.id); await fixture.providers[0]!.close(session).catch(() => undefined); await fixture.close();
  });
});
