import { describe, expect, it } from 'vitest';
import { PluginApiRegistry, PluginExtensionRegistry, type PluginExtensionContext } from './plugin-api.js';
import { PluginPlatformError } from './plugin-platform.js';
import {
  PluginExternalLinkGateway,
  PluginFixtureBuilder,
  PluginModelRouter,
  PluginProviderRegistry,
  PluginSettingsRegistry,
  PluginSkillRegistry,
  PluginTestHost,
  aggregateSearchProviders,
  assertRenderableObject,
  executePluginTool,
  filterPluginContext,
} from './plugin-runtime.js';
import { validateProviderPage, type PluginSearchProvider, type PluginToolProvider } from './plugin-providers.js';
import { PluginEventBus, redactedPluginEvent } from './plugin-events.js';
import { PluginMediaSourceRegistry } from './plugin-providers.js';

const context: PluginExtensionContext = new PluginFixtureBuilder().withCapability('tool.register').withCapability('context.provider.register').context();
const provenance = { pluginId: context.pluginId, pluginRevision: context.revision.packageHash, createdAt: new Date(0).toISOString(), trust: 'PLUGIN_UNTRUSTED' as const };

describe('R0P63 extension surface security', () => {
  it('negotiates stable API features and rejects unsupported ranges', () => {
    const api = new PluginApiRegistry();
    expect(api.negotiate({ minimum: 1, maximum: 1 }, ['tools.v1']).compatible).toBe(true);
    expect(api.negotiate({ minimum: 2, maximum: 3 }).compatible).toBe(false);
  });

  it('binds executable providers to a namespaced plugin revision/session', () => {
    const registry = new PluginProviderRegistry();
    const provider = { metadata: () => ({ providerId: 'plugin:org.example.fixture:provider:video', displayName: 'Video', source: 'PLUGIN_PROVIDER' as const, attributionLabel: 'Fixture', capabilities: [], privacyClass: 'LOCAL' as const }), search: async () => ({ items: [], health: { availability: 'AVAILABLE' as const, checkedAt: new Date(0).toISOString() } }), get: async () => undefined };
    const record = registry.register({ id: 'video', kind: 'VIDEO_PROVIDER', provider, context: { ...context, providerId: 'video', kind: 'VIDEO_PROVIDER' } });
    expect(record.qualifiedId).toBe('plugin:org.example.fixture:provider:video');
    expect('provider' in (registry.list()[0] ?? {})).toBe(false);
    registry.deactivatePrincipal(context.pluginId, context.revision.packageHash, context.sandboxSessionId, 'STALE');
    expect(registry.get(record.qualifiedId)?.state).toBe('STALE');
  });

  it('executes tools only after policy and keeps output untrusted', async () => {
    const tool: any = { id: 'echo', name: 'Echo', description: 'Echo', input: { type: 'object', properties: { text: { type: 'string', maxLength: 32 } }, required: ['text'], additionalProperties: false }, output: { type: 'object', properties: { text: { type: 'string', maxLength: 32 } }, required: ['text'], additionalProperties: false, maxBytes: 1024 }, risk: { risk: 'LOW', requiresConfirmation: false }, requiredCapabilities: ['tool.register'], timeoutMs: 1000 };
    const provider: PluginToolProvider = { listTools: () => [tool], invoke: async () => ({ ok: true, value: { text: 'ok' }, trust: 'UNTRUSTED' as const, provenance }) };
    await expect(executePluginTool(provider, 'echo', { toolId: 'echo', input: { text: 'x' }, requestId: 'r', deadlineAt: new Date(Date.now() + 1000).toISOString() }, context, { policy: { authorize: async () => 'ALLOW' } })).resolves.toMatchObject({ trust: 'UNTRUSTED' });
    await expect(executePluginTool(provider, 'echo', { toolId: 'echo', input: { text: 'x' }, requestId: 'r', deadlineAt: new Date(Date.now() + 1000).toISOString() }, context)).rejects.toMatchObject({ code: 'POLICY_DENIED' });
  });

  it('filters private context and aggregates search with provider failure isolation', async () => {
    const objects: any[] = [{ id: 'public', text: 'public', source: 'fixture', privacy: 'PUBLIC', scope: { privacy: 'PUBLIC' }, trust: 'UNTRUSTED', provenance }, { id: 'private', text: 'secret', source: 'fixture', privacy: 'PRIVATE', scope: { privacy: 'PRIVATE' }, trust: 'UNTRUSTED', provenance }];
    expect(filterPluginContext(objects, context)).toHaveLength(1);
    const provider: PluginSearchProvider = { search: async () => ({ results: [{ objectId: 'x', type: 'Post', title: 'x', providerId: 'a', attribution: 'A', relevanceHint: 1, trust: 'UNTRUSTED', provenance }], nextCursor: 'next', health: { availability: 'AVAILABLE', checkedAt: new Date(0).toISOString() } }) };
    const result = await aggregateSearchProviders([{ id: 'a', provider }, { id: 'slow', provider: { search: async () => { throw new Error('boom'); } } }], { text: 'x', scope: { privacy: 'PUBLIC' }, limit: 10 }, context);
    expect(result.results).toHaveLength(1); expect(result.partial).toBe(true);
  });

  it('keeps Skills review-only, blocks reserved renderers and unsafe links', async () => {
    const skill = { id: 'fixture.skill', version: '1.0.0', packageHash: 'a'.repeat(64), displayName: 'Fixture', declaredCapabilities: [], source: 'fixture' };
    const skills = new PluginSkillRegistry();
    const provider = { listSkills: () => [skill], requestInstall: async () => ({ requiresReview: true as const, accepted: false as const }) };
    await expect(skills.requestInstall(provider, skill.id, false)).resolves.toEqual({ requiresReview: true, accepted: false });
    expect(() => assertRenderableObject({ type: 'Identity', id: 'x', version: 1, data: {} })).toThrow(PluginPlatformError);
    await expect(new PluginExternalLinkGateway().request('javascript:alert(1)', 'open')).resolves.toMatchObject({ warning: 'UNSAFE_SCHEME' });
  });

  it('does not allow stale extension handles or a revoked capability to execute', async () => {
    const registry = new PluginExtensionRegistry();
    const handle = registry.register({ id: 'plugin:org.example.fixture:command:run', kind: 'UI_COMMAND', pluginId: context.pluginId, revisionHash: context.revision.packageHash, sandboxSessionId: context.sandboxSessionId, requiredCapabilities: [], payload: { label: 'Run' } }, { ...context, grantedCapabilities: ['ui.extend'] });
    registry.deactivatePrincipal(context.pluginId, context.revision.packageHash, context.sandboxSessionId, 'STALE');
    await expect(registry.invoke(handle.handleId, context, {}, async () => true)).rejects.toMatchObject({ code: 'INVALID_STATE' });
    const provider = new PluginProviderRegistry();
    const media = { metadata: () => ({ providerId: 'plugin:org.example.fixture:provider:video', displayName: 'Video', source: 'PLUGIN_PROVIDER' as const, attributionLabel: 'Fixture', capabilities: [], privacyClass: 'LOCAL' as const }), search: async () => ({ items: [], health: { availability: 'AVAILABLE' as const, checkedAt: new Date(0).toISOString() } }), get: async () => undefined };
    provider.register({ id: 'video', kind: 'VIDEO_PROVIDER', provider: media, context: { ...context, providerId: 'video', kind: 'VIDEO_PROVIDER', grantedCapabilities: [...context.grantedCapabilities, 'media.provider.register'] }, requiredCapabilities: ['media.provider.register'] });
    await expect(provider.invoke('video', context as any, async () => true)).rejects.toMatchObject({ code: 'CAPABILITY_DENIED' });
  });

  it('bounds pages/settings and marks the test host as development-only', () => {
    expect(() => validateProviderPage(Array.from({ length: 101 }, (_, index) => index), 100)).toThrow();
    const settings = new PluginSettingsRegistry(); settings.register({ namespace: 'plugin.org.example.fixture', keys: { enabled: { type: 'boolean', default: true } } }); expect(settings.list()).toHaveLength(1);
    expect(() => settings.register({ namespace: 'plugin.security', keys: {} })).toThrow();
    const host = new PluginTestHost(); host.assertDevelopmentOnly(); expect(host.environment).toBe('DEVELOPMENT_TEST');
  });

  it('keeps external links behind the host gateway and blocks credential/local destinations', async () => {
    const gateway = new PluginExternalLinkGateway();
    await expect(gateway.request('https://user:pass@example.test/path', 'open')).resolves.toMatchObject({ accepted: false, warning: 'MALFORMED' });
    await expect(gateway.request('https://127.0.0.1/admin', 'open')).resolves.toMatchObject({ accepted: false, warning: 'MALFORMED' });
  });

  it('keeps quarantined and executable files outside ordinary handlers', async () => {
    const provider = { supports: () => true, inspect: async () => ({ metadata: {}, trust: 'UNTRUSTED' as const }) };
    const file = { id: 'f', mimeType: 'application/x-executable', size: 1, state: 'ELIGIBLE' as const, contentId: 'c' };
    await expect((await import('./plugin-runtime.js')).inspectPluginFile(provider, file, context)).rejects.toMatchObject({ code: 'POLICY_DENIED' });
  });

  it('requires explicit owner selection for external media sources', () => {
    const sources = new PluginMediaSourceRegistry();
    expect(() => sources.set({ providerId: 'plugin:org.example.fixture:video', mediaKind: 'VIDEO', enabled: true, ownerSelected: false, updatedAt: new Date(0).toISOString() })).toThrow(PluginPlatformError);
    sources.set({ providerId: 'plugin:org.example.fixture:video', mediaKind: 'VIDEO', enabled: true, ownerSelected: true, updatedAt: new Date(0).toISOString() });
    expect(sources.isEnabled('VIDEO', 'plugin:org.example.fixture:video')).toBe(true);
  });

  it('bounds and validates the event surface', () => {
    const bus = new PluginEventBus({ maxQueue: 1 });
    const handle = bus.subscribe({ pluginId: context.pluginId, sessionId: context.sandboxSessionId, revision: context.revision, event: 'object.created', capabilities: ['events.subscribe'] });
    const event = redactedPluginEvent({ type: 'object.created', payload: { objectId: 'x' }, revision: context.revision.packageHash, pluginId: context.pluginId });
    bus.publish(event); expect(bus.drain(handle.id)).toHaveLength(1);
    expect(() => redactedPluginEvent({ type: 'object.created', payload: { bad: 'x' }, revision: 'bad', pluginId: context.pluginId })).toThrow(PluginPlatformError);
  });

  it('isolates provider failures during bounded fan-out', async () => {
    const registry = new PluginProviderRegistry();
    const make = (id: string, fail = false) => ({ id, kind: 'VIDEO_PROVIDER' as const, provider: { metadata: () => ({ providerId: `plugin:${context.pluginId}:provider:${id}`, displayName: id, source: 'PLUGIN_PROVIDER' as const, attributionLabel: id, capabilities: [], privacyClass: 'LOCAL' as const }), search: async () => ({ items: [], health: { availability: 'AVAILABLE' as const, checkedAt: new Date(0).toISOString() } }), get: async () => { if (fail) throw new Error('boom'); return undefined; } }, context: { ...context, providerId: id, kind: 'VIDEO_PROVIDER' as const, grantedCapabilities: [...context.grantedCapabilities, 'media.provider.register' as const] } });
    registry.register(make('ok')); registry.register(make('bad', true));
    const result = await registry.fanOut('VIDEO_PROVIDER', { ...context, providerId: 'ok', kind: 'VIDEO_PROVIDER', grantedCapabilities: [...context.grantedCapabilities, 'media.provider.register'] }, async (_provider, metadata) => { if (metadata.id === 'bad') throw new Error('boom'); return true; });
    expect(result).toHaveLength(2); expect(result.some(value => value.error)).toBe(true);
  });
});
