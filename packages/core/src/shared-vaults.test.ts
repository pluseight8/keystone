import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { SodiumCryptoProvider } from './crypto.js';
// Replication is asynchronous; poll instead of fixed sleeps that flake under parallel load.
import { eventuallyNearby } from './testing/nearby-exchange-fixture.js';
import { IdentityManager, SelfEnvelopeSecurity } from './identity.js';
import {
  InMemorySharedVaultStateStore,
  MemoryVaultStorageAdapter,
  SharedVaultError,
  SharedVaultService,
  PersistentSharedVaultStateStore,
  VaultService,
} from './index.js';
import { ControlledNetwork, ControlledTransport } from './testing/distributed-harness.js';

function make(identityId: string, storage = new MemoryVaultStorageAdapter(), state = new InMemorySharedVaultStateStore()) {
  const vault = new VaultService({ identityId, rootReference: `local://${identityId}`, name: `${identityId} Vault`, storage });
  return { vault, storage, state, service: new SharedVaultService({ vault, identityId, state }) };
}

describe('Phase 54 Shared Vault collaboration', () => {
  it('never serializes a private epoch key into a generic Shared Vault snapshot', async () => {
    const identity = await IdentityManager.generate(); const keys = await identity.sessionKeys('snapshot-device'); const state = new InMemorySharedVaultStateStore(); const vault = new VaultService({ identityId: keys.nodeId, rootReference: 'local://snapshot', name: 'Snapshot', storage: new MemoryVaultStorageAdapter() }); const service = new SharedVaultService({ vault, identityId: keys.nodeId, device: keys, crypto: new SodiumCryptoProvider(), privateKey: keys.privateKey, state }); await service.ready();
    await service.create({ id: 'opaque-vault', title: 'Opaque epoch', visibility: 'private' });
    const serialized = JSON.stringify(await state.read()); expect(serialized).not.toMatch(/"key"\s*:/); expect(serialized).toContain('epochSecretCiphertext'); await service.close();
  });

  it('encrypts the durable Shared Vault snapshot at the host state boundary', async () => {
    const identity = await IdentityManager.generate(); const keys = await identity.sessionKeys('state-device'); const backend = new InMemorySharedVaultStateStore(); const state = new PersistentSharedVaultStateStore(backend, keys); const storage = new MemoryVaultStorageAdapter(); const vault = new VaultService({ identityId: keys.nodeId, rootReference: 'local://encrypted-state', name: 'Encrypted State', storage }); const crypto = new SodiumCryptoProvider(); const service = new SharedVaultService({ vault, identityId: keys.nodeId, device: keys, crypto, privateKey: keys.privateKey, state }); await service.ready(); const shared = await service.create({ id: 'encrypted-state-vault', title: 'Private state', visibility: 'private' }); await service.createNote(shared.id, { path: 'Secret.md', content: 'private snapshot plaintext' }); await service.close(); const raw = await backend.read(); expect(JSON.stringify(raw)).not.toContain('private snapshot plaintext'); const restartedVault = new VaultService({ identityId: keys.nodeId, rootReference: 'local://encrypted-state', name: 'Encrypted State', storage }); const restarted = new SharedVaultService({ vault: restartedVault, identityId: keys.nodeId, device: keys, crypto, privateKey: keys.privateKey, state: new PersistentSharedVaultStateStore(backend, keys) }); await restarted.ready(); expect((await restarted.get(shared.id))?.title).toBe('Private state'); expect((await restarted.listNotes(shared.id)).some(note => note.content.includes('private snapshot plaintext'))).toBe(true);
  });

  it('supports generic identities, scoped permissions, epoch rotation and revoked access', async () => {
    const fixture = make('identity-01'); await fixture.vault.ready(); const shared = await fixture.service.create({ id: 'vault-collab', title: 'Research', visibility: 'private' });
    expect(shared.members[0]?.identityId).toBe('identity-01'); const note = await fixture.service.createNote(shared.id, { path: 'Research.md', content: '# Initial' }); const before = shared.epoch.epoch; const added = await fixture.service.addMember(shared.id, 'identity-02', 'editor'); expect(added.epoch.epoch).toBe(before + 1); expect(fixture.service.can(shared.id, 'identity-02', 'EDIT')).toBe(true); const removed = await fixture.service.removeMember(shared.id, 'identity-02', 'kick'); expect(removed.epoch.epoch).toBe(added.epoch.epoch + 1); expect(fixture.service.can(shared.id, 'identity-02', 'EDIT')).toBe(false); expect(await fixture.service.get(shared.id, 'identity-02')).toBeUndefined(); await expect(fixture.service.applyCrdtUpdate(shared.id, note.id, new Uint8Array([1]), 'identity-01', before)).rejects.toMatchObject({ code: 'INVALID_EPOCH' });
  });

  it('applies Yjs Markdown updates, rejects replay/oversize and restores durable replicas', async () => {
    const state = new InMemorySharedVaultStateStore(); const fixture = make('identity-owner', new MemoryVaultStorageAdapter(), state); await fixture.vault.ready(); const shared = await fixture.service.create({ id: 'vault-yjs', title: 'CRDT', visibility: 'private' }); const note = await fixture.service.createNote(shared.id, { path: 'Note.md', content: 'base' }); await fixture.service.openReplica(shared.id, note.id);
    const doc = new Y.Doc(); doc.getText('markdown').insert(0, 'converged'); const update = Y.encodeStateAsUpdate(doc); const replica = await fixture.service.applyCrdtUpdate(shared.id, note.id, update); expect(replica.content).toContain('converged'); await expect(fixture.service.applyCrdtUpdate(shared.id, note.id, update)).rejects.toMatchObject({ code: 'REPLAY' }); await expect(fixture.service.applyCrdtUpdate(shared.id, note.id, new Uint8Array(4 * 1024 * 1024 + 1))).rejects.toMatchObject({ code: 'BOUNDS_EXCEEDED' });
    const restarted = make('identity-owner', fixture.storage, state); await restarted.vault.ready(); expect((await restarted.service.get('vault-yjs'))?.title).toBe('CRDT'); expect((await restarted.service.getDocumentReplica('vault-yjs', note.id)).content).toContain('converged');
  });

  it('keeps notes scoped to the Shared Vault and persists the shared Canvas projection', async () => {
    const state = new InMemorySharedVaultStateStore(); const fixture = make('identity-scope', new MemoryVaultStorageAdapter(), state); await fixture.vault.ready(); const outside = await fixture.vault.createNote({ path: 'Private.md', content: 'not shared' }); const shared = await fixture.service.create({ id: 'vault-scope', title: 'Scoped', visibility: 'private' }); const inside = await fixture.service.createNote(shared.id, { path: 'Shared.md', content: 'shared' }); const listed = await fixture.service.listNotes(shared.id); expect(listed.map(note => note.id)).toEqual([inside.id]); expect(await fixture.service.readNote(shared.id, outside.id)).toBeUndefined(); const canvas = await fixture.service.applyCanvasMutation(shared.id, 'board', { type: 'create_node', node: { id: 'node-1', kind: 'TEXT_CARD', x: 0, y: 0, width: 200, height: 100, text: 'Shared' } }); expect(canvas.nodes).toHaveLength(1); const restarted = make('identity-scope', fixture.storage, state); await restarted.vault.ready(); expect((await restarted.service.listSharedCanvases(shared.id))[0]?.nodes).toHaveLength(1);
  });

  it('requires an opaque encrypted content reference for private attachments', async () => {
    const fixture = make('identity-attachments'); await fixture.vault.ready(); const shared = await fixture.service.create({ id: 'vault-attachments', title: 'Attachments', visibility: 'private' }); await expect(fixture.service.addAttachmentReference(shared.id, { contentId: 'plaintext-hash', name: 'secret.bin', mimeType: 'application/octet-stream', size: 12 })).rejects.toMatchObject({ code: 'PRIVATE_KEY_UNAVAILABLE' }); const ref = await fixture.service.addAttachmentReference(shared.id, { contentId: 'plaintext-hash', encryptedContentId: 'ciphertext-hash', name: 'secret.bin', mimeType: 'application/octet-stream', size: 12 }); expect(ref.encrypted).toBe(true); expect(ref.contentId).toBe('ciphertext-hash');
  });

  it('bounds ephemeral presence and expires it without durable privacy history', async () => {
    let clock = 1_000; const storage = new MemoryVaultStorageAdapter(); const vault = new VaultService({ identityId: 'identity-presence', rootReference: 'local://presence', name: 'Presence', storage, now: () => clock }); const service = new SharedVaultService({ vault, identityId: 'identity-presence', now: () => clock }); await vault.ready(); const shared = await service.create({ id: 'vault-presence', title: 'Presence', visibility: 'private' }); await service.setPresence(shared.id, { identityId: 'identity-presence', state: 'editing', ttlMs: 1_000 }); expect(service.listPresence(shared.id)).toHaveLength(1); clock += 2_000; expect(service.listPresence(shared.id)).toHaveLength(0); await service.close();
  });

  it('fails closed for malformed/corrupt durable state and unsupported shared history', async () => {
    const state = new InMemorySharedVaultStateStore(); const fixture = make('identity-corrupt', new MemoryVaultStorageAdapter(), state); await fixture.vault.ready(); await expect(fixture.service.create({ title: 'History', historyPolicy: 'SHARED_HISTORY' })).rejects.toMatchObject({ code: 'NOT_AUTHORIZED' }); state.corrupt({ version: 99 }); const restarted = make('identity-corrupt', fixture.storage, state); await expect(restarted.service.ready()).rejects.toBeInstanceOf(SharedVaultError);
  });

  it('rotates private epochs and replicates notes only to current authenticated members', async () => {
    const network = new ControlledNetwork(); const crypto = new SodiumCryptoProvider();
    const aliceKeys = await (await IdentityManager.generate()).sessionKeys('alice'); const bobKeys = await (await IdentityManager.generate()).sessionKeys('bob');
    const aliceTransport = new ControlledTransport(aliceKeys.nodeId, network); const bobTransport = new ControlledTransport(bobKeys.nodeId, network);
    const aliceVault = new VaultService({ identityId: aliceKeys.nodeId, rootReference: 'local://alice-shared', name: 'Alice', storage: new MemoryVaultStorageAdapter() }); const bobVault = new VaultService({ identityId: bobKeys.nodeId, rootReference: 'local://bob-shared', name: 'Bob', storage: new MemoryVaultStorageAdapter() });
    const aliceSecurity = new SelfEnvelopeSecurity(aliceKeys, { [bobKeys.nodeId]: bobKeys.publicKey }); const bobSecurity = new SelfEnvelopeSecurity(bobKeys, { [aliceKeys.nodeId]: aliceKeys.publicKey });
    const alice = new SharedVaultService({ vault: aliceVault, identityId: aliceKeys.nodeId, device: aliceKeys, crypto, privateKey: aliceKeys.privateKey, trustedPublicKeys: { [bobKeys.nodeId]: bobKeys.publicKey }, trustedEncryptionPublicKeys: { [bobKeys.nodeId]: bobKeys.encryptionPublicKey }, transport: aliceTransport, security: aliceSecurity }); const bob = new SharedVaultService({ vault: bobVault, identityId: bobKeys.nodeId, device: bobKeys, crypto, privateKey: bobKeys.privateKey, trustedPublicKeys: { [aliceKeys.nodeId]: aliceKeys.publicKey }, trustedEncryptionPublicKeys: { [aliceKeys.nodeId]: aliceKeys.encryptionPublicKey }, transport: bobTransport, security: bobSecurity });
    await Promise.all([aliceVault.ready(), bobVault.ready(), alice.ready(), bob.ready()]); const shared = await alice.create({ id: 'private-p2p', title: 'Private P2P', visibility: 'private' }); await alice.invite(shared.id, bobKeys.nodeId, bobKeys); expect(await eventuallyNearby(() => bob.get(shared.id), Boolean)).toBeDefined(); const note = await alice.createNote(shared.id, { path: 'Shared.md', content: 'secret' }); expect((await eventuallyNearby(() => bob.readNote(shared.id, note.id), value => Boolean(value?.content.includes('secret'))))?.content).toContain('secret'); await bob.openReplica(shared.id, note.id); const bobDoc = new Y.Doc(); bobDoc.getText('markdown').insert(0, 'secret from Bob'); await bob.applyCrdtUpdate(shared.id, note.id, Y.encodeStateAsUpdate(bobDoc)); expect((await eventuallyNearby(() => alice.readNote(shared.id, note.id), value => Boolean(value?.body.includes('secret from Bob'))))?.body).toContain('secret from Bob'); const before = (await bob.get(shared.id))?.epoch.epoch; await alice.removeMember(shared.id, bobKeys.nodeId, 'kick'); await new Promise(resolve => setTimeout(resolve, 10)); expect((await bob.get(shared.id))?.epoch.epoch).toBe(before); await alice.close(); await bob.close(); await aliceTransport.close(); await bobTransport.close();
  });
});
