import { describe, expect, it } from 'vitest';
import { isCallSignal } from './protocol.js';

describe('WebRTC signaling boundary', () => {
  it('accepts typed SDP offers', () => {
    expect(isCallSignal({ type:'call_offer', callId:'call-1', media:'video', sdp:{ type:'offer', sdp:'v=0' } })).toBe(true);
  });
  it('rejects malformed or mismatched SDP', () => {
    expect(isCallSignal({ type:'call_offer', callId:'call-1', media:'video', sdp:{ type:'answer', sdp:'v=0' } })).toBe(false);
    expect(isCallSignal({ type:'call_end', callId:'', reason:'hangup' })).toBe(false);
  });
  it('accepts bounded versioned call envelopes and rejects unsafe payloads', () => {
    const base = { version: 1, type: 'CALL_SIGNAL', signalId: 'signal-1', callId: 'call-1', sessionId: 'session-1', sequence: 1, expiresAt: new Date(Date.now() + 10_000).toISOString() };
    expect(isCallSignal({ ...base, payload: { kind: 'offer', sdp: { type: 'offer', sdp: 'v=0' } } })).toBe(true);
    expect(isCallSignal({ ...base, payload: { kind: 'ice', candidate: { candidate: 'candidate:1', sdpMid: '0', sdpMLineIndex: 0 } } })).toBe(true);
    expect(isCallSignal({ ...base, payload: { kind: 'ice', candidate: { candidate: 'x'.repeat(16 * 1024 + 1) } } })).toBe(false);
    expect(isCallSignal({ ...base, payload: { kind: 'offer', sdp: { type: 'offer', sdp: 'x'.repeat(256 * 1024 + 1) } } })).toBe(false);
    expect(isCallSignal({ ...base, type: 'CALL_ACCEPT', payload: { deviceId: 'phone', claimId: 'claim-1' } })).toBe(true);
    expect(isCallSignal({ ...base, type: 'CALL_CLAIM', payload: { deviceId: 'phone' } })).toBe(false);
  });
});
