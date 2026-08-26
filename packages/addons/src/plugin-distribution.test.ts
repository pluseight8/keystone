import { describe, expect, it } from 'vitest';
import { canonicalJson, sha256Hex } from './plugin-integrity.js';
import { manifestForIntegrity } from './plugin-manifest.js';
import { InMemoryPluginRegistryStore, PluginInstaller } from './plugin-platform.js';
import { PluginDistributionService, PluginSourceRegistry, serializePluginPackage } from './plugin-distribution.js';
import type { PluginManifest, PluginPackage, PluginPackageReference } from './plugin-types.js';

const base = {
  id: 'org.example.distribution', name: 'Distribution fixture', description: 'distribution fixture', author: 'fixture', version: '1.0.0', formatVersion: 1, apiVersion: 1,
  entrypoint: 'dist/index.js', pluginType: 'EXECUTABLE', requestedCapabilities: [], extensionPoints: [], dependencies: [], optionalDependencies: [],
  keystoneCompatibility: { api: { min: 1, max: 1 } }, platformCompatibility: { api: { min: 1, max: 1 } }, createdAt: '2026-01-01T00:00:00.000Z',
} as const;

async function fixture(overrides: Partial<PluginManifest> = {}, source: 'LOCAL_FILE' | 'P2P_PACKAGE' = 'LOCAL_FILE'): Promise<PluginPackage> {
  const executable = new Uint8Array([1, 2, 3]);
  const unsigned = { ...base, ...overrides } as PluginManifest;
  const payload = { manifest: manifestForIntegrity(unsigned), entrypoint: unsigned.entrypoint, executable: '010203', resources: {}, schemas: {}, uiBundle: undefined, migrations: {} };
  const manifest = { ...unsigned, integrity: { algorithm: 'SHA-256' as const, packageHash: await sha256Hex(canonicalJson(payload)), entrypointHash: 'a'.repeat(64), resourceHashes: {} } };
  return { manifest, executable, resources: {}, source: { kind: source, reference: source === 'LOCAL_FILE' ? '/tmp/plugin' : 'peer:opaque' } };
}

function ref(plugin: PluginPackage): PluginPackageReference { return { pluginId: plugin.manifest.id, version: plugin.manifest.version, contentAddress: `sha256:${plugin.manifest.integrity.packageHash}` }; }

describe('R0P64 Plugin Distribution', () => {
  it('keeps source trust separate from package identity and supports multiple sources', async () => {
    const packageValue = await fixture(); const source = new PluginSourceRegistry();
    source.register({ descriptor: { id: 'source.a', kind: 'LOCAL_FILE', displayName: 'A', trust: 'KNOWN_SOURCE' }, provider: { descriptor: { id: 'source.a', kind: 'LOCAL_FILE' }, acquire: async () => packageValue } });
    source.register({ descriptor: { id: 'source.b', kind: 'P2P_PACKAGE', displayName: 'B', trust: 'UNTRUSTED' }, provider: { descriptor: { id: 'source.b', kind: 'P2P_PACKAGE' }, acquire: async () => packageValue } });
    const distribution = new PluginDistributionService(source); const result = await distribution.acquire(ref(packageValue), ['source.a']);
    expect(result.state).toBe('VERIFIED'); expect(distribution.package(ref(packageValue))?.manifest.integrity.packageHash).toBe(packageValue.manifest.integrity.packageHash);
    source.remove('source.a'); expect(source.get('source.b')?.descriptor.trust).toBe('UNTRUSTED');
  });

  it('does not install or enable a received package until the existing owner lifecycle is used', async () => {
    const packageValue = await fixture(); const source = new PluginSourceRegistry();
    source.register({ descriptor: { id: 'local', kind: 'LOCAL_FILE' }, provider: { descriptor: { id: 'local', kind: 'LOCAL_FILE' }, acquire: async () => packageValue } });
    const store = new InMemoryPluginRegistryStore(); const installer = new PluginInstaller({ ownerIdentity: 'alice', registry: store, ownerApproval: async () => true });
    const distribution = new PluginDistributionService(source, { installer }); await distribution.acquire(ref(packageValue));
    const candidate = await distribution.prepareInstall(ref(packageValue)); expect(candidate.installedDisabled).toBe(true); expect(installer.registry.list()).toHaveLength(0);
    await installer.install(packageValue.manifest.id); expect(installer.registry.require(packageValue.manifest.id).state).toBe('INSTALLED_DISABLED');
  });

  it('rejects same-version hash confusion and corrupted chunk transfers', async () => {
    const first = await fixture(); const second = await fixture({ description: 'different bytes' }); expect(second.manifest.version).toBe(first.manifest.version); expect(second.manifest.integrity.packageHash).not.toBe(first.manifest.integrity.packageHash);
    const source = new PluginSourceRegistry(); source.register({ descriptor: { id: 'peer', kind: 'P2P_PACKAGE' }, provider: { descriptor: { id: 'peer', kind: 'P2P_PACKAGE' }, acquire: async () => ({ chunks: [{ contentAddress: ref(first).contentAddress, index: 0, total: 1, offset: 0, bytes: new Uint8Array([9]), hash: '0'.repeat(64) }] }) } });
    const distribution = new PluginDistributionService(source); const result = await distribution.acquire(ref(first)); expect(result.state).toBe('FAILED'); expect(result.error?.code).toBe('INTEGRITY');
  });

  it('queues offline acquisition and resumes by content reference', async () => {
    const packageValue = await fixture(); const source = new PluginSourceRegistry(); source.register({ descriptor: { id: 'offline-peer', kind: 'P2P_PACKAGE' }, provider: { descriptor: { id: 'offline-peer', kind: 'P2P_PACKAGE' }, acquire: async () => packageValue } });
    const offline = new PluginDistributionService(source, { offline: true }); await expect(offline.acquire(ref(packageValue))).rejects.toMatchObject({ code: 'OFFLINE' }); expect(offline.snapshot()[0]?.state).toBe('QUEUED');
    const online = new PluginDistributionService(source); await expect(online.acquire(ref(packageValue))).resolves.toMatchObject({ state: 'VERIFIED' });
  });

  it('accepts the same serialized package through a content-addressed chunk transport', async () => {
    const packageValue = await fixture(); const encoded = serializePluginPackage(packageValue); const chunkSize = Math.max(1, Math.ceil(encoded.byteLength / 2)); const chunks = [0, 1].map(index => { const bytes = encoded.slice(index * chunkSize, Math.min(encoded.byteLength, (index + 1) * chunkSize)); return { contentAddress: ref(packageValue).contentAddress, index, total: 2, offset: index * chunkSize, bytes, hash: '' }; });
    for (const chunk of chunks) chunk.hash = await sha256Hex(chunk.bytes);
    const source = new PluginSourceRegistry(); source.register({ descriptor: { id: 'chunk-peer', kind: 'CONTENT_ADDRESS' }, provider: { descriptor: { id: 'chunk-peer', kind: 'CONTENT_ADDRESS' }, acquire: async () => ({ chunks }) } });
    const distribution = new PluginDistributionService(source); await expect(distribution.acquire(ref(packageValue))).resolves.toMatchObject({ state: 'VERIFIED' });
  });

  it('requires review for capability expansion even when discovery says the update is latest', async () => {
    const first = await fixture({ requestedCapabilities: [{ capability: 'messages.read' }] }); const second = await fixture({ version: '1.0.1', requestedCapabilities: [{ capability: 'messages.read' }, { capability: 'messages.write' }] });
    const source = new PluginSourceRegistry(); source.register({ descriptor: { id: 'index', kind: 'TRUSTED_INDEX', trust: 'AUTHENTICATED' }, provider: { descriptor: { id: 'index', kind: 'TRUSTED_INDEX' }, discover: async () => [{ pluginId: second.manifest.id, version: second.manifest.version, contentAddress: `sha256:${second.manifest.integrity.packageHash}`, requestedCapabilities: second.manifest.requestedCapabilities, discoveredAt: second.manifest.createdAt, source: { kind: 'TRUSTED_INDEX', id: 'index' }, metadataTrust: 'SOURCE_AUTHENTICATED' }], acquire: async () => second } });
    const distribution = new PluginDistributionService(source); await distribution.acquire(ref(first)); const result = await distribution.updateCheck(first.manifest.id, { version: first.manifest.version, packageHash: first.manifest.integrity.packageHash, installedAt: first.manifest.createdAt, source: first.source });
    expect(result.candidates[0]?.decision).toBe('REVIEW'); expect(result.candidates[0]?.permissionExpansion).toContain('messages.write');
  });

  it('keeps discovery metadata bounded across multiple independent sources', async () => {
    const packageValue = await fixture(); const registry = new PluginSourceRegistry();
    for (let sourceIndex = 0; sourceIndex < 5; sourceIndex++) registry.register({ descriptor: { id: `index-${sourceIndex}`, kind: 'TRUSTED_INDEX' }, provider: { descriptor: { id: `index-${sourceIndex}`, kind: 'TRUSTED_INDEX' }, discover: async () => Array.from({ length: 100 }, (_, index) => ({ pluginId: `${packageValue.manifest.id}.${sourceIndex}.${index}`, version: '1.0.0', contentAddress: `sha256:${'a'.repeat(64)}` as const, discoveredAt: packageValue.manifest.createdAt, source: { kind: 'TRUSTED_INDEX' as const }, metadataTrust: 'UNTRUSTED' as const })) , acquire: async () => packageValue } });
    const distribution = new PluginDistributionService(registry); const started = Date.now(); const results = await distribution.discover({ limit: 100 }); const elapsedMs = Date.now() - started;
    expect(results).toHaveLength(100); expect(elapsedMs).toBeLessThan(1_000); console.info(`plugin-discovery-benchmark ${JSON.stringify({ sources: 5, metadataEntries: 500, returned: results.length, elapsedMs })}`);
  });
});
