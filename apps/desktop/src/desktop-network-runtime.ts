/** Connectivity Fabric projection. No provider is invented when the host has none. */
import type { ConnectivityFabric, ConnectivityFabricSnapshot, ConnectivityStateSnapshot, DeliveryRequirement, ReachabilityResult, UniversalReachabilityService } from '@keystone/core';

type DesktopConnectivityFabric = Pick<ConnectivityFabric, 'snapshot' | 'snapshotConfiguration' | 'subscribe'>;
type DesktopReachability = Pick<UniversalReachabilityService, 'state' | 'query' | 'canDeliver'>;

export interface DesktopNetworkRuntime {
  readonly fabric: DesktopConnectivityFabric;
  readonly reachability: DesktopReachability;
  snapshot(): ConnectivityStateSnapshot;
  configuration(): ConnectivityFabricSnapshot;
  subscribe?(listener: () => void): () => void;
}

let current: DesktopNetworkRuntime | undefined;
const listeners = new Set<() => void>();

export function installDesktopNetworkRuntime(runtime: DesktopNetworkRuntime | undefined): void { current = runtime; listeners.forEach(listener => listener()); }
export function getDesktopNetworkRuntime(): DesktopNetworkRuntime | undefined { return current; }
export function subscribeDesktopNetworkRuntime(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener); }

export function createDesktopNetworkRuntime(fabric: DesktopConnectivityFabric = createEmptyFabric(), reachability: DesktopReachability = createEmptyReachability()): DesktopNetworkRuntime {
  const localListeners = new Set<() => void>();
  fabric.subscribe(() => { localListeners.forEach(listener => listener()); listeners.forEach(listener => listener()); });
  return {
    fabric,
    reachability,
    snapshot: () => fabric.snapshot(),
    configuration: () => fabric.snapshotConfiguration(),
    subscribe(listener) { localListeners.add(listener); return () => localListeners.delete(listener); },
  };
}

function emptySnapshot(): ConnectivityStateSnapshot {
  return { state: 'DEVICE_ONLY', reachability: 'UNAVAILABLE', internetAvailable: false, localNetworkAvailable: false, nearbyAvailable: false, availableProviders: [], observedAt: new Date().toISOString() };
}

function createEmptyFabric(): DesktopConnectivityFabric {
  return { snapshot: emptySnapshot, snapshotConfiguration: () => ({ version: 1, providers: [] }), subscribe: () => () => undefined };
}

function createEmptyReachability(): DesktopReachability {
  return {
    state: emptySnapshot,
    query: async (destination: string, _requirement?: DeliveryRequirement): Promise<ReachabilityResult> => ({ destination, reachability: 'UNAVAILABLE', availability: 'UNAVAILABLE', state: 'DEVICE_ONLY', providers: [], checkedAt: new Date().toISOString(), reason: 'No secure connectivity provider is installed' }),
    canDeliver: (_requirement: DeliveryRequirement) => false,
  };
}
