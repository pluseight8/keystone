import { describe, expect, it } from 'vitest';
import { SodiumCryptoProvider } from '../crypto.js';
import { IdentityManager } from '../identity.js';
import { DeviceService, InMemoryDeviceStateStorage, SecurityEventLog, InMemorySecurityEventStorage } from './devices.js';

describe('trusted devices and security center', () => {
  it('authorizes, persists and revokes a second device with signed events', async () => {
    const crypto = new SodiumCryptoProvider(); const aliceManager = await IdentityManager.generate(); const alice = await aliceManager.sessionKeys('alice'); const tablet = await aliceManager.sessionKeys('tablet');
    const storage = new InMemoryDeviceStateStorage(); const events = new SecurityEventLog(new InMemorySecurityEventStorage());
    const owner = new DeviceService(storage, crypto, alice, { events }); await owner.ready();
    const authorization = await owner.authorizeDevice({ deviceId: tablet.nodeId, name: 'Tablet', platform: 'android', publicKey: tablet.publicKey, encryptionPublicKey: tablet.encryptionPublicKey });
    expect((await owner.get(tablet.nodeId))?.name).toBe('Tablet');
    const second = new DeviceService(new InMemoryDeviceStateStorage(), crypto, tablet, { identityId: alice.nodeId, authorityKeys: alice, events: new SecurityEventLog(new InMemorySecurityEventStorage()) }); await second.ready();
    expect(await second.acceptAuthorization(authorization)).toBe(true);
    const privileged = await second.makePrivilegedEvent('settings.update', { language: 'ru' });
    expect(await owner.acceptPrivileged(privileged)).toBe(true);
    const revocation = await owner.revokeDevice(tablet.nodeId, 'lost tablet');
    expect(await second.acceptRevocation(revocation)).toBe(true);
    await expect(second.makePrivilegedEvent('settings.update', {})).rejects.toThrow('revoked');
    expect((await second.events.stats()).rejected).toBeGreaterThan(0);
    const restarted = new DeviceService(storage, crypto, alice, { events }); await restarted.ready(); expect((await restarted.get(tablet.nodeId))?.revoked).toBe(true);
  });

  it('rejects spoofed and replayed authorizations without exposing secrets', async () => {
    const crypto = new SodiumCryptoProvider(); const alice = await (await IdentityManager.generate()).sessionKeys('alice'); const mallory = await (await IdentityManager.generate()).sessionKeys('mallory'); const target = await (await IdentityManager.generate()).sessionKeys('phone');
    const owner = new DeviceService(new InMemoryDeviceStateStorage(), crypto, alice); await owner.ready();
    const unsigned = { version: 1 as const, kind: 'device_authorization' as const, id: globalThis.crypto.randomUUID(), identityId: alice.nodeId, deviceId: target.nodeId, name: 'Phone', platform: 'ios', publicKey: target.publicKey, encryptionPublicKey: target.encryptionPublicKey, createdAt: new Date().toISOString(), joinedAt: new Date().toISOString(), issuedBy: alice.nodeId };
    const signature = await crypto.sign(JSON.stringify(unsigned), mallory.privateKey); // deliberately not canonical/authority-signed
    expect(await owner.acceptAuthorization({ ...unsigned, signature })).toBe(false);
    const valid = await owner.authorizeDevice({ deviceId: target.nodeId, name: 'Phone', platform: 'ios', publicKey: target.publicKey, encryptionPublicKey: target.encryptionPublicKey });
    expect(await owner.acceptAuthorization(valid)).toBe(false);
    const summary = await owner.securitySummary(); expect(summary.recovery.revealRequired).toBe(true); expect('privateKey' in summary).toBe(false); expect((await owner.events.stats()).suspicious).toBeGreaterThan(0);
  });

  it('redacts secret-shaped security-event metadata before durable audit', async () => {
    const events = new SecurityEventLog(new InMemorySecurityEventStorage()); await events.ready();
    await events.record({ kind: 'spoof_attempt', reason: 'invalid request', metadata: { apiKey: 'should-not-persist', detail: 'safe' } });
    const value = (await events.list())[0]!;
    expect(value.metadata).toEqual({ apiKey: '[REDACTED_SECRET]', detail: 'safe' });
  });
});
