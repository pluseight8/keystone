import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { canonicalJson, SodiumCryptoProvider } from '../crypto.js';
import { IdentityManager, type DeviceSessionKeys } from '../identity.js';
import { KEYSTONE_OBJECT_VERSION, type KeystoneObject } from './object-model.js';
import { InMemoryNotificationStateStore, NotificationService, PersistentNotificationStorage } from './notifications.js';
import { InMemoryVideoStorage, VideoContentStore, VideoService } from './video.js';
import { ContentCache } from './content.js';

async function signed(keys: DeviceSessionKeys, type: KeystoneObject['type'], payload: Record<string, unknown>, visibility: KeystoneObject['visibility'] = 'public'): Promise<KeystoneObject> {
  const crypto = new SodiumCryptoProvider(); const unsigned = { version: KEYSTONE_OBJECT_VERSION as 1, type, id: randomUUID(), author: keys.nodeId, createdAt: new Date().toISOString(), visibility, references: [], payload }; return { ...unsigned, signature: await crypto.sign(canonicalJson(unsigned), keys.privateKey) } as KeystoneObject;
}

describe('NotificationService', () => {
  it('classifies signed objects, deduplicates replay, and persists read state', async () => {
    const crypto = new SodiumCryptoProvider(); const alice = await (await IdentityManager.generate()).sessionKeys('alice'); const bob = await (await IdentityManager.generate()).sessionKeys('bob'); const backend = new InMemoryNotificationStateStore(); const service = new NotificationService(new PersistentNotificationStorage(backend), alice.nodeId, crypto); const follow = await signed(bob, 'follow', { target: alice.nodeId, action: 'follow' });
    expect((await service.ingest(follow))?.category).toBe('follow'); expect(await service.ingest(follow)).toBeDefined(); expect(await service.unreadCount()).toBe(1); expect((await service.list()).length).toBe(1);
    const record = (await service.list())[0]; await service.markRead(record.id); expect(await service.unreadCount()).toBe(0);
    const restarted = new NotificationService(new PersistentNotificationStorage(backend), alice.nodeId, crypto); expect((await restarted.list())[0].read).toBe(true);
    expect(await restarted.ingest({ ...follow, signature: 'tampered' })).toBeUndefined();
    const short = await signed(bob, 'video', { title: 'Short', videoId: randomUUID(), videoUri: 'keystone://content/sha256-' + 'b'.repeat(64), durationMs: 1_000, dimensions: { width: 9, height: 16 }, videoStream: { codec: 'vp9', container: 'webm' }, shortForm: { aspectRatio: '9:16' }, renditions: [] });
    expect((await restarted.ingest(short))?.category).toBe('short');
    const videoService = new VideoService(new InMemoryVideoStorage(), crypto, bob); const imported = await videoService.import({ bytes: Uint8Array.from([1, 2, 3]), mimeType: 'video/webm', title: 'Real short', durationMs: 1_000, dimensions: { width: 9, height: 16 }, videoStream: { codec: 'vp9', container: 'webm' }, shortForm: { aspectRatio: '9:16' } }, new VideoContentStore('test', new ContentCache(16 * 1024))); expect((await restarted.ingest(imported.video))?.category).toBe('short');
  });
  it('filters blocked and muted actors without publishing local read state', async () => {
    const crypto = new SodiumCryptoProvider(); const alice = await (await IdentityManager.generate()).sessionKeys('alice'); const bob = await (await IdentityManager.generate()).sessionKeys('bob'); let blocked = false; const service = new NotificationService(new PersistentNotificationStorage(new InMemoryNotificationStateStore()), alice.nodeId, crypto, { policy: { isBlocked: () => blocked } }); const track = await signed(bob, 'track', { title: 'P2P track', trackId: randomUUID(), audioUri: 'keystone://content/sha256-' + 'a'.repeat(64) });
    expect((await service.ingest(track))?.category).toBe('track'); blocked = true; expect(await service.list()).toHaveLength(0); blocked = false; await service.setCategoryMuted('track', true); expect(await service.ingest(track)).toBeUndefined(); expect(await service.list()).toHaveLength(0); expect(service.settings().mutedCategories).toContain('track');
  });
});
