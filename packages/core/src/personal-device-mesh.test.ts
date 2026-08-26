import { describe, expect, it } from 'vitest';
import { canonicalJson, SodiumCryptoProvider } from './crypto.js';
import { IdentityManager } from './identity.js';
import type { Envelope, KeystoneDeliveryInterface } from './connectivity.js';
import type { TransportMessageHandler } from './transport.js';
import {
  InMemoryDeviceMeshStorage,
  PersonalDeviceMesh,
} from './personal-device-mesh.js';

/** Deterministic, authenticated delivery seam for unit/integration coverage.
 * It deliberately models Fabric's application boundary, not a physical route. */
class MeshBus {
  private readonly peers = new Map<string, Set<TransportMessageHandler>>();
  private blockRevocations = false;
  blockRevocationDelivery(): void { this.blockRevocations = true; }
  allowRevocationDelivery(): void { this.blockRevocations = false; }
  register(peer: string): KeystoneDeliveryInterface {
    const handlers = new Set<TransportMessageHandler>();
    this.peers.set(peer, handlers);
    return {
      connect: async () => undefined,
      send: async (peerOrEnvelope: string | Envelope, maybeEnvelope?: Envelope) => {
        const peerId = typeof peerOrEnvelope === 'string' ? peerOrEnvelope : peerOrEnvelope.recipient;
        const envelope = maybeEnvelope ?? peerOrEnvelope as Envelope;
        if (this.blockRevocations && envelope.type === 'device.mesh.revocation') throw new Error('revocation delivery blocked');
        const target = this.peers.get(peerId);
        if (!target) throw new Error('peer unavailable');
        await Promise.all([...target].map(handler => handler(envelope)));
      },
      onMessage: (handler: TransportMessageHandler) => { handlers.add(handler); return () => handlers.delete(handler); },
      isPeerConnected: peerId => this.peers.has(peerId),
      close: async () => { this.peers.delete(peer); handlers.clear(); },
    };
  }
  remove(peer: string): void { this.peers.delete(peer); }
}

async function makePair() {
  const crypto = new SodiumCryptoProvider();
  const identity = await IdentityManager.generate();
  const owner = await identity.sessionKeys('laptop');
  const phone = await identity.sessionKeys('phone');
  const bus = new MeshBus();
  const ownerStorage = new InMemoryDeviceMeshStorage();
  const phoneStorage = new InMemoryDeviceMeshStorage();
  const received: unknown[] = [];
  const ownerMesh = new PersonalDeviceMesh({
    local: owner,
    crypto,
    storage: ownerStorage,
    transport: bus.register(owner.nodeId),
    onReplica: (_replica, payload) => { received.push(payload); },
  });
  const phoneMesh = new PersonalDeviceMesh({
    local: phone,
    ownerIdentityId: owner.nodeId,
    authorityDeviceId: owner.nodeId,
    authorityPublicKey: owner.publicKey,
    crypto,
    storage: phoneStorage,
    transport: bus.register(phone.nodeId),
    onReplica: (_replica, payload) => { received.push(payload); },
  });
  await Promise.all([ownerMesh.ready(), phoneMesh.ready()]);
  return { crypto, owner, phone, bus, ownerMesh, phoneMesh, ownerStorage, phoneStorage, received };
}

async function eventually(check: () => boolean | Promise<boolean>, timeoutMs = 2_000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for mesh state');
}

describe('R0P73 Personal Device Mesh', () => {
  it('requires explicit owner authorization and keeps enrollment bound to cryptographic identity', async () => {
    const fixture = await makePair();
    const request = await fixture.phoneMesh.createEnrollmentRequest({ label: 'Alice phone', platform: 'android', capabilities: { roles: ['PORTABLE', 'USER_INTERFACE'], availableStorageBytes: 10_000_000 } });
    await expect(fixture.ownerMesh.authorizeEnrollment(request)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    const authorization = await fixture.ownerMesh.authorizeEnrollment(request, { confirmed: true, doubleConfirmed: true });
    expect(await fixture.phoneMesh.acceptEnrollmentAuthorization(authorization)).toBe(true);
    expect(fixture.ownerMesh.isTrustedDevice(fixture.phone.nodeId)).toBe(true);
    expect(fixture.phoneMesh.isTrustedDevice(fixture.phone.nodeId)).toBe(true);
    await expect(fixture.ownerMesh.authorizeEnrollment(request, { confirmed: true, doubleConfirmed: true })).rejects.toMatchObject({ code: 'REPLAY' });
    const forged = { ...authorization, label: 'Mallory phone', signature: await fixture.crypto.sign(canonicalJson({ ...authorization, label: 'Mallory phone', signature: undefined }), fixture.phone.privateKey) };
    expect(await fixture.phoneMesh.acceptEnrollmentAuthorization(forged)).toBe(false);
    fixture.ownerMesh.close(); fixture.phoneMesh.close();
  });

  it('queues local-first, metadata-only and selected replication, then confirms only after destination receipt', async () => {
    const fixture = await makePair();
    const request = await fixture.phoneMesh.createEnrollmentRequest({ label: 'Phone', platform: 'android', capabilities: { roles: ['PORTABLE'], availableStorageBytes: 20_000_000 } });
    const authorization = await fixture.ownerMesh.authorizeEnrollment(request, { confirmed: true, doubleConfirmed: true });
    await fixture.phoneMesh.acceptEnrollmentAuthorization(authorization);
    expect(await fixture.ownerMesh.replicate({ objectId: 'profile:alice', objectType: 'profile', objectVersion: '1', payload: { displayName: 'Alice' }, policy: { intent: 'LOCAL_ONLY' } })).toHaveLength(0);
    const queued = await fixture.ownerMesh.replicate({ objectId: 'profile:alice', objectType: 'profile', objectVersion: '1', metadata: { displayName: 'Alice' }, policy: { intent: 'METADATA_ONLY', selectedDeviceIds: [fixture.phone.nodeId] }, priority: 'USER_INTERACTIVE' });
    expect(queued).toHaveLength(1);
    expect(queued[0]?.metadataOnly).toBe(true);
    expect((await fixture.ownerMesh.pendingTransfers()).length).toBe(1);
    await fixture.ownerMesh.flush(fixture.phone.nodeId);
    await eventually(async () => (await fixture.ownerMesh.pendingTransfers()).length === 0);
    expect((await fixture.phoneMesh.replica(fixture.phone.nodeId, 'profile:alice'))?.status).toBe('CONFIRMED');
    expect(fixture.received).toContainEqual({ displayName: 'Alice' });
    const selected = await fixture.ownerMesh.transferToDevice({ objectId: 'note:trip', objectType: 'note', objectVersion: '1', payload: { body: 'shared' }, targetDeviceId: fixture.phone.nodeId });
    expect(selected.targetDeviceId).toBe(fixture.phone.nodeId);
    await fixture.ownerMesh.flush(fixture.phone.nodeId);
    await eventually(() => fixture.received.some(value => typeof value === 'object' && value !== null && 'body' in value && (value as { body: string }).body === 'shared'));
    await expect(fixture.ownerMesh.replicate({ objectId: 'secret', objectType: 'settings', payload: { apiKey: 'must-not-replicate' }, policy: { intent: 'SELECTED_DEVICES', selectedDeviceIds: [fixture.phone.nodeId] } })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    fixture.ownerMesh.close(); fixture.phoneMesh.close();
  });

  it('rejects stale, forged and replayed sync, persists state, and propagates revocation', async () => {
    const fixture = await makePair();
    const request = await fixture.phoneMesh.createEnrollmentRequest({ label: 'Phone', platform: 'android', capabilities: { roles: ['PORTABLE'] } });
    const authorization = await fixture.ownerMesh.authorizeEnrollment(request, { confirmed: true, doubleConfirmed: true });
    await fixture.phoneMesh.acceptEnrollmentAuthorization(authorization);
    const transfer = await fixture.ownerMesh.replicate({ objectId: 'task:1', objectType: 'task', objectVersion: '2', payload: { title: 'latest' }, policy: { intent: 'SELECTED_DEVICES', selectedDeviceIds: [fixture.phone.nodeId] } });
    expect(transfer[0]).toBeDefined();
    await fixture.ownerMesh.flush(fixture.phone.nodeId);
    await eventually(() => fixture.received.some(value => typeof value === 'object' && value !== null && 'title' in value));
    const before = await fixture.phoneMesh.replica(fixture.phone.nodeId, 'task:1');
    expect(before?.objectVersion).toBe('2');
    fixture.bus.blockRevocationDelivery();
    const revocation = await fixture.ownerMesh.revokeDevice(fixture.phone.nodeId, 'lost device', { confirmed: true, doubleConfirmed: true });
    await new Promise(resolve => setTimeout(resolve, 25));
    expect(fixture.phoneMesh.isRevoked(fixture.phone.nodeId)).toBe(false);
    fixture.bus.allowRevocationDelivery();
    await fixture.ownerMesh.flush(fixture.phone.nodeId);
    await eventually(() => fixture.phoneMesh.isRevoked(fixture.phone.nodeId));
    expect((await fixture.ownerMesh.getDevice(fixture.phone.nodeId))?.state).toBe('REVOKED');
    expect(await fixture.phoneMesh.acceptRevocation(revocation)).toBe(false);
    await expect(fixture.phoneMesh.replicate({ objectId: 'task:revoked', objectType: 'task', payload: { title: 'must reject' }, policy: { intent: 'SELECTED_DEVICES', selectedDeviceIds: [fixture.owner.nodeId] } })).rejects.toMatchObject({ code: 'REVOKED' });
    await expect(fixture.phoneMesh.acceptEnrollmentAuthorization(authorization)).resolves.toBe(false);
    expect(await fixture.ownerMesh.stateSnapshot()).toMatchObject({ trustEpoch: 1 });
    const restarted = new PersonalDeviceMesh({ local: fixture.owner, crypto: fixture.crypto, storage: fixture.ownerStorage });
    await restarted.ready();
    expect(restarted.isTrustedDevice(fixture.phone.nodeId)).toBe(false);
    expect(restarted.isRevoked(fixture.phone.nodeId)).toBe(true);
    expect((await restarted.getDevice(fixture.phone.nodeId))?.state).toBe('REVOKED');
    restarted.close(); fixture.ownerMesh.close(); fixture.phoneMesh.close();
  });

  it('applies concurrent duplicate sync frames once before durable dedup is written', async () => {
    const fixture = await makePair();
    const request = await fixture.phoneMesh.createEnrollmentRequest({ label: 'Phone', platform: 'android', capabilities: { roles: ['PORTABLE'] } });
    const authorization = await fixture.ownerMesh.authorizeEnrollment(request, { confirmed: true, doubleConfirmed: true });
    await fixture.phoneMesh.acceptEnrollmentAuthorization(authorization);
    const transfer = await fixture.ownerMesh.replicate({ objectId: 'race:1', objectType: 'note', objectVersion: '1', payload: { body: 'once' }, policy: { intent: 'SELECTED_DEVICES', selectedDeviceIds: [fixture.phone.nodeId] } });
    const sync = (fixture.phoneMesh as unknown as { receiveSync(sender: string, body: Record<string, unknown>): Promise<void> }).receiveSync.bind(fixture.phoneMesh);
    await Promise.all([
      sync(fixture.owner.nodeId, { request: transfer[0], trustEpoch: fixture.phoneMesh.trustEpoch }),
      sync(fixture.owner.nodeId, { request: transfer[0], trustEpoch: fixture.phoneMesh.trustEpoch }),
    ]);
    expect(fixture.received.filter(value => typeof value === 'object' && value !== null && (value as { body?: string }).body === 'once')).toHaveLength(1);
    fixture.ownerMesh.close(); fixture.phoneMesh.close();
  });

  it('keeps placement independent from reachability and bounds fan-out', async () => {
    const fixture = await makePair();
    const request = await fixture.phoneMesh.createEnrollmentRequest({ label: 'Phone', platform: 'android', capabilities: { roles: ['DURABLE_REPLICA'], durableReplica: true, availableStorageBytes: 50 } });
    const authorization = await fixture.ownerMesh.authorizeEnrollment(request, { confirmed: true, doubleConfirmed: true });
    await fixture.phoneMesh.acceptEnrollmentAuthorization(authorization);
    expect((await fixture.ownerMesh.placementFor({ intent: 'HIGH_AVAILABILITY' }, 100))).toHaveLength(0);
    expect((await fixture.ownerMesh.placementFor({ intent: 'HIGH_AVAILABILITY' }, 10))).toHaveLength(1);
    await fixture.ownerMesh.observePresence({ deviceId: fixture.phone.nodeId, state: 'OFFLINE', source: 'FABRIC_OBSERVATION', ttlMs: 60_000 });
    const queued = await fixture.ownerMesh.replicate({ objectId: 'file:large', objectType: 'file', objectVersion: '1', payload: { contentHash: 'hash' }, policy: { intent: 'SELECTED_DEVICES', selectedDeviceIds: [fixture.phone.nodeId] }, sizeBytes: 10 });
    expect(queued).toHaveLength(1);
    expect((await fixture.ownerMesh.status()).status).toBe('WAITING_FOR_ROUTE');
    fixture.bus.remove(fixture.phone.nodeId);
    await fixture.ownerMesh.flush(fixture.phone.nodeId);
    expect((await fixture.ownerMesh.pendingTransfers()).length).toBe(1);
    fixture.ownerMesh.close(); fixture.phoneMesh.close();
  });
});
