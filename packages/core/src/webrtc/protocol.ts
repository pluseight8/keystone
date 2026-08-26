import type { NodeId } from '../types.js';
import type { Envelope } from '../connectivity.js';
import type { KeystoneDeliveryInterface } from '../connectivity.js';

export type CallMediaKind = 'audio' | 'video';

/**
 * Versioned application signalling for private calls.  The older lower-case
 * WebRTC messages below remain accepted for compatibility with the Live and
 * network validation fixtures; CallService only emits the versioned form.
 */
export type CallSignalType =
  | 'CALL_INVITE'
  | 'CALL_ACCEPT'
  | 'CALL_REJECT'
  | 'CALL_CANCEL'
  | 'CALL_SIGNAL'
  | 'CALL_MEDIA_STATE'
  | 'CALL_CLAIM'
  | 'CALL_END';

export type CallSignalReason = 'declined' | 'hangup' | 'failed' | 'busy' | 'cancelled' | 'expired' | 'blocked';

export interface VersionedCallSignal {
  readonly version: 1;
  readonly type: CallSignalType;
  readonly signalId: string;
  readonly callId: string;
  readonly sessionId: string;
  readonly sequence: number;
  readonly expiresAt: string;
  readonly mode?: CallMediaKind;
  readonly payload?: unknown;
}

export type CallSignal =
  | VersionedCallSignal
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
    private readonly transport: KeystoneDeliveryInterface,
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
  if (typeof signal.type !== 'string' || typeof signal.callId !== 'string' || !boundedId(signal.callId, 128)) return false;
  if (isVersionedSignalType(signal.type)) return isVersionedCallSignal(signal);
  if (signal.type === 'call_end') return signal.reason === undefined || ['declined', 'hangup', 'failed', 'busy'].includes(String(signal.reason));
  if (signal.type === 'ice_candidate') return !!signal.candidate && typeof signal.candidate === 'object';
  if (signal.type === 'call_answer') return isSdp(signal.sdp, 'answer');
  return signal.type === 'call_offer' && isSdp(signal.sdp, 'offer') && (signal.media === 'audio' || signal.media === 'video');
}

export function isVersionedCallSignal(value: unknown): value is VersionedCallSignal {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  try { if (JSON.stringify(record).length > 256 * 1024) return false; } catch { return false; }
  if (record.version !== 1 || typeof record.signalId !== 'string' || !boundedId(record.signalId, 128)) return false;
  if (typeof record.sessionId !== 'string' || !boundedId(record.sessionId, 128)) return false;
  if (!Number.isSafeInteger(record.sequence) || Number(record.sequence) < 0 || Number(record.sequence) > 100_000) return false;
  if (typeof record.expiresAt !== 'string') return false;
  const expiry = Date.parse(record.expiresAt);
  if (!Number.isFinite(expiry)) return false;
  if (record.mode !== undefined && record.mode !== 'audio' && record.mode !== 'video') return false;
  if (record.type === 'CALL_INVITE' && record.mode === undefined) return false;
  if (record.type === 'CALL_ACCEPT') return record.payload === undefined || isClaimPayload(record.payload);
  if (record.type === 'CALL_CLAIM') return isClaimPayload(record.payload);
  if (record.type === 'CALL_SIGNAL') return isSignalPayload(record.payload);
  if (record.type === 'CALL_MEDIA_STATE') return isMediaStatePayload(record.payload);
  if (record.type === 'CALL_REJECT' || record.type === 'CALL_CANCEL' || record.type === 'CALL_END') return isReasonPayload(record.payload);
  if (record.type === 'CALL_INVITE') return record.payload === undefined || (typeof record.payload === 'object' && record.payload !== null);
  return false;
}

function isVersionedSignalType(value: string): value is CallSignalType {
  return ['CALL_INVITE', 'CALL_ACCEPT', 'CALL_REJECT', 'CALL_CANCEL', 'CALL_SIGNAL', 'CALL_MEDIA_STATE', 'CALL_CLAIM', 'CALL_END'].includes(value);
}

function isSignalPayload(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  try { if (JSON.stringify(value).length > 256 * 1024) return false; } catch { return false; }
  const payload = value as Record<string, unknown>;
  if (payload.kind === 'ice') return isIceCandidate(payload.candidate);
  if (payload.kind === 'offer' || payload.kind === 'answer') return isSdp(payload.sdp, payload.kind);
  return false;
}

function isIceCandidate(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.candidate !== undefined && (typeof candidate.candidate !== 'string' || candidate.candidate.length > 16 * 1024)) return false;
  if (candidate.sdpMid !== undefined && (typeof candidate.sdpMid !== 'string' || candidate.sdpMid.length > 256)) return false;
  if (candidate.sdpMLineIndex !== undefined && (!Number.isSafeInteger(candidate.sdpMLineIndex) || Number(candidate.sdpMLineIndex) < 0 || Number(candidate.sdpMLineIndex) > 10_000)) return false;
  return Object.keys(candidate).every(key => ['candidate', 'sdpMid', 'sdpMLineIndex', 'usernameFragment'].includes(key));
}

function isClaimPayload(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const payload = value as Record<string, unknown>;
  return typeof payload.deviceId === 'string' && boundedId(payload.deviceId, 128) && typeof payload.claimId === 'string' && boundedId(payload.claimId, 128);
}

function isReasonPayload(value: unknown): boolean {
  if (value === undefined) return true;
  if (!value || typeof value !== 'object') return false;
  const reason = (value as Record<string, unknown>).reason;
  return reason === undefined || ['declined', 'hangup', 'failed', 'busy', 'cancelled', 'expired', 'blocked'].includes(String(reason));
}

function isMediaStatePayload(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const payload = value as Record<string, unknown>;
  return ['microphone', 'camera', 'screen'].every(key => payload[key] === undefined || payload[key] === 'enabled' || payload[key] === 'disabled');
}

function boundedId(value: string, max: number): boolean { return value.length > 0 && value.length <= max && !/[\u0000\u0001-\u001f\u007f]/.test(value); }

function isSdp(value: unknown, expectedType: 'offer' | 'answer'): boolean {
  if (!value || typeof value !== 'object') return false;
  const sdp = value as Record<string, unknown>;
  return sdp.type === expectedType && typeof sdp.sdp === 'string' && sdp.sdp.length > 0 && new TextEncoder().encode(sdp.sdp).byteLength <= 256 * 1024;
}
