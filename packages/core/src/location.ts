/**
 * R0P76 privacy-first location capability.
 *
 * Location is deliberately modelled as private context, not as a transport
 * signal.  The service owns validation, scoped grants, freshness and bounded
 * watches.  Sharing is a separate adapter which carries only signed,
 * recipient-encrypted application envelopes through the existing Fabric.
 */

import type { NativeHost, NativeHostPrincipal, NativeLocationFix, NativeLocationRequest, NativeLocationWatch, NativePermissionState } from '@keystone/native-host';
import type { Envelope, EnvelopeSecurity, KeystoneDeliveryInterface, UnsignedEnvelope } from './connectivity.js';
import type { NodeId } from './types.js';

export const LOCATION_PROTOCOL = 'keystone.location.v1' as const;
export const LOCATION_ENVELOPE = 'location.share' as const;
export const LOCATION_MAX_GRANTS = 256;
export const LOCATION_MAX_WATCHES = 8;
export const LOCATION_MAX_SHARES = 64;
export const LOCATION_MAX_PENDING = 64;
export const LOCATION_MAX_SEEN = 8_192;
export const LOCATION_MAX_LIFETIME_MS = 24 * 60 * 60_000;
export const LOCATION_MAX_FUTURE_SKEW_MS = 2 * 60_000;
export const LOCATION_DEFAULT_STALE_AFTER_MS = 2 * 60_000;
export const LOCATION_APPROXIMATE_GRID_DEGREES = 0.01;

export type LocationPrecision = 'APPROXIMATE' | 'PRECISE';
export type LocationPermissionScope = 'ONE_SHOT' | 'FOREGROUND' | 'BACKGROUND';
export type LocationGrantCapability = 'LOCAL_USE' | 'SHARE';
export type LocationProviderProvenance = 'DEVICE_SENSOR' | 'OS_LOCATION_SERVICE' | 'USER_SELECTED' | 'REMOTE_SHARED' | 'CONTROLLED_TEST';
export type LocationFreshness = 'CURRENT' | 'RECENT' | 'STALE' | 'UNKNOWN';
export type LocationShareMode = 'ONE_SHOT' | 'LIVE';
export type LocationShareState = 'ACTIVE' | 'WAITING_FOR_CONNECTION' | 'STOPPED' | 'EXPIRED' | 'REVOKED' | 'ENDED';
export type LocationResourceProfile = 'BALANCED' | 'BATTERY_SAVER' | 'HIGH_AVAILABILITY';
export type LocationCallerKind = 'OWNER_UI' | 'CORE_FEATURE' | 'PLUGIN' | 'AGENT' | 'BROWSER_CONTEXT' | 'REMOTE_PEER' | 'BACKGROUND_TASK';

export interface LocationCaller {
  readonly id: string;
  readonly kind: LocationCallerKind;
  readonly origin?: string;
}

export interface LocationFix {
  readonly latitude: number;
  readonly longitude: number;
  readonly horizontalAccuracy: number;
  readonly altitude?: number;
  readonly altitudeAccuracy?: number;
  readonly heading?: number;
  readonly speed?: number;
  readonly timestamp: string;
  readonly provenance: LocationProviderProvenance;
  readonly precision: LocationPrecision;
}

export interface LocationProviderPermission {
  readonly status: 'UNKNOWN' | 'NOT_REQUESTED' | 'GRANTED' | 'DENIED' | 'RESTRICTED' | 'UNAVAILABLE';
  readonly changedAt: string;
  readonly reason?: string;
}

export interface LocationProviderRequest {
  readonly precision: LocationPrecision;
  readonly purpose: LocationPermissionScope;
  readonly maximumAgeMs: number;
  readonly intervalMs?: number;
}

export interface LocationProviderWatchHandle { readonly id: string; readonly expiresAt?: string; }

export interface LocationProvider {
  permission(): Promise<LocationProviderPermission>;
  requestPermission(explicitOwnerAction: boolean): Promise<LocationProviderPermission>;
  current(request: LocationProviderRequest): Promise<LocationFix>;
  watch(request: LocationProviderRequest, onUpdate: (fix: LocationFix) => void | Promise<void>, onError?: (error: Error) => void | Promise<void>): Promise<LocationProviderWatchHandle>;
  stopWatch(handle: LocationProviderWatchHandle): Promise<void>;
  shutdown?(): Promise<void>;
}

export interface LocationStateStorage {
  read(): Promise<unknown | undefined>;
  write(value: unknown): Promise<void>;
}

export class InMemoryLocationStateStorage implements LocationStateStorage {
  private value?: unknown;
  async read(): Promise<unknown | undefined> { return this.value === undefined ? undefined : structuredClone(this.value); }
  async write(value: unknown): Promise<void> { this.value = structuredClone(value); }
  snapshot(): unknown { return this.value === undefined ? undefined : structuredClone(this.value); }
}

export interface LocationGrant {
  readonly version: 1;
  readonly id: string;
  readonly principalId: string;
  readonly principalKind: LocationCallerKind;
  readonly capability: LocationGrantCapability;
  readonly scope: LocationPermissionScope;
  readonly precision: LocationPrecision;
  readonly target?: string;
  readonly origin?: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly ownerAuthorized: true;
  readonly consumedAt?: string;
  readonly revokedAt?: string;
}

export interface LocationGrantRequest {
  readonly principal: LocationCaller;
  readonly capability: LocationGrantCapability;
  readonly scope: LocationPermissionScope;
  readonly precision: LocationPrecision;
  readonly durationMs: number;
  readonly target?: string;
  readonly origin?: string;
  readonly explicitOwnerAction: boolean;
  readonly ownerConfirmed?: boolean;
}

export class LocationError extends Error {
  constructor(readonly code: 'INVALID_FIX' | 'PERMISSION_DENIED' | 'UNAVAILABLE' | 'STALE_FIX' | 'TIMEOUT' | 'POLICY_DENIED' | 'RESOURCE_EXHAUSTED' | 'EXPIRED' | 'REPLAY' | 'INVALID_UPDATE' | 'NOT_FOUND' | 'CANCELLED', message: string) { super(message); this.name = 'LocationError'; }
}

export class LocationPolicy {
  private readonly grantsById = new Map<string, LocationGrant>();
  private readonly maxGrants: number;
  constructor(private readonly now: () => number = Date.now, maxGrants = LOCATION_MAX_GRANTS) { this.maxGrants = Math.max(1, Math.min(LOCATION_MAX_GRANTS, Math.floor(maxGrants))); }

  issue(request: LocationGrantRequest): LocationGrant {
    if (!request.principal?.id || request.principal.kind === 'REMOTE_PEER') throw new LocationError('POLICY_DENIED', 'Remote callers cannot request location');
    // A plugin/agent/browser/background task must receive a bounded result
    // from Core; it cannot mint owner authority by passing a forged boolean
    // from its own process. Core/Owner UI are the only issuers; NativeHost
    // repeats this boundary at the OS edge.
    if (request.principal.kind !== 'OWNER_UI' && request.principal.kind !== 'CORE_FEATURE') throw new LocationError('POLICY_DENIED', 'Only owner UI or trusted Core may issue a location grant');
    if (!request.explicitOwnerAction || (request.scope === 'BACKGROUND' && request.ownerConfirmed !== true)) throw new LocationError('POLICY_DENIED', 'Explicit owner authorization is required');
    if (!['LOCAL_USE', 'SHARE'].includes(request.capability) || !['ONE_SHOT', 'FOREGROUND', 'BACKGROUND'].includes(request.scope) || !['APPROXIMATE', 'PRECISE'].includes(request.precision)) throw new LocationError('POLICY_DENIED', 'Location grant is invalid');
    if (request.capability === 'SHARE' && !request.target?.trim()) throw new LocationError('POLICY_DENIED', 'A location share requires an explicit target');
    if (!Number.isSafeInteger(request.durationMs) || request.durationMs < 1_000 || request.durationMs > LOCATION_MAX_LIFETIME_MS) throw new LocationError('POLICY_DENIED', 'Location grant duration is outside the bound');
    if (this.grantsById.size >= this.maxGrants) this.sweep();
    if (this.grantsById.size >= this.maxGrants) throw new LocationError('RESOURCE_EXHAUSTED', 'Location grant quota exceeded');
    const createdAt = new Date(this.now()).toISOString();
    const grant: LocationGrant = { version: 1, id: secureId('location-grant'), principalId: request.principal.id, principalKind: request.principal.kind, capability: request.capability, scope: request.scope, precision: request.precision, ...(request.target ? { target: request.target.slice(0, 256) } : {}), ...(request.origin ? { origin: request.origin.slice(0, 256) } : {}), createdAt, expiresAt: new Date(this.now() + request.durationMs).toISOString(), ownerAuthorized: true };
    this.grantsById.set(grant.id, grant); return structuredClone(grant);
  }
  get(id: string): LocationGrant | undefined { this.sweep(); const value = this.grantsById.get(id); return value ? structuredClone(value) : undefined; }
  list(): readonly LocationGrant[] { this.sweep(); return [...this.grantsById.values()].map(value => structuredClone(value)); }
  revoke(id: string): LocationGrant | undefined { const value = this.grantsById.get(id); if (!value) return undefined; const next: LocationGrant = { ...value, revokedAt: new Date(this.now()).toISOString() }; this.grantsById.set(id, next); return structuredClone(next); }
  consume(id: string): LocationGrant { const grant = this.require(id); if (grant.scope !== 'ONE_SHOT') return grant; if (grant.consumedAt || grant.revokedAt) throw new LocationError('POLICY_DENIED', 'One-shot location grant has already been consumed'); const next = { ...grant, consumedAt: new Date(this.now()).toISOString() }; this.grantsById.set(id, next); return structuredClone(next); }
  restore(records: unknown): void {
    this.grantsById.clear(); if (!Array.isArray(records)) return;
    for (const value of records.slice(0, this.maxGrants)) { const grant = parseGrant(value); if (!grant || grant.ownerAuthorized !== true || Date.parse(grant.expiresAt) <= this.now()) continue; this.grantsById.set(grant.id, grant); }
  }
  serialize(): readonly LocationGrant[] { this.sweep(); return this.list(); }
  private require(id: string): LocationGrant { if (!id || !/^[A-Za-z0-9:_-]{1,256}$/.test(id)) throw new LocationError('POLICY_DENIED', 'Location grant id is invalid'); const grant = this.grantsById.get(id); if (!grant) throw new LocationError('NOT_FOUND', 'Location grant was not found'); if (grant.revokedAt) throw new LocationError('POLICY_DENIED', 'Location grant was revoked'); if (grant.consumedAt) throw new LocationError('POLICY_DENIED', 'One-shot location grant has already been consumed'); const expiry = Date.parse(grant.expiresAt); if (!Number.isFinite(expiry) || expiry <= this.now()) throw new LocationError('EXPIRED', 'Location grant expired'); return grant; }
  requireFor(id: string, caller: LocationCaller, capability: LocationGrantCapability, target?: string): LocationGrant { const grant = this.require(id); if (grant.principalId !== caller.id || grant.principalKind !== caller.kind || grant.capability !== capability || (grant.target !== undefined && grant.target !== target)) throw new LocationError('POLICY_DENIED', 'Location grant does not authorize this caller or target'); return structuredClone(grant); }
  private sweep(): void { const now = this.now(); for (const [id, grant] of this.grantsById) if (Date.parse(grant.expiresAt) <= now && !grant.revokedAt) this.grantsById.set(id, { ...grant, revokedAt: new Date(now).toISOString() }); }
}

export interface LocationWatch {
  readonly version: 1;
  readonly id: string;
  readonly grantId: string;
  readonly precision: LocationPrecision;
  readonly scope: LocationPermissionScope;
  readonly startedAt: string;
  readonly expiresAt: string;
  readonly state: 'ACTIVE' | 'STOPPED' | 'REVOKED' | 'EXPIRED';
}

export interface LocationShareSession {
  readonly version: 1;
  readonly id: string;
  readonly ownerDeviceId: string;
  readonly target: string;
  readonly grantId: string;
  readonly mode: LocationShareMode;
  readonly precision: LocationPrecision;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly state: LocationShareState;
  readonly sequence: number;
  readonly lastUpdateAt?: string;
}

export interface LocationServiceOptions {
  readonly now?: () => number;
  readonly storage?: LocationStateStorage;
  readonly staleAfterMs?: number;
  readonly maxWatches?: number;
  readonly maxShares?: number;
  readonly resourceProfile?: LocationResourceProfile;
}

type WatchRecord = { readonly watch: LocationWatch; readonly caller: LocationCaller; readonly callback: (fix: LocationFix) => void | Promise<void>; readonly grantId: string };
type MutableShare = Omit<LocationShareSession, 'state' | 'sequence'> & { state: LocationShareState; sequence: number; lastUpdateAt?: string };
interface PersistedLocationState { version: 1; grants: readonly LocationGrant[]; shares: readonly LocationShareSession[]; revision: number; }

export class LocationService {
  private readonly now: () => number;
  private readonly storage: LocationStateStorage;
  private readonly staleAfterMs: number;
  private readonly maxWatches: number;
  private readonly maxShares: number;
  private readonly policy: LocationPolicy;
  private readonly watches = new Map<string, WatchRecord>();
  private readonly shares = new Map<string, MutableShare>();
  private readonly shareWatches = new Map<string, string>();
  private providerWatch?: LocationProviderWatchHandle;
  private providerWatchPrecision?: LocationPrecision;
  private providerError?: Error;
  private providerLatest?: LocationFix;
  private resourceProfile: LocationResourceProfile;
  private revision = 0;
  private writes: Promise<void> = Promise.resolve();
  private readonly readyPromise: Promise<void>;
  constructor(private readonly provider: LocationProvider, policy = new LocationPolicy(), options: LocationServiceOptions = {}) {
    this.policy = policy; this.now = options.now ?? Date.now; this.storage = options.storage ?? new InMemoryLocationStateStorage(); this.staleAfterMs = boundedInt(options.staleAfterMs ?? LOCATION_DEFAULT_STALE_AFTER_MS, 1_000, 24 * 60 * 60_000); this.maxWatches = boundedInt(options.maxWatches ?? LOCATION_MAX_WATCHES, 1, LOCATION_MAX_WATCHES); this.maxShares = boundedInt(options.maxShares ?? LOCATION_MAX_SHARES, 1, LOCATION_MAX_SHARES); this.resourceProfile = options.resourceProfile ?? 'BALANCED'; this.readyPromise = this.hydrate();
  }
  async ready(): Promise<void> { await this.readyPromise; }
  get grants(): LocationPolicy { return this.policy; }
  async requestPermission(grantId: string, caller: LocationCaller, explicitOwnerAction: boolean): Promise<LocationProviderPermission> { await this.ready(); this.policy.requireFor(grantId, caller, 'LOCAL_USE'); if (!explicitOwnerAction || caller.kind !== 'OWNER_UI') throw new LocationError('POLICY_DENIED', 'Permission dialogs require explicit owner action'); return this.provider.requestPermission(true); }
  async permission(): Promise<LocationProviderPermission> { await this.ready(); return this.provider.permission(); }
  async current(grantId: string, caller: LocationCaller): Promise<LocationFix> {
    await this.ready(); const grant = this.policy.requireFor(grantId, caller, 'LOCAL_USE'); return this.acquire(grant, true);
  }
  async startWatch(grantId: string, caller: LocationCaller, callback: (fix: LocationFix) => void | Promise<void>): Promise<LocationWatch> {
    await this.ready(); const grant = this.policy.requireFor(grantId, caller, 'LOCAL_USE'); return this.startWatchForGrant(grant, caller, callback);
  }
  async stopWatch(id: string): Promise<void> { await this.ready(); if (!this.watches.delete(id)) return; if (!this.watches.size) await this.stopProviderWatch(); }
  async revokeGrant(id: string): Promise<void> { await this.ready(); this.policy.revoke(id); for (const [watchId, record] of this.watches) if (record.grantId === id) this.watches.delete(watchId); for (const [shareId, share] of this.shares) if (share.grantId === id) { share.state = 'REVOKED'; const watchId = this.shareWatches.get(shareId); this.shareWatches.delete(shareId); if (watchId) await this.stopWatch(watchId); } if (!this.watches.size) await this.stopProviderWatch(); await this.persist(); }
  async createShare(input: { readonly ownerDeviceId: string; readonly target: string; readonly grantId: string; readonly caller: LocationCaller; readonly mode: LocationShareMode; readonly durationMs: number }): Promise<LocationShareSession> {
    await this.ready(); const grant = this.policy.requireFor(input.grantId, input.caller, 'SHARE', input.target); if (grant.precision === 'PRECISE' && input.caller.kind !== 'OWNER_UI' && input.caller.kind !== 'CORE_FEATURE') throw new LocationError('POLICY_DENIED', 'Precise sharing requires owner-authorized core context'); if (input.mode === 'LIVE' && grant.scope === 'ONE_SHOT') throw new LocationError('POLICY_DENIED', 'Live sharing requires foreground or background scope'); if (!input.ownerDeviceId || !input.target || this.shares.size >= this.maxShares) throw new LocationError('RESOURCE_EXHAUSTED', 'Location share quota exceeded'); if (!Number.isSafeInteger(input.durationMs) || input.durationMs < 1_000 || input.durationMs > LOCATION_MAX_LIFETIME_MS) throw new LocationError('POLICY_DENIED', 'Location share duration is outside the bound'); const now = this.now(); const share: MutableShare = { version: 1, id: secureId('location-share'), ownerDeviceId: input.ownerDeviceId, target: input.target, grantId: input.grantId, mode: input.mode, precision: grant.precision, createdAt: new Date(now).toISOString(), expiresAt: new Date(Math.min(now + input.durationMs, Date.parse(grant.expiresAt))).toISOString(), state: 'WAITING_FOR_CONNECTION', sequence: 0 }; this.shares.set(share.id, share); await this.persist(); return structuredClone(share);
  }
  async stopShare(id: string, reason: 'STOPPED' | 'REVOKED' = 'STOPPED'): Promise<LocationShareSession> { await this.ready(); const share = this.requireShare(id); share.state = reason; const watchId = this.shareWatches.get(id); this.shareWatches.delete(id); if (watchId) await this.stopWatch(watchId); await this.persist(); return structuredClone(share); }
  /** Attach a previously-created LIVE share to a bounded provider watch. The
   * network adapter remains separate: it receives only the callback fixes and
   * is responsible for recipient encryption/delivery. */
  async startShareWatch(id: string, caller: LocationCaller, callback: (fix: LocationFix) => void | Promise<void>): Promise<LocationWatch> { await this.ready(); const share = this.requireShare(id); if (share.mode !== 'LIVE') throw new LocationError('POLICY_DENIED', 'Only live shares can use a watch'); const grant = this.policy.requireFor(share.grantId, caller, 'SHARE', share.target); const existing = this.shareWatches.get(id); if (existing) { const current = this.watches.get(existing); if (current) return structuredClone(current.watch); this.shareWatches.delete(id); } const watch = await this.startWatchForGrant(grant, caller, async fix => { const current = this.shares.get(id); if (!current || current.state === 'STOPPED' || current.state === 'REVOKED' || current.state === 'EXPIRED' || current.state === 'ENDED') return; current.sequence += 1; current.lastUpdateAt = new Date(this.now()).toISOString(); current.state = 'ACTIVE'; await callback(fix); }); this.shareWatches.set(id, watch.id); return watch; }
  async getShare(id: string): Promise<LocationShareSession | undefined> { await this.ready(); this.sweep(); const share = this.shares.get(id); return share ? structuredClone(share) : undefined; }
  async listShares(): Promise<readonly LocationShareSession[]> { await this.ready(); this.sweep(); return [...this.shares.values()].map(value => structuredClone(value)); }
  async shareCurrent(id: string, caller: LocationCaller): Promise<LocationFix> { await this.ready(); const share = this.requireShare(id); if (share.state !== 'ACTIVE' && share.state !== 'WAITING_FOR_CONNECTION') throw new LocationError('POLICY_DENIED', 'Location share is not active'); const grant = this.policy.requireFor(share.grantId, caller, 'SHARE', share.target); const fix = await this.acquire(grant, grant.scope === 'ONE_SHOT'); share.sequence += 1; share.lastUpdateAt = new Date(this.now()).toISOString(); share.state = 'ACTIVE'; await this.persist(); return fix; }
  freshness(fix: LocationFix | undefined): LocationFreshness { if (!fix) return 'UNKNOWN'; const timestamp = Date.parse(fix.timestamp); if (!Number.isFinite(timestamp)) return 'UNKNOWN'; const age = this.now() - timestamp; if (age < -LOCATION_MAX_FUTURE_SKEW_MS) return 'UNKNOWN'; if (age <= Math.min(this.staleAfterMs, 30_000)) return 'CURRENT'; if (age <= this.staleAfterMs) return 'RECENT'; return 'STALE'; }
  /** Return the in-memory latest fix only through an active LOCAL_USE grant.
   * The zero-argument accessor intentionally does not exist: a previous
   * authorized read must never become an ambient location cache for plugins,
   * agents or other application surfaces. */
  latestLocal(grantId: string, caller: LocationCaller): LocationFix | undefined {
    const grant = this.policy.requireFor(grantId, caller, 'LOCAL_USE');
    if (!this.providerLatest) return undefined;
    if (grant.precision === 'PRECISE' && this.providerLatest.precision !== 'PRECISE') return undefined;
    return grant.precision === 'APPROXIMATE' ? coarsenLocationFix(this.providerLatest) : structuredClone(this.providerLatest);
  }
  setResourceProfile(profile: LocationResourceProfile): void { this.resourceProfile = profile; }
  resourceProfileState(): LocationResourceProfile { return this.resourceProfile; }
  async shutdown(): Promise<void> { this.watches.clear(); this.shareWatches.clear(); this.shares.clear(); await this.stopProviderWatch(); await this.provider.shutdown?.(); }
  async persist(): Promise<void> { const snapshot: PersistedLocationState = { version: 1, grants: this.policy.serialize(), shares: [...this.shares.values()].map(value => ({ ...value, state: value.state === 'ACTIVE' || value.state === 'WAITING_FOR_CONNECTION' ? 'ENDED' : value.state, sequence: value.sequence })), revision: ++this.revision }; const operation = this.writes.then(() => this.storage.write(snapshot)); this.writes = operation.catch(() => undefined); await operation; }
  private async hydrate(): Promise<void> { const raw = await this.storage.read(); if (!raw || typeof raw !== 'object') return; const value = raw as Partial<PersistedLocationState>; const revision = value.revision; if (value.version !== 1 || typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0 || revision > Number.MAX_SAFE_INTEGER) return; this.revision = revision; this.policy.restore(value.grants); if (Array.isArray(value.shares)) for (const candidate of value.shares.slice(0, this.maxShares)) { const share = parseShare(candidate); if (share) this.shares.set(share.id, { ...share, state: share.state === 'ACTIVE' || share.state === 'WAITING_FOR_CONNECTION' ? 'ENDED' : share.state }); } }
  private async ensureProviderWatch(precision: LocationPrecision): Promise<void> { if (this.providerWatch && (this.providerWatchPrecision === 'PRECISE' || this.providerWatchPrecision === precision)) return; if (this.providerWatch) await this.stopProviderWatch(); this.providerWatchPrecision = precision; this.providerWatch = await this.provider.watch({ precision, purpose: [...this.watches.values()].some((record: WatchRecord) => record.watch.scope === 'BACKGROUND') ? 'BACKGROUND' : 'FOREGROUND', maximumAgeMs: this.staleAfterMs, intervalMs: this.intervalForProfile() }, async fix => { try { const validated = validateLocationFix(fix, this.now()); this.providerLatest = validated; for (const record of [...this.watches.values()]) { const grant = this.policy.get(record.grantId); if (!grant || grant.revokedAt || Date.parse(grant.expiresAt) <= this.now()) { this.watches.delete(record.watch.id); continue; } if (grant.precision === 'PRECISE' && validated.precision !== 'PRECISE') continue; await record.callback(grant.precision === 'APPROXIMATE' ? coarsenLocationFix(validated) : validated); } if (!this.watches.size) await this.stopProviderWatch(); } catch (error) { await this.handleProviderError(error instanceof Error ? error : new Error('Invalid location fix')); } }, error => { void this.handleProviderError(error); }); }
  private async startWatchForGrant(grant: LocationGrant, caller: LocationCaller, callback: (fix: LocationFix) => void | Promise<void>): Promise<LocationWatch> { if (grant.scope === 'ONE_SHOT') throw new LocationError('POLICY_DENIED', 'One-shot grants cannot start a watch'); if (this.watches.size >= this.maxWatches) throw new LocationError('RESOURCE_EXHAUSTED', 'Location watch quota exceeded'); const permission = await this.provider.permission(); if (permission.status !== 'GRANTED') throw new LocationError(permission.status === 'UNAVAILABLE' ? 'UNAVAILABLE' : 'PERMISSION_DENIED', 'Location permission is unavailable'); const id = secureId('location-watch'); const now = this.now(); const watch: LocationWatch = { version: 1, id, grantId: grant.id, precision: grant.precision, scope: grant.scope, startedAt: new Date(now).toISOString(), expiresAt: grant.expiresAt, state: 'ACTIVE' }; this.watches.set(id, { watch, caller, callback, grantId: grant.id }); try { await this.ensureProviderWatch(grant.precision); } catch (error) { this.watches.delete(id); if (!this.watches.size) await this.stopProviderWatch(); throw error; } return structuredClone(watch); }
  private async acquire(grant: LocationGrant, consumeOneShot: boolean): Promise<LocationFix> { const permission = await this.provider.permission(); if (permission.status !== 'GRANTED') throw new LocationError(permission.status === 'UNAVAILABLE' ? 'UNAVAILABLE' : 'PERMISSION_DENIED', 'Location permission is unavailable'); const request: LocationProviderRequest = { precision: grant.precision, purpose: grant.scope, maximumAgeMs: this.staleAfterMs, intervalMs: this.intervalForProfile() }; const fix = await boundedCall(this.provider.current(request), 15_000, new LocationError('TIMEOUT', 'Location acquisition timed out')); const validated = validateLocationFix(fix, this.now()); if (grant.precision === 'PRECISE' && validated.precision !== 'PRECISE') throw new LocationError('INVALID_FIX', 'Provider did not satisfy a precise location grant'); if (this.now() - Date.parse(validated.timestamp) > this.staleAfterMs) throw new LocationError('STALE_FIX', 'Location fix is stale'); const transformed = grant.precision === 'APPROXIMATE' ? coarsenLocationFix(validated) : validated; this.providerLatest = validated; if (consumeOneShot && grant.scope === 'ONE_SHOT') this.policy.consume(grant.id); return transformed; }
  private async handleProviderError(error: Error): Promise<void> { this.providerError = error; this.watches.clear(); await this.stopProviderWatch(); }
  private async stopProviderWatch(): Promise<void> { const handle = this.providerWatch; this.providerWatch = undefined; this.providerWatchPrecision = undefined; if (handle) await this.provider.stopWatch(handle).catch(() => undefined); }
  private intervalForProfile(): number { return this.resourceProfile === 'BATTERY_SAVER' ? 60_000 : this.resourceProfile === 'HIGH_AVAILABILITY' ? 5_000 : 15_000; }
  private requireShare(id: string): MutableShare { if (!id || !this.shares.has(id)) throw new LocationError('NOT_FOUND', 'Location share was not found'); const share = this.shares.get(id)!; if (Date.parse(share.expiresAt) <= this.now() && ['ACTIVE', 'WAITING_FOR_CONNECTION'].includes(share.state)) share.state = 'EXPIRED'; if (share.state === 'EXPIRED') throw new LocationError('EXPIRED', 'Location share expired'); return share; }
  private sweep(): void { const now = this.now(); for (const share of this.shares.values()) if (Date.parse(share.expiresAt) <= now && ['ACTIVE', 'WAITING_FOR_CONNECTION'].includes(share.state)) share.state = 'EXPIRED'; }
}

export interface NativeLocationProviderOptions { readonly principal: NativeHostPrincipal; readonly ownerPrincipal?: NativeHostPrincipal; readonly now?: () => number; }
export class NativeHostLocationProvider implements LocationProvider {
  private readonly now: () => number;
  constructor(private readonly host: NativeHost, private readonly options: NativeLocationProviderOptions) { this.now = options.now ?? Date.now; }
  async permission(): Promise<LocationProviderPermission> { const state = await this.host.location().permission(this.request('location.current')); return normalizePermission(state); }
  async requestPermission(explicitOwnerAction: boolean): Promise<LocationProviderPermission> { const principal = this.options.ownerPrincipal ?? this.options.principal; const state = await this.host.requestPermission({ permission: 'location', principal, ownerAction: 'Use location', requestId: secureId('location-permission'), explicitOwnerAction }); return normalizePermission(state); }
  async current(request: LocationProviderRequest): Promise<LocationFix> { const nativeRequest: NativeLocationRequest = { precision: request.precision, purpose: request.purpose, maximumAgeMs: request.maximumAgeMs }; const response = await this.host.request({ requestId: secureId('location-current'), principal: this.options.principal, capability: 'location.current', scope: request.purpose, resource: 'location', createdAt: new Date(this.now()).toISOString(), expiresAt: new Date(this.now() + 15_000).toISOString() }, () => this.host.location().current(nativeRequest, this.request('location.current'))); if (!response.accepted || !response.value) throw new LocationError(response.error === 'UNSUPPORTED' ? 'UNAVAILABLE' : 'PERMISSION_DENIED', 'Location is unavailable'); return fromNativeFix(response.value, request.precision); }
  async watch(request: LocationProviderRequest, onUpdate: (fix: LocationFix) => void | Promise<void>, onError?: (error: Error) => void | Promise<void>): Promise<LocationProviderWatchHandle> { const nativeRequest: NativeLocationRequest = { precision: request.precision, purpose: request.purpose, maximumAgeMs: request.maximumAgeMs }; const response = await this.host.request({ requestId: secureId('location-watch'), principal: this.options.principal, capability: 'location.watch', scope: request.purpose, resource: 'location', ownerConfirmed: true, createdAt: new Date(this.now()).toISOString(), expiresAt: new Date(this.now() + LOCATION_MAX_LIFETIME_MS).toISOString() }, () => this.host.location().watch(nativeRequest, this.request('location.watch'), fix => onUpdate(fromNativeFix(fix, request.precision)), error => onError?.(error))); if (!response.accepted || !response.value) throw new LocationError(response.error === 'UNSUPPORTED' ? 'UNAVAILABLE' : 'PERMISSION_DENIED', 'Location watch is unavailable'); return { id: response.value.id, ...(response.value.expiresAt ? { expiresAt: response.value.expiresAt } : {}) }; }
  async stopWatch(handle: LocationProviderWatchHandle): Promise<void> { const response = await this.host.request({ requestId: secureId('location-stop'), principal: this.options.principal, capability: 'location.stop', scope: 'location', resource: 'location', ownerConfirmed: true, createdAt: new Date(this.now()).toISOString(), expiresAt: new Date(this.now() + 15_000).toISOString() }, () => this.host.location().stop({ kind: 'NATIVE_LOCATION_WATCH', id: handle.id, expiresAt: handle.expiresAt ?? new Date(this.now() + 1_000).toISOString(), state: 'STOPPED' }, this.request('location.stop'))); if (!response.accepted) throw new LocationError(response.error === 'UNSUPPORTED' ? 'UNAVAILABLE' : 'PERMISSION_DENIED', 'Location watch stop was rejected'); }
  private request(capability: 'location.current' | 'location.watch' | 'location.stop'): import('@keystone/native-host').NativeHostRequest { return { requestId: secureId('location-host'), principal: this.options.principal, capability, scope: 'location', resource: 'location' }; }
}

export interface LocationCiphertext { readonly version: 1; readonly algorithm: 'APPLICATION_E2E'; readonly nonce: string; readonly ciphertext: string; }
export interface LocationCipher {
  seal(recipient: NodeId, value: unknown): Promise<LocationCiphertext>;
  open(sender: NodeId, value: unknown): Promise<unknown>;
}

/**
 * Small, platform-neutral application E2E adapter.  The key resolver is
 * deliberately injected by the identity/device layer; this class never
 * persists or discovers keys and therefore cannot turn a location route into
 * an authorization grant.  AES-GCM authentication covers the protocol label
 * and peer id in addition to the payload.
 */
export class AesGcmLocationCipher implements LocationCipher {
  constructor(private readonly keyForPeer: (peer: NodeId) => Promise<Uint8Array> | Uint8Array, private readonly localNodeId: NodeId) {}
  async seal(recipient: NodeId, value: unknown): Promise<LocationCiphertext> {
    const nonce = new Uint8Array(12); globalThis.crypto.getRandomValues(nonce);
    const key = await importLocationKey(await this.keyForPeer(recipient));
    const plaintext = new TextEncoder().encode(JSON.stringify(value));
    const ciphertext = new Uint8Array(await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: new TextEncoder().encode(`${LOCATION_PROTOCOL}:to:${recipient}`) }, key, plaintext));
    return { version: 1, algorithm: 'APPLICATION_E2E', nonce: encodeLocationBytes(nonce), ciphertext: encodeLocationBytes(ciphertext) };
  }
  async open(sender: NodeId, value: unknown): Promise<unknown> {
    if (!value || typeof value !== 'object') throw new LocationError('INVALID_UPDATE', 'Location ciphertext is malformed'); const candidate = value as Partial<LocationCiphertext>; if (candidate.version !== 1 || candidate.algorithm !== 'APPLICATION_E2E' || typeof candidate.nonce !== 'string' || typeof candidate.ciphertext !== 'string') throw new LocationError('INVALID_UPDATE', 'Location ciphertext is malformed');
    const nonce = decodeLocationBytes(candidate.nonce); const ciphertext = decodeLocationBytes(candidate.ciphertext); if (nonce.length !== 12 || ciphertext.length > 128 * 1024) throw new LocationError('INVALID_UPDATE', 'Location ciphertext bounds are invalid'); const key = await importLocationKey(await this.keyForPeer(sender)); const plaintext = new Uint8Array(await globalThis.crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce as unknown as BufferSource, additionalData: new TextEncoder().encode(`${LOCATION_PROTOCOL}:to:${this.localNodeId}`) as unknown as BufferSource }, key, ciphertext as unknown as BufferSource)); return JSON.parse(new TextDecoder().decode(plaintext)) as unknown;
  }
}

export interface LocationWireEnvelope {
  readonly version: 1;
  readonly protocol: typeof LOCATION_PROTOCOL;
  readonly kind: 'START' | 'UPDATE' | 'STOP';
  readonly sessionId: string;
  readonly sender: NodeId;
  readonly recipient: NodeId;
  readonly sequence: number;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly ciphertext: LocationCiphertext;
}

export interface ReceivedLocationShare {
  readonly sessionId: string;
  readonly sender: NodeId;
  readonly target: NodeId;
  readonly precision: LocationPrecision;
  readonly state: 'ACTIVE' | 'STOPPED' | 'EXPIRED';
  readonly sequence: number;
  readonly updatedAt?: string;
  readonly fix?: LocationFix;
}

export interface LocationShareTransportOptions {
  readonly transport: KeystoneDeliveryInterface;
  readonly security: EnvelopeSecurity;
  readonly localNodeId: NodeId;
  readonly cipher: LocationCipher;
  readonly now?: () => number;
}

interface MutableReceived {
  sessionId: string;
  sender: NodeId;
  target: NodeId;
  precision: LocationPrecision;
  state: ReceivedLocationShare['state'];
  sequence: number;
  updatedAt?: string;
  fix?: LocationFix;
}

export class LocationShareService {
  private readonly now: () => number;
  private readonly transport: KeystoneDeliveryInterface;
  private readonly security: EnvelopeSecurity;
  private readonly localNodeId: NodeId;
  private readonly cipher: LocationCipher;
  private readonly unsubscribe: () => void;
  private readonly received = new Map<string, MutableReceived>();
  private readonly seen = new Set<string>();
  private readonly pending = new Map<string, { readonly peer: NodeId; readonly envelope: Envelope }>();
  /** At most one not-yet-delivered UPDATE is retained per share.  Location is
   * ephemeral context: a newer fix supersedes an older queued fix, while
   * START/STOP remain ordered protocol events. */
  private readonly pendingUpdateBySession = new Map<string, string>();
  private readonly delivering = new Set<string>();
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly peerQueues = new Map<NodeId, Promise<void>>();
  private readonly outgoingSequence = new Map<string, number>();
  private readonly listeners = new Set<(share: ReceivedLocationShare) => void | Promise<void>>();
  private readonly rejected: { count: number } = { count: 0 };
  constructor(options: LocationShareTransportOptions) { this.now = options.now ?? Date.now; this.transport = options.transport; this.security = options.security; this.localNodeId = options.localNodeId; this.cipher = options.cipher; this.unsubscribe = this.transport.onMessage(envelope => this.receive(envelope)); }
  close(): void { this.unsubscribe(); this.pending.clear(); this.pendingUpdateBySession.clear(); this.delivering.clear(); this.inFlight.clear(); this.peerQueues.clear(); this.outgoingSequence.clear(); this.received.clear(); this.seen.clear(); }
  onShare(listener: (share: ReceivedLocationShare) => void | Promise<void>): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  diagnostics(): { readonly received: number; readonly pending: number; readonly rejected: number } { return { received: this.received.size, pending: this.pending.size, rejected: this.rejected.count }; }
  get(sessionId: string): ReceivedLocationShare | undefined { const value = this.received.get(sessionId); return value ? structuredClone(value) : undefined; }
  async start(session: LocationShareSession, precision: LocationPrecision): Promise<void> { if (precision !== session.precision) throw new LocationError('POLICY_DENIED', 'Share precision cannot be widened by the sender'); const sequence = this.outgoingSequence.get(session.id) ?? 0; this.outgoingSequence.set(session.id, sequence); await this.send(session.target as NodeId, await this.makeEnvelope('START', session, sequence, { sessionId: session.id, target: session.target, precision: session.precision, mode: session.mode, expiresAt: session.expiresAt })); }
  async sendFix(session: LocationShareSession, fix: LocationFix): Promise<void> { if (!['ACTIVE', 'WAITING_FOR_CONNECTION'].includes(session.state)) throw new LocationError('POLICY_DENIED', 'Cannot update an inactive location share'); const sequence = Math.max(this.outgoingSequence.get(session.id) ?? -1, session.sequence) + 1; this.outgoingSequence.set(session.id, sequence); const transformed = session.precision === 'APPROXIMATE' ? coarsenLocationFix(fix) : fix; await this.send(session.target as NodeId, await this.makeEnvelope('UPDATE', session, sequence, { sessionId: session.id, precision: session.precision, fix: transformed })); }
  async stop(session: LocationShareSession): Promise<void> { const sequence = Math.max(this.outgoingSequence.get(session.id) ?? -1, session.sequence) + 1; this.outgoingSequence.set(session.id, sequence); await this.send(session.target as NodeId, await this.makeEnvelope('STOP', session, sequence, { sessionId: session.id, stoppedAt: new Date(this.now()).toISOString() })); }
  async flush(): Promise<void> { await Promise.all([...this.peerQueues.values()]); for (const key of [...this.pending.keys()]) await this.deliver(key); }
  private async send(peer: NodeId, envelope: Envelope): Promise<void> {
    const key = `${peer}\u0000${envelope.id}`;
    const body = envelope.body as Partial<LocationWireEnvelope>;
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : undefined;
    if (sessionId && body.protocol === LOCATION_PROTOCOL && body.kind === 'UPDATE') {
      const previousKey = this.pendingUpdateBySession.get(sessionId);
      if (previousKey && previousKey !== key && !this.delivering.has(previousKey)) this.pending.delete(previousKey);
      this.pendingUpdateBySession.set(sessionId, key);
    } else if (sessionId && body.protocol === LOCATION_PROTOCOL && body.kind === 'STOP') {
      const previousKey = this.pendingUpdateBySession.get(sessionId);
      if (previousKey && !this.delivering.has(previousKey)) this.pending.delete(previousKey);
      this.pendingUpdateBySession.delete(sessionId);
    }
    if (this.pending.size >= LOCATION_MAX_PENDING && !this.pending.has(key)) {
      const evicted = this.pending.keys().next().value as string | undefined;
      if (evicted) this.pending.delete(evicted);
    }
    this.pending.set(key, { peer, envelope });
    const previous = this.peerQueues.get(peer) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(() => this.deliver(key));
    this.peerQueues.set(peer, next);
    void next.finally(() => { if (this.peerQueues.get(peer) === next) this.peerQueues.delete(peer); });
  }
  private async deliver(key: string): Promise<void> {
    const running = this.inFlight.get(key); if (running) { await running; return; }
    const item = this.pending.get(key); if (!item) return;
    const operation = (async () => {
      this.delivering.add(key);
      try { await this.transport.connect(item.peer); await this.transport.send(item.peer, item.envelope); this.pending.delete(key); }
      catch { /* route may be unavailable; explicit flush/retry can deliver later */ }
      finally {
        this.delivering.delete(key);
        const body = item.envelope.body as Partial<LocationWireEnvelope>;
        if (typeof body.sessionId === 'string' && this.pendingUpdateBySession.get(body.sessionId) === key) this.pendingUpdateBySession.delete(body.sessionId);
      }
    })();
    this.inFlight.set(key, operation); try { await operation; } finally { this.inFlight.delete(key); }
  }
  private async makeEnvelope(kind: LocationWireEnvelope['kind'], session: LocationShareSession, sequence: number, payload: unknown): Promise<Envelope> { const ciphertext = await this.cipher.seal(session.target as NodeId, payload); const unsigned: UnsignedEnvelope = { version: 1, type: LOCATION_ENVELOPE, id: secureId('location-envelope'), sender: this.localNodeId, recipient: session.target as NodeId, nonce: secureId('location-nonce'), expiresAt: session.expiresAt, body: { version: 1, protocol: LOCATION_PROTOCOL, kind, sessionId: session.id, sender: this.localNodeId, recipient: session.target, sequence, issuedAt: new Date(this.now()).toISOString(), expiresAt: session.expiresAt, ciphertext } satisfies LocationWireEnvelope }; return { ...unsigned, signature: await this.security.sign(unsigned) }; }
  private async receive(envelope: Envelope): Promise<void> { if (envelope.type !== LOCATION_ENVELOPE || envelope.recipient !== this.localNodeId) return; const wire = parseWire((envelope.body as unknown)); const expiresAt = wire ? Date.parse(wire.expiresAt) : NaN; const issuedAt = wire ? Date.parse(wire.issuedAt) : NaN; const envelopeExpiresAt = Date.parse(envelope.expiresAt); if (!wire || wire.sender !== envelope.sender || wire.recipient !== this.localNodeId || wire.sessionId.length > 256 || !Number.isFinite(expiresAt) || !Number.isFinite(envelopeExpiresAt) || envelopeExpiresAt !== expiresAt || expiresAt <= this.now() || expiresAt - this.now() > LOCATION_MAX_LIFETIME_MS || !Number.isFinite(issuedAt) || issuedAt > expiresAt || issuedAt > this.now() + LOCATION_MAX_FUTURE_SKEW_MS || this.seen.has(`${wire.sender}:${wire.sessionId}:${wire.kind}:${wire.sequence}`) || !(await this.security.verify(envelope))) { this.rejected.count += 1; return; } const replay = `${wire.sender}:${wire.sessionId}:${wire.kind}:${wire.sequence}`; this.seen.add(replay); if (this.seen.size > LOCATION_MAX_SEEN) this.seen.delete(this.seen.values().next().value as string); try { const payload = await this.cipher.open(wire.sender, wire.ciphertext); await this.apply(wire, payload); } catch { this.rejected.count += 1; } }
  private async apply(wire: LocationWireEnvelope, payload: unknown): Promise<void> { const value = payload && typeof payload === 'object' ? payload as Record<string, unknown> : undefined; if (!value || value.sessionId !== wire.sessionId) throw new LocationError('INVALID_UPDATE', 'Location payload session mismatch'); const existing = this.received.get(wire.sessionId); if (wire.kind === 'START') { const precision = value.precision === 'APPROXIMATE' || value.precision === 'PRECISE' ? value.precision : undefined; const target = typeof value.target === 'string' ? value.target : undefined; if (!precision || target !== this.localNodeId || wire.sequence !== 0) throw new LocationError('INVALID_UPDATE', 'Location share start is invalid'); if (existing && wire.sequence <= existing.sequence) throw new LocationError('REPLAY', 'Location share start is stale'); const next: MutableReceived = { sessionId: wire.sessionId, sender: wire.sender, target: this.localNodeId, precision, state: 'ACTIVE', sequence: wire.sequence }; this.received.set(wire.sessionId, next); await this.notify(next); return; } if (!existing || wire.sequence <= existing.sequence) throw new LocationError('REPLAY', 'Location update is stale'); if (existing.state === 'STOPPED' || existing.state === 'EXPIRED') throw new LocationError('POLICY_DENIED', 'Location share is no longer active'); if (wire.kind === 'STOP') { existing.state = 'STOPPED'; existing.sequence = wire.sequence; existing.updatedAt = new Date(this.now()).toISOString(); await this.notify(existing); return; } const precision = value.precision; if (precision !== existing.precision) throw new LocationError('POLICY_DENIED', 'Location update precision changed'); const fix = validateLocationFix(value.fix, this.now()); if (existing.precision === 'APPROXIMATE' && fix.precision !== 'APPROXIMATE') throw new LocationError('POLICY_DENIED', 'Approximate recipient received precise location'); if (Date.parse(fix.timestamp) > this.now() + LOCATION_MAX_FUTURE_SKEW_MS) throw new LocationError('INVALID_UPDATE', 'Future location update rejected'); if (existing.fix && Date.parse(fix.timestamp) <= Date.parse(existing.fix.timestamp)) throw new LocationError('REPLAY', 'Location update timestamp is stale'); const sharedFix: LocationFix = { ...((existing.precision === 'APPROXIMATE' ? coarsenLocationFix(fix) : fix)), provenance: 'REMOTE_SHARED' }; existing.fix = sharedFix; existing.sequence = wire.sequence; existing.updatedAt = new Date(this.now()).toISOString(); await this.notify(existing); }
  private async notify(value: MutableReceived): Promise<void> { const snapshot = structuredClone(value); await Promise.all([...this.listeners].map(listener => listener(snapshot))); }
}

export class ControlledLocationProvider implements LocationProvider {
  private permissionState: LocationProviderPermission;
  private latest?: LocationFix;
  private readonly watches = new Map<string, { request: LocationProviderRequest; onUpdate: (fix: LocationFix) => void | Promise<void>; onError?: (error: Error) => void | Promise<void> }>();
  constructor(private readonly now: () => number = Date.now, initialPermission: LocationProviderPermission['status'] = 'GRANTED') { this.permissionState = { status: initialPermission, changedAt: new Date(this.now()).toISOString() }; }
  permission(): Promise<LocationProviderPermission> { return Promise.resolve({ ...this.permissionState }); }
  requestPermission(explicitOwnerAction: boolean): Promise<LocationProviderPermission> { if (!explicitOwnerAction) { this.permissionState = { status: 'DENIED', changedAt: new Date(this.now()).toISOString(), reason: 'Explicit owner action is required' }; return Promise.resolve({ ...this.permissionState }); } this.permissionState = { status: 'GRANTED', changedAt: new Date(this.now()).toISOString() }; return Promise.resolve({ ...this.permissionState }); }
  current(): Promise<LocationFix> { if (this.permissionState.status !== 'GRANTED' || !this.latest) return Promise.reject(new LocationError(this.permissionState.status === 'GRANTED' ? 'UNAVAILABLE' : 'PERMISSION_DENIED', 'Controlled location fix unavailable')); return Promise.resolve(structuredClone(this.latest)); }
  watch(request: LocationProviderRequest, onUpdate: (fix: LocationFix) => void | Promise<void>, onError?: (error: Error) => void | Promise<void>): Promise<LocationProviderWatchHandle> { if (this.permissionState.status !== 'GRANTED') return Promise.reject(new LocationError('PERMISSION_DENIED', 'Controlled location permission denied')); const id = secureId('controlled-location-watch'); this.watches.set(id, { request, onUpdate, onError }); return Promise.resolve({ id }); }
  stopWatch(handle: LocationProviderWatchHandle): Promise<void> { this.watches.delete(handle.id); return Promise.resolve(); }
  setPermission(status: LocationProviderPermission['status']): void { this.permissionState = { status, changedAt: new Date(this.now()).toISOString() }; if (status !== 'GRANTED') for (const record of this.watches.values()) void record.onError?.(new LocationError('PERMISSION_DENIED', 'Location permission was revoked')); }
  emit(fix: LocationFix): void { const validated = validateLocationFix(fix, this.now()); this.latest = validated; for (const record of this.watches.values()) void record.onUpdate(validated); }
  emitInvalid(value: unknown): void { for (const record of this.watches.values()) void record.onError?.(new LocationError('INVALID_FIX', 'Provider emitted an invalid location fix')); void value; }
  activeWatches(): number { return this.watches.size; }
}

export function validateLocationFix(value: unknown, now = Date.now()): LocationFix {
  if (!value || typeof value !== 'object') throw new LocationError('INVALID_FIX', 'Location fix is not an object'); const candidate = value as Partial<LocationFix>; const numbers: Array<[string, unknown]> = [['latitude', candidate.latitude], ['longitude', candidate.longitude], ['horizontalAccuracy', candidate.horizontalAccuracy]]; for (const [name, item] of numbers) if (typeof item !== 'number' || !Number.isFinite(item)) throw new LocationError('INVALID_FIX', `Location ${name} is invalid`); if ((candidate.latitude as number) < -90 || (candidate.latitude as number) > 90 || (candidate.longitude as number) < -180 || (candidate.longitude as number) > 180 || (candidate.horizontalAccuracy as number) < 0) throw new LocationError('INVALID_FIX', 'Location coordinates or accuracy are outside bounds'); const optional: Array<[string, unknown, (value: number) => boolean]> = [['altitude', candidate.altitude, Number.isFinite], ['altitudeAccuracy', candidate.altitudeAccuracy, value => Number.isFinite(value) && value >= 0], ['heading', candidate.heading, value => Number.isFinite(value) && value >= 0 && value <= 360], ['speed', candidate.speed, value => Number.isFinite(value) && value >= 0]]; for (const [name, item, valid] of optional) if (item !== undefined && (typeof item !== 'number' || !valid(item))) throw new LocationError('INVALID_FIX', `Location ${name} is invalid`); if (typeof candidate.timestamp !== 'string' || !Number.isFinite(Date.parse(candidate.timestamp)) || Date.parse(candidate.timestamp) > now + LOCATION_MAX_FUTURE_SKEW_MS) throw new LocationError('INVALID_FIX', 'Location timestamp is invalid'); const provenance = candidate.provenance; const precision = candidate.precision; if (!['DEVICE_SENSOR', 'OS_LOCATION_SERVICE', 'USER_SELECTED', 'REMOTE_SHARED', 'CONTROLLED_TEST'].includes(provenance as string) || !['APPROXIMATE', 'PRECISE'].includes(precision as string)) throw new LocationError('INVALID_FIX', 'Location provenance or precision is invalid'); return structuredClone(candidate as LocationFix);
}

export function coarsenLocationFix(fix: LocationFix): LocationFix { const lat = quantize(fix.latitude, LOCATION_APPROXIMATE_GRID_DEGREES); const lon = quantize(fix.longitude, LOCATION_APPROXIMATE_GRID_DEGREES); return { latitude: lat, longitude: lon, horizontalAccuracy: Math.max(fix.horizontalAccuracy, 1_110), ...(fix.altitudeAccuracy === undefined ? {} : { altitudeAccuracy: Math.max(fix.altitudeAccuracy, 100) }), timestamp: fix.timestamp, provenance: fix.provenance, precision: 'APPROXIMATE' }; }
export function locationFreshness(fix: LocationFix | undefined, now = Date.now(), staleAfterMs = LOCATION_DEFAULT_STALE_AFTER_MS): LocationFreshness { if (!fix) return 'UNKNOWN'; const timestamp = Date.parse(fix.timestamp); if (!Number.isFinite(timestamp) || timestamp > now + LOCATION_MAX_FUTURE_SKEW_MS) return 'UNKNOWN'; const age = now - timestamp; if (age <= Math.min(staleAfterMs, 30_000)) return 'CURRENT'; if (age <= staleAfterMs) return 'RECENT'; return 'STALE'; }
export function locationWireContainsPlaintext(value: unknown): boolean {
  const coordinateKeys = new Set(['latitude', 'longitude', 'horizontalAccuracy', 'altitude', 'heading', 'speed']);
  const scan = (candidate: unknown, encrypted = false): boolean => {
    if (!candidate || typeof candidate !== 'object') return false;
    if (Array.isArray(candidate)) return candidate.some(item => scan(item, encrypted));
    for (const [key, nested] of Object.entries(candidate as Record<string, unknown>)) {
      if (key === 'ciphertext') continue;
      if (!encrypted && coordinateKeys.has(key)) return true;
      if (scan(nested, encrypted)) return true;
    }
    return false;
  };
  return scan(value);
}

function fromNativeFix(value: NativeLocationFix, requestedPrecision: LocationPrecision): LocationFix { return validateLocationFix({ ...value, provenance: value.source === 'TEST' ? 'CONTROLLED_TEST' : value.source, precision: value.precision ?? requestedPrecision }); }
function normalizePermission(value: NativePermissionState): LocationProviderPermission { return { status: value.status, changedAt: value.changedAt, ...(value.reason ? { reason: value.reason } : {}) }; }
function parseGrant(value: unknown): LocationGrant | undefined { if (!value || typeof value !== 'object') return undefined; const candidate = value as Partial<LocationGrant>; const createdAt = typeof candidate.createdAt === 'string' ? Date.parse(candidate.createdAt) : NaN; const expiresAt = typeof candidate.expiresAt === 'string' ? Date.parse(candidate.expiresAt) : NaN; if (candidate.version !== 1 || typeof candidate.id !== 'string' || !/^[A-Za-z0-9:_-]{1,256}$/.test(candidate.id) || typeof candidate.principalId !== 'string' || candidate.principalId.length > 256 || typeof candidate.principalKind !== 'string' || !['OWNER_UI', 'CORE_FEATURE', 'PLUGIN', 'AGENT', 'BROWSER_CONTEXT', 'BACKGROUND_TASK'].includes(candidate.principalKind) || !['LOCAL_USE', 'SHARE'].includes(candidate.capability as string) || !['ONE_SHOT', 'FOREGROUND', 'BACKGROUND'].includes(candidate.scope as string) || !['APPROXIMATE', 'PRECISE'].includes(candidate.precision as string) || typeof candidate.createdAt !== 'string' || typeof candidate.expiresAt !== 'string' || candidate.ownerAuthorized !== true || !Number.isFinite(createdAt) || !Number.isFinite(expiresAt) || expiresAt <= createdAt) return undefined; return structuredClone(candidate as LocationGrant); }
function parseShare(value: unknown): LocationShareSession | undefined { if (!value || typeof value !== 'object') return undefined; const candidate = value as Partial<LocationShareSession>; const sequence = candidate.sequence; const createdAt = typeof candidate.createdAt === 'string' ? Date.parse(candidate.createdAt) : NaN; const expiresAt = typeof candidate.expiresAt === 'string' ? Date.parse(candidate.expiresAt) : NaN; if (candidate.version !== 1 || typeof candidate.id !== 'string' || !/^[A-Za-z0-9:_-]{1,256}$/.test(candidate.id) || typeof candidate.ownerDeviceId !== 'string' || candidate.ownerDeviceId.length > 256 || typeof candidate.target !== 'string' || candidate.target.length > 256 || typeof candidate.grantId !== 'string' || !['ONE_SHOT', 'LIVE'].includes(candidate.mode as string) || !['APPROXIMATE', 'PRECISE'].includes(candidate.precision as string) || !['ACTIVE', 'WAITING_FOR_CONNECTION', 'STOPPED', 'EXPIRED', 'REVOKED', 'ENDED'].includes(candidate.state as string) || !Number.isSafeInteger(sequence) || (sequence as number) < 0 || !Number.isFinite(createdAt) || !Number.isFinite(expiresAt) || expiresAt <= createdAt) return undefined; return structuredClone(candidate as LocationShareSession); }
function parseWire(value: unknown): LocationWireEnvelope | undefined { if (!value || typeof value !== 'object') return undefined; const candidate = value as Partial<LocationWireEnvelope>; const cipher = candidate.ciphertext as Partial<LocationCiphertext> | undefined; const sequence = candidate.sequence; const issuedAt = typeof candidate.issuedAt === 'string' ? Date.parse(candidate.issuedAt) : NaN; const expiresAt = typeof candidate.expiresAt === 'string' ? Date.parse(candidate.expiresAt) : NaN; if (candidate.version !== 1 || candidate.protocol !== LOCATION_PROTOCOL || !['START', 'UPDATE', 'STOP'].includes(candidate.kind as string) || typeof candidate.sessionId !== 'string' || candidate.sessionId.length === 0 || candidate.sessionId.length > 256 || typeof candidate.sender !== 'string' || candidate.sender.length === 0 || candidate.sender.length > 256 || typeof candidate.recipient !== 'string' || candidate.recipient.length === 0 || candidate.recipient.length > 256 || !Number.isSafeInteger(sequence) || (sequence as number) < 0 || !Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || !cipher || cipher.version !== 1 || cipher.algorithm !== 'APPLICATION_E2E' || typeof cipher.nonce !== 'string' || typeof cipher.ciphertext !== 'string' || cipher.ciphertext.length > 128 * 1024) return undefined; return structuredClone(candidate as LocationWireEnvelope); }
function secureId(prefix: string): string { if (!globalThis.crypto?.randomUUID) throw new Error('Secure randomness is unavailable'); return `${prefix}:${globalThis.crypto.randomUUID()}`; }
function boundedInt(value: number, min: number, max: number): number { return Number.isSafeInteger(value) ? Math.max(min, Math.min(max, value)) : min; }
function quantize(value: number, grid: number): number { return Number((Math.floor(value / grid) * grid + grid / 2).toFixed(5)); }
async function boundedCall<T>(promise: Promise<T>, timeoutMs: number, timeout: Error): Promise<T> { let timer: ReturnType<typeof setTimeout> | undefined; try { return await Promise.race([promise, new Promise<T>((_, reject) => { timer = setTimeout(() => reject(timeout), timeoutMs); })]); } finally { if (timer) clearTimeout(timer); } }
async function importLocationKey(value: Uint8Array): Promise<CryptoKey> { if (!(value instanceof Uint8Array) || ![16, 24, 32].includes(value.byteLength)) throw new LocationError('POLICY_DENIED', 'Location cipher key must be 128, 192 or 256 bits'); const copy = new Uint8Array(value); return globalThis.crypto.subtle.importKey('raw', copy, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']); }
function encodeLocationBytes(value: Uint8Array): string { let binary = ''; for (const byte of value) binary += String.fromCharCode(byte); return globalThis.btoa(binary); }
function decodeLocationBytes(value: string): Uint8Array { if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length > 180_000) throw new LocationError('INVALID_UPDATE', 'Location ciphertext encoding is invalid'); const binary = globalThis.atob(value); const output = new Uint8Array(binary.length); for (let index = 0; index < binary.length; index += 1) output[index] = binary.charCodeAt(index); return output; }
