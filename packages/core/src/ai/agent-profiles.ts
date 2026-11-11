/**
 * Public, owner-bound profiles for Personal AI agents.
 *
 * An AgentProfile is not a human account and it never creates a second
 * identity. The owner identity signs every revision and the mailbox supplies
 * authenticated recipient-bound delivery. Only explicit public/contact
 * profiles are exposed to peers; private revisions are local state and a
 * tombstone/revocation is the only metadata needed to remove an old listing.
 */
import { type CryptoProvider, signCanonical, verifyCanonical } from '../crypto.js';
import type { DeviceSessionKeys } from '../identity.js';
import type { NodeId } from '../types.js';
import {
  AgentMailbox,
  type AgentContact,
  type AgentMailboxStateStore,
  type AgentPresenceState,
  type AgentTrustMode,
  AGENT_PRESENCE_STATES,
  AGENT_TRUST_MODES,
} from './agent-social.js';
import type { AgentRef } from './visits.js';
import { MandatorySafetySurfaceRegistry } from '../security/safety-surfaces.js';
import { SafetyRuntime, SafetySurfaceGate } from '../security/content-safety.js';

export const AGENT_PROFILE_VERSION = 1 as const;
export const AGENT_PROFILE_MAX_LIFETIME_MS = 7 * 24 * 60 * 60_000;
export const AGENT_PROFILE_MAX_ITEMS = 64;
export const AGENT_PROFILE_MAX_AUDIT = 2_000;

export const AGENT_PROFILE_TYPES = ['Personal', 'Research', 'Coding', 'Automation', 'Community', 'Custom'] as const;
export type AgentProfileType = (typeof AGENT_PROFILE_TYPES)[number];
export const AGENT_PROFILE_VISIBILITIES = ['public', 'contacts', 'private'] as const;
export type AgentProfileVisibility = (typeof AGENT_PROFILE_VISIBILITIES)[number];
export const AGENT_PROFILE_STATUSES = ['active', 'tombstoned', 'revoked'] as const;
export type AgentProfileStatus = (typeof AGENT_PROFILE_STATUSES)[number];

export interface AgentProfilePresence {
  readonly state: AgentPresenceState;
  readonly acceptingTasks: boolean;
  readonly updatedAt: string;
  readonly expiresAt: string;
}

/** Only policy summary is public; it contains no contact lists or private rules. */
export interface AgentProfileTrustPolicy {
  readonly mode: AgentTrustMode;
  readonly acceptsVisits: boolean;
  readonly acceptsTasks: boolean;
  readonly acceptsRooms: boolean;
}

export interface AgentProfile {
  readonly version: 1;
  readonly agentId: string;
  readonly ownerIdentityId: NodeId;
  readonly displayName: string;
  readonly avatar?: string;
  readonly description: string;
  readonly agentType: AgentProfileType;
  readonly capabilitiesSummary: readonly string[];
  readonly interests: readonly string[];
  readonly specializations: readonly string[];
  readonly presence: AgentProfilePresence;
  readonly acceptsVisits: boolean;
  readonly acceptsTasks: boolean;
  readonly acceptsRooms: boolean;
  readonly trustPolicy: AgentProfileTrustPolicy;
  readonly visibility: AgentProfileVisibility;
  readonly status: AgentProfileStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly revision: number;
  /** Detached signature made by ownerIdentityId, not by a separate account. */
  readonly signature: string;
}

export interface AgentProfileInput {
  readonly agentId: string;
  readonly displayName: string;
  readonly avatar?: string;
  readonly description?: string;
  readonly agentType?: AgentProfileType;
  readonly capabilitiesSummary?: readonly string[];
  readonly interests?: readonly string[];
  readonly specializations?: readonly string[];
  readonly presence?: Partial<AgentProfilePresence>;
  readonly acceptsVisits?: boolean;
  readonly acceptsTasks?: boolean;
  readonly acceptsRooms?: boolean;
  readonly trustPolicy?: Partial<AgentProfileTrustPolicy>;
  readonly visibility?: AgentProfileVisibility;
}

export interface AgentProfileUpdate {
  readonly displayName?: string;
  readonly avatar?: string;
  readonly description?: string;
  readonly agentType?: AgentProfileType;
  readonly capabilitiesSummary?: readonly string[];
  readonly interests?: readonly string[];
  readonly specializations?: readonly string[];
  readonly presence?: Partial<AgentProfilePresence>;
  readonly acceptsVisits?: boolean;
  readonly acceptsTasks?: boolean;
  readonly acceptsRooms?: boolean;
  readonly trustPolicy?: Partial<AgentProfileTrustPolicy>;
  readonly visibility?: AgentProfileVisibility;
}

export interface AgentProfileAuditRecord {
  readonly version: 1;
  readonly id: string;
  readonly at: string;
  readonly event: 'profile.created' | 'profile.updated' | 'profile.received' | 'profile.tombstoned' | 'profile.revoked' | 'security.rejected';
  readonly outcome: 'accepted' | 'received' | 'denied';
  readonly agentId?: string;
  readonly ownerIdentityId?: NodeId;
  readonly peer?: NodeId;
  readonly reason?: string;
}

export interface AgentProfileSnapshot {
  readonly version: 1;
  readonly profiles: readonly AgentProfile[];
  readonly seenIds: readonly string[];
  readonly audit: readonly AgentProfileAuditRecord[];
}

export interface AgentProfileServiceOptions {
  readonly mailbox: AgentMailbox;
  readonly crypto: CryptoProvider;
  readonly local: DeviceSessionKeys;
  readonly storage?: AgentMailboxStateStore;
  readonly now?: () => number;
  readonly onProfile?: (profile: AgentProfile, peer?: NodeId) => void | Promise<void>;
  /** Agent social graph can hide blocked owners without changing human graph policy. */
  readonly isBlocked?: (agent: AgentRef) => boolean | Promise<boolean>;
  readonly protectedSurfaces?: MandatorySafetySurfaceRegistry;
}

export type AgentProfileEvent = Readonly<{ profile: AgentProfile; peer?: NodeId }>;

export class AgentProfileError extends Error {
  constructor(readonly code: 'INVALID_ARGUMENT' | 'INVALID_SIGNATURE' | 'INVALID_STATE' | 'UNAUTHORIZED' | 'DUPLICATE' | 'REPLAY' | 'NOT_FOUND' | 'POLICY_DENIED' | 'REVOKED', message: string) { super(message); this.name = 'AgentProfileError'; }
}

export const AGENT_PROTOCOL_RESULT_TYPES = ['AGENT_SUGGESTION', 'DERIVED_PREFERENCE', 'PUBLIC_INFORMATION', 'OWNER_CONFIRMED_DECISION'] as const;
export type AgentProtocolResultType = (typeof AGENT_PROTOCOL_RESULT_TYPES)[number];

export interface AgentOwnerConfirmation {
  readonly version: 1;
  readonly requestId: string;
  readonly ownerIdentityId: NodeId;
  readonly actionHash: string;
  readonly confirmedAt: string;
  readonly signature: string;
}

export interface AgentProtocolResult {
  readonly version: 1;
  readonly id: string;
  readonly agent: AgentRef;
  readonly ownerIdentityId: NodeId;
  readonly type: AgentProtocolResultType;
  readonly value: unknown;
  readonly dataClass: 'PUBLIC' | 'USER_EXPLICIT';
  readonly createdAt: string;
  readonly ownerConfirmation?: AgentOwnerConfirmation;
  readonly signature: string;
}

export class AgentProfileService {
  private readonly mailbox: AgentMailbox;
  private readonly crypto: CryptoProvider;
  private readonly local: DeviceSessionKeys;
  private readonly storage: AgentMailboxStateStore;
  private readonly now: () => number;
  private isBlocked?: AgentProfileServiceOptions['isBlocked'];
  private readonly onProfile?: AgentProfileServiceOptions['onProfile'];
  private readonly profiles = new Map<string, AgentProfile>();
  private readonly seenIds = new Set<string>();
  private readonly auditEntries: AgentProfileAuditRecord[] = [];
  private readonly listeners = new Set<(event: AgentProfileEvent) => void | Promise<void>>();
  private readonly unsubscribe: () => void;
  private readonly readyPromise: Promise<void>;
  private writes: Promise<void> = Promise.resolve();
  private readonly protectedSurfaces: MandatorySafetySurfaceRegistry;

  constructor(options: AgentProfileServiceOptions) {
    this.mailbox = options.mailbox; this.crypto = options.crypto; this.local = options.local; this.storage = options.storage ?? new InMemoryAgentProfileStateStore(); this.now = options.now ?? Date.now; this.isBlocked = options.isBlocked; this.onProfile = options.onProfile; this.protectedSurfaces = options.protectedSurfaces ?? new MandatorySafetySurfaceRegistry(new SafetySurfaceGate(new SafetyRuntime()));
    this.unsubscribe = this.mailbox.onAgentProfileMessage((peer, payload) => this.receive(peer, payload));
    this.readyPromise = this.hydrate();
  }

  async ready(): Promise<void> { await this.readyPromise; }
  close(): void { this.unsubscribe(); this.listeners.clear(); }
  subscribe(listener: (event: AgentProfileEvent) => void | Promise<void>): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  setBlockPolicy(isBlocked: AgentProfileServiceOptions['isBlocked']): void { this.isBlocked = isBlocked; }
  audit(): readonly AgentProfileAuditRecord[] { return this.auditEntries.map(clone); }
  /** Public snapshots must not expose a remote profile that skipped the PROFILES gate. */
  async snapshot(): Promise<AgentProfileSnapshot> {
    await this.ready();
    const local = await this.list({ ownerIdentityId: this.local.nodeId, includePrivate: true, includeInactive: true });
    const remote = await this.list({ includePrivate: false, includeInactive: true });
    const profiles = new Map<string, AgentProfile>();
    for (const profile of [...local, ...remote]) profiles.set(profileKey(profile.ownerIdentityId, profile.agentId), profile);
    // Private remote profiles and inactive profiles are retained as durable
    // lifecycle markers for restart/replay handling, but are never returned
    // by public display/index helpers. They do not carry surface eligibility.
    for (const profile of this.profiles.values()) {
      if (profile.ownerIdentityId !== this.local.nodeId && (profile.status !== 'active' || profile.visibility === 'private')) profiles.set(profileKey(profile.ownerIdentityId, profile.agentId), clone(profile));
    }
    return { version: 1, profiles: [...profiles.values()].map(clone), seenIds: [...this.seenIds].slice(-16_384), audit: this.auditEntries.map(clone) };
  }

  async create(input: AgentProfileInput): Promise<AgentProfile> {
    await this.ready(); const agentId = safeAgentId(input.agentId); if (this.profiles.has(profileKey(this.local.nodeId, agentId))) throw new AgentProfileError('DUPLICATE', 'Agent profile already exists');
    const createdAt = iso(this.now()); const profile = await this.signProfile({ version: 1, agentId, ownerIdentityId: this.local.nodeId, displayName: boundedText(input.displayName, 120), ...(input.avatar ? { avatar: boundedText(input.avatar, 2_048) } : {}), description: boundedText(input.description ?? '', 4_000, false), agentType: assertProfileType(input.agentType ?? 'Personal'), capabilitiesSummary: boundedList(input.capabilitiesSummary ?? []), interests: boundedList(input.interests ?? []), specializations: boundedList(input.specializations ?? []), presence: normalizePresence(input.presence, createdAt), acceptsVisits: input.acceptsVisits ?? true, acceptsTasks: input.acceptsTasks ?? true, acceptsRooms: input.acceptsRooms ?? true, trustPolicy: normalizeTrustPolicy(input.trustPolicy, input.acceptsVisits ?? true, input.acceptsTasks ?? true, input.acceptsRooms ?? true), visibility: assertVisibility(input.visibility ?? 'private'), status: 'active', createdAt, updatedAt: createdAt, revision: 1 });
    this.profiles.set(profileKey(profile.ownerIdentityId, profile.agentId), profile); this.record({ event: 'profile.created', outcome: 'accepted', agentId: profile.agentId, ownerIdentityId: profile.ownerIdentityId }); await this.persist(); this.emit(profile); return clone(profile);
  }
  async createAgentProfile(input: AgentProfileInput): Promise<AgentProfile> { return this.create(input); }

  async update(agentId: string, input: AgentProfileUpdate): Promise<AgentProfile> {
    await this.ready(); const current = this.requireLocal(agentId); if (current.status !== 'active') throw new AgentProfileError('REVOKED', 'Inactive AgentProfile cannot be updated'); const updatedAt = iso(this.now()); const profile = await this.signProfile({ ...current, ...(input.displayName !== undefined ? { displayName: boundedText(input.displayName, 120) } : {}), ...(input.avatar !== undefined ? { avatar: input.avatar ? boundedText(input.avatar, 2_048) : undefined } : {}), ...(input.description !== undefined ? { description: boundedText(input.description, 4_000, false) } : {}), ...(input.agentType !== undefined ? { agentType: assertProfileType(input.agentType) } : {}), ...(input.capabilitiesSummary !== undefined ? { capabilitiesSummary: boundedList(input.capabilitiesSummary) } : {}), ...(input.interests !== undefined ? { interests: boundedList(input.interests) } : {}), ...(input.specializations !== undefined ? { specializations: boundedList(input.specializations) } : {}), ...(input.presence !== undefined ? { presence: normalizePresence(input.presence, updatedAt, current.presence) } : {}), ...(input.acceptsVisits !== undefined ? { acceptsVisits: input.acceptsVisits } : {}), ...(input.acceptsTasks !== undefined ? { acceptsTasks: input.acceptsTasks } : {}), ...(input.acceptsRooms !== undefined ? { acceptsRooms: input.acceptsRooms } : {}), ...(input.trustPolicy !== undefined ? { trustPolicy: normalizeTrustPolicy(input.trustPolicy, input.acceptsVisits ?? current.acceptsVisits, input.acceptsTasks ?? current.acceptsTasks, input.acceptsRooms ?? current.acceptsRooms) } : {}), ...(input.visibility !== undefined ? { visibility: assertVisibility(input.visibility) } : {}), status: 'active' as const, updatedAt, revision: current.revision + 1 });
    this.profiles.set(profileKey(profile.ownerIdentityId, profile.agentId), profile); this.record({ event: 'profile.updated', outcome: 'accepted', agentId: profile.agentId, ownerIdentityId: profile.ownerIdentityId }); await this.persist(); this.emit(profile); return clone(profile);
  }
  async updateAgentProfile(agentId: string, input: AgentProfileUpdate): Promise<AgentProfile> { return this.update(agentId, input); }

  async tombstone(agentId: string): Promise<AgentProfile> { return this.changeStatus(agentId, 'tombstoned'); }
  async revoke(agentId: string): Promise<AgentProfile> { return this.changeStatus(agentId, 'revoked'); }

  async publish(agentId: string, peers?: readonly NodeId[]): Promise<void> {
    await this.ready(); const profile = this.requireLocal(agentId); const targets = peers ? [...new Set(peers)] : this.mailbox.contactsList().map(value => value.agent.identityId); for (const peer of targets) { if (peer === this.local.nodeId) continue; await this.mailbox.sendAgentProfile(peer, profile); await this.mailbox.flush(peer); }
  }
  async publishProfile(agentId: string, peers?: readonly NodeId[]): Promise<void> { return this.publish(agentId, peers); }

  async publishAll(peers?: readonly NodeId[]): Promise<void> { await this.ready(); for (const profile of this.allLocalProfiles()) await this.publish(profile.agentId, peers); }
  async get(agentId: string, ownerIdentityId = this.local.nodeId): Promise<AgentProfile | undefined> { await this.ready(); const value = this.profiles.get(profileKey(ownerIdentityId, safeAgentId(agentId))); if (!value || value.visibility === 'private' && ownerIdentityId !== this.local.nodeId) return undefined; if (value.visibility !== 'private' && !(await this.surfaceEligible(value.agentId, value))) return undefined; return clone(value); }
  async getProfile(agentId: string, ownerIdentityId = this.local.nodeId): Promise<AgentProfile | undefined> { return this.get(agentId, ownerIdentityId); }
  async list(options: { ownerIdentityId?: NodeId; includePrivate?: boolean; includeInactive?: boolean; blockedOwners?: ReadonlySet<NodeId> } = {}): Promise<readonly AgentProfile[]> {
    await this.ready(); const canReadPrivate = options.includePrivate === true && options.ownerIdentityId === this.local.nodeId; const values = [...this.profiles.values()].filter(value => !options.ownerIdentityId || value.ownerIdentityId === options.ownerIdentityId).filter(value => options.includeInactive || value.status === 'active').filter(value => canReadPrivate || value.visibility !== 'private').filter(value => !options.blockedOwners?.has(value.ownerIdentityId)); const filtered: AgentProfile[] = []; for (const value of values) if ((!this.isBlocked || !(await this.isBlocked({ agentId: value.agentId, identityId: value.ownerIdentityId }))) && (value.visibility === 'private' && value.ownerIdentityId === this.local.nodeId || await this.surfaceEligible(value.agentId, value))) filtered.push(clone(value)); return filtered.sort((a, b) => a.displayName.localeCompare(b.displayName) || a.agentId.localeCompare(b.agentId));
  }
  async listProfiles(options: { ownerIdentityId?: NodeId; includePrivate?: boolean; includeInactive?: boolean; blockedOwners?: ReadonlySet<NodeId> } = {}): Promise<readonly AgentProfile[]> { return this.list(options); }
  async publicProfiles(): Promise<readonly AgentProfile[]> { await this.ready(); const values = await this.list({ includePrivate: false, blockedOwners: new Set() }); return values.filter(value => value.visibility === 'public' && value.status === 'active'); }
  async localProfiles(): Promise<readonly AgentProfile[]> { return this.list({ ownerIdentityId: this.local.nodeId, includePrivate: true }); }

  /** Test and host boundary for a raw recipient-authenticated profile payload. */
  async ingest(value: unknown, peer?: NodeId): Promise<AgentProfile> { await this.ready(); const profile = parseProfile(value); const sender = peer ?? profile.ownerIdentityId; if (profile.ownerIdentityId !== sender) throw new AgentProfileError('UNAUTHORIZED', 'AgentProfile owner binding failed'); if (profile.visibility === 'private' && sender !== this.local.nodeId && !this.mailbox.contactsList().some(contact => contact.agent.identityId === sender)) throw new AgentProfileError('POLICY_DENIED', 'Private AgentProfile is not shared with this peer'); const publicKey = await this.signingKey(sender); if (!await verifyCanonical(stripSignature(profile), profile.signature, (canonicalBytes, rawSignature) => this.crypto.verify(canonicalBytes, rawSignature, publicKey))) throw new AgentProfileError('INVALID_SIGNATURE', 'AgentProfile owner signature is invalid'); if (profile.visibility !== 'private' && !(await this.surfaceEligible(profile.agentId, profile))) throw new AgentProfileError('POLICY_DENIED', 'Shared AgentProfile failed mandatory SafetySurfaceGate'); const key = profileKey(profile.ownerIdentityId, profile.agentId); const previous = this.profiles.get(key); if (previous && (profile.revision < previous.revision || profile.revision === previous.revision && profile.updatedAt <= previous.updatedAt)) throw new AgentProfileError('REPLAY', 'AgentProfile revision is stale'); if (previous && previous.status !== 'active' && profile.status === 'active') throw new AgentProfileError('REVOKED', 'Inactive AgentProfile cannot be reactivated'); this.profiles.set(key, profile); this.seenIds.add(`${profile.agentId}:${profile.revision}`); this.record({ event: profile.status === 'tombstoned' ? 'profile.tombstoned' : profile.status === 'revoked' ? 'profile.revoked' : 'profile.received', outcome: 'received', agentId: profile.agentId, ownerIdentityId: profile.ownerIdentityId, peer: sender }); await this.persist(); this.emit(profile, sender); return clone(profile); }

  private async receive(peer: NodeId, payload: unknown): Promise<void> { try { await this.ingest(payload, peer); } catch (error) { this.record({ event: 'security.rejected', outcome: 'denied', peer, reason: error instanceof Error ? error.message.slice(0, 256) : 'AgentProfile rejected' }); await this.persist(); throw error; } }
  private async changeStatus(agentId: string, status: Extract<AgentProfileStatus, 'tombstoned' | 'revoked'>): Promise<AgentProfile> { await this.ready(); const current = this.requireLocal(agentId); if (current.status !== 'active') throw new AgentProfileError('REVOKED', 'AgentProfile is already inactive'); const profile = await this.signProfile({ ...current, status, visibility: current.visibility, updatedAt: iso(this.now()), revision: current.revision + 1 }); this.profiles.set(profileKey(profile.ownerIdentityId, profile.agentId), profile); this.record({ event: status === 'tombstoned' ? 'profile.tombstoned' : 'profile.revoked', outcome: 'accepted', agentId: profile.agentId, ownerIdentityId: profile.ownerIdentityId }); await this.persist(); this.emit(profile); return clone(profile); }
  private allLocalProfiles(): readonly AgentProfile[] { return [...this.profiles.values()].filter(value => value.ownerIdentityId === this.local.nodeId); }
  private requireLocal(agentId: string): AgentProfile { const value = this.profiles.get(profileKey(this.local.nodeId, safeAgentId(agentId))); if (!value) throw new AgentProfileError('NOT_FOUND', 'AgentProfile not found'); return value; }
  private async signProfile(value: Omit<AgentProfile, 'signature'> | AgentProfile): Promise<AgentProfile> { const { signature: _signature, ...unsigned } = value as AgentProfile; validateProfile(unsigned); if (unsigned.visibility !== 'private' && !(await this.surfaceEligible(unsigned.agentId, unsigned))) throw new AgentProfileError('POLICY_DENIED', 'Shared AgentProfile failed mandatory safety gating'); return { ...unsigned, signature: await signCanonical(unsigned, canonicalBytes => this.crypto.sign(canonicalBytes, this.local.privateKey)) }; }
  private async surfaceEligible(objectId: string, value: unknown): Promise<boolean> { const domain = (value as { visibility?: string }).visibility === 'public' ? 'PUBLIC' : 'DIRECT_SHARED'; return (await this.protectedSurfaces.evaluate('PROFILES', { objectId, domain, value, content: value, sourceType: 'profile', verified: true, authorized: true, sharing: true })) !== undefined; }
  private async signingKey(identityId: NodeId): Promise<string> { if (identityId === this.local.nodeId) return this.local.publicKey; const contact = this.mailbox.contactsList().find(value => value.agent.identityId === identityId); if (!contact || contact.revoked) throw new AgentProfileError('UNAUTHORIZED', 'Unknown AgentProfile owner'); return contact.signingPublicKey; }
  private async hydrate(): Promise<void> { const raw = await this.storage.read(); if (!raw) return; const value = parseSnapshot(raw); value.profiles.forEach(profile => this.profiles.set(profileKey(profile.ownerIdentityId, profile.agentId), profile)); value.seenIds.forEach(id => this.seenIds.add(id)); this.auditEntries.push(...value.audit); }
  private async persist(): Promise<void> { const snapshot = this.makeSnapshot(); const operation = this.writes.then(() => this.storage.write(snapshot)); this.writes = operation.catch(() => undefined); await operation; }
  private makeSnapshot(): AgentProfileSnapshot { return { version: 1, profiles: [...this.profiles.values()].map(clone), seenIds: [...this.seenIds].slice(-16_384), audit: this.auditEntries.map(clone) }; }
  private record(input: Omit<AgentProfileAuditRecord, 'version' | 'id' | 'at'>): void { this.auditEntries.push({ version: 1, id: randomId(), at: iso(this.now()), ...input }); while (this.auditEntries.length > AGENT_PROFILE_MAX_AUDIT) this.auditEntries.shift(); }
  private emit(profile: AgentProfile, peer?: NodeId): void { const event = { profile: clone(profile), ...(peer ? { peer } : {}) }; this.listeners.forEach(listener => { void listener(event); }); void this.onProfile?.(clone(profile), peer); }
}

export class InMemoryAgentProfileStateStore implements AgentMailboxStateStore { private value?: unknown; async read(): Promise<unknown | undefined> { return this.value === undefined ? undefined : structuredClone(this.value); } async write(value: unknown): Promise<void> { this.value = structuredClone(value); } }

export async function createOwnerConfirmation(input: { requestId: string; ownerIdentityId?: NodeId; actionHash: string; confirmedAt?: string }, crypto: CryptoProvider, local: DeviceSessionKeys): Promise<AgentOwnerConfirmation> { const unsigned = { version: 1 as const, requestId: safeAgentId(input.requestId), ownerIdentityId: input.ownerIdentityId ?? local.nodeId, actionHash: boundedText(input.actionHash, 256), confirmedAt: input.confirmedAt ?? iso(Date.now()) }; if (unsigned.ownerIdentityId !== local.nodeId) throw new AgentProfileError('UNAUTHORIZED', 'Only the owner can confirm an agent decision'); return { ...unsigned, signature: await signCanonical(unsigned, canonicalBytes => crypto.sign(canonicalBytes, local.privateKey)) }; }

export async function createAgentProtocolResult(input: { agent: AgentRef; type: AgentProtocolResultType; value: unknown; dataClass?: 'PUBLIC' | 'USER_EXPLICIT'; ownerConfirmation?: AgentOwnerConfirmation; id?: string; createdAt?: string }, crypto: CryptoProvider, local: DeviceSessionKeys): Promise<AgentProtocolResult> { if (input.agent.identityId !== local.nodeId) throw new AgentProfileError('UNAUTHORIZED', 'Agent result must be signed by its owner'); const type = assertResultType(input.type); if (type === 'OWNER_CONFIRMED_DECISION' && !input.ownerConfirmation) throw new AgentProfileError('UNAUTHORIZED', 'Owner confirmation is required for a confirmed decision'); const unsigned = { version: 1 as const, id: input.id ? safeAgentId(input.id) : randomId(), agent: normalizeAgent(input.agent), ownerIdentityId: local.nodeId, type, value: structuredClone(input.value), dataClass: input.dataClass ?? 'USER_EXPLICIT', createdAt: input.createdAt ?? iso(Date.now()), ...(input.ownerConfirmation ? { ownerConfirmation: structuredClone(input.ownerConfirmation) } : {}) }; validateProtocolResult(unsigned); return { ...unsigned, signature: await signCanonical(unsigned, canonicalBytes => crypto.sign(canonicalBytes, local.privateKey)) }; }

export async function validateAgentProtocolResult(value: unknown, crypto: CryptoProvider, ownerPublicKey: string): Promise<AgentProtocolResult> { if (!value || typeof value !== 'object') throw new AgentProfileError('INVALID_STATE', 'Invalid agent protocol result'); const result = value as AgentProtocolResult; validateProtocolResult(result); if (!await verifyCanonical(stripSignature(result), result.signature, (canonicalBytes, rawSignature) => crypto.verify(canonicalBytes, rawSignature, ownerPublicKey))) throw new AgentProfileError('INVALID_SIGNATURE', 'Agent protocol result signature is invalid'); if (result.type === 'OWNER_CONFIRMED_DECISION') { const confirmation = result.ownerConfirmation; if (!confirmation || confirmation.ownerIdentityId !== result.ownerIdentityId || !await verifyCanonical(stripSignature(confirmation), confirmation.signature, (canonicalBytes, rawSignature) => crypto.verify(canonicalBytes, rawSignature, ownerPublicKey))) throw new AgentProfileError('UNAUTHORIZED', 'Owner confirmation is invalid'); } return clone(result); }

function parseSnapshot(raw: unknown): AgentProfileSnapshot { if (!raw) return { version: 1, profiles: [], seenIds: [], audit: [] }; if (!raw || typeof raw !== 'object' || (raw as { version?: unknown }).version !== 1 || !Array.isArray((raw as { profiles?: unknown }).profiles) || !Array.isArray((raw as { seenIds?: unknown }).seenIds) || !Array.isArray((raw as { audit?: unknown }).audit)) throw new AgentProfileError('INVALID_STATE', 'Invalid AgentProfile state'); const value = raw as AgentProfileSnapshot; value.profiles.forEach(validateProfile); return { version: 1, profiles: value.profiles.map(clone), seenIds: value.seenIds.filter(value => typeof value === 'string').slice(-16_384), audit: value.audit.slice(-AGENT_PROFILE_MAX_AUDIT).map(clone) }; }
function parseProfile(value: unknown): AgentProfile { if (!value || typeof value !== 'object') throw new AgentProfileError('INVALID_STATE', 'Invalid AgentProfile'); const profile = value as AgentProfile; validateProfile(profile); return clone(profile); }
function validateProfile(value: Omit<AgentProfile, 'signature'> | AgentProfile): void { if (!value || value.version !== 1 || !safeAgentId(value.agentId) || !value.ownerIdentityId || !boundedCheck(value.displayName, 120) || !boundedCheck(value.description, 4_000, false) || !AGENT_PROFILE_TYPES.includes(value.agentType) || !Array.isArray(value.capabilitiesSummary) || !Array.isArray(value.interests) || !Array.isArray(value.specializations) || value.capabilitiesSummary.length > AGENT_PROFILE_MAX_ITEMS || value.interests.length > AGENT_PROFILE_MAX_ITEMS || value.specializations.length > AGENT_PROFILE_MAX_ITEMS || !value.presence || !AGENT_PROFILE_STATUSES.includes(value.status) || !AGENT_PROFILE_VISIBILITIES.includes(value.visibility) || !Number.isSafeInteger(value.revision) || value.revision < 1 || !Number.isFinite(Date.parse(value.createdAt)) || !Number.isFinite(Date.parse(value.updatedAt)) || Date.parse(value.updatedAt) < Date.parse(value.createdAt) || !value.trustPolicy || typeof value.acceptsVisits !== 'boolean' || typeof value.acceptsTasks !== 'boolean' || typeof value.acceptsRooms !== 'boolean' || (value as AgentProfile).signature !== undefined && typeof (value as AgentProfile).signature !== 'string') throw new AgentProfileError('INVALID_STATE', 'Invalid AgentProfile'); validatePresence(value.presence); validateTrustPolicy(value.trustPolicy); for (const list of [value.capabilitiesSummary, value.interests, value.specializations]) list.forEach(item => { if (!boundedCheck(item, 96)) throw new AgentProfileError('INVALID_ARGUMENT', 'AgentProfile list item is invalid'); }); if ((value as AgentProfile).avatar !== undefined && !boundedCheck((value as AgentProfile).avatar, 2_048, false)) throw new AgentProfileError('INVALID_ARGUMENT', 'AgentProfile avatar is invalid'); }
function validatePresence(value: AgentProfilePresence): void { if (!AGENT_PRESENCE_STATES.includes(value.state)) throw new AgentProfileError('INVALID_STATE', 'Invalid AgentProfile presence'); if (typeof value.acceptingTasks !== 'boolean' || !Number.isFinite(Date.parse(value.updatedAt)) || !Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.expiresAt) < Date.parse(value.updatedAt) || Date.parse(value.expiresAt) - Date.parse(value.updatedAt) > 60 * 60_000) throw new AgentProfileError('INVALID_STATE', 'Invalid AgentProfile presence window'); }
function validateTrustPolicy(value: AgentProfileTrustPolicy): void { if (!AGENT_TRUST_MODES.includes(value.mode) || typeof value.acceptsVisits !== 'boolean' || typeof value.acceptsTasks !== 'boolean' || typeof value.acceptsRooms !== 'boolean') throw new AgentProfileError('INVALID_STATE', 'Invalid AgentProfile trust policy'); }
function validateProtocolResult(value: Omit<AgentProtocolResult, 'signature'> | AgentProtocolResult): void { if (!value || value.version !== 1 || !safeAgentId(value.id) || !normalizeAgent(value.agent) || value.ownerIdentityId !== value.agent.identityId || !AGENT_PROTOCOL_RESULT_TYPES.includes(value.type) || (value.dataClass !== 'PUBLIC' && value.dataClass !== 'USER_EXPLICIT') || !Number.isFinite(Date.parse(value.createdAt)) || serializedSize(value.value) > 16_384 || (value.type === 'OWNER_CONFIRMED_DECISION' && !value.ownerConfirmation)) throw new AgentProfileError('INVALID_STATE', 'Invalid agent protocol result'); if (value.ownerConfirmation) { const confirmation = value.ownerConfirmation; if (confirmation.version !== 1 || !safeAgentId(confirmation.requestId) || confirmation.ownerIdentityId !== value.ownerIdentityId || !boundedCheck(confirmation.actionHash, 256) || !Number.isFinite(Date.parse(confirmation.confirmedAt)) || typeof confirmation.signature !== 'string') throw new AgentProfileError('INVALID_STATE', 'Invalid owner confirmation'); } if ((value as AgentProtocolResult).signature !== undefined && typeof (value as AgentProtocolResult).signature !== 'string') throw new AgentProfileError('INVALID_STATE', 'Invalid agent protocol result signature'); }
function normalizePresence(input: Partial<AgentProfilePresence> | undefined, now: string, previous?: AgentProfilePresence): AgentProfilePresence { const updatedAt = input?.updatedAt ?? now; const expiresAt = input?.expiresAt ?? new Date(Date.parse(updatedAt) + 2 * 60_000).toISOString(); const value = { state: input?.state ?? previous?.state ?? 'offline', acceptingTasks: input?.acceptingTasks ?? previous?.acceptingTasks ?? false, updatedAt, expiresAt }; validatePresence(value); return value; }
function normalizeTrustPolicy(input: Partial<AgentProfileTrustPolicy> | undefined, acceptsVisits: boolean, acceptsTasks: boolean, acceptsRooms: boolean): AgentProfileTrustPolicy { const value = { mode: input?.mode ?? 'ask', acceptsVisits: input?.acceptsVisits ?? acceptsVisits, acceptsTasks: input?.acceptsTasks ?? acceptsTasks, acceptsRooms: input?.acceptsRooms ?? acceptsRooms }; validateTrustPolicy(value); return value; }
function profileKey(owner: NodeId, agentId: string): string { return `${owner}:${agentId}`; }
function normalizeAgent(value: AgentRef): AgentRef { if (!value || !safeAgentId(value.agentId) || !value.identityId) throw new AgentProfileError('INVALID_ARGUMENT', 'Invalid agent reference'); return { agentId: value.agentId, identityId: value.identityId }; }
function safeAgentId(value: string): string { if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) throw new AgentProfileError('INVALID_ARGUMENT', 'Invalid agent id'); return value; }
function boundedText(value: string, max: number, required = true): string { if (typeof value !== 'string' || value.length > max || required && !value.trim()) throw new AgentProfileError('INVALID_ARGUMENT', 'AgentProfile text is invalid'); return value.trim(); }
function boundedCheck(value: unknown, max: number, required = true): value is string { return typeof value === 'string' && value.length <= max && (!required || !!value.trim()); }
function boundedList(values: readonly string[]): readonly string[] { if (!Array.isArray(values) || values.length > AGENT_PROFILE_MAX_ITEMS) throw new AgentProfileError('INVALID_ARGUMENT', 'AgentProfile list is too large'); const result = values.map(value => boundedText(value, 96)).filter((value, index, all) => all.indexOf(value) === index); return result; }
function assertProfileType(value: AgentProfileType): AgentProfileType { if (!AGENT_PROFILE_TYPES.includes(value)) throw new AgentProfileError('INVALID_ARGUMENT', 'Invalid AgentProfile type'); return value; }
function assertVisibility(value: AgentProfileVisibility): AgentProfileVisibility { if (!AGENT_PROFILE_VISIBILITIES.includes(value)) throw new AgentProfileError('INVALID_ARGUMENT', 'Invalid AgentProfile visibility'); return value; }
function assertResultType(value: AgentProtocolResultType): AgentProtocolResultType { if (!AGENT_PROTOCOL_RESULT_TYPES.includes(value)) throw new AgentProfileError('INVALID_ARGUMENT', 'Invalid agent result type'); return value; }
function iso(value: number): string { return new Date(value).toISOString(); }
function randomId(): string { return `${globalThis.crypto.randomUUID()}`; }
function stripSignature<T extends { readonly signature: string }>(value: T): Omit<T, 'signature'> { const { signature: _signature, ...unsigned } = value; return unsigned; }
function clone<T>(value: T): T { return structuredClone(value); }
function serializedSize(value: unknown): number { try { return new TextEncoder().encode(JSON.stringify(value) ?? '').byteLength; } catch { return Number.POSITIVE_INFINITY; } }
