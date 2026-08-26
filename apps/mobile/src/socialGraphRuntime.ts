import type { AgentPresenceService, AgentProfileService, AgentSocialGraphService, DiscoveryEntry, NodeId, NotificationService, SocialGraphService, UnifiedDiscoveryService } from '@keystone/core';

/** Native/bootstrap boundary for the encrypted local social graph and notifications. */
export interface MobileSocialGraphRuntime {
  graph: SocialGraphService;
  notifications: NotificationService;
  localNodeId: NodeId;
  viewedIdentity?: NodeId;
  discovery?: UnifiedDiscoveryService;
  /** Optional owner-bound AgentProfile service for the human Profile surface. */
  agentProfiles?: AgentProfileService;
  /** Optional agent-only relationship graph; never inferred from human follows. */
  agentGraph?: AgentSocialGraphService;
  /** Optional signed presence and Personal Concierge service. */
  agentPresence?: AgentPresenceService;
  openObject?: (objectId: string, objectType: DiscoveryEntry['type']) => void;
  shareObject?: (objectId: string, destination: 'chat' | 'community') => void | Promise<void>;
}

let current: MobileSocialGraphRuntime | undefined;
const listeners = new Set<() => void>();
export function installMobileSocialGraphRuntime(runtime: MobileSocialGraphRuntime | undefined): void { current = runtime; listeners.forEach(listener => listener()); }
export function getMobileSocialGraphRuntime(): MobileSocialGraphRuntime | undefined { return current; }
export function subscribeMobileSocialGraphRuntime(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener); }
