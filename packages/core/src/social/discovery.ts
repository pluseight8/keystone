import { z } from 'zod';
import { albumPayloadSchema, artistPayloadSchema, playlistPayloadSchema, trackPayloadSchema } from './music.js';
import { liveBroadcastPayloadSchema } from './streams.js';
import {
  commentObjectSchema,
  communityObjectSchema,
  fileObjectSchema,
  keystoneObjectSchema,
  postObjectSchema,
  profileObjectSchema,
  type KeystoneObject,
  type KeystoneObjectType,
} from './object-model.js';
import { videoPayloadSchema } from './video.js';
import { SafetyRuntime, SafetySurfaceGate, type ContentDomain } from '../security/content-safety.js';
import { MandatorySafetySurfaceRegistry } from '../security/safety-surfaces.js';

export type DiscoveryScope = 'local' | 'neighbourhood' | 'public';
/** Where a discovery item came from. This is local policy metadata, not a central index. */
export type DiscoverySource = 'local' | 'social' | 'public';
export type FeedSurface = 'home' | 'following' | 'communities' | 'music' | 'videos' | 'shorts' | 'live';
/** Publication metadata is a signed PublicationRevision projection, not a
 * second blob/object copy. It intentionally stays separate from the generic
 * KeystoneObject schema while using the same local index/feed surfaces. */
export interface PublicationDiscoveryEntry {
  readonly id: string;
  readonly type: 'publication';
  readonly author: string;
  readonly createdAt: string;
  readonly visibility: 'public' | 'unlisted';
  readonly references: KeystoneObject['references'];
  readonly payload: Readonly<Record<string, unknown>>;
}
export type DiscoveryEntry = {
  readonly id: KeystoneObject['id'];
  readonly type: KeystoneObject['type'] | 'publication';
  readonly author: KeystoneObject['author'];
  readonly createdAt: KeystoneObject['createdAt'];
  readonly visibility: KeystoneObject['visibility'] | 'unlisted';
  readonly references: KeystoneObject['references'];
  readonly payload: KeystoneObject['payload'] | Readonly<Record<string, unknown>>;
};
export type SearchResult = { object: DiscoveryEntry; score: number; highlights: readonly string[] };
export type SearchPage = { items: readonly SearchResult[]; nextCursor?: string };
export type DiscoveryReason = 'following' | 'community' | 'interest' | 'recent' | 'interaction' | 'history' | 'bookmark' | 'trust';
export type FeedItem = { object: DiscoveryEntry; score: number; reasons: readonly DiscoveryReason[] };
export type FeedPage = { items: readonly FeedItem[]; nextCursor?: string };

export interface DiscoveryVisibilityPolicy { shouldDisplay(value: DiscoveryEntry): boolean; }

/** Local signals are deliberately device-local. They are never included in P2P discovery records. */
export interface LocalInteraction {
  likes?: number;
  reactions?: number;
  watchSeconds?: number;
  listenSeconds?: number;
  bookmarked?: boolean;
  updatedAt?: string;
}

export interface RankingContext {
  now?: number;
  following?: ReadonlySet<string>;
  joinedCommunities?: ReadonlySet<string>;
  interests?: readonly string[];
  interactions?: ReadonlyMap<string, LocalInteraction>;
  trustedAuthors?: ReadonlySet<string>;
}

/** A host can replace this with a local AI ranker without changing discovery or storage APIs. */
export interface RankingProvider { rank(entries: readonly DiscoveryEntry[], context?: RankingContext): readonly FeedItem[]; }

/** Deterministic, bounded local ranking. No remote model or analytics endpoint is consulted. */
export class DeterministicRankingProvider implements RankingProvider {
  rank(entries: readonly DiscoveryEntry[], context: RankingContext = {}): readonly FeedItem[] {
    const following = context.following ?? new Set<string>();
    const communities = context.joinedCommunities ?? new Set<string>();
    const interests = tokenize((context.interests ?? []).join(' '));
    const interactions = context.interactions ?? new Map<string, LocalInteraction>();
    const trusted = context.trustedAuthors ?? new Set<string>();
    const now = context.now ?? Date.now();
    return entries.map(object => {
      const reasons: DiscoveryReason[] = [];
      let score = 0;
      const creator = creatorId(object);
      if (following.has(object.author) || (creator && following.has(creator))) { score += 100; reasons.push('following'); }
      if (communityIds(object).some(id => communities.has(id))) { score += 70; reasons.push('community'); }
      const text = searchable(object);
      if (interests.some(term => text.includes(term))) { score += 20; reasons.push('interest'); }
      if (trusted.has(object.author) || (creator && trusted.has(creator))) { score += 12; reasons.push('trust'); }
      const interaction = interactions.get(object.id);
      const likes = interaction?.likes ?? 0;
      const reactions = interaction?.reactions ?? 0;
      if (likes > 0 || reactions > 0) { score += Math.min(24, likes * 2 + reactions); reasons.push('interaction'); }
      if ((interaction?.watchSeconds ?? 0) > 0 || (interaction?.listenSeconds ?? 0) > 0) { score += Math.min(18, Math.floor(((interaction?.watchSeconds ?? 0) + (interaction?.listenSeconds ?? 0)) / 30)); reasons.push('history'); }
      if (interaction?.bookmarked) { score += 28; reasons.push('bookmark'); }
      const ageHours = Math.max(0, (now - Date.parse(object.createdAt)) / 3_600_000);
      score += Math.max(0, 48 - ageHours);
      reasons.push('recent');
      return { object: structuredClone(object), score, reasons };
    }).sort((a, b) => b.score - a.score || b.object.createdAt.localeCompare(a.object.createdAt) || a.object.id.localeCompare(b.object.id));
  }
}

const discoverableTypes = new Set<string>(['identity.profile', 'community', 'post', 'comment', 'track', 'artist', 'album', 'playlist', 'video', 'short_video', 'live_broadcast', 'file_object', 'publication']);
const publicTypes = new Set<string>(['identity.profile', 'community', 'post', 'track', 'artist', 'album', 'playlist', 'video', 'short_video', 'live_broadcast', 'file_object', 'publication']);
const feedTypes = new Set<string>(['identity.profile', 'community', 'post', 'track', 'video', 'short_video', 'live_broadcast', 'file_object', 'publication']);
const shortVideoPayloadSchema = z.object({ videoId: z.string().min(1), videoUri: z.string().min(1), durationMs: z.number().int().positive(), aspectRatio: z.literal('9:16') }).passthrough();

/**
 * Validates a signed-object shape before signature verification. Shorts are
 * represented by existing Video objects with `shortForm.aspectRatio === "9:16"`.
 */
export function parseDiscoveryObject(value: unknown): KeystoneObject | undefined {
  const base = keystoneObjectSchema.safeParse(value);
  if (!base.success) return undefined;
  const typed = (() => {
    switch (base.data.type) {
      case 'identity.profile': return profileObjectSchema.safeParse(value);
      case 'community': return communityObjectSchema.safeParse(value);
      case 'post': return postObjectSchema.safeParse(value);
      case 'comment': return commentObjectSchema.safeParse(value);
      case 'track': return keystoneObjectSchema.extend({ type: z.literal('track'), payload: trackPayloadSchema }).safeParse(value);
      case 'artist': return keystoneObjectSchema.extend({ type: z.literal('artist'), payload: artistPayloadSchema }).safeParse(value);
      case 'album': return keystoneObjectSchema.extend({ type: z.literal('album'), payload: albumPayloadSchema }).safeParse(value);
      case 'playlist': return keystoneObjectSchema.extend({ type: z.literal('playlist'), payload: playlistPayloadSchema }).safeParse(value);
      case 'video': return keystoneObjectSchema.extend({ type: z.literal('video'), payload: videoPayloadSchema }).safeParse(value);
      case 'live_broadcast': return keystoneObjectSchema.extend({ type: z.literal('live_broadcast'), payload: liveBroadcastPayloadSchema }).safeParse(value);
      case 'file_object': return fileObjectSchema.safeParse(value);
      // Kept for forward-compatible readers. Current product Shorts are Video objects.
      case 'short_video': return keystoneObjectSchema.extend({ type: z.literal('short_video'), payload: shortVideoPayloadSchema }).safeParse(value);
      default: return undefined;
    }
  })();
  return typed?.success ? typed.data : undefined;
}

/** Indexes only objects that another verifier has already accepted. Message bodies and `private` data never enter it. */
export class LocalDiscoveryIndex {
  private readonly entries = new Map<string, DiscoveryEntry>();
  private participation = true;
  constructor(private readonly policy?: DiscoveryVisibilityPolicy, private readonly ranking: RankingProvider = new DeterministicRankingProvider()) {}
  setParticipation(enabled: boolean): void { this.participation = enabled; }
  isParticipationEnabled(): boolean { return this.participation; }
  index(object: DiscoveryEntry): boolean { if (!discoverableTypes.has(object.type) || object.visibility === 'private' || object.type === 'message' || object.type === 'live_chat_message') return false; if (this.entries.has(object.id)) return false; this.entries.set(object.id, structuredClone(object)); return true; }
  remove(id: string): void { this.entries.delete(id); }
  has(id: string): boolean { return this.entries.has(id); }
  values(): readonly DiscoveryEntry[] { return [...this.entries.values()].map(value => structuredClone(value)); }
  search(input: { query: string; scope?: DiscoveryScope; limit?: number; cursor?: string }): SearchPage { const query = normalizeQuery(input.query), scope = input.scope ?? 'local', limit = pageSize(input.limit), start = cursor(input.cursor); const terms = tokenize(query); const matches = [...this.entries.values()].filter(value => visible(value, scope) && this.policy?.shouldDisplay(value) !== false).map(value => ({ object: value, text: searchable(value) })).filter(({ text }) => terms.every(term => text.includes(term))).map(({ object, text }) => ({ object: structuredClone(object), score: scoreMatch(text, terms), highlights: highlights(text, terms) })).sort((a, b) => b.score - a.score || b.object.createdAt.localeCompare(a.object.createdAt) || a.object.id.localeCompare(b.object.id)); return page(matches, start, limit); }
  feed(input: { surface: FeedSurface; following?: readonly string[]; communities?: readonly string[]; interests?: readonly string[]; mutedAuthors?: readonly string[]; blockedCommunities?: readonly string[]; interactions?: ReadonlyMap<string, LocalInteraction>; trustedAuthors?: ReadonlySet<string>; limit?: number; cursor?: string; now?: number }): FeedPage {
    const following = new Set(input.following ?? []), communities = new Set(input.communities ?? []), muted = new Set(input.mutedAuthors ?? []), blockedCommunities = new Set(input.blockedCommunities ?? []);
    const values = [...this.entries.values()].filter(value => feedTypes.has(value.type) || (input.surface === 'shorts' && isShort(value))).filter(value => value.visibility !== 'private' && !muted.has(value.author) && !communityIds(value).some(id => blockedCommunities.has(id)) && this.policy?.shouldDisplay(value) !== false).filter(value => onSurface(value, input.surface, following, communities));
    const ranked = this.ranking.rank(values, { now: input.now, following, joinedCommunities: communities, interests: input.interests, interactions: input.interactions, trustedAuthors: input.trustedAuthors });
    return page(ranked, cursor(input.cursor), pageSize(input.limit));
  }
  /** Safe metadata for an opt-in public DHT/gossip adapter. */
  publicAdvertisement(): readonly Pick<DiscoveryEntry, 'id' | 'type' | 'author' | 'createdAt'>[] { if (!this.participation) return []; return [...this.entries.values()].filter(value => value.visibility === 'public' && publicTypes.has(value.type) && this.policy?.shouldDisplay(value) !== false).map(({ id, type, author, createdAt }) => ({ id, type, author, createdAt })); }
}

export interface DiscoveryStateBackend { read(): Promise<unknown | undefined>; write(value: unknown): Promise<void>; }
export type DiscoveryState = { version: 1; entries: Record<string, DiscoveryEntry>; interactions: Record<string, LocalInteraction>; following: string[]; communities: string[]; sources: Record<string, DiscoverySource> };

/** Durable local state. Hosts should provide an authenticated, encrypted backend. */
export class PersistentDiscoveryStorage {
  private state?: DiscoveryState;
  private writes: Promise<void> = Promise.resolve();
  constructor(private readonly backend: DiscoveryStateBackend) {}
  async read(): Promise<DiscoveryState> { if (this.state) return structuredClone(this.state); const value = await this.backend.read(); this.state = parseState(value); return structuredClone(this.state); }
  async write(value: DiscoveryState): Promise<void> { const snapshot = structuredClone(value); const operation = this.writes.then(() => this.backend.write(snapshot)); this.writes = operation.catch(() => undefined); await operation; this.state = snapshot; }
}
export class InMemoryDiscoveryStateStore implements DiscoveryStateBackend { private value?: unknown; async read() { return structuredClone(this.value); } async write(value: unknown) { this.value = structuredClone(value); } }

export interface DiscoveryPermissionContext extends RankingContext {
  blockedAuthors?: ReadonlySet<string>;
  blockedCommunities?: ReadonlySet<string>;
  canView?: (entry: DiscoveryEntry, scope: DiscoveryScope) => boolean;
}

/** Unified local-first service used by Home, Following, Communities, Search and host UIs. */
export class UnifiedDiscoveryService {
  readonly index: LocalDiscoveryIndex;
  private readonly storage?: PersistentDiscoveryStorage;
  private readonly interactions = new Map<string, LocalInteraction>();
  private readonly sources = new Map<string, DiscoverySource>();
  private readonly following = new Set<string>();
  private readonly communities = new Set<string>();
  /** Opt-in local-only message documents; never persisted or replicated. */
  private readonly localMessages = new Map<string, DiscoveryEntry>();
  private localHistoryEnabled = true;
  private readonly readyPromise: Promise<void>;
  private readonly protectedSurfaces: MandatorySafetySurfaceRegistry;
  constructor(options: { index?: LocalDiscoveryIndex; ranking?: RankingProvider; policy?: DiscoveryVisibilityPolicy; storage?: PersistentDiscoveryStorage; protectedSurfaces?: MandatorySafetySurfaceRegistry } = {}) {
    this.index = options.index ?? new LocalDiscoveryIndex(options.policy, options.ranking);
    this.storage = options.storage;
    // Shared/public discovery is never allowed to silently downgrade to a raw
    // index. Hosts may explicitly supply an unavailable registry for fail-closed
    // testing; normal hosts receive the deterministic local runtime.
    this.protectedSurfaces = options.protectedSurfaces ?? new MandatorySafetySurfaceRegistry(new SafetySurfaceGate(new SafetyRuntime()));
    this.readyPromise = this.hydrate();
  }
  safetySurfaces(): MandatorySafetySurfaceRegistry { return this.protectedSurfaces; }
  async ready(): Promise<void> { await this.readyPromise; }
  async ingest(entry: DiscoveryEntry, source: DiscoverySource = 'local', permissions?: DiscoveryPermissionContext): Promise<boolean> {
    await this.ready();
    if (!discoverableTypes.has(entry.type) || entry.visibility === 'private' || entry.type === 'message' || entry.type === 'live_chat_message') return false;
    if (source === 'public' && (!this.index.isParticipationEnabled() || entry.visibility !== 'public' || !publicTypes.has(entry.type))) return false;
    if (permissions && !canDisplay(entry, permissions, source === 'public' ? 'public' : 'local')) return false;
    const domain = discoveryDomain(entry.visibility);
    const eligible = await this.protectedSurfaces.evaluate('DISCOVERY', { objectId: entry.id, value: entry, content: entry.payload, domain, sourceType: 'discovery', verified: true, authorized: true, sharing: true });
    if (!eligible) return false;
    const added = this.index.index(entry);
    if (!added && !this.index.has(entry.id)) return false;
    // Retain the gate-issued token alongside the projected local index entry.
    // The projection is never accepted here unless the registry has already
    // validated the token against the current policy/hash/domain.
    if (added) await this.protectedSurfaces.store('DISCOVERY', eligible);
    this.sources.set(entry.id, source);
    await this.persist();
    return true;
  }
  async ingestObject(value: unknown, source: DiscoverySource = 'local', permissions?: DiscoveryPermissionContext, verify?: (object: KeystoneObject) => Promise<boolean>): Promise<boolean> {
    const object = parseDiscoveryObject(value); if (!object || (verify && !(await verify(object)))) return false;
    return this.ingest(object, source, permissions);
  }
  /** Ingests a verified PublicationService projection without copying its
   * revision/body. The publication service remains signature authority. */
  async ingestPublication(entry: PublicationDiscoveryEntry, source: DiscoverySource = 'local', permissions?: DiscoveryPermissionContext): Promise<boolean> {
    if (!entry || entry.type !== 'publication' || !entry.id || !entry.author || !['public', 'unlisted'].includes(entry.visibility)) return false;
    return this.ingest(entry, source, permissions);
  }
  /** Indexes an already-authorized private message for Local Search only. */
  indexLocalMessage(message: DiscoveryEntry): boolean { if (message.type !== 'message' || message.visibility !== 'private') return false; this.localMessages.set(message.id, structuredClone(message)); return true; }
  async search(input: { query: string; scope?: DiscoveryScope; limit?: number; cursor?: string; permissions?: DiscoveryPermissionContext }): Promise<SearchPage> {
    await this.ready(); const scope = input.scope ?? 'local'; const pageResult = this.index.search({ query: input.query, scope, limit: 100 }); const filtered = pageResult.items.filter(item => canDisplay(item.object, input.permissions ?? {}, scope));
    const safeFiltered = await this.filterSearchResults(filtered, scope);
    if (scope === 'local' && this.localMessages.size) {
      const query = normalizeQuery(input.query); const terms = tokenize(query);
      const messages = [...this.localMessages.values()].filter(value => input.permissions?.canView?.(value, scope) !== false).map(value => { const text = searchable(value); return { object: structuredClone(value), score: scoreMatch(text, terms), highlights: highlights(text, terms), text }; }).filter(item => terms.every(term => item.text.includes(term))).map(({ text: _text, ...item }) => item);
      return page([...safeFiltered, ...messages].sort((a, b) => b.score - a.score || b.object.createdAt.localeCompare(a.object.createdAt) || a.object.id.localeCompare(b.object.id)), cursor(input.cursor), pageSize(input.limit));
    }
    return page(safeFiltered, cursor(input.cursor), pageSize(input.limit));
  }
  async feed(input: { surface: FeedSurface; limit?: number; cursor?: string; permissions?: DiscoveryPermissionContext; following?: readonly string[]; communities?: readonly string[]; interests?: readonly string[]; mutedAuthors?: readonly string[]; blockedCommunities?: readonly string[]; now?: number }): Promise<FeedPage> {
    await this.ready(); const permissions = input.permissions ?? {}; const following = input.following ?? [...this.following]; const communities = input.communities ?? [...this.communities]; const pageResult = this.index.feed({ ...input, following, communities, interests: input.interests, mutedAuthors: [...(input.mutedAuthors ?? []), ...(permissions.blockedAuthors ? [...permissions.blockedAuthors] : [])], blockedCommunities: [...(input.blockedCommunities ?? []), ...(permissions.blockedCommunities ? [...permissions.blockedCommunities] : [])], interactions: this.interactions, trustedAuthors: permissions.trustedAuthors }); const filtered = pageResult.items.filter(item => canDisplay(item.object, permissions, 'local')); const safeFiltered = await this.filterFeedItems(filtered, input.surface); return page(safeFiltered, cursor(input.cursor), pageSize(input.limit));
  }
  /** Recommendation candidates have their own mandatory surface boundary even
   * when the local ranker is reused by Home. This keeps a future ranker from
   * accepting raw DiscoveryEntry values by accident. */
  async recommendations(input: Omit<Parameters<UnifiedDiscoveryService['feed']>[0], 'surface'>): Promise<FeedPage> {
    await this.ready(); const permissions = input.permissions ?? {}; const following = input.following ?? [...this.following]; const communities = input.communities ?? [...this.communities]; const pageResult = this.index.feed({ ...input, surface: 'home', following, communities, interactions: this.interactions, trustedAuthors: permissions.trustedAuthors }); const filtered = pageResult.items.filter(item => canDisplay(item.object, permissions, 'local')); const safe = await this.filterFeedItemsWithSurface(filtered, 'RECOMMENDATIONS'); return page(safe, cursor(input.cursor), pageSize(input.limit));
  }
  async recordInteraction(id: string, signal: LocalInteraction): Promise<void> { await this.ready(); if (!this.localHistoryEnabled) return; const current = this.interactions.get(id) ?? {}; this.interactions.set(id, { ...current, ...signal, updatedAt: signal.updatedAt ?? new Date().toISOString() }); await this.persist(); }
  async setLocalHistoryEnabled(enabled: boolean): Promise<void> { await this.ready(); this.localHistoryEnabled = enabled; if (!enabled) { this.interactions.clear(); await this.persist(); } }
  async clearLocalHistory(): Promise<void> { await this.ready(); this.interactions.clear(); await this.persist(); }
  setDiscoveryParticipation(enabled: boolean): void { this.index.setParticipation(enabled); }
  async follow(identity: string): Promise<void> { await this.ready(); this.following.add(identity); await this.persist(); }
  async unfollow(identity: string): Promise<void> { await this.ready(); this.following.delete(identity); await this.persist(); }
  async joinCommunity(id: string): Promise<void> { await this.ready(); this.communities.add(id); await this.persist(); }
  async leaveCommunity(id: string): Promise<void> { await this.ready(); this.communities.delete(id); await this.persist(); }
  followingIds(): readonly string[] { return [...this.following].sort(); }
  communityIds(): readonly string[] { return [...this.communities].sort(); }
  interaction(id: string): LocalInteraction | undefined { const value = this.interactions.get(id); return value && structuredClone(value); }
  source(id: string): DiscoverySource | undefined { return this.sources.get(id); }
  publicAdvertisement(): readonly Pick<DiscoveryEntry, 'id' | 'type' | 'author' | 'createdAt'>[] { return this.index.publicAdvertisement(); }
  private async hydrate(): Promise<void> { if (!this.storage) return; const state = await this.storage.read(); for (const entry of Object.values(state.entries)) { const domain = discoveryDomain(entry.visibility); const eligible = await this.protectedSurfaces.evaluate('DISCOVERY', { objectId: entry.id, value: entry, content: entry.payload, domain, sourceType: 'discovery', verified: true, authorized: true, sharing: true }); if (!eligible) continue; if (this.index.index(entry)) await this.protectedSurfaces.store('DISCOVERY', eligible); } Object.entries(state.interactions).forEach(([id, value]) => this.interactions.set(id, value)); state.following.forEach(id => this.following.add(id)); state.communities.forEach(id => this.communities.add(id)); Object.entries(state.sources).forEach(([id, source]) => this.sources.set(id, source)); }
  private async persist(): Promise<void> { if (!this.storage) return; await this.storage.write({ version: 1, entries: Object.fromEntries(this.index.values().map(entry => [entry.id, entry])), interactions: Object.fromEntries(this.interactions), following: [...this.following], communities: [...this.communities], sources: Object.fromEntries(this.sources) }); }
  private async filterSearchResults(items: readonly SearchResult[], scope: DiscoveryScope): Promise<readonly SearchResult[]> {
    const surface = 'SEARCH' as const;
    return (await Promise.all(items.map(async item => (await this.entryEligible(surface, item.object, scope)) ? item : undefined))).filter((item): item is SearchResult => !!item);
  }
  private async filterFeedItems(items: readonly FeedItem[], surface: FeedSurface): Promise<readonly FeedItem[]> { return this.filterFeedItemsWithSurface(items, feedSurfaceSafety(surface)); }
  private async filterFeedItemsWithSurface(items: readonly FeedItem[], surface: 'HOME' | 'RECOMMENDATIONS' | 'MUSIC' | 'VIDEO' | 'SHORTS' | 'LIVE'): Promise<readonly FeedItem[]> {
    return (await Promise.all(items.map(async item => (await this.entryEligible(surface, item.object, 'local')) ? item : undefined))).filter((item): item is FeedItem => !!item);
  }
  private async entryEligible(surface: 'SEARCH' | 'HOME' | 'RECOMMENDATIONS' | 'MUSIC' | 'VIDEO' | 'SHORTS' | 'LIVE', entry: DiscoveryEntry, _scope: DiscoveryScope): Promise<boolean> {
    if (entry.visibility === 'private') return true;
    return (await this.protectedSurfaces.evaluate(surface, { objectId: entry.id, value: entry, content: entry.payload, text: searchable(entry), domain: discoveryDomain(entry.visibility), sourceType: 'discovery', verified: true, authorized: true, sharing: true })) !== undefined;
  }
}

/** Maps signed object visibility to the safety domain used by discovery adapters. */
function discoveryDomain(visibility: DiscoveryEntry['visibility']): ContentDomain {
  if (visibility === 'private') return 'PRIVATE_SELF';
  if (visibility === 'community') return 'COMMUNITY';
  if (visibility === 'contacts') return 'DIRECT_SHARED';
  return 'PUBLIC';
}

/** Transport is optional and caller-owned: this contract does not imply a Keystone search server. */
export interface NeighbourhoodDiscoveryAdapter { searchKnownPeers(query: string, limit: number): Promise<readonly DiscoveryEntry[]>; }
export interface PublicDiscoveryAdapter { searchPublic(query: string, limit: number): Promise<readonly DiscoveryEntry[]>; advertise(entries: readonly Pick<DiscoveryEntry, 'id' | 'type' | 'author' | 'createdAt'>[]): Promise<void>; }
/** The caller routes every remote result through its signed-object verifier before it reaches the local index. */
export type DiscoveryEntryVerifier = (entry: DiscoveryEntry) => Promise<boolean>;
export class DiscoveryCoordinator {
  private readonly protectedSurfaces: MandatorySafetySurfaceRegistry;
  constructor(private readonly index: LocalDiscoveryIndex, private readonly verify: DiscoveryEntryVerifier, private readonly neighbourhood?: NeighbourhoodDiscoveryAdapter, private readonly publicNetwork?: PublicDiscoveryAdapter, protectedSurfaces = new MandatorySafetySurfaceRegistry(new SafetySurfaceGate(new SafetyRuntime()))) { this.protectedSurfaces = protectedSurfaces; }
  async discover(query: string, scope: DiscoveryScope, limit = 20): Promise<SearchPage> { if (scope === 'local') return this.safeSearch(this.index.search({ query, scope, limit }), scope); const remote = scope === 'neighbourhood' ? await this.neighbourhood?.searchKnownPeers(query, pageSize(limit)) ?? [] : await this.publicNetwork?.searchPublic(query, pageSize(limit)) ?? []; for (const entry of remote) { if (!(await this.verify(entry))) continue; const eligible = await this.protectedSurfaces.evaluate('DISCOVERY', { objectId: entry.id, value: entry, content: entry.payload, domain: discoveryDomain(entry.visibility), sourceType: 'discovery', verified: true, authorized: true, sharing: true }); if (eligible) { this.index.index(entry); await this.protectedSurfaces.store('DISCOVERY', eligible); } } return this.safeSearch(this.index.search({ query, scope, limit: 100 }), scope).then(result => page(result.items, 0, pageSize(limit))); }
  advertisePublic(): Promise<void> { return this.publicNetwork?.advertise(this.index.publicAdvertisement()) ?? Promise.resolve(); }
  private async safeSearch(result: SearchPage, scope: DiscoveryScope): Promise<SearchPage> { const items = (await Promise.all(result.items.map(async item => { if (item.object.visibility === 'private') return undefined; const eligible = await this.protectedSurfaces.evaluate('SEARCH', { objectId: item.object.id, value: item.object, content: item.object.payload, text: searchable(item.object), domain: discoveryDomain(item.object.visibility), sourceType: 'discovery', verified: true, authorized: true, sharing: true }); return eligible ? item : undefined; }))).filter((item): item is SearchResult => !!item); return page(items, 0, pageSize(result.items.length || undefined)); }
}

function canDisplay(value: DiscoveryEntry, context: DiscoveryPermissionContext, scope: DiscoveryScope): boolean {
  if (value.visibility === 'private') return false;
  if (scope === 'public' && (value.visibility !== 'public' || !publicTypes.has(value.type))) return false;
  if (context.blockedAuthors?.has(value.author) || (creatorId(value) && context.blockedAuthors?.has(creatorId(value)!))) return false;
  if (communityIds(value).some(id => context.blockedCommunities?.has(id))) return false;
  return context.canView?.(value, scope) !== false;
}
function visible(value: DiscoveryEntry, scope: DiscoveryScope): boolean { return scope === 'local' ? value.visibility !== 'private' : scope === 'neighbourhood' ? value.visibility === 'contacts' || value.visibility === 'community' || value.visibility === 'public' : value.visibility === 'public' && publicTypes.has(value.type); }
function onSurface(value: DiscoveryEntry, surface: FeedSurface, following: Set<string>, communities: Set<string>): boolean { if (surface === 'home') return true; if (surface === 'following') return following.has(value.author) || (!!creatorId(value) && following.has(creatorId(value)!)); if (surface === 'communities') return communityIds(value).some(id => communities.has(id)); if (surface === 'music') return value.type === 'track'; if (surface === 'videos') return value.type === 'video' && !isShort(value); if (surface === 'shorts') return isShort(value); return value.type === 'live_broadcast'; }
function feedSurfaceSafety(surface: FeedSurface): 'HOME' | 'MUSIC' | 'VIDEO' | 'SHORTS' | 'LIVE' { if (surface === 'music') return 'MUSIC'; if (surface === 'videos') return 'VIDEO'; if (surface === 'shorts') return 'SHORTS'; if (surface === 'live') return 'LIVE'; return 'HOME'; }
function creatorId(value: DiscoveryEntry): string | undefined { const payload = value.payload as Record<string, unknown>; return typeof payload.creatorProfileId === 'string' ? payload.creatorProfileId : undefined; }
function communityIds(value: DiscoveryEntry): readonly string[] { const payload = value.payload as Record<string, unknown>; const ids = value.references.filter(reference => reference.type === 'community').map(reference => reference.id); if (typeof payload.communityId === 'string') ids.push(payload.communityId); return [...new Set(ids)]; }
function isShort(value: DiscoveryEntry): boolean { const payload = value.payload as Record<string, unknown>; return value.type === 'short_video' || (value.type === 'video' && !!payload.shortForm && typeof payload.shortForm === 'object' && (payload.shortForm as Record<string, unknown>).aspectRatio === '9:16'); }
function searchable(value: DiscoveryEntry): string { const payload = value.payload as Record<string, unknown>; return normalizeQuery([value.type, ...['name', 'title', 'text', 'description', 'caption', 'category', 'bio', 'handle', 'filename', 'mimeType'].map(key => typeof payload[key] === 'string' ? payload[key] : '')].join(' ')); }
function normalizeQuery(value: string): string { const normalized = value.trim().toLocaleLowerCase(); if (!normalized || normalized.length > 128) throw new Error('Search query must contain 1–128 characters'); return normalized; }
function tokenize(value: string): readonly string[] { return [...new Set(value.split(/[^\p{L}\p{N}_]+/u).filter(Boolean))]; }
function scoreMatch(text: string, terms: readonly string[]): number { return terms.reduce((score, term) => score + (text.match(new RegExp(escape(term), 'gu'))?.length ?? 0), 0); }
function highlights(text: string, terms: readonly string[]): readonly string[] { return terms.filter(term => text.includes(term)).slice(0, 5); }
function escape(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function page<T>(values: readonly T[], start: number, limit: number): { items: readonly T[]; nextCursor?: string } { const items = values.slice(start, start + limit); return { items, ...(start + items.length < values.length ? { nextCursor: String(start + items.length) } : {}) }; }
function cursor(value: string | undefined): number { if (value === undefined) return 0; if (!/^(0|[1-9]\d*)$/.test(value)) throw new Error('Invalid page cursor'); return Number(value); }
function pageSize(value: number | undefined): number { if (value === undefined) return 20; if (!Number.isInteger(value) || value < 1 || value > 100) throw new Error('Page limit must be 1–100'); return value; }
function parseState(value: unknown): DiscoveryState {
  if (!value) return { version: 1, entries: {}, interactions: {}, following: [], communities: [], sources: {} };
  if (!value || typeof value !== 'object') throw new Error('Invalid persistent discovery state');
  const candidate = value as Partial<DiscoveryState>;
  if (candidate.version !== 1 || !candidate.entries || !candidate.interactions || !Array.isArray(candidate.following) || !Array.isArray(candidate.communities) || !candidate.sources) throw new Error('Unsupported persistent discovery state');
  const entries: Record<string, DiscoveryEntry> = {};
  for (const [id, entry] of Object.entries(candidate.entries)) {
    // The local index intentionally stores metadata without signatures. A full signed
    // object is accepted when available, while a structurally valid local snapshot is
    // restored without treating it as a new network assertion.
    const parsed = parseDiscoveryObject(entry);
    if (parsed && parsed.id === id && parsed.visibility !== 'private') entries[id] = parsed;
    else if (isStoredEntry(entry) && entry.id === id) entries[id] = structuredClone(entry);
  }
  return { version: 1, entries, interactions: structuredClone(candidate.interactions), following: [...candidate.following], communities: [...candidate.communities], sources: structuredClone(candidate.sources) };
}
function isStoredEntry(value: unknown): value is DiscoveryEntry {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<DiscoveryEntry>;
  return typeof candidate.id === 'string' && typeof candidate.type === 'string' && discoverableTypes.has(candidate.type) && typeof candidate.author === 'string' && typeof candidate.createdAt === 'string' && Number.isFinite(Date.parse(candidate.createdAt)) && candidate.visibility !== 'private' && Array.isArray(candidate.references) && !!candidate.payload && typeof candidate.payload === 'object';
}
