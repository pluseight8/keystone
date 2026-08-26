import { mkdtemp, rm } from 'node:fs/promises';
import { createSocket } from 'node:dgram';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcess } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import DHT from 'hyperdht';
import Hyperswarm from 'hyperswarm';
import { IdentityManager } from '../identity.js';
import { ContactEnvelopeSecurity, type SocialContact } from '../social/messaging.js';
import type { Envelope } from '../transport.js';
import { HyperswarmTransport } from '../transport.js';

const childMode = process.env.KEYSTONE_HOSTILE_PEER_CHILD === '1';
const childAttack = process.env.KEYSTONE_HOSTILE_PEER_ATTACK;
const childBootstrap = process.env.KEYSTONE_HOSTILE_PEER_BOOTSTRAP;
const childTopic = process.env.KEYSTONE_HOSTILE_PEER_TOPIC;
const children: ChildProcess[] = [];
const roots: string[] = [];

afterEach(async () => { await Promise.all(children.splice(0).map(stop)); await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

describe('real hostile protocol client', () => {
  it('keeps legitimate peers operating while a process sends forged and oversized traffic', async () => {
    if (childMode) { await runHostileChild(); return; }
    const root = await mkdtemp(join(tmpdir(), 'keystone-hostile-network-')); roots.push(root);
    const port = await freePort(); const bootstrap = DHT.bootstrapper(port, '127.0.0.1');
    const aliceIdentity = await IdentityManager.generate(); const bobIdentity = await IdentityManager.generate(); const alice = await aliceIdentity.sessionKeys('alice'); const bob = await bobIdentity.sessionKeys('bob');
    const aliceContact: SocialContact = { nodeId: bob.nodeId, signingPublicKey: bob.publicKey, encryptionPublicKey: bob.encryptionPublicKey }; const bobContact: SocialContact = { nodeId: alice.nodeId, signingPublicKey: alice.publicKey, encryptionPublicKey: alice.encryptionPublicKey };
    const aliceSecurity = new ContactEnvelopeSecurity(alice, [aliceContact]); const bobSecurity = new ContactEnvelopeSecurity(bob, [bobContact]); let received = 0;
    const transportOptions = (security: ContactEnvelopeSecurity) => ({ requireEnvelopeVerification: true as const, verifyEnvelope: (envelope: Envelope) => security.verify(envelope) });
    const aliceTransport = new HyperswarmTransport(Buffer.from(alice.publicKey, 'base64url'), () => new Hyperswarm({ dht: new DHT({ bootstrap: [`127.0.0.1:${port}`] }) }), undefined, () => new DHT({ bootstrap: [`127.0.0.1:${port}`] }), undefined, undefined, transportOptions(aliceSecurity));
    const bobTransport = new HyperswarmTransport(Buffer.from(bob.publicKey, 'base64url'), () => new Hyperswarm({ dht: new DHT({ bootstrap: [`127.0.0.1:${port}`] }) }), undefined, () => new DHT({ bootstrap: [`127.0.0.1:${port}`] }), undefined, undefined, transportOptions(bobSecurity));
    try {
      await aliceTransport.start(); await bobTransport.start(); aliceTransport.onMessage(() => { received += 1; }); await bobTransport.connect(alice.nodeId);
      const unsigned = { version: 1 as const, type: 'security.hostile.valid', id: 'legitimate-1', sender: bob.nodeId, recipient: alice.nodeId, nonce: 'legitimate-nonce', expiresAt: new Date(Date.now() + 30_000).toISOString(), body: { text: 'legitimate peers continue' } }; await bobTransport.send(alice.nodeId, { ...unsigned, signature: await bobSecurity.sign(unsigned) });
      await waitFor(() => received === 1, 15_000);
      await runHostile(root, port, await topicFor(alice.publicKey), 'forged'); await runHostile(root, port, await topicFor(alice.publicKey), 'oversized');
      const second = { ...unsigned, id: 'legitimate-2', nonce: 'legitimate-nonce-2', signature: await bobSecurity.sign({ ...unsigned, id: 'legitimate-2', nonce: 'legitimate-nonce-2' }) }; await bobTransport.send(alice.nodeId, second); await waitFor(() => received === 2, 15_000);
      expect(received).toBe(2);
    } finally { await aliceTransport.close(); await bobTransport.close(); await bootstrap.destroy(); }
  }, 60_000);
});

async function runHostileChild(): Promise<void> {
  if (!childBootstrap || !childTopic || (childAttack !== 'forged' && childAttack !== 'oversized')) throw new Error('Missing hostile child configuration');
  const swarm = new Hyperswarm({ dht: new DHT({ bootstrap: [childBootstrap] }) }); let sent = false;
  swarm.on('connection', connection => { (connection as unknown as { on?: (event: string, handler: (...args: unknown[]) => void) => void }).on?.('error', () => undefined); if (sent) return; sent = true; if (childAttack === 'oversized') { const header = Buffer.alloc(4); header.writeUInt32BE(0xffffffff, 0); connection.write(header); } else { const payload = Buffer.from(JSON.stringify({ version: 1, type: 'security.hostile.valid', id: 'forged-safe', sender: 'f'.repeat(64), recipient: 'a'.repeat(64), nonce: 'forged-nonce', expiresAt: new Date(Date.now() + 30_000).toISOString(), body: { official: true, safety: 'SAFE' }, signature: 'not-a-signature' })); const frame = Buffer.alloc(payload.length + 4); frame.writeUInt32BE(payload.length, 0); payload.copy(frame, 4); connection.write(frame); } setTimeout(() => (connection as unknown as { destroy?: () => void }).destroy?.(), 100); }); await swarm.join(Buffer.from(childTopic, 'hex'), { server: false, client: true }); await swarm.flush(); await new Promise(resolve => setTimeout(resolve, 1_500)); await swarm.destroy();
}

async function runHostile(root: string, port: number, topic: string, attack: 'forged' | 'oversized'): Promise<void> {
  const coreRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url)))); const vitest = join(coreRoot, 'node_modules', 'vitest', 'vitest.mjs'); const marker = join(root, `${attack}.done`); const child = spawn(process.execPath, [vitest, 'run', 'src/testing/hostile-network.test.ts', '--pool=forks', '--poolOptions.forks.singleFork=true'], { cwd: coreRoot, env: { ...process.env, KEYSTONE_HOSTILE_PEER_CHILD: '1', KEYSTONE_HOSTILE_PEER_ATTACK: attack, KEYSTONE_HOSTILE_PEER_BOOTSTRAP: `127.0.0.1:${port}`, KEYSTONE_HOSTILE_PEER_TOPIC: topic, KEYSTONE_HOSTILE_PEER_MARKER: marker }, stdio: ['ignore', 'pipe', 'pipe'] }); children.push(child); await new Promise<void>((resolve, reject) => { let output = ''; child.stdout?.on('data', value => { output += value; }); child.stderr?.on('data', value => { output += value; }); child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Hostile process failed (${code}): ${output}`))); });
}

async function freePort(): Promise<number> { const socket = createSocket('udp4'); await new Promise<void>((resolve, reject) => { socket.once('error', reject); socket.bind(0, '127.0.0.1', () => resolve()); }); const address = socket.address(); socket.close(); return typeof address === 'string' ? 0 : address.port; }
async function topicFor(publicKey: string): Promise<string> { const digest = await crypto.subtle.digest('SHA-256', Buffer.from(publicKey, 'base64url')); return Buffer.from(digest).toString('hex'); }
async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> { const end = Date.now() + timeoutMs; while (Date.now() < end) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 50)); } throw new Error('Timed out waiting for legitimate message'); }
async function stop(child: ChildProcess): Promise<void> { if (child.exitCode !== null) return; child.kill('SIGTERM'); await new Promise(resolve => child.once('exit', resolve)); }
