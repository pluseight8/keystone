import { describe, expect, it } from 'vitest';
import {
  ContactService,
  InMemoryContactStateStore,
  contactCardToNearbyObject,
  createContactNearbyExchangePort,
  type ContactReplicationEvent,
} from '../contacts.js';

const NOW = Date.parse('2026-08-26T09:00:00.000Z');

describe('R0P92 Contacts integrations', () => {
  it('keeps groups, Calendar birthday projections, Maps and Continuity as typed adapters', async () => {
    const contacts = new ContactService({ ownerIdentityId: 'alice', now: () => NOW });
    const group = await contacts.createGroup({ id: 'work', name: 'Work' });
    const contact = await contacts.createContact({ displayName: 'Jane', birthday: '--06-15', addresses: [{ id: 'address:1', formatted: 'Moscow' }], websites: [{ id: 'website:1', url: 'https://example.com' }] });
    await contacts.addToGroup(group.id, contact.id);
    expect((await contacts.listGroups())[0]?.contactIds).toContain(contact.id);
    const calendar: unknown[] = [];
    const maps: unknown[] = [];
    const opened: unknown[] = [];
    expect(await contacts.projectBirthdays({ replace(_sourceId, values) { calendar.push(values); } })).toEqual(expect.arrayContaining([expect.objectContaining({ yearless: true, month: 6, day: 15 })]));
    await contacts.showAddressOnMap(contact.id, 'address:1', { showAddress(input) { maps.push(input); } });
    await contacts.openWebsite(contact.id, 'website:1', { open(url) { opened.push(url); } });
    await contacts.handoff(contact.id, { openContact(input) { opened.push(input.contact.id); } });
    expect(calendar).toHaveLength(1); expect(maps).toHaveLength(1); expect(opened).toEqual(['https://example.com/', contact.id]);
  });

  it('shares a selected contact card through the existing Nearby exchange boundary only', async () => {
    const calls: unknown[] = [];
    const contacts = new ContactService({ ownerIdentityId: 'alice', now: () => NOW });
    const contact = await contacts.createContact({ displayName: 'Nearby Jane', emails: [{ value: 'jane@example.com' }], notes: 'never nearby' });
    const card = await contacts.createContactCard(contact.id, { fields: ['name', 'emails', 'privateNotes'] }).catch(error => { expect(error).toMatchObject({ code: 'NOT_AUTHORIZED' }); return contacts.createContactCard(contact.id, { fields: ['name', 'emails'] }); });
    const port = createContactNearbyExchangePort({ async createOffer(input) { calls.push(input); return { accepted: true }; } });
    await port.send({ endpointId: 'endpoint:1', card });
    expect(calls[0]).toBeTruthy();
    expect(JSON.stringify(calls[0])).not.toContain('never nearby');
    expect((calls[0] as { object: ReturnType<typeof contactCardToNearbyObject> }).object.type).toBe('contact');
  });

  it('replicates durable owner-device events through a bounded transport adapter', async () => {
    const events: ContactReplicationEvent[] = [];
    const writer = new ContactService({ ownerIdentityId: 'owner', deviceId: 'device-a', now: () => NOW, replication: { publish(event) { events.push(event); } } });
    const reader = new ContactService({ ownerIdentityId: 'owner', deviceId: 'device-b', now: () => NOW, ownerDeviceRecipients: ['device-a'] });
    const contact = await writer.createContact({ id: 'contact:network', displayName: 'Network contact', emails: [{ value: 'network@example.com' }] });
    await reader.applyReplicationEvent(events[0]!);
    expect(reader.getContact(contact.id)).toMatchObject({ displayName: 'Network contact' });
    const store = new InMemoryContactStateStore();
    const durableWriter = new ContactService({ ownerIdentityId: 'owner', store, now: () => NOW });
    await durableWriter.createContact({ id: 'contact:durable', displayName: 'Durable' });
    const reopened = new ContactService({ ownerIdentityId: 'owner', store, now: () => NOW });
    await reopened.ready();
    expect(reopened.getContact('contact:durable').displayName).toBe('Durable');
  });
});
