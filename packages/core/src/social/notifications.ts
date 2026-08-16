import { canonicalJson, type CryptoProvider } from '../crypto.js';
import type { NodeId } from '../types.js';
import { keystoneObjectSchema, type KeystoneObject, type KeystoneObjectType } from './object-model.js';

export type NotificationCategory = 'dm' | 'reply' | 'reaction' | 'follow' | 'community_invite' | 'community_mention' | 'track' | 'video' | 'short' | 'live' | 'comment';
export type NotificationReference = { id: string; type: KeystoneObjectType };
export interface NotificationRecord {
  id: string;
  category: NotificationCategory;
  objectId: string;
  objectType: KeystoneObjectType;
  actor: NodeId;
  communityId?: string;
  createdAt: string;
  read: boolean;
  title: string;
  preview?: string;
  references: readonly NotificationReference[];
}
export interface NotificationSettings {
  mutedCategories: readonly NotificationCategory[];
  mutedUsers: readonly NodeId[];
  mutedCommunities: readonly string[];
}
export interface NotificationState { version: 1; notifications: Record<string, NotificationRecord>; settings: NotificationSettings; }
export interface NotificationStateBackend { read(): Promise<unknown | undefined>; write(value: unknown): Promise<void>; }
export interface NotificationPolicy {
  canNotify?(object: KeystoneObject, category: NotificationCategory): boolean | Promise<boolean>;
  isBlocked?(actor: NodeId): boolean | Promise<boolean>;
}
/** Optional native boundary for a future OS push adapter. Core never requires Firebase/APNs. */
export interface NotificationDeliveryAdapter { deliver(notification: NotificationRecord): Promise<void>; }

export class PersistentNotificationStorage {
  private state?: NotificationState;
  private writes: Promise<void> = Promise.resolve();
  constructor(private readonly backend: NotificationStateBackend) {}
  async read(): Promise<NotificationState> { if (this.state) return structuredClone(this.state); this.state = parseState(await this.backend.read()); return structuredClone(this.state); }
  async write(value: NotificationState): Promise<void> { const snapshot = structuredClone(value); const operation = this.writes.then(() => this.backend.write(snapshot)); this.writes = operation.catch(() => undefined); await operation; this.state = snapshot; }
}
export class InMemoryNotificationStateStore implements NotificationStateBackend { private value?: unknown; async read() { return structuredClone(this.value); } async write(value: unknown) { this.value = structuredClone(value); } }

export interface NotificationServiceOptions {
  maxHistory?: number;
  now?: () => number;
  policy?: NotificationPolicy;
  delivery?: NotificationDeliveryAdapter;
  localHandles?: readonly string[];
}

/** Local-only notification projection over already authenticated Keystone objects. */
export class NotificationService {
  private readonly maxHistory: number;
  private readonly now: () => number;
  private readonly policy?: NotificationPolicy;
  private readonly delivery?: NotificationDeliveryAdapter;
  private readonly notifications = new Map<string, NotificationRecord>();
  private readonly mutedCategories = new Set<NotificationCategory>();
  private readonly mutedUsers = new Set<NodeId>();
  private readonly mutedCommunities = new Set<string>();
  private readonly localHandles = new Set<string>();
  private enabled = true;
  private readonly listeners = new Set<() => void>();
  private readonly readyPromise: Promise<void>;
  constructor(private readonly storage: PersistentNotificationStorage, private readonly localNodeId: NodeId, private readonly crypto?: CryptoProvider, options: NotificationServiceOptions = {}) {
    this.maxHistory = Math.max(1, Math.min(2_000, Math.floor(options.maxHistory ?? 200)));
    this.now = options.now ?? (() => Date.now()); this.policy = options.policy; this.delivery = options.delivery; (options.localHandles ?? []).forEach(handle => this.localHandles.add(handle.toLocaleLowerCase())); this.readyPromise = this.hydrate();
  }
  async ready(): Promise<void> { await this.readyPromise; }
  setEnabled(enabled: boolean): void { this.enabled = enabled; }
  isEnabled(): boolean { return this.enabled; }
  async applySettings(value: { mutedCategories: readonly string[]; mutedUsers: readonly string[]; mutedCommunities: readonly string[] }): Promise<void> { await this.ready(); this.mutedCategories.clear(); value.mutedCategories.forEach(item => { if (NOTIFICATION_CATEGORIES.includes(item as NotificationCategory)) this.mutedCategories.add(item as NotificationCategory); }); this.mutedUsers.clear(); value.mutedUsers.forEach(item => this.mutedUsers.add(item)); this.mutedCommunities.clear(); value.mutedCommunities.forEach(item => this.mutedCommunities.add(item)); await this.persist(); }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  async ingest(value: unknown): Promise<NotificationRecord | undefined> {
    await this.ready(); if (!this.enabled) return undefined; const parsed = keystoneObjectSchema.safeParse(value); if (!parsed.success) return undefined; const object = parsed.data;
    // Verify the exact wire fields before Zod defaults are applied. This keeps
    // signatures valid for older objects that omitted optional references.
    if (this.crypto) {
      const raw = value as { signature?: unknown; author?: unknown } & Record<string, unknown>;
      if (typeof raw.signature !== 'string' || typeof raw.author !== 'string') return undefined;
      const { signature: _signature, ...rawUnsigned } = raw;
      if (!(await this.crypto.verify(canonicalJson(rawUnsigned), raw.signature, raw.author))) return undefined;
    }
    const classified = classify(object, this.localNodeId, this.localHandles); if (!classified) return undefined;
    const blocked = this.policy?.isBlocked ? await this.policy.isBlocked(object.author) : false;
    const permitted = this.policy?.canNotify ? await this.policy.canNotify(object, classified.category) : true;
    if (object.author === this.localNodeId || this.mutedUsers.has(object.author) || (classified.communityId ? this.mutedCommunities.has(classified.communityId) : false) || this.mutedCategories.has(classified.category) || blocked || !permitted) return undefined;
    const notification: NotificationRecord = { id: notificationId(classified.category, object.id, object.author, classified.communityId), category: classified.category, objectId: object.id, objectType: object.type, actor: object.author, ...(classified.communityId ? { communityId: classified.communityId } : {}), createdAt: object.createdAt, read: false, title: classified.title, ...(classified.preview ? { preview: classified.preview } : {}), references: referencesFor(object) };
    if (this.notifications.has(notification.id)) return this.notifications.get(notification.id);
    this.notifications.set(notification.id, notification); this.trim(); await this.persist(); if (this.delivery) await this.delivery.deliver(structuredClone(notification)); return structuredClone(notification);
  }
  async list(options: { unreadOnly?: boolean; category?: NotificationCategory; limit?: number } = {}): Promise<readonly NotificationRecord[]> { await this.ready(); const limit = Math.max(1, Math.min(100, Math.floor(options.limit ?? 50))); const values = [...this.notifications.values()].filter(value => (!options.unreadOnly || !value.read) && (!options.category || value.category === options.category) && !this.mutedCategories.has(value.category) && !this.mutedUsers.has(value.actor) && !(value.communityId && this.mutedCommunities.has(value.communityId))).sort(compare); const permitted: NotificationRecord[] = []; for (const value of values) { if (this.policy?.isBlocked && await this.policy.isBlocked(value.actor)) continue; permitted.push(value); if (permitted.length >= limit) break; } return permitted.map(value => structuredClone(value)); }
  async unreadCount(): Promise<number> { await this.ready(); let count = 0; for (const value of this.notifications.values()) if (!value.read && !this.mutedCategories.has(value.category) && !this.mutedUsers.has(value.actor) && !(value.communityId && this.mutedCommunities.has(value.communityId)) && !(this.policy?.isBlocked && await this.policy.isBlocked(value.actor))) count++; return count; }
  async markRead(id: string, read = true): Promise<boolean> { await this.ready(); const value = this.notifications.get(id); if (!value) return false; value.read = read; await this.persist(); return true; }
  async markAllRead(): Promise<void> { await this.ready(); for (const value of this.notifications.values()) value.read = true; await this.persist(); }
  async setCategoryMuted(category: NotificationCategory, muted: boolean): Promise<void> { await this.ready(); setValue(this.mutedCategories, category, muted); await this.persist(); }
  async setUserMuted(user: NodeId, muted: boolean): Promise<void> { await this.ready(); setValue(this.mutedUsers, user, muted); await this.persist(); }
  async setCommunityMuted(community: string, muted: boolean): Promise<void> { await this.ready(); setValue(this.mutedCommunities, community, muted); await this.persist(); }
  async setLocalHandles(handles: readonly string[]): Promise<void> { await this.ready(); this.localHandles.clear(); handles.forEach(handle => this.localHandles.add(handle.toLocaleLowerCase())); }
  settings(): NotificationSettings { return { mutedCategories: [...this.mutedCategories].sort(), mutedUsers: [...this.mutedUsers].sort(), mutedCommunities: [...this.mutedCommunities].sort() }; }
  private async hydrate(): Promise<void> { const state = await this.storage.read(); Object.entries(state.notifications).forEach(([id, value]) => this.notifications.set(id, value)); state.settings.mutedCategories.forEach(value => this.mutedCategories.add(value)); state.settings.mutedUsers.forEach(value => this.mutedUsers.add(value)); state.settings.mutedCommunities.forEach(value => this.mutedCommunities.add(value)); this.trim(); }
  private async persist(): Promise<void> { await this.storage.write({ version: 1, notifications: Object.fromEntries(this.notifications), settings: this.settings() }); this.listeners.forEach(listener => listener()); }
  private trim(): void { const values = [...this.notifications.values()].sort(compare); for (const value of values.slice(this.maxHistory)) this.notifications.delete(value.id); }
}

function classify(object: KeystoneObject, local: NodeId, handles: ReadonlySet<string>): { category: NotificationCategory; title: string; preview?: string; communityId?: string } | undefined {
  const payload = object.payload as Record<string, unknown>; const preview = typeof payload.text === 'string' ? payload.text.slice(0, 180) : typeof payload.description === 'string' ? payload.description.slice(0, 180) : undefined;
  if (object.type === 'message') { const kind = payload.kind; if (kind === 'reaction') return { category: 'reaction', title: 'New reaction', preview }; if (typeof payload.replyTo === 'string' || typeof payload.quote === 'object') return { category: 'reply', title: 'New reply', preview }; return { category: 'dm', title: 'New message', preview }; }
  if (object.type === 'follow' && payload.target === local) return { category: 'follow', title: payload.action === 'unfollow' ? 'Unfollowed' : 'New follower' };
  if (object.type === 'community_member' && payload.action === 'invite' && payload.member === local && typeof payload.communityId === 'string') return { category: 'community_invite', title: 'Community invite', communityId: payload.communityId };
  if ((object.type === 'community_message' || object.type === 'post') && (mentionsLocal(payload, handles) || (Array.isArray(payload.mentionIds) && payload.mentionIds.some(value => value === local)))) return { category: 'community_mention', title: 'You were mentioned', preview, communityId: typeof payload.communityId === 'string' ? payload.communityId : undefined };
  if (object.type === 'comment') return { category: 'comment', title: 'New comment', preview };
  if (object.type === 'track' && object.visibility === 'public') return { category: 'track', title: typeof payload.title === 'string' ? payload.title : 'New Track' };
  if (object.type === 'video' && object.visibility === 'public') { const short = payload.shortForm && typeof payload.shortForm === 'object'; return { category: short ? 'short' : 'video', title: typeof payload.title === 'string' ? payload.title : short ? 'New Short' : 'New Video', preview }; }
  if (object.type === 'live_broadcast' && object.visibility === 'public' && payload.state === 'live') return { category: 'live', title: typeof payload.title === 'string' ? payload.title : 'Live started', preview };
  return undefined;
}
function mentionsLocal(payload: Record<string, unknown>, handles: ReadonlySet<string>): boolean { if (!handles.size) return false; const text = typeof payload.text === 'string' ? payload.text.toLocaleLowerCase() : ''; return [...handles].some(handle => text.includes(`@${handle}`)); }
function referencesFor(object: KeystoneObject): readonly NotificationReference[] { const references = [{ id: object.id, type: object.type }, ...object.references]; return [...new Map(references.map(value => [`${value.type}:${value.id}`, value])).values()]; }
function notificationId(category: NotificationCategory, objectId: string, actor: NodeId, communityId?: string): string { return `notification:${category}:${objectId}:${actor}:${communityId ?? ''}`; }
function compare(a: NotificationRecord, b: NotificationRecord): number { return b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id); }
function setValue<T>(set: Set<T>, value: T, enabled: boolean): void { if (enabled) set.add(value); else set.delete(value); }
const NOTIFICATION_CATEGORIES: readonly NotificationCategory[] = ['dm', 'reply', 'reaction', 'follow', 'community_invite', 'community_mention', 'track', 'video', 'short', 'live', 'comment'];
function parseState(value: unknown): NotificationState { if (!value) return { version: 1, notifications: {}, settings: { mutedCategories: [], mutedUsers: [], mutedCommunities: [] } }; if (!value || typeof value !== 'object') throw new Error('Invalid notification state'); const candidate = value as Partial<NotificationState>; if (candidate.version !== 1 || !candidate.notifications || !candidate.settings || !Array.isArray(candidate.settings.mutedCategories) || !Array.isArray(candidate.settings.mutedUsers) || !Array.isArray(candidate.settings.mutedCommunities)) throw new Error('Unsupported notification state'); return { version: 1, notifications: structuredClone(candidate.notifications), settings: { mutedCategories: [...candidate.settings.mutedCategories], mutedUsers: [...candidate.settings.mutedUsers], mutedCommunities: [...candidate.settings.mutedCommunities] } };
}
