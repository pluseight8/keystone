/**
 * R0P61 executable extension contracts.
 *
 * This file intentionally contains data-only contracts.  A Plugin is a
 * separate trust class from Keystone Core: installing one never grants it
 * owner authority, core services, secrets, sockets, or an ambient runtime.
 */

export type PluginId = string;
export type PluginVersion = string;
/** Kept as a type alias for legacy manifest contracts; canonical definition is in plugin-api. */
export type PluginApiVersion = 1;

/**
 * Distribution transports are deliberately descriptive rather than
 * authoritative.  Adding a transport never changes package identity or
 * trust.  The additional values are used by the distribution layer and are
 * still validated by the normal package/quarantine path.
 */
export const PLUGIN_SOURCES = [
  'LOCAL_FILE', 'FILE_OBJECT', 'EXPLICIT_URL', 'P2P_PACKAGE', 'BUILT_IN', 'DEVELOPMENT',
  'CONTENT_ADDRESS', 'TRUSTED_INDEX', 'COMMUNITY_INDEX', 'PERSONAL_DEVICE', 'USB',
] as const;
export type PluginSourceKind = (typeof PLUGIN_SOURCES)[number];
export interface PluginSourceDescriptor {
  readonly kind: PluginSourceKind;
  readonly reference?: string;
  readonly provenance?: string;
  /** Distribution metadata. These fields are not package authority. */
  readonly id?: string;
  readonly type?: PluginSourceKind;
  readonly displayName?: string;
  readonly enabled?: boolean;
  readonly trust?: 'UNKNOWN' | 'KNOWN_SOURCE' | 'AUTHENTICATED' | 'CORE_RESERVED' | 'UNTRUSTED';
  readonly capabilities?: readonly ('DISCOVERY' | 'ACQUISITION' | 'REVOCATION')[];
  readonly lastRefresh?: string;
  readonly health?: 'AVAILABLE' | 'DEGRADED' | 'OFFLINE' | 'INVALID' | 'DISABLED';
}
export type PluginSource = PluginSourceKind | PluginSourceDescriptor;

export const PLUGIN_TYPES = ['EXECUTABLE', 'BUILT_IN', 'DEVELOPMENT'] as const;
export type PluginType = (typeof PLUGIN_TYPES)[number];

/** Granular capabilities. There is deliberately no ALL/FULL_ACCESS/ADMIN. */
export const PLUGIN_CAPABILITIES = [
  'ui.extend',
  'tool.register',
  'skill.provide',
  'model.provider.register',
  'context.provider.register',
  'search.provider.register',
  'media.provider.register',
  'calendar.provider.register',
  'file.handler.register',
  'object.renderer.register',
  'agent.capability.register',
  'messages.read',
  'messages.write',
  'vault.read',
  'vault.write',
  'calendar.read',
  'calendar.write',
  'files.read',
  /** Location is never an implicit plugin capability: each grant is
   * owner-authorized and scoped by LocationService. */
  'location.approximate.once',
  'location.precise.once',
  'location.foreground',
  'location.background',
  'network.request',
  'notifications.create',
  'externalLink.requestOpen',
  'connectivity.status',
  'background.execute',
  'storage.read',
  'storage.write',
  'events.subscribe',
  'surface.publish',
  'settings.read',
  'settings.write',
  'secrets.plugin',
] as const;
export type PluginCapability = (typeof PLUGIN_CAPABILITIES)[number];

export const PLUGIN_EXTENSION_POINTS = [
  'TOOL_PROVIDER',
  'SKILL_PROVIDER',
  'MODEL_PROVIDER',
  'CONTEXT_PROVIDER',
  'SEARCH_PROVIDER',
  'MEDIA_PROVIDER',
  'CALENDAR_PROVIDER',
  'FILE_HANDLER',
  'OBJECT_RENDERER',
  'AGENT_CAPABILITY_PROVIDER',
  'UI_ACTIVITY_BAR',
  'UI_COMMAND',
  'UI_SETTINGS',
  'UI_CONTEXT_ACTION',
  'UI_OBJECT_VIEW',
  'UI_SIDEBAR',
  'EVENT_SUBSCRIPTION',
] as const;
export type PluginExtensionPoint = (typeof PLUGIN_EXTENSION_POINTS)[number];

export const RESERVED_PLUGIN_NAMESPACES = ['core', 'security', 'identity', 'protocol', 'safety', 'secret', 'owner-authority'] as const;

export interface PluginSignatureMetadata {
  readonly algorithm: 'ED25519';
  readonly signerIdentity: string;
  readonly signature: string;
  readonly signedAt?: string;
  readonly keyId?: string;
  /** Optional encoded public key used by a host supplied verifier. */
  readonly publicKey?: string;
}

export interface PluginIntegrity {
  readonly algorithm: 'SHA-256';
  /** Hash of the canonical manifest (without integrity) and all payload files. */
  readonly packageHash: string;
  readonly entrypointHash: string;
  readonly resourceHashes: Readonly<Record<string, string>>;
  readonly treeHash?: string;
}

export interface PluginCompatibility {
  readonly keystone?: { readonly min?: string; readonly max?: string };
  readonly api: { readonly min: PluginApiVersion; readonly max: PluginApiVersion };
  readonly platforms?: readonly ('linux' | 'windows' | 'macos' | 'android' | 'ios' | 'web')[ ];
  readonly architectures?: readonly string[];
  readonly runtimes?: readonly ('tauri-isolated-webview' | 'quickjs' | 'wasmtime' | 'mobile-isolated-js')[ ];
  readonly extensionPoints?: readonly PluginExtensionPoint[];
}

export interface PluginDependency {
  readonly id: PluginId;
  readonly version: string;
  readonly integrity?: string;
}

export interface PluginCapabilityRequest {
  readonly capability: PluginCapability;
  readonly reason?: string;
  readonly scope?: string;
  readonly resourceScope?: string;
  readonly optional?: boolean;
}

export interface PluginManifest {
  readonly id: PluginId;
  readonly name: string;
  readonly description: string;
  /** Display metadata; it is not a cryptographic identity. */
  readonly author: string;
  readonly version: PluginVersion;
  readonly formatVersion: 1;
  readonly apiVersion: PluginApiVersion;
  readonly entrypoint: string;
  readonly pluginType: PluginType;
  readonly requestedCapabilities: readonly PluginCapabilityRequest[];
  readonly extensionPoints: readonly PluginExtensionPoint[];
  readonly dependencies: readonly PluginDependency[];
  readonly optionalDependencies: readonly PluginDependency[];
  readonly dependencyLock?: PluginDependencyLock;
  readonly keystoneCompatibility: PluginCompatibility;
  readonly platformCompatibility: PluginCompatibility;
  readonly integrity: PluginIntegrity;
  readonly signatureMetadata?: PluginSignatureMetadata;
  readonly createdAt: string;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface PluginPackage {
  readonly manifest: PluginManifest;
  readonly executable: Uint8Array;
  readonly resources: Readonly<Record<string, Uint8Array>>;
  readonly schemas?: Readonly<Record<string, Uint8Array>>;
  readonly uiBundle?: Uint8Array;
  readonly migrations?: Readonly<Record<string, Uint8Array>>;
  readonly source: PluginSourceDescriptor;
  readonly provenance?: Readonly<Record<string, string>>;
}

export const PLUGIN_STATES = [
  'RECEIVED', 'QUARANTINED', 'PARSED', 'VALIDATED', 'REVIEW_REQUIRED',
  'INSTALLED_DISABLED', 'ENABLED_STOPPED', 'RUNNING', 'STOPPING',
  'CRASHED', 'REJECTED', 'ROLLED_BACK', 'UNINSTALLED',
] as const;
export type PluginState = (typeof PLUGIN_STATES)[number];

export const PLUGIN_RUNTIME_STATES = ['UNLOADED', 'LOADING', 'READY', 'RUNNING', 'STOPPING', 'STOPPED', 'FAILED'] as const;
export type PluginRuntimeState = (typeof PLUGIN_RUNTIME_STATES)[number];

export interface PluginRevision {
  readonly version: PluginVersion;
  readonly packageHash: string;
  readonly installedAt: string;
  readonly source: PluginSourceDescriptor;
  /** Optional authenticated publisher binding for update/recovery decisions. */
  readonly publisherId?: string;
  /** A revision is content addressed; this state never grants authority. */
  readonly securityState?: PluginRevisionSecurityState;
}

export type PluginRevisionSecurityState = 'ACTIVE' | 'REVOKED' | 'SECURITY_QUARANTINED' | 'UNKNOWN';

export interface PluginPermissionGrant {
  readonly pluginId: PluginId;
  readonly revision: PluginRevision;
  readonly capability: PluginCapability;
  readonly scope: string;
  readonly resourceScope?: string;
  readonly ownerIdentity: string;
  readonly deviceId?: string;
  readonly contextId?: string;
  readonly createdAt: string;
  readonly expiresAt?: string;
  readonly revokedAt?: string;
  readonly revokedReason?: string;
}

export interface PluginCrashRecord {
  readonly id: string;
  readonly pluginId: PluginId;
  readonly revision: PluginRevision;
  readonly at: string;
  readonly message: string;
  readonly count: number;
  readonly quarantined: boolean;
}

export interface PluginFailure {
  readonly code: string;
  readonly message: string;
  readonly at: string;
  readonly recoverable: boolean;
}

export interface PluginResourceBudget {
  readonly cpuClass: 'LOW' | 'STANDARD' | 'HIGH';
  readonly memoryBytes: number;
  readonly storageBytes: number;
  readonly networkRequestsPerMinute: number;
  readonly backgroundSecondsPerHour: number;
  readonly eventRatePerSecond: number;
  readonly toolRegistrations: number;
  readonly uiExtensions: number;
  readonly maxEventQueue: number;
}

export interface PluginInstallRecord {
  readonly pluginId: PluginId;
  readonly manifest: PluginManifest;
  readonly state: PluginState;
  readonly runtimeState: PluginRuntimeState;
  readonly currentRevision: PluginRevision;
  readonly previousRevisions: readonly PluginRevision[];
  readonly grants: readonly PluginPermissionGrant[];
  readonly resourceBudget: PluginResourceBudget;
  readonly crashHistory: readonly PluginCrashRecord[];
  readonly lastFailure?: PluginFailure;
  readonly update?: PluginUpdatePlan;
  readonly storageUsageBytes: number;
  readonly storageSchemaVersion: number;
  readonly updatedAt: string;
  /** Security state is persisted separately from lifecycle state to prevent rollback resurrection. */
  readonly revisionSecurity?: Readonly<Record<string, PluginRevisionSecurityState>>;
}

export type PluginUpdateState = 'AVAILABLE' | 'REVIEW_REQUIRED' | 'READY' | 'APPLYING' | 'APPLIED' | 'FAILED' | 'ROLLED_BACK';
export interface PluginUpdatePlan {
  readonly pluginId: PluginId;
  readonly from: PluginRevision;
  readonly to: PluginRevision;
  readonly state: PluginUpdateState;
  readonly requestedCapabilities: readonly PluginCapabilityRequest[];
  readonly addedCapabilities: readonly PluginCapability[];
  readonly removedCapabilities: readonly PluginCapability[];
  readonly requiresOwnerReview: boolean;
  readonly createdAt: string;
  readonly failure?: PluginFailure;
}

export interface PluginStorageEntry {
  readonly key: string;
  readonly value: unknown;
  readonly bytes: number;
  readonly updatedAt: string;
}

export interface PluginStorageNamespace {
  readonly pluginId: PluginId;
  readonly quotaBytes: number;
  get<T = unknown>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<boolean>;
  list(options?: { readonly cursor?: string; readonly limit?: number }): Promise<{ readonly entries: readonly PluginStorageEntry[]; readonly nextCursor?: string }>;
  usage(): Promise<number>;
  clear(): Promise<void>;
}

/** Opaque plugin-owned secret namespace. No method exposes secret bytes. */
export interface PluginSecretHandle {
  readonly kind: 'PLUGIN_SECRET_HANDLE';
  readonly id: string;
  readonly pluginId: PluginId;
  readonly secretClass: 'PLUGIN_SECRET' | 'PLUGIN_CREDENTIAL';
  readonly state: 'ACTIVE' | 'REVOKED' | 'UNAVAILABLE';
}
export interface PluginSecretNamespace {
  create(input: { readonly name: string; readonly secretClass?: PluginSecretHandle['secretClass'] }): Promise<PluginSecretHandle>;
  status(handleId: string): Promise<PluginSecretHandle | undefined>;
  revoke(handleId: string, reason?: string): Promise<void>;
}

export interface PluginSurfaceGateway {
  /** Host-owned safety + authorization boundary. It never returns raw content. */
  publishShared(input: { readonly pluginId: PluginId; readonly surface: string; readonly objectId: string; readonly value: unknown; readonly domain: string }): Promise<boolean>;
}

/** Optional host-owned structured secret namespace adapter. Plugin code only receives opaque handles. */
export interface PluginSecretNamespaceFactory { forPlugin(pluginId: PluginId, revision: PluginRevision): PluginSecretNamespace; }

/** Coarse, privacy-preserving view of the R0P67 Connectivity Fabric. */
export interface PluginConnectivityState { readonly state: 'OFFLINE' | 'DEVICE_ONLY' | 'NEARBY' | 'LOCAL_NETWORK' | 'RESTRICTED_NETWORK' | 'GLOBAL_NETWORK'; readonly quality?: 'UNKNOWN' | 'POOR' | 'FAIR' | 'GOOD'; readonly reachability?: 'DIRECT' | 'EVENTUALLY' | 'UNAVAILABLE' | 'UNKNOWN'; readonly delivery?: Readonly<{ realtime: boolean; bulk: boolean; eventual: boolean }>; }

export interface PluginProviderRegistration {
  readonly id: string;
  readonly kind: Exclude<PluginExtensionPoint, 'UI_ACTIVITY_BAR' | 'UI_COMMAND' | 'UI_SETTINGS' | 'UI_CONTEXT_ACTION' | 'UI_OBJECT_VIEW' | 'UI_SIDEBAR' | 'EVENT_SUBSCRIPTION'>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
  /** Optional executable provider. It is accepted only by a host that binds it to PluginSandbox. */
  readonly provider?: unknown;
}

export interface PluginUiExtensionRegistration {
  readonly id: string;
  readonly kind: Extract<PluginExtensionPoint, 'UI_ACTIVITY_BAR' | 'UI_COMMAND' | 'UI_SETTINGS' | 'UI_CONTEXT_ACTION' | 'UI_OBJECT_VIEW' | 'UI_SIDEBAR'>;
  readonly label: string;
  /** Declarative metadata only; executable UI is hosted by Keystone. */
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface PluginEventSubscription {
  readonly id: string;
  readonly event: string;
  readonly scope?: string;
  readonly redacted: true;
}

export interface PluginHost {
  readonly pluginId: PluginId;
  readonly revision: PluginRevision;
  readonly storage: PluginStorageNamespace;
  readonly secrets?: PluginSecretNamespace;
  call<T = unknown>(capability: PluginCapability, operation: string, input?: unknown, scope?: string): Promise<T>;
  connectivity(): Promise<PluginConnectivityState>;
  registerProvider(registration: PluginProviderRegistration): Promise<void>;
  /** Executable provider registration is host/sandbox bound; functions are never persisted. */
  registerExecutableProvider?(registration: { readonly id: string; readonly kind: string; readonly provider: unknown; readonly requiredCapabilities?: readonly PluginCapability[] }): Promise<void>;
  registerUiExtension(registration: PluginUiExtensionRegistration): Promise<void>;
  subscribe(subscription: Omit<PluginEventSubscription, 'redacted'>): Promise<PluginEventSubscription>;
  unregister(id: string): Promise<void>;
  requestExternalLink(url: string, reason: string): Promise<{ readonly accepted: boolean; readonly url?: string }>;
  publishShared(input: { readonly surface: string; readonly objectId: string; readonly value: unknown; readonly domain: string }): Promise<boolean>;
  /** Stable API metadata; internal Core service discovery is never exposed. */
  getApiCapabilities?(): { readonly apiVersion: number; readonly features: readonly unknown[] };
  registerExtension?<TPayload = unknown>(registration: { readonly id: string; readonly kind: string; readonly payload: TPayload; readonly requiredCapabilities?: readonly PluginCapability[]; readonly label?: string }): Promise<{ readonly handleId: string; readonly state: string }>;
  unregisterExtension?(handleId: string): Promise<void>;
}

export interface PluginRuntime {
  readonly isolation: 'tauri-isolated-webview' | 'quickjs' | 'wasmtime' | 'mobile-isolated-js' | 'development-adapter';
  /** Production executable runtimes must set this truthfully. */
  readonly sandboxed?: boolean;
  start(plugin: PluginInstallRecord, host: PluginHost): Promise<void>;
  execute(plugin: PluginInstallRecord, host: PluginHost, method: string, input?: unknown): Promise<unknown>;
  stop(plugin: PluginInstallRecord, host: PluginHost): Promise<void>;
}

export interface PluginRegistryStore {
  read(): Promise<readonly PluginInstallRecord[]>;
  write(records: readonly PluginInstallRecord[]): Promise<void>;
  readStorage?(pluginId: PluginId): Promise<readonly PluginStorageEntry[]>;
  writeStorage?(pluginId: PluginId, entries: readonly PluginStorageEntry[]): Promise<void>;
}

export interface PluginInstallerOptions {
  readonly ownerIdentity: string;
  readonly deviceId?: string;
  readonly platform?: NonNullable<PluginCompatibility['platforms']>[number];
  readonly runtime?: PluginRuntime;
  readonly registry?: PluginRegistryStore;
  readonly quarantine?: PluginQuarantine;
  readonly now?: () => number;
  readonly defaultBudget?: Partial<PluginResourceBudget>;
  readonly ownerApproval?: (review: PluginInstallReview) => Promise<boolean>;
  readonly capabilityApproval?: (request: PluginCapabilityRequest, plugin: PluginManifest) => Promise<boolean>;
  /** Production mode rejects development adapters for executable Plugins. */
  readonly mode?: 'development' | 'production';
  readonly supplyChainPolicy?: PluginSupplyChainPolicy;
}

export interface PluginInstallReview {
  readonly plugin: PluginManifest;
  readonly source: PluginSourceDescriptor;
  readonly requestedCapabilities: readonly PluginCapabilityRequest[];
  readonly dependencies: readonly PluginDependency[];
  readonly risk: 'LOW' | 'MEDIUM' | 'HIGH';
  readonly integrityVerified: true;
  readonly compatibility: 'SUPPORTED';
}

export interface PluginQuarantine {
  inspect(plugin: PluginPackage): Promise<void>;
  release(plugin: PluginPackage): Promise<void>;
}

export interface PluginRuntimeFactory {
  create(plugin: PluginPackage): Promise<PluginRuntime>;
}

/**
 * The process boundary is deliberately represented by a host adapter.  Core never
 * imports executable plugin code; it only exchanges bounded, JSON-shaped RPC.
 */
export type PluginRuntimeProfile = 'ISOLATED_JS_PROCESS' | 'WASM' | 'TAURI_ISOLATED_WEBVIEW' | 'MOBILE_ISOLATED_JS' | 'DEVELOPMENT_ADAPTER';
export type PluginSandboxTrustClass = 'PLUGIN_PACKAGE_UNTRUSTED' | 'PLUGIN_INSTALLED_DISABLED' | 'PLUGIN_EXECUTABLE_UNTRUSTED' | 'PLUGIN_SANDBOXED' | 'PLUGIN_QUARANTINED' | 'PLUGIN_DEVELOPMENT';
export type PluginSandboxViolationClass = 'UNAUTHORIZED_FS' | 'UNAUTHORIZED_NETWORK' | 'UNAUTHORIZED_PROCESS' | 'UNAUTHORIZED_SECRET' | 'INVALID_IPC' | 'CAPABILITY_FORGERY' | 'RESOURCE_EXCEEDED' | 'RUNTIME_TAMPER' | 'FORBIDDEN_HOST_API' | 'NAMESPACE_ESCAPE';
export type PluginSandboxExitReason = 'STOPPED' | 'DISABLED' | 'UNINSTALLED' | 'CRASHED' | 'TIMEOUT' | 'RESOURCE_EXCEEDED' | 'VIOLATION' | 'QUARANTINED';
export type PluginSandboxHealth = 'STARTING' | 'HEALTHY' | 'DEGRADED' | 'TERMINATED' | 'QUARANTINED';

export interface PluginSandboxProfile {
  readonly name: 'DEFAULT' | 'NETWORK_SCOPED' | 'BACKGROUND' | 'MEDIA_PROVIDER' | 'MODEL_PROVIDER';
  readonly runtime: PluginRuntimeProfile;
  readonly filesystem: 'NONE' | 'PRIVATE_NAMESPACE';
  readonly process: 'DENY';
  readonly native: 'DENY';
  readonly network: 'DENY' | 'SCOPED';
  readonly maxMessageBytes: number;
}
export interface PluginSandboxPolicy {
  readonly profile: PluginSandboxProfile;
  readonly environmentAllowlist: readonly string[];
  readonly allowedOrigins: readonly string[];
  readonly allowPrivateNetwork: false;
  readonly allowLoopback: false;
  readonly allowChildProcess: false;
  readonly allowNativeModules: false;
}
export interface PluginSandboxSession {
  readonly sessionId: string;
  readonly pluginId: string;
  readonly revisionHash: string;
  readonly trust: PluginSandboxTrustClass;
  readonly policy: PluginSandboxPolicy;
  readonly startedAt: string;
  readonly health: PluginSandboxHealth;
}
export interface PluginSandboxViolation {
  readonly id: string;
  readonly pluginId: string;
  readonly revisionHash: string;
  readonly sessionId?: string;
  readonly class: PluginSandboxViolationClass;
  readonly operation: string;
  readonly at: string;
  readonly terminated: boolean;
}
export interface PluginSandboxResourceController {
  readonly budget: PluginResourceBudget;
  check(input: { readonly kind: 'ipc' | 'event' | 'network' | 'storage' | 'provider' | 'ui'; readonly bytes?: number }): void;
  resetWindow?(): void;
}

export interface PluginSandboxCapabilityBridge {
  call<T = unknown>(envelope: PluginSandboxIpcEnvelope, token?: PluginCapabilityToken): Promise<T>;
  cancel(correlationId: string): Promise<void>;
}

export interface PluginSandboxHost {
  createSession(plugin: PluginInstallRecord, policy?: PluginSandboxPolicy): Promise<PluginSandboxSession>;
  terminate(sessionId: string, reason: PluginSandboxExitReason): Promise<void>;
  health(sessionId: string): PluginSandboxHealth;
  violations(sessionId?: string): readonly PluginSandboxViolation[];
  /** Optional native process integration. The host owns all process handles. */
  launchNativeProcess?(request: { readonly pluginId: string; readonly revisionHash: string; readonly entrypoint: string; readonly workingDirectory: string; readonly environment?: Readonly<Record<string, string>>; readonly maxRuntimeMs?: number }): Promise<{ readonly kind: 'NATIVE_PROCESS_SANDBOX_HANDLE'; readonly id: string; readonly pluginId: string; readonly startedAt: string; readonly state: 'RUNNING' | 'EXITED' | 'KILLED' }>;
  terminateNativeProcess?(handle: { readonly kind: 'NATIVE_PROCESS_SANDBOX_HANDLE'; readonly id: string; readonly pluginId: string; readonly startedAt: string; readonly state: 'RUNNING' | 'EXITED' | 'KILLED' }): Promise<void>;
}

export interface PluginCapabilityToken {
  readonly tokenId: string;
  readonly pluginId: string;
  readonly revisionHash: string;
  readonly sandboxSessionId: string;
  readonly capability: PluginCapability;
  readonly scope: string;
  readonly ownerIdentity: string;
  readonly issuedAt: string;
  readonly expiresAt?: string;
  readonly maxUses?: number;
  readonly uses: number;
  readonly revokedAt?: string;
}

export interface PluginPublisherIdentity { readonly publisherId: string; readonly keyId: string; readonly algorithm: 'ED25519'; readonly publicKey?: string; }
export interface PluginPackageProvenance { readonly source: PluginSourceDescriptor; readonly receivedAt: string; readonly publisher?: PluginPublisherIdentity; readonly components?: readonly string[]; }
export interface PluginTrustEvidence { readonly kind: 'SIGNATURE' | 'INTEGRITY' | 'OWNER_REVIEW' | 'PUBLISHER_REVOCATION' | 'DEPENDENCY_LOCK'; readonly value: string; readonly at: string; }
export interface PluginVerificationResult { readonly pluginId: string; readonly version: string; readonly packageHash: string; readonly integrity: 'VERIFIED' | 'FAILED'; readonly signature: 'SIGNED' | 'UNSIGNED' | 'UNVERIFIED' | 'INVALID'; readonly publisher: 'VERIFIED_PUBLISHER' | 'UNKNOWN' | 'REVOKED'; readonly security: 'SECURITY_APPROVED' | 'REVIEW_REQUIRED' | 'REJECTED'; readonly evidence: readonly PluginTrustEvidence[]; }
export interface PluginSigningPolicy { readonly requireSignature: boolean; readonly allowedPublishers?: readonly string[]; readonly rejectRevokedPublishers: boolean; }
export interface PluginSupplyChainPolicy { readonly signing: PluginSigningPolicy; readonly requireDependencyLocks: boolean; readonly maxBundleBytes: number; readonly maxResourceCount: number; readonly maxResourceBytes: number; readonly rejectNativePayloads: boolean; }
export interface PluginDependencyLock { readonly pluginId: string; readonly dependencies: readonly { readonly id: string; readonly version: string; readonly integrity: string; }[]; readonly graphHash: string; }
export interface PluginRevocationRecord { readonly kind: 'PUBLISHER' | 'REVISION' | 'DEPENDENCY'; readonly subject: string; readonly reason: string; readonly issuedAt: string; readonly expiresAt?: string; readonly evidence?: string; }
export interface PublisherKeyRotation { readonly publisherId: string; readonly oldKeyId: string; readonly newKeyId: string; readonly transitionSignature: string; readonly effectiveAt: string; }
export interface PluginUpdateTrustDecision { readonly pluginId: string; readonly from: PluginRevision; readonly to: PluginRevision; readonly decision: 'ALLOW' | 'REVIEW' | 'REJECT'; readonly reasons: readonly string[]; readonly verification: PluginVerificationResult; }

/* ------------------------------------------------------------------------- *
 * R0P64 distribution, update and recovery contracts.
 *
 * These are intentionally transport-neutral.  A source/peer can advertise or
 * carry bytes, but it never becomes an authority and it never receives owner
 * state.  ContentAddress is the immutable package identity used throughout
 * the lifecycle.
 * ------------------------------------------------------------------------- */
export type PluginSourceId = string;
export type PluginContentAddress = `sha256:${string}`;
export type PluginSourceTrust = 'UNKNOWN' | 'KNOWN_SOURCE' | 'AUTHENTICATED' | 'CORE_RESERVED' | 'UNTRUSTED';

export interface PluginPackageDescriptor {
  readonly pluginId: PluginId;
  readonly name?: string;
  readonly description?: string;
  readonly version: PluginVersion;
  readonly contentAddress: PluginContentAddress;
  readonly packageSize?: number;
  readonly publisher?: PluginPublisherIdentity;
  readonly sourceId?: PluginSourceId;
  readonly requestedCapabilities?: readonly PluginCapabilityRequest[];
  readonly dependencies?: readonly PluginDependency[];
  readonly compatibility?: PluginCompatibility;
  readonly channel?: PluginUpdateChannel;
  readonly securityRevoked?: boolean;
  readonly discoveredAt: string;
}

export interface PluginPackageReference {
  readonly pluginId: PluginId;
  readonly version: PluginVersion;
  readonly contentAddress: PluginContentAddress;
  readonly sourceId?: PluginSourceId;
}

export interface PluginDistributionRecord {
  readonly reference: PluginPackageReference;
  readonly descriptor?: PluginPackageDescriptor;
  readonly state: PluginTransferState;
  readonly receivedBytes: number;
  readonly totalBytes?: number;
  readonly receivedChunks: readonly number[];
  readonly sourceIds: readonly PluginSourceId[];
  /** Opaque transport provenance only; relay identities/routes are excluded. */
  readonly transportKinds?: readonly PluginSourceKind[];
  readonly firstReceivedAt: string;
  readonly updatedAt: string;
  readonly error?: PluginFailure;
}

export interface PluginDistributionAuditEvent {
  readonly id: string;
  readonly type: 'PACKAGE_RECEIVED' | 'VERIFICATION_FAILED' | 'INSTALL_READY' | 'UPDATE_STAGED' | 'UPDATE_APPLIED' | 'ROLLBACK' | 'SECURITY_QUARANTINE' | 'RECOVERY' | 'TAMPER_DETECTED';
  readonly pluginId?: string;
  readonly contentAddress?: PluginContentAddress;
  readonly sourceIds?: readonly PluginSourceId[];
  readonly at: string;
  readonly details?: string;
}

export interface PluginDiscoveryResult extends PluginPackageDescriptor {
  readonly source: PluginSourceDescriptor;
  readonly metadataTrust: 'UNTRUSTED' | 'SOURCE_AUTHENTICATED';
}

export interface PluginDownloadPlan {
  readonly id: string;
  readonly reference: PluginPackageReference;
  readonly sourceIds: readonly PluginSourceId[];
  readonly deliveryClass: 'BULK' | 'BACKGROUND' | 'INTERACTIVE_SMALL';
  readonly maxConcurrentChunks: number;
  readonly createdAt: string;
  readonly offlineQueued: boolean;
}

export type PluginTransferState = 'DISCOVERED' | 'QUEUED' | 'ACQUIRING' | 'PARTIAL' | 'QUARANTINED' | 'VERIFIED' | 'READY' | 'FAILED' | 'CANCELLED' | 'COMPLETE';

export interface PluginTransferReceipt {
  readonly transferId: string;
  readonly reference: PluginPackageReference;
  readonly sourceId?: PluginSourceId;
  readonly receivedChunks: readonly number[];
  readonly bytes: number;
  readonly completedAt?: string;
  readonly integrity: 'PENDING' | 'VERIFIED' | 'FAILED';
}

export interface PluginInstallCandidate {
  readonly package: PluginPackageDescriptor;
  readonly reviewRequired: true;
  readonly installedDisabled: true;
}

export interface PluginUpdateCandidate extends PluginPackageDescriptor {
  readonly current: PluginRevision;
  readonly permissionExpansion: readonly PluginCapability[];
  readonly publisherChanged: boolean;
  readonly dependencyChanged: boolean;
  readonly decision: 'ALLOW' | 'REVIEW' | 'REJECT';
  readonly reasons: readonly string[];
}

export type PluginUpdateChannel = 'STABLE' | 'PREVIEW' | 'DEVELOPMENT' | 'CUSTOM';
export type PluginUpdatePolicyMode = 'NOTIFY_ONLY' | 'DOWNLOAD_ONLY' | 'AUTO_APPLY_SAFE_COMPATIBLE';
export interface PluginUpdatePolicy {
  readonly channel?: PluginUpdateChannel;
  readonly mode: PluginUpdatePolicyMode;
  readonly allowedSourceIds?: readonly PluginSourceId[];
  readonly requireSamePublisher?: boolean;
  readonly intervalMs?: number;
  readonly allowSecurityUpdates?: boolean;
}
export interface PluginUpdateCheckResult {
  readonly pluginId: PluginId;
  readonly current: PluginRevision;
  readonly candidates: readonly PluginUpdateCandidate[];
  readonly checkedAt: string;
  readonly stale: boolean;
}

export type PluginRecoveryState = 'HEALTHY' | 'NEEDS_REPAIR' | 'UPDATE_INTERRUPTED' | 'MIGRATION_INTERRUPTED' | 'CRASH_LOOP' | 'DEPENDENCY_MISSING' | 'SOURCE_UNAVAILABLE' | 'INCOMPATIBLE' | 'SECURITY_QUARANTINED' | 'REPAIRED' | 'FAILED';
export interface PluginRecoveryPlan {
  readonly pluginId: PluginId;
  readonly revision: PluginRevision;
  readonly state: PluginRecoveryState;
  readonly exactContentAddress: PluginContentAddress;
  readonly allowedSourceIds: readonly PluginSourceId[];
  readonly ownerActionRequired: boolean;
  readonly createdAt: string;
  readonly reason?: string;
}
export interface PluginRevisionArchive {
  readonly pluginId: PluginId;
  readonly revision: PluginRevision;
  readonly archivedAt: string;
  readonly knownGood: boolean;
  readonly securityState: PluginRevisionSecurityState;
}
export interface PluginRepairResult {
  readonly pluginId: PluginId;
  readonly revision: PluginRevision;
  readonly state: 'REPAIRED' | 'REJECTED' | 'UNAVAILABLE' | 'REVIEW_REQUIRED';
  readonly contentAddress: PluginContentAddress;
  readonly reason?: string;
}
export interface PluginAvailabilityRecord {
  readonly contentAddress: PluginContentAddress;
  readonly available: boolean;
  readonly sourceIds: readonly PluginSourceId[];
  readonly lastSeenAt: string;
  readonly partial?: boolean;
}

export interface PluginChunk {
  readonly contentAddress: PluginContentAddress;
  readonly index: number;
  readonly total: number;
  readonly offset: number;
  readonly bytes: Uint8Array;
  readonly hash: string;
}
export interface PluginPackageTransfer {
  readonly package?: PluginPackage;
  readonly chunks?: AsyncIterable<PluginChunk> | readonly PluginChunk[];
  /** Optional canonical JSON envelope for hosts that only expose chunk bytes. */
  readonly serializedPackage?: Uint8Array | string;
  readonly totalBytes?: number;
  readonly totalChunks?: number;
}

export interface PluginSourceProvider {
  readonly descriptor: PluginSourceDescriptor;
  discover?(query: { readonly text?: string; readonly pluginId?: string; readonly version?: string; readonly limit: number; readonly channel?: PluginUpdateChannel }): Promise<readonly PluginDiscoveryResult[]>;
  acquire(reference: PluginPackageReference, signal?: AbortSignal, resume?: { readonly receivedChunks: readonly number[] }): Promise<PluginPackage | PluginPackageTransfer>;
}

export interface PluginSourceRegistration {
  readonly descriptor: PluginSourceDescriptor;
  readonly provider: PluginSourceProvider;
}

export interface PluginDistributionOptions {
  readonly now?: () => number;
  readonly maxConcurrentTransfers?: number;
  readonly maxConcurrentChunks?: number;
  readonly maxChunkBytes?: number;
  readonly maxPackageBytes?: number;
  readonly sourceTimeoutMs?: number;
  readonly offline?: boolean;
  readonly policy?: PluginUpdatePolicy;
  readonly supplyChainPolicy?: import('./plugin-types.js').PluginSupplyChainPolicy;
  readonly revocations?: readonly PluginRevocationRecord[];
  readonly quarantine?: PluginQuarantine;
  readonly installer?: { receive(plugin: PluginPackage): Promise<PluginManifest>; install?(pluginId: string): Promise<PluginInstallRecord>; update?(pluginId: string, plugin: PluginPackage): Promise<PluginUpdatePlan>; applyUpdate?(pluginId: string, approvePermissions?: boolean): Promise<PluginInstallRecord> };
  readonly onAudit?: (event: PluginDistributionAuditEvent) => Promise<void> | void;
  readonly onRecord?: (record: PluginDistributionRecord) => Promise<void> | void;
  /** Host-owned decoder for a transport that only exposes opaque package bytes. */
  readonly decodePackage?: (bytes: Uint8Array, reference: PluginPackageReference) => Promise<PluginPackage> | PluginPackage;
  readonly store?: PluginDistributionStore;
  readonly chunkStore?: PluginDistributionChunkStore;
}

export interface PluginDistributionStore {
  read(): Promise<readonly PluginDistributionRecord[]>;
  write(records: readonly PluginDistributionRecord[]): Promise<void>;
}
export interface PluginDistributionChunkStore {
  read(contentAddress: PluginContentAddress): Promise<readonly PluginChunk[]>;
  write(contentAddress: PluginContentAddress, chunks: readonly PluginChunk[]): Promise<void>;
  delete(contentAddress: PluginContentAddress): Promise<void>;
}

export interface PluginDistributionBackupRecord {
  readonly pluginId: PluginId;
  readonly revisions: readonly PluginRevisionArchive[];
  readonly sourceIds: readonly PluginSourceId[];
  readonly preferences?: Readonly<Record<string, string | number | boolean>>;
}

export interface PluginNetworkPolicy {
  readonly origins: readonly string[];
  readonly schemes: readonly ('https' | 'http')[];
  readonly allowLoopback: false;
  readonly allowPrivateNetwork: false;
  readonly maxResponseBytes: number;
  readonly timeoutMs: number;
  readonly maxRedirects: number;
  readonly requestsPerMinute: number;
  readonly maxConcurrent: number;
}
export interface PluginSandboxIpcEnvelope {
  readonly version: 1;
  readonly correlationId: string;
  readonly sessionId: string;
  readonly pluginId: string;
  readonly revisionHash: string;
  readonly capability?: PluginCapability;
  readonly operation: string;
  readonly payload: unknown;
  readonly createdAt: string;
}

export function sourceDescriptor(source: PluginSource): PluginSourceDescriptor {
  return typeof source === 'string' ? { kind: source } : { ...source };
}
