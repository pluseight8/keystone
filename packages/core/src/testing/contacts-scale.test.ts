import { describe, expect, it } from 'vitest';
import { InMemoryContactStateStore, ContactService } from '../contacts.js';

const NOW = Date.parse('2026-08-26T09:00:00.000Z');

describe('R0P92 Contacts scale bounds', () => {
  it('hydrates and searches a bounded 100,000-contact address book without pairwise duplicate work', async () => {
    const timestamp = new Date(NOW).toISOString();
    const store = new InMemoryContactStateStore();
    store.corrupt({ version: 1, protocol: 'keystone.contacts.r0p92', ownerIdentityId: 'alice', contacts: Array.from({ length: 100_000 }, (_, index) => ({ version: 1, protocol: 'keystone.contacts.r0p92', ownerIdentityId: 'alice', id: `contact:${index}`, displayName: `Scale contact ${index}`, name: {}, emails: [], phones: [], addresses: [], websites: [], dates: [], tags: [], groupIds: [], favorite: index % 1000 === 0, identityLinks: [], externalHandles: [], sourceUids: [], createdAt: timestamp, updatedAt: timestamp, revision: 1, tombstone: false })), groups: [], redirects: [], fieldVersions: [], seenEvents: [], revokedDevices: [], logicalClock: 0 });
    const started = performance.now();
    const contacts = new ContactService({ ownerIdentityId: 'alice', store, now: () => NOW });
    await contacts.ready();
    const page = await contacts.listContacts({ limit: 256 });
    const search = await contacts.search('99999', { limit: 8 });
    const duplicates = contacts.detectDuplicateCandidates({ limit: 32 });
    const elapsed = performance.now() - started;
    expect(contacts.diagnostics().activeContacts).toBe(100_000);
    expect(page.items).toHaveLength(256);
    expect(search.items.map(value => value.displayName)).toContain('Scale contact 99999');
    expect(duplicates).toHaveLength(0);
    expect(elapsed).toBeLessThan(60_000);
  }, 180_000);
});
