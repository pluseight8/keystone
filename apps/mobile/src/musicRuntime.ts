import type { MusicService, PlaybackController } from '@keystone/core';

/** Installed by the native/bootstrap layer after encrypted music state, content storage and an audio adapter are ready. */
export interface MobileMusicRuntime { music: MusicService; playback: PlaybackController; }
let current: MobileMusicRuntime | undefined;
const listeners = new Set<() => void>();
export function installMobileMusicRuntime(runtime: MobileMusicRuntime | undefined): void { current = runtime; listeners.forEach(listener => listener()); }
export function getMobileMusicRuntime(): MobileMusicRuntime | undefined { return current; }
export function subscribeMobileMusicRuntime(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener); }
