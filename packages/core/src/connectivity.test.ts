import { describe, expect, it } from 'vitest';
import {
  ConnectivityFabric,
  ConnectivityError,
  ControlledTransportProvider,
  ExternalRadioTransportProvider,
  LocalNetworkTransportProvider,
  OpaqueFragmentReassembler,
  WiFiDirectTransportProvider,
  createOpaqueDeliveryEnvelope,
  decodeOpaqueFrame,
  encodeOpaqueFrame,
  fragmentOpaqueEnvelope,
  type OpaqueDeliveryEnvelope,
} from './connectivity.js';

async function envelope(destination = 'bob'): Promise<OpaqueDeliveryEnvelope> {
  return createOpaqueDeliveryEnvelope({ destination, ciphertext: new TextEncoder().encode('ciphertext-only'), replayNonce: 'n1', expiresAt: new Date(Date.now() + 60_000).toISOString(), requirement: { profile: 'INTERACTIVE' } });
}

describe('R0P67 Connectivity Fabric', () => {
  it('delivers one opaque envelope through a provider without exposing plaintext', async () => {
    const alice = new ControlledTransportProvider('a'); const bob = new ControlledTransportProvider('b');
    alice.connectPeer('bob', bob); bob.connectPeer('alice', alice);
    const fabric = new ConnectivityFabric(); fabric.registerProvider(alice);
    const received: string[] = []; fabric.onOpaqueEnvelope(value => { received.push(value.ciphertext); });
    await fabric.start(); const protectedEnvelope = await envelope();
    const result = await fabric.deliver({ id: 'request-1', destination: 'bob', envelope: protectedEnvelope, requirement: { profile: 'INTERACTIVE' } });
    expect(result.ok).toBe(true); expect(received).toEqual([]); // the sending provider is not a loopback destination
    expect(protectedEnvelope).not.toHaveProperty('plaintext'); expect(protectedEnvelope).not.toHaveProperty('contentKey');
    await fabric.stop();
  });

  it('delivers the same protected envelope between two independent Fabric instances', async () => {
    const aliceProvider = new ControlledTransportProvider('alice'); const bobProvider = new ControlledTransportProvider('bob');
    aliceProvider.connectPeer('bob', bobProvider); bobProvider.connectPeer('alice', aliceProvider);
    const aliceFabric = new ConnectivityFabric(); const bobFabric = new ConnectivityFabric(); aliceFabric.registerProvider(aliceProvider); bobFabric.registerProvider(bobProvider);
    const received: OpaqueDeliveryEnvelope[] = []; let resolveDelivery!: () => void; const delivered = new Promise<void>(resolve => { resolveDelivery = resolve; }); bobFabric.onOpaqueEnvelope(value => { received.push(value); resolveDelivery(); }); await aliceFabric.start(); await bobFabric.start();
    const protectedEnvelope = await envelope('bob'); const result = await aliceFabric.deliver({ id: 'between-fabrics', destination: 'bob', envelope: protectedEnvelope, requirement: { profile: 'INTERACTIVE' } });
    await Promise.race([delivered, new Promise<void>((_, reject) => setTimeout(() => reject(new Error('controlled envelope delivery timed out')), 1_000))]); expect(result.ok).toBe(true); expect(received[0]?.id).toBe(protectedEnvelope.id); expect(received[0]?.ciphertext).toBe(protectedEnvelope.ciphertext);
    await aliceFabric.stop(); await bobFabric.stop();
  });

  it('carries a protected envelope through the framed LocalNetwork provider (same-host evidence)', async () => {
    const serverProvider = new LocalNetworkTransportProvider({ providerId: 'lan-server' });
    const listener = await serverProvider.listen({ host: '127.0.0.1', port: 0 });
    const clientProvider = new LocalNetworkTransportProvider({ providerId: 'lan-client', endpoints: { server: { host: '127.0.0.1', port: listener.port } } });
    const serverFabric = new ConnectivityFabric(); const clientFabric = new ConnectivityFabric(); serverFabric.registerProvider(serverProvider); clientFabric.registerProvider(clientProvider);
    const received: OpaqueDeliveryEnvelope[] = []; serverFabric.onOpaqueEnvelope(value => { received.push(value); }); await serverFabric.start(); await clientFabric.start();
    const protectedEnvelope = await envelope('server'); const result = await clientFabric.deliver({ id: 'lan-request', destination: 'server', envelope: protectedEnvelope, requirement: { profile: 'INTERACTIVE' } });
    await new Promise(resolve => setTimeout(resolve, 10)); expect(result.ok).toBe(true); expect(received[0]?.id).toBe(protectedEnvelope.id);
    await clientFabric.stop(); await serverFabric.stop();
  });

  it('keeps a logical envelope stable while fragmenting and reassembling', async () => {
    const protectedEnvelope = await envelope(); const fragments = await fragmentOpaqueEnvelope(protectedEnvelope, 256); expect(fragments.length).toBeGreaterThan(1);
    const reassembler = new OpaqueFragmentReassembler(); let restored: OpaqueDeliveryEnvelope | undefined;
    for (const fragment of fragments) restored = (await reassembler.add(fragment)) ?? restored;
    expect(restored?.id).toBe(protectedEnvelope.id); expect(restored?.ciphertext).toBe(protectedEnvelope.ciphertext);
    await expect(reassembler.add({ ...fragments[0]!, integrity: 'sha256:bad' })).rejects.toBeInstanceOf(ConnectivityError);
  });

  it('rejects a provider that can decrypt or authorize application data', () => {
    const fabric = new ConnectivityFabric(); const unsafe = new ControlledTransportProvider('unsafe');
    const forged = unsafe as unknown as { register?: unknown };
    void forged;
    const unsafeProvider = { ...unsafe, security: { opaqueOnly: true, e2eRequired: true, canDecrypt: true, canAuthorize: false } as unknown as typeof unsafe.security } as unknown as import('./connectivity.js').TransportProvider;
    expect(() => fabric.registerProvider(unsafeProvider)).toThrow(ConnectivityError);
  });

  it('represents unsupported future providers honestly', async () => {
    const fabric = new ConnectivityFabric(); fabric.registerProvider(new WiFiDirectTransportProvider()); fabric.registerProvider(new ExternalRadioTransportProvider());
    expect(fabric.snapshot().state).toBe('DEVICE_ONLY'); expect((await fabric.reachability('peer')).availability).toBe('UNAVAILABLE');
  });

  it('does not treat transport endpoints as social identities', async () => {
    const provider = new ControlledTransportProvider(); provider.connectPeer('peer', new ControlledTransportProvider());
    const endpoints = await provider.discoverDirectReachability('peer'); expect(endpoints[0]).toMatchObject({ anonymous: true, routeReference: 'peer' });
    expect(endpoints[0]).not.toHaveProperty('profile'); expect(endpoints[0]).not.toHaveProperty('username'); expect(endpoints[0]).not.toHaveProperty('ip');
  });

  it('uses typed state when no provider exists and does not disable local core', () => {
    const fabric = new ConnectivityFabric(); expect(fabric.snapshot()).toMatchObject({ state: 'DEVICE_ONLY', internetAvailable: false, localNetworkAvailable: false });
  });

  it('bounds duplicate delivery requests', async () => {
    class SlowProvider extends ControlledTransportProvider { override async sendOpaqueFrame(session: import('./connectivity.js').TransportSession, frame: import('./connectivity.js').OpaqueFrame): Promise<void> { await new Promise(resolve => setTimeout(resolve, 10)); return super.sendOpaqueFrame(session, frame); } }
    const provider = new SlowProvider('bounded'); const peer = new ControlledTransportProvider('peer'); provider.connectPeer('peer', peer);
    const fabric = new ConnectivityFabric(); fabric.registerProvider(provider); const value = await envelope('peer'); const request = { id: 'same-request', destination: 'peer', envelope: value, requirement: { profile: 'INTERACTIVE' as const } };
    const first = fabric.deliver(request); await expect(fabric.deliver(request)).rejects.toBeInstanceOf(ConnectivityError); await first;
  });

  it('falls back to a second secure provider without changing the logical envelope', async () => {
    class FailingProvider extends ControlledTransportProvider { override async sendOpaqueFrame(): Promise<void> { throw new ConnectivityError('SESSION_FAILED', 'controlled failure'); } }
    const first = new FailingProvider('first'); const firstPeer = new ControlledTransportProvider('first-peer'); first.connectPeer('peer', firstPeer);
    const second = new ControlledTransportProvider('second'); const secondPeer = new ControlledTransportProvider('second-peer'); second.connectPeer('peer', secondPeer);
    const fabric = new ConnectivityFabric({ maxAttempts: 2 }); fabric.registerProvider(first); fabric.registerProvider(second); const value = await envelope('peer');
    const result = await fabric.deliver({ id: 'fallback-request', destination: 'peer', envelope: value, requirement: { profile: 'INTERACTIVE' } });
    expect(result.ok).toBe(true); expect(result.attempts[0]?.ok).toBe(false); expect(result.attempts[1]?.ok).toBe(true); expect(result.receipt?.envelopeId).toBe(value.id);
  });

  it('round-trips the opaque wire representation', async () => {
    const value = await envelope(); const decoded = decodeOpaqueFrame(encodeOpaqueFrame(value)); expect(decoded).toEqual(value);
  });

  it('maps application intent to delivery profiles without transport-specific object branches', async () => {
    const { deliveryProfileForEnvelope } = await import('./connectivity.js');
    expect(deliveryProfileForEnvelope({ type: 'social.message' }).profile).toBe('INTERACTIVE'); expect(deliveryProfileForEnvelope({ type: 'social.file_chunk' }).profile).toBe('BULK'); expect(deliveryProfileForEnvelope({ type: 'social.live_signal' }).profile).toBe('REALTIME');
  });

  it('rejects a tampered protected envelope before dispatch', async () => {
    const value = await envelope(); const tampered = { ...value, ciphertext: 'tampered' };
    class ForgedProvider extends ControlledTransportProvider { inject(frame: import('./connectivity.js').OpaqueDeliveryEnvelope): void { (this as unknown as { emit: (value: import('./connectivity.js').OpaqueDeliveryEnvelope) => void }).emit(frame); } }
    const provider = new ForgedProvider('forged'); const fabric = new ConnectivityFabric(); fabric.registerProvider(provider); let delivered = false; fabric.onOpaqueEnvelope(() => { delivered = true; }); await fabric.start(); provider.inject(tampered); await new Promise(resolve => setTimeout(resolve, 0)); expect(delivered).toBe(false); await fabric.stop();
  });

  it('rejects malformed opaque identifiers, requirements and oversized ciphertext before provider dispatch', async () => {
    await expect(createOpaqueDeliveryEnvelope({ id: 'bad id', destination: 'bob', ciphertext: new Uint8Array([1]), replayNonce: 'nonce', expiresAt: new Date(Date.now() + 60_000).toISOString(), requirement: { profile: 'INTERACTIVE' } })).rejects.toBeInstanceOf(ConnectivityError);
    await expect(createOpaqueDeliveryEnvelope({ destination: 'bob', ciphertext: new Uint8Array([1]), replayNonce: 'nonce', expiresAt: new Date(Date.now() + 60_000).toISOString(), requirement: { profile: 'NOT_A_PROFILE' as never } })).rejects.toBeInstanceOf(ConnectivityError);
    await expect(createOpaqueDeliveryEnvelope({ destination: 'bob', ciphertext: '\u0000not-base64', replayNonce: 'nonce', expiresAt: new Date(Date.now() + 60_000).toISOString(), requirement: { profile: 'INTERACTIVE' } })).rejects.toBeInstanceOf(ConnectivityError);
  });
});
