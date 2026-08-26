import { createSocket } from 'node:dgram';
import { afterEach, describe, expect, it } from 'vitest';
import DHT from 'hyperdht';
import Hyperswarm from 'hyperswarm';
import { IdentityManager } from '../identity.js';
import { ContactEnvelopeSecurity, type SocialContact } from '../social/messaging.js';
import type { Envelope } from '../transport.js';
import { HyperswarmTransport } from '../transport.js';

const transports: HyperswarmTransport[] = [];
const bootstraps: Array<{ destroy(): Promise<void> }> = [];
afterEach(async () => { await Promise.all(transports.splice(0).map(value => value.close())); await Promise.all(bootstraps.splice(0).map(value => value.destroy())); });

describe('real transport secret isolation', () => {
  it('rejects a signed peer payload that attempts to carry a system secret', async () => {
    const port = await freePort();
    const bootstrap = DHT.bootstrapper(port, '127.0.0.1'); bootstraps.push(bootstrap);
    const alice = await (await IdentityManager.generate()).sessionKeys('alice');
    const bob = await (await IdentityManager.generate()).sessionKeys('bob');
    const aliceSecurity = new ContactEnvelopeSecurity(alice, [{ nodeId: bob.nodeId, signingPublicKey: bob.publicKey, encryptionPublicKey: bob.encryptionPublicKey } satisfies SocialContact]);
    const bobSecurity = new ContactEnvelopeSecurity(bob, [{ nodeId: alice.nodeId, signingPublicKey: alice.publicKey, encryptionPublicKey: alice.encryptionPublicKey } satisfies SocialContact]);
    let delivered = 0; let rejected = 0;
    const options = (security: ContactEnvelopeSecurity) => ({ requireEnvelopeVerification: true as const, verifyEnvelope: (envelope: Envelope) => security.verify(envelope), onRejected: () => { rejected += 1; } });
    const aliceTransport = new HyperswarmTransport(Buffer.from(alice.publicKey, 'base64url'), () => new Hyperswarm({ dht: new DHT({ bootstrap: [`127.0.0.1:${port}`] }) }), undefined, () => new DHT({ bootstrap: [`127.0.0.1:${port}`] }), undefined, undefined, options(aliceSecurity));
    const bobTransport = new HyperswarmTransport(Buffer.from(bob.publicKey, 'base64url'), () => new Hyperswarm({ dht: new DHT({ bootstrap: [`127.0.0.1:${port}`] }) }), undefined, () => new DHT({ bootstrap: [`127.0.0.1:${port}`] }), undefined, undefined, options(bobSecurity));
    transports.push(aliceTransport, bobTransport);
    aliceTransport.onMessage(() => { delivered += 1; });
    await aliceTransport.start(); await bobTransport.start(); await bobTransport.connect(alice.nodeId);
    const unsigned = { version: 1 as const, type: 'security.secret.hostile', id: crypto.randomUUID(), sender: bob.nodeId, recipient: alice.nodeId, nonce: crypto.randomUUID(), expiresAt: new Date(Date.now() + 30_000).toISOString(), body: { safety: 'SAFE', privateKey: 'attacker-controlled', providerCredential: { accessToken: 'attacker-token' } } };
    const hostileEnvelope = { ...unsigned, signature: await bobSecurity.sign(unsigned) };
    await expect(bobTransport.send(alice.nodeId, hostileEnvelope)).rejects.toThrow(/secret material/i);
    const payload = Buffer.from(JSON.stringify(hostileEnvelope), 'utf8');
    const connection = (bobTransport as unknown as { peers: Map<string, { write(data: Buffer): boolean }> }).peers.get(alice.nodeId);
    if (!connection) throw new Error('Bob is not connected to Alice');
    const frame = Buffer.allocUnsafe(4 + payload.byteLength); frame.writeUInt32BE(payload.byteLength, 0); payload.copy(frame, 4); connection.write(frame);
    await waitFor(() => rejected > 0, 10_000);
    expect(delivered).toBe(0);
    expect(rejected).toBeGreaterThan(0);
  }, 30_000);
});

async function freePort(): Promise<number> { const socket = createSocket('udp4'); await new Promise<void>((resolve, reject) => { socket.once('error', reject); socket.bind(0, '127.0.0.1', () => resolve()); }); const address = socket.address(); socket.close(); return typeof address === 'string' ? 0 : address.port; }
async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> { const until = Date.now() + timeoutMs; while (Date.now() < until) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 50)); } throw new Error('Timed out waiting for hostile payload rejection'); }
