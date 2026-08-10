import type { NodeId } from '../types.js';
import type { CallMediaKind, CallSignal, SignalingChannel } from './protocol.js';
import type * as Y from 'yjs';
import type { AudioChunk, LocalSTTProvider } from '../ai/voice/stt.js';

export type CallState = 'idle' | 'ringing' | 'connecting' | 'active' | 'ended';
export type LocalTrackSource = 'microphone' | 'camera' | 'screen';

export interface CallSnapshot {
  state: CallState;
  callId?: string;
  peerId?: NodeId;
  media?: CallMediaKind;
  remoteStreams: readonly MediaStream[];
  error?: Error;
}

export interface CallManagerOptions {
  selfId: NodeId;
  signaling: SignalingChannel;
  rtcConfiguration?: RTCConfiguration;
  peerConnectionFactory?: (configuration: RTCConfiguration) => RTCPeerConnection;
}
export interface CallTranscriptEntry { callId:string; peerId:NodeId; speaker:'remote'; text:string; startMs:number; endMs:number; createdAt:string; }
/** Browser uses AudioWorklet; React Native uses its native WebRTC PCM callback. */
export interface RemoteTrackAudioSource { chunks(track:MediaStreamTrack,signal:AbortSignal):AsyncIterable<AudioChunk>; }
export interface CallTranscriptionOptions { stt:LocalSTTProvider; audio:RemoteTrackAudioSource; log:Y.Array<CallTranscriptEntry>; language?:string; }

type Listener = (snapshot: CallSnapshot) => void;

/** One-call WebRTC coordinator using the "perfect negotiation" glare pattern. */
export class CallManager {
  private snapshot: CallSnapshot = { state: 'idle', remoteStreams: [] };
  private pc?: RTCPeerConnection;
  private unsubscribeSignal: () => void;
  private readonly listeners = new Set<Listener>();
  private readonly localTracks = new Map<LocalTrackSource, { track: MediaStreamTrack; stream: MediaStream; sender?: RTCRtpSender }>();
  private readonly pendingCandidates: RTCIceCandidateInit[] = [];
  private pendingOffer?: Extract<CallSignal, { type: 'call_offer' }>;
  private makingOffer = false;
  private ignoreOffer = false;
  private isSettingRemoteAnswerPending = false;
  private operation: Promise<void> = Promise.resolve();
  private transcription?:CallTranscriptionOptions;
  private readonly transcribedTracks=new WeakSet<MediaStreamTrack>();
  private readonly transcriptionControllers=new Set<AbortController>();

  constructor(private readonly options: CallManagerOptions) {
    this.unsubscribeSignal = options.signaling.subscribe((peerId, signal) => {
      void this.handleSignal(peerId, signal).catch(error => this.fail(asError(error)));
    });
  }

  get current(): CallSnapshot { return this.snapshot; }
  subscribe(listener: Listener): () => void { this.listeners.add(listener); listener(this.snapshot); return () => this.listeners.delete(listener); }

  async startCall(peerId: NodeId, media: CallMediaKind, tracks: Partial<Record<LocalTrackSource, MediaStream>> = {}): Promise<void> {
    if (this.snapshot.state !== 'idle' && this.snapshot.state !== 'ended') throw new Error('A call is already in progress');
    const callId = crypto.randomUUID();
    this.setSnapshot({ state: 'connecting', callId, peerId, media, remoteStreams: [] });
    this.createPeerConnection();
    await this.attachInitialStreams(tracks);
    await this.negotiate(false);
  }

  async accept(tracks: Partial<Record<LocalTrackSource, MediaStream>> = {}): Promise<void> {
    if (this.snapshot.state !== 'ringing' || !this.pendingOffer) throw new Error('There is no incoming call');
    const offer = this.pendingOffer; this.pendingOffer = undefined;
    this.setSnapshot({ ...this.snapshot, state: 'connecting' });
    const pc = this.createPeerConnection();
    await this.attachInitialStreams(tracks);
    await pc.setRemoteDescription(offer.sdp);
    await this.flushCandidates();
    await pc.setLocalDescription(await pc.createAnswer());
    await this.send({ type: 'call_answer', callId: offer.callId, sdp: requireLocalDescription(pc) });
  }

  async decline(): Promise<void> {
    if (this.snapshot.state !== 'ringing') return;
    await this.send({ type: 'call_end', callId: this.requireCallId(), reason: 'declined' });
    this.finish();
  }

  /** Add microphone, camera, and screen tracks independently; every source can coexist. */
  async addStream(source: LocalTrackSource, stream: MediaStream): Promise<void> {
    const track = pickTrack(source, stream);
    await this.removeStream(source, false);
    const entry = { track, stream, sender: this.pc?.addTrack(track, stream) };
    this.localTracks.set(source, entry);
    if (source === 'screen') track.addEventListener('ended', () => { void this.removeStream('screen'); }, { once: true });
    if (this.pc && this.snapshot.state === 'active') await this.queueNegotiation();
  }

  async removeStream(source: LocalTrackSource, renegotiate = true): Promise<void> {
    const entry = this.localTracks.get(source);
    if (!entry) return;
    this.localTracks.delete(source);
    if (entry.sender && this.pc?.getSenders().includes(entry.sender)) this.pc.removeTrack(entry.sender);
    entry.track.stop();
    if (renegotiate && this.pc && (this.snapshot.state === 'active' || this.snapshot.state === 'connecting')) await this.queueNegotiation();
  }

  setEnabled(source: LocalTrackSource, enabled: boolean): void {
    const entry = this.localTracks.get(source);
    if (entry) entry.track.enabled = enabled;
  }

  async hangup(): Promise<void> {
    if (!this.snapshot.callId || !this.snapshot.peerId) return;
    try { await this.send({ type: 'call_end', callId: this.snapshot.callId, reason: 'hangup' }); } finally { this.finish(); }
  }

  reset(): void {
    if (this.snapshot.state !== 'ended') throw new Error('Only an ended call can be reset');
    this.setSnapshot({ state: 'idle', remoteStreams: [] });
  }

  dispose(): void { this.unsubscribeSignal(); this.finish(false); this.listeners.clear(); }

  /** Starts remote-party transcription; final Whisper segments are CRDT entries. */
  startCallTranscription(options:CallTranscriptionOptions):void{
    this.stopCallTranscription();this.transcription=options;
    for(const stream of this.snapshot.remoteStreams)for(const track of stream.getAudioTracks())this.attachTranscription(track);
  }
  stopCallTranscription():void{this.transcription=undefined;for(const controller of this.transcriptionControllers)controller.abort();this.transcriptionControllers.clear();}

  private createPeerConnection(): RTCPeerConnection {
    if (this.pc) return this.pc;
    const configuration = this.options.rtcConfiguration ?? {};
    const pc = this.options.peerConnectionFactory?.(configuration) ?? new RTCPeerConnection(configuration);
    pc.onicecandidate = event => { if (event.candidate) void this.send({ type: 'ice_candidate', callId: this.requireCallId(), candidate: event.candidate.toJSON() }); };
    pc.ontrack = event => {
      const streams = event.streams.length ? event.streams : [new MediaStream([event.track])];
      this.setSnapshot({ ...this.snapshot, remoteStreams: uniqueStreams([...this.snapshot.remoteStreams, ...streams]) });
      if(event.track.kind==='audio')this.attachTranscription(event.track);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') this.setSnapshot({ ...this.snapshot, state: 'active' });
      else if (pc.connectionState === 'failed') { void this.send({ type: 'call_end', callId: this.requireCallId(), reason: 'failed' }).finally(() => this.fail(new Error('WebRTC connection failed'))); }
    };
    pc.onnegotiationneeded = () => { if (this.snapshot.state === 'active') void this.queueNegotiation(); };
    this.pc = pc;
    return pc;
  }

  private async handleSignal(peerId: NodeId, signal: CallSignal): Promise<void> {
    if (signal.type === 'call_offer' && !signal.renegotiation && (this.snapshot.state === 'idle' || this.snapshot.state === 'ended')) {
      this.pendingOffer = signal;
      this.setSnapshot({ state: 'ringing', peerId, callId: signal.callId, media: signal.media, remoteStreams: [] });
      return;
    }
    if (peerId !== this.snapshot.peerId || signal.callId !== this.snapshot.callId) {
      if (signal.type === 'call_offer') await this.options.signaling.send(peerId, { type: 'call_end', callId: signal.callId, reason: 'busy' });
      return;
    }
    if (signal.type === 'call_end') { this.finish(); return; }
    if (signal.type === 'ice_candidate') {
      if (!this.pc?.remoteDescription) this.pendingCandidates.push(signal.candidate);
      else if (!this.ignoreOffer) await this.pc.addIceCandidate(signal.candidate);
      return;
    }
    const pc = this.createPeerConnection();
    if (signal.type === 'call_answer') {
      this.isSettingRemoteAnswerPending = true;
      try { await pc.setRemoteDescription(signal.sdp); await this.flushCandidates(); }
      finally { this.isSettingRemoteAnswerPending = false; }
      return;
    }
    const readyForOffer = !this.makingOffer && (pc.signalingState === 'stable' || this.isSettingRemoteAnswerPending);
    const offerCollision = !readyForOffer;
    const polite = this.options.selfId.localeCompare(peerId) > 0;
    this.ignoreOffer = !polite && offerCollision;
    if (this.ignoreOffer) return;
    if (offerCollision) await pc.setLocalDescription({ type: 'rollback' });
    await pc.setRemoteDescription(signal.sdp);
    await this.flushCandidates();
    await pc.setLocalDescription(await pc.createAnswer());
    await this.send({ type: 'call_answer', callId: signal.callId, sdp: requireLocalDescription(pc) });
  }

  private async negotiate(renegotiation: boolean): Promise<void> {
    const pc = this.pc;
    if (!pc || pc.signalingState !== 'stable') return;
    try {
      this.makingOffer = true;
      await pc.setLocalDescription(await pc.createOffer());
      await this.send({ type: 'call_offer', callId: this.requireCallId(), media: this.snapshot.media ?? 'video', renegotiation, sdp: requireLocalDescription(pc) });
    } finally { this.makingOffer = false; }
  }

  private queueNegotiation(): Promise<void> {
    this.operation = this.operation.then(() => this.negotiate(true));
    return this.operation;
  }

  private async attachInitialStreams(streams: Partial<Record<LocalTrackSource, MediaStream>>): Promise<void> {
    for (const source of ['microphone', 'camera', 'screen'] as const) if (streams[source]) await this.addStream(source, streams[source]);
  }
  private async flushCandidates(): Promise<void> { const pc = this.pc; if (!pc) return; for (const candidate of this.pendingCandidates.splice(0)) await pc.addIceCandidate(candidate); }
  private send(signal: CallSignal): Promise<void> { const peerId = this.snapshot.peerId; if (!peerId) throw new Error('Call has no peer'); return this.options.signaling.send(peerId, signal); }
  private requireCallId(): string { if (!this.snapshot.callId) throw new Error('Call has no id'); return this.snapshot.callId; }
  private setSnapshot(snapshot: CallSnapshot): void { this.snapshot = snapshot; this.listeners.forEach(listener => listener(snapshot)); }
  private finish(emit = true): void {
    for(const controller of this.transcriptionControllers)controller.abort();this.transcriptionControllers.clear();
    this.pc?.close(); this.pc = undefined; this.pendingOffer = undefined; this.pendingCandidates.length = 0;
    for (const { track } of this.localTracks.values()) track.stop(); this.localTracks.clear();
    if (emit) this.setSnapshot({ ...this.snapshot, state: 'ended', remoteStreams: [] });
  }
  private fail(error: Error): void { this.finish(false); this.setSnapshot({ ...this.snapshot, state: 'ended', remoteStreams: [], error }); }
  private attachTranscription(track:MediaStreamTrack):void{
    const config=this.transcription;if(!config||this.transcribedTracks.has(track))return;this.transcribedTracks.add(track);
    const controller=new AbortController();this.transcriptionControllers.add(controller);
    track.addEventListener('ended',()=>controller.abort(),{once:true});
    void this.transcribeTrack(track,config,controller).catch(error=>{if(!controller.signal.aborted)this.fail(asError(error));}).finally(()=>{this.transcriptionControllers.delete(controller);this.transcribedTracks.delete(track);});
  }
  private async transcribeTrack(track:MediaStreamTrack,config:CallTranscriptionOptions,controller:AbortController):Promise<void>{
    const session=await config.stt.createSession({language:config.language,signal:controller.signal});
    const callId=this.requireCallId(),peerId=this.snapshot.peerId;if(!peerId)throw new Error('Call has no peer');
    const results=(async()=>{for await(const segment of session.results)if(segment.final&&segment.text.trim())config.log.push([{callId,peerId,speaker:'remote',text:segment.text.trim(),startMs:segment.startMs,endMs:segment.endMs,createdAt:new Date().toISOString()}]);})();
    try{for await(const chunk of config.audio.chunks(track,controller.signal))await session.write(chunk);await session.finish();await results;}catch(error){await session.cancel(String(error));if(!controller.signal.aborted)throw error;}
  }
}

function pickTrack(source: LocalTrackSource, stream: MediaStream): MediaStreamTrack {
  const track = source === 'microphone' ? stream.getAudioTracks()[0] : stream.getVideoTracks()[0];
  if (!track) throw new Error(`${source} stream has no compatible track`);
  return track;
}
function requireLocalDescription(pc: RTCPeerConnection): RTCSessionDescriptionInit { if (!pc.localDescription) throw new Error('Local SDP was not created'); return { type: pc.localDescription.type, sdp: pc.localDescription.sdp }; }
function uniqueStreams(streams: readonly MediaStream[]): MediaStream[] { return [...new Map(streams.map(stream => [stream.id, stream])).values()]; }
function asError(value: unknown): Error { return value instanceof Error ? value : new Error(String(value)); }
