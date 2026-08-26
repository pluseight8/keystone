import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { NativeBluetoothHost } from '@keystone/native-host';
import { SodiumCryptoProvider } from './crypto.js';
import { ConnectivityFabric, ConnectivityResourceGovernor, ControlledTransportProvider, FabricTransport, createOpaqueDeliveryEnvelope, type OpaqueDeliveryEnvelope } from './connectivity.js';
import { IdentityManager } from './identity.js';
import {
  AnonymousNearbyTransportProvider,
  ControlledNearbyNetwork,
  NEARBY_ADVERTISEMENT_BYTES,
  NEARBY_RESOURCE_PROFILES,
  NativeBluetoothNearbyLinkAdapter,
  NearbyPhysicalVerificationHarness,
  decodeNearbyAdvertisement,
  encodeNearbyAdvertisement,
  type AnonymousNearbyPeerHandle,
  type NearbyEndpointToken,
} from './nearby.js';
import { ContactEnvelopeSecurity, DirectMessageService, InMemorySocialStorage, SodiumDirectMessageCipher, type SocialContact } from './social/messaging.js';

const here = dirname(fileURLToPath(import.meta.url));
const tick = () => new Promise(resolve => setTimeout(resolve, 10));

async function opaque(destination: string, marker = 'opaque-application-marker'): Promise<OpaqueDeliveryEnvelope> {
  return createOpaqueDeliveryEnvelope({ destination, ciphertext: new TextEncoder().encode(marker), replayNonce: crypto.randomUUID(), expiresAt: new Date(Date.now() + 60_000).toISOString(), requirement: { profile: 'INTERACTIVE' } });
}

type PairProviderOptions = Omit<ConstructorParameters<typeof AnonymousNearbyTransportProvider>[0], 'adapter' | 'providerId'> & { readonly providerId?: string };
async function pair(options: { readonly alice?: PairProviderOptions; readonly bob?: PairProviderOptions } = {}) {
  const network = new ControlledNearbyNetwork(); const aliceAdapter = network.createAdapter('nearby-a'); const bobAdapter = network.createAdapter('nearby-b');
  const alice = new AnonymousNearbyTransportProvider({ ...options.alice, adapter: aliceAdapter, providerId: options.alice?.providerId ?? 'nearby-a' });
  const bob = new AnonymousNearbyTransportProvider({ ...options.bob, adapter: bobAdapter, providerId: options.bob?.providerId ?? 'nearby-b' });
  const aliceFabric = new ConnectivityFabric(); const bobFabric = new ConnectivityFabric(); aliceFabric.registerProvider(alice); bobFabric.registerProvider(bob); await aliceFabric.start(); await bobFabric.start(); await tick();
  const bobHandle = alice.developerAnonymousPeers()[0]?.handle; const aliceHandle = bob.developerAnonymousPeers()[0]?.handle; if (!bobHandle || !aliceHandle) throw new Error('controlled nearby discovery failed');
  return { network, aliceAdapter, bobAdapter, alice, bob, aliceFabric, bobFabric, aliceHandle, bobHandle, async close() { await aliceFabric.stop(); await bobFabric.stop(); } };
}

describe('R0P68 anonymous nearby transport', () => {
  it('encodes a legacy-sized advertisement without social/profile/device metadata', async () => {
    const network = new ControlledNearbyNetwork(); const provider = new AnonymousNearbyTransportProvider({ adapter: network.createAdapter(), providerId: 'privacy' }); const identity = await provider.currentIdentity();
    const encoded = encodeNearbyAdvertisement(identity); const decoded = decodeNearbyAdvertisement(encoded); const text = new TextDecoder().decode(encoded);
    expect(encoded).toHaveLength(NEARBY_ADVERTISEMENT_BYTES); expect(decoded.peerHandle).toBe(identity.handle); expect(decoded.protocolVersion).toBe(1);
    expect(text).not.toMatch(/identity|profile|username|device|filename|location|recipient/i); expect(encoded.byteLength).toBeLessThanOrEqual(31); await provider.stop();
  });

  it('rejects malformed, oversized, expired and unknown-version advertisements cheaply', async () => {
    const network = new ControlledNearbyNetwork(); const provider = new AnonymousNearbyTransportProvider({ adapter: network.createAdapter(), providerId: 'malformed' }); const identity = await provider.currentIdentity(); const valid = encodeNearbyAdvertisement(identity);
    expect(() => decodeNearbyAdvertisement(new Uint8Array(64))).toThrow(/size/i); expect(() => decodeNearbyAdvertisement(new Uint8Array(valid).fill(0))).toThrow(/marker/i);
    const version = new Uint8Array(valid); version[2] = 99; expect(() => decodeNearbyAdvertisement(version)).toThrow(/version/i);
    const expired = new Uint8Array(valid); new DataView(expired.buffer).setUint32(4, Math.floor((Date.now() - 1_000) / 1_000)); expect(() => decodeNearbyAdvertisement(expired)).toThrow(/expired/i); await provider.stop();
  });

  it('rotates independent ephemeral identities, expires stale handles and never restores one across restart', async () => {
    let now = Date.now(); const clock = () => now; const network = new ControlledNearbyNetwork(); const provider = new AnonymousNearbyTransportProvider({ adapter: network.createAdapter('rotate-a'), now: clock, identityLifetimeMs: 60_000, rotationOverlapMs: 5_000, peerTtlMs: 10_000 });
    const first = await provider.currentIdentity(); const values = new Set([first.handle]); for (let index = 0; index < 128; index += 1) values.add((await provider.rotateIdentity()).handle); expect(values.size).toBe(129);
    const last = await provider.currentIdentity(); expect(last.handle).not.toBe(first.handle); await provider.stop();
    const restarted = new AnonymousNearbyTransportProvider({ adapter: network.createAdapter('rotate-b'), now: clock, identityLifetimeMs: 60_000, rotationOverlapMs: 5_000 }); expect((await restarted.currentIdentity()).handle).not.toBe(last.handle); now += 120_000; await restarted.stop();
  });

  it('delivers one-hop opaque data without an Internet provider and keeps radio bytes unlinkable to social markers', async () => {
    const fixture = await pair(); fixture.alice.bindOpaqueRendezvous('SOCIAL_DESTINATION_MARKER', fixture.bobHandle); const received: OpaqueDeliveryEnvelope[] = []; fixture.bobFabric.onOpaqueEnvelope(value => { received.push(value); });
    const value = await opaque('SOCIAL_DESTINATION_MARKER', 'PLAINTEXT_OBJECT_MARKER'); const result = await fixture.aliceFabric.deliver({ id: value.id, destination: value.destination, envelope: value, requirement: { profile: 'INTERACTIVE' } }); await tick();
    expect(result.ok).toBe(true); expect(result.receipt?.path).toBe('BLUETOOTH'); expect(received).toHaveLength(1); expect(fixture.aliceFabric.snapshot()).toMatchObject({ internetAvailable: false, state: 'NEARBY' });
    const radio = fixture.network.transcript().map(item => new TextDecoder().decode(item.bytes)).join('\n'); expect(radio).not.toContain('SOCIAL_DESTINATION_MARKER'); expect(radio).not.toContain('PLAINTEXT_OBJECT_MARKER'); await fixture.close();
  });

  it('keeps an established protected session usable across transport-identity rotation', async () => {
    const fixture = await pair(); fixture.alice.bindOpaqueRendezvous('peer', fixture.bobHandle); const endpoints = await fixture.alice.discoverDirectReachability('peer'); const session = await fixture.alice.openSession(endpoints[0]!); const old = await fixture.alice.currentIdentity(); const rotated = await fixture.alice.rotateIdentity(); const received: OpaqueDeliveryEnvelope[] = []; fixture.bob.receiveOpaqueFrame(value => { if (!('kind' in value)) received.push(value); });
    const value = await opaque('peer'); await fixture.alice.sendOpaqueFrame(session, value); expect(rotated.handle).not.toBe(old.handle); expect(received[0]?.id).toBe(value.id); await fixture.alice.close(session); await fixture.close();
  });

  it('fails closed on corrupted handshake, corrupted protected frame and replay', async () => {
    const fixture = await pair({ alice: { handshakeTimeoutMs: 100 } }); fixture.alice.bindOpaqueRendezvous('peer', fixture.bobHandle); let endpoints = await fixture.alice.discoverDirectReachability('peer'); fixture.network.corruptNextWrite(); await expect(fixture.alice.openSession(endpoints[0]!)).rejects.toBeDefined();
    await new Promise(resolve => setTimeout(resolve, 600)); endpoints = await fixture.alice.discoverDirectReachability('peer'); const session = await fixture.alice.openSession(endpoints[0]!); let delivered = 0; fixture.bob.receiveOpaqueFrame(() => { delivered += 1; });
    fixture.network.corruptNextWrite(); await fixture.alice.sendOpaqueFrame(session, await opaque('peer')); expect(delivered).toBe(0); expect(fixture.bob.diagnostics().rejectedFrames).toBeGreaterThan(0); await fixture.close();

    const replayFixture = await pair(); replayFixture.alice.bindOpaqueRendezvous('peer', replayFixture.bobHandle); const replaySession = await replayFixture.alice.openSession((await replayFixture.alice.discoverDirectReachability('peer'))[0]!); let replayDelivered = 0; replayFixture.bob.receiveOpaqueFrame(() => { replayDelivered += 1; }); replayFixture.network.duplicateNextWrite(); await replayFixture.alice.sendOpaqueFrame(replaySession, await opaque('peer')); expect(replayDelivered).toBe(1); expect(replayFixture.bob.diagnostics().replayedFrames).toBe(1); await replayFixture.close();
  });

  it('rejects a captured handshake replay after the original session is closed', async () => {
    const fixture = await pair(); fixture.alice.bindOpaqueRendezvous('peer', fixture.bobHandle); const session = await fixture.alice.openSession((await fixture.alice.discoverDirectReachability('peer'))[0]!); const capturedInit = fixture.network.transcript()[0]?.bytes; expect(capturedInit).toBeDefined(); await fixture.alice.close(session); const rejectedBefore = fixture.bob.diagnostics().rejectedHandshakes;
    const replayChannel = await fixture.aliceAdapter.openChannel('nearby-b' as NearbyEndpointToken); await replayChannel.send(capturedInit!); await tick(); expect(fixture.bob.diagnostics().rejectedHandshakes).toBeGreaterThan(rejectedBefore); await fixture.close();
  });

  it('bounds peers, sessions, advertisement parse work and isolates a malformed stranger', async () => {
    const network = new ControlledNearbyNetwork(); const main = new AnonymousNearbyTransportProvider({ adapter: network.createAdapter('main'), maxPeers: 2, maxSessions: 1, maxAdvertisementParsesPerMinute: 8 }); const mainFabric = new ConnectivityFabric(); mainFabric.registerProvider(main); await mainFabric.start();
    network.advertise('malformed-stranger', new Uint8Array(512));
    const peers: { provider: AnonymousNearbyTransportProvider; fabric: ConnectivityFabric }[] = [];
    for (let index = 0; index < 4; index += 1) { const provider = new AnonymousNearbyTransportProvider({ adapter: network.createAdapter(`peer-${index}`), providerId: `peer-${index}` }); const fabric = new ConnectivityFabric(); fabric.registerProvider(provider); await fabric.start(); peers.push({ provider, fabric }); }
    await tick(); expect(main.diagnostics().discoveredPeerCount).toBe(2); expect(main.diagnostics().rejectedAdvertisements).toBeGreaterThan(0);
    const firstHandle = main.developerAnonymousPeers()[0]!.handle; main.bindOpaqueRendezvous('first', firstHandle); const firstSession = await main.openSession((await main.discoverDirectReachability('first'))[0]!); await expect(main.openSession((await main.discoverDirectReachability('first'))[0]!)).rejects.toThrow(/bound/i); await main.close(firstSession);
    await mainFabric.stop(); for (const peer of peers) await peer.fabric.stop(); expect(main.diagnostics().activeSessionCount).toBe(0);
  });

  it('rejects concurrent handshake exhaustion without starting unbounded work', async () => {
    const fixture = await pair({ alice: { maxActiveHandshakes: 1, handshakeTimeoutMs: 100 } }); fixture.alice.bindOpaqueRendezvous('peer', fixture.bobHandle); const endpoint = (await fixture.alice.discoverDirectReachability('peer'))[0]!; fixture.network.dropNextWrite(); const first = fixture.alice.openSession(endpoint); await Promise.resolve();
    await expect(fixture.alice.openSession(endpoint)).rejects.toThrow(/bound/i); await expect(first).rejects.toThrow(/timed out/i); expect(fixture.alice.diagnostics().activeHandshakeCount).toBe(0); await fixture.close();
  });

  it('applies battery/thermal resource pressure to duty profile and isolates provider failure during Fabric fallback', async () => {
    const resources = new ConnectivityResourceGovernor(); resources.update({ battery: 'LOW', thermal: 'FAIR' }); const network = new ControlledNearbyNetwork(); const nearby = new AnonymousNearbyTransportProvider({ adapter: network.createAdapter('resource-nearby'), providerId: 'resource-nearby', resources, resourceProfile: 'HIGH_AVAILABILITY' });
    const controlled = new ControlledTransportProvider('fallback-controlled'); const controlledPeer = new ControlledTransportProvider('fallback-peer'); controlled.connectPeer('destination', controlledPeer);
    const fabric = new ConnectivityFabric({ maxAttempts: 2 }); fabric.registerProvider(nearby); fabric.registerProvider(controlled); await fabric.start(); expect(nearby.diagnostics().resourceProfile).toBe('BATTERY_SAVER');
    const value = await opaque('destination'); const result = await fabric.deliver({ id: value.id, destination: 'destination', envelope: value, requirement: { profile: 'CONTROL' } }); expect(result.ok).toBe(true); expect(result.attempts[0]?.providerId).toBe('resource-nearby'); expect(result.attempts[0]?.ok).toBe(false); expect(result.receipt?.providerId).toBe('fallback-controlled'); await fabric.stop();
  });

  it('applies nearby profiles live and suspends/resumes discovery under critical host pressure', async () => {
    const resources = new ConnectivityResourceGovernor(); resources.update({ battery: 'NORMAL', thermal: 'NOMINAL' }); const network = new ControlledNearbyNetwork(); const adapter = network.createAdapter('resource-profile'); const provider = new AnonymousNearbyTransportProvider({ adapter, resources });
    await provider.start(); expect(adapter.lastDutyCycle()?.profile).toBe('BALANCED'); await provider.setResourceProfile('HIGH_AVAILABILITY'); expect(adapter.lastDutyCycle()?.profile).toBe('HIGH_AVAILABILITY');
    resources.update({ battery: 'CRITICAL', thermal: 'NOMINAL' }); await provider.refreshResourcePolicy(); expect(provider.health()).toMatchObject({ state: 'DEGRADED', availability: 'DEGRADED' });
    resources.update({ battery: 'NORMAL', thermal: 'NOMINAL' }); await provider.refreshResourcePolicy(); expect(provider.health()).toMatchObject({ state: 'HEALTHY', availability: 'AVAILABLE' }); expect(adapter.lastDutyCycle()?.profile).toBe('HIGH_AVAILABILITY'); await provider.stop();
  });

  it('renews bounded native scan/advertisement duty cycles and cancels their timers on stop', async () => {
    vi.useFakeTimers(); const scans: number[] = []; const advertisements: { durationMs: number; intervalMs?: number }[] = [];
    const host: NativeBluetoothHost = {
      async state() { return { adapter: 'POWERED_ON', capability: { scanning: true, advertising: true, connections: true, maxAdvertisementBytes: 31, maxWriteBytes: 512, phys: ['LE_1M'] } }; },
      async scan(options) { scans.push(options.durationMs); return { kind: 'NATIVE_BLUETOOTH_SCAN', id: crypto.randomUUID(), expiresAt: new Date(Date.now() + options.durationMs).toISOString(), maxResults: options.maxResults }; },
      async stopScan() {},
      async advertise(_payload, options) { advertisements.push(options); return { kind: 'NATIVE_BLUETOOTH_ADVERTISEMENT', id: crypto.randomUUID(), expiresAt: new Date(Date.now() + options.durationMs).toISOString() }; },
      async stopAdvertising() {},
      async connect() { throw new Error('not used'); },
      onIncomingConnection() { return () => undefined; },
      receive() { return () => undefined; },
      onDisconnect() { return () => undefined; },
      async send() { throw new Error('not used'); },
      async close() {},
    };
    const adapter = new NativeBluetoothNearbyLinkAdapter({ host, request: capability => ({ requestId: crypto.randomUUID(), capability, principal: { kind: 'CORE_TRUSTED_SUBSYSTEM', id: 'nearby-test' } }) }); const duty = NEARBY_RESOURCE_PROFILES.BALANCED;
    try {
      await adapter.capabilities(); await adapter.startAdvertising(new Uint8Array(24), duty); await adapter.startScanning(duty, () => undefined); expect(scans).toEqual([5_000]); expect(advertisements).toEqual([{ durationMs: 60_000, intervalMs: 5_000 }]);
      await vi.advanceTimersByTimeAsync(59_000); expect(scans.length).toBe(2); expect(advertisements.length).toBe(2); await adapter.stop(); const stopped = { scans: scans.length, advertisements: advertisements.length }; await vi.advanceTimersByTimeAsync(180_000); expect({ scans: scans.length, advertisements: advertisements.length }).toEqual(stopped);
    } finally { vi.useRealTimers(); }
  });

  it('expires a vanished peer and reconnects when it returns with a new ephemeral identity', async () => {
    let now = Date.now(); const clock = () => now; const fixture = await pair({ alice: { now: clock, peerTtlMs: 5_000, identityLifetimeMs: 60_000, rotationOverlapMs: 5_000 }, bob: { now: clock, peerTtlMs: 5_000, identityLifetimeMs: 60_000, rotationOverlapMs: 5_000 } });
    fixture.alice.bindOpaqueRendezvous('peer', fixture.bobHandle); expect(await fixture.alice.discoverDirectReachability('peer')).toHaveLength(1); now += 6_000; expect(await fixture.alice.discoverDirectReachability('peer')).toHaveLength(0); const next = await fixture.bob.rotateIdentity(); await tick(); fixture.alice.bindOpaqueRendezvous('peer', next.handle); expect(await fixture.alice.discoverDirectReachability('peer')).toHaveLength(1); await fixture.close();
  });

  it('cleans up a bounded disconnect storm without retaining sessions or listeners', async () => {
    const fixture = await pair(); fixture.alice.bindOpaqueRendezvous('peer', fixture.bobHandle);
    for (let index = 0; index < 32; index += 1) { const endpoint = (await fixture.alice.discoverDirectReachability('peer'))[0]; expect(endpoint).toBeDefined(); const session = await fixture.alice.openSession(endpoint!); await fixture.alice.close(session); }
    expect(fixture.alice.diagnostics().activeSessionCount).toBe(0); expect(fixture.bob.diagnostics().activeSessionCount).toBe(0); await fixture.close();
  });

  it('carries a signed and E2E-encrypted DirectMessage through Fabric with no Bluetooth branch in Messaging', async () => {
    const fixture = await pair(); const aliceKeys = await (await IdentityManager.generate()).sessionKeys('nearby-message-a'); const bobKeys = await (await IdentityManager.generate()).sessionKeys('nearby-message-b'); fixture.alice.bindOpaqueRendezvous(bobKeys.nodeId, fixture.bobHandle); fixture.bob.bindOpaqueRendezvous(aliceKeys.nodeId, fixture.aliceHandle);
    const aliceContact: SocialContact = { nodeId: bobKeys.nodeId, signingPublicKey: bobKeys.publicKey, encryptionPublicKey: bobKeys.encryptionPublicKey }; const bobContact: SocialContact = { nodeId: aliceKeys.nodeId, signingPublicKey: aliceKeys.publicKey, encryptionPublicKey: aliceKeys.encryptionPublicKey };
    const aliceSecurity = new ContactEnvelopeSecurity(aliceKeys, [aliceContact]); const bobSecurity = new ContactEnvelopeSecurity(bobKeys, [bobContact]); const aliceDelivery = new FabricTransport({ fabric: fixture.aliceFabric, localNodeId: aliceKeys.nodeId, applicationSecurity: aliceSecurity }); const bobDelivery = new FabricTransport({ fabric: fixture.bobFabric, localNodeId: bobKeys.nodeId, applicationSecurity: bobSecurity });
    const cryptoProvider = new SodiumCryptoProvider(); const cipher = new SodiumDirectMessageCipher(); const aliceStore = new InMemorySocialStorage(); const bobStore = new InMemorySocialStorage(); const alice = new DirectMessageService(aliceDelivery, aliceStore, cryptoProvider, aliceKeys, [aliceContact], aliceSecurity, cipher); const bob = new DirectMessageService(bobDelivery, bobStore, cryptoProvider, bobKeys, [bobContact], bobSecurity, cipher);
    const sent = await alice.sendText(bobKeys.nodeId, 'one-hop encrypted nearby message'); await alice.flush(bobKeys.nodeId); await tick(); const conversation = await bob.createConversation(aliceKeys.nodeId); expect((await bob.history(conversation.id)).map(value => value.id)).toContain(sent.id);
    const radio = fixture.network.transcript().map(value => new TextDecoder().decode(value.bytes)).join('\n'); expect(radio).not.toContain(aliceKeys.nodeId); expect(radio).not.toContain(bobKeys.nodeId); expect(radio).not.toContain(aliceKeys.publicKey); expect(radio).not.toContain(bobKeys.publicKey);
    const messagingSource = readFileSync(join(here, 'social/messaging.ts'), 'utf8'); expect(messagingSource).not.toMatch(/Bluetooth|BLE|NearbyLinkAdapter|AnonymousNearbyTransportProvider/); alice.close(); bob.close(); await aliceDelivery.close(); await bobDelivery.close();
  });

  it('keeps plugins and ordinary application modules outside raw nearby topology', () => {
    const pluginTypes = readFileSync(join(here, '../../addons/src/plugin-types.ts'), 'utf8'); expect(pluginTypes).not.toMatch(/AnonymousNearbyPeerHandle|NativeBluetoothEndpointObservation|macAddress|nearbyTopology/);
    const applicationSources = ['social/messaging.ts', 'social/calendar.ts', 'social/spaces.ts', 'ai/visits.ts'].map(file => readFileSync(join(here, file), 'utf8')).join('\n'); expect(applicationSources).not.toMatch(/NativeBluetooth|NearbyLinkAdapter|AnonymousNearbyTransportProvider/);
  });

  it('marks a controlled physical harness as SIMULATED even after a full encrypted exchange', async () => {
    const fixture = await pair(); const report = await new NearbyPhysicalVerificationHarness(fixture.alice, fixture.aliceAdapter).run({ destination: 'peer', peerHandle: fixture.bobHandle, frame: await opaque('peer'), reconnect: true });
    expect(report).toMatchObject({ evidence: 'SIMULATED', peerDiscovered: true, encryptedSessionOpened: true, opaqueEnvelopeExchanged: true, disconnectCompleted: true, reconnectAttempted: true }); expect(report.evidence).not.toBe('PHYSICALLY_VERIFIED'); await fixture.close();
  });
});
