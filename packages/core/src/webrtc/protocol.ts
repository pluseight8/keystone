import type { NodeId } from '../types.js';
import type { Envelope, Transport } from '../transport.js';

export type CallMediaKind = 'audio' | 'video';

export type CallSignal =
  | { type: 'call_offer'; callId: string; sdp: RTCSessionDescriptionInit; media: CallMediaKind; renegotiation?: boolean }
  | { type: 'call_answer'; callId: string; sdp: RTCSessionDescriptionInit }
  | { type: 'ice_candidate'; callId: string; candidate: RTCIceCandidateInit }
  | { type: 'call_end'; callId: string; reason?: 'declined' | 'hangup' | 'failed' | 'busy' };

export interface SignalingChannel {
  send(peerId: NodeId, signal: CallSignal): Promise<void>;
  subscribe(handler: (peerId: NodeId, signal: CallSignal) => void): () => void;
}

/**
 * Adapts authenticated Hyperswarm envelopes to the WebRTC signaling contract.
 * Envelope creation stays with the identity layer so all signaling is signed,
 * expires, and receives a fresh nonce exactly like every other P2P message.
 */
export class HyperswarmSignalingChannel implements SignalingChannel {
  constructor(
    private readonly transport: Transport,
    private readonly createEnvelope: (peerId: NodeId, signal: CallSignal) => Promise<Envelope>,
    private readonly verifyEnvelope: (envelope: Envelope) => Promise<boolean>,
  ) {}

  async send(peerId: NodeId, signal: CallSignal): Promise<void> {
    await this.transport.connect(peerId);
    await this.transport.send(peerId, await this.createEnvelope(peerId, signal));
  }

  subscribe(handler: (peerId: NodeId, signal: CallSignal) => void): () => void {
    return this.transport.onMessage(envelope => {
      void this.verifyEnvelope(envelope).then(valid => {
        if (valid && isCallSignal(envelope.body)) handler(envelope.sender, envelope.body);
      }).catch(() => undefined);
    });
  }
}

export function isCallSignal(value: unknown): value is CallSignal {
  if (!value || typeof value !== 'object') return false;
  const signal = value as Record<string, unknown>;
  if (typeof signal.type !== 'string' || typeof signal.callId !== 'string' || signal.callId.length === 0) return false;
  if (signal.type === 'call_end') return signal.reason === undefined || ['declined', 'hangup', 'failed', 'busy'].includes(String(signal.reason));
  if (signal.type === 'ice_candidate') return !!signal.candidate && typeof signal.candidate === 'object';
  if (signal.type === 'call_answer') return isSdp(signal.sdp, 'answer');
  return signal.type === 'call_offer' && isSdp(signal.sdp, 'offer') && (signal.media === 'audio' || signal.media === 'video');
}

function isSdp(value: unknown, expectedType: 'offer' | 'answer'): boolean {
  if (!value || typeof value !== 'object') return false;
  const sdp = value as Record<string, unknown>;
  return sdp.type === expectedType && typeof sdp.sdp === 'string' && sdp.sdp.length > 0;
}
