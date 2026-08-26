/**
 * R0P70 bounded delay-tolerant store-and-forward.
 *
 * This module is a provider below ConnectivityFabric.  A parcel is an
 * authenticated, destination-sealed copy of an already protected Fabric
 * envelope.  Couriers see only random identifiers, a rendezvous digest,
 * coarse resource metadata and ciphertext.  They never receive a social
 * identity, application authority or a decryption key.
 */

import {
  ConnectivityError,
  ConnectivityResourceGovernor,
  type DeliveryProfile,
  type DeliveryRequest,
  type DeliveryRequirement,
  type DeliveryResult,
  type OpaqueDeliveryEnvelope,
  type OpaqueFrame,
  type TransportAvailability,
  type TransportCapability,
  type TransportEndpoint,
  type TransportHealth,
  type TransportMetrics,
  type TransportProvider,
  type TransportProviderId,
  type TransportSecurityBoundary,
  type TransportSession,
} from './connectivity.js';
import { canonicalJson, SodiumCryptoProvider, type CryptoProvider } from './crypto.js';
import { createOpaqueDeliveryEnvelope, decodeOpaqueBytes, fragmentOpaqueEnvelope, OpaqueFragmentReassembler } from './connectivity.js';
import type { AnonymousNeighborSessionSource } from './mesh-routing.js';

const VERSION = 1 as const;
const FRAME_PREFIX = 'dtn:';
const MAX_DIGEST = 96;
const MAX_WIRE_BYTES = 384 * 1024;
const MAX_INNER_BYTES = 512 * 1024;
const MAX_LIFETIME_MS = 7 * 24 * 60 * 60_000;
const TOMBSTONE_LIFETIME_MS = 24 * 60 * 60_000;
const ENCOUNTER_IDLE_MS = 15_000;

export type DelayTolerantParcelState = 'STORED' | 'OFFERED' | 'TRANSFERRING' | 'FORWARDED_COPY' | 'DESTINATION_CONFIRMED' | 'EXPIRED' | 'REJECTED';
export type DelayTolerantParcelRole = 'OWNER_OUTBOX' | 'COURIER_STORE' | 'RECEIPT_OUTBOX';
export type DelayTolerantResourceClass = 'SMALL' | 'BACKGROUND' | 'BULK';
export type DelayTolerantResourceProfile = 'BALANCED' | 'BATTERY_SAVER' | 'HIGH_AVAILABILITY';

/** Stable, opaque parcel wire format.  Fields are intentionally free of
 * sender/recipient identities, application object names and path history. */
export interface DelayTolerantParcel {
  readonly version: typeof VERSION;
  readonly id: string;
  readonly destinationDigest: string;
  readonly acknowledgementDigest: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly hopBudget: number;
  /** R0P70 uses single-copy custody.  The budget is immutable and cannot be
   * increased by a courier; transfer moves the one valid copy. */
  readonly copyBudget: 1;
  /** Explicit alias used by diagnostics; single-copy custody never increases
   * this value and a transfer consumes the only physical copy. */
  readonly remainingCopyBudget: 1;
  readonly resourceClass: DelayTolerantResourceClass;
  readonly payloadKind: 'DELIVERY' | 'RECEIPT';
  readonly ciphertext: string;
  readonly ciphertextIntegrity: string;
  readonly manifestPublicKey: string;
  readonly manifestSignature: string;
  readonly requirement: Pick<DeliveryRequirement, 'profile' | 'allowMetered' | 'allowHighEnergy'>;
}

export interface StoredDelayTolerantParcel {
  readonly parcel: DelayTolerantParcel;
  readonly role: DelayTolerantParcelRole;
  readonly state: DelayTolerantParcelState;
  readonly acceptedAt: string;
  readonly forwardedAt?: string;
  readonly attempts: number;
}

export interface DelayTolerantStoreLimits {
  readonly maxBytes?: number;
  readonly maxParcels?: number;
  readonly maxParcelBytes?: number;
  readonly maxPerResourceClassBytes?: number;
  readonly maxTombstones?: number;
  readonly maxTombstoneAgeMs?: number;
}

export interface DelayTolerantStoreStats {
  readonly parcels: number;
  readonly bytes: number;
  readonly ownerParcels: number;
  readonly courierParcels: number;
  readonly receiptParcels: number;
  readonly tombstones: number;
  readonly rejected: number;
  readonly expired: number;
}

export interface DelayTolerantStateStore {
  read(): Promise<unknown | undefined>;
  write(value: unknown): Promise<void>;
}

interface PersistedState {
  version: 1;
  parcels: Record<string, StoredDelayTolerantParcel>;
  tombstones: Record<string, number>;
  /** Local handoff markers.  These must never be advertised as destination
   * tombstones: a forwarded parcel can still be validly held by its next
   * courier. */
  forwarded?: Record<string, number>;
  localSecrets?: Record<string, string>;
  confirmed?: Record<string, number>;
}

const EMPTY_STATE = (): PersistedState => ({ version: 1, parcels: {}, tombstones: {}, forwarded: {}, localSecrets: {}, confirmed: {} });
const copy = <T>(value: T): T => structuredClone(value);
const iso = (at: number): string => new Date(at).toISOString();
const bytesLength = (value: string): number => {
  if (typeof Buffer !== 'undefined') return Buffer.byteLength(value, 'utf8');
  return new TextEncoder().encode(value).byteLength;
};

function boundedInt(value: number | undefined, min: number, max: number, fallback: number): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < min || resolved > max) throw new ConnectivityError('POLICY_DENIED', 'Delay-tolerant resource limit is invalid');
  return resolved;
}

function b64(value: Uint8Array): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(value).toString('base64url');
  let binary = ''; for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new ConnectivityError('POLICY_DENIED', 'Delay-tolerant ciphertext encoding is invalid');
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(value, 'base64url'));
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')), char => char.charCodeAt(0));
}
function randomToken(): string { const bytes = new Uint8Array(24); crypto.getRandomValues(bytes); return b64(bytes); }
async function digest(value: string): Promise<string> { const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value) as unknown as ArrayBuffer)); return b64(bytes); }
async function digestBytes(value: Uint8Array): Promise<string> { const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', value as unknown as ArrayBuffer)); return b64(bytes); }
async function keyFor(secret: string): Promise<CryptoKey> {
  const digestValue = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`keystone-r0p70-payload:${secret}`) as unknown as ArrayBuffer));
  return crypto.subtle.importKey('raw', digestValue, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}
async function seal(secret: string, value: unknown): Promise<string> {
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  if (plaintext.byteLength > MAX_INNER_BYTES) throw new ConnectivityError('RESOURCE_LIMIT', 'Delay-tolerant inner payload exceeds bound');
  const nonce = new Uint8Array(12); crypto.getRandomValues(nonce);
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, await keyFor(secret), plaintext as unknown as ArrayBuffer));
  const result = new Uint8Array(nonce.byteLength + encrypted.byteLength); result.set(nonce); result.set(encrypted, nonce.byteLength); return b64(result);
}
async function openSeal(secret: string, value: string): Promise<unknown> {
  const bytes = unb64(value); if (bytes.byteLength < 28 || bytes.byteLength > MAX_WIRE_BYTES) throw new ConnectivityError('RESOURCE_LIMIT', 'Delay-tolerant sealed payload is invalid');
  const plaintext = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, await keyFor(secret), bytes.slice(12).buffer as ArrayBuffer));
  if (plaintext.byteLength > MAX_INNER_BYTES) throw new ConnectivityError('RESOURCE_LIMIT', 'Delay-tolerant decrypted payload exceeds bound');
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext)); } catch { throw new ConnectivityError('SESSION_FAILED', 'Delay-tolerant sealed payload is malformed'); }
}

function validDigest(value: unknown): value is string { return typeof value === 'string' && value.length >= 16 && value.length <= MAX_DIGEST && /^[A-Za-z0-9_-]+$/.test(value); }
function validId(value: unknown): value is string { return typeof value === 'string' && value.length >= 8 && value.length <= 160 && /^[A-Za-z0-9:_-]+$/.test(value); }
function resourceClass(requirement: DeliveryRequirement): DelayTolerantResourceClass {
  if (requirement.profile === 'BULK') return 'BULK';
  if (requirement.profile === 'BACKGROUND') return 'BACKGROUND';
  return 'SMALL';
}
function validProfile(value: unknown): value is DelayTolerantResourceClass { return value === 'SMALL' || value === 'BACKGROUND' || value === 'BULK'; }

/** Validates all untrusted restored/wire state before it reaches the store. */
export function validateDelayTolerantParcel(value: unknown, now = Date.now(), limits: DelayTolerantStoreLimits = {}): asserts value is DelayTolerantParcel {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ConnectivityError('POLICY_DENIED', 'Delay-tolerant parcel is malformed');
  const item = value as Record<string, unknown>;
  if (item.version !== VERSION || !validId(item.id) || !validDigest(item.destinationDigest) || !validDigest(item.acknowledgementDigest) || typeof item.createdAt !== 'string' || typeof item.expiresAt !== 'string' || typeof item.ciphertext !== 'string' || !item.ciphertext || typeof item.ciphertextIntegrity !== 'string' || typeof item.manifestPublicKey !== 'string' || typeof item.manifestSignature !== 'string' || !validProfile(item.resourceClass) || (item.payloadKind !== 'DELIVERY' && item.payloadKind !== 'RECEIPT') || item.copyBudget !== 1 || item.remainingCopyBudget !== 1 || !Number.isSafeInteger(item.hopBudget) || (item.hopBudget as number) < 0 || (item.hopBudget as number) > 64 || !item.requirement || typeof item.requirement !== 'object') throw new ConnectivityError('POLICY_DENIED', 'Delay-tolerant parcel fields are invalid');
  const created = Date.parse(item.createdAt); const expires = Date.parse(item.expiresAt); if (!Number.isFinite(created) || !Number.isFinite(expires) || expires <= created || expires <= now || expires - created > MAX_LIFETIME_MS) throw new ConnectivityError('TIMEOUT', 'Delay-tolerant parcel lifetime is invalid or expired');
  const maxParcel = limits.maxParcelBytes ?? 256 * 1024; if (bytesLength(item.ciphertext as string) > maxParcel) throw new ConnectivityError('RESOURCE_LIMIT', 'Delay-tolerant parcel exceeds size limit');
  if (!/^[A-Za-z0-9_-]+$/.test(item.ciphertext as string) || !/^sha256:[A-Za-z0-9_-]+$/.test(item.ciphertextIntegrity as string) || !/^[A-Za-z0-9_-]+$/.test(item.manifestPublicKey as string) || !/^[A-Za-z0-9_-]+$/.test(item.manifestSignature as string)) throw new ConnectivityError('POLICY_DENIED', 'Delay-tolerant parcel encoding is invalid');
  const requirement = item.requirement as Record<string, unknown>; if (typeof requirement.profile !== 'string' || !['CONTROL', 'INTERACTIVE', 'EVENTUAL', 'BACKGROUND', 'BULK', 'BEST_EFFORT'].includes(requirement.profile)) throw new ConnectivityError('POLICY_DENIED', 'Delay-tolerant parcel requirement is invalid');
}

function unsignedParcel(parcel: DelayTolerantParcel): Record<string, unknown> {
  const { manifestSignature: _signature, ...unsigned } = parcel; return unsigned;
}

/** Durable bounded courier store.  Its backend is host-provided and should be
 * encrypted at rest by the host; parcel confidentiality never depends on it. */
export class DurableOpaqueParcelStore {
  private state?: PersistedState;
  private loading?: Promise<void>;
  private writes: Promise<void> = Promise.resolve();
  private readonly limits: Required<DelayTolerantStoreLimits>;
  private rejectedCount = 0;
  private expiredCount = 0;
  constructor(private readonly backend: DelayTolerantStateStore, limits: DelayTolerantStoreLimits = {}) {
    this.limits = {
      maxBytes: boundedInt(limits.maxBytes, 4 * 1024, 512 * 1024 * 1024, 64 * 1024 * 1024),
      maxParcels: boundedInt(limits.maxParcels, 1, 100_000, 1_024),
      maxParcelBytes: boundedInt(limits.maxParcelBytes, 512, 4 * 1024 * 1024, 256 * 1024),
      maxPerResourceClassBytes: boundedInt(limits.maxPerResourceClassBytes, 512, 512 * 1024 * 1024, 32 * 1024 * 1024),
      maxTombstones: boundedInt(limits.maxTombstones, 16, 100_000, 2_048),
      maxTombstoneAgeMs: boundedInt(limits.maxTombstoneAgeMs, 1_000, MAX_LIFETIME_MS, TOMBSTONE_LIFETIME_MS),
    };
  }
  async ready(): Promise<void> { await this.load(); }
  limitsSnapshot(): Required<DelayTolerantStoreLimits> { return { ...this.limits }; }
  async get(id: string): Promise<StoredDelayTolerantParcel | undefined> { await this.load(); const value = this.state!.parcels[id]; return value ? copy(value) : undefined; }
  async rememberLocalSecret(digestValue: string, secret: string): Promise<void> { await this.load(); if (!validDigest(digestValue) || secret.length < 16 || secret.length > 512) throw new ConnectivityError('POLICY_DENIED', 'Delay-tolerant local rendezvous secret is invalid'); const secrets = this.state!.localSecrets ?? {}; secrets[digestValue] = secret; (this.state as PersistedState).localSecrets = secrets; await this.commit(); }
  async localSecrets(): Promise<readonly { readonly digest: string; readonly secret: string }[]> { await this.load(); return Object.entries(this.state!.localSecrets ?? {}).filter(([digestValue, secret]) => validDigest(digestValue) && typeof secret === 'string' && secret.length >= 16).map(([digestValue, secret]) => ({ digest: digestValue, secret })); }
  async listEligible(now = Date.now(), limit = 64): Promise<readonly StoredDelayTolerantParcel[]> { await this.load(); await this.sweep(now); return Object.values(this.state!.parcels).filter(value => Date.parse(value.parcel.expiresAt) > now && value.state !== 'DESTINATION_CONFIRMED' && value.state !== 'EXPIRED' && value.state !== 'REJECTED').sort((a, b) => a.acceptedAt.localeCompare(b.acceptedAt)).slice(0, Math.max(0, limit)).map(value => copy(value)); }
  async put(parcel: DelayTolerantParcel, role: DelayTolerantParcelRole, now = Date.now()): Promise<boolean> {
    await this.load(); validateDelayTolerantParcel(parcel, now, this.limits); if (this.state!.parcels[parcel.id] || this.state!.tombstones[parcel.id]) return false;
    const entry: StoredDelayTolerantParcel = { parcel: copy(parcel), role, state: 'STORED', acceptedAt: iso(now), attempts: 0 };
    const bytes = bytesLength(parcel.ciphertext); await this.sweep(now); this.evictFor(bytes, role, parcel.resourceClass);
    if (Object.keys(this.state!.parcels).length >= this.limits.maxParcels || this.totalBytes() + bytes > this.limits.maxBytes || this.classBytes(parcel.resourceClass) + bytes > this.limits.maxPerResourceClassBytes) { this.rejectedCount += 1; return false; }
    this.state!.parcels[parcel.id] = entry; await this.commit(); return true;
  }
  async markForwarded(id: string, now = Date.now()): Promise<boolean> { await this.load(); const entry = this.state!.parcels[id]; if (!entry) return false; delete this.state!.parcels[id]; this.addForwarded(id, now); await this.commit(); return true; }
  async markTransferAttempt(id: string): Promise<StoredDelayTolerantParcel | undefined> { await this.load(); const entry = this.state!.parcels[id]; if (!entry) return undefined; const updated: StoredDelayTolerantParcel = { ...entry, state: 'TRANSFERRING', attempts: Math.min(100, entry.attempts + 1) }; this.state!.parcels[id] = updated; await this.commit(); return copy(updated); }
  async markDestinationConfirmed(id: string, now = Date.now()): Promise<boolean> { await this.load(); const entry = this.state!.parcels[id]; if (entry) delete this.state!.parcels[id]; delete this.state!.forwarded?.[id]; (this.state!.confirmed ??= {})[id] = now; this.addTombstone(id, now); await this.commit(); return !!entry; }
  async wasDestinationConfirmed(id: string, now = Date.now()): Promise<boolean> { await this.load(); const at = this.state!.confirmed?.[id]; return at !== undefined && at + this.limits.maxTombstoneAgeMs > now; }
  async markRejected(id: string, now = Date.now()): Promise<void> { await this.load(); if (this.state!.parcels[id]) delete this.state!.parcels[id]; delete this.state!.forwarded?.[id]; this.addTombstone(id, now); await this.commit(); }
  async hasTombstone(id: string, now = Date.now()): Promise<boolean> { await this.load(); await this.sweep(now); return this.state!.tombstones[id] !== undefined || this.state!.forwarded?.[id] !== undefined; }
  async tombstones(now = Date.now(), limit = 128): Promise<readonly string[]> { await this.load(); await this.sweep(now); return Object.keys(this.state!.tombstones).slice(0, limit); }
  async sweep(now = Date.now()): Promise<void> {
    await this.load(); let changed = false;
    for (const [id, value] of Object.entries(this.state!.parcels)) if (Date.parse(value.parcel.expiresAt) <= now) { delete this.state!.parcels[id]; this.addTombstone(id, now); this.expiredCount += 1; changed = true; }
    for (const [id, at] of Object.entries(this.state!.tombstones)) if (at + this.limits.maxTombstoneAgeMs <= now) { delete this.state!.tombstones[id]; delete this.state!.confirmed?.[id]; changed = true; }
    for (const [id, at] of Object.entries(this.state!.forwarded ?? {})) if (at + this.limits.maxTombstoneAgeMs <= now) { delete this.state!.forwarded?.[id]; changed = true; }
    if (changed) await this.commit();
  }
  stats(): DelayTolerantStoreStats { if (!this.state) return { parcels: 0, bytes: 0, ownerParcels: 0, courierParcels: 0, receiptParcels: 0, tombstones: 0, rejected: this.rejectedCount, expired: this.expiredCount }; const values = Object.values(this.state.parcels); return { parcels: values.length, bytes: this.totalBytes(), ownerParcels: values.filter(v => v.role === 'OWNER_OUTBOX').length, courierParcels: values.filter(v => v.role === 'COURIER_STORE').length, receiptParcels: values.filter(v => v.role === 'RECEIPT_OUTBOX').length, tombstones: Object.keys(this.state.tombstones).length, rejected: this.rejectedCount, expired: this.expiredCount }; }
  private async load(): Promise<void> {
    if (this.state) return; this.loading ??= this.backend.read().then(value => { this.state = parseState(value, this.limits, () => { this.rejectedCount += 1; }); }).catch(() => { this.rejectedCount += 1; this.state = EMPTY_STATE(); }); await this.loading;
  }
  private async commit(): Promise<void> { const snapshot = copy(this.state!); const operation = this.writes.then(() => this.backend.write(snapshot)); this.writes = operation.catch(() => undefined); await operation; }
  private totalBytes(): number { return Object.values(this.state!.parcels).reduce((total, value) => total + bytesLength(value.parcel.ciphertext), 0); }
  private classBytes(resource: DelayTolerantResourceClass): number { return Object.values(this.state!.parcels).filter(value => value.parcel.resourceClass === resource).reduce((total, value) => total + bytesLength(value.parcel.ciphertext), 0); }
  private evictFor(bytes: number, role: DelayTolerantParcelRole, resource: DelayTolerantResourceClass): void {
    const needBytes = () => this.totalBytes() + bytes > this.limits.maxBytes || this.classBytes(resource) + bytes > this.limits.maxPerResourceClassBytes || Object.keys(this.state!.parcels).length >= this.limits.maxParcels;
    // Never evict owner/receipt data to make room for a stranger parcel.
    const candidates = Object.values(this.state!.parcels).filter(value => value.role === 'COURIER_STORE').sort((a, b) => a.acceptedAt.localeCompare(b.acceptedAt));
    while (needBytes() && candidates.length) { const victim = candidates.shift()!; delete this.state!.parcels[victim.parcel.id]; this.addTombstone(victim.parcel.id, Date.now()); }
    if (role !== 'COURIER_STORE' && needBytes()) {
      const own = Object.values(this.state!.parcels).filter(value => value.role !== 'COURIER_STORE').sort((a, b) => a.acceptedAt.localeCompare(b.acceptedAt));
      while (needBytes() && own.length) { const victim = own.shift()!; if (victim.role === 'OWNER_OUTBOX' || victim.role === 'RECEIPT_OUTBOX') break; delete this.state!.parcels[victim.parcel.id]; this.addTombstone(victim.parcel.id, Date.now()); }
    }
  }
  private addForwarded(id: string, at: number): void { delete this.state!.tombstones[id]; (this.state!.forwarded ??= {})[id] = at; const entries = Object.entries(this.state!.forwarded).sort((a, b) => a[1] - b[1]); while (entries.length > this.limits.maxTombstones) { const oldest = entries.shift(); if (oldest) delete this.state!.forwarded[oldest[0]]; } }
  private addTombstone(id: string, at: number): void { delete this.state!.forwarded?.[id]; this.state!.tombstones[id] = at; const entries = Object.entries(this.state!.tombstones).sort((a, b) => a[1] - b[1]); while (entries.length > this.limits.maxTombstones) { const oldest = entries.shift(); if (oldest) { delete this.state!.tombstones[oldest[0]]; delete this.state!.confirmed?.[oldest[0]]; } } }
}

function parseState(value: unknown, limits: Required<DelayTolerantStoreLimits>, reject: () => void): PersistedState {
  if (!value) return EMPTY_STATE(); if (!value || typeof value !== 'object' || (value as { version?: unknown }).version !== 1) { reject(); return EMPTY_STATE(); }
  const candidate = value as Partial<PersistedState>; const state = EMPTY_STATE();
  if (!candidate.parcels || typeof candidate.parcels !== 'object' || !candidate.tombstones || typeof candidate.tombstones !== 'object') { reject(); return state; }
  let parcelCount = 0;
  let parcelBytes = 0;
  const resourceBytes: Record<DelayTolerantResourceClass, number> = { SMALL: 0, BACKGROUND: 0, BULK: 0 };
  for (const [id, raw] of Object.entries(candidate.parcels as Record<string, unknown>)) {
    try {
      if (parcelCount >= limits.maxParcels) throw new Error('parcel-count');
      if (!raw || typeof raw !== 'object') throw new Error('record'); const entry = raw as Record<string, unknown>; validateDelayTolerantParcel(entry.parcel, Date.now(), limits); const parcel = entry.parcel as DelayTolerantParcel; const bytes = bytesLength(parcel.ciphertext); if (id !== parcel.id || parcelCount + 1 > limits.maxParcels || parcelBytes + bytes > limits.maxBytes || resourceBytes[parcel.resourceClass] + bytes > limits.maxPerResourceClassBytes) throw new Error('parcel-quota'); if (!['OWNER_OUTBOX', 'COURIER_STORE', 'RECEIPT_OUTBOX'].includes(String(entry.role)) || !['STORED', 'OFFERED', 'TRANSFERRING', 'FORWARDED_COPY', 'DESTINATION_CONFIRMED', 'EXPIRED', 'REJECTED'].includes(String(entry.state)) || typeof entry.acceptedAt !== 'string' || !Number.isSafeInteger(entry.attempts) || (entry.attempts as number) < 0 || (entry.attempts as number) > 100) throw new Error('record'); state.parcels[id] = copy(entry as unknown as StoredDelayTolerantParcel); parcelCount += 1; parcelBytes += bytes; resourceBytes[parcel.resourceClass] += bytes;
    } catch { reject(); }
  }
  let tombstoneCount = 0;
  for (const [id, at] of Object.entries(candidate.tombstones as Record<string, unknown>)) { if (tombstoneCount >= limits.maxTombstones) { reject(); break; } if (validId(id) && Number.isSafeInteger(at) && (at as number) >= 0) { state.tombstones[id] = at as number; tombstoneCount += 1; } else reject(); }
  let forwardedCount = 0;
  for (const [id, at] of Object.entries((candidate.forwarded ?? {}) as Record<string, unknown>)) { if (forwardedCount >= limits.maxTombstones) { reject(); break; } if (validId(id) && Number.isSafeInteger(at) && (at as number) >= 0) { (state.forwarded as Record<string, number>)[id] = at as number; forwardedCount += 1; } else reject(); }
  let secretCount = 0;
  for (const [digestValue, secret] of Object.entries((candidate.localSecrets ?? {}) as Record<string, unknown>)) { if (secretCount >= limits.maxTombstones) { reject(); break; } if (validDigest(digestValue) && typeof secret === 'string' && secret.length >= 16 && secret.length <= 512) { (state.localSecrets as Record<string, string>)[digestValue] = secret; secretCount += 1; } else reject(); }
  let confirmedCount = 0;
  for (const [id, at] of Object.entries((candidate.confirmed ?? {}) as Record<string, unknown>)) { if (confirmedCount >= limits.maxTombstones) { reject(); break; } if (validId(id) && Number.isSafeInteger(at) && (at as number) >= 0) { (state.confirmed as Record<string, number>)[id] = at as number; confirmedCount += 1; } else reject(); }
  return state;
}

export class InMemoryDelayTolerantStateStore implements DelayTolerantStateStore {
  private value?: unknown;
  async read(): Promise<unknown | undefined> { return this.value === undefined ? undefined : copy(this.value); }
  async write(value: unknown): Promise<void> { this.value = copy(value); }
}

/** Anonymous protected encounter boundary.  Implementations may wrap R0P68
 * sessions or a later local radio; no identity lookup is part of this API. */
export interface DelayTolerantEncounterSource {
  listEncounters(limit?: number): readonly { readonly handle: string; readonly expiresAt: string }[];
  openEncounter(handle: string): Promise<TransportSession>;
  sendEncounterFrame(session: TransportSession, frame: DelayTolerantWireFrame): Promise<void>;
  onEncounterFrame(handler: (frame: DelayTolerantWireFrame, session?: TransportSession) => void | Promise<void>): () => void;
  closeEncounter(session: TransportSession): Promise<void>;
  start?(): Promise<void>;
  stop?(): Promise<void>;
}

/** Adapt the protected R0P68/R0P69 anonymous-neighbor boundary.  The DTN
 * control frame is itself an opaque Fabric frame; only the sealed parcel
 * ciphertext can cross a stranger hop. */
export function createDelayTolerantEncounterSource(source: AnonymousNeighborSessionSource): DelayTolerantEncounterSource {
  const reassembler = new OpaqueFragmentReassembler({ maxTransfers: 32, maxBytes: 8 * 1024 * 1024 });
  return {
    listEncounters: limit => source.listNeighbors(limit),
    openEncounter: handle => source.openNeighbor(handle),
    sendEncounterFrame: async (session, frame) => {
      const expiresAt = new Date(Date.now() + 30_000).toISOString();
      const envelope = await createOpaqueDeliveryEnvelope({ destination: 'dtn-control', ciphertext: new TextEncoder().encode(JSON.stringify(frame)), replayNonce: randomToken(), expiresAt, requirement: { profile: 'CONTROL' } });
      for (const frame of await fragmentOpaqueEnvelope(envelope, 16 * 1024)) await source.sendNeighborFrame(session, frame);
    },
    onEncounterFrame: handler => source.onNeighborFrame(async (frame, session) => {
      if (!session) return;
      try {
        const envelope = 'kind' in frame ? await reassembler.add(frame) : frame;
        if (!envelope || envelope.destination !== 'dtn-control' || `sha256:${await digest(envelope.ciphertext)}` !== envelope.integrity) return;
        const decoded = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decodeOpaqueBytes(envelope.ciphertext))) as DelayTolerantWireFrame;
        if (decoded && decoded.version === VERSION && typeof decoded.kind === 'string' && decoded.kind.startsWith(FRAME_PREFIX)) await handler(decoded, session);
      } catch { /* malformed stranger control is dropped */ }
    }),
    closeEncounter: session => source.closeNeighborSession(session),
    start: () => source.start?.() ?? Promise.resolve(),
    stop: () => source.stop?.() ?? Promise.resolve(),
  };
}

export type DelayTolerantWireFrame =
  | { readonly version: 1; readonly kind: 'dtn.inventory'; readonly nonce: string; readonly acceptsAny: boolean; readonly destinationDigests: readonly string[]; readonly entries: readonly DelayTolerantInventoryEntry[]; readonly tombstones: readonly string[] }
  | { readonly version: 1; readonly kind: 'dtn.request'; readonly nonce: string; readonly ids: readonly string[] }
  | { readonly version: 1; readonly kind: 'dtn.parcel'; readonly nonce: string; readonly parcel: DelayTolerantParcel }
  | { readonly version: 1; readonly kind: 'dtn.custody'; readonly nonce: string; readonly parcelId: string; readonly parcelIntegrity: string; readonly accepted: boolean }
  | { readonly version: 1; readonly kind: 'dtn.tombstones'; readonly nonce: string; readonly ids: readonly string[] };
export interface DelayTolerantInventoryEntry { readonly id: string; readonly destinationDigest: string; readonly sizeBytes: number; readonly expiresAt: string; readonly resourceClass: DelayTolerantResourceClass; }

export interface DelayTolerantTransportProviderOptions {
  readonly source?: DelayTolerantEncounterSource;
  readonly store?: DurableOpaqueParcelStore;
  readonly crypto?: SodiumCryptoProvider;
  readonly providerId?: string;
  readonly now?: () => number;
  readonly resources?: ConnectivityResourceGovernor;
  readonly resourceProfile?: DelayTolerantResourceProfile;
  readonly maxEncounters?: number;
  readonly maxInventoryEntries?: number;
  readonly maxParcelsPerEncounter?: number;
  readonly maxBytesPerEncounter?: number;
  readonly maxTransferAttempts?: number;
  readonly maxConcurrentTransfers?: number;
  /** Optional provider-level composition hook. It receives the original
   * authenticated parcel unchanged; it must return only custody acceptance.
   * This is intentionally below applications and does not create a gateway
   * parcel format or reset copy/expiry metadata. */
  readonly forwardParcel?: DelayTolerantParcelForwarder;
}

export interface DelayTolerantParcelForwarder {
  forward(parcel: DelayTolerantParcel): Promise<boolean>;
}

const DTN_SECURITY: TransportSecurityBoundary = Object.freeze({ opaqueOnly: true, e2eRequired: true, canDecrypt: false, canAuthorize: false });
const DTN_CAPABILITIES: readonly TransportCapability[] = Object.freeze(['DISCOVERY', 'DATAGRAM', 'CONTROL', 'INTERACTIVE', 'BULK', 'BACKGROUND', 'LOW_BANDWIDTH', 'LOCAL_ONLY', 'STORE_FORWARD_FUTURE']);

/** Fabric provider implementing bounded single-copy custody across time. */
export class DelayTolerantTransportProvider implements TransportProvider {
  readonly id: TransportProviderId;
  readonly type = 'DelayTolerantTransport' as const;
  readonly security = DTN_SECURITY;
  readonly mtu = 256 * 1024;
  readonly store: DurableOpaqueParcelStore;
  readonly crypto: SodiumCryptoProvider;
  private readonly source?: DelayTolerantEncounterSource;
  private readonly now: () => number;
  private readonly resources: ConnectivityResourceGovernor;
  private readonly limits: Readonly<{ maxEncounters: number; maxInventoryEntries: number; maxParcelsPerEncounter: number; maxBytesPerEncounter: number; maxTransferAttempts: number; maxConcurrentTransfers: number }>;
  private readonly destinationSecrets = new Map<string, string>();
  private readonly localDestinationDigests = new Set<string>();
  private readonly sessions = new Map<string, TransportSession>();
  private readonly sessionsByHandle = new Map<string, TransportSession>();
  private readonly sessionLastUsed = new Map<string, number>();
  private readonly handlers = new Set<(frame: OpaqueFrame, session?: TransportSession) => void | Promise<void>>();
  private readonly receiptStatus = new Map<string, 'PENDING' | 'CONFIRMED'>();
  private readonly transferLocks = new Set<string>();
  private activeTransfers = 0;
  private unsubscribe?: () => void;
  private sweepTimer?: ReturnType<typeof setInterval>;
  private running = false;
  private availability: TransportAvailability = 'UNKNOWN';
  private checkedAt = iso(Date.now());
  private resourceProfile: DelayTolerantResourceProfile;
  private readonly pendingExchanges = new Set<string>();
  private readonly forwardParcel?: DelayTolerantParcelForwarder;

  constructor(options: DelayTolerantTransportProviderOptions = {}) {
    this.id = (options.providerId ?? `dtn:${crypto.randomUUID()}`) as TransportProviderId;
    this.forwardParcel = options.forwardParcel;
    this.source = options.source; this.store = options.store ?? new DurableOpaqueParcelStore(new InMemoryDelayTolerantStateStore()); this.crypto = options.crypto ?? new SodiumCryptoProvider(); this.now = options.now ?? Date.now; this.resources = options.resources ?? new ConnectivityResourceGovernor(); this.resourceProfile = options.resourceProfile ?? 'BALANCED';
    const defaultConcurrency = this.resources.maxConcurrentTransfers();
    this.limits = Object.freeze({ maxEncounters: boundedInt(options.maxEncounters, 1, 128, 16), maxInventoryEntries: boundedInt(options.maxInventoryEntries, 1, 512, 64), maxParcelsPerEncounter: boundedInt(options.maxParcelsPerEncounter, 1, 128, 16), maxBytesPerEncounter: boundedInt(options.maxBytesPerEncounter, 512, 8 * 1024 * 1024, 1 * 1024 * 1024), maxTransferAttempts: boundedInt(options.maxTransferAttempts, 1, 16, 3), maxConcurrentTransfers: boundedInt(options.maxConcurrentTransfers, 1, 64, defaultConcurrency) });
  }
  capabilities(): readonly TransportCapability[] { return DTN_CAPABILITIES; }
  routeMetadata(): { readonly family: 'dtn'; readonly pathKind: 'EVENTUAL' } { return { family: 'dtn', pathKind: 'EVENTUAL' }; }
  async probe(): Promise<TransportAvailability> { this.availability = 'AVAILABLE'; this.checkedAt = iso(this.now()); return this.availability; }
  health(): TransportHealth { return { state: this.availability === 'AVAILABLE' ? 'HEALTHY' : this.availability === 'UNKNOWN' ? 'UNKNOWN' : 'DEGRADED', availability: this.availability, checkedAt: this.checkedAt }; }
  async start(): Promise<void> { if (this.running) return; await this.store.ready(); for (const value of await this.store.localSecrets()) { this.destinationSecrets.set(`@local:${value.digest}`, value.secret); this.localDestinationDigests.add(value.digest); } await this.source?.start?.(); this.unsubscribe = this.source?.onEncounterFrame((frame, session) => this.receiveWire(frame, session)); this.sweepTimer = setInterval(() => { void this.maintenance(); }, 1_000); (this.sweepTimer as { unref?: () => void }).unref?.(); this.running = true; await this.probe(); }
  async stop(): Promise<void> { if (!this.running) return; this.running = false; if (this.sweepTimer) clearInterval(this.sweepTimer); this.sweepTimer = undefined; this.unsubscribe?.(); this.unsubscribe = undefined; for (const session of this.sessions.values()) await this.source?.closeEncounter(session).catch(() => undefined); this.sessions.clear(); this.sessionsByHandle.clear(); this.sessionLastUsed.clear(); this.pendingExchanges.clear(); await this.source?.stop?.(); this.availability = 'UNKNOWN'; }
  isPeerConnected(_destination: string): boolean { return false; }
  discoverDirectReachability(_destination: string, _requirement?: DeliveryRequirement): Promise<readonly TransportEndpoint[]> { return Promise.resolve([]); }
  async openSession(endpoint: TransportEndpoint): Promise<TransportSession> { if (!this.source || endpoint.providerId !== this.id || endpoint.providerType !== this.type) throw new ConnectivityError('POLICY_DENIED', 'Delay-tolerant endpoint is invalid'); const session = await this.source.openEncounter(endpoint.routeReference); this.sessions.set(session.id, session); return session; }
  async sendOpaqueFrame(_session: TransportSession, _frame: OpaqueFrame): Promise<void> { throw new ConnectivityError('POLICY_DENIED', 'Delay-tolerant provider does not expose live application frames'); }
  receiveOpaqueFrame(handler: (frame: OpaqueFrame, session?: TransportSession) => void | Promise<void>): () => void { this.handlers.add(handler); return () => this.handlers.delete(handler); }
  async measureLink(_session?: TransportSession): Promise<TransportMetrics> { return { mtu: this.mtu, queuePressure: this.store.stats().bytes / this.store.limitsSnapshot().maxBytes, cost: 'FREE', energy: 'MEDIUM', metered: false, observedAt: iso(this.now()) }; }
  async close(session: TransportSession): Promise<void> { this.sessions.delete(session.id); this.sessionLastUsed.delete(session.id); for (const [handle, value] of this.sessionsByHandle) if (value.id === session.id) this.sessionsByHandle.delete(handle); await this.source?.closeEncounter(session).catch(() => undefined); }
  setResourceProfile(profile: DelayTolerantResourceProfile): void { this.resourceProfile = profile; }
  resourceProfileSnapshot(): DelayTolerantResourceProfile { return this.resourceProfile; }
  deliveryStatus(parcelId: string): 'PENDING' | 'CONFIRMED' | undefined { return this.receiptStatus.get(parcelId); }
  async isDestinationConfirmed(parcelId: string): Promise<boolean> { return this.store.wasDestinationConfirmed(parcelId, this.now()); }
  diagnostics(): DelayTolerantStoreStats & { running: boolean; activeSessions: number; pendingExchanges: number; resourceProfile: DelayTolerantResourceProfile } { return { ...this.store.stats(), running: this.running, activeSessions: this.sessions.size, pendingExchanges: this.pendingExchanges.size, resourceProfile: this.resourceProfile }; }

  /** Provider-composition boundary for a wider gateway/DTN leg. The parcel
   * remains destination-sealed and authenticated; no application plaintext is
   * exposed and no copy/TTL budget is rewritten. */
  async acceptGatewayParcel(parcel: DelayTolerantParcel): Promise<boolean> {
    try {
      validateDelayTolerantParcel(parcel, this.now(), this.store.limitsSnapshot());
      if (`sha256:${await digest(parcel.ciphertext)}` !== parcel.ciphertextIntegrity) return false;
      if (!(await this.crypto.verify(canonicalJson(unsignedParcel(parcel)), parcel.manifestSignature, parcel.manifestPublicKey))) return false;
      const localSecret = this.destinationSecrets.get(`@local:${parcel.destinationDigest}`); if (!localSecret) return false;
      const before = this.receiptStatus.get(parcel.id); await this.handleParcel(parcel); return this.receiptStatus.get(parcel.id) === 'CONFIRMED' || before === 'CONFIRMED';
    } catch { return false; }
  }

  /** Bind a random rendezvous secret for a destination.  The destination must
   * receive the same secret through an already-authorized bootstrap channel;
   * it is never derived from a social identity. */
  async bindPeerRendezvous(destination: string, secret = randomToken()): Promise<string> { if (!destination || secret.length < 16) throw new ConnectivityError('POLICY_DENIED', 'Delay-tolerant rendezvous input is invalid'); this.destinationSecrets.set(destination, secret); return secret; }
  bindDestination(destination: string, secret: string): Promise<string> { return this.bindPeerRendezvous(destination, secret); }
  async registerLocalRendezvous(secret: string): Promise<string> { if (secret.length < 16) throw new ConnectivityError('POLICY_DENIED', 'Delay-tolerant local rendezvous is invalid'); const digestValue = await digest(secret); this.destinationSecrets.set(`@local:${digestValue}`, secret); this.localDestinationDigests.add(digestValue); await this.store.rememberLocalSecret(digestValue, secret); return digestValue; }
  advertiseOpaqueRendezvous(secret: string): Promise<string> { return this.registerLocalRendezvous(secret); }
  bindOpaqueRendezvous(destination: string, secret?: string): Promise<string> { return this.bindPeerRendezvous(destination, secret); }

  /** Called by Fabric only after all live providers have failed. */
  async queueOpaqueDelivery(request: DeliveryRequest): Promise<DeliveryResult> {
    if (!this.running) await this.start();
    if (request.requirement.profile === 'REALTIME' || request.requirement.profile === 'CONTROL') return { ok: false, requestId: request.id, availability: 'UNAVAILABLE', reachability: 'UNAVAILABLE', attempts: [], failure: { code: 'POLICY_DENIED', providerId: this.id, message: 'Realtime/control traffic cannot use delayed custody' } };
    if (request.requirement.profile === 'BULK' && !request.requirement.allowDelayTolerant) return { ok: false, requestId: request.id, availability: 'UNAVAILABLE', reachability: 'UNAVAILABLE', attempts: [], failure: { code: 'POLICY_DENIED', providerId: this.id, message: 'Bulk delivery requires explicit delay-tolerant policy' } };
    const destinationSecret = this.destinationSecrets.get(request.destination); if (!destinationSecret) return { ok: false, requestId: request.id, availability: 'UNAVAILABLE', reachability: 'UNAVAILABLE', attempts: [], failure: { code: 'NO_COMPATIBLE_TRANSPORT', providerId: this.id, message: 'No opaque destination rendezvous is bound' } };
    const expiry = Math.min(Date.parse(request.envelope.expiresAt), this.now() + MAX_LIFETIME_MS); if (!Number.isFinite(expiry) || expiry <= this.now()) return { ok: false, requestId: request.id, availability: 'UNAVAILABLE', reachability: 'UNAVAILABLE', attempts: [], failure: { code: 'TIMEOUT', providerId: this.id, message: 'Delivery envelope is expired' } };
    const ackToken = randomToken(); const ackDigest = await digest(ackToken); await this.registerLocalRendezvous(ackToken);
    const destinationDigest = await digest(destinationSecret); const sealed = await seal(destinationSecret, { kind: 'delivery', envelope: request.envelope, ackToken, ackDigest });
    const parcel = await this.createSignedParcel({ id: `parcel:${crypto.randomUUID()}`, destinationDigest, acknowledgementDigest: ackDigest, createdAt: this.now(), expiresAt: expiry, hopBudget: 16, copyBudget: 1, resourceClass: resourceClass(request.requirement), payloadKind: 'DELIVERY', ciphertext: sealed, requirement: request.requirement });
    const accepted = await this.store.put(parcel, 'OWNER_OUTBOX', this.now());
    if (!accepted) return { ok: false, requestId: request.id, availability: 'TEMPORARILY_UNAVAILABLE', reachability: 'EVENTUALLY', attempts: [], failure: { code: 'RESOURCE_LIMIT', providerId: this.id, message: 'Delay-tolerant owner outbox quota exceeded' } };
    this.receiptStatus.set(parcel.id, 'PENDING');
    void this.exchangeAll();
    return { ok: true, requestId: request.id, availability: 'TEMPORARILY_UNAVAILABLE', reachability: 'EVENTUALLY', attempts: [], receipt: { requestId: request.id, envelopeId: request.envelope.id, providerId: this.id, acceptedAt: iso(this.now()), path: 'DELAY_TOLERANT' } };
  }

  /** Explicit encounter hook for deterministic hosts/tests. */
  async exchange(handle: string): Promise<void> {
    if (!this.source || !this.running || this.pendingExchanges.has(handle)) return;
    const neighbors = this.source.listEncounters(this.limits.maxEncounters).find(value => value.handle === handle);
    if (!neighbors) return;
    this.pendingExchanges.add(handle);
    try {
      let session = this.sessionsByHandle.get(handle);
      if (!session) {
        if (this.sessions.size >= this.limits.maxEncounters) {
          const oldest = [...this.sessions.values()].sort((a, b) => (this.sessionLastUsed.get(a.id) ?? 0) - (this.sessionLastUsed.get(b.id) ?? 0))[0];
          if (oldest) await this.close(oldest);
        }
        session = await this.source.openEncounter(handle);
        this.sessions.set(session.id, session);
        this.sessionsByHandle.set(handle, session);
      }
      this.sessionLastUsed.set(session.id, this.now());
      try {
        await this.sendInventory(session);
      } catch {
        await this.close(session);
        if (!this.running) return;
        const retry = await this.source.openEncounter(handle).catch(() => undefined);
        if (!retry) return;
        this.sessions.set(retry.id, retry);
        this.sessionsByHandle.set(handle, retry);
        this.sessionLastUsed.set(retry.id, this.now());
        await this.sendInventory(retry).catch(() => undefined);
      }
    } finally {
      this.pendingExchanges.delete(handle);
    }
  }
  private async exchangeAll(): Promise<void> { if (!this.source || !this.running || !this.resources.allowsBackgroundDiscovery() || this.resourceProfile === 'BATTERY_SAVER') return; const handles = this.source.listEncounters(this.limits.maxEncounters); for (const neighbor of handles.slice(0, this.resourceProfile === 'HIGH_AVAILABILITY' ? handles.length : Math.min(4, handles.length))) await this.exchange(neighbor.handle).catch(() => undefined); }
  private async maintenance(): Promise<void> { if (!this.running) return; const at = this.now(); await this.store.sweep(at); for (const session of [...this.sessions.values()]) if ((this.sessionLastUsed.get(session.id) ?? at) + ENCOUNTER_IDLE_MS <= at) await this.close(session); await this.exchangeAll(); }
  private async createSignedParcel(input: { id: string; destinationDigest: string; acknowledgementDigest: string; createdAt: number; expiresAt: number; hopBudget: number; copyBudget: 1; resourceClass: DelayTolerantResourceClass; payloadKind: 'DELIVERY' | 'RECEIPT'; ciphertext: string; requirement: DeliveryRequirement }): Promise<DelayTolerantParcel> {
    const ephemeral = await this.crypto.generateIdentity(); const base = { version: VERSION, id: input.id, destinationDigest: input.destinationDigest, acknowledgementDigest: input.acknowledgementDigest, createdAt: iso(input.createdAt), expiresAt: iso(input.expiresAt), hopBudget: input.hopBudget, copyBudget: input.copyBudget, remainingCopyBudget: input.copyBudget, resourceClass: input.resourceClass, payloadKind: input.payloadKind, ciphertext: input.ciphertext, ciphertextIntegrity: `sha256:${await digest(input.ciphertext)}`, manifestPublicKey: ephemeral.publicKey, requirement: { profile: input.requirement.profile, ...(input.requirement.allowMetered === undefined ? {} : { allowMetered: input.requirement.allowMetered }), ...(input.requirement.allowHighEnergy === undefined ? {} : { allowHighEnergy: input.requirement.allowHighEnergy }) } } satisfies Omit<DelayTolerantParcel, 'manifestSignature'>;
    const manifestSignature = await this.crypto.sign(canonicalJson(base), ephemeral.privateKey); const parcel = { ...base, manifestSignature }; validateDelayTolerantParcel(parcel, this.now(), this.store.limitsSnapshot()); return parcel;
  }
  private async receiveWire(frame: DelayTolerantWireFrame, session?: TransportSession): Promise<void> {
    if (!session || frame.version !== VERSION) return;
    try {
      if (frame.kind === 'dtn.inventory') await this.handleInventory(frame, session);
      else if (frame.kind === 'dtn.request') await this.handleRequest(frame, session);
      else if (frame.kind === 'dtn.parcel') await this.handleParcel(frame.parcel, session);
      else if (frame.kind === 'dtn.custody') await this.handleCustody(frame, session);
      else if (frame.kind === 'dtn.tombstones') await this.handleTombstones(frame, session);
    } catch { /* malformed stranger traffic is dropped without crashing the runtime */ }
  }
  private async send(session: TransportSession | undefined, frame: DelayTolerantWireFrame): Promise<void> { if (!this.source || !session) return; const encoded = JSON.stringify(frame); if (bytesLength(encoded) > MAX_WIRE_BYTES) throw new ConnectivityError('RESOURCE_LIMIT', 'Delay-tolerant wire frame exceeds bound'); this.sessionLastUsed.set(session.id, this.now()); await this.source.sendEncounterFrame(session, frame); }
  private async sendInventory(session: TransportSession): Promise<void> {
    const entries = (await this.store.listEligible(this.now(), this.limits.maxInventoryEntries)).slice(0, this.limits.maxInventoryEntries).map(value => ({ id: value.parcel.id, destinationDigest: value.parcel.destinationDigest, sizeBytes: bytesLength(value.parcel.ciphertext), expiresAt: value.parcel.expiresAt, resourceClass: value.parcel.resourceClass }));
    const tombstones = await this.store.tombstones(this.now(), this.limits.maxInventoryEntries); await this.send(session, { version: VERSION, kind: 'dtn.inventory', nonce: randomToken(), acceptsAny: this.resourceProfile !== 'BATTERY_SAVER' && this.resources.allowsBackgroundDiscovery(), destinationDigests: [...this.localDestinationDigests].slice(0, this.limits.maxInventoryEntries), entries, tombstones });
  }
  private async handleInventory(frame: Extract<DelayTolerantWireFrame, { kind: 'dtn.inventory' }>, session: TransportSession): Promise<void> {
    if (frame.entries.length > this.limits.maxInventoryEntries || frame.destinationDigests.length > this.limits.maxInventoryEntries || frame.tombstones.length > this.limits.maxInventoryEntries) return;
    for (const id of frame.tombstones) if (validId(id)) await this.store.markRejected(id, this.now());
    const stored = await this.store.listEligible(this.now(), this.limits.maxInventoryEntries); const known = new Set(stored.map(value => value.parcel.id)); const requests: string[] = []; let bytes = 0;
    for (const item of frame.entries) {
      if (!validId(item.id) || !validDigest(item.destinationDigest) || !Number.isSafeInteger(item.sizeBytes) || item.sizeBytes < 0 || item.sizeBytes > this.store.limitsSnapshot().maxParcelBytes || Date.parse(item.expiresAt) <= this.now() || known.has(item.id) || await this.store.hasTombstone(item.id, this.now())) continue;
      if (!frame.acceptsAny && !this.localDestinationDigests.has(item.destinationDigest)) continue;
      if (requests.length >= this.limits.maxParcelsPerEncounter || bytes + item.sizeBytes > this.limits.maxBytesPerEncounter) break; requests.push(item.id); bytes += item.sizeBytes;
    }
    if (requests.length) await this.send(session, { version: VERSION, kind: 'dtn.request', nonce: randomToken(), ids: requests });
  }
  private async handleRequest(frame: Extract<DelayTolerantWireFrame, { kind: 'dtn.request' }>, session: TransportSession): Promise<void> { if (frame.ids.length > this.limits.maxParcelsPerEncounter) return; const entries = await this.store.listEligible(this.now(), this.limits.maxInventoryEntries); const wanted = new Set(frame.ids.filter(validId)); let sent = 0; let bytes = 0; for (const entry of entries) { if (!wanted.has(entry.parcel.id) || this.transferLocks.has(entry.parcel.id) || sent >= this.limits.maxParcelsPerEncounter || this.activeTransfers >= this.limits.maxConcurrentTransfers || entry.attempts >= this.limits.maxTransferAttempts) continue; const size = bytesLength(entry.parcel.ciphertext); if (bytes + size > this.limits.maxBytesPerEncounter) break; this.transferLocks.add(entry.parcel.id); this.activeTransfers += 1; await this.store.markTransferAttempt(entry.parcel.id); try { await this.send(session, { version: VERSION, kind: 'dtn.parcel', nonce: randomToken(), parcel: entry.parcel }); sent += 1; bytes += size; } finally { this.activeTransfers = Math.max(0, this.activeTransfers - 1); this.transferLocks.delete(entry.parcel.id); } } }
  private async handleParcel(parcel: DelayTolerantParcel, session?: TransportSession): Promise<void> {
    validateDelayTolerantParcel(parcel, this.now(), this.store.limitsSnapshot()); if (`sha256:${await digest(parcel.ciphertext)}` !== parcel.ciphertextIntegrity) throw new ConnectivityError('POLICY_DENIED', 'Delay-tolerant parcel ciphertext integrity failed'); if (!(await this.crypto.verify(canonicalJson(unsignedParcel(parcel)), parcel.manifestSignature, parcel.manifestPublicKey))) throw new ConnectivityError('POLICY_DENIED', 'Delay-tolerant parcel manifest signature is invalid');
    if (await this.store.hasTombstone(parcel.id, this.now())) { await this.send(session, this.custodyFrame(parcel, true)); return; }
    const localSecret = this.destinationSecrets.get(`@local:${parcel.destinationDigest}`);
    if (!localSecret) {
      if (this.forwardParcel) {
        const accepted = await this.forwardParcel.forward(parcel).catch(() => false);
        if (accepted) { await this.send(session, this.custodyFrame(parcel, true)); return; }
      }
      const accepted = await this.store.put(parcel, 'COURIER_STORE', this.now()); await this.send(session, this.custodyFrame(parcel, accepted)); return;
    }
    const inner = await openSeal(localSecret, parcel.ciphertext); if (!inner || typeof inner !== 'object') throw new ConnectivityError('POLICY_DENIED', 'Delay-tolerant inner payload is invalid'); const value = inner as Record<string, unknown>;
    if (value.kind === 'receipt') {
      const sourceId = typeof value.parcelId === 'string' ? value.parcelId : '';
      if (parcel.payloadKind !== 'RECEIPT' || parcel.destinationDigest !== parcel.acknowledgementDigest || !validId(sourceId) || typeof value.envelopeId !== 'string' || !value.envelopeId) throw new ConnectivityError('POLICY_DENIED', 'Delay-tolerant receipt is invalid');
      this.receiptStatus.set(sourceId, 'CONFIRMED'); await this.store.markDestinationConfirmed(sourceId, this.now()); await this.store.markDestinationConfirmed(parcel.id, this.now()); await this.send(session, this.custodyFrame(parcel, true)); return;
    }
    if (value.kind !== 'delivery' || !value.envelope || typeof value.ackToken !== 'string' || typeof value.ackDigest !== 'string') throw new ConnectivityError('POLICY_DENIED', 'Delay-tolerant delivery payload is invalid');
    if (parcel.payloadKind !== 'DELIVERY' || typeof value.ackToken !== 'string' || typeof value.ackDigest !== 'string' || value.ackDigest !== await digest(value.ackToken) || value.ackDigest !== parcel.acknowledgementDigest) throw new ConnectivityError('POLICY_DENIED', 'Delay-tolerant delivery acknowledgement is invalid');
    const envelope = value.envelope as OpaqueDeliveryEnvelope; const accepted = await this.deliverToApplication(envelope, session); if (!accepted) { await this.store.markRejected(parcel.id, this.now()); await this.send(session, this.custodyFrame(parcel, false)); return; }
    this.receiptStatus.set(parcel.id, 'CONFIRMED'); await this.store.markDestinationConfirmed(parcel.id, this.now()); const receiptCiphertext = await seal(value.ackToken as string, { kind: 'receipt', parcelId: parcel.id, envelopeId: envelope.id }); const receipt = await this.createSignedParcel({ id: `receipt:${crypto.randomUUID()}`, destinationDigest: value.ackDigest as string, acknowledgementDigest: value.ackDigest as string, createdAt: this.now(), expiresAt: Math.min(Date.parse(parcel.expiresAt), this.now() + MAX_LIFETIME_MS), hopBudget: parcel.hopBudget, copyBudget: 1, resourceClass: 'SMALL', payloadKind: 'RECEIPT', ciphertext: receiptCiphertext, requirement: { profile: 'EVENTUAL', allowDelayTolerant: true } }); await this.store.put(receipt, 'RECEIPT_OUTBOX', this.now()); await this.send(session, this.custodyFrame(parcel, true));
  }
  private async deliverToApplication(envelope: OpaqueDeliveryEnvelope, session?: TransportSession): Promise<boolean> { let accepted = false; for (const handler of this.handlers) { try { await handler(envelope, session); accepted = true; } catch { return false; } } return accepted; }
  private custodyFrame(parcel: DelayTolerantParcel, accepted: boolean): Extract<DelayTolerantWireFrame, { kind: 'dtn.custody' }> { return { version: VERSION, kind: 'dtn.custody', nonce: randomToken(), parcelId: parcel.id, parcelIntegrity: parcel.ciphertextIntegrity, accepted }; }
  private async handleCustody(frame: Extract<DelayTolerantWireFrame, { kind: 'dtn.custody' }>, _session: TransportSession): Promise<void> { if (!validId(frame.parcelId) || !/^sha256:[A-Za-z0-9_-]+$/.test(frame.parcelIntegrity)) return; const entry = await this.store.get(frame.parcelId); if (!entry || entry.parcel.ciphertextIntegrity !== frame.parcelIntegrity) return; if (frame.accepted) await this.store.markForwarded(frame.parcelId, this.now()); else if (entry.attempts + 1 >= this.limits.maxTransferAttempts) await this.store.markRejected(frame.parcelId, this.now()); }
  private async handleTombstones(frame: Extract<DelayTolerantWireFrame, { kind: 'dtn.tombstones' }>, _session: TransportSession): Promise<void> { for (const id of frame.ids.slice(0, this.limits.maxInventoryEntries)) if (validId(id)) await this.store.markRejected(id, this.now()); }
}

/** Compatibility alias used by hosts that call the service a courier. */
export const DelayTolerantRouter = DelayTolerantTransportProvider;
export const CourierService = DelayTolerantTransportProvider;
export const DelayTolerantProvider = DelayTolerantTransportProvider;
export const DelayTolerantParcelStore = DurableOpaqueParcelStore;
export function createDelayTolerantTransportProvider(options: DelayTolerantTransportProviderOptions = {}): DelayTolerantTransportProvider { return new DelayTolerantTransportProvider(options); }
