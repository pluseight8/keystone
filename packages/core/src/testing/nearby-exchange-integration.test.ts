import { describe, expect, it } from 'vitest';
import { createNearbyPair, eventuallyNearby, pauseNearby } from './nearby-exchange-fixture.js';

describe('R0P85 Nearby Exchange integration', () => {
  it('transfers the typed exchange objects only after an explicit accept', async () => {
    const fixture = await createNearbyPair();
    try {
      const endpoint = (await fixture.alice.listNearby())[0];
      expect(endpoint).toBeDefined();
      const objects = [
        { version: 1, type: 'text', text: 'a bounded nearby message' },
        { version: 1, type: 'url', url: 'https://example.test/docs?id=1', hostname: 'example.test', title: 'A safe link' },
        { version: 1, type: 'place', placeId: 'place-r0p85', displayName: 'Shared cafe', approximateRegion: 'Moscow', coordinates: { latitude: 55.7512, longitude: 37.6184 } },
        { version: 1, type: 'route', routeId: 'route-r0p85', mode: 'WALKING', label: 'Short walk', points: [{ latitude: 55.7512, longitude: 37.6184 }, { latitude: 55.752, longitude: 37.619 }] },
        { version: 1, type: 'publication', publicationId: 'publication-r0p85', title: 'Shared draft' },
        { version: 1, type: 'contact', selectedFields: ['displayName', 'publicLinks'], fields: { displayName: 'A contact', publicLinks: [{ label: 'site', url: 'https://example.test/profile' }] } },
        { version: 1, type: 'collaboration', invitationId: 'invite-r0p85', objectId: 'note-r0p85', role: 'editor', mode: 'GRANT_ACCESS', label: 'Explicit invitation' },
        { version: 1, type: 'document', objectId: 'doc-r0p85', mode: 'COPY', label: 'Document copy' },
      ] as const;

      for (const object of objects) {
        const offer = await fixture.alice.createOffer({ endpointId: endpoint!.endpointId, object });
        await eventuallyNearby(() => fixture.bob.incomingOffers(), values => values.some(value => value.offerId === offer.offerId));
        const before = (await fixture.bob.transfersList()).find(value => value.offerId === offer.offerId);
        expect(before?.status).toBe('OFFERED');
        await fixture.bob.acceptOffer(offer.offerId);
        const received = await eventuallyNearby(() => fixture.bob.transfersList(), values => values.some(value => value.offerId === offer.offerId && value.status === 'RECEIVED'));
        expect(received.find(value => value.offerId === offer.offerId)?.objectType).toBe(object.type);
      }
    } finally {
      await fixture.close();
    }
  }, 30_000);

  it('keeps access invitations inert and records only bounded transfer state', async () => {
    const fixture = await createNearbyPair({ aliceOptions: { maxHistory: 4, maxPendingOffers: 4 } });
    try {
      const endpoint = (await fixture.alice.listNearby())[0]!;
      const offer = await fixture.alice.createOffer({ endpointId: endpoint.endpointId, object: { version: 1, type: 'document', objectId: 'private-note', mode: 'GRANT_ACCESS', revision: 'rev-1' } });
      await pauseNearby();
      expect((await fixture.bob.incomingOffers())[0]).toMatchObject({ offerId: offer.offerId, status: 'OFFERED', objectType: 'document' });
      expect((await fixture.bob.transfersList()).find(value => value.offerId === offer.offerId)?.object).toBeUndefined();
      await fixture.bob.acceptOffer(offer.offerId);
      await eventuallyNearby(() => fixture.bob.transfersList(), values => values.some(value => value.offerId === offer.offerId && value.status === 'RECEIVED'));
      const persisted = await fixture.bobStorage.read();
      expect(JSON.stringify(persisted)).not.toMatch(/peerHandle|privateKey|secret|gps|locationFix/i);
      expect(fixture.bob.diagnostics().historyCount).toBeLessThanOrEqual(4);
    } finally {
      await fixture.close();
    }
  });
});
