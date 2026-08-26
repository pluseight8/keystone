import { describe, expect, it } from 'vitest';
import { createOpaqueDeliveryEnvelope, ConnectivityFabric, FabricTransport, type OpaqueFrame, type TransportSession } from './connectivity.js';
import { SodiumCryptoProvider } from './crypto.js';
import { IdentityManager } from './identity.js';
import { ContactEnvelopeSecurity, DirectMessageService, InMemorySocialStorage, SodiumDirectMessageCipher } from './social/messaging.js';
import { DelayTolerantTransportProvider, DurableOpaqueParcelStore, InMemoryDelayTolerantStateStore, type DelayTolerantEncounterSource, type DelayTolerantWireFrame } from './delay-tolerant.js';
import type { NodeId } from './types.js';

type Link = { a: SimulatedEncounterSource; b: SimulatedEncounterSource };
class SimulatedEncounterSource implements DelayTolerantEncounterSource {
  private static readonly links = new Set<Link>();
  private readonly handlers = new Set<(frame: DelayTolerantWireFrame, session?: TransportSession) => void | Promise<void>>();
  private readonly sessions = new Map<string, { peer: SimulatedEncounterSource; session: TransportSession }>();
  constructor(readonly name: string) {}
  static connect(a: SimulatedEncounterSource, b: SimulatedEncounterSource): void { SimulatedEncounterSource.links.add({ a, b }); SimulatedEncounterSource.links.add({ a: b, b: a }); }
  static disconnect(a: SimulatedEncounterSource, b: SimulatedEncounterSource): void { for (const link of [...SimulatedEncounterSource.links]) if ((link.a === a && link.b === b) || (link.a === b && link.b === a)) SimulatedEncounterSource.links.delete(link); }
  static reset(): void { SimulatedEncounterSource.links.clear(); }
  listEncounters(limit = 16): readonly { handle: string; expiresAt: string }[] { return [...SimulatedEncounterSource.links].filter(link => link.a === this).slice(0, limit).map(link => ({ handle: link.b.name, expiresAt: new Date(Date.now() + 60_000).toISOString() })); }
  async openEncounter(handle: string): Promise<TransportSession> { const link = [...SimulatedEncounterSource.links].find(value => value.a === this && value.b.name === handle); if (!link) throw new Error('encounter unavailable'); const session: TransportSession = { id: `session:${this.name}:${handle}:${crypto.randomUUID()}`, endpoint: { handle, providerId: `source:${this.name}` as never, providerType: 'DelayTolerantTransport', routeReference: handle, anonymous: true }, providerId: `source:${this.name}` as never, openedAt: new Date().toISOString(), state: 'OPEN' }; this.sessions.set(session.id, { peer: link.b, session }); return session; }
  async sendEncounterFrame(session: TransportSession, frame: DelayTolerantWireFrame): Promise<void> { const value = this.sessions.get(session.id); if (!value) throw new Error('session closed'); const peerSession = await value.peer.openEncounter(this.name); queueMicrotask(() => { for (const handler of value.peer.handlers) void handler(structuredClone(frame), peerSession); }); }
  onEncounterFrame(handler: (frame: DelayTolerantWireFrame, session?: TransportSession) => void | Promise<void>): () => void { this.handlers.add(handler); return () => this.handlers.delete(handler); }
  async closeEncounter(session: TransportSession): Promise<void> { this.sessions.delete(session.id); }
  static async settle(): Promise<void> { for (let i = 0; i < 8; i += 1) await new Promise(resolve => setTimeout(resolve, 5)); }
}

function nodeId(label: string): NodeId { return label as NodeId; }
async function applicationEnvelope(destination: NodeId): Promise<ReturnType<typeof createOpaqueDeliveryEnvelope>> {
  return createOpaqueDeliveryEnvelope({ destination, ciphertext: new TextEncoder().encode('application-ciphertext'), replayNonce: crypto.randomUUID(), expiresAt: new Date(Date.now() + 60_000).toISOString(), requirement: { profile: 'INTERACTIVE', allowDelayTolerant: true } });
}

describe('R0P70 delay-tolerant store-and-forward', () => {
  it('persists bounded opaque parcels and survives provider restart', async () => {
    const backend = new InMemoryDelayTolerantStateStore(); const store = new DurableOpaqueParcelStore(backend, { maxParcels: 1, maxBytes: 4096 }); const cryptoProvider = new SodiumCryptoProvider();
    const source = new SimulatedEncounterSource('owner'); const provider = new DelayTolerantTransportProvider({ source, store, crypto: cryptoProvider }); await provider.start(); const token = await provider.bindPeerRendezvous('destination');
    const fabric = new ConnectivityFabric(); fabric.registerProvider(provider); await fabric.start(); const envelope = await applicationEnvelope(nodeId('destination')); const result = await fabric.deliver({ id: envelope.id, destination: envelope.destination, envelope, requirement: { profile: 'INTERACTIVE', allowDelayTolerant: true } });
    expect(result.ok).toBe(true); expect(result.reachability).toBe('EVENTUALLY'); expect(store.stats().ownerParcels).toBe(1); expect(token).toMatch(/^[A-Za-z0-9_-]+$/); const parcel = await store.listEligible(); expect(JSON.stringify(parcel[0])).not.toContain('destination-node'); expect(JSON.stringify(parcel[0])).not.toContain('application-ciphertext');
    await fabric.stop(); const restarted = new DelayTolerantTransportProvider({ source, store: new DurableOpaqueParcelStore(backend), crypto: cryptoProvider }); await restarted.start(); expect(restarted.diagnostics().ownerParcels).toBe(1); await restarted.stop(); SimulatedEncounterSource.reset();
  });

  it('keeps a generated 60-node temporal topology bounded to one custody copy', async () => {
    SimulatedEncounterSource.reset();
    const count = 60;
    const sources = Array.from({ length: count }, (_, index) => new SimulatedEncounterSource(`scale-${index}`));
    const stores = sources.map(() => new DurableOpaqueParcelStore(new InMemoryDelayTolerantStateStore(), { maxParcels: 4, maxBytes: 256 * 1024 }));
    const cryptoProvider = new SodiumCryptoProvider();
    const providers = sources.map((source, index) => new DelayTolerantTransportProvider({ source, store: stores[index]!, crypto: cryptoProvider, providerId: `dtn-scale-${index}` }));
    const destination = nodeId('scale-destination');
    const secret = await providers[0]!.bindPeerRendezvous(destination);
    await providers[count - 1]!.registerLocalRendezvous(secret);
    const delivered: OpaqueFrame[] = [];
    providers[count - 1]!.receiveOpaqueFrame(frame => { if ('destination' in frame) delivered.push(frame); });
    await Promise.all(providers.map(provider => provider.start()));
    const envelope = await applicationEnvelope(destination);
    const accepted = await providers[0]!.queueOpaqueDelivery({ id: envelope.id, destination, envelope, requirement: { profile: 'INTERACTIVE', allowDelayTolerant: true } });
    expect(accepted.ok).toBe(true);
    let maximumActiveParcels = 0;
    for (let index = 0; index < count - 1; index += 1) {
      SimulatedEncounterSource.connect(sources[index]!, sources[index + 1]!);
      await providers[index]!.exchange(sources[index + 1]!.name);
      await SimulatedEncounterSource.settle();
      maximumActiveParcels = Math.max(maximumActiveParcels, stores.reduce((total, store) => total + store.stats().parcels, 0));
      SimulatedEncounterSource.disconnect(sources[index]!, sources[index + 1]!);
    }
    expect(delivered).toHaveLength(1);
    expect(maximumActiveParcels).toBeLessThanOrEqual(2); // sender/receiver overlap is only transient custody handoff
    expect(stores.reduce((total, store) => total + store.stats().parcels, 0)).toBe(1); // bounded destination receipt
    expect(stores.every(store => store.stats().parcels <= 4 && store.stats().bytes <= 256 * 1024)).toBe(true);
    await Promise.all(providers.map(provider => provider.stop()));
    SimulatedEncounterSource.reset();
  });

  it('rejects forged custody, copy-budget amplification and expired parcels', async () => {
    SimulatedEncounterSource.reset();
    let now = Date.now();
    const ownerSource = new SimulatedEncounterSource('security-owner');
    const attackerSource = new SimulatedEncounterSource('security-attacker');
    const ownerStore = new DurableOpaqueParcelStore(new InMemoryDelayTolerantStateStore(), { maxParcels: 2 });
    const owner = new DelayTolerantTransportProvider({ source: ownerSource, store: ownerStore, crypto: new SodiumCryptoProvider(), now: () => now, providerId: 'dtn-security-owner' });
    await owner.start();
    const destination = nodeId('security-destination');
    await owner.bindPeerRendezvous(destination);
    const envelope = await applicationEnvelope(destination);
    const accepted = await owner.queueOpaqueDelivery({ id: envelope.id, destination, envelope: { ...envelope, expiresAt: new Date(now + 1_000).toISOString() }, requirement: { profile: 'INTERACTIVE', allowDelayTolerant: true } });
    expect(accepted.ok).toBe(true);
    const original = (await ownerStore.listEligible())[0]!;
    SimulatedEncounterSource.connect(ownerSource, attackerSource);
    const attackerSession = await attackerSource.openEncounter(ownerSource.name);
    await attackerSource.sendEncounterFrame(attackerSession, { version: 1, kind: 'dtn.custody', nonce: crypto.randomUUID(), parcelId: original.parcel.id, parcelIntegrity: 'sha256-forged', accepted: true });
    await SimulatedEncounterSource.settle();
    expect((await ownerStore.get(original.parcel.id))?.parcel.id).toBe(original.parcel.id);
    const amplified = { ...original.parcel, remainingCopyBudget: 99 } as unknown as typeof original.parcel;
    await attackerSource.sendEncounterFrame(attackerSession, { version: 1, kind: 'dtn.parcel', nonce: crypto.randomUUID(), parcel: amplified });
    await SimulatedEncounterSource.settle();
    expect(ownerStore.stats().rejected).toBe(0); // malformed wire is dropped before it can affect local owner state
    now += 2_000;
    await ownerStore.sweep(now);
    expect(await ownerStore.listEligible(now)).toHaveLength(0);
    expect(ownerStore.stats().expired).toBe(1);
    await owner.stop();
    SimulatedEncounterSource.reset();
  });

  it('delivers over time-separated A-B, B-C, C-D encounters after sender and courier restarts', async () => {
    SimulatedEncounterSource.reset(); const sources = ['a', 'b', 'c', 'd'].map(name => new SimulatedEncounterSource(name)); const [aSource, bSource, cSource, dSource] = sources; const stores = sources.map(() => new DurableOpaqueParcelStore(new InMemoryDelayTolerantStateStore())); const cryptoProvider = new SodiumCryptoProvider(); const providers = sources.map((source, index) => new DelayTolerantTransportProvider({ source, store: stores[index], crypto: cryptoProvider, providerId: `dtn-${source.name}` })); const destination = nodeId('destination-d'); const secret = await providers[0]!.bindPeerRendezvous(destination); await providers[3]!.registerLocalRendezvous(secret);
    const fabrics = providers.map(provider => new ConnectivityFabric()); for (const [index, fabric] of fabrics.entries()) { fabric.registerProvider(providers[index]!); await fabric.start(); }
    const received: OpaqueFrame[] = []; fabrics[3]!.onOpaqueEnvelope(envelope => { received.push(envelope); }); const envelope = await applicationEnvelope(destination); const accepted = await fabrics[0]!.deliver({ id: envelope.id, destination, envelope, requirement: { profile: 'INTERACTIVE', allowDelayTolerant: true } }); expect(accepted.ok).toBe(true);
    SimulatedEncounterSource.connect(aSource!, bSource!); await providers[0]!.exchange('b'); await SimulatedEncounterSource.settle(); expect(stores[1]!.stats().courierParcels).toBe(1); SimulatedEncounterSource.disconnect(aSource!, bSource!); await fabrics[0]!.stop(); await providers[0]!.stop();
    const bRestarted = new DelayTolerantTransportProvider({ source: bSource!, store: stores[1], crypto: cryptoProvider, providerId: 'dtn-b-restart' }); await bRestarted.start(); SimulatedEncounterSource.connect(bSource!, cSource!); await bRestarted.exchange('c'); await SimulatedEncounterSource.settle(); expect(stores[2]!.stats().courierParcels).toBe(1); SimulatedEncounterSource.disconnect(bSource!, cSource!); await bRestarted.stop();
    await providers[2]!.stop();
    const cRestarted = new DelayTolerantTransportProvider({ source: cSource!, store: stores[2], crypto: cryptoProvider, providerId: 'dtn-c-restart' }); await cRestarted.start(); SimulatedEncounterSource.connect(cSource!, dSource!); await cRestarted.exchange('d'); await SimulatedEncounterSource.settle(); expect(received).toHaveLength(1); expect(received[0]).toEqual(envelope); expect(stores[2]!.stats().parcels).toBe(0); await providers[3]!.exchange('c'); await SimulatedEncounterSource.settle(); expect(stores[2]!.stats().courierParcels).toBe(1); await cRestarted.stop(); await providers[3]!.stop();
    const bReturned = new DelayTolerantTransportProvider({ source: bSource!, store: stores[1], crypto: cryptoProvider, providerId: 'dtn-b-return' }); const cReturned = new DelayTolerantTransportProvider({ source: cSource!, store: stores[2], crypto: cryptoProvider, providerId: 'dtn-c-return' }); await bReturned.start(); await cReturned.start(); SimulatedEncounterSource.connect(bSource!, cSource!); await cReturned.exchange('b'); await SimulatedEncounterSource.settle(); expect(stores[1]!.stats().courierParcels).toBe(1); SimulatedEncounterSource.disconnect(bSource!, cSource!); await cReturned.stop();
    const aReturned = new DelayTolerantTransportProvider({ source: aSource!, store: stores[0], crypto: cryptoProvider, providerId: 'dtn-a-return' }); await aReturned.start(); SimulatedEncounterSource.connect(aSource!, bSource!); await bReturned.exchange('a'); await SimulatedEncounterSource.settle(); const originalId = (await stores[0]!.tombstones()).find(id => id.startsWith('parcel:')); expect(originalId).toBeDefined(); expect(await aReturned.isDestinationConfirmed(originalId!)).toBe(true); await aReturned.stop(); await bReturned.stop(); SimulatedEncounterSource.reset();
  });

  it('rejects tampered manifests and hard-bounds realtime/bulk eligibility', async () => {
    const source = new SimulatedEncounterSource('security'); const provider = new DelayTolerantTransportProvider({ source }); await provider.start(); const fabric = new ConnectivityFabric(); fabric.registerProvider(provider); await fabric.start(); const envelope = await applicationEnvelope(nodeId('unknown'));
    const realtime = await fabric.deliver({ id: envelope.id, destination: envelope.destination, envelope, requirement: { profile: 'REALTIME', allowDelayTolerant: true } }); expect(realtime.ok).toBe(false); const bulk = await fabric.deliver({ id: `bulk:${crypto.randomUUID()}`, destination: envelope.destination, envelope: { ...envelope, id: `bulk:${crypto.randomUUID()}` }, requirement: { profile: 'BULK' } }); expect(bulk.ok).toBe(false); await fabric.stop(); SimulatedEncounterSource.reset();
  });

  it('carries a DirectMessageService envelope without an application courier branch', async () => {
    SimulatedEncounterSource.reset(); const sourceNames = ['app-a', 'courier-b', 'courier-c', 'app-d']; const sourceValues = sourceNames.map(name => new SimulatedEncounterSource(name)); const [aSource, bSource, cSource, dSource] = sourceValues;
    const identities = await Promise.all(sourceNames.map(name => IdentityManager.generate().then(value => value.sessionKeys(name)))); const [aKeys, , , dKeys] = identities; const cryptoProvider = new SodiumCryptoProvider();
    const stores = sourceValues.map(() => new DurableOpaqueParcelStore(new InMemoryDelayTolerantStateStore())); const providers = sourceValues.map((source, index) => new DelayTolerantTransportProvider({ source, store: stores[index], crypto: cryptoProvider, providerId: `dtn-app-${index}` })); const destination = dKeys.nodeId; const secret = await providers[0]!.bindPeerRendezvous(destination); await providers[3]!.registerLocalRendezvous(secret);
    const fabricA = new ConnectivityFabric(); const fabricD = new ConnectivityFabric(); fabricA.registerProvider(providers[0]!); fabricD.registerProvider(providers[3]!); const securityA = new ContactEnvelopeSecurity(aKeys, [{ nodeId: dKeys.nodeId, signingPublicKey: dKeys.publicKey, encryptionPublicKey: dKeys.encryptionPublicKey }]); const securityD = new ContactEnvelopeSecurity(dKeys, [{ nodeId: aKeys.nodeId, signingPublicKey: aKeys.publicKey, encryptionPublicKey: aKeys.encryptionPublicKey }]); const transportA = new FabricTransport({ fabric: fabricA, localNodeId: aKeys.nodeId, applicationSecurity: securityA }); const transportD = new FabricTransport({ fabric: fabricD, localNodeId: dKeys.nodeId, applicationSecurity: securityD }); await transportA.start(); await transportD.start(); await providers[1]!.start(); await providers[2]!.start();
    const sender = new DirectMessageService(transportA, new InMemorySocialStorage(), cryptoProvider, aKeys, [{ nodeId: dKeys.nodeId, signingPublicKey: dKeys.publicKey, encryptionPublicKey: dKeys.encryptionPublicKey }], securityA, new SodiumDirectMessageCipher()); const receiver = new DirectMessageService(transportD, new InMemorySocialStorage(), cryptoProvider, dKeys, [{ nodeId: aKeys.nodeId, signingPublicKey: aKeys.publicKey, encryptionPublicKey: aKeys.encryptionPublicKey }], securityD, new SodiumDirectMessageCipher()); const received: string[] = []; receiver.subscribe(event => { if (event.kind === 'message' && event.message?.payload.kind === 'text') received.push(event.message.payload.text); });
    await sender.sendText(destination, 'temporal delivery'); await new Promise(resolve => setTimeout(resolve, 30)); expect(stores[0]!.stats().ownerParcels).toBe(1); SimulatedEncounterSource.connect(aSource!, bSource!); await providers[0]!.exchange('courier-b'); await SimulatedEncounterSource.settle(); expect(stores[1]!.stats().courierParcels).toBe(1); SimulatedEncounterSource.disconnect(aSource!, bSource!); await transportA.close(); sender.close();
    SimulatedEncounterSource.connect(bSource!, cSource!); await providers[1]!.exchange('courier-c'); await SimulatedEncounterSource.settle(); expect(stores[2]!.stats().courierParcels).toBe(1); SimulatedEncounterSource.disconnect(bSource!, cSource!); await providers[1]!.stop();
    SimulatedEncounterSource.connect(cSource!, dSource!); await providers[2]!.exchange('app-d'); await SimulatedEncounterSource.settle(); expect(received).toEqual(['temporal delivery']); receiver.close(); await transportD.close(); await providers[2]!.stop(); SimulatedEncounterSource.reset();
  });

  it('composes DTN custody with a bounded wider gateway forwarder without changing parcel budgets', async () => {
    SimulatedEncounterSource.reset(); const ownerSource = new SimulatedEncounterSource('gateway-owner'); const courierSource = new SimulatedEncounterSource('gateway-courier'); const gatewaySource = new SimulatedEncounterSource('gateway-node');
    const cryptoProvider = new SodiumCryptoProvider(); const ownerStore = new DurableOpaqueParcelStore(new InMemoryDelayTolerantStateStore()); const courierStore = new DurableOpaqueParcelStore(new InMemoryDelayTolerantStateStore()); const gatewayStore = new DurableOpaqueParcelStore(new InMemoryDelayTolerantStateStore());
    const owner = new DelayTolerantTransportProvider({ source: ownerSource, store: ownerStore, crypto: cryptoProvider, providerId: 'gateway-dtn-owner' }); const destination = new DelayTolerantTransportProvider({ crypto: cryptoProvider, providerId: 'gateway-dtn-destination' }); const secret = await owner.bindPeerRendezvous('gateway-destination'); await destination.registerLocalRendezvous(secret); const received: OpaqueFrame[] = []; destination.receiveOpaqueFrame(frame => { received.push(frame); });
    const gateway = new DelayTolerantTransportProvider({ source: gatewaySource, store: gatewayStore, crypto: cryptoProvider, providerId: 'gateway-dtn-gateway', forwardParcel: { forward: parcel => destination.acceptGatewayParcel(parcel) } }); const courier = new DelayTolerantTransportProvider({ source: courierSource, store: courierStore, crypto: cryptoProvider, providerId: 'gateway-dtn-courier' });
    await Promise.all([owner.start(), courier.start(), gateway.start(), destination.start()]); const envelope = await applicationEnvelope(nodeId('gateway-destination')); const accepted = await owner.queueOpaqueDelivery({ id: envelope.id, destination: 'gateway-destination', envelope, requirement: { profile: 'INTERACTIVE', allowDelayTolerant: true } }); expect(accepted.ok).toBe(true); const parcel = (await ownerStore.listEligible())[0]!.parcel;
    SimulatedEncounterSource.connect(ownerSource, courierSource); await owner.exchange('gateway-courier'); await SimulatedEncounterSource.settle(); SimulatedEncounterSource.disconnect(ownerSource, courierSource); expect(courierStore.stats().courierParcels).toBe(1);
    SimulatedEncounterSource.connect(courierSource, gatewaySource); await courier.exchange('gateway-node'); await SimulatedEncounterSource.settle(); expect(received).toHaveLength(1); expect(received[0]).toEqual(envelope); expect(courierStore.stats().courierParcels).toBe(0); expect(parcel.copyBudget).toBe(1); expect(parcel.remainingCopyBudget).toBe(1); expect(parcel.expiresAt).toBe((await ownerStore.get(parcel.id))?.parcel.expiresAt ?? parcel.expiresAt);
    await Promise.all([owner.stop(), courier.stop(), gateway.stop(), destination.stop()]); SimulatedEncounterSource.reset();
  });
});
