import { createServer } from 'node:net';
import { mkdtemp, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcess } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import type { LoopbackNearbyPeerAddress } from './nearby-exchange-loopback.js';

type Role = 'alice' | 'bob';
interface Config { readonly root: string; readonly peers: Record<Role, LoopbackNearbyPeerAddress>; }
type Command = { readonly action: 'offer' | 'incoming' | 'accept' | 'status' | 'wire' | 'stop' };
interface Response { readonly ok: boolean; readonly result?: any; readonly error?: string; }

const roots: string[] = [];
const peers: ChildProcess[] = [];
const logs = new Map<string, string>();

afterEach(async () => {
  await Promise.all(peers.splice(0).map(stopProcess));
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

describe('R0P85 independent-process nearby exchange proof', () => {
  it('transfers an explicitly accepted object over real R0P68 session crypto and a loopback link', async () => {
    const root = await mkdtemp(join(tmpdir(), 'keystone-r0p85-nearby-network-')); roots.push(root);
    const [aliceTcp, bobTcp, aliceUdp, bobUdp] = await Promise.all([freeTcpPort(), freeTcpPort(), freeUdpPort(), freeUdpPort()]);
    const config: Config = { root, peers: {
      alice: { host: '127.0.0.1', tcpPort: aliceTcp, udpPort: aliceUdp },
      bob: { host: '127.0.0.1', tcpPort: bobTcp, udpPort: bobUdp },
    } };
    const configPath = join(root, 'nearby.json'); await atomicWrite(configPath, config);
    const alice = await startPeer('alice', configPath);
    const bob = await startPeer('bob', configPath);
    const offered = await command(root, 'alice', { action: 'offer' });
    expect(offered.result).toMatchObject({ objectType: 'text', status: 'OFFERED' });
    const incoming = await eventually(async () => commandMaybe(root, 'bob', { action: 'incoming' }), value => value.ok && value.result?.some((item: { offerId: string }) => item.offerId === offered.result.offerId), 20_000);
    expect(incoming.ok).toBe(true);
    await command(root, 'bob', { action: 'accept' });
    const received = await eventually(async () => commandMaybe(root, 'bob', { action: 'status' }), value => value.ok && value.result?.transfers?.some((item: { status: string }) => item.status === 'RECEIVED'), 20_000);
    expect(received.result.transfers).toContainEqual(expect.objectContaining({ status: 'RECEIVED', objectType: 'text' }));
    expect(received.result.diagnostics.nearbyEvidence).toBe('IMPLEMENTED');
    const wire = await command(root, 'alice', { action: 'wire' });
    const loopbackBytes = wire.result.frames.map((frame: string) => Buffer.from(frame, 'base64url').toString('utf8')).join('');
    expect(loopbackBytes).not.toContain('R0P85 independent-process nearby payload');
    expect(loopbackBytes).not.toContain('keystone.nearby.exchange.r0p85');
    expect(wire.result.diagnostics.fabricAvailable).toBe(false);
    await command(root, 'alice', { action: 'stop' });
    await command(root, 'bob', { action: 'stop' });
    await Promise.all([waitExit(alice), waitExit(bob)]);
    expect(childExited(alice)).toBe(true);
    expect(childExited(bob)).toBe(true);
  }, 180_000);
});

async function startPeer(role: Role, configPath: string): Promise<ChildProcess> {
  const coreRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
  const vitest = join(coreRoot, 'node_modules', 'vitest', 'vitest.mjs');
  const directory = join(dirname(configPath), role);
  await unlink(join(directory, 'ready.json')).catch(ignoreMissing);
  const child = spawn(process.execPath, [vitest, 'run', 'src/testing/nearby-exchange-network-peer.test.ts', '--pool=forks', '--poolOptions.forks.singleFork=true'], {
    cwd: coreRoot,
    detached: process.platform !== 'win32',
    env: { ...process.env, KEYSTONE_NEARBY_CONFIG: configPath, KEYSTONE_NEARBY_ROLE: role },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  peers.push(child);
  let output = '';
  logs.set(role, output);
  const collect = (value: Buffer): void => { output += String(value); logs.set(role, output); };
  child.stdout?.on('data', collect); child.stderr?.on('data', collect);
  await eventually(async () => readJson(join(directory, 'ready.json')), value => !!value, 40_000, () => output.slice(-8_000));
  return child;
}

async function command(root: string, role: Role, input: Command): Promise<Response> { const response = await commandMaybe(root, role, input); if (!response.ok) throw new Error(`${role} ${input.action} failed: ${response.error}`); return response; }
async function commandMaybe(root: string, role: Role, input: Command): Promise<Response> {
  const id = crypto.randomUUID(); const directory = join(root, role); await atomicWrite(join(directory, 'command.json'), { ...input, id });
  return eventually(async () => readJson<Response>(join(directory, `response-${id}.json`)), value => !!value, 40_000, () => logsText());
}
async function eventually<T>(condition: () => Promise<T | undefined>, predicate: (value: T) => boolean, timeoutMs: number, detail?: () => string): Promise<T> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) { const value = await condition(); if (value !== undefined && predicate(value)) return value; await pause(75); }
  throw new Error(`Timed out after ${timeoutMs}ms${detail ? `: ${detail()}` : ''}`);
}
async function freeTcpPort(): Promise<number> { const server = createServer(); await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve()); }); const address = server.address(); const port = typeof address === 'object' && address ? address.port : 0; await new Promise<void>(resolve => server.close(() => resolve())); return port; }
async function freeUdpPort(): Promise<number> { const { createSocket } = await import('node:dgram'); const socket = createSocket('udp4'); await new Promise<void>((resolve, reject) => { socket.once('error', reject); socket.bind(0, '127.0.0.1', () => resolve()); }); const address = socket.address(); const port = typeof address === 'object' ? address.port : 0; socket.close(); return port; }
async function readJson<T>(path: string): Promise<T | undefined> { try { return JSON.parse(await readFile(path, 'utf8')) as T; } catch (error: any) { if (error?.code === 'ENOENT' || error instanceof SyntaxError) return undefined; throw error; } }
async function atomicWrite(path: string, value: unknown): Promise<void> { const temporary = `${path}.${crypto.randomUUID()}.tmp`; await writeFile(temporary, JSON.stringify(value), { mode: 0o600 }); await rename(temporary, path); }
function ignoreMissing(error: any): void { if (error?.code !== 'ENOENT') throw error; }
async function pause(ms: number): Promise<void> { await new Promise(resolve => setTimeout(resolve, ms)); }
function childExited(child: ChildProcess): boolean { return child.exitCode !== null || child.signalCode !== null; }
function signalPeerTree(child: ChildProcess, signal: NodeJS.Signals): void { if (child.pid === undefined) return; if (process.platform !== 'win32') { try { process.kill(-child.pid, signal); return; } catch { /* fall through */ } } try { child.kill(signal); } catch { /* already exited */ } }
function waitExit(child: ChildProcess): Promise<void> { return childExited(child) ? Promise.resolve() : new Promise(resolve => child.once('exit', () => resolve())); }
async function stopProcess(child: ChildProcess): Promise<void> { if (childExited(child)) return; const exited = waitExit(child); signalPeerTree(child, 'SIGTERM'); await Promise.race([exited, pause(2_000)]); if (!childExited(child)) { const killed = waitExit(child); signalPeerTree(child, 'SIGKILL'); await Promise.race([killed, pause(500)]); } }
function logsText(): string { return [...logs.entries()].map(([role, value]) => `${role}: ${value.slice(-8_000)}`).join('\n'); }
