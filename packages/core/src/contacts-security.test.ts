import { describe, expect, it } from 'vitest';
import {
  CONTACTS_ARCHITECTURE_POLICY,
  CONTACTS_MAX_CARD_BYTES,
  ContactError,
  ContactService,
  InMemoryContactStateStore,
  createContactCard,
  type ContactReplicationEvent,
  type ContactSigner,
  type ContactShareCard,
} from './contacts.js';

const NOW = Date.parse('2026-08-26T09:00:00.000Z');

describe('R0P92 Contacts security boundaries', () => {
  it('declares Contacts separate from Identity, ACL and implicit enrichment paths', () => {
    expect(CONTACTS_ARCHITECTURE_POLICY.centralContactsServerDependency).toBe(0);
    expect(CONTACTS_ARCHITECTURE_POLICY.contactAsAuthorizationPrincipal).toBe(0);
    expect(CONTACTS_ARCHITECTURE_POLICY.emailToIdentityAutomaticTrust).toBe(0);
    expect(CONTACTS_ARCHITECTURE_POLICY.phoneToIdentityAutomaticTrust).toBe(0);
    expect(CONTACTS_ARCHITECTURE_POLICY.displayNameToIdentityAutomaticLink).toBe(0);
    expect(CONTACTS_ARCHITECTURE_POLICY.mailSenderAutomaticContactCreation).toBe(0);
    expect(CONTACTS_ARCHITECTURE_POLICY.nearbyAutomaticContactCreation).toBe(0);
    expect(CONTACTS_ARCHITECTURE_POLICY.photoFaceContactMatching).toBe(0);
    expect(CONTACTS_ARCHITECTURE_POLICY.relationshipInference).toBe(0);
    expect(CONTACTS_ARCHITECTURE_POLICY.externalAiImplicitContactContext).toBe(0);
    expect(CONTACTS_ARCHITECTURE_POLICY.privateNotesDefaultShare).toBe(0);
    expect(CONTACTS_ARCHITECTURE_POLICY.timerPerContact).toBe(0);
    expect(CONTACTS_ARCHITECTURE_POLICY.listenerPerContact).toBe(0);
    expect(CONTACTS_ARCHITECTURE_POLICY.directApplicationBypassAllowed).toBe(false);
  });

  it('does not auto-create from mail sender resolution or received card preview', async () => {
    const contacts = new ContactService({ ownerIdentityId: 'alice', now: () => NOW });
    await contacts.createContact({ displayName: 'Known', emails: [{ value: 'known@example.com' }], notes: 'keep private' });
    expect(contacts.resolveMailSender({ address: 'unknown@example.com' })).toMatchObject({ status: 'NONE', contacts: [] });
    const card = await contacts.createContactCard('contact:missing').catch(error => error);
    expect(card).toMatchObject({ code: 'NOT_FOUND' });
    expect((await contacts.listContacts()).total).toBe(1);
  });

  it('keeps private notes out of the default share card and bounds hostile card payloads', async () => {
    const contacts = new ContactService({ ownerIdentityId: 'alice', now: () => NOW });
    const contact = await contacts.createContact({ displayName: 'Private', notes: 'secret owner note', emails: [{ value: 'private@example.com' }] });
    const card = await contacts.createContactCard(contact.id);
    expect(JSON.stringify(card)).not.toContain('secret owner note');
    expect(() => createContactCard(contact, { fields: ['privateNotes'], includePrivateNotes: true })).not.toThrow();
    expect(() => createContactCard({ ...contact, notes: 'x'.repeat(CONTACTS_MAX_CARD_BYTES) }, { fields: ['privateNotes'], includePrivateNotes: true })).toThrow();
    const received = await contacts.addReceivedContactCard(await contacts.createContactCard(contact.id, { fields: ['name', 'privateNotes'], includePrivateNotes: true }), { ownerConfirmed: true, mode: 'NEW' });
    expect(received.notes).toBeUndefined();
    const receivedWithNotes = await contacts.addReceivedContactCard(await contacts.createContactCard(contact.id, { fields: ['name', 'privateNotes'], includePrivateNotes: true }), { ownerConfirmed: true, mode: 'NEW', includePrivateNotes: true });
    expect(receivedWithNotes.notes).toBe('secret owner note');
  });

  it('does not convert an unverified claimed canonical proof from input or a received card into Identity authority', async () => {
    const contacts = new ContactService({ ownerIdentityId: 'alice', now: () => NOW });
    const direct = await contacts.createContact({ displayName: 'Forged direct', identityLinks: [{ identityId: 'identity:forged-direct', proof: { version: 1, identityId: 'identity:forged-direct', source: 'CANONICAL_IDENTITY', publicKey: 'forged' } }] });
    expect(direct.identityLinks[0]).toMatchObject({ identityId: 'identity:forged-direct', verified: false });
    const base = await contacts.createContact({ displayName: 'Forged card' });
    const card = { ...await contacts.createContactCard(base.id, { fields: ['name'] }), fields: ['name', 'identity'], data: { ...base, displayName: base.displayName, name: base.name, identities: [{ identityId: 'identity:forged-card', verified: true, proof: { version: 1, identityId: 'identity:forged-card', source: 'CANONICAL_IDENTITY', publicKey: 'forged' } }] } } as unknown as ContactShareCard;
    const received = await contacts.addReceivedContactCard(card, { ownerConfirmed: true, mode: 'NEW' });
    expect(received.identityLinks[0]).toMatchObject({ identityId: 'identity:forged-card', verified: false });
  });

  it('fails closed for malformed persisted state, cross-owner replication and replay', async () => {
    const store = new InMemoryContactStateStore();
    store.corrupt({ version: 1, protocol: 'keystone.contacts.r0p92', ownerIdentityId: 'alice', contacts: [{ version: 1, protocol: 'keystone.contacts.r0p92', ownerIdentityId: 'alice', id: 'contact:bad', displayName: 'bad', emails: [{ value: 'not-an-email' }] }], groups: [], redirects: [], fieldVersions: [], seenEvents: [], revokedDevices: [], logicalClock: 0 });
    const contacts = new ContactService({ ownerIdentityId: 'alice', store, now: () => NOW });
    await contacts.ready();
    expect((await contacts.listContacts()).total).toBe(0);
    const event: ContactReplicationEvent = { version: 1, protocol: 'keystone.contacts.r0p92', id: 'event:1', ownerIdentityId: 'mallory', actorDeviceId: 'device-m', operation: 'contact.upsert', targetId: 'contact:1', revision: 1, createdAt: new Date(NOW).toISOString(), payload: {} };
    await expect(contacts.applyReplicationEvent(event)).rejects.toMatchObject({ code: 'NOT_AUTHORIZED' });
    const local = await new ContactService({ ownerIdentityId: 'alice', now: () => NOW }).createContact({ displayName: 'One' });
    expect(local.id).toBeTruthy();
  });

  it('verifies signed owner-device events before applying them', async () => {
    const signer: ContactSigner = { sign: payload => payload, verify: (payload, signature) => payload === signature };
    const events: ContactReplicationEvent[] = [];
    const writer = new ContactService({ ownerIdentityId: 'alice', deviceId: 'device-a', now: () => NOW, signer, replication: { publish(event) { events.push(event); } } });
    const reader = new ContactService({ ownerIdentityId: 'alice', deviceId: 'device-b', now: () => NOW, signer, ownerDeviceRecipients: ['device-a'] });
    await writer.createContact({ id: 'contact:signed', displayName: 'Signed' });
    expect(events[0]?.signature).toBeTruthy();
    await expect(reader.applyReplicationEvent({ ...events[0]!, signature: `${events[0]!.signature}-tampered` })).rejects.toMatchObject({ code: 'NOT_AUTHORIZED' });
    await reader.applyReplicationEvent(events[0]!);
    expect(reader.getContact('contact:signed').displayName).toBe('Signed');
    await expect(reader.applyReplicationEvent(events[0]!)).rejects.toMatchObject({ code: 'REPLAY' });
  });
});
