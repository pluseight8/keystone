import { describe, expect, it } from 'vitest';
import { AnonymousNearbyTransportProvider, ControlledNearbyNetwork, encodeNearbyAdvertisement, type AnonymousNearbyPeerHandle } from '../nearby.js';
import { createNearbyPair, pauseNearby } from './nearby-exchange-fixture.js';
import type { ContentId } from '../social/content.js';
import { NearbyExchangeError } from '../nearby-exchange.js';

describe('R0P85 Nearby Exchange bounded scale', () => {
  it('caps 1000 discovered endpoints and keeps 5000 offer cycles plus a 100-file batch bounded', async () => {
    const network = new ControlledNearbyNetwork();
    const adapter = network.createAdapter('scale-main');
    const provider = new AnonymousNearbyTransportProvider({ adapter, providerId: 'scale-nearby-main', maxPeers: 256, maxSessions: 32, maxAdvertisementParsesPerMinute: 512 });
    try {
      await provider.start();
      const expiresAt = new Date(Date.now() + 60_000).toISOString();
      for (let index = 0; index < 1_000; index += 1) {
        const handle = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64url') as AnonymousNearbyPeerHandle;
        network.advertise(`scale-peer-${index}`, encodeNearbyAdvertisement({ handle, expiresAt }));
      }
      await pauseNearby(150);
      expect(provider.diagnostics().discoveredPeerCount).toBeLessThanOrEqual(256);
      expect(provider.diagnostics().rejectedAdvertisements).toBeGreaterThan(0);
    } finally {
      await provider.stop();
    }

    const fixture = await createNearbyPair({ maxBytesPerSession: 128 * 1024 * 1024, aliceOptions: { maxPendingOffers: 256, maxHistory: 128 }, bobOptions: { maxPendingOffers: 256, maxHistory: 128 } });
    try {
      let endpointId = (await fixture.alice.listNearby())[0]!.endpointId;
      let index = 0;
      while (index < 5_000) {
        try {
          const offer = await fixture.alice.createOffer({ endpointId, object: { version: 1, type: 'text', text: `bounded-${index}` } });
          await fixture.alice.cancelOffer(offer.offerId, 'scale cycle');
          index += 1;
        } catch (error) {
          if (error instanceof NearbyExchangeError && error.code === 'UNAVAILABLE') {
            await fixture.alice.refreshDiscovery();
            const next = (await fixture.alice.listNearby())[0];
            if (!next) throw new Error(`Nearby scale offer cycle ${index} could not refresh its bounded route; serviceAlice=${JSON.stringify(fixture.alice.diagnostics())}; serviceBob=${JSON.stringify(fixture.bob.diagnostics())}; alice=${JSON.stringify(fixture.aliceProvider.diagnostics())}; bob=${JSON.stringify(fixture.bobProvider.diagnostics())}`);
            endpointId = next.endpointId;
            continue;
          }
          throw new Error(`Nearby scale offer cycle ${index} failed: ${error instanceof Error ? error.message : String(error)}; serviceAlice=${JSON.stringify(fixture.alice.diagnostics())}; serviceBob=${JSON.stringify(fixture.bob.diagnostics())}; alice=${JSON.stringify(fixture.aliceProvider.diagnostics())}; bob=${JSON.stringify(fixture.bobProvider.diagnostics())}`);
        }
      }
      expect(fixture.alice.diagnostics().pendingOffers).toBe(0);
      expect(fixture.alice.diagnostics().historyCount).toBeLessThanOrEqual(128);
      expect((await fixture.alice.transfersList()).length).toBeLessThanOrEqual(128);

      const zeroContentId = `sha256-${'0'.repeat(64)}` as ContentId;
      const files = Array.from({ length: 100 }, (_, index) => ({
        object: { version: 1 as const, type: 'file' as const, contentId: zeroContentId, byteLength: 2, mimeType: 'application/octet-stream', name: `batch-${index}.bin`, mode: 'COPY' as const },
        bytes: Uint8Array.from([index & 0xff, (index + 1) & 0xff]),
      }));
      const batch = await fixture.alice.createBatchOffer({ endpointId, files });
      expect(batch).toHaveLength(100);
      expect(fixture.alice.diagnostics().pendingOffers).toBeLessThanOrEqual(256);
      expect(fixture.alice.diagnostics().sessionCount).toBeLessThanOrEqual(32);
    } finally {
      await fixture.close();
    }
  }, 180_000);
});
