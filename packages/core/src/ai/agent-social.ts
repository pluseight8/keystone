/**
 * Asynchronous agent-to-agent social protocol.
 *
 * This is intentionally a separate protocol from Agent Visits/Rooms.  It
 * stores signed, recipient-encrypted envelopes in a durable outbox and lets a
 * recipient process accept work later, after it reconnects.  The protocol
 * never reads Memory, RAG, files, chats, or tools: callers must provide an
 * explicitly shareable PUBLIC/USER_EXPLICIT context projection.
 */

import { canonicalJson, type CryptoProvider } from '../crypto.js';
import type { DeviceSessionKeys } from '../identity.js';
import type { Envelope, EnvelopeSecurity, Transport, UnsignedEnvelope } from '../transport.js';
import type { NodeId } from '../types.js';
import { SodiumDirectMessageCipher, type DirectMessageCipher } from '../social/messaging.js';
import type { AgentRef, AgentSharedContext } from './visits.js';

export const AGENT_SOCIAL_VERSION = 1 as const;
export const AGENT_SOCIAL_ENVELOPE = 'ai.agent_social';
export const AGENT_SOCIAL_MAX_LIFETIME_MS = 7 * 24 * 60 * 60_000;
export const AGENT_SOCIAL_MAX_TASK_BYTES = 256 * 1024;
export const AGENT_SOCIAL_MAX_MAILBOX = 1_000;
export const AGENT_SOCIAL_MAX_OUTBOX = 1_000;
export const AGENT_SOCIAL_MAX_ROOM_CONTRIBUTIONS = 2_000;
export const AGENT_SOCIAL_MAX_DELEGATION_DEPTH = 2;
export const AGENT_SOCIAL_MAX_CAPABILITIES = 16;
export const AGENT_SOCIAL_MAX_CONTEXT_ITEMS = 64;

export const AGENT_TASK_TYPES = ['availability', 'research', 'coordination', 'file-transfer', 'custom'] as const;
export type AgentTaskType = (typeof AGENT_TASK_TYPES)[number];
export const AGENT_TASK_STATUSES = ['queued', 'pending', 'accepted', 'rejected', 'completed', 'expired', 'cancelled'] as const;
export type AgentTaskStatus = (typeof AGENT_TASK_STATUSES)[number];
export const AGENT_PRESENCE_STATES = ['available', 'busy', 'offline', 'do_not_disturb'] as const;
export type AgentPresenceState = (typeof AGENT_PRESENCE_STATES)[number];
export const AGENT_TRUST_MODES = ['deny', 'contacts-only', 'trusted-only', 'ask', 'auto'] as const;
export type AgentTrustMode = (typeof AGENT_TRUST_MODES)[number];
export const AGENT_RECEIPT_STATUSES = ['queued', 'delivered', 'accepted', 'completed', 'rejected', 'expired'] as const;
export type AgentDeliveryStatus = (typeof AGENT_RECEIPT_STATUSES)[number];

export type AgentSocialDataClass = 'PUBLIC' | 'USER_EXPLICIT';

export interface AgentContact {
  readonly version: 1;
  readonly agent: AgentRef;
  readonly signingPublicKey: string;
  readonly encryptionPublicKey: string;
  readonly label?: string;
  readonly trusted: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly revoked?: boolean;
}

export interface AgentPresence {
  readonly version: 1;
  readonly agent: AgentRef;
  readonly state: AgentPresenceState;
  readonly acceptingTasks: boolean;
  readonly updatedAt: string;
  readonly expiresAt: string;
  readonly signature: string;
}

export interface AgentTrustPolicy {
  readonly version: 1;
  readonly mode: AgentTrustMode;
  readonly allowedIdentityIds: readonly NodeId[];
  readonly allowedAgentIds: readonly string[];
  readonly blockedIdentityIds: readonly NodeId[];
  readonly blockedAgentIds: readonly string[];
  readonly askBeforeAccepting: boolean;
  readonly autoAcceptTaskTypes: readonly AgentTaskType[];
  readonly maxPending: number;
  readonly maxTasksPerSenderPerHour: number;
}

export interface AgentTaskCapability {
  readonly version: 1;
  readonly id: string;
  readonly scope: string;
  readonly taskTypes: readonly AgentTaskType[];
  readonly issuedBy: NodeId;
  readonly subject: AgentRef;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly maxUses: number;
  readonly signature: string;
}

export interface AgentTaskRequest {
  readonly version: 1;
  readonly id: string;
  readonly taskId: string;
  readonly sender: AgentRef;
  readonly recipient: AgentRef;
  readonly taskType: AgentTaskType;
  /** Untrusted text. It is not interpreted as a tool/capability grant. */
  readonly prompt: string;
  /** The prompt is untrusted input and never becomes a capability grant. */
  readonly untrusted: true;
  /** Explicitly shared projections only; never Memory/RAG/private payloads. */
  readonly explicitContext: readonly AgentSharedContext[];
  readonly capabilities: readonly AgentTaskCapability[];
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly delegationDepth: number;
  readonly delegationChain: readonly string[];
  readonly roomId?: string;
  readonly signature: string;
  readonly status: AgentTaskStatus;
}

export interface AgentTaskResult {
  readonly value: unknown;
  readonly dataClass: AgentSocialDataClass;
  readonly references?: readonly { readonly id: string; readonly type: string }[];
}

export interface AgentTaskResponse {
  readonly version: 1;
  readonly id: string;
  readonly taskId: string;
  readonly requestId: string;
  readonly sender: AgentRef;
  readonly recipient: AgentRef;
  readonly status: Extract<AgentTaskStatus, 'accepted' | 'rejected' | 'completed' | 'expired'>;
  readonly result?: AgentTaskResult;
  readonly reason?: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly signature: string;
}

export interface AgentDeliveryReceipt {
  readonly version: 1;
  readonly id: string;
  readonly messageId: string;
  readonly taskId?: string;
  readonly roomId?: string;
  readonly sender: AgentRef;
  readonly recipient: AgentRef;
  readonly status: AgentDeliveryStatus;
  readonly at: string;
  readonly signature: string;
}

export interface AgentAsyncRoom {
  readonly version: 1;
  readonly id: string;
  readonly title: string;
  readonly owner: AgentRef;
  readonly members: readonly AgentRef[];
  readonly sharedContext: readonly AgentSharedContext[];
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly status: 'active' | 'ended' | 'expired';
  readonly revision: number;
  readonly signature: string;
}

export interface AgentRoomContribution {
  readonly version: 1;
  readonly id: string;
  readonly roomId: string;
  readonly sender: AgentRef;
  readonly text: string;
  readonly context: readonly AgentSharedContext[];
  readonly dataClass: AgentSocialDataClass;
  readonly createdAt: string;
  readonly signature: string;
}

export interface AgentMailboxAuditRecord {
  readonly version: 1;
  readonly id: string;
  readonly at: string;
  readonly event: 'task.sent' | 'task.received' | 'task.accepted' | 'task.rejected' | 'task.completed' | 'response.received' | 'receipt.received' | 'room.received' | 'room.contribution' | 'presence.received' | 'security.rejected';
  readonly outcome: 'accepted' | 'denied' | 'queued' | 'received';
  readonly peer?: NodeId;
  readonly taskId?: string;
  readonly roomId?: string;
  readonly dataClasses: readonly AgentSocialDataClass[];
  readonly reason?: string;
}

export interface AgentMailboxSnapshot {
  readonly version: 1;
  readonly contacts: readonly AgentContact[];
  readonly policy: AgentTrustPolicy;
  readonly presence?: AgentPresence;
  readonly requests: readonly AgentTaskRequest[];
  readonly responses: readonly AgentTaskResponse[];
  readonly receipts: readonly AgentDeliveryReceipt[];
  readonly outbox: readonly AgentMailboxOutbox[];
  readonly rooms: readonly AgentAsyncRoom[];
  readonly contributions: readonly AgentRoomContribution[];
  readonly seenIds: readonly string[];
  readonly revokedCapabilityIds: readonly string[];
  readonly capabilityUses: readonly { readonly id: string; readonly uses: number }[];
  readonly audit: readonly AgentMailboxAuditRecord[];
}

export interface AgentMailboxOutbox {
  readonly id: string;
  readonly peer: NodeId;
  readonly envelope: Envelope;
  readonly attempts: number;
  readonly nextAttemptAt: number;
}

export interface AgentMailboxStateStore {
  read(): Promise<unknown | undefined>;
  write(value: unknown): Promise<void>;
}

export class InMemoryAgentMailboxStateStore implements AgentMailboxStateStore {
  private value?: unknown;
  async read(): Promise<unknown | undefined> { return this.value === undefined ? undefined : structuredClone(this.value); }
  async write(value: unknown): Promise<void> { this.value = structuredClone(value); }
}

export interface AgentTaskExecutor {
  execute(request: AgentTaskRequest, capabilities: readonly AgentTaskCapability[], signal: AbortSignal): Promise<AgentTaskResult>;
}

export interface AgentMailboxOptions {
  readonly transport: Transport;
  readonly crypto: CryptoProvider;
  readonly security: EnvelopeSecurity;
  readonly local: DeviceSessionKeys;
  readonly agentId: string;
  readonly contacts?: readonly AgentContact[];
  readonly storage?: AgentMailboxStateStore;
  readonly cipher?: DirectMessageCipher;
  readonly policy?: Partial<AgentTrustPolicy>;
  readonly now?: () => number;
  readonly maxMailbox?: number;
  readonly maxOutbox?: number;
  readonly maxConcurrentTasks?: number;
  readonly executor?: AgentTaskExecutor;
  readonly onApprovalRequired?: (request: AgentTaskRequest) => void | Promise<void>;
  readonly onTask?: (request: AgentTaskRequest) => void | Promise<void>;
}

export type AgentSocialErrorCode =
  | 'INVALID_ARGUMENT' | 'INVALID_SIGNATURE' | 'INVALID_STATE' | 'UNAUTHORIZED' | 'UNKNOWN_CONTACT'
  | 'POLICY_DENIED' | 'APPROVAL_REQUIRED' | 'QUOTA' | 'REPLAY' | 'DUPLICATE' | 'EXPIRED'
  | 'UNSHAREABLE_DATA' | 'CAPABILITY_DENIED' | 'CAPABILITY_EXPIRED' | 'CAPABILITY_EXHAUSTED'
  | 'RECURSION_LIMIT' | 'TRANSPORT' | 'NOT_FOUND';

export class AgentSocialError extends Error {
  constructor(readonly code: AgentSocialErrorCode, message: string) { super(message); this.name = 'AgentSocialError'; }
}

interface AgentSocialMessage {
  readonly kind: 'task' | 'response' | 'receipt' | 'presence' | 'room' | 'contribution';
  readonly task?: AgentTaskRequest;
  readonly response?: AgentTaskResponse;
  readonly receipt?: AgentDeliveryReceipt;
  readonly presence?: AgentPresence;
  readonly room?: AgentAsyncRoom;
  readonly contribution?: AgentRoomContribution;
}

const DEFAULT_POLICY: AgentTrustPolicy = {
  version: 1,
  mode: 'ask',
  allowedIdentityIds: [],
  allowedAgentIds: [],
  blockedIdentityIds: [],
  blockedAgentIds: [],
  askBeforeAccepting: true,
  autoAcceptTaskTypes: [],
  maxPending: 64,
  maxTasksPerSenderPerHour: 30,
};

/** Durable asynchronous mailbox and encrypted P2P social protocol. */
export class AgentMailbox {
  private readonly transport: Transport;
  private readonly crypto: CryptoProvider;
  private readonly security: EnvelopeSecurity;
  private readonly local: DeviceSessionKeys;
  private readonly localAgent: AgentRef;
  private readonly storage: AgentMailboxStateStore;
  private readonly cipher: DirectMessageCipher;
  private readonly now: () => number;
  private readonly maxMailbox: number;
  private readonly maxOutbox: number;
  private readonly maxConcurrentTasks: number;
  private readonly executor?: AgentTaskExecutor;
  private readonly onApprovalRequired?: AgentMailboxOptions['onApprovalRequired'];
  private readonly onTask?: AgentMailboxOptions['onTask'];
  private readonly contacts = new Map<NodeId, AgentContact>();
  private readonly requests = new Map<string, AgentTaskRequest>();
  private readonly responses = new Map<string, AgentTaskResponse>();
  private readonly receipts = new Map<string, AgentDeliveryReceipt>();
  private readonly outbox = new Map<string, AgentMailboxOutbox>();
  private readonly presences = new Map<NodeId, AgentPresence>();
  private readonly rooms = new Map<string, AgentAsyncRoom>();
  private readonly contributions = new Map<string, AgentRoomContribution>();
  private readonly seenIds = new Set<string>();
  private readonly revokedCapabilityIds = new Set<string>();
  private readonly capabilityUses = new Map<string, number>();
  private readonly auditEntries: AgentMailboxAuditRecord[] = [];
  private policy: AgentTrustPolicy;
  private localPresence?: AgentPresence;
  private readonly unsubscribe: () => void;
  private readyPromise: Promise<void>;
  private writes: Promise<void> = Promise.resolve();
  private flushPromise?: Promise<void>;
  private readonly executing = new Set<string>();

  constructor(options: AgentMailboxOptions) {
    this.transport = options.transport; this.crypto = options.crypto; this.security = options.security; this.local = options.local;
    this.localAgent = normalizeAgentRef({ agentId: options.agentId, identityId: options.local.nodeId });
    this.storage = options.storage ?? new InMemoryAgentMailboxStateStore(); this.cipher = options.cipher ?? new SodiumDirectMessageCipher();
    this.now = options.now ?? Date.now; this.maxMailbox = clamp(options.maxMailbox ?? AGENT_SOCIAL_MAX_MAILBOX, 1, AGENT_SOCIAL_MAX_MAILBOX); this.maxOutbox = clamp(options.maxOutbox ?? AGENT_SOCIAL_MAX_OUTBOX, 1, AGENT_SOCIAL_MAX_OUTBOX); this.maxConcurrentTasks = clamp(options.maxConcurrentTasks ?? 4, 1, 32);
    this.executor = options.executor; this.onApprovalRequired = options.onApprovalRequired; this.onTask = options.onTask;
    for (const contact of options.contacts ?? []) this.contacts.set(contact.agent.identityId, normalizeContact(contact));
    this.policy = normalizePolicy({ ...DEFAULT_POLICY, ...options.policy });
    this.unsubscribe = this.transport.onMessage(envelope => { void this.receive(envelope).catch(error => this.rejectIncoming(envelope, error)); });
    this.readyPromise = this.hydrate();
  }

  get localAgentRef(): AgentRef { return { ...this.localAgent }; }
  async ready(): Promise<void> { await this.readyPromise; }
  close(): void { this.unsubscribe(); }
  contactsList(): readonly AgentContact[] { return [...this.contacts.values()].map(clone); }
  listContacts(): readonly AgentContact[] { return this.contactsList(); }
  policySnapshot(): AgentTrustPolicy { return clone(this.policy); }
  async setPolicy(policy: Partial<AgentTrustPolicy>): Promise<AgentTrustPolicy> { return this.setTrustPolicy(policy); }
  async snapshot(): Promise<AgentMailboxSnapshot> { await this.ready(); return this.makeSnapshot(); }
  async listInbox(): Promise<readonly AgentTaskRequest[]> { await this.ready(); return [...this.requests.values()].filter(value => value.recipient.identityId === this.local.nodeId).map(value => withEffectiveTaskStatus(value, this.now())); }
  async listPending(): Promise<readonly AgentTaskRequest[]> { return (await this.listInbox()).filter(value => value.status === 'pending' || value.status === 'queued'); }
  async listSent(): Promise<readonly AgentTaskRequest[]> { await this.ready(); return [...this.requests.values()].filter(value => value.sender.identityId === this.local.nodeId).map(value => withEffectiveTaskStatus(value, this.now())); }
  async listResponses(): Promise<readonly AgentTaskResponse[]> { await this.ready(); return [...this.responses.values()].map(clone); }
  async listCompleted(): Promise<readonly AgentTaskResponse[]> { return (await this.listResponses()).filter(value => value.status === 'completed'); }
  async listReceipts(): Promise<readonly AgentDeliveryReceipt[]> { await this.ready(); return [...this.receipts.values()].map(clone); }
  async listRooms(): Promise<readonly AgentAsyncRoom[]> { await this.ready(); return [...this.rooms.values()].map(value => withEffectiveRoomStatus(value, this.now())); }
  async listContributions(roomId?: string): Promise<readonly AgentRoomContribution[]> { await this.ready(); return [...this.contributions.values()].filter(value => !roomId || value.roomId === roomId).map(clone); }
  presenceOf(identityId: NodeId): AgentPresence | undefined { const value = identityId === this.local.nodeId ? this.localPresence : this.presences.get(identityId); return value && Date.parse(value.expiresAt) > this.now() ? clone(value) : undefined; }
  getPresence(identityId: NodeId): AgentPresence | undefined { return this.presenceOf(identityId); }
  stats(): { readonly inbox: number; readonly sent: number; readonly pending: number; readonly outbox: number; readonly responses: number; readonly rooms: number; readonly rejected: number } { return { inbox: [...this.requests.values()].filter(value => value.recipient.identityId === this.local.nodeId && value.status === 'pending').length, sent: [...this.requests.values()].filter(value => value.sender.identityId === this.local.nodeId).length, pending: [...this.requests.values()].filter(value => value.status === 'pending').length, outbox: this.outbox.size, responses: this.responses.size, rooms: this.rooms.size, rejected: this.auditEntries.filter(value => value.outcome === 'denied').length }; }
  audit(): readonly AgentMailboxAuditRecord[] { return this.auditEntries.map(clone); }

  addContact(contact: AgentContact): void { const normalized = normalizeContact(contact); this.contacts.set(normalized.agent.identityId, normalized); void this.persist(); }
  removeContact(identityId: NodeId): void { this.contacts.delete(identityId); void this.persist(); }
  async setTrustPolicy(policy: Partial<AgentTrustPolicy>): Promise<AgentTrustPolicy> { await this.ready(); this.policy = normalizePolicy({ ...this.policy, ...policy }); await this.persist(); return clone(this.policy); }

  async issueCapability(input: { recipient: AgentRef; scope: string; taskTypes?: readonly AgentTaskType[]; expiresAt?: string; maxUses?: number }): Promise<AgentTaskCapability> {
    await this.ready(); const subject = normalizeAgentRef(input.recipient); this.requireContact(subject.identityId); const issuedAt = iso(this.now()); const expiresAt = input.expiresAt ?? new Date(this.now() + AGENT_SOCIAL_MAX_LIFETIME_MS).toISOString(); assertExpiry(issuedAt, expiresAt, this.now());
    const unsigned = { version: 1 as const, id: randomId(), scope: boundedText(input.scope, 256, 'Capability scope'), taskTypes: normalizeTaskTypes(input.taskTypes ?? AGENT_TASK_TYPES), issuedBy: this.local.nodeId, subject, issuedAt, expiresAt, maxUses: boundedInt(input.maxUses ?? 1, 1, 100) };
    return { ...unsigned, signature: await this.crypto.sign(canonicalJson(unsigned), this.local.privateKey) };
  }

  async revokeCapability(id: string): Promise<void> { await this.ready(); assertId(id); this.revokedCapabilityIds.add(id); await this.persist(); }

  async setPresence(input: { state: AgentPresenceState; acceptingTasks?: boolean; peers?: readonly AgentRef[] }): Promise<AgentPresence> {
    await this.ready(); if (!AGENT_PRESENCE_STATES.includes(input.state)) throw new AgentSocialError('INVALID_ARGUMENT', 'Invalid presence state'); const updatedAt = iso(this.now()); const expiresAt = new Date(this.now() + 2 * 60_000).toISOString(); const unsigned = { version: 1 as const, agent: this.localAgent, state: input.state, acceptingTasks: input.acceptingTasks ?? input.state === 'available', updatedAt, expiresAt }; const presence: AgentPresence = { ...unsigned, signature: await this.crypto.sign(canonicalJson(unsigned), this.local.privateKey) }; this.localPresence = presence; await this.persist();
    for (const peer of input.peers ?? this.contactsList().map(value => value.agent)) if (peer.identityId !== this.local.nodeId) await this.queueMessage(peer.identityId, { kind: 'presence', presence });
    return clone(presence);
  }

  async createTask(input: { recipient: AgentRef; taskType: AgentTaskType; prompt: string; explicitContext?: readonly AgentSharedContext[]; capabilities?: readonly AgentTaskCapability[]; expiresAt?: string; parentTaskId?: string; delegationDepth?: number; delegationChain?: readonly string[]; roomId?: string }): Promise<AgentTaskRequest> {
    await this.ready(); const recipient = normalizeAgentRef(input.recipient); if (recipient.identityId === this.local.nodeId) throw new AgentSocialError('INVALID_ARGUMENT', 'Task recipient must be remote'); this.assertCanContact(recipient); const prompt = boundedText(input.prompt, 16_384, 'Task prompt'); if (!AGENT_TASK_TYPES.includes(input.taskType)) throw new AgentSocialError('INVALID_ARGUMENT', 'Invalid task type');
    const createdAt = iso(this.now()); const expiresAt = input.expiresAt ?? new Date(this.now() + 24 * 60 * 60_000).toISOString(); assertExpiry(createdAt, expiresAt, this.now()); const depth = boundedInt(input.delegationDepth ?? 0, 0, AGENT_SOCIAL_MAX_DELEGATION_DEPTH); const chain = normalizeChain(input.delegationChain ?? [], depth); if (input.parentTaskId && chain.includes(input.parentTaskId)) throw new AgentSocialError('RECURSION_LIMIT', 'Delegation cycle detected');
    const explicitContext = normalizeContext(input.explicitContext ?? []); if (input.roomId) { const room = this.requireRoom(assertId(input.roomId)); this.assertRoomUsable(room); if (!room.members.some(value => value.identityId === recipient.identityId && value.agentId === recipient.agentId)) throw new AgentSocialError('UNAUTHORIZED', 'Task recipient is not an asynchronous room member'); } const capabilities = await this.normalizeCapabilities(input.capabilities ?? [], recipient, input.taskType, expiresAt); this.assertOutboxQuota();
    const unsigned = { version: 1 as const, id: randomId(), taskId: randomId(), sender: this.localAgent, recipient, taskType: input.taskType, prompt, untrusted: true as const, explicitContext, capabilities, createdAt, expiresAt, delegationDepth: depth, delegationChain: chain, ...(input.roomId ? { roomId: assertId(input.roomId) } : {}), status: 'queued' as const };
    const task: AgentTaskRequest = { ...unsigned, signature: await this.crypto.sign(canonicalJson(unsigned), this.local.privateKey) }; this.requests.set(task.taskId, task); await this.persist(); await this.queueMessage(recipient.identityId, { kind: 'task', task }); this.record({ event: 'task.sent', outcome: 'queued', peer: recipient.identityId, taskId: task.taskId, dataClasses: explicitContext.map(value => value.dataClass) }); await this.persist(); void this.flush(recipient.identityId); return clone(task);
  }

  async sendTask(input: Parameters<AgentMailbox['createTask']>[0]): Promise<AgentTaskRequest> { return this.createTask(input); }

  async flush(peer?: NodeId): Promise<void> {
    await this.ready();
    if (this.flushPromise) await this.flushPromise;
    const run = this.flushNow(peer); this.flushPromise = run;
    try { await run; } finally { if (this.flushPromise === run) this.flushPromise = undefined; }
  }
  private async flushNow(peer?: NodeId): Promise<void> {
    for (const item of [...this.outbox.values()].filter(value => !peer || value.peer === peer)) {
      try { await this.transport.connect(item.peer); await this.transport.send(item.peer, item.envelope); this.outbox.delete(item.id); await this.persist(); }
      catch { this.outbox.set(item.id, { ...item, attempts: item.attempts + 1, nextAttemptAt: this.now() + retryDelay(item.attempts) }); await this.persist(); }
    }
  }

  async acceptTask(taskId: string): Promise<AgentTaskResponse> { await this.ready(); const task = this.requireTask(taskId); if (task.recipient.identityId !== this.local.nodeId) throw new AgentSocialError('UNAUTHORIZED', 'Only the recipient can accept a task'); if (task.status !== 'pending' && task.status !== 'queued') throw new AgentSocialError('DUPLICATE', 'Task is no longer pending'); this.assertTaskUsable(task); this.assertCanAccept(task); return this.executeTask(task); }
  async rejectTask(taskId: string, reason = 'Rejected by local policy'): Promise<AgentTaskResponse> { await this.ready(); const task = this.requireTask(taskId); if (task.recipient.identityId !== this.local.nodeId) throw new AgentSocialError('UNAUTHORIZED', 'Only the recipient can reject a task'); const response = await this.makeResponse(task, 'rejected', undefined, boundedText(reason, 512, 'Reason')); this.requests.set(task.taskId, { ...task, status: 'rejected' }); await this.persist(); await this.queueMessage(task.sender.identityId, { kind: 'response', response }); await this.sendReceipt(task.sender.identityId, task, 'rejected'); await this.persist(); void this.flush(task.sender.identityId); this.record({ event: 'task.rejected', outcome: 'denied', peer: task.sender.identityId, taskId: task.taskId, dataClasses: task.explicitContext.map(value => value.dataClass), reason }); return clone(response); }

  async createAsyncRoom(input: { title: string; members: readonly AgentRef[]; sharedContext?: readonly AgentSharedContext[]; expiresAt?: string }): Promise<AgentAsyncRoom> {
    await this.ready(); if (this.rooms.size >= this.maxMailbox) throw new AgentSocialError('QUOTA', 'Agent room mailbox quota exceeded'); const members = uniqueRefs([this.localAgent, ...input.members]); if (members.length < 2) throw new AgentSocialError('INVALID_ARGUMENT', 'An asynchronous room needs at least two agents'); members.filter(value => value.identityId !== this.local.nodeId).forEach(value => this.assertCanContact(value)); const createdAt = iso(this.now()); const expiresAt = input.expiresAt ?? new Date(this.now() + AGENT_SOCIAL_MAX_LIFETIME_MS).toISOString(); assertExpiry(createdAt, expiresAt, this.now()); const unsigned = { version: 1 as const, id: randomId(), title: boundedText(input.title, 256, 'Room title'), owner: this.localAgent, members, sharedContext: normalizeContext(input.sharedContext ?? []), createdAt, expiresAt, status: 'active' as const, revision: 1 };
    const room: AgentAsyncRoom = { ...unsigned, signature: await this.crypto.sign(canonicalJson(unsigned), this.local.privateKey) }; this.rooms.set(room.id, room); await this.persist(); for (const member of members.filter(value => value.identityId !== this.local.nodeId)) await this.queueMessage(member.identityId, { kind: 'room', room }); await this.persist(); void this.flush(); return clone(room);
  }
  async createRoom(input: Parameters<AgentMailbox['createAsyncRoom']>[0]): Promise<AgentAsyncRoom> { return this.createAsyncRoom(input); }

  async addRoomContribution(roomId: string, input: { text: string; context?: readonly AgentSharedContext[] }): Promise<AgentRoomContribution> {
    await this.ready(); if (this.contributions.size >= AGENT_SOCIAL_MAX_ROOM_CONTRIBUTIONS) throw new AgentSocialError('QUOTA', 'Agent room contribution quota exceeded'); const room = this.requireRoom(roomId); this.assertRoomUsable(room); const contributionUnsigned = { version: 1 as const, id: randomId(), roomId, sender: this.localAgent, text: boundedText(input.text, 16_384, 'Contribution'), context: normalizeContext(input.context ?? []), dataClass: 'USER_EXPLICIT' as const, createdAt: iso(this.now()) }; const contribution: AgentRoomContribution = { ...contributionUnsigned, signature: await this.crypto.sign(canonicalJson(contributionUnsigned), this.local.privateKey) }; this.contributions.set(contribution.id, contribution); await this.persist(); for (const member of room.members.filter(value => value.identityId !== this.local.nodeId)) await this.queueMessage(member.identityId, { kind: 'contribution', contribution }); await this.persist(); void this.flush(); return clone(contribution);
  }
  async postRoomContribution(roomId: string, input: { text: string; context?: readonly AgentSharedContext[] }): Promise<AgentRoomContribution> { return this.addRoomContribution(roomId, input); }

  private async executeTask(task: AgentTaskRequest): Promise<AgentTaskResponse> {
    if (this.executing.has(task.taskId)) throw new AgentSocialError('DUPLICATE', 'Task is already executing'); if (this.executing.size >= this.maxConcurrentTasks) throw new AgentSocialError('QUOTA', 'Agent task concurrency quota exceeded'); this.executing.add(task.taskId); try {
      this.requests.set(task.taskId, { ...task, status: 'accepted' }); await this.persist(); await this.sendReceipt(task.sender.identityId, task, 'accepted'); await this.persist(); void this.flush(task.sender.identityId);
      const controller = new AbortController(); let result: AgentTaskResult = { value: { accepted: true, taskId: task.taskId }, dataClass: 'USER_EXPLICIT' };
      try {
        if (this.executor) result = await this.executor.execute({ ...task, status: 'accepted' }, task.capabilities.map(clone), controller.signal);
        assertResultShareable(result);
      } catch (error) {
        const reason = error instanceof Error ? error.message.slice(0, 512) : 'Task execution failed';
        const response = await this.makeResponse(task, 'rejected', undefined, reason);
        this.requests.set(task.taskId, { ...task, status: 'rejected' }); await this.persist(); await this.queueMessage(task.sender.identityId, { kind: 'response', response }); await this.sendReceipt(task.sender.identityId, task, 'rejected'); await this.persist(); void this.flush(task.sender.identityId);
        this.record({ event: 'task.rejected', outcome: 'denied', peer: task.sender.identityId, taskId: task.taskId, dataClasses: task.explicitContext.map(value => value.dataClass), reason }); return clone(response);
      }
      const response = await this.makeResponse(task, 'completed', result); this.requests.set(task.taskId, { ...task, status: 'completed' }); await this.persist(); await this.queueMessage(task.sender.identityId, { kind: 'response', response }); await this.sendReceipt(task.sender.identityId, task, 'completed'); await this.persist(); void this.flush(task.sender.identityId); this.record({ event: 'task.completed', outcome: 'accepted', peer: task.sender.identityId, taskId: task.taskId, dataClasses: [result.dataClass] }); return clone(response);
    } finally { this.executing.delete(task.taskId); }
  }

  private async receive(envelope: Envelope): Promise<void> {
    await this.ready(); if (envelope.type !== AGENT_SOCIAL_ENVELOPE || envelope.recipient !== this.local.nodeId) return; if (!validEnvelopeExpiry(envelope.expiresAt, this.now()) || await this.security.verify(envelope) === false) throw new AgentSocialError('INVALID_SIGNATURE', 'Invalid agent social envelope'); if (this.seenIds.has(envelope.id) || this.seenIds.has(envelope.nonce)) throw new AgentSocialError('REPLAY', 'Agent social envelope replay'); this.seenIds.add(envelope.id); this.seenIds.add(envelope.nonce);
    const contact = this.contacts.get(envelope.sender); if (!contact || contact.revoked) throw new AgentSocialError('UNKNOWN_CONTACT', 'Agent sender is not an authorized contact'); const body = await this.cipher.decrypt(envelope.body, this.local.encryptionPrivateKey, contact.encryptionPublicKey).catch(() => undefined); if (!body) throw new AgentSocialError('INVALID_SIGNATURE', 'Unable to decrypt agent social envelope'); const message = parseMessage(body); if (!message) throw new AgentSocialError('INVALID_STATE', 'Malformed agent social message');
    switch (message.kind) {
      case 'task': await this.receiveTask(envelope, message.task); break;
      case 'response': await this.receiveResponse(envelope, message.response); break;
      case 'receipt': await this.receiveReceipt(envelope, message.receipt); break;
      case 'presence': await this.receivePresence(envelope, message.presence); break;
      case 'room': await this.receiveRoom(envelope, message.room); break;
      case 'contribution': await this.receiveContribution(envelope, message.contribution); break;
    }
    await this.persist();
  }

  private async receiveTask(envelope: Envelope, task: AgentTaskRequest | undefined): Promise<void> {
    if (!task || !await this.verifyTask(task, envelope.sender) || task.recipient.identityId !== this.local.nodeId || task.recipient.agentId !== this.localAgent.agentId) throw new AgentSocialError('INVALID_SIGNATURE', 'Invalid task sender or recipient'); this.assertTaskShape(task); if (this.requests.has(task.taskId)) throw new AgentSocialError('DUPLICATE', 'Duplicate task'); this.assertTaskUsable(task); if (!await this.verifyTaskCapabilities(task)) throw new AgentSocialError('CAPABILITY_DENIED', 'Task carries an invalid or escalated capability'); this.assertCanAccept(task); if (this.requests.size >= this.maxMailbox) throw new AgentSocialError('QUOTA', 'Agent mailbox quota exceeded'); if (this.pendingFrom(task.sender.identityId) >= this.policy.maxPending) throw new AgentSocialError('QUOTA', 'Mailbox pending quota exceeded'); this.requests.set(task.taskId, { ...task, status: 'pending' }); this.record({ event: 'task.received', outcome: 'received', peer: envelope.sender, taskId: task.taskId, dataClasses: task.explicitContext.map(value => value.dataClass) }); await this.sendReceipt(task.sender.identityId, task, 'delivered'); await this.persist(); void this.flush(task.sender.identityId); await this.onTask?.(clone(task));
    const auto = !this.policy.askBeforeAccepting && this.policy.autoAcceptTaskTypes.includes(task.taskType) || this.policy.mode === 'auto' && this.policy.autoAcceptTaskTypes.includes(task.taskType); if (auto && this.executor) void this.acceptTask(task.taskId).catch(() => undefined); else if (!auto || !this.executor) await this.onApprovalRequired?.(clone(task));
  }

  private async receiveResponse(envelope: Envelope, response: AgentTaskResponse | undefined): Promise<void> {
    if (!response || !await this.verifyResponse(response, envelope.sender) || response.recipient.identityId !== this.local.nodeId || response.recipient.agentId !== this.localAgent.agentId || !validEnvelopeExpiry(response.expiresAt, this.now())) throw new AgentSocialError('INVALID_SIGNATURE', 'Invalid task response'); this.assertContactAgent(envelope.sender, response.sender.agentId); const task = this.requests.get(response.taskId); if (!task || task.sender.identityId !== this.local.nodeId || task.sender.agentId !== this.localAgent.agentId || task.recipient.identityId !== response.sender.identityId || task.recipient.agentId !== response.sender.agentId) throw new AgentSocialError('UNAUTHORIZED', 'Response does not match a sent task'); if (this.responses.has(response.id)) throw new AgentSocialError('DUPLICATE', 'Duplicate task response'); if (response.result) assertResultShareable(response.result); if (this.responses.size >= this.maxMailbox) throw new AgentSocialError('QUOTA', 'Agent response mailbox quota exceeded'); this.responses.set(response.id, response); this.requests.set(task.taskId, { ...task, status: response.status }); this.record({ event: 'response.received', outcome: 'received', peer: envelope.sender, taskId: task.taskId, dataClasses: response.result ? [response.result.dataClass] : [] });
  }

  private async receiveReceipt(envelope: Envelope, receipt: AgentDeliveryReceipt | undefined): Promise<void> { if (!receipt || !await this.verifyReceipt(receipt, envelope.sender) || receipt.recipient.identityId !== this.local.nodeId || receipt.recipient.agentId !== this.localAgent.agentId) throw new AgentSocialError('INVALID_SIGNATURE', 'Invalid delivery receipt'); this.assertContactAgent(envelope.sender, receipt.sender.agentId); if (this.receipts.has(receipt.id)) throw new AgentSocialError('DUPLICATE', 'Duplicate delivery receipt'); if (this.receipts.size >= this.maxMailbox) throw new AgentSocialError('QUOTA', 'Agent receipt mailbox quota exceeded'); if (receipt.taskId) { const task = this.requests.get(receipt.taskId); if (!task || task.sender.identityId !== this.local.nodeId || task.sender.agentId !== this.localAgent.agentId || task.recipient.identityId !== receipt.sender.identityId || task.recipient.agentId !== receipt.sender.agentId) throw new AgentSocialError('UNAUTHORIZED', 'Receipt does not match a sent task'); const status = receiptToTaskStatus(receipt.status); if (status) this.requests.set(task.taskId, { ...task, status }); } this.receipts.set(receipt.id, receipt); this.record({ event: 'receipt.received', outcome: 'received', peer: envelope.sender, taskId: receipt.taskId, roomId: receipt.roomId, dataClasses: [] }); }
  private async receivePresence(envelope: Envelope, presence: AgentPresence | undefined): Promise<void> { if (!presence || !await this.verifyPresence(presence, envelope.sender) || presence.agent.identityId !== envelope.sender || !validEnvelopeExpiry(presence.expiresAt, this.now())) throw new AgentSocialError('INVALID_SIGNATURE', 'Invalid agent presence'); this.assertContactAgent(envelope.sender, presence.agent.agentId); this.presences.set(envelope.sender, presence); this.record({ event: 'presence.received', outcome: 'received', peer: envelope.sender, dataClasses: [] }); }
  private async receiveRoom(envelope: Envelope, room: AgentAsyncRoom | undefined): Promise<void> { if (!room || room.owner.identityId !== envelope.sender || !await verifySigned(this.crypto, room, envelope.sender) || !room.members.some(value => value.identityId === this.local.nodeId && value.agentId === this.localAgent.agentId)) throw new AgentSocialError('UNAUTHORIZED', 'Room membership is invalid'); this.assertContactAgent(envelope.sender, room.owner.agentId); validateRoom(room); if (this.rooms.has(room.id)) return; if (this.rooms.size >= this.maxMailbox) throw new AgentSocialError('QUOTA', 'Agent room mailbox quota exceeded'); this.rooms.set(room.id, room); this.record({ event: 'room.received', outcome: 'received', peer: envelope.sender, roomId: room.id, dataClasses: room.sharedContext.map(value => value.dataClass) }); }
  private async receiveContribution(envelope: Envelope, contribution: AgentRoomContribution | undefined): Promise<void> { if (!contribution || contribution.sender.identityId !== envelope.sender || !await verifySigned(this.crypto, contribution, envelope.sender) || this.contributions.has(contribution.id)) throw new AgentSocialError('INVALID_SIGNATURE', 'Invalid room contribution'); this.assertContactAgent(envelope.sender, contribution.sender.agentId); const room = this.rooms.get(contribution.roomId); if (!room || !room.members.some(value => value.identityId === envelope.sender && value.agentId === contribution.sender.agentId) || !room.members.some(value => value.identityId === this.local.nodeId && value.agentId === this.localAgent.agentId)) throw new AgentSocialError('UNAUTHORIZED', 'Contribution is outside room membership'); normalizeContext(contribution.context); if (this.contributions.size >= AGENT_SOCIAL_MAX_ROOM_CONTRIBUTIONS) throw new AgentSocialError('QUOTA', 'Agent room contribution quota exceeded'); this.contributions.set(contribution.id, contribution); this.record({ event: 'room.contribution', outcome: 'received', peer: envelope.sender, roomId: contribution.roomId, dataClasses: contribution.context.map(value => value.dataClass) }); }

  private async queueMessage(peer: NodeId, message: AgentSocialMessage): Promise<void> {
    const contact = this.requireContact(peer); if (this.outbox.size >= this.maxOutbox) throw new AgentSocialError('QUOTA', 'Agent mailbox outbox quota exceeded'); const plaintext = JSON.stringify(message); if (new TextEncoder().encode(plaintext).byteLength > AGENT_SOCIAL_MAX_TASK_BYTES) throw new AgentSocialError('QUOTA', 'Agent social object exceeds size limit'); const body = await this.cipher.encrypt(plaintext, this.local.encryptionPrivateKey, contact.encryptionPublicKey); const unsigned: UnsignedEnvelope = { version: 1, type: AGENT_SOCIAL_ENVELOPE, id: randomId(), sender: this.local.nodeId, recipient: peer, nonce: await this.crypto.randomNonce(), expiresAt: new Date(this.now() + AGENT_SOCIAL_MAX_LIFETIME_MS).toISOString(), body }; const envelope: Envelope = { ...unsigned, signature: await this.security.sign(unsigned) }; this.outbox.set(envelope.id, { id: envelope.id, peer, envelope, attempts: 0, nextAttemptAt: this.now() });
  }

  private async sendReceipt(peer: NodeId, task: AgentTaskRequest, status: AgentDeliveryStatus): Promise<void> { const unsigned = { version: 1 as const, id: randomId(), messageId: task.id, taskId: task.taskId, sender: this.localAgent, recipient: task.sender, status, at: iso(this.now()) }; const receipt: AgentDeliveryReceipt = { ...unsigned, signature: await this.crypto.sign(canonicalJson(unsigned), this.local.privateKey) }; this.receipts.set(receipt.id, receipt); await this.queueMessage(peer, { kind: 'receipt', receipt }); }
  private async makeResponse(task: AgentTaskRequest, status: AgentTaskResponse['status'], result?: AgentTaskResult, reason?: string): Promise<AgentTaskResponse> { const createdAt = iso(this.now()); const unsigned = { version: 1 as const, id: randomId(), taskId: task.taskId, requestId: task.id, sender: this.localAgent, recipient: task.sender, status, ...(result ? { result } : {}), ...(reason ? { reason } : {}), createdAt, expiresAt: new Date(this.now() + AGENT_SOCIAL_MAX_LIFETIME_MS).toISOString() }; return { ...unsigned, signature: await this.crypto.sign(canonicalJson(unsigned), this.local.privateKey) }; }

  private assertCanContact(recipient: AgentRef): void { const contact = this.contacts.get(recipient.identityId); if (!contact || contact.revoked || contact.agent.agentId !== recipient.agentId) throw new AgentSocialError('UNKNOWN_CONTACT', 'Agent is not an authorized contact'); const p = this.policy; if (p.blockedIdentityIds.includes(recipient.identityId) || p.blockedAgentIds.includes(recipient.agentId)) throw new AgentSocialError('POLICY_DENIED', 'Agent contact is blocked'); if (p.allowedIdentityIds.length && !p.allowedIdentityIds.includes(recipient.identityId) || p.allowedAgentIds.length && !p.allowedAgentIds.includes(recipient.agentId)) throw new AgentSocialError('POLICY_DENIED', 'Agent is outside the allowed contact policy'); if (p.mode === 'deny') throw new AgentSocialError('POLICY_DENIED', 'Agent contact policy denies tasks'); if (p.mode === 'trusted-only' && !contact.trusted) throw new AgentSocialError('POLICY_DENIED', 'Agent is not trusted'); }
  private assertCanAccept(task: AgentTaskRequest): void { const p = this.policy; if (p.blockedIdentityIds.includes(task.sender.identityId) || p.blockedAgentIds.includes(task.sender.agentId)) throw new AgentSocialError('POLICY_DENIED', 'Sender is blocked'); if (p.mode === 'deny') throw new AgentSocialError('POLICY_DENIED', 'Incoming agent tasks are denied'); const contact = this.contacts.get(task.sender.identityId); if (!contact || contact.revoked || contact.agent.agentId !== task.sender.agentId) throw new AgentSocialError('UNKNOWN_CONTACT', 'Sender is not an authorized contact'); if (p.allowedIdentityIds.length && !p.allowedIdentityIds.includes(task.sender.identityId) || p.allowedAgentIds.length && !p.allowedAgentIds.includes(task.sender.agentId)) throw new AgentSocialError('POLICY_DENIED', 'Sender is outside the allowed contact policy'); if (p.mode === 'trusted-only' && !contact.trusted) throw new AgentSocialError('POLICY_DENIED', 'Only trusted agents may send tasks'); const recent = [...this.requests.values()].filter(value => value.sender.identityId === task.sender.identityId && Date.parse(value.createdAt) > this.now() - 60 * 60_000).length; if (recent >= p.maxTasksPerSenderPerHour) throw new AgentSocialError('QUOTA', 'Sender task rate limit exceeded'); }
  private assertAcceptPolicy(task: AgentTaskRequest): void { this.assertCanAccept(task); if (this.policy.askBeforeAccepting && !this.policy.autoAcceptTaskTypes.includes(task.taskType)) throw new AgentSocialError('APPROVAL_REQUIRED', 'Task requires local approval'); }
  private assertTaskUsable(task: AgentTaskRequest): void { if (Date.parse(task.expiresAt) <= this.now()) throw new AgentSocialError('EXPIRED', 'Task has expired'); if (task.delegationDepth > AGENT_SOCIAL_MAX_DELEGATION_DEPTH || task.delegationChain.length > AGENT_SOCIAL_MAX_DELEGATION_DEPTH + 1 || new Set(task.delegationChain).size !== task.delegationChain.length) throw new AgentSocialError('RECURSION_LIMIT', 'Delegation chain is invalid'); }
  private assertTaskShape(task: AgentTaskRequest): void { if (task.version !== 1 || !safeId(task.id) || !safeId(task.taskId) || !normalizeAgentRefSafe(task.sender) || !normalizeAgentRefSafe(task.recipient) || !AGENT_TASK_TYPES.includes(task.taskType) || typeof task.prompt !== 'string' || task.untrusted !== true || !Array.isArray(task.explicitContext) || !Array.isArray(task.capabilities) || !Number.isFinite(Date.parse(task.createdAt)) || !Number.isFinite(Date.parse(task.expiresAt)) || typeof task.signature !== 'string' || !Number.isSafeInteger(task.delegationDepth) || !Array.isArray(task.delegationChain)) throw new AgentSocialError('INVALID_STATE', 'Invalid task shape'); normalizeContext(task.explicitContext); if (task.prompt.length > 16_384) throw new AgentSocialError('QUOTA', 'Task prompt is too large'); if (task.capabilities.length > AGENT_SOCIAL_MAX_CAPABILITIES) throw new AgentSocialError('CAPABILITY_DENIED', 'Too many capabilities'); }
  private async normalizeCapabilities(values: readonly AgentTaskCapability[], recipient: AgentRef, taskType: AgentTaskType, expiresAt: string): Promise<AgentTaskCapability[]> { if (values.length > AGENT_SOCIAL_MAX_CAPABILITIES) throw new AgentSocialError('CAPABILITY_DENIED', 'Too many capabilities'); const result: AgentTaskCapability[] = []; const seen = new Set<string>(); for (const value of values) { validateCapability(value); if (seen.has(value.id)) throw new AgentSocialError('CAPABILITY_DENIED', 'Duplicate capability in task'); seen.add(value.id); if (value.issuedBy !== this.local.nodeId || value.subject.identityId !== recipient.identityId || value.subject.agentId !== recipient.agentId || !value.taskTypes.includes(taskType) || Date.parse(value.expiresAt) > Date.parse(expiresAt) || this.revokedCapabilityIds.has(value.id) || (this.capabilityUses.get(value.id) ?? 0) >= value.maxUses || !await this.crypto.verify(canonicalJson(stripSignature(value)), value.signature, this.local.publicKey)) throw new AgentSocialError('CAPABILITY_DENIED', 'Capability is not issued by this agent or is out of scope'); this.capabilityUses.set(value.id, (this.capabilityUses.get(value.id) ?? 0) + 1); result.push(clone(value)); } return result; }
  private pendingFrom(identityId: NodeId): number { return [...this.requests.values()].filter(value => value.sender.identityId === identityId && value.recipient.identityId === this.local.nodeId && value.status === 'pending').length; }
  private assertOutboxQuota(): void { if (this.outbox.size >= this.maxOutbox) throw new AgentSocialError('QUOTA', 'Agent mailbox outbox quota exceeded'); }
  private requireContact(identityId: NodeId): AgentContact { const value = this.contacts.get(identityId); if (!value || value.revoked) throw new AgentSocialError('UNKNOWN_CONTACT', 'Unknown or revoked agent contact'); return value; }
  private assertContactAgent(identityId: NodeId, agentId: string): void { if (this.requireContact(identityId).agent.agentId !== agentId) throw new AgentSocialError('UNAUTHORIZED', 'Agent reference does not match the trusted contact'); }
  private requireTask(taskId: string): AgentTaskRequest { const value = this.requests.get(taskId); if (!value) throw new AgentSocialError('NOT_FOUND', 'Agent task not found'); return value; }
  private requireRoom(roomId: string): AgentAsyncRoom { const value = this.rooms.get(roomId); if (!value) throw new AgentSocialError('NOT_FOUND', 'Agent room not found'); return value; }
  private assertRoomUsable(room: AgentAsyncRoom): void { if (room.status !== 'active' || Date.parse(room.expiresAt) <= this.now()) throw new AgentSocialError('EXPIRED', 'Agent room is no longer active'); if (!room.members.some(value => value.identityId === this.local.nodeId && value.agentId === this.localAgent.agentId)) throw new AgentSocialError('UNAUTHORIZED', 'Agent is not a room member'); }

  private async verifyTask(task: AgentTaskRequest, sender: NodeId): Promise<boolean> { return task.sender.identityId === sender && await verifySigned(this.crypto, task, sender); }
  private async verifyTaskCapabilities(task: AgentTaskRequest): Promise<boolean> { const seen = new Set<string>(); for (const value of task.capabilities) { try { validateCapability(value); if (seen.has(value.id)) return false; seen.add(value.id); if (value.issuedBy !== task.sender.identityId || value.subject.identityId !== task.recipient.identityId || value.subject.agentId !== task.recipient.agentId || !value.taskTypes.includes(task.taskType) || Date.parse(value.expiresAt) <= this.now() || Date.parse(value.expiresAt) > Date.parse(task.expiresAt) || this.revokedCapabilityIds.has(value.id) || (this.capabilityUses.get(value.id) ?? 0) >= value.maxUses) return false; const contact = this.contacts.get(value.issuedBy); if (!contact || !(await this.crypto.verify(canonicalJson(stripSignature(value)), value.signature, contact.signingPublicKey))) return false; } catch { return false; } } for (const value of task.capabilities) this.capabilityUses.set(value.id, (this.capabilityUses.get(value.id) ?? 0) + 1); return true; }
  private async verifyResponse(response: AgentTaskResponse, sender: NodeId): Promise<boolean> { return response.sender.identityId === sender && await verifySigned(this.crypto, response, sender); }
  private async verifyReceipt(receipt: AgentDeliveryReceipt, sender: NodeId): Promise<boolean> { return receipt.sender.identityId === sender && await verifySigned(this.crypto, receipt, sender); }
  private async verifyPresence(presence: AgentPresence, sender: NodeId): Promise<boolean> { return presence.agent.identityId === sender && await verifySigned(this.crypto, presence, sender); }
  private async hydrate(): Promise<void> { const raw = await this.storage.read(); if (raw === undefined) return; const snapshot = parseSnapshot(raw); this.policy = snapshot.policy; snapshot.contacts.forEach(value => this.contacts.set(value.agent.identityId, value)); snapshot.requests.forEach(value => this.requests.set(value.taskId, value)); snapshot.responses.forEach(value => this.responses.set(value.id, value)); snapshot.receipts.forEach(value => this.receipts.set(value.id, value)); snapshot.outbox.forEach(value => this.outbox.set(value.id, value)); if (snapshot.presence) this.localPresence = snapshot.presence; snapshot.rooms.forEach(value => this.rooms.set(value.id, value)); snapshot.contributions.forEach(value => this.contributions.set(value.id, value)); snapshot.seenIds.forEach(value => this.seenIds.add(value)); snapshot.revokedCapabilityIds.forEach(value => this.revokedCapabilityIds.add(value)); snapshot.capabilityUses.forEach(value => this.capabilityUses.set(value.id, value.uses)); this.auditEntries.push(...snapshot.audit); }
  private makeSnapshot(): AgentMailboxSnapshot { return { version: 1, contacts: this.contactsList(), policy: clone(this.policy), ...(this.localPresence ? { presence: clone(this.localPresence) } : {}), requests: [...this.requests.values()].map(value => withEffectiveTaskStatus(value, this.now())), responses: [...this.responses.values()].map(clone), receipts: [...this.receipts.values()].map(clone), outbox: [...this.outbox.values()].map(clone), rooms: [...this.rooms.values()].map(value => withEffectiveRoomStatus(value, this.now())), contributions: [...this.contributions.values()].map(clone), seenIds: [...this.seenIds].slice(-16_384), revokedCapabilityIds: [...this.revokedCapabilityIds], capabilityUses: [...this.capabilityUses.entries()].map(([id, uses]) => ({ id, uses })), audit: this.auditEntries.map(clone) }; }
  private async persist(): Promise<void> { const snapshot = this.makeSnapshot(); const operation = this.writes.then(() => this.storage.write(snapshot)); this.writes = operation.catch(() => undefined); await operation; }
  private record(input: Omit<AgentMailboxAuditRecord, 'version' | 'id' | 'at'>): void { this.auditEntries.push({ version: 1, id: randomId(), at: iso(this.now()), ...input }); while (this.auditEntries.length > 2_000) this.auditEntries.shift(); }
  private rejectIncoming(envelope: Envelope, error: unknown): void { this.record({ event: 'security.rejected', outcome: 'denied', peer: envelope.sender, dataClasses: [], reason: error instanceof Error ? error.message.slice(0, 256) : 'rejected' }); void this.persist(); }
}

/** Semantic alias for hosts that prefer the service-oriented name. */
export class AgentSocialService extends AgentMailbox {}

function normalizeContact(value: AgentContact): AgentContact { if (!value || value.version !== 1 || !normalizeAgentRefSafe(value.agent) || typeof value.signingPublicKey !== 'string' || !value.signingPublicKey || typeof value.encryptionPublicKey !== 'string' || !value.encryptionPublicKey || typeof value.trusted !== 'boolean' || !Number.isFinite(Date.parse(value.createdAt)) || !Number.isFinite(Date.parse(value.updatedAt))) throw new AgentSocialError('INVALID_ARGUMENT', 'Invalid agent contact'); return clone(value); }
function normalizePolicy(value: Partial<AgentTrustPolicy>): AgentTrustPolicy { const policy: AgentTrustPolicy = { version: 1, mode: value.mode ?? DEFAULT_POLICY.mode, allowedIdentityIds: uniqueStrings(value.allowedIdentityIds ?? []), allowedAgentIds: uniqueStrings(value.allowedAgentIds ?? []), blockedIdentityIds: uniqueStrings(value.blockedIdentityIds ?? []), blockedAgentIds: uniqueStrings(value.blockedAgentIds ?? []), askBeforeAccepting: value.askBeforeAccepting ?? DEFAULT_POLICY.askBeforeAccepting, autoAcceptTaskTypes: normalizeTaskTypes(value.autoAcceptTaskTypes ?? []), maxPending: boundedInt(value.maxPending ?? DEFAULT_POLICY.maxPending, 1, AGENT_SOCIAL_MAX_MAILBOX), maxTasksPerSenderPerHour: boundedInt(value.maxTasksPerSenderPerHour ?? DEFAULT_POLICY.maxTasksPerSenderPerHour, 1, 10_000) }; if (!AGENT_TRUST_MODES.includes(policy.mode)) throw new AgentSocialError('INVALID_ARGUMENT', 'Invalid agent trust policy'); return policy; }
function normalizeTaskTypes(values: readonly AgentTaskType[]): AgentTaskType[] { if (!Array.isArray(values) || values.length > AGENT_TASK_TYPES.length) throw new AgentSocialError('INVALID_ARGUMENT', 'Invalid task type list'); const result = [...new Set(values)]; if (result.some(value => !AGENT_TASK_TYPES.includes(value))) throw new AgentSocialError('INVALID_ARGUMENT', 'Invalid task type'); return result; }
function normalizeContext(values: readonly AgentSharedContext[]): AgentSharedContext[] { if (!Array.isArray(values) || values.length > AGENT_SOCIAL_MAX_CONTEXT_ITEMS) throw new AgentSocialError('UNSHAREABLE_DATA', 'Too much shared context'); return values.map(value => { if (!value || !safeId(value.id) || typeof value.label !== 'string' || !value.label.trim() || value.label.length > 240 || (value.dataClass !== 'PUBLIC' && value.dataClass !== 'USER_EXPLICIT')) throw new AgentSocialError('UNSHAREABLE_DATA', 'Only PUBLIC/USER_EXPLICIT context may leave an agent'); const encoded = stringify(value.value); if (encoded.length > 32_000) throw new AgentSocialError('UNSHAREABLE_DATA', 'Shared context item is too large'); return { id: value.id, label: value.label.trim(), value: safeClone(value.value), dataClass: value.dataClass }; }); }
function validateCapability(value: AgentTaskCapability): void { if (!value || value.version !== 1 || !safeId(value.id) || typeof value.scope !== 'string' || !value.scope || !isSafeCapabilityScope(value.scope) || !Array.isArray(value.taskTypes) || !value.taskTypes.length || !normalizeAgentRefSafe(value.subject) || !safeId(value.issuedBy) || !Number.isFinite(Date.parse(value.issuedAt)) || !Number.isFinite(Date.parse(value.expiresAt)) || !Number.isSafeInteger(value.maxUses) || value.maxUses < 1 || value.maxUses > 100 || typeof value.signature !== 'string') throw new AgentSocialError('CAPABILITY_DENIED', 'Invalid delegated capability'); normalizeTaskTypes(value.taskTypes); if (Date.parse(value.expiresAt) <= Date.parse(value.issuedAt)) throw new AgentSocialError('CAPABILITY_EXPIRED', 'Capability expiry is invalid'); }
function isSafeCapabilityScope(scope: string): boolean { if (scope.length > 256 || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(scope)) return false; return !/(^|[._:-])(private|secret|memory|rag|credential|device|security|shell|filesystem|network|delete|revoke|ban)([._:-]|$)/i.test(scope); }
function validateRoom(value: AgentAsyncRoom): void { if (!value || value.version !== 1 || !safeId(value.id) || !value.title || !normalizeAgentRefSafe(value.owner) || !Array.isArray(value.members) || !value.members.length || !Array.isArray(value.sharedContext) || !Number.isFinite(Date.parse(value.createdAt)) || !Number.isFinite(Date.parse(value.expiresAt)) || !['active', 'ended', 'expired'].includes(value.status) || !Number.isSafeInteger(value.revision) || typeof value.signature !== 'string') throw new AgentSocialError('INVALID_STATE', 'Invalid asynchronous agent room'); uniqueRefs(value.members); normalizeContext(value.sharedContext); }
function parseSnapshot(value: unknown): AgentMailboxSnapshot { if (!value || typeof value !== 'object' || (value as { version?: unknown }).version !== 1) throw new AgentSocialError('INVALID_STATE', 'Invalid agent mailbox state version'); const candidate = value as Partial<AgentMailboxSnapshot>; if (!Array.isArray(candidate.contacts) || !candidate.policy || !Array.isArray(candidate.requests) || !Array.isArray(candidate.responses) || !Array.isArray(candidate.receipts) || !Array.isArray(candidate.outbox) || !Array.isArray(candidate.rooms) || !Array.isArray(candidate.contributions) || !Array.isArray(candidate.seenIds) || !Array.isArray(candidate.revokedCapabilityIds) || !Array.isArray(candidate.audit)) throw new AgentSocialError('INVALID_STATE', 'Invalid agent mailbox state'); const policy = normalizePolicy(candidate.policy); const contacts = candidate.contacts.map(normalizeContact); const requests = candidate.requests.map(value => { const task = value as AgentTaskRequest; if (!task || !task.signature) throw new AgentSocialError('INVALID_STATE', 'Invalid persisted task'); return clone(task); }); const responses = candidate.responses.map(value => clone(value as AgentTaskResponse)); const receipts = candidate.receipts.map(value => clone(value as AgentDeliveryReceipt)); const outbox = candidate.outbox.map(value => clone(value as AgentMailboxOutbox)); const rooms = candidate.rooms.map(value => { validateRoom(value as AgentAsyncRoom); return clone(value as AgentAsyncRoom); }); const contributions = candidate.contributions.map(value => clone(value as AgentRoomContribution)); const capabilityUses = (candidate.capabilityUses ?? []).filter(value => !!value && safeId(value.id) && Number.isSafeInteger(value.uses) && value.uses >= 0).map(value => ({ id: value.id, uses: value.uses })); return { version: 1, contacts, policy, ...(candidate.presence ? { presence: clone(candidate.presence) } : {}), requests, responses, receipts, outbox, rooms, contributions, seenIds: candidate.seenIds.filter(safeId).slice(-16_384), revokedCapabilityIds: candidate.revokedCapabilityIds.filter(safeId), capabilityUses, audit: candidate.audit.map(value => clone(value as AgentMailboxAuditRecord)).slice(-2_000) }; }
function withEffectiveTaskStatus(value: AgentTaskRequest, now: number): AgentTaskRequest { return value.status === 'queued' || value.status === 'pending' ? Date.parse(value.expiresAt) <= now ? { ...value, status: 'expired' } : clone(value) : clone(value); }
function receiptToTaskStatus(value: AgentDeliveryStatus): AgentTaskStatus | undefined { switch (value) { case 'delivered': return 'pending'; case 'accepted': return 'accepted'; case 'completed': return 'completed'; case 'rejected': return 'rejected'; case 'expired': return 'expired'; default: return undefined; } }
function withEffectiveRoomStatus(value: AgentAsyncRoom, now: number): AgentAsyncRoom { return value.status === 'active' && Date.parse(value.expiresAt) <= now ? { ...value, status: 'expired' } : clone(value); }
function assertResultShareable(value: AgentTaskResult): void { if (!value || (value.dataClass !== 'PUBLIC' && value.dataClass !== 'USER_EXPLICIT')) throw new AgentSocialError('UNSHAREABLE_DATA', 'Private/secret task results cannot cross an agent mailbox'); if (stringify(value.value).length > 32_000) throw new AgentSocialError('QUOTA', 'Task result is too large'); if (value.references && (!Array.isArray(value.references) || value.references.length > 64 || value.references.some(reference => !reference || !safeId(reference.id) || typeof reference.type !== 'string' || reference.type.length > 128))) throw new AgentSocialError('INVALID_ARGUMENT', 'Task result references are invalid'); }
async function verifySigned(crypto: CryptoProvider, value: { readonly signature: string }, signer: NodeId): Promise<boolean> { try { return await crypto.verify(canonicalJson(stripSignature(value)), value.signature, signer); } catch { return false; } }
function stripSignature<T extends { readonly signature: string }>(value: T): Omit<T, 'signature'> { const { signature: _signature, ...unsigned } = value; return unsigned; }
function parseMessage(value: string): AgentSocialMessage | undefined { try { const parsed = JSON.parse(value) as AgentSocialMessage; if (!parsed || !['task', 'response', 'receipt', 'presence', 'room', 'contribution'].includes(parsed.kind)) return undefined; return parsed; } catch { return undefined; } }
function normalizeAgentRef(value: AgentRef): AgentRef { if (!normalizeAgentRefSafe(value)) throw new AgentSocialError('INVALID_ARGUMENT', 'Invalid agent reference'); return { agentId: value.agentId, identityId: value.identityId }; }
function normalizeAgentRefSafe(value: unknown): value is AgentRef { return !!value && typeof value === 'object' && safeId((value as AgentRef).agentId) && safeId((value as AgentRef).identityId); }
function uniqueRefs(values: readonly AgentRef[]): AgentRef[] { const map = new Map<string, AgentRef>(); for (const value of values) { const normalized = normalizeAgentRef(value); map.set(`${normalized.identityId}:${normalized.agentId}`, normalized); } return [...map.values()]; }
function uniqueStrings(values: readonly string[]): string[] { return [...new Set(values.filter(value => typeof value === 'string' && safeId(value)))]; }
function normalizeChain(values: readonly string[], depth: number): string[] { if (values.length > AGENT_SOCIAL_MAX_DELEGATION_DEPTH + 1 || values.some(value => !safeId(value)) || new Set(values).size !== values.length || values.length < depth) throw new AgentSocialError('RECURSION_LIMIT', 'Invalid delegation chain'); return [...values]; }
function assertExpiry(createdAt: string, expiresAt: string, now: number): void { const created = Date.parse(createdAt); const expiry = Date.parse(expiresAt); if (!Number.isFinite(created) || !Number.isFinite(expiry) || expiry <= now || expiry <= created || expiry - now > AGENT_SOCIAL_MAX_LIFETIME_MS) throw new AgentSocialError('INVALID_ARGUMENT', 'Expiry is outside the agent social lifetime'); }
function validEnvelopeExpiry(value: string, now: number): boolean { const expiry = Date.parse(value); return Number.isFinite(expiry) && expiry > now - 1_000 && expiry - now <= AGENT_SOCIAL_MAX_LIFETIME_MS + 1_000; }
function retryDelay(attempts: number): number { return Math.min(60_000, 1_000 * 2 ** Math.min(attempts, 6)); }
function boundedText(value: string, max: number, label: string): string { if (typeof value !== 'string' || !value.trim() || value.length > max) throw new AgentSocialError('INVALID_ARGUMENT', `${label} is invalid`); return value.trim(); }
function boundedInt(value: number, min: number, max: number): number { if (!Number.isSafeInteger(value) || value < min || value > max) throw new AgentSocialError('INVALID_ARGUMENT', 'Integer is outside bounds'); return value; }
function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, Math.trunc(value))); }
function safeId(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9_-][A-Za-z0-9._:-]{0,127}$/.test(value); }
function assertId(value: string): string { if (!safeId(value)) throw new AgentSocialError('INVALID_ARGUMENT', 'Invalid id'); return value; }
function iso(value: number): string { return new Date(value).toISOString(); }
function randomId(): string { return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function clone<T>(value: T): T { return structuredClone(value); }
function safeClone<T>(value: T): T { try { return structuredClone(value); } catch { return String(value) as T; } }
function stringify(value: unknown): string { try { return JSON.stringify(value) ?? String(value); } catch { return '[unserializable]'; } }
