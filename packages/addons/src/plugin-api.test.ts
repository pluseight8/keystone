import { describe, expect, it } from 'vitest';
import { PluginApiRegistry, PluginExtensionLifecycle, PluginExtensionRegistry } from './plugin-api.js';
import { PluginPlatformError } from './plugin-platform.js';
import { PluginFixtureBuilder } from './plugin-runtime.js';

const fixture = new PluginFixtureBuilder().withCapability('ui.extend').context();

describe('R0P63 Plugin API contracts', () => {
  it('fails closed for malformed ranges and does not let plugins override core features', () => {
    const api = new PluginApiRegistry();
    expect(api.negotiate({ minimum: 2, maximum: 1 })).toMatchObject({ compatible: false });
    expect(() => api.registerFeature({ feature: 'core.secret.v1', version: 1, stability: 'STABLE', available: true })).toThrow(PluginPlatformError);
  });

  it('invalidates only old sessions on restart and restores metadata as stale', () => {
    const registry = new PluginExtensionRegistry();
    const old = registry.register({ id: 'plugin:org.example.fixture:command:old', kind: 'UI_COMMAND', pluginId: fixture.pluginId, revisionHash: fixture.revision.packageHash, sandboxSessionId: 'old-session', payload: { label: 'old' } }, { ...fixture, sandboxSessionId: 'old-session' });
    const current = registry.register({ id: 'plugin:org.example.fixture:command:new', kind: 'UI_COMMAND', pluginId: fixture.pluginId, revisionHash: fixture.revision.packageHash, sandboxSessionId: 'new-session', payload: { label: 'new' } }, { ...fixture, sandboxSessionId: 'new-session' });
    new PluginExtensionLifecycle(registry).onStarted(fixture.pluginId, fixture.revision.packageHash, 'new-session');
    expect(registry.get(old.handleId)?.state).toBe('STALE');
    expect(registry.get(current.handleId)?.state).toBe('ACTIVE');
    const snapshot = registry.snapshot(); const restored = new PluginExtensionRegistry(); restored.restore(snapshot);
    expect(restored.get(current.handleId)?.state).toBe('STALE');
  });
});
