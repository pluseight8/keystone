/**
 * Keystone Content Safety Runtime (Release 0 / Phase 56).
 *
 * This module is deliberately host-neutral.  It protects the boundary between
 * a user's local data and shared/public surfaces without requiring a
 * generative model.  Models, classifiers and sender attestations are hints;
 * MandatorySafetyPolicy and recipient-local authorization remain authoritative.
 */
import { canonicalJson } from '../crypto.js';
import type { AIResourceScheduler } from '../ai/resource-scheduler.js';

export const CONTENT_DOMAINS = [
  'PERSONAL_LOCAL', 'PRIVATE_SELF', 'DIRECT_SHARED', 'GROUP_SHARED',
  'SHARED_SPACE', 'COMMUNITY', 'PUBLIC', 'DISCOVERY',
] as const;
export type ContentDomain = (typeof CONTENT_DOMAINS)[number];

export const SAFETY_CATEGORIES = [
  'ADULT_SEXUAL', 'EXPLICIT_NUDITY', 'SEXUALIZED_CONTENT',
  'GRAPHIC_VIOLENCE', 'REAL_WORLD_VIOLENCE', 'HARASSMENT',
  'TARGETED_ABUSE', 'STALKING', 'BLOCK_EVASION', 'COMBAT_CONTENT',
  'CURRENT_ARMED_CONFLICT', 'POLITICAL_CONTENT', 'POLITICAL_CAMPAIGNING',
  'EXTREMIST_CONTENT', 'GRAPHIC_SELF_HARM', 'DISTURBING_CONTENT',
  'MALICIOUS_OR_DECEPTIVE_CONTENT', 'UNKNOWN',
] as const;
export type SafetyCategory = (typeof SAFETY_CATEGORIES)[number];

export const SAFETY_CONTEXTS = [
  'PERSONAL_PRIVATE', 'HISTORICAL', 'EDUCATIONAL', 'DOCUMENTARY',
  'MEDICAL', 'FICTIONAL', 'NEWS_LIKE', 'CURRENT_EVENTS', 'PROMOTIONAL',
  'TARGETED_PERSON', 'REAL_WORLD', 'UNKNOWN',
] as const;
export type SafetyContext = (typeof SAFETY_CONTEXTS)[number];

export const SAFETY_DECISIONS = [
  'ALLOW', 'ALLOW_WITH_WARNING', 'HIDE_BY_DEFAULT', 'BLOCK_FROM_SHARED',
  'BLOCK_FROM_PUBLIC', 'BLOCK_FROM_DISCOVERY', 'QUARANTINE',
  'NEEDS_LOCAL_REVIEW', 'CLASSIFICATION_FAILED',
] as const;
export type SafetyDecision = (typeof SAFETY_DECISIONS)[number];

export const SAFETY_LIFECYCLE_STATES = [
  'UNSCANNED', 'SCANNING', 'SAFE', 'RESTRICTED', 'BLOCKED', 'QUARANTINED',
  'CLASSIFICATION_FAILED',
] as const;
export type SafetyLifecycleState = (typeof SAFETY_LIFECYCLE_STATES)[number];

export const SAFETY_CONFIGURATION_CLASSES = ['MANDATORY', 'USER_CONFIGURABLE'] as const;
export type SafetyConfigurationClass = (typeof SAFETY_CONFIGURATION_CLASSES)[number];

export type SafetyConfidence = number | 'HIGH' | 'MEDIUM' | 'LOW';
export type SafetyPolicyVersion = string;
export const SAFETY_STATES = ['SAFE', 'UNCERTAIN'] as const;
export type SafetyState = (typeof SAFETY_STATES)[number];

export interface SafetyEvidence {
  readonly kind: 'RULE' | 'FINGERPRINT' | 'CLASSIFIER' | 'MEDIA_SAMPLE' | 'LOCAL_AI' | 'BEHAVIOR' | 'ATTESTATION';
  readonly id: string;
  readonly category?: SafetyCategory;
  readonly context?: SafetyContext;
  readonly confidence: SafetyConfidence;
  readonly reason?: string;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface SafetyLabel {
  readonly category: SafetyCategory;
  readonly state: 'SAFE' | 'UNCERTAIN';
  readonly confidence: SafetyConfidence;
  readonly context: SafetyContext;
  readonly evidence: readonly SafetyEvidence[];
}

export interface SafetyAttestation {
  readonly contentHash: string;
  readonly labels: readonly SafetyLabel[];
  readonly classifierVersion: string;
  readonly policyVersion: string;
  readonly timestamp: string;
  readonly signature?: string;
}

export interface SafetyDecisionToken {
  readonly version: 1;
  readonly contentHash: string;
  readonly objectId: string;
  readonly domain: ContentDomain;
  readonly classifierVersion: string;
  readonly policyVersion: string;
  readonly timestamp: string;
  readonly decision: SafetyDecision;
  readonly lifecycle?: SafetyLifecycleState;
  readonly integrity: string;
}

export interface RawIncomingObject<T = unknown> {
  readonly kind: 'RawIncomingObject';
  readonly objectId: string;
  readonly contentHash: string;
  readonly domain: ContentDomain;
  readonly value: T;
  readonly receivedAt: string;
}

export interface VerifiedObject<T = unknown> extends Omit<RawIncomingObject<T>, 'kind'> {
  readonly kind: 'VerifiedObject';
  readonly verifiedBy: 'SIGNATURE' | 'LOCAL_SOURCE';
}

export interface AuthorizedObject<T = unknown> extends Omit<VerifiedObject<T>, 'kind'> {
  readonly kind: 'AuthorizedObject';
  readonly authorizationScope: string;
}

export interface SafetyEvaluatedObject<T = unknown> extends Omit<AuthorizedObject<T>, 'kind'> {
  readonly kind: 'SafetyEvaluatedObject';
  readonly decision: SafetyDecision;
  readonly lifecycle: SafetyLifecycleState;
  readonly labels: readonly SafetyLabel[];
  readonly token?: SafetyDecisionToken;
}

export interface SurfaceEligibleObject<T = unknown> extends Omit<SafetyEvaluatedObject<T>, 'kind' | 'decision' | 'token'> {
  readonly kind: 'SurfaceEligibleObject';
  readonly token: SafetyDecisionToken;
  readonly decision: 'ALLOW' | 'ALLOW_WITH_WARNING';
}

export type SafetySourceType =
  | 'chat' | 'group' | 'community' | 'profile' | 'discovery' | 'file' | 'music'
  | 'video' | 'short' | 'live' | 'space' | 'vault' | 'calendar' | 'workboard'
  | 'agent' | 'browser' | 'skill' | 'plugin' | 'publication' | 'unknown';

export interface SafetyRelationshipSignals {
  readonly knownContact?: boolean;
  readonly blocked?: boolean;
  readonly muted?: boolean;
  readonly explicitlyUnwanted?: boolean;
  readonly repeatedContact?: boolean;
  readonly repeatedInvites?: number;
  readonly mentions?: number;
  readonly afterBlock?: boolean;
  readonly targetRequested?: boolean;
  readonly rapidRequests?: number;
}

export interface SafetyEvaluationRequest<T = unknown> {
  readonly objectId?: string;
  readonly contentHash?: string;
  readonly domain: ContentDomain;
  readonly value?: T;
  readonly content?: unknown;
  readonly text?: string;
  readonly mimeType?: string;
  readonly context?: SafetyContext;
  readonly sourceType?: SafetySourceType | string;
  readonly author?: string;
  readonly relationship?: SafetyRelationshipSignals;
  readonly senderAttestation?: SafetyAttestation;
  readonly verified?: boolean;
  readonly authorized?: boolean;
  readonly authorizationScope?: string;
  /** Explicitly mark a share/publication attempt. Personal copies are retained. */
  readonly sharing?: boolean;
  readonly maxBytes?: number;
}

export interface SafetyEvaluation<T = unknown> extends SafetyEvaluatedObject<T> {
  readonly object: T | undefined;
  readonly contentHash: string;
  readonly sourceType: string;
  readonly confidence: SafetyConfidence;
  readonly evidence: readonly SafetyEvidence[];
  readonly fromCache: boolean;
  readonly personalPreserved: boolean;
}

export class SafetyRuntimeError extends Error {
  constructor(readonly code: 'INVALID_ARGUMENT' | 'POLICY_UNAVAILABLE' | 'CLASSIFICATION_FAILED' | 'STALE_TOKEN' | 'UNAUTHORIZED' | 'LIMIT_EXCEEDED', message: string) {
    super(message);
    this.name = 'SafetyRuntimeError';
  }
}

const sharedDomains = new Set<ContentDomain>(['DIRECT_SHARED', 'GROUP_SHARED', 'SHARED_SPACE', 'COMMUNITY', 'PUBLIC', 'DISCOVERY']);
const protectedDecisions = new Set<SafetyDecision>(['ALLOW', 'ALLOW_WITH_WARNING']);
const domainRank: Record<ContentDomain, number> = {
  PERSONAL_LOCAL: 0, PRIVATE_SELF: 0, DIRECT_SHARED: 1, GROUP_SHARED: 2,
  SHARED_SPACE: 2, COMMUNITY: 3, PUBLIC: 4, DISCOVERY: 5,
};
const toConfidenceNumber = (value: SafetyConfidence): number => typeof value === 'number' ? Math.max(0, Math.min(1, value)) : value === 'HIGH' ? 0.9 : value === 'MEDIUM' ? 0.6 : 0.25;
const confidenceName = (value: number): SafetyConfidence => value >= 0.85 ? 'HIGH' : value >= 0.55 ? 'MEDIUM' : 'LOW';
const nowIso = (): string => new Date().toISOString();
const clone = <T>(value: T): T => structuredClone(value);
const isContentDomain = (value: unknown): value is ContentDomain => typeof value === 'string' && (CONTENT_DOMAINS as readonly string[]).includes(value);
const isDecision = (value: unknown): value is SafetyDecision => typeof value === 'string' && (SAFETY_DECISIONS as readonly string[]).includes(value);
const isSafeEnum = <T extends readonly string[]>(values: T, value: unknown): value is T[number] => typeof value === 'string' && values.includes(value);

async function digestBytes(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const input = new Uint8Array(bytes.length); input.set(bytes);
    const output = new Uint8Array(await subtle.digest('SHA-256', input.buffer));
    return [...output].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }
  // The runtime is expected to have Web Crypto. This bounded fallback keeps
  // host-less tests deterministic; it is never presented as a cryptographic
  // content id when Web Crypto is available.
  let hash = 2166136261;
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619);
  return `fallback-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
async function digest(value: string): Promise<string> { return digestBytes(new TextEncoder().encode(value)); }

function boundedText(value: unknown, max = 32_768): string {
  if (typeof value === 'string') return value.slice(0, max);
  if (value instanceof Uint8Array) return new TextDecoder().decode(value.slice(0, max));
  try { return JSON.stringify(value)?.slice(0, max) ?? ''; } catch { return ''; }
}

function normalizeText(value: string): string {
  const homoglyphs: Record<string, string> = { 'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'х': 'x', 'у': 'y', 'і': 'i', 'Ι': 'i', 'О': 'o', 'А': 'a' };
  return value.normalize('NFKC').replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069]/g, '').split('').map(char => homoglyphs[char] ?? char).join('').toLocaleLowerCase().slice(0, 32_768);
}

function normalizeCategory(value: unknown): SafetyCategory {
  return isSafeEnum(SAFETY_CATEGORIES, value) ? value : 'UNKNOWN';
}

function normalizeContext(value: unknown): SafetyContext {
  return isSafeEnum(SAFETY_CONTEXTS, value) ? value : 'UNKNOWN';
}

function normalizeConfidence(value: unknown): SafetyConfidence {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.min(1, value));
  if (value === 'HIGH' || value === 'MEDIUM' || value === 'LOW') return value;
  return 'LOW';
}

function normalizeEvidence(value: unknown, fallbackKind: SafetyEvidence['kind'] = 'RULE'): SafetyEvidence[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 32).flatMap(item => {
    if (!item || typeof item !== 'object') return [];
    const candidate = item as Record<string, unknown>;
    const kind = isSafeEnum(['RULE', 'FINGERPRINT', 'CLASSIFIER', 'MEDIA_SAMPLE', 'LOCAL_AI', 'BEHAVIOR', 'ATTESTATION'] as const, candidate.kind) ? candidate.kind : fallbackKind;
    return [{ kind, id: typeof candidate.id === 'string' ? candidate.id.slice(0, 128) : 'evidence', ...(candidate.category !== undefined ? { category: normalizeCategory(candidate.category) } : {}), ...(candidate.context !== undefined ? { context: normalizeContext(candidate.context) } : {}), confidence: normalizeConfidence(candidate.confidence), ...(typeof candidate.reason === 'string' ? { reason: candidate.reason.slice(0, 512) } : {}) }];
  });
}

function normalizeLabels(value: unknown): SafetyLabel[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 32).flatMap(item => {
    if (!item || typeof item !== 'object') return [];
    const candidate = item as Record<string, unknown>;
    const category = normalizeCategory(candidate.category);
    const state = candidate.state === 'SAFE' ? 'SAFE' : 'UNCERTAIN';
    const context = normalizeContext(candidate.context);
    return [{ category, state, context, confidence: normalizeConfidence(candidate.confidence), evidence: normalizeEvidence(candidate.evidence) }];
  });
}

/** Immutable minimum platform policy. User preferences can only move toward stricter results. */
export class MandatorySafetyPolicy {
  readonly configurationClass = 'MANDATORY' as const;
  readonly id: string;
  readonly version: string;
  constructor(options: { id?: string; version?: string } = {}) { this.id = options.id ?? 'keystone-mandatory-safety'; this.version = options.version ?? 'r0p56.1'; }

  evaluate(domain: ContentDomain, labels: readonly SafetyLabel[], context: SafetyContext = 'UNKNOWN', uncertain = false): { decision: SafetyDecision; reason: string } {
    if (!isContentDomain(domain)) return { decision: 'CLASSIFICATION_FAILED', reason: 'invalid content domain' };
    if (!sharedDomains.has(domain)) return { decision: 'ALLOW', reason: 'personal domain is owner-local' };
    if (uncertain || labels.some(label => label.state === 'UNCERTAIN')) return { decision: domain === 'DIRECT_SHARED' ? 'NEEDS_LOCAL_REVIEW' : 'QUARANTINE', reason: 'shared content is not sufficiently classified' };
    const categories = new Set(labels.map(label => label.category));
    if (categories.has('ADULT_SEXUAL') || categories.has('EXPLICIT_NUDITY') || categories.has('SEXUALIZED_CONTENT')) return { decision: domain === 'DISCOVERY' ? 'BLOCK_FROM_DISCOVERY' : domain === 'PUBLIC' ? 'BLOCK_FROM_PUBLIC' : 'BLOCK_FROM_SHARED', reason: 'sexual content is not eligible for this shared surface' };
    if (categories.has('TARGETED_ABUSE') || categories.has('STALKING') || categories.has('BLOCK_EVASION') || categories.has('GRAPHIC_SELF_HARM') || categories.has('MALICIOUS_OR_DECEPTIVE_CONTENT')) return { decision: 'BLOCK_FROM_SHARED', reason: 'targeted harm, evasion, self-harm or malicious content is blocked' };
    if (categories.has('EXTREMIST_CONTENT') || categories.has('GRAPHIC_VIOLENCE') || categories.has('REAL_WORLD_VIOLENCE')) return { decision: domainRank[domain] >= 3 ? 'HIDE_BY_DEFAULT' : 'ALLOW_WITH_WARNING', reason: 'disturbing real-world content requires a warning or restricted surface' };
    if (categories.has('CURRENT_ARMED_CONFLICT') || categories.has('COMBAT_CONTENT') || categories.has('DISTURBING_CONTENT')) return { decision: context === 'HISTORICAL' || context === 'EDUCATIONAL' || context === 'DOCUMENTARY' ? 'ALLOW_WITH_WARNING' : domainRank[domain] >= 4 ? 'HIDE_BY_DEFAULT' : 'ALLOW_WITH_WARNING', reason: 'context-sensitive violence requires a warning' };
    if (categories.has('HARASSMENT') || categories.has('POLITICAL_CAMPAIGNING')) return { decision: 'ALLOW_WITH_WARNING', reason: 'interpersonal or campaigning content is warning-labelled' };
    if (categories.has('POLITICAL_CONTENT')) return { decision: 'ALLOW_WITH_WARNING', reason: 'political content is allowed with context' };
    if (categories.has('UNKNOWN')) return { decision: 'NEEDS_LOCAL_REVIEW', reason: 'unknown category requires local review' };
    return { decision: 'ALLOW', reason: 'no mandatory restriction matched' };
  }
}

export interface UserSafetyPreferences {
  readonly version: 1;
  readonly stricterCategories: readonly SafetyCategory[];
  readonly stricterContexts: readonly SafetyContext[];
  readonly hideUncertain: boolean;
  readonly restrictedDomains: readonly ContentDomain[];
}

export const DEFAULT_USER_SAFETY_PREFERENCES: UserSafetyPreferences = { version: 1, stricterCategories: [], stricterContexts: [], hideUncertain: true, restrictedDomains: [] };

export interface SafetyPolicyStateStore { read(): Promise<unknown | undefined>; write(value: unknown): Promise<void>; }
export class InMemorySafetyPolicyStateStore implements SafetyPolicyStateStore { private value?: unknown; async read() { return clone(this.value); } async write(value: unknown) { this.value = clone(value); } }

export interface OwnerRequestedSettingsIntent {
  readonly version: 1;
  readonly explicitOwnerRequest?: true;
  readonly source?: 'OWNER';
  readonly requestId: string;
  readonly requestedAt?: string;
  readonly fields?: readonly string[];
  /** Extended owner-authority binding used by settings mutation adapters. */
  readonly kind?: 'owner_requested_settings_intent';
  readonly ownerIdentityId?: string;
  readonly deviceId?: string;
  readonly sessionId?: string;
  readonly sourceInteraction?: string;
  readonly requested?: readonly { readonly path: string; readonly value?: unknown; readonly action?: string; readonly settingsClass?: string }[];
  readonly createdAt?: string;
  readonly expiresAt?: string;
  readonly nonce?: string;
  readonly signature?: string;
}

export class SafetyPolicyController {
  readonly mandatory: MandatorySafetyPolicy;
  private preferences: UserSafetyPreferences = clone(DEFAULT_USER_SAFETY_PREFERENCES);
  private readonly store?: SafetyPolicyStateStore;
  private writes: Promise<void> = Promise.resolve();
  private readonly readyPromise: Promise<void>;
  constructor(mandatory = new MandatorySafetyPolicy(), preferences?: Partial<UserSafetyPreferences>, store?: SafetyPolicyStateStore) { this.mandatory = mandatory; this.store = store; if (preferences) this.preferences = this.normalize(preferences); this.readyPromise = this.hydrate(); }
  async ready(): Promise<void> { await this.readyPromise; }
  async flush(): Promise<void> { await this.writes; }
  snapshot(): { mandatory: { id: string; version: string; configurationClass: 'MANDATORY' }; preferences: UserSafetyPreferences } { return { mandatory: { id: this.mandatory.id, version: this.mandatory.version, configurationClass: 'MANDATORY' }, preferences: clone(this.preferences) }; }
  preferencesSnapshot(): UserSafetyPreferences { return clone(this.preferences); }
  applyPreferences(next: Partial<UserSafetyPreferences>, intent: OwnerRequestedSettingsIntent): UserSafetyPreferences {
    if (!intent || intent.explicitOwnerRequest !== true || intent.source !== 'OWNER' || !intent.requestId || !Array.isArray(intent.fields)) throw new SafetyRuntimeError('UNAUTHORIZED', 'Safety settings require a fresh explicit owner intent');
    this.preferences = this.normalize({ ...this.preferences, ...next });
    void this.persist();
    return this.preferencesSnapshot();
  }
  evaluate(domain: ContentDomain, labels: readonly SafetyLabel[], context: SafetyContext, uncertain = false): { decision: SafetyDecision; reason: string } {
    const mandatory = this.mandatory.evaluate(domain, labels, context, uncertain);
    if (this.preferences.restrictedDomains.includes(domain) && protectedDecisions.has(mandatory.decision)) return { decision: 'HIDE_BY_DEFAULT', reason: 'owner preference restricts this domain' };
    const categories = new Set(labels.map(label => label.category));
    if (this.preferences.stricterCategories.some(category => categories.has(category))) return { decision: domain === 'DISCOVERY' ? 'BLOCK_FROM_DISCOVERY' : 'HIDE_BY_DEFAULT', reason: 'owner preference is stricter for this category' };
    if (this.preferences.stricterContexts.includes(context) || (this.preferences.hideUncertain && uncertain)) return { decision: 'HIDE_BY_DEFAULT', reason: 'owner preference hides uncertain/context-sensitive content' };
    return mandatory;
  }
  private normalize(value: Partial<UserSafetyPreferences>): UserSafetyPreferences { return { version: 1, stricterCategories: [...new Set((value.stricterCategories ?? []).filter(item => isSafeEnum(SAFETY_CATEGORIES, item)))], stricterContexts: [...new Set((value.stricterContexts ?? []).filter(item => isSafeEnum(SAFETY_CONTEXTS, item)))], hideUncertain: value.hideUncertain !== false, restrictedDomains: [...new Set((value.restrictedDomains ?? []).filter(item => isContentDomain(item)))] }; }
  private async hydrate(): Promise<void> { const raw = await this.store?.read(); if (!raw || typeof raw !== 'object') return; const candidate = raw as { version?: unknown; preferences?: unknown }; if (candidate.version !== 1 || !candidate.preferences || typeof candidate.preferences !== 'object') return; this.preferences = this.normalize(candidate.preferences as Partial<UserSafetyPreferences>); }
  private async persist(): Promise<void> { if (!this.store) return; const operation = this.writes.then(() => this.store!.write({ version: 1 as const, preferences: this.preferencesSnapshot() })); this.writes = operation.catch(() => undefined); await operation; }
}

export interface SafetyCacheEntry {
  readonly contentHash: string;
  readonly policyVersion: string;
  readonly classifierVersion: string;
  readonly decision: SafetyDecision;
  readonly labels: readonly SafetyLabel[];
  readonly confidence: SafetyConfidence;
  readonly evidence: readonly SafetyEvidence[];
  readonly lifecycle: SafetyLifecycleState;
  readonly analyzedAt: string;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface SafetyCacheStateStore { read(): Promise<unknown | undefined>; write(value: unknown): Promise<void>; }
export class InMemorySafetyCacheStateStore implements SafetyCacheStateStore { private value?: unknown; async read() { return clone(this.value); } async write(value: unknown) { this.value = clone(value); } }

export class SafetyCache {
  private readonly entries = new Map<string, SafetyCacheEntry>();
  private readonly readyPromise?: Promise<void>;
  private writes: Promise<void> = Promise.resolve();
  constructor(private readonly options: { maxEntries?: number; store?: SafetyCacheStateStore } = {}) { if (options.store) this.readyPromise = this.hydrate(options.store); }
  async ready(): Promise<void> { await this.readyPromise; }
  key(contentHash: string, policyVersion: string, classifierVersion: string): string { return `${contentHash}|${policyVersion}|${classifierVersion}`; }
  get(contentHash: string, policyVersion: string, classifierVersion: string): SafetyCacheEntry | undefined { const value = this.entries.get(this.key(contentHash, policyVersion, classifierVersion)); return value ? clone(value) : undefined; }
  async getAsync(contentHash: string, policyVersion: string, classifierVersion: string): Promise<SafetyCacheEntry | undefined> { await this.ready(); return this.get(contentHash, policyVersion, classifierVersion); }
  async put(entry: SafetyCacheEntry): Promise<void> { await this.ready(); const key = this.key(entry.contentHash, entry.policyVersion, entry.classifierVersion); this.entries.set(key, clone(entry)); const max = Math.max(1, Math.min(100_000, this.options.maxEntries ?? 4_096)); while (this.entries.size > max) this.entries.delete(this.entries.keys().next().value as string); await this.persist(); }
  invalidate(contentHash?: string, policyVersion?: string, classifierVersion?: string): void { for (const [key, entry] of this.entries) if (!contentHash || entry.contentHash === contentHash) { if (policyVersion && entry.policyVersion !== policyVersion) continue; if (classifierVersion && entry.classifierVersion !== classifierVersion) continue; this.entries.delete(key); } }
  invalidateStale(policyVersion: string, classifierVersion: string): void { for (const [key, entry] of this.entries) if (entry.policyVersion !== policyVersion || entry.classifierVersion !== classifierVersion) this.entries.delete(key); }
  clear(): void { this.entries.clear(); }
  size(): number { return this.entries.size; }
  entriesSnapshot(): readonly SafetyCacheEntry[] { return [...this.entries.values()].map(clone); }
  private async hydrate(store: SafetyCacheStateStore): Promise<void> { const raw = await store.read(); if (!raw || typeof raw !== 'object') return; const values = (raw as { entries?: unknown }).entries; if (!Array.isArray(values)) return; for (const item of values.slice(0, this.options.maxEntries ?? 4_096)) { if (!item || typeof item !== 'object') continue; const candidate = item as Partial<SafetyCacheEntry>; if (typeof candidate.contentHash !== 'string' || typeof candidate.policyVersion !== 'string' || typeof candidate.classifierVersion !== 'string' || !isDecision(candidate.decision)) continue; const metadata = candidate.metadata && typeof candidate.metadata === 'object' ? Object.fromEntries(Object.entries(candidate.metadata).filter(([key, value]) => ['sourceType', 'domain', 'context'].includes(key) && typeof value === 'string')) : undefined; this.entries.set(this.key(candidate.contentHash, candidate.policyVersion, candidate.classifierVersion), clone({ contentHash: candidate.contentHash, policyVersion: candidate.policyVersion, classifierVersion: candidate.classifierVersion, decision: candidate.decision, labels: normalizeLabels(candidate.labels), confidence: normalizeConfidence(candidate.confidence), evidence: normalizeEvidence(candidate.evidence), lifecycle: isSafeEnum(SAFETY_LIFECYCLE_STATES, candidate.lifecycle) ? candidate.lifecycle : 'CLASSIFICATION_FAILED', analyzedAt: typeof candidate.analyzedAt === 'string' ? candidate.analyzedAt : nowIso(), ...(metadata && Object.keys(metadata).length ? { metadata } : {}) })); } }
  private async persist(): Promise<void> { const store = this.options.store; if (!store) return; const snapshot = { version: 1 as const, entries: this.entriesSnapshot() }; const operation = this.writes.then(() => store.write(snapshot)); this.writes = operation.catch(() => undefined); await operation; }
}

export interface SafetyFingerprintAdapter { readonly id: string; readonly kind: 'image' | 'video' | 'audio'; fingerprint(input: unknown): Promise<string | undefined>; }
export class SafetyFingerprintService {
  private readonly known = new Map<string, SafetyCacheEntry>();
  constructor(private readonly adapters: readonly SafetyFingerprintAdapter[] = [], private readonly maxBytes = 1_048_576) {}
  async contentHash(value: unknown): Promise<string> { const bounded = value instanceof Uint8Array ? value.slice(0, this.maxBytes) : boundedText(value, this.maxBytes); return bounded instanceof Uint8Array ? digestBytes(bounded) : digest(bounded); }
  async fingerprint(value: unknown, mimeType?: string): Promise<{ contentHash: string; perceptual?: string }> { const contentHash = await this.contentHash(value); const kind = mimeType?.startsWith('image/') ? 'image' : mimeType?.startsWith('video/') ? 'video' : mimeType?.startsWith('audio/') ? 'audio' : undefined; if (!kind) return { contentHash }; const adapter = this.adapters.find(item => item.kind === kind); if (!adapter) return { contentHash }; try { const perceptual = await adapter.fingerprint(value); return perceptual ? { contentHash, perceptual } : { contentHash }; } catch { return { contentHash }; } }
  remember(fingerprint: string, entry: SafetyCacheEntry): void { if (fingerprint) this.known.set(fingerprint.slice(0, 256), clone(entry)); }
  lookup(fingerprint: string): SafetyCacheEntry | undefined { const value = this.known.get(fingerprint.slice(0, 256)); return value ? clone(value) : undefined; }
}

export interface SafetyRuleInput { readonly text?: string; readonly mimeType?: string; readonly context?: SafetyContext; readonly relationship?: SafetyRelationshipSignals; readonly sourceType?: string; }
export interface SafetyRuleResult { readonly labels: readonly SafetyLabel[]; readonly evidence: readonly SafetyEvidence[]; readonly context: SafetyContext; readonly uncertain: boolean; readonly normalizedText: string; readonly urls: readonly string[]; }

/** Bounded, context-aware rules. It is intentionally a first pass, not a claim of perfect moderation. */
export class SafetyRuleEngine {
  constructor(private readonly maxChars = 32_768) {}
  evaluate(input: SafetyRuleInput): SafetyRuleResult {
    const normalized = normalizeText((input.text ?? '').slice(0, this.maxChars));
    const context = normalizeContext(input.context);
    const relationship = input.relationship ?? {};
    const evidence: SafetyEvidence[] = [];
    const categories = new Set<SafetyCategory>();
    const add = (category: SafetyCategory, reason: string, confidence: SafetyConfidence = 'MEDIUM', categoryContext = context) => { categories.add(category); evidence.push({ kind: 'RULE', id: `rule:${category.toLowerCase()}`, category, context: categoryContext, confidence, reason }); };
    const match = (patterns: readonly string[]): boolean => patterns.some(pattern => normalized.includes(pattern));
    if (match(['porn', 'pornograph', 'explicit nude', 'sexual service', 'sex video'])) add('ADULT_SEXUAL', 'sexual terms detected', 'HIGH');
    if (match(['nude', 'nudity', 'моя голая', 'обнаж'])) add('EXPLICIT_NUDITY', 'nudity terms detected', 'MEDIUM');
    if (match(['sexualized', 'sexy content', 'suggestive sexual'])) add('SEXUALIZED_CONTENT', 'sexualized content terms detected', 'MEDIUM');
    if (match(['rape', 'kill you', 'i will find you', 'doxx', 'doxing', 'угрожаю'])) add('TARGETED_ABUSE', 'targeted threat or abuse terms detected', 'MEDIUM', 'TARGETED_PERSON');
    if (match(['stalk', 'follow you home', 'преслед'])) add('STALKING', 'stalking terms detected', 'MEDIUM', 'TARGETED_PERSON');
    if (match(['circumvent block', 'evade block', 'new account after block', 'обойди блок'])) add('BLOCK_EVASION', 'block evasion terms detected', 'HIGH');
    if (match(['graphic gore', 'beheading', 'blood everywhere', 'расчлен'])) add('GRAPHIC_VIOLENCE', 'graphic violence terms detected', 'HIGH');
    if (match(['real violence', 'massacre', 'массакр'])) add('REAL_WORLD_VIOLENCE', 'real-world violence terms detected', 'MEDIUM', 'REAL_WORLD');
    if (match(['war footage', 'battlefield', 'armed conflict', 'военн'])) add('CURRENT_ARMED_CONFLICT', 'current conflict terms detected', 'MEDIUM', context === 'HISTORICAL' ? 'HISTORICAL' : context);
    if (match(['combat', 'fighter jet', 'battle'])) add('COMBAT_CONTENT', 'combat terms detected', 'MEDIUM');
    if (match(['election', 'campaign', 'vote for', 'выбор'])) add('POLITICAL_CONTENT', 'political terms detected', 'MEDIUM');
    if (match(['vote for me', 'elect me', 'donate to campaign'])) add('POLITICAL_CAMPAIGNING', 'campaign solicitation detected', 'MEDIUM', 'PROMOTIONAL');
    if (match(['terrorist manifesto', 'join extremist', 'нацист'])) add('EXTREMIST_CONTENT', 'extremist terms detected', 'MEDIUM');
    if (match(['suicide', 'self harm', 'cut myself', 'самоуб'])) add('GRAPHIC_SELF_HARM', 'self-harm terms detected', 'MEDIUM');
    if (match(['scam', 'phishing', 'malware', 'password reset urgently', 'crypto giveaway'])) add('MALICIOUS_OR_DECEPTIVE_CONTENT', 'deceptive or malicious terms detected', 'HIGH');
    if (match(['idiot', 'loser', 'harass', 'insult'])) add('HARASSMENT', 'harassment terms detected', 'LOW');
    if (relationship.explicitlyUnwanted || relationship.afterBlock) add(relationship.afterBlock ? 'BLOCK_EVASION' : 'HARASSMENT', relationship.afterBlock ? 'contact after block' : 'recipient marked contact unwanted', 'HIGH');
    if ((relationship.repeatedContact ?? false) || (relationship.repeatedInvites ?? 0) > 3 || (relationship.rapidRequests ?? 0) > 5) add('HARASSMENT', 'repeated unsolicited behavior metadata', 'HIGH');
    const urls = normalized.match(/https?:\/\/[^\s<]{1,512}/g) ?? [];
    if (urls.some(url => /bit\.ly|tinyurl|\.zip\b|login-|verify-/i.test(url))) add('MALICIOUS_OR_DECEPTIVE_CONTENT', 'suspicious URL pattern', 'MEDIUM');
    const labels = [...categories].map(category => ({ category, state: 'SAFE' as const, confidence: evidence.find(item => item.category === category)?.confidence ?? 'MEDIUM', context, evidence: evidence.filter(item => item.category === category) }));
    const uncertain = !normalized && input.mimeType !== undefined && !/^text\//.test(input.mimeType) || labels.some(label => toConfidenceNumber(label.confidence) < 0.5);
    return { labels, evidence, context, uncertain, normalizedText: normalized, urls: [...new Set(urls)].slice(0, 32) };
  }
}

export interface SafetyClassifierInput { readonly contentHash: string; readonly boundedContent: string; readonly domain: ContentDomain; readonly context: SafetyContext; readonly mimeType?: string; }
export interface SafetyClassifierResult { readonly labels: readonly SafetyLabel[]; readonly confidence: SafetyConfidence; readonly evidence?: readonly SafetyEvidence[]; readonly uncertain?: boolean; }
export interface SafetyClassifierAdapter { readonly id: string; readonly version: string; readonly kind: 'text' | 'image' | 'video' | 'audio' | 'violence' | 'nudity' | 'topic' | 'harassment'; classify(input: SafetyClassifierInput): Promise<SafetyClassifierResult>; }
export type TextSafetyClassifier = SafetyClassifierAdapter;
export type ImageSafetyClassifier = SafetyClassifierAdapter;
export type ViolenceClassifier = SafetyClassifierAdapter;
export type NudityClassifier = SafetyClassifierAdapter;
export type TopicClassifier = SafetyClassifierAdapter;
export type HarassmentClassifier = SafetyClassifierAdapter;

export interface SafetyMediaSample { readonly kind: 'metadata' | 'keyframe' | 'audio-segment'; readonly atMs?: number; readonly bytes?: Uint8Array | string; readonly metadata?: Readonly<Record<string, string | number | boolean>>; }
export interface MediaSafetySamplerOptions { readonly maxFrames?: number; readonly maxDecodedBytes?: number; readonly maxDurationMs?: number; readonly maxDepth?: number; }
export interface MediaSafetySampler { sample(input: { content: unknown; mimeType?: string }, options: MediaSafetySamplerOptions): Promise<readonly SafetyMediaSample[]>; }
export interface LocalAISafetyReview { review(input: SafetyClassifierInput): Promise<SafetyClassifierResult>; }

export type SafetyRuntimeStatus = 'AVAILABLE' | 'LIMITED' | 'LOCAL_AI_RECOMMENDED' | 'LOCAL_AI_REQUIRED';
export interface SafetyRuntimeMetrics { readonly evaluated: number; readonly cacheHits: number; readonly deterministicResolutions: number; readonly fingerprintResolutions: number; readonly classifierResolutions: number; readonly targetedMediaAnalyses: number; readonly localAIEscalations: number; readonly quarantined: number; readonly classificationFailures: number; readonly averageProcessingMs: number; }
export interface SafetyAuditRecord { readonly version: 1; readonly id: string; readonly timestamp: string; readonly decision: SafetyDecision; readonly category?: SafetyCategory; readonly domain: ContentDomain; readonly sourceType: string; readonly policyVersion: string; readonly classifierVersion: string; readonly action: 'EVALUATE' | 'SHARE' | 'BLOCK' | 'QUARANTINE' | 'INDEX' | 'DISPLAY' | 'BEHAVIOR'; readonly contentHash: string; readonly objectId: string; readonly reason?: string; }
export class SafetyAuditLog {
  private readonly records: SafetyAuditRecord[] = [];
  constructor(private readonly maxEntries = 4_096) {}
  append(record: Omit<SafetyAuditRecord, 'version'> & { version?: 1 }): void { this.records.push({ version: 1, ...record }); while (this.records.length > this.maxEntries) this.records.shift(); }
  list(): readonly SafetyAuditRecord[] { return this.records.map(clone); }
  clear(): void { this.records.length = 0; }
}

export interface SafetyRuntimeOptions {
  readonly policy?: SafetyPolicyController;
  readonly mandatoryPolicy?: MandatorySafetyPolicy;
  readonly userPreferences?: Partial<UserSafetyPreferences>;
  readonly cache?: SafetyCache;
  readonly rules?: SafetyRuleEngine;
  readonly fingerprints?: SafetyFingerprintService;
  readonly classifiers?: readonly SafetyClassifierAdapter[];
  readonly mediaSampler?: MediaSafetySampler;
  readonly localAIReview?: LocalAISafetyReview;
  readonly now?: () => number;
  readonly classifierVersion?: string;
  readonly maxInputBytes?: number;
  readonly audit?: SafetyAuditLog;
  readonly onSafetyReview?: (request: SafetyClassifierInput) => Promise<SafetyClassifierResult | undefined>;
  /** Optional shared scheduler boundary; no model weights are owned here. */
  readonly scheduler?: AIResourceScheduler;
}

/** Main recipient-local, fail-closed safety pipeline. */
export class SafetyRuntime {
  readonly policy: SafetyPolicyController;
  readonly cache: SafetyCache;
  readonly rules: SafetyRuleEngine;
  readonly fingerprints: SafetyFingerprintService;
  readonly audit: SafetyAuditLog;
  private readonly classifiers: readonly SafetyClassifierAdapter[];
  private readonly mediaSampler?: MediaSafetySampler;
  private readonly localAIReview?: LocalAISafetyReview;
  private readonly onSafetyReview?: SafetyRuntimeOptions['onSafetyReview'];
  private readonly scheduler?: AIResourceScheduler;
  private readonly now: () => number;
  private readonly classifierVersion: string;
  private readonly maxInputBytes: number;
  private metricsState: { evaluated: number; cacheHits: number; deterministicResolutions: number; fingerprintResolutions: number; classifierResolutions: number; targetedMediaAnalyses: number; localAIEscalations: number; quarantined: number; classificationFailures: number; totalProcessingMs: number } = { evaluated: 0, cacheHits: 0, deterministicResolutions: 0, fingerprintResolutions: 0, classifierResolutions: 0, targetedMediaAnalyses: 0, localAIEscalations: 0, quarantined: 0, classificationFailures: 0, totalProcessingMs: 0 };
  private readonly personalObjects = new Map<string, unknown>();
  constructor(options: SafetyRuntimeOptions = {}) { this.policy = options.policy ?? new SafetyPolicyController(options.mandatoryPolicy, options.userPreferences); this.cache = options.cache ?? new SafetyCache(); this.rules = options.rules ?? new SafetyRuleEngine(); this.fingerprints = options.fingerprints ?? new SafetyFingerprintService(); this.audit = options.audit ?? new SafetyAuditLog(); this.classifiers = options.classifiers ?? []; this.mediaSampler = options.mediaSampler; this.localAIReview = options.localAIReview; this.onSafetyReview = options.onSafetyReview; this.scheduler = options.scheduler; this.now = options.now ?? Date.now; this.classifierVersion = options.classifierVersion ?? 'ruleset-r0p56.1'; this.maxInputBytes = Math.max(1_024, Math.min(16 * 1024 * 1024, options.maxInputBytes ?? 2 * 1024 * 1024)); }
  status(): SafetyRuntimeStatus { return this.localAIReview || this.onSafetyReview ? 'AVAILABLE' : this.classifiers.length ? 'LIMITED' : 'LOCAL_AI_RECOMMENDED'; }
  metrics(): SafetyRuntimeMetrics { const count = this.metricsState.evaluated; return { ...this.metricsState, averageProcessingMs: count ? this.metricsState.totalProcessingMs / count : 0 } as SafetyRuntimeMetrics; }
  personalCopy<T>(objectId: string): T | undefined { return this.personalObjects.has(objectId) ? clone(this.personalObjects.get(objectId) as T) : undefined; }
  async evaluate<T = unknown>(request: SafetyEvaluationRequest<T>): Promise<SafetyEvaluation<T>> {
    const started = this.now(); this.metricsState.evaluated++;
    try {
      await this.policy.ready();
      if (!isContentDomain(request.domain) || (request.objectId !== undefined && (typeof request.objectId !== 'string' || request.objectId.length > 256))) throw new SafetyRuntimeError('INVALID_ARGUMENT', 'Malformed safety request');
      const objectId = request.objectId ?? `object:${await digest(canonicalJson(request.content ?? request.value ?? ''))}`;
      if (sharedDomains.has(request.domain) && (request.verified === false || request.authorized === false)) throw new SafetyRuntimeError('UNAUTHORIZED', 'Shared content must be verified and authorized before safety evaluation');
      const value = request.value ?? request.content as T | undefined;
      if (request.domain === 'PERSONAL_LOCAL' || request.domain === 'PRIVATE_SELF') this.personalObjects.set(objectId, clone(value));
      const contentValue = request.content ?? request.value ?? request.text ?? '';
      const bounded = contentValue instanceof Uint8Array ? contentValue.slice(0, Math.min(contentValue.length, request.maxBytes ?? this.maxInputBytes)) : boundedText(contentValue, Math.min(request.maxBytes ?? this.maxInputBytes, this.maxInputBytes));
      if (!boundedText(bounded).trim() && !request.mimeType) throw new SafetyRuntimeError('CLASSIFICATION_FAILED', 'Safety input has no bounded content');
      if (contentValue instanceof Uint8Array && contentValue.length > this.maxInputBytes) throw new SafetyRuntimeError('LIMIT_EXCEEDED', 'Safety input exceeds bounded analysis budget');
      const fingerprint = await this.fingerprints.fingerprint(bounded, request.mimeType);
      const contentHash = request.contentHash ?? fingerprint.contentHash;
      if (request.contentHash && request.contentHash !== fingerprint.contentHash && request.value !== undefined) throw new SafetyRuntimeError('CLASSIFICATION_FAILED', 'Content hash does not match bytes');
      const sourceType = request.sourceType ?? 'unknown';
      const scope = request.sharing === false || !sharedDomains.has(request.domain) ? request.domain : request.domain;
      if ((scope === 'PERSONAL_LOCAL' || scope === 'PRIVATE_SELF') && !request.sharing) {
        const token = await this.createToken(contentHash, objectId, scope, 'ALLOW', 'SAFE');
        const personal = this.makeResult(request, objectId, contentHash, value, sourceType, 'ALLOW', 'SAFE', [], [], token, false, true);
        this.recordAudit(personal, 'EVALUATE', 'personal domain is owner-local');
        return personal;
      }
      await this.cache.ready();
      const cachedCandidate = await this.cache.getAsync(contentHash, this.policy.mandatory.version, this.classifierVersion);
      const requestedContext = normalizeContext(request.context);
      const cached = cachedCandidate && cachedCandidate.metadata?.domain === request.domain && cachedCandidate.metadata?.context === requestedContext ? cachedCandidate : undefined;
      if (cached) {
        this.metricsState.cacheHits++;
        const cachedLifecycle = cached.lifecycle ?? lifecycleFor(cached.decision);
        const token = await this.createToken(contentHash, objectId, request.domain, cached.decision, cachedLifecycle);
        const result = this.makeResult(request, objectId, contentHash, value, sourceType, cached.decision, cachedLifecycle, cached.labels, cached.evidence, token, true, this.personalObjects.has(objectId));
        if (!protectedDecisions.has(cached.decision)) this.metricsState.quarantined++;
        this.recordAudit(result, 'EVALUATE', 'current safety cache entry');
        return result;
      }
      const ruleResult = this.rules.evaluate({ text: request.text ?? boundedText(bounded), mimeType: request.mimeType, context: request.context, relationship: request.relationship, sourceType });
      let labels = [...ruleResult.labels]; let evidence = [...ruleResult.evidence]; let uncertain = ruleResult.uncertain;
      const known = fingerprint.perceptual ? this.fingerprints.lookup(fingerprint.perceptual) : undefined;
      if (known && fingerprint.perceptual && known.metadata?.domain === request.domain && known.metadata?.context === ruleResult.context) { this.metricsState.fingerprintResolutions++; labels = [...known.labels]; evidence = [...known.evidence, { kind: 'FINGERPRINT', id: fingerprint.perceptual, confidence: known.confidence, reason: 'known local fingerprint match' }]; uncertain = false; }
      if (!known && (uncertain || !labels.length) && this.classifiers.length) {
        for (const classifier of this.classifiers.slice(0, 8)) {
          try { const classified = await classifier.classify({ contentHash, boundedContent: typeof bounded === 'string' ? bounded.slice(0, 16_384) : boundedText(bounded, 16_384), domain: request.domain, context: ruleResult.context, mimeType: request.mimeType }); const normalized = normalizeLabels(classified.labels); labels = mergeLabels(labels, normalized); evidence.push(...normalizeEvidence(classified.evidence, 'CLASSIFIER')); uncertain = Boolean(classified.uncertain) || uncertain; this.metricsState.classifierResolutions++; } catch { uncertain = true; }
        }
      }
      if (!known && !this.classifiers.length && request.mimeType && !request.mimeType.startsWith('text/') && this.mediaSampler) {
        this.metricsState.targetedMediaAnalyses++;
        try { const samples = await this.mediaSampler.sample({ content: bounded, mimeType: request.mimeType }, { maxFrames: 8, maxDecodedBytes: 2 * 1024 * 1024, maxDurationMs: 60_000, maxDepth: 2 }); for (const sample of samples.slice(0, 8)) { const sampleText = boundedText(sample.bytes ?? sample.metadata ?? '', 4_096); const sampleRules = this.rules.evaluate({ text: sampleText, context: ruleResult.context, mimeType: request.mimeType }); labels = mergeLabels(labels, sampleRules.labels); evidence.push(...sampleRules.evidence.map(item => ({ ...item, kind: 'MEDIA_SAMPLE' as const }))); uncertain = uncertain || sampleRules.uncertain; } } catch { uncertain = true; }
      }
      if (uncertain && (this.localAIReview || this.onSafetyReview) && sharedDomains.has(request.domain)) {
        this.metricsState.localAIEscalations++;
        try { const input: SafetyClassifierInput = { contentHash, boundedContent: typeof bounded === 'string' ? bounded.slice(0, 16_384) : boundedText(bounded, 16_384), domain: request.domain, context: ruleResult.context, mimeType: request.mimeType }; const review = this.localAIReview ? () => this.localAIReview!.review(input) : this.onSafetyReview ? () => this.onSafetyReview!(input) : undefined; const reviewed = review ? this.scheduler ? await this.scheduler.run({ agentId: 'keystone-safety', model: { provider: 'local', model: 'safety-review' }, priority: 'SAFETY_REVIEW', kind: 'safety-review', timeoutMs: 30_000, handler: async () => review() }) : await review() : undefined; if (reviewed) { labels = mergeLabels(labels, normalizeLabels(reviewed.labels)); evidence.push(...normalizeEvidence(reviewed.evidence, 'LOCAL_AI')); uncertain = Boolean(reviewed.uncertain); } } catch { uncertain = true; }
      }
      const effectiveLabels = labels.length ? labels : (uncertain ? [{ category: 'UNKNOWN' as const, state: 'UNCERTAIN' as const, confidence: 'LOW' as const, context: ruleResult.context, evidence: [] }] : []);
      const decisionResult = this.policy.evaluate(request.domain, effectiveLabels, ruleResult.context, uncertain);
      const lifecycle = lifecycleFor(decisionResult.decision);
      const confidence = labels.length ? confidenceName(Math.min(...labels.map(label => toConfidenceNumber(label.confidence)))) : 'LOW';
      const cacheEntry: SafetyCacheEntry = { contentHash, policyVersion: this.policy.mandatory.version, classifierVersion: this.classifierVersion, decision: decisionResult.decision, labels, confidence, evidence, lifecycle, analyzedAt: nowIso(), metadata: { sourceType, domain: request.domain, context: ruleResult.context } };
      await this.cache.put(cacheEntry); if (fingerprint.perceptual) this.fingerprints.remember(fingerprint.perceptual, cacheEntry);
      if (!protectedDecisions.has(decisionResult.decision)) this.metricsState.quarantined++;
      if (decisionResult.decision === 'CLASSIFICATION_FAILED') this.metricsState.classificationFailures++; else if (!uncertain && !known) this.metricsState.deterministicResolutions++;
      const token = await this.createToken(contentHash, objectId, request.domain, decisionResult.decision, lifecycle);
      const result = this.makeResult(request, objectId, contentHash, value, sourceType, decisionResult.decision, lifecycle, labels, evidence, token, false, this.personalObjects.has(objectId));
      this.recordAudit(result, 'EVALUATE', decisionResult.reason);
      return result;
    } catch (error) {
      if (error instanceof SafetyRuntimeError && error.code === 'LIMIT_EXCEEDED') throw error;
      const objectId = request.objectId ?? 'unknown'; const contentHash = request.contentHash ?? 'unknown'; this.metricsState.classificationFailures++;
      const token = await this.createToken(contentHash, objectId, isContentDomain(request.domain) ? request.domain : 'PUBLIC', 'CLASSIFICATION_FAILED', 'CLASSIFICATION_FAILED');
      const failed = this.makeResult(request, objectId, contentHash, request.value, request.sourceType ?? 'unknown', 'CLASSIFICATION_FAILED', 'CLASSIFICATION_FAILED', [{ category: 'UNKNOWN', state: 'UNCERTAIN', confidence: 'LOW', context: 'UNKNOWN', evidence: [] }], [], token, false, false);
      this.recordAudit(failed, 'QUARANTINE', error instanceof Error ? error.message.slice(0, 256) : 'classification failed');
      return failed;
    } finally { this.metricsState.totalProcessingMs += Math.max(0, this.now() - started); }
  }
  async preflightShare<T>(request: Omit<SafetyEvaluationRequest<T>, 'sharing'>): Promise<SafetyEvaluation<T>> { return this.evaluate({ ...request, sharing: true }); }
  async classify<T>(request: SafetyEvaluationRequest<T>): Promise<SafetyEvaluation<T>> { return this.evaluate(request); }
  async evaluateObject<T>(request: SafetyEvaluationRequest<T>): Promise<SafetyEvaluation<T>> { return this.evaluate(request); }
  async validateToken(token: SafetyDecisionToken, request: Pick<SafetyEvaluationRequest, 'objectId' | 'contentHash' | 'domain'>): Promise<boolean> { if (!token || token.version !== 1 || !isContentDomain(token.domain) || !isDecision(token.decision)) return false; if (token.objectId !== request.objectId || token.contentHash !== request.contentHash || token.domain !== request.domain || token.policyVersion !== this.policy.mandatory.version || token.classifierVersion !== this.classifierVersion || !protectedDecisions.has(token.decision)) return false; const expected = await this.tokenIntegrity(token); return expected === token.integrity; }
  async toSurfaceEligible<T>(evaluated: SafetyEvaluatedObject<T>): Promise<SurfaceEligibleObject<T>> { if (!evaluated.token || !protectedDecisions.has(evaluated.decision) || !(await this.validateToken(evaluated.token, evaluated))) throw new SafetyRuntimeError('STALE_TOKEN', 'Safety token is absent, stale or not eligible for a protected surface'); const decision = evaluated.decision as 'ALLOW' | 'ALLOW_WITH_WARNING'; return { ...evaluated, kind: 'SurfaceEligibleObject', decision, token: evaluated.token }; }
  private async createToken(contentHash: string, objectId: string, domain: ContentDomain, decision: SafetyDecision, lifecycle: SafetyLifecycleState): Promise<SafetyDecisionToken> { const unsigned = { version: 1 as const, contentHash, objectId, domain, classifierVersion: this.classifierVersion, policyVersion: this.policy.mandatory.version, timestamp: new Date(this.now()).toISOString(), decision, lifecycle }; return { ...unsigned, integrity: await this.tokenIntegrity(unsigned) }; }
  private async tokenIntegrity(value: Omit<SafetyDecisionToken, 'integrity'> | SafetyDecisionToken): Promise<string> { const { integrity: _ignored, ...unsigned } = value as SafetyDecisionToken; return digest(canonicalJson(unsigned)); }
  private makeResult<T>(request: SafetyEvaluationRequest<T>, objectId: string, contentHash: string, value: T | undefined, sourceType: string, decision: SafetyDecision, lifecycle: SafetyLifecycleState, labels: readonly SafetyLabel[], evidence: readonly SafetyEvidence[], token: SafetyDecisionToken, fromCache: boolean, personalPreserved: boolean): SafetyEvaluation<T> { const confidence = labels.length ? confidenceName(Math.min(...labels.map(label => toConfidenceNumber(label.confidence)))) : 'LOW'; const authorized = request.authorized !== false; const verified = request.verified !== false; const raw: RawIncomingObject<T> = { kind: 'RawIncomingObject', objectId, contentHash, domain: request.domain, value: clone(value as T), receivedAt: nowIso() }; const verifiedObject: VerifiedObject<T> = { ...raw, kind: 'VerifiedObject', verifiedBy: verified ? 'SIGNATURE' : 'LOCAL_SOURCE' }; const authorizedObject: AuthorizedObject<T> = { ...verifiedObject, kind: 'AuthorizedObject', authorizationScope: request.authorizationScope ?? (authorized ? 'surface-preflight' : 'none') }; return { ...authorizedObject, kind: 'SafetyEvaluatedObject', decision, lifecycle, labels: clone(labels), token, object: clone(value), contentHash, sourceType, confidence, evidence: clone(evidence), fromCache, personalPreserved, }; }
  private recordAudit(result: SafetyEvaluation, action: SafetyAuditRecord['action'], reason: string): void { this.audit.append({ id: `safety:${result.objectId}:${this.metricsState.evaluated}`, timestamp: nowIso(), decision: result.decision, category: result.labels[0]?.category, domain: result.domain, sourceType: result.sourceType, policyVersion: this.policy.mandatory.version, classifierVersion: this.classifierVersion, action, contentHash: result.contentHash, objectId: result.objectId, reason: reason.slice(0, 512) }); }
}

function mergeLabels(left: readonly SafetyLabel[], right: readonly SafetyLabel[]): SafetyLabel[] { const map = new Map<SafetyCategory, SafetyLabel>(); for (const item of [...left, ...right]) { const current = map.get(item.category); if (!current || toConfidenceNumber(item.confidence) > toConfidenceNumber(current.confidence) || item.state === 'UNCERTAIN') map.set(item.category, { ...item, evidence: [...(current?.evidence ?? []), ...item.evidence].slice(0, 32) }); } return [...map.values()]; }
function lifecycleFor(decision: SafetyDecision): SafetyLifecycleState { if (decision === 'ALLOW' || decision === 'ALLOW_WITH_WARNING') return 'SAFE'; if (decision === 'CLASSIFICATION_FAILED') return 'CLASSIFICATION_FAILED'; if (decision === 'QUARANTINE' || decision === 'NEEDS_LOCAL_REVIEW') return 'QUARANTINED'; if (decision === 'HIDE_BY_DEFAULT') return 'RESTRICTED'; return 'BLOCKED'; }

export class SafetySurfaceIndex<T = unknown> {
  private readonly entries = new Map<string, SurfaceEligibleObject<T>>();
  constructor(private readonly validate?: (value: SurfaceEligibleObject<T>) => boolean | Promise<boolean>) {}
  async add(value: SurfaceEligibleObject<T>): Promise<boolean> {
    if (!value || value.kind !== 'SurfaceEligibleObject' || !value.token || !/^(?:[a-f0-9]{64}|fallback-[a-f0-9]{8})$/i.test(value.token.integrity) || !protectedDecisions.has(value.decision)) return false;
    if (value.token.objectId !== value.objectId || value.token.contentHash !== value.contentHash || value.token.domain !== value.domain || value.token.decision !== value.decision) return false;
    // Even the legacy index path must not accept a token whose bound fields were
    // changed after issuance. A runtime-backed MandatorySafetySurfaceRegistry
    // additionally checks the current policy/classifier versions.
    const { integrity: _integrity, ...unsigned } = value.token;
    if (await digest(canonicalJson(unsigned)) !== value.token.integrity) return false;
    if (this.validate && !(await this.validate(value))) return false;
    if (this.entries.has(value.objectId)) return false;
    this.entries.set(value.objectId, clone(value)); return true;
  }
  remove(objectId: string): void { this.entries.delete(objectId); }
  has(objectId: string): boolean { return this.entries.has(objectId); }
  get(objectId: string): SurfaceEligibleObject<T> | undefined { const value = this.entries.get(objectId); return value && clone(value); }
  values(): readonly SurfaceEligibleObject<T>[] { return [...this.entries.values()].map(clone); }
  clear(): void { this.entries.clear(); }
}

/** Shared adapter for display, indexing, preview and publication boundaries. */
export class SafetySurfaceGate {
  constructor(private readonly runtime: SafetyRuntime) {}
  async beforeDisplay<T>(request: SafetyEvaluationRequest<T>): Promise<SurfaceEligibleObject<T> | undefined> { try { const evaluated = await this.runtime.evaluate(request); return isProtectedDecision(evaluated.decision) ? await this.runtime.toSurfaceEligible(evaluated) : undefined; } catch { return undefined; } }
  async beforeIndex<T>(request: SafetyEvaluationRequest<T>): Promise<SurfaceEligibleObject<T> | undefined> { return this.beforeDisplay(request); }
  async beforeShare<T>(request: Omit<SafetyEvaluationRequest<T>, 'sharing'>): Promise<SurfaceEligibleObject<T> | undefined> { const evaluated = await this.runtime.preflightShare(request); return isProtectedDecision(evaluated.decision) ? this.runtime.toSurfaceEligible(evaluated) : undefined; }
  /**
   * Surface-aware entry point used by mandatory protected adapters. Keeping the
   * surface name in this call makes it impossible for a caller to accidentally
   * treat a generic classification as permission to render/index it.
   */
  async beforeSurface<T>(surface: string, request: SafetyEvaluationRequest<T>): Promise<SurfaceEligibleObject<T> | undefined> {
    if (!surface || !isSharedDomain(request.domain)) return undefined;
    return this.beforeDisplay(request);
  }
  /** Re-validates an already evaluated value against the current runtime. */
  async acceptEvaluated<T>(value: unknown): Promise<SurfaceEligibleObject<T> | undefined> {
    if (!isSurfaceEligible<T>(value)) return undefined;
    try { return await this.runtime.toSurfaceEligible(value as unknown as SafetyEvaluatedObject<T>); } catch { return undefined; }
  }
}
export const ContentSafetyGate = SafetySurfaceGate;

export type BehaviorSafetyState = 'NORMAL' | 'REPEATED_CONTACT' | 'UNWANTED_CONTACT' | 'BLOCK_EVASION' | 'HARASSMENT_PATTERN' | 'SEVERE_RESTRICTION';
export type BehaviorInteractionKind = 'dm' | 'invite' | 'visit' | 'task' | 'mention' | 'presence' | 'location' | 'notification' | 'discovery' | 'recommendation' | 'room' | 'negotiation';
export interface BehaviorObservation { readonly peer: string; readonly kind: BehaviorInteractionKind; readonly at?: number; readonly knownContact?: boolean; readonly explicitlyUnwanted?: boolean; readonly afterBlock?: boolean; readonly targetRequested?: boolean; readonly rapid?: boolean; }
export interface BehaviorSnapshot { readonly peer: string; readonly state: BehaviorSafetyState; readonly score: number; readonly blocked: boolean; readonly muted: boolean; readonly observations: number; readonly lastAt?: number; }
export interface BehaviorStateStore { read(): Promise<unknown | undefined>; write(value: unknown): Promise<void>; }
export class InMemoryBehaviorStateStore implements BehaviorStateStore { private value?: unknown; async read() { return clone(this.value); } async write(value: unknown) { this.value = clone(value); } }

/** Recipient-local behavior protection; it does not infer real-world identity. */
export class BehaviorSafetyService {
  private readonly states = new Map<string, { observations: BehaviorObservation[]; blocked: boolean; muted: boolean }>();
  private readonly readyPromise: Promise<void>;
  private writes: Promise<void> = Promise.resolve();
  constructor(private readonly options: { store?: BehaviorStateStore; now?: () => number; maxPeers?: number; windowMs?: number } = {}) { this.readyPromise = this.hydrate(); }
  async ready(): Promise<void> { await this.readyPromise; }
  async observe(input: BehaviorObservation): Promise<BehaviorSnapshot> { await this.ready(); if (!input.peer || !input.kind) throw new SafetyRuntimeError('INVALID_ARGUMENT', 'Behavior observation requires a peer and kind'); const at = input.at ?? (this.options.now?.() ?? Date.now()); const state = this.states.get(input.peer) ?? { observations: [], blocked: false, muted: false }; state.observations = [...state.observations.filter(item => at - (item.at ?? at) <= (this.options.windowMs ?? 24 * 60 * 60_000)), { ...input, at }].slice(-64); this.states.set(input.peer, state); const snapshot = this.snapshot(input.peer); await this.persist(); return snapshot; }
  async block(peer: string): Promise<void> { await this.ready(); const state = this.states.get(peer) ?? { observations: [], blocked: false, muted: false }; state.blocked = true; this.states.set(peer, state); await this.persist(); }
  async unblock(peer: string): Promise<void> { await this.ready(); const state = this.states.get(peer); if (state) { state.blocked = false; this.states.set(peer, state); await this.persist(); } }
  async mute(peer: string, muted = true): Promise<void> { await this.ready(); const state = this.states.get(peer) ?? { observations: [], blocked: false, muted: false }; state.muted = muted; this.states.set(peer, state); await this.persist(); }
  snapshot(peer: string): BehaviorSnapshot { const state = this.states.get(peer) ?? { observations: [], blocked: false, muted: false }; const observations = state.observations; const afterBlock = observations.filter(item => item.afterBlock).length; const unwanted = observations.filter(item => item.explicitlyUnwanted).length; const rapid = observations.filter(item => item.rapid).length; const repeated = observations.length; let score = Math.min(100, repeated * 2 + afterBlock * 30 + unwanted * 12 + rapid * 8); let behaviorState: BehaviorSafetyState = 'NORMAL'; if (afterBlock > 0) behaviorState = 'BLOCK_EVASION'; else if (unwanted >= 3 || rapid >= 5) behaviorState = 'HARASSMENT_PATTERN'; else if (unwanted > 0) behaviorState = 'UNWANTED_CONTACT'; else if (repeated >= 5) behaviorState = 'REPEATED_CONTACT'; if (score >= 80) behaviorState = 'SEVERE_RESTRICTION'; return { peer, state: behaviorState, score, blocked: state.blocked, muted: state.muted, observations: repeated, lastAt: observations.at(-1)?.at }; }
  snapshots(): readonly BehaviorSnapshot[] { return [...this.states.keys()].map(peer => this.snapshot(peer)); }
  private async hydrate(): Promise<void> { const raw = await this.options.store?.read(); if (!raw || typeof raw !== 'object') return; const peers = (raw as { peers?: Record<string, unknown> }).peers; if (!peers || typeof peers !== 'object') return; for (const [peer, value] of Object.entries(peers).slice(0, this.options.maxPeers ?? 1_024)) { if (!value || typeof value !== 'object') continue; const candidate = value as { observations?: unknown; blocked?: unknown; muted?: unknown }; const observations = Array.isArray(candidate.observations) ? candidate.observations.filter(item => item && typeof item === 'object').slice(-64) as BehaviorObservation[] : []; this.states.set(peer, { observations, blocked: candidate.blocked === true, muted: candidate.muted === true }); } }
  private async persist(): Promise<void> { const store = this.options.store; if (!store) return; const snapshot = { version: 1 as const, peers: Object.fromEntries([...this.states.entries()].map(([peer, value]) => [peer, value])) }; const operation = this.writes.then(() => store.write(snapshot)); this.writes = operation.catch(() => undefined); await operation; }
}

export interface InteractionPolicySnapshot { readonly blocked: readonly string[]; readonly muted: readonly string[]; readonly unknownPeerQuota: number; }
export interface InteractionPolicyStore { read(): Promise<unknown | undefined>; write(value: unknown): Promise<void>; }
export class InMemoryInteractionPolicyStore implements InteractionPolicyStore { private value?: unknown; async read() { return clone(this.value); } async write(value: unknown) { this.value = clone(value); } }

/** Protocol-level block/mute consequences shared by chat, agents and discovery adapters. */
export class InteractionSafetyPolicy {
  private readonly blocked = new Set<string>(); private readonly muted = new Set<string>(); private readonly unknownRequests = new Map<string, number[]>(); private readonly readyPromise: Promise<void>; private writes: Promise<void> = Promise.resolve();
  constructor(private readonly options: { store?: InteractionPolicyStore; unknownPeerQuota?: number } = {}) { this.readyPromise = this.hydrate(); }
  async ready(): Promise<void> { await this.readyPromise; }
  async block(peer: string): Promise<void> { await this.ready(); if (!peer) throw new SafetyRuntimeError('INVALID_ARGUMENT', 'peer is required'); this.blocked.add(peer); await this.persist(); }
  async unblock(peer: string): Promise<void> { await this.ready(); this.blocked.delete(peer); await this.persist(); }
  async mute(peer: string, muted = true): Promise<void> { await this.ready(); if (muted) this.muted.add(peer); else this.muted.delete(peer); await this.persist(); }
  isBlocked(peer: string): boolean { return this.blocked.has(peer); }
  isMuted(peer: string): boolean { return this.muted.has(peer); }
  canInteract(input: { peer: string; kind: BehaviorInteractionKind }): boolean { if (this.blocked.has(input.peer)) return false; if (input.kind === 'location' || input.kind === 'presence' || input.kind === 'discovery' || input.kind === 'recommendation' || input.kind === 'notification') return !this.muted.has(input.peer); return true; }
  filterPresence<T extends { peer: string }>(values: readonly T[]): readonly T[] { return values.filter(value => this.canInteract({ peer: value.peer, kind: 'presence' })); }
  allowsDiscovery(peer: string): boolean { return !this.blocked.has(peer) && !this.muted.has(peer); }
  allowsNotification(peer: string): boolean { return !this.blocked.has(peer) && !this.muted.has(peer); }
  /** Conservative local quota for unknown peers; it is not an identity/reputation oracle. */
  canAcceptUnknown(peer: string, now = Date.now()): boolean { if (this.blocked.has(peer)) return false; const windowMs = 60 * 60_000; const values = (this.unknownRequests.get(peer) ?? []).filter(at => now - at < windowMs); const quota = this.options.unknownPeerQuota ?? 10; if (values.length >= Math.max(1, quota)) { this.unknownRequests.set(peer, values); return false; } values.push(now); this.unknownRequests.set(peer, values.slice(-Math.max(1, quota))); return true; }
  snapshot(): InteractionPolicySnapshot { return { blocked: [...this.blocked].sort(), muted: [...this.muted].sort(), unknownPeerQuota: this.options.unknownPeerQuota ?? 10 }; }
  private async hydrate(): Promise<void> { const value = await this.options.store?.read(); if (!value || typeof value !== 'object') return; const candidate = value as { blocked?: unknown; muted?: unknown }; if (Array.isArray(candidate.blocked)) candidate.blocked.filter(item => typeof item === 'string').slice(0, 10_000).forEach(item => this.blocked.add(item)); if (Array.isArray(candidate.muted)) candidate.muted.filter(item => typeof item === 'string').slice(0, 10_000).forEach(item => this.muted.add(item)); }
  private async persist(): Promise<void> { const store = this.options.store; if (!store) return; const operation = this.writes.then(() => store.write({ version: 1 as const, blocked: [...this.blocked], muted: [...this.muted] })); this.writes = operation.catch(() => undefined); await operation; }
}

/** Validate a lifecycle value before a surface adapter accepts it. */
export function isSurfaceEligible<T>(value: unknown): value is SurfaceEligibleObject<T> { if (!value || typeof value !== 'object') return false; const candidate = value as Partial<SurfaceEligibleObject<T>>; return candidate.kind === 'SurfaceEligibleObject' && typeof candidate.objectId === 'string' && typeof candidate.contentHash === 'string' && !!candidate.token && protectedDecisions.has(candidate.decision as SafetyDecision); }
export function isSharedDomain(domain: ContentDomain): boolean { return sharedDomains.has(domain); }
export function isProtectedDecision(decision: SafetyDecision): boolean { return protectedDecisions.has(decision); }
export function lifecycleForSafetyDecision(decision: SafetyDecision): SafetyLifecycleState { return lifecycleFor(decision); }

/** Small explicit domain boundary used by adapters before they construct a preflight request. */
export class DomainPolicy {
  classify(input: { visibility?: string; shared?: boolean; domain?: ContentDomain }): ContentDomain {
    if (input.domain && isContentDomain(input.domain)) return input.domain;
    if (input.shared === false || input.visibility === 'private') return 'PRIVATE_SELF';
    if (input.visibility === 'contacts') return 'DIRECT_SHARED';
    if (input.visibility === 'community') return 'COMMUNITY';
    return 'PUBLIC';
  }
  requiresSafety(domain: ContentDomain, sharing = true): boolean { return sharing && isSharedDomain(domain); }
  isPersonal(domain: ContentDomain): boolean { return domain === 'PERSONAL_LOCAL' || domain === 'PRIVATE_SELF'; }
}
export const SafetyDomainPolicy = DomainPolicy;

/** Explicit lifecycle transitions keep surfaces from accepting an unverified value. */
export function markVerified<T>(raw: RawIncomingObject<T>, verifiedBy: VerifiedObject<T>['verifiedBy'] = 'SIGNATURE'): VerifiedObject<T> {
  if (!raw || raw.kind !== 'RawIncomingObject' || !raw.objectId || !raw.contentHash || !isContentDomain(raw.domain)) throw new SafetyRuntimeError('INVALID_ARGUMENT', 'Invalid raw incoming object');
  return { ...clone(raw), kind: 'VerifiedObject', verifiedBy };
}
export function authorizeObject<T>(value: VerifiedObject<T>, authorizationScope: string): AuthorizedObject<T> {
  if (!value || value.kind !== 'VerifiedObject' || !authorizationScope || authorizationScope.length > 256) throw new SafetyRuntimeError('UNAUTHORIZED', 'Object authorization is required before safety evaluation');
  return { ...clone(value), kind: 'AuthorizedObject', authorizationScope };
}

export const SAFETY_INVARIANTS = [
  'UNCLASSIFIED_SHARED_NOT_SURFACED', 'SENDER_ATTESTATION_NOT_AUTHORITY',
  'PERSONAL_DATA_NOT_DESTROYED', 'NO_GENERATIVE_AI_REQUIRED',
  'MANDATORY_POLICY_IMMUTABLE', 'REMOTE_SETTINGS_DENIED',
  'SKILL_BYPASS_DENIED', 'BLOCKED_CONTENT_NOT_REINDEXED',
  'SAFETY_TOKEN_GRANTS_NO_CAPABILITY', 'HASH_CHANGE_INVALIDATES_TOKEN',
] as const;
export type SafetyInvariant = (typeof SAFETY_INVARIANTS)[number];

/** Small reusable assertion boundary for host/security suites. */
export class SafetyInvariantHarness {
  constructor(private readonly runtime: SafetyRuntime) {}
  async assertSurfaceEligible<T>(value: SafetyEvaluatedObject<T>): Promise<SurfaceEligibleObject<T>> { return this.runtime.toSurfaceEligible(value); }
  async assertTokenBound(token: SafetyDecisionToken, objectId: string, contentHash: string, domain: ContentDomain): Promise<void> { if (!(await this.runtime.validateToken(token, { objectId, contentHash, domain }))) throw new SafetyRuntimeError('STALE_TOKEN', 'Safety token is not bound to the supplied object'); }
  assertPersonalPreserved<T>(objectId: string, expected: T): void { const actual = this.runtime.personalCopy<T>(objectId); if (canonicalJson(actual) !== canonicalJson(expected)) throw new SafetyRuntimeError('CLASSIFICATION_FAILED', 'Personal copy was not preserved'); }
}
