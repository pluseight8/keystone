/**
 * Host-owned execution helpers for R0P63 extension surfaces.
 *
 * The provider objects in this module are executable and therefore are never
 * persisted.  Only bounded registration metadata may be persisted by a host.
 * Every operation is re-authorized against the plugin/revision/session that
 * registered it; a provider is not an authority and its output is untrusted.
 */
import { PluginPlatformError } from './plugin-platform.js';
import {
  PLUGIN_EXTENSION_KINDS,
  type PluginExtensionContext,
  type PluginExtensionKind,
  type PluginExtensionLifecycleState,
} from './plugin-api.js';
import type {
  PluginCapability,
  PluginRevision,
} from './plugin-types.js';
import type {
  PluginAgentCapabilityProvider,
  PluginCalendarProvider,
  PluginContextObject,
  PluginContextProvider,
  PluginContextQuery,
  PluginDataProvenance,
  PluginFileHandle,
  PluginFileHandlerProvider,
  PluginInferenceRequest,
  PluginMediaProvider,
  PluginModelProvider,
  PluginObjectRendererProvider,
  PluginSearchProvider,
  PluginSearchQuery,
  PluginSearchResult,
  PluginSkillDefinition,
  PluginSkillProvider,
  PluginStreamingResult,
  PluginToolDefinition,
  PluginToolInvocation,
  PluginToolPolicy,
  PluginToolProvider,
  ProviderFailure,
  ProviderHealth,
} from './plugin-providers.js';
import { validateProviderPage } from './plugin-providers.js';

export type ExecutablePluginProvider =
  | PluginToolProvider
  | PluginSkillProvider
  | PluginModelProvider
  | PluginContextProvider
  | PluginSearchProvider
  | PluginMediaProvider
  | PluginCalendarProvider
  | PluginFileHandlerProvider
  | PluginObjectRendererProvider
  | PluginAgentCapabilityProvider;

export interface PluginProviderContext extends PluginExtensionContext {
  readonly providerId: string;
  readonly kind: PluginExtensionKind;
}

export interface PluginProviderRegistrationRecord {
  readonly id: string;
  readonly qualifiedId: string;
  readonly kind: PluginExtensionKind;
  readonly pluginId: string;
  readonly revisionHash: string;
  readonly sandboxSessionId: string;
  readonly requiredCapabilities: readonly PluginCapability[];
  readonly state: PluginExtensionLifecycleState;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly provider: ExecutablePluginProvider;
}

export interface PluginProviderRegistryOptions {
  readonly now?: () => number;
  readonly maxProviders?: number;
  readonly maxPerPlugin?: number;
}

/**
 * Registry for executable providers.  It deliberately has no persistence
 * method for provider functions.  A restart must re-register through the
 * sandbox lifecycle.
 */
export class PluginProviderRegistry {
  private readonly records = new Map<string, PluginProviderRegistrationRecord>();
  private readonly now: () => number;
  private readonly maxProviders: number;
  private readonly maxPerPlugin: number;

  constructor(options: PluginProviderRegistryOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.maxProviders = Math.min(Math.max(options.maxProviders ?? 256, 1), 1024);
    this.maxPerPlugin = Math.min(Math.max(options.maxPerPlugin ?? 64, 1), this.maxProviders);
  }

  register(input: {
    readonly id: string;
    readonly kind: PluginExtensionKind;
    readonly provider: ExecutablePluginProvider;
    readonly context: PluginProviderContext;
    readonly requiredCapabilities?: readonly PluginCapability[];
  }): Omit<PluginProviderRegistrationRecord, 'provider'> {
    if (!PLUGIN_EXTENSION_KINDS.includes(input.kind)) fail('INVALID_ARGUMENT', 'Unsupported Plugin provider kind');
    if (!input.provider || typeof input.provider !== 'object') fail('INVALID_ARGUMENT', 'Provider implementation is invalid');
    assertProviderShape(input.kind, input.provider);
    if (input.context.kind !== input.kind || input.context.providerId !== input.id) fail('POLICY_DENIED', 'Provider context does not match registration');
    if (!input.context.pluginId || !input.context.ownerIdentity || !input.context.sandboxSessionId || !/^[a-f0-9]{64}$/i.test(input.context.revision.packageHash)) fail('POLICY_DENIED', 'Provider context is invalid');
    const required = [...new Set(input.requiredCapabilities ?? [])];
    for (const capability of required) if (!input.context.grantedCapabilities.includes(capability)) fail('CAPABILITY_DENIED', `Provider capability is not granted: ${capability}`);
    const qualifiedId = qualifyProviderId(input.context.pluginId, input.id);
    if (this.records.has(qualifiedId)) fail('INVALID_ARGUMENT', `Provider already registered: ${qualifiedId}`);
    if (this.records.size >= this.maxProviders || [...this.records.values()].filter(value => value.pluginId === input.context.pluginId).length >= this.maxPerPlugin) fail('QUOTA', 'Provider registration quota exceeded');
    const now = new Date(this.now()).toISOString();
    const record: PluginProviderRegistrationRecord = {
      id: input.id,
      qualifiedId,
      kind: input.kind,
      pluginId: input.context.pluginId,
      revisionHash: input.context.revision.packageHash,
      sandboxSessionId: input.context.sandboxSessionId,
      requiredCapabilities: required,
      state: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
      provider: input.provider,
    };
    this.records.set(qualifiedId, record);
    return publicMetadata(record);
  }

  /** Public metadata lookup never returns the executable provider object. */
  get(id: string): Omit<PluginProviderRegistrationRecord, 'provider'> | undefined {
    const value = this.records.get(this.resolveId(id));
    return value ? publicMetadata(value) : undefined;
  }

  /** Returns metadata only; executable providers are intentionally omitted. */
  list(kind?: PluginExtensionKind): readonly Omit<PluginProviderRegistrationRecord, 'provider'>[] {
    return [...this.records.values()]
      .filter(value => !kind || value.kind === kind)
      .map(value => publicMetadata(value));
  }

  /** Run a bounded operation against all active providers of one kind. A
   * provider crash/timeout becomes a typed failure and never aborts siblings. */
  async fanOut<T>(kind: PluginExtensionKind, context: PluginProviderContext, operation: (provider: ExecutablePluginProvider, metadata: Omit<PluginProviderRegistrationRecord, 'provider'>) => Promise<T> | T, options: { readonly timeoutMs?: number; readonly max?: number } = {}): Promise<readonly { readonly provider: Omit<PluginProviderRegistrationRecord, 'provider'>; readonly value?: T; readonly error?: ProviderFailure }[]> {
    const records = this.list(kind).filter(record => record.state === 'ACTIVE').slice(0, Math.min(Math.max(options.max ?? 32, 1), 64));
    return Promise.all(records.map(async metadata => {
      try {
        const value = await withTimeout(this.invoke(metadata.qualifiedId, context, provider => operation(provider, metadata)), options.timeoutMs ?? 2_000);
        return { provider: metadata, value };
      } catch (error) {
        const timeout = error instanceof PluginPlatformError && error.code === 'TIMEOUT';
        return { provider: metadata, error: { code: timeout ? 'TIMEOUT' : 'CRASHED', message: error instanceof Error ? error.message.slice(0, 256) : 'Provider failed', retryable: true } satisfies ProviderFailure };
      }
    }));
  }

  provider(id: string): ExecutablePluginProvider | undefined { return this.records.get(this.resolveId(id))?.provider; }

  async invoke<T>(id: string, context: PluginProviderContext, operation: (provider: ExecutablePluginProvider) => Promise<T> | T): Promise<T> {
    const value = this.records.get(this.resolveId(id));
    if (!value) fail('NOT_FOUND', `Provider not found: ${id}`);
    if (value.state !== 'ACTIVE') fail('INVALID_STATE', 'Plugin provider is not active');
    if (value.pluginId !== context.pluginId || value.revisionHash !== context.revision.packageHash || value.sandboxSessionId !== context.sandboxSessionId) fail('POLICY_DENIED', 'Stale or foreign provider session');
    for (const capability of value.requiredCapabilities) if (!context.grantedCapabilities.includes(capability)) fail('CAPABILITY_DENIED', `Provider capability is revoked: ${capability}`);
    const output = await operation(value.provider);
    if (byteSize(output) > 512 * 1024) fail('QUOTA', 'Plugin provider output exceeds bounded size');
    try { return structuredClone(output); } catch { fail('INVALID_OUTPUT', 'Plugin provider output is not serializable'); }
  }

  setEnabled(id: string, enabled: boolean): void {
    const value = this.require(id);
    if (value.state === 'REMOVED' || value.state === 'REVOKED') fail('INVALID_STATE', 'Provider cannot be enabled after removal/revocation');
    this.records.set(value.qualifiedId, { ...value, state: enabled ? 'ACTIVE' : 'DISABLED', updatedAt: new Date(this.now()).toISOString() });
  }

  deactivatePrincipal(pluginId: string, revisionHash?: string, sandboxSessionId?: string, state: PluginExtensionLifecycleState = 'STALE'): void {
    for (const [id, value] of this.records) {
      if (value.pluginId === pluginId && (!revisionHash || value.revisionHash === revisionHash) && (!sandboxSessionId || value.sandboxSessionId === sandboxSessionId)) {
        this.records.set(id, { ...value, state, updatedAt: new Date(this.now()).toISOString() });
      }
    }
  }

  removePrincipal(pluginId: string): void { this.deactivatePrincipal(pluginId, undefined, undefined, 'REMOVED'); }
  clear(): void { this.records.clear(); }

  private resolveId(id: string): string {
    if (this.records.has(id)) return id;
    return [...this.records.values()].find(value => value.id === id)?.qualifiedId ?? id;
  }

  private require(id: string): PluginProviderRegistrationRecord {
    const value = this.records.get(this.resolveId(id));
    if (!value) fail('NOT_FOUND', `Provider not found: ${id}`);
    return value;
  }
}

function publicMetadata(value: PluginProviderRegistrationRecord): Omit<PluginProviderRegistrationRecord, 'provider'> {
  return {
    id: value.id,
    qualifiedId: value.qualifiedId,
    kind: value.kind,
    pluginId: value.pluginId,
    revisionHash: value.revisionHash,
    sandboxSessionId: value.sandboxSessionId,
    requiredCapabilities: [...value.requiredCapabilities],
    state: value.state,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function qualifyProviderId(pluginId: string, id: string): string {
  const qualified = id.startsWith(`plugin:${pluginId}:`) ? id : `plugin:${pluginId}:provider:${id}`;
  if (!/^plugin:[a-z0-9](?:[a-z0-9-]{0,62})(?:\.[a-z0-9](?:[a-z0-9-]{0,62}))*:provider:[a-z][a-z0-9._-]{0,63}$/.test(qualified)) fail('INVALID_ARGUMENT', 'Provider id must be namespaced to its Plugin');
  if (/(^|:)(core|security|identity|protocol|safety|secret|owner-authority)(:|$)/.test(qualified)) fail('POLICY_DENIED', 'Provider namespace is reserved');
  return qualified;
}

export interface PluginToolExecutionOptions {
  readonly policy?: PluginToolPolicy;
  readonly now?: () => number;
  readonly maxOutputBytes?: number;
  readonly onCancel?: (invocation: PluginToolInvocation) => Promise<void> | void;
}

/** Typed ToolProvider flow: validate → policy → sandbox provider → validate output. */
export async function executePluginTool(
  provider: PluginToolProvider,
  toolId: string,
  invocation: PluginToolInvocation,
  context: PluginExtensionContext,
  options: PluginToolExecutionOptions = {},
): Promise<import('./plugin-providers.js').PluginToolResult> {
  const tool = provider.listTools().find(value => value.id === toolId);
  if (!tool) fail('NOT_FOUND', `Plugin tool not found: ${toolId}`);
  if (invocation.toolId !== toolId) fail('INVALID_ARGUMENT', 'Plugin Tool invocation id does not match the selected tool');
  validateToolDefinition(tool);
  validateSchemaValue(tool.input, invocation.input, '$input');
  if (invocation.cancellation?.aborted) { await options.onCancel?.(invocation); fail('CANCELLED', 'Plugin tool invocation was cancelled'); }
  const decision = options.policy ? await options.policy.authorize({ tool, invocation, context }) : 'DENY';
  if (decision === 'DENY') fail('POLICY_DENIED', 'Plugin ToolPolicy denied invocation');
  if (decision === 'CONFIRM') fail('REVIEW_REQUIRED', 'Plugin tool invocation requires owner confirmation');
  const now = options.now ?? (() => Date.now());
  const deadline = Date.parse(invocation.deadlineAt);
  const timeout = Math.max(1, Math.min(tool.timeoutMs, Number.isFinite(deadline) ? deadline - now() : tool.timeoutMs));
  if (timeout <= 0) fail('TIMEOUT', 'Plugin tool deadline has expired');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      provider.invoke(tool, invocation, context),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new PluginPlatformError('TIMEOUT', 'Plugin tool timed out')), timeout); }),
    ]);
    if (!result || result.trust !== 'UNTRUSTED' || !result.provenance) fail('INVALID_OUTPUT', 'Plugin Tool output must remain untrusted and attributable');
    if (result.value !== undefined) validateSchemaValue(tool.output, result.value, '$output');
    const bytes = byteSize(result.value);
    const max = Math.min(options.maxOutputBytes ?? 512 * 1024, tool.output.maxBytes ?? 512 * 1024);
    if (bytes > max) fail('QUOTA', 'Plugin Tool output exceeds bounded size');
    return structuredClone(result);
  } catch (error) {
    if (invocation.cancellation?.aborted || error instanceof PluginPlatformError && error.code === 'TIMEOUT') {
      await options.onCancel?.(invocation);
      if (invocation.cancellation?.aborted) fail('CANCELLED', 'Plugin tool invocation was cancelled');
    }
    throw error;
  } finally { if (timer) clearTimeout(timer); }
}

function validateToolDefinition(tool: PluginToolDefinition): void {
  if (!/^[a-z][a-z0-9._:-]{0,127}$/.test(tool.id) || !tool.name || tool.name.length > 120 || tool.description.length > 4_000) fail('INVALID_ARGUMENT', 'Plugin Tool definition is invalid');
  if (!Number.isSafeInteger(tool.timeoutMs) || tool.timeoutMs < 1 || tool.timeoutMs > 120_000) fail('INVALID_ARGUMENT', 'Plugin Tool timeout is invalid');
  if (tool.risk.requiresConfirmation && tool.risk.risk === 'LOW') fail('INVALID_ARGUMENT', 'Low-risk Plugin Tool cannot require an inconsistent confirmation declaration');
}

function validateSchemaValue(schema: { readonly type: string; readonly properties?: Readonly<Record<string, { readonly type: string; readonly maxLength?: number }>>; readonly required?: readonly string[]; readonly additionalProperties?: boolean }, value: unknown, path: string): void {
  if (schema.type !== 'object' || !value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_ARGUMENT', `Plugin schema mismatch at ${path}`);
  const object = value as Record<string, unknown>;
  const properties = schema.properties ?? {};
  if (schema.additionalProperties === false && Object.keys(object).some(key => !(key in properties))) fail('INVALID_ARGUMENT', `Unknown Plugin schema property at ${path}`);
  for (const key of schema.required ?? []) if (!(key in object)) fail('INVALID_ARGUMENT', `Missing Plugin schema property at ${path}.${key}`);
  for (const [key, rule] of Object.entries(properties)) {
    if (!(key in object)) continue;
    const item = object[key];
    if (rule.type === 'string' && (typeof item !== 'string' || rule.maxLength !== undefined && item.length > rule.maxLength)) fail('INVALID_ARGUMENT', `Plugin schema mismatch at ${path}.${key}`);
    if (rule.type === 'number' && (typeof item !== 'number' || !Number.isFinite(item))) fail('INVALID_ARGUMENT', `Plugin schema mismatch at ${path}.${key}`);
    if (rule.type === 'boolean' && typeof item !== 'boolean') fail('INVALID_ARGUMENT', `Plugin schema mismatch at ${path}.${key}`);
    if (rule.type === 'array' && !Array.isArray(item)) fail('INVALID_ARGUMENT', `Plugin schema mismatch at ${path}.${key}`);
    if (rule.type === 'object' && (!item || typeof item !== 'object' || Array.isArray(item))) fail('INVALID_ARGUMENT', `Plugin schema mismatch at ${path}.${key}`);
  }
}

function byteSize(value: unknown): number { try { return new TextEncoder().encode(JSON.stringify(value)).byteLength; } catch { return Number.MAX_SAFE_INTEGER; } }

export interface PluginContextPolicy {
  readonly allowPrivate?: boolean;
  readonly allowSecret?: boolean;
  readonly maxItems?: number;
  readonly maxTextBytes?: number;
}

/** Filters context before a provider sees it and strips policy-looking fields. */
export function filterPluginContext(objects: readonly PluginContextObject[], context: PluginExtensionContext, policy: PluginContextPolicy = {}): readonly PluginContextObject[] {
  const max = Math.min(Math.max(policy.maxItems ?? 50, 1), 100);
  const result: PluginContextObject[] = [];
  for (const object of objects.slice(0, max)) {
    if (!object || object.trust !== 'UNTRUSTED' || !object.provenance || !object.id || !object.source) continue;
    if (object.privacy === 'SECRET' && !policy.allowSecret) continue;
    if (object.privacy === 'PRIVATE' && !policy.allowPrivate) continue;
    if ((object.privacy === 'PRIVATE' || object.privacy === 'SECRET') && !context.grantedCapabilities.some(value => value === 'vault.read' || value === 'messages.read' || value === 'files.read' || value === 'calendar.read')) continue;
    const text = object.text.slice(0, 32_000);
    if (new TextEncoder().encode(text).byteLength > (policy.maxTextBytes ?? 256 * 1024)) continue;
    result.push({ ...structuredClone(object), text });
  }
  return result;
}

export interface PluginContextQueryOptions extends PluginContextPolicy { readonly timeoutMs?: number; }
export async function queryPluginContext(provider: PluginContextProvider, query: PluginContextQuery, context: PluginExtensionContext, options: PluginContextQueryOptions = {}): Promise<{ readonly objects: readonly PluginContextObject[]; readonly nextCursor?: string }> {
  const limit = boundedLimit(query.limit);
  const output = await withTimeout(provider.search({ ...query, limit }, context), options.timeoutMs ?? 2_000);
  return { objects: filterPluginContext(output.objects, context, { ...options, maxItems: limit }), ...(output.nextCursor ? { nextCursor: output.nextCursor.slice(0, 256) } : {}) };
}

export interface PluginSearchAggregationOptions {
  readonly timeoutMs?: number;
  readonly maxResults?: number;
  readonly safety?: (result: PluginSearchResult) => boolean | Promise<boolean>;
}
export async function aggregateSearchProviders(
  providers: readonly { readonly id: string; readonly provider: PluginSearchProvider; readonly enabled?: boolean; readonly timeoutMs?: number }[],
  query: PluginSearchQuery,
  context: PluginExtensionContext,
  options: PluginSearchAggregationOptions = {},
): Promise<{ readonly results: readonly PluginSearchResult[]; readonly providers: readonly ProviderHealth[]; readonly partial: boolean }> {
  const max = Math.min(Math.max(options.maxResults ?? 100, 1), 100);
  const health: ProviderHealth[] = [];
  const all: PluginSearchResult[] = [];
  await Promise.all((providers ?? []).filter(entry => entry.enabled !== false).map(async entry => {
    try {
      const output = await withTimeout(entry.provider.search({ ...query, limit: boundedLimit(query.limit) }, context), entry.timeoutMs ?? options.timeoutMs ?? 2_000);
      health.push(output.health);
      const page = validateProviderPage(output.results, boundedLimit(query.limit));
      for (const result of page) {
        if (result.providerId !== entry.id && result.providerId !== `plugin:${context.pluginId}:provider:${entry.id}`) continue;
        if (!Number.isFinite(result.relevanceHint) || result.relevanceHint < 0 || result.relevanceHint > 1) continue;
        if (result.trust !== 'UNTRUSTED' || !result.provenance || !result.objectId || result.title.length > 512) continue;
        if (result.externalLink && !/^https:\/\//i.test(result.externalLink)) continue;
        if (options.safety && !(await options.safety(result))) continue;
        all.push({ ...structuredClone(result), relevanceHint: Math.max(0, Math.min(1, result.relevanceHint)) });
      }
    } catch (error) {
      health.push(providerFailureHealth(error));
    }
  }));
  const unique = new Map<string, PluginSearchResult>();
  for (const result of all) { const key = `${result.providerId}:${result.objectId}`; if (!unique.has(key)) unique.set(key, result); }
  return { results: [...unique.values()].sort((a, b) => b.relevanceHint - a.relevanceHint).slice(0, max), providers: health, partial: health.some(value => value.availability !== 'AVAILABLE') };
}

export interface PluginModelRouterOptions {
  readonly egressFirewall?: (request: PluginInferenceRequest, metadata: { readonly privacy: string; readonly providerId: string }) => boolean | PluginInferenceRequest | Promise<boolean | PluginInferenceRequest>;
  readonly schedule?: <T>(job: () => Promise<T>, input: { readonly providerId: string; readonly requestId: string; readonly priority: 'USER_INTERACTIVE' | 'ACTIVE_AGENT' | 'BACKGROUND' }) => Promise<T>;
}

/** Model providers are arbitrary compute, never authority or a privacy bypass. */
export class PluginModelRouter {
  constructor(private readonly options: PluginModelRouterOptions = {}) {}
  async infer(provider: PluginModelProvider, request: PluginInferenceRequest, context: PluginExtensionContext): Promise<PluginStreamingResult> {
    if (!request.requestId || request.prompt.length > 128 * 1024 || !Number.isSafeInteger(request.maxOutputTokens) || request.maxOutputTokens < 1 || request.maxOutputTokens > 16_384) fail('INVALID_ARGUMENT', 'Inference request is invalid');
    const metadata = provider.metadata();
    const model = provider.models().find(value => value.modelId === request.modelId);
    if (!model) fail('NOT_FOUND', `Plugin model is not available: ${request.modelId}`);
    let safeRequest = structuredClone(request);
    if (metadata.privacyClass === 'EXTERNAL' || model.privacy === 'EXTERNAL' || model.privacy === 'HYBRID') {
      if (!this.options.egressFirewall) fail('POLICY_DENIED', 'External Plugin ModelProvider requires the AIEgressFirewall');
      const decision = await this.options.egressFirewall(safeRequest, { privacy: model.privacy, providerId: metadata.providerId });
      if (decision === false) fail('POLICY_DENIED', 'AIEgressFirewall denied Plugin ModelProvider request');
      if (decision !== true) safeRequest = structuredClone(decision);
    }
    const run = () => provider.infer(safeRequest, context);
    const result = this.options.schedule ? await this.options.schedule(run, { providerId: metadata.providerId, requestId: request.requestId, priority: request.privacy === 'PRIVATE' || request.privacy === 'SECRET' ? 'USER_INTERACTIVE' : 'ACTIVE_AGENT' }) : await run();
    return boundStreamingResult(result, request.requestId);
  }
}

export interface PluginSkillRegistryOptions { readonly install?: (skill: PluginSkillDefinition) => Promise<void>; }
/** Skill provider only exposes a reviewable package; it can never auto-install. */
export class PluginSkillRegistry {
  constructor(private readonly options: PluginSkillRegistryOptions = {}) {}
  list(provider: PluginSkillProvider): readonly PluginSkillDefinition[] { return provider.listSkills().filter(skill => /^[a-z][a-z0-9._-]{0,127}$/.test(skill.id) && /^[a-f0-9]{64}$/i.test(skill.packageHash)).slice(0, 100).map(skill => structuredClone(skill)); }
  async requestInstall(provider: PluginSkillProvider, skillId: string, approved: boolean): Promise<{ readonly accepted: false; readonly requiresReview: true }> {
    const skill = this.list(provider).find(value => value.id === skillId);
    if (!skill) fail('NOT_FOUND', `Plugin Skill not found: ${skillId}`);
    if (!approved) return { accepted: false, requiresReview: true };
    const review = await provider.requestInstall(skill);
    if (!review.requiresReview || review.accepted) fail('POLICY_DENIED', 'Plugin Skill must use the normal reviewed Skill installation flow');
    // The provider may only submit a candidate. Installation is delegated to
    // the host's normal R0P55 review/install flow, never performed implicitly.
    return { accepted: false, requiresReview: true };
  }
}

export function inspectPluginFile(provider: PluginFileHandlerProvider, file: PluginFileHandle, context: PluginExtensionContext, options: { readonly allowQuarantined?: boolean } = {}): Promise<{ readonly metadata: Readonly<Record<string, string | number | boolean>>; readonly trust: 'UNTRUSTED' }> {
  if (file.mimeType.toLowerCase().startsWith('application/x-executable') || /(?:^|\/)x-(?:msdownload|dosexec)|application\/vnd\.microsoft\.portabl|application\/x-sharedlib/i.test(file.mimeType)) return Promise.reject(new PluginPlatformError('POLICY_DENIED', 'Executable FileObject cannot enter a Plugin FileHandler'));
  if (file.state === 'QUARANTINED' && !options.allowQuarantined) return Promise.reject(new PluginPlatformError('POLICY_DENIED', 'Quarantined FileObject is not eligible for Plugin inspection'));
  if (file.state !== 'ELIGIBLE') return Promise.reject(new PluginPlatformError('UNAVAILABLE', 'FileObject is unavailable to Plugin')); // typed state, no path disclosure
  if (!provider.supports(file.mimeType)) return Promise.reject(new PluginPlatformError('UNSUPPORTED', 'Plugin FileHandler does not support this MIME type'));
  return provider.inspect({ ...file, id: file.id.slice(0, 256), contentId: file.contentId.slice(0, 256) }, context).then(result => ({ metadata: structuredClone(result.metadata), trust: 'UNTRUSTED' as const }));
}

export function assertSafePluginFileName(name: string): void {
  if (!name || name.length > 255 || /[\u0000-\u001f\\/]/.test(name) || name === '.' || name === '..') fail('POLICY_DENIED', 'Plugin file metadata cannot be used as a filesystem path');
}

export function assertRenderableObject(object: { readonly type: string; readonly id: string; readonly version: number; readonly data: Readonly<Record<string, unknown>> }, reservedTypes: readonly string[] = ['Identity', 'SecurityEvent', 'OwnerAuthority', 'IntegrityRoot', 'MandatoryPolicyRoot']): void {
  if (reservedTypes.includes(object.type) || !/^plugin:[a-z0-9][a-z0-9.-]*:[a-z][a-z0-9._-]{0,63}$/.test(object.type)) fail('POLICY_DENIED', 'Plugin renderer may only render namespaced Plugin objects');
  if (!object.id || !Number.isSafeInteger(object.version) || byteSize(object.data) > 256 * 1024) fail('INVALID_ARGUMENT', 'Renderable Plugin object is invalid');
}

export interface PluginExternalLinkDecision { readonly accepted: boolean; readonly url?: string; readonly warning?: 'UNKNOWN_HOST' | 'UNSAFE_SCHEME' | 'MALFORMED'; readonly host?: string; }
export class PluginExternalLinkGateway {
  constructor(private readonly open?: (url: string, reason: string) => Promise<PluginExternalLinkDecision>) {}
  async request(url: string, reason: string): Promise<PluginExternalLinkDecision> {
    if (!reason.trim() || url.length > 2_048 || /[\s\u0000-\u001f]/.test(url)) return { accepted: false, warning: 'MALFORMED' };
    let parsed: URL; try { parsed = new URL(url); } catch { return { accepted: false, warning: 'MALFORMED' }; }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return { accepted: false, warning: 'UNSAFE_SCHEME' };
    // Credentials, localhost/metadata hosts and IP literals are never valid
    // ordinary add-on destinations. The Core confirmation UI owns exceptions.
    if (parsed.username || parsed.password || isUnsafeExternalHost(parsed.hostname)) return { accepted: false, warning: 'MALFORMED', host: parsed.host };
    if (!this.open) return { accepted: false, warning: 'UNKNOWN_HOST', host: parsed.host };
    return this.open(parsed.toString(), reason.slice(0, 500));
  }
}

export interface PluginNotificationInput { readonly title: string; readonly body?: string; readonly objectId?: string; readonly category?: string; }
export function validatePluginNotification(input: PluginNotificationInput): PluginNotificationInput {
  if (!input || !input.title.trim() || input.title.length > 160 || input.body && input.body.length > 2_000 || input.objectId && input.objectId.length > 256 || input.category && input.category.length > 80) fail('INVALID_ARGUMENT', 'Plugin notification is invalid');
  if (input.category?.toLowerCase().includes('security')) fail('POLICY_DENIED', 'Plugin cannot impersonate a Core security notification');
  return structuredClone(input);
}

export interface PluginSettingsSchema { readonly namespace: string; readonly keys: Readonly<Record<string, { readonly type: 'boolean' | 'string' | 'number' | 'enum'; readonly default?: unknown; readonly values?: readonly string[] }>>; }
export class PluginSettingsRegistry {
  private readonly schemas = new Map<string, PluginSettingsSchema>();
  register(schema: PluginSettingsSchema): void {
    if (!/^plugin\.[a-z0-9](?:[a-z0-9-]{0,62})(?:\.[a-z0-9](?:[a-z0-9-]{0,62}))*$/.test(schema.namespace) || schema.namespace.startsWith('plugin.security') || schema.namespace.startsWith('plugin.core') || schema.namespace.startsWith('security.') || schema.namespace.startsWith('core.')) fail('POLICY_DENIED', 'Plugin settings must use a non-sensitive namespace');
    if (this.schemas.has(schema.namespace) || Object.keys(schema.keys).length > 64) fail('INVALID_ARGUMENT', 'Plugin settings namespace is already registered or too large');
    for (const [key, value] of Object.entries(schema.keys)) { if (!/^[a-z][a-z0-9._-]{0,63}$/.test(key) || value.type === 'enum' && (!value.values || value.values.length > 32)) fail('INVALID_ARGUMENT', 'Plugin setting key/schema is invalid'); }
    this.schemas.set(schema.namespace, structuredClone(schema));
  }
  list(): readonly PluginSettingsSchema[] { return [...this.schemas.values()].map(value => structuredClone(value)); }
  clear(namespace?: string): void { if (namespace) this.schemas.delete(namespace); else this.schemas.clear(); }
}

export function validateSettingsValue(schema: PluginSettingsSchema, key: string, value: unknown): void {
  const rule = schema.keys[key];
  if (!rule) fail('NOT_FOUND', `Plugin setting is not declared: ${key}`);
  if (rule.type === 'boolean' && typeof value !== 'boolean' || rule.type === 'string' && typeof value !== 'string' || rule.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value)) || rule.type === 'enum' && (typeof value !== 'string' || !rule.values?.includes(value))) fail('INVALID_ARGUMENT', `Plugin setting value is invalid: ${key}`);
}

export interface PluginConnectivityGateway {
  snapshot(): Promise<{ readonly state: string; readonly quality: string; readonly latencyClass: string; readonly bandwidthClass: string; readonly realtime: boolean; readonly bulk: boolean; readonly eventual: boolean }>;
  delivery(operation: 'INTERACTIVE' | 'EVENTUAL' | 'BULK' | 'REALTIME' | 'BACKGROUND'): Promise<'AVAILABLE' | 'WAITING_FOR_CONNECTIVITY' | 'NETWORK_UNAVAILABLE' | 'QUEUED'>;
}

/** Map a host connectivity snapshot to the stable provider-facing contract. */
export function normalizePluginConnectivity(snapshot: { readonly state: string; readonly quality?: string }): import('./plugin-providers.js').PluginConnectivitySnapshot {
  const states = ['OFFLINE', 'DEVICE_ONLY', 'NEARBY', 'NEARBY_MESH', 'LOCAL_NETWORK', 'RESTRICTED_NETWORK', 'GLOBAL_NETWORK'] as const;
  const state = states.includes(snapshot.state as typeof states[number]) ? snapshot.state as typeof states[number] : 'OFFLINE';
  const qualities = ['UNKNOWN', 'POOR', 'FAIR', 'GOOD'] as const;
  const quality = qualities.includes(snapshot.quality as typeof qualities[number]) ? snapshot.quality as typeof qualities[number] : 'UNKNOWN';
  return { state, quality, latencyClass: 'UNKNOWN', bandwidthClass: 'UNKNOWN', realtime: state !== 'OFFLINE', bulk: state !== 'OFFLINE', eventual: true };
}

export type PluginConnectivityState = 'OFFLINE' | 'DEVICE_ONLY' | 'NEARBY' | 'NEARBY_MESH' | 'LOCAL_NETWORK' | 'RESTRICTED_NETWORK' | 'GLOBAL_NETWORK';
export interface PluginConnectivityApiSnapshot { readonly state: PluginConnectivityState; readonly quality: 'UNKNOWN' | 'POOR' | 'FAIR' | 'GOOD'; readonly latencyClass: 'UNKNOWN' | 'LOW' | 'MEDIUM' | 'HIGH'; readonly bandwidthClass: 'UNKNOWN' | 'LOW' | 'MEDIUM' | 'HIGH'; readonly realtime: boolean; readonly bulk: boolean; readonly eventual: boolean; }

export interface PluginTestHostOptions { readonly apiVersion?: number; readonly online?: boolean; readonly ownerIdentity?: string; }
/** Explicitly development-only host for SDK/provider tests. */
export class PluginTestHost {
  readonly environment = 'DEVELOPMENT_TEST' as const;
  readonly apiVersion: number;
  readonly ownerIdentity: string;
  private readonly online: boolean;
  constructor(options: PluginTestHostOptions = {}) { this.apiVersion = options.apiVersion ?? 1; this.ownerIdentity = options.ownerIdentity ?? 'test-owner'; this.online = options.online ?? true; }
  assertDevelopmentOnly(): void { if (this.environment !== 'DEVELOPMENT_TEST') throw new PluginPlatformError('POLICY_DENIED', 'Test host cannot masquerade as Production PluginHost'); }
  connectivity(): 'ONLINE' | 'OFFLINE' { return this.online ? 'ONLINE' : 'OFFLINE'; }
}

export class PluginFixtureBuilder {
  private readonly capabilities: PluginCapability[] = [];
  constructor(readonly pluginId = 'org.example.fixture') {}
  withCapability(capability: PluginCapability): this { this.capabilities.push(capability); return this; }
  context(revision: PluginRevision = { version: '1.0.0', packageHash: 'a'.repeat(64), installedAt: new Date(0).toISOString(), source: { kind: 'DEVELOPMENT' } }): PluginExtensionContext {
    return { pluginId: this.pluginId, revision, sandboxSessionId: 'test-session', ownerIdentity: 'test-owner', grantedCapabilities: [...new Set(this.capabilities)] };
  }
}

export class ProviderTestHarness {
  constructor(readonly host = new PluginTestHost()) {}
  async run<T>(operation: () => Promise<T> | T): Promise<T> { this.host.assertDevelopmentOnly(); return operation(); }
  validatePage<T>(items: readonly T[], limit = 100): readonly T[] { if (items.length > Math.min(limit, 100)) throw new PluginPlatformError('QUOTA', 'Provider test output exceeds page bound'); return structuredClone(items); }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  const timeout = Math.min(Math.max(timeoutMs, 1), 120_000);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new PluginPlatformError('TIMEOUT', 'Plugin provider timed out')), timeout); })]); }
  finally { if (timer) clearTimeout(timer); }
}
function assertProviderShape(kind: PluginExtensionKind, provider: object): void {
  const required: Partial<Record<PluginExtensionKind, readonly string[]>> = {
    TOOL_PROVIDER: ['listTools', 'invoke'], SKILL_PROVIDER: ['listSkills', 'requestInstall'], MODEL_PROVIDER: ['metadata', 'models', 'health', 'infer'], CONTEXT_PROVIDER: ['search'], SEARCH_PROVIDER: ['search'], VIDEO_PROVIDER: ['metadata', 'search', 'get'], MUSIC_PROVIDER: ['metadata', 'search', 'get'], LIVE_PROVIDER: ['metadata', 'search', 'get'], CALENDAR_PROVIDER: ['list'], FILE_HANDLER_PROVIDER: ['supports', 'inspect'], OBJECT_RENDERER_PROVIDER: ['render'], AGENT_CAPABILITY_PROVIDER: ['invoke'],
  };
  for (const method of required[kind] ?? []) if (typeof (provider as Record<string, unknown>)[method] !== 'function') fail('INVALID_ARGUMENT', `Provider is missing required operation: ${method}`);
}
function boundStreamingResult(result: PluginStreamingResult, requestId: string): PluginStreamingResult {
  if (!result || result.requestId !== requestId || typeof result.cancel !== 'function' || !result.chunks || typeof result.chunks[Symbol.asyncIterator] !== 'function') fail('INVALID_OUTPUT', 'Plugin model streaming result is invalid');
  return { requestId, cancel: result.cancel.bind(result), chunks: boundedChunks(result.chunks) };
}
async function* boundedChunks(chunks: AsyncIterable<string>): AsyncIterable<string> { let bytes = 0; let count = 0; for await (const chunk of chunks) { if (typeof chunk !== 'string' || ++count > 16_384) fail('QUOTA', 'Plugin model stream exceeds bounded chunks'); bytes += new TextEncoder().encode(chunk).byteLength; if (bytes > 16 * 1024 * 1024) fail('QUOTA', 'Plugin model stream exceeds bounded output'); yield chunk.slice(0, 64 * 1024); } }
function boundedLimit(value: number): number { if (!Number.isSafeInteger(value) || value < 1) fail('INVALID_ARGUMENT', 'Provider page limit is invalid'); return Math.min(value, 100); }
function providerFailureHealth(error: unknown): ProviderHealth { return { availability: error instanceof PluginPlatformError && error.code === 'OFFLINE' ? 'OFFLINE' : 'DEGRADED', checkedAt: new Date().toISOString(), failure: { code: error instanceof PluginPlatformError && error.code === 'TIMEOUT' ? 'TIMEOUT' : 'CRASHED', message: error instanceof Error ? error.message.slice(0, 256) : 'Provider failure', retryable: true } }; }
function isUnsafeExternalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/[\[\]]/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host === 'metadata.google.internal') return true;
  if (/^(?:127\.|10\.|192\.168\.|169\.254\.)/.test(host) || host === '::1' || host.startsWith('fc') || host.startsWith('fe80:')) return true;
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host);
}
function fail(code: 'INVALID_ARGUMENT' | 'POLICY_DENIED' | 'CAPABILITY_DENIED' | 'QUOTA' | 'INVALID_STATE' | 'NOT_FOUND' | 'COMPATIBILITY' | 'REVIEW_REQUIRED' | 'CANCELLED' | 'TIMEOUT' | 'INVALID_OUTPUT' | 'UNAVAILABLE' | 'UNSUPPORTED', message: string): never { throw new PluginPlatformError(code, message); }
