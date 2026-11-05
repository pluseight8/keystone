/**
 * Real local media bootstrap for the desktop renderer.
 *
 * The media objects and content manifests remain Core-owned.  This adapter
 * supplies only the browser decoder and the IndexedDB-backed local stores;
 * identity signatures cross the Tauri host boundary as opaque operations.
 */
import {
  ContentCache,
  PersistentContentCache,
  PersistentMusicStorage,
  PersistentVideoStorage,
  LocalContentStore,
  MusicService,
  PlaybackController,
  ShortFeedController,
  ShortVideoService,
  VideoContentStore,
  VideoPlaybackController,
  VideoService,
  parseContentUri,
  type AudioPlaybackAdapter,
  type MusicObject,
  type VideoObject,
  type VideoPlaybackAdapter,
  type WatchStateStore,
} from '@keystone/core';
import { SodiumCryptoProvider } from '../../../packages/core/src/browser.js';
import type { LocalDesktopProfile } from './desktop-local-runtime';
import { DesktopIndexedDbStateStore } from './desktop-browser-state';
import { createDesktopIdentitySigner, decodeDesktopAudio, pauseDesktopAudio, pauseDesktopVideo, probeDesktopVideo, resumeDesktopAudio, resumeDesktopVideo, seekDesktopAudio, seekDesktopVideo, setDesktopAudioVolume, setDesktopVideoVolume, startDesktopAudio, startDesktopVideo, stopDesktopAudio, stopDesktopVideo, type DesktopDecodedAudio, type DesktopVideoProbe } from './desktop-host-bridge';
import { createDesktopMusicRuntime, createDesktopShortsRuntime, createDesktopVideoRuntime, type DesktopMediaPlaybackState, type DesktopMusicRuntime, type DesktopShortsRuntime, type DesktopVideoRuntime } from './desktop-media-runtime';

const MEDIA_CACHE_QUOTA = 512 * 1024 * 1024;
const DEFAULT_STATE: DesktopMediaPlaybackState = { playing: false, currentTimeMs: 0, durationMs: 0, volume: 1, muted: false };

export interface DesktopLocalMediaRuntimes {
  readonly cache: PersistentContentCache;
  readonly music: DesktopMusicRuntime;
  readonly video: DesktopVideoRuntime;
  readonly shorts: DesktopShortsRuntime;
}

export async function createDesktopLocalMediaRuntimes(profile: LocalDesktopProfile): Promise<DesktopLocalMediaRuntimes> {
  const owner = profile.ownerIdentityId;
  const cache = new PersistentContentCache(MEDIA_CACHE_QUOTA, new DesktopIndexedDbStateStore(`keystone.local.content.v1:${owner}`));
  await cache.ready();
  const crypto = new SodiumCryptoProvider();
  const signer = createDesktopIdentitySigner(profile.deviceId);
  const identity = { nodeId: profile.nodeId };

  const musicStorage = new PersistentMusicStorage(new DesktopIndexedDbStateStore(`keystone.local.music.v1:${owner}`));
  const localContent = new LocalContentStore(`desktop-local:${owner}`, cache);
  const musicService = new MusicService(musicStorage, crypto, identity, undefined, undefined, signer);
  const audio = new LocalAudioAdapter(cache);
  const musicPlayback = new PlaybackController(audio);

  const videoStorage = new PersistentVideoStorage(new DesktopIndexedDbStateStore(`keystone.local.video.v1:${owner}`));
  const videoContent = new VideoContentStore(`desktop-local-video:${owner}`, cache);
  const videoAdapter = new LocalVideoAdapter(cache, videoStorage);
  const videoService = new VideoService(videoStorage, crypto, identity, undefined, undefined, undefined, signer);
  const videoPlayback = new VideoPlaybackController(videoAdapter, videoStorage);
  const shortsService = new ShortVideoService(videoService);
  const shortsFeed = new ShortFeedController(videoAdapter);

  await Promise.all([musicStorage.list('track'), videoStorage.list(), videoStorage.getWatch('__keystone_probe__')]);
  return {
    cache,
    music: createDesktopMusicRuntime(musicService, musicPlayback, {
      hostName: 'Tauri/WebKitGTK local media',
      importTrack: input => importTrack(musicService, localContent, input),
      state: () => audio.state(),
      setVolume: value => audio.setVolume(value),
      subscribe: listener => audio.subscribe(listener),
    }),
    video: createDesktopVideoRuntime(videoService, videoPlayback, {
      hostName: 'Tauri/WebKitGTK local media',
      importVideo: input => importVideo(videoService, videoContent, input),
      state: () => videoAdapter.state(),
      setVolume: value => videoAdapter.setVolume(value),
      setMuted: value => videoAdapter.setMuted(value),
      seek: value => videoAdapter.seek(value),
      attachVideoElement: element => videoAdapter.attach(element),
      toggleFullscreen: () => videoAdapter.toggleFullscreen(),
      nativePlayback: () => videoAdapter.nativePlayback(),
      subscribe: listener => videoAdapter.subscribe(listener),
    }),
    shorts: createDesktopShortsRuntime(shortsService, shortsFeed, {
      hostName: 'Tauri/WebKitGTK local media',
      importVideo: input => importVideo(videoService, videoContent, input),
      state: () => videoAdapter.state(),
      setVolume: value => videoAdapter.setVolume(value),
      setMuted: value => videoAdapter.setMuted(value),
      seek: value => videoAdapter.seek(value),
      attachVideoElement: element => videoAdapter.attach(element),
      toggleFullscreen: () => videoAdapter.toggleFullscreen(),
      nativePlayback: () => videoAdapter.nativePlayback(),
      subscribe: listener => videoAdapter.subscribe(listener),
    }),
  };
}

async function importTrack(service: MusicService, content: LocalContentStore, input: { readonly filename: string; readonly mimeType: string; readonly bytes: Uint8Array }): Promise<Extract<MusicObject, { type: 'track' }>> {
  const metadata = await inspectAudio(input.bytes, input.mimeType);
  const artist = await service.createArtist({ name: 'Local files' }, 'private');
  const result = await service.importTrack({
    title: titleFromFilename(input.filename),
    artistIds: [artist.payload.artistId],
    bytes: input.bytes,
    mimeType: input.mimeType,
    name: input.filename,
    durationMs: metadata.durationMs,
    codec: codecForMime(input.mimeType),
    explicit: false,
    rights: { notice: 'Imported locally; rights remain with the owner.' },
  }, content, 'private');
  return result.track;
}

async function importVideo(service: VideoService, content: VideoContentStore, input: { readonly filename: string; readonly mimeType: string; readonly bytes: Uint8Array; readonly shortForm?: boolean }): Promise<VideoObject> {
  const metadata = await inspectVideo(input.bytes, input.mimeType);
  const shortForm = input.shortForm === true;
  if (shortForm && metadata.height < metadata.width) throw new Error('Short-form video must use portrait dimensions');
  const result = await service.import({
    title: titleFromFilename(input.filename),
    bytes: input.bytes,
    mimeType: input.mimeType,
    name: input.filename,
    durationMs: metadata.durationMs,
    dimensions: { width: metadata.width, height: metadata.height },
    videoStream: { codec: metadata.videoCodec, container: metadata.container },
    ...(shortForm ? { shortForm: { aspectRatio: '9:16' as const } } : {}),
  }, content, shortForm ? 'contacts' : 'private');
  return result.video;
}

class LocalAudioAdapter implements AudioPlaybackAdapter {
  private readonly element: HTMLAudioElement;
  private objectUrl?: string;
  private current?: Extract<MusicObject, { type: 'track' }>;
  private nativeDecoded?: { readonly trackId: string; readonly decoded: DesktopDecodedAudio };
  private nativeSessionId?: string;
  private nativeStartedAt = 0;
  private nativeOffsetMs = 0;
  private nativePlaying = false;
  private nativeTimer?: number;
  private snapshot: DesktopMediaPlaybackState = { ...DEFAULT_STATE };
  private readonly listeners = new Set<() => void>();

  constructor(private readonly cache: ContentCache) {
    this.element = document.createElement('audio');
    this.element.preload = 'metadata';
    this.element.setAttribute('aria-hidden', 'true');
    this.element.style.display = 'none';
    document.body.appendChild(this.element);
    for (const event of ['timeupdate', 'durationchange', 'play', 'pause', 'ended', 'volumechange', 'error']) this.element.addEventListener(event, () => this.sync());
    this.element.volume = 1;
  }

  async play(track: MusicObject, positionMs: number): Promise<void> {
    if (track.type !== 'track') throw new Error('Audio playback received a non-track object');
    await this.load(track);
    if (this.nativeDecoded) { await this.playNative(positionMs); return; }
    this.element.currentTime = Math.max(0, positionMs / 1_000);
    await this.element.play();
    this.sync();
  }

  async pause(): Promise<void> {
    if (this.nativeDecoded && this.nativeSessionId) {
      const position = this.nativePositionMs();
      await pauseDesktopAudio(this.nativeSessionId);
      this.nativeOffsetMs = position; this.nativeStartedAt = 0; this.nativePlaying = false; this.stopNativeTimer(); this.sync(); return;
    }
    this.element.pause(); this.sync();
  }
  async seek(positionMs: number): Promise<void> {
    if (this.nativeDecoded && this.nativeSessionId) {
      const next = Math.max(0, Math.min(this.nativeDecoded.decoded.durationMs, positionMs));
      await seekDesktopAudio(this.nativeSessionId, next);
      this.nativeOffsetMs = next; this.nativeStartedAt = this.nativePlaying ? performance.now() : 0; this.sync();
      return;
    }
    this.element.currentTime = Math.max(0, positionMs / 1_000); this.sync();
  }
  setVolume(value: number): void {
    this.element.volume = clamp(value);
    if (this.nativeSessionId) void setDesktopAudioVolume(this.nativeSessionId, this.element.volume).catch(() => undefined);
    this.sync();
  }
  state(): DesktopMediaPlaybackState { return { ...this.snapshot }; }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }

  private async load(track: Extract<MusicObject, { type: 'track' }>): Promise<void> {
    if (this.current?.id === track.id && (this.element.src || this.nativeDecoded)) return;
    const bytes = await this.cache.read(parseContentUri(track.payload.audioUri));
    if (!bytes) throw new Error('Audio is not available in the local content cache');
    if (this.nativeSessionId) await stopDesktopAudio(this.nativeSessionId).catch(() => undefined);
    this.nativeSessionId = undefined; this.nativeDecoded = undefined;
    this.nativeOffsetMs = 0;
    this.revokeUrl();
    const manifest = this.cache.manifest(parseContentUri(track.payload.audioUri));
    const mimeType = manifest?.mimeType ?? 'application/octet-stream';
    this.objectUrl = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: mimeType }));
    this.element.src = this.objectUrl;
    this.current = track;
    try {
      if (this.element.canPlayType(mimeType)) await waitForMetadata(this.element);
    } catch {
      // WebKitGTK may expose the element but have no matching GStreamer
      // decoder. The bounded native host adapter is the real fallback.
    }
    if (!this.element.canPlayType(mimeType) || this.element.readyState < 1) {
      const decoded = await decodeDesktopAudio(bytes, mimeType);
      this.nativeDecoded = { trackId: track.id, decoded };
    }
    this.sync();
  }

  private async playNative(positionMs: number): Promise<void> {
    if (!this.nativeDecoded) throw new Error('Native audio decode buffer is unavailable');
    const sessionId = this.nativeSessionId ?? crypto.randomUUID();
    if (this.nativeSessionId && !this.nativePlaying && this.nativeOffsetMs < this.nativeDecoded.decoded.durationMs) {
      await resumeDesktopAudio(this.nativeSessionId);
      this.nativeStartedAt = performance.now(); this.nativePlaying = true; this.startNativeTimer(); this.sync(); return;
    }
    const offsetMs = Math.max(0, Math.min(this.nativeDecoded.decoded.durationMs, positionMs));
    await startDesktopAudio(sessionId, this.nativeDecoded.decoded, offsetMs, this.element.volume);
    this.nativeSessionId = sessionId; this.nativeOffsetMs = offsetMs; this.nativeStartedAt = performance.now(); this.nativePlaying = true; this.startNativeTimer(); this.sync();
  }

  private nativePositionMs(): number {
    const duration = this.nativeDecoded?.decoded.durationMs ?? this.current?.payload.durationMs ?? 0;
    const running = this.nativePlaying ? performance.now() - this.nativeStartedAt : 0;
    return Math.max(0, Math.min(duration, Math.round(this.nativeOffsetMs + running)));
  }

  private startNativeTimer(): void { if (this.nativeTimer === undefined) this.nativeTimer = window.setInterval(() => { if (this.nativeDecoded && this.nativePositionMs() >= this.nativeDecoded.decoded.durationMs) { this.nativeOffsetMs = this.nativeDecoded.decoded.durationMs; this.nativePlaying = false; this.stopNativeTimer(); const sessionId = this.nativeSessionId; this.nativeSessionId = undefined; if (sessionId) void stopDesktopAudio(sessionId).catch(() => undefined); } this.sync(); }, 250); }
  private stopNativeTimer(): void { if (this.nativeTimer !== undefined) { window.clearInterval(this.nativeTimer); this.nativeTimer = undefined; } }

  private sync(): void {
    if (this.nativeDecoded) {
      this.snapshot = { currentId: this.current?.id, playing: this.nativePlaying, currentTimeMs: this.nativePositionMs(), durationMs: this.nativeDecoded.decoded.durationMs, volume: this.element.volume, muted: this.element.muted };
      this.listeners.forEach(listener => listener());
      return;
    }
    const durationMs = mediaDurationMs(this.element, this.current?.payload.durationMs);
    this.snapshot = {
      currentId: this.current?.id,
      playing: !this.element.paused,
      currentTimeMs: Math.round((Number.isFinite(this.element.currentTime) ? this.element.currentTime : 0) * 1_000),
      durationMs,
      volume: this.element.volume,
      muted: this.element.muted,
    };
    this.listeners.forEach(listener => listener());
  }

  private revokeUrl(): void { if (this.objectUrl) URL.revokeObjectURL(this.objectUrl); this.objectUrl = undefined; }
}

class LocalVideoAdapter implements VideoPlaybackAdapter {
  private readonly fallback: HTMLVideoElement;
  private element: HTMLVideoElement;
  private objectUrl?: string;
  private current?: VideoObject;
  private nativeProbe?: { readonly videoId: string; readonly probe: DesktopVideoProbe; readonly bytes: Uint8Array; readonly mimeType: string };
  private nativeSessionId?: string;
  private nativeStartedAt = 0;
  private nativeOffsetMs = 0;
  private nativePlaying = false;
  private nativeTimer?: number;
  private snapshot: DesktopMediaPlaybackState = { ...DEFAULT_STATE };
  private readonly listeners = new Set<() => void>();
  private lastProgressWriteAt = 0;

  constructor(private readonly cache: ContentCache, private readonly watch: WatchStateStore) {
    this.fallback = document.createElement('video');
    this.fallback.preload = 'metadata';
    this.fallback.playsInline = true;
    this.fallback.setAttribute('aria-hidden', 'true');
    this.fallback.style.display = 'none';
    document.body.appendChild(this.fallback);
    this.element = this.fallback;
    for (const event of ['timeupdate', 'durationchange', 'play', 'pause', 'ended', 'volumechange', 'loadedmetadata', 'error']) this.fallback.addEventListener(event, () => this.sync());
    this.element.volume = 1;
  }

  async open(video: VideoObject, positionMs: number): Promise<void> {
    const bytes = await this.cache.read(parseContentUri(video.payload.videoUri));
    if (!bytes) throw new Error('Video is not available in the local content cache');
    const manifest = this.cache.manifest(parseContentUri(video.payload.videoUri));
    const mimeType = manifest?.mimeType ?? 'application/octet-stream';
    if (this.current?.id === video.id && this.nativeProbe?.videoId === video.id) {
      await this.playNative(positionMs);
      return;
    }
    if (this.current?.id === video.id && !this.nativeProbe && this.element.src) {
      this.element.currentTime = Math.max(0, positionMs / 1_000);
      await this.element.play();
      this.sync();
      return;
    }

    await this.stopNativeSession();
    this.nativeProbe = undefined;
    this.nativePlaying = false;
    this.revokeUrl();
    this.element.pause();
    this.element.removeAttribute('src');
    this.element.load();
    this.current = video;

    const canUseBrowserDecoder = Boolean(this.element.canPlayType(mimeType));
    if (canUseBrowserDecoder) {
      this.objectUrl = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: mimeType }));
      this.element.src = this.objectUrl;
      try {
        await waitForMetadata(this.element, undefined, 3_000);
        this.element.currentTime = Math.max(0, positionMs / 1_000);
        await this.element.play();
        this.sync();
        return;
      } catch {
        // WebKitGTK can advertise a media type while its GStreamer stack lacks
        // the matching decoder. Fall through to the bounded native host path.
        this.revokeUrl();
        this.element.pause();
        this.element.removeAttribute('src');
        this.element.load();
      }
    }

    const probe = await probeDesktopVideo(bytes, mimeType);
    this.nativeProbe = { videoId: video.id, probe, bytes: bytes.slice(), mimeType };
    this.nativeOffsetMs = Math.max(0, Math.min(probe.durationMs, positionMs));
    try {
      await this.playNative(this.nativeOffsetMs);
    } catch (error) {
      // Do not leave the UI in native-playback mode when the host player
      // cannot be started. The next attempt must be able to retry cleanly.
      this.nativeProbe = undefined;
      this.nativeOffsetMs = 0;
      this.current = undefined;
      throw error;
    }
  }

  async pause(): Promise<void> {
    if (this.nativeProbe) {
      if (this.nativeSessionId) {
        const position = this.nativePositionMs();
        await pauseDesktopVideo(this.nativeSessionId);
        this.nativeOffsetMs = position;
      }
      this.nativeStartedAt = 0;
      this.nativePlaying = false;
      this.stopNativeTimer();
      this.sync();
      return;
    }
    this.element.pause();
    this.sync();
  }

  async seek(positionMs: number): Promise<void> {
    if (this.nativeProbe) {
      const next = Math.max(0, Math.min(this.nativeProbe.probe.durationMs, positionMs));
      if (this.nativeSessionId) {
        await seekDesktopVideo(this.nativeSessionId, next);
        this.nativeOffsetMs = next;
        this.nativeStartedAt = this.nativePlaying ? performance.now() : 0;
      } else if (next < this.nativeProbe.probe.durationMs) {
        await this.playNative(next);
      } else {
        this.nativeOffsetMs = next;
        this.nativePlaying = false;
      }
      this.sync();
      return;
    }
    this.element.currentTime = Math.max(0, positionMs / 1_000);
    this.sync();
  }

  async ensureBuffered(video: VideoObject): Promise<void> {
    if (!(await this.cache.read(parseContentUri(video.payload.videoUri)))) throw new Error('Video content is not fully available locally');
  }

  setVolume(value: number): void {
    this.element.volume = clamp(value);
    if (this.nativeSessionId) void setDesktopVideoVolume(this.nativeSessionId, this.element.muted ? 0 : this.element.volume).catch(() => undefined);
    this.sync();
  }

  setMuted(value: boolean): void {
    this.element.muted = value;
    if (this.nativeSessionId) void setDesktopVideoVolume(this.nativeSessionId, value ? 0 : this.element.volume).catch(() => undefined);
    this.sync();
  }

  nativePlayback(): boolean { return this.nativeProbe !== undefined; }
  state(): DesktopMediaPlaybackState { return { ...this.snapshot }; }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }

  attach(element: HTMLVideoElement | null): void {
    if (!element) {
      this.element = this.fallback;
      this.sync();
      return;
    }
    if (element === this.element) return;
    if (this.nativeProbe) {
      element.volume = this.element.volume;
      element.muted = this.element.muted;
      this.element = element;
      this.sync();
      return;
    }
    const wasPlaying = !this.element.paused;
    const position = this.element.currentTime;
    element.preload = 'metadata';
    element.playsInline = true;
    element.volume = this.element.volume;
    element.muted = this.element.muted;
    this.bindEvents(element);
    if (this.objectUrl) { element.src = this.objectUrl; element.currentTime = position; }
    this.element = element;
    this.sync();
    if (wasPlaying) void element.play().catch(() => undefined);
  }

  async toggleFullscreen(): Promise<boolean> {
    if (this.nativeProbe || !this.element.requestFullscreen) return false;
    if (document.fullscreenElement) { await document.exitFullscreen(); return false; }
    await this.element.requestFullscreen();
    return true;
  }

  private async playNative(positionMs: number): Promise<void> {
    if (!this.nativeProbe || !this.current) throw new Error('Native video probe is unavailable');
    await this.stopNativeSession();
    const offsetMs = Math.max(0, Math.min(this.nativeProbe.probe.durationMs, positionMs));
    const sessionId = crypto.randomUUID();
    await startDesktopVideo(sessionId, this.nativeProbe.mimeType, this.nativeProbe.bytes, this.nativeProbe.probe.durationMs, offsetMs, this.element.muted ? 0 : this.element.volume);
    this.nativeSessionId = sessionId;
    this.nativeOffsetMs = offsetMs;
    this.nativeStartedAt = performance.now();
    this.nativePlaying = true;
    this.startNativeTimer();
    this.sync();
  }

  private nativePositionMs(): number {
    const duration = this.nativeProbe?.probe.durationMs ?? this.current?.payload.durationMs ?? 0;
    const running = this.nativePlaying ? performance.now() - this.nativeStartedAt : 0;
    return Math.max(0, Math.min(duration, Math.round(this.nativeOffsetMs + running)));
  }

  private startNativeTimer(): void {
    if (this.nativeTimer !== undefined) return;
    this.nativeTimer = window.setInterval(() => {
      if (this.nativeProbe && this.nativePositionMs() >= this.nativeProbe.probe.durationMs) {
        this.nativeOffsetMs = this.nativeProbe.probe.durationMs;
        this.nativeStartedAt = 0;
        this.nativePlaying = false;
        this.stopNativeTimer();
        const sessionId = this.nativeSessionId;
        this.nativeSessionId = undefined;
        if (sessionId) void stopDesktopVideo(sessionId).catch(() => undefined);
      }
      this.sync();
    }, 250);
  }

  private stopNativeTimer(): void {
    if (this.nativeTimer !== undefined) {
      window.clearInterval(this.nativeTimer);
      this.nativeTimer = undefined;
    }
  }

  private async stopNativeSession(): Promise<void> {
    const sessionId = this.nativeSessionId;
    this.nativeSessionId = undefined;
    this.nativeStartedAt = 0;
    this.nativePlaying = false;
    this.stopNativeTimer();
    if (sessionId) await stopDesktopVideo(sessionId).catch(() => undefined);
  }

  private bindEvents(element: HTMLVideoElement): void { for (const event of ['timeupdate', 'durationchange', 'play', 'pause', 'ended', 'volumechange', 'loadedmetadata', 'error']) element.addEventListener(event, () => this.sync()); }
  private sync(): void {
    if (this.nativeProbe) {
      this.snapshot = {
        currentId: this.current?.id,
        playing: this.nativePlaying,
        currentTimeMs: this.nativePositionMs(),
        durationMs: this.nativeProbe.probe.durationMs,
        volume: this.element.volume,
        muted: this.element.muted,
      };
    } else {
      const durationMs = mediaDurationMs(this.element, this.current?.payload.durationMs);
      this.snapshot = {
        currentId: this.current?.id,
        playing: !this.element.paused,
        currentTimeMs: Math.round((Number.isFinite(this.element.currentTime) ? this.element.currentTime : 0) * 1_000),
        durationMs,
        volume: this.element.volume,
        muted: this.element.muted,
      };
    }
    if (this.current && this.snapshot.currentTimeMs > 0 && (this.snapshot.currentTimeMs >= (this.current.payload.durationMs - 1_000) || Date.now() - this.lastProgressWriteAt >= 500)) void this.watchProgress();
    this.listeners.forEach(listener => listener());
  }

  private async watchProgress(): Promise<void> {
    if (!this.current) return;
    this.lastProgressWriteAt = Date.now();
    const previous = await this.watch.getWatch(this.current.payload.videoId);
    await this.watch.saveWatch({ videoId: this.current.payload.videoId, positionMs: this.snapshot.currentTimeMs, completed: this.snapshot.currentTimeMs >= this.current.payload.durationMs - 1_000, saved: previous?.saved ?? false, updatedAt: new Date().toISOString() });
  }
  private revokeUrl(): void { if (this.objectUrl) URL.revokeObjectURL(this.objectUrl); this.objectUrl = undefined; }
}

async function inspectAudio(bytes: Uint8Array, mimeType: string): Promise<{ readonly durationMs: number }> {
  const element = document.createElement('audio');
  const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: mimeType }));
  try {
    if (element.canPlayType(mimeType)) { await waitForMetadata(element, url); return requireDuration(element.duration); }
    return decodeDesktopAudio(bytes, mimeType).then(value => requireDuration(value.durationMs / 1_000));
  } catch { return decodeDesktopAudio(bytes, mimeType).then(value => requireDuration(value.durationMs / 1_000)); }
  finally { URL.revokeObjectURL(url); element.remove(); }
}

async function inspectVideo(bytes: Uint8Array, mimeType: string): Promise<{ readonly durationMs: number; readonly width: number; readonly height: number; readonly videoCodec: string; readonly container: string }> {
  const element = document.createElement('video');
  element.preload = 'metadata';
  element.muted = true;
  const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: mimeType }));
  try {
    if (element.canPlayType(mimeType)) {
      try {
        await waitForMetadata(element, url, 3_000);
        const durationMs = requireDuration(element.duration).durationMs;
        if (!element.videoWidth || !element.videoHeight) throw new Error('Video metadata did not include dimensions');
        return { durationMs, width: element.videoWidth, height: element.videoHeight, videoCodec: codecForMime(mimeType), container: containerForMime(mimeType) };
      } catch {
        // Use ffprobe when WebKitGTK's advertised media support is incomplete.
      }
    }
    const probe = await probeDesktopVideo(bytes, mimeType);
    return { durationMs: probe.durationMs, width: probe.width, height: probe.height, videoCodec: probe.videoCodec, container: probe.container };
  }
  finally { URL.revokeObjectURL(url); element.remove(); }
}

function waitForMetadata(element: HTMLMediaElement, source?: string, timeoutMs = 15_000): Promise<void> {
  if (source) element.src = source;
  if (element.readyState >= 1) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => finish(new Error('The selected media format has no readable metadata')), timeoutMs);
    const finish = (error?: Error) => { window.clearTimeout(timer); element.removeEventListener('loadedmetadata', onLoaded); element.removeEventListener('error', onError); error ? reject(error) : resolve(); };
    const onLoaded = () => finish();
    const onError = () => finish(new Error('The selected media format is not supported by the desktop decoder'));
    element.addEventListener('loadedmetadata', onLoaded, { once: true });
    element.addEventListener('error', onError, { once: true });
    element.load();
  });
}

function requireDuration(value: number): { readonly durationMs: number } { if (!Number.isFinite(value) || value <= 0) throw new Error('The selected media has no usable duration'); return { durationMs: Math.max(1, Math.round(value * 1_000)) }; }
function mediaDurationMs(element: HTMLMediaElement, fallbackMs = 0): number { return Number.isFinite(element.duration) && element.duration > 0 ? Math.round(element.duration * 1_000) : fallbackMs; }
function titleFromFilename(filename: string): string { return filename.replace(/\.[^./]+$/, '').trim().slice(0, 300) || 'Untitled local media'; }
function codecForMime(mimeType: string): string { return mimeType.toLowerCase().split('/')[1]?.split(';')[0] || 'unknown'; }
function containerForMime(mimeType: string): string { return mimeType.toLowerCase().split('/')[1]?.split(';')[0] || 'unknown'; }
function clamp(value: number): number { return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1; }
