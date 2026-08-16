/**
 * Agent-to-agent visits over the existing signed Keystone Transport.
 *
 * A visit is a capability protocol, not a second AgentRuntime.  The remote
 * agent is always untrusted and receives no context unless a host explicitly
 * returns a bounded PUBLIC/USER_EXPLICIT value from its own local policy.
 * Memory, RAG, files, credentials and tools never cross this module by
 * default.  Hosts may adapt `onGuestRequest` to their existing AgentRuntime or
 * ToolPolicy; this service itself never invokes a tool on behalf of a guest.
 */

import { canonicalJson, type CryptoProvider } from '../crypto.js';
import type { DeviceSessionKeys } from '../identity.js';
import type { Envelope, EnvelopeSecurity, Transport, UnsignedEnvelope } from '../transport.js';
import type { NodeId } from '../types.js';
import type { AIDataClass } from './privacy.js';

export const AGENT_VISIT_VERSION = 1 as const;
export const AGENT_VISIT_ENVELOPE = 'ai.agent_visit';
export const AGENT_VISIT_MAX_LIFETIME_MS = 15 * 60_000;
export const AGENT_VISIT_MAX_OBJECT_BYTES = 256 * 1024;
export const AGENT_VISIT_MAX_AUDIT = 2_000;

export const AGENT_CAPABILITIES = [
  'talk_to_host_agent',
  'read_shared_context',
  'write_shared_workspace',
  'search_public_objects',
  'use_specific_tool',
] as const;
export type AgentCapabilityName = (typeof AGENT_CAPABILITIES)[number];
export const AGENT_APPROVAL_MODES = ['ASK_EVERY_TIME', 'ALLOW_THIS_VISIT', 'ALLOW_THIS_AGENT', 'DENY'] as const;
export type AgentVisitApprovalMode = (typeof AGENT_APPROVAL_MODES)[number];
export const AGENT_VISIT_OPERATIONS = [
  'talk_to_host_agent',
  'read_shared_context',
  'write_shared_workspace',
  'search_public_objects',
  'use_specific_tool',
  /** Deliberately recognized and always denied without a private capability. */
  'read_private_memory',
] as const;
export type AgentVisitOperation = (typeof AGENT_VISIT_OPERATIONS)[number];
export const AGENT_VISIT_SAFE_DATA_CLASSES: readonly AIDataClass[] = ['PUBLIC', 'USER_EXPLICIT'];

export interface AgentRef {
  readonly agentId: string;
  readonly identityId: NodeId;
}

export interface AgentCapabilityRequest {
  readonly capability: AgentCapabilityName;
  readonly scope?: string;
  readonly toolId?: string;
}

export interface AgentCapabilityGrant extends AgentCapabilityRequest {
  readonly grantId: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly maxUses: number;
}

export interface AgentInvitation {
  readonly version: 1;
  readonly id: string;
  readonly visitor: AgentRef;
  readonly host: AgentRef;
  readonly requestedCapabilities: readonly AgentCapabilityRequest[];
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly status: 'pending' | 'accepted' | 'declined' | 'expired' | 'revoked';
  readonly signature: string;
}

export interface AgentDelegationToken {
  readonly version: 1;
  readonly id: string;
  readonly visitId: string;
  readonly issuer: NodeId;
  readonly subject: NodeId;
  readonly hostAgentId: string;
  readonly visitorAgentId: string;
  readonly capabilities: readonly AgentCapabilityGrant[];
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly signature: string;
}

export interface AgentVisit {
  readonly version: 1;
  readonly id: string;
  readonly invitationId: string;
  readonly visitor: AgentRef;
  readonly host: AgentRef;
  readonly capabilities: readonly AgentCapabilityGrant[];
  readonly approvalMode: AgentVisitApprovalMode;
  readonly tokenId: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly status: 'active' | 'revoked' | 'ended' | 'expired';
  readonly revision: number;
  readonly signature: string;
}

export interface GuestAgentSession {
  readonly version: 1;
  readonly id: string;
  readonly visitId: string;
  readonly role: 'visitor' | 'host';
  readonly localAgent: AgentRef;
  readonly remoteAgent: AgentRef;
  readonly tokenId?: string;
  readonly status: 'active' | 'revoked' | 'ended' | 'expired';
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly requestCount: number;
}

export interface AgentSharedContext {
  readonly id: string;
  readonly label: string;
  readonly value: unknown;
  readonly dataClass: 'PUBLIC' | 'USER_EXPLICIT';
}

export interface AgentRoomMember {
  readonly agent: AgentRef;
  readonly role: 'owner' | 'member';
}

export interface AgentRoom {
  readonly version: 1;
  readonly id: string;
  readonly title: string;
  readonly owner: AgentRef;
  readonly members: readonly AgentRoomMember[];
  readonly sharedContext: readonly AgentSharedContext[];
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly status: 'active' | 'ended' | 'expired';
  readonly revision: number;
  readonly signature: string;
}

export interface AgentRoomMessage {
  readonly id: string;
  readonly roomId: string;
  readonly sender: AgentRef;
  readonly text: string;
  readonly dataClass: 'PUBLIC' | 'USER_EXPLICIT';
  readonly createdAt: string;
}

export interface GuestAgentRequest {
  readonly requestId: string;
  readonly visit: AgentVisit;
  readonly operation: AgentVisitOperation;
  readonly toolId?: string;
  readonly input: unknown;
  readonly dataClass: 'PUBLIC' | 'USER_EXPLICIT';
  readonly untrusted: true;
}

export interface AgentVisitResult {
  readonly value: unknown;
  readonly dataClass: 'PUBLIC' | 'USER_EXPLICIT';
  readonly toolIntents?: readonly string[];
}

export interface AgentVisitApprovalRequest {
  readonly visitId: string;
  readonly visitor: AgentRef;
  readonly operation: AgentVisitOperation;
  readonly toolId?: string;
  readonly requestId: string;
  readonly sensitive: boolean;
}

export interface AgentVisitApprovalBoundary {
  approve(request: AgentVisitApprovalRequest): Promise<boolean>;
}

export interface AgentVisitHost {
  onGuestRequest(request: GuestAgentRequest): Promise<AgentVisitResult | undefined>;
}

export interface AgentVisitServiceOptions {
  readonly transport: Transport;
  readonly crypto: CryptoProvider;
  readonly security: EnvelopeSecurity;
  readonly local: DeviceSessionKeys;
  readonly agentId: string;
  readonly storage?: AgentVisitStateStore;
  readonly now?: () => number;
  readonly approval?: AgentVisitApprovalBoundary;
  readonly host?: AgentVisitHost;
  readonly onResult?: (visitId: string, result: AgentVisitResult) => void | Promise<void>;
  readonly onRoomMessage?: (message: AgentRoomMessage, room: AgentRoom) => void | Promise<void>;
}

export interface AgentVisitAuditRecord {
  readonly version: 1;
  readonly id: string;
  readonly at: string;
  readonly event: AgentVisitAuditEvent;
  readonly outcome: 'accepted' | 'denied' | 'sent' | 'received' | 'revoked' | 'ended';
  readonly visitId?: string;
  readonly roomId?: string;
  readonly requestId?: string;
  readonly visitor: AgentRef;
  readonly host: AgentRef;
  readonly capabilities: readonly string[];
  readonly dataClasses: readonly AIDataClass[];
  readonly toolIntents: readonly string[];
  readonly errorCode?: AgentVisitErrorCode;
}

export type AgentVisitAuditEvent =
  | 'invitation.sent'
  | 'invitation.received'
  | 'visit.accepted'
  | 'visit.request'
  | 'visit.response'
  | 'visit.revoked'
  | 'visit.ended'
  | 'room.received'
  | 'room.message';

export interface AgentVisitStateStore {
  read(): Promise<unknown | undefined>;
  write(value: unknown): Promise<void>;
}

export class InMemoryAgentVisitStateStore implements AgentVisitStateStore {
  private value?: unknown;
  async read(): Promise<unknown | undefined> { return this.value === undefined ? undefined : structuredClone(this.value); }
  async write(value: unknown): Promise<void> { this.value = structuredClone(value); }
}

export interface AgentVisitSnapshot {
  readonly version: 1;
  readonly invitations: readonly AgentInvitation[];
  readonly visits: readonly AgentVisit[];
  readonly tokens: readonly AgentDelegationToken[];
  readonly sessions: readonly GuestAgentSession[];
  readonly rooms: readonly AgentRoom[];
  readonly seenIds: readonly string[];
  readonly usedGrants: readonly { visitId: string; grantId: string; uses: number }[];
  readonly audit: readonly AgentVisitAuditRecord[];
}

export type AgentVisitErrorCode =
  | 'INVALID_ARGUMENT'
  | 'INVALID_SIGNATURE'
  | 'INVALID_STATE'
  | 'INVITATION_NOT_FOUND'
  | 'VISIT_NOT_FOUND'
  | 'ROOM_NOT_FOUND'
  | 'NOT_AUTHORIZED'
  | 'CAPABILITY_DENIED'
  | 'CAPABILITY_EXPIRED'
  | 'CAPABILITY_EXHAUSTED'
  | 'VISIT_REVOKED'
  | 'VISIT_EXPIRED'
  | 'VISIT_ENDED'
  | 'REPLAY'
  | 'UNSHAREABLE_DATA'
  | 'REMOTE_UNTRUSTED'
  | 'APPROVAL_REQUIRED'
  | 'TRANSPORT'
  | 'TIMEOUT';

export class AgentVisitError extends Error {
  constructor(readonly code: AgentVisitErrorCode, message: string) {
    super(message);
    this.name = 'AgentVisitError';
  }
}

interface VisitMessage {
  readonly kind: 'invitation' | 'accept' | 'request' | 'response' | 'revoke' | 'end' | 'room' | 'room_message';
  readonly invitation?: AgentInvitation;
  readonly visit?: AgentVisit;
  readonly token?: AgentDelegationToken;
  readonly request?: { requestId: string; operation: AgentVisitOperation; toolId?: string; input: unknown; dataClass: AIDataClass };
  readonly response?: { requestId: string; accepted: boolean; result?: AgentVisitResult; errorCode?: AgentVisitErrorCode };
  readonly reason?: string;
  readonly room?: AgentRoom;
  readonly message?: AgentRoomMessage;
}

interface PendingRequest {
  readonly visitId: string;
  readonly resolve: (result: AgentVisitResult) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

export class AgentVisitService {
  private readonly transport: Transport;
  private readonly crypto: CryptoProvider;
  private readonly security: EnvelopeSecurity;
  private readonly local: DeviceSessionKeys;
  private readonly localAgent: AgentRef;
  private readonly storage: AgentVisitStateStore;
  private readonly now: () => number;
  private readonly approval?: AgentVisitApprovalBoundary;
  private readonly host?: AgentVisitHost;
  private readonly onResult?: AgentVisitServiceOptions['onResult'];
  private readonly onRoomMessage?: AgentVisitServiceOptions['onRoomMessage'];
  private readonly invitations = new Map<string, AgentInvitation>();
  private readonly visits = new Map<string, AgentVisit>();
  private readonly tokens = new Map<string, AgentDelegationToken>();
  private readonly sessions = new Map<string, GuestAgentSession>();
  private readonly rooms = new Map<string, AgentRoom>();
  private readonly seenIds = new Set<string>();
  private readonly usedGrants = new Map<string, number>();
  private readonly auditEntries: AgentVisitAuditRecord[] = [];
  private readonly pending = new Map<string, PendingRequest>();
  private readonly unsubscribe: () => void;
  private writes: Promise<void> = Promise.resolve();
  private readyPromise: Promise<void>;
  private acceptedCount = 0;
  private rejectedCount = 0;

  constructor(options: AgentVisitServiceOptions) {
    this.transport = options.transport;
    this.crypto = options.crypto;
    this.security = options.security;
    this.local = options.local;
    this.localAgent = { agentId: assertId(options.agentId), identityId: options.local.nodeId };
    this.storage = options.storage ?? new InMemoryAgentVisitStateStore();
    this.now = options.now ?? Date.now;
    this.approval = options.approval;
    this.host = options.host;
    this.onResult = options.onResult;
    this.onRoomMessage = options.onRoomMessage;
    this.unsubscribe = this.transport.onMessage(envelope => { void this.receive(envelope).catch(() => { this.rejectedCount += 1; }); });
    this.readyPromise = this.hydrate();
  }

  async ready(): Promise<void> { await this.readyPromise; }
  close(): void { this.unsubscribe(); for (const value of this.pending.values()) { clearTimeout(value.timer); value.reject(new AgentVisitError('TRANSPORT', 'Agent visit service closed')); } this.pending.clear(); }
  stats(): { accepted: number; rejected: number; pending: number; activeVisits: number; rooms: number } { return { accepted: this.acceptedCount, rejected: this.rejectedCount, pending: this.pending.size, activeVisits: [...this.visits.values()].filter(value => this.effectiveStatus(value) === 'active').length, rooms: [...this.rooms.values()].filter(value => this.effectiveRoomStatus(value) === 'active').length }; }
  audit(): readonly AgentVisitAuditRecord[] { return this.auditEntries.map(clone); }
  async listInvitations(): Promise<readonly AgentInvitation[]> { await this.ready(); return [...this.invitations.values()].map(value => ({ ...value })); }
  async listVisits(): Promise<readonly AgentVisit[]> { await this.ready(); return [...this.visits.values()].map(value => this.withEffectiveStatus(value)); }
  async listSessions(): Promise<readonly GuestAgentSession[]> { await this.ready(); return [...this.sessions.values()].map(value => ({ ...value })); }
  async listRooms(): Promise<readonly AgentRoom[]> { await this.ready(); return [...this.rooms.values()].map(value => this.withEffectiveRoomStatus(value)); }

  async createInvitation(host: AgentRef, requestedCapabilities: readonly AgentCapabilityRequest[], options: { expiresAt?: string } = {}): Promise<AgentInvitation> {
    await this.ready();
    if (host.identityId === this.local.nodeId || !safeId(host.agentId)) throw new AgentVisitError('INVALID_ARGUMENT', 'Invitation host must be a remote agent');
    const createdAt = iso(this.now());
    const expiresAt = options.expiresAt ?? new Date(this.now() + AGENT_VISIT_MAX_LIFETIME_MS).toISOString();
    assertExpiry(createdAt, expiresAt, this.now());
    const requested = normalizeCapabilityRequests(requestedCapabilities);
    const unsigned = { version: 1 as const, id: randomId(), visitor: this.localAgent, host: normalizeAgentRef(host), requestedCapabilities: requested, createdAt, expiresAt, status: 'pending' as const };
    const invitation: AgentInvitation = { ...unsigned, signature: await this.crypto.sign(canonicalJson(unsigned), this.local.privateKey) };
    this.invitations.set(invitation.id, invitation);
    await this.persist();
    return clone(invitation);
  }

  async sendInvitation(invitationId: string): Promise<void> {
    await this.ready();
    const invitation = this.requireInvitation(invitationId);
    if (invitation.visitor.identityId !== this.local.nodeId || invitation.status !== 'pending') throw new AgentVisitError('NOT_AUTHORIZED', 'Only the visitor may send a pending invitation');
    if (this.effectiveInvitationStatus(invitation) !== 'pending') throw new AgentVisitError('VISIT_EXPIRED', 'Invitation has expired');
    await this.send(invitation.host.identityId, { kind: 'invitation', invitation });
    this.record({ event: 'invitation.sent', outcome: 'sent', visitor: invitation.visitor, host: invitation.host, capabilities: capabilityLabels(invitation.requestedCapabilities), dataClasses: [], toolIntents: [] });
    await this.persist();
  }

  async acceptInvitation(invitationId: string, input: { capabilities: readonly AgentCapabilityGrant[]; approvalMode: AgentVisitApprovalMode }): Promise<{ visit: AgentVisit; token: AgentDelegationToken; session: GuestAgentSession }> {
    await this.ready();
    const invitation = this.requireInvitation(invitationId);
    if (invitation.host.identityId !== this.local.nodeId || invitation.host.agentId !== this.localAgent.agentId) throw new AgentVisitError('NOT_AUTHORIZED', 'Only the invited host agent may accept');
    if (this.effectiveInvitationStatus(invitation) !== 'pending') throw new AgentVisitError('VISIT_EXPIRED', 'Invitation is no longer pending');
    if (!AGENT_APPROVAL_MODES.includes(input.approvalMode)) throw new AgentVisitError('INVALID_ARGUMENT', 'Invalid approval mode');
    const capabilities = normalizeCapabilityGrants(input.capabilities, invitation, this.now());
    if (input.approvalMode === 'DENY') throw new AgentVisitError('NOT_AUTHORIZED', 'Visit was denied');
    const createdAt = iso(this.now());
    const expiresAt = minExpiry(invitation.expiresAt, capabilities.map(value => value.expiresAt), this.now());
    const unsignedToken = { version: 1 as const, id: randomId(), visitId: randomId(), issuer: this.local.nodeId, subject: invitation.visitor.identityId, hostAgentId: this.localAgent.agentId, visitorAgentId: invitation.visitor.agentId, capabilities, issuedAt: createdAt, expiresAt };
    const token: AgentDelegationToken = { ...unsignedToken, signature: await this.crypto.sign(canonicalJson(unsignedToken), this.local.privateKey) };
    const unsignedVisit = { version: 1 as const, id: unsignedToken.visitId, invitationId: invitation.id, visitor: invitation.visitor, host: this.localAgent, capabilities, approvalMode: input.approvalMode, tokenId: token.id, createdAt, expiresAt, status: 'active' as const, revision: 1 };
    const visit: AgentVisit = { ...unsignedVisit, signature: await this.crypto.sign(canonicalJson(unsignedVisit), this.local.privateKey) };
    const session: GuestAgentSession = { version: 1, id: randomId(), visitId: visit.id, role: 'host', localAgent: this.localAgent, remoteAgent: invitation.visitor, tokenId: token.id, status: 'active', startedAt: createdAt, requestCount: 0 };
    this.invitations.set(invitation.id, { ...invitation, status: 'accepted' });
    this.visits.set(visit.id, visit); this.tokens.set(token.id, token); this.sessions.set(session.id, session);
    await this.send(invitation.visitor.identityId, { kind: 'accept', visit, token });
    this.record({ event: 'visit.accepted', outcome: 'accepted', visitId: visit.id, visitor: visit.visitor, host: visit.host, capabilities: capabilityLabels(capabilities), dataClasses: [], toolIntents: [] });
    await this.persist();
    return { visit: clone(visit), token: clone(token), session: clone(session) };
  }

  async request(visitId: string, input: { operation: AgentVisitOperation; input?: unknown; dataClass?: AIDataClass; toolId?: string }, timeoutMs = 30_000): Promise<AgentVisitResult> {
    await this.ready();
    const visit = this.requireVisit(visitId);
    if (visit.visitor.identityId !== this.local.nodeId) throw new AgentVisitError('NOT_AUTHORIZED', 'Only a visiting agent may send this request');
    this.assertVisitUsable(visit);
    const token = this.tokens.get(visit.tokenId);
    if (!token) throw new AgentVisitError('CAPABILITY_DENIED', 'Delegation token is unavailable');
    const requestId = randomId();
    const dataClass = input.dataClass ?? 'USER_EXPLICIT';
    assertShareableDataClass(dataClass);
    assertOperation(input.operation, input.toolId);
    if (!hasCapability(visit.capabilities, input.operation, input.toolId, this.now())) throw new AgentVisitError('CAPABILITY_DENIED', 'Requested operation is outside the delegation token');
    const timer = setTimeout(() => { const pending = this.pending.get(requestId); if (!pending) return; this.pending.delete(requestId); pending.reject(new AgentVisitError('TIMEOUT', 'Guest agent request timed out')); }, Math.max(100, Math.min(timeoutMs, 120_000)));
    const promise = new Promise<AgentVisitResult>((resolve, reject) => this.pending.set(requestId, { visitId, resolve, reject, timer }));
    try {
      await this.send(visit.host.identityId, { kind: 'request', visit, token, request: { requestId, operation: input.operation, ...(input.toolId ? { toolId: assertId(input.toolId) } : {}), input: safeClone(input.input), dataClass } });
    } catch (error) {
      const pending = this.pending.get(requestId);
      if (pending) { this.pending.delete(requestId); clearTimeout(pending.timer); pending.reject(error instanceof AgentVisitError ? error : new AgentVisitError('TRANSPORT', 'Agent visit transport failed')); }
      throw error;
    }
    this.record({ event: 'visit.request', outcome: 'sent', visitId, requestId, visitor: visit.visitor, host: visit.host, capabilities: capabilityLabels([requiredCapability(input.operation)]), dataClasses: [dataClass], toolIntents: input.toolId ? [input.toolId] : [] });
    return promise;
  }

  async revokeVisit(visitId: string, reason = 'revoked by host'): Promise<void> {
    await this.ready();
    const visit = this.requireVisit(visitId);
    if (visit.host.identityId !== this.local.nodeId) throw new AgentVisitError('NOT_AUTHORIZED', 'Only the host may revoke a visit');
    if (this.effectiveStatus(visit) === 'revoked') return;
    const revoked: AgentVisit = await this.resignVisit({ ...visit, status: 'revoked', revision: visit.revision + 1 });
    this.visits.set(visit.id, revoked); this.updateSessionStatus(visit.id, 'revoked');
    await this.send(visit.visitor.identityId, { kind: 'revoke', visit: revoked, reason });
    this.rejectPending(visit.id, new AgentVisitError('VISIT_REVOKED', reason));
    this.record({ event: 'visit.revoked', outcome: 'revoked', visitId, visitor: visit.visitor, host: visit.host, capabilities: capabilityLabels(visit.capabilities), dataClasses: [], toolIntents: [] });
    await this.persist();
  }

  async endVisit(visitId: string, reason = 'ended by participant'): Promise<void> {
    await this.ready();
    const visit = this.requireVisit(visitId);
    if (visit.visitor.identityId !== this.local.nodeId && visit.host.identityId !== this.local.nodeId) throw new AgentVisitError('NOT_AUTHORIZED', 'Participant is not part of this visit');
    if (this.effectiveStatus(visit) === 'ended') return;
    const ended: AgentVisit = await this.resignVisit({ ...visit, status: 'ended', revision: visit.revision + 1 });
    this.visits.set(visit.id, ended); this.updateSessionStatus(visit.id, 'ended');
    const peer = this.local.nodeId === visit.host.identityId ? visit.visitor.identityId : visit.host.identityId;
    await this.send(peer, { kind: 'end', visit: ended, reason });
    this.rejectPending(visit.id, new AgentVisitError('VISIT_ENDED', reason));
    this.record({ event: 'visit.ended', outcome: 'ended', visitId, visitor: visit.visitor, host: visit.host, capabilities: capabilityLabels(visit.capabilities), dataClasses: [], toolIntents: [] });
    await this.persist();
  }

  async createRoom(input: { title: string; members: readonly AgentRef[]; sharedContext?: readonly AgentSharedContext[]; expiresAt?: string }): Promise<AgentRoom> {
    await this.ready();
    if (!input.title.trim() || input.title.length > 160) throw new AgentVisitError('INVALID_ARGUMENT', 'Room title is invalid');
    const members = uniqueRoomMembers([{ agent: this.localAgent, role: 'owner' }, ...input.members.map(agent => ({ agent: normalizeAgentRef(agent), role: 'member' as const }))]);
    if (!members.some(value => value.agent.identityId === this.local.nodeId && value.agent.agentId === this.localAgent.agentId)) throw new AgentVisitError('NOT_AUTHORIZED', 'Room owner must be a member');
    const createdAt = iso(this.now()); const expiresAt = input.expiresAt ?? new Date(this.now() + AGENT_VISIT_MAX_LIFETIME_MS).toISOString(); assertExpiry(createdAt, expiresAt, this.now());
    const sharedContext = normalizeSharedContext(input.sharedContext ?? []);
    const unsigned = { version: 1 as const, id: randomId(), title: input.title.trim(), owner: this.localAgent, members, sharedContext, createdAt, expiresAt, status: 'active' as const, revision: 1 };
    const room: AgentRoom = { ...unsigned, signature: await this.crypto.sign(canonicalJson(unsigned), this.local.privateKey) };
    this.rooms.set(room.id, room); await this.persist(); return clone(room);
  }

  async publishRoom(roomId: string, peers?: readonly NodeId[]): Promise<void> {
    await this.ready();
    const room = this.requireRoom(roomId);
    if (room.owner.identityId !== this.local.nodeId) throw new AgentVisitError('NOT_AUTHORIZED', 'Only the room owner may publish it');
    const recipients = peers ?? room.members.filter(value => value.agent.identityId !== this.local.nodeId).map(value => value.agent.identityId);
    for (const peer of recipients) { if (!room.members.some(value => value.agent.identityId === peer)) throw new AgentVisitError('NOT_AUTHORIZED', 'Room recipient is not a member'); await this.send(peer, { kind: 'room', room }); }
  }

  async sendRoomMessage(roomId: string, text: string, dataClass: AIDataClass = 'USER_EXPLICIT'): Promise<void> {
    await this.ready();
    const room = this.requireRoom(roomId); this.assertRoomUsable(room); assertShareableDataClass(dataClass);
    if (!text.trim() || text.length > 16_000) throw new AgentVisitError('INVALID_ARGUMENT', 'Room message is invalid');
    const message: AgentRoomMessage = { id: randomId(), roomId, sender: this.localAgent, text: text.trim(), dataClass, createdAt: iso(this.now()) };
    for (const member of room.members) if (member.agent.identityId !== this.local.nodeId) await this.send(member.agent.identityId, { kind: 'room_message', room, message });
    this.record({ event: 'room.message', outcome: 'sent', roomId, visitor: this.localAgent, host: room.owner, capabilities: [], dataClasses: [dataClass], toolIntents: [] });
  }

  private async receive(envelope: Envelope): Promise<void> {
    await this.ready();
    if (envelope.type !== AGENT_VISIT_ENVELOPE || envelope.recipient !== this.local.nodeId) return;
    if (!validEnvelopeExpiry(envelope.expiresAt, this.now()) || this.seenIds.has(envelope.id) || this.seenIds.has(envelope.nonce) || !(await this.security.verify(envelope))) { this.rejectedCount += 1; return; }
    this.seenIds.add(envelope.id); this.seenIds.add(envelope.nonce); trimSet(this.seenIds, 8_192);
    const body = parseMessage(envelope.body);
    if (!body) { this.rejectedCount += 1; return; }
    switch (body.kind) {
      case 'invitation': await this.receiveInvitation(envelope, body.invitation); break;
      case 'accept': await this.receiveAccept(envelope, body.visit, body.token); break;
      case 'request': await this.receiveRequest(envelope, body.visit, body.token, body.request); break;
      case 'response': await this.receiveResponse(envelope, body.visit, body.response); break;
      case 'revoke': await this.receiveRevocation(envelope, body.visit, body.reason); break;
      case 'end': await this.receiveEnd(envelope, body.visit, body.reason); break;
      case 'room': await this.receiveRoom(envelope, body.room); break;
      case 'room_message': await this.receiveRoomMessage(envelope, body.room, body.message); break;
    }
  }

  private async receiveInvitation(envelope: Envelope, invitation: AgentInvitation | undefined): Promise<void> {
    if (!invitation || invitation.host.identityId !== this.local.nodeId || invitation.host.agentId !== this.localAgent.agentId || invitation.visitor.identityId !== envelope.sender || !(await verifySigned(this.crypto, invitation, invitation.visitor.identityId)) || this.effectiveInvitationStatus(invitation) !== 'pending') { this.rejectedCount += 1; return; }
    if (this.invitations.has(invitation.id)) { this.rejectedCount += 1; return; }
    this.invitations.set(invitation.id, invitation); this.acceptedCount += 1;
    this.record({ event: 'invitation.received', outcome: 'received', visitor: invitation.visitor, host: invitation.host, capabilities: capabilityLabels(invitation.requestedCapabilities), dataClasses: [], toolIntents: [] });
    await this.persist();
  }

  private async receiveAccept(envelope: Envelope, visit: AgentVisit | undefined, token: AgentDelegationToken | undefined): Promise<void> {
    if (!visit || !token || visit.visitor.identityId !== this.local.nodeId || visit.visitor.agentId !== this.localAgent.agentId || visit.host.identityId !== envelope.sender || token.issuer !== envelope.sender || token.subject !== this.local.nodeId || token.visitId !== visit.id || token.id !== visit.tokenId || !(await verifySigned(this.crypto, visit, visit.host.identityId)) || !(await verifySigned(this.crypto, token, token.issuer)) || !validateVisitAndToken(visit, token, this.now())) { this.rejectedCount += 1; return; }
    if (this.visits.has(visit.id)) { this.rejectedCount += 1; return; }
    this.visits.set(visit.id, visit); this.tokens.set(token.id, token);
    const session: GuestAgentSession = { version: 1, id: randomId(), visitId: visit.id, role: 'visitor', localAgent: this.localAgent, remoteAgent: visit.host, tokenId: token.id, status: 'active', startedAt: visit.createdAt, requestCount: 0 };
    this.sessions.set(session.id, session); const invitation = this.invitations.get(visit.invitationId); if (invitation) this.invitations.set(invitation.id, { ...invitation, status: 'accepted' });
    this.acceptedCount += 1; await this.persist();
  }

  private async receiveRequest(envelope: Envelope, visit: AgentVisit | undefined, token: AgentDelegationToken | undefined, request: VisitMessage['request']): Promise<void> {
    const localVisit = visit ? this.visits.get(visit.id) : undefined;
    if (localVisit?.status === 'revoked') { await this.denyRequest(envelope.sender, visit, request?.requestId, 'VISIT_REVOKED'); return; }
    if (localVisit?.status === 'ended') { await this.denyRequest(envelope.sender, visit, request?.requestId, 'VISIT_ENDED'); return; }
    if (!visit || !token || !request || visit.host.identityId !== this.local.nodeId || visit.host.agentId !== this.localAgent.agentId || visit.visitor.identityId !== envelope.sender || !(await verifySigned(this.crypto, visit, visit.host.identityId)) || !(await verifySigned(this.crypto, token, token.issuer)) || !validateVisitAndToken(visit, token, this.now()) || token.subject !== envelope.sender || !this.sessionsForVisit(visit.id).some(value => value.role === 'host' && value.status === 'active')) { await this.denyRequest(envelope.sender, visit, request?.requestId, 'NOT_AUTHORIZED'); return; }
    const requestId = request.requestId;
    if (!safeId(requestId) || this.seenIds.has(requestId)) { await this.denyRequest(envelope.sender, visit, requestId, 'REPLAY'); return; }
    this.seenIds.add(requestId); trimSet(this.seenIds, 8_192);
    const dataClass = request.dataClass;
    if (!AGENT_VISIT_SAFE_DATA_CLASSES.includes(dataClass as 'PUBLIC' | 'USER_EXPLICIT') || !assertOperationSafe(request.operation, request.toolId) || !hasCapability(visit.capabilities, request.operation, request.toolId, this.now())) { await this.denyRequest(envelope.sender, visit, requestId, 'CAPABILITY_DENIED'); return; }
    const grant = matchingGrant(visit.capabilities, request.operation, request.toolId, this.now());
    if (!grant || !this.canConsumeGrant(visit.id, grant)) { await this.denyRequest(envelope.sender, visit, requestId, grant ? 'CAPABILITY_EXHAUSTED' : 'CAPABILITY_DENIED'); return; }
    const sensitive = request.operation === 'use_specific_tool' || request.operation === 'write_shared_workspace';
    const mode = visit.approvalMode;
    if (mode === 'DENY' || ((mode === 'ASK_EVERY_TIME' || sensitive) && (!this.approval || !await this.approval.approve({ visitId: visit.id, visitor: visit.visitor, operation: request.operation, ...(request.toolId ? { toolId: request.toolId } : {}), requestId, sensitive })))) { await this.denyRequest(envelope.sender, visit, requestId, 'APPROVAL_REQUIRED'); return; }
    if (!this.host) { await this.denyRequest(envelope.sender, visit, requestId, 'NOT_AUTHORIZED'); return; }
    let result: AgentVisitResult | undefined;
    try { result = await this.host.onGuestRequest({ requestId, visit, operation: request.operation, ...(request.toolId ? { toolId: request.toolId } : {}), input: safeClone(request.input), dataClass: dataClass as 'PUBLIC' | 'USER_EXPLICIT', untrusted: true }); } catch { result = undefined; }
    if (!result || !AGENT_VISIT_SAFE_DATA_CLASSES.includes(result.dataClass) || stringify(result.value).length > 64_000 || (result.toolIntents ?? []).some(value => !safeId(value))) { await this.denyRequest(envelope.sender, visit, requestId, 'UNSHAREABLE_DATA'); return; }
    if (!this.consumeGrant(visit.id, grant)) { await this.denyRequest(envelope.sender, visit, requestId, 'CAPABILITY_EXHAUSTED'); return; }
    this.bumpSession(visit.id);
    await this.send(envelope.sender, { kind: 'response', visit, response: { requestId, accepted: true, result: { value: safeClone(result.value), dataClass: result.dataClass, ...(result.toolIntents?.length ? { toolIntents: [...result.toolIntents] } : {}) } } });
    this.record({ event: 'visit.response', outcome: 'sent', visitId: visit.id, requestId, visitor: visit.visitor, host: visit.host, capabilities: capabilityLabels([grant]), dataClasses: [dataClass, result.dataClass], toolIntents: result.toolIntents ?? [] });
    await this.persist();
  }

  private async receiveResponse(envelope: Envelope, visit: AgentVisit | undefined, response: VisitMessage['response']): Promise<void> {
    if (!visit || !response || visit.visitor.identityId !== this.local.nodeId || visit.host.identityId !== envelope.sender || !(await verifySigned(this.crypto, visit, visit.host.identityId)) || !this.visits.has(visit.id)) { this.rejectedCount += 1; return; }
    const pending = this.pending.get(response.requestId); if (!pending || pending.visitId !== visit.id) { this.rejectedCount += 1; return; }
    this.pending.delete(response.requestId); clearTimeout(pending.timer);
    if (!response.accepted || !response.result || !AGENT_VISIT_SAFE_DATA_CLASSES.includes(response.result.dataClass) || stringify(response.result.value).length > 64_000) {
      const code = visit.status === 'revoked' ? 'VISIT_REVOKED' : visit.status === 'ended' ? 'VISIT_ENDED' : response.errorCode ?? 'CAPABILITY_DENIED';
      pending.reject(new AgentVisitError(code, code === 'VISIT_REVOKED' ? 'Visit is revoked' : code === 'VISIT_ENDED' ? 'Visit has ended' : 'Guest request was denied'));
      return;
    }
    this.bumpSession(visit.id); this.acceptedCount += 1; this.record({ event: 'visit.response', outcome: 'received', visitId: visit.id, requestId: response.requestId, visitor: visit.visitor, host: visit.host, capabilities: [], dataClasses: [response.result.dataClass], toolIntents: response.result.toolIntents ?? [] }); await this.persist(); await this.onResult?.(visit.id, response.result); pending.resolve(clone(response.result));
  }

  private async receiveRevocation(envelope: Envelope, visit: AgentVisit | undefined, reason?: string): Promise<void> {
    if (!visit || visit.visitor.identityId !== this.local.nodeId || visit.host.identityId !== envelope.sender || !(await verifySigned(this.crypto, visit, visit.host.identityId)) || !this.visits.has(visit.id)) { this.rejectedCount += 1; return; }
    this.visits.set(visit.id, visit); this.updateSessionStatus(visit.id, 'revoked'); this.rejectPending(visit.id, new AgentVisitError('VISIT_REVOKED', reason ?? 'Visit revoked')); this.record({ event: 'visit.revoked', outcome: 'revoked', visitId: visit.id, visitor: visit.visitor, host: visit.host, capabilities: capabilityLabels(visit.capabilities), dataClasses: [], toolIntents: [] }); await this.persist();
  }

  private async receiveEnd(envelope: Envelope, visit: AgentVisit | undefined, reason?: string): Promise<void> {
    if (!visit || !this.visits.has(visit.id) || (this.local.nodeId !== visit.visitor.identityId && this.local.nodeId !== visit.host.identityId) || !(await verifySigned(this.crypto, visit, visit.host.identityId))) { this.rejectedCount += 1; return; }
    this.visits.set(visit.id, visit); this.updateSessionStatus(visit.id, 'ended'); this.rejectPending(visit.id, new AgentVisitError('VISIT_ENDED', reason ?? 'Visit ended')); await this.persist();
  }

  private async receiveRoom(envelope: Envelope, room: AgentRoom | undefined): Promise<void> {
    if (!room || room.owner.identityId !== envelope.sender || !room.members.some(value => value.agent.identityId === this.local.nodeId && value.agent.agentId === this.localAgent.agentId) || !(await verifySigned(this.crypto, room, room.owner.identityId)) || this.effectiveRoomStatus(room) !== 'active') { this.rejectedCount += 1; return; }
    const previous = this.rooms.get(room.id); if (previous && previous.revision >= room.revision) { this.rejectedCount += 1; return; }
    this.rooms.set(room.id, room); this.acceptedCount += 1; this.record({ event: 'room.received', outcome: 'received', roomId: room.id, visitor: this.localAgent, host: room.owner, capabilities: [], dataClasses: room.sharedContext.map(value => value.dataClass), toolIntents: [] }); await this.persist();
  }

  private async receiveRoomMessage(envelope: Envelope, room: AgentRoom | undefined, message: AgentRoomMessage | undefined): Promise<void> {
    if (!room || !message || message.roomId !== room.id || message.sender.identityId !== envelope.sender || !room.members.some(value => value.agent.identityId === message.sender.identityId && value.agent.agentId === message.sender.agentId) || !room.members.some(value => value.agent.identityId === this.local.nodeId && value.agent.agentId === this.localAgent.agentId) || !(await verifySigned(this.crypto, room, room.owner.identityId)) || !AGENT_VISIT_SAFE_DATA_CLASSES.includes(message.dataClass) || this.effectiveRoomStatus(room) !== 'active') { this.rejectedCount += 1; return; }
    const key = `room-message:${message.id}`; if (this.seenIds.has(key)) { this.rejectedCount += 1; return; } this.seenIds.add(key); trimSet(this.seenIds, 8_192); this.rooms.set(room.id, room); this.acceptedCount += 1; this.record({ event: 'room.message', outcome: 'received', roomId: room.id, visitor: message.sender, host: room.owner, capabilities: [], dataClasses: [message.dataClass], toolIntents: [] }); await this.persist(); await this.onRoomMessage?.(clone(message), clone(room));
  }

  private async denyRequest(peer: NodeId, visit: AgentVisit | undefined, requestId: string | undefined, code: AgentVisitErrorCode): Promise<void> {
    if (!visit || !safeId(requestId ?? '')) { this.rejectedCount += 1; return; }
    const id = requestId as string;
    this.rejectedCount += 1; this.record({ event: 'visit.response', outcome: 'denied', visitId: visit.id, requestId: id, visitor: visit.visitor, host: visit.host, capabilities: [], dataClasses: [], toolIntents: [], errorCode: code });
    try { await this.send(peer, { kind: 'response', visit, response: { requestId: id, accepted: false, errorCode: code } }); } catch { /* peer may already be offline */ }
    await this.persist();
  }

  private async send(peer: NodeId, body: VisitMessage): Promise<void> {
    const unsigned: UnsignedEnvelope = { version: 1, type: AGENT_VISIT_ENVELOPE, id: randomId(), sender: this.local.nodeId, recipient: peer, nonce: await this.crypto.randomNonce(), expiresAt: new Date(this.now() + AGENT_VISIT_MAX_LIFETIME_MS).toISOString(), body };
    if (new TextEncoder().encode(canonicalJson(body)).byteLength > AGENT_VISIT_MAX_OBJECT_BYTES) throw new AgentVisitError('INVALID_ARGUMENT', 'Agent visit message is too large');
    await this.transport.connect(peer); await this.transport.send(peer, { ...unsigned, signature: await this.security.sign(unsigned) });
  }

  private async resignVisit(value: Omit<AgentVisit, 'signature'>): Promise<AgentVisit> { const { signature: _signature, ...unsigned } = value as Omit<AgentVisit, 'signature'> & { signature?: string }; return { ...unsigned, signature: await this.crypto.sign(canonicalJson(unsigned), this.local.privateKey) }; }
  private sessionsForVisit(id: string): GuestAgentSession[] { return [...this.sessions.values()].filter(value => value.visitId === id); }
  private bumpSession(visitId: string): void { for (const [id, session] of this.sessions) if (session.visitId === visitId) this.sessions.set(id, { ...session, requestCount: session.requestCount + 1 }); }
  private updateSessionStatus(visitId: string, status: GuestAgentSession['status']): void { const endedAt = status === 'active' ? undefined : iso(this.now()); for (const [id, session] of this.sessions) if (session.visitId === visitId) this.sessions.set(id, { ...session, status, ...(endedAt ? { endedAt } : {}) }); }
  private rejectPending(visitId: string, error: AgentVisitError): void { for (const [id, pending] of this.pending) if (pending.visitId === visitId) { this.pending.delete(id); clearTimeout(pending.timer); pending.reject(error); } }
  private requireInvitation(id: string): AgentInvitation { const value = this.invitations.get(id); if (!value) throw new AgentVisitError('INVITATION_NOT_FOUND', `Invitation not found: ${id}`); return value; }
  private requireVisit(id: string): AgentVisit { const value = this.visits.get(id); if (!value) throw new AgentVisitError('VISIT_NOT_FOUND', `Visit not found: ${id}`); return value; }
  private requireRoom(id: string): AgentRoom { const value = this.rooms.get(id); if (!value) throw new AgentVisitError('ROOM_NOT_FOUND', `Room not found: ${id}`); return value; }
  private assertVisitUsable(visit: AgentVisit): void { const status = this.effectiveStatus(visit); if (status === 'revoked') throw new AgentVisitError('VISIT_REVOKED', 'Visit is revoked'); if (status === 'expired') throw new AgentVisitError('VISIT_EXPIRED', 'Visit has expired'); if (status === 'ended') throw new AgentVisitError('VISIT_ENDED', 'Visit has ended'); }
  private assertRoomUsable(room: AgentRoom): void { const status = this.effectiveRoomStatus(room); if (status === 'expired') throw new AgentVisitError('VISIT_EXPIRED', 'Room has expired'); if (status === 'ended') throw new AgentVisitError('VISIT_ENDED', 'Room has ended'); if (!room.members.some(value => value.agent.identityId === this.local.nodeId && value.agent.agentId === this.localAgent.agentId)) throw new AgentVisitError('NOT_AUTHORIZED', 'Agent is not a room member'); }
  private effectiveInvitationStatus(value: AgentInvitation): AgentInvitation['status'] { return value.status === 'pending' && Date.parse(value.expiresAt) <= this.now() ? 'expired' : value.status; }
  private effectiveStatus(value: AgentVisit): AgentVisit['status'] { return value.status === 'active' && Date.parse(value.expiresAt) <= this.now() ? 'expired' : value.status; }
  private effectiveRoomStatus(value: AgentRoom): AgentRoom['status'] { return value.status === 'active' && Date.parse(value.expiresAt) <= this.now() ? 'expired' : value.status; }
  private withEffectiveStatus(value: AgentVisit): AgentVisit { const status = this.effectiveStatus(value); return status === value.status ? clone(value) : { ...value, status }; }
  private withEffectiveRoomStatus(value: AgentRoom): AgentRoom { const status = this.effectiveRoomStatus(value); return status === value.status ? clone(value) : { ...value, status }; }
  private record(input: Omit<AgentVisitAuditRecord, 'version' | 'id' | 'at'>): void { this.auditEntries.push({ version: 1, id: randomId(), at: iso(this.now()), ...input }); while (this.auditEntries.length > AGENT_VISIT_MAX_AUDIT) this.auditEntries.shift(); }

  private async hydrate(): Promise<void> {
    const raw = await this.storage.read(); if (raw === undefined) return; const snapshot = parseSnapshot(raw);
    for (const value of snapshot.invitations) this.invitations.set(value.id, value);
    for (const value of snapshot.visits) this.visits.set(value.id, value);
    for (const value of snapshot.tokens) this.tokens.set(value.id, value);
    for (const value of snapshot.sessions) this.sessions.set(value.id, value);
    for (const value of snapshot.rooms) this.rooms.set(value.id, value);
    for (const value of snapshot.seenIds) this.seenIds.add(value);
    for (const value of snapshot.usedGrants) this.usedGrants.set(`${value.visitId}:${value.grantId}`, value.uses);
    this.auditEntries.push(...snapshot.audit);
  }

  private async persist(): Promise<void> {
    const snapshot: AgentVisitSnapshot = { version: 1, invitations: [...this.invitations.values()].map(clone), visits: [...this.visits.values()].map(clone), tokens: [...this.tokens.values()].map(clone), sessions: [...this.sessions.values()].map(clone), rooms: [...this.rooms.values()].map(clone), seenIds: [...this.seenIds].slice(-8_192), usedGrants: [...this.usedGrants.entries()].map(([key, uses]) => { const [visitId, grantId] = key.split(':'); return { visitId: visitId!, grantId: grantId!, uses }; }), audit: this.auditEntries.map(clone) };
    const operation = this.writes.then(() => this.storage.write(snapshot)); this.writes = operation.catch(() => undefined); await operation;
  }

  private canConsumeGrant(visitId: string, grant: AgentCapabilityGrant): boolean { return (this.usedGrants.get(`${visitId}:${grant.grantId}`) ?? 0) < grant.maxUses; }
  private consumeGrant(visitId: string, grant: AgentCapabilityGrant): boolean { if (!this.canConsumeGrant(visitId, grant)) return false; const key = `${visitId}:${grant.grantId}`; this.usedGrants.set(key, (this.usedGrants.get(key) ?? 0) + 1); return true; }
}

function normalizeAgentRef(value: AgentRef): AgentRef { if (!value || !safeId(value.agentId) || !safeId(value.identityId)) throw new AgentVisitError('INVALID_ARGUMENT', 'Invalid agent reference'); return { agentId: value.agentId, identityId: value.identityId }; }
function normalizeCapabilityRequests(values: readonly AgentCapabilityRequest[]): AgentCapabilityRequest[] { if (!Array.isArray(values) || values.length > 16) throw new AgentVisitError('INVALID_ARGUMENT', 'Invalid capability request list'); return values.map(value => { if (!AGENT_CAPABILITIES.includes(value.capability) || (value.toolId !== undefined && !safeId(value.toolId)) || (value.scope !== undefined && value.scope.length > 256)) throw new AgentVisitError('INVALID_ARGUMENT', 'Invalid capability request'); if (value.capability === 'use_specific_tool' && !value.toolId) throw new AgentVisitError('INVALID_ARGUMENT', 'Specific tool capability requires a tool id'); return { capability: value.capability, ...(value.scope ? { scope: value.scope } : {}), ...(value.toolId ? { toolId: value.toolId } : {}) }; }); }
function normalizeCapabilityGrants(values: readonly AgentCapabilityGrant[], invitation: AgentInvitation, now: number): AgentCapabilityGrant[] { const requested = invitation.requestedCapabilities; if (!Array.isArray(values) || values.length > 16) throw new AgentVisitError('INVALID_ARGUMENT', 'Invalid capability grant list'); return values.map(value => { if (!AGENT_CAPABILITIES.includes(value.capability) || !safeId(value.grantId) || !Number.isSafeInteger(value.maxUses) || value.maxUses < 1 || value.maxUses > 10_000 || (value.capability === 'use_specific_tool' && !value.toolId) || (value.toolId !== undefined && !safeId(value.toolId)) || !Number.isFinite(Date.parse(value.issuedAt)) || !Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.expiresAt) <= now || Date.parse(value.expiresAt) > Date.parse(invitation.expiresAt) || !requested.some(request => request.capability === value.capability && request.toolId === value.toolId && request.scope === value.scope)) throw new AgentVisitError('INVALID_ARGUMENT', 'Capability grant exceeds invitation'); return { grantId: value.grantId, capability: value.capability, ...(value.scope ? { scope: value.scope } : {}), ...(value.toolId ? { toolId: value.toolId } : {}), issuedAt: value.issuedAt, expiresAt: value.expiresAt, maxUses: value.maxUses }; }); }
function normalizeSharedContext(values: readonly AgentSharedContext[]): AgentSharedContext[] { if (!Array.isArray(values) || values.length > 64) throw new AgentVisitError('INVALID_ARGUMENT', 'Invalid shared context'); return values.map(value => { if (!value || !safeId(value.id) || typeof value.label !== 'string' || !value.label.trim() || value.label.length > 240 || !AGENT_VISIT_SAFE_DATA_CLASSES.includes(value.dataClass) || stringify(value.value).length > 32_000) throw new AgentVisitError('UNSHAREABLE_DATA', 'Room context must be bounded public/user-explicit data'); return { id: value.id, label: value.label.trim(), value: safeClone(value.value), dataClass: value.dataClass }; }); }
function uniqueRoomMembers(values: readonly AgentRoomMember[]): AgentRoomMember[] { const map = new Map<string, AgentRoomMember>(); for (const value of values) { const member = { agent: normalizeAgentRef(value.agent), role: value.role }; if (member.role !== 'owner' && member.role !== 'member') throw new AgentVisitError('INVALID_ARGUMENT', 'Invalid room member role'); const key = `${member.agent.identityId}:${member.agent.agentId}`; const existing = map.get(key); map.set(key, existing?.role === 'owner' ? existing : member); } const result = [...map.values()]; if (result.filter(value => value.role === 'owner').length !== 1) throw new AgentVisitError('INVALID_ARGUMENT', 'Agent room must have exactly one owner'); return result; }
function assertExpiry(createdAt: string, expiresAt: string, now: number): void { const expiry = Date.parse(expiresAt); const created = Date.parse(createdAt); if (!Number.isFinite(expiry) || !Number.isFinite(created) || expiry <= now || expiry <= created || expiry - now > AGENT_VISIT_MAX_LIFETIME_MS) throw new AgentVisitError('INVALID_ARGUMENT', 'Expiry is outside the visit lifetime'); }
function minExpiry(invitationExpiry: string, expiries: readonly string[], now: number): string { const values = [Date.parse(invitationExpiry), ...expiries.map(value => Date.parse(value))].filter(Number.isFinite); if (!values.length || Math.min(...values) <= now) throw new AgentVisitError('CAPABILITY_EXPIRED', 'Capability expiry is in the past'); return new Date(Math.min(...values)).toISOString(); }
function validEnvelopeExpiry(value: string, now: number): boolean { const expiry = Date.parse(value); return Number.isFinite(expiry) && expiry > now - 1_000 && expiry - now <= AGENT_VISIT_MAX_LIFETIME_MS + 1_000; }
function effectiveTokenExpiry(value: AgentDelegationToken): number { return Math.min(Date.parse(value.expiresAt), ...value.capabilities.map(capability => Date.parse(capability.expiresAt))); }
function validateVisitAndToken(visit: AgentVisit, token: AgentDelegationToken, now: number): boolean { return visit.status === 'active' && token.issuer === visit.host.identityId && token.subject === visit.visitor.identityId && token.visitId === visit.id && token.hostAgentId === visit.host.agentId && token.visitorAgentId === visit.visitor.agentId && Date.parse(visit.expiresAt) > now && effectiveTokenExpiry(token) > now && token.capabilities.every(value => Date.parse(value.expiresAt) > now); }
function requiredCapability(operation: AgentVisitOperation): AgentCapabilityRequest { return operation === 'use_specific_tool' ? { capability: 'use_specific_tool' } : { capability: operation as AgentCapabilityName }; }
function hasCapability(values: readonly AgentCapabilityGrant[], operation: AgentVisitOperation, toolId?: string, now = Date.now()): boolean { return !!matchingGrant(values, operation, toolId, now); }
function matchingGrant(values: readonly AgentCapabilityGrant[], operation: AgentVisitOperation, toolId?: string, now = Date.now()): AgentCapabilityGrant | undefined { if (operation === 'read_private_memory') return undefined; const capability = requiredCapability(operation); return values.find(value => value.capability === capability.capability && (capability.capability !== 'use_specific_tool' || value.toolId === toolId) && Date.parse(value.expiresAt) > now); }
function assertOperation(operation: AgentVisitOperation, toolId?: string): void { if (!AGENT_VISIT_OPERATIONS.includes(operation) || operation === 'read_private_memory' || operation === 'use_specific_tool' && !safeId(toolId ?? '')) throw new AgentVisitError('CAPABILITY_DENIED', 'Operation is not permitted'); }
function assertOperationSafe(operation: AgentVisitOperation, toolId?: string): boolean { try { assertOperation(operation, toolId); return true; } catch { return false; } }
function assertShareableDataClass(value: AIDataClass): asserts value is 'PUBLIC' | 'USER_EXPLICIT' { if (!AGENT_VISIT_SAFE_DATA_CLASSES.includes(value)) throw new AgentVisitError('UNSHAREABLE_DATA', 'Private and secret data cannot cross an agent visit'); }
function capabilityLabels(values: readonly (AgentCapabilityRequest | AgentCapabilityGrant)[]): string[] { return values.map(value => value.capability === 'use_specific_tool' ? `${value.capability}:${value.toolId ?? ''}` : value.capability); }
async function verifySigned(crypto: CryptoProvider, value: { readonly signature: string }, signer: NodeId): Promise<boolean> { try { const { signature: _signature, ...unsigned } = value as Record<string, unknown>; return !!value.signature && await crypto.verify(canonicalJson(unsigned), value.signature, signer); } catch { return false; } }
function parseMessage(value: unknown): VisitMessage | undefined { if (!value || typeof value !== 'object') return undefined; const candidate = value as VisitMessage; if (!['invitation', 'accept', 'request', 'response', 'revoke', 'end', 'room', 'room_message'].includes(candidate.kind)) return undefined; return candidate; }
function parseSnapshot(value: unknown): AgentVisitSnapshot { if (!value || typeof value !== 'object' || (value as { version?: unknown }).version !== 1) throw new AgentVisitError('INVALID_STATE', 'Invalid agent visit state version'); const candidate = value as Partial<AgentVisitSnapshot>; if (!Array.isArray(candidate.invitations) || !Array.isArray(candidate.visits) || !Array.isArray(candidate.tokens) || !Array.isArray(candidate.sessions) || !Array.isArray(candidate.rooms) || !Array.isArray(candidate.seenIds) || !Array.isArray(candidate.usedGrants) || !Array.isArray(candidate.audit)) throw new AgentVisitError('INVALID_STATE', 'Invalid agent visit state shape'); return { version: 1, invitations: candidate.invitations.map(parseInvitation), visits: candidate.visits.map(parseVisit), tokens: candidate.tokens.map(parseToken), sessions: candidate.sessions.map(parseSession), rooms: candidate.rooms.map(parseRoom), seenIds: candidate.seenIds.filter(safeId).slice(-8_192), usedGrants: candidate.usedGrants.filter(value => !!value && safeId(value.visitId) && safeId(value.grantId) && Number.isSafeInteger(value.uses) && value.uses >= 0).map(value => ({ visitId: value.visitId, grantId: value.grantId, uses: value.uses })), audit: candidate.audit.map(parseAudit).slice(-AGENT_VISIT_MAX_AUDIT) }; }
function parseInvitation(value: unknown): AgentInvitation { if (!value || typeof value !== 'object') throw new AgentVisitError('INVALID_STATE', 'Invalid invitation'); const candidate = value as AgentInvitation; if (candidate.version !== 1 || !safeId(candidate.id) || !normalizeAgentRefSafe(candidate.visitor) || !normalizeAgentRefSafe(candidate.host) || !Array.isArray(candidate.requestedCapabilities) || !Number.isFinite(Date.parse(candidate.createdAt)) || !Number.isFinite(Date.parse(candidate.expiresAt)) || !['pending', 'accepted', 'declined', 'expired', 'revoked'].includes(candidate.status) || typeof candidate.signature !== 'string') throw new AgentVisitError('INVALID_STATE', 'Invalid invitation'); normalizeCapabilityRequests(candidate.requestedCapabilities); return clone(candidate); }
function parseToken(value: unknown): AgentDelegationToken { if (!value || typeof value !== 'object') throw new AgentVisitError('INVALID_STATE', 'Invalid delegation token'); const candidate = value as AgentDelegationToken; if (candidate.version !== 1 || !safeId(candidate.id) || !safeId(candidate.visitId) || !safeId(candidate.issuer) || !safeId(candidate.subject) || !safeId(candidate.hostAgentId) || !safeId(candidate.visitorAgentId) || !Array.isArray(candidate.capabilities) || !Number.isFinite(Date.parse(candidate.issuedAt)) || !Number.isFinite(Date.parse(candidate.expiresAt)) || typeof candidate.signature !== 'string') throw new AgentVisitError('INVALID_STATE', 'Invalid delegation token'); return clone(candidate); }
function parseVisit(value: unknown): AgentVisit { if (!value || typeof value !== 'object') throw new AgentVisitError('INVALID_STATE', 'Invalid visit'); const candidate = value as AgentVisit; if (candidate.version !== 1 || !safeId(candidate.id) || !safeId(candidate.invitationId) || !normalizeAgentRefSafe(candidate.visitor) || !normalizeAgentRefSafe(candidate.host) || !Array.isArray(candidate.capabilities) || !AGENT_APPROVAL_MODES.includes(candidate.approvalMode) || !safeId(candidate.tokenId) || !Number.isFinite(Date.parse(candidate.createdAt)) || !Number.isFinite(Date.parse(candidate.expiresAt)) || !['active', 'revoked', 'ended', 'expired'].includes(candidate.status) || !Number.isSafeInteger(candidate.revision) || candidate.revision < 1 || typeof candidate.signature !== 'string') throw new AgentVisitError('INVALID_STATE', 'Invalid visit'); return clone(candidate); }
function parseSession(value: unknown): GuestAgentSession { if (!value || typeof value !== 'object') throw new AgentVisitError('INVALID_STATE', 'Invalid guest session'); const candidate = value as GuestAgentSession; if (candidate.version !== 1 || !safeId(candidate.id) || !safeId(candidate.visitId) || !['visitor', 'host'].includes(candidate.role) || !normalizeAgentRefSafe(candidate.localAgent) || !normalizeAgentRefSafe(candidate.remoteAgent) || candidate.tokenId !== undefined && !safeId(candidate.tokenId) || !['active', 'revoked', 'ended', 'expired'].includes(candidate.status) || !Number.isFinite(Date.parse(candidate.startedAt)) || !Number.isSafeInteger(candidate.requestCount) || candidate.requestCount < 0) throw new AgentVisitError('INVALID_STATE', 'Invalid guest session'); return clone(candidate); }
function parseRoom(value: unknown): AgentRoom { if (!value || typeof value !== 'object') throw new AgentVisitError('INVALID_STATE', 'Invalid agent room'); const candidate = value as AgentRoom; if (candidate.version !== 1 || !safeId(candidate.id) || typeof candidate.title !== 'string' || !normalizeAgentRefSafe(candidate.owner) || !Array.isArray(candidate.members) || !Array.isArray(candidate.sharedContext) || !Number.isFinite(Date.parse(candidate.createdAt)) || !Number.isFinite(Date.parse(candidate.expiresAt)) || !['active', 'ended', 'expired'].includes(candidate.status) || !Number.isSafeInteger(candidate.revision) || typeof candidate.signature !== 'string') throw new AgentVisitError('INVALID_STATE', 'Invalid agent room'); uniqueRoomMembers(candidate.members); normalizeSharedContext(candidate.sharedContext); return clone(candidate); }
function parseAudit(value: unknown): AgentVisitAuditRecord { if (!value || typeof value !== 'object') throw new AgentVisitError('INVALID_STATE', 'Invalid agent audit'); const candidate = value as AgentVisitAuditRecord; if (candidate.version !== 1 || !safeId(candidate.id) || !Number.isFinite(Date.parse(candidate.at)) || !candidate.event || !candidate.outcome || !Array.isArray(candidate.capabilities) || !Array.isArray(candidate.dataClasses) || !Array.isArray(candidate.toolIntents) || !normalizeAgentRefSafe(candidate.visitor) || !normalizeAgentRefSafe(candidate.host)) throw new AgentVisitError('INVALID_STATE', 'Invalid agent audit'); return clone(candidate); }
function normalizeAgentRefSafe(value: unknown): value is AgentRef { try { normalizeAgentRef(value as AgentRef); return true; } catch { return false; } }
function iso(now: number): string { return new Date(now).toISOString(); }
function assertId(value: string): string { if (!safeId(value)) throw new AgentVisitError('INVALID_ARGUMENT', 'Invalid id'); return value; }
// Identity IDs are URL-safe base64 public keys and may begin with '-' or '_'.
// Keep the bounded identifier grammar while accepting those canonical keys.
function safeId(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9_-][A-Za-z0-9._:-]{0,127}$/.test(value); }
function randomId(): string { return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function safeClone<T>(value: T): T { try { return structuredClone(value); } catch { return String(value) as T; } }
function clone<T>(value: T): T { return structuredClone(value); }
function stringify(value: unknown): string { try { return JSON.stringify(value) ?? String(value); } catch { return '[unserializable]'; } }
function trimSet(values: Set<string>, max: number): void { while (values.size > max) values.delete(values.values().next().value as string); }
