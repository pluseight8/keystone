import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CoreExternalLinkGateway, DefaultNativeHostPolicy, NativeHostError, NativeFileSystemService, TestNativeHost, TestSecureStorage, createProductionNativeHost, createTestNativeHost, LinuxSecretToolStorage, LocalNetworkTransport, NativeLocalNetworkHost, PhysicalE2EHarness, PhysicalFeatureProbe } from './index.js';

const owner = (capability: any, extra: Record<string, unknown> = {}) => ({ requestId: `req:${Math.random()}`, capability, principal: { kind: 'OWNER_UI' as const, id: 'owner' }, ...extra });
const remote = (capability: any) => ({ requestId: `req:${Math.random()}`, capability, principal: { kind: 'REMOTE_PEER' as const, id: 'peer' } });

describe('R0P65 NativeHost boundary', () => {
  it('keeps production and test hosts distinct and does not silently use test secure storage', () => {
    const test = createTestNativeHost(); expect(test.environment).toBe('TEST'); expect(test.feature('secureStorage').state).toBe('AVAILABLE');
    const production = createProductionNativeHost({ root: join(tmpdir(), `keystone-native-test-${Date.now()}`) }); expect(production.environment).toBe('PRODUCTION'); expect(['DEGRADED', 'UNAVAILABLE']).toContain(production.feature('secureStorage').state);
  });
  it('preserves provenance and rejects remote/confused-deputy requests', async () => {
    const host = createTestNativeHost();
    await expect(host.request(remote('audio.playback'), async () => 'bad')).resolves.toMatchObject({ accepted: false, error: 'POLICY_DENIED' });
    await expect(host.request({ ...owner('audio.playback'), principal: { kind: 'PLUGIN', id: 'p', chain: ['REMOTE_PEER'] } }, async () => 'bad')).resolves.toMatchObject({ accepted: false, error: 'POLICY_DENIED' });
  });
  it('uses scoped filesystem handles and rejects traversal/symlink escape/stale sessions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'keystone-native-fs-')); const fs = new NativeFileSystemService(root, () => 'session-1'); await fs.init(); const path = join(root, 'owner_selected', 'a.txt'); await writeFile(path, 'ok');
    const handle = await fs.selectFile(path, owner('filesystem.select'), { writable: true }); expect(new TextDecoder().decode(await handle.read())).toBe('ok'); await handle.write(new TextEncoder().encode('changed')); expect(new TextDecoder().decode(await handle.read())).toBe('changed');
    await expect(fs.selectFile(join(root, 'owner_selected', '..', 'core-durable', 'x'), owner('filesystem.select'))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(fs.openApplicationFile('../escape', 'CACHE', owner('filesystem.write'), { writable: true })).rejects.toMatchObject({ code: 'POLICY_DENIED' });
    const outside = join(root, 'outside'); await writeFile(outside, 'secret'); await symlink(outside, join(root, 'owner_selected', 'link')); await expect(fs.selectFile(join(root, 'owner_selected', 'link'), owner('filesystem.select'))).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    const stale = new NativeFileSystemService(root, () => 'session-2'); await expect(stale.read(handle)).rejects.toMatchObject({ code: 'HANDLE_INVALID' }); await rm(root, { recursive: true, force: true });
  });
  it('never exposes secret bytes through opaque handles', async () => {
    const store = new TestSecureStorage(); const request = owner('secure-storage.write'); const handle = await store.put('identity', new Uint8Array([1, 2, 3]), request); expect(handle.toJSON()).not.toHaveProperty('secret'); expect(handle.toJSON()).not.toHaveProperty('bytes'); await expect(store.status(handle, owner('secure-storage.read'))).resolves.toMatchObject({ state: 'ACTIVE', exportable: false });
    await expect(store.sign(handle, new Uint8Array([4]), remote('secure-storage.sign'))).rejects.toMatchObject({ code: 'POLICY_DENIED' });
  });
  it('keeps external URL and permissions behind explicit owner boundaries', async () => {
    const gateway = new CoreExternalLinkGateway(); await expect(gateway.openApprovedUrl('https://example.com', owner('external-link.open'))).rejects.toMatchObject({ code: 'POLICY_DENIED' }); await expect(gateway.openApprovedUrl('https://example.com', owner('external-link.open', { ownerConfirmed: true }))).resolves.toMatchObject({ accepted: true }); await expect(gateway.openApprovedUrl('http://127.0.0.1', owner('external-link.open', { ownerConfirmed: true }))).rejects.toBeInstanceOf(NativeHostError);
  });
  it('offers honest typed feature states for unavailable hardware', () => { const host = new TestNativeHost(); expect(host.feature('bluetooth').state).toBe('UNAVAILABLE'); expect(host.feature('wifiDirect').state).toBe('UNSUPPORTED'); expect(host.feature('camera').state).toBe('UNAVAILABLE'); });

  it('keeps location behind the narrow host adapter and rejects remote/native escalation', async () => {
    const host = new TestNativeHost();
    expect(host.feature('location').state).toBe('UNAVAILABLE');
    expect((await host.location().permission(owner('location.current'))).status).toBe('UNAVAILABLE');
    await expect(host.request(remote('location.current'), async () => ({ latitude: 1 }))).resolves.toMatchObject({ accepted: false, error: 'POLICY_DENIED' });
    await expect(host.request({ ...owner('location.watch'), ownerConfirmed: false }, async () => undefined)).resolves.toMatchObject({ accepted: false, error: 'POLICY_DENIED' });
  });

  it('does not let a test adapter claim physical verification', () => {
    const evidence = PhysicalE2EHarness.simulated('bluetooth');
    expect(evidence.classification).toBe('SIMULATED');
    expect(evidence.evidence.statuses).not.toContain('PHYSICALLY_VERIFIED');
  });

  it('probes Linux capabilities with explicit evidence and keeps Bluetooth identity opaque', async () => {
    const results = await new PhysicalFeatureProbe('linux').all(['filesystem', 'lanDiscovery', 'bluetooth', 'wifiDirect', 'location']);
    expect(results).toHaveLength(5);
    expect(results.find(item => item.feature === 'filesystem')?.evidence.statuses).toContain('PHYSICALLY_VERIFIED');
    expect(results.find(item => item.feature === 'lanDiscovery')?.classification).toBe('SAME_HOST');
    expect(results.find(item => item.feature === 'wifiDirect')?.classification).toBe('UNSUPPORTED');
    expect(results.find(item => item.feature === 'location')?.classification).toBe('UNSUPPORTED');
    for (const item of results) expect(JSON.stringify(item)).not.toMatch(/ownerIdentity|username|serialNumber|macAddress/i);
  });

  it('moves framed opaque bytes through LocalNetworkTransport without using endpoint as identity', async () => {
    const transport = new LocalNetworkTransport(); let received: Uint8Array | undefined;
    const listener = await transport.listen((_connection, bytes) => { received = bytes; });
    const connection = await transport.connect('127.0.0.1', listener.port, () => undefined);
    const ciphertext = new Uint8Array([0, 255, 7, 44]); transport.send(connection, ciphertext);
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(received).toEqual(ciphertext); expect(connection.transport).toBe('LocalNetworkTransport'); expect(connection).not.toHaveProperty('identity');
    await transport.close(connection); await listener.close();
  });

  it('uses production Linux Secret Service when available and otherwise remains unavailable', async () => {
    const storage = new LinuxSecretToolStorage();
    if (!storage.available()) return;
    const available = await storage.probe();
    if (!available) return;
    const request = owner('secure-storage.write'); const handle = await storage.put('r0p66-test', new Uint8Array([3, 1, 4]), request);
    expect(handle.toJSON()).not.toHaveProperty('bytes'); expect(handle.toJSON()).not.toHaveProperty('secret');
    await expect(storage.status(handle, owner('secure-storage.read'))).resolves.toMatchObject({ state: 'ACTIVE', exportable: false });
    await storage.revoke(handle, owner('secure-storage.write')); await expect(storage.status(handle, owner('secure-storage.read'))).rejects.toBeInstanceOf(NativeHostError);
  });
});
