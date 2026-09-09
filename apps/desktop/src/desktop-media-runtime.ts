/**
 * Typed desktop boundary for the existing social media services.
 *
 * The desktop renderer does not manufacture signed Music/Video objects and it
 * does not own raw identity keys. A native/bootstrap host installs these
 * adapters after it has connected encrypted object storage, content providers
 * and a decoder-backed playback adapter.
 */
import type {
  LiveBroadcastObject,
  LiveBroadcastService,
  LiveSessionController,
  MusicService,
  PlaybackController,
  ShortFeedController,
  ShortVideoService,
  VideoPlaybackController,
  VideoService,
} from '@keystone/core';

export interface DesktopMediaPlaybackState {
  readonly currentId?: string;
  readonly playing: boolean;
  readonly currentTimeMs: number;
  readonly durationMs: number;
  readonly volume: number;
  readonly muted: boolean;
}

export interface DesktopMediaImportInput {
  readonly filename: string;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
}

export interface DesktopMusicRuntime {
  readonly music: MusicService;
  readonly playback: PlaybackController;
  readonly importTrack?: (input: DesktopMediaImportInput) => Promise<Extract<import('@keystone/core').MusicObject, { type: 'track' }>>;
  readonly state?: () => DesktopMediaPlaybackState;
  readonly setVolume?: (value: number) => void;
  readonly subscribe?: (listener: () => void) => () => void;
  readonly hostName?: string;
}

export interface DesktopVideoRuntime {
  readonly videos: VideoService;
  readonly playback: VideoPlaybackController;
  readonly importVideo?: (input: DesktopMediaImportInput & { readonly shortForm?: boolean }) => Promise<import('@keystone/core').VideoObject>;
  readonly state?: () => DesktopMediaPlaybackState;
  readonly setVolume?: (value: number) => void;
  readonly setMuted?: (value: boolean) => void;
  readonly seek?: (positionMs: number) => Promise<void>;
  readonly attachVideoElement?: (element: HTMLVideoElement | null) => void;
  readonly toggleFullscreen?: () => Promise<boolean>;
  readonly nativePlayback?: () => boolean;
  readonly subscribe?: (listener: () => void) => () => void;
  readonly shareToChat?: (videoId: string) => Promise<void>;
  readonly shareToCommunity?: (videoId: string) => Promise<void>;
  readonly hostName?: string;
}

export interface DesktopShortsRuntime {
  readonly shorts: ShortVideoService;
  readonly feed: ShortFeedController;
  readonly importVideo?: (input: DesktopMediaImportInput & { readonly shortForm?: boolean }) => Promise<import('@keystone/core').VideoObject>;
  readonly state?: () => DesktopMediaPlaybackState;
  readonly setVolume?: (value: number) => void;
  readonly setMuted?: (value: boolean) => void;
  readonly seek?: (positionMs: number) => Promise<void>;
  readonly attachVideoElement?: (element: HTMLVideoElement | null) => void;
  readonly toggleFullscreen?: () => Promise<boolean>;
  readonly nativePlayback?: () => boolean;
  readonly subscribe?: (listener: () => void) => () => void;
  readonly followCreator?: (creatorId: string) => Promise<void>;
  readonly shareToChat?: (videoId: string) => Promise<void>;
  readonly shareToCommunity?: (videoId: string) => Promise<void>;
  readonly hostName?: string;
}

export interface DesktopLiveRuntime {
  readonly live: LiveBroadcastService;
  readonly session?: LiveSessionController;
  readonly localNodeId?: string;
  readonly start?: (input: Parameters<LiveBroadcastService['create']>[0]) => Promise<LiveBroadcastObject>;
  readonly stop?: (broadcast: LiveBroadcastObject) => Promise<LiveBroadcastObject>;
  readonly hostName?: string;
}

let music: DesktopMusicRuntime | undefined;
let video: DesktopVideoRuntime | undefined;
let shorts: DesktopShortsRuntime | undefined;
let live: DesktopLiveRuntime | undefined;
const musicListeners = new Set<() => void>();
const videoListeners = new Set<() => void>();
const shortsListeners = new Set<() => void>();
const liveListeners = new Set<() => void>();

export function installDesktopMusicRuntime(runtime: DesktopMusicRuntime | undefined): void {
  music = runtime;
  musicListeners.forEach(listener => listener());
}
export function getDesktopMusicRuntime(): DesktopMusicRuntime | undefined { return music; }
export function subscribeDesktopMusicRuntime(listener: () => void): () => void { musicListeners.add(listener); return () => musicListeners.delete(listener); }

export function installDesktopVideoRuntime(runtime: DesktopVideoRuntime | undefined): void {
  video = runtime;
  videoListeners.forEach(listener => listener());
}
export function getDesktopVideoRuntime(): DesktopVideoRuntime | undefined { return video; }
export function subscribeDesktopVideoRuntime(listener: () => void): () => void { videoListeners.add(listener); return () => videoListeners.delete(listener); }

export function installDesktopShortsRuntime(runtime: DesktopShortsRuntime | undefined): void {
  shorts = runtime;
  shortsListeners.forEach(listener => listener());
}
export function getDesktopShortsRuntime(): DesktopShortsRuntime | undefined { return shorts; }
export function subscribeDesktopShortsRuntime(listener: () => void): () => void { shortsListeners.add(listener); return () => shortsListeners.delete(listener); }

export function installDesktopLiveRuntime(runtime: DesktopLiveRuntime | undefined): void {
  live = runtime;
  liveListeners.forEach(listener => listener());
}
export function getDesktopLiveRuntime(): DesktopLiveRuntime | undefined { return live; }
export function subscribeDesktopLiveRuntime(listener: () => void): () => void { liveListeners.add(listener); return () => liveListeners.delete(listener); }

export function createDesktopMusicRuntime(musicService: MusicService, playback: PlaybackController, options: Omit<DesktopMusicRuntime, 'music' | 'playback'> | string = {}): DesktopMusicRuntime {
  const normalized = typeof options === 'string' ? { hostName: options } : options;
  return { music: musicService, playback, ...normalized };
}
export function createDesktopVideoRuntime(videos: VideoService, playback: VideoPlaybackController, options: Omit<DesktopVideoRuntime, 'videos' | 'playback'> = {}): DesktopVideoRuntime {
  return { videos, playback, ...options };
}
export function createDesktopShortsRuntime(shortsService: ShortVideoService, feed: ShortFeedController, options: Omit<DesktopShortsRuntime, 'shorts' | 'feed'> = {}): DesktopShortsRuntime {
  return { shorts: shortsService, feed, ...options };
}
export function createDesktopLiveRuntime(liveService: LiveBroadcastService, options: Omit<DesktopLiveRuntime, 'live'> = {}): DesktopLiveRuntime {
  return { live: liveService, ...options };
}
