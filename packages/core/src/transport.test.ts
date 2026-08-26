import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { HyperswarmTransport, type Envelope } from './transport.js';

/** Minimal authenticated-connection stand-in.  The test intentionally drives
 * the transport's private attach/process pipeline so the replacement race is
 * covered without opening another OS process or a real DHT. */
class FakeConnection extends EventEmitter {
  readonly remotePublicKey: Buffer;
  readonly writes: Buffer[] = [];
  destroyed = false;
  constructor(fill: number) { super(); this.remotePublicKey = Buffer.alloc(32, fill); }
  write(data: Buffer): boolean { this.writes.push(Buffer.from(data)); return true; }
  destroy(): void { if (this.destroyed) return; this.destroyed = true; this.emit('close'); }
}

function frame(value: Envelope): Uint8Array { return new TextEncoder().encode(JSON.stringify(value)); }

describe('HyperswarmTransport authenticated session replacement', () => {
  it('keeps the newest live connection after an older socket closes', async () => {
    const transport = new HyperswarmTransport(new Uint8Array(32));
    const first = new FakeConnection(7);
    const second = new FakeConnection(7);
    const attach = (transport as unknown as { attach(connection: FakeConnection, info?: { publicKey?: Buffer }): void }).attach.bind(transport);
    const processFrame = (transport as unknown as { processFrame(connection: FakeConnection, peer: string, bytes: Uint8Array): Promise<void> }).processFrame.bind(transport);
    const peers = (transport as unknown as { peers: Map<string, FakeConnection> }).peers;
    const noiseId = first.remotePublicKey.toString('hex');
    attach(first, { publicKey: first.remotePublicKey });
    attach(second, { publicKey: second.remotePublicKey });
    expect(peers.get(noiseId)).toBe(second);

    const envelope: Envelope = {
      version: 1,
      type: 'transport.session-replacement',
      id: 'replacement-message',
      sender: 'application-peer',
      recipient: 'application-recipient',
      nonce: 'replacement-nonce',
      expiresAt: new Date(Date.now() + 30_000).toISOString(),
      body: { opaque: true },
      signature: 'test-signature',
    };
    await processFrame(second, noiseId, frame(envelope));
    expect(peers.get(envelope.sender)).toBe(second);

    // The stale socket may close after the replacement frame.  Its cleanup
    // must not delete either the Noise or application peer association.
    first.destroy();
    expect(peers.get(noiseId)).toBe(second);
    expect(peers.get(envelope.sender)).toBe(second);

    second.destroy();
    expect(peers.has(noiseId)).toBe(false);
    expect(peers.has(envelope.sender)).toBe(false);
    await transport.close();
  });
});
