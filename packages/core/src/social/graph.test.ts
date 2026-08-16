import { describe, expect, it } from 'vitest';
import { SodiumCryptoProvider } from '../crypto.js';
import { IdentityManager } from '../identity.js';
import { SocialGraphService } from './graph.js';
import { InMemoryEncryptedSocialStateStore, PersistentSocialStorage } from './storage.js';

async function service(name: string, backend = new InMemoryEncryptedSocialStateStore()) { const keys = await (await IdentityManager.generate()).sessionKeys(name); return { keys, backend, graph: new SocialGraphService(new PersistentSocialStorage(backend), new SodiumCryptoProvider(), keys) }; }

describe('SocialGraphService', () => {
  it('publishes signed profiles without claiming global handle ownership', async () => {
    const { graph, keys } = await service('alice'); const profile = await graph.publishProfile({ displayName: 'Alice', handle: 'alice', bio: 'hello', links: [] });
    expect(profile.author).toBe(keys.nodeId); expect(profile.visibility).toBe('public'); expect((await graph.profile(keys.nodeId))?.payload.handle).toBe('alice'); const revised = await graph.publishProfile({ displayName: 'Alice revised', handle: 'alice', links: [] }); expect(revised.payload.joinedAt).toBe(profile.payload.joinedAt);
  });
  it('converges follow/unfollow events and preserves only local safety policy', async () => {
    const alice = await service('alice'), bob = await service('bob'); const follow = await alice.graph.follow(bob.keys.nodeId); expect(await bob.graph.ingest(follow)).toBeDefined(); expect(await bob.graph.followers()).toEqual([alice.keys.nodeId]);
    const unfollow = await alice.graph.unfollow(bob.keys.nodeId); await bob.graph.ingest(unfollow); expect(await bob.graph.followers()).toEqual([]);
    await bob.graph.setBlocked(alice.keys.nodeId, true); await bob.graph.setMuted(alice.keys.nodeId, true); await bob.graph.setTrust(alice.keys.nodeId, 'trusted'); expect(await bob.graph.relationship(alice.keys.nodeId)).toMatchObject({ blocked: true, muted: true, trust: 'trusted' });
  });
  it('rejects malformed, self-follow, and tampered remote graph objects', async () => {
    const alice = await service('alice'), bob = await service('bob'); const profile = await alice.graph.publishProfile({ displayName: 'Alice', links: [] });
    expect(await bob.graph.ingest({ ...profile, signature: 'bad' })).toBeUndefined(); const follow = await alice.graph.follow(bob.keys.nodeId); expect(await bob.graph.ingest({ ...follow, payload: { target: alice.keys.nodeId, action: 'follow' } })).toBeUndefined(); expect(await bob.graph.ingest({ ...follow, author: bob.keys.nodeId })).toBeUndefined();
  });
  it('migrates social storage v1 snapshots without losing messenger records', async () => {
    const backend = new InMemoryEncryptedSocialStateStore(); await backend.write({ version: 1, conversations: {}, messages: {}, outbox: {}, nonces: {}, blocked: {}, clocks: {}, acknowledgements: {} }); const graph = new SocialGraphService(new PersistentSocialStorage(backend), new SodiumCryptoProvider(), await (await IdentityManager.generate()).sessionKeys('migrated'));
    const profile = await graph.publishProfile({ displayName: 'Migrated', links: [] }); expect(profile.payload.displayName).toBe('Migrated');
  });
});
