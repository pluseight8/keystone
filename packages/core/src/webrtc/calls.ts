import type { NodeId } from '../types.js';
import type { CallMediaKind, CallSignal, CallSignalReason, SignalingChannel, VersionedCallSignal } from './protocol.js';
import { isCallSignal, isVersionedCallSignal } from './protocol.js';
import type { MediaCaptureAdapter } from './platform.js';

/** Maximum lifetime of a live invite.  Missed-call metadata is separate. */
export const CALL_INVITE_TTL_MS = 30_000;
export const CALL_SIGNAL_TTL_MS = 60_000;
export const CALL_MAX_PENDING_INVITES = 8;
export const CALL_MAX_ACTIVE_SESSIONS = 1;
export const CALL_MAX_SIGNALS_PER_SESSION = 256;
export const CALL_MAX_ICE_CANDIDATES = 128;
export const CALL_MAX_SDP_BYTES = 256 * 1024;
export const CALL_MAX_RECONNECT_ATTEMPTS = 3;
export const CALL_RECONNECT_TIMEOUT_MS = 5_000;
export const CALL_MAX_HISTORY = 500;

export type CallState = 'IDLE' | 'OUTGOING' | 'RINGING' | 'CONNECTING' | 'CONNECTED' | 'RECONNECTING' | 'ENDING' | 'ENDED' | 'REJECTED' | 'MISSED' | 'FAILED';
export type CallMode = CallMediaKind;
export type CallMediaSource = 'microphone' | 'camera' | 'screen';
export type CallMediaPermission = 'microphone' | 'camera' | 'screen';
export type CallOutcome = 'completed' | 'rejected' | 'cancelled' | 'missed' | 'failed' | 'busy' | 'expired';
export type CallMediaState = 'enabled' | 'disabled';

export interface CallParticipant {
  readonly identityId: NodeId;
  readonly deviceId?: string;
}

export interface CallSession {
  readonly callId: string;
  readonly sessionId: string;
  readonly peerId: NodeId;
  readonly mode: CallMode;
  readonly direction: 'incoming' | 'outgoing';
  readonly createdAt: string;
  readonly inviteExpiresAt: string;
  readonly localDeviceId: string;
  readonly state: CallState;
  readonly remoteMicrophone: CallMediaState;
  readonly remoteCamera: CallMediaState;
  readonly remoteScreen: CallMediaState;
  readonly localMicrophone: CallMediaState;
  readonly localCamera: CallMediaState;
  readonly localScreen: CallMediaState;
  readonly reconnectAttempts: number;
  readonly error?: string;
}

export interface CallHistoryEntry {
  readonly version: 1;
  readonly callId: string;
  readonly sessionId: string;
  readonly participant: NodeId;
  readonly direction: 'incoming' | 'outgoing';
  readonly mode: CallMode;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly outcome: CallOutcome;
}

export interface CallHistoryStore {
  read(): Promise<unknown | undefined>;
  write(entries: readonly CallHistoryEntry[]): Promise<void>;
}

export class InMemoryCallHistoryStore implements CallHistoryStore {
  private value?: readonly CallHistoryEntry[];
  async read(): Promise<unknown | undefined> { return this.value ? structuredClone(this.value) : undefined; }
  async write(entries: readonly CallHistoryEntry[]): Promise<void> { this.value = structuredClone(entries); }
}

export interface CallPermissionPolicy {
  canCall?(peerId: NodeId): boolean | Promise<boolean>;
  canReceiveInvite?(peerId: NodeId): boolean | Promise<boolean>;
  isBlocked?(peerId: NodeId): boolean | Promise<boolean>;
  requestMicrophone?(): boolean | Promise<boolean>;
  requestCamera?(): boolean | Promise<boolean>;
  requestScreen?(): boolean | Promise<boolean>;
}

export type CallPrivacyPolicy = 'CONTACTS' | 'ALLOWED_CONTEXT' | 'ANYONE' | 'NOBODY';

/** Conservative policy helper.  Relationship checks stay host-owned. */
export class DefaultCallPermissionPolicy implements CallPermissionPolicy {
  constructor(private readonly options: {
    readonly privacy?: CallPrivacyPolicy;
    readonly contacts?: ReadonlySet<NodeId>;
    readonly allowed?: ReadonlySet<NodeId>;
    readonly blocked?: ReadonlySet<NodeId>;
    readonly permissions?: Partial<Record<CallMediaPermission, () => boolean | Promise<boolean>>>;
  } = {}) {}
  canCall(peerId: NodeId): boolean { return this.allowedPeer(peerId); }
  canReceiveInvite(peerId: NodeId): boolean { return this.allowedPeer(peerId); }
  isBlocked(peerId: NodeId): boolean { return this.options.blocked?.has(peerId) ?? false; }
  requestMicrophone(): boolean | Promise<boolean> { return this.options.permissions?.microphone?.() ?? true; }
  requestCamera(): boolean | Promise<boolean> { return this.options.permissions?.camera?.() ?? true; }
  requestScreen(): boolean | Promise<boolean> { return this.options.permissions?.screen?.() ?? true; }
  private allowedPeer(peerId: NodeId): boolean {
    if (this.isBlocked(peerId)) return false;
    const privacy = this.options.privacy ?? 'CONTACTS';
    if (privacy === 'NOBODY') return false;
    if (privacy === 'ANYONE') return true;
    return privacy === 'CONTACTS' ? (this.options.contacts?.has(peerId) ?? false) : (this.options.allowed?.has(peerId) ?? false);
  }
}

/** Just-in-time permission boundary.  Constructing this class never prompts. */
export class CallDeviceManager {
  constructor(private readonly adapter: MediaCaptureAdapter, private readonly policy: CallPermissionPolicy = {}) {}
  async microphone(): Promise<MediaStream> { if (!(await this.allowed('microphone'))) throw new CallPermissionError('microphone'); try { return await this.adapter.getUserMedia({ audio: true, video: false }); } catch (error) { if (isPermissionError(error)) throw new CallPermissionError('microphone'); throw error; } }
  async camera(): Promise<MediaStream> { if (!(await this.allowed('camera'))) throw new CallPermissionError('camera'); try { return await this.adapter.getUserMedia({ audio: false, video: true }); } catch (error) { if (isPermissionError(error)) throw new CallPermissionError('camera'); throw error; } }
  async screen(): Promise<MediaStream> { if (!(await this.allowed('screen'))) throw new CallPermissionError('screen'); try { return await this.adapter.getDisplayMedia({ video: true, audio: false }); } catch (error) { if (isPermissionError(error)) throw new CallPermissionError('screen'); throw error; } }
  private async allowed(permission: CallMediaPermission): Promise<boolean> {
    const callback = permission === 'microphone' ? this.policy.requestMicrophone : permission === 'camera' ? this.policy.requestCamera : this.policy.requestScreen;
    return callback ? !!(await callback()) : true;
  }
}

export class CallPermissionError extends Error {
  readonly code = 'PERMISSION_DENIED';
  constructor(readonly permission: CallMediaPermission) { super(`${permission} permission denied`); this.name = 'CallPermissionError'; }
}

export type CallMediaConnectionState = 'new' | 'connecting' | 'connected' | 'disconnected' | 'failed' | 'closed';

export interface CallMediaRuntimeOptions {
  readonly callId: string;
  readonly peerId: NodeId;
  readonly mode: CallMode;
  readonly initiator: boolean;
  readonly onSignal: (payload: CallSignalPayload) => void | Promise<void>;
  readonly onState: (state: CallMediaConnectionState) => void;
  readonly onRemoteTrack?: (track: MediaStreamTrack, streams: readonly MediaStream[]) => void;
}

export type CallSignalPayload =
  | { readonly kind: 'offer'; readonly sdp: RTCSessionDescriptionInit }
  | { readonly kind: 'answer'; readonly sdp: RTCSessionDescriptionInit }
  | { readonly kind: 'ice'; readonly candidate: RTCIceCandidateInit };

export interface CallMediaSession {
  readonly state: CallMediaConnectionState;
  start(): Promise<void>;
  handleSignal(payload: CallSignalPayload): Promise<void>;
  setStream(source: CallMediaSource, stream: MediaStream): Promise<void>;
  removeStream(source: CallMediaSource): Promise<void>;
  setEnabled(source: CallMediaSource, enabled: boolean): void;
  reconnect?(): Promise<void>;
  close(): Promise<void>;
}

/** Alias used by hosts that call the media endpoint a controller. */
export type CallMediaController = CallMediaSession;

export interface CallMediaRuntime {
  open(options: CallMediaRuntimeOptions): Promise<CallMediaSession>;
}

/**
 * Deterministic media boundary for unit/integration tests.  It models a
 * connected media endpoint but never calls getUserMedia or activates a real
 * device.  Production code must inject WebRTCCallMediaRuntime instead.
 */
export class ControlledCallMediaRuntime implements CallMediaRuntime {
  readonly sessions = new Set<ControlledCallMediaSession>();
  readonly openCount = { value: 0 };
  constructor(private readonly connectDelayMs = 0) {}
  async open(options: CallMediaRuntimeOptions): Promise<CallMediaSession> {
    const session = new ControlledCallMediaSession(options, this.connectDelayMs, () => this.sessions.delete(session));
    this.sessions.add(session); this.openCount.value += 1; return session;
  }
  activeCount(): number { return this.sessions.size; }
}

export class ControlledCallMediaSession implements CallMediaSession {
  state: CallMediaConnectionState = 'new';
  private readonly streams = new Map<CallMediaSource, MediaStream>();
  constructor(private readonly options: CallMediaRuntimeOptions, private readonly delayMs: number, private readonly onClosed: () => void) {}
  async start(): Promise<void> { if (this.state === 'closed') throw new Error('Media session is closed'); this.state = 'connecting'; this.options.onState(this.state); if (this.delayMs) await delay(this.delayMs); this.state = 'connected'; this.options.onState(this.state); }
  async handleSignal(_payload: CallSignalPayload): Promise<void> { if (this.state === 'new') await this.start(); }
  async setStream(source: CallMediaSource, stream: MediaStream): Promise<void> { if (this.state === 'closed') throw new Error('Media session is closed'); this.streams.set(source, stream); }
  async removeStream(source: CallMediaSource): Promise<void> { const stream = this.streams.get(source); this.streams.delete(source); stopStream(stream); }
  setEnabled(source: CallMediaSource, enabled: boolean): void { const stream = this.streams.get(source); for (const track of stream?.getTracks?.() ?? []) track.enabled = enabled; }
  async reconnect(): Promise<void> { await this.start(); }
  async close(): Promise<void> { if (this.state === 'closed') return; for (const stream of this.streams.values()) stopStream(stream); this.streams.clear(); this.state = 'closed'; this.options.onState('closed'); this.onClosed(); }
}

/**
 * Browser/host WebRTC runtime.  It uses the platform RTCPeerConnection and
 * therefore provides DTLS-SRTP through WebRTC; it is deliberately unavailable
 * when no native/browser implementation exists, rather than falling back to a
 * fake production media path.
 */
export class WebRTCCallMediaRuntime implements CallMediaRuntime {
  constructor(private readonly options: { readonly configuration?: RTCConfiguration; readonly factory?: (configuration: RTCConfiguration) => RTCPeerConnection } = {}) {}
  async open(options: CallMediaRuntimeOptions): Promise<CallMediaSession> {
    const factory = this.options.factory ?? ((configuration: RTCConfiguration) => {
      const Constructor = (globalThis as unknown as { RTCPeerConnection?: new (configuration?: RTCConfiguration) => RTCPeerConnection }).RTCPeerConnection;
      if (!Constructor) throw new Error('WebRTC RTCPeerConnection is unavailable');
      return new Constructor(configuration);
    });
    return new WebRTCCallMediaSession(options, factory(this.options.configuration ?? {}));
  }
}

/** Explicit name for callers that want to make the real-runtime boundary clear. */
export const RealWebRTCCallMediaRuntime = WebRTCCallMediaRuntime;

class WebRTCCallMediaSession implements CallMediaSession {
  private readonly streams = new Map<CallMediaSource, MediaStream>();
  private stateValue: CallMediaConnectionState = 'new';
  private makingOffer = false;
  private closed = false;
  private remoteDescriptionSet = false;
  private readonly pendingIceCandidates: RTCIceCandidateInit[] = [];
  constructor(private readonly options: CallMediaRuntimeOptions, private readonly pc: RTCPeerConnection) {
    pc.onicecandidate = event => { if (event.candidate) void options.onSignal({ kind: 'ice', candidate: event.candidate.toJSON() }); };
    pc.ontrack = event => options.onRemoteTrack?.(event.track, event.streams);
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState === 'connected' ? 'connected' : pc.connectionState === 'failed' ? 'failed' : pc.connectionState === 'disconnected' ? 'disconnected' : pc.connectionState === 'closed' ? 'closed' : 'connecting';
      this.setState(state);
    };
    pc.onnegotiationneeded = () => { if (options.initiator && !this.makingOffer && !this.closed) void this.createOffer(); };
  }
  get state(): CallMediaConnectionState { return this.stateValue; }
  async start(): Promise<void> { if (this.closed) throw new Error('Media session is closed'); if (this.options.initiator) await this.createOffer(); else this.setState('connecting'); }
  async handleSignal(payload: CallSignalPayload): Promise<void> {
    if (this.closed) return;
    if (payload.kind === 'ice') {
      if (!this.remoteDescriptionSet) { if (this.pendingIceCandidates.length < CALL_MAX_ICE_CANDIDATES) this.pendingIceCandidates.push(payload.candidate); return; }
      await this.pc.addIceCandidate(payload.candidate); return;
    }
    await this.pc.setRemoteDescription(payload.sdp);
    this.remoteDescriptionSet = true;
    while (this.pendingIceCandidates.length) await this.pc.addIceCandidate(this.pendingIceCandidates.shift()!);
    if (payload.kind === 'offer') {
      await this.pc.setLocalDescription(await this.pc.createAnswer());
      if (!this.pc.localDescription) throw new Error('WebRTC answer was not created');
      await this.options.onSignal({ kind: 'answer', sdp: { type: this.pc.localDescription.type, sdp: boundSdp(this.pc.localDescription.sdp) } });
      this.setState('connecting');
    }
  }
  async setStream(source: CallMediaSource, stream: MediaStream): Promise<void> {
    if (this.closed) throw new Error('Media session is closed');
    await this.removeStream(source);
    this.streams.set(source, stream);
    for (const track of stream.getTracks()) this.pc.addTrack(track, stream);
    if (this.stateValue === 'connected' || this.stateValue === 'connecting') await this.createOffer();
  }
  async removeStream(source: CallMediaSource): Promise<void> {
    const stream = this.streams.get(source); this.streams.delete(source); if (!stream) return;
    for (const track of stream.getTracks()) {
      const sender = this.pc.getSenders().find(value => value.track === track); if (sender) this.pc.removeTrack(sender);
      track.stop();
    }
    if (!this.closed && (this.stateValue === 'connected' || this.stateValue === 'connecting')) await this.createOffer();
  }
  setEnabled(source: CallMediaSource, enabled: boolean): void { for (const track of this.streams.get(source)?.getTracks() ?? []) track.enabled = enabled; }
  async reconnect(): Promise<void> { if (this.closed) return; this.setState('connecting'); if (this.options.initiator) await this.createOffer(); }
  async close(): Promise<void> { if (this.closed) return; this.closed = true; for (const stream of this.streams.values()) stopStream(stream); this.streams.clear(); this.pc.close(); this.setState('closed'); }
  private async createOffer(): Promise<void> {
    if (this.closed || this.makingOffer || this.pc.signalingState !== 'stable') return;
    this.makingOffer = true;
    try { await this.pc.setLocalDescription(await this.pc.createOffer()); if (!this.pc.localDescription) throw new Error('WebRTC offer was not created'); await this.options.onSignal({ kind: 'offer', sdp: { type: this.pc.localDescription.type, sdp: boundSdp(this.pc.localDescription.sdp) } }); this.setState('connecting'); }
    finally { this.makingOffer = false; }
  }
  private setState(state: CallMediaConnectionState): void { this.stateValue = state; this.options.onState(state); }
}

export interface CallClaim {
  readonly callId: string;
  readonly sessionId: string;
  readonly deviceId: string;
  readonly claimId: string;
  readonly createdAt: string;
}

export interface CallClaimAuthority {
  claim(value: CallClaim): Promise<{ readonly accepted: boolean; readonly winner: CallClaim }>;
  release?(callId: string, sessionId: string, deviceId: string): Promise<void> | void;
  subscribe?(listener: (claim: CallClaim) => void): () => void;
}

/** Deterministic owner-device claim authority for controlled multi-device tests. */
export class InMemoryCallClaimAuthority implements CallClaimAuthority {
  private readonly claims = new Map<string, CallClaim>();
  private readonly listeners = new Set<(claim: CallClaim) => void>();
  async claim(value: CallClaim): Promise<{ readonly accepted: boolean; readonly winner: CallClaim }> {
    const key = `${value.callId}:${value.sessionId}`; const existing = this.claims.get(key);
    if (!existing || value.deviceId.localeCompare(existing.deviceId) < 0 || (value.deviceId === existing.deviceId && value.claimId.localeCompare(existing.claimId) < 0)) { const winner = structuredClone(value); this.claims.set(key, winner); for (const listener of this.listeners) listener(structuredClone(winner)); return { accepted: true, winner }; }
    return { accepted: existing.deviceId === value.deviceId && existing.claimId === value.claimId, winner: structuredClone(existing) };
  }
  release(callId: string, sessionId: string, deviceId: string): void { const key = `${callId}:${sessionId}`; if (this.claims.get(key)?.deviceId === deviceId) this.claims.delete(key); }
  subscribe(listener: (claim: CallClaim) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  size(): number { return this.claims.size; }
}

export interface CallServiceOptions {
  readonly selfId: NodeId;
  readonly deviceId?: string;
  readonly signaling: SignalingChannel;
  readonly mediaRuntime?: CallMediaRuntime;
  readonly deviceManager?: CallDeviceManager;
  readonly permissionPolicy?: CallPermissionPolicy;
  readonly history?: CallHistoryStore;
  readonly now?: () => number;
  readonly maxPendingInvites?: number;
  readonly maxSignalsPerSession?: number;
  readonly maxReconnectAttempts?: number;
  readonly reconnectTimeoutMs?: number;
  readonly onMissedCall?: (entry: CallHistoryEntry) => void | Promise<void>;
  readonly isDeviceRevoked?: (deviceId: string) => boolean | Promise<boolean>;
  readonly claimAuthority?: CallClaimAuthority;
}

export interface CallServiceEvent {
  readonly kind: 'session' | 'history' | 'remoteTrack' | 'signalRejected';
  readonly session?: CallSession;
  readonly history?: CallHistoryEntry;
  readonly track?: MediaStreamTrack;
  readonly streams?: readonly MediaStream[];
  readonly reason?: string;
}

interface MutableSession {
  callId: string;
  sessionId: string;
  peerId: NodeId;
  mode: CallMode;
  direction: 'incoming' | 'outgoing';
  createdAt: number;
  inviteExpiresAt: number;
  state: CallState;
  sequence: number;
  lastRemoteSequence: number;
  seenSignals: Set<string>;
  media?: CallMediaSession;
  reconnectAttempts: number;
  reconnectTimer?: ReturnType<typeof setTimeout>;
  local: Record<CallMediaSource, CallMediaState>;
  remote: Record<CallMediaSource, CallMediaState>;
  claim?: CallClaim;
  error?: string;
  localDeviceId: string;
  receivedIceCandidates: number;
}

/**
 * Authenticated, bounded call application service.  It consumes only the
 * SignalingChannel abstraction (normally backed by KeystoneDeliveryInterface /
 * ConnectivityFabric) and never imports a physical transport.
 */
export class CallService {
  private readonly now: () => number;
  private readonly deviceId: string;
  private readonly policy: CallPermissionPolicy;
  private readonly mediaRuntime: CallMediaRuntime;
  private readonly listeners = new Set<(event: CallServiceEvent) => void>();
  private readonly sessions = new Map<string, MutableSession>();
  private readonly historyEntries: CallHistoryEntry[] = [];
  private readonly historyStore?: CallHistoryStore;
  private readonly seenSignalIds = new Set<string>();
  private readonly maxPendingInvites: number;
  private readonly maxSignalsPerSession: number;
  private readonly maxReconnectAttempts: number;
  private readonly reconnectTimeoutMs: number;
  private readonly unsubscribe: () => void;
  private readonly claimUnsubscribe?: () => void;
  private readonly readyPromise: Promise<void>;
  private closed = false;

  constructor(private readonly options: CallServiceOptions) {
    this.now = options.now ?? (() => Date.now());
    this.deviceId = options.deviceId ?? options.selfId;
    this.policy = options.permissionPolicy ?? {};
    this.mediaRuntime = options.mediaRuntime ?? new WebRTCCallMediaRuntime();
    this.historyStore = options.history;
    this.maxPendingInvites = Math.max(1, Math.min(CALL_MAX_PENDING_INVITES, Math.floor(options.maxPendingInvites ?? CALL_MAX_PENDING_INVITES)));
    this.maxSignalsPerSession = Math.max(8, Math.min(CALL_MAX_SIGNALS_PER_SESSION, Math.floor(options.maxSignalsPerSession ?? CALL_MAX_SIGNALS_PER_SESSION)));
    this.maxReconnectAttempts = Math.max(0, Math.min(CALL_MAX_RECONNECT_ATTEMPTS, Math.floor(options.maxReconnectAttempts ?? CALL_MAX_RECONNECT_ATTEMPTS)));
    this.reconnectTimeoutMs = Math.max(100, Math.min(60_000, Math.floor(options.reconnectTimeoutMs ?? CALL_RECONNECT_TIMEOUT_MS)));
    this.unsubscribe = options.signaling.subscribe((peerId, signal) => { void this.handleSignal(peerId, signal).catch(error => this.emit({ kind: 'signalRejected', reason: error instanceof Error ? error.message : String(error) })); });
    this.claimUnsubscribe = options.claimAuthority?.subscribe?.(claim => { const session = this.sessions.get(claim.callId); if (!session || session.sessionId !== claim.sessionId || session.direction !== 'incoming' || session.localDeviceId === claim.deviceId) return; if (['RINGING', 'CONNECTING', 'CONNECTED', 'RECONNECTING'].includes(session.state)) void this.finish(session, 'FAILED', 'claimed on another device'); });
    this.readyPromise = this.hydrateHistory();
  }

  async ready(): Promise<void> { await this.readyPromise; }
  subscribe(listener: (event: CallServiceEvent) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  current(): readonly CallSession[] { return [...this.sessions.values()].map(sessionSnapshot); }
  history(): readonly CallHistoryEntry[] { return this.historyEntries.map(value => structuredClone(value)); }
  getSession(callId: string): CallSession | undefined { const session = this.sessions.get(callId); return session ? sessionSnapshot(session) : undefined; }

  async startCall(peerId: NodeId, mode: CallMode = 'audio'): Promise<CallSession> {
    await this.ready();
    if (!boundedPeerId(peerId)) throw new CallPolicyError('Calling an invalid peer identity is not allowed');
    if (!(await this.allowed('canCall', peerId)) || (await this.blocked(peerId))) throw new CallPolicyError('Calling this identity is not allowed');
    if (this.hasActiveSession()) throw new CallStateError('Only one active call is supported');
    const now = this.now();
    const session = this.createSession(peerId, mode, 'outgoing', now, now + CALL_INVITE_TTL_MS);
    this.transition(session, 'OUTGOING');
    this.emitSession(session);
    this.sendBestEffort(peerId, this.makeSignal(session, 'CALL_INVITE', { mode }));
    return sessionSnapshot(session);
  }
  start(peerId: NodeId, mode: CallMode = 'audio'): Promise<CallSession> { return this.startCall(peerId, mode); }

  async acceptCall(callId: string, options: { readonly microphone?: boolean; readonly camera?: boolean } = {}): Promise<CallSession> {
    await this.ready();
    const session = this.require(callId);
    if (session.state !== 'RINGING') throw new CallStateError('CALL_ACCEPT is not valid in the current state');
    if (this.isExpired(session)) { await this.finish(session, 'MISSED', 'expired'); throw new CallStateError('Call invite expired'); }
    if (await this.revoked(this.deviceId)) throw new CallPolicyError('Revoked device cannot claim a call');
    const claim: CallClaim = { callId: session.callId, sessionId: session.sessionId, deviceId: this.deviceId, claimId: randomId('claim'), createdAt: new Date(this.now()).toISOString() };
    const claimResult = await this.options.claimAuthority?.claim(claim) ?? { accepted: true, winner: claim };
    if (!claimResult.accepted) { await this.finish(session, 'FAILED', 'claimed on another device'); throw new CallPolicyError('Another owned device claimed this call'); }
    session.claim = claim;
    this.clearReconnect(session);
    this.transition(session, 'CONNECTING');
    this.emitSession(session);
    this.sendBestEffort(session.peerId, this.makeSignal(session, 'CALL_CLAIM', { deviceId: claim.deviceId, claimId: claim.claimId }));
    this.sendBestEffort(session.peerId, this.makeSignal(session, 'CALL_ACCEPT', { deviceId: this.deviceId, claimId: claim.claimId }));
    await this.openMedia(session, false, options);
    return sessionSnapshot(session);
  }
  accept(callId: string, options: { readonly microphone?: boolean; readonly camera?: boolean } = {}): Promise<CallSession> { return this.acceptCall(callId, options); }

  async rejectCall(callId: string, reason: CallSignalReason = 'declined'): Promise<void> {
    const session = this.require(callId);
    if (session.state !== 'RINGING') throw new CallStateError('CALL_REJECT is not valid in the current state');
    this.transition(session, 'REJECTED');
    this.sendBestEffort(session.peerId, this.makeSignal(session, 'CALL_REJECT', { reason }));
    await this.recordAndRemove(session, 'rejected', 'REJECTED');
  }
  reject(callId: string, reason: CallSignalReason = 'declined'): Promise<void> { return this.rejectCall(callId, reason); }

  async cancelCall(callId: string): Promise<void> {
    const session = this.require(callId);
    if (session.state !== 'OUTGOING' && session.state !== 'RINGING' && session.state !== 'CONNECTING') throw new CallStateError('CALL_CANCEL is not valid in the current state');
    await this.endLocal(session, 'cancelled', 'CALL_CANCEL');
  }
  cancel(callId: string): Promise<void> { return this.cancelCall(callId); }

  async hangup(callId?: string): Promise<void> {
    const session = callId ? this.require(callId) : this.singleSession();
    if (!session || ['ENDED', 'REJECTED', 'MISSED', 'FAILED'].includes(session.state)) return;
    await this.endLocal(session, 'completed', 'CALL_END');
  }
  end(callId?: string): Promise<void> { return this.hangup(callId); }

  async setMuted(callId: string, muted: boolean): Promise<void> { await this.setLocalMediaState(callId, 'microphone', !muted); }
  async setCamera(callId: string, enabled: boolean): Promise<void> {
    const session = this.require(callId);
    if (enabled && !session.media) throw new CallStateError('Call media is not connected');
    if (enabled && !session.local.camera) {
      if (!this.options.deviceManager) throw new CallPermissionError('camera');
      try { await session.media!.setStream('camera', await this.options.deviceManager.camera()); } catch (error) { if (error instanceof CallPermissionError) throw error; throw error; }
    } else if (!enabled) await session.media?.removeStream('camera');
    session.local.camera = enabled ? 'enabled' : 'disabled'; this.sendBestEffort(session.peerId, this.makeSignal(session, 'CALL_MEDIA_STATE', { camera: session.local.camera })); this.emitSession(session);
  }
  async startScreenShare(callId: string): Promise<void> {
    const session = this.require(callId); if (!session.media || (session.state !== 'CONNECTED' && session.state !== 'CONNECTING')) throw new CallStateError('Call media is not connected');
    if (!this.options.deviceManager) throw new CallPermissionError('screen');
    const stream = await this.options.deviceManager.screen(); await session.media.setStream('screen', stream); session.local.screen = 'enabled'; this.sendBestEffort(session.peerId, this.makeSignal(session, 'CALL_MEDIA_STATE', { screen: 'enabled' })); this.emitSession(session);
  }
  async stopScreenShare(callId: string): Promise<void> { const session = this.require(callId); await session.media?.removeStream('screen'); session.local.screen = 'disabled'; this.sendBestEffort(session.peerId, this.makeSignal(session, 'CALL_MEDIA_STATE', { screen: 'disabled' })); this.emitSession(session); }

  dispose(): void { if (this.closed) return; this.closed = true; this.unsubscribe(); this.claimUnsubscribe?.(); for (const session of [...this.sessions.values()]) void this.finish(session, 'FAILED', 'disposed'); this.listeners.clear(); }

  private async handleSignal(peerId: NodeId, signal: CallSignal): Promise<void> {
    if (this.closed || !isCallSignal(signal) || !isVersionedCallSignal(signal)) return;
    const expiry = Date.parse(signal.expiresAt);
    if (signal.expiresAt && (expiry <= this.now() || expiry > this.now() + (signal.type === 'CALL_INVITE' ? CALL_INVITE_TTL_MS : CALL_SIGNAL_TTL_MS) + 5_000)) { this.emit({ kind: 'signalRejected', reason: expiry <= this.now() ? 'expired' : 'signal lifetime exceeded' }); return; }
    if (this.seenSignalIds.has(signal.signalId)) return;
    this.seenSignalIds.add(signal.signalId); trimSet(this.seenSignalIds, 2_048);
    let session = this.sessions.get(signal.callId);
    if (signal.type === 'CALL_INVITE') { await this.receiveInvite(peerId, signal); return; }
    if (!session || session.sessionId !== signal.sessionId || session.peerId !== peerId) { this.emit({ kind: 'signalRejected', reason: 'cross-session or wrong participant' }); return; }
    if (session.seenSignals.has(signal.signalId)) return;
    session.seenSignals.add(signal.signalId); trimSet(session.seenSignals, this.maxSignalsPerSession);
    if (signal.sequence <= session.lastRemoteSequence) return;
    session.lastRemoteSequence = signal.sequence;
    switch (signal.type) {
      case 'CALL_ACCEPT': await this.receiveAccept(session); break;
      case 'CALL_CLAIM': await this.receiveClaim(session, signal); break;
      case 'CALL_REJECT': await this.receiveReject(session, reasonOf(signal.payload, 'declined')); break;
      case 'CALL_CANCEL': await this.receiveCancel(session); break;
      case 'CALL_END': await this.receiveEnd(session, reasonOf(signal.payload, 'hangup')); break;
      case 'CALL_SIGNAL': await this.receiveMediaSignal(session, signal); break;
      case 'CALL_MEDIA_STATE': this.receiveMediaState(session, signal.payload); break;
    }
  }

  private async receiveInvite(peerId: NodeId, signal: VersionedCallSignal): Promise<void> {
    if (!boundedPeerId(peerId)) { this.emit({ kind: 'signalRejected', reason: 'invalid peer identity' }); return; }
    if (signal.mode !== 'audio' && signal.mode !== 'video') return;
    if (await this.blocked(peerId) || !(await this.allowed('canReceiveInvite', peerId))) { this.emit({ kind: 'signalRejected', reason: 'blocked or policy denied' }); return; }
    if (this.hasActiveSession() || [...this.sessions.values()].filter(value => value.state === 'RINGING').length >= this.maxPendingInvites) { this.sendBestEffort(peerId, this.makeReplySignal(signal, 'CALL_REJECT', { reason: 'busy' })); return; }
    const now = this.now();
    if (Date.parse(signal.expiresAt) <= now) return;
    const existing = this.sessions.get(signal.callId);
    if (existing) return;
    const session = this.createSession(peerId, signal.mode, 'incoming', now, Date.parse(signal.expiresAt));
    this.sessions.delete(session.callId);
    session.callId = signal.callId;
    this.sessions.set(session.callId, session);
    session.sessionId = signal.sessionId;
    session.seenSignals.add(signal.signalId);
    session.lastRemoteSequence = signal.sequence;
    this.transition(session, 'RINGING'); this.emitSession(session);
    this.armInviteExpiry(session);
  }

  private async receiveAccept(session: MutableSession): Promise<void> {
    if (session.direction !== 'outgoing' || session.state !== 'OUTGOING') return;
    if (this.isExpired(session)) { await this.finish(session, 'MISSED', 'expired'); return; }
    this.transition(session, 'CONNECTING'); this.emitSession(session); await this.openMedia(session, true, {});
  }
  private async receiveClaim(session: MutableSession, signal: VersionedCallSignal): Promise<void> {
    const payload = claimPayload(signal.payload); if (!payload) return;
    if (await this.revoked(payload.deviceId)) return;
    const incomingClaim: CallClaim = { callId: session.callId, sessionId: session.sessionId, deviceId: payload.deviceId, claimId: payload.claimId, createdAt: new Date(this.now()).toISOString() };
    const claimResult = await this.options.claimAuthority?.claim(incomingClaim) ?? { accepted: true, winner: incomingClaim };
    if (!claimResult.accepted && claimResult.winner.deviceId !== payload.deviceId) { if (session.direction === 'incoming') await this.finish(session, 'FAILED', 'claimed on another device'); return; }
    if (session.claim && session.claim.deviceId.localeCompare(payload.deviceId) <= 0) return;
    session.claim = incomingClaim;
    if (session.direction === 'incoming' && claimResult.winner.deviceId !== payload.deviceId) { await this.finish(session, 'FAILED', 'claimed on another device'); return; }
    if (session.direction === 'incoming' && (session.state === 'RINGING' || session.state === 'CONNECTING')) { await this.finish(session, 'FAILED', 'claimed on another device'); return; }
  }
  private async receiveReject(session: MutableSession, reason: CallSignalReason): Promise<void> { if (session.state === 'OUTGOING' || session.state === 'CONNECTING') await this.recordAndRemove(session, reason === 'busy' ? 'busy' : 'rejected', 'REJECTED'); }
  private async receiveCancel(session: MutableSession): Promise<void> { if (session.state === 'RINGING') await this.recordAndRemove(session, 'cancelled', 'ENDED'); else if (['OUTGOING', 'CONNECTING', 'CONNECTED', 'RECONNECTING'].includes(session.state)) await this.finish(session, 'ENDED', 'cancelled'); }
  private async receiveEnd(session: MutableSession, reason: CallSignalReason): Promise<void> { if (!['ENDED', 'REJECTED', 'MISSED', 'FAILED'].includes(session.state)) await this.finish(session, reason === 'failed' ? 'FAILED' : 'ENDED', reason); }
  private async receiveMediaSignal(session: MutableSession, signal: VersionedCallSignal): Promise<void> {
    if (!session.media || (session.state !== 'CONNECTING' && session.state !== 'CONNECTED' && session.state !== 'RECONNECTING')) return;
    const payload = signalPayload(signal.payload); if (!payload) return;
    if (payload.kind === 'ice') { session.receivedIceCandidates += 1; if (session.receivedIceCandidates > CALL_MAX_ICE_CANDIDATES) { this.emit({ kind: 'signalRejected', session: sessionSnapshot(session), reason: 'ICE candidate limit exceeded' }); return; } }
    await session.media.handleSignal(payload);
  }
  private receiveMediaState(session: MutableSession, value: unknown): void { if (!value || typeof value !== 'object') return; const payload = value as Record<string, unknown>; for (const source of ['microphone', 'camera', 'screen'] as const) if (payload[source] === 'enabled' || payload[source] === 'disabled') session.remote[source] = payload[source]; this.emitSession(session); }

  private async openMedia(session: MutableSession, initiator: boolean, capture: { readonly microphone?: boolean; readonly camera?: boolean }): Promise<void> {
    if (session.media) return;
    try {
      session.media = await this.mediaRuntime.open({ callId: session.callId, peerId: session.peerId, mode: session.mode, initiator, onSignal: payload => { this.sendBestEffort(session.peerId, this.makeSignal(session, 'CALL_SIGNAL', payload)); }, onState: state => { void this.handleMediaState(session, state); }, onRemoteTrack: (track, streams) => this.emit({ kind: 'remoteTrack', session: sessionSnapshot(session), track, streams }) });
    } catch (error) {
      session.error = error instanceof Error ? error.message : String(error);
      await this.finish(session, 'FAILED', 'media runtime unavailable');
      return;
    }
    try {
      if (capture.microphone !== false && this.options.deviceManager) await this.capture(session, 'microphone');
      if (capture.camera === true && session.mode === 'video' && this.options.deviceManager) await this.capture(session, 'camera');
      await session.media.start();
    } catch (error) {
      if (error instanceof CallPermissionError) { await session.media.start().catch(() => undefined); }
      else { session.error = error instanceof Error ? error.message : String(error); await this.finish(session, 'FAILED', 'media setup failed'); }
    }
  }
  private async capture(session: MutableSession, source: CallMediaSource): Promise<void> {
    if (!this.options.deviceManager || !session.media) return;
    try { const stream = source === 'microphone' ? await this.options.deviceManager.microphone() : source === 'camera' ? await this.options.deviceManager.camera() : await this.options.deviceManager.screen(); await session.media.setStream(source, stream); session.local[source] = 'enabled'; }
    catch (error) { if (!(error instanceof CallPermissionError)) throw error; session.local[source] = 'disabled'; }
  }
  private async handleMediaState(session: MutableSession, state: CallMediaConnectionState): Promise<void> {
    if (this.closed || !this.sessions.has(session.callId)) return;
    if (state === 'connected') { if (session.state === 'CONNECTING' || session.state === 'RECONNECTING') { session.reconnectAttempts = 0; this.clearReconnect(session); this.transition(session, 'CONNECTED'); this.emitSession(session); } return; }
    if (state === 'disconnected' || state === 'failed') { if (session.state === 'CONNECTED' || session.state === 'CONNECTING') { this.transition(session, 'RECONNECTING'); this.emitSession(session); } this.scheduleReconnect(session); return; }
    if (state === 'closed' && !['ENDING', 'ENDED', 'REJECTED', 'MISSED', 'FAILED'].includes(session.state)) await this.finish(session, 'FAILED', 'media closed');
  }
  private scheduleReconnect(session: MutableSession): void {
    this.clearReconnect(session);
    if (session.reconnectAttempts >= this.maxReconnectAttempts) { void this.finish(session, 'FAILED', 'reconnect timeout'); return; }
    session.reconnectAttempts += 1;
    session.reconnectTimer = setTimeout(() => { session.reconnectTimer = undefined; void (session.media?.reconnect?.() ?? Promise.reject(new Error('reconnect unavailable'))).catch(() => this.scheduleReconnect(session)); }, this.reconnectTimeoutMs);
    session.reconnectTimer.unref?.();
  }
  private async setLocalMediaState(callId: string, source: CallMediaSource, enabled: boolean): Promise<void> { const session = this.require(callId); if (!session.media) throw new CallStateError('Call media is not connected'); session.media.setEnabled(source, enabled); session.local[source] = enabled ? 'enabled' : 'disabled'; this.sendBestEffort(session.peerId, this.makeSignal(session, 'CALL_MEDIA_STATE', { [source]: session.local[source] })); this.emitSession(session); }
  private async endLocal(session: MutableSession, outcome: CallOutcome, signalType: 'CALL_CANCEL' | 'CALL_END'): Promise<void> { if (['ENDED', 'REJECTED', 'MISSED', 'FAILED'].includes(session.state)) return; this.transition(session, 'ENDING'); this.clearReconnect(session); await session.media?.close(); session.media = undefined; this.transition(session, 'ENDED'); this.sendBestEffort(session.peerId, this.makeSignal(session, signalType, { reason: outcome === 'cancelled' ? 'cancelled' : 'hangup' })); await this.recordAndRemove(session, outcome, 'ENDED'); }
  private async finish(session: MutableSession, terminal: Extract<CallState, 'ENDED' | 'REJECTED' | 'MISSED' | 'FAILED'>, reason: string): Promise<void> { if (['ENDED', 'REJECTED', 'MISSED', 'FAILED'].includes(session.state)) return; this.clearReconnect(session); await session.media?.close(); session.media = undefined; this.transition(session, terminal); await this.recordAndRemove(session, terminal === 'MISSED' ? 'missed' : terminal === 'REJECTED' ? 'rejected' : terminal === 'FAILED' ? 'failed' : 'completed', terminal, reason); }
  private async recordAndRemove(session: MutableSession, outcome: CallOutcome, terminal: Extract<CallState, 'ENDED' | 'REJECTED' | 'MISSED' | 'FAILED'>, reason?: string): Promise<void> { this.clearReconnect(session); session.error = reason; session.state = terminal; await this.options.claimAuthority?.release?.(session.callId, session.sessionId, session.localDeviceId); const entry: CallHistoryEntry = { version: 1, callId: session.callId, sessionId: session.sessionId, participant: session.peerId, direction: session.direction, mode: session.mode, startedAt: new Date(session.createdAt).toISOString(), endedAt: new Date(this.now()).toISOString(), outcome }; this.historyEntries.push(entry); while (this.historyEntries.length > CALL_MAX_HISTORY) this.historyEntries.shift(); await this.historyStore?.write(this.historyEntries); this.emit({ kind: 'history', history: structuredClone(entry), session: sessionSnapshot(session) }); if (outcome === 'missed') await this.options.onMissedCall?.(entry); this.sessions.delete(session.callId); this.emitSession(session); }
  private async hydrateHistory(): Promise<void> { if (!this.historyStore) return; const value = await this.historyStore.read(); if (!Array.isArray(value)) return; for (const item of value) if (isHistoryEntry(item)) this.historyEntries.push(item); while (this.historyEntries.length > CALL_MAX_HISTORY) this.historyEntries.shift(); }
  private createSession(peerId: NodeId, mode: CallMode, direction: 'incoming' | 'outgoing', createdAt: number, expiresAt: number): MutableSession { const session: MutableSession = { callId: randomId('call'), sessionId: randomId('session'), peerId, mode, direction, createdAt, inviteExpiresAt: expiresAt, state: 'IDLE', sequence: 0, lastRemoteSequence: -1, seenSignals: new Set(), reconnectAttempts: 0, local: { microphone: 'disabled', camera: 'disabled', screen: 'disabled' }, remote: { microphone: 'disabled', camera: 'disabled', screen: 'disabled' }, localDeviceId: this.deviceId, receivedIceCandidates: 0 }; this.sessions.set(session.callId, session); return session; }
  private makeSignal(session: MutableSession, type: VersionedCallSignal['type'], payload?: unknown): VersionedCallSignal { return { version: 1, type, signalId: randomId('signal'), callId: session.callId, sessionId: session.sessionId, sequence: ++session.sequence, expiresAt: new Date(this.now() + (type === 'CALL_INVITE' ? CALL_INVITE_TTL_MS : CALL_SIGNAL_TTL_MS)).toISOString(), ...(type === 'CALL_INVITE' || type === 'CALL_ACCEPT' ? { mode: session.mode } : {}), ...(payload === undefined ? {} : { payload }) }; }
  private makeReplySignal(signal: VersionedCallSignal, type: VersionedCallSignal['type'], payload?: unknown): VersionedCallSignal { return { version: 1, type, signalId: randomId('signal'), callId: signal.callId, sessionId: signal.sessionId, sequence: signal.sequence + 1, expiresAt: new Date(this.now() + CALL_SIGNAL_TTL_MS).toISOString(), ...(signal.mode ? { mode: signal.mode } : {}), ...(payload === undefined ? {} : { payload }) }; }
  private sendBestEffort(peerId: NodeId, signal: CallSignal): void { void this.options.signaling.send(peerId, signal).catch(() => undefined); }
  private armInviteExpiry(session: MutableSession): void { const delayMs = Math.max(1, session.inviteExpiresAt - this.now()); const timer = setTimeout(() => { if (this.sessions.has(session.callId) && session.state === 'RINGING') void this.finish(session, 'MISSED', 'expired'); }, delayMs); timer.unref?.(); session.reconnectTimer = timer; }
  private clearReconnect(session: MutableSession): void { if (session.reconnectTimer) clearTimeout(session.reconnectTimer); session.reconnectTimer = undefined; }
  private transition(session: MutableSession, next: CallState): void { if (!canTransition(session.state, next)) throw new CallStateError(`${session.state} -> ${next} is not allowed`); session.state = next; }
  private emitSession(session: MutableSession): void { this.emit({ kind: 'session', session: sessionSnapshot(session) }); }
  private emit(event: CallServiceEvent): void { for (const listener of this.listeners) listener(event); }
  private require(callId: string): MutableSession { const session = this.sessions.get(callId); if (!session) throw new CallStateError('Unknown call session'); return session; }
  private singleSession(): MutableSession | undefined { return this.sessions.values().next().value as MutableSession | undefined; }
  private hasActiveSession(): boolean { return [...this.sessions.values()].some(value => !['ENDED', 'REJECTED', 'MISSED', 'FAILED'].includes(value.state)); }
  private isExpired(session: MutableSession): boolean { return session.inviteExpiresAt <= this.now(); }
  private async blocked(peerId: NodeId): Promise<boolean> { return this.policy.isBlocked ? !!(await this.policy.isBlocked(peerId)) : false; }
  private async allowed(kind: 'canCall' | 'canReceiveInvite', peerId: NodeId): Promise<boolean> { const fn = this.policy[kind]; return fn ? !!(await fn(peerId)) : true; }
  private async revoked(deviceId: string): Promise<boolean> { return this.options.isDeviceRevoked ? !!(await this.options.isDeviceRevoked(deviceId)) : false; }
}

export class CallStateError extends Error { readonly code = 'INVALID_CALL_STATE'; constructor(message: string) { super(message); this.name = 'CallStateError'; } }
export class CallPolicyError extends Error { readonly code = 'CALL_POLICY_DENIED'; constructor(message: string) { super(message); this.name = 'CallPolicyError'; } }

function canTransition(from: CallState, to: CallState): boolean {
  if (from === to) return true;
  const allowed: Readonly<Record<CallState, readonly CallState[]>> = {
    IDLE: ['OUTGOING', 'RINGING'], OUTGOING: ['CONNECTING', 'REJECTED', 'ENDING', 'MISSED', 'FAILED'], RINGING: ['CONNECTING', 'REJECTED', 'ENDING', 'MISSED', 'FAILED'], CONNECTING: ['CONNECTED', 'RECONNECTING', 'ENDING', 'REJECTED', 'FAILED'], CONNECTED: ['RECONNECTING', 'ENDING', 'FAILED'], RECONNECTING: ['CONNECTED', 'ENDING', 'FAILED'], ENDING: ['ENDED', 'FAILED'], ENDED: [], REJECTED: [], MISSED: [], FAILED: [],
  };
  return allowed[from].includes(to);
}

export function isValidCallTransition(from: CallState, to: CallState): boolean { return canTransition(from, to); }

function sessionSnapshot(session: MutableSession): CallSession { return { callId: session.callId, sessionId: session.sessionId, peerId: session.peerId, mode: session.mode, direction: session.direction, createdAt: new Date(session.createdAt).toISOString(), inviteExpiresAt: new Date(session.inviteExpiresAt).toISOString(), localDeviceId: session.localDeviceId ?? '', state: session.state, remoteMicrophone: session.remote.microphone, remoteCamera: session.remote.camera, remoteScreen: session.remote.screen, localMicrophone: session.local.microphone, localCamera: session.local.camera, localScreen: session.local.screen, reconnectAttempts: session.reconnectAttempts, ...(session.error ? { error: session.error } : {}) }; }

function reasonOf(value: unknown, fallback: CallSignalReason): CallSignalReason { if (value && typeof value === 'object' && typeof (value as Record<string, unknown>).reason === 'string') return (value as Record<string, unknown>).reason as CallSignalReason; return fallback; }
function claimPayload(value: unknown): { deviceId: string; claimId: string } | undefined { if (!value || typeof value !== 'object') return undefined; const payload = value as Record<string, unknown>; return typeof payload.deviceId === 'string' && typeof payload.claimId === 'string' ? { deviceId: payload.deviceId, claimId: payload.claimId } : undefined; }
function signalPayload(value: unknown): CallSignalPayload | undefined { if (!value || typeof value !== 'object') return undefined; const payload = value as Record<string, unknown>; if (payload.kind === 'ice' && payload.candidate && typeof payload.candidate === 'object') return { kind: 'ice', candidate: payload.candidate as RTCIceCandidateInit }; if ((payload.kind === 'offer' || payload.kind === 'answer') && payload.sdp && typeof payload.sdp === 'object') return { kind: payload.kind, sdp: payload.sdp as RTCSessionDescriptionInit }; return undefined; }
function isHistoryEntry(value: unknown): value is CallHistoryEntry { if (!value || typeof value !== 'object') return false; const item = value as Record<string, unknown>; return item.version === 1 && typeof item.callId === 'string' && typeof item.sessionId === 'string' && typeof item.participant === 'string' && (item.direction === 'incoming' || item.direction === 'outgoing') && (item.mode === 'audio' || item.mode === 'video') && typeof item.startedAt === 'string' && typeof item.endedAt === 'string' && ['completed', 'rejected', 'cancelled', 'missed', 'failed', 'busy', 'expired'].includes(String(item.outcome)); }
function stopStream(stream: MediaStream | undefined): void { for (const track of stream?.getTracks?.() ?? []) track.stop(); }
function randomId(prefix: string): string { return `${prefix}-${crypto.randomUUID()}`; }
function trimSet<T>(set: Set<T>, max: number): void { while (set.size > max) { const first = set.values().next().value as T | undefined; if (first === undefined) break; set.delete(first); } }
function delay(ms: number): Promise<void> { return new Promise(resolve => setTimeout(resolve, ms)); }
function boundSdp(value: string): string { if (new TextEncoder().encode(value).byteLength > CALL_MAX_SDP_BYTES) throw new Error('SDP exceeds call limit'); return value; }
function isPermissionError(value: unknown): boolean { return !!value && typeof value === 'object' && ['NotAllowedError', 'PermissionDeniedError', 'AbortError'].includes(String((value as { name?: unknown }).name)); }
function boundedPeerId(value: string): boolean { return typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value); }

/** Minimal deterministic tracks for controlled tests; they never touch host devices. */
export class ControlledMediaTrack {
  readonly id = randomId('track');
  enabled = true;
  stopped = false;
  private readonly listeners = new Set<() => void>();
  constructor(readonly kind: 'audio' | 'video') {}
  stop(): void { if (this.stopped) return; this.stopped = true; for (const listener of this.listeners) listener(); }
  addEventListener(type: string, listener: () => void): void { if (type === 'ended') this.listeners.add(listener); }
  removeEventListener(type: string, listener: () => void): void { if (type === 'ended') this.listeners.delete(listener); }
}

export class ControlledMediaStream {
  readonly id = randomId('stream');
  constructor(private readonly tracks: readonly ControlledMediaTrack[]) {}
  getTracks(): readonly ControlledMediaTrack[] { return this.tracks; }
  getAudioTracks(): readonly ControlledMediaTrack[] { return this.tracks.filter(track => track.kind === 'audio'); }
  getVideoTracks(): readonly ControlledMediaTrack[] { return this.tracks.filter(track => track.kind === 'video'); }
}
