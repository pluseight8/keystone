import { describe, expect, it } from 'vitest';
import {
  ContactError,
  ContactService,
  InMemoryContactStateStore,
  contactCardFromNearbyObject,
  contactCardToNearbyObject,
  createContactMailAdapter,
  resolveKeystoneMessageRecipient,
  type ContactReplicationAdapter,
  type ContactReplicationEvent,
  type ContactServiceOptions,
} from './contacts.js';

const NOW = Date.parse('2026-08-26T09:00:00.000Z');
const service = (ownerIdentityId = 'alice', options: Partial<ContactServiceOptions> = {}) => new ContactService({ ownerIdentityId, now: () => NOW, ...options });

describe('R0P92 ContactService', () => {
  it('stores structured personal data, multi-value fields, groups, favorites and yearless birthdays', async () => {
    const contacts = service();
    const group = await contacts.createGroup({ id: 'family', name: 'Family' });
    const contact = await contacts.createContact({
      id: 'contact:alice-mom',
      name: { givenName: 'Мария', familyName: 'Иванова' },
      displayName: 'Мария Иванова',
      emails: [{ value: 'MOM@Example.com', label: 'home', preferred: true }, { value: 'mom.work@example.com', label: 'work' }],
      phones: [{ value: '+7 (900) 123-45-67', label: 'mobile', preferred: true }],
      addresses: [{ label: 'home', formatted: 'Moscow' }],
      websites: [{ label: 'site', url: 'https://example.com/maria' }],
      organization: { name: 'Example', jobTitle: 'Designer' },
      birthday: '--05-17',
      notes: 'Private note',
      tags: ['family'],
      groupIds: [group.id],
      favorite: true,
    });
    expect(contact.name.familyName).toBe('Иванова');
    expect(contact.emails).toHaveLength(2);
    expect(contact.emails[0]?.normalized).toBe('MOM@example.com');
    expect(contact.dates).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'BIRTHDAY', month: 5, day: 17 })]));
    expect(contact.dates[0]).not.toHaveProperty('year');
    expect((await contacts.listContacts({ view: 'FAVORITES' })).items.map(value => value.id)).toContain(contact.id);
    expect((await contacts.searchContacts('example', { includePrivateNotes: false })).items.map(value => value.id)).toContain(contact.id);
    expect((await contacts.search('Private note')).items).toHaveLength(0);
    expect(contacts.lookupByEmail('MOM@example.com').status).toBe('MATCH');
    expect(contacts.lookupByPhone('+79001234567').status).toBe('MATCH');
    expect((await contacts.listGroups())[0]).toMatchObject({ id: group.id, contactIds: [contact.id] });
  });

  it('requires explicit Identity linking and never treats address-book values as Identity authority', async () => {
    const contacts = service();
    const contact = await contacts.createContact({ displayName: 'Bob', emails: [{ value: 'bob@example.com' }] });
    expect(() => resolveKeystoneMessageRecipient(contacts, contact.id)).toThrowError(/Identity/);
    expect((await contacts.linkIdentity(contact.id, 'identity:bob')).verified).toBe(false);
    expect(resolveKeystoneMessageRecipient(contacts, contact.id)).toMatchObject({ identityId: 'identity:bob' });
    expect(contacts.lookupByIdentity('identity:bob').contacts[0]?.id).toBe(contact.id);
  });

  it('finds duplicate candidates and merges only after explicit confirmation with a redirect', async () => {
    const contacts = service();
    const primary = await contacts.createContact({ id: 'contact:primary', displayName: 'Bob', emails: [{ value: 'bob@example.com' }], notes: 'primary note' });
    const secondary = await contacts.createContact({ id: 'contact:secondary', displayName: 'Robert', emails: [{ value: 'bob@example.com' }], phones: [{ value: '+12025550123' }], notes: 'secondary note' });
    expect(contacts.detectDuplicateCandidates({ limit: 10 })).toEqual(expect.arrayContaining([expect.objectContaining({ left: primary.id, right: secondary.id, reasons: expect.arrayContaining(['EXACT_EMAIL']) })]));
    const preview = contacts.previewMerge(primary.id, secondary.id, { notes: 'COMBINE', displayName: 'SECONDARY' });
    expect(preview.conflicts).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'displayName' })]));
    await expect(contacts.mergeContacts(primary.id, secondary.id)).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
    const merged = await contacts.mergeContacts(primary.id, secondary.id, { ownerConfirmed: true, notes: 'COMBINE', displayName: 'SECONDARY' });
    expect(merged.displayName).toBe('Robert');
    expect(merged.emails).toHaveLength(1);
    expect(merged.phones).toHaveLength(1);
    expect(contacts.resolveContactId(secondary.id)).toBe(primary.id);
    expect(contacts.getContact(secondary.id).id).toBe(primary.id);
    expect((await contacts.listContacts({ view: 'TRASH' })).items.map(value => value.id)).toContain(secondary.id);
  });

  it('keeps group membership symmetric when Contacts are updated, merged and deleted', async () => {
    const contacts = service();
    const firstGroup = await contacts.createGroup({ id: 'group:first', name: 'First' });
    const secondGroup = await contacts.createGroup({ id: 'group:second', name: 'Second' });
    const primary = await contacts.createContact({ id: 'contact:group-primary', displayName: 'Primary', groupIds: [firstGroup.id] });
    const secondary = await contacts.createContact({ id: 'contact:group-secondary', displayName: 'Secondary', groupIds: [secondGroup.id] });
    await contacts.updateContact(primary.id, { groupIds: [firstGroup.id, secondGroup.id] });
    expect((await contacts.getGroup(secondGroup.id)).contactIds).toEqual(expect.arrayContaining([primary.id, secondary.id]));
    await contacts.mergeContacts(primary.id, secondary.id, { ownerConfirmed: true });
    expect((await contacts.getGroup(firstGroup.id)).contactIds).toEqual([primary.id]);
    expect((await contacts.getGroup(secondGroup.id)).contactIds).toEqual([primary.id]);
    await contacts.permanentlyDeleteContact(primary.id, true);
    expect((await contacts.getGroup(firstGroup.id)).contactIds).toEqual([]);
    expect((await contacts.getGroup(secondGroup.id)).contactIds).toEqual([]);
  });

  it('uses explicit import preview/confirmation, safe URLs and private-by-default cards', async () => {
    const contacts = service();
    const vcard = ['BEGIN:VCARD', 'VERSION:4.0', 'UID:external-1', 'FN:Jane Doe', 'N:Doe;Jane;;;', 'EMAIL;TYPE=work:jane@example.com', 'BDAY:--12-31', 'URL:https://example.com/jane', 'NOTE:private import', 'END:VCARD'].join('\r\n');
    const preview = await contacts.previewVCard(vcard);
    expect(preview.contactCount).toBe(1);
    await expect(contacts.importVCard(vcard)).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
    const imported = await contacts.importVCard(vcard, { confirmed: true });
    expect(imported.imported).toBe(1);
    const importedContact = contacts.getContact(imported.importedIds[0]!);
    expect(importedContact.sourceUids).toContain('external-1');
    expect(importedContact.emails[0]?.provenance).toBe('IMPORTED_VCARD');
    expect(importedContact.websites[0]?.provenance).toBe('IMPORTED_VCARD');
    expect(importedContact.dates[0]).toMatchObject({ kind: 'BIRTHDAY', month: 12, day: 31 });
    expect(importedContact.dates[0]).not.toHaveProperty('year');
    const card = await contacts.createContactCard(importedContact.id, { fields: ['name', 'emails'] });
    expect(card.data.privateNotes).toBeUndefined();
    await expect(contacts.createContactCard(importedContact.id, { fields: ['privateNotes'], includePrivateNotes: true })).resolves.toBeTruthy();
    const nearby = contactCardToNearbyObject(card);
    const received = contactCardFromNearbyObject(nearby);
    expect(received.data.displayName).toBe('Jane Doe');
    expect(received.data.privateNotes).toBeUndefined();
  });

  it('links an explicit mail recipient to an existing Contact without importing unknown senders', async () => {
    const contacts = service();
    const contact = await contacts.createContact({ displayName: 'Mail target' });
    const adapter = createContactMailAdapter(contacts);
    await adapter.link?.({ name: 'Mail target', address: 'target@example.com' }, contact.id);
    expect(contacts.lookupByEmail('target@example.com').contacts[0]?.id).toBe(contact.id);
    expect(() => contacts.lookupByEmail('unknown@example.com')).not.toThrow();
    expect((await contacts.listContacts()).total).toBe(1);
  });

  it('shares a selective Contact card through Messages only after resolving an explicit recipient Identity', async () => {
    const contacts = service();
    const target = await contacts.createContact({ displayName: 'Message target' });
    const source = await contacts.createContact({ displayName: 'Card source', emails: [{ value: 'source@example.com' }] });
    await contacts.linkIdentity(target.id, 'identity:message-target');
    const card = await contacts.createContactCard(source.id, { fields: ['name', 'emails'] });
    const sent: { readonly recipientIdentityId: string; readonly card: typeof card }[] = [];
    await contacts.sendContactCardViaMessage(target.id, card, { send(input) { sent.push(input); return input; } });
    expect(sent[0]).toMatchObject({ recipientIdentityId: 'identity:message-target', card: { data: { displayName: 'Card source' } } });
    expect(JSON.stringify(sent[0]?.card)).not.toContain('privateNotes');
  });

  it('round-trips yearless birthdays through CSV without inventing a year', async () => {
    const contacts = service();
    const original = await contacts.createContact({ displayName: 'CSV birthday', birthday: '--05-17' });
    const csv = await contacts.exportCsv([original.id]);
    expect(csv).toContain('--05-17');
    const preview = await contacts.previewCsv(csv);
    expect(preview.contactCount).toBe(1);
    const imported = await contacts.importCsv(csv, { confirmed: true });
    const copy = contacts.getContact(imported.importedIds[0]!);
    expect(copy.dates[0]).toMatchObject({ kind: 'BIRTHDAY', month: 5, day: 17, provenance: 'IMPORTED_CSV' });
    expect(copy.dates[0]).not.toHaveProperty('year');
  });

  it('persists through a state store and projects birthdays without allocating one timer per contact', async () => {
    const store = new InMemoryContactStateStore();
    const first = service('alice', { store });
    const contact = await first.createContact({ displayName: 'Birthday', birthday: '--01-02' });
    const second = service('alice', { store });
    await second.ready();
    expect(second.getContact(contact.id).dates[0]).toMatchObject({ kind: 'BIRTHDAY', month: 1, day: 2 });
    expect(second.birthdayProjections()).toEqual([expect.objectContaining({ contactId: contact.id, yearless: true, sourceId: 'contacts:birthdays' })]);
    expect(second.diagnostics().listeners).toBe(0);
  });

  it('preserves explicit Identity link state and stable item IDs across hydration', async () => {
    const store = new InMemoryContactStateStore();
    const first = service('alice', { store });
    const contact = await first.createContact({ displayName: 'Linked' });
    await first.linkIdentity(contact.id, 'identity:stable');
    const linked = first.getContact(contact.id).identityLinks[0]!;
    await first.unlinkIdentity(contact.id, 'identity:stable');
    const second = service('alice', { store });
    await second.ready();
    expect(second.getContact(contact.id).identityLinks[0]).toMatchObject({ id: linked.id, identityId: 'identity:stable', state: 'UNLINKED', verified: false });
    expect(second.lookupByIdentity('identity:stable').status).toBe('NONE');
  });
});

describe('R0P92 owner-device field convergence', () => {
  it('converges independent fields, keeps item-level multi-values and rejects stale deletes after restore', async () => {
    const aEvents: ContactReplicationEvent[] = [];
    const bEvents: ContactReplicationEvent[] = [];
    const aReplication: ContactReplicationAdapter = { publish(event) { aEvents.push(event); } };
    const bReplication: ContactReplicationAdapter = { publish(event) { bEvents.push(event); } };
    const a = service('owner', { deviceId: 'device-a', replication: aReplication, ownerDeviceRecipients: ['device-b'] });
    const b = service('owner', { deviceId: 'device-b', replication: bReplication, ownerDeviceRecipients: ['device-a'] });
    const base = await a.createContact({ id: 'contact:shared', displayName: 'Shared', emails: [{ id: 'email:base', value: 'base@example.com' }] });
    await b.applyReplicationEvent(aEvents[0]!);
    const aUpdate = await a.updateContact(base.id, { notes: 'A private edit' });
    const bUpdate = await b.updateContact(base.id, { emails: [{ id: 'email:base', value: 'base@example.com' }, { id: 'email:b', value: 'b@example.com' }] });
    await b.applyReplicationEvent(aEvents.at(-1)!);
    await a.applyReplicationEvent(bEvents.at(-1)!);
    expect(a.getContact(base.id).notes).toBe(aUpdate.notes);
    expect(a.getContact(base.id).emails.map(value => value.id)).toEqual(expect.arrayContaining(['email:base', 'email:b']));
    expect(b.getContact(base.id).notes).toBe(aUpdate.notes);
    const deleted = await a.deleteContact(base.id);
    const deleteEvent = aEvents.at(-1)!;
    await a.restoreContact(base.id);
    const restoreEvent = aEvents.at(-1)!;
    await b.applyReplicationEvent(restoreEvent);
    await b.applyReplicationEvent(deleteEvent);
    expect(b.getContact(base.id).tombstone).toBe(false);
    expect(deleted.tombstone).toBe(true);
  });
});

it('rejects malformed or cross-owner persisted state without leaking it into active Contacts', async () => {
  const store = new InMemoryContactStateStore();
  store.corrupt({ version: 1, protocol: 'keystone.contacts.r0p92', ownerIdentityId: 'mallory', contacts: [{ id: 'contact:bad' }], groups: [], redirects: [], fieldVersions: [], seenEvents: [], revokedDevices: [], logicalClock: 0 });
  const contacts = service('alice', { store });
  await expect(contacts.ready()).rejects.toMatchObject({ code: 'INVALID_STATE' });
  const clean = service('alice');
  await expect(clean.createContact({ displayName: 'safe', websites: [{ url: 'javascript:alert(1)' }] })).rejects.toMatchObject({ code: 'UNSAFE_URL' });
  await expect(clean.createContact({ displayName: 'safe', avatar: { uri: 'file:///secret' } })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
});
