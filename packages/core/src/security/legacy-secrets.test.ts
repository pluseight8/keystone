import { describe, expect, it } from 'vitest';
import { CapabilityEnvelopeSecurity, IdentityManager, SelfEnvelopeSecurity } from '../identity.js';
import {
  InMemorySecureSecretHost,
  LegacySecretCompatibilityBoundary,
  LegacySecretMigrationService,
  SecretAccessError,
  type SecretReference,
} from './secrets.js';

describe('legacy secret compatibility boundary', () => {
  it('fails closed for production and for an identity without an explicit context', async () => {
    expect(() => LegacySecretCompatibilityBoundary.open({ environment: 'PRODUCTION', purpose: 'MIGRATION', caller: 'host' })).toThrow(SecretAccessError);
    const identity = new IdentityManager(undefined, { legacyCompatibility: null });
    expect(() => identity.masterSeed).toThrow(/legacy raw-secret/i);
    await expect(identity.sessionKeys('production-device')).rejects.toThrow(/legacy raw-secret/i);
  });

  it('keeps the old fixture API audited and non-enumerable', async () => {
    const boundary = LegacySecretCompatibilityBoundary.forTests('legacy-secrets-test');
    const identity = await IdentityManager.generate({ legacyCompatibility: boundary });
    const keys = await identity.sessionKeys('fixture-device', boundary);
    expect(keys.privateKey).toEqual(expect.any(String));
    expect(keys.encryptionPrivateKey).toEqual(expect.any(String));
    expect(Object.keys(keys)).not.toContain('privateKey');
    expect(Object.keys(keys)).not.toContain('encryptionPrivateKey');
    const serialized = JSON.stringify({ keys, error: new Error('raw privateKey should not be persisted') });
    expect(serialized).not.toContain(keys.privateKey);
    expect(serialized).not.toContain(keys.encryptionPrivateKey);
    expect(boundary.audit().map(record => record.operation)).toContain('DERIVE_SESSION_KEYS');
    expect(() => new SelfEnvelopeSecurity(keys, {}, undefined, boundary)).not.toThrow();
  });

  it('imports legacy bytes into an opaque host handle idempotently', async () => {
    const host = new InMemorySecureSecretHost({ environment: 'TEST' });
    const boundary = LegacySecretCompatibilityBoundary.open({ environment: 'DEVELOPMENT', purpose: 'MIGRATION', caller: 'identity-migration' });
    const records: { value: any[] } = { value: [] };
    const store = { read: async () => records.value, write: async (value: readonly any[]) => { records.value = [...value]; } };
    const migration = new LegacySecretMigrationService(host, boundary, store);
    const bytes = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
    const input = { secretClass: 'IDENTITY_PRIVATE_KEY' as const, scope: 'IDENTITY' as const, algorithm: 'ED25519' as const, bytes };
    const first = await migration.import(input);
    const second = await migration.import(input);
    expect(first.id).toBe(second.id);
    const [concurrentA, concurrentB] = await Promise.all([migration.import(input), migration.import(input)]);
    expect(concurrentA.id).toBe(concurrentB.id);
    expect(first.toJSON()).not.toHaveProperty('bytes');
    expect(host.hasMaterial(first.id)).toBe(true);
    expect(migration.snapshot()).toHaveLength(1);
    expect(boundary.audit().map(record => record.operation)).toContain('IMPORT_LEGACY_SECRET');
    expect(JSON.stringify(migration.snapshot())).not.toContain(new TextDecoder().decode(bytes));
    const restarted = new LegacySecretMigrationService(host, boundary, store);
    expect((await restarted.import(input)).id).toBe(first.id);
  });

  it('does not let user/remote configuration turn on compatibility', () => {
    const identity = new IdentityManager(undefined, { legacyCompatibility: null });
    const remote = { legacyMode: true, compatibility: 'PRODUCTION', masterSeed: 'attacker-controlled' };
    expect(() => identity.exportMasterSeed(remote as never)).toThrow(/legacy raw-secret/i);
    const reference: SecretReference = {
      kind: 'SECRET_REFERENCE', handleId: 'secret:test', secretClass: 'IDENTITY_PRIVATE_KEY', risk: 'CRITICAL', lifetime: 'DURABLE', scope: 'IDENTITY', origin: 'GENERATED', exportPolicy: 'NON_EXPORTABLE', generation: 1, state: 'ACTIVE', createdAt: new Date().toISOString(), securityLevel: 'MEMORY_ONLY', environment: 'TEST',
    };
    expect(JSON.stringify(reference)).not.toContain('attacker-controlled');
  });

  it('uses the SecureSecretHost path for production-shaped typed signing', async () => {
    const host = new InMemorySecureSecretHost({ environment: 'TEST' });
    const identity = await IdentityManager.generate({ legacyCompatibility: null, secretHost: host });
    const signer = await identity.createIdentitySigningCapability('typed-device', { callerId: 'typed-runtime' });
    await expect(signer.signProtocolEnvelope('KEYSTONE_MESSAGE', { id: 'typed-message' })).resolves.toEqual(expect.any(String));
    expect(signer.secretReference.environment).toBe('TEST');
    signer.close();
  });

  it('keeps transport signing capability-oriented without a raw session-key object', async () => {
    const host = new InMemorySecureSecretHost({ environment: 'TEST' });
    const identity = await IdentityManager.generate({ legacyCompatibility: null, secretHost: host });
    const metadata = await identity.devicePublicIdentity('transport-device');
    const signer = await identity.createDeviceSigningCapability('transport-device', { callerId: 'transport-runtime' });
    const security = new CapabilityEnvelopeSecurity(metadata, signer);
    const unsigned = { version: 1 as const, type: 'security.capability', id: 'capability-envelope', sender: metadata.nodeId, recipient: metadata.nodeId, nonce: 'nonce-1', expiresAt: new Date(Date.now() + 30_000).toISOString(), body: { ok: true } };
    const envelope = { ...unsigned, signature: await security.sign(unsigned) };
    await expect(security.verify(envelope)).resolves.toBe(true);
    expect(JSON.stringify(envelope)).not.toMatch(/privateKey|encryptionPrivateKey|masterSeed|sessionKeys/i);
    signer.close();
  });

  it('returns only public device metadata without opening the legacy boundary', async () => {
    const identity = new IdentityManager(undefined, { legacyCompatibility: null });
    const publicIdentity = await identity.devicePublicIdentity('metadata-device');
    expect(publicIdentity).toEqual(expect.objectContaining({ deviceId: 'metadata-device', nodeId: expect.any(String), publicKey: expect.any(String), encryptionPublicKey: expect.any(String) }));
    expect(JSON.stringify(publicIdentity)).not.toMatch(/private|seed|secret/i);
  });

  it('keeps the generic package entrypoint free of legacy secret APIs', async () => {
    const entrypoint = await import('../index.js') as Record<string, unknown>;
    expect(entrypoint).not.toHaveProperty('LegacySecretCompatibilityBoundary');
    expect(entrypoint).not.toHaveProperty('InMemorySecureSecretHost');
    expect(entrypoint).not.toHaveProperty('SelfEnvelopeSecurity');
    expect(entrypoint).not.toHaveProperty('DeviceSessionKeys');
    expect(entrypoint).not.toHaveProperty('SodiumCryptoProvider');
    expect(entrypoint).not.toHaveProperty('SodiumKeyPair');
    expect(entrypoint).toHaveProperty('CapabilityEnvelopeSecurity');
  });
});
