import { createSocket } from 'node:dgram';
import { mkdtemp, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcess } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import DHT from 'hyperdht';
import { IdentityManager } from '../identity.js';

type Role = 'alice' | 'bob';
type Config = { readonly root: string; readonly bootstrap: string; readonly seeds: Record<Role, string> };
type Command = { readonly action: 'create' | 'share' | 'received' | 'wire' | 'stats' | 'stop'; readonly peer?: Role };
interface Response { readonly ok: boolean; readonly result?: any; readonly error?: string; }

const roots: string[] = [];
const peers: ChildProcess[] = [];
const logs = new Map<string, string>();

afterEach(async () => {
  await Promise.all(peers.splice(0).map(stopProcess));
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

describe('R0P82 real Fabric/Hyperswarm place sharing', () => {
  it('shares one explicit Place reference across two independent processes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'keystone-r0p82-maps-network-')); roots.push(root);
    const port = await freeUdpPort();
    const bootstrap = DHT.bootstrapper(port, '127.0.0.1');
    try {
      const seeds = { alice: (await IdentityManager.generate()).masterSeed, bob: (await IdentityManager.generate()).masterSeed } as Record<Role, string>;
      const configPath = join(root, 'maps.json');
      await atomicWrite(configPath, { root, bootstrap: `127.0.0.1:${port}`, seeds } satisfies Config);
      const alice = await startPeer('alice', configPath);
      const bob = await startPeer('bob', configPath);

      const created = await command(root, 'alice', { action: 'create' });
      expect(created.result).toMatchObject({ placeId: 'r0p82-real-shared-place', displayName: 'R0P82 real shared cafe', coordinates: { latitude: 55.7512, longitude: 37.6184 } });
      await command(root, 'alice', { action: 'share', peer: 'bob' });
      const wire = await command(root, 'alice', { action: 'wire' });
      expect(wire.result.type).toBe('maps.place.share');
      expect(wire.result.body).toMatchObject({ kind: 'PLACE_SHARE', encrypted: true, visibility: 'PRIVATE' });
      expect(JSON.stringify(wire.result.body)).not.toContain('r0p82-real-shared-place');
      expect(JSON.stringify(wire.result.body)).not.toContain('55.7512');
      expect(JSON.stringify(wire.result.body)).not.toContain('Controlled street 1');

      const received = await eventually(async () => {
        const response = await commandMaybe(root, 'bob', { action: 'received' });
        return response.ok && response.result?.placeId === 'r0p82-real-shared-place' ? response : false;
      }, 40_000, () => logsText());
      expect(received.result).toMatchObject({ placeId: 'r0p82-real-shared-place', provenance: { kind: 'RECEIVED_KEYSTONE' }, coordinates: { latitude: 55.7512, longitude: 37.6184 } });
      expect(JSON.stringify(received.result)).not.toMatch(/currentLocation|locationFix|movementHistory|gps/i);
      expect((await command(root, 'bob', { action: 'stats' })).result).toMatchObject({ received: 1, rejected: 0 });

      await command(root, 'alice', { action: 'stop' });
      await command(root, 'bob', { action: 'stop' });
      await Promise.all([waitExit(alice), waitExit(bob)]);
      expect(childExited(alice)).toBe(true);
      expect(childExited(bob)).toBe(true);
    } finally {
      await bootstrap.destroy().catch(() => undefined);
    }
  }, 180_000);
});

async function startPeer(role: Role, configPath: string): Promise<ChildProcess> {
  const coreRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
  const vitest = join(coreRoot, 'node_modules', 'vitest', 'vitest.mjs');
  const directory = join(dirname(configPath), role);
  await unlink(join(directory, 'ready.json')).catch(ignoreMissing);
  await unlink(join(directory, 'command.json')).catch(ignoreMissing);
  const child = spawn(process.execPath, [vitest, 'run', 'src/testing/maps-network-peer.test.ts', '--pool=forks', '--poolOptions.forks.singleFork=true'], {
    cwd: coreRoot,
    detached: process.platform !== 'win32',
    env: { ...process.env, KEYSTONE_MAPS_CONFIG: configPath, KEYSTONE_MAPS_ROLE: role },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  peers.push(child);
  let output = '';
  logs.set(role, output);
  const collect = (value: Buffer): void => { output += String(value); logs.set(role, output); };
  child.stdout?.on('data', collect); child.stderr?.on('data', collect);
  await eventually(async () => readJson(join(directory, 'ready.json')), 40_000, () => output.slice(-8_000));
  return child;
}

async function command(root: string, role: Role, input: Command): Promise<Response> {
  const response = await commandMaybe(root, role, input);
  if (!response.ok) throw new Error(`${role} command ${input.action} failed: ${response.error}`);
  return response;
}

async function commandMaybe(root: string, role: Role, input: Command): Promise<Response> {
  const id = crypto.randomUUID();
  const directory = join(root, role);
  await atomicWrite(join(directory, 'command.json'), { ...input, id });
  return eventually(async () => readJson<Response>(join(directory, `response-${id}.json`)), 40_000, () => logsText());
}

async function eventually<T>(condition: () => Promise<T | false | undefined>, timeoutMs: number, detail?: () => string): Promise<T> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) { const value = await condition(); if (value) return value; await pause(75); }
  throw new Error(`Timed out after ${timeoutMs}ms${detail ? `: ${detail()}` : ''}`);
}

async function freeUdpPort(): Promise<number> {
  const socket = createSocket('udp4');
  await new Promise<void>((resolve, reject) => { socket.once('error', reject); socket.bind(0, '127.0.0.1', () => resolve()); });
  const address = socket.address(); socket.close();
  return typeof address === 'string' ? 0 : address.port;
}

async function readJson<T>(path: string): Promise<T | undefined> {
  try { return JSON.parse(await readFile(path, 'utf8')) as T; }
  catch (error: any) { if (error?.code === 'ENOENT' || error instanceof SyntaxError) return undefined; throw error; }
}
async function atomicWrite(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
  await rename(temporary, path);
}
function ignoreMissing(error: any): void { if (error?.code !== 'ENOENT') throw error; }
async function pause(ms: number): Promise<void> { await new Promise(resolve => setTimeout(resolve, ms)); }
function childExited(child: ChildProcess): boolean { return child.exitCode !== null || child.signalCode !== null; }
function signalPeerTree(child: ChildProcess, signal: NodeJS.Signals): void { if (child.pid === undefined) return; if (process.platform !== 'win32') { try { process.kill(-child.pid, signal); return; } catch { /* fall through */ } } try { child.kill(signal); } catch { /* already exited */ } }
function waitExit(child: ChildProcess): Promise<void> { return childExited(child) ? Promise.resolve() : new Promise(resolve => child.once('exit', () => resolve())); }
async function stopProcess(child: ChildProcess): Promise<void> { if (childExited(child)) return; const exited = waitExit(child); signalPeerTree(child, 'SIGTERM'); await Promise.race([exited, pause(2_000)]); if (!childExited(child)) { const killed = waitExit(child); signalPeerTree(child, 'SIGKILL'); await Promise.race([killed, pause(500)]); } }
function logsText(): string { return [...logs.entries()].map(([name, value]) => `${name}: ${value.slice(-8_000)}`).join('\n'); }
