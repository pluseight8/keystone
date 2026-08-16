import type { DirectMessageService, GroupConversationService, NodeId } from '@keystone/core';

/** Installed by the native/bootstrap layer after it opens encrypted social storage and transport. */
export interface MobileMessagingRuntime {
  messaging: DirectMessageService;
  /** Optional group projection; hosts may install it alongside the DM service. */
  groups?: GroupConversationService;
  /** Legacy direct-chat bootstrap target; no longer required for the chats list. */
  peer?: NodeId;
  peerLabel?: string;
}
let current: MobileMessagingRuntime | undefined;
const listeners = new Set<() => void>();
export function installMobileMessagingRuntime(runtime: MobileMessagingRuntime | undefined): void { current = runtime; listeners.forEach(listener => listener()); }
export function getMobileMessagingRuntime(): MobileMessagingRuntime | undefined { return current; }
export function subscribeMobileMessagingRuntime(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener); }
