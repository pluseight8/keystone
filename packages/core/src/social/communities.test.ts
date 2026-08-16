import { describe, expect, it } from 'vitest';
import { SodiumCryptoProvider } from '../crypto.js';
import { IdentityManager } from '../identity.js';
import { CommunityService } from './communities.js';
import { InMemoryCommunityStorage } from './community-storage.js';

async function peer(name: string) { const keys = await (await IdentityManager.generate()).sessionKeys(name); const storage = new InMemoryCommunityStorage(); return { keys, storage, service: new CommunityService(storage, new SodiumCryptoProvider(), keys) }; }
async function copy(to: CommunityService, ...values: unknown[]) { for (const value of values) await to.ingest(value); }

describe('CommunityService', () => {
  it('enforces roles in core before channels and moderation actions', async () => {
    const owner = await peer('owner'), moderator = await peer('moderator'), member = await peer('member'); const community = await owner.service.createCommunity({ name: 'Keystone', description: 'P2P' });
    const role = await owner.service.createRole(community.id, { name: 'Moderator', permissions: ['create_channel', 'manage_members', 'moderate'] }); const invite = await owner.service.invite(community.id, moderator.keys.nodeId, [role.payload.roleId]);
    await copy(moderator.service, community, role, invite); const channel = await moderator.service.createChannel(community.id, { name: 'general', kind: 'text' }); expect(channel.author).toBe(moderator.keys.nodeId);
    const join = await member.service.join(community.id); await copy(owner.service, join); const ban = await moderator.service.moderate(community.id, member.keys.nodeId, 'ban'); await copy(owner.service, ban); expect((await owner.service.projection(community.id))?.members.get(member.keys.nodeId)).toMatchObject({ active: false, banned: true });
  });
  it('converges an out-of-order role assignment after its role arrives', async () => {
    const owner = await peer('owner'), manager = await peer('manager'); const community = await owner.service.createCommunity({ name: 'Order' }); const role = await owner.service.createRole(community.id, { name: 'Channels', permissions: ['create_channel'] }); const invite = await owner.service.invite(community.id, manager.keys.nodeId, [role.payload.roleId]);
    await copy(manager.service, community, invite); expect(await manager.service.can(community.id, manager.keys.nodeId, 'create_channel')).toBe(false); await manager.service.ingest(role); expect(await manager.service.can(community.id, manager.keys.nodeId, 'create_channel')).toBe(true);
  });
  it('keeps unauthorized signed events without granting them an effect', async () => {
    const owner = await peer('owner'), attacker = await peer('attacker'); const community = await owner.service.createCommunity({ name: 'Safe' }); await attacker.service.ingest(community);
    await expect(attacker.service.createChannel(community.id, { name: 'takeover', kind: 'text' })).rejects.toThrow('Community permission denied'); const forged = await attacker.service.join(community.id); await owner.service.ingest(forged); expect((await owner.service.projection(community.id))?.members.get(attacker.keys.nodeId)?.active).toBe(true); expect(await owner.service.can(community.id, attacker.keys.nodeId, 'moderate')).toBe(false);
  });
  it('rejects invalid signatures and stores no community action for them', async () => {
    const owner = await peer('owner'), receiver = await peer('receiver'); const community = await owner.service.createCommunity({ name: 'Signed' }); expect(await receiver.service.ingest({ ...community, signature: 'bad' })).toBeUndefined(); expect(await receiver.service.projection(community.id)).toBeUndefined();
  });
});
