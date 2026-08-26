/**
 * R0P63 stable Plugin API and extension-surface contracts.
 *
 * These are deliberately host-owned data contracts.  They never expose a Core
 * service container, executable closures or raw Keystone objects to a Plugin.
 */
import type {
  PluginCapability,
  PluginInstallRecord,
  PluginRevision,
} from './plugin-types.js';
import { PluginPlatformError } from './plugin-platform.js';

export const PLUGIN_API_VERSION = 1 as const;
/** Stable Plugin API contract version, deliberately independent of Keystone's release version. */
export type PluginApiVersion = typeof PLUGIN_API_VERSION;
export const PLUGIN_API_FEATURES = [
  'ui.activityBar.v1', 'ui.commands.v1', 'ui.contextMenu.v1', 'ui.settings.v1', 'ui.views.v1',
  'tools.v1', 'skills.v1', 'models.v1', 'context.v1', 'search.v1', 'media.video.v1',
  'media.music.v1', 'media.live.v1', 'calendar.v1', 'files.v1', 'objects.v1', 'agents.v1',
  'notifications.v1', 'events.v1', 'connectivity.v1', 'externalLinks.v1',
] as const;
export type PluginApiFeatureId = (typeof PLUGIN_API_FEATURES)[number] | (string & {});
export type PluginApiFeature = PluginApiFeatureId;

export interface PluginApiRange {
  readonly minimum?: number;
  readonly maximum?: number;
  readonly preferred?: number;
  /** Aliases accepted by manifest/tooling adapters. */
  readonly min?: number;
  readonly max?: number;
}
export interface PluginFeatureVersion {
  readonly feature: PluginApiFeatureId;
  readonly version: number;
  readonly stability: 'STABLE' | 'EXPERIMENTAL' | 'DEPRECATED';
  readonly available: boolean;
}
export interface PluginApiCompatibilityResult {
  readonly compatible: boolean;
  readonly selectedVersion?: number;
  readonly unsupportedFeatures: readonly PluginApiFeatureId[];
  readonly reason?: string;
}

export type PluginPlatform = 'linux' | 'windows' | 'macos' | 'android' | 'ios' | 'web';

const DEFAULT_FEATURES: readonly PluginFeatureVersion[] = PLUGIN_API_FEATURES.map(feature => ({ feature, version: 1, stability: 'STABLE' as const, available: true }));

export class PluginApiRegistry {
  private readonly features = new Map<PluginApiFeatureId, PluginFeatureVersion>(DEFAULT_FEATURES.map(value => [value.feature, value]));
  constructor(features: readonly PluginFeatureVersion[] = []) {
    for (const feature of features) {
      const existing = this.features.get(feature.feature);
      if (existing) {
        if (existing.version !== feature.version || existing.available !== feature.available || existing.stability !== feature.stability) fail('POLICY_DENIED', `Stable Plugin API feature cannot be overridden: ${feature.feature}`);
        continue;
      }
      validateFeature(feature);
      this.features.set(feature.feature, { ...feature });
    }
  }
  getApiVersion(): 1 { return PLUGIN_API_VERSION; }
  getApiCapabilities(): { readonly apiVersion: 1; readonly features: readonly PluginFeatureVersion[] } { return { apiVersion: 1, features: [...this.features.values()].map(value => ({ ...value })) }; }
  feature(feature: PluginApiFeatureId): PluginFeatureVersion | undefined { const value = this.features.get(feature); return value && { ...value }; }
  registerFeature(feature: PluginFeatureVersion): void { validateFeature(feature); if (this.features.has(feature.feature) || /^(?:core|security|identity|protocol|safety)\./i.test(feature.feature)) fail('POLICY_DENIED', 'Stable Plugin API features cannot be overridden'); this.features.set(feature.feature, { ...feature }); }
  negotiate(range: PluginApiRange, requestedFeatures: readonly PluginApiFeatureId[] = [], platform?: PluginPlatform): PluginApiCompatibilityResult {
    const minimum = range?.minimum ?? range?.min;
    const maximum = range?.maximum ?? range?.max;
    const min = minimum as number; const max = maximum as number;
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min < 1 || max < min) return { compatible: false, unsupportedFeatures: [], reason: 'Plugin API version range is malformed' };
    const selected = [range.preferred, max, min].find(value => value !== undefined && Number.isSafeInteger(value) && value >= min && value <= max && value === PLUGIN_API_VERSION);
    const unsupportedFeatures = requestedFeatures.filter(feature => !this.features.get(feature)?.available || this.features.get(feature)!.version < 1);
    void platform;
    return selected && !unsupportedFeatures.length ? { compatible: true, selectedVersion: selected, unsupportedFeatures: [] } : { compatible: false, unsupportedFeatures, reason: unsupportedFeatures.length ? 'Requested Plugin API feature is unavailable' : 'Plugin API version range is unsupported' };
  }
  negotiateExtension(input: PluginExtensionCompatibility, platform?: PluginPlatform): PluginApiCompatibilityResult {
    if (platform && input.platforms?.length && !input.platforms.includes(platform)) return { compatible: false, unsupportedFeatures: [], reason: 'Plugin extension platform is unsupported' };
    return this.negotiate(input.api, input.features ?? [], platform);
  }
}

export const PLUGIN_EXTENSION_KINDS = [
  'TOOL_PROVIDER', 'SKILL_PROVIDER', 'MODEL_PROVIDER', 'CONTEXT_PROVIDER', 'SEARCH_PROVIDER',
  'VIDEO_PROVIDER', 'MUSIC_PROVIDER', 'LIVE_PROVIDER', 'CALENDAR_PROVIDER', 'FILE_HANDLER_PROVIDER',
  'OBJECT_RENDERER_PROVIDER', 'AGENT_CAPABILITY_PROVIDER', 'UI_ACTIVITY_BAR', 'UI_COMMAND',
  'UI_CONTEXT_MENU', 'UI_SIDEBAR', 'UI_SETTINGS', 'UI_OBJECT_ACTION', 'UI_STATUS', 'UI_VIEW',
  'NOTIFICATION_PROVIDER', 'EVENT_SUBSCRIPTION',
] as const;
export type PluginExtensionKind = (typeof PLUGIN_EXTENSION_KINDS)[number];
export type PluginExtensionRegistrationId = `plugin:${string}:${string}`;

export type PluginExtensionLifecycleState = 'ACTIVE' | 'DISABLED' | 'REVOKED' | 'STALE' | 'REMOVED';
export interface PluginExtensionQuota {
  readonly maxTotal?: number;
  readonly maxPerKind?: number;
  readonly maxPayloadBytes?: number;
  readonly maxLabelLength?: number;
  readonly maxConcurrentInvocations?: number;
}
export interface PluginExtensionCompatibility {
  readonly api: PluginApiRange;
  readonly features?: readonly PluginApiFeatureId[];
  readonly platforms?: readonly ('linux' | 'windows' | 'macos' | 'android' | 'ios' | 'web')[];
}
export interface PluginExtensionContext {
  readonly pluginId: string;
  readonly revision: PluginRevision;
  readonly sandboxSessionId: string;
  readonly ownerIdentity: string;
  readonly grantedCapabilities: readonly PluginCapability[];
}
export interface PluginExtensionRegistration<TPayload = unknown> {
  readonly id: string;
  readonly kind: PluginExtensionKind;
  readonly pluginId: string;
  readonly revisionHash: string;
  readonly sandboxSessionId: string;
  readonly requiredCapabilities?: readonly PluginCapability[];
  readonly compatibility?: PluginExtensionCompatibility;
  readonly payload: TPayload;
  readonly label?: string;
  readonly enabled?: boolean;
}
export interface PluginExtensionHandle {
  readonly handleId: string;
  readonly id: string;
  readonly kind: PluginExtensionKind;
  readonly pluginId: string;
  readonly revisionHash: string;
  readonly sandboxSessionId: string;
  readonly state: PluginExtensionLifecycleState;
}
export interface PluginExtensionRecord<TPayload = unknown> extends PluginExtensionRegistration<TPayload> {
  readonly handleId: string;
  readonly state: PluginExtensionLifecycleState;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly invocationCount: number;
}

const RESERVED = new Set(['core', 'security', 'identity', 'protocol', 'safety', 'secret', 'owner-authority']);
const KIND_CAPABILITY: Partial<Record<PluginExtensionKind, PluginCapability>> = {
  TOOL_PROVIDER: 'tool.register', SKILL_PROVIDER: 'skill.provide', MODEL_PROVIDER: 'model.provider.register', CONTEXT_PROVIDER: 'context.provider.register', SEARCH_PROVIDER: 'search.provider.register', VIDEO_PROVIDER: 'media.provider.register', MUSIC_PROVIDER: 'media.provider.register', LIVE_PROVIDER: 'media.provider.register', CALENDAR_PROVIDER: 'calendar.provider.register', FILE_HANDLER_PROVIDER: 'file.handler.register', OBJECT_RENDERER_PROVIDER: 'object.renderer.register', AGENT_CAPABILITY_PROVIDER: 'agent.capability.register', UI_ACTIVITY_BAR: 'ui.extend', UI_COMMAND: 'ui.extend', UI_CONTEXT_MENU: 'ui.extend', UI_SIDEBAR: 'ui.extend', UI_SETTINGS: 'ui.extend', UI_OBJECT_ACTION: 'ui.extend', UI_STATUS: 'ui.extend', UI_VIEW: 'ui.extend', NOTIFICATION_PROVIDER: 'notifications.create', EVENT_SUBSCRIPTION: 'events.subscribe',
};

export interface PluginExtensionRegistryOptions { readonly now?: () => number; readonly api?: PluginApiRegistry; readonly platform?: PluginPlatform; readonly quota?: PluginExtensionQuota; readonly authorize?: (input: { readonly registration: PluginExtensionRegistration; readonly context: PluginExtensionContext }) => void; }

/** Registry is the only durable source of extension metadata; executable code is never persisted. */
export class PluginExtensionRegistry {
  private readonly records = new Map<string, PluginExtensionRecord>();
  private readonly now: () => number;
  private readonly api: PluginApiRegistry;
  private readonly quota: Required<PluginExtensionQuota>;
  private sequence = 0;
  private readonly invocations = new Map<string, number>();
  constructor(private readonly options: PluginExtensionRegistryOptions = {}) { this.now = options.now ?? (() => Date.now()); this.api = options.api ?? new PluginApiRegistry(); this.quota = { maxTotal: 256, maxPerKind: 64, maxPayloadBytes: 256 * 1024, maxLabelLength: 160, maxConcurrentInvocations: 32, ...options.quota }; }
  register<TPayload>(registration: PluginExtensionRegistration<TPayload>, context?: PluginExtensionContext): PluginExtensionHandle {
    validateRegistration(registration, this.quota, this.api);
    const actualContext: PluginExtensionContext = context ?? { pluginId: registration.pluginId, revision: { version: '0.0.0', packageHash: registration.revisionHash, installedAt: new Date(this.now()).toISOString(), source: { kind: 'DEVELOPMENT' } }, sandboxSessionId: registration.sandboxSessionId, ownerIdentity: 'host', grantedCapabilities: [] };
    if (actualContext.pluginId !== registration.pluginId || actualContext.revision.packageHash !== registration.revisionHash || actualContext.sandboxSessionId !== registration.sandboxSessionId) fail('POLICY_DENIED', 'Extension registration principal does not match its session');
    const required = new Set(registration.requiredCapabilities ?? []); const kindCapability = KIND_CAPABILITY[registration.kind]; if (kindCapability) required.add(kindCapability); for (const capability of required) if (!actualContext.grantedCapabilities.includes(capability)) fail('CAPABILITY_DENIED', `Extension capability is not granted: ${capability}`);
    this.options.authorize?.({ registration, context: actualContext });
    const qualified = registration.id;
    if (this.records.has(qualified)) fail('INVALID_ARGUMENT', `Plugin extension ID already exists: ${qualified}`);
    if (this.records.size >= this.quota.maxTotal || [...this.records.values()].filter(value => value.kind === registration.kind && value.state === 'ACTIVE').length >= this.quota.maxPerKind) fail('QUOTA', 'Plugin extension quota exceeded');
    const now = new Date(this.now()).toISOString(); const record: PluginExtensionRecord = { ...structuredClone(registration), requiredCapabilities: [...required], handleId: `pex:${registration.pluginId}:${++this.sequence}`, state: registration.enabled === false ? 'DISABLED' : 'ACTIVE', createdAt: now, updatedAt: now, invocationCount: 0 };
    this.records.set(qualified, record); return toHandle(record);
  }
  get(handleOrId: string): PluginExtensionRecord | undefined { const record = [...this.records.values()].find(value => value.handleId === handleOrId || value.id === handleOrId); return record && structuredClone(record); }
  list(kind?: PluginExtensionKind): readonly PluginExtensionRecord[] { return [...this.records.values()].filter(value => !kind || value.kind === kind).map(value => structuredClone(value)); }
  listActive(): readonly PluginExtensionRecord[] { return this.list().filter(value => value.state === 'ACTIVE'); }
  setEnabled(handleOrId: string, enabled: boolean): PluginExtensionHandle { const record = this.require(handleOrId); if (record.state === 'REMOVED' || record.state === 'REVOKED' || record.state === 'STALE') fail('INVALID_STATE', 'Stale or revoked Plugin extension cannot be enabled'); if (enabled && record.state !== 'DISABLED') fail('INVALID_STATE', 'Only a disabled Plugin extension can be enabled'); const next = { ...record, state: enabled ? 'ACTIVE' as const : 'DISABLED' as const, updatedAt: new Date(this.now()).toISOString() }; this.records.set(record.id, next); return toHandle(next); }
  deactivatePrincipal(pluginId: string, revisionHash?: string, sandboxSessionId?: string, state: PluginExtensionLifecycleState = 'STALE'): void { for (const [id, record] of this.records) if (record.pluginId === pluginId && (!revisionHash || record.revisionHash === revisionHash) && (!sandboxSessionId || record.sandboxSessionId === sandboxSessionId) && !(state === 'DISABLED' && ['STALE', 'REVOKED', 'REMOVED'].includes(record.state))) this.records.set(id, { ...record, state, updatedAt: new Date(this.now()).toISOString() }); }
  remove(handleOrId: string): void { const record = this.require(handleOrId); this.records.set(record.id, { ...record, state: 'REMOVED', updatedAt: new Date(this.now()).toISOString() }); }
  async invoke<TInput, TOutput>(handleOrId: string, context: PluginExtensionContext, input: TInput, executor: (registration: PluginExtensionRecord, input: TInput, context: PluginExtensionContext) => Promise<TOutput> | TOutput): Promise<TOutput> { const record = this.require(handleOrId); if (record.state !== 'ACTIVE') fail('INVALID_STATE', 'Plugin extension is not active'); if (record.pluginId !== context.pluginId || record.revisionHash !== context.revision.packageHash || record.sandboxSessionId !== context.sandboxSessionId) fail('POLICY_DENIED', 'Stale or foreign Plugin extension handle'); for (const capability of record.requiredCapabilities ?? []) if (!context.grantedCapabilities.includes(capability)) fail('CAPABILITY_DENIED', `Extension capability is revoked: ${capability}`); const active = this.invocations.get(record.handleId) ?? 0; if (active >= this.quota.maxConcurrentInvocations) fail('QUOTA', 'Plugin extension concurrency quota exceeded'); this.invocations.set(record.handleId, active + 1); try { const output = await executor(structuredClone(record), structuredClone(input), context); this.records.set(record.id, { ...record, invocationCount: record.invocationCount + 1, updatedAt: new Date(this.now()).toISOString() }); return structuredClone(output); } finally { this.invocations.set(record.handleId, active); } }
  /** Durable metadata only. Executable callbacks are never part of this snapshot. */
  snapshot(): readonly PluginExtensionRecord[] { return [...this.records.values()].map(value => structuredClone(value)); }
  restore(records: readonly PluginExtensionRecord[]): void {
    this.records.clear(); this.invocations.clear();
    if (!Array.isArray(records) || records.length > this.quota.maxTotal) fail('QUOTA', 'Plugin extension snapshot exceeds quota');
    for (const record of records) {
      validateRegistration(record, this.quota, this.api);
      if (this.records.has(record.id)) fail('INVALID_ARGUMENT', 'Plugin extension snapshot contains duplicate IDs');
      if (!['ACTIVE', 'DISABLED', 'REVOKED', 'STALE', 'REMOVED'].includes(record.state)) fail('INVALID_ARGUMENT', 'Plugin extension snapshot contains invalid state');
      this.records.set(record.id, structuredClone({ ...record, state: record.state === 'ACTIVE' ? 'STALE' : record.state }));
      const match = /^pex:[^:]+:(\d+)$/.exec(record.handleId); if (match) this.sequence = Math.max(this.sequence, Number(match[1]));
    }
  }
  clear(): void { this.records.clear(); this.invocations.clear(); }
  private require(handleOrId: string): PluginExtensionRecord { const record = this.get(handleOrId); if (!record) throw new PluginPlatformError('NOT_FOUND', `Plugin extension not found: ${handleOrId}`); return record; }
}

export class PluginExtensionLifecycle {
  constructor(private readonly registry: PluginExtensionRegistry) {}
  onStarted(pluginId: string, revisionHash: string, sandboxSessionId: string): void {
    // A restart invalidates only older principals. The newly started session may
    // re-register after this call and must never be deactivated accidentally.
    for (const record of this.registry.list()) if (record.pluginId === pluginId && (record.revisionHash !== revisionHash || record.sandboxSessionId !== sandboxSessionId)) this.registry.deactivatePrincipal(pluginId, record.revisionHash, record.sandboxSessionId, 'STALE');
  }
  onStopped(pluginId: string, revisionHash?: string, sandboxSessionId?: string): void { this.registry.deactivatePrincipal(pluginId, revisionHash, sandboxSessionId, 'STALE'); }
  onDisabled(pluginId: string): void { this.registry.deactivatePrincipal(pluginId, undefined, undefined, 'DISABLED'); }
  onQuarantined(pluginId: string): void { this.registry.deactivatePrincipal(pluginId, undefined, undefined, 'REVOKED'); }
  onUninstalled(pluginId: string): void { this.registry.deactivatePrincipal(pluginId, undefined, undefined, 'REMOVED'); }
}

function validateRegistration(registration: PluginExtensionRegistration, quota: Required<PluginExtensionQuota>, api: PluginApiRegistry): void {
  if (!registration || !PLUGIN_EXTENSION_KINDS.includes(registration.kind) || typeof registration.pluginId !== 'string' || !/^[a-z0-9](?:[a-z0-9-]{0,62})(?:\.[a-z0-9](?:[a-z0-9-]{0,62}))*$/.test(registration.pluginId) || typeof registration.id !== 'string' || registration.id.length > 256) fail('INVALID_ARGUMENT', 'Plugin extension registration is invalid');
  const prefix = `plugin:${registration.pluginId}:`; if (!registration.id.startsWith(prefix) || registration.id.split(':').some(part => RESERVED.has(part))) fail('POLICY_DENIED', 'Plugin extension must use its own namespace');
  if (!/^[a-z][a-z0-9._-]{0,63}$/.test(registration.id.slice(prefix.length).split(':').at(-1) ?? '')) fail('INVALID_ARGUMENT', 'Plugin extension local ID is invalid');
  if (!/^[a-f0-9]{64}$/i.test(registration.revisionHash) || !registration.sandboxSessionId || registration.sandboxSessionId.length > 256) fail('POLICY_DENIED', 'Plugin extension revision/session binding is invalid');
  if (registration.label && registration.label.length > quota.maxLabelLength) fail('QUOTA', 'Plugin extension label is too long');
  let bytes = 0; try { bytes = new TextEncoder().encode(JSON.stringify(registration.payload)).byteLength; } catch { fail('INVALID_ARGUMENT', 'Plugin extension payload is not serializable'); }
  if (bytes > quota.maxPayloadBytes) fail('QUOTA', 'Plugin extension payload is too large');
  if (registration.compatibility && !api.negotiateExtension(registration.compatibility).compatible) fail('COMPATIBILITY', 'Plugin extension API compatibility is unsupported');
}
function validateFeature(feature: PluginFeatureVersion): void {
  if (!feature || !/^[-a-z0-9_.]+\.v\d+$/i.test(feature.feature) || !Number.isSafeInteger(feature.version) || feature.version < 1 || !['STABLE', 'EXPERIMENTAL', 'DEPRECATED'].includes(feature.stability) || typeof feature.available !== 'boolean') fail('INVALID_ARGUMENT', 'Plugin API feature is invalid');
}
function toHandle(record: PluginExtensionRecord): PluginExtensionHandle { return { handleId: record.handleId, id: record.id, kind: record.kind, pluginId: record.pluginId, revisionHash: record.revisionHash, sandboxSessionId: record.sandboxSessionId, state: record.state }; }

function fail(code: 'INVALID_ARGUMENT' | 'POLICY_DENIED' | 'CAPABILITY_DENIED' | 'QUOTA' | 'INVALID_STATE' | 'NOT_FOUND' | 'COMPATIBILITY', message: string): never { throw new PluginPlatformError(code, message); }
