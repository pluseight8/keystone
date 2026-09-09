/** Unified local Discovery projection used by Home and Search. */
import {
  PersistentDiscoveryStorage,
  UnifiedDiscoveryService,
  type DiscoveryEntry,
  type DiscoveryScope,
  type DiscoveryStateBackend,
  type FeedPage,
  type FeedSurface,
  type SearchPage,
} from '@keystone/core';

export interface DesktopDiscoveryRuntime {
  readonly discovery: UnifiedDiscoveryService;
  search(query: string, options?: { readonly scope?: DiscoveryScope; readonly limit?: number }): Promise<SearchPage>;
  feed(surface: FeedSurface, options?: { readonly limit?: number }): Promise<FeedPage>;
  ingest(entry: DiscoveryEntry, source?: 'local' | 'social' | 'public'): Promise<boolean>;
  counts(): Promise<{ readonly indexed: number; readonly following: number; readonly communities: number }>;
  subscribe?(listener: () => void): () => void;
}

let current: DesktopDiscoveryRuntime | undefined;
const listeners = new Set<() => void>();

export function installDesktopDiscoveryRuntime(runtime: DesktopDiscoveryRuntime | undefined): void { current = runtime; listeners.forEach(listener => listener()); }
export function getDesktopDiscoveryRuntime(): DesktopDiscoveryRuntime | undefined { return current; }
export function subscribeDesktopDiscoveryRuntime(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener); }

export function createDesktopDiscoveryRuntime(discovery: UnifiedDiscoveryService): DesktopDiscoveryRuntime {
  const localListeners = new Set<() => void>();
  return {
    discovery,
    search: (query, options) => discovery.search({ query, scope: options?.scope ?? 'local', limit: options?.limit ?? 50 }),
    feed: (surface, options) => discovery.feed({ surface, limit: options?.limit ?? 30 }),
    async ingest(entry, source = 'local') { const result = await discovery.ingest(entry, source); localListeners.forEach(listener => listener()); listeners.forEach(listener => listener()); return result; },
    async counts() { await discovery.ready(); return { indexed: discovery.index.values().length, following: discovery.followingIds().length, communities: discovery.communityIds().length }; },
    subscribe(listener) { localListeners.add(listener); return () => localListeners.delete(listener); },
  };
}

export function createDesktopDiscoveryStorage(backend: DiscoveryStateBackend): PersistentDiscoveryStorage { return new PersistentDiscoveryStorage(backend); }
