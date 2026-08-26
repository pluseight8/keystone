import { describe, expect, it } from 'vitest';
import {
  InMemorySecureSecretHost,
  DeviceKeyHandle,
  DeviceSigningCapability,
  IdentitySigningCapability,
  SecretCapabilityService,
  SecretExportService,
  SecretHandle,
  SecretRedactionPolicy,
  SecretAccessError,
  SecretRevocationRegistry,
  InMemorySecretRevocationStore,
  KeyEpochService,
  SecureClipboardBoundary,
  ScopedPluginSecretNamespace,
  type SecretReference,
} from './secrets.js';

function reference(overrides: Partial<SecretReference> = {}): SecretReference {
  return {
    kind: 'SECRET_REFERENCE', handleId: `test:${crypto.randomUUID()}`, secretClass: 'SESSION_SECRET', risk: 'HIGH', lifetime: 'SESSION', scope: 'SESSION', origin: 'GENERATED', exportPolicy: 'NON_EXPORTABLE', generation: 1, state: 'ACTIVE', createdAt: new Date().toISOString(), securityLevel: 'MEMORY_ONLY', environment: 'TEST', ...overrides,
  };
}

describe('R0P60 secret boundary', () => {
  it('creates opaque handles and never serializes secret bytes', async () => {
    const host = new InMemorySecureSecretHost({ environment: 'TEST' });
    const handle = await host.generate({ secretClass: 'IDENTITY_PRIVATE_KEY', scope: 'IDENTITY', algorithm: 'ED25519' });
    expect(handle).toBeInstanceOf(SecretHandle);
    expect(JSON.stringify(handle)).not.toMatch(/raw|secret-material-bytes|base64-private-key/i);
    expect(handle.reference.securityLevel).toBe('MEMORY_ONLY');
    expect(host.hasMaterial(handle.id)).toBe(true);
  });

  it('enforces scoped, expiring and single-use capabilities', async () => {
    let clock = 1_000;
    const host = new InMemorySecureSecretHost({ environment: 'TEST' });
    const handle = await host.generate({ secretClass: 'SESSION_SECRET', scope: 'SESSION' });
    const service = new SecretCapabilityService(() => clock);
    const capability = service.issue({ handle, callerId: 'agent-a', operations: ['DERIVE_KEY'], ttlMs: 100, maxUses: 1 });
    expect(capability.authorize('ENCRYPT', handle, { callerId: 'agent-a' }).allowed).toBe(false);
    const derived = await host.derive(handle, 'test-purpose', capability);
    expect(derived.reference.secretClass).toBe('DERIVED_KEY');
    expect(() => capability.consume('DERIVE_KEY', handle, { callerId: 'agent-a' })).toThrow(SecretAccessError);
    const second = service.issue({ handle, callerId: 'agent-a', operations: ['DERIVE_KEY'], ttlMs: 100 });
    clock += 101;
    expect(() => second.consume('DERIVE_KEY', handle, { callerId: 'agent-a' })).toThrow(/expired/i);
  });

  it('signs typed domains and rejects cross-domain capability use', async () => {
    const host = new InMemorySecureSecretHost({ environment: 'TEST' });
    const handle = await host.generate({ secretClass: 'IDENTITY_PRIVATE_KEY', scope: 'IDENTITY', algorithm: 'ED25519' });
    const service = new SecretCapabilityService();
    const capability = service.issue({ handle, callerId: 'identity:test', operations: ['SIGN_PROTOCOL_ENVELOPE'], maxUses: 4 });
    const signer = new IdentitySigningCapability(host, handle, capability, 'identity:test', new Set(['KEYSTONE_MESSAGE']));
    const signature = await signer.signProtocolEnvelope('KEYSTONE_MESSAGE', { id: 'm1' });
    expect(signature).toBeTruthy();
    await expect(signer.signOwnerIntent({ action: 'delete' })).rejects.toThrow(/domain/i);
  });

  it('authenticates encryption and rejects tampered ciphertext', async () => {
    const host = new InMemorySecureSecretHost({ environment: 'TEST' });
    const handle = await host.generate({ secretClass: 'BACKUP_ENCRYPTION_KEY', scope: 'BACKUP' });
    const service = new SecretCapabilityService();
    const capability = service.issue({ handle, callerId: 'backup', operations: ['ENCRYPT', 'DECRYPT'], maxUses: 4 });
    const encrypted = await host.encrypt(handle, new TextEncoder().encode('private state'), capability);
    const decrypted = await host.decrypt(handle, encrypted, capability);
    expect(new TextDecoder().decode(decrypted)).toBe('private state');
    await expect(host.decrypt(handle, { ...encrypted, ciphertext: `${encrypted.ciphertext}x` }, capability)).rejects.toThrow(/authentication/i);
  });

  it('requires explicit owner confirmation and rejects replayed recovery intent', async () => {
    const handle = new SecretHandle(reference({ secretClass: 'RECOVERY_SECRET', scope: 'BACKUP', exportPolicy: 'OWNER_EXPORT_WITH_STRONG_CONFIRMATION' }));
    const nonExportable = new SecretHandle(reference({ secretClass: 'IDENTITY_PRIVATE_KEY', scope: 'IDENTITY', exportPolicy: 'NON_EXPORTABLE' }));
    const service = new SecretExportService(() => 10_000);
    expect(() => service.createExportIntent({ ownerIdentityId: 'alice', handle: nonExportable, confirmed: true, policy: { exportAllowed: true, strongConfirmationRequired: true, ttlMs: 1000, recoveryOnly: true } })).toThrow(/forbids export/i);
    expect(() => service.createExportIntent({ ownerIdentityId: 'alice', handle, confirmed: false, policy: { exportAllowed: true, strongConfirmationRequired: true, ttlMs: 1000, recoveryOnly: true } })).toThrow(/confirmation/i);
    const intent = service.createExportIntent({ ownerIdentityId: 'alice', handle, confirmed: true, policy: { exportAllowed: true, strongConfirmationRequired: true, ttlMs: 1000, recoveryOnly: true } });
    service.consumeExportIntent(intent, handle, 'alice');
    expect(() => service.consumeExportIntent(intent, handle, 'alice')).toThrow(/replayed/i);
    const importIntent = service.createImportIntent({ ownerIdentityId: 'alice', confirmed: true });
    service.consumeImportIntent(importIntent, 'alice');
    expect(() => service.consumeImportIntent(importIntent, 'alice')).toThrow(/replayed/i);
  });

  it('redacts secret-shaped values from logs, tools and crash reports', () => {
    const value = { public: 'ok', privateKey: 'raw', nested: { accessToken: 'token' }, safeCiphertext: 'ciphertext' };
    expect(SecretRedactionPolicy.containsManagedSecret(value)).toBe(true);
    const redacted = SecretRedactionPolicy.redact(value);
    expect(redacted).toEqual({ public: 'ok', privateKey: '[REDACTED_SECRET]', nested: { accessToken: '[REDACTED_SECRET]' }, safeCiphertext: 'ciphertext' });
  });

  it('rotates epochs monotonically and removes members from future epochs', async () => {
    const host = new InMemorySecureSecretHost({ environment: 'TEST' });
    const epochs = new KeyEpochService(host, 'COMMUNITY');
    await epochs.createInitial();
    await epochs.rotate(['alice', 'bob']);
    epochs.remove('bob');
    await epochs.rotate(['alice']);
    expect(epochs.currentEpoch).toBe(3);
    expect(epochs.authorize('bob', 3).allowed).toBe(false);
    expect(epochs.authorize('alice', 3).allowed).toBe(true);
    expect(epochs.authorize('alice', 2).allowed).toBe(false);
  });

  it('keeps plugin secret namespaces scoped to the plugin', async () => {
    const host = new InMemorySecureSecretHost({ environment: 'TEST' });
    const namespace = new ScopedPluginSecretNamespace('plugin-a', host);
    await namespace.generate({ secretClass: 'PLUGIN_SECRET', lifetime: 'DURABLE', exportPolicy: 'NON_EXPORTABLE' });
    expect(namespace.inventory().namespace).toBe('plugin:plugin-a');
    expect(namespace.inventory().handles[0].scope).toBe('PLUGIN');
  });

  it('persists handle revocation and denies cached capabilities after restart', async () => {
    const store = new InMemorySecretRevocationStore();
    const first = new SecretRevocationRegistry(store); await first.ready();
    const host = new InMemorySecureSecretHost({ environment: 'TEST', revocations: first });
    const handle = await host.generate({ secretClass: 'SESSION_SECRET', scope: 'SESSION' });
    const capability = new SecretCapabilityService(Date.now, first).issue({ handle, callerId: 'session', operations: ['DERIVE_KEY'] });
    await host.revoke(handle);
    const second = new SecretRevocationRegistry(store); await second.ready();
    expect(second.isRevoked(handle.id)).toBe(true);
    expect(() => new SecretCapabilityService(Date.now, second).authorize(capability, 'DERIVE_KEY', handle, { callerId: 'session' })).not.toThrow();
    expect(new SecretCapabilityService(Date.now, second).authorize(capability, 'DERIVE_KEY', handle, { callerId: 'session' }).allowed).toBe(false);
  });

  it('never treats the development host as a production secure host', () => {
    expect(() => new InMemorySecureSecretHost({ environment: 'PRODUCTION' })).toThrow(/production/i);
  });

  it('requires explicit clipboard confirmation and supports bounded auto-clear', async () => {
    const writes: Array<{ text: string; autoClearMs?: number }> = [];
    const boundary = new SecureClipboardBoundary({ write: async (text, options) => { writes.push({ text, ...options }); } });
    await expect(boundary.copy({ kind: 'CLIPBOARD_COPY_INTENT', text: 'secret-like value', ownerConfirmed: false as never })).rejects.toThrow(/confirmation/i);
    await boundary.copy({ kind: 'CLIPBOARD_COPY_INTENT', text: 'owner-approved', ownerConfirmed: true, autoClearMs: 10_000 });
    expect(writes).toEqual([{ text: 'owner-approved', autoClearMs: 10_000 }]);
    await expect(boundary.copy({ kind: 'CLIPBOARD_COPY_INTENT', text: 'owner-approved', ownerConfirmed: true, autoClearMs: 20 * 60_000 })).rejects.toThrow(/auto-clear/i);
  });

  it('denies capabilities after a handle is closed, even without a host lookup', async () => {
    const host = new InMemorySecureSecretHost({ environment: 'TEST' });
    const handle = await host.generate({ secretClass: 'SESSION_SECRET', scope: 'SESSION' });
    const service = new SecretCapabilityService();
    const capability = service.issue({ handle, callerId: 'session', operations: ['DERIVE_KEY'] });
    handle.close();
    expect(capability.authorize('DERIVE_KEY', handle, { callerId: 'session' }).allowed).toBe(false);
  });

  it('keeps device signing scoped to the device handle and target', async () => {
    const host = new InMemorySecureSecretHost({ environment: 'TEST' });
    const handle = await host.generate({ secretClass: 'DEVICE_PRIVATE_KEY', scope: 'DEVICE', algorithm: 'ED25519' });
    const deviceHandle = new DeviceKeyHandle(handle.reference, 'device-a');
    const service = new SecretCapabilityService();
    const grant = service.issue({ handle: deviceHandle, callerId: 'device-a', operations: ['SIGN_PROTOCOL_ENVELOPE'], scope: 'DEVICE', target: 'device-a', maxUses: 2 });
    const signer = new DeviceSigningCapability(host, deviceHandle, grant, 'device-a', 'device-a');
    await expect(signer.signProtocolEnvelope('KEYSTONE_DEVICE', { id: 'device-event' })).resolves.toBeTruthy();
    signer.setRevocationState('REVOKED');
    await expect(signer.signProtocolEnvelope('KEYSTONE_DEVICE', { id: 'revoked' })).rejects.toThrow(/authorized/i);
  });

  it('fuzzes mutated handles, domains, expiry and recovery intents without escalation', async () => {
    const host = new InMemorySecureSecretHost({ environment: 'TEST' });
    const handle = await host.generate({ secretClass: 'RECOVERY_SECRET', scope: 'BACKUP', exportPolicy: 'OWNER_EXPORT_WITH_STRONG_CONFIRMATION' });
    const service = new SecretCapabilityService();
    const capability = service.issue({ handle, callerId: 'owner', operations: ['DERIVE_KEY'], maxUses: 64 });
    for (let index = 0; index < 64; index += 1) {
      const mutated = new SecretHandle({ ...handle.reference, handleId: `${handle.id}:mutated-${index}` });
      expect(capability.authorize(index % 2 ? 'SIGN_PROTOCOL_ENVELOPE' : 'DERIVE_KEY', mutated, { callerId: index % 3 ? 'owner' : 'attacker' }).allowed).toBe(false);
    }
    const exportService = new SecretExportService(() => 1_000);
    const intent = exportService.createExportIntent({ ownerIdentityId: 'owner', handle, confirmed: true, policy: { exportAllowed: true, strongConfirmationRequired: true, ttlMs: 500, recoveryOnly: true } });
    for (const mutation of [
      { ...intent, ownerIdentityId: 'attacker' },
      { ...intent, handleId: `${intent.handleId}:wrong` },
      { ...intent, expiresAt: new Date(0).toISOString() },
      { ...intent, confirmed: false },
    ]) expect(() => exportService.consumeExportIntent(mutation, handle, 'owner')).toThrow();
  });
});
