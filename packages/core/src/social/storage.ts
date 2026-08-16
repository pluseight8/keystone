import type { NodeId } from '../types.js';
import type { FollowObject, MessageObject, ProfileObject } from './object-model.js';
import type { DirectConversation, PendingEnvelope, SocialStorage } from './messaging.js';

/** An encrypted, atomic blob supplied by a native host. Core never chooses key storage. */
export interface EncryptedSocialStateStore { read(): Promise<unknown | undefined>; write(value: unknown): Promise<void>; }
export type SocialStorageChange = { kind: 'conversation' | 'message' | 'outbox' | 'policy' | 'acknowledgement'; conversationId?: string };
export interface LocalRelationship { target: NodeId; blocked: boolean; muted: boolean; trust: 'unknown' | 'trusted'; updatedAt: string; }
export interface SocialGraphStorage { saveProfile(value: ProfileObject): Promise<boolean>; getProfile(identity: NodeId): Promise<ProfileObject | undefined>; saveFollow(value: FollowObject): Promise<boolean>; follows(actor: NodeId): Promise<readonly FollowObject[]>; followers(target: NodeId): Promise<readonly FollowObject[]>; getLocalRelationship(target: NodeId): Promise<LocalRelationship | undefined>; saveLocalRelationship(value: LocalRelationship): Promise<void>; }
type State = { version: 2; conversations: Record<string, DirectConversation>; messages: Record<string, MessageObject>; outbox: Record<string, PendingEnvelope>; nonces: Record<string, true>; blocked: Record<string, true>; clocks: Record<string, number>; acknowledgements: Record<string, boolean>; seenObjects: Record<string, true>; profiles: Record<string, ProfileObject>; follows: Record<string, FollowObject>; localRelationships: Record<string, LocalRelationship>; };
const empty = (): State => ({ version: 2, conversations: {}, messages: {}, outbox: {}, nonces: {}, blocked: {}, clocks: {}, acknowledgements: {}, seenObjects: {}, profiles: {}, follows: {}, localRelationships: {} });

/** Durable social storage with explicit schema version; wrap its backend in authenticated encryption in every host. */
export class PersistentSocialStorage implements SocialStorage, SocialGraphStorage {
  private state?: State; private loading?: Promise<State>; private writes: Promise<void> = Promise.resolve(); private readonly listeners = new Set<(change: SocialStorageChange) => void>();
  constructor(private readonly backend: EncryptedSocialStateStore) {}
  subscribe(listener: (change: SocialStorageChange) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  async getConversation(id: string) { return copy((await this.load()).conversations[id]); }
  async listConversations() { return Object.values((await this.load()).conversations).sort((a, b) => (b.lastMessageAt ?? b.createdAt).localeCompare(a.lastMessageAt ?? a.createdAt)).map(copy).filter((value): value is DirectConversation => !!value); }
  async saveConversation(value: DirectConversation) { const state = await this.load(); state.conversations[value.id] = copy(value)!; await this.commit(state, { kind: 'conversation', conversationId: value.id }); }
  async upsertMessage(value: MessageObject) { const state = await this.load(); if (state.messages[value.id]) return false; state.messages[value.id] = copy(value)!; await this.commit(state, { kind: 'message', conversationId: value.payload.conversationId }); return true; }
  async getMessage(id: string) { return copy((await this.load()).messages[id]); }
  async messages(conversationId: string) { return Object.values((await this.load()).messages).filter(value => value.payload.conversationId === conversationId).sort(compareMessages).map(copy).filter((value): value is MessageObject => !!value); }
  async nextLogicalClock(conversationId: string) { const state = await this.load(); const next = (state.clocks[conversationId] ?? 0) + 1; state.clocks[conversationId] = next; await this.commit(state, { kind: 'message', conversationId }); return next; }
  async enqueue(value: PendingEnvelope) { const state = await this.load(); state.outbox[value.id] = copy(value)!; await this.commit(state, { kind: 'outbox' }); }
  async pending(peer?: NodeId) { return Object.values((await this.load()).outbox).filter(value => !peer || value.peer === peer).map(copy).filter((value): value is PendingEnvelope => !!value); }
  async replacePending(value: PendingEnvelope) { const state = await this.load(); state.outbox[value.id] = copy(value)!; await this.commit(state, { kind: 'outbox' }); }
  async removePending(id: string) { const state = await this.load(); if (!state.outbox[id]) return; delete state.outbox[id]; await this.commit(state, { kind: 'outbox' }); }
  async hasSeen(nonce: string) { return !!(await this.load()).nonces[nonce]; }
  async markSeen(nonce: string) { const state = await this.load(); state.nonces[nonce] = true; await this.commit(state, { kind: 'policy' }); }
  async isBlocked(peer: NodeId) { return !!(await this.load()).blocked[peer]; }
  async setBlocked(peer: NodeId, blocked: boolean) { const state = await this.load(); if (blocked) state.blocked[peer] = true; else delete state.blocked[peer]; await this.commit(state, { kind: 'policy' }); }
  async acknowledge(messageId: string, read: boolean) { const state = await this.load(); state.acknowledgements[messageId] = read; await this.commit(state, { kind: 'acknowledgement' }); }
  async deliveryState(messageId: string) { const state = await this.load(); const value = state.acknowledgements[messageId]; return value === undefined ? (state.messages[messageId] ? 'pending' : undefined) : value ? 'read' : 'delivered'; }
  async hasSeenObject(id: string) { return !!(await this.load()).seenObjects[id]; }
  async markSeenObject(id: string) { const state = await this.load(); state.seenObjects[id] = true; await this.commit(state, { kind: 'policy' }); }
  async saveProfile(value: ProfileObject) { const state = await this.load(); const current = state.profiles[value.author]; if (current && compareRevision(current, value) >= 0) return false; state.profiles[value.author] = copy(value)!; await this.commit(state, { kind: 'policy' }); return true; }
  async getProfile(identity: NodeId) { return copy((await this.load()).profiles[identity]); }
  async saveFollow(value: FollowObject) { const state = await this.load(); if (state.follows[value.id]) return false; state.follows[value.id] = copy(value)!; await this.commit(state, { kind: 'policy' }); return true; }
  async follows(actor: NodeId) { return Object.values((await this.load()).follows).filter(value => value.author === actor).sort(compareRevision).map(copy).filter((value): value is FollowObject => !!value); }
  async followers(target: NodeId) { return Object.values((await this.load()).follows).filter(value => value.payload.target === target).sort(compareRevision).map(copy).filter((value): value is FollowObject => !!value); }
  async getLocalRelationship(target: NodeId) { return copy((await this.load()).localRelationships[target]); }
  async saveLocalRelationship(value: LocalRelationship) { const state = await this.load(); state.localRelationships[value.target] = copy(value)!; await this.commit(state, { kind: 'policy' }); }
  private async load(): Promise<State> {
    if (this.state) return this.state;
    this.loading ??= this.backend.read().then(parsed => {
      this.state = parseState(parsed); return this.state;
    });
    return this.loading;
  }
  private async commit(state: State, change: SocialStorageChange): Promise<void> {
    const snapshot = structuredClone(state);
    const operation = this.writes.then(() => this.backend.write(snapshot));
    this.writes = operation.catch(() => undefined);
    await operation; this.state = state; this.listeners.forEach(listener => listener(change));
  }
}

export class InMemoryEncryptedSocialStateStore implements EncryptedSocialStateStore { private value?: unknown; async read() { return copy(this.value); } async write(value: unknown) { this.value = copy(value); } }
function parseState(value: unknown): State { if (!value) return empty(); if (!value || typeof value !== 'object') throw new Error('Invalid persistent social state'); const candidate = value as { version?: number } & Partial<Omit<State, 'version'>>; if (!candidate.conversations || !candidate.messages || !candidate.outbox || !candidate.nonces || !candidate.blocked || !candidate.clocks || !candidate.acknowledgements) throw new Error('Unsupported persistent social state'); if (candidate.version === 1) return { ...structuredClone(candidate), version: 2, seenObjects: {}, profiles: {}, follows: {}, localRelationships: {} } as State; if (candidate.version !== 2 || !candidate.profiles || !candidate.follows || !candidate.localRelationships) throw new Error('Unsupported persistent social state'); return { ...structuredClone(candidate as State), seenObjects: candidate.seenObjects ?? {} }; }
function compareMessages(a: MessageObject, b: MessageObject): number { return a.payload.logicalClock - b.payload.logicalClock || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id); }
function compareRevision(a: { createdAt: string; id: string }, b: { createdAt: string; id: string }): number { return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id); }
function copy<T>(value: T | undefined): T | undefined { return value === undefined ? undefined : structuredClone(value); }
