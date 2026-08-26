import { afterEach, describe, expect, it } from 'vitest';
import DHT from 'hyperdht';
import Hyperswarm from 'hyperswarm';
import { IdentityManager } from '../identity.js';
import { ContactEnvelopeSecurity } from '../social/messaging.js';
import { ConnectivityFabric, FabricTransport, HyperswarmTransportProvider } from '../connectivity.js';
import { HyperswarmTransport, type Envelope } from '../transport.js';

const processes: Array<{ close(): Promise<void> }> = [];
afterEach(async () => { await Promise.all(processes.splice(0).map(value => value.close())); });

describe('real Hyperswarm through ConnectivityFabric', () => {
  it('carries the same signed application envelope over two independent Fabric instances', async () => {
    const port = await freeUdpPort(); const bootstrap = DHT.bootstrapper(port, '127.0.0.1');
    try {
      const alice = await IdentityManager.generate(); const bob = await IdentityManager.generate(); const aliceKeys = await IdentityManager.fromMasterSeed(alice.masterSeed).sessionKeys('alice'); const bobKeys = await IdentityManager.fromMasterSeed(bob.masterSeed).sessionKeys('bob');
      const aliceSecurity = new ContactEnvelopeSecurity(aliceKeys, [{ nodeId: bobKeys.nodeId, signingPublicKey: bobKeys.publicKey, encryptionPublicKey: bobKeys.encryptionPublicKey }]); const bobSecurity = new ContactEnvelopeSecurity(bobKeys, [{ nodeId: aliceKeys.nodeId, signingPublicKey: aliceKeys.publicKey, encryptionPublicKey: aliceKeys.encryptionPublicKey }]);
      const rawAlice = new HyperswarmTransport(Buffer.from(aliceKeys.publicKey, 'base64url'), () => new Hyperswarm({ dht: new DHT({ bootstrap: [`127.0.0.1:${port}`] }) }), undefined, () => new DHT({ bootstrap: [`127.0.0.1:${port}`] }), undefined, undefined, { requireEnvelopeVerification: true, verifyEnvelope: envelope => aliceSecurity.verify(envelope) });
      const rawBob = new HyperswarmTransport(Buffer.from(bobKeys.publicKey, 'base64url'), () => new Hyperswarm({ dht: new DHT({ bootstrap: [`127.0.0.1:${port}`] }) }), undefined, () => new DHT({ bootstrap: [`127.0.0.1:${port}`] }), undefined, undefined, { requireEnvelopeVerification: true, verifyEnvelope: envelope => bobSecurity.verify(envelope) });
      const aliceFabric = new ConnectivityFabric(); const bobFabric = new ConnectivityFabric(); aliceFabric.registerProvider(new HyperswarmTransportProvider(rawAlice, { sender: aliceKeys.nodeId, security: aliceSecurity, ownsTransport: true })); bobFabric.registerProvider(new HyperswarmTransportProvider(rawBob, { sender: bobKeys.nodeId, security: bobSecurity, ownsTransport: true }));
      const aliceTransport = new FabricTransport({ fabric: aliceFabric, localNodeId: aliceKeys.nodeId, applicationSecurity: aliceSecurity }); const bobTransport = new FabricTransport({ fabric: bobFabric, localNodeId: bobKeys.nodeId, applicationSecurity: bobSecurity });
      processes.push({ close: async () => { await aliceTransport.close(); await bobTransport.close(); await bootstrap.destroy(); } });
      const received: Envelope[] = []; bobTransport.onMessage(envelope => { received.push(envelope); }); await aliceTransport.start(); await bobTransport.start();
      const unsigned: Omit<Envelope, 'signature'> = { version: 1, type: 'connectivity.fabric.test', id: crypto.randomUUID(), sender: aliceKeys.nodeId, recipient: bobKeys.nodeId, nonce: crypto.randomUUID(), expiresAt: new Date(Date.now() + 60_000).toISOString(), body: { ciphertext: 'opaque application test' } }; const envelope: Envelope = { ...unsigned, signature: await aliceSecurity.sign(unsigned) };
      await aliceTransport.connect(bobKeys.nodeId); await aliceTransport.send(bobKeys.nodeId, envelope);
      await eventually(() => received.some(value => value.id === envelope.id)); expect(received.filter(value => value.id === envelope.id)).toHaveLength(1); expect(received[0]?.sender).toBe(aliceKeys.nodeId);
    } finally { await bootstrap.destroy().catch(() => undefined); }
  }, 180_000);
});

async function eventually(check: () => boolean, timeoutMs = 30_000): Promise<void> { const until = Date.now() + timeoutMs; while (Date.now() < until) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 100)); } throw new Error('Timed out waiting for Fabric network delivery'); }
async function freeUdpPort(): Promise<number> { const socket = await import('node:dgram').then(({ createSocket }) => createSocket('udp4')); return new Promise((resolve, reject) => { socket.once('error', reject); socket.bind(0, '127.0.0.1', () => { const address = socket.address(); if (typeof address === 'string') { socket.close(); reject(new Error('Unable to determine free port')); return; } const port = address.port; socket.close(() => resolve(port)); }); }); }
