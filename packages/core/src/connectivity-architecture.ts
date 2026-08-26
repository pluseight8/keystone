/**
 * R0P67 application/network dependency inventory.
 *
 * This is intentionally a small, reviewable registry rather than a runtime
 * service.  It gives architecture tests a stable list of modules that are
 * allowed to perform Keystone peer delivery and records why a remaining
 * low-level path is legitimate.  A future provider can therefore be added
 * below ConnectivityFabric without changing application packages.
 */

export type ConnectivityUseClassification =
  | 'FABRIC_MIGRATED'
  | 'LOW_LEVEL_PROVIDER'
  | 'LOCAL_ONLY'
  | 'TEST'
  | 'MIGRATION'
  | 'LEGACY_COMPATIBILITY_BOUNDARY'
  | 'LEGACY_BYPASS'
  | 'EXTERNAL_PROVIDER_NETWORK';

export interface ConnectivityUseInventoryEntry {
  readonly module: string;
  readonly classification: ConnectivityUseClassification;
  readonly reason: string;
}

/** High-level modules receive KeystoneDeliveryInterface (normally a
 * FabricTransport) and must not import physical provider implementations. */
export const FABRIC_APPLICATION_MODULES: readonly string[] = [
  'ai/agent-social.ts',
  'ai/agent-negotiation.ts',
  'ai/agent-presence.ts',
  'ai/personal-mesh.ts',
  'ai/visits.ts',
  'ai/workboards.ts',
  'agents/chronos.ts',
  'security/devices.ts',
  'personal-device-mesh.ts',
  'shared-vaults.ts',
  'social/calendar.ts',
  'social/community-replication.ts',
  'social/discovery-replication.ts',
  'social/file-replication.ts',
  'social/graph-replication.ts',
  'social/live-replication.ts',
  'social/messaging.ts',
  'social/music-replication.ts',
  'social/private-communities.ts',
  'social/spaces.ts',
  'social/video-replication.ts',
  'sync/ai-router.ts',
  'sync/crdt.ts',
  'sync/handoff.ts',
  'webrtc/protocol.ts',
  'webrtc/calls.ts',
  'sync/capsule.ts',
  'social/conversations.ts',
  'social/distributed-content.ts',
  'location.ts',
];

/**
 * Production services that can emit or consume peer-delivery envelopes. This
 * superset intentionally includes object/social/media and device/AI paths so
 * a newly added service cannot silently become a second delivery authority.
 * Local-only modules are not listed: they commit locally and synchronize only
 * through an explicitly injected delivery implementation.
 */
export const NETWORK_CAPABLE_PRODUCTION_MODULES: readonly string[] = [
  ...FABRIC_APPLICATION_MODULES,
  'social/notifications.ts',
  'social/content.ts',
  'social/files.ts',
  'social/music.ts',
  'social/video.ts',
  'social/shorts.ts',
  'social/streams.ts',
  'social/conversations.ts',
  'social/discovery.ts',
  'social/graph.ts',
  'social/safety.ts',
  'sync/backup.ts',
  'sync/backup-recovery.ts',
  'sync/revocation.ts',
  'ai/agent-profiles.ts',
  'ai/agent-social-graph.ts',
  'security/settings.ts',
  'location.ts',
];

/** Physical/network implementation modules are the only normal owners of
 * low-level Transport, Hyperswarm, HyperDHT and native LAN details. */
export const LOW_LEVEL_PROVIDER_MODULES: readonly string[] = [
  'adaptive-route.ts',
  'connectivity.ts',
  'nearby.ts',
  'mesh-routing.ts',
  'delay-tolerant.ts',
  'gateway.ts',
  'transport.ts',
  // External package boundary; this path is checked by the native-host
  // package itself, not resolved relative to core/src.
  '@keystone/native-host/runtime.ts',
];

/** Remaining direct network code is explicit and bounded. External provider
 * bridges and migration channels are not application-level Keystone delivery
 * authorities. */
export const CONNECTIVITY_USE_INVENTORY: readonly ConnectivityUseInventoryEntry[] = [
  ...FABRIC_APPLICATION_MODULES.map(module => ({ module, classification: 'FABRIC_MIGRATED' as const, reason: 'Application delivery is injected as KeystoneDeliveryInterface/FabricTransport.' })),
  ...LOW_LEVEL_PROVIDER_MODULES.map(module => ({ module, classification: 'LOW_LEVEL_PROVIDER' as const, reason: 'Physical/provider implementation below ConnectivityFabric.' })),
  { module: 'testing/*', classification: 'TEST', reason: 'Controlled and hostile protocol fixtures are explicit test seams.' },
  { module: 'engine.ts', classification: 'LEGACY_COMPATIBILITY_BOUNDARY', reason: 'Explicitly classified TEST/MIGRATION Transport compatibility seam; production construction requires Fabric/FabricTransport and rejects unclassified legacy input.' },
  { module: 'sync/migration.ts', classification: 'MIGRATION', reason: 'Host-provided authenticated migration channel; no physical transport selection.' },
  { module: 'apps/extension/src/background.ts', classification: 'EXTERNAL_PROVIDER_NETWORK', reason: 'Browser extension websocket is a host/app bridge, not Keystone peer delivery.' },
  { module: 'sync/capsule.ts', classification: 'FABRIC_MIGRATED', reason: 'Context capsule peer sync uses the injected KeystoneDeliveryInterface; no physical provider is selected in the application module.' },
  { module: 'identity.ts', classification: 'LOCAL_ONLY', reason: 'Identity and signing capability management is local; envelope types are protocol data, not a delivery path.' },
  { module: 'sync/backup-recovery.ts', classification: 'LOCAL_ONLY', reason: 'Backup/restore is local-first; peer cache recovery is separately injected through Fabric-compatible sync.' },
  { module: 'social/conversations.ts', classification: 'FABRIC_MIGRATED', reason: 'Group conversation objects are delivered by the injected messaging/Fabric delivery seam.' },
  { module: 'social/content.ts', classification: 'LOCAL_ONLY', reason: 'Content addressing/cache is local; provider negotiation is owned by Fabric-compatible replication.' },
  { module: 'social/distributed-content.ts', classification: 'FABRIC_MIGRATED', reason: 'Distributed content requests use the injected KeystoneDeliveryInterface; source selection remains separate from Fabric route selection.' },
  { module: 'social/notifications.ts', classification: 'LOCAL_ONLY', reason: 'Notification/read state is local; remote triggers arrive through the originating Fabric-backed service.' },
  { module: 'social/safety.ts', classification: 'LOCAL_ONLY', reason: 'Abuse/safety policy is local and does not select a physical network.' },
  { module: 'social/discovery.ts', classification: 'LOCAL_ONLY', reason: 'Local discovery/indexing is local-first; public object replication is injected separately.' },
  { module: 'security/settings.ts', classification: 'LOCAL_ONLY', reason: 'Settings and diagnostics consume shared Fabric state; they do not open or choose network providers.' },
  { module: 'location.ts', classification: 'FABRIC_MIGRATED', reason: 'Location sharing accepts KeystoneDeliveryInterface and carries only recipient-encrypted application envelopes; local provider access remains NativeHost-scoped.' },
  { module: 'security/devices.ts', classification: 'FABRIC_MIGRATED', reason: 'Trusted-device event replication receives KeystoneDeliveryInterface/FabricTransport.' },
  { module: 'social/files.ts', classification: 'LOCAL_ONLY', reason: 'Content-addressed file bytes are local; metadata/transfer control is replicated through FileReplicationService.' },
  { module: 'social/music.ts', classification: 'LOCAL_ONLY', reason: 'Media object and content stores are local; replication is delegated to MusicReplicationService.' },
  { module: 'social/video.ts', classification: 'LOCAL_ONLY', reason: 'Media object and content stores are local; replication is delegated to VideoReplicationService.' },
  { module: 'social/shorts.ts', classification: 'LOCAL_ONLY', reason: 'Short-form projections are local; source object replication is Fabric-backed.' },
  { module: 'social/streams.ts', classification: 'LOCAL_ONLY', reason: 'Live state/media control is local; live replication/signaling is Fabric-backed.' },
  { module: 'social/graph.ts', classification: 'LOCAL_ONLY', reason: 'Graph projection is local-first; signed graph replication owns delivery.' },
  { module: 'sync/backup.ts', classification: 'LOCAL_ONLY', reason: 'Backup serialization is local; peer transfer is a separate Fabric-compatible operation.' },
  { module: 'sync/revocation.ts', classification: 'LOCAL_ONLY', reason: 'Revocation state is local security state; device event replication uses the Fabric seam.' },
  { module: 'ai/agent-profiles.ts', classification: 'LOCAL_ONLY', reason: 'Agent profiles are local state; remote social exchange is delegated to mailbox/replication.' },
  { module: 'ai/agent-social-graph.ts', classification: 'LOCAL_ONLY', reason: 'Agent graph projection is local; AgentMailbox carries authenticated remote events.' },
  { module: 'apps/relay/src/index.ts', classification: 'LOW_LEVEL_PROVIDER', reason: 'Relay is an external provider/bridge process and carries only transport-level traffic; it is not an application replication service.' },
];

export function connectivityUse(module: string): ConnectivityUseInventoryEntry | undefined {
  return CONNECTIVITY_USE_INVENTORY.find(value => value.module === module);
}

/**
 * A machine-readable description of the authority boundary.  Consumers use
 * this instead of inferring policy from a constructor shape.  It is kept
 * intentionally small so an architecture test can enumerate every normal
 * production path without loading providers or opening sockets.
 */
export const CONNECTIVITY_AUTHORITY = Object.freeze({
  applicationAuthority: 'ConnectivityFabric',
  compatibilityFacade: 'FabricTransport',
  lowLevelAbstraction: 'Transport',
  physicalProviderModules: LOW_LEVEL_PROVIDER_MODULES,
  directApplicationBypassAllowed: false,
  silentLegacyFallbackAllowed: false,
} as const);

export function assertFabricAuthority(entry: ConnectivityUseInventoryEntry): void {
  if (entry.classification === 'LEGACY_BYPASS') throw new Error(`Unclassified ConnectivityFabric bypass: ${entry.module}`);
  if (!entry.reason.trim()) throw new Error(`Connectivity inventory entry has no reason: ${entry.module}`);
}
