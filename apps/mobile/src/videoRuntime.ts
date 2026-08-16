import type { VideoPlaybackController, VideoService } from '@keystone/core';
/** Installed by the native host after encrypted video state, P2P content providers and a decoder-backed adapter are ready. */
export interface MobileVideoRuntime { videos: VideoService; playback: VideoPlaybackController; shareToChat?(videoId: string): Promise<void>; shareToCommunity?(videoId: string): Promise<void>; }
let current: MobileVideoRuntime | undefined; const listeners = new Set<() => void>();
export function installMobileVideoRuntime(runtime: MobileVideoRuntime | undefined) { current = runtime; listeners.forEach(listener => listener()); }
export function getMobileVideoRuntime() { return current; }
export function subscribeMobileVideoRuntime(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; }
