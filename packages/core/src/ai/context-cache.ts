/**
 * Context and KV cache lifecycle for many AgentSession instances.
 *
 * Agent identity, durable sessions and Memory are intentionally outside this
 * module.  KV is a disposable optimization: every COLD session can be
 * reconstructed from a model-independent ContextSnapshot and the existing
 * ContextBuilder boundary.
 */

import type {
  AgentContextCandidate,
  AgentContextCapability,
  ContextBuildResult,
  ContextBuilder,
} from './agents.js';
import { ContextBudget } from './agents.js';
import type { AIContextItem, AIDataClass, AIModelRef } from './privacy.js';
import {
  AIResourceScheduler,
  type InferenceExecutionContext,
  type InferenceJobRequest,
  type ModelLease,
  type ResourceMode,
} from './resource-scheduler.js';

export const AI_CONTEXT_CACHE_VERSION = 1 as const;

export const CONTEXT_TIERS = ['HOT', 'WARM', 'COLD', 'FROZEN'] as const;
export type ContextTier = (typeof CONTEXT_TIERS)[number];
export type ContextPressureLevel = 'normal' | 'moderate' | 'high';

export const CONTEXT_RESTORE_SOURCES = ['HOT_KV', 'WARM_KV', 'SNAPSHOT', 'CONTEXT_BUILDER', 'EMPTY'] as const;
export type ContextRestoreSource = (typeof CONTEXT_RESTORE_SOURCES)[number];

export type ContextCacheErrorCode =
  | 'INVALID_ARGUMENT'
  | 'SESSION_NOT_FOUND'
  | 'DUPLICATE_SESSION'
  | 'CACHE_PRESSURE'
  | 'ACTIVE_SESSION'
  | 'CONTEXT_PRIVACY'
  | 'CONTEXT_TOO_LARGE'
  | 'INVALID_SNAPSHOT'
  | 'FAILED';

export class ContextCacheError extends Error {
  constructor(readonly code: ContextCacheErrorCode, message: string) {
    super(message);
    this.name = 'ContextCacheError';
  }
}

export interface ContextSessionRef {
  readonly sessionId: string;
  readonly agentId: string;
}

export interface ContextTurn {
  readonly id: string;
  readonly role: 'user' | 'assistant' | 'tool';
  readonly text: string;
  readonly dataClass: AIDataClass;
  readonly createdAt: string;
  readonly sourceIds?: readonly string[];
  readonly untrusted?: boolean;
}

export interface ContextProvenance {
  readonly sourceIds: readonly string[];
  readonly sourceKinds?: readonly string[];
  readonly dataClasses: readonly AIDataClass[];
  readonly trust: 'local' | 'user_explicit' | 'untrusted';
}

export interface ContextSummary {
  readonly text: string;
  readonly sourceTurnIds: readonly string[];
  readonly generatedBy: 'local' | 'personal_trusted' | 'deterministic';
  readonly provenance: ContextProvenance;
  readonly createdAt: string;
}

/** Model-independent durable representation. Raw backend KV is never required. */
export interface ContextSnapshot {
  readonly version: 1;
  readonly sessionId: string;
  readonly agentId: string;
  readonly namespace: string;
  readonly modelIndependent: true;
  readonly generation: number;
  readonly compactSummary?: ContextSummary;
  readonly recentTurns: readonly ContextTurn[];
  readonly referencedMemoryIds: readonly string[];
  readonly referencedObjectIds: readonly string[];
  readonly toolStateRefs: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface KVCacheLease {
  readonly version: 1;
  readonly id: string;
  readonly sessionId: string;
  readonly agentId: string;
  readonly model: AIModelRef;
  readonly tier: 'HOT' | 'WARM';
  readonly acquiredAt: string;
  readonly expiresAt: string;
  readonly estimatedRamBytes: number;
  readonly estimatedVramBytes: number;
  readonly interactive: boolean;
  readonly cancellable: true;
}

export interface SessionContextState extends ContextSessionRef {
  readonly version: 1;
  readonly namespace: string;
  readonly tier: ContextTier;
  readonly model?: AIModelRef;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastUsedAt?: string;
  readonly activeInference: boolean;
  readonly interactiveInference: boolean;
  /** Keeps the most recent user-interactive context warm when policy allows. */
  readonly interactivePinned: boolean;
  readonly activeLeaseCount: number;
  readonly estimatedContextTokens: number;
  readonly estimatedKvRamBytes: number;
  readonly estimatedKvVramBytes: number;
  readonly contextGeneration: number;
  readonly restoreRequired: boolean;
  /** Optional backend-specific KV handle. Never required for restore. */
  readonly portableKvLease?: KVCacheLease;
  readonly snapshot?: ContextSnapshot;
  readonly lastEvictionReason?: 'budget' | 'pressure' | 'gaming' | 'battery' | 'manual' | 'restart';
}

export interface ContextEvictionPolicy {
  readonly maxTotalKvRamBytes: number;
  readonly maxTotalKvVramBytes: number;
  readonly perSessionKvRamBytes: number;
  readonly perSessionKvVramBytes: number;
  readonly maxHotSessions: number;
  readonly maxWarmSessions: number;
  readonly warmIdleMs: number;
  readonly coldIdleMs: number;
  readonly frozenIdleMs: number;
  readonly keepInteractiveHot: boolean;
  readonly maxSnapshotTurns: number;
  readonly maxSnapshotTokens: number;
}

export interface ContextCandidate extends AIContextItem {
  readonly priority?: number;
  readonly tokenEstimate?: number;
  readonly untrusted?: boolean;
  readonly sourceKind?: string;
}

export interface ContextRestoreInput {
  readonly currentPrompt: string;
  readonly tokenBudget: number;
  readonly reservedOutputTokens?: number;
  readonly toolSchemaTokens?: number;
  readonly recentTurns?: readonly ContextTurn[];
  readonly retrievedContext?: readonly ContextCandidate[];
  readonly explicitAttachments?: readonly AIContextItem[];
  readonly referencedMemoryIds?: readonly string[];
  readonly referencedObjectIds?: readonly string[];
  readonly toolStateRefs?: readonly string[];
  readonly capabilities?: readonly AgentContextCapability[];
  readonly allowedDataClasses?: readonly AIDataClass[];
}

/** Inputs that bind a scheduler lease to one durable AgentSession namespace. */
export interface ContextAcquireInput extends ContextRestoreInput {
  readonly sessionId: string;
  readonly agentId: string;
  readonly namespace?: string;
  readonly estimatedKvRamBytes?: number;
  readonly estimatedKvVramBytes?: number;
  readonly interactive?: boolean;
}

export interface ContextRestorePlan {
  readonly version: 1;
  readonly sessionId: string;
  readonly agentId: string;
  readonly namespace: string;
  readonly model: AIModelRef;
  readonly source: ContextRestoreSource;
  readonly tier: ContextTier;
  readonly currentPrompt: string;
  readonly contextItems: readonly AIContextItem[];
  readonly snapshot?: ContextSnapshot;
  readonly estimatedTokens: number;
  readonly effectiveContextTokens: number;
  readonly reservedOutputTokens: number;
  readonly toolSchemaTokens: number;
  readonly omittedContextIds: readonly string[];
  readonly droppedRetrievedIds: readonly string[];
  readonly referencedMemoryIds: readonly string[];
  readonly referencedObjectIds: readonly string[];
  readonly toolStateRefs: readonly string[];
  readonly untrustedSourceIds: readonly string[];
  readonly requiresReconstruction: boolean;
}

export interface ContextSummarizer {
  readonly execution: 'local' | 'personal_trusted' | 'external';
  summarize(input: { session: ContextSessionRef; turns: readonly ContextTurn[]; previous?: ContextSummary; signal?: AbortSignal }): Promise<ContextSummary>;
}

export interface PortableKVCacheBackend {
  readonly id?: string;
  readonly portable: boolean;
  save?(lease: KVCacheLease): Promise<void>;
  restore?(lease: KVCacheLease): Promise<boolean>;
  discard?(session: ContextSessionRef): Promise<void>;
}

export interface ContextCacheStateStore {
  read(): Promise<unknown | undefined>;
  write(value: unknown): Promise<void>;
}

export class InMemoryContextCacheStateStore implements ContextCacheStateStore {
  private value?: unknown;
  async read(): Promise<unknown | undefined> { return this.value === undefined ? undefined : structuredClone(this.value); }
  async write(value: unknown): Promise<void> { this.value = structuredClone(value); }
}

export interface ContextCacheManagerOptions {
  readonly storage?: ContextCacheStateStore;
  readonly policy?: Partial<ContextEvictionPolicy>;
  readonly mode?: ResourceMode;
  readonly now?: () => number;
  readonly contextBuilder?: Pick<ContextBuilder, 'build'>;
  readonly summarizer?: ContextSummarizer;
  readonly kvBackend?: PortableKVCacheBackend;
}

interface ContextCacheSnapshot {
  readonly version: 1;
  readonly mode: ResourceMode;
  readonly policy: ContextEvictionPolicy;
  readonly sessions: readonly SessionContextState[];
}

const MODE_POLICIES: Record<ResourceMode, ContextEvictionPolicy> = {
  PERFORMANCE: { maxTotalKvRamBytes: 768 * 1024 * 1024, maxTotalKvVramBytes: 2 * 1024 * 1024 * 1024, perSessionKvRamBytes: 160 * 1024 * 1024, perSessionKvVramBytes: 512 * 1024 * 1024, maxHotSessions: 8, maxWarmSessions: 16, warmIdleMs: 10 * 60_000, coldIdleMs: 60 * 60_000, frozenIdleMs: 24 * 60 * 60_000, keepInteractiveHot: true, maxSnapshotTurns: 64, maxSnapshotTokens: 16_384 },
  BALANCED: { maxTotalKvRamBytes: 384 * 1024 * 1024, maxTotalKvVramBytes: 1024 * 1024 * 1024, perSessionKvRamBytes: 96 * 1024 * 1024, perSessionKvVramBytes: 256 * 1024 * 1024, maxHotSessions: 4, maxWarmSessions: 8, warmIdleMs: 5 * 60_000, coldIdleMs: 30 * 60_000, frozenIdleMs: 12 * 60 * 60_000, keepInteractiveHot: true, maxSnapshotTurns: 48, maxSnapshotTokens: 12_000 },
  GAMING: { maxTotalKvRamBytes: 128 * 1024 * 1024, maxTotalKvVramBytes: 256 * 1024 * 1024, perSessionKvRamBytes: 64 * 1024 * 1024, perSessionKvVramBytes: 128 * 1024 * 1024, maxHotSessions: 1, maxWarmSessions: 1, warmIdleMs: 30_000, coldIdleMs: 120_000, frozenIdleMs: 10 * 60_000, keepInteractiveHot: true, maxSnapshotTurns: 32, maxSnapshotTokens: 8_000 },
  BATTERY: { maxTotalKvRamBytes: 64 * 1024 * 1024, maxTotalKvVramBytes: 128 * 1024 * 1024, perSessionKvRamBytes: 32 * 1024 * 1024, perSessionKvVramBytes: 64 * 1024 * 1024, maxHotSessions: 1, maxWarmSessions: 0, warmIdleMs: 5_000, coldIdleMs: 30_000, frozenIdleMs: 5 * 60_000, keepInteractiveHot: true, maxSnapshotTurns: 24, maxSnapshotTokens: 6_000 },
};

function clone<T>(value: T): T { try { return structuredClone(value); } catch { return value; } }
function nowIso(now: () => number): string { return new Date(now()).toISOString(); }
function randomId(prefix: string): string { return `${prefix}-${crypto.randomUUID()}`; }
function safeId(value: unknown, max = 256): value is string { return typeof value === 'string' && value.length > 0 && value.length <= max && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value); }
function normalizeModel(value: AIModelRef): AIModelRef { if (!safeId(value.provider, 128) || !safeId(value.model, 128)) throw new ContextCacheError('INVALID_ARGUMENT', 'Invalid model reference'); return { provider: value.provider, model: value.model }; }
function boundedInt(value: number | undefined, min: number, max: number, fallback: number): number { return Number.isSafeInteger(value) ? Math.max(min, Math.min(max, value!)) : fallback; }
function boundedBytes(value: number | undefined, fallback: number): number { return boundedInt(value, 0, 64 * 1024 * 1024 * 1024, fallback); }
function estimateTokens(value: unknown): number { let text: string; try { text = typeof value === 'string' ? value : JSON.stringify(value) ?? String(value); } catch { text = '[unserializable]'; } return Math.max(1, Math.ceil(text.length / 4)); }
function unique(values: readonly string[] | undefined, max = 512): string[] { return [...new Set((values ?? []).filter(value => safeId(value)))].slice(0, max); }
function tokenEstimate(item: ContextCandidate): number { return Math.max(1, item.tokenEstimate ?? estimateTokens(item.value)); }
function priority(item: ContextCandidate): number { return Number.isFinite(item.priority) ? Math.max(-100, Math.min(100, item.priority!)) : 0; }
function isPrivate(dataClass: AIDataClass): boolean { return dataClass === 'PRIVATE' || dataClass === 'SECRET'; }
function isUntrustedSource(source: string | undefined): boolean { return source === 'web' || source === 'remote-agent' || source === 'file' || source === 'filesystem'; }
function isTerminalTier(tier: ContextTier): boolean { return tier === 'COLD' || tier === 'FROZEN'; }

function normalizePolicy(mode: ResourceMode, input?: Partial<ContextEvictionPolicy>): ContextEvictionPolicy {
  const base = MODE_POLICIES[mode];
  return {
    maxTotalKvRamBytes: boundedBytes(input?.maxTotalKvRamBytes, base.maxTotalKvRamBytes),
    maxTotalKvVramBytes: boundedBytes(input?.maxTotalKvVramBytes, base.maxTotalKvVramBytes),
    perSessionKvRamBytes: boundedBytes(input?.perSessionKvRamBytes, base.perSessionKvRamBytes),
    perSessionKvVramBytes: boundedBytes(input?.perSessionKvVramBytes, base.perSessionKvVramBytes),
    maxHotSessions: boundedInt(input?.maxHotSessions, 0, 256, base.maxHotSessions),
    maxWarmSessions: boundedInt(input?.maxWarmSessions, 0, 512, base.maxWarmSessions),
    warmIdleMs: boundedInt(input?.warmIdleMs, 0, 7 * 24 * 60 * 60_000, base.warmIdleMs),
    coldIdleMs: boundedInt(input?.coldIdleMs, 0, 30 * 24 * 60 * 60_000, base.coldIdleMs),
    frozenIdleMs: boundedInt(input?.frozenIdleMs, 0, 365 * 24 * 60 * 60_000, base.frozenIdleMs),
    keepInteractiveHot: input?.keepInteractiveHot ?? base.keepInteractiveHot,
    maxSnapshotTurns: boundedInt(input?.maxSnapshotTurns, 4, 512, base.maxSnapshotTurns),
    maxSnapshotTokens: boundedInt(input?.maxSnapshotTokens, 256, 128_000, base.maxSnapshotTokens),
  };
}

function validateRef(ref: ContextSessionRef): void { if (!safeId(ref.sessionId) || !safeId(ref.agentId)) throw new ContextCacheError('INVALID_ARGUMENT', 'Invalid context session identity'); }
function key(ref: ContextSessionRef): string { validateRef(ref); return `${ref.agentId}\u0000${ref.sessionId}`; }
function cloneContextItem(item: AIContextItem): AIContextItem { return { ...item, ...(item.source ? { source: item.source } : {}), value: clone(item.value) }; }
function cloneTurn(turn: ContextTurn): ContextTurn { return { ...turn, text: turn.text.slice(0, 1_000_000), ...(turn.sourceIds ? { sourceIds: unique(turn.sourceIds) } : {}) }; }

export class AIContextCacheManager {
  private readonly storage: ContextCacheStateStore;
  private readonly now: () => number;
  private readonly contextBuilder?: Pick<ContextBuilder, 'build'>;
  private readonly summarizer?: ContextSummarizer;
  private readonly kvBackend?: PortableKVCacheBackend;
  private readonly sessions = new Map<string, SessionContextState>();
  private readonly leases = new Map<string, KVCacheLease>();
  private writes: Promise<void> = Promise.resolve();
  private readonly readyPromise: Promise<void>;
  private mode: ResourceMode;
  private policy: ContextEvictionPolicy;

  constructor(options: ContextCacheManagerOptions = {}) {
    this.storage = options.storage ?? new InMemoryContextCacheStateStore(); this.now = options.now ?? Date.now; this.mode = options.mode ?? 'BALANCED'; this.policy = normalizePolicy(this.mode, options.policy); this.contextBuilder = options.contextBuilder; this.summarizer = options.summarizer; this.kvBackend = options.kvBackend; this.readyPromise = this.hydrate();
  }

  async ready(): Promise<void> { await this.readyPromise; }
  get currentMode(): ResourceMode { return this.mode; }
  get currentPolicy(): ContextEvictionPolicy { return clone(this.policy); }

  async registerSession(input: ContextSessionRef & { namespace?: string; model?: AIModelRef }): Promise<SessionContextState> {
    await this.ready(); validateRef(input); const id = key(input); if (this.sessions.has(id)) throw new ContextCacheError('DUPLICATE_SESSION', `Context session ${input.sessionId} already exists for ${input.agentId}`);
    const timestamp = nowIso(this.now); const state: SessionContextState = { version: 1, sessionId: input.sessionId, agentId: input.agentId, namespace: input.namespace ?? `${input.agentId}:${input.sessionId}`, tier: 'COLD', ...(input.model ? { model: normalizeModel(input.model) } : {}), createdAt: timestamp, updatedAt: timestamp, activeInference: false, interactiveInference: false, interactivePinned: false, activeLeaseCount: 0, estimatedContextTokens: 0, estimatedKvRamBytes: 0, estimatedKvVramBytes: 0, contextGeneration: 0, restoreRequired: true };
    this.sessions.set(id, state); await this.persist(); return clone(state);
  }

  async ensureSession(input: ContextSessionRef & { namespace?: string; model?: AIModelRef }): Promise<SessionContextState> {
    await this.ready(); const existing = this.sessions.get(key(input)); return existing ? clone(existing) : this.registerSession(input);
  }

  getSession(ref: ContextSessionRef): SessionContextState | undefined { const value = this.sessions.get(key(ref)); return value ? clone(value) : undefined; }
  listSessions(): readonly SessionContextState[] { return [...this.sessions.values()].sort((a, b) => (b.lastUsedAt ?? b.updatedAt).localeCompare(a.lastUsedAt ?? a.updatedAt)).map(clone); }

  async setMode(mode: ResourceMode): Promise<void> {
    await this.ready(); this.mode = mode; this.policy = normalizePolicy(mode); for (const state of this.sessions.values()) { if (mode === 'GAMING' && !state.interactivePinned && !state.interactiveInference && (state.tier === 'HOT' || state.tier === 'WARM')) this.evictInternal(state, 'gaming'); if (mode === 'BATTERY' && !state.interactivePinned && !state.interactiveInference && state.tier !== 'COLD' && state.tier !== 'FROZEN') this.evictInternal(state, 'battery'); } await this.enforceBudgets(); await this.persist();
  }

  /** Host resource adapters call this when RAM/VRAM pressure changes. */
  async applyMemoryPressure(level: ContextPressureLevel): Promise<void> {
    await this.ready();
    if (level === 'high') {
      for (const state of this.sessions.values()) if (!state.activeInference && !state.interactiveInference && !state.interactivePinned && state.tier === 'WARM') this.evictInternal(state, 'pressure');
      for (const state of this.sessions.values()) if (!state.activeInference && !state.interactiveInference && !state.interactivePinned && state.tier === 'HOT') this.evictInternal(state, 'pressure');
    } else if (level === 'moderate') {
      for (const state of this.sessions.values()) if (!state.activeInference && !state.interactiveInference && !state.interactivePinned && state.tier === 'WARM') this.evictInternal(state, 'pressure');
    }
    await this.enforceBudgets(); await this.persist();
  }

  getUsage(): { totalKvRamBytes: number; totalKvVramBytes: number; hotSessions: number; warmSessions: number; coldSessions: number; frozenSessions: number } {
    return { totalKvRamBytes: this.totalRam(), totalKvVramBytes: this.totalVram(), hotSessions: this.hotCount(), warmSessions: this.warmCount(), coldSessions: [...this.sessions.values()].filter(state => state.tier === 'COLD').length, frozenSessions: [...this.sessions.values()].filter(state => state.tier === 'FROZEN').length };
  }

  async saveSnapshot(ref: ContextSessionRef, input: Omit<ContextSnapshot, 'version' | 'sessionId' | 'agentId' | 'namespace' | 'modelIndependent' | 'generation' | 'createdAt' | 'updatedAt'> & { generation?: number }): Promise<ContextSnapshot> {
    await this.ready(); const state = this.require(ref); const timestamp = nowIso(this.now); const snapshot = this.validateSnapshot({ ...input, version: 1, sessionId: state.sessionId, agentId: state.agentId, namespace: state.namespace, modelIndependent: true, generation: input.generation ?? state.contextGeneration + 1, createdAt: state.snapshot?.createdAt ?? timestamp, updatedAt: timestamp }); this.update(ref, { snapshot, contextGeneration: snapshot.generation, restoreRequired: state.tier === 'COLD' || state.tier === 'FROZEN' }); await this.persist(); return clone(snapshot);
  }

  async appendTurn(ref: ContextSessionRef, turn: ContextTurn, refs: { memoryIds?: readonly string[]; objectIds?: readonly string[]; toolStateRefs?: readonly string[] } = {}): Promise<SessionContextState> {
    await this.ready(); const state = this.require(ref); const snapshot = state.snapshot ?? this.emptySnapshot(state); const nextTurns = [...snapshot.recentTurns, cloneTurn(turn)].slice(-this.policy.maxSnapshotTurns); const next: ContextSnapshot = { ...snapshot, recentTurns: nextTurns, referencedMemoryIds: unique([...snapshot.referencedMemoryIds, ...(refs.memoryIds ?? [])]), referencedObjectIds: unique([...snapshot.referencedObjectIds, ...(refs.objectIds ?? [])]), toolStateRefs: unique([...snapshot.toolStateRefs, ...(refs.toolStateRefs ?? [])]), updatedAt: nowIso(this.now), generation: snapshot.generation + 1 }; this.update(ref, { snapshot: next, contextGeneration: next.generation, estimatedContextTokens: estimateSnapshotTokens(next), updatedAt: nowIso(this.now), restoreRequired: state.tier === 'COLD' || state.tier === 'FROZEN' }); if (estimateSnapshotTokens(next) > this.policy.maxSnapshotTokens && nextTurns.length > 4) await this.compact(ref, { turns: nextTurns }); await this.persist(); return clone(this.require(ref));
  }

  async compact(ref: ContextSessionRef, input: { turns?: readonly ContextTurn[]; signal?: AbortSignal } = {}): Promise<ContextSnapshot> {
    await this.ready(); const state = this.require(ref); const snapshot = state.snapshot ?? this.emptySnapshot(state); const turns = (input.turns ?? snapshot.recentTurns).map(cloneTurn); let summary: ContextSummary;
    if (this.summarizer) { if (this.summarizer.execution === 'external' && turns.some(turn => isPrivate(turn.dataClass))) throw new ContextCacheError('CONTEXT_PRIVACY', 'Private session summaries must use local or trusted execution'); summary = await this.summarizer.summarize({ session: ref, turns, previous: snapshot.compactSummary, signal: input.signal }); summary = sanitizeSummary(summary, turns, this.now); }
    else summary = deterministicSummary(ref, turns, this.now);
    summary = boundSummary(summary, this.policy.maxSnapshotTokens);
    const next: ContextSnapshot = { ...snapshot, compactSummary: summary, recentTurns: turns.slice(-Math.min(8, this.policy.maxSnapshotTurns)), generation: snapshot.generation + 1, updatedAt: nowIso(this.now) }; this.update(ref, { snapshot: next, contextGeneration: next.generation, estimatedContextTokens: estimateSnapshotTokens(next), updatedAt: nowIso(this.now) }); await this.persist(); return clone(next);
  }

  async acquire(lease: ModelLease, input: ContextAcquireInput): Promise<{ lease: KVCacheLease; plan: ContextRestorePlan }> {
    await this.ready(); validateRef(input); const session = this.findSessionForLease(input);
    const state = session.state; const model = normalizeModel(lease.model); const interactive = input.interactive ?? lease.priority === 'USER_INTERACTIVE';
    if (state.model && (state.model.provider !== model.provider || state.model.model !== model.model)) { if (state.activeInference) throw new ContextCacheError('ACTIVE_SESSION', 'Cannot change model while a session is running'); this.evictInternal(state, 'manual'); }
    const ram = Math.min(this.policy.perSessionKvRamBytes, Math.max(0, input.estimatedKvRamBytes ?? estimateKvBytes(input.tokenBudget, false))); const vram = Math.min(this.policy.perSessionKvVramBytes, Math.max(0, input.estimatedKvVramBytes ?? estimateKvBytes(input.tokenBudget, true)));
    await this.ensureCapacity(ram, vram, session.session, interactive);
    const timestamp = nowIso(this.now); const cacheLease: KVCacheLease = { version: 1, id: randomId('kv-lease'), sessionId: state.sessionId, agentId: state.agentId, model, tier: 'HOT', acquiredAt: timestamp, expiresAt: new Date(this.now() + Math.max(100, Date.parse(lease.expiresAt) - this.now())).toISOString(), estimatedRamBytes: ram, estimatedVramBytes: vram, interactive, cancellable: true };
    this.leases.set(cacheLease.id, cacheLease); this.updateRefState(state, { model, tier: 'HOT', activeInference: true, interactiveInference: interactive || state.interactiveInference, activeLeaseCount: state.activeLeaseCount + 1, estimatedKvRamBytes: ram, estimatedKvVramBytes: vram, estimatedContextTokens: Math.min(input.tokenBudget, this.policy.maxSnapshotTokens), lastUsedAt: timestamp, updatedAt: timestamp, restoreRequired: false, portableKvLease: undefined });
    const portableLease = state.portableKvLease;
    let source: ContextRestoreSource = state.tier === 'HOT' && !state.restoreRequired ? 'HOT_KV' : state.tier === 'WARM' && this.kvBackend?.portable ? (await this.kvBackend.restore?.(portableLease ?? cacheLease) ? 'WARM_KV' : 'SNAPSHOT') : state.snapshot ? 'SNAPSHOT' : 'EMPTY';
    const plan = await this.buildPlan(state, model, source, input, interactive); source = plan.source;
    await this.persist(); return { lease: clone(cacheLease), plan: clone({ ...plan, source }) };
  }

  async release(lease: KVCacheLease | string, result: { estimatedContextTokens?: number; keepWarm?: boolean; interactive?: boolean } = {}): Promise<SessionContextState> {
    await this.ready(); const id = typeof lease === 'string' ? lease : lease.id; const cached = this.leases.get(id); if (!cached) throw new ContextCacheError('INVALID_ARGUMENT', 'Unknown KV cache lease'); this.leases.delete(id); const state = this.require({ sessionId: cached.sessionId, agentId: cached.agentId }); const nextCount = Math.max(0, state.activeLeaseCount - 1); const timestamp = nowIso(this.now); const wasInteractive = result.interactive ?? cached.interactive; const keepHot = nextCount > 0 || (result.keepWarm === false ? false : this.policy.keepInteractiveHot && wasInteractive); const nextTier: ContextTier = nextCount > 0 ? 'HOT' : keepHot ? 'HOT' : this.policy.maxWarmSessions > 0 ? 'WARM' : 'COLD'; const portableKvLease = !keepHot && this.kvBackend?.portable && nextTier === 'WARM' ? cached : undefined; if (portableKvLease) await this.kvBackend!.save?.(portableKvLease); this.updateRefState(state, { activeInference: nextCount > 0, interactiveInference: nextCount > 0 && state.interactiveInference, interactivePinned: state.interactivePinned || (wasInteractive && this.policy.keepInteractiveHot), activeLeaseCount: nextCount, tier: nextTier, estimatedContextTokens: result.estimatedContextTokens ?? state.estimatedContextTokens, estimatedKvRamBytes: nextTier === 'COLD' ? 0 : state.estimatedKvRamBytes, estimatedKvVramBytes: nextTier === 'COLD' ? 0 : state.estimatedKvVramBytes, lastUsedAt: timestamp, updatedAt: timestamp, restoreRequired: nextTier === 'COLD', portableKvLease }); await this.enforceBudgets(); await this.persist(); return clone(this.require({ sessionId: cached.sessionId, agentId: cached.agentId }));
  }

  async runWithScheduler<T>(scheduler: AIResourceScheduler, request: Omit<InferenceJobRequest<T>, 'handler'> & { sessionId: string; agentId: string }, context: ContextRestoreInput & { estimatedKvRamBytes?: number; estimatedKvVramBytes?: number; interactive?: boolean }, handler: (plan: ContextRestorePlan, execution: InferenceExecutionContext) => Promise<T>): Promise<T> {
    return scheduler.run({ ...request, handler: async execution => { const registered = this.require({ sessionId: request.sessionId, agentId: request.agentId }); const acquired = await this.acquire(execution.lease, { ...context, sessionId: request.sessionId, agentId: request.agentId, namespace: registered.namespace, interactive: context.interactive ?? execution.job.priority === 'USER_INTERACTIVE' }); try { return await handler(acquired.plan, execution); } finally { await this.release(acquired.lease, { interactive: context.interactive ?? execution.job.priority === 'USER_INTERACTIVE' }); } } });
  }

  async restore(ref: ContextSessionRef, model: AIModelRef, input: ContextRestoreInput): Promise<ContextRestorePlan> { await this.ready(); const state = this.require(ref); const source: ContextRestoreSource = state.snapshot ? 'SNAPSHOT' : 'EMPTY'; return this.buildPlan(state, normalizeModel(model), source, input, false); }

  async evict(ref: ContextSessionRef, reason: 'manual' | 'pressure' = 'manual'): Promise<SessionContextState> { await this.ready(); const state = this.require(ref); if (state.activeInference || state.interactiveInference) throw new ContextCacheError('ACTIVE_SESSION', 'Active inference context cannot be evicted'); this.evictInternal(state, reason); await this.persist(); return clone(this.require(ref)); }
  async evictSession(ref: ContextSessionRef, reason: 'manual' | 'pressure' = 'manual'): Promise<SessionContextState> { return this.evict(ref, reason); }
  async clearRuntimeCache(ref: ContextSessionRef): Promise<SessionContextState> { return this.evict(ref, 'manual'); }

  async sweep(): Promise<void> { await this.ready(); const now = this.now(); for (const [id, lease] of this.leases) if (Date.parse(lease.expiresAt) <= now) { this.leases.delete(id); const state = this.sessions.get(key(lease)); if (state && state.activeLeaseCount > 0) this.updateRefState(state, { activeLeaseCount: state.activeLeaseCount - 1, activeInference: state.activeLeaseCount > 1 }); } for (const state of this.sessions.values()) { if (state.activeInference || !state.lastUsedAt) continue; const age = now - Date.parse(state.lastUsedAt); if (state.tier === 'HOT' && age >= this.policy.warmIdleMs) this.demote(state, this.policy.maxWarmSessions > 0 ? 'WARM' : 'COLD', 'budget'); else if (state.tier === 'WARM' && age >= this.policy.coldIdleMs) this.evictInternal(state, 'budget'); else if (state.tier === 'COLD' && age >= this.policy.frozenIdleMs) this.updateRefState(state, { tier: 'FROZEN', restoreRequired: true, lastEvictionReason: 'budget', updatedAt: nowIso(this.now) }); } await this.enforceBudgets(); await this.persist(); }

  async snapshot(): Promise<readonly SessionContextState[]> { await this.ready(); return this.listSessions(); }

  private findSessionForLease(input: Pick<ContextAcquireInput, 'sessionId' | 'agentId' | 'namespace'>): { state: SessionContextState; session: ContextSessionRef } {
    const found = this.sessions.get(key(input));
    if (!found || (input.namespace !== undefined && found.namespace !== input.namespace)) throw new ContextCacheError('SESSION_NOT_FOUND', 'Scheduler lease must identify one registered AgentSession');
    return { state: found, session: { sessionId: found.sessionId, agentId: found.agentId } };
  }

  private async buildPlan(state: SessionContextState, model: AIModelRef, source: ContextRestoreSource, input: ContextRestoreInput, interactive: boolean): Promise<ContextRestorePlan> {
    const reserved = boundedInt(input.reservedOutputTokens, 0, input.tokenBudget, Math.min(1_024, Math.floor(input.tokenBudget * .2))); const schema = boundedInt(input.toolSchemaTokens, 0, input.tokenBudget - reserved, 0); const effective = Math.max(1, input.tokenBudget - reserved - schema); const snapshot = state.snapshot; const recent = input.recentTurns ?? snapshot?.recentTurns ?? []; const candidates: ContextCandidate[] = [];
    if (snapshot?.compactSummary) candidates.push({ id: `summary:${state.sessionId}:${snapshot.generation}`, dataClass: snapshot.compactSummary.provenance.dataClasses.includes('PRIVATE') ? 'PRIVATE' : 'USER_EXPLICIT', source: 'context-summary', value: snapshot.compactSummary.text, priority: 80, tokenEstimate: estimateTokens(snapshot.compactSummary.text), untrusted: snapshot.compactSummary.provenance.trust === 'untrusted', sourceKind: 'summary' });
    for (const turn of recent) candidates.push({ id: turn.id, dataClass: turn.dataClass, source: 'agent-session', value: { role: turn.role, text: turn.text }, priority: turn.role === 'user' ? 70 : 50, tokenEstimate: estimateTokens(turn.text), untrusted: turn.untrusted, sourceKind: 'turn' });
    for (const item of input.retrievedContext ?? []) candidates.push({ ...cloneContextItem(item), priority: priority(item), tokenEstimate: tokenEstimate(item), untrusted: item.untrusted ?? isUntrustedSource(item.sourceKind ?? item.source), sourceKind: item.sourceKind ?? item.source });
    const attachments = (input.explicitAttachments ?? []).map(item => ({ ...cloneContextItem(item), priority: 100, tokenEstimate: estimateTokens(item.value), untrusted: false, sourceKind: 'explicit-attachment' } satisfies ContextCandidate));
    const selected = selectCandidates([...attachments, ...candidates], effective); const contextItems: AIContextItem[] = [];
    if (this.contextBuilder && input.capabilities && input.allowedDataClasses) {
      const history: AgentContextCandidate[] = recent.map(turn => ({ id: turn.id, dataClass: turn.dataClass, source: 'agent-session', value: { role: turn.role, text: turn.text }, capability: 'HISTORY', priority: turn.role === 'user' ? 70 : 50, relevance: 1, explicit: turn.role === 'user', createdAt: turn.createdAt }));
      const built: ContextBuildResult = await this.contextBuilder.build({ sessionId: state.sessionId, agentId: state.agentId, query: input.currentPrompt, capabilities: input.capabilities, allowedDataClasses: input.allowedDataClasses, budget: new ContextBudget({ maxTokens: effective }), history, attachments: input.explicitAttachments });
      contextItems.push(...built.items.map(cloneContextItem));
    } else contextItems.push(...selected.items.map(cloneContextItem));
    const selectedIds = new Set(contextItems.map(item => item.id)); const untrusted = [...contextItems.filter(item => item.source === 'context-summary' || isUntrustedSource(item.source)).map(item => item.id), ...(input.retrievedContext ?? []).filter(item => selectedIds.has(item.id) && (item.untrusted || isUntrustedSource(item.sourceKind ?? item.source))).map(item => item.id)];
    const retrievedIds = (input.retrievedContext ?? []).map(item => item.id); const omitted = [...selected.omittedIds, ...selected.truncatedIds]; const droppedRetrievedIds = retrievedIds.filter(id => !contextItems.some(item => item.id === id));
    return { version: 1, sessionId: state.sessionId, agentId: state.agentId, namespace: state.namespace, model, source: this.contextBuilder ? 'CONTEXT_BUILDER' : source, tier: interactive ? 'HOT' : state.tier, currentPrompt: input.currentPrompt.slice(0, 1_000_000), contextItems, ...(snapshot ? { snapshot: clone(snapshot) } : {}), estimatedTokens: Math.min(effective, contextItems.reduce((sum, item) => sum + estimateTokens(item.value), 0)), effectiveContextTokens: effective, reservedOutputTokens: reserved, toolSchemaTokens: schema, omittedContextIds: unique(omitted), droppedRetrievedIds: unique(droppedRetrievedIds), referencedMemoryIds: unique([...(snapshot?.referencedMemoryIds ?? []), ...(input.referencedMemoryIds ?? [])]), referencedObjectIds: unique([...(snapshot?.referencedObjectIds ?? []), ...(input.referencedObjectIds ?? [])]), toolStateRefs: unique([...(snapshot?.toolStateRefs ?? []), ...(input.toolStateRefs ?? [])]), untrustedSourceIds: unique(untrusted), requiresReconstruction: source === 'SNAPSHOT' || source === 'CONTEXT_BUILDER' || source === 'EMPTY' };
  }

  private async ensureCapacity(ram: number, vram: number, protectedRef: ContextSessionRef, interactive: boolean): Promise<void> {
    const over = () => this.totalRam() + ram > this.policy.maxTotalKvRamBytes || this.totalVram() + vram > this.policy.maxTotalKvVramBytes || this.hotCount() >= this.policy.maxHotSessions && !this.sessions.get(key(protectedRef))?.activeInference;
    if (!over()) return;
    const candidates = [...this.sessions.values()].filter(state => !state.activeInference && !(interactive && (state.interactiveInference || state.interactivePinned)) && key(state) !== key(protectedRef)).sort((a, b) => (a.lastUsedAt ?? a.updatedAt).localeCompare(b.lastUsedAt ?? b.updatedAt));
    for (const state of candidates) { if (state.tier === 'WARM') this.evictInternal(state, 'pressure'); else if (state.tier === 'HOT' && this.policy.maxWarmSessions > this.warmCount()) this.demote(state, 'WARM', 'budget'); else if (state.tier === 'HOT') this.evictInternal(state, 'pressure'); if (!over()) break; }
    if (over() && !interactive) throw new ContextCacheError('CACHE_PRESSURE', 'No context cache capacity is available');
  }
  private async enforceBudgets(): Promise<void> { const candidates = [...this.sessions.values()].filter(state => !state.activeInference && !state.interactivePinned).sort((a, b) => (a.lastUsedAt ?? a.updatedAt).localeCompare(b.lastUsedAt ?? b.updatedAt)); for (const state of candidates) { if (this.warmCount() > this.policy.maxWarmSessions && state.tier === 'WARM') this.evictInternal(state, 'budget'); if (this.hotCount() > this.policy.maxHotSessions && state.tier === 'HOT') this.policy.maxWarmSessions > this.warmCount() ? this.demote(state, 'WARM', 'budget') : this.evictInternal(state, 'budget'); if (this.totalRam() > this.policy.maxTotalKvRamBytes || this.totalVram() > this.policy.maxTotalKvVramBytes) this.evictInternal(state, 'pressure'); } }
  private totalRam(): number { return [...this.sessions.values()].reduce((sum, state) => sum + state.estimatedKvRamBytes, 0); }
  private totalVram(): number { return [...this.sessions.values()].reduce((sum, state) => sum + state.estimatedKvVramBytes, 0); }
  private hotCount(): number { return [...this.sessions.values()].filter(state => state.tier === 'HOT').length; }
  private warmCount(): number { return [...this.sessions.values()].filter(state => state.tier === 'WARM').length; }
  private demote(state: SessionContextState, tier: 'WARM' | 'COLD', reason: SessionContextState['lastEvictionReason']): void {
    let portableKvLease: KVCacheLease | undefined;
    if (tier === 'WARM' && this.kvBackend?.portable) {
      portableKvLease = { version: 1, id: randomId('warm'), sessionId: state.sessionId, agentId: state.agentId, model: state.model ?? { provider: 'unknown', model: 'unknown' }, tier: 'WARM', acquiredAt: nowIso(this.now), expiresAt: new Date(this.now() + this.policy.warmIdleMs).toISOString(), estimatedRamBytes: state.estimatedKvRamBytes, estimatedVramBytes: state.estimatedKvVramBytes, interactive: false, cancellable: true };
      void this.kvBackend.save?.(portableKvLease);
    }
    this.updateRefState(state, { tier, estimatedKvRamBytes: tier === 'COLD' ? 0 : state.estimatedKvRamBytes, estimatedKvVramBytes: tier === 'COLD' ? 0 : state.estimatedKvVramBytes, restoreRequired: tier === 'COLD', portableKvLease, lastEvictionReason: reason, updatedAt: nowIso(this.now) });
  }
  private evictInternal(state: SessionContextState, reason: SessionContextState['lastEvictionReason']): void { if (state.activeInference) return; void this.kvBackend?.discard?.({ sessionId: state.sessionId, agentId: state.agentId }); this.updateRefState(state, { tier: 'COLD', estimatedKvRamBytes: 0, estimatedKvVramBytes: 0, restoreRequired: true, portableKvLease: undefined, lastEvictionReason: reason, updatedAt: nowIso(this.now) }); }
  private updateRefState(state: SessionContextState, patch: Partial<SessionContextState>): void { const id = key(state); this.sessions.set(id, { ...state, ...patch, updatedAt: patch.updatedAt ?? nowIso(this.now) } as SessionContextState); }
  private update(ref: ContextSessionRef, patch: Partial<SessionContextState>): void { const state = this.require(ref); this.updateRefState(state, patch); }
  private require(ref: ContextSessionRef): SessionContextState { const state = this.sessions.get(key(ref)); if (!state) throw new ContextCacheError('SESSION_NOT_FOUND', `Context session ${ref.sessionId} was not found`); return state; }
  private emptySnapshot(state: SessionContextState): ContextSnapshot { const timestamp = nowIso(this.now); return { version: 1, sessionId: state.sessionId, agentId: state.agentId, namespace: state.namespace, modelIndependent: true, generation: state.contextGeneration, recentTurns: [], referencedMemoryIds: [], referencedObjectIds: [], toolStateRefs: [], createdAt: timestamp, updatedAt: timestamp }; }
  private validateSnapshot(value: unknown): ContextSnapshot { if (!value || typeof value !== 'object') throw new ContextCacheError('INVALID_SNAPSHOT', 'Invalid ContextSnapshot'); const candidate = value as ContextSnapshot; if (candidate.version !== 1 || candidate.modelIndependent !== true || !safeId(candidate.sessionId) || !safeId(candidate.agentId) || !safeId(candidate.namespace) || !Number.isSafeInteger(candidate.generation) || !Array.isArray(candidate.recentTurns)) throw new ContextCacheError('INVALID_SNAPSHOT', 'Invalid ContextSnapshot shape'); const recentTurns = candidate.recentTurns.slice(-this.policy.maxSnapshotTurns).map(turn => { if (!turn || !safeId(turn.id) || !['user', 'assistant', 'tool'].includes(turn.role) || typeof turn.text !== 'string' || !['PUBLIC', 'USER_EXPLICIT', 'PRIVATE', 'SECRET'].includes(turn.dataClass)) throw new ContextCacheError('INVALID_SNAPSHOT', 'Invalid context turn'); return cloneTurn(turn); }); return { version: 1, sessionId: candidate.sessionId, agentId: candidate.agentId, namespace: candidate.namespace, modelIndependent: true, generation: candidate.generation, ...(candidate.compactSummary ? { compactSummary: sanitizeSummary(candidate.compactSummary, recentTurns, this.now) } : {}), recentTurns, referencedMemoryIds: unique(candidate.referencedMemoryIds), referencedObjectIds: unique(candidate.referencedObjectIds), toolStateRefs: unique(candidate.toolStateRefs), createdAt: candidate.createdAt, updatedAt: candidate.updatedAt }; }
  private async hydrate(): Promise<void> { const raw = await this.storage.read(); if (!raw) return; const snapshot = parseCacheSnapshot(raw); this.mode = snapshot.mode; this.policy = snapshot.policy; for (const state of snapshot.sessions) { const durableSnapshot = state.snapshot ? this.validateSnapshot(state.snapshot) : undefined; this.sessions.set(key(state), { ...state, ...(durableSnapshot ? { snapshot: durableSnapshot } : {}), interactivePinned: state.interactivePinned ?? false, tier: 'COLD', activeInference: false, interactiveInference: false, activeLeaseCount: 0, estimatedKvRamBytes: 0, estimatedKvVramBytes: 0, restoreRequired: true, lastEvictionReason: 'restart', updatedAt: nowIso(this.now) }); } }
  private async persist(): Promise<void> { const operation = this.writes.then(() => this.storage.write({ version: 1, mode: this.mode, policy: this.policy, sessions: [...this.sessions.values()].map(clone) } satisfies ContextCacheSnapshot)); this.writes = operation.catch(() => undefined); await operation; }
}

function estimateKvBytes(tokens: number, vram: boolean): number { const safeTokens = Math.max(1, Math.min(128_000, tokens)); return Math.max(1 * 1024 * 1024, safeTokens * (vram ? 8_192 : 16_384)); }
function estimateSnapshotTokens(snapshot: ContextSnapshot): number { return estimateTokens({ summary: snapshot.compactSummary?.text, turns: snapshot.recentTurns }); }
function selectCandidates(candidates: readonly ContextCandidate[], budget: number): { items: AIContextItem[]; omittedIds: string[]; truncatedIds: string[] } {
  const uniqueCandidates = new Map<string, ContextCandidate>(); for (const candidate of candidates) { if (!safeId(candidate.id)) continue; const existing = uniqueCandidates.get(candidate.id); if (!existing || priority(candidate) > priority(existing)) uniqueCandidates.set(candidate.id, candidate); }
  const ordered = [...uniqueCandidates.values()].sort((a, b) => priority(b) - priority(a) || a.id.localeCompare(b.id)); let remaining = budget; const items: AIContextItem[] = []; const omittedIds: string[] = []; const truncatedIds: string[] = [];
  for (const candidate of ordered) { const estimate = tokenEstimate(candidate); if (estimate <= remaining) { items.push(cloneContextItem(candidate)); remaining -= estimate; continue; } if (candidate.sourceKind === 'explicit-attachment' || candidate.priority === 100) { const text = typeof candidate.value === 'string' ? candidate.value : JSON.stringify(candidate.value) ?? String(candidate.value); const truncated = text.slice(0, Math.max(1, remaining * 4)); items.push({ ...cloneContextItem(candidate), value: truncated }); truncatedIds.push(candidate.id); remaining = Math.max(0, remaining - Math.ceil(truncated.length / 4)); continue; } omittedIds.push(candidate.id); }
  return { items, omittedIds, truncatedIds };
}
function sanitizeSummary(summary: ContextSummary, turns: readonly ContextTurn[], now: () => number): ContextSummary { if (!summary || typeof summary.text !== 'string' || summary.text.length > 64_000) throw new ContextCacheError('INVALID_SNAPSHOT', 'Invalid context summary'); const sourceTurnIds = unique(summary.sourceTurnIds?.length ? summary.sourceTurnIds : turns.map(turn => turn.id)); const dataClasses = [...new Set(summary.provenance?.dataClasses ?? turns.filter(turn => sourceTurnIds.includes(turn.id)).map(turn => turn.dataClass))] as AIDataClass[]; return { text: summary.text.slice(0, 64_000), sourceTurnIds, generatedBy: summary.generatedBy === 'personal_trusted' ? 'personal_trusted' : summary.generatedBy === 'local' ? 'local' : 'deterministic', provenance: { sourceIds: unique(summary.provenance?.sourceIds ?? sourceTurnIds), sourceKinds: unique(summary.provenance?.sourceKinds), dataClasses: dataClasses.length ? dataClasses : ['PRIVATE'], trust: summary.provenance?.trust === 'untrusted' ? 'untrusted' : summary.provenance?.trust === 'user_explicit' ? 'user_explicit' : 'local' }, createdAt: summary.createdAt || nowIso(now) }; }
function boundSummary(summary: ContextSummary, maxTokens: number): ContextSummary { return { ...summary, text: summary.text.slice(0, Math.max(256, maxTokens * 4)) }; }
function deterministicSummary(ref: ContextSessionRef, turns: readonly ContextTurn[], now: () => number): ContextSummary { const text = turns.slice(-8).map(turn => `${turn.role}: ${turn.text}`).join('\n').slice(0, 16_000); return { text: `Local compact summary for ${ref.agentId}/${ref.sessionId}:\n${text}`, sourceTurnIds: turns.map(turn => turn.id), generatedBy: 'deterministic', provenance: { sourceIds: turns.flatMap(turn => turn.sourceIds ?? [turn.id]).slice(0, 512), dataClasses: [...new Set(turns.map(turn => turn.dataClass))], trust: turns.some(turn => turn.untrusted) ? 'untrusted' : 'local' }, createdAt: nowIso(now) }; }
function parseCacheSnapshot(value: unknown): ContextCacheSnapshot { if (!value || typeof value !== 'object' || (value as { version?: unknown }).version !== 1 || !Array.isArray((value as { sessions?: unknown }).sessions) || !((value as { policy?: unknown }).policy)) throw new ContextCacheError('FAILED', 'Invalid context cache state'); const candidate = value as ContextCacheSnapshot; if (!['PERFORMANCE', 'BALANCED', 'GAMING', 'BATTERY'].includes(candidate.mode)) throw new ContextCacheError('FAILED', 'Invalid context cache mode'); const policy = normalizePolicy(candidate.mode, candidate.policy); const sessions = candidate.sessions.map(state => { validateRef(state); if (state.version !== 1 || !safeId(state.namespace) || !CONTEXT_TIERS.includes(state.tier) || !Number.isSafeInteger(state.contextGeneration)) throw new ContextCacheError('FAILED', 'Invalid context session state'); return clone({ ...state, interactivePinned: state.interactivePinned ?? false, ...(state.snapshot ? { snapshot: state.snapshot } : {}) }); }); return { version: 1, mode: candidate.mode, policy, sessions }; }
