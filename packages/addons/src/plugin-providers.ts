import type { PluginCapability, PluginRevision } from './plugin-types.js';
import { PluginPlatformError } from './plugin-platform.js';
import { PluginExtensionRegistry, type PluginExtensionContext, type PluginExtensionHandle, type PluginExtensionRegistration } from './plugin-api.js';
// Re-export the stable host context from the provider surface.  Event consumers
// import their public contracts from this module; keeping the type available
// here avoids exposing an implementation-only import path.
export type { PluginExtensionContext } from './plugin-api.js';

export type PluginPrivacyClass = 'PUBLIC' | 'USER_EXPLICIT' | 'PRIVATE' | 'SECRET';
export type PluginTrustClass = 'NATIVE_KEYSTONE' | 'PLUGIN_UNTRUSTED' | 'EXTERNAL_PROVIDER';
export type ProviderOperationClass = 'INTERACTIVE' | 'EVENTUAL' | 'BULK' | 'REALTIME' | 'BACKGROUND';
export type ProviderAvailability = 'AVAILABLE' | 'DEGRADED' | 'UNAVAILABLE' | 'OFFLINE' | 'DISABLED';

export interface PluginDataProvenance { readonly pluginId: string; readonly pluginRevision: string; readonly providerId?: string; readonly source?: string; readonly createdAt: string; readonly trust: PluginTrustClass; readonly integrity?: string; }
export interface ProviderHealth { readonly availability: ProviderAvailability; readonly checkedAt: string; readonly latencyClass?: 'UNKNOWN' | 'FAST' | 'MEDIUM' | 'SLOW'; readonly failure?: ProviderFailure; }
export interface ProviderFailure { readonly code: 'TIMEOUT' | 'OFFLINE' | 'INVALID_OUTPUT' | 'CRASHED' | 'DENIED' | 'UNSUPPORTED'; readonly message: string; readonly retryable: boolean; }
export interface ProviderMetadata { readonly providerId: string; readonly displayName: string; readonly source: 'KEYSTONE_NATIVE' | 'PLUGIN_PROVIDER' | 'EXTERNAL_PROVIDER'; readonly attributionLabel: string; readonly capabilities: readonly string[]; readonly privacyClass: 'LOCAL' | 'EXTERNAL' | 'HYBRID'; readonly health?: ProviderHealth; }
export interface ProviderScope { readonly privacy: PluginPrivacyClass; readonly objectIds?: readonly string[]; readonly communityIds?: readonly string[]; readonly calendarIds?: readonly string[]; readonly fileIds?: readonly string[]; readonly expiresAt?: string; }

export interface ToolInputSchema { readonly type: 'object'; readonly properties: Readonly<Record<string, { readonly type: 'string' | 'number' | 'boolean' | 'array' | 'object'; readonly maxLength?: number }>>; readonly required?: readonly string[]; readonly additionalProperties: false; }
export interface ToolOutputSchema extends ToolInputSchema { readonly maxBytes?: number; }
export interface ToolRiskMetadata { readonly risk: 'LOW' | 'MEDIUM' | 'HIGH' | 'DESTRUCTIVE'; readonly requiresConfirmation: boolean; readonly network?: boolean; }
export interface PluginToolDefinition { readonly id: string; readonly name: string; readonly description: string; readonly input: ToolInputSchema; readonly output: ToolOutputSchema; readonly risk: ToolRiskMetadata; readonly requiredCapabilities: readonly PluginCapability[]; readonly timeoutMs: number; }
export interface PluginToolInvocation { readonly toolId: string; readonly input: unknown; readonly requestId: string; readonly deadlineAt: string; readonly cancellation?: AbortSignal; }
export interface PluginToolResult { readonly ok: boolean; readonly value?: unknown; readonly error?: ProviderFailure; readonly trust: 'UNTRUSTED'; readonly provenance: PluginDataProvenance; }
export interface PluginToolPolicy { authorize(input: { readonly tool: PluginToolDefinition; readonly invocation: PluginToolInvocation; readonly context: PluginExtensionContext }): Promise<'ALLOW' | 'DENY' | 'CONFIRM'>; }
export interface PluginToolProvider { listTools(): readonly PluginToolDefinition[]; invoke(tool: PluginToolDefinition, invocation: PluginToolInvocation, context: PluginExtensionContext): Promise<PluginToolResult>; }

export interface PluginSkillDefinition { readonly id: string; readonly version: string; readonly packageHash: string; readonly displayName: string; readonly declaredCapabilities: readonly PluginCapability[]; readonly source: string; }
export interface PluginSkillProvider { listSkills(): readonly PluginSkillDefinition[]; requestInstall(skill: PluginSkillDefinition): Promise<{ readonly requiresReview: true; readonly accepted: false }>; }

export type PluginModelPrivacy = 'LOCAL' | 'EXTERNAL' | 'HYBRID';
export interface PluginModelMetadata { readonly modelId: string; readonly displayName: string; readonly contextWindow: number; readonly capabilities: readonly ('TEXT' | 'VISION' | 'TOOLS' | 'STREAMING')[]; readonly resourceEstimate: { readonly memoryBytes?: number; readonly vramBytes?: number; readonly loadMillis?: number }; readonly privacy: PluginModelPrivacy; }
export interface PluginInferenceRequest { readonly requestId: string; readonly modelId: string; readonly prompt: string; readonly privacy: PluginPrivacyClass; readonly stream: boolean; readonly maxOutputTokens: number; }
export interface PluginStreamingResult { readonly requestId: string; readonly chunks: AsyncIterable<string>; cancel(): Promise<void>; }
export interface PluginModelProvider { metadata(): ProviderMetadata; models(): readonly PluginModelMetadata[]; health(): Promise<ProviderHealth>; infer(request: PluginInferenceRequest, context: PluginExtensionContext): Promise<PluginStreamingResult>; }

/** Opaque provider credential operation. Secret bytes never cross this API. */
export interface PluginProviderSecretHandle { readonly id: string; readonly providerId: string; readonly state: 'ACTIVE' | 'REVOKED' | 'UNAVAILABLE'; }
export interface PluginProviderSecretHost { use<T>(handle: PluginProviderSecretHandle, operation: (opaqueCredential: unknown) => Promise<T> | T): Promise<T>; }

export interface PluginContextObject { readonly id: string; readonly text: string; readonly source: string; readonly privacy: PluginPrivacyClass; readonly scope: ProviderScope; readonly expiresAt?: string; readonly trust: 'UNTRUSTED'; readonly provenance: PluginDataProvenance; }
export interface PluginContextQuery { readonly query: string; readonly scope: ProviderScope; readonly limit: number; readonly cursor?: string; }
export interface PluginContextProvider { search(input: PluginContextQuery, context: PluginExtensionContext): Promise<{ readonly objects: readonly PluginContextObject[]; readonly nextCursor?: string }>; }

export interface PluginSearchQuery { readonly text: string; readonly scope: ProviderScope; readonly limit: number; readonly cursor?: string; }
export interface PluginSearchResult { readonly objectId: string; readonly type: string; readonly title: string; readonly preview?: string; readonly providerId: string; readonly attribution: string; readonly relevanceHint: number; readonly trust: 'UNTRUSTED'; readonly provenance: PluginDataProvenance; readonly externalLink?: string; }
export interface PluginSearchProvider { search(query: PluginSearchQuery, context: PluginExtensionContext): Promise<{ readonly results: readonly PluginSearchResult[]; readonly nextCursor?: string; readonly health: ProviderHealth }>; }

export type MediaProviderId = string;
export interface MediaCreatorReference { readonly id?: string; readonly name: string; readonly profileUrl?: string; }
export interface MediaAttribution { readonly providerId: MediaProviderId; readonly providerLabel: string; readonly creator?: MediaCreatorReference; readonly sourceUrl?: string; readonly native: false; }
export interface MediaMetadata { readonly id: string; readonly title: string; readonly description?: string; readonly creator?: MediaCreatorReference; readonly durationSeconds?: number; readonly thumbnailUrl?: string; readonly attribution: MediaAttribution; readonly provenance: PluginDataProvenance; }
export interface MediaPlaybackDescriptor { readonly kind: 'URL' | 'ADAPTER' | 'KEYSTONE_REFERENCE'; readonly uri?: string; readonly adapterId?: string; readonly expiresAt?: string; readonly requiresRealtime?: boolean; }
export interface ExternalMediaObject { readonly metadata: MediaMetadata; readonly playback: MediaPlaybackDescriptor; readonly availability: ProviderAvailability; }
export interface PluginMediaQuery { readonly text?: string; readonly creatorId?: string; readonly limit: number; readonly cursor?: string; readonly scope: ProviderScope; }
export interface PluginMediaProvider { metadata(): ProviderMetadata; search(query: PluginMediaQuery, context: PluginExtensionContext): Promise<{ readonly items: readonly ExternalMediaObject[]; readonly nextCursor?: string; readonly health: ProviderHealth }>; get(id: string, context: PluginExtensionContext): Promise<ExternalMediaObject | undefined>; }
export type PluginVideoProvider = PluginMediaProvider;
export type PluginMusicProvider = PluginMediaProvider;
export type PluginLiveProvider = PluginMediaProvider;

export interface ContentSourcePreference { readonly mediaKind: 'VIDEO' | 'MUSIC' | 'LIVE' | 'SEARCH'; readonly enabled: boolean; readonly priorityHint: number; readonly ownerSelected: boolean; }
export interface MediaAggregationResult { readonly items: readonly ExternalMediaObject[]; readonly providers: readonly ProviderHealth[]; readonly partial: boolean; }

export interface PluginMediaSourceSelection { readonly providerId: string; readonly mediaKind: ContentSourcePreference['mediaKind']; readonly enabled: boolean; readonly ownerSelected: boolean; readonly updatedAt: string; }
export class PluginMediaSourceRegistry {
  private readonly selections = new Map<string, PluginMediaSourceSelection>();
  set(input: PluginMediaSourceSelection): void {
    if (!input.providerId || !['VIDEO', 'MUSIC', 'LIVE', 'SEARCH'].includes(input.mediaKind) || !input.ownerSelected) throw new PluginPlatformError('POLICY_DENIED', 'Media source requires explicit owner selection');
    this.selections.set(`${input.mediaKind}:${input.providerId}`, structuredClone(input));
  }
  isEnabled(mediaKind: ContentSourcePreference['mediaKind'], providerId: string): boolean { return this.selections.get(`${mediaKind}:${providerId}`)?.enabled === true; }
  list(mediaKind?: ContentSourcePreference['mediaKind']): readonly PluginMediaSourceSelection[] { return [...this.selections.values()].filter(value => !mediaKind || value.mediaKind === mediaKind).map(value => structuredClone(value)); }
}

export interface PluginCalendarEvent { readonly id: string; readonly title: string; readonly start: string; readonly end: string; readonly calendarId: string; readonly privacy: PluginPrivacyClass; readonly provenance: PluginDataProvenance; }
export interface PluginCalendarProvider { list(input: { readonly calendarIds: readonly string[]; readonly from: string; readonly to: string; readonly limit: number }, context: PluginExtensionContext): Promise<{ readonly events: readonly PluginCalendarEvent[]; readonly health: ProviderHealth }>; }
export interface PluginFileHandle { readonly id: string; readonly mimeType: string; readonly size: number; readonly state: 'ELIGIBLE' | 'QUARANTINED' | 'UNAVAILABLE'; readonly contentId: string; }
export interface PluginFileHandlerProvider { supports(mimeType: string): boolean; inspect(file: PluginFileHandle, context: PluginExtensionContext): Promise<{ readonly metadata: Readonly<Record<string, string | number | boolean>>; readonly trust: 'UNTRUSTED'; }>; }
export interface TypedRenderableObject { readonly type: string; readonly id: string; readonly version: number; readonly data: Readonly<Record<string, unknown>>; readonly provenance: PluginDataProvenance; }
export interface PluginObjectRendererProvider { readonly objectType: string; render(object: TypedRenderableObject, context: PluginExtensionContext): Promise<PluginDeclarativeView>; }
export interface PluginAgentCapabilityProvider { readonly capabilityId: string; invoke(input: { readonly requestId: string; readonly payload: unknown; readonly scope: ProviderScope }, context: PluginExtensionContext): Promise<{ readonly trust: 'UNTRUSTED'; readonly value: unknown; readonly provenance: PluginDataProvenance }>; }

/** Stable names for the declarative extension families exposed by the API. */
export interface PluginUiExtensionProvider { list(): readonly (ActivityBarContribution | CommandContribution | ContextMenuContribution | SidebarContribution | SettingsContribution | ObjectActionContribution | StatusContribution | PluginViewDescriptor)[]; }
export type PluginCommandProvider = Pick<PluginUiExtensionProvider, 'list'>;
export type PluginSettingsExtensionProvider = Pick<PluginUiExtensionProvider, 'list'>;
export interface PluginNotificationProvider { notify(input: { readonly title: string; readonly body?: string; readonly objectId?: string; readonly category?: string }, context: PluginExtensionContext): Promise<{ readonly accepted: boolean; readonly provenance: PluginDataProvenance }>; }

export interface PluginDeclarativeView { readonly kind: 'TEXT' | 'LIST' | 'METRIC' | 'ACTION' | 'LINK' | 'VIEW'; readonly title: string; readonly text?: string; readonly items?: readonly string[]; readonly commandId?: string; readonly externalLink?: string; }
export interface ActivityBarContribution { readonly id: string; readonly label: string; readonly iconReference: string; readonly commandId: string; }
export interface CommandContribution { readonly id: string; readonly label: string; readonly description?: string; readonly keywords?: readonly string[]; }
export interface ContextMenuContribution { readonly id: string; readonly label: string; readonly targetTypes: readonly string[]; readonly commandId: string; }
export interface SidebarContribution { readonly id: string; readonly title: string; readonly iconReference?: string; readonly viewId: string; }
export interface SettingsContribution { readonly namespace: string; readonly schema: Readonly<Record<string, { readonly type: 'boolean' | 'string' | 'number' | 'enum' | 'fileHandle' | 'secretHandle'; readonly default?: unknown; readonly values?: readonly string[] }>>; }
export interface ObjectActionContribution { readonly id: string; readonly label: string; readonly targetTypes: readonly string[]; readonly commandId: string; }
export interface StatusContribution { readonly id: string; readonly label: string; readonly view: PluginDeclarativeView; }
export interface PluginViewDescriptor { readonly id: string; readonly title: string; readonly isolation: 'DECLARATIVE' | 'ISOLATED_RUNTIME'; readonly providerLabel: string; readonly restoreKey?: string; }

export const PLUGIN_EVENTS = ['object.created', 'object.updated', 'selection.changed', 'workspace.changed', 'connectivity.changed', 'plugin.lifecycle', 'media.playback.metadata'] as const;
export type PluginEventType = (typeof PLUGIN_EVENTS)[number];
export interface PluginEvent { readonly type: PluginEventType; readonly sequence: number; readonly revision: string; readonly createdAt: string; readonly payload: Readonly<Record<string, unknown>>; readonly redacted: true; readonly provenance: PluginDataProvenance; }
export interface PluginEventSubscriptionHandle { readonly id: string; readonly pluginId: string; readonly sessionId: string; readonly event: PluginEventType; readonly scope?: string; readonly cursor?: number; readonly active: boolean; }

export type ConnectivityState = 'OFFLINE' | 'DEVICE_ONLY' | 'NEARBY' | 'NEARBY_MESH' | 'LOCAL_NETWORK' | 'RESTRICTED_NETWORK' | 'GLOBAL_NETWORK';
export interface PluginConnectivitySnapshot { readonly state: ConnectivityState; readonly quality: 'UNKNOWN' | 'POOR' | 'FAIR' | 'GOOD'; readonly latencyClass: 'UNKNOWN' | 'LOW' | 'MEDIUM' | 'HIGH'; readonly bandwidthClass: 'UNKNOWN' | 'LOW' | 'MEDIUM' | 'HIGH'; readonly realtime: boolean; readonly bulk: boolean; readonly eventual: boolean; }
export interface PluginConnectivityApi { snapshot(): Promise<PluginConnectivitySnapshot>; delivery(operation: ProviderOperationClass): Promise<'AVAILABLE' | 'WAITING_FOR_CONNECTIVITY' | 'NETWORK_UNAVAILABLE' | 'QUEUED'>; }

export interface PluginExtensionSurfaceApi { readonly registry: PluginExtensionRegistry; readonly context: PluginExtensionContext; register<T>(registration: PluginExtensionRegistration<T>): PluginExtensionHandle; }
export class PluginExtensionSurfaceApiImpl implements PluginExtensionSurfaceApi { constructor(readonly registry: PluginExtensionRegistry, readonly context: PluginExtensionContext) {} register<T>(registration: PluginExtensionRegistration<T>): PluginExtensionHandle { return this.registry.register({ ...registration, pluginId: this.context.pluginId, revisionHash: this.context.revision.packageHash, sandboxSessionId: this.context.sandboxSessionId }, this.context); } }

export function createProvenance(context: PluginExtensionContext, input: { readonly providerId?: string; readonly source?: string; readonly trust?: PluginTrustClass } = {}): PluginDataProvenance { return { pluginId: context.pluginId, pluginRevision: context.revision.packageHash, ...(input.providerId ? { providerId: input.providerId } : {}), ...(input.source ? { source: input.source } : {}), createdAt: new Date().toISOString(), trust: input.trust ?? 'PLUGIN_UNTRUSTED' }; }

/** Bounded, source-preserving aggregation owned by Keystone rather than providers. */
export async function aggregateMediaProviders(providers: readonly { readonly id: string; readonly provider: PluginMediaProvider; readonly enabled: boolean; readonly timeoutMs?: number }[], query: PluginMediaQuery, context: PluginExtensionContext, limit = 100): Promise<MediaAggregationResult> {
  const pageSize = boundedProviderLimit(query.limit); const max = boundedProviderLimit(limit); const health: ProviderHealth[] = []; const results: ExternalMediaObject[] = [];
  if ((query.scope.privacy === 'PRIVATE' || query.scope.privacy === 'SECRET') && !hasPrivateRead(context)) return { items: [], providers: [{ availability: 'DISABLED', checkedAt: new Date().toISOString(), failure: { code: 'DENIED', message: 'Private media scope is not granted to the provider', retryable: false } }], partial: true };
  await Promise.all(providers.filter(value => value.enabled).map(async entry => { const timeout = Math.min(Math.max(entry.timeoutMs ?? 2_000, 1), 120_000); try { const metadata = entry.provider.metadata(); if (!metadata.providerId || metadata.source === 'KEYSTONE_NATIVE') throw new Error('Plugin media provider cannot impersonate Keystone-native source'); const output = await Promise.race([entry.provider.search({ ...query, limit: pageSize }, context), new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), timeout))]); health.push(output.health); for (const item of validateProviderPage(output.items, pageSize)) { const attribution = item.metadata?.attribution; if (!attribution || attribution.native !== false || attribution.providerId !== entry.id && attribution.providerId !== metadata.providerId || item.metadata.provenance.trust === 'NATIVE_KEYSTONE' || item.metadata.provenance.providerId && item.metadata.provenance.providerId !== attribution.providerId) continue; if (attribution.sourceUrl && !/^https:\/\//i.test(attribution.sourceUrl)) continue; results.push(structuredClone(item)); } } catch (error) { health.push({ availability: 'DEGRADED', checkedAt: new Date().toISOString(), failure: { code: 'TIMEOUT', message: error instanceof Error ? error.message : 'provider failure', retryable: true } }); } }));
  const unique = new Map<string, ExternalMediaObject>(); for (const item of results) if (!unique.has(`${item.metadata.attribution.providerId}:${item.metadata.id}`)) unique.set(`${item.metadata.attribution.providerId}:${item.metadata.id}`, item);
  return { items: [...unique.values()].slice(0, max), providers: health, partial: health.some(value => value.availability !== 'AVAILABLE') };
}

export function validateProviderPage<T>(items: readonly T[], limit: number, maxBytes = 512 * 1024): readonly T[] { if (!Number.isSafeInteger(limit) || limit < 1) throw new PluginPlatformError('INVALID_ARGUMENT', 'Provider page size is invalid'); const pageLimit = Math.min(limit, 100); if (items.length > pageLimit) throw new PluginPlatformError('QUOTA', 'Provider returned more items than the bounded page'); let bytes = 0; try { bytes = new TextEncoder().encode(JSON.stringify(items)).byteLength; } catch { throw new PluginPlatformError('INVALID_ARGUMENT', 'Provider output is not serializable'); } if (bytes > maxBytes) throw new PluginPlatformError('QUOTA', 'Provider output exceeds bounded size'); return structuredClone(items); }
function boundedProviderLimit(value: number): number { if (!Number.isSafeInteger(value) || value < 1) throw new PluginPlatformError('INVALID_ARGUMENT', 'Provider page size is invalid'); return Math.min(value, 100); }
function hasPrivateRead(context: PluginExtensionContext): boolean { return context.grantedCapabilities.some(value => value === 'messages.read' || value === 'files.read' || value === 'vault.read' || value === 'calendar.read'); }
