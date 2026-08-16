import { describe, expect, it } from 'vitest';
import { SodiumCryptoProvider } from '../crypto.js';
import { IdentityManager, type DeviceSessionKeys } from '../identity.js';
import { ContactEnvelopeSecurity } from './messaging.js';
import { InMemoryEncryptedSocialStateStore } from './storage.js';
import { InMemorySharedSpaceStateStore, PersistentSharedSpaceStateStore, SharedSpaceError, SharedSpaceService } from './spaces.js';
import { ControlledNetwork, ControlledTransport, settle } from '../testing/distributed-harness.js';

type Peer = { keys: DeviceSessionKeys; transport: ControlledTransport; service: SharedSpaceService; security: ContactEnvelopeSecurity };

async function peers(names: readonly string[]): Promise<{ network: ControlledNetwork; values: Record<string, Peer> }> {
  const network = new ControlledNetwork(); const keys: Record<string, DeviceSessionKeys> = {};
  for (const name of names) keys[name] = await (await IdentityManager.generate()).sessionKeys(name);
  const values: Record<string, Peer> = {};
  for (const name of names) {
    const local = keys[name]!; const transport = new ControlledTransport(local.nodeId, network);
    const contacts = Object.values(keys).filter(value => value.nodeId !== local.nodeId).map(value => ({ nodeId: value.nodeId, signingPublicKey: value.publicKey, encryptionPublicKey: value.encryptionPublicKey }));
    const security = new ContactEnvelopeSecurity(local, contacts); const crypto = new SodiumCryptoProvider();
    const service = new SharedSpaceService({ transport, crypto, security, local, peers: Object.values(keys).filter(value => value.nodeId !== local.nodeId), storage: new InMemorySharedSpaceStateStore() }); await service.ready();
    values[name] = { keys: local, transport, service, security };
  }
  return { network, values };
}

describe('SharedSpace', () => {
  it('converges signed offline CRDT edits from three members and persists state', async () => {
    const value = await peers(['alice', 'bob', 'charlie']); const { network, values } = value; const alice = values.alice!.service; const bob = values.bob!.service; const charlie = values.charlie!.service;
    const space = await alice.createSpace({ title: 'Trip', description: 'Shared planning', members: [{ identityId: values.bob!.keys.nodeId, role: 'editor' }, { identityId: values.charlie!.keys.nodeId, role: 'editor' }] });
    const document = await alice.createDocument(space.id, { title: 'Plan', body: 'start' }); await alice.publish(space.id); await settle();
    expect(bob.getSpace(space.id)?.id).toBe(space.id); expect(charlie.getSpace(space.id)?.id).toBe(space.id);
    network.partition(values.bob!.keys.nodeId, values.charlie!.keys.nodeId, true);
    await bob.updateDocument(space.id, document.id, { body: 'Bob edit' }); await charlie.updateDocument(space.id, document.id, { title: 'Charlie title' }); await settle(); await new Promise(resolve => setTimeout(resolve, 300));
    await alice.publish(space.id, [values.bob!.keys.nodeId, values.charlie!.keys.nodeId]); await settle();
    expect(bob.listDocuments(space.id)[0]?.title).toBe('Charlie title'); expect(charlie.listDocuments(space.id)[0]?.body).toBe('Bob edit');
    await Promise.all(Object.values(values).map(peer => peer.service.close()));
  });

  it('encrypts private spaces, rotates keys on removal, and denies old members', async () => {
    const { values } = await peers(['alice', 'bob']); const alice = values.alice!.service; const bob = values.bob!.service;
    const space = await alice.createSpace({ title: 'Private Trip', description: 'not public', visibility: 'private', members: [{ identityId: values.bob!.keys.nodeId, role: 'editor' }] });
    await alice.publish(space.id); await settle(); const document = await alice.createDocument(space.id, { title: 'Secret', body: 'ciphertext only' }); await settle();
    expect(bob.listDocuments(space.id)[0]?.body).toBe('ciphertext only'); expect(bob.getSpace(space.id)?.title).toBe('Private Trip');
    await alice.removeMember(space.id, values.bob!.keys.nodeId); await settle();
    expect(() => bob.listDocuments(space.id)).toThrow(SharedSpaceError);
    await expect(bob.updateDocument(space.id, document.id, { body: 'forged' })).rejects.toMatchObject({ code: 'NOT_AUTHORIZED' });
    await Promise.all(Object.values(values).map(peer => peer.service.close()));
  });

  it('requires explicit agent grant and does not inherit Agent Visit permissions', async () => {
    const { values } = await peers(['alice', 'bob']); const alice = values.alice!.service;
    const agent = new SharedSpaceService({ transport: values.bob!.transport, crypto: new SodiumCryptoProvider(), security: values.bob!.security, local: values.bob!.keys, localAgentId: 'bob-agent', peers: [values.alice!.keys], storage: new InMemorySharedSpaceStateStore() }); await agent.ready();
    const space = await alice.createSpace({ title: 'Agents', members: [{ identityId: values.bob!.keys.nodeId, role: 'viewer' }] }); await alice.publish(space.id); await settle();
    await expect(alice.shareWithSpace(space.id, { sourceId: 'private-memory', kind: 'memory', value: 'secret', dataClass: 'PRIVATE' })).rejects.toMatchObject({ code: 'UNSHAREABLE_DATA' });
    await expect(agent.createDocument(space.id, { title: 'no grant' })).rejects.toMatchObject({ code: 'NOT_AUTHORIZED' });
    await alice.grantAgent(space.id, { agentId: 'bob-agent', identityId: values.bob!.keys.nodeId, permissions: ['document.read', 'document.write', 'space.read'] }); await alice.publish(space.id); await settle();
    const doc = await agent.createDocument(space.id, { title: 'bounded agent work' }); expect(doc.title).toBe('bounded agent work');
    agent.close(); alice.close(); values.bob!.service.close();
  });

  it('encrypts the durable private snapshot and restores the same space after restart', async () => {
    const { values } = await peers(['alice', 'bob']); const backend = new InMemoryEncryptedSocialStateStore(); const alice = values.alice!;
    const storage = new PersistentSharedSpaceStateStore(backend, alice.keys); const service = new SharedSpaceService({ transport: alice.transport, crypto: new SodiumCryptoProvider(), security: alice.security, local: alice.keys, peers: [values.bob!.keys], storage }); await service.ready();
    const space = await service.createSpace({ title: 'At-rest secret', description: 'never plaintext', visibility: 'private', members: [{ identityId: values.bob!.keys.nodeId }] });
    const raw = JSON.stringify(await backend.read()); expect(raw).not.toContain('At-rest secret'); expect(raw).not.toContain('never plaintext'); service.close();
    const restored = new SharedSpaceService({ transport: alice.transport, crypto: new SodiumCryptoProvider(), security: alice.security, local: alice.keys, peers: [values.bob!.keys], storage: new PersistentSharedSpaceStateStore(backend, alice.keys) }); await restored.ready(); expect(restored.getSpace(space.id)?.title).toBe('At-rest secret'); restored.close(); values.alice!.service.close(); values.bob!.service.close();
  });
});
