import { describe, expect, it } from 'vitest';
import { AnonymousNearbyTransportProvider, ControlledNearbyNetwork } from './nearby.js';
import {
  InMemoryNearbyExchangeStorage,
  NearbyExchangeError,
  NearbyExchangeService,
  encodeNearbyReceiveQr,
  parseNearbyReceiveQr,
  type NearbyContactField,
  type NearbyIdentityDisclosure,
} from './nearby-exchange.js';

async function pause(ms = 20): Promise<void> { await new Promise(resolve => setTimeout(resolve, ms)); }

async function pair(options: { readonly aliceReceive?: boolean; readonly mtu?: number } = {}) {
  const network = new ControlledNearbyNetwork();
  const aliceProvider = new AnonymousNearbyTransportProvider({ adapter: network.createAdapter('alice'), providerId: 'nearby-alice', mtu: options.mtu ?? 4 * 1024 });
  const bobProvider = new AnonymousNearbyTransportProvider({ adapter: network.createAdapter('bob'), providerId: 'nearby-bob', mtu: options.mtu ?? 4 * 1024 });
  const alice = new NearbyExchangeService({ nearby: aliceProvider, localAlias: 'Alice laptop', storage: new InMemoryNearbyExchangeStorage() });
  const bob = new NearbyExchangeService({ nearby: bobProvider, localAlias: 'Bob phone', storage: new InMemoryNearbyExchangeStorage() });
  await bob.startReceive({ policy: options.aliceReceive === false ? 'NOT_ACCEPTING' : 'ASK_EVERY_TIME', alias: 'Bob phone' });
  await alice.start();
  await pause();
  await alice.refreshDiscovery();
  await pause();
  return { alice, bob, network };
}

describe('R0P85 NearbyExchangeService', () => {
  it('discovers an anonymous endpoint and keeps social identity separate', async () => {
    const { alice, bob } = await pair();
    try {
      const endpoints = await alice.listNearby();
      expect(endpoints).toHaveLength(1);
      expect(endpoints[0]).toMatchObject({ alias: 'Bob phone', socialState: 'ANONYMOUS', visible: true });
      expect(JSON.stringify(endpoints[0])).not.toMatch(/identityId|profile|email|gps|hostname|mac/i);

      const offer = await alice.createOffer({ endpointId: endpoints[0]!.endpointId, object: { version: 1, type: 'text', text: 'One-time hello' } });
      await pause();
      const incoming = (await bob.incomingOffers())[0];
      expect(incoming).toMatchObject({ offerId: offer.offerId, direction: 'INCOMING', objectType: 'text', status: 'OFFERED' });
      expect((await bob.transfersList()).find(value => value.offerId === offer.offerId)?.status).toBe('OFFERED');
      await bob.acceptOffer(offer.offerId);
      let received = (await bob.transfersList()).find(value => value.offerId === offer.offerId);
      const deadline = Date.now() + 2_000;
      while (received?.status !== 'RECEIVED' && Date.now() < deadline) {
        await pause(20);
        received = (await bob.transfersList()).find(value => value.offerId === offer.offerId);
      }
      expect(received).toMatchObject({ status: 'RECEIVED', objectType: 'text', progress: 1 });
      let senderTransfer = (await alice.transfersList()).find(value => value.offerId === offer.offerId);
      while (senderTransfer?.status !== 'RECEIVED' && Date.now() < deadline) {
        await pause(20);
        senderTransfer = (await alice.transfersList()).find(value => value.offerId === offer.offerId);
      }
      expect(senderTransfer).toMatchObject({ status: 'RECEIVED' });
      expect((await alice.endpoints())[0]?.socialState).toBe('ANONYMOUS');
      expect((await bob.endpoints())[0]?.socialState).toBe('ANONYMOUS');
    } finally { await alice.close(); await bob.close(); }
  });

  it('requires explicit consent, supports reject/cancel, and never auto-accepts a file', async () => {
    const { alice, bob } = await pair();
    try {
      const endpoint = (await alice.listNearby())[0]!;
      const bytes = new TextEncoder().encode('safe file body');
      const offer = await alice.createOffer({ endpointId: endpoint.endpointId, object: { version: 1, type: 'file', contentId: 'sha256-0000000000000000000000000000000000000000000000000000000000000000', byteLength: bytes.byteLength, mimeType: 'text/plain', name: '../../.ssh/authorized_keys', mode: 'COPY' }, bytes });
      await pause();
      expect((await bob.incomingOffers())[0]?.preview.title).toBe('._._.ssh_authorized_keys');
      expect((await bob.transfersList()).find(value => value.offerId === offer.offerId)?.status).toBe('OFFERED');
      await bob.rejectOffer(offer.offerId, 'not now');
      expect((await alice.transfersList()).find(value => value.offerId === offer.offerId)).toMatchObject({ status: 'REJECTED' });

      const second = await alice.createOffer({ endpointId: endpoint.endpointId, object: { version: 1, type: 'text', text: 'cancel me' } });
      await alice.cancelOffer(second.offerId);
      expect((await alice.transfersList()).find(value => value.offerId === second.offerId)?.status).toBe('CANCELED');
    } finally { await alice.close(); await bob.close(); }
  });

  it('moves a file through the R0P74 manifest/chunk verifier and emits a verified receipt', async () => {
    const { alice, bob } = await pair();
    try {
      const endpoint = (await alice.listNearby())[0]!;
      const bytes = Uint8Array.from({ length: 160_000 }, (_, index) => index % 251);
      const offer = await alice.createOffer({ endpointId: endpoint.endpointId, object: { version: 1, type: 'file', contentId: 'sha256-0000000000000000000000000000000000000000000000000000000000000000', byteLength: bytes.byteLength, mimeType: 'application/octet-stream', name: 'payload.bin', mode: 'COPY' }, bytes });
      await pause();
      await bob.acceptOffer(offer.offerId);
      for (let index = 0; index < 100 && !(await bob.transfersList()).find(value => value.offerId === offer.offerId && value.status === 'RECEIVED'); index += 1) await pause(30);
      const received = (await bob.transfersList()).find(value => value.offerId === offer.offerId)!;
      expect(received).toMatchObject({ status: 'RECEIVED', completedBytes: bytes.byteLength, progress: 1 });
      expect(received.object).toMatchObject({ type: 'file', mode: 'COPY' });
      const contentId = received.object?.type === 'file' ? received.object.contentId : undefined;
      expect(contentId).toMatch(/^sha256-[a-f0-9]{64}$/);
      expect(await bob.readReceivedContent(contentId!)).toEqual(bytes);
      expect((await alice.transfersList()).find(value => value.offerId === offer.offerId)?.receipt?.status).toBe('RECEIVED');
    } finally { await alice.close(); await bob.close(); }
  }, 30_000);

  it('uses bounded fragmented control frames on a small nearby MTU', async () => {
    const { alice, bob } = await pair({ mtu: 1_024 });
    try {
      const endpoint = (await alice.listNearby())[0]!;
      const text = 'x'.repeat(15_000);
      const offer = await alice.createOffer({ endpointId: endpoint.endpointId, object: { version: 1, type: 'text', text } });
      await pause();
      await bob.acceptOffer(offer.offerId);
      // Fragmented control delivery is asynchronous.  A fixed 150 ms pause
      // is contention-sensitive when the complete workspace suite is active,
      // so keep the assertion bounded while waiting for the same terminal
      // state rather than making the suite depend on scheduler timing.
      let received = (await bob.transfersList()).find(value => value.offerId === offer.offerId);
      const deadline = Date.now() + 2_000;
      while (received?.status !== 'RECEIVED' && Date.now() < deadline) {
        await pause(20);
        received = (await bob.transfersList()).find(value => value.offerId === offer.offerId);
      }
      expect(received?.status).toBe('RECEIVED');
      expect(alice.diagnostics().fragmentCount).toBeLessThanOrEqual(1_024);
    } finally { await alice.close(); await bob.close(); }
  }, 30_000);

  it('does not surface or accept unsolicited offers when application receive mode is stopped', async () => {
    const { alice, bob } = await pair({ aliceReceive: false });
    try {
      const endpoint = (await alice.listNearby())[0];
      expect(endpoint).toBeUndefined();
      await expect(alice.createOffer({ endpointId: 'missing-endpoint', object: { version: 1, type: 'text', text: 'blocked' } })).rejects.toMatchObject({ code: 'UNAVAILABLE' });
      expect((await bob.incomingOffers())).toHaveLength(0);
    } finally { await alice.close(); await bob.close(); }
  });

  it('binds the receive QR to one short-lived session and rejects profile QR schemas', async () => {
    const { alice, bob } = await pair();
    try {
      const qr = await bob.createReceiveQr();
      expect(parseNearbyReceiveQr(qr).accepted).toBe(true);
      expect(JSON.parse(new TextDecoder().decode(Buffer.from(qr.slice('keystone-nearby:'.length), 'base64url')))).not.toHaveProperty('identityId');
      expect(parseNearbyReceiveQr('keystone-nearby:' + Buffer.from(JSON.stringify({ protocol: 'profile', version: 1 })).toString('base64url')).accepted).toBe(false);
      const endpoint = await alice.bootstrapFromQr(qr);
      expect(endpoint?.visible).toBe(true);
      const second = await alice.bootstrapFromQr(qr);
      expect(second?.visible).toBe(true); // the session is still live; the receiver token is consumed only for a new bootstrap.
    } finally { await alice.close(); await bob.close(); }
  });

  it('requires explicit social disclosure and delegates Add Contact to the canonical host adapter', async () => {
    const disclosure: NearbyIdentityDisclosure = { version: 1, kind: 'IDENTITY_DISCLOSURE', disclosedFields: ['displayName'], displayName: 'Alice' };
    const fields: NearbyContactField[] = ['displayName'];
    const contacts: string[] = [];
    const first = await pair();
    await first.alice.close(); await first.bob.close();
    const network = new ControlledNearbyNetwork();
    const aProvider = new AnonymousNearbyTransportProvider({ adapter: network.createAdapter('social-a'), providerId: 'nearby-social-a' });
    const bProvider = new AnonymousNearbyTransportProvider({ adapter: network.createAdapter('social-b'), providerId: 'nearby-social-b' });
    const alice = new NearbyExchangeService({ nearby: aProvider, localAlias: 'Alice', social: { async disclose() { return disclosure; }, async addContact() { contacts.push('added'); return { contactId: 'contact-1' }; } } });
    const bob = new NearbyExchangeService({ nearby: bProvider, localAlias: 'Bob' });
    try {
      await bob.startReceive(); await alice.start(); await pause(); await alice.refreshDiscovery(); await pause();
      const endpoint = (await alice.listNearby())[0]!;
      await expect(alice.addContact(endpoint.endpointId)).rejects.toMatchObject({ code: 'POLICY_DENIED' });
      await expect(alice.discloseIdentity(endpoint.endpointId, fields)).resolves.toEqual(disclosure);
      await expect(alice.addContact(endpoint.endpointId)).resolves.toEqual({ contactId: 'contact-1' });
      expect(contacts).toEqual(['added']);
    } finally { await alice.close(); await bob.close(); }
  });

  it('rejects dangerous objects and keeps remote content inert', async () => {
    const { alice, bob } = await pair();
    try {
      const endpoint = (await alice.listNearby())[0]!;
      await expect(alice.createOffer({ endpointId: endpoint.endpointId, object: { version: 1, type: 'url', url: 'javascript:alert(1)', hostname: 'invalid' } })).rejects.toMatchObject({ code: 'POLICY_DENIED' });
      await expect(alice.createOffer({ endpointId: endpoint.endpointId, object: { version: 1, type: 'document', objectId: '../../settings', mode: 'GRANT_ACCESS' } })).resolves.toBeTruthy();
      expect((await bob.incomingOffers())[0]?.status).toBe('OFFERED');
      expect(bob.diagnostics().fabricAvailable).toBe(false);
    } finally { await alice.close(); await bob.close(); }
  });
});
