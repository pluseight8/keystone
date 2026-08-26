import { canonicalJson, SodiumCryptoProvider, type CryptoProvider } from '../crypto.js';
import type { IdentityManager } from '../identity.js';
import type { IdentitySigningCapability, SigningDomain } from './secrets.js';

/** Trust classes are deliberately explicit so mutable/user supplied data can
 * never be mistaken for a release-signed security component. */
export const TRUST_CLASSES = [
  'IMMUTABLE_CORE',
  'TRUSTED_RUNTIME',
  'SANDBOXED_EXTENSION',
  'USER_CONTENT',
  'UNTRUSTED_REMOTE_DATA',
  'UNTRUSTED_MODEL',
] as const;
export type TrustClass = (typeof TRUST_CLASSES)[number];

export const TRUSTED_STARTUP_STAGES = [
  'UNVERIFIED',
  'MANIFEST_VERIFIED',
  'CORE_FILES_VERIFIED',
  'POLICY_VERIFIED',
  'ROLLBACK_VERIFIED',
  'TRUSTED_CORE_READY',
  'PRIVILEGED_RUNTIME_READY',
  'LOCKDOWN',
] as const;
export type TrustedStartupStage = (typeof TRUSTED_STARTUP_STAGES)[number];

export const PRIVILEGED_OPERATIONS = [
  'IDENTITY_SIGNING',
  'P2P_NETWORKING',
  'AGENT_EXECUTION',
  'PLUGIN_RUNTIME',
  'SECURITY_SETTINGS_MUTATION',
  'SECRET_EXPORT',
  'TRUSTED_UPDATE_MUTATION',
  'PRIVATE_KEY_UNLOCK',
] as const;
export type PrivilegedOperation = (typeof PRIVILEGED_OPERATIONS)[number];

const LOCKDOWN_CLEAR_TOKEN = Symbol('keystone:verified-core');

export type OfficialBuildStatus = 'OFFICIAL_VERIFIED' | 'OFFICIAL_DAMAGED' | 'UNVERIFIED_BUILD' | 'DEVELOPMENT_BUILD';
/** Canonical status exposed to host/UI surfaces. */
export type IntegrityState = TrustedStartupStage;
export type IntegrityFailureCategory =
  | 'MANIFEST_INVALID'
  | 'MANIFEST_SIGNATURE_INVALID'
  | 'CRITICAL_HASH_MISMATCH'
  | 'CRITICAL_ENTRY_MISSING'
  | 'POLICY_BUNDLE_MISMATCH'
  | 'PROTOCOL_SCHEMA_MISMATCH'
  | 'SECURITY_PROFILE_INCOMPATIBLE'
  | 'ROLLBACK_REJECTED'
  | 'TRUST_ROOT_UNAVAILABLE'
  | 'SECURE_STORAGE_UNAVAILABLE';

export interface IntegrityFailureMetadata {
  readonly category: IntegrityFailureCategory;
  readonly message: string;
  readonly componentId?: string;
  readonly path?: string;
  readonly expectedHash?: string;
  readonly actualHash?: string;
  readonly policyEpoch?: number;
  readonly timestamp: string;
}

export interface SecurityAuditRecord {
  readonly id: string;
  readonly timestamp: string;
  readonly event: 'integrity_check' | 'privileged_denied' | 'rollback_decision' | 'recovery_check';
  readonly outcome: 'accepted' | 'rejected' | 'lockdown';
  readonly componentId?: string;
  readonly category?: IntegrityFailureCategory;
  readonly operation?: PrivilegedOperation;
  readonly policyEpoch?: number;
}

/** Metadata-only bounded audit; secrets, private keys and user content are not
 * accepted by its schema. */
export class SecurityAuditLog {
  private readonly records: SecurityAuditRecord[] = [];
  constructor(private readonly maxEntries = 512) {}
  append(record: Omit<SecurityAuditRecord, 'id' | 'timestamp'> & { id?: string; timestamp?: string }): void {
    this.records.push({ id: record.id ?? crypto.randomUUID(), timestamp: record.timestamp ?? new Date().toISOString(), event: record.event, outcome: record.outcome, ...(record.componentId ? { componentId: record.componentId } : {}), ...(record.category ? { category: record.category } : {}), ...(record.operation ? { operation: record.operation } : {}), ...(record.policyEpoch === undefined ? {} : { policyEpoch: record.policyEpoch }) });
    while (this.records.length > this.maxEntries) this.records.shift();
  }
  list(): readonly SecurityAuditRecord[] { return this.records.map(value => ({ ...value })); }
  clear(): void { this.records.length = 0; }
}

export class IntegrityFailure extends Error {
  readonly metadata: IntegrityFailureMetadata;
  constructor(metadata: IntegrityFailureMetadata) {
    super(metadata.message);
    this.name = 'IntegrityFailure';
    this.metadata = Object.freeze({ ...metadata });
  }
}

export interface IntegrityEntry {
  readonly path: string;
  readonly componentId: string;
  readonly contentHash: string;
  readonly size: number;
  readonly trustClass: TrustClass;
  readonly required: boolean;
}

export interface IntegritySignatureMetadata {
  readonly algorithm: 'ed25519';
  readonly keyId: string;
  readonly signature: string;
  readonly signedAt: string;
}

export interface IntegrityManifest {
  readonly version: 1;
  readonly releaseId: string;
  readonly releaseVersion: string;
  readonly buildId: string;
  readonly platform: string;
  readonly architecture: string;
  readonly createdAt: string;
  readonly minimumAcceptedPolicyEpoch: number;
  readonly securityProfileVersion: string;
  readonly entries: readonly IntegrityEntry[];
  readonly policyBundleHashes: Readonly<Record<string, string>>;
  readonly protocolSchemaHashes: Readonly<Record<string, string>>;
  readonly verifierVersion: string;
  readonly signatureMetadata: IntegritySignatureMetadata;
}

export type UnsignedIntegrityManifest = Omit<IntegrityManifest, 'signatureMetadata'>;

export interface ReleaseTrustRoot {
  readonly kind: 'RELEASE_TRUST_ROOT';
  readonly keyId: string;
  readonly environment: 'production' | 'development';
  readonly publicKey?: string;
  readonly verify: (payload: string, signature: string) => Promise<boolean> | boolean;
}

/** Public name used by release/update integrations.  The trust root contains
 * verification material only; release private keys are never part of core. */
export type IntegrityRoot = ReleaseTrustRoot;

/** A remote claim is descriptive metadata, never a local authority. */
export interface RemoteBuildClaim {
  readonly official?: boolean;
  readonly status?: OfficialBuildStatus | string;
  readonly manifestSignature?: string;
}

export function remoteBuildClaimAllowsPrivilege(_claim: RemoteBuildClaim | undefined): false {
  return false;
}

/** Creates a verifier from host-provided public material. No private release
 * key is represented by this API. */
export function createCryptoReleaseTrustRoot(input: {
  keyId: string;
  publicKey: string;
  environment?: 'production' | 'development';
  crypto?: CryptoProvider;
}): ReleaseTrustRoot {
  const crypto = input.crypto;
  if (!input.keyId || !input.publicKey || !crypto) throw new Error('A host-provided release public key and verifier are required');
  return Object.freeze({
    kind: 'RELEASE_TRUST_ROOT' as const,
    keyId: input.keyId,
    publicKey: input.publicKey,
    environment: input.environment ?? 'production',
    verify: (payload: string, signature: string) => crypto.verify(payload, signature, input.publicKey),
  });
}

export interface IntegrityFileReader {
  read(path: string): Promise<Uint8Array | string | undefined>;
}

export class InMemoryIntegrityFileReader implements IntegrityFileReader {
  constructor(private readonly files: Readonly<Record<string, Uint8Array | string>>) {}
  async read(path: string): Promise<Uint8Array | string | undefined> {
    const value = this.files[path];
    return value === undefined ? undefined : typeof value === 'string' ? value : new Uint8Array(value);
  }
}

export interface RollbackState {
  readonly version: 1;
  readonly highestTrustedEpoch: number;
  readonly updatedAt: string;
  readonly integrity: string;
}

export interface RollbackStateStore {
  read(): Promise<unknown | undefined>;
  write(value: RollbackState): Promise<void>;
  /** Host secure storage can seal/verify a monotonic state. */
  seal?(value: Omit<RollbackState, 'integrity'>): Promise<string> | string;
  verify?(value: RollbackState): Promise<boolean> | boolean;
  readonly secureMonotonic?: boolean;
}

export class InMemoryRollbackStateStore implements RollbackStateStore {
  readonly secureMonotonic = false;
  private value?: RollbackState;
  async read(): Promise<RollbackState | undefined> { return this.value && structuredClone(this.value); }
  async write(value: RollbackState): Promise<void> { this.value = structuredClone(value); }
}

export type RollbackDecision = 'INITIALIZED' | 'ACCEPTED_NEW_EPOCH' | 'ACCEPTED_CURRENT_EPOCH' | 'REJECTED_ROLLBACK' | 'REJECTED_STATE';

export interface RollbackVerification {
  readonly decision: RollbackDecision;
  readonly highestTrustedEpoch: number;
  readonly secureStorage: boolean;
}

/** Durable rollback state is a host boundary. The software fallback is
 * integrity checked but is explicitly not claimed to be tamper-proof. */
export class RollbackProtection {
  private current?: RollbackState;
  constructor(private readonly store: RollbackStateStore = new InMemoryRollbackStateStore(), private readonly anchor = 'keystone:rollback:v1', private readonly now: () => number = Date.now) {}
  get secureStorage(): boolean { return this.store.secureMonotonic === true && typeof this.store.seal === 'function' && typeof this.store.verify === 'function'; }
  get highestTrustedEpoch(): number { return this.current?.highestTrustedEpoch ?? 0; }
  async verifyAndAdvance(epoch: number): Promise<RollbackVerification> {
    if (!Number.isSafeInteger(epoch) || epoch < 0) throw new IntegrityFailure(failure('ROLLBACK_REJECTED', 'Security epoch is invalid', this.now()));
    const raw = await this.store.read();
    if (raw !== undefined && !validRollbackState(raw)) throw new IntegrityFailure(failure('ROLLBACK_REJECTED', 'Durable rollback state is malformed', this.now()));
    const stateValid = raw === undefined
      ? true
      : typeof this.store.verify === 'function'
        ? await this.store.verify(raw)
        : raw.integrity === await this.integrity(raw);
    if (!stateValid) {
      throw new IntegrityFailure(failure('ROLLBACK_REJECTED', 'Durable rollback state integrity failed', this.now()));
    }
    const previous = raw as RollbackState | undefined;
    const highest = previous?.highestTrustedEpoch ?? 0;
    if (previous && epoch < highest) throw new IntegrityFailure({ ...failure('ROLLBACK_REJECTED', `Security epoch ${epoch} is older than trusted epoch ${highest}`, this.now()), policyEpoch: epoch });
    const decision: RollbackDecision = previous ? epoch === highest ? 'ACCEPTED_CURRENT_EPOCH' : 'ACCEPTED_NEW_EPOCH' : 'INITIALIZED';
    const unsignedNext = { version: 1 as const, highestTrustedEpoch: Math.max(highest, epoch), updatedAt: new Date(this.now()).toISOString() };
    const next: RollbackState = { ...unsignedNext, integrity: this.store.seal ? await this.store.seal(unsignedNext) : await this.integrity(unsignedNext) };
    await this.store.write(next);
    this.current = next;
    return { decision, highestTrustedEpoch: next.highestTrustedEpoch, secureStorage: this.secureStorage };
  }
  private async integrity(value: Omit<RollbackState, 'integrity'> | RollbackState): Promise<string> {
    const { integrity: _ignored, ...unsigned } = value as RollbackState;
    return digestText(canonicalJson({ anchor: this.anchor, ...unsigned }));
  }
}

export interface MandatoryPolicyRootInput {
  readonly version: string;
  readonly epoch: number;
  readonly policyBundleHashes: Readonly<Record<string, string>>;
  readonly protocolMinimums: Readonly<Record<string, string>>;
  readonly cryptoMinimums: Readonly<Record<string, string>>;
  readonly pluginSandboxMinimum: string;
  readonly settingsAuthorityVersion: string;
  readonly aiEgressVersion: string;
  readonly safetyPolicyVersion: string;
  /** R0P59 immutable minimum: network files are quarantined and parsers are bounded. */
  readonly fileContainmentPolicyVersion?: string;
  readonly fileContainmentPolicyHash?: string;
  /** Immutable protocol-security profile reference; user config may only
   * select stricter limits, never replace this minimum. */
  readonly protocolSecurityProfileVersion?: string;
  readonly protocolSecurityProfileHash?: string;
  readonly protocolSchemaHashes?: Readonly<Record<string, string>>;
  readonly rootHash?: string;
}

/** Immutable in-process policy references. User config may select stricter
 * preferences but cannot replace or downgrade this root. */
export class MandatoryPolicyRoot {
  readonly configurationClass = 'MANDATORY' as const;
  readonly version: string;
  readonly epoch: number;
  readonly policyBundleHashes: Readonly<Record<string, string>>;
  readonly protocolMinimums: Readonly<Record<string, string>>;
  readonly cryptoMinimums: Readonly<Record<string, string>>;
  readonly pluginSandboxMinimum: string;
  readonly settingsAuthorityVersion: string;
  readonly aiEgressVersion: string;
  readonly safetyPolicyVersion: string;
  readonly fileContainmentPolicyVersion: string;
  readonly fileContainmentPolicyHash?: string;
  readonly protocolSecurityProfileVersion?: string;
  readonly protocolSecurityProfileHash?: string;
  readonly protocolSchemaHashes?: Readonly<Record<string, string>>;
  readonly rootHash?: string;
  constructor(input: MandatoryPolicyRootInput) {
    if (!input.version || !Number.isSafeInteger(input.epoch) || input.epoch < 0) throw new Error('Invalid MandatoryPolicyRoot');
    this.version = input.version; this.epoch = input.epoch;
    this.policyBundleHashes = Object.freeze({ ...input.policyBundleHashes });
    this.protocolMinimums = Object.freeze({ ...input.protocolMinimums });
    this.cryptoMinimums = Object.freeze({ ...input.cryptoMinimums });
    this.pluginSandboxMinimum = input.pluginSandboxMinimum;
    this.settingsAuthorityVersion = input.settingsAuthorityVersion;
    this.aiEgressVersion = input.aiEgressVersion;
    this.safetyPolicyVersion = input.safetyPolicyVersion;
    this.fileContainmentPolicyVersion = input.fileContainmentPolicyVersion ?? 'r0p59.1';
    this.fileContainmentPolicyHash = input.fileContainmentPolicyHash;
    this.protocolSecurityProfileVersion = input.protocolSecurityProfileVersion;
    this.protocolSecurityProfileHash = input.protocolSecurityProfileHash;
    this.protocolSchemaHashes = input.protocolSchemaHashes ? Object.freeze({ ...input.protocolSchemaHashes }) : undefined;
    this.rootHash = input.rootHash;
    Object.freeze(this);
  }
  assertCompatible(candidate: Partial<MandatoryPolicyRootInput>): void {
    if (candidate.version !== undefined && candidate.version !== this.version) throw new Error('MandatoryPolicyRoot version cannot be changed');
    if (candidate.epoch !== undefined && candidate.epoch < this.epoch) throw new Error('MandatoryPolicyRoot rollback is not allowed');
    if (candidate.policyBundleHashes && canonicalJson(candidate.policyBundleHashes) !== canonicalJson(this.policyBundleHashes)) throw new Error('Mandatory policy bundles cannot be overridden');
    if (candidate.protocolMinimums && canonicalJson(candidate.protocolMinimums) !== canonicalJson(this.protocolMinimums)) throw new Error('Protocol minimums cannot be overridden');
    if (candidate.cryptoMinimums && canonicalJson(candidate.cryptoMinimums) !== canonicalJson(this.cryptoMinimums)) throw new Error('Crypto minimums cannot be overridden');
    if (candidate.pluginSandboxMinimum !== undefined && candidate.pluginSandboxMinimum !== this.pluginSandboxMinimum) throw new Error('Plugin sandbox minimum cannot be overridden');
    if (candidate.settingsAuthorityVersion !== undefined && candidate.settingsAuthorityVersion !== this.settingsAuthorityVersion) throw new Error('Settings authority cannot be overridden');
    if (candidate.aiEgressVersion !== undefined && candidate.aiEgressVersion !== this.aiEgressVersion) throw new Error('AI egress boundary cannot be overridden');
    if (candidate.safetyPolicyVersion !== undefined && candidate.safetyPolicyVersion !== this.safetyPolicyVersion) throw new Error('Safety policy cannot be overridden');
    if (candidate.fileContainmentPolicyVersion !== undefined && candidate.fileContainmentPolicyVersion !== this.fileContainmentPolicyVersion) throw new Error('File containment policy cannot be overridden');
    if (candidate.fileContainmentPolicyHash !== undefined && candidate.fileContainmentPolicyHash !== this.fileContainmentPolicyHash) throw new Error('File containment policy hash cannot be overridden');
    if (candidate.protocolSecurityProfileVersion !== undefined && candidate.protocolSecurityProfileVersion !== this.protocolSecurityProfileVersion) throw new Error('Protocol security profile cannot be overridden');
    if (candidate.protocolSecurityProfileHash !== undefined && candidate.protocolSecurityProfileHash !== this.protocolSecurityProfileHash) throw new Error('Protocol security profile hash cannot be overridden');
    if (candidate.protocolSchemaHashes && canonicalJson(candidate.protocolSchemaHashes) !== canonicalJson(this.protocolSchemaHashes)) throw new Error('Protocol schema references cannot be overridden');
    if (candidate.rootHash !== undefined && candidate.rootHash !== this.rootHash) throw new Error('Mandatory policy root hash cannot be overridden');
  }
}

export interface IntegrityVerificationResult {
  readonly ok: boolean;
  readonly stage: TrustedStartupStage;
  readonly officialStatus: OfficialBuildStatus;
  readonly failures: readonly IntegrityFailureMetadata[];
  readonly manifest?: IntegrityManifest;
  readonly rollback?: RollbackVerification;
  readonly policyRoot?: MandatoryPolicyRoot;
}

export interface IntegrityVerifierOptions {
  readonly trustRoot?: ReleaseTrustRoot;
  readonly fileReader?: IntegrityFileReader;
  readonly rollback?: RollbackProtection;
  readonly policyRoot?: MandatoryPolicyRoot;
  readonly mode?: 'production' | 'development';
  /** Expected security profile supplied by the immutable host/runtime. */
  readonly securityProfileVersion?: string;
  readonly requireSecureMonotonicStorage?: boolean;
  readonly now?: () => number;
}

export class IntegrityVerifier {
  readonly mode: 'production' | 'development';
  readonly rollback: RollbackProtection;
  private readonly now: () => number;
  constructor(private readonly options: IntegrityVerifierOptions = {}) {
    this.mode = options.mode ?? 'production'; this.rollback = options.rollback ?? new RollbackProtection(); this.now = options.now ?? Date.now;
  }

  async verifyManifest(manifest: IntegrityManifest): Promise<void> {
    validateManifest(manifest);
    const root = this.options.trustRoot;
    if (!root) throw new IntegrityFailure(failure('TRUST_ROOT_UNAVAILABLE', 'Release trust root is unavailable', this.now()));
    if (root.keyId !== manifest.signatureMetadata.keyId) throw new IntegrityFailure(failure('MANIFEST_SIGNATURE_INVALID', 'Release manifest key id does not match the trust root', this.now()));
    if (this.mode === 'production' && root.environment !== 'production') throw new IntegrityFailure(failure('TRUST_ROOT_UNAVAILABLE', 'Development trust material cannot verify a production build', this.now()));
    if (!(await root.verify(signedManifestPayload(manifest), manifest.signatureMetadata.signature))) throw new IntegrityFailure(failure('MANIFEST_SIGNATURE_INVALID', 'Release manifest signature is invalid', this.now()));
  }

  async verifyFiles(manifest: IntegrityManifest): Promise<void> {
    const reader = this.options.fileReader;
    if (!reader) throw new IntegrityFailure(failure('CRITICAL_ENTRY_MISSING', 'No host file reader is available for core integrity verification', this.now()));
    for (const entry of manifest.entries) {
      if (!entry.required && entry.trustClass !== 'IMMUTABLE_CORE' && entry.trustClass !== 'TRUSTED_RUNTIME') continue;
      const bytes = await reader.read(entry.path);
      if (bytes === undefined) {
        if (entry.required) throw new IntegrityFailure({ ...failure('CRITICAL_ENTRY_MISSING', `Critical integrity entry is missing: ${entry.path}`, this.now()), componentId: entry.componentId, path: entry.path, expectedHash: entry.contentHash });
        continue;
      }
      const normalized = toBytes(bytes);
      const actual = await digestBytes(normalized);
      if (normalized.byteLength !== entry.size || actual !== entry.contentHash) throw new IntegrityFailure({ ...failure('CRITICAL_HASH_MISMATCH', `Critical integrity entry changed: ${entry.path}`, this.now()), componentId: entry.componentId, path: entry.path, expectedHash: entry.contentHash, actualHash: actual });
    }
    this.verifyBundleReferences(manifest);
  }

  async verify(manifest: IntegrityManifest): Promise<IntegrityVerificationResult> {
    const failures: IntegrityFailureMetadata[] = [];
    const officialStatus: OfficialBuildStatus = this.mode === 'development' ? 'DEVELOPMENT_BUILD' : this.options.trustRoot?.environment === 'production' ? 'OFFICIAL_VERIFIED' : 'UNVERIFIED_BUILD';
    try {
      await this.verifyManifest(manifest);
      await this.verifyFiles(manifest);
      if (this.options.securityProfileVersion !== undefined && manifest.securityProfileVersion !== this.options.securityProfileVersion) throw new IntegrityFailure({ ...failure('SECURITY_PROFILE_INCOMPATIBLE', 'Manifest security profile is incompatible with the immutable runtime', this.now()), componentId: 'security-profile' });
      if (this.options.policyRoot && manifest.minimumAcceptedPolicyEpoch < this.options.policyRoot.epoch) throw new IntegrityFailure({ ...failure('SECURITY_PROFILE_INCOMPATIBLE', 'Manifest policy epoch is below the mandatory policy root', this.now()), policyEpoch: manifest.minimumAcceptedPolicyEpoch });
      if (this.options.policyRoot?.protocolSecurityProfileVersion && manifest.securityProfileVersion !== this.options.policyRoot.protocolSecurityProfileVersion) throw new IntegrityFailure(failure('SECURITY_PROFILE_INCOMPATIBLE', 'Manifest protocol security profile does not match the mandatory policy root', this.now()));
      if (this.options.policyRoot && canonicalJson(manifest.policyBundleHashes) !== canonicalJson(this.options.policyRoot.policyBundleHashes)) throw new IntegrityFailure(failure('POLICY_BUNDLE_MISMATCH', 'Manifest policy bundle references do not match the mandatory policy root', this.now()));
      if (this.options.policyRoot && this.options.policyRoot.protocolSchemaHashes && canonicalJson(manifest.protocolSchemaHashes) !== canonicalJson(this.options.policyRoot.protocolSchemaHashes)) throw new IntegrityFailure(failure('PROTOCOL_SCHEMA_MISMATCH', 'Manifest protocol schema references do not match the mandatory policy root', this.now()));
      const rollback = await this.rollback.verifyAndAdvance(manifest.minimumAcceptedPolicyEpoch);
      if (this.options.requireSecureMonotonicStorage && !rollback.secureStorage) throw new IntegrityFailure(failure('SECURE_STORAGE_UNAVAILABLE', 'Secure monotonic rollback storage is unavailable', this.now()));
      return { ok: true, stage: 'TRUSTED_CORE_READY', officialStatus, failures, manifest, rollback, policyRoot: this.options.policyRoot };
    } catch (error) {
      const metadata = error instanceof IntegrityFailure ? error.metadata : failure('MANIFEST_INVALID', error instanceof Error ? error.message : 'Integrity verification failed', this.now());
      failures.push(metadata);
      const damaged = metadata.category === 'CRITICAL_HASH_MISMATCH' || metadata.category === 'CRITICAL_ENTRY_MISSING' || metadata.category === 'POLICY_BUNDLE_MISMATCH' || metadata.category === 'PROTOCOL_SCHEMA_MISMATCH';
      const failedStatus: OfficialBuildStatus = this.mode === 'development' ? 'DEVELOPMENT_BUILD' : this.options.trustRoot?.environment === 'production' ? 'OFFICIAL_DAMAGED' : 'UNVERIFIED_BUILD';
      return { ok: false, stage: 'LOCKDOWN', officialStatus: damaged || failedStatus === 'OFFICIAL_DAMAGED' ? 'OFFICIAL_DAMAGED' : failedStatus, failures, manifest };
    }
  }

  private verifyBundleReferences(manifest: IntegrityManifest): void {
    const byComponent = new Map(manifest.entries.map(entry => [entry.componentId, entry.contentHash]));
    for (const [componentId, hash] of Object.entries(manifest.policyBundleHashes)) if (byComponent.get(componentId) !== hash) throw new IntegrityFailure({ ...failure('POLICY_BUNDLE_MISMATCH', `Policy bundle hash mismatch: ${componentId}`, this.now()), componentId, expectedHash: hash, actualHash: byComponent.get(componentId) });
    for (const [componentId, hash] of Object.entries(manifest.protocolSchemaHashes)) if (byComponent.get(componentId) !== hash) throw new IntegrityFailure({ ...failure('PROTOCOL_SCHEMA_MISMATCH', `Protocol schema hash mismatch: ${componentId}`, this.now()), componentId, expectedHash: hash, actualHash: byComponent.get(componentId) });
  }
}

export interface ImmutableCoreOptions extends IntegrityVerifierOptions {
  readonly verifier?: IntegrityVerifier;
}

export interface ImmutableCoreSnapshot {
  readonly stage: TrustedStartupStage;
  readonly officialStatus: OfficialBuildStatus;
  readonly locked: boolean;
  readonly failure?: IntegrityFailureMetadata;
  readonly manifest?: IntegrityManifest;
  readonly rollbackEpoch: number;
  readonly policyEpoch?: number;
}

/** Startup orchestrator and explicit security lockdown boundary. */
export class ImmutableCore {
  readonly verifier: IntegrityVerifier;
  readonly lockdown: SecurityLockdown;
  readonly audit = new SecurityAuditLog();
  private current: ImmutableCoreSnapshot = { stage: 'UNVERIFIED', officialStatus: 'UNVERIFIED_BUILD', locked: false, rollbackEpoch: 0 };
  constructor(options: ImmutableCoreOptions = {}) { this.verifier = options.verifier ?? new IntegrityVerifier(options); this.lockdown = new SecurityLockdown(); }
  async bootstrap(manifest: IntegrityManifest): Promise<ImmutableCoreSnapshot> {
    this.current = { stage: 'UNVERIFIED', officialStatus: this.verifier.mode === 'development' ? 'DEVELOPMENT_BUILD' : 'UNVERIFIED_BUILD', locked: false, rollbackEpoch: this.verifier.rollback.highestTrustedEpoch, manifest };
    const result = await this.verifier.verify(manifest);
    const policyEpoch = manifest.minimumAcceptedPolicyEpoch;
    if (!result.ok) { const metadata = result.failures[0] ?? failure('MANIFEST_INVALID', 'Integrity verification failed', Date.now()); this.audit.append({ event: 'integrity_check', outcome: 'lockdown', category: metadata.category, componentId: metadata.componentId, policyEpoch: metadata.policyEpoch }); this.lockdown.enter(metadata); this.current = { stage: 'LOCKDOWN', officialStatus: result.officialStatus, locked: true, failure: metadata, manifest, rollbackEpoch: this.verifier.rollback.highestTrustedEpoch, policyEpoch }; return this.snapshot(); }
    this.lockdown.clearAfterVerification(LOCKDOWN_CLEAR_TOKEN);
    this.audit.append({ event: 'integrity_check', outcome: 'accepted', policyEpoch });
    if (result.rollback) this.audit.append({ event: 'rollback_decision', outcome: result.rollback.decision === 'REJECTED_ROLLBACK' || result.rollback.decision === 'REJECTED_STATE' ? 'rejected' : 'accepted', policyEpoch: result.rollback.highestTrustedEpoch });
    this.current = { stage: 'TRUSTED_CORE_READY', officialStatus: result.officialStatus, locked: false, manifest, rollbackEpoch: result.rollback?.highestTrustedEpoch ?? 0, policyEpoch };
    return this.snapshot();
  }
  /** Authenticates a candidate recovery/reinstall manifest without mutating
   * rollback state or unlocking any privileged operation. */
  async verifyRecoveryArtifact(manifest: IntegrityManifest): Promise<boolean> {
    try { await this.verifier.verifyManifest(manifest); this.audit.append({ event: 'recovery_check', outcome: 'accepted', policyEpoch: manifest.minimumAcceptedPolicyEpoch }); return true; } catch (error) { const metadata = error instanceof IntegrityFailure ? error.metadata : undefined; this.audit.append({ event: 'recovery_check', outcome: 'rejected', ...(metadata?.category ? { category: metadata.category } : {}), ...(metadata?.componentId ? { componentId: metadata.componentId } : {}) }); return false; }
  }
  async unlockPrivilegedRuntime(): Promise<ImmutableCoreSnapshot> { this.assertStage('TRUSTED_CORE_READY'); this.current = { ...this.current, stage: 'PRIVILEGED_RUNTIME_READY' }; return this.snapshot(); }
  assertStage(required: Exclude<TrustedStartupStage, 'LOCKDOWN'>): void { if (this.current.locked || this.current.stage === 'LOCKDOWN' || stageRank(this.current.stage) < stageRank(required)) throw new IntegrityFailure(this.current.failure ?? failure('MANIFEST_INVALID', `Trusted startup stage ${required} is required`, Date.now())); }
  assertPrivileged(operation: PrivilegedOperation): void { if (this.current.locked || this.current.stage !== 'PRIVILEGED_RUNTIME_READY') { this.audit.append({ event: 'privileged_denied', outcome: 'rejected', operation, ...(this.current.failure?.category ? { category: this.current.failure.category } : {}) }); this.lockdown.assertAllowed(operation); throw new IntegrityFailure(this.current.failure ?? failure('MANIFEST_INVALID', `Privileged operation ${operation} is unavailable before trusted startup`, Date.now())); } }
  snapshot(): ImmutableCoreSnapshot { return structuredClone(this.current); }
}

export interface SecurityLockdownSnapshot {
  readonly state: 'LOCKDOWN';
  readonly enteredAt: string;
  readonly failure: IntegrityFailureMetadata;
  readonly deniedOperations: readonly PrivilegedOperation[];
  readonly recoveryActions: readonly ('INSPECT_FAILURE' | 'VERIFY_AGAIN' | 'REPAIR_HOST' | 'VERIFY_RECOVERY_ARTIFACT')[];
}

/** Lockdown is recoverable through host-controlled repair/verification only;
 * there is intentionally no ignore/continue operation. */
export class SecurityLockdown {
  private state?: SecurityLockdownSnapshot;
  enter(metadata: IntegrityFailureMetadata): void { this.state = { state: 'LOCKDOWN', enteredAt: new Date().toISOString(), failure: { ...metadata }, deniedOperations: [...PRIVILEGED_OPERATIONS], recoveryActions: ['INSPECT_FAILURE', 'VERIFY_AGAIN', 'REPAIR_HOST', 'VERIFY_RECOVERY_ARTIFACT'] }; }
  isLocked(): boolean { return this.state !== undefined; }
  snapshot(): SecurityLockdownSnapshot | undefined { return this.state && structuredClone(this.state); }
  assertAllowed(operation: PrivilegedOperation): void { if (this.state) throw new Error(`SecurityLockdown denies ${operation}`); }
  inspectFailure(): IntegrityFailureMetadata | undefined { return this.state && { ...this.state.failure }; }
  canRecover(action: SecurityLockdownSnapshot['recoveryActions'][number]): boolean { return this.state?.recoveryActions.includes(action) ?? false; }
  /** Called only after a fresh, independently verified manifest succeeds. */
  clearAfterVerification(token: typeof LOCKDOWN_CLEAR_TOKEN): void { if (token !== LOCKDOWN_CLEAR_TOKEN) throw new Error('Only a verified Immutable Core may clear SecurityLockdown'); this.state = undefined; }
}

export interface IdentitySecretHandle {
  readonly deviceId: string;
  readonly nodeId: string;
  readonly publicKey: string;
  readonly encryptionPublicKey: string;
  sign(value: string): Promise<string>;
  signIdentityObject(objectType: string, payload: unknown): Promise<string>;
  signProtocolEnvelope(domain: SigningDomain, payload: unknown): Promise<string>;
  signOwnerIntent(payload: unknown): Promise<string>;
  close(): void;
}

/** Identity keys stay behind this host-neutral capability. The handle exposes
 * signing, never a private key or recovery material. */
export class IdentitySecretAccess {
  private handle?: IdentitySecretHandle;
  constructor(private readonly core: ImmutableCore, private readonly identity: IdentityManager, private readonly crypto: CryptoProvider = new SodiumCryptoProvider()) {}
  async unlock(deviceId: string): Promise<IdentitySecretHandle> {
    this.core.assertStage('TRUSTED_CORE_READY');
    const keys = await this.identity.devicePublicIdentity(deviceId);
    this.handle?.close();
    const signer: IdentitySigningCapability = await this.identity.createIdentitySigningCapability(deviceId, { callerId: `immutable-core:${deviceId}` });
    const handle: IdentitySecretHandle = {
      deviceId: keys.deviceId,
      nodeId: keys.nodeId,
      publicKey: keys.publicKey,
      encryptionPublicKey: keys.encryptionPublicKey,
      sign: async value => { this.core.assertPrivileged('IDENTITY_SIGNING'); return signer.signProtocolEnvelope('KEYSTONE_LEGACY', value); },
      signIdentityObject: async (objectType, payload) => { this.core.assertPrivileged('IDENTITY_SIGNING'); return signer.signIdentityObject(objectType, payload); },
      signProtocolEnvelope: async (domain, payload) => { this.core.assertPrivileged('IDENTITY_SIGNING'); return signer.signProtocolEnvelope(domain, payload); },
      signOwnerIntent: async payload => { this.core.assertPrivileged('IDENTITY_SIGNING'); return signer.signOwnerIntent(payload); },
      close: () => { signer.close(); if (this.handle === handle) this.handle = undefined; },
    };
    this.handle = handle;
    return handle;
  }
  isUnlocked(): boolean { return this.handle !== undefined; }
  lock(): void { this.handle?.close(); this.handle = undefined; }
}

export function unsignedManifest(manifest: IntegrityManifest): UnsignedIntegrityManifest {
  const { signatureMetadata: _signatureMetadata, ...unsigned } = manifest;
  return structuredClone(unsigned);
}

/** Canonical payload includes signature metadata except the signature itself,
 * preventing an attacker from changing key id, algorithm or signing time. */
export function signedManifestPayload(manifest: IntegrityManifest): string {
  const { signature: _signature, ...metadata } = manifest.signatureMetadata;
  return canonicalJson({ ...unsignedManifest(manifest), signatureMetadata: metadata });
}

export async function digestBytes(value: Uint8Array): Promise<string> {
  const copy = new Uint8Array(value); const result = await crypto.subtle.digest('SHA-256', copy.buffer);
  return [...new Uint8Array(result)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function digestText(value: string): Promise<string> { return digestBytes(new TextEncoder().encode(value)); }

export async function createIntegrityEntry(input: { path: string; componentId?: string; bytes: Uint8Array | string; trustClass: TrustClass; required?: boolean }): Promise<IntegrityEntry> {
  const bytes = toBytes(input.bytes); return { path: input.path, componentId: input.componentId ?? input.path, contentHash: await digestBytes(bytes), size: bytes.byteLength, trustClass: input.trustClass, required: input.required ?? true };
}

export async function createSignedIntegrityManifest(input: Omit<IntegrityManifest, 'version' | 'signatureMetadata'> & { signer: (payload: string) => Promise<string> | string; keyId: string; signedAt?: string }): Promise<IntegrityManifest> {
  const unsigned = { version: 1 as const, releaseId: input.releaseId, releaseVersion: input.releaseVersion, buildId: input.buildId, platform: input.platform, architecture: input.architecture, createdAt: input.createdAt, minimumAcceptedPolicyEpoch: input.minimumAcceptedPolicyEpoch, securityProfileVersion: input.securityProfileVersion, entries: input.entries.map(entry => ({ ...entry })), policyBundleHashes: { ...input.policyBundleHashes }, protocolSchemaHashes: { ...input.protocolSchemaHashes }, verifierVersion: input.verifierVersion, signatureMetadata: { algorithm: 'ed25519' as const, keyId: input.keyId, signature: '', signedAt: input.signedAt ?? new Date().toISOString() } } satisfies IntegrityManifest;
  validateManifest({ ...unsigned, signatureMetadata: { ...unsigned.signatureMetadata, signature: 'placeholder' } });
  const signature = await input.signer(signedManifestPayload(unsigned)); return { ...unsigned, signatureMetadata: { ...unsigned.signatureMetadata, signature } };
}

function validateManifest(value: unknown): asserts value is IntegrityManifest {
  if (!value || typeof value !== 'object') throw new IntegrityFailure(failure('MANIFEST_INVALID', 'Integrity manifest is not an object', Date.now()));
  const manifest = value as Partial<IntegrityManifest>;
  const epoch = manifest.minimumAcceptedPolicyEpoch;
  if (manifest.version !== 1 || typeof manifest.releaseId !== 'string' || typeof manifest.releaseVersion !== 'string' || typeof manifest.buildId !== 'string' || typeof manifest.platform !== 'string' || typeof manifest.architecture !== 'string' || typeof manifest.createdAt !== 'string' || !Number.isFinite(Date.parse(manifest.createdAt)) || !Number.isSafeInteger(epoch) || (epoch as number) < 0 || typeof manifest.securityProfileVersion !== 'string' || typeof manifest.verifierVersion !== 'string' || !Array.isArray(manifest.entries) || !manifest.policyBundleHashes || !manifest.protocolSchemaHashes || !manifest.signatureMetadata) throw new IntegrityFailure(failure('MANIFEST_INVALID', 'Integrity manifest fields are invalid', Date.now()));
  const paths = new Set<string>();
  for (const entry of manifest.entries) { if (!entry || typeof entry !== 'object' || typeof entry.path !== 'string' || !safePath(entry.path) || typeof entry.componentId !== 'string' || typeof entry.contentHash !== 'string' || !/^[a-f0-9]{64}$/i.test(entry.contentHash) || !Number.isSafeInteger(entry.size) || entry.size < 0 || !TRUST_CLASSES.includes(entry.trustClass as TrustClass) || typeof entry.required !== 'boolean' || paths.has(entry.path)) throw new IntegrityFailure(failure('MANIFEST_INVALID', 'Integrity entry is invalid or duplicated', Date.now())); paths.add(entry.path); }
  const signature = manifest.signatureMetadata as IntegritySignatureMetadata; if (signature.algorithm !== 'ed25519' || typeof signature.keyId !== 'string' || typeof signature.signature !== 'string' || typeof signature.signedAt !== 'string' || !Number.isFinite(Date.parse(signature.signedAt))) throw new IntegrityFailure(failure('MANIFEST_INVALID', 'Manifest signature metadata is invalid', Date.now()));
  for (const values of [manifest.policyBundleHashes, manifest.protocolSchemaHashes]) for (const [componentId, hash] of Object.entries(values as Record<string, unknown>)) if (!componentId || typeof hash !== 'string' || !/^[a-f0-9]{64}$/i.test(hash)) throw new IntegrityFailure(failure('MANIFEST_INVALID', 'Manifest bundle hash map is invalid', Date.now()));
}

function validRollbackState(value: unknown): value is RollbackState { return !!value && typeof value === 'object' && (value as RollbackState).version === 1 && Number.isSafeInteger((value as RollbackState).highestTrustedEpoch) && (value as RollbackState).highestTrustedEpoch >= 0 && typeof (value as RollbackState).updatedAt === 'string' && typeof (value as RollbackState).integrity === 'string'; }
function safePath(value: string): boolean { return value.length > 0 && value.length <= 512 && !value.startsWith('/') && !value.includes('..') && !value.includes('\\'); }
function toBytes(value: Uint8Array | string): Uint8Array { return typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value); }
function failure(category: IntegrityFailureCategory, message: string, timestamp: number): IntegrityFailureMetadata { return { category, message, timestamp: new Date(timestamp).toISOString() }; }
function stageRank(stage: TrustedStartupStage): number { return stage === 'UNVERIFIED' ? 0 : stage === 'MANIFEST_VERIFIED' ? 1 : stage === 'CORE_FILES_VERIFIED' ? 2 : stage === 'POLICY_VERIFIED' ? 3 : stage === 'ROLLBACK_VERIFIED' ? 4 : stage === 'TRUSTED_CORE_READY' ? 5 : stage === 'PRIVILEGED_RUNTIME_READY' ? 6 : -1; }
