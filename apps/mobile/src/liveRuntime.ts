import type { LiveBroadcastObject, LiveBroadcastService, LiveChatObject, LiveSessionController } from '@keystone/core';

/** Native host installs the signed Live store, WebRTC media adapter and P2P signaling.
 * The screen intentionally has no fallback central stream URL. */
export interface MobileLiveRuntime {
  live: LiveBroadcastService;
  localNodeId?: string;
  session?: LiveSessionController;
  adapterReady?: boolean;
  chat?(broadcastId: string): Promise<readonly LiveChatObject[]>;
  join?(broadcast: LiveBroadcastObject): Promise<void>;
  leave?(broadcast: LiveBroadcastObject): Promise<void>;
  start?(input: Parameters<LiveBroadcastService['create']>[0]): Promise<LiveBroadcastObject>;
  stop?(broadcast: LiveBroadcastObject): Promise<LiveBroadcastObject>;
  sendChat?(broadcast: LiveBroadcastObject, text: string): Promise<void>;
  react?(broadcast: LiveBroadcastObject, emoji: string): Promise<void>;
  shareToChat?(broadcastId: string): Promise<void>;
  shareToCommunity?(broadcastId: string): Promise<void>;
  openTrack?(trackId: string): Promise<void>;
}

let current: MobileLiveRuntime | undefined;
const listeners = new Set<() => void>();

export function installMobileLiveRuntime(runtime: MobileLiveRuntime | undefined) { current = runtime; listeners.forEach(listener => listener()); }
export function getMobileLiveRuntime() { return current; }
export function subscribeMobileLiveRuntime(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
