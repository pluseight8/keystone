/**
 * R0P73 Personal Device Mesh.
 *
 * This is an owned-device placement and synchronization layer.  It does not
 * open sockets or choose a physical route: all wire delivery is delegated to
 * the injected KeystoneDeliveryInterface/ConnectivityFabric boundary.
 * Device ownership is proven by an explicit, signed enrollment issued by the
 * existing identity authority.  Labels, proximity and route observations are
 * never trust inputs.
 */

import { canonicalJson, type CryptoProvider } from './crypto.js';
import type { DeviceSessionKeys } from './identity.js';
import type { Envelope, EnvelopeSecurity, KeystoneDeliveryInterface, UnsignedEnvelope } from './connectivity.js';
import type { DeliveryProfile } from './connectivity.js';
import type { NodeId } from './types.js';

export const DEVICE_MESH_SCHEMA_VERSION = 1 as const;
export const DEVICE_MESH_PROTOCOL_VERSION = 1 as const;
export const DEVICE_MESH_ENROLLMENT_TTL_MS = 10 * 60_000;
export const DEVICE_MESH_SYNC_TTL_MS = 10 * 60_000;

export type DeviceRole =
  | 'PORTABLE'
  | 'ALWAYS_AVAILABLE'
  | 'LOCAL_AI'
  | 'DURABLE_REPLICA'
  | 'LIMITED_STORAGE'
  | 'USER_INTERFACE'
  | 'ARCHIVAL'
  | 'HIGH_AVAILABILITY';

/** Coarse, owner-only capabilities advertised by an enrolled device.  These
 * are product surface hints, not authority grants or plugin inventory. */
export type DeviceContinuityCapability =
  | 'CAN_OPEN_MAPS'
  | 'CAN_OPEN_MAIL'
  | 'CAN_OPEN_BROWSER'
  | 'CAN_RECEIVE_FILES'
  | 'CAN_OPEN_VAULT'
  | 'CAN_OPEN_DOCUMENT'
  | 'CAN_OPEN_COLLABORATION'
  | 'CAN_OPEN_PUBLICATION'
  | 'CAN_OPEN_MESSAGING'
  | 'CAN_OPEN_WORKSPACE'
  | 'CAN_RECEIVE_CLIPBOARD';

export interface DeviceCapabilitySet {
  readonly roles?: readonly DeviceRole[];
  readonly continuityCapabilities?: readonly DeviceContinuityCapability[];
  readonly canRunLocalAI?: boolean;
  readonly durableReplica?: boolean;
  readonly highAvailability?: boolean;
  readonly storageBytes?: number;
  readonly availableStorageBytes?: number;
  readonly battery?: 'CRITICAL' | 'LOW' | 'NORMAL' | 'FULL' | 'UNKNOWN';
  readonly charging?: boolean | 'UNKNOWN';
  readonly thermal?: 'NOMINAL' | 'FAIR' | 'SERIOUS' | 'CRITICAL' | 'UNKNOWN';
}

export type DeviceEnrollmentState = 'PENDING' | 'TRUSTED' | 'REVOKED' | 'EXPIRED';
export type DevicePresenceState = 'AVAILABLE' | 'RECENTLY_SEEN' | 'OFFLINE' | 'DELIVERY_PENDING' | 'UNKNOWN';
export type DeviceMeshStatus = 'AVAILABLE' | 'SYNCHRONIZING' | 'UP_TO_DATE' | 'WAITING_FOR_ROUTE' | 'OFFLINE' | 'REVOKED' | 'NEEDS_ATTENTION';
export type ReplicationIntent = 'LOCAL_ONLY' | 'OWNED_DEVICES' | 'SELECTED_DEVICES' | 'HIGH_AVAILABILITY' | 'METADATA_ONLY' | 'ON_DEMAND';
export type DeviceTransferPriority = 'SECURITY' | 'USER_INTERACTIVE' | 'NORMAL' | 'BACKGROUND' | 'OPTIONAL_BULK';

export interface DeviceTrustRecord {
  readonly version: 1;
  readonly deviceId: NodeId;
  readonly ownerIdentityId: NodeId;
  readonly publicKey: string;
  readonly encryptionPublicKey: string;
  readonly label: string;
  readonly platform: string;
  readonly capabilities: DeviceCapabilitySet;
  readonly enrolledAt: string;
  readonly lastSeenAt?: string;
  readonly trustEpoch: number;
  readonly state: DeviceEnrollmentState;
}

export interface DeviceEnrollmentRequest {
  readonly version: 1;
  readonly kind: 'device_enrollment_request';
  readonly id: string;
  readonly ownerIdentityId: NodeId;
  readonly deviceId: NodeId;
  readonly publicKey: string;
  readonly encryptionPublicKey: string;
  readonly label: string;
  readonly platform: string;
  readonly capabilities: DeviceCapabilitySet;
  readonly requestedAt: string;
  readonly expiresAt: string;
  readonly nonce: string;
  readonly signature: string;
}

export interface DeviceEnrollmentAuthorization {
  readonly version: 1;
  readonly kind: 'device_enrollment_authorization';
  readonly id: string;
  readonly ownerIdentityId: NodeId;
  readonly deviceId: NodeId;
  readonly publicKey: string;
  readonly encryptionPublicKey: string;
  readonly label: string;
  readonly platform: string;
  readonly capabilities: DeviceCapabilitySet;
  readonly issuedBy: NodeId;
  readonly trustEpoch: number;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly nonce: string;
  readonly signature: string;
}

export interface DeviceMeshRevocationEvent {
  readonly version: 1;
  readonly kind: 'device_mesh_revocation';
  readonly id: string;
  readonly ownerIdentityId: NodeId;
  readonly deviceId: NodeId;
  readonly issuedBy: NodeId;
  readonly trustEpoch: number;
  readonly revokedAt: string;
  readonly reason: string;
  readonly signature: string;
}

export interface DevicePresenceObservation {
  readonly version: 1;
  readonly deviceId: NodeId;
  readonly state: DevicePresenceState;
  readonly observedAt: string;
  readonly expiresAt: string;
  readonly source: 'LOCAL' | 'AUTHENTICATED_DEVICE' | 'FABRIC_OBSERVATION';
}

export interface DevicePlacementPolicy {
  readonly intent: ReplicationIntent;
  readonly selectedDeviceIds?: readonly NodeId[];
  readonly includeContent?: boolean;
  readonly maxBytes?: number;
  readonly minimumStorageBytes?: number;
}

export interface DeviceReplicaState {
  readonly version: 1;
  readonly deviceId: NodeId;
  readonly objectId: string;
  readonly objectType: string;
  readonly objectVersion: string;
  readonly stateHash: string;
  readonly metadataOnly: boolean;
  readonly status: 'PENDING' | 'TRANSFERRING' | 'CONFIRMED' | 'STALE' | 'REJECTED';
  readonly updatedAt: string;
  readonly confirmedAt?: string;
}

export interface DeviceSyncCursor {
  readonly version: 1;
  readonly deviceId: NodeId;
  readonly cursor: string;
  readonly stateHash?: string;
  readonly updatedAt: string;
}

export interface DeviceTransferRequest {
  readonly version: 1;
  readonly id: string;
  readonly objectId: string;
  readonly objectType: string;
  readonly objectVersion: string;
  readonly stateHash: string;
  readonly targetDeviceId: NodeId;
  readonly intent: ReplicationIntent;
  readonly priority: DeviceTransferPriority;
  readonly profile: DeliveryProfile;
  readonly metadataOnly: boolean;
  readonly sizeBytes: number;
  readonly payload?: unknown;
  readonly createdAt: string;
  readonly attempts: number;
  readonly nextAttemptAt: number;
  readonly status: 'PENDING' | 'TRANSFERRING' | 'WAITING_FOR_ROUTE';
}

export interface DeviceMeshStatusSnapshot {
  readonly localDeviceId: NodeId;
  readonly ownerIdentityId: NodeId;
  readonly status: DeviceMeshStatus;
  readonly devices: readonly (DeviceTrustRecord & { readonly presence: DevicePresenceState; readonly pending: number; readonly replicas: number })[];
  readonly pendingTransfers: number;
  readonly confirmedReplicas: number;
  readonly trustEpoch: number;
}

export interface DeviceMeshState {
  readonly version: typeof DEVICE_MESH_SCHEMA_VERSION;
  readonly ownerIdentityId: NodeId;
  readonly trustEpoch: number;
  readonly devices: Readonly<Record<NodeId, DeviceTrustRecord>>;
  readonly pendingEnrollments: Readonly<Record<string, DeviceEnrollmentRequest>>;
  readonly revocations: Readonly<Record<NodeId, DeviceMeshRevocationEvent>>;
  readonly pendingTransfers: Readonly<Record<string, DeviceTransferRequest>>;
  readonly replicas: Readonly<Record<string, DeviceReplicaState>>;
  readonly cursors: Readonly<Record<NodeId, DeviceSyncCursor>>;
  readonly presence: Readonly<Record<NodeId, DevicePresenceObservation>>;
  readonly seen: Readonly<Record<string, true>>;
}

/** Internal mutable projection; callers only receive the readonly state above. */
type MutableDeviceMeshState = {
  version: typeof DEVICE_MESH_SCHEMA_VERSION;
  ownerIdentityId: NodeId;
  trustEpoch: number;
  devices: Record<NodeId, DeviceTrustRecord>;
  pendingEnrollments: Record<string, DeviceEnrollmentRequest>;
  revocations: Record<NodeId, DeviceMeshRevocationEvent>;
  pendingTransfers: Record<string, DeviceTransferRequest>;
  replicas: Record<string, DeviceReplicaState>;
  cursors: Record<NodeId, DeviceSyncCursor>;
  presence: Record<NodeId, DevicePresenceObservation>;
  seen: Record<string, true>;
};

export interface DeviceMeshStorage {
  read(): Promise<unknown | undefined>;
  write(value: unknown): Promise<void>;
}

export class InMemoryDeviceMeshStorage implements DeviceMeshStorage {
  private value?: unknown;
  async read(): Promise<unknown | undefined> { return this.value === undefined ? undefined : structuredClone(this.value); }
  async write(value: unknown): Promise<void> { this.value = structuredClone(value); }
}

export interface DeviceMeshSigner {
  sign(payload: unknown): Promise<string>;
  verify(payload: unknown, signature: string, publicKey: string): Promise<boolean>;
}

export interface OwnerConfirmation {
  readonly confirmed: true;
  readonly doubleConfirmed: true;
}

export interface PersonalDeviceMeshOptions {
  readonly local: DeviceSessionKeys;
  readonly ownerIdentityId?: NodeId;
  /** Authority device is normally the first/owner device. */
  readonly authorityDeviceId?: NodeId;
  readonly authorityPublicKey?: string;
  readonly crypto: CryptoProvider;
  readonly storage?: DeviceMeshStorage;
  readonly transport?: KeystoneDeliveryInterface;
  readonly security?: EnvelopeSecurity;
  readonly signer?: DeviceMeshSigner;
  readonly now?: () => number;
  readonly maxDevices?: number;
  readonly maxPendingTransfers?: number;
  readonly maxReplicaRecords?: number;
  readonly maxPayloadBytes?: number;
  readonly onReplica?: (replica: DeviceReplicaState, payload: unknown) => Promise<void> | void;
}

export class DeviceMeshError extends Error {
  constructor(readonly code: 'INVALID' | 'UNAUTHORIZED' | 'REPLAY' | 'REVOKED' | 'EXPIRED' | 'RESOURCE_LIMIT' | 'UNAVAILABLE' | 'STALE' | 'INTEGRITY', message: string) { super(message); this.name = 'DeviceMeshError'; }
}

const SYNC_ENVELOPE = 'device.mesh.sync';
const REVOCATION_ENVELOPE = 'device.mesh.revocation';
const ACK_ENVELOPE = 'device.mesh.ack';
const MAX_LABEL = 80;
const MAX_PLATFORM = 80;
const MAX_OBJECT_ID = 256;
const MAX_OBJECT_TYPE = 128;
const MAX_CURSOR = 512;
const MAX_SEEN = 8_192;

function clone<T>(value: T): T { return structuredClone(value); }
function nowIso(now: () => number): string { return new Date(now()).toISOString(); }
function validString(value: unknown, max: number): value is string { return typeof value === 'string' && value.trim().length > 0 && value.length <= max; }
function boundedInt(value: unknown, min: number, max: number): value is number { return Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max; }
function expiresIn(value: string, now: number, max = DEVICE_MESH_ENROLLMENT_TTL_MS): boolean { const parsed = Date.parse(value); return Number.isFinite(parsed) && parsed > now && parsed <= now + max; }
function pastOrCurrent(value: string, now: number): boolean { const parsed = Date.parse(value); return Number.isFinite(parsed) && parsed <= now + 60_000; }
function transferKey(deviceId: NodeId, objectId: string): string { return `${deviceId}\u0000${objectId}`; }
function replicaKey(deviceId: NodeId, objectId: string): string { return `${deviceId}\u0000${objectId}`; }
function safeJsonSize(value: unknown): number { try { return new TextEncoder().encode(JSON.stringify(value)).byteLength; } catch { return Number.MAX_SAFE_INTEGER; } }
function hasSecretField(value: unknown, path = ''): boolean {
  if (!value || typeof value !== 'object' || value instanceof Uint8Array) return false;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (/^(privateKey|encryptionPrivateKey|secretKey|recoverySecret|recoveryPhrase|mnemonic|apiKey|token)$/i.test(key)) return true;
    if (hasSecretField(child, `${path}${key}.`)) return true;
  }
  return false;
}
function safeCapabilities(value: unknown): DeviceCapabilitySet {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>;
  const roles = Array.isArray(input.roles) ? input.roles.filter((role): role is DeviceRole => typeof role === 'string' && ['PORTABLE', 'ALWAYS_AVAILABLE', 'LOCAL_AI', 'DURABLE_REPLICA', 'LIMITED_STORAGE', 'USER_INTERFACE', 'ARCHIVAL', 'HIGH_AVAILABILITY'].includes(role)).slice(0, 16) : undefined;
  const continuityCapabilities = Array.isArray(input.continuityCapabilities)
    ? input.continuityCapabilities.filter((capability): capability is DeviceContinuityCapability => typeof capability === 'string' && ['CAN_OPEN_MAPS', 'CAN_OPEN_MAIL', 'CAN_OPEN_BROWSER', 'CAN_RECEIVE_FILES', 'CAN_OPEN_VAULT', 'CAN_OPEN_DOCUMENT', 'CAN_OPEN_COLLABORATION', 'CAN_OPEN_PUBLICATION', 'CAN_OPEN_MESSAGING', 'CAN_OPEN_WORKSPACE', 'CAN_RECEIVE_CLIPBOARD'].includes(capability)).slice(0, 32)
    : undefined;
  const output: DeviceCapabilitySet = {
    ...(roles?.length ? { roles } : {}),
    ...(continuityCapabilities?.length ? { continuityCapabilities } : {}),
    ...(typeof input.canRunLocalAI === 'boolean' ? { canRunLocalAI: input.canRunLocalAI } : {}),
    ...(typeof input.durableReplica === 'boolean' ? { durableReplica: input.durableReplica } : {}),
    ...(typeof input.highAvailability === 'boolean' ? { highAvailability: input.highAvailability } : {}),
    ...(boundedInt(input.storageBytes, 0, Number.MAX_SAFE_INTEGER) ? { storageBytes: input.storageBytes } : {}),
    ...(boundedInt(input.availableStorageBytes, 0, Number.MAX_SAFE_INTEGER) ? { availableStorageBytes: input.availableStorageBytes } : {}),
    ...(typeof input.battery === 'string' && ['CRITICAL', 'LOW', 'NORMAL', 'FULL', 'UNKNOWN'].includes(input.battery) ? { battery: input.battery as DeviceCapabilitySet['battery'] } : {}),
    ...(typeof input.charging === 'boolean' || input.charging === 'UNKNOWN' ? { charging: input.charging as DeviceCapabilitySet['charging'] } : {}),
    ...(typeof input.thermal === 'string' && ['NOMINAL', 'FAIR', 'SERIOUS', 'CRITICAL', 'UNKNOWN'].includes(input.thermal) ? { thermal: input.thermal as DeviceCapabilitySet['thermal'] } : {}),
  };
  return output;
}

function validateTrustRecord(value: unknown): value is DeviceTrustRecord {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<DeviceTrustRecord>;
  return item.version === 1 && validString(item.deviceId, 256) && validString(item.ownerIdentityId, 256) && validString(item.publicKey, 512) && validString(item.encryptionPublicKey, 512) && validString(item.label, MAX_LABEL) && validString(item.platform, MAX_PLATFORM) && boundedInt(item.trustEpoch, 0, Number.MAX_SAFE_INTEGER) && ['PENDING', 'TRUSTED', 'REVOKED', 'EXPIRED'].includes(String(item.state)) && typeof item.enrolledAt === 'string' && safeJsonSize(item.capabilities) <= 8_192;
}

/** Bounded registry projection. It has no network or cryptographic side effects. */
export class OwnedDeviceRegistry {
  private readonly records = new Map<NodeId, DeviceTrustRecord>();
  constructor(private readonly maxDevices = 32) {}
  list(): readonly DeviceTrustRecord[] { return [...this.records.values()].map(clone); }
  get(deviceId: NodeId): DeviceTrustRecord | undefined { const value = this.records.get(deviceId); return value ? clone(value) : undefined; }
  register(value: DeviceTrustRecord): void { if (!validateTrustRecord(value)) throw new DeviceMeshError('INVALID', 'Invalid device trust record'); if (!this.records.has(value.deviceId) && this.records.size >= this.maxDevices) throw new DeviceMeshError('RESOURCE_LIMIT', 'Owned device registry bound exceeded'); const current = this.records.get(value.deviceId); if (current?.state === 'REVOKED' && value.state !== 'REVOKED' && value.trustEpoch <= current.trustEpoch) throw new DeviceMeshError('STALE', 'Revoked device trust cannot roll back'); this.records.set(value.deviceId, clone(value)); }
  revoke(deviceId: NodeId, epoch: number): void { const current = this.records.get(deviceId); if (!current) return; if (epoch < current.trustEpoch) throw new DeviceMeshError('STALE', 'Stale device trust epoch'); this.records.set(deviceId, { ...current, state: 'REVOKED', trustEpoch: epoch }); }
  isTrusted(deviceId: NodeId): boolean { return this.records.get(deviceId)?.state === 'TRUSTED'; }
  clear(): void { this.records.clear(); }
}

/** Placement is deliberately separate from route choice. */
export class DevicePlacementPlanner {
  constructor(private readonly maxTargets = 32) {}
  select(devices: readonly DeviceTrustRecord[], policy: DevicePlacementPolicy, localDeviceId?: NodeId, sizeBytes = 0): readonly DeviceTrustRecord[] {
    const selected = new Set(policy.selectedDeviceIds ?? []);
    const eligible = devices.filter(device => device.state === 'TRUSTED' && device.deviceId !== localDeviceId && (!selected.size || selected.has(device.deviceId))).filter(device => {
      const available = device.capabilities.availableStorageBytes;
      if (policy.minimumStorageBytes !== undefined && available !== undefined && available < policy.minimumStorageBytes) return false;
      if (sizeBytes > 0 && available !== undefined && available < sizeBytes) return false;
      if (sizeBytes > 0 && device.capabilities.battery === 'CRITICAL') return false;
      return true;
    });
    if (policy.intent === 'LOCAL_ONLY' || policy.intent === 'ON_DEMAND') return [];
    if (policy.intent === 'HIGH_AVAILABILITY') {
      const preferred = eligible.filter(device => device.capabilities.highAvailability || device.capabilities.durableReplica || device.capabilities.roles?.includes('HIGH_AVAILABILITY') || device.capabilities.roles?.includes('DURABLE_REPLICA'));
      return (preferred.length ? preferred : eligible).slice(0, this.maxTargets).map(clone);
    }
    return eligible.slice(0, this.maxTargets).map(clone);
  }
}

export class PersonalDeviceMesh {
  readonly registry: OwnedDeviceRegistry;
  readonly placement: DevicePlacementPlanner;
  private state: MutableDeviceMeshState;
  private readonly storage: DeviceMeshStorage;
  private readonly now: () => number;
  private readonly crypto: CryptoProvider;
  private readonly local: DeviceSessionKeys;
  private readonly ownerIdentityId: NodeId;
  private readonly authorityId: NodeId;
  private readonly authorityPublicKey: string;
  private readonly transport?: KeystoneDeliveryInterface;
  private readonly security?: EnvelopeSecurity;
  private readonly signer?: DeviceMeshSigner;
  private readonly limits: { readonly maxPending: number; readonly maxReplicas: number; readonly maxPayloadBytes: number };
  private readonly onReplica?: (replica: DeviceReplicaState, payload: unknown) => Promise<void> | void;
  private writes: Promise<void> = Promise.resolve();
  private readonly readyPromise: Promise<void>;
  /** Serialize application of a transfer ID while signature/hash checks and
   * durable persistence are in flight.  Transport replay dedup alone cannot
   * prevent two concurrent handlers from both invoking onReplica. */
  private readonly syncInFlight = new Map<string, Promise<void>>();
  private unsubscribe?: () => void;
  private closed = false;

  constructor(options: PersonalDeviceMeshOptions) {
    if (!options.local || !options.crypto) throw new DeviceMeshError('INVALID', 'PersonalDeviceMesh requires local device keys and crypto');
    this.local = options.local; this.crypto = options.crypto; this.now = options.now ?? Date.now; this.ownerIdentityId = options.ownerIdentityId ?? options.local.nodeId; this.authorityId = options.authorityDeviceId ?? options.local.nodeId; this.authorityPublicKey = options.authorityPublicKey ?? options.local.publicKey; this.storage = options.storage ?? new InMemoryDeviceMeshStorage(); this.transport = options.transport; this.security = options.security; this.signer = options.signer; this.onReplica = options.onReplica; this.limits = { maxPending: Math.max(1, Math.min(4_096, options.maxPendingTransfers ?? 256)), maxReplicas: Math.max(1, Math.min(16_384, options.maxReplicaRecords ?? 4_096)), maxPayloadBytes: Math.max(4_096, Math.min(4 * 1024 * 1024, options.maxPayloadBytes ?? 512 * 1024)) }; this.registry = new OwnedDeviceRegistry(options.maxDevices ?? 32); this.placement = new DevicePlacementPlanner(options.maxDevices ?? 32); this.state = this.emptyState(); this.readyPromise = this.hydrate(); if (this.transport) this.unsubscribe = this.transport.onMessage(envelope => { void this.receiveEnvelope(envelope).catch(() => undefined); });
  }

  async ready(): Promise<void> { await this.readyPromise; }
  get localDeviceId(): NodeId { return this.local.nodeId; }
  get identityId(): NodeId { return this.ownerIdentityId; }
  /** The R0P73 authority device is exposed as metadata only so higher-level
   * services can distinguish the enrolled authority from an ordinary peer. */
  get authorityDeviceId(): NodeId { return this.authorityId; }
  get trustEpoch(): number { return this.state.trustEpoch; }
  async listDevices(): Promise<readonly DeviceTrustRecord[]> { await this.ready(); return this.registry.list(); }
  async getDevice(deviceId: NodeId): Promise<DeviceTrustRecord | undefined> { await this.ready(); return this.registry.get(deviceId); }
  isTrustedDevice(deviceId: NodeId): boolean { return this.registry.isTrusted(deviceId) && !this.isRevoked(deviceId); }
  isRevoked(deviceId: NodeId): boolean { const value = this.registry.get(deviceId); return value?.state === 'REVOKED' || Boolean(this.state.revocations[deviceId]); }

  async createEnrollmentRequest(input: { label: string; platform: string; capabilities?: DeviceCapabilitySet; expiresInMs?: number }): Promise<DeviceEnrollmentRequest> {
    await this.ready(); if (!validString(input.label, MAX_LABEL) || !validString(input.platform, MAX_PLATFORM)) throw new DeviceMeshError('INVALID', 'Device label/platform is invalid'); if (this.local.nodeId === this.authorityDeviceId) throw new DeviceMeshError('INVALID', 'The authority device cannot enroll itself'); const now = this.now(); const ttl = Math.max(30_000, Math.min(DEVICE_MESH_ENROLLMENT_TTL_MS, input.expiresInMs ?? DEVICE_MESH_ENROLLMENT_TTL_MS)); const unsigned = { version: 1 as const, kind: 'device_enrollment_request' as const, id: crypto.randomUUID(), ownerIdentityId: this.ownerIdentityId, deviceId: this.local.nodeId, publicKey: this.local.publicKey, encryptionPublicKey: this.local.encryptionPublicKey, label: input.label.trim().slice(0, MAX_LABEL), platform: input.platform.trim().slice(0, MAX_PLATFORM), capabilities: safeCapabilities(input.capabilities), requestedAt: nowIso(this.now), expiresAt: new Date(now + ttl).toISOString(), nonce: await this.crypto.randomNonce() }; const request = { ...unsigned, signature: await this.sign(unsigned) }; this.state.pendingEnrollments[request.id] = request; this.trimSeenAndPending(); await this.persist(); return clone(request);
  }

  async authorizeEnrollment(request: DeviceEnrollmentRequest, confirmation?: OwnerConfirmation): Promise<DeviceEnrollmentAuthorization> {
    await this.ready(); this.assertAuthority(confirmation); if (!(await this.verifyRequest(request)) || request.ownerIdentityId !== this.ownerIdentityId || request.deviceId === this.authorityDeviceId || !expiresIn(request.expiresAt, this.now())) throw new DeviceMeshError('UNAUTHORIZED', 'Enrollment request failed owner/device authentication'); if (this.state.seen[request.id]) throw new DeviceMeshError('REPLAY', 'Enrollment request was already used'); if (this.registry.get(request.deviceId)?.state === 'REVOKED') throw new DeviceMeshError('REVOKED', 'Revoked device cannot be enrolled without a new recovery flow'); const issuedAt = nowIso(this.now); const unsigned = { version: 1 as const, kind: 'device_enrollment_authorization' as const, id: crypto.randomUUID(), ownerIdentityId: this.ownerIdentityId, deviceId: request.deviceId, publicKey: request.publicKey, encryptionPublicKey: request.encryptionPublicKey, label: request.label, platform: request.platform, capabilities: safeCapabilities(request.capabilities), issuedBy: this.authorityDeviceId, trustEpoch: this.state.trustEpoch, issuedAt, expiresAt: new Date(this.now() + DEVICE_MESH_ENROLLMENT_TTL_MS).toISOString(), nonce: request.nonce }; const authorization = { ...unsigned, signature: await this.sign(unsigned) }; this.state.seen[request.id] = true; this.state.seen[authorization.id] = true; this.upsertTrust({ version: 1, deviceId: authorization.deviceId, ownerIdentityId: this.ownerIdentityId, publicKey: authorization.publicKey, encryptionPublicKey: authorization.encryptionPublicKey, label: authorization.label, platform: authorization.platform, capabilities: authorization.capabilities, enrolledAt: authorization.issuedAt, lastSeenAt: authorization.issuedAt, trustEpoch: authorization.trustEpoch, state: 'TRUSTED' }); delete this.state.pendingEnrollments[request.id]; await this.persist(); return clone(authorization);
  }

  async acceptEnrollmentAuthorization(value: unknown): Promise<boolean> {
    await this.ready(); const authorization = parseAuthorization(value); if (!authorization || authorization.ownerIdentityId !== this.ownerIdentityId || authorization.deviceId !== this.local.nodeId || authorization.issuedBy !== this.authorityDeviceId || !expiresIn(authorization.expiresAt, this.now()) || !(await this.verifyAuthority(authorization))) return false; if (this.state.seen[authorization.id]) return false; if (authorization.trustEpoch < this.state.trustEpoch || this.isRevoked(this.local.nodeId)) return false; this.state.seen[authorization.id] = true; this.upsertTrust({ version: 1, deviceId: authorization.deviceId, ownerIdentityId: this.ownerIdentityId, publicKey: authorization.publicKey, encryptionPublicKey: authorization.encryptionPublicKey, label: authorization.label, platform: authorization.platform, capabilities: authorization.capabilities, enrolledAt: authorization.issuedAt, lastSeenAt: nowIso(this.now), trustEpoch: authorization.trustEpoch, state: 'TRUSTED' }); await this.persist(); return true;
  }

  async revokeDevice(deviceId: NodeId, reason: string, confirmation?: OwnerConfirmation): Promise<DeviceMeshRevocationEvent> {
    await this.ready(); this.assertAuthority(confirmation); if (!validString(deviceId, 256) || deviceId === this.authorityDeviceId || !validString(reason, 240)) throw new DeviceMeshError('INVALID', 'Invalid device revocation'); const epoch = this.state.trustEpoch + 1; const unsigned = { version: 1 as const, kind: 'device_mesh_revocation' as const, id: crypto.randomUUID(), ownerIdentityId: this.ownerIdentityId, deviceId, issuedBy: this.authorityDeviceId, trustEpoch: epoch, revokedAt: nowIso(this.now), reason: reason.trim().slice(0, 240) }; const event = { ...unsigned, signature: await this.sign(unsigned) }; this.state.trustEpoch = epoch; this.state.revocations[deviceId] = event; const existing = this.registry.get(deviceId); if (existing) { this.registry.revoke(deviceId, epoch); this.state.devices[deviceId] = this.registry.get(deviceId)!; } this.dropPendingFor(deviceId); this.state.seen[event.id] = true; await this.persist(); void this.broadcastRevocation(event); return clone(event);
  }

  async acceptRevocation(value: unknown): Promise<boolean> {
    await this.ready(); const event = parseRevocation(value); if (!event || event.ownerIdentityId !== this.ownerIdentityId || event.issuedBy !== this.authorityDeviceId || !(await this.verifyAuthority(event)) || event.trustEpoch < this.state.trustEpoch) return false; if (this.state.seen[event.id]) return false; this.state.seen[event.id] = true; this.state.trustEpoch = Math.max(this.state.trustEpoch, event.trustEpoch); this.state.revocations[event.deviceId] = event; this.registry.revoke(event.deviceId, event.trustEpoch); const revoked = this.registry.get(event.deviceId); if (revoked) this.state.devices[event.deviceId] = revoked; if (event.deviceId === this.local.nodeId) { const current = this.registry.get(this.local.nodeId); if (current) { const localRevoked = { ...current, state: 'REVOKED' as const, trustEpoch: event.trustEpoch }; this.registry.register(localRevoked); this.state.devices[this.local.nodeId] = localRevoked; } } this.dropPendingFor(event.deviceId); await this.persist(); if (this.transport && event.deviceId === this.local.nodeId) void this.sendWire(event.issuedBy, 'device_mesh_revocation_ack', { eventId: event.id, trustEpoch: event.trustEpoch }); return true;
  }

  async observePresence(input: Omit<DevicePresenceObservation, 'version' | 'observedAt' | 'expiresAt'> & { ttlMs?: number }): Promise<DevicePresenceObservation> {
    await this.ready(); if (!this.isTrustedDevice(input.deviceId) && input.deviceId !== this.local.nodeId) throw new DeviceMeshError('UNAUTHORIZED', 'Presence requires an enrolled device'); const ttl = Math.max(1_000, Math.min(5 * 60_000, input.ttlMs ?? 60_000)); const observation: DevicePresenceObservation = { version: 1, deviceId: input.deviceId, state: input.state, source: input.source, observedAt: nowIso(this.now), expiresAt: new Date(this.now() + ttl).toISOString() }; this.state.presence[input.deviceId] = observation; await this.persist(); return clone(observation);
  }

  async placementFor(policy: DevicePlacementPolicy, sizeBytes = 0): Promise<readonly DeviceTrustRecord[]> { await this.ready(); if (this.isRevoked(this.local.nodeId)) throw new DeviceMeshError('REVOKED', 'Revoked device cannot place or replicate owned state'); return this.placement.select(this.registry.list(), policy, this.local.nodeId, sizeBytes); }

  async replicate(input: { objectId: string; objectType: string; objectVersion?: string; payload?: unknown; metadata?: unknown; policy: DevicePlacementPolicy; priority?: DeviceTransferPriority; contentHash?: string; sizeBytes?: number }): Promise<readonly DeviceTransferRequest[]> {
    await this.ready(); this.assertObjectInput(input); const metadataOnly = input.policy.intent === 'METADATA_ONLY' || input.payload === undefined; const value = metadataOnly ? input.metadata : input.payload; if (hasSecretField(value)) throw new DeviceMeshError('UNAUTHORIZED', 'Secret material cannot enter device replication'); const sizeBytes = input.sizeBytes ?? safeJsonSize(value); if (!boundedInt(sizeBytes, 0, this.limits.maxPayloadBytes)) throw new DeviceMeshError('RESOURCE_LIMIT', 'Replica payload exceeds local bound'); const stateHash = input.contentHash ?? await this.crypto.hash(canonicalJson(value ?? { objectId: input.objectId, objectVersion: input.objectVersion ?? '0' })); if (input.contentHash && input.payload !== undefined && stateHash !== await this.crypto.hash(canonicalJson(input.payload))) throw new DeviceMeshError('INTEGRITY', 'Content hash does not match replica payload'); const targets = await this.placementFor(input.policy, sizeBytes); if (input.policy.intent === 'ON_DEMAND' || input.policy.intent === 'LOCAL_ONLY') return []; const result: DeviceTransferRequest[] = []; for (const target of targets) { const key = transferKey(target.deviceId, input.objectId); const current = this.state.pendingTransfers[key]; const request: DeviceTransferRequest = { version: 1, id: current?.id ?? crypto.randomUUID(), objectId: input.objectId, objectType: input.objectType, objectVersion: input.objectVersion ?? '0', stateHash, targetDeviceId: target.deviceId, intent: input.policy.intent, priority: input.priority ?? 'NORMAL', profile: input.priority === 'USER_INTERACTIVE' ? (sizeBytes > 64 * 1024 ? 'BULK' : 'INTERACTIVE') : input.priority === 'OPTIONAL_BULK' ? 'BULK' : input.priority === 'SECURITY' ? 'CONTROL' : 'BACKGROUND', metadataOnly, sizeBytes, ...(value === undefined ? {} : { payload: clone(value) }), createdAt: current?.createdAt ?? nowIso(this.now), attempts: current?.attempts ?? 0, nextAttemptAt: this.now(), status: 'PENDING' }; this.state.pendingTransfers[key] = request; this.setReplica({ version: 1, deviceId: target.deviceId, objectId: input.objectId, objectType: input.objectType, objectVersion: request.objectVersion, stateHash, metadataOnly, status: 'PENDING', updatedAt: nowIso(this.now) }); result.push(clone(request)); } this.trimState(); await this.persist(); return result;
  }

  async transferToDevice(input: Omit<Parameters<PersonalDeviceMesh['replicate']>[0], 'policy'> & { targetDeviceId: NodeId; priority?: DeviceTransferPriority; metadataOnly?: boolean }): Promise<DeviceTransferRequest> {
    const policy: DevicePlacementPolicy = { intent: 'SELECTED_DEVICES', selectedDeviceIds: [input.targetDeviceId], includeContent: !input.metadataOnly }; const values = await this.replicate({ ...input, policy, priority: input.priority ?? 'USER_INTERACTIVE' }); const result = values[0]; if (!result) throw new DeviceMeshError('UNAVAILABLE', 'Target device is not eligible for transfer'); return result;
  }

  async flush(targetDeviceId?: NodeId): Promise<{ attempted: number; confirmed: number; pending: number }> {
    await this.ready();
    if (!this.transport || this.closed) return { attempted: 0, confirmed: 0, pending: Object.keys(this.state.pendingTransfers).length };
    const now = this.now();
    const values = Object.values(this.state.pendingTransfers)
      .filter(value => (!targetDeviceId || value.targetDeviceId === targetDeviceId) && value.nextAttemptAt <= now && !this.isRevoked(value.targetDeviceId))
      .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || a.createdAt.localeCompare(b.createdAt))
      .slice(0, 64);
    let attempted = 0;
    let confirmed = 0;
    for (const value of values) {
      attempted += 1;
      const key = transferKey(value.targetDeviceId, value.objectId);
      const current = this.state.pendingTransfers[key];
      if (!current) continue;
      this.state.pendingTransfers[key] = { ...current, status: 'TRANSFERRING', attempts: current.attempts + 1, nextAttemptAt: now + retryDelay(current.attempts + 1) };
      this.setReplica({ version: 1, deviceId: current.targetDeviceId, objectId: current.objectId, objectType: current.objectType, objectVersion: current.objectVersion, stateHash: current.stateHash, metadataOnly: current.metadataOnly, status: 'TRANSFERRING', updatedAt: nowIso(this.now) });
      try {
        await this.sendWire(current.targetDeviceId, 'device_mesh_sync', { request: current, trustEpoch: this.state.trustEpoch });
      } catch {
        const failed = this.state.pendingTransfers[key];
        if (failed) this.state.pendingTransfers[key] = { ...failed, status: 'WAITING_FOR_ROUTE', nextAttemptAt: this.now() + retryDelay(failed.attempts) };
        this.setReplica({ version: 1, deviceId: current.targetDeviceId, objectId: current.objectId, objectType: current.objectType, objectVersion: current.objectVersion, stateHash: current.stateHash, metadataOnly: current.metadataOnly, status: 'PENDING', updatedAt: nowIso(this.now) });
        continue;
      }
      this.setReplica({ version: 1, deviceId: current.targetDeviceId, objectId: current.objectId, objectType: current.objectType, objectVersion: current.objectVersion, stateHash: current.stateHash, metadataOnly: current.metadataOnly, status: 'TRANSFERRING', updatedAt: nowIso(this.now) });
    }
    await this.retryRevocations(targetDeviceId);
    await this.persist();
    return { attempted, confirmed, pending: Object.keys(this.state.pendingTransfers).length };
  }

  async pendingTransfers(targetDeviceId?: NodeId): Promise<readonly DeviceTransferRequest[]> { await this.ready(); return Object.values(this.state.pendingTransfers).filter(value => !targetDeviceId || value.targetDeviceId === targetDeviceId).map(clone); }
  async replica(deviceId: NodeId, objectId: string): Promise<DeviceReplicaState | undefined> { await this.ready(); const value = this.state.replicas[replicaKey(deviceId, objectId)]; return value ? clone(value) : undefined; }
  async cursor(deviceId: NodeId): Promise<DeviceSyncCursor | undefined> { await this.ready(); const value = this.state.cursors[deviceId]; return value ? clone(value) : undefined; }
  async stateSnapshot(): Promise<DeviceMeshState> { await this.ready(); return clone(this.state); }
  async status(): Promise<DeviceMeshStatusSnapshot> { await this.ready(); const devices = this.registry.list().map(device => { const presence = this.presenceFor(device.deviceId); const pending = Object.values(this.state.pendingTransfers).filter(value => value.targetDeviceId === device.deviceId).length; const replicas = Object.values(this.state.replicas).filter(value => value.deviceId === device.deviceId && value.status === 'CONFIRMED').length; return { ...device, presence, pending, replicas }; }); const status: DeviceMeshStatus = this.isRevoked(this.local.nodeId) ? 'REVOKED' : devices.some(value => value.pending > 0 && value.presence === 'OFFLINE') ? 'WAITING_FOR_ROUTE' : devices.some(value => value.pending > 0) ? 'SYNCHRONIZING' : devices.length <= 1 || devices.every(value => value.replicas >= 0) ? 'UP_TO_DATE' : 'AVAILABLE'; return { localDeviceId: this.local.nodeId, ownerIdentityId: this.ownerIdentityId, status, devices, pendingTransfers: Object.keys(this.state.pendingTransfers).length, confirmedReplicas: Object.values(this.state.replicas).filter(value => value.status === 'CONFIRMED').length, trustEpoch: this.state.trustEpoch }; }

  close(): void { this.closed = true; this.unsubscribe?.(); this.unsubscribe = undefined; }

  private async receiveEnvelope(envelope: Envelope): Promise<void> {
    if (this.closed || envelope.recipient !== this.local.nodeId || ![SYNC_ENVELOPE, REVOCATION_ENVELOPE, ACK_ENVELOPE].includes(envelope.type)) return;
    const body = envelope.body as Record<string, unknown> | undefined;
    if (!body || body.version !== DEVICE_MESH_PROTOCOL_VERSION || typeof body.kind !== 'string') return;
    if (this.security) {
      if (!(await this.security.verify(envelope))) return;
    } else {
      const record = this.registry.get(envelope.sender);
      const publicKey = envelope.sender === this.authorityDeviceId ? this.authorityPublicKey : record?.publicKey;
      if (!publicKey) return;
      const { signature, ...unsigned } = envelope;
      if (!(await this.verify(unsigned, signature, publicKey))) return;
    }
    if (body.kind === 'device_mesh_sync') { await this.receiveSync(envelope.sender, body); return; }
    if (body.kind === 'device_mesh_revocation') { await this.acceptRevocation(body.event); return; }
    if (body.kind === 'device_mesh_revocation_ack') { await this.receiveRevocationAck(envelope.sender, body); return; }
    if (body.kind === 'device_mesh_ack') await this.receiveAck(envelope.sender, body);
  }

  private async receiveSync(sender: NodeId, body: Record<string, unknown>): Promise<void> {
    const request = parseTransfer(body.request); const senderIsAuthority = sender === this.authorityDeviceId;
    if (!request || request.targetDeviceId !== this.local.nodeId || (!senderIsAuthority && !this.isTrustedDevice(sender))) return;
    if (this.state.seen[request.id]) {
      const known = this.state.replicas[replicaKey(this.local.nodeId, request.objectId)];
      if (known?.stateHash === request.stateHash) await this.sendAck(sender, request, known.stateHash, true).catch(() => undefined);
      return;
    }
    const active = this.syncInFlight.get(request.id);
    if (active) { await active.catch(() => undefined); return; }
    const operation = this.applySync(sender, body, request, senderIsAuthority);
    this.syncInFlight.set(request.id, operation);
    try { await operation; } finally { this.syncInFlight.delete(request.id); }
  }

  private async applySync(sender: NodeId, body: Record<string, unknown>, request: DeviceTransferRequest, senderIsAuthority: boolean): Promise<void> {
    const trustEpoch = body.trustEpoch;
    if (!boundedInt(trustEpoch, 0, Number.MAX_SAFE_INTEGER) || trustEpoch < this.state.trustEpoch || this.isRevoked(sender)) return;
    const source = senderIsAuthority ? undefined : this.registry.get(sender); if (!senderIsAuthority && (!source || source.ownerIdentityId !== this.ownerIdentityId)) return;
    if (request.sizeBytes > this.limits.maxPayloadBytes || safeJsonSize(request.payload) > this.limits.maxPayloadBytes || hasSecretField(request.payload)) return;
    if (request.payload !== undefined && request.stateHash !== await this.crypto.hash(canonicalJson(request.payload))) return;
    this.state.seen[request.id] = true; this.trimSeenAndPending();
    const known = this.state.replicas[replicaKey(this.local.nodeId, request.objectId)]; if (known && compareVersion(request.objectVersion, known.objectVersion) < 0) { await this.sendAck(sender, request, known.stateHash, false); return; }
    const replica: DeviceReplicaState = { version: 1, deviceId: this.local.nodeId, objectId: request.objectId, objectType: request.objectType, objectVersion: request.objectVersion, stateHash: request.stateHash, metadataOnly: request.metadataOnly, status: 'CONFIRMED', updatedAt: nowIso(this.now), confirmedAt: nowIso(this.now) }; this.setReplica(replica); this.state.cursors[this.local.nodeId] = { version: 1, deviceId: this.local.nodeId, cursor: request.objectVersion, stateHash: request.stateHash, updatedAt: nowIso(this.now) }; this.trimState(); await this.persist(); await this.onReplica?.(replica, clone(request.payload)); await this.sendAck(sender, request, request.stateHash, true);
  }

  private async receiveAck(sender: NodeId, body: Record<string, unknown>): Promise<void> { const ack = parseAck(body.ack); if (!ack || ack.targetDeviceId !== this.local.nodeId || ack.senderDeviceId !== sender || !this.isTrustedDevice(sender)) return; const key = transferKey(sender, ack.objectId); const pending = this.state.pendingTransfers[key]; if (!pending || pending.stateHash !== ack.stateHash || compareVersion(ack.objectVersion, pending.objectVersion) < 0) return; this.state.seen[ack.id] = true; if (ack.accepted) { delete this.state.pendingTransfers[key]; this.setReplica({ version: 1, deviceId: sender, objectId: ack.objectId, objectType: pending.objectType, objectVersion: ack.objectVersion, stateHash: ack.stateHash, metadataOnly: pending.metadataOnly, status: 'CONFIRMED', updatedAt: nowIso(this.now), confirmedAt: nowIso(this.now) }); } else this.state.pendingTransfers[key] = { ...pending, status: 'WAITING_FOR_ROUTE', nextAttemptAt: this.now() + retryDelay(pending.attempts) }; await this.persist(); }
  private async sendAck(peer: NodeId, request: DeviceTransferRequest, stateHash: string, accepted: boolean): Promise<void> { if (!this.transport) return; await this.sendWire(peer, 'device_mesh_ack', { ack: { version: 1 as const, id: crypto.randomUUID(), senderDeviceId: this.local.nodeId, targetDeviceId: peer, objectId: request.objectId, objectVersion: request.objectVersion, stateHash, accepted } }); }
  private async receiveRevocationAck(sender: NodeId, body: Record<string, unknown>): Promise<void> { const eventId = body.eventId; if (typeof eventId !== 'string' || !this.isTrustedDevice(sender)) return; const pending = this.state.pendingEnrollments[eventId]; if (pending) { delete this.state.pendingEnrollments[eventId]; await this.persist(); } }
  private async broadcastRevocation(event: DeviceMeshRevocationEvent): Promise<void> { if (!this.transport) return; for (const device of this.registry.list()) if (device.deviceId !== this.local.nodeId && (device.deviceId === event.deviceId || device.state === 'TRUSTED')) { try { await this.sendWire(device.deviceId, 'device_mesh_revocation', { event }); } catch { /* bounded retry occurs when host asks flush */ } } }
  private async retryRevocations(targetDeviceId?: NodeId): Promise<void> { if (!this.transport || this.local.nodeId !== this.authorityDeviceId) return; for (const event of Object.values(this.state.revocations).slice(-32)) { if (targetDeviceId && event.deviceId !== targetDeviceId) continue; try { await this.sendWire(event.deviceId, 'device_mesh_revocation', { event }); } catch { /* the durable event is retried by the next flush */ } } }
  private async sendWire(peer: NodeId, kind: 'device_mesh_sync' | 'device_mesh_revocation' | 'device_mesh_ack' | 'device_mesh_revocation_ack', value: unknown): Promise<void> { if (!this.transport) throw new DeviceMeshError('UNAVAILABLE', 'No delivery interface is configured'); const extra: Record<string, unknown> = kind === 'device_mesh_sync' ? { request: (value as { request: DeviceTransferRequest }).request, trustEpoch: (value as { trustEpoch: number }).trustEpoch } : kind === 'device_mesh_revocation' ? { event: (value as { event: DeviceMeshRevocationEvent }).event } : kind === 'device_mesh_ack' ? { ack: (value as { ack: unknown }).ack } : (value && typeof value === 'object' ? value as Record<string, unknown> : {}); const unsigned: UnsignedEnvelope = { version: 1, type: kind === 'device_mesh_sync' ? SYNC_ENVELOPE : kind === 'device_mesh_revocation' ? REVOCATION_ENVELOPE : ACK_ENVELOPE, id: crypto.randomUUID(), sender: this.local.nodeId, recipient: peer, nonce: await this.crypto.randomNonce(), expiresAt: new Date(this.now() + DEVICE_MESH_SYNC_TTL_MS).toISOString(), body: { version: DEVICE_MESH_PROTOCOL_VERSION, kind, ...extra } }; const signed: Envelope = { ...unsigned, signature: this.security ? await this.security.sign(unsigned) : await this.sign(unsigned) }; await this.transport.send(peer, signed); }
  private async sign(value: unknown): Promise<string> { return this.signer ? this.signer.sign(value) : this.crypto.sign(canonicalJson(value), this.local.privateKey); }
  private async verify(value: unknown, signature: string, publicKey: string): Promise<boolean> { return this.signer ? this.signer.verify(value, signature, publicKey) : this.crypto.verify(canonicalJson(value), signature, publicKey); }
  private async verifyRequest(value: DeviceEnrollmentRequest): Promise<boolean> { const { signature, ...unsigned } = value; return this.verify(unsigned, signature, value.publicKey); }
  private async verifyAuthority(value: DeviceEnrollmentAuthorization | DeviceMeshRevocationEvent): Promise<boolean> { const { signature, ...unsigned } = value; return this.verify(unsigned, signature, this.authorityPublicKey); }
  private assertAuthority(confirmation?: OwnerConfirmation): void { if (this.local.nodeId !== this.authorityDeviceId || !confirmation?.confirmed || !confirmation.doubleConfirmed) throw new DeviceMeshError('UNAUTHORIZED', 'Fresh explicit owner double confirmation is required'); }
  private assertObjectInput(input: { objectId: string; objectType: string; objectVersion?: string }): void { if (!validString(input.objectId, MAX_OBJECT_ID) || !validString(input.objectType, MAX_OBJECT_TYPE) || (input.objectVersion !== undefined && !validString(input.objectVersion, MAX_CURSOR))) throw new DeviceMeshError('INVALID', 'Replica object identity/version is invalid'); }
  private upsertTrust(value: DeviceTrustRecord): void { this.registry.register(value); this.state.devices[value.deviceId] = clone(value); }
  private setReplica(value: DeviceReplicaState): void { const key = replicaKey(value.deviceId, value.objectId); if (!this.state.replicas[key] && Object.keys(this.state.replicas).length >= this.limits.maxReplicas) throw new DeviceMeshError('RESOURCE_LIMIT', 'Replica metadata bound exceeded'); const current = this.state.replicas[key]; if (current && compareVersion(value.objectVersion, current.objectVersion) < 0) return; this.state.replicas[key] = clone(value); }
  private dropPendingFor(deviceId: NodeId): void { for (const key of Object.keys(this.state.pendingTransfers)) if (this.state.pendingTransfers[key]?.targetDeviceId === deviceId) delete this.state.pendingTransfers[key]; }
  private presenceFor(deviceId: NodeId): DevicePresenceState { const value = this.state.presence[deviceId]; if (!value || Date.parse(value.expiresAt) <= this.now()) return deviceId === this.local.nodeId ? 'AVAILABLE' : 'UNKNOWN'; return value.state; }
  private emptyState(): MutableDeviceMeshState { const devices: Record<NodeId, DeviceTrustRecord> = {}; if (this.local.nodeId === this.authorityDeviceId) { const timestamp = nowIso(this.now); devices[this.local.nodeId] = { version: 1, deviceId: this.local.nodeId, ownerIdentityId: this.ownerIdentityId, publicKey: this.local.publicKey, encryptionPublicKey: this.local.encryptionPublicKey, label: 'Current device', platform: 'unknown', capabilities: { roles: ['USER_INTERFACE'] }, enrolledAt: timestamp, lastSeenAt: timestamp, trustEpoch: 0, state: 'TRUSTED' }; } return { version: DEVICE_MESH_SCHEMA_VERSION, ownerIdentityId: this.ownerIdentityId, trustEpoch: 0, devices, pendingEnrollments: {}, revocations: {}, pendingTransfers: {}, replicas: {}, cursors: {}, presence: {}, seen: {} }; }
  private async hydrate(): Promise<void> { const value = await this.storage.read(); if (value === undefined) { this.state = this.emptyState(); this.rebuildRegistry(); await this.persist(); return; } if (!isState(value) || value.ownerIdentityId !== this.ownerIdentityId) throw new DeviceMeshError('INVALID', 'Unsupported or foreign Personal Device Mesh state'); this.state = normalizeState(value, this.limits); this.rebuildRegistry(); }
  private rebuildRegistry(): void { this.registry.clear(); for (const value of Object.values(this.state.devices)) this.registry.register(value); for (const event of Object.values(this.state.revocations)) { this.registry.revoke(event.deviceId, event.trustEpoch); const revoked = this.registry.get(event.deviceId); if (revoked) this.state.devices[event.deviceId] = revoked; } }
  private trimSeenAndPending(): void { const pending = Object.values(this.state.pendingEnrollments).sort((a, b) => a.requestedAt.localeCompare(b.requestedAt)); for (const value of pending.slice(0, Math.max(0, pending.length - 256))) delete this.state.pendingEnrollments[value.id]; const seen = Object.keys(this.state.seen); if (seen.length > MAX_SEEN) for (const key of seen.slice(0, seen.length - MAX_SEEN)) delete this.state.seen[key]; }
  private trimState(): void { this.trimSeenAndPending(); const pending = Object.values(this.state.pendingTransfers).sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || a.createdAt.localeCompare(b.createdAt)); if (pending.length > this.limits.maxPending) for (const value of pending.slice(this.limits.maxPending)) delete this.state.pendingTransfers[transferKey(value.targetDeviceId, value.objectId)]; }
  private async persist(): Promise<void> { const snapshot = clone(this.state); const operation = this.writes.then(() => this.storage.write(snapshot)); this.writes = operation.catch(() => undefined); await operation; }
}

/** Small façade used by application schedulers; it never selects a provider. */
export class OwnedDeviceSyncCoordinator {
  constructor(private readonly mesh: PersonalDeviceMesh) {}
  enqueue(input: Parameters<PersonalDeviceMesh['replicate']>[0]): Promise<readonly DeviceTransferRequest[]> { return this.mesh.replicate(input); }
  transfer(input: Parameters<PersonalDeviceMesh['transferToDevice']>[0]): Promise<DeviceTransferRequest> { return this.mesh.transferToDevice(input); }
  flush(deviceId?: NodeId): Promise<{ attempted: number; confirmed: number; pending: number }> { return this.mesh.flush(deviceId); }
  status(): Promise<DeviceMeshStatusSnapshot> { return this.mesh.status(); }
}

function priorityRank(priority: DeviceTransferPriority): number { return priority === 'SECURITY' ? 0 : priority === 'USER_INTERACTIVE' ? 1 : priority === 'NORMAL' ? 2 : priority === 'BACKGROUND' ? 3 : 4; }
function retryDelay(attempts: number): number { return Math.min(60_000, 1_000 * 2 ** Math.max(0, Math.min(6, attempts - 1))); }
function compareVersion(left: string, right: string): number { const a = left.split(/[.:-]/).map(value => Number(value)).every(Number.isFinite) ? left.split(/[.:-]/).map(value => Number(value)) : undefined; const b = right.split(/[.:-]/).map(value => Number(value)).every(Number.isFinite) ? right.split(/[.:-]/).map(value => Number(value)) : undefined; if (a && b) { for (let index = 0; index < Math.max(a.length, b.length); index++) { const difference = (a[index] ?? 0) - (b[index] ?? 0); if (difference) return difference; } return 0; } return left === right ? 0 : left > right ? 1 : -1; }
function parseAuthorization(value: unknown): DeviceEnrollmentAuthorization | undefined { if (!value || typeof value !== 'object') return undefined; const item = value as Partial<DeviceEnrollmentAuthorization>; return item.version === 1 && item.kind === 'device_enrollment_authorization' && validString(item.id, 256) && validString(item.ownerIdentityId, 256) && validString(item.deviceId, 256) && validString(item.publicKey, 512) && validString(item.encryptionPublicKey, 512) && validString(item.issuedBy, 256) && boundedInt(item.trustEpoch, 0, Number.MAX_SAFE_INTEGER) && typeof item.issuedAt === 'string' && typeof item.expiresAt === 'string' && typeof item.nonce === 'string' && typeof item.signature === 'string' && safeJsonSize(item.capabilities) <= 8_192 ? item as DeviceEnrollmentAuthorization : undefined; }
function parseRevocation(value: unknown): DeviceMeshRevocationEvent | undefined { if (!value || typeof value !== 'object') return undefined; const item = value as Partial<DeviceMeshRevocationEvent>; return item.version === 1 && item.kind === 'device_mesh_revocation' && validString(item.id, 256) && validString(item.ownerIdentityId, 256) && validString(item.deviceId, 256) && validString(item.issuedBy, 256) && boundedInt(item.trustEpoch, 0, Number.MAX_SAFE_INTEGER) && typeof item.revokedAt === 'string' && validString(item.reason, 240) && typeof item.signature === 'string' ? item as DeviceMeshRevocationEvent : undefined; }
function parseTransfer(value: unknown): DeviceTransferRequest | undefined { if (!value || typeof value !== 'object') return undefined; const item = value as Partial<DeviceTransferRequest>; return item.version === 1 && validString(item.id, 256) && validString(item.objectId, MAX_OBJECT_ID) && validString(item.objectType, MAX_OBJECT_TYPE) && validString(item.objectVersion, MAX_CURSOR) && validString(item.stateHash, 512) && validString(item.targetDeviceId, 256) && ['LOCAL_ONLY', 'OWNED_DEVICES', 'SELECTED_DEVICES', 'HIGH_AVAILABILITY', 'METADATA_ONLY', 'ON_DEMAND'].includes(String(item.intent)) && ['SECURITY', 'USER_INTERACTIVE', 'NORMAL', 'BACKGROUND', 'OPTIONAL_BULK'].includes(String(item.priority)) && ['CONTROL', 'INTERACTIVE', 'REALTIME', 'EVENTUAL', 'BULK', 'BACKGROUND', 'BEST_EFFORT'].includes(String(item.profile)) && typeof item.metadataOnly === 'boolean' && boundedInt(item.sizeBytes, 0, 4 * 1024 * 1024) && typeof item.createdAt === 'string' && boundedInt(item.attempts, 0, 64) && boundedInt(item.nextAttemptAt, 0, Number.MAX_SAFE_INTEGER) && ['PENDING', 'TRANSFERRING', 'WAITING_FOR_ROUTE'].includes(String(item.status)) && safeJsonSize(item.payload) <= 4 * 1024 * 1024 ? item as DeviceTransferRequest : undefined; }
function parseAck(value: unknown): { version: 1; id: string; senderDeviceId: NodeId; targetDeviceId: NodeId; objectId: string; objectVersion: string; stateHash: string; accepted: boolean } | undefined { if (!value || typeof value !== 'object') return undefined; const item = value as Record<string, unknown>; return item.version === 1 && validString(item.id, 256) && validString(item.senderDeviceId, 256) && validString(item.targetDeviceId, 256) && validString(item.objectId, MAX_OBJECT_ID) && validString(item.objectVersion, MAX_CURSOR) && validString(item.stateHash, 512) && typeof item.accepted === 'boolean' ? item as never : undefined; }
function isState(value: unknown): value is DeviceMeshState { if (!value || typeof value !== 'object') return false; const item = value as Partial<DeviceMeshState>; return item.version === DEVICE_MESH_SCHEMA_VERSION && validString(item.ownerIdentityId, 256) && boundedInt(item.trustEpoch, 0, Number.MAX_SAFE_INTEGER) && item.devices !== undefined && typeof item.devices === 'object' && item.pendingEnrollments !== undefined && typeof item.pendingEnrollments === 'object' && item.pendingTransfers !== undefined && typeof item.pendingTransfers === 'object' && item.replicas !== undefined && typeof item.replicas === 'object' && item.cursors !== undefined && typeof item.cursors === 'object' && item.presence !== undefined && typeof item.presence === 'object' && item.seen !== undefined && typeof item.seen === 'object'; }
function normalizeState(value: DeviceMeshState, limits: { readonly maxPending: number; readonly maxReplicas: number; readonly maxPayloadBytes: number }): MutableDeviceMeshState { const devices: Record<NodeId, DeviceTrustRecord> = {}; for (const [id, record] of Object.entries(value.devices).slice(0, 32)) if (id === record.deviceId && validateTrustRecord(record)) devices[id] = clone(record); const pendingEnrollments: Record<string, DeviceEnrollmentRequest> = {}; for (const request of Object.values(value.pendingEnrollments).slice(0, 256)) if (request && request.version === 1 && request.kind === 'device_enrollment_request' && validString(request.id, 256) && validString(request.ownerIdentityId, 256) && validString(request.deviceId, 256) && validString(request.publicKey, 512) && validString(request.encryptionPublicKey, 512) && validString(request.label, MAX_LABEL) && validString(request.platform, MAX_PLATFORM) && validString(request.nonce, 256) && validString(request.signature, 1024) && typeof request.requestedAt === 'string' && typeof request.expiresAt === 'string' && safeJsonSize(request.capabilities) <= 8_192) pendingEnrollments[request.id] = clone(request); const revocations: Record<NodeId, DeviceMeshRevocationEvent> = {}; for (const event of Object.values(value.revocations).slice(0, 32)) { const parsed = parseRevocation(event); if (parsed) revocations[parsed.deviceId] = clone(parsed); } const pendingTransfers: Record<string, DeviceTransferRequest> = {}; for (const request of Object.values(value.pendingTransfers).slice(0, limits.maxPending)) { const parsed = parseTransfer(request); if (parsed) pendingTransfers[transferKey(parsed.targetDeviceId, parsed.objectId)] = clone(parsed); } const replicas: Record<string, DeviceReplicaState> = {}; for (const replica of Object.values(value.replicas).slice(0, limits.maxReplicas)) if (replica && replica.version === 1 && validString(replica.deviceId, 256) && validString(replica.objectId, MAX_OBJECT_ID) && validString(replica.objectType, MAX_OBJECT_TYPE) && validString(replica.objectVersion, MAX_CURSOR) && validString(replica.stateHash, 512) && typeof replica.metadataOnly === 'boolean' && ['PENDING', 'TRANSFERRING', 'CONFIRMED', 'STALE', 'REJECTED'].includes(replica.status)) replicas[replicaKey(replica.deviceId, replica.objectId)] = clone(replica); const cursors: Record<NodeId, DeviceSyncCursor> = {}; for (const cursor of Object.values(value.cursors).slice(0, 32)) if (cursor && cursor.version === 1 && validString(cursor.deviceId, 256) && validString(cursor.cursor, MAX_CURSOR) && validString(cursor.updatedAt, 128) && (cursor.stateHash === undefined || validString(cursor.stateHash, 512))) cursors[cursor.deviceId] = clone(cursor); const presence: Record<NodeId, DevicePresenceObservation> = {}; for (const observation of Object.values(value.presence).slice(0, 32)) if (observation && observation.version === 1 && validString(observation.deviceId, 256) && ['AVAILABLE', 'RECENTLY_SEEN', 'OFFLINE', 'DELIVERY_PENDING', 'UNKNOWN'].includes(observation.state) && ['LOCAL', 'AUTHENTICATED_DEVICE', 'FABRIC_OBSERVATION'].includes(observation.source) && typeof observation.observedAt === 'string' && typeof observation.expiresAt === 'string') presence[observation.deviceId] = clone(observation); return { version: 1, ownerIdentityId: value.ownerIdentityId, trustEpoch: value.trustEpoch, devices, pendingEnrollments, revocations, pendingTransfers, replicas, cursors, presence, seen: Object.fromEntries(Object.keys(value.seen).slice(-MAX_SEEN).map(key => [key, true])) }; }
