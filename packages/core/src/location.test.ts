import { describe, expect, it } from 'vitest';
import {
  AesGcmLocationCipher,
  ControlledLocationProvider,
  InMemoryLocationStateStorage,
  LocationError,
  LocationPolicy,
  LocationService,
  LocationShareService,
  coarsenLocationFix,
  locationFreshness,
  locationWireContainsPlaintext,
  validateLocationFix,
  type LocationCaller,
  type LocationFix,
} from './location.js';
import type { Envelope, EnvelopeSecurity, KeystoneDeliveryInterface, UnsignedEnvelope } from './connectivity.js';
import type { NodeId } from './types.js';

const at = Date.parse('2026-08-23T10:00:00.000Z');
const owner: LocationCaller = { id: 'alice-device', kind: 'OWNER_UI' };
const core: LocationCaller = { id: 'keystone-core', kind: 'CORE_FEATURE' };
const fix = (timestamp = new Date(at).toISOString(), precision: LocationFix['precision'] = 'PRECISE'): LocationFix => ({ latitude: 55.751244, longitude: 37.618423, horizontalAccuracy: 12, timestamp, provenance: 'CONTROLLED_TEST', precision });

function grant(policy: LocationPolicy, principal: LocationCaller, capability: 'LOCAL_USE' | 'SHARE', scope: 'ONE_SHOT' | 'FOREGROUND' | 'BACKGROUND' = 'ONE_SHOT', precision: 'APPROXIMATE' | 'PRECISE' = 'PRECISE', target?: string) {
  return policy.issue({ principal, capability, scope, precision, durationMs: 30 * 60_000, ...(target ? { target } : {}), explicitOwnerAction: true, ownerConfirmed: scope === 'BACKGROUND' ? true : undefined });
}

describe('R0P76 location policy and provider boundary', () => {
  it('validates finite bounded fixes and rejects impossible values', () => {
    expect(validateLocationFix(fix(), at)).toEqual(fix());
    for (const value of [
      { ...fix(), latitude: Number.NaN },
      { ...fix(), longitude: Number.POSITIVE_INFINITY },
      { ...fix(), latitude: 91 },
      { ...fix(), longitude: -181 },
      { ...fix(), horizontalAccuracy: -1 },
      { ...fix(), heading: 361 },
      { ...fix(), timestamp: new Date(at + 10 * 60_000).toISOString() },
    ]) expect(() => validateLocationFix(value, at)).toThrowError(LocationError);
  });

  it('coarsens the actual disclosed coordinates and keeps explicit provenance', () => {
    const coarse = coarsenLocationFix(fix());
    expect(coarse.precision).toBe('APPROXIMATE');
    expect(coarse.horizontalAccuracy).toBeGreaterThanOrEqual(1_110);
    expect(coarse.latitude).not.toBe(fix().latitude);
    expect(coarse.provenance).toBe('CONTROLLED_TEST');
  });

  it('supports one-shot use without creating a movement history', async () => {
    let now = at;
    const provider = new ControlledLocationProvider(() => now);
    provider.emit(fix());
    const policy = new LocationPolicy(() => now);
    const service = new LocationService(provider, policy, { now: () => now, storage: new InMemoryLocationStateStorage() });
    const oneShot = grant(policy, owner, 'LOCAL_USE');
    expect((await service.current(oneShot.id, owner)).precision).toBe('PRECISE');
    await expect(service.current(oneShot.id, owner)).rejects.toMatchObject({ code: 'POLICY_DENIED' });
    const foreground = grant(policy, owner, 'LOCAL_USE', 'FOREGROUND', 'APPROXIMATE');
    expect(service.latestLocal(foreground.id, owner)?.precision).toBe('APPROXIMATE');
    expect(() => service.latestLocal('not-a-grant', owner)).toThrowError(LocationError);
    const persisted = (await new InMemoryLocationStateStorage().read());
    expect(persisted).toBeUndefined();
    now += 31 * 60_000;
    await service.shutdown();
  });

  it('requires explicit owner approval and keeps OS denial authoritative', async () => {
    const now = () => at;
    const provider = new ControlledLocationProvider(now, 'DENIED');
    const policy = new LocationPolicy(now);
    const service = new LocationService(provider, policy, { now });
    const deniedGrant = grant(policy, owner, 'LOCAL_USE');
    await expect(service.current(deniedGrant.id, owner)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(service.requestPermission(deniedGrant.id, owner, false)).rejects.toMatchObject({ code: 'POLICY_DENIED' });
    expect((await service.permission()).status).toBe('DENIED');
  });

  it('bounds watches, revokes them, and stops provider resources', async () => {
    const provider = new ControlledLocationProvider(() => at);
    const policy = new LocationPolicy(() => at);
    const service = new LocationService(provider, policy, { now: () => at, maxWatches: 2 });
    const foreground = grant(policy, core, 'LOCAL_USE', 'FOREGROUND', 'APPROXIMATE');
    const second = grant(policy, core, 'LOCAL_USE', 'FOREGROUND', 'APPROXIMATE');
    const seen: LocationFix[] = [];
    const first = await service.startWatch(foreground.id, core, value => { seen.push(value); });
    const other = await service.startWatch(second.id, core, () => undefined);
    expect(provider.activeWatches()).toBe(1);
    await expect(service.startWatch(grant(policy, core, 'LOCAL_USE', 'FOREGROUND').id, core, () => undefined)).rejects.toMatchObject({ code: 'RESOURCE_EXHAUSTED' });
    provider.emit(fix());
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(seen[0]?.precision).toBe('APPROXIMATE');
    await service.revokeGrant(foreground.id);
    expect(provider.activeWatches()).toBe(1);
    await service.stopWatch(other.id);
    expect(provider.activeWatches()).toBe(0);
    expect(first.state).toBe('ACTIVE');
  });

  it('keeps live sharing behind an explicit bounded watch and stops it immediately', async () => {
    const provider = new ControlledLocationProvider(() => at);
    provider.emit(fix());
    const policy = new LocationPolicy(() => at);
    const service = new LocationService(provider, policy, { now: () => at });
    const shareGrant = grant(policy, owner, 'SHARE', 'FOREGROUND', 'APPROXIMATE', 'bob-device');
    const share = await service.createShare({ ownerDeviceId: owner.id, target: 'bob-device', grantId: shareGrant.id, caller: owner, mode: 'LIVE', durationMs: 10 * 60_000 });
    const updates: LocationFix[] = [];
    await service.startShareWatch(share.id, owner, value => { updates.push(value); });
    expect(provider.activeWatches()).toBe(1);
    provider.emit(fix());
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(updates).toHaveLength(1);
    expect(updates[0]?.precision).toBe('APPROXIMATE');
    expect((await service.getShare(share.id))?.state).toBe('ACTIVE');
    await service.stopShare(share.id);
    expect(provider.activeWatches()).toBe(0);
    provider.emit(fix(new Date(at + 1_000).toISOString()));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(updates).toHaveLength(1);
  });

  it('never resumes active sharing after restart and rejects tampered state', async () => {
    const storage = new InMemoryLocationStateStorage();
    const policy = new LocationPolicy(() => at);
    const service = new LocationService(new ControlledLocationProvider(() => at), policy, { now: () => at, storage });
    const shareGrant = grant(policy, owner, 'SHARE', 'FOREGROUND', 'APPROXIMATE', 'bob-device');
    const share = await service.createShare({ ownerDeviceId: owner.id, target: 'bob-device', grantId: shareGrant.id, caller: owner, mode: 'LIVE', durationMs: 10 * 60_000 });
    expect(share.state).toBe('WAITING_FOR_CONNECTION');
    const snapshot = storage.snapshot() as { shares: unknown[]; revision: number; version: number; grants: unknown[] };
    expect(JSON.stringify(snapshot)).not.toMatch(/latitude|longitude/);
    await service.shutdown();
    const restored = new LocationService(new ControlledLocationProvider(() => at), new LocationPolicy(() => at), { now: () => at, storage });
    await restored.ready();
    expect((await restored.getShare(share.id))?.state).toBe('ENDED');
    await storage.write({ ...snapshot, revision: 'rollback', grants: [{ ...shareGrant, ownerAuthorized: false }] });
    const tampered = new LocationService(new ControlledLocationProvider(() => at), new LocationPolicy(() => at), { now: () => at, storage });
    await tampered.ready();
    expect(tampered.grants.list()).toHaveLength(0);
  });

  it('reports freshness without persisting a timeline', () => {
    expect(locationFreshness(fix(), at)).toBe('CURRENT');
    expect(locationFreshness(fix(new Date(at - 90_000).toISOString()), at, 120_000)).toBe('RECENT');
    expect(locationFreshness(fix(new Date(at - 121_000).toISOString()), at, 120_000)).toBe('STALE');
    expect(locationFreshness(undefined, at)).toBe('UNKNOWN');
  });
});

class InProcessDelivery implements KeystoneDeliveryInterface {
  private readonly handlers = new Set<(envelope: Envelope) => void | Promise<void>>();
  private readonly peers = new Map<NodeId, InProcessDelivery>();
  constructor(readonly nodeId: NodeId) {}
  connect(peer: NodeId): Promise<void> { if (!this.peers.has(peer)) throw new Error('offline'); return Promise.resolve(); }
  send(envelope: Envelope): Promise<void>;
  send(peer: NodeId, envelope: Envelope): Promise<void>;
  async send(peerOrEnvelope: NodeId | Envelope, maybeEnvelope?: Envelope): Promise<void> { const envelope = maybeEnvelope ?? peerOrEnvelope as Envelope; const peer = maybeEnvelope ? peerOrEnvelope as NodeId : envelope.recipient; const destination = this.peers.get(peer); if (!destination) throw new Error('offline'); await Promise.all([...destination.handlers].map(handler => handler(envelope))); }
  onMessage(handler: (envelope: Envelope) => void | Promise<void>): () => void { this.handlers.add(handler); return () => this.handlers.delete(handler); }
  isPeerConnected(peer: NodeId): boolean { return this.peers.has(peer); }
  isDeterministic(): boolean { return true; }
  async close(): Promise<void> { this.handlers.clear(); this.peers.clear(); }
  pair(peer: InProcessDelivery): void { this.peers.set(peer.nodeId, peer); }
}

class BlockingDelivery implements KeystoneDeliveryInterface {
  private released = false;
  private readonly releaseWaiter: Promise<void>;
  private releaseResolve!: () => void;
  readonly sent: Envelope[] = [];
  constructor(readonly nodeId: NodeId) { this.releaseWaiter = new Promise(resolve => { this.releaseResolve = resolve; }); }
  async connect(): Promise<void> { if (!this.released) await this.releaseWaiter; }
  async send(peerOrEnvelope: NodeId | Envelope, maybeEnvelope?: Envelope): Promise<void> { this.sent.push(structuredClone((maybeEnvelope ?? peerOrEnvelope) as Envelope)); }
  onMessage(): () => void { return () => undefined; }
  isPeerConnected(): boolean { return this.released; }
  isDeterministic(): boolean { return true; }
  async close(): Promise<void> { this.released = true; this.releaseResolve(); }
  release(): void { this.released = true; this.releaseResolve(); }
}

class DeterministicEnvelopeSecurity implements EnvelopeSecurity {
  async sign(envelope: UnsignedEnvelope): Promise<string> { return `sig:${JSON.stringify(envelope)}`; }
  async verify(envelope: Envelope): Promise<boolean> { return envelope.signature === `sig:${JSON.stringify({ version: envelope.version, type: envelope.type, id: envelope.id, sender: envelope.sender, recipient: envelope.recipient, nonce: envelope.nonce, expiresAt: envelope.expiresAt, body: envelope.body })}`; }
}

describe('R0P76 protected location sharing', () => {
  it('uses recipient E2E ciphertext, enforces approximate disclosure, ordering and replay', async () => {
    const alice = new InProcessDelivery('alice' as NodeId); const bob = new InProcessDelivery('bob' as NodeId); alice.pair(bob); bob.pair(alice);
    const security = new DeterministicEnvelopeSecurity(); const key = new Uint8Array(32); key.fill(7);
    const aliceCipher = new AesGcmLocationCipher(() => key, 'alice' as NodeId); const bobCipher = new AesGcmLocationCipher(() => key, 'bob' as NodeId);
    const received: string[] = []; const bobShares = new LocationShareService({ transport: bob, security, localNodeId: 'bob' as NodeId, cipher: bobCipher, now: () => at }); bobShares.onShare(value => { received.push(value.state); });
    const aliceShares = new LocationShareService({ transport: alice, security, localNodeId: 'alice' as NodeId, cipher: aliceCipher, now: () => at });
    const policy = new LocationPolicy(() => at); const service = new LocationService(new ControlledLocationProvider(() => at), policy, { now: () => at });
    const shareGrant = grant(policy, owner, 'SHARE', 'FOREGROUND', 'APPROXIMATE', 'bob');
    const session = await service.createShare({ ownerDeviceId: 'alice', target: 'bob', grantId: shareGrant.id, caller: owner, mode: 'ONE_SHOT', durationMs: 5 * 60_000 });
    await aliceShares.start(session, 'APPROXIMATE'); await aliceShares.flush();
    expect(bobShares.get(session.id)?.precision).toBe('APPROXIMATE');
    const senderFix = fix(); await aliceShares.sendFix({ ...session, state: 'ACTIVE', sequence: 0 }, senderFix); await aliceShares.flush();
    const remote = bobShares.get(session.id); expect(remote?.fix?.precision).toBe('APPROXIMATE'); expect(remote?.fix?.provenance).toBe('REMOTE_SHARED'); expect(remote?.fix?.latitude).not.toBe(senderFix.latitude); expect(JSON.stringify(remote)).not.toContain('55.751244');
    const beforeReject = bobShares.diagnostics().rejected; await aliceShares.sendFix({ ...session, state: 'ACTIVE', sequence: 0 }, senderFix); await aliceShares.flush(); expect(bobShares.diagnostics().rejected).toBeGreaterThan(beforeReject);
    await aliceShares.stop({ ...session, state: 'ACTIVE', sequence: 1 }); await aliceShares.flush(); expect(bobShares.get(session.id)?.state).toBe('STOPPED'); expect(received).toEqual(['ACTIVE', 'ACTIVE', 'STOPPED']);
    const rejectedAfterStop = bobShares.diagnostics().rejected;
    await aliceShares.sendFix({ ...session, state: 'ACTIVE', sequence: 3 }, senderFix); await aliceShares.flush();
    expect(bobShares.diagnostics().rejected).toBeGreaterThan(rejectedAfterStop);
    aliceShares.close(); bobShares.close();
  });

  it('does not expose precise sharing to a plugin/agent caller', async () => {
    const policy = new LocationPolicy(() => at); const plugin: LocationCaller = { id: 'plugin', kind: 'PLUGIN' };
    expect(() => grant(policy, plugin, 'SHARE', 'FOREGROUND', 'PRECISE', 'bob')).toThrowError(LocationError);
    expect(() => grant(policy, { id: 'agent', kind: 'AGENT' }, 'LOCAL_USE', 'ONE_SHOT', 'APPROXIMATE')).toThrowError(LocationError);
  });

  it('coalesces queued live updates without reordering START and STOP', async () => {
    const transport = new BlockingDelivery('alice' as NodeId);
    const security = new DeterministicEnvelopeSecurity();
    const key = new Uint8Array(32); key.fill(3);
    const shares = new LocationShareService({ transport, security, localNodeId: 'alice' as NodeId, cipher: new AesGcmLocationCipher(() => key, 'alice' as NodeId), now: () => at });
    const policy = new LocationPolicy(() => at); const service = new LocationService(new ControlledLocationProvider(() => at), policy, { now: () => at });
    const shareGrant = grant(policy, owner, 'SHARE', 'FOREGROUND', 'APPROXIMATE', 'bob');
    const session = await service.createShare({ ownerDeviceId: owner.id, target: 'bob', grantId: shareGrant.id, caller: owner, mode: 'LIVE', durationMs: 10 * 60_000 });
    await shares.start(session, 'APPROXIMATE');
    await shares.sendFix({ ...session, state: 'ACTIVE', sequence: 0 }, fix());
    await shares.sendFix({ ...session, state: 'ACTIVE', sequence: 1 }, fix(new Date(at + 1_000).toISOString()));
    expect(shares.diagnostics().pending).toBe(2); // START + newest UPDATE; the older UPDATE is superseded.
    transport.release(); await shares.flush();
    expect(transport.sent.map(value => (value.body as { kind?: string }).kind)).toEqual(['START', 'UPDATE']);
    shares.close();
  });

  it('detects cleartext coordinates even when an attacker adds a ciphertext-shaped field', () => {
    expect(locationWireContainsPlaintext({ ciphertext: 'opaque', latitude: 1 })).toBe(true);
    expect(locationWireContainsPlaintext({ ciphertext: { nonce: 'n', ciphertext: 'opaque' } })).toBe(false);
  });
});
