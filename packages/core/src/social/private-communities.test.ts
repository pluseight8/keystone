import { describe, expect, it } from 'vitest';
import { canonicalJson, SodiumCryptoProvider } from '../crypto.js';
import { IdentityManager, type DeviceSessionKeys } from '../identity.js';
import { CommunityService } from './communities.js';
import { InMemoryCommunityStorage } from './community-storage.js';
import { InMemoryEncryptedSocialStateStore } from './storage.js';
import {
  InMemoryPrivateCommunityStateStorage,
  PersistentPrivateCommunityStateStorage,
  PrivateCommunityService,
  type PrivateCommunityKeyUpdate,
} from './private-communities.js';

async function participant(name: string, peers: readonly DeviceSessionKeys[] = []) {
  const keys = await (await IdentityManager.generate()).sessionKeys(name);
  const communities = new CommunityService(new InMemoryCommunityStorage(), new SodiumCryptoProvider(), keys);
  const privateCommunities = new PrivateCommunityService(new InMemoryPrivateCommunityStateStorage(), communities, new SodiumCryptoProvider(), keys, { peers });
  return { keys, communities, privateCommunities };
}

describe('Phase 25 private communities and epoch encryption', () => {
  it('distributes a current-only epoch, rejects tampering and removes a member on rotation', async () => {
    const alice = await participant('alice');
    const bob = await participant('bob', [alice.keys]);
    const charlie = await participant('charlie', [alice.keys, bob.keys]);
    alice.privateCommunities.registerPeer(bob.keys); alice.privateCommunities.registerPeer(charlie.keys);
    const community = await alice.privateCommunities.createCommunity({ name: 'Encrypted operators', visibility: 'private' });
    const channel = await alice.communities.createChannel(community.id, { name: 'private', kind: 'text' });
    const invite = await alice.privateCommunities.prepareInvite(community.id, bob.keys.nodeId);
    const request = await bob.privateCommunities.acceptInvite(invite);
    const bobUpdates = await alice.privateCommunities.acceptJoin(request);
    await bob.privateCommunities.applyKeyUpdate(bobUpdates.find(update => update.recipient === bob.keys.nodeId)!);
    expect((await bob.privateCommunities.state(community.id))?.epoch).toBe(2);

    const first = await alice.privateCommunities.postMessage(community.id, channel.payload.channelId, 'before Charlie');
    const firstPayload = await alice.privateCommunities.encryptEvent(first);
    await bob.privateCommunities.decryptEvent(firstPayload, alice.keys.nodeId);
    await expect(bob.privateCommunities.decryptEvent({ ...firstPayload, ciphertext: `${firstPayload.ciphertext}tampered` }, alice.keys.nodeId)).rejects.toThrow('authentication');

    const charlieInvite = await alice.privateCommunities.prepareInvite(community.id, charlie.keys.nodeId);
    const charlieRequest = await charlie.privateCommunities.acceptInvite(charlieInvite);
    const joinUpdates = await alice.privateCommunities.acceptJoin(charlieRequest);
    await bob.privateCommunities.applyKeyUpdate(joinUpdates.find(update => update.recipient === bob.keys.nodeId)!);
    await charlie.privateCommunities.applyKeyUpdate(joinUpdates.find(update => update.recipient === charlie.keys.nodeId)!);
    expect((await charlie.privateCommunities.state(community.id))?.epoch).toBe(3);
    await expect(charlie.privateCommunities.decryptEvent(firstPayload, alice.keys.nodeId)).rejects.toThrow('unavailable');

    const removeUpdates = await alice.privateCommunities.changeMembership(community.id, bob.keys.nodeId, 'ban', 'revoked');
    expect(removeUpdates.some(update => update.recipient === bob.keys.nodeId)).toBe(false);
    const afterRemoval = await alice.privateCommunities.postMessage(community.id, channel.payload.channelId, 'after Bob');
    const afterPayload = await alice.privateCommunities.encryptEvent(afterRemoval);
    await expect(bob.privateCommunities.decryptEvent(afterPayload, alice.keys.nodeId)).rejects.toThrow('unavailable');
    await charlie.privateCommunities.applyKeyUpdate(removeUpdates.find(update => update.recipient === charlie.keys.nodeId)!);
    await charlie.privateCommunities.decryptEvent(afterPayload, alice.keys.nodeId);
  });

  it('persists epoch keys only in authenticated encrypted storage and rejects forged/replayed updates', async () => {
    const alice = await participant('alice');
    const bobKeys = await (await IdentityManager.generate()).sessionKeys('bob');
    const backend = new InMemoryEncryptedSocialStateStore();
    const storage = new PersistentPrivateCommunityStateStorage(backend, alice.keys);
    const owner = new PrivateCommunityService(storage, alice.communities, new SodiumCryptoProvider(), alice.keys, { peers: [bobKeys] });
    const community = await owner.createCommunity({ name: 'Durable private', visibility: 'contacts' });
    const raw = await backend.read();
    expect(JSON.stringify(raw)).not.toContain((await owner.state(community.id))!.key);
    const restored = new PrivateCommunityService(new PersistentPrivateCommunityStateStorage(backend, alice.keys), alice.communities, new SodiumCryptoProvider(), alice.keys, { peers: [bobKeys] });
    expect((await restored.state(community.id))?.epoch).toBe(1);

    const forged = {
      version: 1 as const, protocol: 'keystone.private-community.v1' as const, id: crypto.randomUUID(), communityId: community.id, actor: bobKeys.nodeId, recipient: alice.keys.nodeId,
      epoch: 2, previousEpoch: 1, keyId: 'forged', members: [{ nodeId: alice.keys.nodeId, encryptionPublicKey: alice.keys.encryptionPublicKey }], historyPolicy: 'current-only' as const,
      bootstrapEvents: [], keyNonce: 'bad', encryptedKey: 'bad', issuedAt: new Date().toISOString(), signature: await new SodiumCryptoProvider().sign(canonicalJson({ version: 1, protocol: 'keystone.private-community.v1', id: 'forged', communityId: community.id, actor: bobKeys.nodeId, recipient: alice.keys.nodeId, epoch: 2, previousEpoch: 1, keyId: 'forged', members: [{ nodeId: alice.keys.nodeId, encryptionPublicKey: alice.keys.encryptionPublicKey }], historyPolicy: 'current-only', bootstrapEvents: [], keyNonce: 'bad', encryptedKey: 'bad', issuedAt: new Date().toISOString() }), bobKeys.privateKey),
    } as PrivateCommunityKeyUpdate;
    await expect(restored.applyKeyUpdate(forged)).rejects.toThrow(/signature|owner/);
  });

  it('encrypts attachments before content addressing and rejects a corrupted blob', async () => {
    const alice = await participant('alice');
    const community = await alice.privateCommunities.createCommunity({ name: 'Files', visibility: 'private' });
    const source = new TextEncoder().encode('private attachment payload');
    const encrypted = await alice.privateCommunities.encryptAttachment(community.id, source, { mimeType: 'text/plain', name: 'secret.txt' });
    expect(encrypted.contentUri).toMatch(/^keystone:\/\/content\/sha256-/);
    expect(encrypted.bytes).not.toEqual(source);
    await expect(alice.privateCommunities.decryptAttachment(encrypted, encrypted.bytes, community.id)).resolves.toEqual(source);
    const corrupted = encrypted.bytes.slice(); corrupted[0] ^= 1;
    await expect(alice.privateCommunities.decryptAttachment(encrypted, corrupted, community.id)).rejects.toThrow('hash');
    const channel = await alice.communities.createChannel(community.id, { name: 'files', kind: 'media' });
    const message = await alice.privateCommunities.postMessage(community.id, channel.payload.channelId, 'encrypted file', { encryptedContent: [{ contentUri: encrypted.contentUri, epoch: encrypted.epoch, keyId: encrypted.keyId, nonce: encrypted.nonce, mimeType: encrypted.manifest.mimeType, size: encrypted.manifest.byteLength }] });
    expect((message as { payload: { encryptedContent?: readonly unknown[] } }).payload.encryptedContent).toHaveLength(1);
  });
});
