import { describe, expect, it } from 'vitest';
import { encodeNearbyReceiveQr, NearbyExchangeError, parseNearbyReceiveQr } from './nearby-exchange.js';
import type { ContentId } from './social/content.js';
import { createNearbyPair } from './testing/nearby-exchange-fixture.js';

describe('R0P85 Nearby Exchange security boundary', () => {
  it('fails closed for dangerous URLs, oversized text, malformed identity QR and traversal-like names', async () => {
    const fixture = await createNearbyPair({ aliceOptions: { maxPendingOffers: 4 } });
    try {
      const endpoint = (await fixture.alice.listNearby())[0]!;
      await expect(fixture.alice.createOffer({ endpointId: endpoint.endpointId, object: { version: 1, type: 'url', url: 'javascript:alert(1)', hostname: 'example.test' } })).rejects.toMatchObject({ code: 'POLICY_DENIED' });
      await expect(fixture.alice.createOffer({ endpointId: endpoint.endpointId, object: { version: 1, type: 'url', url: 'file:///etc/passwd', hostname: 'localhost' } })).rejects.toMatchObject({ code: 'POLICY_DENIED' });
      await expect(fixture.alice.createOffer({ endpointId: endpoint.endpointId, object: { version: 1, type: 'text', text: 'x'.repeat(16 * 1024 + 1) } })).rejects.toMatchObject({ code: 'MALFORMED' });

      const bytes = new TextEncoder().encode('safe');
      const zeroContentId = `sha256-${'0'.repeat(64)}` as ContentId;
      const offer = await fixture.alice.createOffer({ endpointId: endpoint.endpointId, object: { version: 1, type: 'file', contentId: zeroContentId, byteLength: bytes.byteLength, mimeType: 'text/plain', name: '../../.ssh/authorized_keys', mode: 'COPY' }, bytes });
      expect((await fixture.bob.incomingOffers())[0]?.preview.title).toBe('._._.ssh_authorized_keys');
      expect((await fixture.bob.transfersList()).find(value => value.offerId === offer.offerId)?.status).toBe('OFFERED');
      expect(fixture.bob.diagnostics().activeTransfers).toBe(1);
    } finally {
      await fixture.close();
    }
  });

  it('enforces consent and releases terminal offer slots without retaining an unbounded queue', async () => {
    const fixture = await createNearbyPair({ aliceOptions: { maxPendingOffers: 4, maxHistory: 4 } });
    try {
      const endpoint = (await fixture.alice.listNearby())[0]!;
      const offers = [];
      for (let index = 0; index < 4; index += 1) offers.push(await fixture.alice.createOffer({ endpointId: endpoint.endpointId, object: { version: 1, type: 'text', text: `offer-${index}` } }));
      await expect(fixture.alice.createOffer({ endpointId: endpoint.endpointId, object: { version: 1, type: 'text', text: 'bounded' } })).rejects.toMatchObject({ code: 'RESOURCE_LIMIT' });
      await fixture.alice.cancelOffer(offers[0]!.offerId);
      await expect(fixture.alice.createOffer({ endpointId: endpoint.endpointId, object: { version: 1, type: 'text', text: 'slot-reused' } })).resolves.toBeTruthy();
      expect(fixture.alice.diagnostics().pendingOffers).toBeLessThanOrEqual(4);
      expect((await fixture.alice.history()).length).toBeLessThanOrEqual(4);
    } finally {
      await fixture.close();
    }
  });

  it('keeps Receive QR scoped to the exchange protocol and excludes profile/private material', async () => {
    const fixture = await createNearbyPair();
    try {
      const qr = await fixture.bob.createReceiveQr(60_000);
      const result = parseNearbyReceiveQr(qr);
      expect(result.accepted).toBe(true);
      expect(qr).not.toMatch(/identityId|privateKey|secret|profile/i);
      expect(parseNearbyReceiveQr('keystone-nearby:' + Buffer.from(JSON.stringify({ protocol: 'profile', version: 1, identityId: 'secret' })).toString('base64url')).accepted).toBe(false);
      expect(() => encodeNearbyReceiveQr({ protocol: 'keystone.nearby.exchange.r0p85', version: 1, kind: 'RECEIVE_QR', token: 'short', endpointHandle: 'bad', endpointPublicKey: 'bad', expiresAt: new Date(Date.now() + 60_000).toISOString(), scope: 'ONE_TIME_RECEIVE' })).toThrow(NearbyExchangeError);
    } finally {
      await fixture.close();
    }
  });
});
