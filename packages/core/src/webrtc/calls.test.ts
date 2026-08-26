import { describe, expect, it } from 'vitest';
import type { NodeId } from '../types.js';
import type { CallSignal, SignalingChannel, VersionedCallSignal } from './protocol.js';
import {
  CallDeviceManager,
  InMemoryCallClaimAuthority,
  CallService,
  CallPolicyError,
  ControlledCallMediaRuntime,
  ControlledMediaStream,
  ControlledMediaTrack,
  InMemoryCallHistoryStore,
  type CallServiceEvent,
} from './calls.js';

class LinkedSignaling implements SignalingChannel {
  peer?: LinkedSignaling;
  online = true;
  readonly sent: CallSignal[] = [];
  private readonly listeners = new Set<(peerId: NodeId, signal: CallSignal) => void>();
  constructor(readonly local: NodeId, readonly remote: NodeId) {}
  async send(_peerId: NodeId, signal: CallSignal): Promise<void> { this.sent.push(structuredClone(signal)); if (!this.online || !this.peer?.online) return; for (const listener of this.peer.listeners) listener(this.local, structuredClone(signal)); }
  subscribe(listener: (peerId: NodeId, signal: CallSignal) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
}

function pair(): { a: LinkedSignaling; b: LinkedSignaling } {
  const a = new LinkedSignaling('alice' as NodeId, 'bob' as NodeId); const b = new LinkedSignaling('bob' as NodeId, 'alice' as NodeId); a.peer = b; b.peer = a; return { a, b };
}

async function settle(): Promise<void> { await new Promise(resolve => setTimeout(resolve, 0)); await new Promise(resolve => setTimeout(resolve, 0)); }

describe('CallService', () => {
  it('runs an authenticated-shaped 1:1 voice lifecycle without device capture', async () => {
    const links = pair(); const aliceMedia = new ControlledCallMediaRuntime(); const bobMedia = new ControlledCallMediaRuntime();
    const alice = new CallService({ selfId: 'alice' as NodeId, deviceId: 'desktop' as string, signaling: links.a, mediaRuntime: aliceMedia });
    const bob = new CallService({ selfId: 'bob' as NodeId, deviceId: 'phone', signaling: links.b, mediaRuntime: bobMedia });
    const outgoing = await alice.startCall('bob' as NodeId, 'audio'); await settle();
    const incoming = bob.current()[0]; expect(outgoing.state).toBe('OUTGOING'); expect(incoming?.state).toBe('RINGING');
    await bob.acceptCall(incoming!.callId); await settle();
    expect(alice.current()[0]?.state).toBe('CONNECTED'); expect(bob.current()[0]?.state).toBe('CONNECTED');
    await alice.hangup(outgoing.callId); await settle();
    expect(alice.current()).toHaveLength(0); expect(bob.current()).toHaveLength(0); expect(alice.history()[0]?.outcome).toBe('completed');
    alice.dispose(); bob.dispose();
  });

  it('keeps invite, cancel, reject and replay semantics bounded', async () => {
    const links = pair(); const alice = new CallService({ selfId: 'alice' as NodeId, signaling: links.a, mediaRuntime: new ControlledCallMediaRuntime() }); const bob = new CallService({ selfId: 'bob' as NodeId, signaling: links.b, mediaRuntime: new ControlledCallMediaRuntime() });
    const call = await alice.startCall('bob' as NodeId); await settle(); const incoming = bob.current()[0]!;
    const invite = links.a.sent.find(value => value.type === 'CALL_INVITE')!; expect(bob.current()).toHaveLength(1);
    await links.a.send('bob' as NodeId, invite); await settle(); expect(bob.current()).toHaveLength(1);
    await alice.cancelCall(call.callId); await settle(); expect(bob.current()).toHaveLength(0);
    await expect(bob.rejectCall(incoming.callId)).rejects.toThrow();
    alice.dispose(); bob.dispose();
  });

  it('rejects expired and cross-session signals before media setup', async () => {
    const links = pair(); let now = Date.now(); const bob = new CallService({ selfId: 'bob' as NodeId, signaling: links.b, now: () => now, mediaRuntime: new ControlledCallMediaRuntime() });
    const expired: VersionedCallSignal = { version: 1, type: 'CALL_INVITE', signalId: 'expired', callId: 'old', sessionId: 'old-session', sequence: 0, expiresAt: new Date(now - 1).toISOString(), mode: 'audio' };
    await links.a.send('bob' as NodeId, expired); await settle(); expect(bob.current()).toHaveLength(0);
    now += 1_000; const other: VersionedCallSignal = { version: 1, type: 'CALL_SIGNAL', signalId: 'cross', callId: 'old', sessionId: 'other-session', sequence: 1, expiresAt: new Date(now + 10_000).toISOString(), payload: { kind: 'offer', sdp: { type: 'offer', sdp: 'v=0' } } }; await links.a.send('bob' as NodeId, other); await settle(); expect(bob.current()).toHaveLength(0);
    bob.dispose();
  });

  it('does not capture on invite and treats denied microphone as a media-only limitation', async () => {
    const links = pair(); let captures = 0; const adapter = { async getUserMedia() { captures += 1; throw Object.assign(new Error('denied'), { name: 'NotAllowedError' }); }, async getDisplayMedia() { captures += 1; throw Object.assign(new Error('denied'), { name: 'NotAllowedError' }); } };
    const media = new ControlledCallMediaRuntime(); const alice = new CallService({ selfId: 'alice' as NodeId, signaling: links.a, mediaRuntime: new ControlledCallMediaRuntime() }); const bob = new CallService({ selfId: 'bob' as NodeId, signaling: links.b, mediaRuntime: media, deviceManager: new CallDeviceManager(adapter) });
    await alice.startCall('bob' as NodeId); await settle(); const incoming = bob.current()[0]!; expect(captures).toBe(0);
    await bob.acceptCall(incoming.callId); await settle(); expect(captures).toBe(1); expect(bob.current()[0]?.state).toBe('CONNECTED');
    alice.dispose(); bob.dispose();
  });

  it('fails closed when the host WebRTC media runtime is unavailable', async () => {
    const links = pair(); const unavailable = { async open(): Promise<never> { throw new Error('WebRTC RTCPeerConnection is unavailable'); } };
    const alice = new CallService({ selfId: 'alice' as NodeId, signaling: links.a, mediaRuntime: unavailable });
    const bob = new CallService({ selfId: 'bob' as NodeId, signaling: links.b, mediaRuntime: unavailable });
    await alice.startCall('bob' as NodeId); await settle(); const incoming = bob.current()[0]!; await bob.acceptCall(incoming.callId); await settle();
    expect(alice.current()).toHaveLength(0); expect(bob.current()).toHaveLength(0); expect(alice.history()[0]?.outcome).toBe('failed'); expect(bob.history()[0]?.outcome).toBe('failed'); alice.dispose(); bob.dispose();
  });

  it('requires explicit screen-share action and stops the local track immediately', async () => {
    const links = pair(); const screenTrack = new ControlledMediaTrack('video'); const adapter = { async getUserMedia() { return new ControlledMediaStream([new ControlledMediaTrack('audio')]) as unknown as MediaStream; }, async getDisplayMedia() { return new ControlledMediaStream([screenTrack]) as unknown as MediaStream; } };
    const alice = new CallService({ selfId: 'alice' as NodeId, signaling: links.a, mediaRuntime: new ControlledCallMediaRuntime() }); const bob = new CallService({ selfId: 'bob' as NodeId, signaling: links.b, mediaRuntime: new ControlledCallMediaRuntime(), deviceManager: new CallDeviceManager(adapter) });
    await alice.startCall('bob' as NodeId); await settle(); const call = bob.current()[0]!; await bob.acceptCall(call.callId); await settle(); expect(screenTrack.stopped).toBe(false); await bob.startScreenShare(call.callId); expect(screenTrack.stopped).toBe(false); await bob.stopScreenShare(call.callId); expect(screenTrack.stopped).toBe(true);
    alice.dispose(); bob.dispose();
  });

  it('cleans media sessions and bounded state over repeated lifecycles', async () => {
    const links = pair(); const media = new ControlledCallMediaRuntime(); const service = new CallService({ selfId: 'alice' as NodeId, signaling: links.a, mediaRuntime: media, history: new InMemoryCallHistoryStore() });
    for (let index = 0; index < 110; index += 1) { const call = await service.startCall(`bob-${index}` as NodeId); await service.hangup(call.callId); }
    expect(service.current()).toHaveLength(0); expect(media.activeCount()).toBe(0); expect(service.history()).toHaveLength(110); service.dispose();
  });

  it('restores bounded call history after a local service restart and rejects invalid peers', async () => {
    const links = pair(); const history = new InMemoryCallHistoryStore();
    const service = new CallService({ selfId: 'alice' as NodeId, signaling: links.a, mediaRuntime: new ControlledCallMediaRuntime(), history });
    await expect(service.startCall('\u0000invalid' as NodeId)).rejects.toBeInstanceOf(CallPolicyError);
    const call = await service.startCall('bob' as NodeId); await service.hangup(call.callId); await service.ready(); service.dispose();
    const restarted = new CallService({ selfId: 'alice' as NodeId, signaling: links.a, mediaRuntime: new ControlledCallMediaRuntime(), history });
    await restarted.ready(); expect(restarted.history()).toHaveLength(1); expect(restarted.history()[0]?.outcome).toBe('completed'); restarted.dispose();
  });

  it('supports invalid transition checks and blocked caller policy', async () => {
    const links = pair(); const events: CallServiceEvent[] = []; const bob = new CallService({ selfId: 'bob' as NodeId, signaling: links.b, permissionPolicy: { isBlocked: peer => peer === 'alice', canReceiveInvite: peer => peer !== 'alice' }, mediaRuntime: new ControlledCallMediaRuntime() }); bob.subscribe(event => events.push(event));
    await links.a.send('bob' as NodeId, { version: 1, type: 'CALL_INVITE', signalId: 'blocked', callId: 'blocked-call', sessionId: 'blocked-session', sequence: 0, expiresAt: new Date(Date.now() + 1_000).toISOString(), mode: 'audio' }); await settle(); expect(bob.current()).toHaveLength(0); expect(events.some(event => event.kind === 'signalRejected')).toBe(true); bob.dispose();
  });

  it('deterministically selects one endpoint when two owned devices claim a ringing call', async () => {
    const authority = new InMemoryCallClaimAuthority();
    const first = await authority.claim({ callId: 'call-1', sessionId: 'session-1', deviceId: 'tablet', claimId: 'claim-b', createdAt: new Date().toISOString() });
    const second = await authority.claim({ callId: 'call-1', sessionId: 'session-1', deviceId: 'phone', claimId: 'claim-a', createdAt: new Date().toISOString() });
    expect(first.accepted).toBe(true); expect(second.accepted).toBe(true); expect(second.winner.deviceId).toBe('phone');
    const replay = await authority.claim({ callId: 'call-1', sessionId: 'session-1', deviceId: 'tablet', claimId: 'claim-b', createdAt: new Date().toISOString() });
    expect(replay.accepted).toBe(false); expect(replay.winner.deviceId).toBe('phone');
  });

  it('bounds trickle ICE candidate floods per call session', async () => {
    const links = pair(); const events: CallServiceEvent[] = [];
    const alice = new CallService({ selfId: 'alice' as NodeId, signaling: links.a, mediaRuntime: new ControlledCallMediaRuntime() });
    const bob = new CallService({ selfId: 'bob' as NodeId, signaling: links.b, mediaRuntime: new ControlledCallMediaRuntime() }); bob.subscribe(event => events.push(event));
    const call = await alice.startCall('bob' as NodeId); await settle(); const incoming = bob.current()[0]!; await bob.acceptCall(incoming.callId); await settle();
    const signal = (sequence: number): VersionedCallSignal => ({ version: 1, type: 'CALL_SIGNAL', signalId: `ice-${sequence}`, callId: call.callId, sessionId: call.sessionId, sequence, expiresAt: new Date(Date.now() + 10_000).toISOString(), payload: { kind: 'ice', candidate: { candidate: `candidate:${sequence}`, sdpMid: '0', sdpMLineIndex: 0 } } });
    for (let sequence = 1; sequence <= 130; sequence += 1) await links.a.send('bob' as NodeId, signal(sequence));
    await settle(); expect(events.some(event => event.kind === 'signalRejected' && event.reason === 'ICE candidate limit exceeded')).toBe(true);
    await alice.hangup(call.callId); alice.dispose(); bob.dispose();
  });
});
