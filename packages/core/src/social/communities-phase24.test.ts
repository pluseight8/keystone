import { describe, expect, it } from 'vitest';
import { canonicalJson, SodiumCryptoProvider } from '../crypto.js';
import { IdentityManager } from '../identity.js';
import { CommunityService } from './communities.js';
import { InMemoryCommunityStorage } from './community-storage.js';
import { communityObjectSchema } from './object-model.js';

async function node(name: string) {
  const keys = await (await IdentityManager.generate()).sessionKeys(name);
  const storage = new InMemoryCommunityStorage();
  return { keys, storage, service: new CommunityService(storage, new SodiumCryptoProvider(), keys) };
}

async function copy(target: CommunityService, ...objects: readonly unknown[]) {
  for (const object of objects) await target.ingest(object);
}

describe('Phase 24 community roles and moderation', () => {
  it('projects categories, channel overrides, invites, pins and signed moderation with core authorization', async () => {
    const alice = await node('alice'); const bob = await node('bob'); const charlie = await node('charlie'); const mallory = await node('mallory');
    const community = await alice.service.createCommunity({ name: 'Keystone Operators', description: 'Public moderation test', visibility: 'public' });
    const moderatorRole = await alice.service.createRole(community.id, { name: 'Moderator', position: 20, permissions: ['post_message', 'moderate', 'pin_messages', 'moderate_messages'] });
    const invite = await alice.service.createInvite(community.id, { recipient: bob.keys.nodeId, roleIds: [moderatorRole.payload.roleId] });
    await copy(bob.service, community, moderatorRole, invite);
    const accepted = await bob.service.acceptInvite(invite.payload.inviteId); await copy(alice.service, accepted);
    const charlieJoin = await charlie.service.join(community.id); await copy(alice.service, charlieJoin); await copy(charlie.service, community);
    const category = await alice.service.createCategory(community.id, { name: 'Public', position: 0 });
    const channel = await alice.service.createChannel(community.id, { name: 'announcements', kind: 'announcement', categoryId: category.payload.categoryId, permissionOverrides: [{ roleId: moderatorRole.payload.roleId, allow: ['post_announcements'], deny: ['manage_community'] }] });
    await copy(bob.service, category, channel); await copy(charlie.service, community, category, channel);
    expect((await bob.service.projection(community.id))?.members.get(bob.keys.nodeId)).toMatchObject({ active: true, roleIds: [moderatorRole.payload.roleId] });
    expect(await bob.service.can(community.id, bob.keys.nodeId, 'post_announcements', channel.payload.channelId)).toBe(true);
    expect(await bob.service.can(community.id, bob.keys.nodeId, 'manage_community', channel.payload.channelId)).toBe(false);
    const message = await bob.service.postMessage(community.id, channel.payload.channelId, 'Signed announcement'); await copy(alice.service, message);
    const pin = await bob.service.pinMessage(community.id, channel.payload.channelId, message.payload.messageId, 'Important'); await copy(alice.service, pin);
    expect((await alice.service.pinnedMessages(community.id, channel.payload.channelId)).map(value => value.payload.messageId)).toEqual([message.payload.messageId]);
    const deletion = await alice.service.deleteMessage(community.id, channel.payload.channelId, message.payload.messageId, 'archived'); await copy(bob.service, deletion);
    expect(await bob.service.messages(community.id, channel.payload.channelId)).toEqual([]);
    await expect(charlie.service.createChannel(community.id, { name: 'spoofed', kind: 'text' })).rejects.toThrow('Community permission denied');
    const forged = await mallory.service.join(community.id); await copy(alice.service, forged); expect(await alice.service.can(community.id, mallory.keys.nodeId, 'moderate')).toBe(false);
    await expect(charlie.service.moderate(community.id, bob.keys.nodeId, 'ban')).rejects.toThrow('Community permission denied');
    const ban = await bob.service.moderate(community.id, charlie.keys.nodeId, 'ban', { reason: 'spam' }); await copy(alice.service, ban);
    expect((await alice.service.projection(community.id))?.members.get(charlie.keys.nodeId)).toMatchObject({ active: false, banned: true });
    await expect(bob.service.moderate(community.id, community.author, 'ban')).rejects.toThrow('Owner is protected');
    await expect(alice.service.ingest({ ...ban, signature: 'invalid' })).resolves.toBeUndefined();
    await copy(alice.service, ban, ban);
    expect((await alice.service.auditLog(community.id)).filter(entry => entry.action === 'ban')).toHaveLength(1);
    const edited = await alice.service.editCommunity(community.id, { description: 'Edited locally by owner' }); await copy(bob.service, edited); expect((await bob.service.projection(community.id))?.community.payload.description).toBe('Edited locally by owner');
    const { signature: _signature, ...editedUnsigned } = edited; const forgedUnsigned = { ...editedUnsigned, id: crypto.randomUUID(), author: mallory.keys.nodeId, createdAt: new Date(Date.now() + 1_000).toISOString(), references: [{ id: community.id, type: 'community' as const }], supersedes: edited.id, payload: { ...edited.payload, name: 'Mallory takeover' } }; const forgedCommunity = communityObjectSchema.parse({ ...forgedUnsigned, signature: await new SodiumCryptoProvider().sign(canonicalJson(forgedUnsigned), mallory.keys.privateKey) }); expect(await alice.service.ingest(forgedCommunity)).toBeUndefined(); expect((await alice.service.projection(community.id))?.community.payload.name).toBe('Keystone Operators');
    const deletedChannel = await alice.service.deleteChannel(community.id, channel.payload.channelId, 'archived'); await copy(bob.service, deletedChannel); expect((await bob.service.projection(community.id))?.channels.has(channel.payload.channelId)).toBe(false);
    const tombstone = await alice.service.deleteCommunity(community.id, 'shutdown'); await copy(bob.service, tombstone); expect((await bob.service.projection(community.id))?.community.deleted).toBe(true);
  });

  it('keeps private and contacts communities local until group encryption/key rotation exists', async () => {
    const alice = await node('alice'); const bob = await node('bob');
    const privateCommunity = await alice.service.createCommunity({ name: 'Private', visibility: 'private' });
    const contactsCommunity = await alice.service.createCommunity({ name: 'Contacts', visibility: 'contacts' });
    expect(await bob.service.ingest(privateCommunity)).toBeDefined();
    expect(await bob.service.projection(privateCommunity.id)).toBeDefined();
    expect(await bob.service.ingest(contactsCommunity)).toBeDefined();
    await expect(bob.service.join(privateCommunity.id)).rejects.toThrow('invite');
    await expect(bob.service.join(contactsCommunity.id)).rejects.toThrow('invite');
  });

  it('does not expose blocked authors through local community search', async () => {
    const alice = await node('alice'); const bob = await node('bob');
    const community = await alice.service.createCommunity({ name: 'Searchable' });
    const channel = await alice.service.createChannel(community.id, { name: 'general', kind: 'text' });
    const message = await alice.service.postMessage(community.id, channel.payload.channelId, 'visible before block'); await copy(bob.service, community, channel, message);
    expect((await bob.service.search('visible')).length).toBe(1);
    await bob.service.block(alice.keys.nodeId);
    expect(await bob.service.search('visible')).toEqual([]);
  });

  it('enforces role hierarchy when a moderator tries to escalate or moderate above its level', async () => {
    const owner = await node('owner'); const moderator = await node('moderator'); const administrator = await node('administrator');
    const community = await owner.service.createCommunity({ name: 'Hierarchy' });
    const adminRole = await owner.service.createRole(community.id, { name: 'Admin', position: 50, permissions: ['manage_roles', 'moderate'] });
    const modRole = await owner.service.createRole(community.id, { name: 'Mod', position: 10, permissions: ['manage_roles', 'moderate'] });
    const adminInvite = await owner.service.invite(community.id, administrator.keys.nodeId, [adminRole.payload.roleId]); const modInvite = await owner.service.invite(community.id, moderator.keys.nodeId, [modRole.payload.roleId]);
    await copy(moderator.service, community, adminRole, modRole, adminInvite, modInvite); await copy(administrator.service, community, adminRole, modRole, adminInvite);
    const helperRole = await moderator.service.createRole(community.id, { name: 'Helper', position: 5, permissions: ['post_message'] }); expect(helperRole.payload.position).toBe(5);
    await expect(moderator.service.createRole(community.id, { name: 'Escalation', position: 100, permissions: ['manage_community'] })).rejects.toThrow('Role hierarchy');
    await expect(moderator.service.setRoles(community.id, administrator.keys.nodeId, [modRole.payload.roleId])).rejects.toThrow('Role hierarchy');
  });
});
