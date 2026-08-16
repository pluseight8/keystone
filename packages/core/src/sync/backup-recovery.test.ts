import { describe, expect, it } from 'vitest';
import { BackupService, DEFAULT_BACKUP_POLICY, migrateBackupPayload, type KeystoneBackupState } from './backup-recovery.js';

const secret = 'recovery-secret-for-phase-28';
const state: KeystoneBackupState = {
  identitySecurity: { identityId: 'alice-id', masterSeed: 'alice-master-seed', devices: [{ deviceId: 'alice-device', revoked: false }] },
  settings: { language: 'ru', privacy: { presence: false } },
  socialGraph: { follows: ['bob-id'], blocks: [] },
  conversations: { direct: [{ id: 'conversation-1', messages: ['hello'] }], groups: [] },
  communities: { public: [{ id: 'community-1' }] },
  privateCommunities: { encrypted: [{ id: 'private-1', epoch: 3, ciphertext: 'opaque' }] },
  mediaMetadata: { tracks: ['track-1'], videos: ['video-1'], files: ['file-1'] },
  libraryPlaylists: { library: ['track-1'], playlists: [{ id: 'playlist-1', tracks: ['track-1'] }] },
  notifications: { unread: ['notification-1'], read: [] },
  storageReferences: { pinned: ['file-1'], userOwned: ['file-1'] },
  userOwnedMedia: { files: [{ id: 'file-1', contentId: 'sha256-abc' }] },
  cache: { chunks: [{ contentId: 'sha256-abc', index: 0 }] },
};

describe('Phase 28 encrypted backup and recovery', () => {
  it('round-trips selected durable state and exposes only safe inspection metadata', async () => {
    const service = new BackupService();
    const created = await service.create(state, { recoverySecret: secret, now: new Date('2026-08-16T10:00:00.000Z') });
    const inspection = service.inspect(created.bytes);
    expect(inspection).toMatchObject({ format: 'keystone.backup', version: 2, createdAt: '2026-08-16T10:00:00.000Z', cacheIncluded: false, encrypted: true });
    expect(inspection.sections).toContain('identity-security');
    expect(inspection.sections).not.toContain('cache');
    expect(new TextDecoder().decode(created.bytes)).not.toContain(secret);
    expect(new TextDecoder().decode(created.bytes)).not.toContain('alice-master-seed');
    const restored = await service.restore(created.bytes, secret);
    expect(restored.state.identitySecurity).toEqual(state.identitySecurity);
    expect(restored.state.privateCommunities).toEqual(state.privateCommunities);
    expect(restored.state.userOwnedMedia).toEqual(state.userOwnedMedia);
    expect(restored.state.cache).toBeUndefined();
  });

  it('rejects wrong secret, tampering, truncation and forbidden plaintext secret fields', async () => {
    const service = new BackupService();
    const created = await service.create({ identitySecurity: state.identitySecurity }, { recoverySecret: secret });
    await expect(service.restore(created.bytes, 'wrong-recovery-secret')).rejects.toThrow(/Incorrect recovery secret/);
    const tampered = created.bytes.slice(); tampered[tampered.length - 1] ^= 1;
    await expect(service.restore(tampered, secret)).rejects.toThrow(/Incorrect recovery secret/);
    await expect(service.restore(created.bytes.slice(0, -3), secret)).rejects.toThrow(/Truncated|Incorrect recovery secret/);
    await expect(service.create({ identitySecurity: { privateKey: 'do-not-export' } }, { recoverySecret: secret })).rejects.toThrow(/forbidden secret field/);
  });

  it('supports explicit secret boundaries, atomic restore targets, selective cache and schema migration', async () => {
    const service = new BackupService(); let requested: 'create' | 'restore' | undefined;
    const boundary = { requestSecret: async (context: { purpose: 'create' | 'restore' }) => { requested = context.purpose; return secret; } };
    const created = await service.createWithBoundary(state, boundary, { policy: { ...DEFAULT_BACKUP_POLICY, cache: true } });
    expect(requested).toBe('create');
    expect(service.inspect(created.bytes).cacheIncluded).toBe(true);
    let staged: KeystoneBackupState | undefined; let committed = false; let rolledBack = false;
    const restored = await service.restoreWithBoundary(created.bytes, { requestSecret: async context => { requested = context.purpose; return secret; } }, { stage: async value => { staged = value; return { commit: async () => { committed = true; }, rollback: async () => { rolledBack = true; } }; } });
    expect(requested).toBe('restore'); expect(committed).toBe(true); expect(rolledBack).toBe(false); expect(staged?.identitySecurity).toEqual(state.identitySecurity); expect(restored.state.cache).toEqual(state.cache);
    const legacy = migrateBackupPayload({ version: 1, state: { settings: { language: 'en' }, 'identity-security': { identityId: 'legacy' } } });
    expect(legacy.migratedFrom).toBe(1); expect(legacy.state.settings).toEqual({ language: 'en' }); expect(legacy.state.identitySecurity).toEqual({ identityId: 'legacy' });
  });
});
