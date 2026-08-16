import type { ShortFeedController, ShortVideoService } from '@keystone/core';
export interface MobileShortsRuntime { shorts: ShortVideoService; feed: ShortFeedController; shareToChat?(videoId: string): Promise<void>; shareToCommunity?(videoId: string): Promise<void>; followCreator?(creatorId: string): Promise<void>; }
let current: MobileShortsRuntime | undefined; const listeners = new Set<() => void>();
export function installMobileShortsRuntime(runtime: MobileShortsRuntime | undefined) { current = runtime; listeners.forEach(listener => listener()); }
export function getMobileShortsRuntime() { return current; }
export function subscribeMobileShortsRuntime(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; }
