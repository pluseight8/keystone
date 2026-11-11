/**
 * Signed agent presence and Personal Concierge boundary.
 *
 * Presence is a short-lived hint exchanged only with authenticated mailbox
 * contacts.  It is not a visit, a trust grant, or a device/network
 * advertisement.  Concierge requests carry only explicitly shareable context;
 * private Memory, files, chats and credentials never enter this protocol.
 */
import { canonicalJson, type CryptoProvider, signCanonical, verifyCanonical } from '../crypto.js';
import type { DeviceSessionKeys } from '../identity.js';
import type { NodeId } from '../types.js';
import {
  AgentMailbox,
  AGENT_PRESENCE_STATES,
  type AgentContact,
  type AgentMailboxStateStore,
  type AgentPresence,
  type AgentPresenceState,
} from './agent-social.js';
import {
  createAgentProtocolResult,
  createOwnerConfirmation,
  validateAgentProtocolResult,
  type AgentOwnerConfirmation,
  type AgentProfileService,
  type AgentProtocolResult,
  type AgentProtocolResultType,
} from './agent-profiles.js';
import type { AgentRef, AgentSharedContext } from './visits.js';
import { MandatorySafetySurfaceRegistry } from '../security/safety-surfaces.js';
import { SafetyRuntime, SafetySurfaceGate } from '../security/content-safety.js';

export const AGENT_PRESENCE_VERSION = 1 as const;
export const AGENT_PRESENCE_MAX_LIFETIME_MS = 60 * 60_000;
export const AGENT_CONCIERGE_VERSION = 1 as const;
export const AGENT_CONCIERGE_MAX_REQUESTS = 1_000;
export const AGENT_CONCIERGE_MAX_RESPONSES = 1_000;
export const AGENT_CONCIERGE_MAX_AUDIT = 2_000;
export const AGENT_CONCIERGE_MAX_TEXT = 8_192;
export const AGENT_CONCIERGE_MAX_DISCLOSURE_BYTES = 4_096;

export const AGENT_PRESENCE_VISIBILITIES = ['public', 'contacts', 'selected'] as const;
export type AgentPresenceVisibility = (typeof AGENT_PRESENCE_VISIBILITIES)[number];
export const AGENT_CONCIERGE_ACCESS_MODES = ['deny', 'human_contacts', 'trusted_agents', 'selected_identities', 'profile_policy', 'everyone'] as const;
export type AgentConciergeAccessMode = (typeof AGENT_CONCIERGE_ACCESS_MODES)[number];
export const AGENT_CONCIERGE_CATEGORIES = ['availability', 'scheduling', 'public_information', 'coordination', 'request', 'proposal', 'custom'] as const;
export type AgentConciergeCategory = (typeof AGENT_CONCIERGE_CATEGORIES)[number];
export const AGENT_CONCIERGE_KINDS = ['question', 'request', 'proposal'] as const;
export type AgentConciergeKind = (typeof AGENT_CONCIERGE_KINDS)[number];
export const AGENT_CONCIERGE_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type AgentConciergePriority = (typeof AGENT_CONCIERGE_PRIORITIES)[number];
export const AGENT_CONCIERGE_STATUSES = ['pending', 'waiting_for_owner', 'processing', 'answered', 'rejected', 'expired'] as const;
export type AgentConciergeStatus = (typeof AGENT_CONCIERGE_STATUSES)[number];

export type ConciergeSource =
  | Readonly<{ kind: 'human'; identityId: NodeId }>
  | Readonly<{ kind: 'agent'; agent: AgentRef }>;

export interface PersonalConciergePolicy {
  readonly version: 1;
  readonly accessMode: AgentConciergeAccessMode;
  readonly selectedIdentityIds: readonly NodeId[];
  readonly selectedAgentRefs: readonly AgentRef[];
  readonly autoCategories: readonly AgentConciergeCategory[];
  readonly ownerApprovalCategories: readonly AgentConciergeCategory[];
  readonly acceptingMessages: boolean;
  readonly maxInbox: number;
  readonly maxPerSenderPerHour: number;
  readonly defaultPriority: AgentConciergePriority;
}

export interface ConciergeRequest {
  readonly version: 1;
  readonly id: string;
  readonly requestId: string;
  readonly sender: AgentRef;
  readonly recipient: AgentRef;
  readonly source: ConciergeSource;
  readonly kind: AgentConciergeKind;
  readonly category: AgentConciergeCategory;
  /** Untrusted text. It never grants a tool or capability. */
  readonly text: string;
  /** Only PUBLIC/USER_EXPLICIT projections are permitted here. */
  readonly explicitContext: readonly AgentSharedContext[];
  readonly priority: AgentConciergePriority;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly status: AgentConciergeStatus;
  readonly signature: string;
}

export interface ConciergeResponse {
  readonly version: 1;
  readonly id: string;
  readonly requestId: string;
  readonly sender: AgentRef;
  readonly recipient: ConciergeSource;
  readonly result: AgentProtocolResult;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly signature: string;
}

export interface OwnerInboxItem {
  readonly request: ConciergeRequest;
  readonly status: AgentConciergeStatus;
  readonly sourceLabel: string;
  readonly needsOwner: boolean;
}

export interface AgentPresenceAuditRecord {
  readonly version: 1;
  readonly id: string;
  readonly at: string;
  readonly event: 'presence.published' | 'presence.received' | 'presence.expired' | 'concierge.sent' | 'concierge.received' | 'concierge.answered' | 'concierge.rejected' | 'concierge.shared' | 'security.rejected';
  readonly outcome: 'accepted' | 'received' | 'queued' | 'denied';
  readonly peer?: NodeId;
  readonly requestId?: string;
  readonly responseId?: string;
  readonly category?: AgentConciergeCategory;
  readonly dataClasses: readonly ('PUBLIC' | 'USER_EXPLICIT')[];
  readonly reason?: string;
}

export interface AgentPresenceSnapshot {
  readonly version: 1;
  readonly localPresence?: AgentPresence;
  readonly remotePresences: readonly { readonly peer: NodeId; readonly presence: AgentPresence }[];
  readonly policy: PersonalConciergePolicy;
  readonly requests: readonly ConciergeRequest[];
  readonly responses: readonly ConciergeResponse[];
  readonly seenIds: readonly string[];
  readonly audit: readonly AgentPresenceAuditRecord[];
}

export interface ConciergeAutoAnswer {
  readonly type: Exclude<AgentProtocolResultType, 'OWNER_CONFIRMED_DECISION'>;
  readonly value: unknown;
  readonly dataClass?: 'PUBLIC' | 'USER_EXPLICIT';
  readonly shareWith?: readonly ConciergeSource[];
}

export interface AgentPresenceServiceOptions {
  readonly mailbox: AgentMailbox;
  readonly crypto: CryptoProvider;
  readonly local: DeviceSessionKeys;
  readonly storage?: AgentMailboxStateStore;
  readonly now?: () => number;
  readonly profile?: AgentProfileService;
  readonly policy?: Partial<PersonalConciergePolicy>;
  readonly isHumanContact?: (identityId: NodeId) => boolean | Promise<boolean>;
  readonly isTrustedAgent?: (agent: AgentRef) => boolean | Promise<boolean>;
  readonly isBlocked?: (agent: AgentRef) => boolean | Promise<boolean>;
  readonly isMuted?: (agent: AgentRef) => boolean | Promise<boolean>;
  readonly profilePolicy?: (source: ConciergeSource) => boolean | Promise<boolean>;
  readonly autoResponder?: (request: ConciergeRequest) => ConciergeAutoAnswer | undefined | Promise<ConciergeAutoAnswer | undefined>;
  readonly onInbox?: (item: OwnerInboxItem) => void | Promise<void>;
  readonly protectedSurfaces?: MandatorySafetySurfaceRegistry;
}

export type AgentPresenceErrorCode = 'INVALID_ARGUMENT' | 'INVALID_SIGNATURE' | 'INVALID_STATE' | 'UNAUTHORIZED' | 'POLICY_DENIED' | 'DUPLICATE' | 'REPLAY' | 'EXPIRED' | 'QUOTA' | 'NOT_FOUND' | 'UNSHAREABLE_DATA';
export class AgentPresenceError extends Error {
  constructor(readonly code: AgentPresenceErrorCode, message: string) { super(message); this.name = 'AgentPresenceError'; }
}

const DEFAULT_POLICY: PersonalConciergePolicy = {
  version: 1,
  accessMode: 'deny',
  selectedIdentityIds: [],
  selectedAgentRefs: [],
  autoCategories: [],
  ownerApprovalCategories: ['availability', 'scheduling', 'coordination', 'request', 'proposal'],
  acceptingMessages: false,
  maxInbox: 128,
  maxPerSenderPerHour: 30,
  defaultPriority: 'normal',
};

/** Durable presence plus an explicit, owner-controlled concierge boundary. */
export class AgentPresenceService {
  private readonly mailbox: AgentMailbox;
  private readonly crypto: CryptoProvider;
  private readonly local: DeviceSessionKeys;
  private readonly storage: AgentMailboxStateStore;
  private readonly now: () => number;
  private readonly profile?: AgentProfileService;
  private readonly isHumanContact?: AgentPresenceServiceOptions['isHumanContact'];
  private readonly isTrustedAgent?: AgentPresenceServiceOptions['isTrustedAgent'];
  private readonly isBlocked?: AgentPresenceServiceOptions['isBlocked'];
  private readonly isMuted?: AgentPresenceServiceOptions['isMuted'];
  private readonly profilePolicy?: AgentPresenceServiceOptions['profilePolicy'];
  private readonly autoResponder?: AgentPresenceServiceOptions['autoResponder'];
  private readonly onInbox?: AgentPresenceServiceOptions['onInbox'];
  private readonly protectedSurfaces: MandatorySafetySurfaceRegistry;
  private readonly localAgent: AgentRef;
  private readonly remotePresences = new Map<NodeId, AgentPresence>();
  private readonly requests = new Map<string, ConciergeRequest>();
  private readonly responses = new Map<string, ConciergeResponse>();
  private readonly seenIds = new Set<string>();
  private readonly auditEntries: AgentPresenceAuditRecord[] = [];
  private policy: PersonalConciergePolicy;
  private localPresence?: AgentPresence;
  private readonly unsubscribePresence: () => void;
  private readonly unsubscribeConcierge: () => void;
  private readonly readyPromise: Promise<void>;
  private writes: Promise<void> = Promise.resolve();

  constructor(options: AgentPresenceServiceOptions) {
    this.mailbox = options.mailbox; this.crypto = options.crypto; this.local = options.local; this.storage = options.storage ?? new InMemoryAgentPresenceStateStore(); this.now = options.now ?? Date.now; this.profile = options.profile;
    this.isHumanContact = options.isHumanContact; this.isTrustedAgent = options.isTrustedAgent; this.isBlocked = options.isBlocked; this.isMuted = options.isMuted; this.profilePolicy = options.profilePolicy; this.autoResponder = options.autoResponder; this.onInbox = options.onInbox; this.protectedSurfaces = options.protectedSurfaces ?? new MandatorySafetySurfaceRegistry(new SafetySurfaceGate(new SafetyRuntime()));
    this.localAgent = { ...this.mailbox.localAgentRef }; this.policy = normalizePolicy({ ...DEFAULT_POLICY, ...options.policy });
    this.unsubscribePresence = this.mailbox.onPresenceMessage((peer, presence) => this.receivePresence(peer, presence));
    this.unsubscribeConcierge = this.mailbox.onConciergeMessage((peer, payload) => this.receiveConcierge(peer, payload));
    this.readyPromise = this.hydrate();
  }

  async ready(): Promise<void> { await this.readyPromise; }
  close(): void { this.unsubscribePresence(); this.unsubscribeConcierge(); }
  policySnapshot(): PersonalConciergePolicy { return clone(this.policy); }
  async setPolicy(input: Partial<PersonalConciergePolicy>): Promise<PersonalConciergePolicy> { await this.ready(); this.policy = normalizePolicy({ ...this.policy, ...input }); await this.persist(); return clone(this.policy); }
  async setConciergePolicy(input: Partial<PersonalConciergePolicy>): Promise<PersonalConciergePolicy> { return this.setPolicy(input); }
  presence(): AgentPresence | undefined { return this.effectivePresence(this.localPresence); }
  currentPresence(): AgentPresence | undefined { return this.presence(); }
  getPresence(): AgentPresence | undefined { return this.presence(); }
  localPresenceSnapshot(): AgentPresence | undefined { return this.presence(); }
  remotePresence(identityId: NodeId): AgentPresence | undefined { return this.effectivePresence(this.remotePresences.get(identityId)); }
  listRemotePresence(): readonly AgentPresence[] { return [...this.remotePresences.values()].map(value => this.effectivePresence(value)).filter((value): value is AgentPresence => !!value); }
  audit(): readonly AgentPresenceAuditRecord[] { return this.auditEntries.map(clone); }
  async snapshot(): Promise<AgentPresenceSnapshot> {
    await this.ready();
    const raw = this.makeSnapshot();
    const requests = await this.safeRequests(raw.requests);
    const responses = await this.safeResponses(raw.responses);
    return { ...raw, requests, responses };
  }
  async listInbox(): Promise<readonly OwnerInboxItem[]> { await this.ready(); const requests = await this.safeRequests([...this.requests.values()].filter(value => value.recipient.identityId === this.local.nodeId)); return requests.map(value => this.toInboxItem(value)); }
  async listOwnerInbox(): Promise<readonly OwnerInboxItem[]> { return this.listInbox(); }
  async listPending(): Promise<readonly OwnerInboxItem[]> { return (await this.listInbox()).filter(item => item.status === 'pending' || item.status === 'waiting_for_owner'); }
  async listResponses(): Promise<readonly ConciergeResponse[]> { await this.ready(); return this.safeResponses([...this.responses.values()]); }
  getRequest(requestId: string): ConciergeRequest | undefined { const value = this.requests.get(requestId); return value ? clone(value) : undefined; }

  async setPresence(input: { state: AgentPresenceState; acceptingMessages?: boolean; acceptingTasks?: boolean; visibility?: AgentPresenceVisibility; peers?: readonly AgentRef[]; expiresAt?: string }): Promise<AgentPresence> {
    await this.ready(); if (!AGENT_PRESENCE_STATES.includes(input.state)) throw new AgentPresenceError('INVALID_ARGUMENT', 'Invalid presence state'); if (input.visibility !== undefined && !AGENT_PRESENCE_VISIBILITIES.includes(input.visibility)) throw new AgentPresenceError('INVALID_ARGUMENT', 'Invalid presence visibility'); const updatedAt = iso(this.now()); const expiresAt = input.expiresAt ?? new Date(this.now() + 2 * 60_000).toISOString(); assertPresenceExpiry(updatedAt, expiresAt, this.now());
    const unsigned = { version: 1 as const, agent: this.localAgent, state: input.state, acceptingTasks: input.acceptingTasks ?? input.state === 'available', ...(input.acceptingMessages === undefined ? {} : { acceptingMessages: input.acceptingMessages }), ...(input.visibility ? { visibility: input.visibility } : {}), updatedAt, expiresAt };
    const presence: AgentPresence = { ...unsigned, signature: await signCanonical(unsigned, canonicalBytes => this.crypto.sign(canonicalBytes, this.local.privateKey)) }; this.localPresence = presence; await this.persist();
    const peers = input.visibility === 'selected' ? input.peers ?? [] : this.mailbox.contactsList().map(value => value.agent);
    for (const peer of peers) { if (peer.identityId === this.local.nodeId) continue; this.assertContact(peer); await this.mailbox.sendPresence(peer.identityId, presence); await this.mailbox.flush(peer.identityId); }
    this.record({ event: 'presence.published', outcome: 'accepted', dataClasses: [] }); await this.persist(); return clone(presence);
  }
  async setAgentPresence(input: Parameters<AgentPresenceService['setPresence']>[0]): Promise<AgentPresence> { return this.setPresence(input); }
  async publishPresence(input: Parameters<AgentPresenceService['setPresence']>[0]): Promise<AgentPresence> { return this.setPresence(input); }
  async sweep(): Promise<void> { await this.ready(); const now = this.now(); for (const [peer, presence] of this.remotePresences) if (Date.parse(presence.expiresAt) <= now) { this.remotePresences.delete(peer); this.record({ event: 'presence.expired', outcome: 'received', peer, dataClasses: [] }); } for (const request of this.requests.values()) if ((request.status === 'pending' || request.status === 'waiting_for_owner') && Date.parse(request.expiresAt) <= now) this.requests.set(request.requestId, { ...request, status: 'expired' }); await this.persist(); }

  async createRequest(input: { recipient: AgentRef; source?: ConciergeSource; kind: AgentConciergeKind; category: AgentConciergeCategory; text: string; explicitContext?: readonly AgentSharedContext[]; priority?: AgentConciergePriority; expiresAt?: string }): Promise<ConciergeRequest> {
    await this.ready(); const recipient = normalizeAgent(input.recipient); if (recipient.identityId === this.local.nodeId) throw new AgentPresenceError('INVALID_ARGUMENT', 'Concierge recipient must be remote'); this.assertContact(recipient); const source = input.source ?? { kind: 'agent', agent: this.localAgent } as ConciergeSource; validateSource(source); if (source.kind === 'agent' && (source.agent.identityId !== this.local.nodeId || source.agent.agentId !== this.localAgent.agentId)) throw new AgentPresenceError('UNAUTHORIZED', 'Request source must be the local agent');
    const createdAt = iso(this.now()); const expiresAt = input.expiresAt ?? new Date(this.now() + 24 * 60 * 60_000).toISOString(); assertRequestExpiry(createdAt, expiresAt, this.now()); const explicitContext = normalizeContext(input.explicitContext ?? []); const text = boundedText(input.text, AGENT_CONCIERGE_MAX_TEXT, 'Concierge text'); const requestId = randomId();
    const unsigned = { version: 1 as const, id: randomId(), requestId, sender: this.localAgent, recipient, source, kind: assertIn(input.kind, AGENT_CONCIERGE_KINDS, 'kind'), category: assertIn(input.category, AGENT_CONCIERGE_CATEGORIES, 'category'), text, explicitContext, priority: assertIn(input.priority ?? this.policy.defaultPriority, AGENT_CONCIERGE_PRIORITIES, 'priority'), createdAt, expiresAt, status: 'pending' as const };
    const request: ConciergeRequest = { ...unsigned, signature: await signCanonical(unsigned, canonicalBytes => this.crypto.sign(canonicalBytes, this.local.privateKey)) }; this.requests.set(requestId, request); await this.persist(); await this.mailbox.sendConcierge(recipient.identityId, { kind: 'request', request }); void this.mailbox.flush(recipient.identityId).catch(() => undefined); this.record({ event: 'concierge.sent', outcome: 'queued', peer: recipient.identityId, requestId, category: request.category, dataClasses: explicitContext.map(value => value.dataClass) }); await this.persist(); return clone(request);
  }
  async createConciergeRequest(input: Parameters<AgentPresenceService['createRequest']>[0]): Promise<ConciergeRequest> { return this.createRequest(input); }

  async approve(requestId: string, input: { value: unknown; type?: AgentProtocolResultType; dataClass?: 'PUBLIC' | 'USER_EXPLICIT'; shareWith?: readonly ConciergeSource[] }): Promise<ConciergeResponse[]> {
    await this.ready(); const request = this.requireRequest(requestId); if (request.recipient.identityId !== this.local.nodeId) throw new AgentPresenceError('UNAUTHORIZED', 'Only the owner can approve a concierge request'); if (request.status !== 'waiting_for_owner' && request.status !== 'pending') throw new AgentPresenceError('DUPLICATE', 'Request is no longer awaiting a decision'); this.assertDisclosure(input.value, input.dataClass ?? 'USER_EXPLICIT'); const type = input.type ?? 'OWNER_CONFIRMED_DECISION'; if (type !== 'OWNER_CONFIRMED_DECISION') return this.respond(requestId, { type, value: input.value, dataClass: input.dataClass, shareWith: input.shareWith });
    const actionHash = await this.crypto.hash(canonicalJson({ requestId, type, value: input.value })); const confirmation = await createOwnerConfirmation({ requestId, actionHash }, this.crypto, this.local); const result = await createAgentProtocolResult({ agent: this.localAgent, type, value: input.value, dataClass: input.dataClass ?? 'USER_EXPLICIT', ownerConfirmation: confirmation }, this.crypto, this.local); return this.sendResult(request, result, input.shareWith);
  }
  async confirm(requestId: string, input: Parameters<AgentPresenceService['approve']>[1]): Promise<ConciergeResponse[]> { return this.approve(requestId, input); }
  async approveRequest(requestId: string, input: Parameters<AgentPresenceService['approve']>[1]): Promise<ConciergeResponse[]> { return this.approve(requestId, input); }
  async respond(requestId: string, input: { type: Exclude<AgentProtocolResultType, 'OWNER_CONFIRMED_DECISION'>; value: unknown; dataClass?: 'PUBLIC' | 'USER_EXPLICIT'; shareWith?: readonly ConciergeSource[] }): Promise<ConciergeResponse[]> { await this.ready(); const request = this.requireRequest(requestId); this.assertDisclosure(input.value, input.dataClass ?? 'USER_EXPLICIT'); const result = await createAgentProtocolResult({ agent: this.localAgent, type: input.type, value: input.value, dataClass: input.dataClass ?? 'USER_EXPLICIT' }, this.crypto, this.local); return this.sendResult(request, result, input.shareWith); }
  async shareResponse(requestId: string, target: ConciergeSource, input: { type: Exclude<AgentProtocolResultType, 'OWNER_CONFIRMED_DECISION'> | 'OWNER_CONFIRMED_DECISION'; value: unknown; dataClass?: 'PUBLIC' | 'USER_EXPLICIT'; ownerConfirmation?: AgentOwnerConfirmation }): Promise<ConciergeResponse> { await this.ready(); const request = this.requireRequest(requestId); validateSource(target); this.assertDisclosure(input.value, input.dataClass ?? 'USER_EXPLICIT'); if (input.type === 'OWNER_CONFIRMED_DECISION' && input.ownerConfirmation?.requestId !== requestId) throw new AgentPresenceError('UNAUTHORIZED', 'Owner confirmation does not match request'); const result = input.type === 'OWNER_CONFIRMED_DECISION' ? await createAgentProtocolResult({ agent: this.localAgent, type: input.type, value: input.value, dataClass: input.dataClass, ownerConfirmation: input.ownerConfirmation }, this.crypto, this.local) : await createAgentProtocolResult({ agent: this.localAgent, type: input.type, value: input.value, dataClass: input.dataClass }, this.crypto, this.local); const response = await this.makeResponse(request, result, target); await this.sendResponse(target, response); this.responses.set(response.id, response); await this.persist(); this.record({ event: 'concierge.shared', outcome: 'queued', peer: sourceIdentity(target), requestId, responseId: response.id, category: request.category, dataClasses: [result.dataClass] }); return clone(response); }
  async reject(requestId: string, reason = 'The owner did not approve this request'): Promise<void> { await this.ready(); const request = this.requireRequest(requestId); if (request.recipient.identityId !== this.local.nodeId) throw new AgentPresenceError('UNAUTHORIZED', 'Only the owner can reject a request'); this.requests.set(requestId, { ...request, status: 'rejected' }); await this.persist(); this.record({ event: 'concierge.rejected', outcome: 'denied', peer: sourceIdentity(request.source), requestId, category: request.category, dataClasses: [], reason: boundedText(reason, 256, 'Reason') }); await this.persist(); }
  async rejectRequest(requestId: string, reason?: string): Promise<void> { return this.reject(requestId, reason); }

  private async sendResult(request: ConciergeRequest, result: AgentProtocolResult, shareWith?: readonly ConciergeSource[]): Promise<ConciergeResponse[]> {
    const targets = uniqueSources([request.source, ...(shareWith ?? [])]); const sent: ConciergeResponse[] = []; for (const target of targets) { validateSource(target); const response = await this.makeResponse(request, result, target); await this.sendResponse(target, response); this.responses.set(response.id, response); sent.push(response); }
    this.requests.set(request.requestId, { ...request, status: 'answered' }); await this.persist(); this.record({ event: 'concierge.answered', outcome: 'queued', peer: sourceIdentity(request.source), requestId: request.requestId, category: request.category, responseId: sent[0]?.id, dataClasses: [result.dataClass] }); await this.persist(); return sent.map(clone);
  }
  private async sendResponse(target: ConciergeSource, response: ConciergeResponse): Promise<void> { const peer = sourceIdentity(target); this.assertContactIdentity(peer); await this.mailbox.sendConcierge(peer, { kind: 'response', response }); void this.mailbox.flush(peer).catch(() => undefined); }
  private async receivePresence(peer: NodeId, presence: AgentPresence): Promise<void> { if (presence.agent.identityId !== peer || !AGENT_PRESENCE_STATES.includes(presence.state) || !validSignedWindow(presence.updatedAt, presence.expiresAt, this.now())) throw new AgentPresenceError('INVALID_SIGNATURE', 'Invalid signed presence'); const previous = this.remotePresences.get(peer); if (previous && Date.parse(presence.updatedAt) <= Date.parse(previous.updatedAt)) throw new AgentPresenceError('REPLAY', 'Stale agent presence'); this.remotePresences.set(peer, clone(presence)); this.record({ event: 'presence.received', outcome: 'received', peer, dataClasses: [] }); await this.persist(); }
  private async receiveConcierge(peer: NodeId, payload: unknown): Promise<void> {
    try {
      if (!payload || typeof payload !== 'object' || !['request', 'response'].includes((payload as { kind?: unknown }).kind as string)) throw new AgentPresenceError('INVALID_STATE', 'Malformed concierge payload');
      if ((payload as { kind: string }).kind === 'request') await this.receiveRequest(peer, (payload as { request?: unknown }).request); else await this.receiveResponse(peer, (payload as { response?: unknown }).response);
    } catch (error) { this.record({ event: 'security.rejected', outcome: 'denied', peer, dataClasses: [], reason: error instanceof Error ? error.message.slice(0, 256) : 'Concierge message rejected' }); await this.persist(); throw error; }
  }
  private async receiveRequest(peer: NodeId, raw: unknown): Promise<void> {
    const request = parseRequest(raw); if (request.sender.identityId !== peer || request.recipient.identityId !== this.local.nodeId || request.recipient.agentId !== this.localAgent.agentId || !(await this.verifySigned(request, peer)) || !validSignedWindow(request.createdAt, request.expiresAt, this.now())) throw new AgentPresenceError('INVALID_SIGNATURE', 'Invalid concierge request signature'); if (request.source.kind === 'agent' && (request.source.agent.identityId !== peer || request.source.agent.agentId !== request.sender.agentId) || request.source.kind === 'human' && request.source.identityId !== peer) throw new AgentPresenceError('UNAUTHORIZED', 'Request source does not match sender'); if (this.seenIds.has(request.id) || this.requests.has(request.requestId)) throw new AgentPresenceError('REPLAY', 'Concierge request replay'); this.seenIds.add(request.id); this.seenIds.add(request.requestId); normalizeContext(request.explicitContext);
    if (await this.isBlocked?.(request.source.kind === 'agent' ? request.source.agent : { agentId: request.sender.agentId, identityId: peer })) throw new AgentPresenceError('POLICY_DENIED', 'Blocked requester'); if (await this.isMuted?.(request.source.kind === 'agent' ? request.source.agent : { agentId: request.sender.agentId, identityId: peer })) throw new AgentPresenceError('POLICY_DENIED', 'Muted requester'); if (!await this.allowed(request.source) || !this.policy.acceptingMessages) throw new AgentPresenceError('POLICY_DENIED', 'Concierge policy denies this requester'); if (this.requests.size >= this.policy.maxInbox) throw new AgentPresenceError('QUOTA', 'Owner inbox quota exceeded'); if (this.recentRequests(peer) >= this.policy.maxPerSenderPerHour) throw new AgentPresenceError('QUOTA', 'Concierge sender rate limit exceeded');
    let status: AgentConciergeStatus = 'waiting_for_owner'; const current = this.presence(); const canAuto = this.policy.autoCategories.includes(request.category) && !this.policy.ownerApprovalCategories.includes(request.category) && current?.state !== 'do_not_disturb' && current?.state !== 'ask_owner' && current?.state !== 'offline' && current?.state !== undefined && current.acceptingMessages !== false;
    const stored = { ...request, status }; this.requests.set(request.requestId, stored); this.record({ event: 'concierge.received', outcome: 'received', peer, requestId: request.requestId, category: request.category, dataClasses: request.explicitContext.map(value => value.dataClass) }); await this.persist(); await this.onInbox?.(this.toInboxItem(stored));
    if (canAuto && this.autoResponder) { const answer = await this.autoResponder(clone(stored)); if (answer) { this.assertDisclosure(answer.value, answer.dataClass ?? 'PUBLIC'); const result = await createAgentProtocolResult({ agent: this.localAgent, type: answer.type, value: answer.value, dataClass: answer.dataClass ?? 'PUBLIC' }, this.crypto, this.local); const responses = await this.sendResult(stored, result, answer.shareWith); status = responses.length ? 'answered' : status; } }
    if (status !== 'answered') this.requests.set(request.requestId, { ...stored, status: 'waiting_for_owner' }); await this.persist();
  }
  private async receiveResponse(peer: NodeId, raw: unknown): Promise<void> {
    const response = parseResponse(raw); if (response.sender.identityId !== peer || !validSignedWindow(response.createdAt, response.expiresAt, this.now()) || !(await this.verifySigned(response, peer)) || !this.recipientMatchesLocal(response.recipient)) throw new AgentPresenceError('INVALID_SIGNATURE', 'Invalid concierge response signature'); const request = this.requests.get(response.requestId); if (request && request.sender.identityId !== this.local.nodeId) throw new AgentPresenceError('UNAUTHORIZED', 'Response does not match a local request'); const key = this.mailbox.contactsList().find(value => value.agent.identityId === peer)?.signingPublicKey; if (!key) throw new AgentPresenceError('UNAUTHORIZED', 'Unknown response signer'); const result = await validateAgentProtocolResult(response.result, this.crypto, key); this.assertDisclosure(result.value, result.dataClass); if (result.type === 'OWNER_CONFIRMED_DECISION' && (!result.ownerConfirmation || result.ownerConfirmation.requestId !== response.requestId || await this.crypto.hash(canonicalJson({ requestId: response.requestId, type: result.type, value: result.value })) !== result.ownerConfirmation.actionHash)) throw new AgentPresenceError('UNAUTHORIZED', 'Owner confirmation does not match request'); if (this.responses.has(response.id)) throw new AgentPresenceError('REPLAY', 'Concierge response replay'); this.responses.set(response.id, { ...response, result }); if (request) this.requests.set(request.requestId, { ...request, status: 'answered' }); this.seenIds.add(response.id); this.record({ event: 'concierge.answered', outcome: 'received', peer, requestId: response.requestId, responseId: response.id, dataClasses: [result.dataClass] }); await this.persist();
  }
  private async allowed(source: ConciergeSource): Promise<boolean> { if (this.policy.accessMode === 'deny') return false; if (this.policy.accessMode === 'everyone') return true; const identity = sourceIdentity(source); if (this.policy.accessMode === 'selected_identities') return this.policy.selectedIdentityIds.includes(identity) || source.kind === 'agent' && this.policy.selectedAgentRefs.some(value => value.identityId === source.agent.identityId && value.agentId === source.agent.agentId); if (this.policy.accessMode === 'human_contacts') return source.kind === 'human' && (await this.isHumanContact?.(identity) ?? false); if (this.policy.accessMode === 'trusted_agents') return source.kind === 'agent' && (await this.isTrustedAgent?.(source.agent) ?? false); if (this.policy.accessMode === 'profile_policy') return await this.profilePolicy?.(source) ?? false; return false; }
  private effectivePresence(value: AgentPresence | undefined): AgentPresence | undefined { if (!value || Date.parse(value.expiresAt) <= this.now()) return undefined; return clone(value); }
  private toInboxItem(request: ConciergeRequest): OwnerInboxItem { return { request: clone(request), status: request.status, sourceLabel: request.source.kind === 'agent' ? request.source.agent.agentId : request.source.identityId, needsOwner: request.status === 'waiting_for_owner' || this.policy.ownerApprovalCategories.includes(request.category) }; }
  private async safeRequests(values: readonly ConciergeRequest[]): Promise<readonly ConciergeRequest[]> { const safe: ConciergeRequest[] = []; for (const value of values) if (await this.surfaceEligible(value.id, value)) safe.push(clone(value)); return safe; }
  private async safeResponses(values: readonly ConciergeResponse[]): Promise<readonly ConciergeResponse[]> { const safe: ConciergeResponse[] = []; for (const value of values) if (await this.surfaceEligible(value.id, value)) safe.push(clone(value)); return safe; }
  private async surfaceEligible(objectId: string, value: unknown): Promise<boolean> { return (await this.protectedSurfaces.evaluate('AGENT_MAILBOX', { objectId, domain: 'DIRECT_SHARED', value, content: value, sourceType: 'agent', verified: true, authorized: true, sharing: true })) !== undefined; }
  private recentRequests(peer: NodeId): number { return [...this.requests.values()].filter(value => value.sender.identityId === peer && Date.parse(value.createdAt) > this.now() - 60 * 60_000).length; }
  private requireRequest(requestId: string): ConciergeRequest { const value = this.requests.get(requestId); if (!value) throw new AgentPresenceError('NOT_FOUND', 'Concierge request not found'); if (Date.parse(value.expiresAt) <= this.now()) throw new AgentPresenceError('EXPIRED', 'Concierge request has expired'); return value; }
  private assertContact(agent: AgentRef): void { const contact = this.mailbox.contactsList().find(value => value.agent.identityId === agent.identityId); if (!contact || contact.revoked || contact.agent.agentId !== agent.agentId) throw new AgentPresenceError('UNAUTHORIZED', 'Agent is not an authenticated contact'); }
  private assertContactIdentity(identityId: NodeId): void { const contact = this.mailbox.contactsList().find(value => value.agent.identityId === identityId); if (!contact || contact.revoked) throw new AgentPresenceError('UNAUTHORIZED', 'Identity is not an authenticated contact'); }
  private async makeResponse(request: ConciergeRequest, result: AgentProtocolResult, recipient: ConciergeSource): Promise<ConciergeResponse> { const createdAt = iso(this.now()); const unsigned = { version: 1 as const, id: randomId(), requestId: request.requestId, sender: this.localAgent, recipient, result, createdAt, expiresAt: new Date(this.now() + 24 * 60 * 60_000).toISOString() }; return { ...unsigned, signature: await signCanonical(unsigned, canonicalBytes => this.crypto.sign(canonicalBytes, this.local.privateKey)) }; }
  private async verifySigned(value: { readonly signature: string }, signer: NodeId): Promise<boolean> { const contact = this.mailbox.contactsList().find(item => item.agent.identityId === signer); return !!contact && verifyCanonical(stripSignature(value), value.signature, (canonicalBytes, rawSignature) => this.crypto.verify(canonicalBytes, rawSignature, contact.signingPublicKey)); }
  private assertDisclosure(value: unknown, dataClass: 'PUBLIC' | 'USER_EXPLICIT'): void { if (dataClass !== 'PUBLIC' && dataClass !== 'USER_EXPLICIT') throw new AgentPresenceError('UNSHAREABLE_DATA', 'Only public or explicitly shared data may leave the owner'); const encoded = stringify(value); if (encoded.length > AGENT_CONCIERGE_MAX_DISCLOSURE_BYTES || !safeDisclosure(value, 0)) throw new AgentPresenceError('UNSHAREABLE_DATA', 'Disclosure contains private or unbounded data'); }
  private recipientMatchesLocal(source: ConciergeSource): boolean { if (source.kind === 'human') return source.identityId === this.local.nodeId; return source.agent.identityId === this.local.nodeId && source.agent.agentId === this.localAgent.agentId; }
  private async hydrate(): Promise<void> { const raw = await this.storage.read(); if (!raw) return; const snapshot = parseSnapshot(raw); this.policy = snapshot.policy; this.localPresence = snapshot.localPresence; snapshot.remotePresences.forEach(value => this.remotePresences.set(value.peer, value.presence)); snapshot.requests.forEach(value => this.requests.set(value.requestId, value)); snapshot.responses.forEach(value => this.responses.set(value.id, value)); snapshot.seenIds.forEach(value => this.seenIds.add(value)); this.auditEntries.push(...snapshot.audit); }
  private makeSnapshot(): AgentPresenceSnapshot { return { version: 1, ...(this.localPresence ? { localPresence: clone(this.localPresence) } : {}), remotePresences: [...this.remotePresences.entries()].map(([peer, presence]) => ({ peer, presence: clone(presence) })), policy: clone(this.policy), requests: [...this.requests.values()].slice(-AGENT_CONCIERGE_MAX_REQUESTS).map(clone), responses: [...this.responses.values()].slice(-AGENT_CONCIERGE_MAX_RESPONSES).map(clone), seenIds: [...this.seenIds].slice(-16_384), audit: this.auditEntries.slice(-AGENT_CONCIERGE_MAX_AUDIT).map(clone) }; }
  private async persist(): Promise<void> { const operation = this.writes.then(() => this.storage.write(this.makeSnapshot())); this.writes = operation.catch(() => undefined); await operation; }
  private record(input: Omit<AgentPresenceAuditRecord, 'version' | 'id' | 'at'>): void { this.auditEntries.push({ version: 1, id: randomId(), at: iso(this.now()), ...input }); while (this.auditEntries.length > AGENT_CONCIERGE_MAX_AUDIT) this.auditEntries.shift(); }
}

export class InMemoryAgentPresenceStateStore implements AgentMailboxStateStore { private value?: unknown; async read(): Promise<unknown | undefined> { return this.value === undefined ? undefined : structuredClone(this.value); } async write(value: unknown): Promise<void> { this.value = structuredClone(value); } }

function parseRequest(value: unknown): ConciergeRequest { if (!value || typeof value !== 'object') throw new AgentPresenceError('INVALID_STATE', 'Invalid concierge request'); const request = value as ConciergeRequest; if (request.version !== 1 || !safeId(request.id) || !safeId(request.requestId) || !normalizeAgentSafe(request.sender) || !normalizeAgentSafe(request.recipient) || !validSource(request.source) || !AGENT_CONCIERGE_KINDS.includes(request.kind) || !AGENT_CONCIERGE_CATEGORIES.includes(request.category) || !AGENT_CONCIERGE_PRIORITIES.includes(request.priority) || !Array.isArray(request.explicitContext) || !boundedCheck(request.text, AGENT_CONCIERGE_MAX_TEXT) || !Number.isFinite(Date.parse(request.createdAt)) || !Number.isFinite(Date.parse(request.expiresAt)) || !AGENT_CONCIERGE_STATUSES.includes(request.status) || typeof request.signature !== 'string') throw new AgentPresenceError('INVALID_STATE', 'Invalid concierge request shape'); return clone(request); }
function parseResponse(value: unknown): ConciergeResponse { if (!value || typeof value !== 'object') throw new AgentPresenceError('INVALID_STATE', 'Invalid concierge response'); const response = value as ConciergeResponse; if (response.version !== 1 || !safeId(response.id) || !safeId(response.requestId) || !normalizeAgentSafe(response.sender) || !validSource(response.recipient) || !response.result || !Number.isFinite(Date.parse(response.createdAt)) || !Number.isFinite(Date.parse(response.expiresAt)) || typeof response.signature !== 'string') throw new AgentPresenceError('INVALID_STATE', 'Invalid concierge response shape'); return clone(response); }
function parseSnapshot(value: unknown): AgentPresenceSnapshot { if (!value || typeof value !== 'object' || (value as { version?: unknown }).version !== 1 || !Array.isArray((value as { remotePresences?: unknown }).remotePresences) || !(value as { policy?: unknown }).policy || !Array.isArray((value as { requests?: unknown }).requests) || !Array.isArray((value as { responses?: unknown }).responses) || !Array.isArray((value as { seenIds?: unknown }).seenIds) || !Array.isArray((value as { audit?: unknown }).audit)) throw new AgentPresenceError('INVALID_STATE', 'Invalid AgentPresence state'); const candidate = value as AgentPresenceSnapshot; return { version: 1, ...(candidate.localPresence ? { localPresence: clone(candidate.localPresence) } : {}), remotePresences: candidate.remotePresences.filter(value => !!value && safeId(value.peer) && !!value.presence).map(value => ({ peer: value.peer, presence: clone(value.presence) })), policy: normalizePolicy(candidate.policy), requests: candidate.requests.map(parseRequest).slice(-AGENT_CONCIERGE_MAX_REQUESTS), responses: candidate.responses.map(parseResponse).slice(-AGENT_CONCIERGE_MAX_RESPONSES), seenIds: candidate.seenIds.filter(safeId).slice(-16_384), audit: candidate.audit.slice(-AGENT_CONCIERGE_MAX_AUDIT).map(clone) }; }
function normalizePolicy(value: Partial<PersonalConciergePolicy>): PersonalConciergePolicy { const result: PersonalConciergePolicy = { version: 1, accessMode: value.accessMode ?? DEFAULT_POLICY.accessMode, selectedIdentityIds: uniqueIds(value.selectedIdentityIds ?? []), selectedAgentRefs: uniqueAgents(value.selectedAgentRefs ?? []), autoCategories: uniqueEnum(value.autoCategories ?? [], AGENT_CONCIERGE_CATEGORIES), ownerApprovalCategories: uniqueEnum(value.ownerApprovalCategories ?? [], AGENT_CONCIERGE_CATEGORIES), acceptingMessages: value.acceptingMessages ?? DEFAULT_POLICY.acceptingMessages, maxInbox: boundedInt(value.maxInbox ?? DEFAULT_POLICY.maxInbox, 1, AGENT_CONCIERGE_MAX_REQUESTS), maxPerSenderPerHour: boundedInt(value.maxPerSenderPerHour ?? DEFAULT_POLICY.maxPerSenderPerHour, 1, 10_000), defaultPriority: value.defaultPriority ?? DEFAULT_POLICY.defaultPriority }; if (!AGENT_CONCIERGE_ACCESS_MODES.includes(result.accessMode) || !AGENT_CONCIERGE_PRIORITIES.includes(result.defaultPriority)) throw new AgentPresenceError('INVALID_ARGUMENT', 'Invalid concierge policy'); return result; }
function normalizeContext(values: readonly AgentSharedContext[]): AgentSharedContext[] { if (!Array.isArray(values) || values.length > 64) throw new AgentPresenceError('UNSHAREABLE_DATA', 'Explicit context is too large'); return values.map(value => { if (!value || !safeId(value.id) || !boundedCheck(value.label, 240) || (value.dataClass !== 'PUBLIC' && value.dataClass !== 'USER_EXPLICIT') || stringify(value.value).length > 32_000) throw new AgentPresenceError('UNSHAREABLE_DATA', 'Only bounded PUBLIC/USER_EXPLICIT context is allowed'); return { id: value.id, label: value.label.trim(), value: structuredClone(value.value), dataClass: value.dataClass }; }); }
function safeDisclosure(value: unknown, depth: number): boolean { if (depth > 4) return false; if (value === null || typeof value === 'boolean' || typeof value === 'number') return true; if (typeof value === 'string') return value.length <= 1_024 && !/(private\s+memory|raw\s+(context|data)|recovery\s+phrase|private\s+key|credential|password|device\s+state|security\s+event|filename|location\s+history|full\s+history|rag\b)/i.test(value); if (Array.isArray(value)) return value.length <= 32 && value.every(item => safeDisclosure(item, depth + 1)); if (typeof value === 'object') { const entries = Object.entries(value as Record<string, unknown>); return entries.length <= 32 && entries.every(([key, item]) => !/(private|secret|memory|rag|credential|password|recovery|device|security|filename|location|history|contact)/i.test(key) && safeDisclosure(item, depth + 1)); } return false; }
function validateSource(value: ConciergeSource): void { if (!validSource(value)) throw new AgentPresenceError('INVALID_ARGUMENT', 'Invalid concierge source'); }
function validSource(value: unknown): value is ConciergeSource { return !!value && typeof value === 'object' && ((value as ConciergeSource).kind === 'human' && safeId((value as { identityId?: unknown }).identityId)) || ((value as ConciergeSource).kind === 'agent' && normalizeAgentSafe((value as { agent?: unknown }).agent)); }
function sourceIdentity(value: ConciergeSource): NodeId { return value.kind === 'human' ? value.identityId : value.agent.identityId; }
function uniqueSources(values: readonly ConciergeSource[]): ConciergeSource[] { const map = new Map<string, ConciergeSource>(); for (const value of values) map.set(value.kind === 'human' ? `h:${value.identityId}` : `a:${value.agent.identityId}:${value.agent.agentId}`, clone(value)); return [...map.values()]; }
function uniqueAgents(values: readonly AgentRef[]): AgentRef[] { const map = new Map<string, AgentRef>(); for (const value of values) if (normalizeAgentSafe(value)) map.set(`${value.identityId}:${value.agentId}`, clone(value)); return [...map.values()]; }
function uniqueIds(values: readonly string[]): string[] { return [...new Set(values.filter(safeId))]; }
function uniqueEnum<T extends string>(values: readonly T[], allowed: readonly T[]): T[] { return [...new Set(values.filter(value => allowed.includes(value)))]; }
function normalizeAgent(value: AgentRef): AgentRef { if (!normalizeAgentSafe(value)) throw new AgentPresenceError('INVALID_ARGUMENT', 'Invalid agent reference'); return { agentId: value.agentId, identityId: value.identityId }; }
function normalizeAgentSafe(value: unknown): value is AgentRef { return !!value && typeof value === 'object' && safeId((value as AgentRef).agentId) && safeId((value as AgentRef).identityId); }
function assertPresenceExpiry(createdAt: string, expiresAt: string, now: number): void { const start = Date.parse(createdAt); const end = Date.parse(expiresAt); if (!Number.isFinite(start) || !Number.isFinite(end) || end <= now || end < start || end - now > AGENT_PRESENCE_MAX_LIFETIME_MS) throw new AgentPresenceError('INVALID_ARGUMENT', 'Presence expiry is invalid'); }
function assertRequestExpiry(createdAt: string, expiresAt: string, now: number): void { const start = Date.parse(createdAt); const end = Date.parse(expiresAt); if (!Number.isFinite(start) || !Number.isFinite(end) || end <= now || end <= start || end - now > 7 * 24 * 60 * 60_000) throw new AgentPresenceError('INVALID_ARGUMENT', 'Request expiry is invalid'); }
function validSignedWindow(createdAt: string, expiresAt: string, now: number): boolean { const start = Date.parse(createdAt); const end = Date.parse(expiresAt); return Number.isFinite(start) && Number.isFinite(end) && end > now - 1_000 && start <= now + 60_000 && end > start && end - now <= 7 * 24 * 60 * 60_000 + 1_000; }
function assertIn<T extends string>(value: T, values: readonly T[], label: string): T { if (!values.includes(value)) throw new AgentPresenceError('INVALID_ARGUMENT', `Invalid ${label}`); return value; }
function boundedText(value: string, max: number, label: string): string { if (typeof value !== 'string' || !value.trim() || value.length > max) throw new AgentPresenceError('INVALID_ARGUMENT', `${label} is invalid`); return value.trim(); }
function boundedCheck(value: unknown, max: number): value is string { return typeof value === 'string' && !!value.trim() && value.length <= max; }
function boundedInt(value: number, min: number, max: number): number { if (!Number.isSafeInteger(value) || value < min || value > max) throw new AgentPresenceError('INVALID_ARGUMENT', 'Integer is outside bounds'); return value; }
function validSourceIdentity(value: ConciergeSource): NodeId { return sourceIdentity(value); }
function stripSignature<T extends { readonly signature: string }>(value: T): Omit<T, 'signature'> { const { signature: _signature, ...unsigned } = value; return unsigned; }
function stringify(value: unknown): string { try { return JSON.stringify(value) ?? String(value); } catch { return '[unserializable]'; } }
function safeId(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9_-][A-Za-z0-9._:-]{0,127}$/.test(value); }
function iso(value: number): string { return new Date(value).toISOString(); }
function randomId(): string { return `${globalThis.crypto.randomUUID()}`; }
function clone<T>(value: T): T { return structuredClone(value); }
