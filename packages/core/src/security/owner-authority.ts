import { canonicalJson, type CryptoProvider } from '../crypto.js';
import { ImmutableCore, type PrivilegedOperation } from './immutable-core.js';
import type { OwnerRequestedSettingsIntent } from './content-safety.js';

export const SETTINGS_CLASSES = ['USER_PREFERENCE', 'PRIVACY_SETTING', 'SECURITY_SETTING', 'IMMUTABLE_POLICY'] as const;
export type SettingsClass = (typeof SETTINGS_CLASSES)[number];
export type SettingsRisk = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type SettingsMutationActor = 'OWNER' | 'LOCAL_AI' | 'PERSONAL_TRUSTED_AI' | 'REMOTE_AGENT' | 'SKILL' | 'PLUGIN';
export type SettingsMutationDecision = 'ALLOW' | 'PREVIEW_REQUIRED' | 'CONFIRMATION_REQUIRED' | 'DOUBLE_CONFIRMATION_REQUIRED' | 'DENY' | 'STALE_REQUEST' | 'INVALID_REQUEST';
export type SettingsConfirmationRequirement = 'NONE' | 'PREVIEW' | 'CONFIRM' | 'DOUBLE_CONFIRM' | 'ALWAYS_DENY';

export interface OwnerRequestedSetting {
  readonly path: string;
  readonly value?: unknown;
  readonly action?: 'set' | 'clear' | 'enable' | 'disable' | 'rotate' | 'revoke';
  readonly settingsClass?: SettingsClass;
}

export interface SettingsMutationIntent {
  readonly version: 1;
  readonly kind: 'settings_mutation_intent';
  readonly mutationId: string;
  readonly actor: SettingsMutationActor;
  readonly actorId: string;
  readonly ownerRequestId?: string;
  readonly path: string;
  readonly value?: unknown;
  readonly action?: OwnerRequestedSetting['action'];
  readonly settingsClass?: SettingsClass;
  readonly capability?: string;
  readonly createdAt: string;
  readonly signature?: string;
}

export interface SettingsMutationDecisionRecord {
  readonly decision: SettingsMutationDecision;
  readonly allowed: boolean;
  readonly settingsClass: SettingsClass;
  readonly risk: SettingsRisk;
  readonly confirmation: SettingsConfirmationRequirement;
  readonly reason: string;
  readonly mutationId: string;
  readonly ownerRequestId?: string;
}

export interface SettingsAuditRecord {
  readonly id: string;
  readonly timestamp: string;
  readonly kind: 'owner_request' | 'settings_mutation';
  readonly requestId?: string;
  readonly ownerRequestId?: string;
  readonly mutationId?: string;
  readonly actor?: SettingsMutationActor;
  readonly settingsClass?: SettingsClass;
  readonly risk?: SettingsRisk;
  readonly decision: SettingsMutationDecision;
  readonly confirmation: SettingsConfirmationRequirement;
  readonly reason: string;
  readonly path?: string;
}

export class OwnerAuthorityError extends Error {
  constructor(readonly code: 'OWNER_REQUEST_REQUIRED' | 'OWNER_REQUEST_STALE' | 'INVALID_SIGNATURE' | 'REPLAY' | 'IMMUTABLE_POLICY' | 'CONFIRMATION_REQUIRED' | 'REMOTE_AGENT_DENIED' | 'CAPABILITY_DENIED' | 'INVALID_INTENT', message: string) {
    super(message);
    this.name = 'OwnerAuthorityError';
  }
}

export interface OwnerAuthorityOptions {
  readonly ownerIdentityId: string;
  readonly ownerPublicKey: string;
  readonly deviceId: string;
  readonly sessionId: string;
  readonly crypto: CryptoProvider;
  readonly ownerPrivateKey?: string;
  readonly core?: ImmutableCore;
  readonly now?: () => number;
  readonly requestLifetimeMs?: number;
  readonly auditLimit?: number;
}

/**
 * The only authority that turns model/agent proposals into settings changes.
 * It accepts a signed, short-lived owner request and classifies the mutation
 * before any host settings adapter is called.
 */
export class OwnerAuthorityService {
  readonly ownerIdentityId: string;
  readonly deviceId: string;
  readonly sessionId: string;
  private readonly now: () => number;
  private readonly lifetimeMs: number;
  private readonly options: OwnerAuthorityOptions;
  private readonly requests = new Map<string, OwnerRequestedSettingsIntent>();
  private readonly usedNonces = new Set<string>();
  private readonly auditEntries: SettingsAuditRecord[] = [];

  constructor(options: OwnerAuthorityOptions) {
    if (!options.ownerIdentityId || !options.ownerPublicKey || !options.deviceId || !options.sessionId || !options.crypto) throw new Error('OwnerAuthority requires an identity, device, session and crypto verifier');
    this.options = options; this.ownerIdentityId = options.ownerIdentityId; this.deviceId = options.deviceId; this.sessionId = options.sessionId; this.now = options.now ?? Date.now; this.lifetimeMs = clamp(options.requestLifetimeMs ?? 5 * 60_000, 1_000, 60 * 60_000);
  }

  async createOwnerRequest(input: { sourceInteraction: string; requested: readonly OwnerRequestedSetting[]; expiresAt?: string; requestId?: string; nonce?: string }): Promise<OwnerRequestedSettingsIntent> {
    if (!this.options.ownerPrivateKey) throw new OwnerAuthorityError('OWNER_REQUEST_REQUIRED', 'An owner signing capability is required to create an owner request');
    if (!input.sourceInteraction.trim() || !input.requested.length || input.requested.length > 32) throw new OwnerAuthorityError('INVALID_INTENT', 'Owner request is empty or too large');
    const now = this.now(); const expiresAt = input.expiresAt ?? new Date(now + this.lifetimeMs).toISOString();
    if (!validFutureExpiry(expiresAt, now, this.lifetimeMs)) throw new OwnerAuthorityError('INVALID_INTENT', 'Owner request expiry is invalid');
    const requested = input.requested.map(normalizeRequestedSetting);
    const unsigned = { version: 1 as const, kind: 'owner_requested_settings_intent' as const, explicitOwnerRequest: true as const, source: 'OWNER' as const, requestId: input.requestId ?? randomId('owner-request'), ownerIdentityId: this.ownerIdentityId, deviceId: this.deviceId, sessionId: this.sessionId, sourceInteraction: input.sourceInteraction.trim().slice(0, 2_000), requested, createdAt: new Date(now).toISOString(), requestedAt: new Date(now).toISOString(), expiresAt, nonce: input.nonce ?? randomId('owner-nonce'), fields: requested.map(value => value.path) };
    if (this.requests.has(unsigned.requestId) || this.usedNonces.has(unsigned.nonce)) throw new OwnerAuthorityError('REPLAY', 'Owner request id or nonce was already used');
    const signature = await this.options.crypto.sign(canonicalJson(unsigned), this.options.ownerPrivateKey);
    const request: OwnerRequestedSettingsIntent = { ...unsigned, signature };
    const nonce = request.nonce; if (!nonce) throw new OwnerAuthorityError('INVALID_INTENT', 'Owner request nonce is missing');
    this.requests.set(request.requestId, request); this.usedNonces.add(nonce);
    this.audit({ kind: 'owner_request', requestId: request.requestId, decision: 'ALLOW', confirmation: 'NONE', reason: 'Fresh explicit owner request' });
    return structuredClone(request);
  }

  async acceptOwnerRequest(value: unknown): Promise<boolean> {
    const request = parseOwnerRequest(value);
    if (!request || request.kind !== 'owner_requested_settings_intent' || request.ownerIdentityId !== this.ownerIdentityId || request.deviceId !== this.deviceId || request.sessionId !== this.sessionId || !request.expiresAt || !validFutureExpiry(request.expiresAt, this.now(), this.lifetimeMs)) {
      this.audit({ kind: 'owner_request', requestId: request?.requestId, decision: 'INVALID_REQUEST', confirmation: 'NONE', reason: 'Owner request shape, binding or expiry failed' });
      return false;
    }
    if (!request.nonce || !request.signature || !request.requested || this.requests.has(request.requestId) || this.usedNonces.has(request.nonce)) { this.audit({ kind: 'owner_request', requestId: request.requestId, decision: 'INVALID_REQUEST', confirmation: 'NONE', reason: 'Owner request replayed or incomplete' }); return false; }
    const { signature: _signature, ...unsigned } = request;
    if (!(await this.options.crypto.verify(canonicalJson(unsigned), request.signature, this.options.ownerPublicKey))) { this.audit({ kind: 'owner_request', requestId: request.requestId, decision: 'INVALID_REQUEST', confirmation: 'NONE', reason: 'Owner request signature failed' }); return false; }
    this.requests.set(request.requestId, request); this.usedNonces.add(request.nonce); return true;
  }

  async authorizeMutation(input: SettingsMutationIntent, options: { readonly confirmed?: boolean; readonly doubleConfirmed?: boolean; readonly pluginNamespace?: string } = {}): Promise<SettingsMutationDecisionRecord> {
    const classification = classifySetting(input.path, input.settingsClass);
    const confirmation = confirmationFor(classification.settingsClass, classification.risk, input.path);
    let decision: SettingsMutationDecision = 'DENY'; let reason = 'Settings mutation denied'; let allowed = false;
    try {
      if (!validMutation(input)) throw new OwnerAuthorityError('INVALID_INTENT', 'Settings mutation intent is invalid');
      if (classification.settingsClass === 'IMMUTABLE_POLICY') throw new OwnerAuthorityError('IMMUTABLE_POLICY', 'Immutable policy is release-signed and cannot be mutated');
      if (input.actor === 'REMOTE_AGENT') throw new OwnerAuthorityError('REMOTE_AGENT_DENIED', 'Remote agents cannot mutate owner settings');
      if (this.options.core && (input.actor !== 'OWNER' || classification.settingsClass === 'SECURITY_SETTING')) this.options.core.assertPrivileged('SECURITY_SETTINGS_MUTATION');
      if (input.actor === 'PLUGIN' && !pluginNamespaceAllows(input, options.pluginNamespace)) throw new OwnerAuthorityError('CAPABILITY_DENIED', 'Plugin lacks a scoped settings capability');
      if (input.actor === 'SKILL' && !input.capability?.includes('SETTINGS_MUTATION')) throw new OwnerAuthorityError('CAPABILITY_DENIED', 'Skill lacks the explicit settings mutation capability');
      if (input.actor !== 'OWNER') {
        if (!input.ownerRequestId) throw new OwnerAuthorityError('OWNER_REQUEST_REQUIRED', 'AI/Skill/Plugin settings mutations require a fresh explicit owner request');
        const request = this.requests.get(input.ownerRequestId);
        if (!request) throw new OwnerAuthorityError('OWNER_REQUEST_REQUIRED', 'Owner request is not known to this device');
        const expiresAt = request.expiresAt; const requested = request.requested;
        if (!expiresAt || !validFutureExpiry(expiresAt, this.now(), this.lifetimeMs)) throw new OwnerAuthorityError('OWNER_REQUEST_STALE', 'Owner request is stale or expired');
        if (!requested || !requested.some(value => requestedMatches(value, input))) throw new OwnerAuthorityError('INVALID_INTENT', 'Mutation is outside the owner request scope');
      }
      if (confirmation === 'ALWAYS_DENY') throw new OwnerAuthorityError('IMMUTABLE_POLICY', 'Immutable policy is always denied');
      if (confirmation === 'PREVIEW' && !options.confirmed) { decision = 'PREVIEW_REQUIRED'; reason = 'Privacy disclosure changes require an owner preview/confirmation'; return this.recordDecision(input, classification, confirmation, decision, false, reason); }
      if (confirmation === 'CONFIRM' && !options.confirmed) throw new OwnerAuthorityError('CONFIRMATION_REQUIRED', 'Owner confirmation is required');
      if (confirmation === 'DOUBLE_CONFIRM' && (!options.confirmed || !options.doubleConfirmed)) throw new OwnerAuthorityError('CONFIRMATION_REQUIRED', 'Strong/double owner confirmation is required');
      decision = 'ALLOW'; reason = input.actor === 'OWNER' ? 'Explicit owner mutation' : 'Fresh owner request authorized'; allowed = true;
    } catch (error) {
      decision = error instanceof OwnerAuthorityError && error.code === 'OWNER_REQUEST_STALE' ? 'STALE_REQUEST' : error instanceof OwnerAuthorityError && error.code === 'INVALID_INTENT' ? 'INVALID_REQUEST' : 'DENY';
      reason = error instanceof Error ? error.message : 'Settings mutation denied';
    }
    return this.recordDecision(input, classification, confirmation, decision, allowed, reason);
  }

  /** Convenience assertion for privileged settings adapters. */
  async assertMutation(input: SettingsMutationIntent, options: { readonly confirmed?: boolean; readonly doubleConfirmed?: boolean; readonly pluginNamespace?: string } = {}): Promise<void> {
    const result = await this.authorizeMutation(input, options);
    if (!result.allowed) throw new OwnerAuthorityError(result.decision === 'STALE_REQUEST' ? 'OWNER_REQUEST_STALE' : result.confirmation !== 'NONE' ? 'CONFIRMATION_REQUIRED' : 'OWNER_REQUEST_REQUIRED', result.reason);
  }

  auditLog(): readonly SettingsAuditRecord[] { return this.auditEntries.map(value => structuredClone(value)); }
  isFreshOwnerRequest(requestId: string): boolean { const request = this.requests.get(requestId); return Boolean(request && request.expiresAt && validFutureExpiry(request.expiresAt, this.now(), this.lifetimeMs)); }
  assertCorePolicyMutationDenied(operation: PrivilegedOperation = 'SECURITY_SETTINGS_MUTATION'): never { this.options.core?.assertPrivileged(operation); throw new OwnerAuthorityError('IMMUTABLE_POLICY', 'Release-signed policy cannot be mutated'); }

  private recordDecision(input: SettingsMutationIntent, classification: { settingsClass: SettingsClass; risk: SettingsRisk }, confirmation: SettingsConfirmationRequirement, decision: SettingsMutationDecision, allowed: boolean, reason: string): SettingsMutationDecisionRecord {
    this.audit({ kind: 'settings_mutation', mutationId: input.mutationId, ownerRequestId: input.ownerRequestId, actor: input.actor, settingsClass: classification.settingsClass, risk: classification.risk, decision, confirmation, reason, path: input.path });
    return { decision, allowed, settingsClass: classification.settingsClass, risk: classification.risk, confirmation, reason, mutationId: input.mutationId, ...(input.ownerRequestId ? { ownerRequestId: input.ownerRequestId } : {}) };
  }
  private audit(input: Omit<SettingsAuditRecord, 'id' | 'timestamp'>): void { this.auditEntries.push({ ...input, id: crypto.randomUUID(), timestamp: new Date(this.now()).toISOString() }); while (this.auditEntries.length > (this.options.auditLimit ?? 256)) this.auditEntries.shift(); }
}

export interface PluginSettingsCapability { readonly pluginId: string; readonly namespace: string; readonly canWrite: boolean; readonly expiresAt: string; }

export class PluginSettingsBoundary {
  constructor(private readonly authority: OwnerAuthorityService) {}
  async authorize(input: SettingsMutationIntent, capability: PluginSettingsCapability, options: { readonly confirmed?: boolean; readonly doubleConfirmed?: boolean } = {}): Promise<SettingsMutationDecisionRecord> {
    const classification = classifySetting(input.path, input.settingsClass);
    if (!capability.expiresAt || Date.parse(capability.expiresAt) <= Date.now()) return { decision: 'DENY', allowed: false, settingsClass: classification.settingsClass, risk: classification.risk, confirmation: confirmationFor(classification.settingsClass, classification.risk, input.path), reason: 'Plugin settings capability is expired', mutationId: input.mutationId, ...(input.ownerRequestId ? { ownerRequestId: input.ownerRequestId } : {}) };
    return this.authority.authorizeMutation({ ...input, actor: 'PLUGIN', actorId: capability.pluginId, capability: capability.canWrite ? 'SETTINGS_MUTATION' : undefined }, { ...options, pluginNamespace: capability.namespace });
  }
}

export function classifySetting(path: string, requested?: SettingsClass): { settingsClass: SettingsClass; risk: SettingsRisk } {
  if (requested) return { settingsClass: requested, risk: riskFor(requested, path) };
  const normalized = path.trim().toLowerCase();
  if (normalized.startsWith('immutable.') || normalized.startsWith('securitycore.') || normalized.includes('mandatorypolicy') || normalized.includes('integrityroot') || normalized.includes('toolpolicy') || normalized.includes('egressfirewall') || normalized.includes('sandbox')) return { settingsClass: 'IMMUTABLE_POLICY', risk: 'CRITICAL' };
  if (normalized.startsWith('security.') || normalized.startsWith('devices.') || normalized.startsWith('plugins.') || normalized.startsWith('agents.capabilities') || normalized.includes('backup.recovery') || normalized.includes('browser.permissions')) return { settingsClass: 'SECURITY_SETTING', risk: 'HIGH' };
  if (normalized.startsWith('privacy.') || normalized.includes('visibility') || normalized.includes('location') || normalized.includes('contextualai')) return { settingsClass: 'PRIVACY_SETTING', risk: 'MEDIUM' };
  return { settingsClass: 'USER_PREFERENCE', risk: 'LOW' };
}

export function confirmationFor(settingsClass: SettingsClass, risk: SettingsRisk, path: string): SettingsConfirmationRequirement {
  if (settingsClass === 'IMMUTABLE_POLICY') return 'ALWAYS_DENY';
  if (settingsClass === 'SECURITY_SETTING' || risk === 'CRITICAL' || /revoke|rotate|delete|remove|trust|permission/i.test(path)) return 'DOUBLE_CONFIRM';
  if (settingsClass === 'PRIVACY_SETTING') return 'PREVIEW';
  return 'NONE';
}

function normalizeRequestedSetting(value: OwnerRequestedSetting): OwnerRequestedSetting { if (!value || !value.path || value.path.length > 512) throw new OwnerAuthorityError('INVALID_INTENT', 'Requested setting path is invalid'); const classification = classifySetting(value.path, value.settingsClass); return { path: value.path, ...(value.value === undefined ? {} : { value: structuredClone(value.value) }), ...(value.action ? { action: value.action } : {}), settingsClass: classification.settingsClass }; }
function requestedMatches(request: { readonly path: string; readonly value?: unknown; readonly action?: string }, mutation: SettingsMutationIntent): boolean { return request.path === mutation.path && (request.action === undefined || request.action === mutation.action) && (request.value === undefined || canonicalJson(request.value) === canonicalJson(mutation.value)); }
function validMutation(value: SettingsMutationIntent): boolean { return Boolean(value && value.version === 1 && value.kind === 'settings_mutation_intent' && value.mutationId && value.actor && value.actorId && value.path && value.path.length <= 512 && value.createdAt && Number.isFinite(Date.parse(value.createdAt))); }
function parseOwnerRequest(value: unknown): OwnerRequestedSettingsIntent | undefined { if (!value || typeof value !== 'object') return undefined; const item = value as Partial<OwnerRequestedSettingsIntent>; return item.version === 1 && item.kind === 'owner_requested_settings_intent' && item.explicitOwnerRequest === true && item.source === 'OWNER' && typeof item.requestId === 'string' && typeof item.ownerIdentityId === 'string' && typeof item.deviceId === 'string' && typeof item.sessionId === 'string' && typeof item.sourceInteraction === 'string' && Array.isArray(item.requested) && typeof item.createdAt === 'string' && typeof item.expiresAt === 'string' && typeof item.nonce === 'string' && typeof item.signature === 'string' ? item as OwnerRequestedSettingsIntent : undefined; }
function pluginNamespaceAllows(input: SettingsMutationIntent, namespace?: string): boolean { return Boolean(namespace && input.path.startsWith(`${namespace}.`) && input.capability?.includes('SETTINGS_MUTATION')) || Boolean(input.path.startsWith(`plugin.${input.actorId}.`) && input.capability?.includes('SETTINGS_MUTATION')); }
function riskFor(settingsClass: SettingsClass, path: string): SettingsRisk { if (settingsClass === 'IMMUTABLE_POLICY') return 'CRITICAL'; if (settingsClass === 'SECURITY_SETTING' || /revoke|rotate|delete|remove|trust|permission/i.test(path)) return 'HIGH'; if (settingsClass === 'PRIVACY_SETTING') return 'MEDIUM'; return 'LOW'; }
function validFutureExpiry(value: string, now: number, maxLifetime: number): boolean { const expiry = Date.parse(value); return Number.isFinite(expiry) && expiry > now && expiry <= now + maxLifetime; }
function clamp(value: number, min: number, max: number): number { return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.trunc(value))) : min; }
function randomId(prefix: string): string { return `${prefix}:${crypto.randomUUID()}`; }
