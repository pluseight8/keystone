import { createSocket } from 'node:dgram';
import { mkdir, mkdtemp, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { spawn, type ChildProcess } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import DHT from 'hyperdht';
import { IdentityManager } from '../identity.js';

type Role = 'alice' | 'alice_phone';
type Config = { root: string; bootstrap: string; seeds: Record<Role, string> };
type Command = {
  id: string;
  action: 'meshEnrollRequest' | 'meshAuthorize' | 'meshAccept' | 'meshReplicate' | 'meshFlush' | 'meshRead' | 'meshRevoke' | 'meshFallbackSpoof' | 'continuitySend' | 'continuityFlush' | 'continuityRead' | 'continuityOpen' | 'continuityCancel' | 'stop';
  peer?: Role;
  text?: string;
  messageId?: string;
  objectId?: string;
  objectType?: string;
  objectVersion?: string;
  payload?: unknown;
  meshRequest?: unknown;
  meshAuthorization?: unknown;
  reason?: string;
  confirm?: boolean;
};
type Response = { ok: boolean; result?: any; error?: string };

const roots: string[] = [];
const ownedChildren = new Set<ChildProcess>();
const activeChildren = new Map<Role, ChildProcess>();
let handlersInstalled = false;
let shutdownRequested = false;
let maxConcurrentPeers = 0;

function signalChildTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  if (process.platform !== 'win32') {
    try { process.kill(-child.pid, signal); return; } catch { /* fall through to direct child */ }
  }
  try { child.kill(signal); } catch { /* already exited */ }
}

function livePeerCount(): number {
  return [...ownedChildren].filter(child => !childExited(child) && !child.killed).length;
}

function childExited(child: ChildProcess): boolean { return child.exitCode !== null || child.signalCode !== null; }

function reportResources(label: string): void {
  const rssMiB = Math.round(process.memoryUsage().rss / 1024 / 1024);
  console.error(`[R0P73-RESOURCE] ${label} peers=${livePeerCount()} maxPeers=${maxConcurrentPeers} vitestWorkers=2 parentRssMiB=${rssMiB}`);
}

function installInterruptCleanup(): void {
  if (handlersInstalled) return;
  handlersInstalled = true;
  const terminate = (signal: NodeJS.Signals): void => {
    if (shutdownRequested) return;
    shutdownRequested = true;
    for (const child of ownedChildren) signalChildTree(child, 'SIGTERM');
    const timer = setTimeout(() => {
      for (const child of ownedChildren) signalChildTree(child, 'SIGKILL');
      process.exit(signal === 'SIGINT' ? 130 : 143);
    }, 500);
    timer.unref?.();
  };
  process.once('SIGINT', () => terminate('SIGINT'));
  process.once('SIGTERM', () => terminate('SIGTERM'));
  process.once('exit', () => { for (const child of ownedChildren) signalChildTree(child, 'SIGKILL'); });
}

describe('R0P73 bounded real Personal Device Mesh network', () => {
  it('enrolls, replicates, resumes, and revokes two independent Hyperswarm devices', async () => {
    installInterruptCleanup();
    reportResources('before');
    const root = await mkdtemp(join('/tmp', 'keystone-r0p73-mesh-'));
    roots.push(root);
    const port = await freeUdpPort();
    const bootstrap = DHT.bootstrapper(port, '127.0.0.1');
    try {
      const seed = (await IdentityManager.generate()).masterSeed;
      const configPath = join(root, 'network.json');
      const config: Config = { root, bootstrap: `127.0.0.1:${port}`, seeds: { alice: seed, alice_phone: seed } };
      await atomicWrite(configPath, config);

      await startPeer('alice', configPath);
      await startPeer('alice_phone', configPath);
      expect(livePeerCount()).toBe(2);

      const beforeEnrollment = await command(root, 'alice_phone', { action: 'meshRead', peer: 'alice' });
      expect(beforeEnrollment.result.devices).toHaveLength(0);
      expect(beforeEnrollment.result.revoked).toBe(false);

      const request = await command(root, 'alice_phone', { action: 'meshEnrollRequest', text: 'Alice phone mesh', messageId: 'android' });
      const authorization = await command(root, 'alice', { action: 'meshAuthorize', meshRequest: request.result.request, confirm: true });
      expect((await command(root, 'alice_phone', { action: 'meshAccept', meshAuthorization: authorization.result.authorization })).result.accepted).toBe(true);
      await eventually(async () => (await command(root, 'alice', { action: 'meshRead' })).result.devices.some((value: { deviceId: string; state: string }) => value.deviceId === request.result.request.deviceId && value.state === 'TRUSTED'));
      await eventually(async () => (await command(root, 'alice_phone', { action: 'meshRead' })).result.devices.some((value: { deviceId: string; state: string }) => value.deviceId === request.result.request.deviceId && value.state === 'TRUSTED'));
      expect((await command(root, 'alice_phone', { action: 'meshAccept', meshAuthorization: authorization.result.authorization })).result.accepted).toBe(false);

      const handoff = await command(root, 'alice', { action: 'continuitySend', peer: 'alice_phone', objectType: 'place', objectId: 'place:network-trip', payload: { objectId: 'place:network-trip', placeId: 'place:network-trip', displayName: 'Network trip place', snapshot: { displayName: 'Network trip place', approximateRegion: 'Moscow' } } });
      expect(handoff.result.type).toBe('place');
      await eventually(async () => (await command(root, 'alice_phone', { action: 'continuityRead' })).result.inbox.some((value: { requestId: string; status: string }) => value.requestId === handoff.result.requestId && value.status === 'DELIVERED_TO_DEVICE'));
      expect((await command(root, 'alice_phone', { action: 'continuityOpen', objectId: handoff.result.requestId })).result.status).toBe('ACCEPTED');
      await eventually(async () => (await command(root, 'alice', { action: 'continuityRead' })).result.outbox.some((value: { requestId: string; status: string }) => value.requestId === handoff.result.requestId && value.status === 'ACCEPTED'));

      const replicated = await command(root, 'alice', { action: 'meshReplicate', peer: 'alice_phone', objectId: 'mesh:bounded-trip', objectType: 'shared-note', objectVersion: '1', payload: { title: 'Trip plan', body: 'same signed object' } });
      expect(replicated.result.requests).toHaveLength(1);
      await command(root, 'alice', { action: 'meshFlush', peer: 'alice_phone' });
      await eventually(async () => (await command(root, 'alice_phone', { action: 'meshRead' })).result.replicas.some((value: { objectId: string; status: string }) => value.objectId === 'mesh:bounded-trip' && value.status === 'CONFIRMED'));
      await eventually(async () => (await command(root, 'alice', { action: 'meshRead' })).result.replicas.some((value: { objectId: string; status: string }) => value.objectId === 'mesh:bounded-trip' && value.status === 'CONFIRMED'));

      await command(root, 'alice', { action: 'meshFallbackSpoof', peer: 'alice_phone' });
      await pause(300);
      expect((await command(root, 'alice_phone', { action: 'meshRead' })).result.replicas.some((value: { objectId: string }) => value.objectId === 'mesh:fallback-signature')).toBe(false);

      await stopPeer('alice_phone');
      const offlineStarted = Date.now();
      const offline = await command(root, 'alice', { action: 'meshReplicate', peer: 'alice_phone', objectId: 'mesh:offline-resume', objectType: 'note', objectVersion: '1', payload: { body: 'resume after restart' } });
      const offlineDuration = Date.now() - offlineStarted;
      console.error(`[R0P73-TIMELINE] offline local meshReplicate durationMs=${offlineDuration}`);
      expect(offlineDuration).toBeLessThan(2_000);
      expect(offline.result.requests).toHaveLength(1);
      expect((await command(root, 'alice', { action: 'meshRead', peer: 'alice_phone' })).result.pending.length).toBeGreaterThan(0);
      const offlineHandoff = await command(root, 'alice', { action: 'continuitySend', peer: 'alice_phone', objectType: 'browser', objectId: 'browser:offline-resume', payload: { url: 'https://example.test/offline-resume', title: 'Offline resume' } });
      expect(['QUEUED', 'SENDING']).toContain(offlineHandoff.result.status);
      expect((await command(root, 'alice', { action: 'continuityRead' })).result.outbox.some((value: { requestId: string }) => value.requestId === offlineHandoff.result.requestId)).toBe(true);

      await startPeer('alice_phone', configPath);
      await flushUntilConfirmed(root, 'mesh:offline-resume');
      await pause(700);
      await eventually(async () => { await command(root, 'alice', { action: 'continuityFlush', peer: 'alice_phone' }); return (await command(root, 'alice_phone', { action: 'continuityRead' })).result.inbox.some((value: { requestId: string }) => value.requestId === offlineHandoff.result.requestId); }, 45_000);

      await stopPeer('alice_phone');
      const revocation = await command(root, 'alice', { action: 'meshRevoke', peer: 'alice_phone', reason: 'lost phone' });
      expect(revocation.result.trustEpoch).toBeGreaterThan(0);
      const noRoute = await command(root, 'alice', { action: 'meshRead', peer: 'alice_phone' });
      expect(noRoute.result.revoked).toBe(true);

      await startPeer('alice_phone', configPath);
      expect((await command(root, 'alice_phone', { action: 'meshRead' })).result.revoked).toBe(false);
      const noNewState = await command(root, 'alice', { action: 'meshReplicate', peer: 'alice_phone', objectId: 'mesh:after-revoke', objectType: 'note', objectVersion: '1', payload: { body: 'must not be queued' } });
      expect(noNewState.result.requests).toHaveLength(0);
      expect((await commandMaybe(root, 'alice', { action: 'continuitySend', peer: 'alice_phone', objectType: 'browser', objectId: 'browser:after-revoke', payload: { url: 'https://example.test/after-revoke' } })).ok).toBe(false);
      await flushUntilRevoked(root);
      expect((await commandMaybe(root, 'alice_phone', { action: 'meshReplicate', peer: 'alice', objectId: 'mesh:revoked-request', objectType: 'note', payload: { body: 'must reject' } })).ok).toBe(false);

      await stopPeer('alice');
      await startPeer('alice', configPath);
      expect((await command(root, 'alice', { action: 'meshRead', peer: 'alice_phone' })).result.devices.some((value: { deviceId: string; state: string }) => value.state === 'REVOKED')).toBe(true);
      expect((await command(root, 'alice_phone', { action: 'meshRead' })).result.revoked).toBe(true);
      reportResources('after');
    } finally {
      await bootstrap.destroy();
    }
  }, 300_000);
});

async function startPeer(role: Role, configPath: string): Promise<ChildProcess> {
  const coreRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
  const vitest = join(coreRoot, 'node_modules', 'vitest', 'vitest.mjs');
  const directory = join(dirname(configPath), role);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await Promise.all(['ready.json', 'command.json'].map(name => unlink(join(directory, name)).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; })));
  const child = spawn(process.execPath, [vitest, 'run', 'src/testing/network-peer.test.ts', '--pool=forks', '--poolOptions.forks.singleFork=true'], {
    cwd: coreRoot,
    detached: process.platform !== 'win32',
    env: { ...process.env, KEYSTONE_NETWORK_CONFIG: configPath, KEYSTONE_NETWORK_ROLE: role, KEYSTONE_NETWORK_DIRECTORY: directory },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  ownedChildren.add(child);
  activeChildren.set(role, child);
  maxConcurrentPeers = Math.max(maxConcurrentPeers, livePeerCount());
  let output = '';
  child.stdout?.on('data', value => { output += String(value); });
  child.stderr?.on('data', value => { output += String(value); });
  await eventually(async () => !!(await readJson(join(directory, 'ready.json'))), 30_000, () => output);
  reportResources(`start:${role}`);
  return child;
}

async function stopPeer(role: Role): Promise<void> {
  const child = activeChildren.get(role);
  if (!child) return;
  activeChildren.delete(role);
  if (childExited(child)) return;
  const terminated = waitExit(child);
  signalChildTree(child, 'SIGTERM');
  await Promise.race([terminated, pause(2_000)]);
  if (!childExited(child)) {
    const killed = waitExit(child);
    signalChildTree(child, 'SIGKILL');
    await Promise.race([killed, pause(500)]);
  }
  expect(childExited(child)).toBe(true);
  reportResources(`stop:${role}`);
}

async function command(root: string, role: Role, input: Omit<Command, 'id'>): Promise<Response> {
  const id = crypto.randomUUID();
  const directory = join(root, role);
  await atomicWrite(join(directory, 'command.json'), { id, ...input });
  const response = await eventually(async () => readJson<Response>(join(directory, `response-${id}.json`)), 30_000);
  if (!response.ok) throw new Error(`${role} command ${input.action} failed: ${response.error}`);
  return response;
}

async function commandMaybe(root: string, role: Role, input: Omit<Command, 'id'>): Promise<Response> {
  const id = crypto.randomUUID();
  const directory = join(root, role);
  await atomicWrite(join(directory, 'command.json'), { id, ...input });
  return eventually(async () => readJson<Response>(join(directory, `response-${id}.json`)), 30_000);
}

async function flushUntilConfirmed(root: string, objectId: string): Promise<void> {
  await eventually(async () => {
    await command(root, 'alice', { action: 'meshFlush', peer: 'alice_phone' });
    return (await command(root, 'alice_phone', { action: 'meshRead' })).result.replicas.some((value: { objectId: string; status: string }) => value.objectId === objectId && value.status === 'CONFIRMED');
  }, 45_000);
}

async function flushUntilRevoked(root: string): Promise<void> {
  await eventually(async () => {
    await command(root, 'alice', { action: 'meshFlush', peer: 'alice_phone' });
    return (await command(root, 'alice_phone', { action: 'meshRead' })).result.revoked === true;
  }, 45_000);
}

async function eventually<T>(condition: () => Promise<T | false | undefined>, timeout = 12_000, detail?: () => string): Promise<T> {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await condition();
    if (value) return value;
    await pause(50);
  }
  throw new Error(`Timed out after ${timeout}ms${detail ? `: ${detail()}` : ''}`);
}

async function freeUdpPort(): Promise<number> {
  const socket = createSocket('udp4');
  await new Promise<void>((resolve, reject) => { socket.once('error', reject); socket.bind(0, '127.0.0.1', () => resolve()); });
  const address = socket.address();
  socket.close();
  return typeof address === 'string' ? 0 : address.port;
}

async function readJson<T>(path: string): Promise<T | undefined> {
  try { return JSON.parse(await readFile(path, 'utf8')) as T; } catch (error: any) { if (error?.code === 'ENOENT' || error instanceof SyntaxError) return undefined; throw error; }
}

async function atomicWrite(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
  await rename(temporary, path);
}

async function waitExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  await new Promise<void>(resolve => child.once('exit', () => resolve()));
}

function pause(ms: number): Promise<void> { return new Promise(resolve => setTimeout(resolve, ms)); }

afterEach(async () => {
  await Promise.all([...activeChildren.keys()].map(stopPeer));
  for (const child of ownedChildren) if (!childExited(child)) signalChildTree(child, 'SIGKILL');
  if (process.env.KEEP_REAL_NETWORK_ROOT !== '1') await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })));
});
