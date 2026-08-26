import { describe, expect, it } from 'vitest';
import { canonicalJson, sha256Hex } from './plugin-integrity.js';
import { manifestForIntegrity, parsePluginManifest } from './plugin-manifest.js';
import { PluginSandboxError, PluginSandboxHostImpl, defaultPluginSandboxPolicy } from './plugin-sandbox.js';
import { createDependencyLock, decidePluginUpdateTrust, verifyDependencyLock, verifyPluginSupplyChain } from './plugin-supply-chain.js';
import type { PluginInstallRecord, PluginManifest, PluginPackage } from './plugin-types.js';

const base = {
  id: 'org.example.sandbox', name: 'Sandbox', description: 'bounded plugin', author: 'publisher', version: '1.0.0', formatVersion: 1, apiVersion: 1,
  entrypoint: 'dist/index.js', pluginType: 'EXECUTABLE', requestedCapabilities: [], extensionPoints: [], dependencies: [], optionalDependencies: [],
  keystoneCompatibility: { api: { min: 1, max: 1 } }, platformCompatibility: { api: { min: 1, max: 1 } }, createdAt: '2026-01-01T00:00:00.000Z',
} as const;

async function packageValue(overrides: Partial<PluginManifest> = {}): Promise<PluginPackage> {
  const executable = new Uint8Array([1, 2, 3]);
  const unsigned = { ...base, ...overrides } as PluginManifest;
  const payload = { manifest: manifestForIntegrity(unsigned), entrypoint: unsigned.entrypoint, executable: '010203', resources: {}, schemas: {}, uiBundle: undefined, migrations: {} };
  const manifest = { ...unsigned, integrity: { algorithm: 'SHA-256' as const, packageHash: await sha256Hex(canonicalJson(payload)), entrypointHash: 'a'.repeat(64), resourceHashes: {} } };
  return { manifest, executable, resources: {}, source: { kind: 'LOCAL_FILE', reference: '/tmp/plugin' } };
}

function record(manifest: PluginManifest): PluginInstallRecord {
  const revision = { version: manifest.version, packageHash: manifest.integrity.packageHash, installedAt: manifest.createdAt, source: { kind: 'LOCAL_FILE' as const } };
  return { pluginId: manifest.id, manifest, state: 'INSTALLED_DISABLED', runtimeState: 'UNLOADED', currentRevision: revision, previousRevisions: [], grants: [], resourceBudget: { cpuClass: 'STANDARD', memoryBytes: 1024, storageBytes: 1024, networkRequestsPerMinute: 1, backgroundSecondsPerHour: 1, eventRatePerSecond: 1, toolRegistrations: 1, uiExtensions: 1, maxEventQueue: 2 }, crashHistory: [], storageUsageBytes: 0, storageSchemaVersion: 1, updatedAt: manifest.createdAt };
}

describe('R0P62 sandbox boundary', () => {
  it('binds capabilities to plugin, revision and live sandbox session', async () => {
    const pkg = await packageValue(); const host = new PluginSandboxHostImpl(() => 1_700_000_000_000); const session = await host.createSession(record(pkg.manifest));
    const token = host.issueCapabilityToken({ pluginId: pkg.manifest.id, revisionHash: pkg.manifest.integrity.packageHash, sandboxSessionId: session.sessionId, capability: 'messages.read', scope: 'plugin', ownerIdentity: 'alice' });
    expect(host.consumeCapabilityToken(token, { pluginId: pkg.manifest.id, revisionHash: pkg.manifest.integrity.packageHash, sessionId: session.sessionId, capability: 'messages.read' }).uses).toBe(1);
    await host.terminate(session.sessionId, 'STOPPED');
    expect(() => host.consumeCapabilityToken(token, { pluginId: pkg.manifest.id, revisionHash: pkg.manifest.integrity.packageHash, sessionId: session.sessionId, capability: 'messages.read' })).toThrowError(PluginSandboxError);
  });

  it('rejects IPC forgery, namespace escape, process access and local network SSRF', async () => {
    const pkg = await packageValue(); const host = new PluginSandboxHostImpl(); const session = await host.createSession(record(pkg.manifest), defaultPluginSandboxPolicy({ network: 'SCOPED' }));
    expect(() => host.validateIpc({ version: 1, sessionId: session.sessionId, pluginId: 'other', revisionHash: session.revisionHash, correlationId: 'x', operation: 'read', payload: {} }, { pluginId: pkg.manifest.id, revisionHash: session.revisionHash, sessionId: session.sessionId })).toThrow(/malformed/);
    expect(() => host.authorizeFilesystem(session.sessionId, '../outside', 'read')).toThrow(/escapes/);
    expect(() => host.authorizeProcess(session.sessionId, 'child_process.spawn')).toThrow(/denied/);
    expect(() => host.authorizeNetwork(session.sessionId, 'http://127.0.0.1:8080', ['http://127.0.0.1:8080'])).toThrow(/outside/);
    expect(host.violations(session.sessionId).map(item => item.class)).toEqual(expect.arrayContaining(['INVALID_IPC', 'NAMESPACE_ESCAPE', 'UNAUTHORIZED_PROCESS', 'UNAUTHORIZED_NETWORK']));
  });

  it('uses bounded JSON IPC and disallows arbitrary values/depth', async () => {
    const pkg = await packageValue(); const host = new PluginSandboxHostImpl(); const session = await host.createSession(record(pkg.manifest));
    const deep: Record<string, unknown> = {}; let cursor = deep; for (let index = 0; index < 10; index++) { cursor.next = {}; cursor = cursor.next as Record<string, unknown>; }
    expect(() => host.validateIpc({ version: 1, sessionId: session.sessionId, pluginId: pkg.manifest.id, revisionHash: session.revisionHash, correlationId: 'x', operation: 'read', payload: deep }, { pluginId: pkg.manifest.id, revisionHash: session.revisionHash, sessionId: session.sessionId })).toThrow(PluginSandboxError);
  });
});

describe('R0P62 supply chain', () => {
  it('verifies exact dependency lock identity and rejects confusion', async () => {
    const manifest = (await packageValue({ dependencies: [{ id: 'org.example.parser', version: '1.2.3', integrity: 'b'.repeat(64) }] })).manifest;
    const lock = createDependencyLock(manifest); expect(() => verifyDependencyLock(manifest, lock)).not.toThrow();
    expect(() => verifyDependencyLock(manifest, { ...lock, dependencies: [{ ...lock.dependencies[0]!, id: 'example-parser' }] })).toThrow();
  });

  it('separates a valid signature from security approval and rejects malformed package updates', async () => {
    const pkg = await packageValue({ signatureMetadata: { algorithm: 'ED25519', signerIdentity: 'publisher', keyId: 'key-1', signature: 'signature' } });
    const verification = await verifyPluginSupplyChain(pkg, { verifier: { async verify() { return true; } } });
    expect(verification.signature).toBe('SIGNED'); expect(verification.publisher).toBe('VERIFIED_PUBLISHER'); expect(verification.security).toBe('REVIEW_REQUIRED');
    const decision = decidePluginUpdateTrust({ pluginId: pkg.manifest.id, from: { version: '0.9.0', packageHash: 'c'.repeat(64), installedAt: pkg.manifest.createdAt, source: pkg.source }, to: { version: pkg.manifest.version, packageHash: pkg.manifest.integrity.packageHash, installedAt: pkg.manifest.createdAt, source: pkg.source }, verification, addedCapabilities: ['messages.read'] });
    expect(decision.decision).toBe('REVIEW');
  });
});
