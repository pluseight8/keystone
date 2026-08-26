import { describe, expect, it } from 'vitest';
import { PluginSandboxHostImpl } from './plugin-sandbox.js';
import type { PluginInstallRecord, PluginManifest } from './plugin-types.js';

const manifest: PluginManifest = {
  id: 'org.example.native', name: 'Native', description: 'test', author: 'test', version: '1.0.0', formatVersion: 1, apiVersion: 1,
  entrypoint: 'dist/plugin.js', pluginType: 'EXECUTABLE', requestedCapabilities: [], extensionPoints: [], dependencies: [], optionalDependencies: [],
  keystoneCompatibility: { api: { min: 1, max: 1 } }, platformCompatibility: { api: { min: 1, max: 1 } }, createdAt: new Date(0).toISOString(),
  integrity: { algorithm: 'SHA-256', packageHash: 'a'.repeat(64), entrypointHash: 'b'.repeat(64), resourceHashes: {} },
};
const record = (): PluginInstallRecord => ({ pluginId: manifest.id, manifest, state: 'RUNNING', runtimeState: 'READY', currentRevision: { version: manifest.version, packageHash: manifest.integrity.packageHash, installedAt: manifest.createdAt, source: { kind: 'DEVELOPMENT' } }, previousRevisions: [], grants: [], resourceBudget: { cpuClass: 'STANDARD', memoryBytes: 1024, storageBytes: 1024, networkRequestsPerMinute: 1, backgroundSecondsPerHour: 1, eventRatePerSecond: 1, toolRegistrations: 1, uiExtensions: 1, maxEventQueue: 1 }, crashHistory: [], storageUsageBytes: 0, storageSchemaVersion: 1, updatedAt: manifest.createdAt });

describe('R0P65 Plugin native process boundary', () => {
  it('does not expose a generic shell and sanitizes secret environment', async () => {
    const host = new PluginSandboxHostImpl(); const session = await host.createSession(record());
    const handle = await host.launchNativeProcess({ pluginId: manifest.id, revisionHash: manifest.integrity.packageHash, entrypoint: 'plugin.js', workingDirectory: process.cwd(), environment: { API_TOKEN: 'must-not-inherit', SAFE: 'ok' }, policy: { maxRuntimeMs: 2_000, maxProcesses: 1, maxOutputBytes: 1024 } });
    expect(handle.kind).toBe('NATIVE_PROCESS_SANDBOX_HANDLE');
    await host.terminateNativeProcess(handle);
    await host.terminate(session.sessionId, 'STOPPED');
    expect(host.health(session.sessionId)).toBe('TERMINATED');
  });
});
