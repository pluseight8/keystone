import { describe, expect, it } from 'vitest';
import { ConnectivityFabric, ControlledTransportProvider, FABRIC_DELIVERY_ACK_TYPE, FabricTransport, type OpaqueFrame, type TransportSession } from './connectivity.js';
import type { Envelope } from './transport.js';

const security = { sign: async (_: Omit<Envelope, 'signature'>) => 'test-signature', verify: async (_: Envelope) => true };

/** Accepts the first `drops` frames like a socket that is being replaced, without delivering them. */
class LossyProvider extends ControlledTransportProvider {
  resetPeer?: (destination: string) => void;
  constructor(id: string, private drops: number) { super(id); }
  override async sendOpaqueFrame(session: TransportSession, frame: OpaqueFrame): Promise<void> {
    if (this.drops > 0) { this.drops -= 1; return; }
    return super.sendOpaqueFrame(session, frame);
  }
}

function node(id: string, provider: ControlledTransportProvider, retransmitDelaysMs?: readonly number[]): FabricTransport {
  const fabric = new ConnectivityFabric(); fabric.registerProvider(provider);
  return new FabricTransport({ fabric, localNodeId: id, applicationSecurity: security, ...(retransmitDelaysMs ? { retransmitDelaysMs } : {}) });
}

function envelope(sender: string, recipient: string, type = 'test.object'): Envelope {
  return { version: 1, type, id: crypto.randomUUID(), sender, recipient, nonce: crypto.randomUUID(), expiresAt: new Date(Date.now() + 60_000).toISOString(), body: { value: 'payload' }, signature: 'test-signature' };
}

async function until(condition: () => boolean, timeoutMs = 2_000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!condition()) { if (Date.now() > end) throw new Error('condition timed out'); await new Promise(resolve => setTimeout(resolve, 5)); }
}

describe('FabricTransport destination acknowledgements', () => {
  it('resends an envelope whose first frame was silently lost and delivers it once', async () => {
    const aliceProvider = new LossyProvider('alice-provider', 1); const bobProvider = new ControlledTransportProvider('bob-provider');
    aliceProvider.connectPeer('bob', bobProvider); bobProvider.connectPeer('alice', aliceProvider);
    const alice = node('alice', aliceProvider, [30, 60, 120]); const bob = node('bob', bobProvider, [30, 60, 120]);
    await alice.start(); await bob.start();
    const received: Envelope[] = []; bob.onMessage(value => { received.push(value); });
    const sent = envelope('alice', 'bob');
    await alice.send('bob', sent);
    expect(received).toHaveLength(0);
    await until(() => received.length === 1 && alice.unacknowledgedCount === 0);
    await new Promise(resolve => setTimeout(resolve, 200));
    expect(received.map(value => value.id)).toEqual([sent.id]);
    await alice.close(); await bob.close();
  });

  it('acknowledges again when the first acknowledgement was lost, without running the handler twice', async () => {
    const aliceProvider = new ControlledTransportProvider('alice-provider'); const bobProvider = new LossyProvider('bob-provider', 1);
    aliceProvider.connectPeer('bob', bobProvider); bobProvider.connectPeer('alice', aliceProvider);
    // One quick resend, then a long gap: only a real re-acknowledgement can clear the entry within the wait.
    const alice = node('alice', aliceProvider, [30, 10_000]); const bob = node('bob', bobProvider, [30, 60, 120]);
    await alice.start(); await bob.start();
    const received: Envelope[] = []; bob.onMessage(value => { received.push(value); });
    await alice.send('bob', envelope('alice', 'bob'));
    await until(() => received.length === 1);
    expect(alice.unacknowledgedCount).toBe(1); // Bob's first ack was dropped
    await until(() => alice.unacknowledgedCount === 0);
    expect(received).toHaveLength(1);
    await alice.close(); await bob.close();
  });

  it('drops the connection before resending again when resends stay unacknowledged', async () => {
    const aliceProvider = new LossyProvider('alice-provider', 100); const resets: string[] = []; aliceProvider.resetPeer = destination => { resets.push(destination); };
    aliceProvider.connectPeer('bob', new ControlledTransportProvider('bob-sink'));
    const alice = node('alice', aliceProvider, [20, 20, 20]); await alice.start();
    await alice.send('bob', envelope('alice', 'bob'));
    await until(() => resets.length >= 1);
    expect(resets[0]).toBe('bob');
    await until(() => alice.unacknowledgedCount === 0);
    expect(resets).toHaveLength(2); // second and third resend, not the first
    await alice.close();
  });

  it('redials after frame loss and confirms delivery when the first ACK on the new session is also lost', async () => {
    const sender = new LossyProvider('alice-provider', 2);
    const receiver = new LossyProvider('bob-provider', 1);
    sender.connectPeer('bob', new ControlledTransportProvider('stale-bob'));
    receiver.connectPeer('alice', sender);
    const resets: string[] = [];
    sender.resetPeer = destination => {
      resets.push(destination);
      sender.connectPeer(destination, receiver);
    };
    const alice = node('alice', sender, [20, 20, 20]);
    const bob = node('bob', receiver, []);
    try {
      await alice.start();
      await bob.start();
      const sent = envelope('alice', 'bob');
      const received: string[] = [];
      bob.onMessage(value => { received.push(value.id); });
      await alice.send('bob', sent);
      await until(() => received.length === 1 && alice.unacknowledgedCount === 0);
      expect(resets).toEqual(['bob', 'bob']);
      expect(received).toEqual([sent.id]);
    } finally {
      await Promise.all([alice.close(), bob.close()]);
    }
  });

  it('stops resending once the destination acknowledges', async () => {
    const aliceProvider = new ControlledTransportProvider('alice-provider'); const bobProvider = new ControlledTransportProvider('bob-provider');
    aliceProvider.connectPeer('bob', bobProvider); bobProvider.connectPeer('alice', aliceProvider);
    const alice = node('alice', aliceProvider, [50, 50, 50]); const bob = node('bob', bobProvider, [50, 50, 50]);
    await alice.start(); await bob.start();
    const received: Envelope[] = []; bob.onMessage(value => { received.push(value); });
    await alice.send('bob', envelope('alice', 'bob'));
    await until(() => alice.unacknowledgedCount === 0);
    await new Promise(resolve => setTimeout(resolve, 250));
    expect(received).toHaveLength(1);
    await alice.close(); await bob.close();
  });

  it('ignores an acknowledgement sent by someone other than the destination', async () => {
    const aliceProvider = new ControlledTransportProvider('alice-provider'); const malloryProvider = new ControlledTransportProvider('mallory-provider');
    aliceProvider.connectPeer('mallory', malloryProvider); malloryProvider.connectPeer('alice', aliceProvider);
    aliceProvider.connectPeer('bob', new ControlledTransportProvider('bob-sink'));
    const alice = node('alice', aliceProvider, [10_000]); const mallory = node('mallory', malloryProvider, []);
    await alice.start(); await mallory.start();
    const sent = envelope('alice', 'bob');
    await alice.send('bob', sent);
    expect(alice.unacknowledgedCount).toBe(1);
    await mallory.send('alice', { ...envelope('mallory', 'alice', FABRIC_DELIVERY_ACK_TYPE), body: { ids: [sent.id] } });
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(alice.unacknowledgedCount).toBe(1);
    await alice.close(); await mallory.close();
  });

  it('does not track envelopes when acknowledgements are disabled', async () => {
    const aliceProvider = new ControlledTransportProvider('alice-provider'); aliceProvider.connectPeer('bob', new ControlledTransportProvider('bob-sink'));
    const alice = node('alice', aliceProvider, []); await alice.start();
    await alice.send('bob', envelope('alice', 'bob'));
    expect(alice.unacknowledgedCount).toBe(0);
    await alice.close();
  });
});
