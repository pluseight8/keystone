import type { CommunityService, NodeId } from '@keystone/core';

/** Native host boundary for the durable Community service. No demo data is created here. */
export interface MobileCommunityRuntime {
  communities: CommunityService;
  localNodeId?: NodeId;
  openObject?: (id: string, type?: string) => void;
}

let current: MobileCommunityRuntime | undefined;
const listeners = new Set<() => void>();

export function installMobileCommunityRuntime(runtime: MobileCommunityRuntime | undefined): void { current = runtime; listeners.forEach(listener => listener()); }
export function getMobileCommunityRuntime(): MobileCommunityRuntime | undefined { return current; }
export function subscribeMobileCommunityRuntime(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener); }
