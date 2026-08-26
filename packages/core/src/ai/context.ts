/**
 * Unified, local-first context for Personal AI.
 *
 * This module is deliberately a resolver rather than another index. Existing
 * services remain authoritative; adapters expose bounded, already-authorized
 * projections and this layer applies one permission filter before context is
 * handed to an agent. The resolver never sends data to a provider.
 */
import { ContextBudget, type AgentContextCandidate } from './agents.js';
import { MemoryService, type MemoryEntry } from './memory.js';
import { KEYSTONE_UNIFIED_CONTEXT_SOURCE, type AIContextItem, type AIDataClass } from './privacy.js';
import type { KeystoneObject, ObjectVisibility } from '../social/object-model.js';
import type { DiscoveryEntry, UnifiedDiscoveryService } from '../social/discovery.js';
import type { SharedSpaceService, SharedSpace, SharedDocument, SharedNote, TaskList, SharedTask, WorkspaceFileReference, WorkspaceComment, SharedLink, SharedContextPublication } from '../social/spaces.js';
import type { CommunityService } from '../social/communities.js';
import type { FileService } from '../social/files.js';
import type { MusicService, MusicObject } from '../social/music.js';
import type { VideoService, VideoObject, WatchStateStore } from '../social/video.js';
import type { ShortVideoService } from '../social/shorts.js';
import type { LiveBroadcastService, LiveBroadcastObject, LiveChatObject } from '../social/streams.js';
import type { NotificationService, NotificationRecord } from '../social/notifications.js';
import type { VaultService } from '../vaults.js';
import type { VaultGraphService } from '../vault-graph.js';
import type { CanvasService } from '../vault-canvas.js';
import type { SharedVaultService } from '../shared-vaults.js';
import { SafetyRuntime, SafetySurfaceGate, type ContentDomain, type SafetyEvaluationRequest } from '../security/content-safety.js';
import { MandatorySafetySurfaceRegistry } from '../security/safety-surfaces.js';
import { SecretRedactionPolicy } from '../security/secrets.js';

export const UNIFIED_CONTEXT_VERSION = 1 as const;
export const CONTEXT_SCOPES = ['all-private', 'current-space', 'current-chat', 'communities', 'files', 'public-only'] as const;
export type ContextScope = (typeof CONTEXT_SCOPES)[number];
export type ContextExecution = 'local' | 'personal_trusted' | 'external';
export type UnifiedContextSourceType =
  | 'memory' | 'message' | 'group_message' | 'community' | 'community_message'
  | 'space' | 'space_document' | 'space_note' | 'task_list' | 'task' | 'space_file'
  | 'space_comment' | 'space_link' | 'file' | 'track' | 'artist' | 'album'
  | 'playlist' | 'library' | 'video' | 'short' | 'live' | 'live_chat'
  | 'profile' | 'notification' | 'vault_note' | 'vault_graph' | 'vault_canvas' | 'shared_vault' | 'shared_vault_note' | 'post' | 'comment' | 'object';

export interface ContextReference { readonly id: string; readonly type: string; }

/** A source adapter projection. `text` is a bounded summary, never raw payload. */
export interface UnifiedContextRecord {
  readonly id: string;
  readonly sourceType: UnifiedContextSourceType;
  readonly author: string;
  readonly authorLabel?: string;
  readonly timestamp: string;
  readonly updatedAt?: string;
  readonly visibility: 'private' | 'contacts' | 'community' | 'public' | 'local';
  readonly dataClass: AIDataClass;
  readonly text: string;
  readonly references: readonly ContextReference[];
  readonly permissionScope: string;
  readonly accessibleTo?: readonly string[];
  readonly relatedAuthors?: readonly string[];
  readonly spaceId?: string;
  readonly conversationId?: string;
  readonly communityId?: string;
  readonly sourceId?: string;
  readonly supersedes?: string;
  readonly deleted?: boolean;
  readonly revoked?: boolean;
  readonly labels?: readonly string[];
}

export interface ContextQuery {
  readonly text: string;
  readonly scope?: ContextScope;
  readonly currentSpaceId?: string;
  readonly currentChatId?: string;
  readonly currentCommunityId?: string;
  readonly currentCanvasId?: string;
  readonly selectedCanvasNodeIds?: readonly string[];
  readonly after?: string;
  readonly before?: string;
  readonly afterObjectId?: string;
  readonly beforeObjectId?: string;
  readonly timezone?: string;
  readonly limit?: number;
  readonly maxTokens?: number;
  readonly execution?: ContextExecution;
  readonly allowedDataClasses?: readonly AIDataClass[];
  readonly signal?: AbortSignal;
}

export interface ContextCitation {
  readonly objectId: string;
  readonly sourceType: UnifiedContextSourceType;
  readonly author: string;
  readonly authorLabel?: string;
  readonly timestamp: string;
  readonly updatedAt?: string;
  readonly permissionScope: string;
  readonly dataClass: AIDataClass;
  readonly excerpt: string;
  readonly references: readonly ContextReference[];
}

export interface ContextResult {
  readonly version: 1;
  readonly query: Omit<ContextQuery, 'signal'>;
  readonly status: 'found' | 'not_found' | 'blocked_external';
  readonly privacy: 'local' | 'personal_trusted' | 'external_blocked';
  readonly scope: ContextScope;
  readonly answer: string;
  readonly citations: readonly ContextCitation[];
  readonly contextItems: readonly AIContextItem[];
  readonly omittedObjectIds: readonly string[];
  readonly truncatedObjectIds: readonly string[];
  readonly generatedAt: string;
}

export type UnifiedContextErrorCode = 'INVALID_QUERY' | 'INVALID_RECORD' | 'INVALID_CITATION' | 'EXTERNAL_CONTEXT_FORBIDDEN' | 'UNAUTHORIZED' | 'PERSISTENCE';
export class UnifiedContextError extends Error {
  constructor(readonly code: UnifiedContextErrorCode, message: string) { super(message); this.name = 'UnifiedContextError'; }
}

export interface UnifiedContextSnapshot { readonly version: 1; readonly records: Record<string, UnifiedContextRecord>; }
export interface ContextStateStore { read(): Promise<unknown | undefined>; write(value: unknown): Promise<void>; }
export class InMemoryUnifiedContextStateStore implements ContextStateStore {
  private value?: unknown;
  async read(): Promise<unknown | undefined> { return this.value === undefined ? undefined : structuredClone(this.value); }
  async write(value: unknown): Promise<void> { this.value = structuredClone(value); }
}

export interface UnifiedContextSourceRequest { readonly query: ContextQuery; readonly viewerId: string; readonly now: number; }
export interface UnifiedContextSource { readonly id: string; readonly refreshOnResolve?: boolean; read(request: UnifiedContextSourceRequest): Promise<readonly UnifiedContextRecord[]>; }

/** Small callback adapter for hosts that already have a local query/index. */
export class FunctionUnifiedContextSource implements UnifiedContextSource {
  constructor(readonly id: string, private readonly reader: (request: UnifiedContextSourceRequest) => Promise<readonly UnifiedContextRecord[]> | readonly UnifiedContextRecord[]) {}
  async read(request: UnifiedContextSourceRequest): Promise<readonly UnifiedContextRecord[]> { return (await this.reader(request)).map(cloneRecord); }
}

export class InMemoryUnifiedContextSource implements UnifiedContextSource {
  private readonly values = new Map<string, UnifiedContextRecord>();
  constructor(readonly id: string, values: readonly UnifiedContextRecord[] = []) { this.replace(values); }
  replace(values: readonly UnifiedContextRecord[]): void { this.values.clear(); for (const value of values) this.upsert(value); }
  upsert(value: UnifiedContextRecord): void { validateRecord(value); this.values.set(value.id, cloneRecord(value)); }
  remove(id: string): void { this.values.delete(id); }
  valuesSnapshot(): readonly UnifiedContextRecord[] { return [...this.values.values()].map(cloneRecord); }
  async read(): Promise<readonly UnifiedContextRecord[]> { return this.valuesSnapshot(); }
}

export interface ContextPermissionFilterOptions {
  readonly viewerId: string;
  readonly blockedIdentities?: ReadonlySet<string>;
  readonly deletedObjectIds?: ReadonlySet<string>;
  readonly revokedObjectIds?: ReadonlySet<string>;
  readonly canView?: (record: UnifiedContextRecord, query: ContextQuery) => boolean | Promise<boolean>;
}

/** Permission checks run before ranking, budgeting, or AI formatting. */
export class ContextPermissionFilter {
  constructor(private readonly options: ContextPermissionFilterOptions) {}
  async filter(records: readonly UnifiedContextRecord[], query: ContextQuery): Promise<readonly UnifiedContextRecord[]> {
    if (query.execution === 'external') return [];
    const allowed = new Set(query.allowedDataClasses ?? ['PUBLIC', 'USER_EXPLICIT', 'PRIVATE']);
    const blocked = this.options.blockedIdentities ?? new Set<string>();
    const deleted = this.options.deletedObjectIds ?? new Set<string>();
    const revoked = this.options.revokedObjectIds ?? new Set<string>();
    const output: UnifiedContextRecord[] = [];
    for (const record of records) {
      if (!isValidDate(record.timestamp) || record.deleted || record.revoked || deleted.has(record.id) || revoked.has(record.id)) continue;
      if (record.dataClass === 'SECRET' || !allowed.has(record.dataClass)) continue;
      if (blocked.has(record.author) || (record.relatedAuthors ?? []).some(author => blocked.has(author))) continue;
      if (!this.allowedScope(record, query)) continue;
      const nonPublic = record.visibility !== 'public' || record.dataClass !== 'PUBLIC';
      if (nonPublic && !(record.accessibleTo ?? []).includes(this.options.viewerId)) continue;
      if (query.scope === 'public-only' && (record.visibility !== 'public' || record.dataClass !== 'PUBLIC')) continue;
      if (this.options.canView && !await this.options.canView(record, query)) continue;
      output.push(cloneRecord(record));
    }
    return output;
  }
  private allowedScope(record: UnifiedContextRecord, query: ContextQuery): boolean {
    switch (query.scope) {
      case 'current-space': return Boolean(query.currentSpaceId && (record.spaceId === query.currentSpaceId || record.references.some(ref => ref.id === query.currentSpaceId)));
      case 'current-chat': return Boolean(query.currentChatId && record.conversationId === query.currentChatId);
      case 'communities': return record.sourceType.startsWith('community') || Boolean(record.communityId);
      case 'files': return ['file', 'space_file'].includes(record.sourceType);
      default: return true;
    }
  }
}

export interface UnifiedContextResolverOptions {
  readonly viewerId: string;
  readonly sources?: readonly UnifiedContextSource[];
  readonly filter?: ContextPermissionFilter;
  readonly storage?: ContextStateStore;
  readonly now?: () => number;
  readonly maxRecords?: number;
  /** Mandatory recipient-local gate for shared/public AI context. */
  readonly protectedSurfaces?: MandatorySafetySurfaceRegistry;
}

/** Resolves local context, follows references, and emits only real citations. */
export class UnifiedContextResolver {
  private readonly viewerId: string;
  private readonly sourceMap = new Map<string, UnifiedContextSource>();
  private readonly recordsMap = new Map<string, UnifiedContextRecord>();
  private readonly storage?: ContextStateStore;
  private readonly now: () => number;
  private readonly maxRecords: number;
  private readonly filter: ContextPermissionFilter;
  private readonly protectedSurfaces: MandatorySafetySurfaceRegistry;
  private sourcesHydrated = false;
  private readyPromise: Promise<void>;
  private writes: Promise<void> = Promise.resolve();

  constructor(options: UnifiedContextResolverOptions) {
    if (!options.viewerId?.trim()) throw new UnifiedContextError('UNAUTHORIZED', 'A viewer identity is required');
    this.viewerId = options.viewerId; this.storage = options.storage; this.now = options.now ?? Date.now; this.maxRecords = clamp(options.maxRecords ?? 10_000, 1, 100_000);
    this.protectedSurfaces = options.protectedSurfaces ?? new MandatorySafetySurfaceRegistry(new SafetySurfaceGate(new SafetyRuntime()));
    this.filter = options.filter ?? new ContextPermissionFilter({ viewerId: options.viewerId });
    for (const source of options.sources ?? []) this.registerSource(source);
    this.readyPromise = this.hydrate();
  }
  async ready(): Promise<void> { await this.readyPromise; }
  registerSource(source: UnifiedContextSource): void { if (!source?.id) throw new UnifiedContextError('INVALID_RECORD', 'Context source id is required'); this.sourceMap.set(source.id, source); this.sourcesHydrated = false; }
  unregisterSource(id: string): void { this.sourceMap.delete(id); this.sourcesHydrated = false; }
  records(): readonly UnifiedContextRecord[] { return [...this.recordsMap.values()].map(cloneRecord); }
  async refresh(): Promise<void> {
    await this.ready();
    for (const source of this.sourceMap.values()) {
      const values = await source.read({ query: { text: '' }, viewerId: this.viewerId, now: this.now() });
      for (const existing of [...this.recordsMap.values()].filter(value => value.sourceId === source.id)) this.recordsMap.delete(existing.id);
      for (const value of values.slice(0, this.maxRecords)) { validateRecord(value); this.recordsMap.set(value.id, { ...cloneRecord(value), sourceId: value.sourceId ?? source.id }); }
    }
    this.sourcesHydrated = true;
    await this.persist();
  }
  async ingestRecord(value: UnifiedContextRecord): Promise<void> {
    await this.ready(); validateRecord(value);
    if (requiresSharedSafety(value.visibility)) {
      const eligible = await this.protectedSurfaces.evaluate('AI_CONTEXT', contextRequest(value));
      if (!eligible) throw new UnifiedContextError('UNAUTHORIZED', 'Shared/public context requires a current SafetyDecisionToken');
    }
    this.recordsMap.set(value.id, cloneRecord(value)); await this.persist();
  }
  /** Direct object ingestion requires an explicit verification assertion. */
  async ingestObject(object: KeystoneObject, options: { verified: true; dataClass?: AIDataClass; permissionScope?: string; accessibleTo?: readonly string[]; relatedAuthors?: readonly string[] } ): Promise<void> {
    if (!options?.verified) throw new UnifiedContextError('UNAUTHORIZED', 'Only verified Keystone objects may enter unified context');
    if (requiresSharedSafety(object.visibility)) {
      const eligible = await this.protectedSurfaces.evaluate('AI_CONTEXT', { objectId: object.id, value: object, content: object.payload, text: JSON.stringify(object.payload), domain: contextDomain(object.visibility), sourceType: 'object', verified: true, authorized: true, sharing: true });
      if (!eligible) throw new UnifiedContextError('UNAUTHORIZED', 'Shared/public object failed the mandatory SafetySurfaceGate');
    }
    const record = recordFromObject(object, { ...options, viewerId: this.viewerId });
    await this.ingestRecord(record);
  }
  async resolve(input: ContextQuery): Promise<ContextResult> {
    await this.ready();
    if (this.sourceMap.size && !this.sourcesHydrated) await this.refresh();
    const query = normalizeQuery(input);
    if (query.execution === 'external') return this.emptyResult(query, 'blocked_external', 'external_blocked', 'Unified Keystone context is local-only.');
    if (query.signal?.aborted) throw new UnifiedContextError('INVALID_QUERY', 'Context query was cancelled');
    for (const source of this.sourceMap.values()) if (source.refreshOnResolve) {
      const values = await source.read({ query, viewerId: this.viewerId, now: this.now() });
      for (const existing of [...this.recordsMap.values()].filter(value => value.sourceId === source.id)) this.recordsMap.delete(existing.id);
      for (const value of values.slice(0, this.maxRecords)) { validateRecord(value); this.recordsMap.set(value.id, { ...cloneRecord(value), sourceId: value.sourceId ?? source.id }); }
    }
    const visible = await this.filter.filter([...this.recordsMap.values()], query);
    const safetyVisible = await this.gateSharedRecords(visible);
    const temporal = resolveTimeRange(query, safetyVisible, this.now());
    const matched = rankRecords(safetyVisible.filter(record => inRange(record, temporal) && matchesQuery(record, query.text)), query.text);
    const expanded = expandReferences(matched, safetyVisible);
    const candidates = (expanded.length ? expanded : matched).slice(0, clamp(query.limit ?? 64, 1, 512));
    if (!candidates.length) return this.emptyResult(query, 'not_found', query.execution === 'personal_trusted' ? 'personal_trusted' : 'local', 'No permitted Keystone objects found.');
    const budget = new ContextBudget(clamp(query.maxTokens ?? 4_096, 64, 128_000));
    const contextCandidates: AgentContextCandidate[] = candidates.map(record => ({
      id: record.id, source: KEYSTONE_UNIFIED_CONTEXT_SOURCE, label: record.text.slice(0, 240), dataClass: record.dataClass,
      value: { objectId: record.id, sourceType: record.sourceType, author: record.author, authorLabel: record.authorLabel, timestamp: record.timestamp, updatedAt: record.updatedAt, text: record.text, permissionScope: record.permissionScope, references: record.references },
      capability: 'LOCAL_SEARCH', priority: record.labels?.includes('pinned') ? 2 : 1, relevance: scoreRecord(record, query.text), createdAt: record.timestamp, tokenEstimate: estimateTokens(record.text) + 36,
    }));
    const selection = budget.select(contextCandidates);
    const selectedById = new Map(selection.items.map(item => [String((item.value as { objectId?: string }).objectId), item]));
    const selected = candidates.filter(record => selectedById.has(record.id));
    const citations = selected.map(toCitation);
    const result: ContextResult = { version: 1, query: serializableQuery(query), status: 'found', privacy: query.execution === 'personal_trusted' ? 'personal_trusted' : 'local', scope: query.scope ?? 'all-private', answer: summarize(selected), citations, contextItems: selection.items, omittedObjectIds: selection.omittedIds, truncatedObjectIds: selection.truncatedIds, generatedAt: new Date(this.now()).toISOString() };
    return result;
  }
  validateCitations(result: ContextResult, citations: readonly ContextCitation[]): readonly ContextCitation[] {
    const byId = new Map(result.citations.map(value => [value.objectId, value]));
    const seen = new Set<string>();
    for (const citation of citations) {
      const expected = byId.get(citation.objectId);
      if (!expected || seen.has(citation.objectId) || !sameCitation(expected, citation)) throw new UnifiedContextError('INVALID_CITATION', `Citation is not present in resolver result: ${citation.objectId}`);
      seen.add(citation.objectId);
    }
    return citations.map(value => ({ ...value, references: value.references.map(ref => ({ ...ref })) }));
  }
  toAIContext(result: ContextResult, execution: ContextExecution): readonly AIContextItem[] {
    if (execution === 'external') throw new UnifiedContextError('EXTERNAL_CONTEXT_FORBIDDEN', 'Unified Keystone context cannot be sent to an external AI provider');
    return result.contextItems.map(item => ({ ...item, value: structuredClone(item.value), source: KEYSTONE_UNIFIED_CONTEXT_SOURCE }));
  }
  private async gateSharedRecords(records: readonly UnifiedContextRecord[]): Promise<readonly UnifiedContextRecord[]> {
    const output: UnifiedContextRecord[] = [];
    for (const record of records) {
      if (!requiresSharedSafety(record.visibility)) { output.push(record); continue; }
      const eligible = await this.protectedSurfaces.evaluate('AI_CONTEXT', contextRequest(record));
      if (eligible) output.push(record);
    }
    return output;
  }
  private emptyResult(query: ContextQuery, status: ContextResult['status'], privacy: ContextResult['privacy'], answer: string): ContextResult {
    return { version: 1, query: serializableQuery(query), status, privacy, scope: query.scope ?? 'all-private', answer, citations: [], contextItems: [], omittedObjectIds: [], truncatedObjectIds: [], generatedAt: new Date(this.now()).toISOString() };
  }
  private async hydrate(): Promise<void> {
    if (!this.storage) return;
    try {
      const value = await this.storage.read();
      if (!value) return;
      if (!isObject(value) || value.version !== 1 || !isObject(value.records)) throw new UnifiedContextError('PERSISTENCE', 'Unsupported unified context snapshot');
      for (const candidate of Object.values(value.records)) { try { validateRecord(candidate); this.recordsMap.set(candidate.id, cloneRecord(candidate)); } catch (error) { if (!(isObject(candidate) && candidate.dataClass === 'SECRET')) throw error; } }
    } catch (error) { if (error instanceof UnifiedContextError) throw error; throw new UnifiedContextError('PERSISTENCE', 'Unable to load unified context state'); }
  }
  private async persist(): Promise<void> {
    if (!this.storage) return;
    const snapshot: UnifiedContextSnapshot = { version: 1, records: Object.fromEntries([...this.recordsMap].slice(0, this.maxRecords).map(([id, value]) => [id, value])) };
    const operation = this.writes.then(() => this.storage!.write(structuredClone(snapshot))); this.writes = operation.catch(() => undefined); await operation;
  }
}

/** Convert an already parsed object into a bounded, citation-safe projection. */
export function recordFromObject(object: KeystoneObject, options: { verified: true; viewerId: string; dataClass?: AIDataClass; permissionScope?: string; accessibleTo?: readonly string[]; relatedAuthors?: readonly string[] } ): UnifiedContextRecord {
  if (!options.verified) throw new UnifiedContextError('UNAUTHORIZED', 'Object verification is required');
  const payload = isObject(object.payload) ? object.payload : {};
  const text = objectSummary(object.type, payload);
  const refs = [...object.references.map(reference => ({ id: reference.id, type: reference.type }))];
  const visibility = object.visibility as UnifiedContextRecord['visibility'];
  const dataClass = options.dataClass ?? (visibility === 'public' ? 'PUBLIC' : 'PRIVATE');
  const accessibleTo = options.accessibleTo ?? (visibility === 'public' ? undefined : [options.viewerId]);
  return { id: object.id, sourceType: mapObjectType(object.type), author: object.author, timestamp: object.createdAt, updatedAt: object.updatedAt, visibility, dataClass, text, references: refs, permissionScope: options.permissionScope ?? (visibility === 'public' ? 'public' : 'object-access'), accessibleTo, relatedAuthors: options.relatedAuthors, sourceId: 'object-adapter', deleted: object.deleted, supersedes: object.supersedes, labels: object.type === 'file_object' ? ['file'] : undefined };
}

/** Build adapters from existing services. All service APIs remain authoritative. */
export function createUnifiedContextSources(services: {
  memory?: MemoryService;
  discovery?: UnifiedDiscoveryService;
  spaces?: SharedSpaceService;
  communities?: CommunityService;
  files?: FileService;
  music?: MusicService;
  videos?: VideoService;
  videoWatch?: WatchStateStore;
  shorts?: ShortVideoService;
  live?: LiveBroadcastService;
  notifications?: NotificationService;
  vault?: VaultService;
  graph?: VaultGraphService;
  canvas?: CanvasService;
  sharedVaults?: readonly SharedVaultService[];
  messages?: { conversations(): Promise<readonly { id: string; members?: readonly string[]; participants?: readonly string[]; kind?: string }[]>; history(id: string): Promise<readonly KeystoneObject[]> };
}, viewerId: string): readonly UnifiedContextSource[] {
  const sources: UnifiedContextSource[] = [];
  if (services.memory) sources.push(new MemoryUnifiedContextSource(services.memory, viewerId));
  if (services.discovery) sources.push(new DiscoveryUnifiedContextSource(services.discovery, viewerId));
  if (services.messages) sources.push(new MessageUnifiedContextSource(services.messages, viewerId));
  if (services.spaces) sources.push(new SharedSpaceUnifiedContextSource(services.spaces, viewerId));
  if (services.communities) sources.push(new CommunityUnifiedContextSource(services.communities, viewerId));
  if (services.files) sources.push(new FileUnifiedContextSource(services.files, viewerId));
  if (services.music) sources.push(new MusicUnifiedContextSource(services.music, viewerId));
  if (services.videos) sources.push(new VideoUnifiedContextSource(services.videos, viewerId, services.videoWatch));
  if (services.shorts) sources.push(new ShortUnifiedContextSource(services.shorts, viewerId));
  if (services.live) sources.push(new LiveUnifiedContextSource(services.live, viewerId));
  if (services.notifications) sources.push(new NotificationUnifiedContextSource(services.notifications, viewerId));
  if (services.vault) sources.push(new VaultUnifiedContextSource(services.vault, viewerId));
  if (services.graph) sources.push(new VaultGraphUnifiedContextSource(services.graph, viewerId));
  if (services.canvas) sources.push(new VaultCanvasUnifiedContextSource(services.canvas, viewerId));
  if (services.sharedVaults?.length) sources.push(new SharedVaultUnifiedContextSource(services.sharedVaults, viewerId));
  return sources;
}

export class MemoryUnifiedContextSource implements UnifiedContextSource {
  readonly id = 'memory';
  constructor(private readonly memory: MemoryService, private readonly viewerId: string) {}
  async read(): Promise<readonly UnifiedContextRecord[]> { const entries = await this.memory.list({ limit: 1_000 }); return entries.filter(entry => entry.privacyClass !== 'SECRET').map(entry => memoryRecord(entry, this.viewerId)); }
}

export class DiscoveryUnifiedContextSource implements UnifiedContextSource {
  readonly id = 'discovery';
  constructor(private readonly discovery: UnifiedDiscoveryService, private readonly viewerId: string) {}
  async read(): Promise<readonly UnifiedContextRecord[]> { await this.discovery.ready(); return this.discovery.index.values().map(entry => recordFromObject(entry as KeystoneObject, { verified: true, viewerId: this.viewerId, permissionScope: entry.visibility === 'public' ? 'public-discovery' : 'local-discovery', accessibleTo: entry.visibility === 'public' ? undefined : [this.viewerId] })); }
}

export class MessageUnifiedContextSource implements UnifiedContextSource {
  readonly id = 'messages';
  constructor(private readonly messages: { conversations(): Promise<readonly { id: string; members?: readonly string[]; participants?: readonly string[]; kind?: string }[]>; history(id: string): Promise<readonly KeystoneObject[]> }, private readonly viewerId: string) {}
  async read(): Promise<readonly UnifiedContextRecord[]> { const output: UnifiedContextRecord[] = []; for (const conversation of await this.messages.conversations()) { const members = conversation.members ?? conversation.participants ?? []; if (!members.includes(this.viewerId)) continue; for (const object of await this.messages.history(conversation.id)) { if (object.deleted) continue; const record = recordFromObject(object, { verified: true, viewerId: this.viewerId, dataClass: 'PRIVATE', permissionScope: 'conversation-member', accessibleTo: members }); output.push({ ...record, sourceType: conversation.kind === 'group' ? 'group_message' : 'message', conversationId: conversation.id }); } } return output; }
}

export class SharedSpaceUnifiedContextSource implements UnifiedContextSource {
  readonly id = 'spaces';
  constructor(private readonly spaces: SharedSpaceService, private readonly viewerId: string) {}
  async read(): Promise<readonly UnifiedContextRecord[]> {
    const output: UnifiedContextRecord[] = [];
    for (const space of this.spaces.listSpaces()) {
      if (!activeMember(space, this.viewerId)) continue;
      const members = activeMembers(space); const dataClass: AIDataClass = space.visibility === 'public' ? 'PUBLIC' : 'PRIVATE'; const base = { viewerId: this.viewerId, dataClass, permissionScope: space.visibility === 'public' ? 'space-public' : 'space-member', accessibleTo: members } as const;
      output.push(spaceRecord(space, base));
      const call = async <T>(reader: () => readonly T[] | Promise<readonly T[]>, mapper: (value: T) => UnifiedContextRecord) => { try { for (const value of await reader()) output.push(mapper(value)); } catch { /* removed/private spaces fail closed */ } };
      await call(() => this.spaces.listDocuments(space.id), value => childSpaceRecord(value, 'space_document', space, base, (value as SharedDocument).title + ': ' + (value as SharedDocument).body));
      await call(() => this.spaces.listNotes(space.id), value => childSpaceRecord(value, 'space_note', space, base, (value as SharedNote).title + ': ' + (value as SharedNote).body));
      await call(() => this.spaces.listTaskLists(space.id), value => childSpaceRecord(value, 'task_list', space, base, (value as TaskList).title + ': ' + ((value as TaskList).description ?? '')));
      await call(() => this.spaces.listTasks(space.id), value => childSpaceRecord(value, 'task', space, base, (value as SharedTask).title + ': ' + ((value as SharedTask).description ?? '') + ' [' + (value as SharedTask).status + ']'));
      await call(() => this.spaces.listFileReferences(space.id), value => childSpaceRecord(value, 'space_file', space, base, (value as WorkspaceFileReference).filename ?? (value as WorkspaceFileReference).fileId));
      await call(() => this.spaces.listComments(space.id), value => childSpaceRecord(value, 'space_comment', space, base, (value as WorkspaceComment).text));
      await call(() => this.spaces.listLinks(space.id), value => childSpaceRecord(value, 'space_link', space, base, (value as SharedLink).title ?? (value as SharedLink).url));
      await call(() => this.spaces.listSharedContext(space.id), value => childSpaceRecord(value, 'object', space, base, String((value as SharedContextPublication).value ?? '')));
    }
    return output;
  }
}

export class CommunityUnifiedContextSource implements UnifiedContextSource {
  readonly id = 'communities';
  constructor(private readonly communities: CommunityService, private readonly viewerId: string) {}
  async read(): Promise<readonly UnifiedContextRecord[]> {
    const output: UnifiedContextRecord[] = [];
    for (const community of await this.communities.listCommunities()) {
      const projection = await this.communities.projection(community.id); const members = projection ? [...projection.members.values()].filter(member => member.active && !member.banned).map(member => member.identity) : [];
      const root = recordFromObject(community as KeystoneObject, { verified: true, viewerId: this.viewerId, dataClass: community.visibility === 'public' ? 'PUBLIC' : 'PRIVATE', permissionScope: 'community-member', accessibleTo: members.length ? members : [this.viewerId] }); output.push({ ...root, sourceType: 'community', communityId: community.id });
      try { for (const event of await this.communities.events(community.id)) { const candidate = event as unknown as KeystoneObject; if (candidate.id && candidate.createdAt) output.push({ ...recordFromObject(candidate, { verified: true, viewerId: this.viewerId, dataClass: community.visibility === 'public' ? 'PUBLIC' : 'PRIVATE', permissionScope: 'community-member', accessibleTo: members.length ? members : [this.viewerId] }), sourceType: 'community_message', communityId: community.id }); } } catch { /* malformed or unauthorized events stay out */ }
    }
    return output;
  }
}

export class FileUnifiedContextSource implements UnifiedContextSource {
  readonly id = 'files';
  constructor(private readonly files: FileService, private readonly viewerId: string) {}
  async read(): Promise<readonly UnifiedContextRecord[]> { return (await this.files.list()).map(file => recordFromObject(file as KeystoneObject, { verified: true, viewerId: this.viewerId, dataClass: file.visibility === 'public' ? 'PUBLIC' : 'PRIVATE', permissionScope: file.visibility === 'public' ? 'public-file' : 'file-owner', accessibleTo: file.visibility === 'public' ? undefined : [this.viewerId] })); }
}

export class MusicUnifiedContextSource implements UnifiedContextSource {
  readonly id = 'music';
  constructor(private readonly music: MusicService, private readonly viewerId: string) {}
  async read(): Promise<readonly UnifiedContextRecord[]> { const values = [...await this.music.tracks(), ...await this.music.artists(), ...await this.music.albums(), ...await this.music.playlists(), ...await this.music.library()]; return values.map(value => musicRecord(value, this.viewerId)); }
}

export class VideoUnifiedContextSource implements UnifiedContextSource {
  readonly id = 'videos';
  constructor(private readonly videos: VideoService, private readonly viewerId: string, private readonly watch?: WatchStateStore) {}
  async read(): Promise<readonly UnifiedContextRecord[]> { const output: UnifiedContextRecord[] = []; for (const video of await this.videos.videos()) { const state = this.watch ? await this.watch.getWatch(video.payload.videoId) : undefined; output.push(videoRecord(video, this.viewerId, state?.saved ? ['saved'] : undefined)); } return output; }
}

export class ShortUnifiedContextSource {
  readonly id = 'shorts';
  constructor(private readonly shorts: ShortVideoService, private readonly viewerId: string) {}
  async read(): Promise<readonly UnifiedContextRecord[]> { return (await this.shorts.list()).filter(video => Boolean(video.payload.shortForm?.aspectRatio)).map(video => ({ ...videoRecord(video, this.viewerId), sourceType: 'short' })); }
}

export class LiveUnifiedContextSource implements UnifiedContextSource {
  readonly id = 'live';
  constructor(private readonly live: LiveBroadcastService, private readonly viewerId: string) {}
  async read(): Promise<readonly UnifiedContextRecord[]> { const output: UnifiedContextRecord[] = []; for (const broadcast of await this.live.broadcasts()) { output.push(liveRecord(broadcast, this.viewerId)); try { for (const chat of await this.live.chats(broadcast.payload.broadcastId)) output.push(liveChatRecord(chat, broadcast, this.viewerId)); } catch { /* stale live chat is ignored */ } } return output; }
}

export class NotificationUnifiedContextSource implements UnifiedContextSource {
  readonly id = 'notifications';
  constructor(private readonly notifications: NotificationService, private readonly viewerId: string) {}
  async read(): Promise<readonly UnifiedContextRecord[]> { return (await this.notifications.list({ limit: 100 })).map(value => notificationRecord(value, this.viewerId)); }
}

/** Markdown Vault projection. Notes remain private, bounded and explicitly untrusted. */
export class VaultUnifiedContextSource implements UnifiedContextSource {
  readonly id = 'vault';
  readonly refreshOnResolve = true;
  constructor(private readonly vault: VaultService, private readonly viewerId: string) {}
  async read(request: UnifiedContextSourceRequest): Promise<readonly UnifiedContextRecord[]> {
    const query = request.query.text ? { text: request.query.text, limit: 512 } : { limit: 512 };
    const hits = await this.vault.search(query, this.viewerId);
    const output: UnifiedContextRecord[] = [];
    for (const hit of hits) {
      try {
        const note = await this.vault.getNote(hit.note.id, this.viewerId);
        if (!note) continue;
        output.push({
          id: note.id,
          sourceType: 'vault_note',
          author: this.viewerId,
          timestamp: note.modifiedAt,
          updatedAt: note.modifiedAt,
          visibility: 'private',
          dataClass: 'PRIVATE',
          text: `${note.title}: ${note.body.slice(0, 8_000)}`,
          references: [
            ...note.headings.slice(0, 64).map(heading => ({ id: `${note.id}#${heading.id}`, type: 'vault_heading' })),
            ...note.links.filter(link => link.targetNoteId).map(link => ({ id: link.targetNoteId!, type: 'vault_note' })),
          ],
          permissionScope: `vault-owner:${note.vaultId}`,
          accessibleTo: [this.viewerId],
          sourceId: this.id,
          labels: ['UNTRUSTED_VAULT_MARKDOWN', ...note.tags.slice(0, 32)],
        });
      } catch {
        // Missing or malformed notes fail closed without poisoning other context.
      }
    }
    return output;
  }
}

/** Explicit shared-vault projection. Membership is checked by SharedVaultService before data enters AI context. */
export class SharedVaultUnifiedContextSource implements UnifiedContextSource {
  readonly id = 'shared-vaults';
  readonly refreshOnResolve = true;
  constructor(private readonly sharedVaults: readonly SharedVaultService[], private readonly viewerId: string) {}
  async read(request: UnifiedContextSourceRequest): Promise<readonly UnifiedContextRecord[]> {
    const output: UnifiedContextRecord[] = [];
    for (const service of this.sharedVaults) {
      for (const shared of await service.list(this.viewerId)) {
        if (request.query.scope === 'public-only' && shared.visibility !== 'public') continue;
        output.push({ id: shared.id, sourceType: 'shared_vault', author: shared.ownerIdentityId, timestamp: shared.createdAt, updatedAt: shared.updatedAt, visibility: shared.visibility === 'public' ? 'public' : 'private', dataClass: shared.visibility === 'public' ? 'PUBLIC' : 'PRIVATE', text: `${shared.title}${shared.description ? `: ${shared.description}` : ''}`, references: [{ id: shared.id, type: 'shared_vault' }], permissionScope: `shared-vault:${shared.id}`, accessibleTo: shared.visibility === 'public' ? undefined : [this.viewerId], sourceId: this.id });
        try {
          const notes = await service.listNotes(shared.id, this.viewerId);
          for (const note of notes.slice(0, Math.min(request.query.limit ?? 64, 256))) output.push({ id: note.id, sourceType: 'shared_vault_note', author: this.viewerId, timestamp: note.modifiedAt, updatedAt: note.modifiedAt, visibility: 'private', dataClass: 'PRIVATE', text: `${note.title}: ${note.body.slice(0, 8_000)}`, references: [{ id: shared.id, type: 'shared_vault' }], permissionScope: `shared-vault:${shared.id}`, accessibleTo: [this.viewerId], sourceId: this.id, spaceId: shared.id });
        } catch { /* removed/revoked vaults fail closed */ }
      }
    }
    return output;
  }
}

/** Explicit, bounded graph scope for a local/trusted Agent Bot. */
export class VaultGraphUnifiedContextSource implements UnifiedContextSource {
  readonly id = 'vault-graph';
  readonly refreshOnResolve = true;
  constructor(private readonly graph: VaultGraphService, private readonly viewerId: string) {}
  async read(request: UnifiedContextSourceRequest): Promise<readonly UnifiedContextRecord[]> {
    const projection = await this.graph.globalGraph({ filter: { searchQuery: request.query.text || undefined, includeUnresolved: true }, limitNodes: Math.min(request.query.limit ?? 64, 256), limitEdges: 512 }, this.viewerId);
    return projection.nodes.map(node => ({ id: node.id, sourceType: 'vault_graph', author: this.viewerId, timestamp: node.modifiedAt ?? new Date(request.now).toISOString(), visibility: 'private', dataClass: 'PRIVATE', text: `${node.kind}: ${node.label}${node.path ? ` (${node.path})` : ''}`, references: projection.edges.filter(edge => edge.source === node.id || edge.target === node.id).slice(0, 32).map(edge => ({ id: edge.source === node.id ? edge.target : edge.source, type: `graph_${edge.kind.toLowerCase()}` })), permissionScope: `vault-graph:${projection.vaultId}`, accessibleTo: [this.viewerId], sourceId: this.id, labels: ['UNTRUSTED_VAULT_GRAPH', ...(node.unresolved ? ['unresolved'] : [])] }));
  }
}

/** Canvas context is opt-in and selected-card bounded; it never imports note content. */
export class VaultCanvasUnifiedContextSource implements UnifiedContextSource {
  readonly id = 'vault-canvas';
  readonly refreshOnResolve = true;
  constructor(private readonly canvas: CanvasService, private readonly viewerId: string) {}
  async read(request: UnifiedContextSourceRequest): Promise<readonly UnifiedContextRecord[]> {
    if (!request.query.currentCanvasId) return [];
    const document = await this.canvas.open(request.query.currentCanvasId, this.viewerId); if (!document) return [];
    const selected = request.query.selectedCanvasNodeIds?.length ? new Set(request.query.selectedCanvasNodeIds) : undefined;
    return document.nodes.filter(node => !selected || selected.has(node.id)).slice(0, 256).map(node => ({ id: `${document.id}:${node.id}`, sourceType: 'vault_canvas', author: this.viewerId, timestamp: document.updatedAt, visibility: 'private', dataClass: 'PRIVATE', text: `${node.kind}: ${node.title ?? node.text ?? node.reference?.kind ?? node.id}`.slice(0, 4_000), references: node.reference ? [{ id: typeof node.reference === 'object' && 'noteId' in node.reference ? String(node.reference.noteId) : node.id, type: 'canvas_reference' }] : [], permissionScope: `vault-canvas:${document.id}`, accessibleTo: [this.viewerId], sourceId: this.id, labels: ['UNTRUSTED_VAULT_CANVAS', ...(selected ? ['selected'] : [])] }));
  }
}

function memoryRecord(entry: MemoryEntry, viewerId: string): UnifiedContextRecord { return { id: entry.id, sourceType: 'memory', author: viewerId, timestamp: entry.updatedAt, updatedAt: entry.updatedAt, visibility: 'local', dataClass: entry.privacyClass, text: `${entry.summary} (${entry.assertion})`, references: entry.sources.map(source => ({ id: source.id, type: source.type })), permissionScope: 'local-owner', accessibleTo: [viewerId], labels: [entry.kind, ...(entry.pinned ? ['pinned'] : [])] }; }
function spaceRecord(space: SharedSpace, base: { viewerId: string; dataClass: AIDataClass; permissionScope: string; accessibleTo: readonly string[] }): UnifiedContextRecord { return { id: space.id, sourceType: 'space', author: space.owner, timestamp: space.createdAt, updatedAt: space.updatedAt, visibility: space.visibility, dataClass: base.dataClass, text: `${space.title}: ${space.description}`, references: [], permissionScope: base.permissionScope, accessibleTo: base.accessibleTo, spaceId: space.id }; }
function childSpaceRecord(value: unknown, sourceType: UnifiedContextSourceType, space: SharedSpace, base: { viewerId: string; dataClass: AIDataClass; permissionScope: string; accessibleTo: readonly string[] }, text: string): UnifiedContextRecord { const candidate = value as { id: string; createdAt: string; updatedAt?: string; createdBy?: string; author?: string; listId?: string; fileId?: string; objectId?: string; sourceId?: string; dataClass?: AIDataClass }; const refs = [{ id: space.id, type: 'space' }, ...(candidate.listId ? [{ id: candidate.listId, type: 'task_list' }] : []), ...(candidate.fileId ? [{ id: candidate.fileId, type: 'file' }] : []), ...(candidate.objectId ? [{ id: candidate.objectId, type: 'object' }] : []), ...(candidate.sourceId ? [{ id: candidate.sourceId, type: 'object' }] : [])]; return { id: candidate.id, sourceType, author: candidate.createdBy ?? candidate.author ?? space.owner, timestamp: candidate.createdAt, updatedAt: candidate.updatedAt, visibility: space.visibility, dataClass: candidate.dataClass ?? base.dataClass, text: text.slice(0, 4_000), references: refs, permissionScope: base.permissionScope, accessibleTo: base.accessibleTo, spaceId: space.id }; }
function musicRecord(value: MusicObject, viewerId: string): UnifiedContextRecord { const payload = value.payload as Record<string, unknown>; const refs = value.references.map(ref => ({ id: ref.id, type: ref.type })); const text = `${String(payload.title ?? payload.name ?? payload.trackId ?? value.type)}${payload.artistIds ? ` artists ${(payload.artistIds as string[]).join(', ')}` : ''}`; return { id: value.id, sourceType: value.type === 'library_entry' ? 'library' : value.type, author: value.author, timestamp: value.createdAt, updatedAt: value.updatedAt, visibility: value.visibility, dataClass: value.visibility === 'public' ? 'PUBLIC' : 'PRIVATE', text, references: refs, permissionScope: value.visibility === 'public' ? 'public-music' : 'local-music', accessibleTo: value.visibility === 'public' ? undefined : [viewerId] }; }
function videoRecord(video: VideoObject, viewerId: string, labels?: readonly string[]): UnifiedContextRecord { return { id: video.id, sourceType: video.payload.shortForm ? 'short' : 'video', author: video.author, timestamp: video.createdAt, updatedAt: video.updatedAt, visibility: video.visibility, dataClass: video.visibility === 'public' ? 'PUBLIC' : 'PRIVATE', text: `${video.payload.title}: ${video.payload.description ?? ''}`, references: video.references.map(ref => ({ id: ref.id, type: ref.type })), permissionScope: video.visibility === 'public' ? 'public-video' : 'local-video', accessibleTo: video.visibility === 'public' ? undefined : [viewerId], labels }; }
function liveRecord(value: LiveBroadcastObject, viewerId: string): UnifiedContextRecord { return { id: value.id, sourceType: 'live', author: value.author, timestamp: value.createdAt, updatedAt: value.updatedAt, visibility: value.visibility, dataClass: value.visibility === 'public' ? 'PUBLIC' : 'PRIVATE', text: `${value.payload.title}: ${value.payload.description ?? ''} [${value.payload.state}]`, references: value.references.map(ref => ({ id: ref.id, type: ref.type })), permissionScope: value.visibility === 'public' ? 'public-live' : 'live-member', accessibleTo: value.visibility === 'public' ? undefined : [viewerId], communityId: value.payload.communityId }; }
function liveChatRecord(value: LiveChatObject, broadcast: LiveBroadcastObject, viewerId: string): UnifiedContextRecord { return { id: value.id, sourceType: 'live_chat', author: value.author, timestamp: value.createdAt, visibility: broadcast.visibility, dataClass: broadcast.visibility === 'public' ? 'PUBLIC' : 'PRIVATE', text: value.payload.text, references: value.references.map(ref => ({ id: ref.id, type: ref.type })), permissionScope: broadcast.visibility === 'public' ? 'public-live-chat' : 'live-member', accessibleTo: broadcast.visibility === 'public' ? undefined : [viewerId] }; }
function notificationRecord(value: NotificationRecord, viewerId: string): UnifiedContextRecord { return { id: value.id, sourceType: 'notification', author: value.actor, timestamp: value.createdAt, visibility: 'local', dataClass: 'PRIVATE', text: `${value.title}: ${value.preview ?? ''}`, references: [{ id: value.objectId, type: value.objectType }], permissionScope: 'local-notification', accessibleTo: [viewerId] }; }

function mapObjectType(type: string): UnifiedContextSourceType { const map: Record<string, UnifiedContextSourceType> = { 'identity.profile': 'profile', message: 'message', 'group_message': 'group_message', community: 'community', post: 'post', comment: 'comment', file_object: 'file', track: 'track', artist: 'artist', album: 'album', playlist: 'playlist', library_entry: 'library', video: 'video', short_video: 'short', live_broadcast: 'live', live_chat_message: 'live_chat' }; return map[type] ?? 'object'; }
function objectSummary(type: string, payload: Record<string, unknown>): string { const fields = ['title', 'name', 'displayName', 'username', 'description', 'bio', 'text', 'filename', 'caption', 'status', 'category']; const pieces = fields.flatMap(field => typeof payload[field] === 'string' ? [payload[field] as string] : []).map(value => value.trim()).filter(Boolean); return (pieces.length ? pieces.join(': ') : `${type} object`).slice(0, 4_000); }
function validateRecord(value: UnifiedContextRecord): void { if (!value || SecretRedactionPolicy.containsManagedSecret(value) || typeof value.id !== 'string' || !value.id || typeof value.author !== 'string' || !isValidDate(value.timestamp) || !value.text || value.text.length > 16_000 || !value.permissionScope || !value.sourceType) throw new UnifiedContextError('INVALID_RECORD', 'Invalid unified context record'); if (value.dataClass === 'SECRET') throw new UnifiedContextError('INVALID_RECORD', 'SECRET records cannot enter unified context'); }
function cloneRecord(value: UnifiedContextRecord): UnifiedContextRecord { return { ...value, references: value.references.map(ref => ({ ...ref })), ...(value.accessibleTo ? { accessibleTo: [...value.accessibleTo] } : {}), ...(value.relatedAuthors ? { relatedAuthors: [...value.relatedAuthors] } : {}), ...(value.labels ? { labels: [...value.labels] } : {}) }; }
function normalizeQuery(input: ContextQuery): ContextQuery { if (!input || typeof input.text !== 'string' || input.text.length > 4_000 || !input.text.trim()) throw new UnifiedContextError('INVALID_QUERY', 'Context query must be a bounded non-empty string'); const timezone = input.timezone ?? 'UTC'; try { new Intl.DateTimeFormat('en-US', { timeZone: timezone }); } catch { throw new UnifiedContextError('INVALID_QUERY', 'Invalid IANA timezone'); } return { ...input, text: input.text.trim(), scope: input.scope ?? 'all-private', limit: clamp(input.limit ?? 64, 1, 512), maxTokens: clamp(input.maxTokens ?? 4_096, 64, 128_000), timezone }; }
function serializableQuery(query: ContextQuery): Omit<ContextQuery, 'signal'> { const { signal: _signal, ...serializable } = query; return serializable; }
function validateDate(value: string): number { const result = Date.parse(value); if (!Number.isFinite(result)) throw new UnifiedContextError('INVALID_RECORD', 'Invalid context timestamp'); return result; }
function isValidDate(value: string): boolean { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
function activeMember(space: SharedSpace, viewerId: string): boolean { return space.members.some(member => member.identityId === viewerId && !member.removedAt); }
function activeMembers(space: SharedSpace): readonly string[] { return space.members.filter(member => !member.removedAt).map(member => member.identityId); }
function matchesQuery(record: UnifiedContextRecord, text: string): boolean { const terms = tokenize(text).filter(term => !TIME_TERMS.has(term) && !STOP_WORDS.has(term)); if (!terms.length) return true; const haystack = tokenize([record.text, record.author, record.authorLabel ?? '', record.sourceType, ...(record.labels ?? [])].join(' ')); return terms.some(term => haystack.includes(term) || haystack.some(value => value.startsWith(term))); }
function rankRecords(values: readonly UnifiedContextRecord[], query: string): UnifiedContextRecord[] { return [...values].sort((left, right) => scoreRecord(right, query) - scoreRecord(left, query) || right.timestamp.localeCompare(left.timestamp) || left.id.localeCompare(right.id)); }
function scoreRecord(record: UnifiedContextRecord, query: string): number { const terms = tokenize(query); const text = tokenize(`${record.text} ${record.author} ${record.authorLabel ?? ''}`); return terms.reduce((score, term) => score + (text.includes(term) ? 5 : 0), 0) + (record.labels?.includes('pinned') ? 3 : 0) + Date.parse(record.timestamp) / 1e13; }
function expandReferences(matches: readonly UnifiedContextRecord[], visible: readonly UnifiedContextRecord[]): UnifiedContextRecord[] {
  const ids = new Set(matches.map(value => value.id)); const output = [...matches]; let frontier = [...matches];
  while (frontier.length) {
    const linked = new Set(frontier.flatMap(value => value.references.map(ref => ref.id)));
    const next = visible.filter(record => !ids.has(record.id) && (linked.has(record.id) || record.references.some(ref => frontier.some(parent => parent.id === ref.id))));
    if (!next.length) break;
    for (const record of next) { ids.add(record.id); output.push(record); }
    frontier = next;
  }
  return rankRecords(output, '');
}
function toCitation(record: UnifiedContextRecord): ContextCitation { return { objectId: record.id, sourceType: record.sourceType, author: record.author, authorLabel: record.authorLabel, timestamp: record.timestamp, updatedAt: record.updatedAt, permissionScope: record.permissionScope, dataClass: record.dataClass, excerpt: record.text.slice(0, 600), references: record.references.map(ref => ({ ...ref })) }; }
function sameCitation(left: ContextCitation, right: ContextCitation): boolean { return left.sourceType === right.sourceType && left.author === right.author && left.timestamp === right.timestamp && left.permissionScope === right.permissionScope && left.dataClass === right.dataClass && left.excerpt === right.excerpt && JSON.stringify(left.references) === JSON.stringify(right.references); }
function summarize(values: readonly UnifiedContextRecord[]): string { if (!values.length) return 'No permitted Keystone objects found.'; const excerpts = values.slice(0, 3).map(value => `${value.sourceType} ${value.id}: ${value.text.slice(0, 180)}`); return `Found ${values.length} permitted Keystone source${values.length === 1 ? '' : 's'}. ${excerpts.join(' | ')}`; }
function estimateTokens(value: unknown): number { return Math.max(1, Math.ceil(String(value ?? '').length / 4)); }
const STOP_WORDS = new Set(['the', 'and', 'for', 'from', 'with', 'that', 'this', 'what', 'who', 'find', 'show', 'tell', 'about', 'sent', 'me', 'please', 'что', 'мне', 'про', 'как', 'был', 'была', 'было', 'или', 'это', 'из', 'на', 'в', 'и', 'с', 'у', 'о', 'мы', 'чем', 'говорили', 'решили', 'нужно', 'сделать', 'найди', 'покажи', 'расскажи', 'собери', 'прислал', 'прислала', 'присылал', 'сохранял', 'кто', 'друзей', 'сейчас', 'все']);
const TIME_TERMS = new Set(['yesterday', 'today', 'week', 'last', 'month', 'ago', 'вчера', 'сегодня', 'неделю', 'неделе', 'месяц', 'назад', 'прошлой', 'прошлый']);
const QUERY_ALIASES: Readonly<Record<string, string>> = { трек: 'track', трека: 'track', треки: 'track', файл: 'file', файлы: 'file', видео: 'video', ролик: 'video', шорт: 'short', shorts: 'short', эфир: 'live', профиль: 'profile', сообщество: 'community', сообщества: 'community', задача: 'task', задачи: 'task', сообщение: 'message', сообщения: 'message', пространство: 'space', плейлист: 'playlist' };
function tokenize(value: string): string[] { return value.toLocaleLowerCase().split(/[^\p{L}\p{N}_-]+/u).filter(Boolean).map(term => QUERY_ALIASES[term] ?? term); }
function resolveTimeRange(query: ContextQuery, records: readonly UnifiedContextRecord[], now: number): { after?: number; before?: number } { let after = query.after ? validateDate(query.after) : undefined; let before = query.before ? validateDate(query.before) : undefined; const terms = tokenize(query.text); const termSet = new Set(terms); if (termSet.has('yesterday') || termSet.has('вчера')) { const end = localDayStart(now, query.timezone ?? 'UTC'); after = end - 86_400_000; before = end; } else if (termSet.has('today') || termSet.has('сегодня')) { after = localDayStart(now, query.timezone ?? 'UTC'); before = now; } else if (termSet.has('last') && termSet.has('week') || termSet.has('прошлой') && (termSet.has('неделю') || termSet.has('неделе'))) { before = now; after = now - 7 * 86_400_000; } else if (termSet.has('month') && (termSet.has('ago') || termSet.has('last')) || termSet.has('месяц') && termSet.has('назад')) { before = now; after = now - 30 * 86_400_000; } const afterIndex = terms.findIndex(term => term === 'after' || term === 'после'); const beforeIndex = terms.findIndex(term => term === 'before' || term === 'до'); if (query.afterObjectId) { const record = records.find(value => value.id === query.afterObjectId); if (record) after = Date.parse(record.timestamp); } else if (afterIndex >= 0 && terms[afterIndex + 1]) { const record = records.find(value => value.id === terms[afterIndex + 1]); if (record) after = Date.parse(record.timestamp); } if (query.beforeObjectId) { const record = records.find(value => value.id === query.beforeObjectId); if (record) before = Date.parse(record.timestamp); } else if (beforeIndex >= 0 && terms[beforeIndex + 1]) { const record = records.find(value => value.id === terms[beforeIndex + 1]); if (record) before = Date.parse(record.timestamp); } return { after, before }; }
function inRange(record: UnifiedContextRecord, range: { after?: number; before?: number }): boolean { const at = Date.parse(record.timestamp); return (range.after === undefined || at >= range.after) && (range.before === undefined || at < range.before); }
function localDayStart(timestamp: number, timezone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const parts = Object.fromEntries(formatter.formatToParts(new Date(timestamp)).map(part => [part.type, part.value]));
  const utcMidnightGuess = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
  const atGuess = Object.fromEntries(formatter.formatToParts(new Date(utcMidnightGuess)).map(part => [part.type, part.value]));
  const offset = Date.UTC(Number(atGuess.year), Number(atGuess.month) - 1, Number(atGuess.day), Number(atGuess.hour), Number(atGuess.minute), Number(atGuess.second)) - utcMidnightGuess;
  return utcMidnightGuess - offset;
}
function clamp(value: number, min: number, max: number): number { return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.floor(value))) : min; }
function isObject(value: unknown): value is Record<string, any> { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }
function requiresSharedSafety(visibility: UnifiedContextRecord['visibility'] | KeystoneObject['visibility']): boolean { return visibility === 'contacts' || visibility === 'community' || visibility === 'public'; }
function contextDomain(visibility: KeystoneObject['visibility']): ContentDomain { if (visibility === 'contacts') return 'DIRECT_SHARED'; if (visibility === 'community') return 'COMMUNITY'; return 'PUBLIC'; }
function contextRequest(record: UnifiedContextRecord): SafetyEvaluationRequest {
  return { objectId: record.id, domain: contextDomain(record.visibility as KeystoneObject['visibility']), content: record.text, text: record.text, sourceType: 'object', verified: true, authorized: true, sharing: true };
}
