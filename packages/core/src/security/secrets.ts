/**
 * Keystone secret and key-isolation boundary (R0P60).
 *
 * This module deliberately exposes metadata and capabilities, never secret
 * bytes.  Platform hosts may implement the interfaces with a hardware or OS
 * keystore.  The in-memory implementation is only a development/test host
 * and advertises MEMORY_ONLY; it is not a hardware-security claim.
 */

import { CANONICAL_V2_SIGNATURE_PREFIX, canonicalJson, canonicalJsonV2, canonicalSigned } from '../crypto.js';

export const SECRET_CLASSES = [
  'IDENTITY_PRIVATE_KEY', 'DEVICE_PRIVATE_KEY', 'SESSION_SECRET',
  'GROUP_EPOCH_KEY', 'SHARED_VAULT_EPOCH_KEY', 'BACKUP_ENCRYPTION_KEY',
  'RECOVERY_SECRET', 'PROVIDER_CREDENTIAL', 'PLUGIN_SECRET',
  'LOCAL_SERVICE_CREDENTIAL', 'AUTH_TOKEN', 'DERIVED_KEY', 'EPHEMERAL_SECRET',
] as const;
export type SecretClass = (typeof SECRET_CLASSES)[number];

export const SECRET_RISKS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type SecretRisk = (typeof SECRET_RISKS)[number];
export const SECRET_LIFETIMES = ['EPHEMERAL', 'SESSION', 'DURABLE', 'ROTATING', 'RECOVERY_ONLY'] as const;
export type SecretLifetime = (typeof SECRET_LIFETIMES)[number];
export const SECRET_SCOPES = ['IDENTITY', 'DEVICE', 'SESSION', 'COMMUNITY', 'SHARED_VAULT', 'BACKUP', 'PROVIDER', 'PLUGIN', 'BROWSER', 'LOCAL_SERVICE'] as const;
export type SecretScope = (typeof SECRET_SCOPES)[number];
export const SECRET_ORIGINS = ['GENERATED', 'IMPORTED', 'DERIVED', 'RESTORED', 'HOST_PROVISIONED'] as const;
export type SecretOrigin = (typeof SECRET_ORIGINS)[number];
export const SECRET_ACCESS_MODES = ['SIGN', 'DERIVE', 'ENCRYPT', 'DECRYPT', 'AUTHENTICATE', 'FILL_CREDENTIAL', 'EXPORT', 'ROTATE', 'REVOKE', 'VERIFY'] as const;
export type SecretAccessMode = (typeof SECRET_ACCESS_MODES)[number];
export const SECRET_EXPORT_POLICIES = ['NON_EXPORTABLE', 'OWNER_EXPORT_WITH_STRONG_CONFIRMATION', 'SCOPED_USE_ONLY', 'RECOVERY_ONLY'] as const;
export type SecretExportPolicy = (typeof SECRET_EXPORT_POLICIES)[number];
export const SECRET_STATES = ['ACTIVE', 'STAGED', 'RETIRING', 'REVOKED', 'DELETED', 'UNAVAILABLE'] as const;
export type SecretState = (typeof SECRET_STATES)[number];
export interface SecretRevocationState { readonly handleId: string; readonly revokedAt: string; readonly reason: string; readonly propagated: boolean; }
export const SECURITY_LEVELS = ['HARDWARE_BACKED', 'OS_PROTECTED', 'APPLICATION_ENCRYPTED', 'MEMORY_ONLY', 'UNAVAILABLE'] as const;
export type SecurityLevel = (typeof SECURITY_LEVELS)[number];
export const SECRET_ENVIRONMENTS = ['TEST', 'DEVELOPMENT', 'PRODUCTION'] as const;
export type SecretEnvironment = (typeof SECRET_ENVIRONMENTS)[number];

export const SIGNING_DOMAINS = [
  'KEYSTONE_IDENTITY_PROFILE', 'KEYSTONE_MESSAGE', 'KEYSTONE_OWNER_INTENT',
  'KEYSTONE_AGENT_PROFILE', 'KEYSTONE_CALENDAR', 'KEYSTONE_SHARED_VAULT',
  'KEYSTONE_DEVICE', 'KEYSTONE_WORKBOARD', 'KEYSTONE_SAFETY_ATTESTATION',
  'KEYSTONE_PUBLICATION', 'KEYSTONE_PROTOCOL_ENVELOPE', 'KEYSTONE_LEGACY',
] as const;
export type SigningDomain = (typeof SIGNING_DOMAINS)[number];

export const CRYPTO_SUITES = ['ed25519+x25519+xchacha20poly1305', 'ed25519+xsalsa20poly1305'] as const;
export type CryptoSuiteId = (typeof CRYPTO_SUITES)[number];
export type KeyAlgorithm = 'ED25519' | 'X25519' | 'XCHACHA20POLY1305' | 'GENERIC_32_BYTE';
export type SigningAlgorithm = 'ED25519';
export type EncryptionAlgorithm = 'XCHACHA20POLY1305';
export const KDF_PURPOSES = ['DEVICE_KEY', 'GROUP_EPOCH', 'SHARED_VAULT_EPOCH', 'BACKUP_ENCRYPTION', 'PROVIDER_SESSION', 'PLUGIN_NAMESPACE', 'SESSION'] as const;
export type KdfPurpose = (typeof KDF_PURPOSES)[number];
export interface KdfContext { readonly purpose: KdfPurpose | string; readonly version: 1; readonly salt?: string; }
/** Explicit names used by host adapters so derived-key domains remain
 * reviewable and portable across crypto implementations. */
export type DerivedKeyPurpose = KdfPurpose;
export interface KeyDerivationContext { readonly purpose: DerivedKeyPurpose; readonly version: 1; readonly salt?: string; readonly domain?: string; }

export const SECRET_OPERATIONS = [
  'SIGN_IDENTITY_OBJECT', 'SIGN_PROTOCOL_ENVELOPE', 'SIGN_OWNER_INTENT',
  'DERIVE_KEY', 'ENCRYPT', 'DECRYPT', 'USE_PROVIDER_CREDENTIAL',
  'FILL_CREDENTIAL', 'AUTHENTICATE', 'EXPORT', 'ROTATE', 'REVOKE', 'VERIFY', 'SIGN', 'USE',
] as const;
export type SecretOperation = (typeof SECRET_OPERATIONS)[number];

export interface SecretReference {
  readonly kind: 'SECRET_REFERENCE';
  readonly handleId: string;
  readonly secretClass: SecretClass;
  readonly risk: SecretRisk;
  readonly lifetime: SecretLifetime;
  readonly scope: SecretScope;
  readonly origin: SecretOrigin;
  readonly exportPolicy: SecretExportPolicy;
  readonly algorithm?: KeyAlgorithm;
  readonly cryptoSuite?: CryptoSuiteId;
  readonly generation: number;
  readonly state: SecretState;
  readonly createdAt: string;
  readonly rotatedAt?: string;
  readonly revokedAt?: string;
  readonly securityLevel: SecurityLevel;
  readonly environment: SecretEnvironment;
}

export interface SecretStatus extends SecretReference {
  readonly lastUsedAt?: string;
  readonly activeCapabilities: number;
}

function safeId(value: string, label: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) throw new Error(`Invalid ${label}`);
  return value;
}
function nowIso(now = Date.now()): string { return new Date(now).toISOString(); }
function randomId(prefix: string): string { return secureRandomId(prefix); }
/** Cryptographically strong identifier helper; there is deliberately no Math.random fallback. */
export function secureRandomId(prefix = 'id'): string { if (!globalThis.crypto?.randomUUID) throw new Error('Secure randomness is unavailable'); return `${prefix}:${globalThis.crypto.randomUUID()}`; }
function randomBytes(length: number): Uint8Array { const bytes = new Uint8Array(length); globalThis.crypto.getRandomValues(bytes); return bytes; }
function bytesToBase64(bytes: Uint8Array): string { let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, ''); }
function base64ToBytes(value: string): Uint8Array { const normalized = value.replace(/-/g, '+').replace(/_/g, '/'); const binary = atob(normalized + '='.repeat((4 - normalized.length % 4) % 4)); return Uint8Array.from(binary, char => char.charCodeAt(0)); }
function cloneBytes(value: Uint8Array): Uint8Array { return new Uint8Array(value); }
async function sodiumReady(): Promise<any> { const { default: sodium } = await import('libsodium-wrappers'); await sodium.ready; return sodium; }

/** Opaque handle. It contains no secret material and is safe to pass across a typed boundary. */
export class SecretHandle {
  readonly kind = 'SECRET_HANDLE' as const;
  private closed = false;
  constructor(readonly reference: SecretReference, private readonly onClose?: () => void) {}
  get id(): string { return this.reference.handleId; }
  assertUsable(operation?: SecretOperation): void {
    if (this.closed || this.reference.state === 'REVOKED' || this.reference.state === 'DELETED' || this.reference.state === 'UNAVAILABLE') throw new SecretAccessError('Secret handle is not usable', { operation, handleId: this.id });
  }
  close(): void { if (this.closed) return; this.closed = true; this.onClose?.(); }
  toJSON(): SecretReference { return { ...this.reference }; }
  get isClosed(): boolean { return this.closed; }
}

/** Device-scoped opaque handle; it is intentionally not interchangeable with
 * an identity handle at the type boundary. */
export class DeviceKeyHandle extends SecretHandle {
  constructor(reference: SecretReference, readonly deviceId: string, onClose?: () => void) { super(reference, onClose); }
}

export interface SecretCapabilityGrant {
  readonly kind: 'SECRET_CAPABILITY_GRANT';
  readonly capabilityId: string;
  readonly handleId: string;
  readonly secretClass: SecretClass;
  readonly operations: readonly SecretOperation[];
  readonly callerId: string;
  readonly scope: SecretScope;
  readonly target?: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly maxUses: number;
  readonly uses: number;
  readonly revoked: boolean;
  readonly grantDigest: string;
}

export interface SecretAccessDecision {
  readonly allowed: boolean;
  readonly reason?: string;
  readonly operation: SecretOperation;
  readonly handleId?: string;
  readonly callerId?: string;
}

export class SecretAccessError extends Error {
  constructor(message: string, readonly decision?: Partial<SecretAccessDecision>) { super(message); this.name = 'SecretAccessError'; }
}

export interface SecretRevocationStore { read(): Promise<readonly SecretRevocationState[]>; write(value: readonly SecretRevocationState[]): Promise<void>; }
export class InMemorySecretRevocationStore implements SecretRevocationStore {
  private value: readonly SecretRevocationState[] = [];
  async read(): Promise<readonly SecretRevocationState[]> { return this.value.map(item => ({ ...item })); }
  async write(value: readonly SecretRevocationState[]): Promise<void> { this.value = value.map(item => ({ ...item })); }
}
/** Durable, metadata-only revocation registry.  It never stores secret bytes. */
export class SecretRevocationRegistry {
  private readonly records = new Map<string, SecretRevocationState>();
  private readyPromise: Promise<void>;
  constructor(private readonly store?: SecretRevocationStore) { this.readyPromise = this.hydrate(); }
  async ready(): Promise<void> { await this.readyPromise; }
  isRevoked(handleId: string): boolean { return this.records.has(handleId); }
  async revoke(handleId: string, reason: string, propagated = false): Promise<SecretRevocationState> { const record: SecretRevocationState = { handleId, revokedAt: nowIso(), reason: reason.slice(0, 256), propagated }; this.records.set(handleId, record); await this.persist(); return { ...record }; }
  list(): readonly SecretRevocationState[] { return [...this.records.values()].map(item => ({ ...item })); }
  private async hydrate(): Promise<void> { for (const item of await this.store?.read() ?? []) if (item && safeId(item.handleId, 'handle id') && typeof item.revokedAt === 'string') this.records.set(item.handleId, { ...item, reason: item.reason.slice(0, 256) }); }
  private async persist(): Promise<void> { await this.store?.write(this.list()); }
}

/** Capability issuer/validator. Capabilities are scoped, expiring and replay bounded. */
export class SecretCapabilityService {
  private readonly grants = new Map<string, SecretCapabilityGrant>();
  constructor(private readonly clock: () => number = Date.now, private readonly revocations?: SecretRevocationRegistry) {}
  issue(input: { handle: SecretHandle; operations: readonly SecretOperation[]; callerId: string; scope?: SecretScope; target?: string; ttlMs?: number; maxUses?: number }): SecretCapability {
    input.handle.assertUsable();
    const callerId = safeId(input.callerId, 'caller id');
    const operations = [...new Set(input.operations)].filter((op): op is SecretOperation => (SECRET_OPERATIONS as readonly string[]).includes(op));
    if (!operations.length) throw new SecretAccessError('A capability must declare at least one operation');
    const ttl = input.ttlMs ?? 60_000; const maxUses = input.maxUses ?? 1;
    if (!Number.isSafeInteger(ttl) || ttl <= 0 || ttl > 86_400_000 || !Number.isSafeInteger(maxUses) || maxUses <= 0 || maxUses > 1024) throw new SecretAccessError('Invalid capability lifetime or use count');
    const issuedAt = nowIso(this.clock()); const expiresAt = nowIso(this.clock() + ttl); const capabilityId = randomId('cap');
    const unsigned = { kind: 'SECRET_CAPABILITY_GRANT' as const, capabilityId, handleId: input.handle.id, secretClass: input.handle.reference.secretClass, operations, callerId, scope: input.scope ?? input.handle.reference.scope, ...(input.target ? { target: input.target } : {}), issuedAt, expiresAt, maxUses, uses: 0, revoked: false };
    const grantDigest = bytesToBase64(randomBytes(16));
    const grant = { ...unsigned, grantDigest } as SecretCapabilityGrant;
    this.grants.set(capabilityId, grant);
    return new SecretCapability(grant, this);
  }
  authorize(capability: SecretCapability, operation: SecretOperation, handle: SecretHandle, context: { callerId?: string; target?: string } = {}): SecretAccessDecision {
    try { handle.assertUsable(operation); } catch (error) { return { allowed: false, operation, handleId: handle.id, reason: error instanceof SecretAccessError ? error.message : 'Secret handle is not usable' }; }
    const stored = this.grants.get(capability.grant.capabilityId);
    if (!stored || stored.grantDigest !== capability.grant.grantDigest) return { allowed: false, operation, handleId: handle.id, reason: 'Unknown or tampered capability' };
    if (stored.revoked || stored.uses >= stored.maxUses) return { allowed: false, operation, handleId: handle.id, callerId: stored.callerId, reason: 'Capability revoked or exhausted' };
    if (new Date(stored.expiresAt).getTime() <= this.clock()) return { allowed: false, operation, handleId: handle.id, callerId: stored.callerId, reason: 'Capability expired' };
    if (this.revocations?.isRevoked(handle.id)) return { allowed: false, operation, handleId: handle.id, callerId: stored.callerId, reason: 'Secret handle is revoked' };
    if (stored.handleId !== handle.id || stored.secretClass !== handle.reference.secretClass) return { allowed: false, operation, handleId: handle.id, callerId: stored.callerId, reason: 'Capability handle/class mismatch' };
    if (!stored.operations.includes(operation)) return { allowed: false, operation, handleId: handle.id, callerId: stored.callerId, reason: 'Operation not granted' };
    if (context.callerId && context.callerId !== stored.callerId) return { allowed: false, operation, handleId: handle.id, callerId: stored.callerId, reason: 'Caller mismatch' };
    if (stored.target && stored.target !== context.target) return { allowed: false, operation, handleId: handle.id, callerId: stored.callerId, reason: 'Target mismatch' };
    return { allowed: true, operation, handleId: handle.id, callerId: stored.callerId };
  }
  consume(capability: SecretCapability, operation: SecretOperation, handle: SecretHandle, context: { callerId?: string; target?: string } = {}): SecretAccessDecision {
    const decision = this.authorize(capability, operation, handle, context); if (!decision.allowed) throw new SecretAccessError(decision.reason ?? 'Secret capability denied', decision);
    const current = this.grants.get(capability.grant.capabilityId)!; this.grants.set(current.capabilityId, { ...current, uses: current.uses + 1 }); capability.refresh(this.grants.get(current.capabilityId)!); return decision;
  }
  revoke(capabilityId: string): void { const value = this.grants.get(capabilityId); if (value) this.grants.set(capabilityId, { ...value, revoked: true }); }
  revokeForHandle(handleId: string): void { for (const [id, grant] of this.grants) if (grant.handleId === handleId) this.grants.set(id, { ...grant, revoked: true }); }
  list(): readonly SecretCapabilityGrant[] { return [...this.grants.values()].map(value => ({ ...value, operations: [...value.operations] })); }
}

export class SecretCapability {
  constructor(private grantValue: SecretCapabilityGrant, private readonly service: SecretCapabilityService) {}
  get grant(): SecretCapabilityGrant { return { ...this.grantValue, operations: [...this.grantValue.operations] }; }
  get id(): string { return this.grantValue.capabilityId; }
  authorize(operation: SecretOperation, handle: SecretHandle, context?: { callerId?: string; target?: string }): SecretAccessDecision { return this.service.authorize(this, operation, handle, context); }
  consume(operation: SecretOperation, handle: SecretHandle, context?: { callerId?: string; target?: string }): SecretAccessDecision { return this.service.consume(this, operation, handle, context); }
  revoke(): void { this.service.revoke(this.id); }
  refresh(value: SecretCapabilityGrant): void { this.grantValue = value; }
  toJSON(): SecretCapabilityGrant { return this.grant; }
}

export interface SecretCreateInput {
  secretClass: SecretClass;
  risk?: SecretRisk;
  lifetime?: SecretLifetime;
  scope: SecretScope;
  origin?: SecretOrigin;
  exportPolicy?: SecretExportPolicy;
  algorithm?: KeyAlgorithm;
  cryptoSuite?: CryptoSuiteId;
}

export interface EncryptedSecretPayload { readonly algorithm: EncryptionAlgorithm; readonly nonce: string; readonly ciphertext: string; readonly keyHandleId: string; }

export interface SecureSecretStore {
  readonly environment: SecretEnvironment;
  readonly securityLevel: SecurityLevel;
  generate(input: SecretCreateInput): Promise<SecretHandle>;
  importSecret(input: SecretCreateInput, secretBytes: Uint8Array): Promise<SecretHandle>;
  status(handle: SecretHandle): Promise<SecretStatus>;
  rotate(handle: SecretHandle): Promise<SecretHandle>;
  revoke(handle: SecretHandle): Promise<void>;
  delete(handle: SecretHandle): Promise<void>;
}
export interface SecureSigningHost {
  sign(handle: SecretHandle, domain: SigningDomain, payload: unknown, capability: SecretCapability): Promise<string>;
  verify(domain: SigningDomain, payload: unknown, signature: string, publicKey: string): Promise<boolean>;
}
export interface SecureCryptoHost {
  derive(handle: SecretHandle, purpose: string, capability: SecretCapability): Promise<SecretHandle>;
  encrypt(handle: SecretHandle, plaintext: Uint8Array, capability: SecretCapability): Promise<EncryptedSecretPayload>;
  decrypt(handle: SecretHandle, payload: EncryptedSecretPayload, capability: SecretCapability): Promise<Uint8Array>;
}
/** Optional host-internal adapter boundary for short-lived provider use. */
export type SecureSecretHost = SecureSecretStore & SecureSigningHost & SecureCryptoHost & {
  readonly readForScopedAdapter?: (handle: SecretHandle) => string;
  /** Optional durable-host hook used only to rehydrate a migrated handle by
   * its metadata. It never returns secret bytes. */
  readonly restoreHandle?: (reference: SecretReference) => Promise<SecretHandle | undefined>;
};

export type LegacySecretCompatibilityPurpose = 'MIGRATION' | 'TEST_FIXTURE';
export interface LegacySecretCompatibilityContext {
  readonly kind: 'LEGACY_SECRET_COMPATIBILITY_CONTEXT';
  readonly environment: SecretEnvironment;
  readonly purpose: LegacySecretCompatibilityPurpose;
  readonly caller: string;
}
export interface LegacySecretAuditRecord {
  readonly operation: 'READ_MASTER_SEED' | 'DERIVE_SESSION_KEYS' | 'IMPORT_LEGACY_SECRET';
  readonly purpose: LegacySecretCompatibilityPurpose;
  readonly environment: Exclude<SecretEnvironment, 'PRODUCTION'>;
  readonly caller: string;
  readonly at: string;
}

/**
 * Explicit compatibility boundary for old raw-key layouts.  It is not a
 * general secret capability and it cannot be opened for PRODUCTION.  The
 * boundary is intentionally small so migration/test code can be audited
 * independently from normal application dependency injection.
 */
export class LegacySecretCompatibilityBoundary {
  private readonly records: LegacySecretAuditRecord[] = [];
  private constructor(readonly context: LegacySecretCompatibilityContext, private readonly maxRecords = 128) {}
  static open(input: { environment: SecretEnvironment; purpose: LegacySecretCompatibilityPurpose; caller: string }): LegacySecretCompatibilityBoundary {
    if (!input || (input.environment !== 'TEST' && input.environment !== 'DEVELOPMENT') || (input.purpose !== 'MIGRATION' && input.purpose !== 'TEST_FIXTURE') || (input.purpose === 'TEST_FIXTURE' && input.environment !== 'TEST') || !safeId(input.caller, 'legacy compatibility caller')) throw new SecretAccessError('Invalid legacy secret compatibility context');
    return new LegacySecretCompatibilityBoundary({ kind: 'LEGACY_SECRET_COMPATIBILITY_CONTEXT', environment: input.environment, purpose: input.purpose, caller: input.caller });
  }
  /** Test-only convenience; production code must open a named migration context. */
  static forTests(caller = 'vitest'): LegacySecretCompatibilityBoundary { return this.open({ environment: 'TEST', purpose: 'TEST_FIXTURE', caller }); }
  assertAllowed(operation: LegacySecretAuditRecord['operation']): void {
    if (this.context.environment === 'PRODUCTION') throw new SecretAccessError('Legacy raw-secret compatibility is unavailable in production', { operation: 'USE' });
    const record: LegacySecretAuditRecord = { operation, purpose: this.context.purpose, environment: this.context.environment, caller: this.context.caller, at: nowIso() };
    this.records.push(record); while (this.records.length > this.maxRecords) this.records.shift();
  }
  audit(): readonly LegacySecretAuditRecord[] { return this.records.map(record => ({ ...record })); }
  /** Import is the only migration primitive that accepts bytes. They are
   * copied into the host and cleared from this temporary buffer immediately. */
  async importSecret(host: SecureSecretHost, input: SecretCreateInput, bytes: Uint8Array): Promise<SecretHandle> {
    this.assertAllowed('IMPORT_LEGACY_SECRET');
    if (host.environment === 'PRODUCTION' && host.securityLevel === 'MEMORY_ONLY') throw new SecretAccessError('Production legacy migration requires a platform secure host');
    if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) throw new SecretAccessError('Legacy secret material must be non-empty bytes');
    const temporary = new Uint8Array(bytes);
    try { return await host.importSecret({ ...input, exportPolicy: 'NON_EXPORTABLE' }, temporary); } finally { temporary.fill(0); }
  }
}

export class LegacySecretMigrationService {
  private readonly migrated = new Map<string, SecretHandle>();
  private readonly records = new Map<string, { readonly version: 1; readonly sourceDigest: string; readonly handleId: string; readonly secretClass: SecretClass; readonly scope: SecretScope; readonly importedAt: string }>();
  private readonly pending = new Map<string, Promise<SecretHandle>>();
  private readonly readyPromise: Promise<void>;
  constructor(private readonly host: SecureSecretHost, private readonly boundary: LegacySecretCompatibilityBoundary, private readonly store?: LegacySecretMigrationStore) { if (!(boundary instanceof LegacySecretCompatibilityBoundary) || boundary.context.purpose !== 'MIGRATION') throw new SecretAccessError('Legacy migration requires an explicit migration boundary'); if (host.environment === 'PRODUCTION' && host.securityLevel === 'MEMORY_ONLY') throw new SecretAccessError('Production legacy migration requires a platform secure host'); this.readyPromise = this.hydrate(); }
  async ready(): Promise<void> { await this.readyPromise; }
  async import(input: SecretCreateInput & { readonly bytes: Uint8Array }): Promise<SecretHandle> {
    await this.ready();
    const sourceDigest = await digestSecretBytes(input.bytes);
    const pending = this.pending.get(sourceDigest);
    if (pending) return pending;
    const operation = this.importOnce(input, sourceDigest);
    this.pending.set(sourceDigest, operation);
    try { return await operation; } finally { if (this.pending.get(sourceDigest) === operation) this.pending.delete(sourceDigest); }
  }
  private async importOnce(input: SecretCreateInput & { readonly bytes: Uint8Array }, sourceDigest: string): Promise<SecretHandle> {
    const existing = this.migrated.get(sourceDigest);
    if (existing) {
      const status = await this.host.status(existing);
      if (status.secretClass !== input.secretClass || status.scope !== input.scope) throw new SecretAccessError('Legacy migration source metadata mismatch');
      return existing;
    }
    const record = this.records.get(sourceDigest);
    if (record && (record.secretClass !== input.secretClass || record.scope !== input.scope)) throw new SecretAccessError('Legacy migration source metadata mismatch');
    if (record && this.host.restoreHandle) {
      const restored = await this.host.restoreHandle({ kind: 'SECRET_REFERENCE', handleId: record.handleId, secretClass: input.secretClass, risk: input.risk ?? 'CRITICAL', lifetime: input.lifetime ?? 'DURABLE', scope: input.scope, origin: 'IMPORTED', exportPolicy: 'NON_EXPORTABLE', ...(input.algorithm ? { algorithm: input.algorithm } : {}), ...(input.cryptoSuite ? { cryptoSuite: input.cryptoSuite } : {}), generation: 1, state: 'ACTIVE', createdAt: record.importedAt, securityLevel: this.host.securityLevel, environment: this.host.environment });
      if (restored) { this.migrated.set(sourceDigest, restored); return restored; }
    }
    const handle = await this.boundary.importSecret(this.host, input, input.bytes);
    const status = await this.host.status(handle);
    if (status.secretClass !== input.secretClass || status.scope !== input.scope || status.state !== 'ACTIVE') { await this.host.delete(handle).catch(() => handle.close()); throw new SecretAccessError('Legacy migration verification failed'); }
    this.migrated.set(sourceDigest, handle);
    this.records.set(sourceDigest, { version: 1, sourceDigest, handleId: handle.id, secretClass: input.secretClass, scope: input.scope, importedAt: nowIso() });
    try { await this.persist(); } catch { this.migrated.delete(sourceDigest); this.records.delete(sourceDigest); await this.host.delete(handle).catch(() => handle.close()); throw new SecretAccessError('Legacy migration state could not be committed'); }
    return handle;
  }
  get context(): LegacySecretCompatibilityContext { return this.boundary.context; }
  snapshot(): readonly LegacySecretMigrationRecord[] { return [...this.records.values()].map(record => ({ ...record })); }
  private async hydrate(): Promise<void> { for (const record of await this.store?.read() ?? []) if (record?.version === 1 && safeId(record.sourceDigest, 'migration source digest') && safeId(record.handleId, 'migration handle id') && typeof record.importedAt === 'string' && (SECRET_CLASSES as readonly string[]).includes(record.secretClass) && (SECRET_SCOPES as readonly string[]).includes(record.scope)) this.records.set(record.sourceDigest, { ...record }); }
  private async persist(): Promise<void> { await this.store?.write(this.snapshot()); }
}

export interface LegacySecretMigrationRecord { readonly version: 1; readonly sourceDigest: string; readonly handleId: string; readonly secretClass: SecretClass; readonly scope: SecretScope; readonly importedAt: string; }
export interface LegacySecretMigrationStore { read(): Promise<readonly LegacySecretMigrationRecord[]>; write(value: readonly LegacySecretMigrationRecord[]): Promise<void>; }

async function digestSecretBytes(bytes: Uint8Array): Promise<string> {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) throw new SecretAccessError('Legacy secret material must be non-empty bytes');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}

interface SecretEntry { reference: SecretReference; bytes: Uint8Array; lastUsedAt?: string; }

/** Software fallback used by tests/development. It intentionally reports MEMORY_ONLY. */
export class InMemorySecureSecretHost implements SecureSecretHost {
  private readonly entries = new Map<string, SecretEntry>();
  constructor(readonly options: { environment: SecretEnvironment; securityLevel?: SecurityLevel; revocations?: SecretRevocationRegistry } = { environment: 'TEST', securityLevel: 'MEMORY_ONLY' }) { if (options.environment === 'PRODUCTION') throw new SecretAccessError('In-memory secret host cannot be used in production'); }
  get environment(): SecretEnvironment { return this.options.environment; }
  get securityLevel(): SecurityLevel { return this.options.securityLevel ?? 'MEMORY_ONLY'; }
  async generate(input: SecretCreateInput): Promise<SecretHandle> {
    const length = input.algorithm === 'ED25519' ? 64 : 32;
    const bytes = input.algorithm === 'ED25519' ? (await sodiumReady()).crypto_sign_keypair().privateKey : randomBytes(length);
    return this.store(input, bytes);
  }
  async importSecret(input: SecretCreateInput, secretBytes: Uint8Array): Promise<SecretHandle> { if (!(secretBytes instanceof Uint8Array) || !secretBytes.byteLength) throw new SecretAccessError('Secret material must be non-empty bytes'); return this.store({ ...input, origin: input.origin ?? 'IMPORTED' }, secretBytes); }
  async status(handle: SecretHandle): Promise<SecretStatus> { const entry = this.entries.get(handle.id); if (!entry) throw new SecretAccessError('Secret handle is unknown'); return { ...entry.reference, ...(entry.lastUsedAt ? { lastUsedAt: entry.lastUsedAt } : {}), activeCapabilities: 0 }; }
  async rotate(handle: SecretHandle): Promise<SecretHandle> { const entry = this.must(handle); const next = await this.generate({ secretClass: entry.reference.secretClass, risk: entry.reference.risk, lifetime: entry.reference.lifetime, scope: entry.reference.scope, origin: 'GENERATED', exportPolicy: entry.reference.exportPolicy, algorithm: entry.reference.algorithm, cryptoSuite: entry.reference.cryptoSuite }); const nextEntry = this.must(next); nextEntry.reference = { ...nextEntry.reference, generation: entry.reference.generation + 1 }; this.entries.set(handle.id, { ...entry, reference: { ...entry.reference, state: 'RETIRING', rotatedAt: nowIso() } }); return new SecretHandle(nextEntry.reference); }
  async revoke(handle: SecretHandle): Promise<void> { const entry = this.must(handle); this.entries.set(handle.id, { ...entry, reference: { ...entry.reference, state: 'REVOKED', revokedAt: nowIso() }, bytes: new Uint8Array() }); await this.options.revocations?.revoke(handle.id, 'host revoke'); handle.close(); }
  async delete(handle: SecretHandle): Promise<void> { const entry = this.must(handle); entry.bytes.fill(0); this.entries.set(handle.id, { ...entry, reference: { ...entry.reference, state: 'DELETED' }, bytes: new Uint8Array() }); handle.close(); }
  async sign(handle: SecretHandle, domain: SigningDomain, payload: unknown, capability: SecretCapability): Promise<string> { const operation = domain === 'KEYSTONE_IDENTITY_PROFILE' ? 'SIGN_IDENTITY_OBJECT' : domain === 'KEYSTONE_OWNER_INTENT' ? 'SIGN_OWNER_INTENT' : 'SIGN_PROTOCOL_ENVELOPE'; const context = { callerId: capability.grant.callerId, ...(capability.grant.target ? { target: capability.grant.target } : {}) }; const direct = capability.authorize(operation, handle, context); const generic = direct.allowed ? direct : capability.authorize('SIGN', handle, context); if (!generic.allowed) throw new SecretAccessError(generic.reason ?? 'Signing capability denied', generic); capability.consume(direct.allowed ? operation : 'SIGN', handle, context); const entry = this.mustUsable(handle); if (entry.reference.algorithm !== 'ED25519') throw new SecretAccessError('Signing requires an ED25519 handle'); const sodium = await sodiumReady(); const signed = sodium.crypto_sign_detached(sodium.from_string(canonicalJsonV2({ domain, payload })), sodium.from_base64(bytesToBase64(entry.bytes), sodium.base64_variants.URLSAFE_NO_PADDING)); entry.lastUsedAt = nowIso(); return CANONICAL_V2_SIGNATURE_PREFIX + sodium.to_base64(signed, sodium.base64_variants.URLSAFE_NO_PADDING); }
  async verify(domain: SigningDomain, payload: unknown, signature: string, publicKey: string): Promise<boolean> { try { const sodium = await sodiumReady(); const covered = canonicalSigned({ domain, payload }, signature); return sodium.crypto_sign_verify_detached(sodium.from_base64(covered.signature, sodium.base64_variants.URLSAFE_NO_PADDING), sodium.from_string(covered.bytes), sodium.from_base64(publicKey, sodium.base64_variants.URLSAFE_NO_PADDING)); } catch { return false; } }
  async derive(handle: SecretHandle, purpose: string, capability: SecretCapability): Promise<SecretHandle> { capability.consume('DERIVE_KEY', handle, { callerId: capability.grant.callerId }); const entry = this.mustUsable(handle); if (!purpose || purpose.length > 256) throw new SecretAccessError('Invalid KDF purpose'); const sodium = await sodiumReady(); const bytes = sodium.crypto_generichash(32, sodium.from_string(`keystone:kdf:v1:${purpose}`), entry.bytes); entry.lastUsedAt = nowIso(); return this.store({ secretClass: 'DERIVED_KEY', risk: 'HIGH', lifetime: 'SESSION', scope: entry.reference.scope, origin: 'DERIVED', exportPolicy: 'NON_EXPORTABLE', algorithm: 'GENERIC_32_BYTE', cryptoSuite: entry.reference.cryptoSuite }, bytes); }
  async encrypt(handle: SecretHandle, plaintext: Uint8Array, capability: SecretCapability): Promise<EncryptedSecretPayload> { capability.consume('ENCRYPT', handle, { callerId: capability.grant.callerId }); const entry = this.mustUsable(handle); const sodium = await sodiumReady(); const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES); const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(plaintext, null, null, nonce, this.key32(entry.bytes)); entry.lastUsedAt = nowIso(); return { algorithm: 'XCHACHA20POLY1305', nonce: bytesToBase64(nonce), ciphertext: bytesToBase64(ciphertext), keyHandleId: handle.id }; }
  async decrypt(handle: SecretHandle, payload: EncryptedSecretPayload, capability: SecretCapability): Promise<Uint8Array> { capability.consume('DECRYPT', handle, { callerId: capability.grant.callerId }); const entry = this.mustUsable(handle); if (payload.keyHandleId !== handle.id || payload.algorithm !== 'XCHACHA20POLY1305') throw new SecretAccessError('Ciphertext key or algorithm mismatch'); const sodium = await sodiumReady(); try { const plaintext = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, base64ToBytes(payload.ciphertext), null, base64ToBytes(payload.nonce), this.key32(entry.bytes)); entry.lastUsedAt = nowIso(); return new Uint8Array(plaintext); } catch { throw new SecretAccessError('Ciphertext authentication failed'); } }
  /** Test-only status helper; it returns a boolean and never exposes bytes. */
  hasMaterial(handleId: string): boolean { const entry = this.entries.get(handleId); return Boolean(entry && entry.bytes.byteLength > 0 && entry.reference.state === 'ACTIVE'); }
  /** The adapter receives a short-lived value only inside this host boundary. */
  readForScopedAdapter(handle: SecretHandle): string { const entry = this.mustUsable(handle); if (entry.reference.secretClass !== 'PROVIDER_CREDENTIAL' && entry.reference.secretClass !== 'AUTH_TOKEN') throw new SecretAccessError('Handle is not a provider credential'); entry.lastUsedAt = nowIso(); return new TextDecoder().decode(entry.bytes); }
  async restoreHandle(reference: SecretReference): Promise<SecretHandle | undefined> {
    const entry = this.entries.get(reference.handleId);
    if (!entry || entry.reference.state !== 'ACTIVE') return undefined;
    if (entry.reference.secretClass !== reference.secretClass || entry.reference.scope !== reference.scope || entry.reference.environment !== reference.environment) return undefined;
    return new SecretHandle({ ...entry.reference }, () => undefined);
  }
  private async store(input: SecretCreateInput, bytes: Uint8Array): Promise<SecretHandle> { const id = randomId('secret'); const ref: SecretReference = { kind: 'SECRET_REFERENCE', handleId: id, secretClass: input.secretClass, risk: input.risk ?? (input.secretClass === 'EPHEMERAL_SECRET' ? 'MEDIUM' : 'CRITICAL'), lifetime: input.lifetime ?? 'DURABLE', scope: input.scope, origin: input.origin ?? 'GENERATED', exportPolicy: input.exportPolicy ?? 'NON_EXPORTABLE', ...(input.algorithm ? { algorithm: input.algorithm } : {}), ...(input.cryptoSuite ? { cryptoSuite: input.cryptoSuite } : {}), generation: 1, state: 'ACTIVE', createdAt: nowIso(), securityLevel: this.securityLevel, environment: this.environment }; this.entries.set(id, { reference: ref, bytes: cloneBytes(bytes) }); return new SecretHandle(ref, () => undefined); }
  private must(handle: SecretHandle): SecretEntry { const entry = this.entries.get(handle.id); if (!entry) throw new SecretAccessError('Secret handle is unknown', { handleId: handle.id }); return entry; }
  private mustUsable(handle: SecretHandle): SecretEntry { handle.assertUsable(); const entry = this.must(handle); if (entry.reference.state !== 'ACTIVE') throw new SecretAccessError('Secret is not active', { handleId: handle.id }); return entry; }
  private key32(bytes: Uint8Array): Uint8Array { if (bytes.byteLength === 32) return bytes; return bytes.slice(0, 32); }
}

export const SIGNING_DOMAIN_RULES: Readonly<Record<SigningDomain, readonly SecretOperation[]>> = Object.freeze({
  KEYSTONE_IDENTITY_PROFILE: ['SIGN_IDENTITY_OBJECT'], KEYSTONE_MESSAGE: ['SIGN_PROTOCOL_ENVELOPE'], KEYSTONE_OWNER_INTENT: ['SIGN_OWNER_INTENT'], KEYSTONE_AGENT_PROFILE: ['SIGN_PROTOCOL_ENVELOPE'], KEYSTONE_CALENDAR: ['SIGN_PROTOCOL_ENVELOPE'], KEYSTONE_SHARED_VAULT: ['SIGN_PROTOCOL_ENVELOPE'], KEYSTONE_DEVICE: ['SIGN_PROTOCOL_ENVELOPE'], KEYSTONE_WORKBOARD: ['SIGN_PROTOCOL_ENVELOPE'], KEYSTONE_SAFETY_ATTESTATION: ['SIGN_PROTOCOL_ENVELOPE'], KEYSTONE_PUBLICATION: ['SIGN_PROTOCOL_ENVELOPE'], KEYSTONE_PROTOCOL_ENVELOPE: ['SIGN_PROTOCOL_ENVELOPE'], KEYSTONE_LEGACY: ['SIGN_PROTOCOL_ENVELOPE'],
});

export function signingDomainFor(kind: 'identity' | 'protocol' | 'owner', objectType?: string): SigningDomain {
  if (kind === 'identity') return 'KEYSTONE_IDENTITY_PROFILE';
  if (kind === 'owner') return 'KEYSTONE_OWNER_INTENT';
  const normalized = (objectType ?? '').toLowerCase();
  if (normalized.includes('message')) return 'KEYSTONE_MESSAGE'; if (normalized.includes('agent')) return 'KEYSTONE_AGENT_PROFILE'; if (normalized.includes('calendar')) return 'KEYSTONE_CALENDAR'; if (normalized.includes('vault')) return 'KEYSTONE_SHARED_VAULT'; if (normalized.includes('device')) return 'KEYSTONE_DEVICE'; if (normalized.includes('workboard')) return 'KEYSTONE_WORKBOARD'; if (normalized.includes('publication') || normalized.includes('publish')) return 'KEYSTONE_PUBLICATION'; if (normalized.includes('safety')) return 'KEYSTONE_SAFETY_ATTESTATION'; return 'KEYSTONE_PROTOCOL_ENVELOPE';
}

export class IdentitySigningCapability {
  constructor(protected readonly host: SecureSigningHost, protected readonly handle: SecretHandle, protected readonly capability: SecretCapability, readonly callerId: string, private readonly permittedDomains: ReadonlySet<SigningDomain> = new Set(SIGNING_DOMAINS)) {}
  protected assertDomain(domain: SigningDomain, operation: SecretOperation): void { this.handle.assertUsable(operation); if (!this.permittedDomains.has(domain) || !SIGNING_DOMAIN_RULES[domain].includes(operation)) throw new SecretAccessError('Signing domain is not authorized', { operation, handleId: this.handle.id }); }
  async signIdentityObject(objectType: string, payload: unknown): Promise<string> { safeId(objectType, 'object type'); this.assertDomain('KEYSTONE_IDENTITY_PROFILE', 'SIGN_IDENTITY_OBJECT'); return this.host.sign(this.handle, 'KEYSTONE_IDENTITY_PROFILE', { objectType, payload }, this.capability); }
  async signProtocolEnvelope(domain: SigningDomain, payload: unknown): Promise<string> { this.assertDomain(domain, 'SIGN_PROTOCOL_ENVELOPE'); return this.host.sign(this.handle, domain, payload, this.capability); }
  async signOwnerIntent(payload: unknown): Promise<string> { this.assertDomain('KEYSTONE_OWNER_INTENT', 'SIGN_OWNER_INTENT'); return this.host.sign(this.handle, 'KEYSTONE_OWNER_INTENT', payload, this.capability); }
  /** Verification never exposes secret material and can be used by a typed
   * transport adapter to authenticate a peer with public identity metadata. */
  async verifySignature(domain: SigningDomain, payload: unknown, signature: string, publicKey: string): Promise<boolean> { if (!this.permittedDomains.has(domain)) return false; return this.host.verify(domain, payload, signature, publicKey); }
  get secretReference(): SecretReference { return { ...this.handle.reference }; }
  close(): void { this.handle.close(); this.capability.revoke(); }
}

export type DeviceTrustState = 'TRUSTED' | 'PENDING' | 'REVOKED' | 'UNKNOWN';
export type DeviceRevocationState = 'ACTIVE' | 'REVOKED' | 'PENDING_REVOCATION';
export class DeviceSigningCapability extends IdentitySigningCapability {
  constructor(host: SecureSigningHost, handle: SecretHandle, capability: SecretCapability, callerId: string, readonly deviceId: string, private trust: DeviceTrustState = 'TRUSTED', private revocation: DeviceRevocationState = 'ACTIVE') { super(host, handle, capability, callerId, new Set(['KEYSTONE_DEVICE', 'KEYSTONE_MESSAGE', 'KEYSTONE_PROTOCOL_ENVELOPE', 'KEYSTONE_OWNER_INTENT'])); }
  assertDeviceUsable(): void { if (this.trust !== 'TRUSTED' || this.revocation !== 'ACTIVE') throw new SecretAccessError('Device signing is not authorized'); }
  setTrustState(value: DeviceTrustState): void { this.trust = value; }
  setRevocationState(value: DeviceRevocationState): void { this.revocation = value; }
  override async signProtocolEnvelope(domain: SigningDomain, payload: unknown): Promise<string> { this.assertDeviceUsable(); return super.signProtocolEnvelope(domain, payload); }
  override async signOwnerIntent(payload: unknown): Promise<string> { this.assertDeviceUsable(); return super.signOwnerIntent(payload); }
}

export interface KeyGeneration { readonly generation: number; readonly handleId: string; readonly createdAt: string; readonly state: 'STAGED' | 'ACTIVE' | 'RETIRED' | 'REVOKED'; }
export interface KeyActivation { readonly generation: number; readonly activatedAt: string; }
export interface KeyRetirement { readonly generation: number; readonly retiredAt: string; }
export interface KeyRevocation { readonly generation: number; readonly revokedAt: string; readonly reason: string; }
export interface KeyRotationPlan { readonly rotationId: string; readonly currentGeneration: number; readonly nextGeneration: number; readonly status: 'PLANNED' | 'STAGED' | 'ACTIVATED' | 'RETIRED' | 'REVOKED'; readonly createdAt: string; readonly reason: string; }

export class KeyRotationService {
  private readonly plans = new Map<string, KeyRotationPlan>();
  constructor(private readonly store: SecureSecretStore, private readonly clock: () => number = Date.now) {}
  async stage(handle: SecretHandle, reason: string): Promise<{ plan: KeyRotationPlan; next: SecretHandle }> { handle.assertUsable('ROTATE'); const next = await this.store.rotate(handle); const plan: KeyRotationPlan = { rotationId: randomId('rotation'), currentGeneration: handle.reference.generation, nextGeneration: next.reference.generation, status: 'STAGED', createdAt: nowIso(this.clock()), reason: reason.slice(0, 256) }; this.plans.set(plan.rotationId, plan); return { plan, next }; }
  activate(planId: string): KeyRotationPlan { const plan = this.plans.get(planId); if (!plan || plan.status !== 'STAGED') throw new SecretAccessError('Rotation plan is not staged'); const next = { ...plan, status: 'ACTIVATED' as const }; this.plans.set(planId, next); return next; }
  retire(planId: string): KeyRotationPlan { const plan = this.plans.get(planId); if (!plan || plan.status !== 'ACTIVATED') throw new SecretAccessError('Rotation must be activated before retirement'); const next = { ...plan, status: 'RETIRED' as const }; this.plans.set(planId, next); return next; }
  revoke(planId: string, reason: string): KeyRotationPlan { const plan = this.plans.get(planId); if (!plan) throw new SecretAccessError('Unknown rotation plan'); const next = { ...plan, status: 'REVOKED' as const, reason: reason.slice(0, 256) }; this.plans.set(planId, next); return next; }
  list(): readonly KeyRotationPlan[] { return [...this.plans.values()].map(value => ({ ...value })); }
}

export interface KeyEpoch { readonly epoch: number; readonly keyHandleId: string; readonly createdAt: string; readonly membershipDigest: string; readonly state: 'CURRENT' | 'STALE' | 'REVOKED'; }
export interface EpochMembership { readonly identityId: string; readonly deviceIds: readonly string[]; readonly joinedEpoch: number; readonly removedEpoch?: number; }
export interface EpochAccessDecision { readonly allowed: boolean; readonly epoch: number; readonly reason?: string; }
export class KeyEpochService {
  private current = 0; private currentHandle?: SecretHandle; private readonly epochs = new Map<number, KeyEpoch>(); private readonly memberships = new Map<string, EpochMembership>();
  constructor(private readonly store: SecureSecretStore, private readonly scope: SecretScope, private readonly clock: () => number = Date.now) {}
  async createInitial(): Promise<KeyEpoch> { if (this.current) throw new SecretAccessError('Epoch already initialized'); const handle = await this.store.generate({ secretClass: this.scope === 'SHARED_VAULT' ? 'SHARED_VAULT_EPOCH_KEY' : 'GROUP_EPOCH_KEY', scope: this.scope, lifetime: 'ROTATING', exportPolicy: 'NON_EXPORTABLE', algorithm: 'GENERIC_32_BYTE' }); return this.commit(handle, []); }
  async rotate(members: readonly string[]): Promise<KeyEpoch> { if (!this.current || !this.currentHandle) await this.createInitial(); const handle = await this.store.rotate(this.currentHandle!); return this.commit(handle, members); }
  authorize(identityId: string, epoch: number): EpochAccessDecision { const membership = this.memberships.get(identityId); if (!membership || epoch < membership.joinedEpoch || (membership.removedEpoch !== undefined && epoch >= membership.removedEpoch)) return { allowed: false, epoch, reason: 'Identity is not a member of this epoch' }; if (epoch !== this.current) return { allowed: false, epoch, reason: 'Stale epoch' }; return { allowed: true, epoch }; }
  remove(identityId: string): void { const member = this.memberships.get(identityId); if (member) this.memberships.set(identityId, { ...member, removedEpoch: this.current + 1 }); }
  get currentEpoch(): number { return this.current; }
  list(): readonly KeyEpoch[] { return [...this.epochs.values()].map(value => ({ ...value })); }
  private commit(handle: SecretHandle, members: readonly string[]): KeyEpoch { const next = this.current + 1; if (this.current) { const previous = this.epochs.get(this.current)!; this.epochs.set(this.current, { ...previous, state: 'STALE' }); } const epoch: KeyEpoch = { epoch: next, keyHandleId: handle.id, createdAt: nowIso(this.clock()), membershipDigest: canonicalJson([...members].sort()), state: 'CURRENT' }; this.epochs.set(next, epoch); this.current = next; this.currentHandle = handle; for (const identityId of members) { const existing = this.memberships.get(identityId); this.memberships.set(identityId, { identityId, deviceIds: existing?.deviceIds ?? [], joinedEpoch: existing?.joinedEpoch ?? next }); } return epoch; }
}

export interface RecoveryPolicy { readonly exportAllowed: boolean; readonly strongConfirmationRequired: boolean; readonly ttlMs: number; readonly recoveryOnly: boolean; }
export interface RecoveryExportIntent { readonly kind: 'RECOVERY_EXPORT_INTENT'; readonly intentId: string; readonly ownerIdentityId: string; readonly handleId: string; readonly expiresAt: string; readonly nonce: string; readonly confirmed: boolean; }
export interface RecoveryImportIntent { readonly kind: 'RECOVERY_IMPORT_INTENT'; readonly intentId: string; readonly ownerIdentityId: string; readonly expiresAt: string; readonly nonce: string; readonly confirmed: boolean; }
export class RecoverySecretHandle extends SecretHandle {}
export class SecretExportService {
  private readonly used = new Set<string>();
  private readonly usedImports = new Set<string>();
  constructor(private readonly clock: () => number = Date.now) {}
  createExportIntent(input: { ownerIdentityId: string; handle: SecretHandle; confirmed: boolean; policy?: RecoveryPolicy }): RecoveryExportIntent { const policy = input.policy ?? { exportAllowed: false, strongConfirmationRequired: true, ttlMs: 60_000, recoveryOnly: true }; input.handle.assertUsable('EXPORT'); if (input.handle.reference.exportPolicy === 'NON_EXPORTABLE' || input.handle.reference.exportPolicy === 'SCOPED_USE_ONLY') throw new SecretAccessError('Secret export policy forbids export'); if (!policy.exportAllowed || (policy.strongConfirmationRequired && input.confirmed !== true)) throw new SecretAccessError('Explicit owner confirmation is required for secret export'); const intentId = randomId('recovery-export'); return { kind: 'RECOVERY_EXPORT_INTENT', intentId, ownerIdentityId: safeId(input.ownerIdentityId, 'owner identity'), handleId: input.handle.id, expiresAt: nowIso(this.clock() + policy.ttlMs), nonce: bytesToBase64(randomBytes(24)), confirmed: true }; }
  consumeExportIntent(intent: RecoveryExportIntent, handle: SecretHandle, ownerIdentityId: string): void { if (this.used.has(intent.intentId) || intent.handleId !== handle.id || intent.ownerIdentityId !== ownerIdentityId || !intent.confirmed || new Date(intent.expiresAt).getTime() <= this.clock()) throw new SecretAccessError('Recovery export intent is invalid, expired or replayed'); this.used.add(intent.intentId); }
  createImportIntent(input: { ownerIdentityId: string; confirmed: boolean; policy?: RecoveryPolicy }): RecoveryImportIntent { const policy = input.policy ?? { exportAllowed: true, strongConfirmationRequired: true, ttlMs: 60_000, recoveryOnly: true }; if (policy.strongConfirmationRequired && input.confirmed !== true) throw new SecretAccessError('Explicit owner confirmation is required for recovery import'); const intentId = randomId('recovery-import'); return { kind: 'RECOVERY_IMPORT_INTENT', intentId, ownerIdentityId: safeId(input.ownerIdentityId, 'owner identity'), expiresAt: nowIso(this.clock() + policy.ttlMs), nonce: bytesToBase64(randomBytes(24)), confirmed: true }; }
  consumeImportIntent(intent: RecoveryImportIntent, ownerIdentityId: string): void { if (this.usedImports.has(intent.intentId) || intent.ownerIdentityId !== ownerIdentityId || !intent.confirmed || new Date(intent.expiresAt).getTime() <= this.clock()) throw new SecretAccessError('Recovery import intent is invalid, expired or replayed'); this.usedImports.add(intent.intentId); }
}

export interface SecretInventoryItem { readonly handleId: string; readonly secretClass: SecretClass; readonly scope: SecretScope; readonly state: SecretState; readonly securityLevel: SecurityLevel; readonly generation: number; readonly createdAt: string; readonly allowedOperations: readonly SecretOperation[]; }
export class SecretInventory {
  constructor(private readonly store: SecureSecretStore, private readonly capabilities?: SecretCapabilityService) {}
  async inspect(handles: readonly SecretHandle[]): Promise<readonly SecretInventoryItem[]> { return Promise.all(handles.map(async handle => { const status = await this.store.status(handle); const allowedOperations = this.capabilities?.list().filter(grant => grant.handleId === status.handleId && !grant.revoked && grant.expiresAt > nowIso() && grant.uses < grant.maxUses).flatMap(grant => grant.operations) ?? []; return { handleId: status.handleId, secretClass: status.secretClass, scope: status.scope, state: status.state, securityLevel: status.securityLevel, generation: status.generation, createdAt: status.createdAt, allowedOperations: [...new Set(allowedOperations)] }; })); }
}

const SECRET_KEY = /^(?:privateKey|encryptionPrivateKey|masterSeed|mnemonic|apiKey|accessToken|refreshToken|authToken|token|credential|password|passphrase|secret|keyMaterial|recoveryPhrase|recoverySecret)$/i;
const MANAGED_SECRET_MARKER = Symbol.for('keystone.managed-secret');
export function markManagedSecret<T extends object>(value: T): T { Object.defineProperty(value, MANAGED_SECRET_MARKER, { value: true, enumerable: false, configurable: false }); return value; }
export function isManagedSecret(value: unknown): boolean { return value instanceof SecretHandle || value instanceof SecretCapability || Boolean(value && typeof value === 'object' && (value as Record<PropertyKey, unknown>)[MANAGED_SECRET_MARKER] === true); }
export class SecretRedactionPolicy {
  static isSensitiveKey(key: string): boolean { return SECRET_KEY.test(key); }
  static containsManagedSecret(value: unknown, depth = 0): boolean { if (depth > 16 || value === null || value === undefined) return false; if (isManagedSecret(value)) return true; if (Array.isArray(value)) return value.some(item => this.containsManagedSecret(item, depth + 1)); if (typeof value !== 'object') return false; return Object.entries(value as Record<string, unknown>).some(([key, item]) => this.isSensitiveKey(key) || this.containsManagedSecret(item, depth + 1)); }
  static redact<T>(value: T, depth = 0): T { if (depth > 16 || value === null || value === undefined || typeof value !== 'object') return value; if (isManagedSecret(value)) return '[REDACTED_SECRET]' as T; if (Array.isArray(value)) return value.map(item => this.redact(item, depth + 1)) as T; const output: Record<string, unknown> = {}; for (const [key, item] of Object.entries(value as Record<string, unknown>)) output[key] = this.isSensitiveKey(key) ? '[REDACTED_SECRET]' : this.redact(item, depth + 1); return output as T; }
  static redactError(error: unknown): { name: string; message: string } { const name = error instanceof Error ? error.name : 'Error'; const message = error instanceof Error ? error.message : String(error); return { name: this.redact(name), message: this.redact(message) }; }
  static redactToolResult<T>(value: T): T { return this.redact(value); }
  static redactCrashReport<T>(value: T): T { return this.redact(value); }
}
/** Typed clipboard boundary. Clipboard is never treated as secret storage and
 * a copy operation always carries a fresh owner-confirmation bit. */
export interface ClipboardCopyIntent { readonly kind: 'CLIPBOARD_COPY_INTENT'; readonly text: string; readonly ownerConfirmed: true; readonly autoClearMs?: number; }
export interface SecureClipboardHost { write(text: string, options?: { autoClearMs?: number }): Promise<void>; }
export class SecureClipboardBoundary {
  constructor(private readonly host: SecureClipboardHost) {}
  async copy(intent: ClipboardCopyIntent): Promise<void> {
    if (intent.kind !== 'CLIPBOARD_COPY_INTENT' || intent.ownerConfirmed !== true || typeof intent.text !== 'string' || intent.text.length > 1_000_000) throw new SecretAccessError('Explicit owner confirmation is required for clipboard copy');
    if (intent.autoClearMs !== undefined && (!Number.isSafeInteger(intent.autoClearMs) || intent.autoClearMs < 0 || intent.autoClearMs > 15 * 60_000)) throw new SecretAccessError('Clipboard auto-clear duration is invalid');
    if (SecretRedactionPolicy.containsManagedSecret(intent)) throw new SecretAccessError('Managed secret material cannot be copied to clipboard');
    await this.host.write(intent.text, intent.autoClearMs === undefined ? undefined : { autoClearMs: intent.autoClearMs });
  }
}
/** Host-neutral crash diagnostics boundary. It returns metadata-safe copies
 * and never forwards decrypted secret material to a reporter. */
export class CrashReportRedactor {
  redact<T>(report: T): T { return SecretRedactionPolicy.redactCrashReport(report); }
  redactError(error: unknown): { name: string; message: string } { return SecretRedactionPolicy.redactError(error); }
}
export class SecureLoggerBoundary {
  private readonly records: unknown[] = [];
  constructor(private readonly maxEntries = 256) {}
  append(value: unknown): void { this.records.push(SecretRedactionPolicy.redact(value)); while (this.records.length > this.maxEntries) this.records.shift(); }
  list<T = unknown>(): readonly T[] { return this.records.map(value => structuredClone(value)) as T[]; }
}

export interface PluginSecretNamespace { readonly pluginId: string; readonly namespace: string; readonly handles: readonly SecretReference[]; }
export class ScopedPluginSecretNamespace {
  private readonly handles: SecretHandle[] = [];
  constructor(readonly pluginId: string, private readonly host: SecureSecretStore) { safeId(pluginId, 'plugin id'); }
  async generate(input: Omit<SecretCreateInput, 'scope'>): Promise<SecretHandle> { const handle = await this.host.generate({ ...input, scope: 'PLUGIN' }); this.handles.push(handle); return handle; }
  inventory(): PluginSecretNamespace { return { pluginId: this.pluginId, namespace: `plugin:${this.pluginId}`, handles: this.handles.map(handle => ({ ...handle.reference })) }; }
}

export interface ProviderCredentialCapability { readonly kind: 'PROVIDER_CREDENTIAL_CAPABILITY'; readonly providerId: string; readonly modelId?: string; readonly handleId: string; getAuthorizationHeader(target: string): Promise<string>; }
export class ScopedProviderCredential implements ProviderCredentialCapability {
  readonly kind = 'PROVIDER_CREDENTIAL_CAPABILITY' as const;
  constructor(readonly providerId: string, readonly handle: SecretHandle, private readonly host: SecureSecretHost, private readonly capability: SecretCapability, readonly modelId?: string) {}
  get handleId(): string { return this.handle.id; }
  async getAuthorizationHeader(target: string): Promise<string> { this.capability.consume('USE_PROVIDER_CREDENTIAL', this.handle, { callerId: this.capability.grant.callerId, target }); const read = this.host.readForScopedAdapter; if (!read) throw new SecretAccessError('Provider credential host adapter is unavailable'); const token = read.call(this.host, this.handle); return `Bearer ${token}`; }
  toJSON(): { kind: string; providerId: string; handleId: string; modelId?: string } { return { kind: this.kind, providerId: this.providerId, handleId: this.handleId, ...(this.modelId ? { modelId: this.modelId } : {}) }; }
}

export interface CredentialAvailable { readonly kind: 'CREDENTIAL_AVAILABLE'; readonly credentialHandleId: string; readonly origin: string; readonly pageRevision: string; readonly fields: readonly string[]; }
export interface FillCredentialIntent { readonly kind: 'FILL_CREDENTIAL_INTENT'; readonly credentialHandleId: string; readonly origin: string; readonly pageRevision: string; readonly fieldIds: readonly string[]; readonly confirmed: boolean; }
export interface BrowserCredentialBoundary { credentialAvailable(origin: string, pageRevision: string): Promise<CredentialAvailable | undefined>; fillCredential(intent: FillCredentialIntent): Promise<{ accepted: true; filledFieldIds: readonly string[] } | { accepted: false; reason: string }>; }

export class SecretMetrics {
  private readonly values = new Map<string, number>();
  increment(name: string): void { this.values.set(name, (this.values.get(name) ?? 0) + 1); }
  snapshot(): Readonly<Record<string, number>> { return Object.fromEntries(this.values); }
}
