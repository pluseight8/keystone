import { describe, expect, it } from 'vitest';
import { SodiumCryptoProvider } from '../crypto.js';
import { IdentityManager } from '../identity.js';
import { ContentCache, type ContentManifest, type ContentProvider, contentUri, createContentManifest, sha256 } from './content.js';
import { LocalContentStore } from './music.js';
import { CommunityService } from './communities.js';
import { InMemoryCommunityStorage } from './community-storage.js';
import { InMemoryPrivateCommunityStateStorage, PrivateCommunityService } from './private-communities.js';
import {
  FileService,
  FileStorageManager,
  FileTransferManager,
  InMemoryEncryptedFileStateStore,
  InMemoryFileStorage,
  PersistentFileStorage,
  type FileProviderDirectory,
} from './files.js';
import type { FileObject } from './object-model.js';
import { UnifiedDiscoveryService } from './discovery.js';

const bytes = (size: number) => Uint8Array.from({ length: size }, (_, index) => index % 251);

class Provider implements ContentProvider {
  calls = 0;
  constructor(readonly id: string, private readonly source: Uint8Array, private readonly manifest: ContentManifest, private readonly corrupt = false, private readonly failAt = new Set<number>()) {}
  async getChunk(_contentId: ContentManifest['contentId'], index: number): Promise<Uint8Array> {
    this.calls++; if (this.failAt.has(index)) throw new Error(`${this.id} unavailable`);
    const start = index * this.manifest.chunkSize; const value = this.source.subarray(start, Math.min(this.source.length, start + this.manifest.chunkSize)); return this.corrupt ? Uint8Array.from(value, byte => byte ^ 0xff) : value;
  }
}

async function peer(name: string) { return (await IdentityManager.generate()).sessionKeys(name); }

describe('Files, storage and provider availability', () => {
  it('imports a signed deterministic FileObject and keeps private metadata encrypted-only', async () => {
    const keys = await peer('alice'), cache = new ContentCache(256 * 1024), content = new LocalContentStore('alice', cache), storage = new InMemoryFileStorage(), service = new FileService(storage, new SodiumCryptoProvider(), keys, content), source = bytes(40_000);
    const encrypted = { epoch: 2, keyId: 'epoch-key', nonce: 'n'.repeat(24), communityId: crypto.randomUUID() };
    const first = await service.import({ bytes: source, filename: 'secret.bin', mimeType: 'application/octet-stream', visibility: 'private', encrypted });
    const second = await service.import({ bytes: source, filename: 'secret.bin', mimeType: 'application/octet-stream', visibility: 'private', encrypted });
    expect(first.file.id).toBe(second.file.id); expect(first.file.payload.contentId).toBe(first.manifest.contentId); expect(first.file.payload.encrypted?.keyId).toBe('epoch-key'); expect(first.file.visibility).toBe('private');
    const remote = new FileService(new InMemoryFileStorage(), new SodiumCryptoProvider(), await peer('bob'), content); expect(await remote.ingest({ ...first.file, signature: 'spoofed' })).toBeUndefined(); expect(await remote.ingest(first.file)).toBeDefined();
    const adapted = await service.importWithEncryption({ plaintext: bytes(4_000), filename: 'adapter.bin', mimeType: 'application/octet-stream', visibility: 'private' }, { async encrypt(value) { return { ciphertext: Uint8Array.from(value, byte => byte ^ 0xaa), epoch: 3, keyId: 'adapter-key', nonce: 'x'.repeat(24) }; } }); expect(adapted.file.payload.encrypted?.epoch).toBe(3);
    const privateCommunities = new PrivateCommunityService(new InMemoryPrivateCommunityStateStorage(), new CommunityService(new InMemoryCommunityStorage(), new SodiumCryptoProvider(), keys), new SodiumCryptoProvider(), keys); const privateCommunity = await privateCommunities.createCommunity({ name: 'Private files', visibility: 'private' }); const plaintext = bytes(3_000); const encryptedAttachment = await privateCommunities.encryptAttachment(privateCommunity.id, plaintext, { mimeType: 'application/octet-stream', name: 'cipher.bin' }); const encryptedFile = await service.importWithEncryption({ plaintext, filename: 'cipher.bin', mimeType: 'application/octet-stream', visibility: 'community', communityId: privateCommunity.id }, { async encrypt() { return { ciphertext: encryptedAttachment.bytes, epoch: encryptedAttachment.epoch, keyId: encryptedAttachment.keyId, nonce: encryptedAttachment.nonce, communityId: privateCommunity.id }; } }); expect(encryptedFile.file.payload.contentId).not.toBe(`sha256-${await sha256(plaintext)}`); await expect(privateCommunities.decryptAttachment(encryptedAttachment, encryptedAttachment.bytes, privateCommunity.id)).resolves.toEqual(plaintext);
    const discovery = new UnifiedDiscoveryService(); expect(await discovery.ingest(adapted.file, 'public')).toBe(false); const publicFile = await service.import({ bytes: bytes(4_000), filename: 'public.txt', mimeType: 'text/plain', visibility: 'public' }); expect(await discovery.ingest(publicFile.file, 'public')).toBe(true);
  });

  it('downloads a large file with bounded parallel providers, rejects corruption, and resumes verified chunks', async () => {
    const source = bytes(160 * 1024), manifest = await createContentManifest(source, { mimeType: 'application/octet-stream', chunkSize: 16 * 1024 }), cache = new ContentCache(source.length * 2), corrupt = new Provider('mallory', source, manifest, true), healthy = new Provider('charlie', source, manifest), directory: FileProviderDirectory = { async manifest() { return manifest; }, async providers() { return [corrupt, healthy]; } }, manager = new FileTransferManager(cache, directory, undefined, 3);
    const file = { id: crypto.randomUUID(), type: 'file_object', version: 1, author: 'a'.repeat(32), createdAt: new Date().toISOString(), visibility: 'public', references: [], payload: { fileId: crypto.randomUUID(), filename: 'large.bin', mimeType: manifest.mimeType, size: manifest.byteLength, contentId: manifest.contentId, owner: 'a'.repeat(32), uploader: 'a'.repeat(32) }, signature: 'signed-file' } as unknown as FileObject;
    const result = await manager.download(file, { maxParallel: 3 }); expect(result).toEqual(source); expect(corrupt.calls).toBeGreaterThan(0); expect(healthy.calls).toBeGreaterThan(0); expect(manager.state(file).status).toBe('complete');
    const interruptedCache = new ContentCache(source.length * 2), interrupted = new Provider('alice', source, manifest, false, new Set([2])), interruptedDirectory: FileProviderDirectory = { async manifest() { return manifest; }, async providers() { return [interrupted]; } }, interruptedManager = new FileTransferManager(interruptedCache, interruptedDirectory, undefined, 2);
    await expect(interruptedManager.download(file, { maxParallel: 1 })).rejects.toThrow('unavailable'); expect(interruptedCache.missing(manifest)).toContain(2); const resumed = new Provider('charlie', source, manifest); const resumedManager = new FileTransferManager(interruptedCache, { async manifest() { return manifest; }, async providers() { return [resumed]; } }, undefined, 2); expect(await resumedManager.download(file)).toEqual(source); expect(resumed.calls).toBeLessThan(manifest.chunks.length);
  });

  it('reports availability and protects user-owned/pinned data from ordinary eviction while allowing explicit deletion', async () => {
    const source = bytes(30_000), manifest = await createContentManifest(source, { mimeType: 'application/octet-stream', chunkSize: 16 * 1024 }), cache = new ContentCache(40_000), content = new LocalContentStore('owner', cache), keys = await peer('owner'), storage = new InMemoryFileStorage(), service = new FileService(storage, new SodiumCryptoProvider(), keys, content), imported = await service.import({ bytes: source, filename: 'owned.bin', mimeType: manifest.mimeType, visibility: 'public' }), backend = new InMemoryEncryptedFileStateStore(), policy = new FileStorageManager(cache, backend);
    await policy.register(imported.file, { userOwned: true }); expect(policy.availability(imported.file, imported.manifest, []).status).toBe('AVAILABLE LOCAL'); await policy.pin(imported.file); expect(cache.isPinned(manifest.contentId)).toBe(true); await policy.evict(); expect(await cache.read(manifest.contentId)).toEqual(source); expect(policy.usage().usedBytes).toBe(source.length); await policy.deleteLocalCopy(imported.file); expect(await cache.read(manifest.contentId)).toBeUndefined();
    const restarted = new FileStorageManager(cache, backend); await restarted.ready(); expect(restarted.record(imported.file.id)?.storageClass).toBe('temporary');
  });

  it('persists FileObjects across restart and reuses one ID in a file reference', async () => {
    const backend = new InMemoryEncryptedFileStateStore(), storage = new PersistentFileStorage(backend), keys = await peer('alice'), cache = new ContentCache(100_000), content = new LocalContentStore('alice', cache), service = new FileService(storage, new SodiumCryptoProvider(), keys, content), imported = await service.import({ bytes: bytes(20_000), filename: 'shared.txt', mimeType: 'text/plain', visibility: 'public' });
    const restarted = new FileService(new PersistentFileStorage(backend), new SodiumCryptoProvider(), keys, content); expect((await restarted.get(imported.file.id))?.payload.filename).toBe('shared.txt'); expect(contentUri(imported.file.payload.contentId as `sha256-${string}`)).toContain(imported.file.payload.contentId);
  });
});
