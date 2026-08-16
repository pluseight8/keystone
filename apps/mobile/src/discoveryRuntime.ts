import type { DiscoveryPermissionContext, DiscoveryScope, DiscoveryEntry, UnifiedDiscoveryService } from '@keystone/core';

/** Native/bootstrap boundary for the local-first discovery graph. */
export interface MobileDiscoveryRuntime {
  discovery: UnifiedDiscoveryService;
  permissions?: DiscoveryPermissionContext;
  /** Optional local model label; no network recommendation service is implied. */
  localAiLabel?: string;
  openObject?: (object: DiscoveryEntry) => void;
  setScope?: (scope: DiscoveryScope) => void;
}

let current: MobileDiscoveryRuntime | undefined;
const listeners = new Set<() => void>();
export function installMobileDiscoveryRuntime(runtime: MobileDiscoveryRuntime | undefined): void { current = runtime; listeners.forEach(listener => listener()); }
export function getMobileDiscoveryRuntime(): MobileDiscoveryRuntime | undefined { return current; }
export function subscribeMobileDiscoveryRuntime(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener); }
