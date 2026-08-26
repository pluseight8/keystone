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
type Command = { readonly action: string; readonly objectId?: string; readonly peer?: Role; readonly invitationId?: string; readonly text?: string; readonly enabled?: boolean };
interface Response { readonly ok: boolean; readonly result?: any; readonly error?: string; }

const roots: string[] = [];
const peers: ChildProcess[] = [];
const logs = new Map<string, string>();

afterEach(async () => {
  await Promise.all(peers.splice(0).map(stopProcess));
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

describe('R0P81 real Fabric/Hyperswarm collaboration', () => {
  it('converges a private note across concurrent offline edits and restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'keystone-r0p81-collaboration-')); roots.push(root);
    const port = await freeUdpPort();
    const bootstrap = DHT.bootstrapper(port, '127.0.0.1');
    try {
      const seeds = { alice: (await IdentityManager.generate()).masterSeed, bob: (await IdentityManager.generate()).masterSeed } as Record<Role, string>;
      const configPath = join(root, 'collaboration.json');
      await atomicWrite(configPath, { root, bootstrap: `127.0.0.1:${port}`, seeds } satisfies Config);
      let alice = await startPeer('alice', configPath);
      let bob = await startPeer('bob', configPath);
      const objectId = 'r0p81-real-private-note';

      const created = await command(root, 'alice', { action: 'create', objectId });
      expect(created.result.private).toBe(true);
      const invitation = await command(root, 'alice', { action: 'share', objectId, peer: 'bob' });
      const invitationId = invitation.result.id as string;
      await eventually(async () => {
        const response = await commandMaybe(root, 'bob', { action: 'info', objectId });
        return response.ok && response.result?.invitations?.some((value: { id: string }) => value.id === invitationId) ? response : false;
      }, 30_000, () => [...logs.entries()].map(([name, value]) => `${name}: ${value.slice(-8_000)}`).join('\n'));
      await command(root, 'bob', { action: 'accept', objectId, invitationId });
      await eventually(async () => {
        const response = await commandMaybe(root, 'alice', { action: 'snapshot', objectId });
        return response.ok && response.result?.info?.participants?.some((value: { identityId: string; status: string }) => value.status === 'active' && value.identityId !== response.result.info.ownerId) ? response : false;
      }, 30_000);
      await eventually(async () => {
        const response = await commandMaybe(root, 'bob', { action: 'snapshot', objectId });
        return response.ok && response.result?.info?.participants?.some((value: { status: string }) => value.status === 'active') ? response : false;
      }, 30_000);

      const first = await command(root, 'alice', { action: 'edit', objectId, text: 'Alice online edit' });
      await eventually(async () => (await commandMaybe(root, 'bob', { action: 'snapshot', objectId })).result?.snapshot?.content === 'Alice online edit', 30_000);
      const second = await command(root, 'bob', { action: 'edit', objectId, text: 'Bob online edit' });
      await eventually(async () => (await commandMaybe(root, 'alice', { action: 'snapshot', objectId })).result?.snapshot?.content === 'Bob online edit', 30_000);
      expect(first.result.snapshot.content).toBe('Alice online edit');
      expect(second.result.snapshot.content).toBe('Bob online edit');
      await command(root, 'alice', { action: 'comment', objectId, text: 'A safe plain-text comment' });
      await eventually(async () => (await commandMaybe(root, 'bob', { action: 'snapshot', objectId })).result?.comments?.some((value: { body: string }) => value.body === 'A safe plain-text comment'), 30_000);

      // Disconnect both live providers, edit independently, and allow the
      // service's durable retry timer to flush after reconnect.  No explicit
      // collaboration flush command is used in this proof.
      await command(root, 'alice', { action: 'offline', enabled: true });
      await command(root, 'bob', { action: 'offline', enabled: true });
      await command(root, 'alice', { action: 'edit', objectId, text: 'Alice offline edit' });
      await command(root, 'bob', { action: 'edit', objectId, text: 'Bob offline edit' });
      const aliceOffline = await command(root, 'alice', { action: 'snapshot', objectId });
      const bobOffline = await command(root, 'bob', { action: 'snapshot', objectId });
      expect(aliceOffline.result.snapshot.content).toBe('Alice offline edit');
      expect(bobOffline.result.snapshot.content).toBe('Bob offline edit');
      await command(root, 'alice', { action: 'offline', enabled: false });
      await command(root, 'bob', { action: 'offline', enabled: false });
      let aliceReconnect: Response | undefined;
      await eventually(async () => {
        const response = await commandMaybe(root, 'alice', { action: 'snapshot', objectId }); aliceReconnect = response;
        const content = response.result?.snapshot?.content;
        return response.ok && typeof content === 'string' && content.includes('Alice offline edit') && content.includes('Bob offline edit') && response.result?.info?.pendingUpdates === 0 ? response : false;
      }, 40_000, () => JSON.stringify(aliceReconnect));
      const bobReconnect = await eventually(async () => {
        const response = await commandMaybe(root, 'bob', { action: 'snapshot', objectId });
        const content = response.result?.snapshot?.content;
        return response.ok && typeof content === 'string' && content.includes('Alice offline edit') && content.includes('Bob offline edit') && response.result?.info?.pendingUpdates === 0 ? response : false;
      }, 40_000);
      expect(bobReconnect.result.snapshot.content).toBe(aliceReconnect?.result.snapshot.content);
      const mergedContent = aliceReconnect?.result.snapshot.content as string;

      const wire = await command(root, 'alice', { action: 'wire', objectId });
      expect(wire.result.type).toBe('keystone.collaboration.update');
      expect((wire.result.body as { kind?: string }).kind).toBe('protected');
      expect(JSON.stringify(wire.result.body)).not.toContain('Bob offline edit');
      expect(JSON.stringify(wire.result.body)).not.toContain('A safe plain-text comment');

      await command(root, 'bob', { action: 'presence', objectId });
      await eventually(async () => (await commandMaybe(root, 'alice', { action: 'snapshot', objectId })).result?.presence?.some((value: { peerId: string }) => typeof value.peerId === 'string'), 30_000);

      await command(root, 'bob', { action: 'stop' });
      await waitExit(bob);
      bob = await startPeer('bob', configPath);
      const restarted = await eventually(async () => {
        const response = await commandMaybe(root, 'bob', { action: 'snapshot', objectId });
        return response.ok && response.result?.snapshot?.content === mergedContent ? response : false;
      }, 40_000);
      expect(restarted.result.comments.some((value: { body: string }) => value.body === 'A safe plain-text comment')).toBe(true);
      expect(restarted.result.presence).toHaveLength(0);
      expect((await command(root, 'alice', { action: 'stats' })).result.pendingUpdates).toBe(0);

      await command(root, 'alice', { action: 'stop' });
      await command(root, 'bob', { action: 'stop' });
      await Promise.all([waitExit(alice), waitExit(bob)]);
    } finally {
      await bootstrap.destroy();
    }
  }, 180_000);
});

async function startPeer(role: Role, configPath: string): Promise<ChildProcess> {
  const coreRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
  const vitest = join(coreRoot, 'node_modules', 'vitest', 'vitest.mjs');
  const directory = join(dirname(configPath), role);
  await unlink(join(directory, 'ready.json')).catch(ignoreMissing);
  await unlink(join(directory, 'command.json')).catch(ignoreMissing);
  const child = spawn(process.execPath, [vitest, 'run', 'src/testing/collaboration-network-peer.test.ts', '--pool=forks', '--poolOptions.forks.singleFork=true'], {
    cwd: coreRoot,
    detached: process.platform !== 'win32',
    env: { ...process.env, KEYSTONE_COLLAB_CONFIG: configPath, KEYSTONE_COLLAB_ROLE: role },
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
  return eventually(async () => readJson<Response>(join(directory, `response-${id}.json`)), 40_000, () => [...logs.entries()].map(([name, value]) => `${name}: ${value.slice(-3_000)}`).join('\n'));
}

async function eventually<T>(condition: () => Promise<T | false | undefined>, timeoutMs = 12_000, detail?: () => string): Promise<T> {
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
