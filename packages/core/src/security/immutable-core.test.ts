import { describe, expect, it } from 'vitest';
import { IdentityManager } from '../identity.js';
import { SodiumCryptoProvider } from '../crypto.js';
import {
  ImmutableCore,
  IdentitySecretAccess,
  InMemoryIntegrityFileReader,
  InMemoryRollbackStateStore,
  IntegrityVerifier,
  MandatoryPolicyRoot,
  RollbackProtection,
  SecurityLockdown,
  createCryptoReleaseTrustRoot,
  createIntegrityEntry,
  createSignedIntegrityManifest,
  remoteBuildClaimAllowsPrivilege,
  PRIVILEGED_OPERATIONS,
  type IntegrityManifest,
} from './immutable-core.js';

async function fixture(epoch = 1, files: Record<string, string> = { 'core/identity.js': 'identity-v1', 'policy/mandatory.json': 'policy-v1', 'protocol/schema.json': 'schema-v1' }): Promise<{ manifest: IntegrityManifest; files: Record<string, string>; crypto: SodiumCryptoProvider; publicKey: string; privateKey: string; keyId: string }> {
  const crypto = new SodiumCryptoProvider();
  const keys = await crypto.generateIdentity();
  const entries = await Promise.all([
    createIntegrityEntry({ path: 'core/identity.js', componentId: 'identity', bytes: files['core/identity.js']!, trustClass: 'IMMUTABLE_CORE' }),
    createIntegrityEntry({ path: 'policy/mandatory.json', componentId: 'mandatory-policy', bytes: files['policy/mandatory.json']!, trustClass: 'IMMUTABLE_CORE' }),
    createIntegrityEntry({ path: 'protocol/schema.json', componentId: 'protocol-schema', bytes: files['protocol/schema.json']!, trustClass: 'IMMUTABLE_CORE' }),
  ]);
  const manifest = await createSignedIntegrityManifest({ releaseId: 'test-release', releaseVersion: '0.0.0-test', buildId: 'build-test', platform: 'linux', architecture: 'x64', createdAt: new Date().toISOString(), minimumAcceptedPolicyEpoch: epoch, securityProfileVersion: 'test-security-v1', entries, policyBundleHashes: { 'mandatory-policy': entries[1]!.contentHash }, protocolSchemaHashes: { 'protocol-schema': entries[2]!.contentHash }, verifierVersion: 'test-verifier-v1', keyId: 'test-root', signer: payload => crypto.sign(payload, keys.privateKey) });
  return { manifest, files, crypto, publicKey: keys.publicKey, privateKey: keys.privateKey, keyId: 'test-root' };
}

function verifier(fixtureValue: Awaited<ReturnType<typeof fixture>>, store = new InMemoryRollbackStateStore()): IntegrityVerifier {
  return new IntegrityVerifier({ mode: 'development', trustRoot: createCryptoReleaseTrustRoot({ keyId: fixtureValue.keyId, publicKey: fixtureValue.publicKey, environment: 'development', crypto: fixtureValue.crypto }), fileReader: new InMemoryIntegrityFileReader(fixtureValue.files), rollback: new RollbackProtection(store) });
}

describe('Immutable Core and startup trust', () => {
  it('verifies a signed release, reaches trusted startup and unlocks privileged runtime only afterwards', async () => {
    const value = await fixture(); const core = new ImmutableCore({ verifier: verifier(value) });
    expect((await core.bootstrap(value.manifest)).stage).toBe('TRUSTED_CORE_READY');
    expect(core.snapshot().officialStatus).toBe('DEVELOPMENT_BUILD');
    expect(() => core.assertPrivileged('IDENTITY_SIGNING')).toThrow();
    await core.unlockPrivilegedRuntime();
    expect(() => core.assertPrivileged('IDENTITY_SIGNING')).not.toThrow();
  });

  it('enters SecurityLockdown after a one-byte critical modification', async () => {
    const value = await fixture(); value.files['core/identity.js'] = 'identity-v2';
    const core = new ImmutableCore({ verifier: verifier(value) }); const state = await core.bootstrap(value.manifest);
    expect(state.stage).toBe('LOCKDOWN'); expect(state.locked).toBe(true); expect(state.failure?.category).toBe('CRITICAL_HASH_MISMATCH');
    expect(core.lockdown.snapshot()?.deniedOperations).toContain('P2P_NETWORKING');
    expect(() => core.lockdown.assertAllowed('IDENTITY_SIGNING')).toThrow();
  });

  it('does not include mutable user files in the release integrity root', async () => {
    const value = await fixture(); value.files['Vault/private-note.md'] = 'owner private text';
    const core = new ImmutableCore({ verifier: verifier(value) });
    expect((await core.bootstrap(value.manifest)).locked).toBe(false);
    expect(JSON.stringify(core.snapshot())).not.toContain('owner private text');
  });

  it('rejects invalid signatures and missing trust roots fail closed', async () => {
    const value = await fixture(); const invalid = { ...value.manifest, signatureMetadata: { ...value.manifest.signatureMetadata, signature: `${value.manifest.signatureMetadata.signature}tampered` } };
    const badCore = new ImmutableCore({ verifier: verifier(value) }); expect((await badCore.bootstrap(invalid)).failure?.category).toBe('MANIFEST_SIGNATURE_INVALID');
    const noRoot = new ImmutableCore({ verifier: new IntegrityVerifier({ mode: 'production', fileReader: new InMemoryIntegrityFileReader(value.files), rollback: new RollbackProtection() }) });
    expect((await noRoot.bootstrap(value.manifest)).stage).toBe('LOCKDOWN');
  });

  it('marks a valid production release as official, but never trusts a remote claim', async () => {
    const value = await fixture();
    const root = createCryptoReleaseTrustRoot({ keyId: value.keyId, publicKey: value.publicKey, environment: 'production', crypto: value.crypto });
    const core = new ImmutableCore({ verifier: new IntegrityVerifier({ mode: 'production', trustRoot: root, fileReader: new InMemoryIntegrityFileReader(value.files), rollback: new RollbackProtection() }) });
    expect((await core.bootstrap(value.manifest)).officialStatus).toBe('OFFICIAL_VERIFIED');
    expect(remoteBuildClaimAllowsPrivilege({ official: true, status: 'OFFICIAL_VERIFIED' })).toBe(false);
    await expect(core.unlockPrivilegedRuntime()).resolves.toBeDefined();
  });

  it('locks down when the mandatory policy or security profile reference differs', async () => {
    const value = await fixture();
    const root = createCryptoReleaseTrustRoot({ keyId: value.keyId, publicKey: value.publicKey, environment: 'production', crypto: value.crypto });
    const policyRoot = { version: 'root-v1', epoch: 1, policyBundleHashes: { 'mandatory-policy': 'a'.repeat(64) }, protocolMinimums: {}, cryptoMinimums: {}, pluginSandboxMinimum: 'sandbox-v1', settingsAuthorityVersion: 'settings-v1', aiEgressVersion: 'egress-v1', safetyPolicyVersion: 'safety-v1' };
    const core = new ImmutableCore({ verifier: new IntegrityVerifier({ mode: 'production', trustRoot: root, fileReader: new InMemoryIntegrityFileReader(value.files), rollback: new RollbackProtection(), policyRoot: new MandatoryPolicyRoot(policyRoot), securityProfileVersion: 'different-profile' }) });
    const state = await core.bootstrap(value.manifest);
    expect(state.locked).toBe(true); expect(['POLICY_BUNDLE_MISMATCH', 'SECURITY_PROFILE_INCOMPATIBLE']).toContain(state.failure?.category);
  });

  it('keeps the R0P59 file containment minimum immutable', () => {
    const root = new MandatoryPolicyRoot({ version: 'root-v1', epoch: 1, policyBundleHashes: {}, protocolMinimums: {}, cryptoMinimums: {}, pluginSandboxMinimum: 'sandbox-v1', settingsAuthorityVersion: 'settings-v1', aiEgressVersion: 'egress-v1', safetyPolicyVersion: 'safety-v1' });
    expect(root.fileContainmentPolicyVersion).toBe('r0p59.1');
    expect(() => root.assertCompatible({ fileContainmentPolicyVersion: 'disabled' })).toThrow(/containment/i);
  });

  it('rejects a valid signed older epoch after a newer epoch was trusted', async () => {
    const store = new InMemoryRollbackStateStore(); const newer = await fixture(3); const old = await fixture(2);
    const first = new ImmutableCore({ verifier: verifier(newer, store) }); expect((await first.bootstrap(newer.manifest)).locked).toBe(false);
    const second = new ImmutableCore({ verifier: verifier(old, store) }); expect((await second.bootstrap(old.manifest)).failure?.category).toBe('ROLLBACK_REJECTED');
  });

  it('gates IdentitySecretAccess and never returns private keys', async () => {
    const value = await fixture(); const core = new ImmutableCore({ verifier: verifier(value) }); const identity = await IdentityManager.generate(); const access = new IdentitySecretAccess(core, identity, value.crypto);
    await expect(access.unlock('device-before-trust')).rejects.toThrow();
    await core.bootstrap(value.manifest); const handle = await access.unlock('device-test');
    expect(handle).not.toHaveProperty('privateKey'); await expect(handle.sign('before runtime')).rejects.toThrow();
    await core.unlockPrivilegedRuntime(); expect(await handle.sign('after runtime')).toEqual(expect.any(String)); handle.close();
  });

  it('keeps lockdown recovery metadata bounded and exposes no user content', () => {
    const lockdown = new SecurityLockdown(); lockdown.enter({ category: 'CRITICAL_HASH_MISMATCH', message: 'critical component changed', timestamp: new Date().toISOString(), path: 'core/security.js' });
    expect(lockdown.canRecover('REPAIR_HOST')).toBe(true); expect(lockdown.canRecover('IGNORE_AND_CONTINUE' as never)).toBe(false); expect(JSON.stringify(lockdown.snapshot())).not.toContain('private');
    for (const operation of PRIVILEGED_OPERATIONS) expect(() => lockdown.assertAllowed(operation)).toThrow();
  });
});
