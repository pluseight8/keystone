/**
 * Agent-only relationships. This graph is deliberately independent from the
 * human SocialGraph: following a person never grants trust to that person's
 * agents, and local mute/block decisions never become public human events.
 */
import { canonicalJson, type CryptoProvider } from '../crypto.js';
import type { DeviceSessionKeys } from '../identity.js';
import type { NodeId } from '../types.js';
import { AgentMailbox, type AgentMailboxStateStore } from './agent-social.js';
import { AgentProfileService, type AgentProfile } from './agent-profiles.js';
import type { AgentRef } from './visits.js';

export const AGENT_RELATIONSHIP_VERSION = 1 as const;
export const AGENT_RELATIONSHIP_ACTIONS = ['known', 'add_contact', 'remove_contact', 'trust', 'untrust', 'mute', 'unmute', 'block', 'unblock', 'interaction'] as const;
export type AgentRelationshipAction = (typeof AGENT_RELATIONSHIP_ACTIONS)[number];
export const AGENT_INTERACTION_KINDS = ['profile', 'room', 'visit', 'task', 'negotiation'] as const;
export type AgentInteractionKind = (typeof AGENT_INTERACTION_KINDS)[number];

export interface AgentInteractionReference {
  readonly kind: AgentInteractionKind;
  readonly id: string;
  readonly at: string;
}

export interface AgentRelationshipEvent {
  readonly version: 1;
  readonly id: string;
  readonly actor: AgentRef;
  readonly ownerIdentityId: NodeId;
  readonly target: AgentRef;
  readonly action: AgentRelationshipAction;
  readonly interaction?: AgentInteractionReference;
  readonly createdAt: string;
  readonly signature: string;
}

export interface AgentRelationship {
  readonly version: 1;
  readonly agent: AgentRef;
  readonly known: boolean;
  readonly contact: boolean;
  /** Local trust only. A human follow or a remote trust event cannot set it. */
  readonly trusted: boolean;
  readonly trustedByPeer: boolean;
  readonly muted: boolean;
  readonly blocked: boolean;
  readonly revoked: boolean;
  readonly interactions: readonly AgentInteractionReference[];
  readonly updatedAt: string;
  readonly lastEventId?: string;
}

export interface AgentSocialGraphSnapshot {
  readonly version: 1;
  readonly relationships: readonly AgentRelationship[];
  readonly events: readonly AgentRelationshipEvent[];
  readonly seenIds: readonly string[];
}

export interface AgentSocialGraphServiceOptions {
  readonly mailbox: AgentMailbox;
  readonly crypto: CryptoProvider;
  readonly local: DeviceSessionKeys;
  readonly storage?: AgentMailboxStateStore;
  readonly profiles?: AgentProfileService;
  readonly now?: () => number;
}

export class AgentSocialGraphError extends Error {
  constructor(readonly code: 'INVALID_ARGUMENT' | 'INVALID_SIGNATURE' | 'INVALID_STATE' | 'UNAUTHORIZED' | 'DUPLICATE' | 'REPLAY' | 'NOT_FOUND' | 'POLICY_DENIED', message: string) { super(message); this.name = 'AgentSocialGraphError'; }
}

export class AgentSocialGraphService {
  private readonly mailbox: AgentMailbox;
  private readonly crypto: CryptoProvider;
  private readonly local: DeviceSessionKeys;
  private readonly storage: AgentMailboxStateStore;
  private readonly profiles?: AgentProfileService;
  private readonly now: () => number;
  private readonly relationships = new Map<string, AgentRelationship>();
  private readonly events = new Map<string, AgentRelationshipEvent>();
  private readonly seenIds = new Set<string>();
  private readonly unsubscribe: () => void;
  private readonly profileUnsubscribe?: () => void;
  private readonly readyPromise: Promise<void>;
  private writes: Promise<void> = Promise.resolve();

  constructor(options: AgentSocialGraphServiceOptions) {
    this.mailbox = options.mailbox; this.crypto = options.crypto; this.local = options.local; this.storage = options.storage ?? new InMemoryAgentSocialGraphStateStore(); this.profiles = options.profiles; this.now = options.now ?? Date.now;
    this.unsubscribe = this.mailbox.onAgentRelationshipMessage((peer, payload) => this.receive(peer, payload));
    this.profileUnsubscribe = this.profiles?.subscribe(event => { void this.noteProfile(event.profile); });
    this.readyPromise = this.hydrate();
  }

  async ready(): Promise<void> { await this.readyPromise; }
  close(): void { this.unsubscribe(); this.profileUnsubscribe?.(); }
  async snapshot(): Promise<AgentSocialGraphSnapshot> { await this.ready(); return { version: 1, relationships: [...this.relationships.values()].map(clone), events: [...this.events.values()].map(clone), seenIds: [...this.seenIds].slice(-16_384) }; }
  list(): readonly AgentRelationship[] { return [...this.relationships.values()].map(clone).sort((a, b) => a.agent.agentId.localeCompare(b.agent.agentId) || a.agent.identityId.localeCompare(b.agent.identityId)); }
  contacts(): readonly AgentRelationship[] { return this.list().filter(value => value.contact && !value.blocked && !value.revoked); }
  trustedAgents(): readonly AgentRelationship[] { return this.list().filter(value => value.trusted && !value.blocked && !value.revoked); }
  knownAgents(): readonly AgentRelationship[] { return this.list().filter(value => value.known && !value.blocked && !value.revoked); }
  get(agent: AgentRef): AgentRelationship | undefined { const value = this.relationships.get(key(agent)); return value ? clone(value) : undefined; }
  isTrusted(agent: AgentRef): boolean { return this.relationships.get(key(agent))?.trusted === true; }
  isBlocked(agent: AgentRef): boolean { return this.relationships.get(key(agent))?.blocked === true; }
  isMuted(agent: AgentRef): boolean { return this.relationships.get(key(agent))?.muted === true; }
  isRevoked(agent: AgentRef): boolean { return this.relationships.get(key(agent))?.revoked === true; }

  async noteProfile(profile: AgentProfile): Promise<AgentRelationship> {
    await this.ready(); const agent = { agentId: profile.agentId, identityId: profile.ownerIdentityId }; const current = this.relationships.get(key(agent)); const next = { ...(current ?? emptyRelationship(agent, this.now())), known: profile.status === 'active', revoked: profile.status === 'revoked', updatedAt: iso(this.now()) }; this.relationships.set(key(agent), next); await this.persist(); return clone(next);
  }

  async addContact(agent: AgentRef, notify = true): Promise<AgentRelationship> { return this.mutate(agent, 'add_contact', notify); }
  async removeContact(agent: AgentRef, notify = true): Promise<AgentRelationship> { return this.mutate(agent, 'remove_contact', notify); }
  async setTrusted(agent: AgentRef, trusted: boolean, notify = true): Promise<AgentRelationship> { return this.mutate(agent, trusted ? 'trust' : 'untrust', notify); }
  async setMuted(agent: AgentRef, muted: boolean, notify = false): Promise<AgentRelationship> { return this.mutate(agent, muted ? 'mute' : 'unmute', notify); }
  async setBlocked(agent: AgentRef, blocked: boolean, notify = false): Promise<AgentRelationship> { return this.mutate(agent, blocked ? 'block' : 'unblock', notify); }
  async recordInteraction(agent: AgentRef, kind: AgentInteractionKind, id: string, notify = false): Promise<AgentRelationship> { if (!AGENT_INTERACTION_KINDS.includes(kind) || !safeId(id)) throw new AgentSocialGraphError('INVALID_ARGUMENT', 'Invalid agent interaction reference'); return this.mutate(agent, 'interaction', notify, { kind, id, at: iso(this.now()) }); }

  async ingest(value: unknown, peer?: NodeId): Promise<AgentRelationshipEvent> {
    await this.ready(); const event = parseEvent(value); const sender = peer ?? event.ownerIdentityId; if (event.ownerIdentityId !== sender || event.actor.identityId !== sender) throw new AgentSocialGraphError('UNAUTHORIZED', 'Agent relationship owner binding failed'); const contact = this.mailbox.contactsList().find(item => item.agent.identityId === sender); const publicKey = sender === this.local.nodeId ? this.local.publicKey : contact?.signingPublicKey; if (!publicKey || !await this.crypto.verify(canonicalJson(stripSignature(event)), event.signature, publicKey)) throw new AgentSocialGraphError('INVALID_SIGNATURE', 'Agent relationship signature is invalid'); if (this.seenIds.has(event.id)) throw new AgentSocialGraphError('REPLAY', 'Agent relationship event replay'); this.seenIds.add(event.id); this.events.set(event.id, event); const targetKey = key(event.target); const current = this.relationships.get(targetKey) ?? emptyRelationship(event.target, this.now()); const next = applyRemoteEvent(current, event, event.target.identityId === this.local.nodeId); this.relationships.set(targetKey, next); await this.persist(); return clone(event); }

  private async receive(peer: NodeId, payload: unknown): Promise<void> { try { await this.ingest(payload, peer); } catch (error) { if (error instanceof AgentSocialGraphError && error.code === 'REPLAY') return; throw error; } }
  private async mutate(agentInput: AgentRef, action: AgentRelationshipAction, notify: boolean, interaction?: AgentInteractionReference): Promise<AgentRelationship> {
    await this.ready(); const agent = normalizeAgent(agentInput); if (agent.identityId === this.local.nodeId) throw new AgentSocialGraphError('INVALID_ARGUMENT', 'An agent cannot relate to itself'); const current = this.relationships.get(key(agent)) ?? emptyRelationship(agent, this.now()); const next = applyLocalAction(current, action, interaction, this.now()); const eventUnsigned = { version: 1 as const, id: randomId(), actor: this.mailbox.localAgentRef, ownerIdentityId: this.local.nodeId, target: agent, action, ...(interaction ? { interaction } : {}), createdAt: iso(this.now()) }; const event: AgentRelationshipEvent = { ...eventUnsigned, signature: await this.crypto.sign(canonicalJson(eventUnsigned), this.local.privateKey) }; this.events.set(event.id, event); this.seenIds.add(event.id); this.relationships.set(key(agent), { ...next, lastEventId: event.id }); await this.persist(); if (notify && this.mailbox.contactsList().some(contact => contact.agent.identityId === agent.identityId)) { await this.mailbox.sendAgentRelationship(agent.identityId, event); } return clone(this.relationships.get(key(agent))!);
  }
  private async hydrate(): Promise<void> { const raw = await this.storage.read(); if (!raw) return; const value = parseSnapshot(raw); value.relationships.forEach(item => this.relationships.set(key(item.agent), item)); value.events.forEach(item => this.events.set(item.id, item)); value.seenIds.forEach(item => this.seenIds.add(item)); }
  private async persist(): Promise<void> { const operation = this.writes.then(async () => this.storage.write(await this.snapshot())); this.writes = operation.catch(() => undefined); await operation; }
}

export class InMemoryAgentSocialGraphStateStore implements AgentMailboxStateStore { private value?: unknown; async read(): Promise<unknown | undefined> { return this.value === undefined ? undefined : structuredClone(this.value); } async write(value: unknown): Promise<void> { this.value = structuredClone(value); } }

function emptyRelationship(agent: AgentRef, now: number): AgentRelationship { return { version: 1, agent: normalizeAgent(agent), known: false, contact: false, trusted: false, trustedByPeer: false, muted: false, blocked: false, revoked: false, interactions: [], updatedAt: iso(now) }; }
function applyLocalAction(current: AgentRelationship, action: AgentRelationshipAction, interaction: AgentInteractionReference | undefined, now: number): AgentRelationship { const next = { ...current, updatedAt: iso(now) }; if (action === 'known') next.known = true; if (action === 'add_contact') { next.known = true; next.contact = true; } if (action === 'remove_contact') next.contact = false; if (action === 'trust') { next.known = true; next.trusted = true; } if (action === 'untrust') next.trusted = false; if (action === 'mute') next.muted = true; if (action === 'unmute') next.muted = false; if (action === 'block') { next.blocked = true; next.contact = false; } if (action === 'unblock') next.blocked = false; if (action === 'interaction' && interaction) next.interactions = [...next.interactions, interaction].slice(-128); return next; }
function applyRemoteEvent(current: AgentRelationship, event: AgentRelationshipEvent, targetsLocal: boolean): AgentRelationship { const next = { ...current, known: true, updatedAt: event.createdAt, lastEventId: event.id }; if (event.action === 'add_contact') next.contact = true; if (event.action === 'remove_contact' && targetsLocal) next.contact = false; if (event.action === 'trust') next.trustedByPeer = true; if (event.action === 'untrust') next.trustedByPeer = false; if (event.action === 'mute' && targetsLocal) next.muted = true; if (event.action === 'unmute' && targetsLocal) next.muted = false; if (event.action === 'block' && targetsLocal) next.blocked = true; if (event.action === 'unblock' && targetsLocal) next.blocked = false; if (event.action === 'interaction' && event.interaction) next.interactions = [...next.interactions, event.interaction].slice(-128); return next; }
function parseSnapshot(raw: unknown): AgentSocialGraphSnapshot { if (!raw) return { version: 1, relationships: [], events: [], seenIds: [] }; if (!raw || typeof raw !== 'object' || (raw as { version?: unknown }).version !== 1 || !Array.isArray((raw as { relationships?: unknown }).relationships) || !Array.isArray((raw as { events?: unknown }).events) || !Array.isArray((raw as { seenIds?: unknown }).seenIds)) throw new AgentSocialGraphError('INVALID_STATE', 'Invalid Agent Social Graph state'); const value = raw as AgentSocialGraphSnapshot; value.relationships.forEach(validateRelationship); value.events.forEach(parseEvent); return { version: 1, relationships: value.relationships.map(clone), events: value.events.map(clone), seenIds: value.seenIds.filter(item => typeof item === 'string').slice(-16_384) }; }
function parseEvent(value: unknown): AgentRelationshipEvent { if (!value || typeof value !== 'object') throw new AgentSocialGraphError('INVALID_STATE', 'Invalid agent relationship event'); const event = value as AgentRelationshipEvent; if (event.version !== 1 || !safeId(event.id) || !normalizeAgent(event.actor) || !event.ownerIdentityId || !normalizeAgent(event.target) || !AGENT_RELATIONSHIP_ACTIONS.includes(event.action) || !Number.isFinite(Date.parse(event.createdAt)) || typeof event.signature !== 'string' || event.action === 'interaction' && (!event.interaction || !AGENT_INTERACTION_KINDS.includes(event.interaction.kind) || !safeId(event.interaction.id) || !Number.isFinite(Date.parse(event.interaction.at)))) throw new AgentSocialGraphError('INVALID_STATE', 'Invalid agent relationship event'); return clone(event); }
function validateRelationship(value: AgentRelationship): void { if (!value || value.version !== 1 || !normalizeAgent(value.agent) || typeof value.known !== 'boolean' || typeof value.contact !== 'boolean' || typeof value.trusted !== 'boolean' || typeof value.trustedByPeer !== 'boolean' || typeof value.muted !== 'boolean' || typeof value.blocked !== 'boolean' || typeof value.revoked !== 'boolean' || !Array.isArray(value.interactions) || value.interactions.length > 128 || !Number.isFinite(Date.parse(value.updatedAt))) throw new AgentSocialGraphError('INVALID_STATE', 'Invalid agent relationship'); }
function normalizeAgent(value: AgentRef): AgentRef { if (!value || !safeId(value.agentId) || !value.identityId) throw new AgentSocialGraphError('INVALID_ARGUMENT', 'Invalid agent reference'); return { agentId: value.agentId, identityId: value.identityId }; }
function safeId(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value); }
function key(agent: AgentRef): string { return `${agent.identityId}:${agent.agentId}`; }
function iso(value: number): string { return new Date(value).toISOString(); }
function randomId(): string { return `${globalThis.crypto.randomUUID()}`; }
function clone<T>(value: T): T { return structuredClone(value); }
function stripSignature<T extends { readonly signature: string }>(value: T): Omit<T, 'signature'> { const { signature: _signature, ...unsigned } = value; return unsigned; }
