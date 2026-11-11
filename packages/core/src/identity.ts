import type { NodeId, Role } from './types.js';
import { protocolSignedValue } from './security/protocol-security.js';
import type { Envelope, EnvelopeSecurity, UnsignedEnvelope } from './transport.js';
import { CANONICAL_V2_SIGNATURE_PREFIX, canonicalJsonV2, canonicalSigned } from './crypto.js';
import { DeviceKeyHandle, DeviceSigningCapability, IdentitySigningCapability, LegacySecretCompatibilityBoundary, SecretAccessError, SecretCapabilityService, SecretHandle, signingDomainFor, type SecretCreateInput, type SecretReference, type SecureSecretHost, type SecureSigningHost, type SigningDomain } from './security/secrets.js';

/** @deprecated Import/restore compatibility data only; never application data. */
export type MasterSeed = string & { readonly __brand: 'MasterSeed' };
/**
 * @deprecated Compatibility-only raw session-key view. Production code must
 * use `createDeviceSigningCapability`/`createIdentitySigningCapability` and
 * opaque SecretHandle capabilities. Access is denied unless an explicit
 * LegacySecretCompatibilityBoundary is available (Vitest gets a test-only
 * boundary so existing deterministic fixtures remain source-compatible).
 */
export interface DeviceSessionKeys {
  deviceId: string;
  role: 'Self';
  nodeId: NodeId;
  publicKey: string;
  privateKey: string;
  encryptionPublicKey: string;
  encryptionPrivateKey: string;
}
/** @deprecated Legacy pairing payload; use host-controlled typed pairing. */
export interface AddDevicePayload { version: 1; seed: MasterSeed; deviceId?: string; }
export interface SelfSwarmCapability { version: 1; role: 'Self'; topic: Uint8Array; }
export interface IdentityManagerOptions { readonly legacyCompatibility?: LegacySecretCompatibilityBoundary | null; readonly secretHost?: SecureSecretHost; }
export interface DevicePublicIdentity { readonly deviceId: string; readonly nodeId: NodeId; readonly publicKey: string; readonly encryptionPublicKey: string; }

/** Own-device identity. The seed must be kept in platform secure storage; it is never logged. */
export class IdentityManager {
  private readonly ready = import('libsodium-wrappers').then(async ({ default: sodium }) => { await sodium.ready; return sodium; });
  private readonly seed: Uint8Array;
  private readonly legacyCompatibility?: LegacySecretCompatibilityBoundary | null;
  private readonly secretHost?: SecureSecretHost;
  constructor(masterSeed?: MasterSeed | string | Uint8Array, options: IdentityManagerOptions = {}) { this.seed = masterSeed instanceof Uint8Array ? copySeed(masterSeed) : masterSeed ? decodeSeed(masterSeed) : randomSeed(); this.legacyCompatibility = options.legacyCompatibility; this.secretHost = options.secretHost; }
  static fromMasterSeed(seed: MasterSeed | string | Uint8Array, options: IdentityManagerOptions = {}): IdentityManager { return new IdentityManager(seed, options); }
  static fromAddDeviceUri(uri: string, options: IdentityManagerOptions = {}): IdentityManager { return new IdentityManager(parseAddDevice(uri).seed, options); }
  static async generate(options: IdentityManagerOptions = {}): Promise<IdentityManager> { const sodium = await loadSodium(); return new IdentityManager(encode(sodium.randombytes_buf(32)) as MasterSeed, options); }
  /** Raw seed export is a migration/test-only compatibility operation. */
  get masterSeed(): MasterSeed { return this.exportMasterSeed(); }
  exportMasterSeed(boundary?: LegacySecretCompatibilityBoundary): MasterSeed { this.requireLegacyCompatibility(boundary).assertAllowed('READ_MASTER_SEED'); return encode(this.seed) as MasterSeed; }
  async getSwarmTopic(): Promise<Uint8Array> { return this.swarmTopic(); }
  async swarmTopic(): Promise<Uint8Array> { const sodium = await this.ready; return sodium.crypto_generichash(32, sodium.from_string('keystone:self-swarm:v1'), this.seed); }
  async selfSwarmCapability(): Promise<SelfSwarmCapability> { return { version:1, role:'Self', topic:await this.swarmTopic() }; }
  async swarmTopicHex(): Promise<string> { return hex(await this.swarmTopic()); }
  /** Safe metadata-only projection for production consumers. */
  async devicePublicIdentity(deviceId: string): Promise<DevicePublicIdentity> {
    if (!deviceId || deviceId.length > 128) throw new Error('Invalid device id');
    const sodium = await this.ready;
    const material = sodium.crypto_generichash(64, sodium.from_string(`keystone:device:v1:${deviceId}`), this.seed);
    const signing = sodium.crypto_sign_seed_keypair(material.subarray(0, 32));
    const encryption = sodium.crypto_box_seed_keypair(material.subarray(32, 64));
    try { return { deviceId, nodeId: encode(signing.publicKey), publicKey: encode(signing.publicKey), encryptionPublicKey: encode(encryption.publicKey) }; }
    finally { material.fill(0); signing.privateKey.fill(0); encryption.privateKey.fill(0); }
  }
  /** @deprecated Use an opaque signing capability. Kept only for migration and
   * deterministic test fixtures behind the explicit compatibility boundary. */
  async deriveSessionKeys(deviceId: string, boundary?: LegacySecretCompatibilityBoundary): Promise<DeviceSessionKeys> { return this.sessionKeys(deviceId, boundary); }
  /** @deprecated Use an opaque signing capability. */
  async generateSessionKeys(deviceId: string, boundary?: LegacySecretCompatibilityBoundary): Promise<DeviceSessionKeys> { return this.sessionKeys(deviceId, boundary); }
  /** @deprecated Raw private keys are available only through explicit
   * migration/test compatibility context. */
  async sessionKeys(deviceId: string, boundary?: LegacySecretCompatibilityBoundary): Promise<DeviceSessionKeys> {
    this.requireLegacyCompatibility(boundary).assertAllowed('DERIVE_SESSION_KEYS');
    return this.deriveSessionKeysInternal(deviceId);
  }
  private async deriveSessionKeysInternal(deviceId: string): Promise<DeviceSessionKeys> {
    if (!deviceId || deviceId.length > 128) throw new Error('Invalid device id');
    const sodium = await this.ready;
    const material = sodium.crypto_generichash(64, sodium.from_string(`keystone:device:v1:${deviceId}`), this.seed);
    const signing = sodium.crypto_sign_seed_keypair(material.subarray(0, 32));
    const encryption = sodium.crypto_box_seed_keypair(material.subarray(32, 64));
    const publicKey = encode(signing.publicKey); const privateKey = encode(signing.privateKey); const encryptionPublicKey = encode(encryption.publicKey); const encryptionPrivateKey = encode(encryption.privateKey);
    const result = createLegacySessionKeys({ deviceId, nodeId: publicKey, publicKey, encryptionPublicKey, privateKey, encryptionPrivateKey });
    material.fill(0); signing.privateKey.fill(0); encryption.privateKey.fill(0);
    return result;
  }
  /** Derive only the signing material needed by the typed host boundary.  The
   * legacy session object (including its encryption key) is never constructed
   * on this production-shaped path. */
  private async deriveSigningPrivateKeyInternal(deviceId: string): Promise<Uint8Array> {
    if (!deviceId || deviceId.length > 128) throw new Error('Invalid device id');
    const sodium = await this.ready;
    const material = sodium.crypto_generichash(64, sodium.from_string(`keystone:device:v1:${deviceId}`), this.seed);
    const signing = sodium.crypto_sign_seed_keypair(material.subarray(0, 32));
    const privateKey = new Uint8Array(signing.privateKey);
    material.fill(0); signing.privateKey.fill(0);
    return privateKey;
  }
  /**
   * Typed signing boundary.  The returned capability contains only an opaque
   * handle; the legacy session-key object is never passed to callers here.
   */
  async createIdentitySigningCapability(deviceId: string, options: { callerId?: string; domains?: readonly SigningDomain[] } = {}): Promise<IdentitySigningCapability> {
    const { host, handle } = await this.signingContext(deviceId, 'IDENTITY_PRIVATE_KEY', 'IDENTITY');
    const service = new SecretCapabilityService();
    const capability = service.issue({ handle, callerId: options.callerId ?? `identity:${deviceId}`, operations: ['SIGN_IDENTITY_OBJECT', 'SIGN_PROTOCOL_ENVELOPE', 'SIGN_OWNER_INTENT'], ttlMs: 86_400_000, maxUses: 1024 });
    return new IdentitySigningCapability(host, handle, capability, options.callerId ?? `identity:${deviceId}`, new Set(options.domains ?? ['KEYSTONE_IDENTITY_PROFILE', 'KEYSTONE_MESSAGE', 'KEYSTONE_OWNER_INTENT', 'KEYSTONE_AGENT_PROFILE', 'KEYSTONE_CALENDAR', 'KEYSTONE_SHARED_VAULT', 'KEYSTONE_DEVICE', 'KEYSTONE_WORKBOARD', 'KEYSTONE_SAFETY_ATTESTATION', 'KEYSTONE_PUBLICATION', 'KEYSTONE_PROTOCOL_ENVELOPE', 'KEYSTONE_LEGACY']));
  }
  /** Device-scoped signer with a distinct opaque handle and trust/revocation
   * state. It can sign device/message/protocol objects but cannot mint an
   * identity profile signature. */
  async createDeviceSigningCapability(deviceId: string, options: { callerId?: string; trust?: import('./security/secrets.js').DeviceTrustState; revocation?: import('./security/secrets.js').DeviceRevocationState } = {}): Promise<DeviceSigningCapability> {
    const { host, handle: imported } = await this.signingContext(deviceId, 'DEVICE_PRIVATE_KEY', 'DEVICE');
    const handle = new DeviceKeyHandle(imported.reference, deviceId, () => imported.close());
    const service = new SecretCapabilityService();
    const callerId = options.callerId ?? `device:${deviceId}`;
    const capability = service.issue({ handle, callerId, operations: ['SIGN_PROTOCOL_ENVELOPE'], ttlMs: 86_400_000, maxUses: 1024, scope: 'DEVICE', target: deviceId });
    return new DeviceSigningCapability(host, handle, capability, callerId, deviceId, options.trust ?? 'TRUSTED', options.revocation ?? 'ACTIVE');
  }
  async signIdentityObject(deviceId: string, objectType: string, payload: unknown, options?: { callerId?: string }): Promise<string> { return (await this.createIdentitySigningCapability(deviceId, options)).signIdentityObject(objectType, payload); }
  async signProtocolEnvelope(deviceId: string, domain: SigningDomain, payload: unknown, options?: { callerId?: string }): Promise<string> { return (await this.createIdentitySigningCapability(deviceId, options)).signProtocolEnvelope(domain, payload); }
  async signOwnerIntent(deviceId: string, payload: unknown, options?: { callerId?: string }): Promise<string> { return (await this.createIdentitySigningCapability(deviceId, options)).signOwnerIntent(payload); }
  createAddDeviceUri(deviceId?: string, boundary?: LegacySecretCompatibilityBoundary): string {
    const payload: AddDevicePayload = { version: 1, seed: this.exportMasterSeed(boundary), ...(deviceId ? { deviceId } : {}) };
    return `keystone://add-device?data=${encode(new TextEncoder().encode(JSON.stringify(payload)))}`;
  }
  /** @deprecated Device enrollment should use host-controlled typed pairing;
   * this raw return remains only for migration/test compatibility. */
  async addDevice(uriOrData: string, deviceId?: string, boundary?: LegacySecretCompatibilityBoundary): Promise<DeviceSessionKeys> {
    const compatibility = this.requireLegacyCompatibility(boundary);
    const payload = parseAddDevice(uriOrData);
    const manager = new IdentityManager(payload.seed, { legacyCompatibility: compatibility });
    return manager.sessionKeys(deviceId ?? payload.deviceId ?? crypto.randomUUID(), compatibility);
  }
  private resolveLegacyCompatibility(boundary?: LegacySecretCompatibilityBoundary): LegacySecretCompatibilityBoundary | undefined {
    if (boundary) return boundary;
    if (this.legacyCompatibility !== undefined) return this.legacyCompatibility ?? undefined;
    return implicitTestCompatibility();
  }
  private requireLegacyCompatibility(boundary?: LegacySecretCompatibilityBoundary): LegacySecretCompatibilityBoundary {
    const compatibility = this.resolveLegacyCompatibility(boundary);
    if (!(compatibility instanceof LegacySecretCompatibilityBoundary)) throw new SecretAccessError('Legacy raw-secret access requires an explicit migration or test compatibility context');
    return compatibility;
  }
  private async signingContext(deviceId: string, secretClass: 'IDENTITY_PRIVATE_KEY' | 'DEVICE_PRIVATE_KEY', scope: 'IDENTITY' | 'DEVICE'): Promise<{ readonly host: SecureSigningHost; readonly handle: SecretHandle }> {
    const privateKey = await this.deriveSigningPrivateKeyInternal(deviceId);
    const input: SecretCreateInput = { secretClass, risk: 'CRITICAL', lifetime: 'DURABLE', scope, origin: 'DERIVED', exportPolicy: 'NON_EXPORTABLE', algorithm: 'ED25519' };
    if (this.secretHost) {
      try { return { host: this.secretHost, handle: await this.secretHost.importSecret(input, privateKey) }; }
      finally { privateKey.fill(0); }
    }
    const compatibility = this.resolveLegacyCompatibility();
    if (!(compatibility instanceof LegacySecretCompatibilityBoundary) || compatibility.context.environment !== 'TEST' || compatibility.context.purpose !== 'TEST_FIXTURE') { privateKey.fill(0); throw new SecretAccessError('A SecureSecretHost is required for production identity signing'); }
    compatibility.assertAllowed('DERIVE_SESSION_KEYS');
    const encodedPrivateKey = encode(privateKey);
    privateKey.fill(0);
    return { host: new IdentityManagerSigningHost(deviceId, encodedPrivateKey), handle: new SecretHandle({ kind: 'SECRET_REFERENCE', handleId: `${scope.toLowerCase()}:${deviceId}`, secretClass, risk: 'CRITICAL', lifetime: 'DURABLE', scope, origin: 'DERIVED', exportPolicy: 'NON_EXPORTABLE', algorithm: 'ED25519', generation: 1, state: 'ACTIVE', createdAt: new Date().toISOString(), securityLevel: 'MEMORY_ONLY', environment: 'TEST' }) };
  }
  /** A topic is an authorization capability: only holders of the seed may derive it. */
  assertSelf(role: Role): asserts role is 'Self' { if (role !== 'Self') throw new Error('Only Self devices may join the private swarm'); }
}

/** Internal host adapter. It keeps compatibility with the existing derivation
 * implementation while exposing only domain-scoped signatures. */
class IdentityManagerSigningHost implements SecureSigningHost {
  private readonly ready = loadSodium();
  constructor(private readonly deviceId: string, private readonly privateKey: string) {}
  async sign(handle: SecretHandle, domain: SigningDomain, payload: unknown, capability: import('./security/secrets.js').SecretCapability): Promise<string> {
    if (handle.reference.handleId !== `identity:${this.deviceId}` && handle.reference.handleId !== `device:${this.deviceId}`) throw new Error('Identity handle mismatch');
    const operation = domain === 'KEYSTONE_IDENTITY_PROFILE' ? 'SIGN_IDENTITY_OBJECT' : domain === 'KEYSTONE_OWNER_INTENT' ? 'SIGN_OWNER_INTENT' : 'SIGN_PROTOCOL_ENVELOPE';
    capability.consume(operation, handle, { callerId: capability.grant.callerId, ...(capability.grant.target ? { target: capability.grant.target } : {}) });
    const sodium = await this.ready;
    const signature = sodium.crypto_sign_detached(sodium.from_string(canonicalJsonV2({ domain, payload })), sodium.from_base64(this.privateKey, sodium.base64_variants.URLSAFE_NO_PADDING));
    return CANONICAL_V2_SIGNATURE_PREFIX + sodium.to_base64(signature, sodium.base64_variants.URLSAFE_NO_PADDING);
  }
  async verify(domain: SigningDomain, payload: unknown, signature: string, publicKey: string): Promise<boolean> { const sodium = await this.ready; try { const signed = canonicalSigned({ domain, payload }, signature); return sodium.crypto_sign_verify_detached(sodium.from_base64(signed.signature, sodium.base64_variants.URLSAFE_NO_PADDING), sodium.from_string(signed.bytes), sodium.from_base64(publicKey, sodium.base64_variants.URLSAFE_NO_PADDING)); } catch { return false; } }
}

/** EnvelopeSecurity adapter for production callers.  It accepts only public
 * device metadata and an Identity/DeviceSigningCapability; no legacy session
 * key object is part of this boundary. */
export class CapabilityEnvelopeSecurity implements EnvelopeSecurity {
  private readonly trusted = new Map<NodeId, string>();
  constructor(private readonly local: Pick<DevicePublicIdentity, 'nodeId' | 'publicKey'>, private readonly signer: IdentitySigningCapability, trustedPeers: Readonly<Record<NodeId, string>> = {}) {
    Object.entries(trustedPeers).forEach(([id, key]) => this.trusted.set(id, key));
    this.trusted.set(local.nodeId, local.publicKey);
  }
  trust(peer: Pick<DevicePublicIdentity, 'nodeId' | 'publicKey'>): void { this.trusted.set(peer.nodeId, peer.publicKey); }
  async sign(envelope: UnsignedEnvelope): Promise<string> {
    if (envelope.sender !== this.local.nodeId) throw new Error('Cannot sign for another device');
    return this.signer.signProtocolEnvelope(signingDomainFor('protocol', envelope.type), envelope);
  }
  async verify(envelope: Envelope): Promise<boolean> {
    const key = this.trusted.get(envelope.sender);
    if (!key || !envelope.signature) return false;
    const { signature, ...unsigned } = envelope;
    return this.signer.verifySignature(signingDomainFor('protocol', envelope.type), unsigned, signature, key);
  }
}

/** Application-level authentication binding envelope.sender to a paired Self public key. */
export class SelfEnvelopeSecurity implements EnvelopeSecurity {
  private readonly ready = loadSodium(); private readonly trusted = new Map<NodeId, string>();
  /** @deprecated Raw-key envelope security remains only for migration/test
   * fixtures. Production code should inject an EnvelopeSecurity backed by a
   * typed IdentitySigningCapability. */
  constructor(private readonly local: DeviceSessionKeys, trustedPeers: Readonly<Record<NodeId, string>> = {}, private readonly signer?: IdentitySigningCapability, boundary?: LegacySecretCompatibilityBoundary) { requireLegacyBoundary(boundary); Object.entries(trustedPeers).forEach(([id, key]) => this.trusted.set(id, key)); this.trusted.set(local.nodeId, local.publicKey); }
  trust(peer: Pick<DeviceSessionKeys, 'nodeId' | 'publicKey'>): void { this.trusted.set(peer.nodeId, peer.publicKey); }
  async sign(envelope: UnsignedEnvelope): Promise<string> { if (envelope.sender !== this.local.nodeId) throw new Error('Cannot sign for another device'); if (this.signer) { const domain: SigningDomain = envelope.type.includes('message') ? 'KEYSTONE_MESSAGE' : envelope.type.includes('owner') ? 'KEYSTONE_OWNER_INTENT' : 'KEYSTONE_PROTOCOL_ENVELOPE'; return this.signer.signProtocolEnvelope(domain, envelope); } const sodium = await this.ready; return CANONICAL_V2_SIGNATURE_PREFIX + encode(sodium.crypto_sign_detached(sodium.from_string(canonicalJsonV2(protocolSignedValue(envelope.type, envelope))), sodium.from_base64(this.local.privateKey, sodium.base64_variants.URLSAFE_NO_PADDING))); }
  async verify(envelope: Envelope): Promise<boolean> { const key = this.trusted.get(envelope.sender); if (!key || !envelope.signature) return false; const sodium = await this.ready; try { const { signature: _signature, ...unsigned } = envelope; const signed = canonicalSigned(protocolSignedValue(envelope.type, unsigned), envelope.signature); const signature = sodium.from_base64(signed.signature, sodium.base64_variants.URLSAFE_NO_PADDING); const publicKey = sodium.from_base64(key, sodium.base64_variants.URLSAFE_NO_PADDING); if (sodium.crypto_sign_verify_detached(signature, sodium.from_string(signed.bytes), publicKey)) return true; const domain = envelope.type.includes('message') ? 'KEYSTONE_MESSAGE' : envelope.type.includes('owner') ? 'KEYSTONE_OWNER_INTENT' : 'KEYSTONE_PROTOCOL_ENVELOPE'; return sodium.crypto_sign_verify_detached(signature, sodium.from_string(canonicalSigned({ domain, payload: unsigned }, envelope.signature).bytes), publicKey); } catch { return false; } }
}

function createLegacySessionKeys(input: { deviceId: string; nodeId: string; publicKey: string; privateKey: string; encryptionPublicKey: string; encryptionPrivateKey: string }): DeviceSessionKeys {
  const value = { deviceId: input.deviceId, role: 'Self' as const, nodeId: input.nodeId, publicKey: input.publicKey, encryptionPublicKey: input.encryptionPublicKey } as DeviceSessionKeys;
  Object.defineProperties(value, {
    privateKey: { value: input.privateKey, enumerable: false, configurable: false, writable: false },
    encryptionPrivateKey: { value: input.encryptionPrivateKey, enumerable: false, configurable: false, writable: false },
    toJSON: { value: () => ({ deviceId: value.deviceId, role: value.role, nodeId: value.nodeId, publicKey: value.publicKey, encryptionPublicKey: value.encryptionPublicKey }), enumerable: false, configurable: false, writable: false },
  });
  return value;
}

function implicitTestCompatibility(): LegacySecretCompatibilityBoundary | undefined {
  // Vitest injects this non-environment runtime marker into each isolated test
  // worker.  Do not consult NODE_ENV/VITEST (or any other mutable environment
  // variable): a deployment setting must never be able to enable raw-secret
  // compatibility.  Production callers therefore always need an explicit
  // LegacySecretCompatibilityBoundary instance.
  const runtime = (globalThis as unknown as { __vitest_worker__?: { ctx?: { config?: { mode?: string } } } }).__vitest_worker__;
  if (runtime?.ctx?.config?.mode === 'test') return LegacySecretCompatibilityBoundary.forTests('vitest-runtime');
  return undefined;
}

function requireLegacyBoundary(boundary?: LegacySecretCompatibilityBoundary): LegacySecretCompatibilityBoundary {
  const value = boundary ?? implicitTestCompatibility();
  if (!(value instanceof LegacySecretCompatibilityBoundary)) throw new SecretAccessError('Legacy raw-secret compatibility requires an explicit migration or test context');
  return value;
}

export function parseAddDevice(value: string): AddDevicePayload {
  const raw = value.startsWith('keystone://') ? new URL(value).searchParams.get('data') : value;
  if (!raw) throw new Error('Missing add-device data');
  let decoded: string;
  try { decoded = new TextDecoder().decode(decode(raw)); } catch { throw new Error('Invalid add-device data'); }
  try {
    const parsed = JSON.parse(decoded) as Partial<AddDevicePayload>;
    if (parsed.version !== 1 || typeof parsed.seed !== 'string') throw new Error('Invalid add-device payload');
    decodeSeed(parsed.seed); return { version: 1, seed: parsed.seed as MasterSeed, ...(typeof parsed.deviceId === 'string' ? { deviceId: parsed.deviceId } : {}) };
  } catch (error) {
    if (error instanceof Error && error.message === 'Invalid add-device payload') throw error;
    decodeSeed(raw); return { version: 1, seed: raw as MasterSeed };
  }
}
function randomSeed(): Uint8Array { const bytes = new Uint8Array(32); globalThis.crypto.getRandomValues(bytes); return bytes; }
function copySeed(value: Uint8Array): Uint8Array { if (value.byteLength !== 32) throw new Error('Master seed must be exactly 32 bytes'); return new Uint8Array(value); }
function decodeSeed(value: string): Uint8Array { return copySeed(decode(value)); }
function encode(bytes: Uint8Array): string { let binary = ''; bytes.forEach(byte => { binary += String.fromCharCode(byte); }); return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, ''); }
function decode(value: string): Uint8Array { const normalized = value.replace(/-/g, '+').replace(/_/g, '/'); const binary = atob(normalized + '='.repeat((4 - normalized.length % 4) % 4)); return Uint8Array.from(binary, char => char.charCodeAt(0)); }
function hex(bytes: Uint8Array): string { return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join(''); }
async function loadSodium(): Promise<any> { const { default: sodium } = await import('libsodium-wrappers'); await sodium.ready; return sodium; }
