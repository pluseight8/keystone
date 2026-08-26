import { describe, expect, it } from 'vitest';
import { ContentCache, DEFAULT_CHUNK_SIZE } from '../social/content.js';
import { DistributedContentService, InMemoryContentTransferStateStore, type DistributedContentSource } from '../social/distributed-content.js';
import { SodiumCryptoProvider } from '../crypto.js';
import { IdentityManager } from '../identity.js';
import { InMemoryDeviceMeshStorage, PersonalDeviceMesh } from '../personal-device-mesh.js';
import type { Envelope, KeystoneDeliveryInterface } from '../connectivity.js';
import type { TransportMessageHandler } from '../transport.js';
import {
  ContentCacheFolderContentStore,
  CryptoFolderSigner,
  DistributedContentFolderDelivery,
  PersonalDeviceFolderPlacement,
  SharedFolderService,
  type SharedFolderServiceOptions,
} from '../shared-folders.js';
import type { NodeId } from '../types.js';

const largeBytes = (size: number, seed = 7): Uint8Array => Uint8Array.from({ length: size }, (_, index) => (index * 31 + seed) % 251);
const text = (value: string): Uint8Array => new TextEncoder().encode(value);

async function eventually(check: () => Promise<boolean>, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for device proof');
}

function service(identityId: string, cache: ContentCache, options: Omit<SharedFolderServiceOptions, 'localIdentityId' | 'content'> = {}): SharedFolderService {
  return new SharedFolderService({ localIdentityId: identityId as NodeId, content: new ContentCacheFolderContentStore(cache), ...options });
}

class DeviceBus {
  private readonly peers = new Map<string, Set<TransportMessageHandler>>();
  register(peer: string): KeystoneDeliveryInterface {
    const handlers = new Set<TransportMessageHandler>();
    this.peers.set(peer, handlers);
    return {
      connect: async () => undefined,
      send: async (peerOrEnvelope: string | Envelope, maybeEnvelope?: Envelope) => {
        const peerId = typeof peerOrEnvelope === 'string' ? peerOrEnvelope : peerOrEnvelope.recipient;
        const envelope = maybeEnvelope ?? peerOrEnvelope as Envelope;
        const target = this.peers.get(peerId);
        if (!target) throw new Error('peer unavailable');
        await Promise.all([...target].map(handler => handler(envelope)));
      },
      onMessage: handler => { handlers.add(handler); return () => handlers.delete(handler); },
      isPeerConnected: peerId => this.peers.has(peerId),
      close: async () => { this.peers.delete(peer); handlers.clear(); },
    };
  }
}

function sourceFor(bytes: Uint8Array, allowedSubject: string, calls: number[]): DistributedContentSource {
  return {
    id: `authorized-source:${allowedSubject}`,
    scope: 'AUTHORIZED_GROUP',
    canServe: async (_manifest, authorization) => authorization?.subjectId === allowedSubject && (authorization.scope === 'AUTHORIZED_GROUP' || authorization.scope === 'OWNER'),
    getChunk: async (_contentId, index) => { calls.push(index); const start = index * DEFAULT_CHUNK_SIZE; return bytes.slice(start, Math.min(bytes.byteLength, start + DEFAULT_CHUNK_SIZE)); },
  };
}

describe('R0P90 real two-device and social network proofs', () => {
  it('syncs an own-device folder, transfers multi-chunk content through R0P74 and preserves offline concurrent edits', async () => {
    const crypto = new SodiumCryptoProvider();
    const identity = await IdentityManager.generate();
    const laptop = await identity.sessionKeys('r0p90-laptop');
    const phone = await identity.sessionKeys('r0p90-phone');
    const bus = new DeviceBus();
    const ownerMesh = new PersonalDeviceMesh({ local: laptop, crypto, storage: new InMemoryDeviceMeshStorage(), transport: bus.register(laptop.nodeId) });
    const phoneMesh = new PersonalDeviceMesh({ local: phone, ownerIdentityId: laptop.nodeId, authorityDeviceId: laptop.nodeId, authorityPublicKey: laptop.publicKey, crypto, storage: new InMemoryDeviceMeshStorage(), transport: bus.register(phone.nodeId) });
    await Promise.all([ownerMesh.ready(), phoneMesh.ready()]);
    const enrollment = await phoneMesh.createEnrollmentRequest({ label: 'R0P90 phone', platform: 'test', capabilities: { roles: ['PORTABLE'], availableStorageBytes: 64 * 1024 * 1024 } });
    const authorization = await ownerMesh.authorizeEnrollment(enrollment, { confirmed: true, doubleConfirmed: true });
    expect(await phoneMesh.acceptEnrollmentAuthorization(authorization)).toBe(true);

    const content = largeBytes(400 * 1024);
    const calls: number[] = [];
    const source = sourceFor(content, laptop.nodeId, calls);
    const phoneCache = new ContentCache(64 * 1024 * 1024);
    const phoneDelivery = new DistributedContentFolderDelivery(new DistributedContentService({
      cache: phoneCache,
      directory: { async sources(manifest, authorizationValue) { return authorizationValue?.subjectId === laptop.nodeId ? [source] : []; } },
      transferState: new InMemoryContentTransferStateStore(),
      maxInFlightChunks: 2,
    }));
    const signer = new CryptoFolderSigner(crypto, laptop.privateKey);
    const laptopFiles = service(laptop.nodeId, new ContentCache(64 * 1024 * 1024), { localDeviceId: laptop.nodeId, signer, placement: new PersonalDeviceFolderPlacement(ownerMesh) });
    const phoneFiles = service(laptop.nodeId, phoneCache, { localDeviceId: phone.nodeId, signer, contentDelivery: phoneDelivery });
    const folder = await laptopFiles.createFolder({ name: 'Own Device Drive' });
    const file = await laptopFiles.createFile({ folderId: folder.id, name: 'multi.bin', bytes: content, mimeType: 'application/octet-stream' });
    await laptopFiles.setPlacement({ folderId: folder.id, fileId: file.file.id, intent: 'SELECTED_DEVICES', selectedDeviceIds: [phone.nodeId], includeContent: true });
    await ownerMesh.flush(phone.nodeId);
    await eventually(async () => (await phoneMesh.replica(phone.nodeId, file.file.id))?.status === 'CONFIRMED');
    expect((await phoneMesh.replica(phone.nodeId, file.file.id))?.status).toBe('CONFIRMED');
    for (const change of laptopFiles.exportChanges().items) await phoneFiles.applyChange(change);
    const remote = await phoneFiles.describeFile(file.file.id);
    expect(remote.availability).toBe('METADATA_ONLY');
    expect(await phoneFiles.readFile(file.file.id)).toEqual(content);
    expect(calls.length).toBe(remote.revision.manifest.chunks.length);

    const base = remote.revision.id;
    await laptopFiles.updateFile(file.file.id, text('laptop edit'), { baseRevisionId: base });
    await phoneFiles.updateFile(file.file.id, text('phone edit'), { baseRevisionId: base });
    const phoneEdit = phoneFiles.exportChanges().items.find(change => change.kind === 'UPDATE_CONTENT' && change.actorDeviceId === phone.nodeId);
    const laptopEdit = laptopFiles.exportChanges().items.find(change => change.kind === 'UPDATE_CONTENT' && change.actorDeviceId === laptop.nodeId);
    expect(phoneEdit).toBeDefined();
    expect(laptopEdit).toBeDefined();
    await laptopFiles.applyChange(phoneEdit!);
    await phoneFiles.applyChange(laptopEdit!);
    expect(await laptopFiles.versionHistory(file.file.id)).toHaveLength(3);
    expect(await phoneFiles.versionHistory(file.file.id)).toHaveLength(3);
    expect((await laptopFiles.listConflicts(folder.id)).some(conflict => conflict.kind === 'CONTENT')).toBe(true);
    ownerMesh.close();
    phoneMesh.close();
  }, 180_000);

  it('proves social sharing, authorized content, contributor return flow, revocation and retained-cache limitation', async () => {
    const crypto = new SodiumCryptoProvider();
    const alice = await crypto.generateIdentity();
    const bob = await crypto.generateIdentity();
    const mallory = await crypto.generateIdentity();
    const signerAlice = new CryptoFolderSigner(crypto, alice.privateKey);
    const signerBob = new CryptoFolderSigner(crypto, bob.privateKey);
    const content = largeBytes(320 * 1024, 13);
    const calls: number[] = [];
    const source = sourceFor(content, bob.publicKey, calls);
    const bobCache = new ContentCache(64 * 1024 * 1024);
    const bobDelivery = new DistributedContentFolderDelivery(new DistributedContentService({
      cache: bobCache,
      directory: { async sources() { return [source]; } },
      transferState: new InMemoryContentTransferStateStore(),
      maxInFlightChunks: 2,
    }));
    const aliceFiles = service(alice.publicKey, new ContentCache(64 * 1024 * 1024), { signer: signerAlice });
    const bobFiles = service(bob.publicKey, bobCache, { signer: signerBob, contentDelivery: bobDelivery });
    const folder = await aliceFiles.createFolder({ name: 'Social Shared' });
    const invitation = await aliceFiles.invite(folder.id, { recipientIdentityId: bob.publicKey, role: 'EDITOR' });
    await bobFiles.receiveInvitation(invitation);
    await bobFiles.acceptInvitation(invitation.id);
    await aliceFiles.confirmInvitationAcceptance(invitation.id);
    const aliceFile = await aliceFiles.createFile({ folderId: folder.id, name: 'alice.bin', bytes: content, mimeType: 'application/octet-stream' });
    for (const change of aliceFiles.exportChanges().items) await bobFiles.applyChange(change);
    expect(await bobFiles.readFile(aliceFile.file.id)).toEqual(content);
    const bobFile = await bobFiles.createFile({ folderId: folder.id, name: 'bob.txt', bytes: text('from bob'), mimeType: 'text/plain' });
    const bobChange = bobFiles.exportChanges().items.find(change => change.kind === 'CREATE_FILE' && change.objectId === bobFile.file.id && change.actorIdentityId === bob.publicKey);
    expect(bobChange).toBeDefined();
    await aliceFiles.applyChange(bobChange!);
    expect((await aliceFiles.listFiles(folder.id)).items.some(value => value.file.id === bobFile.file.id)).toBe(true);

    const malloryFiles = service(mallory.publicKey, new ContentCache(64 * 1024 * 1024), { signer: new CryptoFolderSigner(crypto, mallory.privateKey), contentDelivery: bobDelivery });
    await malloryFiles.createFolderFromDescriptor(aliceFiles.getFolder(folder.id)!);
    const aliceCreate = aliceFiles.exportChanges().items.find(change => change.kind === 'CREATE_FILE' && change.objectId === aliceFile.file.id);
    await expect(malloryFiles.applyChange(aliceCreate!)).rejects.toMatchObject({ code: 'NOT_AUTHORIZED' });
    await aliceFiles.revokeMember(folder.id, bob.publicKey, true);
    expect(await bobFiles.readFile(aliceFile.file.id)).toEqual(content);
    const afterRevoke = await aliceFiles.createFile({ folderId: folder.id, name: 'after-revoke.txt', bytes: text('owner only'), mimeType: 'text/plain' });
    const stale = aliceFiles.exportChanges().items.find(change => change.kind === 'CREATE_FILE' && change.objectId === afterRevoke.file.id);
    await expect(bobFiles.applyChange(stale!)).rejects.toMatchObject({ code: 'STALE_EPOCH' });
    await expect(aliceFiles.readFile(aliceFile.file.id, { actorIdentityId: bob.publicKey })).rejects.toMatchObject({ code: 'NOT_AUTHORIZED' });
    expect(calls.length).toBeGreaterThan(0);
  }, 180_000);
});
