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
type Command = { action: string; peer?: Role; manifest?: unknown; maxChunks?: number };
type Response = { ok: boolean; result?: any; error?: string };

const roots: string[] = [];
const children = new Map<Role, ChildProcess>();
const peerLogs = new Map<Role, string>();
let interrupted = false;

function signalTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  if (process.platform !== 'win32') {
    try { process.kill(-child.pid, signal); return; } catch { /* fall through */ }
  }
  try { child.kill(signal); } catch { /* already exited */ }
}

function installCleanup(): void {
  if (interrupted) return;
  const terminate = (signal: NodeJS.Signals): void => {
    if (interrupted) return;
    interrupted = true;
    for (const child of children.values()) signalTree(child, 'SIGTERM');
    const timer = setTimeout(() => {
      for (const child of children.values()) signalTree(child, 'SIGKILL');
      process.exit(signal === 'SIGINT' ? 130 : 143);
    }, 500);
    timer.unref?.();
  };
  process.once('SIGINT', () => terminate('SIGINT'));
  process.once('SIGTERM', () => terminate('SIGTERM'));
  process.once('exit', () => { for (const child of children.values()) signalTree(child, 'SIGKILL'); });
}

describe('R0P74 bounded real distributed content delivery', () => {
  it('serves multi-chunk content over Hyperswarm/Noise and resumes after receiver restart', async () => {
    installCleanup();
    const startedAt = Date.now();
    const root = await mkdtemp(join('/tmp', 'keystone-r0p74-content-'));
    roots.push(root);
    const port = await freeUdpPort();
    const bootstrap = DHT.bootstrapper(port, '127.0.0.1');
    try {
      const seed = (await IdentityManager.generate()).masterSeed;
      const config: Config = { root, bootstrap: `127.0.0.1:${port}`, seeds: { alice: seed, alice_phone: seed } };
      const configPath = join(root, 'network.json');
      await atomicWrite(configPath, config);

      await startPeer('alice', configPath);
      await startPeer('alice_phone', configPath);
      const served = await command(root, 'alice', { action: 'distributedContentServe', peer: 'alice_phone' });
      const manifest = served.result.manifest as { contentId: string; chunks: readonly string[]; byteLength: number };
      expect(manifest.contentId).toMatch(/^sha256-[a-f0-9]{64}$/);
      expect(manifest.byteLength).toBe(4 * 1024 * 1024);
      expect(manifest.chunks).toHaveLength(32);

      const partial = await command(root, 'alice_phone', { action: 'distributedContentFetch', peer: 'alice', manifest, maxChunks: 2 });
      expect(partial.result.complete).toBe(false);
      expect(partial.result.state).toBe('PAUSED');
      expect(partial.result.completedChunks).toBe(2);
      expect(partial.result.missing.length).toBe(manifest.chunks.length - 2);

      await stopPeer('alice_phone');
      await startPeer('alice_phone', configPath);
      const resumed = await command(root, 'alice_phone', { action: 'distributedContentFetch', peer: 'alice', manifest });
      expect(resumed.result.complete).toBe(true);
      expect(resumed.result.state).toBe('COMPLETE');
      expect(resumed.result.completedChunks).toBe(manifest.chunks.length);
      expect(resumed.result.missing).toHaveLength(0);
      expect(resumed.result.diagnostics.maxInFlightChunks).toBeLessThanOrEqual(2);

      const persisted = await command(root, 'alice_phone', { action: 'distributedContentRead', manifest });
      expect(persisted.result.session.state.state).toBe('COMPLETE');
      expect(persisted.result.availability).toBe('complete content local');
      console.error(`[R0P74-TIMELINE] bounded content proof durationMs=${Date.now() - startedAt} chunks=${manifest.chunks.length}`);
    } finally {
      await Promise.all([...children.keys()].map(stopPeer));
      await bootstrap.destroy();
    }
  }, 300_000);
});

async function startPeer(role: Role, configPath: string): Promise<void> {
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
  children.set(role, child);
  let output = '';
  peerLogs.set(role, output);
  child.stdout?.on('data', value => { output += String(value); peerLogs.set(role, output); });
  child.stderr?.on('data', value => { output += String(value); peerLogs.set(role, output); });
  try {
    await eventually(async () => !!(await readJson(join(directory, 'ready.json'))), 30_000);
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${output.slice(-8_000)}`);
  }
}

async function stopPeer(role: Role): Promise<void> {
  const child = children.get(role);
  if (!child) return;
  children.delete(role);
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = waitExit(child);
  signalTree(child, 'SIGTERM');
  await Promise.race([exited, pause(2_000)]);
  if (child.exitCode === null && child.signalCode === null) {
    const killed = waitExit(child);
    signalTree(child, 'SIGKILL');
    await Promise.race([killed, pause(500)]);
  }
  if (child.exitCode === null && child.signalCode === null) throw new Error(`Peer ${role} did not exit`);
}

async function command(root: string, role: Role, input: Command): Promise<Response> {
  const id = crypto.randomUUID();
  const directory = join(root, role);
  await atomicWrite(join(directory, 'command.json'), { id, ...input });
  let response: Response | undefined;
  try {
    response = await eventually(async () => readJson<Response>(join(directory, `response-${id}.json`)), 60_000);
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${[...peerLogs.entries()].map(([name, log]) => `${name}: ${log.slice(-8_000)}`).join('\n')}`);
  }
  if (!response.ok) throw new Error(`${role} command ${input.action} failed: ${response.error}`);
  return response;
}

async function eventually<T>(condition: () => Promise<T | false | undefined>, timeoutMs = 12_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await condition();
    if (value) return value;
    await pause(50);
  }
  throw new Error(`Timed out after ${timeoutMs}ms`);
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
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>(resolve => child.once('exit', () => resolve()));
}

function pause(ms: number): Promise<void> { return new Promise(resolve => setTimeout(resolve, ms)); }

afterEach(async () => {
  await Promise.all([...children.keys()].map(stopPeer));
  if (process.env.KEEP_REAL_NETWORK_ROOT !== '1') await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })));
});
