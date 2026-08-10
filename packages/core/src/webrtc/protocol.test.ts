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
});
