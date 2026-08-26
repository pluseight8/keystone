/**
 * Privacy-preserving negotiation between trusted Personal AI agents.
 *
 * The mailbox supplies recipient-bound encryption, replay protection and
 * transport delivery.  This layer signs and validates the negotiation state
 * and deliberately stores only constraint metadata.  Constraint values stay
 * in the evaluator owned by the local process; only a small derived response
 * may cross the wire.
 */
import { canonicalJson, type CryptoProvider } from '../crypto.js';
import type { DeviceSessionKeys } from '../identity.js';
import type { NodeId } from '../types.js';
import { AgentMailbox, type AgentContact, type AgentMailboxStateStore } from './agent-social.js';
import type { AgentRef } from './visits.js';
import { MandatorySafetySurfaceRegistry } from '../security/safety-surfaces.js';
import { SafetyRuntime, SafetySurfaceGate } from '../security/content-safety.js';

export const AGENT_NEGOTIATION_VERSION = 1 as const;
export const AGENT_NEGOTIATION_MAX_LIFETIME_MS = 7 * 24 * 60 * 60_000;
export const AGENT_NEGOTIATION_MAX_PARTICIPANTS = 32;
export const AGENT_NEGOTIATION_MAX_OPTIONS = 64;
export const AGENT_NEGOTIATION_MAX_CONSTRAINTS = 64;
export const AGENT_NEGOTIATION_MAX_RESPONSES = 512;
export const AGENT_NEGOTIATION_MAX_AUDIT = 2_000;

export const NEGOTIATION_STRATEGIES = ['UNANIMOUS', 'MAJORITY', 'BEST_SCORE', 'FIRST_COMMON', 'HOST_DECIDES'] as const;
export type NegotiationStrategy = (typeof NEGOTIATION_STRATEGIES)[number];
export const NEGOTIATION_STATUSES = ['pending', 'active', 'completed', 'rejected', 'timed_out', 'cancelled', 'left'] as const;
export type NegotiationStatus = (typeof NEGOTIATION_STATUSES)[number];
export const NEGOTIATION_DISCLOSURES = ['EXACT', 'RANGE', 'BOOLEAN', 'SCORE', 'REDACTED'] as const;
export type NegotiationDisclosure = (typeof NEGOTIATION_DISCLOSURES)[number];
export const NEGOTIATION_POLICY_MODES = ['ASK_EVERY_TIME', 'ALLOW_SAFE_NEGOTIATIONS', 'ALLOW_FROM_TRUSTED_AGENTS', 'DENY'] as const;
export type NegotiationPolicyMode = (typeof NEGOTIATION_POLICY_MODES)[number];
export const NEGOTIATION_DECISIONS = ['accept', 'reject', 'abstain', 'counter'] as const;
export type NegotiationDecision = (typeof NEGOTIATION_DECISIONS)[number];
export const NEGOTIATION_DATA_CLASSES = ['PUBLIC', 'USER_EXPLICIT', 'PRIVATE', 'SECRET'] as const;
export type NegotiationDataClass = (typeof NEGOTIATION_DATA_CLASSES)[number];

export interface NegotiationConstraint {
  readonly id: string;
  readonly label: string;
  readonly dataClass: NegotiationDataClass;
  readonly disclosure: NegotiationDisclosure;
  /** Values are intentionally absent. The local evaluator owns them. */
  readonly localOnly: true;
}

export interface NegotiationOption {
  readonly id: string;
  readonly label: string;
  readonly disclosure?: NegotiationDisclosure;
  readonly dataClass: 'PUBLIC' | 'USER_EXPLICIT';
}

export interface NegotiationParticipant extends AgentRef {
  readonly role: 'host' | 'participant';
  readonly trusted?: boolean;
}

export interface NegotiationSession {
  readonly version: 1;
  readonly id: string;
  readonly title: string;
  readonly category: string;
  readonly host: AgentRef;
  readonly participants: readonly NegotiationParticipant[];
  readonly strategy: NegotiationStrategy;
  readonly disclosureDefault: NegotiationDisclosure;
  readonly constraints: readonly NegotiationConstraint[];
  readonly roomId?: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly status: NegotiationStatus;
  readonly revision: number;
  readonly signature: string;
}

/** Alias used by UI/API callers that describe a session as a negotiation. */
export type AgentNegotiation = NegotiationSession;

export interface NegotiationProposal {
  readonly version: 1;
  readonly id: string;
  readonly sessionId: string;
  readonly sender: AgentRef;
  readonly kind: 'proposal' | 'counter-proposal';
  readonly options: readonly NegotiationOption[];
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly signature: string;
}

export interface NegotiationResponse {
  readonly version: 1;
  readonly id: string;
  readonly sessionId: string;
  readonly proposalId: string;
  readonly sender: AgentRef;
  readonly decision: NegotiationDecision;
  readonly selectedOptionIds: readonly string[];
  readonly disclosure: NegotiationDisclosure;
  /** A bounded derived value. It must not contain source constraint values. */
  readonly derived?: NegotiationDerivedValue;
  readonly score?: number;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly signature: string;
}

/**
 * Safe derived output is intentionally small and typed. It can express a
 * boolean/range/score without carrying arbitrary source text or nested data.
 */
export interface NegotiationDerivedObject {
  readonly available?: boolean;
  readonly accepted?: boolean;
  readonly preferred?: boolean;
  readonly min?: number;
  readonly max?: number;
  readonly optionIds?: readonly string[];
}
export type NegotiationDerivedValue = boolean | number | NegotiationDerivedObject;

export interface NegotiationResult {
  readonly version: 1;
  readonly id: string;
  readonly sessionId: string;
  readonly strategy: NegotiationStrategy;
  readonly status: Extract<NegotiationStatus, 'completed' | 'rejected' | 'timed_out' | 'cancelled'>;
  readonly selectedOptionIds: readonly string[];
  readonly responseIds: readonly string[];
  readonly disclosure: NegotiationDisclosure;
  readonly createdAt: string;
  readonly endedAt: string;
  readonly signature: string;
}

export interface NegotiationPolicy {
  readonly version: 1;
  readonly mode: NegotiationPolicyMode;
  readonly allowedCategories: readonly string[];
  readonly defaultDisclosure: NegotiationDisclosure;
  readonly maxSessions: number;
  readonly maxPending: number;
  readonly maxProposals: number;
  readonly maxResponses: number;
  readonly askBeforeAccepting: boolean;
}

export interface NegotiationEvaluation {
  readonly decision: NegotiationDecision;
  readonly selectedOptionIds?: readonly string[];
  readonly disclosure?: NegotiationDisclosure;
  readonly derived?: unknown;
  readonly score?: number;
}

export interface NegotiationEvaluatorContext {
  readonly session: NegotiationSession;
  readonly proposal: NegotiationProposal;
  readonly constraints: readonly NegotiationConstraint[];
}

export type NegotiationEvaluator = (context: NegotiationEvaluatorContext) => NegotiationEvaluation | Promise<NegotiationEvaluation>;

export interface NegotiationAuditRecord {
  readonly version: 1;
  readonly id: string;
  readonly at: string;
  readonly event: 'session.sent' | 'session.received' | 'proposal.sent' | 'proposal.received' | 'response.sent' | 'response.received' | 'result.completed' | 'security.rejected' | 'session.cancelled' | 'session.expired';
  readonly outcome: 'accepted' | 'denied' | 'queued' | 'received';
  readonly negotiationId?: string;
  readonly peer?: NodeId;
  readonly strategy?: NegotiationStrategy;
  readonly proposalCount?: number;
  readonly responseCount?: number;
  readonly disclosure?: NegotiationDisclosure;
  readonly startedAt?: string;
  readonly endedAt?: string;
  readonly reason?: string;
}

export interface NegotiationSnapshot {
  readonly version: 1;
  readonly policy: NegotiationPolicy;
  readonly sessions: readonly NegotiationSession[];
  readonly proposals: readonly NegotiationProposal[];
  readonly responses: readonly NegotiationResponse[];
  readonly results: readonly NegotiationResult[];
  readonly seenIds: readonly string[];
  readonly audit: readonly NegotiationAuditRecord[];
}

export interface AgentNegotiationServiceOptions {
  readonly mailbox: AgentMailbox;
  readonly crypto: CryptoProvider;
  readonly local: DeviceSessionKeys;
  readonly storage?: AgentMailboxStateStore;
  readonly policy?: Partial<NegotiationPolicy>;
  readonly evaluator?: NegotiationEvaluator;
  readonly now?: () => number;
  readonly onApprovalRequired?: (session: NegotiationSession) => void | Promise<void>;
  readonly protectedSurfaces?: MandatorySafetySurfaceRegistry;
}

export class AgentNegotiationError extends Error {
  constructor(readonly code: 'INVALID_ARGUMENT' | 'INVALID_SIGNATURE' | 'INVALID_STATE' | 'UNAUTHORIZED' | 'UNKNOWN_CONTACT' | 'POLICY_DENIED' | 'APPROVAL_REQUIRED' | 'QUOTA' | 'REPLAY' | 'DUPLICATE' | 'EXPIRED' | 'NOT_FOUND' | 'UNSHAREABLE_DATA', message: string) { super(message); this.name = 'AgentNegotiationError'; }
}

interface NegotiationWireMessage {
  readonly version: 1;
  readonly kind: 'session' | 'proposal' | 'response' | 'result' | 'cancel';
  readonly sender: AgentRef;
  readonly recipient: AgentRef;
  readonly negotiationId: string;
  readonly expiresAt: string;
  readonly payload: NegotiationSession | NegotiationProposal | NegotiationResponse | NegotiationResult | { readonly sessionId: string; readonly action?: 'leave' };
  readonly signature: string;
}

const DEFAULT_POLICY: NegotiationPolicy = { version: 1, mode: 'ASK_EVERY_TIME', allowedCategories: [], defaultDisclosure: 'REDACTED', maxSessions: 128, maxPending: 64, maxProposals: 512, maxResponses: 512, askBeforeAccepting: true };

export class AgentNegotiationService {
  private readonly mailbox: AgentMailbox;
  private readonly crypto: CryptoProvider;
  private readonly local: DeviceSessionKeys;
  private readonly storage: AgentMailboxStateStore;
  private readonly evaluator?: NegotiationEvaluator;
  private readonly now: () => number;
  private readonly onApprovalRequired?: AgentNegotiationServiceOptions['onApprovalRequired'];
  private readonly sessions = new Map<string, NegotiationSession>();
  private readonly proposals = new Map<string, NegotiationProposal>();
  private readonly responses = new Map<string, NegotiationResponse>();
  private readonly results = new Map<string, NegotiationResult>();
  private readonly seenIds = new Set<string>();
  private readonly auditEntries: NegotiationAuditRecord[] = [];
  private policy: NegotiationPolicy;
  private writes: Promise<void> = Promise.resolve();
  private receiveQueue: Promise<void> = Promise.resolve();
  private readyPromise: Promise<void>;
  private readonly unsubscribe: () => void;
  private readonly protectedSurfaces: MandatorySafetySurfaceRegistry;

  constructor(options: AgentNegotiationServiceOptions) {
    this.mailbox = options.mailbox; this.crypto = options.crypto; this.local = options.local; this.storage = options.storage ?? new InMemoryNegotiationStateStore(); this.evaluator = options.evaluator; this.now = options.now ?? Date.now; this.onApprovalRequired = options.onApprovalRequired; this.protectedSurfaces = options.protectedSurfaces ?? new MandatorySafetySurfaceRegistry(new SafetySurfaceGate(new SafetyRuntime())); this.policy = normalizePolicy({ ...DEFAULT_POLICY, ...options.policy });
    this.unsubscribe = this.mailbox.onNegotiationMessage((peer, payload) => this.receive(peer, payload));
    this.readyPromise = this.hydrate();
  }

  async ready(): Promise<void> { await this.readyPromise; }
  close(): void { this.unsubscribe(); }
  policySnapshot(): NegotiationPolicy { return clone(this.policy); }
  async setPolicy(input: Partial<NegotiationPolicy>): Promise<NegotiationPolicy> { await this.ready(); this.policy = normalizePolicy({ ...this.policy, ...input }); await this.persist(); return clone(this.policy); }
  async snapshot(): Promise<NegotiationSnapshot> {
    await this.ready();
    const raw = this.makeSnapshot();
    const filter = async <T extends { readonly id: string }>(values: readonly T[]): Promise<readonly T[]> => {
      const safe: T[] = [];
      for (const value of values) if (await this.surfaceEligible(value.id, value)) safe.push(clone(value));
      return safe;
    };
    return { ...raw, sessions: await filter(raw.sessions), proposals: await filter(raw.proposals), responses: await filter(raw.responses), results: await filter(raw.results) };
  }
  async listSessions(): Promise<readonly NegotiationSession[]> { await this.ready(); const safe: NegotiationSession[] = []; for (const value of this.sessions.values()) if (await this.surfaceEligible(value.id, value)) safe.push(effectiveSession(value, this.now())); return safe; }
  async listProposals(sessionId?: string): Promise<readonly NegotiationProposal[]> { await this.ready(); const safe: NegotiationProposal[] = []; for (const value of this.proposals.values()) if ((!sessionId || value.sessionId === sessionId) && await this.surfaceEligible(value.id, value)) safe.push(clone(value)); return safe; }
  async listResponses(sessionId?: string): Promise<readonly NegotiationResponse[]> { await this.ready(); const safe: NegotiationResponse[] = []; for (const value of this.responses.values()) if ((!sessionId || value.sessionId === sessionId) && await this.surfaceEligible(value.id, value)) safe.push(clone(value)); return safe; }
  async listResults(): Promise<readonly NegotiationResult[]> { await this.ready(); const safe: NegotiationResult[] = []; for (const value of this.results.values()) if (await this.surfaceEligible(value.id, value)) safe.push(clone(value)); return safe; }
  audit(): readonly NegotiationAuditRecord[] { return this.auditEntries.map(clone); }
  async flush(peer?: NodeId): Promise<void> { await this.mailbox.flush(peer); }

  async createSession(input: { title: string; category?: string; participants: readonly AgentRef[]; strategy?: NegotiationStrategy; constraints?: readonly NegotiationConstraint[]; disclosureDefault?: NegotiationDisclosure; expiresAt?: string; roomId?: string }): Promise<NegotiationSession> {
    await this.ready(); if (this.policy.mode === 'DENY') throw new AgentNegotiationError('POLICY_DENIED', 'Negotiations are disabled'); if (this.sessions.size >= this.policy.maxSessions) throw new AgentNegotiationError('QUOTA', 'Negotiation session quota exceeded'); const participants = uniqueParticipants([{ ...this.mailbox.localAgentRef, role: 'host' }, ...input.participants.map(value => ({ ...value, role: 'participant' as const }))]); if (participants.length < 2 || participants.length > AGENT_NEGOTIATION_MAX_PARTICIPANTS) throw new AgentNegotiationError('INVALID_ARGUMENT', 'Negotiation participant count is invalid'); if (!participants.some(value => value.identityId === this.local.nodeId && value.agentId === this.mailbox.localAgentRef.agentId)) throw new AgentNegotiationError('UNAUTHORIZED', 'Local agent must host the negotiation'); for (const participant of participants.filter(value => value.identityId !== this.local.nodeId)) this.assertContact(participant);
    const createdAt = iso(this.now()); const expiresAt = input.expiresAt ?? new Date(this.now() + 24 * 60 * 60_000).toISOString(); assertExpiry(createdAt, expiresAt, this.now()); const category = boundedText(input.category ?? 'general', 96); if (containsPrivateMarker(category) || this.policy.allowedCategories.length && !this.policy.allowedCategories.includes(category)) throw new AgentNegotiationError('POLICY_DENIED', 'Negotiation category is not allowed'); const constraints = normalizeConstraints(input.constraints ?? []); if (input.roomId) await this.assertRoom(input.roomId, participants); const title = boundedText(input.title, 256); if (containsPrivateMarker(title)) throw new AgentNegotiationError('UNSHAREABLE_DATA', 'Session title must not contain private context'); const unsigned = { version: 1 as const, id: randomId(), title, category, host: this.mailbox.localAgentRef, participants, strategy: assertStrategy(input.strategy ?? 'FIRST_COMMON'), disclosureDefault: assertDisclosure(input.disclosureDefault ?? this.policy.defaultDisclosure), constraints, ...(input.roomId ? { roomId: assertId(input.roomId) } : {}), createdAt, expiresAt, status: 'active' as const, revision: 1 }; const session: NegotiationSession = { ...unsigned, signature: await this.sign(unsigned) }; this.sessions.set(session.id, session); await this.persist(); for (const participant of participants.filter(value => value.identityId !== this.local.nodeId)) await this.send(participant.identityId, 'session', session.id, session.expiresAt, session, participant); this.record({ event: 'session.sent', outcome: 'queued', negotiationId: session.id, strategy: session.strategy, proposalCount: 0, responseCount: 0, disclosure: session.disclosureDefault, startedAt: session.createdAt }); await this.persist(); return clone(session);
  }

  async propose(sessionId: string, input: { options: readonly NegotiationOption[]; kind?: 'proposal' | 'counter-proposal' }): Promise<NegotiationProposal> {
    await this.ready(); const session = this.requireSession(sessionId); this.assertActive(session); if (!isParticipant(session, this.mailbox.localAgentRef)) throw new AgentNegotiationError('UNAUTHORIZED', 'Only a participant may propose'); if (input.kind !== undefined && !['proposal', 'counter-proposal'].includes(input.kind)) throw new AgentNegotiationError('INVALID_ARGUMENT', 'Invalid proposal kind'); if (this.proposals.size >= this.policy.maxProposals) throw new AgentNegotiationError('QUOTA', 'Negotiation proposal quota exceeded'); const options = normalizeOptions(input.options); const createdAt = iso(this.now()); const unsigned = { version: 1 as const, id: randomId(), sessionId, sender: this.mailbox.localAgentRef, kind: input.kind ?? 'proposal', options, createdAt, expiresAt: session.expiresAt }; const proposal: NegotiationProposal = { ...unsigned, signature: await this.sign(unsigned) }; this.proposals.set(proposal.id, proposal); await this.persist(); for (const participant of session.participants.filter(value => value.identityId !== this.local.nodeId)) await this.send(participant.identityId, 'proposal', session.id, session.expiresAt, proposal, participant); this.record({ event: 'proposal.sent', outcome: 'queued', negotiationId: session.id, strategy: session.strategy, proposalCount: 1, responseCount: 0, disclosure: session.disclosureDefault }); await this.persist(); return clone(proposal);
  }

  async counterPropose(sessionId: string, options: readonly NegotiationOption[]): Promise<NegotiationProposal> { return this.propose(sessionId, { options, kind: 'counter-proposal' }); }

  async respond(sessionId: string, proposalId: string, evaluation: NegotiationEvaluation): Promise<NegotiationResponse> {
    await this.ready(); const session = this.requireSession(sessionId); this.assertActive(session); const proposal = this.proposals.get(proposalId); if (!proposal || proposal.sessionId !== sessionId) throw new AgentNegotiationError('NOT_FOUND', 'Negotiation proposal not found'); if (!isParticipant(session, this.mailbox.localAgentRef)) throw new AgentNegotiationError('UNAUTHORIZED', 'Agent is not a negotiation participant'); const response = await this.makeResponse(session, proposal, evaluation); this.storeResponse(response); await this.persist(); if (session.host.identityId !== this.local.nodeId) { await this.send(session.host.identityId, 'response', session.id, session.expiresAt, response, session.host); } this.record({ event: 'response.sent', outcome: 'queued', negotiationId: session.id, strategy: session.strategy, proposalCount: 1, responseCount: 1, disclosure: response.disclosure }); await this.persist(); return clone(response);
  }

  async evaluate(sessionId: string, proposalId: string): Promise<NegotiationResponse> { if (!this.evaluator) throw new AgentNegotiationError('INVALID_STATE', 'No local negotiation evaluator is configured'); const session = this.requireSession(sessionId); const proposal = this.proposals.get(proposalId); if (!proposal) throw new AgentNegotiationError('NOT_FOUND', 'Negotiation proposal not found'); const evaluation = await this.evaluator({ session: clone(session), proposal: clone(proposal), constraints: clone(session.constraints) }); return this.respond(sessionId, proposalId, evaluation); }

  async finalize(sessionId: string, selectedOptionIds?: readonly string[]): Promise<NegotiationResult> {
    await this.ready(); const session = this.requireSession(sessionId); this.assertActive(session); if (session.host.identityId !== this.local.nodeId) throw new AgentNegotiationError('UNAUTHORIZED', 'Only the host may finalize a negotiation'); const responses = [...this.responses.values()].filter(value => value.sessionId === sessionId); const knownOptionIds = new Set([...this.proposals.values()].filter(value => value.sessionId === sessionId).flatMap(value => value.options.map(option => option.id))); const ids = selectedOptionIds ? normalizeIds(selectedOptionIds) : aggregate(session, responses); if (ids.some(id => !knownOptionIds.has(id))) throw new AgentNegotiationError('INVALID_ARGUMENT', 'Result selects an option that was not proposed'); const status: NegotiationResult['status'] = ids.length ? 'completed' : 'rejected'; const createdAt = iso(this.now()); const unsigned = { version: 1 as const, id: randomId(), sessionId, strategy: session.strategy, status, selectedOptionIds: ids, responseIds: responses.map(value => value.id), disclosure: session.disclosureDefault, createdAt, endedAt: createdAt }; const result: NegotiationResult = { ...unsigned, signature: await this.sign(unsigned) }; this.results.set(session.id, result); this.sessions.set(session.id, { ...session, status, revision: session.revision + 1 }); await this.persist(); for (const participant of session.participants.filter(value => value.identityId !== this.local.nodeId)) await this.send(participant.identityId, 'result', session.id, session.expiresAt, result, participant); this.record({ event: 'result.completed', outcome: status === 'completed' ? 'accepted' : 'denied', negotiationId: session.id, strategy: session.strategy, proposalCount: responses.length, responseCount: responses.length, disclosure: result.disclosure, startedAt: session.createdAt, endedAt: result.endedAt }); await this.persist(); return clone(result);
  }

  async cancel(sessionId: string): Promise<void> { await this.ready(); const session = this.requireSession(sessionId); this.assertActive(session); if (session.host.identityId !== this.local.nodeId) throw new AgentNegotiationError('UNAUTHORIZED', 'Only the host may cancel a negotiation'); this.sessions.set(sessionId, { ...session, status: 'cancelled', revision: session.revision + 1 }); await this.persist(); for (const participant of session.participants.filter(value => value.identityId !== this.local.nodeId)) await this.send(participant.identityId, 'cancel', session.id, session.expiresAt, { sessionId }, participant); this.record({ event: 'session.cancelled', outcome: 'accepted', negotiationId: sessionId, strategy: session.strategy, proposalCount: 0, responseCount: 0, disclosure: session.disclosureDefault, startedAt: session.createdAt, endedAt: iso(this.now()) }); await this.persist(); }
  async leave(sessionId: string): Promise<void> { await this.ready(); const session = this.requireSession(sessionId); if (session.status !== 'active' && session.status !== 'pending') throw new AgentNegotiationError('INVALID_STATE', 'Negotiation is no longer active'); if (Date.parse(session.expiresAt) <= this.now()) throw new AgentNegotiationError('EXPIRED', 'Negotiation is no longer active'); if (!isParticipant(session, this.mailbox.localAgentRef)) throw new AgentNegotiationError('UNAUTHORIZED', 'Agent is not a participant'); this.sessions.set(sessionId, { ...session, status: 'left', revision: session.revision + 1 }); await this.persist(); if (session.host.identityId !== this.local.nodeId) await this.send(session.host.identityId, 'cancel', session.id, session.expiresAt, { sessionId, action: 'leave' }, session.host); }
  async approveSession(sessionId: string): Promise<NegotiationSession> { await this.ready(); const session = this.requireSession(sessionId); if (session.status !== 'pending') throw new AgentNegotiationError('INVALID_STATE', 'Negotiation is not awaiting approval'); if (Date.parse(session.expiresAt) <= this.now()) throw new AgentNegotiationError('EXPIRED', 'Negotiation is no longer active'); if (!isParticipant(session, this.mailbox.localAgentRef)) throw new AgentNegotiationError('UNAUTHORIZED', 'Agent is not a participant'); this.sessions.set(sessionId, { ...session, status: 'active', revision: session.revision + 1 }); await this.persist(); return clone(this.sessions.get(sessionId)!); }
  async rejectSession(sessionId: string): Promise<void> { await this.ready(); const session = this.requireSession(sessionId); if (session.status !== 'pending') throw new AgentNegotiationError('INVALID_STATE', 'Negotiation is not awaiting approval'); if (Date.parse(session.expiresAt) <= this.now()) throw new AgentNegotiationError('EXPIRED', 'Negotiation is no longer active'); if (!isParticipant(session, this.mailbox.localAgentRef)) throw new AgentNegotiationError('UNAUTHORIZED', 'Agent is not a participant'); this.sessions.set(sessionId, { ...session, status: 'rejected', revision: session.revision + 1 }); await this.persist(); }
  async sweep(): Promise<void> { await this.ready(); const now = this.now(); for (const session of this.sessions.values()) if ((session.status === 'active' || session.status === 'pending') && Date.parse(session.expiresAt) <= now) { this.sessions.set(session.id, { ...session, status: 'timed_out', revision: session.revision + 1 }); this.record({ event: 'session.expired', outcome: 'denied', negotiationId: session.id, strategy: session.strategy, proposalCount: 0, responseCount: 0, disclosure: session.disclosureDefault, startedAt: session.createdAt, endedAt: iso(now) }); } await this.persist(); }

  private receive(peer: NodeId, raw: unknown): Promise<void> { const operation = this.receiveQueue.then(() => this.receiveNow(peer, raw)); this.receiveQueue = operation.catch(() => undefined); return operation; }

  private async receiveNow(peer: NodeId, raw: unknown): Promise<void> {
    try {
      await this.ready(); const wire = parseWire(raw); if (wire.sender.identityId !== peer || wire.recipient.identityId !== this.local.nodeId || wire.recipient.agentId !== this.mailbox.localAgentRef.agentId) throw new AgentNegotiationError('UNAUTHORIZED', 'Negotiation recipient binding failed'); if (Date.parse(wire.expiresAt) <= this.now()) throw new AgentNegotiationError('EXPIRED', 'Negotiation message expired'); if (this.seenIds.has(wire.signature) || this.seenIds.has(wire.payloadId)) throw new AgentNegotiationError('REPLAY', 'Negotiation message replay'); if (payloadId(wire.payload) !== wire.payloadId) throw new AgentNegotiationError('INVALID_SIGNATURE', 'Negotiation payload binding failed'); this.assertContact(wire.sender); const contact = this.mailbox.contactsList().find(value => value.agent.identityId === peer); if (!contact || !(await this.crypto.verify(canonicalJson(stripSignature(wire)), wire.signature, contact.signingPublicKey))) throw new AgentNegotiationError('INVALID_SIGNATURE', 'Negotiation signature is invalid'); if (!(await this.surfaceEligible(wire.payloadId, wire.payload))) throw new AgentNegotiationError('UNSHAREABLE_DATA', 'Negotiation payload failed mandatory safety gating');
      switch (wire.kind) { case 'session': { const session = wire.payload as NegotiationSession; assertWireSession(wire, session.id); await this.receiveSession(session, peer, wire.sender.agentId, wire.expiresAt); break; } case 'proposal': { const proposal = wire.payload as NegotiationProposal; assertWireSession(wire, proposal.sessionId); await this.receiveProposal(proposal, peer, wire.sender.agentId, wire.expiresAt); break; } case 'response': { const response = wire.payload as NegotiationResponse; assertWireSession(wire, response.sessionId); await this.receiveResponse(response, peer, wire.sender.agentId, wire.expiresAt); break; } case 'result': { const result = wire.payload as NegotiationResult; assertWireSession(wire, result.sessionId); await this.receiveResult(result, peer, wire.sender.agentId); break; } case 'cancel': { const cancel = wire.payload as { readonly sessionId: string }; assertWireSession(wire, cancel.sessionId); await this.receiveCancel(cancel, peer, wire.sender.agentId); break; } }
      this.seenIds.add(wire.signature); this.seenIds.add(wire.payloadId);
      await this.persist();
    } catch (error) { this.record({ event: 'security.rejected', outcome: 'denied', peer, reason: error instanceof Error ? error.message.slice(0, 256) : 'rejected' }); await this.persist(); }
  }

  private async receiveSession(session: NegotiationSession, peer: NodeId, senderAgentId: string, wireExpiresAt: string): Promise<void> { validateSession(session); assertExpiry(session.createdAt, session.expiresAt, this.now()); if (!await this.verifySigned(session, peer) || session.host.identityId !== peer || session.host.agentId !== senderAgentId || session.expiresAt !== wireExpiresAt || !session.participants.some(value => value.identityId === this.local.nodeId && value.agentId === this.mailbox.localAgentRef.agentId)) throw new AgentNegotiationError('UNAUTHORIZED', 'Session membership is invalid'); if (this.sessions.has(session.id)) return; this.assertPolicy(peer, session.category); if (session.roomId) await this.assertRoom(session.roomId, session.participants); if (this.sessions.size >= this.policy.maxSessions || [...this.sessions.values()].filter(value => value.status === 'pending').length >= this.policy.maxPending) throw new AgentNegotiationError('QUOTA', 'Negotiation session quota exceeded'); const trusted = this.trusted(peer); if (this.policy.mode === 'ALLOW_FROM_TRUSTED_AGENTS' && !trusted && !this.policy.askBeforeAccepting) throw new AgentNegotiationError('POLICY_DENIED', 'Only trusted negotiation contacts are allowed'); const accepted = this.policy.mode === 'ALLOW_SAFE_NEGOTIATIONS' || this.policy.mode === 'ALLOW_FROM_TRUSTED_AGENTS' && trusted; let status: NegotiationStatus = 'active'; if (this.policy.mode === 'ASK_EVERY_TIME' || (this.policy.mode === 'ALLOW_FROM_TRUSTED_AGENTS' && !trusted) || (this.policy.askBeforeAccepting && !accepted)) { status = 'pending'; await this.onApprovalRequired?.(clone(session)); } this.sessions.set(session.id, { ...session, status }); this.record({ event: 'session.received', outcome: status === 'active' ? 'received' : 'queued', negotiationId: session.id, peer, strategy: session.strategy, proposalCount: 0, responseCount: 0, disclosure: session.disclosureDefault, startedAt: session.createdAt }); }
  private async receiveProposal(proposal: NegotiationProposal, peer: NodeId, senderAgentId: string, wireExpiresAt: string): Promise<void> { validateProposal(proposal); const session = this.requireSession(proposal.sessionId); if (!await this.verifySigned(proposal, peer) || proposal.expiresAt !== wireExpiresAt || proposal.expiresAt !== session.expiresAt || proposal.sender.identityId !== peer || proposal.sender.agentId !== senderAgentId || !isParticipant(session, proposal.sender)) throw new AgentNegotiationError('UNAUTHORIZED', 'Proposal sender is not a participant'); if (session.status !== 'active' && session.status !== 'pending') throw new AgentNegotiationError('EXPIRED', 'Negotiation is not accepting proposals'); if (this.proposals.has(proposal.id)) throw new AgentNegotiationError('DUPLICATE', 'Duplicate negotiation proposal'); if (this.proposals.size >= this.policy.maxProposals) throw new AgentNegotiationError('QUOTA', 'Negotiation proposal quota exceeded'); this.proposals.set(proposal.id, clone(proposal)); this.record({ event: 'proposal.received', outcome: 'received', negotiationId: session.id, peer, strategy: session.strategy, proposalCount: 1, responseCount: 0, disclosure: session.disclosureDefault }); if (session.status === 'active' && this.evaluator && isParticipant(session, this.mailbox.localAgentRef)) { try { await this.evaluate(session.id, proposal.id); } catch { /* A local approval boundary may handle it later. */ } } }
  private async receiveResponse(response: NegotiationResponse, peer: NodeId, senderAgentId: string, wireExpiresAt: string): Promise<void> { validateResponse(response); const session = this.requireSession(response.sessionId); const proposal = this.proposals.get(response.proposalId); if (!await this.verifySigned(response, peer) || response.expiresAt !== wireExpiresAt || response.expiresAt !== session.expiresAt || session.status !== 'active' || !proposal || proposal.sessionId !== response.sessionId || response.sender.identityId !== peer || response.sender.agentId !== senderAgentId || !isParticipant(session, response.sender) || response.selectedOptionIds.some(id => !proposal.options.some(option => option.id === id))) throw new AgentNegotiationError('UNAUTHORIZED', 'Response is outside the negotiation'); if ([...this.responses.values()].some(value => value.sessionId === response.sessionId && value.proposalId === response.proposalId && value.sender.identityId === response.sender.identityId)) throw new AgentNegotiationError('DUPLICATE', 'Duplicate participant response'); if (this.responses.size >= this.policy.maxResponses) throw new AgentNegotiationError('QUOTA', 'Negotiation response quota exceeded'); this.storeResponse(response); this.record({ event: 'response.received', outcome: 'received', negotiationId: session.id, peer, strategy: session.strategy, proposalCount: 1, responseCount: 1, disclosure: response.disclosure }); }
  private async receiveResult(result: NegotiationResult, peer: NodeId, senderAgentId: string): Promise<void> { validateResult(result); const session = this.requireSession(result.sessionId); if (session.host.identityId !== peer || session.host.agentId !== senderAgentId || !await this.verifySigned(result, peer)) throw new AgentNegotiationError('INVALID_SIGNATURE', 'Invalid negotiation result'); if (result.strategy !== session.strategy) throw new AgentNegotiationError('UNAUTHORIZED', 'Negotiation result strategy does not match session'); if (this.results.has(session.id)) return; this.results.set(session.id, clone(result)); this.sessions.set(session.id, { ...session, status: result.status, revision: session.revision + 1 }); }
  private async receiveCancel(payload: { sessionId: string; action?: 'leave' }, peer: NodeId, senderAgentId: string): Promise<void> { assertId(payload.sessionId); const session = this.requireSession(payload.sessionId); if (payload.action === 'leave') { if (session.host.identityId !== peer || !isParticipant(session, { agentId: senderAgentId, identityId: peer })) throw new AgentNegotiationError('UNAUTHORIZED', 'Leave is outside the negotiation'); return; } if (session.host.identityId !== peer || session.host.agentId !== senderAgentId) throw new AgentNegotiationError('UNAUTHORIZED', 'Only the host may cancel a negotiation'); if (session.status !== 'active' && session.status !== 'pending') return; this.sessions.set(session.id, { ...session, status: 'cancelled', revision: session.revision + 1 }); }

  private async makeResponse(session: NegotiationSession, proposal: NegotiationProposal, input: NegotiationEvaluation): Promise<NegotiationResponse> { const selected = normalizeIds(input.selectedOptionIds ?? []); if (selected.some(id => !proposal.options.some(option => option.id === id))) throw new AgentNegotiationError('INVALID_ARGUMENT', 'Response selects an unknown option'); const disclosure = assertDisclosure(input.disclosure ?? session.disclosureDefault); if (!NEGOTIATION_DECISIONS.includes(input.decision)) throw new AgentNegotiationError('INVALID_ARGUMENT', 'Invalid negotiation decision'); if ((input.decision === 'reject' || input.decision === 'abstain') && selected.length) throw new AgentNegotiationError('INVALID_ARGUMENT', 'A non-accepting response cannot select options'); if (session.constraints.some(value => value.dataClass === 'PRIVATE' || value.dataClass === 'SECRET') && disclosure === 'EXACT') throw new AgentNegotiationError('UNSHAREABLE_DATA', 'Exact disclosure is not allowed for private constraints'); if (typeof input.score !== 'undefined' && (!Number.isFinite(input.score) || input.score < -1_000_000 || input.score > 1_000_000)) throw new AgentNegotiationError('INVALID_ARGUMENT', 'Response score is invalid'); if (input.derived !== undefined) { if (serializedSize(input.derived) > 8_192) throw new AgentNegotiationError('UNSHAREABLE_DATA', 'Derived response is too large'); assertDerivedValue(input.derived); if (containsPrivateMarker(input.derived)) throw new AgentNegotiationError('UNSHAREABLE_DATA', 'Private constraint data cannot be returned'); } const createdAt = iso(this.now()); const unsigned = { version: 1 as const, id: randomId(), sessionId: session.id, proposalId: proposal.id, sender: this.mailbox.localAgentRef, decision: input.decision, selectedOptionIds: selected, disclosure, ...(input.derived !== undefined ? { derived: clone(input.derived) } : {}), ...(input.score !== undefined ? { score: input.score } : {}), createdAt, expiresAt: session.expiresAt }; return { ...unsigned, signature: await this.sign(unsigned) }; }
  private storeResponse(response: NegotiationResponse): void { const key = `${response.sessionId}:${response.proposalId}:${response.sender.identityId}`; if ([...this.responses.values()].some(value => `${value.sessionId}:${value.proposalId}:${value.sender.identityId}` === key)) throw new AgentNegotiationError('DUPLICATE', 'Duplicate participant response'); this.responses.set(response.id, clone(response)); }
  /** Reachability is only an observation; queue the signed wire and let the
   * durable mailbox deliver it asynchronously instead of synchronously
   * coupling proposal creation to a continuously live route. */
  private async send(peer: NodeId, kind: NegotiationWireMessage['kind'], negotiationId: string, expiresAt: string, payload: NegotiationWireMessage['payload'], recipient: AgentRef): Promise<void> { const unsigned = { version: 1 as const, kind, sender: this.mailbox.localAgentRef, recipient, negotiationId, expiresAt, payload, payloadId: payloadId(payload) }; if (!(await this.surfaceEligible(unsigned.payloadId, payload))) throw new AgentNegotiationError('UNSHAREABLE_DATA', 'Negotiation payload failed mandatory safety gating'); const wire = { ...unsigned, signature: await this.crypto.sign(canonicalJson(unsigned), this.local.privateKey) }; await this.mailbox.sendNegotiation(peer, wire); }
  private async surfaceEligible(objectId: string, value: unknown): Promise<boolean> { return (await this.protectedSurfaces.evaluate('AGENT_NEGOTIATION', { objectId, domain: 'DIRECT_SHARED', value, content: value, sourceType: 'agent', verified: true, authorized: true, sharing: true })) !== undefined; }
  private async sign(value: object): Promise<string> { return this.crypto.sign(canonicalJson(value), this.local.privateKey); }
  private async verifySigned(value: { readonly signature: string }, signer: NodeId): Promise<boolean> { const contact = this.mailbox.contactsList().find(item => item.agent.identityId === signer); return !!contact && this.crypto.verify(canonicalJson(stripSignature(value)), value.signature, contact.signingPublicKey); }
  private assertContact(ref: AgentRef): AgentContact { const contact = this.mailbox.contactsList().find(value => value.agent.identityId === ref.identityId && value.agent.agentId === ref.agentId); if (!contact || contact.revoked) throw new AgentNegotiationError('UNKNOWN_CONTACT', 'Unknown or revoked negotiation contact'); return contact; }
  private trusted(identityId: NodeId): boolean { return this.mailbox.contactsList().some(value => value.agent.identityId === identityId && value.trusted && !value.revoked); }
  private assertPolicy(peer: NodeId, category: string): void { if (this.policy.mode === 'DENY') throw new AgentNegotiationError('POLICY_DENIED', 'Negotiations are disabled'); if (this.policy.allowedCategories.length && !this.policy.allowedCategories.includes(category)) throw new AgentNegotiationError('POLICY_DENIED', 'Negotiation category is blocked'); this.assertContact({ identityId: peer, agentId: this.mailbox.contactsList().find(value => value.agent.identityId === peer)?.agent.agentId ?? '' }); }
  private async assertRoom(roomId: string, participants: readonly NegotiationParticipant[]): Promise<void> { const rooms = await this.mailbox.listRooms(); const room = rooms.find(value => value.id === roomId && value.status === 'active'); if (!room || !room.members.some(value => value.identityId === this.local.nodeId && value.agentId === this.mailbox.localAgentRef.agentId) || participants.some(value => !room.members.some(member => member.identityId === value.identityId && member.agentId === value.agentId))) throw new AgentNegotiationError('UNAUTHORIZED', 'Negotiation room membership is invalid'); }
  private assertActive(session: NegotiationSession): void { if (session.status !== 'active' || Date.parse(session.expiresAt) <= this.now()) throw new AgentNegotiationError('EXPIRED', 'Negotiation is no longer active'); }
  private requireSession(id: string): NegotiationSession { const value = this.sessions.get(assertId(id)); if (!value) throw new AgentNegotiationError('NOT_FOUND', 'Negotiation session not found'); return value; }
  private makeSnapshot(): NegotiationSnapshot { return { version: 1, policy: clone(this.policy), sessions: [...this.sessions.values()].map(value => effectiveSession(value, this.now())), proposals: [...this.proposals.values()].map(clone), responses: [...this.responses.values()].map(clone), results: [...this.results.values()].map(clone), seenIds: [...this.seenIds].slice(-16_384), audit: this.auditEntries.map(clone) }; }
  private async hydrate(): Promise<void> { const raw = await this.storage.read(); if (!raw) return; const value = parseSnapshot(raw); this.policy = value.policy; value.sessions.forEach(item => this.sessions.set(item.id, item)); value.proposals.forEach(item => this.proposals.set(item.id, item)); value.responses.forEach(item => this.responses.set(item.id, item)); value.results.forEach(item => this.results.set(item.sessionId, item)); value.seenIds.forEach(item => this.seenIds.add(item)); this.auditEntries.push(...value.audit); }
  private async persist(): Promise<void> { const snapshot = this.makeSnapshot(); const operation = this.writes.then(() => this.storage.write(snapshot)); this.writes = operation.catch(() => undefined); await operation; }
  private record(input: Omit<NegotiationAuditRecord, 'version' | 'id' | 'at'>): void { this.auditEntries.push({ version: 1, id: randomId(), at: iso(this.now()), ...input }); while (this.auditEntries.length > AGENT_NEGOTIATION_MAX_AUDIT) this.auditEntries.shift(); }
}

export class InMemoryNegotiationStateStore implements AgentMailboxStateStore { private value?: unknown; async read(): Promise<unknown | undefined> { return this.value === undefined ? undefined : structuredClone(this.value); } async write(value: unknown): Promise<void> { this.value = structuredClone(value); } }

function normalizePolicy(value: Partial<NegotiationPolicy>): NegotiationPolicy { return { version: 1, mode: assertPolicyMode(value.mode ?? DEFAULT_POLICY.mode), allowedCategories: [...new Set((value.allowedCategories ?? []).filter(item => typeof item === 'string' && item.length <= 96))], defaultDisclosure: assertDisclosure(value.defaultDisclosure ?? DEFAULT_POLICY.defaultDisclosure), maxSessions: boundedInt(value.maxSessions ?? DEFAULT_POLICY.maxSessions, 1, 1_000), maxPending: boundedInt(value.maxPending ?? DEFAULT_POLICY.maxPending, 1, 1_000), maxProposals: boundedInt(value.maxProposals ?? DEFAULT_POLICY.maxProposals, 1, AGENT_NEGOTIATION_MAX_RESPONSES), maxResponses: boundedInt(value.maxResponses ?? DEFAULT_POLICY.maxResponses, 1, AGENT_NEGOTIATION_MAX_RESPONSES), askBeforeAccepting: value.askBeforeAccepting ?? DEFAULT_POLICY.askBeforeAccepting }; }
function parseSnapshot(raw: unknown): NegotiationSnapshot { if (!raw || typeof raw !== 'object' || (raw as { version?: unknown }).version !== 1) throw new AgentNegotiationError('INVALID_STATE', 'Invalid negotiation state'); const value = raw as Partial<NegotiationSnapshot>; if (!value.policy || !Array.isArray(value.sessions) || !Array.isArray(value.proposals) || !Array.isArray(value.responses) || !Array.isArray(value.results) || !Array.isArray(value.seenIds) || !Array.isArray(value.audit)) throw new AgentNegotiationError('INVALID_STATE', 'Incomplete negotiation state'); const sessions = value.sessions.map(item => { validateSession(item as NegotiationSession); return clone(item as NegotiationSession); }); const proposals = value.proposals.map(item => { validateProposal(item as NegotiationProposal); return clone(item as NegotiationProposal); }); const responses = value.responses.map(item => { validateResponse(item as NegotiationResponse); return clone(item as NegotiationResponse); }); const results = value.results.map(item => { validateResult(item as NegotiationResult); return clone(item as NegotiationResult); }); return { version: 1, policy: normalizePolicy(value.policy), sessions, proposals, responses, results, seenIds: value.seenIds.filter(safeId).slice(-16_384), audit: value.audit.slice(-AGENT_NEGOTIATION_MAX_AUDIT).map(item => clone(item as NegotiationAuditRecord)) }; }
function validateSession(value: NegotiationSession): void { if (!value || value.version !== 1 || !safeId(value.id) || !value.title || containsPrivateMarker(value.title) || !safeId(value.category) || containsPrivateMarker(value.category) || (value.roomId !== undefined && !safeId(value.roomId)) || !normalizeAgent(value.host) || !Array.isArray(value.participants) || !value.participants.length || value.participants.length > AGENT_NEGOTIATION_MAX_PARTICIPANTS || !NEGOTIATION_STRATEGIES.includes(value.strategy) || !NEGOTIATION_DISCLOSURES.includes(value.disclosureDefault) || !Array.isArray(value.constraints) || value.constraints.length > AGENT_NEGOTIATION_MAX_CONSTRAINTS || !Number.isFinite(Date.parse(value.createdAt)) || !Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.expiresAt) <= Date.parse(value.createdAt) || !NEGOTIATION_STATUSES.includes(value.status) || !Number.isSafeInteger(value.revision) || typeof value.signature !== 'string') throw new AgentNegotiationError('INVALID_STATE', 'Invalid negotiation session'); const participants = uniqueParticipants(value.participants); if (participants.length !== value.participants.length || !participants.some(item => item.identityId === value.host.identityId && item.agentId === value.host.agentId && item.role === 'host')) throw new AgentNegotiationError('INVALID_STATE', 'Negotiation host membership is invalid'); normalizeConstraints(value.constraints); }
function validateProposal(value: NegotiationProposal): void { if (!value || value.version !== 1 || !safeId(value.id) || !safeId(value.sessionId) || !normalizeAgent(value.sender) || !['proposal', 'counter-proposal'].includes(value.kind) || !Array.isArray(value.options) || !value.options.length || value.options.length > AGENT_NEGOTIATION_MAX_OPTIONS || !Number.isFinite(Date.parse(value.createdAt)) || !Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.expiresAt) <= Date.parse(value.createdAt) || typeof value.signature !== 'string') throw new AgentNegotiationError('INVALID_STATE', 'Invalid negotiation proposal'); normalizeOptions(value.options); }
function validateResponse(value: NegotiationResponse): void { if (!value || value.version !== 1 || !safeId(value.id) || !safeId(value.sessionId) || !safeId(value.proposalId) || !normalizeAgent(value.sender) || !NEGOTIATION_DECISIONS.includes(value.decision) || !Array.isArray(value.selectedOptionIds) || !NEGOTIATION_DISCLOSURES.includes(value.disclosure) || (value.score !== undefined && !Number.isFinite(value.score)) || (value.derived !== undefined && serializedSize(value.derived) > 8_192) || !Number.isFinite(Date.parse(value.createdAt)) || !Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.expiresAt) <= Date.parse(value.createdAt) || typeof value.signature !== 'string') throw new AgentNegotiationError('INVALID_STATE', 'Invalid negotiation response'); if (value.derived !== undefined) { assertDerivedValue(value.derived); if (containsPrivateMarker(value.derived)) throw new AgentNegotiationError('UNSHAREABLE_DATA', 'Private constraint data cannot be returned'); } normalizeIds(value.selectedOptionIds); if ((value.decision === 'reject' || value.decision === 'abstain') && value.selectedOptionIds.length) throw new AgentNegotiationError('INVALID_STATE', 'A non-accepting response cannot select options'); }
function validateResult(value: NegotiationResult): void { if (!value || value.version !== 1 || !safeId(value.id) || !safeId(value.sessionId) || !NEGOTIATION_STRATEGIES.includes(value.strategy) || !['completed', 'rejected', 'timed_out', 'cancelled'].includes(value.status) || !Array.isArray(value.selectedOptionIds) || !Array.isArray(value.responseIds) || !NEGOTIATION_DISCLOSURES.includes(value.disclosure) || !Number.isFinite(Date.parse(value.createdAt)) || !Number.isFinite(Date.parse(value.endedAt)) || Date.parse(value.endedAt) < Date.parse(value.createdAt) || typeof value.signature !== 'string') throw new AgentNegotiationError('INVALID_STATE', 'Invalid negotiation result'); normalizeIds(value.selectedOptionIds); }
function normalizeConstraints(values: readonly NegotiationConstraint[]): NegotiationConstraint[] { if (!Array.isArray(values) || values.length > AGENT_NEGOTIATION_MAX_CONSTRAINTS) throw new AgentNegotiationError('INVALID_ARGUMENT', 'Too many negotiation constraints'); const result = values.map(value => { if (!value || !safeId(value.id) || !value.label || !value.label.trim() || value.label.length > 256 || !NEGOTIATION_DATA_CLASSES.includes(value.dataClass) || !NEGOTIATION_DISCLOSURES.includes(value.disclosure) || value.localOnly !== true) throw new AgentNegotiationError('UNSHAREABLE_DATA', 'Constraint metadata is invalid'); return { id: value.id, label: value.label.trim(), dataClass: value.dataClass, disclosure: value.disclosure, localOnly: true as const }; }); if (new Set(result.map(value => value.id)).size !== result.length) throw new AgentNegotiationError('DUPLICATE', 'Duplicate negotiation constraint'); return result; }
function normalizeOptions(values: readonly NegotiationOption[]): NegotiationOption[] { if (!Array.isArray(values) || !values.length || values.length > AGENT_NEGOTIATION_MAX_OPTIONS) throw new AgentNegotiationError('INVALID_ARGUMENT', 'Invalid negotiation options'); const result = values.map(value => { if (!value || !safeId(value.id) || !value.label || !value.label.trim() || value.label.length > 256 || containsPrivateMarker(value.label) || (value.dataClass !== 'PUBLIC' && value.dataClass !== 'USER_EXPLICIT') || (value.disclosure !== undefined && !NEGOTIATION_DISCLOSURES.includes(value.disclosure))) throw new AgentNegotiationError('UNSHAREABLE_DATA', 'Options must be public or explicitly shared'); return { id: value.id, label: value.label.trim(), dataClass: value.dataClass, ...(value.disclosure ? { disclosure: value.disclosure } : {}) }; }); if (new Set(result.map(value => value.id)).size !== result.length) throw new AgentNegotiationError('DUPLICATE', 'Duplicate negotiation option'); return result; }
function normalizeIds(values: readonly string[]): string[] { if (!Array.isArray(values) || values.length > AGENT_NEGOTIATION_MAX_OPTIONS || values.some(value => !safeId(value))) throw new AgentNegotiationError('INVALID_ARGUMENT', 'Invalid option ids'); return [...new Set(values)]; }
function uniqueParticipants(values: readonly NegotiationParticipant[]): NegotiationParticipant[] { const map = new Map<string, NegotiationParticipant>(); for (const value of values) { if (!normalizeAgent(value) || !['host', 'participant'].includes(value.role)) throw new AgentNegotiationError('INVALID_ARGUMENT', 'Invalid negotiation participant'); const key = `${value.identityId}:${value.agentId}`; if (!map.has(key)) map.set(key, { identityId: value.identityId, agentId: value.agentId, role: value.role, ...(value.trusted !== undefined ? { trusted: value.trusted } : {}) }); } return [...map.values()]; }
function isParticipant(session: NegotiationSession, value: AgentRef): boolean { return session.participants.some(item => item.identityId === value.identityId && item.agentId === value.agentId); }
function aggregate(session: NegotiationSession, responses: readonly NegotiationResponse[]): string[] { const usable = responses.filter(value => value.decision === 'accept' || value.decision === 'counter'); if (!usable.length) return []; if (session.strategy === 'BEST_SCORE') { const best = [...usable].sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity))[0]; return [...best.selectedOptionIds]; } const count = new Map<string, number>(); usable.forEach(value => value.selectedOptionIds.forEach(id => count.set(id, (count.get(id) ?? 0) + 1))); const voterCount = Math.max(1, session.participants.filter(value => value.identityId !== session.host.identityId).length); if (session.strategy === 'UNANIMOUS' || session.strategy === 'FIRST_COMMON') { return [...count.entries()].filter(([, value]) => value >= voterCount).map(([id]) => id); } if (session.strategy === 'MAJORITY') { const threshold = Math.floor(voterCount / 2) + 1; return [...count.entries()].filter(([, value]) => value >= threshold).sort((a, b) => b[1] - a[1]).slice(0, 1).map(([id]) => id); } return []; }
function effectiveSession(value: NegotiationSession, now: number): NegotiationSession { return value.status === 'active' && Date.parse(value.expiresAt) <= now ? { ...value, status: 'timed_out' } : clone(value); }
function assertWireSession(wire: NegotiationWireMessage, sessionId: string): void { if (!safeId(sessionId) || wire.negotiationId !== sessionId) throw new AgentNegotiationError('UNAUTHORIZED', 'Negotiation message/session binding failed'); }
function parseWire(raw: unknown): NegotiationWireMessage & { readonly payloadId: string } { if (!raw || typeof raw !== 'object') throw new AgentNegotiationError('INVALID_STATE', 'Malformed negotiation wire message'); const value = raw as Partial<NegotiationWireMessage> & { payloadId?: unknown }; if (value.version !== 1 || !['session', 'proposal', 'response', 'result', 'cancel'].includes(value.kind ?? '') || !normalizeAgent(value.sender) || !normalizeAgent(value.recipient) || !safeId(value.negotiationId) || !Number.isFinite(Date.parse(value.expiresAt ?? '')) || !value.payload || !safeId(value.payloadId) || typeof value.signature !== 'string') throw new AgentNegotiationError('INVALID_STATE', 'Malformed negotiation wire message'); return value as NegotiationWireMessage & { payloadId: string }; }
function payloadId(value: unknown): string { const encoded = canonicalJson(value); let hash = 2166136261; for (let index = 0; index < encoded.length; index += 1) hash = Math.imul(hash ^ encoded.charCodeAt(index), 16777619); return `p${(hash >>> 0).toString(16)}`; }
function stripSignature<T extends { readonly signature: string }>(value: T): Omit<T, 'signature'> { const { signature: _signature, ...unsigned } = value; return unsigned; }
function normalizeAgent(value: unknown): value is AgentRef { return !!value && typeof value === 'object' && safeId((value as AgentRef).identityId) && safeId((value as AgentRef).agentId); }
function assertStrategy(value: NegotiationStrategy): NegotiationStrategy { if (!NEGOTIATION_STRATEGIES.includes(value)) throw new AgentNegotiationError('INVALID_ARGUMENT', 'Invalid negotiation strategy'); return value; }
function assertDisclosure(value: NegotiationDisclosure): NegotiationDisclosure { if (!NEGOTIATION_DISCLOSURES.includes(value)) throw new AgentNegotiationError('INVALID_ARGUMENT', 'Invalid disclosure policy'); return value; }
function assertPolicyMode(value: NegotiationPolicyMode): NegotiationPolicyMode { if (!NEGOTIATION_POLICY_MODES.includes(value)) throw new AgentNegotiationError('INVALID_ARGUMENT', 'Invalid negotiation policy mode'); return value; }
function assertExpiry(createdAt: string, expiresAt: string, now: number): void { const created = Date.parse(createdAt); const expiry = Date.parse(expiresAt); if (!Number.isFinite(created) || !Number.isFinite(expiry) || expiry <= now || expiry <= created || expiry - now > AGENT_NEGOTIATION_MAX_LIFETIME_MS) throw new AgentNegotiationError('INVALID_ARGUMENT', 'Negotiation expiry is invalid'); }
function boundedText(value: string, max: number): string { if (typeof value !== 'string' || !value.trim() || value.length > max) throw new AgentNegotiationError('INVALID_ARGUMENT', 'Negotiation text is invalid'); return value.trim(); }
function boundedInt(value: number, min: number, max: number): number { if (!Number.isSafeInteger(value) || value < min || value > max) throw new AgentNegotiationError('INVALID_ARGUMENT', 'Negotiation limit is invalid'); return value; }
function assertId(value: string): string { if (!safeId(value)) throw new AgentNegotiationError('INVALID_ARGUMENT', 'Invalid negotiation id'); return value; }
function safeId(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9_-][A-Za-z0-9._:-]{0,127}$/.test(value); }
function iso(value: number): string { return new Date(value).toISOString(); }
function randomId(): string { return `${globalThis.crypto.randomUUID()}`; }
function clone<T>(value: T): T { return structuredClone(value); }
function serializedSize(value: unknown): number { try { return new TextEncoder().encode(JSON.stringify(value) ?? '').byteLength; } catch { return Number.POSITIVE_INFINITY; } }
function assertDerivedValue(value: unknown): asserts value is NegotiationDerivedValue {
  if (typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AgentNegotiationError('UNSHAREABLE_DATA', 'Derived response must be a boolean, score or bounded result');
  const record = value as Record<string, unknown>; const allowed = new Set(['available', 'accepted', 'preferred', 'min', 'max', 'optionIds']);
  if (Object.keys(record).some(key => !allowed.has(key))) throw new AgentNegotiationError('UNSHAREABLE_DATA', 'Derived response contains an unsupported field');
  for (const key of ['available', 'accepted', 'preferred']) if (record[key] !== undefined && typeof record[key] !== 'boolean') throw new AgentNegotiationError('UNSHAREABLE_DATA', 'Derived boolean field is invalid');
  for (const key of ['min', 'max']) if (record[key] !== undefined && (typeof record[key] !== 'number' || !Number.isFinite(record[key]))) throw new AgentNegotiationError('UNSHAREABLE_DATA', 'Derived range field is invalid');
  if (record.optionIds !== undefined && (!Array.isArray(record.optionIds) || record.optionIds.length > AGENT_NEGOTIATION_MAX_OPTIONS || record.optionIds.some(value => !safeId(value)))) throw new AgentNegotiationError('UNSHAREABLE_DATA', 'Derived option ids are invalid');
  const min = typeof record.min === 'number' ? record.min : undefined; const max = typeof record.max === 'number' ? record.max : undefined; if (min !== undefined && max !== undefined && min > max) throw new AgentNegotiationError('UNSHAREABLE_DATA', 'Derived range is invalid');
}
function containsPrivateMarker(value: unknown): boolean { if (value === undefined || value === null) return false; if (typeof value === 'string') return /private|secret|memory|rag|schedule|credential/i.test(value); if (Array.isArray(value)) return value.some(containsPrivateMarker); if (typeof value === 'object') return Object.entries(value as Record<string, unknown>).some(([key, item]) => /private|secret|memory|rag|credential/i.test(key) || containsPrivateMarker(item)); return false; }
