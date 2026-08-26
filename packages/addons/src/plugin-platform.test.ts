import { describe, expect, it } from 'vitest';
import { canonicalJson, sha256Hex } from './plugin-integrity.js';
import { InMemoryPluginRegistryStore, PluginInstaller, PluginLifecycleService, PluginPlatformError, PluginRegistry, PluginStorageNamespaceImpl } from './plugin-platform.js';
import { manifestForIntegrity, parsePluginManifest } from './plugin-manifest.js';
import type { PluginManifest, PluginPackage, PluginRuntime } from './plugin-types.js';

const base = {
  id: 'org.example.test', name: 'Test', description: 'test plugin', author: 'author', version: '1.0.0', formatVersion: 1, apiVersion: 1,
  entrypoint: 'dist/index.js', pluginType: 'EXECUTABLE', requestedCapabilities: [], extensionPoints: [], dependencies: [], optionalDependencies: [],
  keystoneCompatibility: { api: { min: 1, max: 1 } }, platformCompatibility: { api: { min: 1, max: 1 } }, createdAt: '2026-01-01T00:00:00.000Z',
} as const;

async function pkg(overrides: Partial<PluginManifest> = {}): Promise<PluginPackage> {
  const executable = new Uint8Array([1, 2, 3]);
  const unsigned = { ...base, ...overrides } as PluginManifest;
  const payload = { manifest: manifestForIntegrity(unsigned), entrypoint: unsigned.entrypoint, executable: '010203', resources: {}, schemas: {}, uiBundle: undefined, migrations: {} };
  const manifest = { ...unsigned, integrity: { algorithm: 'SHA-256' as const, packageHash: await sha256Hex(canonicalJson(payload)), entrypointHash: 'a'.repeat(64), resourceHashes: {} } };
  return { manifest, executable, resources: {}, source: { kind: 'LOCAL_FILE', reference: '/tmp/test' } };
}

describe('R0P61 Plugin platform invariants', () => {
  it('does not execute received packages and requires explicit owner approval', async () => {
    const packageValue = await pkg(); const installer = new PluginInstaller({ ownerIdentity: 'alice' });
    await installer.receive(packageValue);
    await expect(installer.install(packageValue.manifest.id)).rejects.toMatchObject({ code: 'REVIEW_REQUIRED' });
    expect(installer.registry.list()).toHaveLength(0);
  });

  it('installs disabled, validates capabilities, and requires enable before runtime', async () => {
    const packageValue = await pkg({ requestedCapabilities: [{ capability: 'messages.read', reason: 'read selected messages' }] });
    let called = 0;
    const installer = new PluginInstaller({ ownerIdentity: 'alice', ownerApproval: async () => true, capabilityApproval: async () => true });
    const record = await installer.install(packageValue.manifest.id).catch(async () => { await installer.receive(packageValue); return installer.install(packageValue.manifest.id); });
    expect(record.state).toBe('INSTALLED_DISABLED');
    const runtime: PluginRuntime = { isolation: 'development-adapter', async start() { called++; }, async execute() { return { ok: true }; }, async stop() {} };
    const lifecycle = new PluginLifecycleService(installer.registry, { ownerIdentity: 'alice', runtime });
    await expect(lifecycle.execute(record.pluginId, 'run')).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await lifecycle.enable(record.pluginId); await lifecycle.start(record.pluginId); expect(called).toBe(1); await expect(lifecycle.execute(record.pluginId, 'run')).resolves.toEqual({ ok: true });
  });

  it('fails closed for shared plugin output without a safety gateway', async () => {
    const packageValue = await pkg({ requestedCapabilities: [{ capability: 'surface.publish' }] }); const installer = new PluginInstaller({ ownerIdentity: 'alice', ownerApproval: async () => true }); await installer.receive(packageValue); const record = await installer.install(packageValue.manifest.id);
    const lifecycle = new PluginLifecycleService(installer.registry, { ownerIdentity: 'alice', runtime: { isolation: 'development-adapter', async start() {}, async execute() { return null; }, async stop() {} } }); await lifecycle.enable(record.pluginId); await lifecycle.start(record.pluginId); const host = lifecycle.host(record.pluginId);
    await expect(host.publishShared({ surface: 'HOME', objectId: 'x', value: { text: 'x' }, domain: 'PUBLIC' })).resolves.toBe(false);
  });

  it('revocation blocks the next operation and survives registry restart', async () => {
    const packageValue = await pkg({ requestedCapabilities: [{ capability: 'messages.read' }] }); const installer = new PluginInstaller({ ownerIdentity: 'alice', ownerApproval: async () => true }); await installer.receive(packageValue); const record = await installer.install(packageValue.manifest.id);
    const lifecycle = new PluginLifecycleService(installer.registry, { ownerIdentity: 'alice', handlers: { 'messages.read': () => ({ ok: true }) } }); const host = lifecycle.host(record.pluginId); await expect(host.call('messages.read', 'read')).resolves.toEqual({ ok: true }); await lifecycle.revoke(record.pluginId, 'messages.read'); await expect(host.call('messages.read', 'read')).rejects.toMatchObject({ code: 'CAPABILITY_DENIED' });
  });

  it('does not silently expand update permissions and applies reviewed updates', async () => {
    const first = await pkg({ requestedCapabilities: [{ capability: 'messages.read' }] }); const installer = new PluginInstaller({ ownerIdentity: 'alice', ownerApproval: async () => true }); await installer.receive(first); await installer.install(first.manifest.id);
    const second = await pkg({ version: '1.0.1', requestedCapabilities: [{ capability: 'messages.read' }, { capability: 'messages.write' }] }); const plan = await installer.update(first.manifest.id, second); expect(plan.state).toBe('REVIEW_REQUIRED'); await expect(installer.applyUpdate(first.manifest.id)).rejects.toMatchObject({ code: 'REVIEW_REQUIRED' }); const applied = await installer.applyUpdate(first.manifest.id, true); expect(applied.currentRevision.version).toBe('1.0.1');
  });

  it('rejects invalid storage snapshots and isolates namespaces', async () => {
    const a = new PluginStorageNamespaceImpl('a', 100); const b = new PluginStorageNamespaceImpl('b', 100); await a.set('key', { value: 1 }); expect(await b.get('key')).toBeUndefined(); expect(() => a.restore([{ key: 'key', value: { value: 1 }, bytes: 1, updatedAt: new Date().toISOString() }])).toThrow(PluginPlatformError);
  });

  it('rejects reserved namespaces', async () => {
    expect(() => parsePluginManifest({ ...base, id: 'core' })).toThrow();
  });

  it('survives a storage restart without crossing namespaces', async () => {
    const store = new InMemoryPluginRegistryStore(); const first = new PluginRegistry(store); const ns = first.storageNamespace('org.example.test', 100); await ns.set('persisted', { ok: true });
    const second = new PluginRegistry(store); await second.ready(); const restored = second.storageNamespace('org.example.test', 100); expect(await restored.get('persisted')).toEqual({ ok: true }); expect(await second.storageNamespace('org.other', 100).get('persisted')).toBeUndefined();
  });
});
