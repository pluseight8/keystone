/**
 * Local-first Personal AI memory.
 *
 * Memory is deliberately an additive layer above RAG and AgentRuntime.  RAG
 * remains a search/index primitive; this module owns durable, user-visible
 * memories, provenance, consolidation and privacy.  No method in this module
 * sends memory to an external provider.
 */

import { ContextBudget, type AgentContextCandidate, type AgentContextSource, type AgentContextSourceRequest } from './agents.js';
import type { AIContextItem, AIDataClass } from './privacy.js';
import { LocalHashEmbeddingProvider, type EmbeddingProvider } from '../rag.js';
import type { ChronosAction, ChronosRunContext, ChronosWorkflowRunner } from '../agents/chronos.js';
import { SecretRedactionPolicy, secureRandomId } from '../security/secrets.js';

export const MEMORY_VERSION = 1 as const;
export const MEMORY_CHRONOS_PREFIX = 'keystone-memory-consolidation:';
export const MEMORY_KINDS = ['episodic', 'semantic', 'preference', 'relationship', 'project'] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];
export const MEMORY_ASSERTIONS = ['fact', 'assumption', 'preference'] as const;
export type MemoryAssertion = (typeof MEMORY_ASSERTIONS)[number];
export const MEMORY_SOURCE_TYPES = ['message', 'file', 'community', 'track', 'video', 'agent_session', 'user_statement', 'other'] as const;
export type MemorySourceType = (typeof MEMORY_SOURCE_TYPES)[number];

export const MEMORY_PRIVACY_ORDER: readonly AIDataClass[] = ['PUBLIC', 'USER_EXPLICIT', 'PRIVATE', 'SECRET'];

export interface MemorySourceRef {
  readonly type: MemorySourceType;
  readonly id: string;
  readonly label?: string;
  readonly objectType?: string;
}

/** A bounded observation supplied by an existing Keystone source adapter. */
export interface MemoryObservation {
  readonly id: string;
  readonly text: string;
  readonly source: MemorySourceRef;
  readonly dataClass: AIDataClass;
  readonly occurredAt: string;
  readonly explicit?: boolean;
  readonly importance?: number;
  readonly sourceTrust?: number;
  readonly kindHint?: MemoryKind;
}

export interface MemoryCandidate {
  readonly kind: MemoryKind;
  readonly assertion: MemoryAssertion;
  readonly summary: string;
  readonly value?: unknown;
  readonly subject?: string;
  readonly predicate?: string;
  readonly sources: readonly MemorySourceRef[];
  readonly confidence: number;
  readonly importance: number;
  /** This is treated as a lower bound; source data classes can only make it stricter. */
  readonly privacyClass: AIDataClass;
  /** Automatic model output can never make a memory explicit or pinned. */
  readonly explicit?: boolean;
  readonly createdAt?: string;
}

export interface MemoryEntry {
  readonly version: 1;
  readonly id: string;
  readonly kind: MemoryKind;
  readonly assertion: MemoryAssertion;
  readonly summary: string;
  readonly value?: unknown;
  readonly subject?: string;
  readonly predicate?: string;
  readonly sources: readonly MemorySourceRef[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly confidence: number;
  readonly importance: number;
  readonly privacyClass: AIDataClass;
  readonly explicit: boolean;
  readonly pinned: boolean;
  readonly incorrect: boolean;
  readonly supersedes: readonly string[];
  readonly supersededBy: readonly string[];
  readonly conflictsWith: readonly string[];
}

export interface CreateMemoryInput {
  readonly id?: string;
  readonly kind: MemoryKind;
  readonly assertion: MemoryAssertion;
  readonly summary: string;
  readonly value?: unknown;
  readonly subject?: string;
  readonly predicate?: string;
  readonly sources?: readonly MemorySourceRef[];
  readonly confidence?: number;
  readonly importance?: number;
  readonly privacyClass?: AIDataClass;
}

export interface UpdateMemoryInput {
  readonly summary?: string;
  readonly value?: unknown;
  readonly kind?: MemoryKind;
  readonly assertion?: MemoryAssertion;
  readonly subject?: string;
  readonly predicate?: string;
  readonly confidence?: number;
  readonly importance?: number;
  readonly privacyClass?: AIDataClass;
}

export interface MemoryQuery {
  readonly query?: string;
  readonly kind?: MemoryKind;
  readonly source?: MemorySourceRef;
  readonly privacyClasses?: readonly AIDataClass[];
  readonly pinnedOnly?: boolean;
  readonly includeSuperseded?: boolean;
  readonly includeIncorrect?: boolean;
  readonly limit?: number;
  readonly maxTokens?: number;
}

export interface MemorySearchResult {
  readonly entry: MemoryEntry;
  readonly score: number;
  readonly semanticScore: number;
  readonly recencyScore: number;
  readonly sourceTrust: number;
  readonly reasons: readonly string[];
}

export interface MemoryExplanation {
  readonly entry: MemoryEntry;
  readonly reason: string;
  readonly sources: readonly MemorySourceRef[];
  readonly relatedMemoryIds: readonly string[];
}

export interface MemorySettings {
  readonly version: 1;
  readonly automaticMemoryEnabled: boolean;
}

export interface MemorySnapshot {
  readonly version: 1;
  readonly settings: MemorySettings;
  readonly entries: readonly MemoryEntry[];
}

export interface MemoryStateStore {
  read(): Promise<unknown | undefined>;
  write(value: unknown): Promise<void>;
}

export class InMemoryMemoryStateStore implements MemoryStateStore {
  private value?: unknown;
  async read(): Promise<unknown | undefined> { return this.value === undefined ? undefined : structuredClone(this.value); }
  async write(value: unknown): Promise<void> { this.value = structuredClone(value); }
}

export type MemoryModelExecution = 'local' | 'personal_trusted' | 'external';

export interface MemoryModelRequest {
  readonly observations: readonly MemoryObservation[];
  readonly signal?: AbortSignal;
}

export interface MemoryModelResponse {
  readonly candidates: readonly MemoryCandidate[];
}

/** Host-provided local model boundary. External execution is rejected before propose() is called. */
export interface MemoryModelGateway {
  readonly execution: MemoryModelExecution;
  propose(request: MemoryModelRequest): Promise<MemoryModelResponse>;
}

export interface MemoryConsolidationResult {
  readonly status: 'consolidated' | 'disabled' | 'rejected';
  readonly acceptedIds: readonly string[];
  readonly deduplicatedIds: readonly string[];
  readonly conflictedIds: readonly string[];
  readonly supersededIds: readonly string[];
  readonly rejected: readonly MemoryRejection[];
}

export interface MemoryRejection {
  readonly code: MemoryRejectionCode;
  readonly sourceIds?: readonly string[];
  readonly detail?: string;
}

export type MemoryRejectionCode =
  | 'EXTERNAL_MEMORY_FORBIDDEN'
  | 'AUTOMATIC_MEMORY_DISABLED'
  | 'INVALID_OBSERVATION'
  | 'INVALID_CANDIDATE'
  | 'UNTRUSTED_SOURCE'
  | 'SOURCE_PRIVACY_MISMATCH'
  | 'MODEL_UNAVAILABLE'
  | 'CANCELLED';

export class MemoryPrivacyError extends Error {
  constructor(readonly code: MemoryRejectionCode, message: string) {
    super(message);
    this.name = 'MemoryPrivacyError';
  }
}

export interface MemoryForgetPolicy {
  /** Explicit user memories survive source forgetting by default. */
  readonly preserveExplicit?: boolean;
}

export interface MemoryContextOptions {
  readonly maxTokens?: number;
  readonly privacyClasses?: readonly AIDataClass[];
}

export interface MemoryObservationSource {
  recent(limit: number): Promise<readonly MemoryObservation[]>;
}

/** An opt-in Chronos adapter. Scheduling remains owned by Chronos; this only runs one local job. */
export class LocalMemoryConsolidationRunner {
  constructor(
    private readonly memory: MemoryService,
    private readonly observations: MemoryObservationSource,
    private readonly gateway: MemoryModelGateway,
    private readonly limit = 128,
  ) {}

  async run(signal?: AbortSignal): Promise<MemoryConsolidationResult> {
    if (signal?.aborted) throw new MemoryPrivacyError('CANCELLED', 'Memory consolidation was cancelled');
    const values = await this.observations.recent(Math.max(1, Math.min(this.limit, 1_000)));
    return this.memory.consolidate(values, this.gateway, { signal });
  }
}

/**
 * Composable Chronos workflow adapter. It handles only instructions created by
 * `memoryConsolidationInstruction`; all other Chronos workflows remain owned by
 * the host's existing runner.
 */
export function createMemoryChronosWorkflow(runner: LocalMemoryConsolidationRunner): ChronosWorkflowRunner {
  return {
    async run(action: ChronosAction, context: ChronosRunContext): Promise<{ summary?: string } | void> {
      if (action.type !== 'ai.workflow' || !action.instruction.startsWith(MEMORY_CHRONOS_PREFIX)) return;
      const result = await runner.run(context.signal);
      return { summary: `Memory consolidation ${result.status}; accepted=${result.acceptedIds.length}; rejected=${result.rejected.length}` };
    },
  };
}

export function memoryConsolidationInstruction(name = 'default'): string {
  const suffix = name.trim().replace(/[^A-Za-z0-9._:-]/g, '-').slice(0, 96) || 'default';
  return `${MEMORY_CHRONOS_PREFIX}${suffix}`;
}

export class MemoryConsolidator {
  constructor(private readonly memory: MemoryService) {}

  async run(observations: readonly MemoryObservation[], gateway: MemoryModelGateway, signal?: AbortSignal): Promise<MemoryConsolidationResult> {
    return this.memory.consolidate(observations, gateway, { signal });
  }
}

export class MemoryService {
  private readonly entries = new Map<string, MemoryEntry>();
  private readonly embeddings = new Map<string, readonly number[]>();
  private readonly embedder: EmbeddingProvider;
  private readonly now: () => number;
  private readonly storage: MemoryStateStore;
  private settings: MemorySettings = { version: 1, automaticMemoryEnabled: true };
  private readyPromise: Promise<void>;
  private writes: Promise<void> = Promise.resolve();

  constructor(options: { storage?: MemoryStateStore; embedder?: EmbeddingProvider; now?: () => number; automaticMemoryEnabled?: boolean } = {}) {
    this.storage = options.storage ?? new InMemoryMemoryStateStore();
    this.embedder = options.embedder ?? new LocalHashEmbeddingProvider();
    this.now = options.now ?? Date.now;
    if (options.automaticMemoryEnabled !== undefined) this.settings = { version: 1, automaticMemoryEnabled: options.automaticMemoryEnabled };
    this.readyPromise = this.hydrate();
  }

  async ready(): Promise<void> { await this.readyPromise; }

  async settingsSnapshot(): Promise<MemorySettings> { await this.ready(); return clone(this.settings); }

  async setAutomaticMemoryEnabled(enabled: boolean): Promise<MemorySettings> {
    await this.ready();
    this.settings = { version: 1, automaticMemoryEnabled: !!enabled };
    await this.persist();
    return clone(this.settings);
  }

  async createExplicit(input: CreateMemoryInput): Promise<MemoryEntry> {
    await this.ready();
    const candidate = normalizeCandidate({ ...input, sources: input.sources ?? [{ type: 'user_statement', id: `local:${randomId()}` }], confidence: input.confidence ?? 1, importance: input.importance ?? 0.8, privacyClass: input.privacyClass ?? 'PRIVATE' }, true);
    if (this.entries.has(candidate.id ?? '')) throw new MemoryPrivacyError('INVALID_CANDIDATE', 'Memory id already exists');
    const value = this.buildEntry(candidate, true);
    this.entries.set(value.id, value);
    this.embeddings.delete(value.id);
    await this.persist();
    return clone(value);
  }

  async get(id: string): Promise<MemoryEntry | undefined> { await this.ready(); const value = this.entries.get(id); return value ? clone(value) : undefined; }

  async list(query: Omit<MemoryQuery, 'query' | 'maxTokens'> = {}): Promise<readonly MemoryEntry[]> {
    await this.ready();
    return [...this.entries.values()]
      .filter(entry => this.matches(entry, query))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))
      .slice(0, clampInt(query.limit ?? 200, 1, 1_000))
      .map(clone);
  }

  async search(query: string, options: Omit<MemoryQuery, 'query'> = {}): Promise<readonly MemorySearchResult[]> {
    await this.ready();
    const allowed = new Set<AIDataClass>(options.privacyClasses ?? ['PUBLIC', 'USER_EXPLICIT', 'PRIVATE']);
    const text = query.trim();
    const vector = text ? await this.embed(text) : undefined;
    const values: MemorySearchResult[] = [];
    for (const entry of this.entries.values()) {
      if (!allowed.has(entry.privacyClass) || !this.matches(entry, { ...options, privacyClasses: [...allowed] })) continue;
      const semanticScore = vector ? cosine(vector, await this.embeddingFor(entry)) : 0;
      const age = Math.max(0, this.now() - Date.parse(entry.updatedAt));
      const recencyScore = Number.isFinite(age) ? Math.max(0, 1 - age / (90 * 24 * 60 * 60 * 1_000)) : 0;
      const trust = sourceTrust(entry.sources, entry.explicit);
      const score = text ? semanticScore * 0.55 + entry.importance * 0.2 + recencyScore * 0.15 + trust * 0.1 : entry.importance * 0.45 + recencyScore * 0.35 + trust * 0.2;
      const reasons = [entry.explicit ? 'explicit user memory' : 'locally consolidated', `source trust ${trust.toFixed(2)}`];
      if (entry.pinned) reasons.push('pinned');
      if (entry.supersedes.length) reasons.push(`supersedes ${entry.supersedes.length}`);
      values.push({ entry: clone(entry), score, semanticScore, recencyScore, sourceTrust: trust, reasons });
    }
    values.sort((a, b) => b.score - a.score || b.entry.updatedAt.localeCompare(a.entry.updatedAt) || a.entry.id.localeCompare(b.entry.id));
    return values.slice(0, clampInt(options.limit ?? 32, 1, 256));
  }

  async context(query: string, options: MemoryContextOptions = {}): Promise<readonly AIContextItem[]> {
    const results = await this.search(query, { privacyClasses: options.privacyClasses, limit: 128 });
    const candidates: AgentContextCandidate[] = results.map(result => ({
      id: `memory:${result.entry.id}`,
      source: 'memory',
      label: result.entry.summary,
      dataClass: result.entry.privacyClass,
      value: { kind: result.entry.kind, assertion: result.entry.assertion, summary: result.entry.summary, value: cloneValue(result.entry.value), sources: result.entry.sources.map(source => ({ ...source })) },
      capability: 'MEMORY',
      priority: result.entry.pinned ? 2 : result.entry.importance,
      relevance: result.score,
      explicit: result.entry.explicit,
      createdAt: result.entry.updatedAt,
      tokenEstimate: estimateTokens(result.entry.summary) + estimateTokens(result.entry.value),
    }));
    return new ContextBudget({ maxTokens: clampInt(options.maxTokens ?? 2_048, 1, 128_000) }).select(candidates).items;
  }

  async explain(id: string): Promise<MemoryExplanation | undefined> {
    const entry = await this.get(id);
    if (!entry) return undefined;
    const reason = entry.explicit ? 'Created explicitly by the user.' : `Consolidated locally from ${entry.sources.length} provenance source${entry.sources.length === 1 ? '' : 's'}.`;
    return { entry, reason, sources: entry.sources, relatedMemoryIds: [...new Set([...entry.supersedes, ...entry.supersededBy, ...entry.conflictsWith])] };
  }

  async update(id: string, patch: UpdateMemoryInput): Promise<MemoryEntry> {
    await this.ready();
    const current = this.require(id);
    const candidate = normalizeCandidate({ ...current, ...patch, sources: current.sources, privacyClass: maxPrivacy(current.privacyClass, patch.privacyClass ?? current.privacyClass), confidence: patch.confidence ?? current.confidence, importance: patch.importance ?? current.importance }, current.explicit);
    const updated: MemoryEntry = { ...current, ...candidate, id: current.id, version: 1, updatedAt: timestamp(this.now()), explicit: current.explicit, pinned: current.pinned, incorrect: false, supersedes: current.supersedes, supersededBy: current.supersededBy, conflictsWith: current.conflictsWith };
    this.entries.set(id, updated);
    this.embeddings.delete(id);
    await this.persist();
    return clone(updated);
  }

  async setPinned(id: string, pinned: boolean): Promise<MemoryEntry> {
    await this.ready();
    const current = this.require(id);
    const updated = { ...current, pinned: !!pinned, updatedAt: timestamp(this.now()) };
    this.entries.set(id, updated);
    await this.persist();
    return clone(updated);
  }

  async markIncorrect(id: string): Promise<MemoryEntry> {
    await this.ready();
    const current = this.require(id);
    const updated = { ...current, incorrect: true, updatedAt: timestamp(this.now()) };
    this.entries.set(id, updated);
    await this.persist();
    return clone(updated);
  }

  async delete(id: string): Promise<boolean> {
    await this.ready();
    const deleted = this.removeEntry(id);
    if (deleted) await this.persist();
    return deleted;
  }

  async clearCategory(kind: MemoryKind): Promise<number> {
    await this.ready();
    let count = 0;
    for (const [id, entry] of [...this.entries]) if (entry.kind === kind && this.removeEntry(id)) count += 1;
    if (count) await this.persist();
    return count;
  }

  async forgetSource(source: MemorySourceRef, policy: MemoryForgetPolicy = {}): Promise<readonly string[]> {
    await this.ready();
    const removed: string[] = [];
    let changed = false;
    for (const [id, entry] of this.entries) {
      if (!entry.sources.some(value => sameSource(value, source))) continue;
      const remaining = entry.sources.filter(value => !sameSource(value, source));
      if (remaining.length) {
        this.entries.set(id, { ...entry, sources: remaining, updatedAt: timestamp(this.now()) });
        changed = true;
        continue;
      }
      if (entry.explicit && policy.preserveExplicit !== false) {
        this.entries.set(id, { ...entry, sources: [{ type: 'user_statement', id: `local:${id}`, label: 'Source forgotten; retained by user policy' }], updatedAt: timestamp(this.now()) });
        changed = true;
      } else {
        if (this.removeEntry(id)) { removed.push(id); changed = true; }
      }
    }
    if (changed) await this.persist();
    return removed;
  }

  async forgetConversation(id: string, policy?: MemoryForgetPolicy): Promise<readonly string[]> { return this.forgetSource({ type: 'message', id }, policy); }

  async consolidate(observations: readonly MemoryObservation[], gateway: MemoryModelGateway, options: { signal?: AbortSignal } = {}): Promise<MemoryConsolidationResult> {
    await this.ready();
    if (!this.settings.automaticMemoryEnabled) return emptyConsolidation('disabled');
    if (!gateway || typeof gateway.propose !== 'function') throw new MemoryPrivacyError('MODEL_UNAVAILABLE', 'A local memory model is not configured');
    if (gateway.execution === 'external') throw new MemoryPrivacyError('EXTERNAL_MEMORY_FORBIDDEN', 'External AI cannot read or write private memory');
    if (gateway.execution !== 'local' && gateway.execution !== 'personal_trusted') throw new MemoryPrivacyError('MODEL_UNAVAILABLE', 'No local memory model is available');
    if (options.signal?.aborted) throw new MemoryPrivacyError('CANCELLED', 'Memory consolidation was cancelled');
    const validObservations: MemoryObservation[] = [];
    const rejected: MemoryRejection[] = [];
    for (const observation of observations.slice(0, 1_000)) {
      const result = validateObservation(observation);
      if (result) validObservations.push(result); else rejected.push({ code: 'INVALID_OBSERVATION', detail: observation?.id });
    }
    if (!validObservations.length) return { ...emptyConsolidation('rejected'), rejected };
    let response: MemoryModelResponse;
    try { response = await gateway.propose({ observations: validObservations.map(clone), signal: options.signal }); } catch (error) {
      if (options.signal?.aborted) throw new MemoryPrivacyError('CANCELLED', 'Memory consolidation was cancelled');
      throw new MemoryPrivacyError('MODEL_UNAVAILABLE', error instanceof Error ? error.message : 'Local memory model failed');
    }
    if (!response || !Array.isArray(response.candidates)) return { ...emptyConsolidation('rejected'), rejected: [...rejected, { code: 'INVALID_CANDIDATE', detail: 'model response' }] };
    const sourceMap = new Map(validObservations.map(observation => [sourceKey(observation.source), observation]));
    const outcomes: { accepted?: string; deduplicated?: string; conflicted?: string; superseded?: string }[] = [];
    for (const raw of response.candidates.slice(0, 256)) {
      const candidate = normalizeAutomaticCandidate(raw, sourceMap);
      if (!candidate) { rejected.push({ code: 'INVALID_CANDIDATE' }); continue; }
      outcomes.push(this.mergeCandidate(candidate));
    }
    if (outcomes.length) await this.persist();
    return { status: 'consolidated', acceptedIds: outcomes.flatMap(value => value.accepted ? [value.accepted] : []), deduplicatedIds: outcomes.flatMap(value => value.deduplicated ? [value.deduplicated] : []), conflictedIds: outcomes.flatMap(value => value.conflicted ? [value.conflicted] : []), supersededIds: outcomes.flatMap(value => value.superseded ? [value.superseded] : []), rejected };
  }

  /** Internal host hook for tests/adapters that already performed local extraction. */
  async ingestLocalCandidates(candidates: readonly MemoryCandidate[], observations: readonly MemoryObservation[], execution: Exclude<MemoryModelExecution, 'external'> = 'local'): Promise<MemoryConsolidationResult> {
    await this.ready();
    if (!this.settings.automaticMemoryEnabled) return emptyConsolidation('disabled');
    if (execution !== 'local' && execution !== 'personal_trusted') throw new MemoryPrivacyError('EXTERNAL_MEMORY_FORBIDDEN', 'External AI cannot write memory');
    const sourceMap = new Map(observations.flatMap(observation => { const value = validateObservation(observation); return value ? [[sourceKey(value.source), value] as const] : []; }));
    const rejected: MemoryRejection[] = [];
    const outcomes: { accepted?: string; deduplicated?: string; conflicted?: string; superseded?: string }[] = [];
    for (const raw of candidates) { const candidate = normalizeAutomaticCandidate(raw, sourceMap); if (!candidate) rejected.push({ code: 'INVALID_CANDIDATE' }); else outcomes.push(this.mergeCandidate(candidate)); }
    if (outcomes.length) await this.persist();
    return { status: 'consolidated', acceptedIds: outcomes.flatMap(value => value.accepted ? [value.accepted] : []), deduplicatedIds: outcomes.flatMap(value => value.deduplicated ? [value.deduplicated] : []), conflictedIds: outcomes.flatMap(value => value.conflicted ? [value.conflicted] : []), supersededIds: outcomes.flatMap(value => value.superseded ? [value.superseded] : []), rejected };
  }

  private mergeCandidate(candidate: NormalizedCandidate): { accepted?: string; deduplicated?: string; conflicted?: string; superseded?: string } {
    const fingerprint = memoryFingerprint(candidate);
    const duplicate = [...this.entries.values()].find(entry => memoryFingerprint(entry) === fingerprint && !entry.incorrect);
    if (duplicate) {
      const mergedSources = uniqueSources([...duplicate.sources, ...candidate.sources]);
      this.entries.set(duplicate.id, { ...duplicate, sources: mergedSources, confidence: Math.max(duplicate.confidence, candidate.confidence), importance: Math.max(duplicate.importance, candidate.importance), privacyClass: maxPrivacy(duplicate.privacyClass, candidate.privacyClass), updatedAt: timestamp(this.now()) });
      return { deduplicated: duplicate.id };
    }
    const id = candidate.id ?? `memory-${fnv64(fingerprint)}`;
    const conflicts = [...this.entries.values()].filter(entry => !entry.incorrect && entry.subject && entry.predicate && candidate.subject && candidate.predicate && entry.subject === candidate.subject && entry.predicate === candidate.predicate && memoryFingerprint(entry) !== fingerprint);
    const entry = this.buildEntry({ ...candidate, id }, false);
    let superseded = false;
    for (const conflict of conflicts) {
      const conflictIds = uniqueIds([...conflict.conflictsWith, entry.id]);
      this.entries.set(conflict.id, { ...conflict, conflictsWith: conflictIds, ...(this.winnerScore(entry) > this.winnerScore(conflict) ? { supersededBy: uniqueIds([...conflict.supersededBy, entry.id]) } : {}), updatedAt: timestamp(this.now()) });
      if (this.winnerScore(entry) > this.winnerScore(conflict)) { entry.supersedes = uniqueIds([...entry.supersedes, conflict.id]); superseded = true; }
    }
    if (conflicts.length) entry.conflictsWith = conflicts.map(value => value.id);
    this.entries.set(id, entry);
    this.embeddings.delete(id);
    return superseded ? { accepted: id, superseded: id, conflicted: id } : conflicts.length ? { accepted: id, conflicted: id } : { accepted: id };
  }

  private buildEntry(candidate: NormalizedCandidate, explicit: boolean): MutableMemoryEntry {
    const now = timestamp(this.now());
    return { version: 1, id: candidate.id ?? `memory-${randomId()}`, kind: candidate.kind, assertion: candidate.assertion, summary: candidate.summary, ...(candidate.value === undefined ? {} : { value: cloneValue(candidate.value) }), ...(candidate.subject ? { subject: candidate.subject } : {}), ...(candidate.predicate ? { predicate: candidate.predicate } : {}), sources: uniqueSources(candidate.sources), createdAt: candidate.createdAt ?? now, updatedAt: now, confidence: candidate.confidence, importance: candidate.importance, privacyClass: candidate.privacyClass, explicit, pinned: false, incorrect: false, supersedes: [], supersededBy: [], conflictsWith: [] };
  }

  private winnerScore(entry: MemoryEntry): number { return entry.confidence * 0.6 + entry.importance * 0.3 + sourceTrust(entry.sources, entry.explicit) * 0.1 + Math.max(0, 1 - Math.max(0, this.now() - Date.parse(entry.updatedAt)) / (365 * 24 * 60 * 60 * 1_000)) * 0.05; }

  private matches(entry: MemoryEntry, query: Omit<MemoryQuery, 'query' | 'maxTokens'>): boolean {
    if (!query.includeIncorrect && entry.incorrect) return false;
    if (!query.includeSuperseded && entry.supersededBy.length) return false;
    if (query.kind && entry.kind !== query.kind) return false;
    if (query.pinnedOnly && !entry.pinned) return false;
    if (query.privacyClasses && !query.privacyClasses.includes(entry.privacyClass)) return false;
    if (query.source && !entry.sources.some(source => sameSource(source, query.source!))) return false;
    return true;
  }

  private async embeddingFor(entry: MemoryEntry): Promise<readonly number[]> {
    const cached = this.embeddings.get(entry.id);
    if (cached) return cached;
    const value = await this.embed(`${entry.kind} ${entry.assertion} ${entry.subject ?? ''} ${entry.predicate ?? ''} ${entry.summary} ${stringify(entry.value)}`);
    this.embeddings.set(entry.id, value);
    return value;
  }

  private async embed(text: string): Promise<readonly number[]> { return normalizeVector(await this.embedder.embed(text)); }

  private async hydrate(): Promise<void> {
    const raw = await this.storage.read();
    if (raw === undefined) return;
    const snapshot = parseSnapshot(raw);
    this.settings = snapshot.settings;
    this.entries.clear();
    for (const entry of snapshot.entries) this.entries.set(entry.id, entry);
  }

  private async persist(): Promise<void> {
    const snapshot: MemorySnapshot = { version: 1, settings: clone(this.settings), entries: [...this.entries.values()].map(clone) };
    const operation = this.writes.then(() => this.storage.write(snapshot));
    this.writes = operation.catch(() => undefined);
    await operation;
  }

  private require(id: string): MemoryEntry { const value = this.entries.get(id); if (!value) throw new Error(`Memory entry not found: ${id}`); return value; }

  private removeEntry(id: string): boolean {
    const deleted = this.entries.delete(id);
    this.embeddings.delete(id);
    if (!deleted) return false;
    for (const [relatedId, related] of this.entries) {
      const next: MemoryEntry = { ...related, supersedes: related.supersedes.filter(value => value !== id), supersededBy: related.supersededBy.filter(value => value !== id), conflictsWith: related.conflictsWith.filter(value => value !== id) };
      if (next.supersedes.length !== related.supersedes.length || next.supersededBy.length !== related.supersededBy.length || next.conflictsWith.length !== related.conflictsWith.length) this.entries.set(relatedId, { ...next, updatedAt: timestamp(this.now()) });
    }
    return true;
  }
}

/** Capability adapter consumed by the existing Agent ContextBuilder. */
export class MemoryContextSource implements AgentContextSource {
  constructor(private readonly memory: MemoryService, private readonly privacyClasses: readonly AIDataClass[] = ['PUBLIC', 'USER_EXPLICIT', 'PRIVATE'], private readonly maxTokens = 2_048) {}
  async read(request: AgentContextSourceRequest): Promise<readonly AgentContextCandidate[]> {
    if (request.capability !== 'MEMORY') return [];
    const items = await this.memory.context(request.query ?? '', { maxTokens: this.maxTokens, privacyClasses: this.privacyClasses });
    return items.map(item => ({ ...item, capability: 'MEMORY', priority: item.dataClass === 'PRIVATE' ? 1 : 0.8, relevance: 1, createdAt: new Date().toISOString() }));
  }
}

type NormalizedCandidate = Omit<MemoryCandidate, 'explicit'> & { readonly id?: string; readonly explicit: boolean; readonly supersedes: string[] };
type MutableMemoryEntry = { -readonly [K in keyof MemoryEntry]: MemoryEntry[K] };

function normalizeCandidate(value: CreateMemoryInput | (MemoryCandidate & { readonly id?: string }), explicit: boolean): NormalizedCandidate {
  if (SecretRedactionPolicy.containsManagedSecret(value)) throw new MemoryPrivacyError('INVALID_CANDIDATE', 'Managed secrets cannot be stored in Personal Memory');
  if (!value || !MEMORY_KINDS.includes(value.kind) || !MEMORY_ASSERTIONS.includes(value.assertion) || typeof value.summary !== 'string' || !value.summary.trim() || value.summary.length > 4_000 || !Array.isArray(value.sources) || !value.sources.length) throw new MemoryPrivacyError('INVALID_CANDIDATE', 'Invalid memory candidate');
  if (!AI_DATA_CLASSES.includes(value.privacyClass as AIDataClass)) throw new MemoryPrivacyError('INVALID_CANDIDATE', 'Invalid memory privacy class');
  if (value.value !== undefined && stringify(value.value).length > 64_000) throw new MemoryPrivacyError('INVALID_CANDIDATE', 'Memory value is too large');
  const sources = uniqueSources(value.sources.map(validateSource));
  if (!sources.length) throw new MemoryPrivacyError('INVALID_CANDIDATE', 'Memory provenance is required');
  return { id: 'id' in value && value.id ? assertId(value.id) : undefined, kind: value.kind, assertion: value.assertion, summary: value.summary.trim(), ...(value.value === undefined ? {} : { value: cloneValue(value.value) }), ...(value.subject ? { subject: normalizePart(value.subject, 'subject') } : {}), ...(value.predicate ? { predicate: normalizePart(value.predicate, 'predicate') } : {}), sources, confidence: clamp01(value.confidence ?? (explicit ? 1 : 0.5)), importance: clamp01(value.importance ?? (explicit ? 0.8 : 0.5)), privacyClass: value.privacyClass ?? (explicit ? 'PRIVATE' : 'PRIVATE'), explicit, createdAt: 'createdAt' in value && value.createdAt ? validTimestamp(value.createdAt) : undefined, supersedes: [] };
}

function normalizeAutomaticCandidate(value: unknown, sourceMap: ReadonlyMap<string, MemoryObservation>): NormalizedCandidate | undefined {
  try {
    if (!value || typeof value !== 'object') return undefined;
    const candidate = value as MemoryCandidate;
    if (!Array.isArray(candidate.sources) || candidate.sources.some(source => !sourceMap.has(sourceKey(source)))) return undefined;
    const normalized = normalizeCandidate({ ...candidate, sources: candidate.sources, explicit: false }, false);
    const observations = normalized.sources.map(source => sourceMap.get(sourceKey(source))!).filter(Boolean);
    if (!observations.length) return undefined;
    const derivedPrivacy = observations.reduce<AIDataClass>((current, observation) => maxPrivacy(current, observation.dataClass), 'PUBLIC');
    return { ...normalized, privacyClass: maxPrivacy(derivedPrivacy, normalized.privacyClass), explicit: false };
  } catch { return undefined; }
}

function validateObservation(value: MemoryObservation): MemoryObservation | undefined {
  try {
    if (!value || SecretRedactionPolicy.containsManagedSecret(value) || !safeId(value.id) || typeof value.text !== 'string' || !value.text.trim() || value.text.length > 32_000 || !AI_DATA_CLASSES.includes(value.dataClass) || !validTimestamp(value.occurredAt) || !validateSource(value.source)) return undefined;
    return { ...value, source: validateSource(value.source), text: value.text.trim(), importance: clamp01(value.importance ?? 0.5), sourceTrust: clamp01(value.sourceTrust ?? sourceTrust([value.source], !!value.explicit)) };
  } catch { return undefined; }
}

function validateSource(value: MemorySourceRef): MemorySourceRef {
  if (!value || !MEMORY_SOURCE_TYPES.includes(value.type) || !safeId(value.id)) throw new MemoryPrivacyError('INVALID_CANDIDATE', 'Invalid memory source');
  return { type: value.type, id: value.id, ...(value.label ? { label: value.label.slice(0, 240) } : {}), ...(value.objectType ? { objectType: value.objectType.slice(0, 120) } : {}) };
}

function parseSnapshot(value: unknown): MemorySnapshot {
  if (!value || typeof value !== 'object' || (value as { version?: unknown }).version !== 1) throw new MemoryPrivacyError('INVALID_CANDIDATE', 'Invalid memory state version');
  const candidate = value as Partial<MemorySnapshot>;
  if (!candidate.settings || candidate.settings.version !== 1 || typeof candidate.settings.automaticMemoryEnabled !== 'boolean' || !Array.isArray(candidate.entries)) throw new MemoryPrivacyError('INVALID_CANDIDATE', 'Invalid memory state shape');
  const entries = candidate.entries.map(parseEntry);
  if (new Set(entries.map(entry => entry.id)).size !== entries.length) throw new MemoryPrivacyError('INVALID_CANDIDATE', 'Duplicate memory ids');
  return { version: 1, settings: { version: 1, automaticMemoryEnabled: candidate.settings.automaticMemoryEnabled }, entries };
}

function parseEntry(value: unknown): MemoryEntry {
  if (!value || typeof value !== 'object') throw new MemoryPrivacyError('INVALID_CANDIDATE', 'Invalid memory entry');
  if (SecretRedactionPolicy.containsManagedSecret(value)) throw new MemoryPrivacyError('INVALID_CANDIDATE', 'Managed secrets cannot be restored into Personal Memory');
  const entry = value as MemoryEntry;
  if (entry.version !== 1 || !safeId(entry.id) || !MEMORY_KINDS.includes(entry.kind) || !MEMORY_ASSERTIONS.includes(entry.assertion) || typeof entry.summary !== 'string' || !entry.summary.trim() || entry.summary.length > 4_000 || !validTimestamp(entry.createdAt) || !validTimestamp(entry.updatedAt) || !Array.isArray(entry.sources) || !entry.sources.length || !AI_DATA_CLASSES.includes(entry.privacyClass) || typeof entry.explicit !== 'boolean' || typeof entry.pinned !== 'boolean' || typeof entry.incorrect !== 'boolean' || !Array.isArray(entry.supersedes) || !Array.isArray(entry.supersededBy) || !Array.isArray(entry.conflictsWith) || !entry.supersedes.every(safeId) || !entry.supersededBy.every(safeId) || !entry.conflictsWith.every(safeId)) throw new MemoryPrivacyError('INVALID_CANDIDATE', 'Invalid memory entry');
  return clone({ ...entry, sources: uniqueSources(entry.sources.map(validateSource)), confidence: clamp01(entry.confidence), importance: clamp01(entry.importance), supersedes: uniqueIds(entry.supersedes), supersededBy: uniqueIds(entry.supersededBy), conflictsWith: uniqueIds(entry.conflictsWith) });
}

function emptyConsolidation(status: MemoryConsolidationResult['status']): MemoryConsolidationResult { return { status, acceptedIds: [], deduplicatedIds: [], conflictedIds: [], supersededIds: [], rejected: [] }; }
function memoryFingerprint(value: Pick<MemoryEntry | NormalizedCandidate, 'kind' | 'assertion' | 'summary' | 'value' | 'subject' | 'predicate'>): string { return `${value.kind}|${value.assertion}|${normalizeText(value.subject ?? '')}|${normalizeText(value.predicate ?? '')}|${normalizeText(value.summary)}|${normalizeText(stringify(value.value))}`; }
function sourceKey(value: MemorySourceRef): string { return `${value.type}:${value.id}`; }
function sameSource(a: MemorySourceRef, b: MemorySourceRef): boolean { return a.type === b.type && a.id === b.id; }
function uniqueSources(values: readonly MemorySourceRef[]): MemorySourceRef[] { const map = new Map<string, MemorySourceRef>(); for (const value of values) map.set(sourceKey(value), value); return [...map.values()].sort((a, b) => sourceKey(a).localeCompare(sourceKey(b))); }
function uniqueIds(values: readonly string[]): string[] { return [...new Set(values.filter(safeId))].sort(); }
function sourceTrust(sources: readonly MemorySourceRef[], explicit: boolean): number { if (explicit) return 1; if (!sources.length) return 0; const weights: Record<MemorySourceType, number> = { user_statement: 1, agent_session: 0.75, message: 0.65, file: 0.6, community: 0.55, track: 0.5, video: 0.5, other: 0.4 }; return sources.reduce((sum, source) => sum + weights[source.type], 0) / sources.length; }
function maxPrivacy(a: AIDataClass, b: AIDataClass): AIDataClass { return MEMORY_PRIVACY_ORDER[Math.max(MEMORY_PRIVACY_ORDER.indexOf(a), MEMORY_PRIVACY_ORDER.indexOf(b))]!; }
function normalizeText(value: string): string { return value.toLocaleLowerCase().replace(/\s+/g, ' ').trim(); }
function normalizePart(value: string, name: string): string { const text = value.trim(); if (!text || text.length > 256) throw new MemoryPrivacyError('INVALID_CANDIDATE', `Invalid ${name}`); return text; }
function safeId(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value); }
function assertId(value: string): string { if (!safeId(value)) throw new MemoryPrivacyError('INVALID_CANDIDATE', 'Invalid memory id'); return value; }
function validTimestamp(value: string): string { if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new MemoryPrivacyError('INVALID_CANDIDATE', 'Invalid memory timestamp'); return value; }
function timestamp(now: (() => number) | number): string { return new Date(typeof now === 'function' ? now() : now).toISOString(); }
function clamp01(value: number): number { return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0; }
function clampInt(value: number, min: number, max: number): number { return Number.isSafeInteger(value) ? Math.max(min, Math.min(max, value)) : min; }
function stringify(value: unknown): string { try { return JSON.stringify(value) ?? String(value); } catch { return '[unserializable]'; } }
function estimateTokens(value: unknown): number { return Math.max(1, Math.ceil(stringify(value).length / 4)); }
function clone<T>(value: T): T { return structuredClone(value); }
function cloneValue(value: unknown): unknown { try { return structuredClone(value); } catch { return String(value); } }
function normalizeVector(vector: readonly number[]): number[] { const values = vector.map(value => Number.isFinite(value) ? value : 0); const length = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0)) || 1; return values.map(value => value / length); }
function cosine(a: readonly number[], b: readonly number[]): number { if (a.length !== b.length) return 0; return Math.max(0, Math.min(1, a.reduce((sum, value, index) => sum + value * (b[index] ?? 0), 0))); }
function randomId(): string { return secureRandomId('memory'); }
function fnv64(value: string): string { let hash = 14695981039346656037n; for (const byte of new TextEncoder().encode(value)) { hash ^= BigInt(byte); hash = BigInt.asUintN(64, hash * 1099511628211n); } return hash.toString(16).padStart(16, '0'); }
function isPlainRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }

const AI_DATA_CLASSES: readonly AIDataClass[] = ['PUBLIC', 'USER_EXPLICIT', 'PRIVATE', 'SECRET'];
