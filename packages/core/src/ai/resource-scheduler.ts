/**
 * Unified local AI resource scheduler.
 *
 * Models are compute resources; agents remain the owners of identity, state,
 * context and capabilities.  This module deliberately does not inspect or
 * merge prompts/contexts.  A job handler receives one isolated session
 * request and a lease for a shared model runtime.
 */

import { formatAIModelRef, parseAIModelRef, type AIModelRef, type AIProvider, type AIProviderRequest, type AIProviderResponse } from './privacy.js';
import type { AgentModelGateway, AgentModelRequest, AgentModelResponse, AgentModelStreamChunk } from './agents.js';

export const AI_RESOURCE_SCHEDULER_VERSION = 1 as const;

export const INFERENCE_PRIORITIES = [
  'USER_INTERACTIVE',
  'ACTIVE_AGENT',
  'SAFETY_REVIEW',
  'BROWSER',
  'AGENT_SOCIAL',
  'AUTOMATION',
  'RECOMMENDATION',
  'MEMORY_CONSOLIDATION',
  'BACKGROUND',
] as const;
export type InferencePriority = (typeof INFERENCE_PRIORITIES)[number];

export const AI_RESOURCE_MODES = ['PERFORMANCE', 'BALANCED', 'GAMING', 'BATTERY'] as const;
export type ResourceMode = (typeof AI_RESOURCE_MODES)[number];

export const MODEL_RUNTIME_STATES = ['UNLOADED', 'LOADING', 'READY', 'BUSY', 'IDLE', 'UNLOADING', 'FAILED'] as const;
export type ModelRuntimeLifecycle = (typeof MODEL_RUNTIME_STATES)[number];

export const INFERENCE_JOB_STATES = ['queued', 'running', 'paused', 'completed', 'cancelled', 'failed', 'crashed'] as const;
export type InferenceJobState = (typeof INFERENCE_JOB_STATES)[number];

export const INFERENCE_ERROR_CODES = [
  'INVALID_ARGUMENT',
  'QUEUE_FULL',
  'AGENT_QUOTA',
  'DUPLICATE_JOB',
  'JOB_NOT_FOUND',
  'CANCELLED',
  'TIMEOUT',
  'MODEL_UNAVAILABLE',
  'MODEL_CRASHED',
  'RESOURCE_PRESSURE',
  'NO_HANDLER',
  'FAILED',
] as const;
export type InferenceErrorCode = (typeof INFERENCE_ERROR_CODES)[number];

export class AIResourceSchedulerError extends Error {
  constructor(readonly code: InferenceErrorCode, message: string) {
    super(message);
    this.name = 'AIResourceSchedulerError';
  }
}

export interface AIModelRuntime {
  readonly model: AIModelRef;
  /** The host adapter owns the actual Ollama/LM Studio/llama.cpp handle. */
  load?(signal?: AbortSignal): Promise<void>;
  unload?(signal?: AbortSignal): Promise<void>;
  recover?(signal?: AbortSignal): Promise<void>;
  /** One runtime can serve many independent jobs and agent sessions. */
  infer<T = unknown>(input: unknown, signal: AbortSignal): Promise<T>;
}

export type ModelRuntimeFactory = (model: AIModelRef) => AIModelRuntime | Promise<AIModelRuntime>;

export interface ModelLease {
  readonly version: 1;
  readonly id: string;
  readonly ownerJobId: string;
  readonly model: AIModelRef;
  readonly priority: InferencePriority;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly cancellable: boolean;
}

export interface InferenceJob {
  readonly version: 1;
  readonly id: string;
  readonly agentId: string;
  readonly sessionId?: string;
  readonly model: AIModelRef;
  readonly priority: InferencePriority;
  readonly kind: string;
  readonly cheap: boolean;
  readonly persist: boolean;
  readonly state: InferenceJobState;
  readonly createdAt: string;
  readonly queuedAt: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly updatedAt: string;
  readonly timeoutMs: number;
  readonly maxAttempts: number;
  readonly attempt: number;
  readonly waitTimeMs?: number;
  readonly inferenceTimeMs?: number;
  readonly pauseReason?: 'user' | 'resource_mode' | 'preempted' | 'resource_pressure' | 'crash_recovery';
  readonly errorCode?: InferenceErrorCode;
  readonly errorMessage?: string;
  /** Only bounded, non-sensitive diagnostics are persisted. */
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface InferenceJobRequest<T = unknown> {
  readonly id?: string;
  readonly agentId: string;
  readonly sessionId?: string;
  readonly model: AIModelRef | string;
  readonly priority: InferencePriority;
  readonly kind: string;
  readonly cheap?: boolean;
  readonly persist?: boolean;
  readonly timeoutMs?: number;
  readonly maxAttempts?: number;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
  readonly onToken?: (token: string) => void;
  readonly handler: InferenceJobHandler<T>;
}

export interface InferenceExecutionContext {
  readonly job: InferenceJob;
  readonly runtime: AIModelRuntime;
  readonly lease: ModelLease;
  readonly signal: AbortSignal;
  /** Cooperative preemption checkpoint. Context remains job-local. */
  checkpoint(): Promise<void>;
  /** Alias used by providers that already expose cooperative yielding. */
  yieldIfNeeded(): Promise<void>;
  /** Emits a token/event without placing it in durable scheduler state. */
  emitToken(token: string): void;
}

export type InferenceJobHandler<T = unknown> = (context: InferenceExecutionContext) => Promise<T>;

export interface ResourceBudget {
  readonly maxConcurrency: number;
  readonly foregroundConcurrency: number;
  readonly backgroundConcurrency: number;
  readonly maxQueuedJobs: number;
  readonly perAgentMaxActive: number;
  readonly perAgentMaxQueued: number;
  readonly defaultJobTimeoutMs: number;
  readonly maxJobTimeoutMs: number;
  readonly starvationAfterMs: number;
  readonly maxPersistedJobs: number;
}

export interface RuntimeResourceState {
  readonly model: AIModelRef;
  readonly lifecycle: ModelRuntimeLifecycle;
  readonly loadedAt?: string;
  readonly lastUsedAt?: string;
  readonly activeJobs: number;
  readonly queuedJobs: number;
  readonly loadCount: number;
  readonly loadTimeMs: number;
  readonly memoryBytes?: number;
  readonly error?: string;
}

export interface AIResourceSignals {
  readonly ramPressure?: 'normal' | 'moderate' | 'high';
  readonly vramPressure?: 'normal' | 'moderate' | 'high';
  readonly gpuUtilization?: number;
  readonly cpuUtilization?: number;
  readonly batteryLevel?: number;
  readonly charging?: boolean;
  readonly thermalState?: 'nominal' | 'fair' | 'serious' | 'critical';
  readonly foregroundHeavyApp?: boolean;
}

export interface AIResourceHostAdapter {
  readSignals(): Promise<AIResourceSignals | undefined>;
  subscribe?(listener: (signals: AIResourceSignals) => void): () => void;
}

export type KeepLoadedPolicy = 'never' | '5m' | '15m' | 'always';

export interface SchedulerMetrics {
  readonly queueLength: number;
  readonly waitTimeMs: number;
  readonly inferenceTimeMs: number;
  readonly modelLoadTimeMs: number;
  readonly activeJobs: number;
  readonly pausedJobs: number;
  readonly cancellations: number;
  readonly completedJobs: number;
  readonly failedJobs: number;
}

export interface AIResourceSchedulerSnapshot {
  readonly version: 1;
  readonly mode: ResourceMode;
  readonly backgroundPaused: boolean;
  readonly backgroundPauseExplicit: boolean;
  readonly keepLoaded: KeepLoadedPolicy;
  readonly budget: ResourceBudget;
  readonly signals: AIResourceSignals;
  readonly jobs: readonly InferenceJob[];
  readonly runtimes: readonly RuntimeResourceState[];
  readonly metrics: SchedulerMetrics;
}

export interface AIResourceSchedulerStateStore {
  read(): Promise<unknown | undefined>;
  write(value: unknown): Promise<void>;
}

export class InMemoryAIResourceSchedulerStateStore implements AIResourceSchedulerStateStore {
  private value?: unknown;
  async read(): Promise<unknown | undefined> { return this.value === undefined ? undefined : structuredClone(this.value); }
  async write(value: unknown): Promise<void> { this.value = structuredClone(value); }
}

export interface AIResourceSchedulerOptions {
  readonly runtimeFactory?: ModelRuntimeFactory;
  readonly runtime?: AIModelRuntime;
  readonly runtimes?: readonly AIModelRuntime[];
  readonly storage?: AIResourceSchedulerStateStore;
  readonly mode?: ResourceMode;
  readonly budget?: Partial<ResourceBudget>;
  readonly keepLoaded?: KeepLoadedPolicy;
  readonly now?: () => number;
  readonly host?: AIResourceHostAdapter;
}

export interface InferenceJobEvent {
  readonly type: 'queued' | 'started' | 'paused' | 'resumed' | 'completed' | 'cancelled' | 'failed' | 'token';
  readonly job: InferenceJob;
  readonly token?: string;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type StoredHandler = InferenceJobHandler<unknown>;
type Deferred = { promise: Promise<unknown>; resolve: (value: unknown) => void; reject: (error: Error) => void };
type ActiveExecution = {
  jobId: string;
  controller: AbortController;
  timer: ReturnType<typeof setTimeout>;
  runtime: RuntimeRecord;
  lease: ModelLease;
  startedAt: number;
  pauseRequested: boolean;
  paused: boolean;
  timedOut: boolean;
  resume?: () => void;
  slotHeld: boolean;
};
type RuntimeRecord = {
  runtime: AIModelRuntime;
  state: RuntimeResourceState;
  loadPromise?: Promise<void>;
  unloadTimer?: ReturnType<typeof setTimeout>;
};

const PRIORITY_SCORE: Record<InferencePriority, number> = {
  USER_INTERACTIVE: 800,
  ACTIVE_AGENT: 700,
  SAFETY_REVIEW: 650,
  BROWSER: 600,
  AGENT_SOCIAL: 500,
  AUTOMATION: 400,
  RECOMMENDATION: 300,
  MEMORY_CONSOLIDATION: 200,
  BACKGROUND: 100,
};
const BACKGROUND_PRIORITIES = new Set<InferencePriority>(['AGENT_SOCIAL', 'AUTOMATION', 'RECOMMENDATION', 'MEMORY_CONSOLIDATION', 'BACKGROUND']);

const MODE_DEFAULTS: Record<ResourceMode, ResourceBudget> = {
  PERFORMANCE: { maxConcurrency: 4, foregroundConcurrency: 4, backgroundConcurrency: 2, maxQueuedJobs: 128, perAgentMaxActive: 2, perAgentMaxQueued: 32, defaultJobTimeoutMs: 120_000, maxJobTimeoutMs: 600_000, starvationAfterMs: 10_000, maxPersistedJobs: 512 },
  BALANCED: { maxConcurrency: 2, foregroundConcurrency: 2, backgroundConcurrency: 1, maxQueuedJobs: 64, perAgentMaxActive: 1, perAgentMaxQueued: 16, defaultJobTimeoutMs: 120_000, maxJobTimeoutMs: 600_000, starvationAfterMs: 8_000, maxPersistedJobs: 256 },
  GAMING: { maxConcurrency: 2, foregroundConcurrency: 2, backgroundConcurrency: 1, maxQueuedJobs: 32, perAgentMaxActive: 1, perAgentMaxQueued: 8, defaultJobTimeoutMs: 90_000, maxJobTimeoutMs: 300_000, starvationAfterMs: 15_000, maxPersistedJobs: 128 },
  BATTERY: { maxConcurrency: 1, foregroundConcurrency: 1, backgroundConcurrency: 0, maxQueuedJobs: 16, perAgentMaxActive: 1, perAgentMaxQueued: 4, defaultJobTimeoutMs: 90_000, maxJobTimeoutMs: 180_000, starvationAfterMs: 20_000, maxPersistedJobs: 64 },
};

function clone<T>(value: T): T { try { return structuredClone(value); } catch { return value; } }
function nowIso(now: () => number): string { return new Date(now()).toISOString(); }
function randomId(prefix: string): string { return `${prefix}-${crypto.randomUUID()}`; }
function isSafeId(value: unknown, max = 128): value is string { return typeof value === 'string' && value.length > 0 && value.length <= max && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value); }
function boundedInt(value: number, min: number, max: number, fallback: number): number { return Number.isSafeInteger(value) ? Math.max(min, Math.min(max, value)) : fallback; }
function boundedNumber(value: number, min: number, max: number, fallback: number): number { return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback; }
function normalizeModel(value: AIModelRef | string): AIModelRef { return typeof value === 'string' ? parseAIModelRef(value) : parseAIModelRef(formatAIModelRef(value)); }
function terminal(state: InferenceJobState): boolean { return state === 'completed' || state === 'cancelled' || state === 'failed' || state === 'crashed'; }
function background(priority: InferencePriority): boolean { return BACKGROUND_PRIORITIES.has(priority); }
function safeError(error: unknown): string { return (error instanceof Error ? error.message : String(error)).slice(0, 512) || 'Inference failed'; }
function clampSignals(input: AIResourceSignals | undefined): AIResourceSignals {
  if (!input) return {};
  return {
    ...(input.ramPressure ? { ramPressure: input.ramPressure } : {}),
    ...(input.vramPressure ? { vramPressure: input.vramPressure } : {}),
    ...(input.gpuUtilization === undefined ? {} : { gpuUtilization: boundedNumber(input.gpuUtilization, 0, 1, 0) }),
    ...(input.cpuUtilization === undefined ? {} : { cpuUtilization: boundedNumber(input.cpuUtilization, 0, 1, 0) }),
    ...(input.batteryLevel === undefined ? {} : { batteryLevel: boundedNumber(input.batteryLevel, 0, 1, 1) }),
    ...(input.charging === undefined ? {} : { charging: Boolean(input.charging) }),
    ...(input.thermalState ? { thermalState: input.thermalState } : {}),
    ...(input.foregroundHeavyApp === undefined ? {} : { foregroundHeavyApp: Boolean(input.foregroundHeavyApp) }),
  };
}
function normalizeBudget(mode: ResourceMode, input?: Partial<ResourceBudget>): ResourceBudget {
  const defaults = MODE_DEFAULTS[mode];
  return {
    maxConcurrency: boundedInt(input?.maxConcurrency ?? defaults.maxConcurrency, 1, 64, defaults.maxConcurrency),
    foregroundConcurrency: boundedInt(input?.foregroundConcurrency ?? defaults.foregroundConcurrency, 1, 64, defaults.foregroundConcurrency),
    backgroundConcurrency: boundedInt(input?.backgroundConcurrency ?? defaults.backgroundConcurrency, 0, 64, defaults.backgroundConcurrency),
    maxQueuedJobs: boundedInt(input?.maxQueuedJobs ?? defaults.maxQueuedJobs, 1, 4_096, defaults.maxQueuedJobs),
    perAgentMaxActive: boundedInt(input?.perAgentMaxActive ?? defaults.perAgentMaxActive, 1, 64, defaults.perAgentMaxActive),
    perAgentMaxQueued: boundedInt(input?.perAgentMaxQueued ?? defaults.perAgentMaxQueued, 1, 512, defaults.perAgentMaxQueued),
    defaultJobTimeoutMs: boundedInt(input?.defaultJobTimeoutMs ?? defaults.defaultJobTimeoutMs, 100, 3_600_000, defaults.defaultJobTimeoutMs),
    maxJobTimeoutMs: boundedInt(input?.maxJobTimeoutMs ?? defaults.maxJobTimeoutMs, 100, 3_600_000, defaults.maxJobTimeoutMs),
    starvationAfterMs: boundedInt(input?.starvationAfterMs ?? defaults.starvationAfterMs, 100, 3_600_000, defaults.starvationAfterMs),
    maxPersistedJobs: boundedInt(input?.maxPersistedJobs ?? defaults.maxPersistedJobs, 1, 4_096, defaults.maxPersistedJobs),
  };
}
function sanitizeMetadata(value: Readonly<Record<string, string | number | boolean>> | undefined): Readonly<Record<string, string | number | boolean>> | undefined {
  if (!value) return undefined;
  const entries: Array<[string, string | number | boolean]> = [];
  for (const [key, item] of Object.entries(value).slice(0, 16)) {
    if (!isSafeId(key, 64)) continue;
    if (typeof item === 'string') entries.push([key, item.slice(0, 256)]);
    else if (typeof item === 'number' && Number.isFinite(item)) entries.push([key, item]);
    else if (typeof item === 'boolean') entries.push([key, item]);
  }
  return entries.length ? Object.fromEntries(entries) : undefined;
}

/** Priority-aware bounded queue. It never stores prompt/context payloads. */
export class InferenceQueue {
  private readonly jobs = new Map<string, InferenceJob>();
  enqueue(job: InferenceJob): void { this.jobs.set(job.id, job); }
  remove(id: string): InferenceJob | undefined { const value = this.jobs.get(id); this.jobs.delete(id); return value; }
  get(id: string): InferenceJob | undefined { return this.jobs.get(id); }
  clear(): void { this.jobs.clear(); }
  get length(): number { return this.jobs.size; }
  list(): readonly InferenceJob[] { return [...this.jobs.values()]; }
  /** Selects the best eligible job while respecting age and caller fairness. */
  take(now: number, starvationAfterMs: number, eligible: (job: InferenceJob) => boolean, activeByAgent: ReadonlyMap<string, number>, lastAgent?: string): InferenceJob | undefined {
    const candidates = [...this.jobs.values()].filter(eligible);
    candidates.sort((a, b) => {
      const ageA = Math.max(0, now - Date.parse(a.queuedAt));
      const ageB = Math.max(0, now - Date.parse(b.queuedAt));
      const boostA = Math.floor(ageA / starvationAfterMs);
      const boostB = Math.floor(ageB / starvationAfterMs);
      const scoreA = PRIORITY_SCORE[a.priority] + Math.min(200, boostA * 25);
      const scoreB = PRIORITY_SCORE[b.priority] + Math.min(200, boostB * 25);
      if (scoreA !== scoreB) return scoreB - scoreA;
      const activeA = activeByAgent.get(a.agentId) ?? 0;
      const activeB = activeByAgent.get(b.agentId) ?? 0;
      if (activeA !== activeB) return activeA - activeB;
      if (lastAgent === a.agentId && lastAgent !== b.agentId) return 1;
      if (lastAgent === b.agentId && lastAgent !== a.agentId) return -1;
      return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
    });
    const value = candidates[0];
    if (!value) return undefined;
    this.jobs.delete(value.id);
    return value;
  }
}

export class AIResourceScheduler {
  private readonly storage: AIResourceSchedulerStateStore;
  private readonly runtimeFactory?: ModelRuntimeFactory;
  private readonly now: () => number;
  private readonly jobs = new Map<string, InferenceJob>();
  private readonly handlers = new Map<string, StoredHandler>();
  private readonly tokenHandlers = new Map<string, (token: string) => void>();
  private readonly kindHandlers = new Map<string, StoredHandler>();
  private readonly runtimes = new Map<string, RuntimeRecord>();
  private readonly runtimeCreations = new Map<string, Promise<RuntimeRecord>>();
  private readonly queue = new InferenceQueue();
  private readonly active = new Map<string, ActiveExecution>();
  private readonly activeByAgent = new Map<string, number>();
  private readonly starting = new Set<string>();
  private readonly startingByAgent = new Map<string, number>();
  private readonly deferred = new Map<string, Deferred>();
  private readonly results = new Map<string, unknown>();
  private readonly errors = new Map<string, Error>();
  private readonly listeners = new Set<(event: InferenceJobEvent) => void>();
  private readonly idleTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private writes: Promise<void> = Promise.resolve();
  private readyPromise: Promise<void>;
  private pumpScheduled = false;
  private disposed = false;
  private mode: ResourceMode;
  private budget: ResourceBudget;
  private signals: AIResourceSignals = {};
  private backgroundPaused = false;
  private backgroundPauseExplicit = false;
  private keepLoaded: KeepLoadedPolicy;
  private lastAgent?: string;
  private metricsState: SchedulerMetrics = { queueLength: 0, waitTimeMs: 0, inferenceTimeMs: 0, modelLoadTimeMs: 0, activeJobs: 0, pausedJobs: 0, cancellations: 0, completedJobs: 0, failedJobs: 0 };
  private hostUnsubscribe?: () => void;

  constructor(options: AIResourceSchedulerOptions = {}) {
    this.storage = options.storage ?? new InMemoryAIResourceSchedulerStateStore();
    this.runtimeFactory = options.runtimeFactory;
    this.now = options.now ?? Date.now;
    this.mode = options.mode ?? 'BALANCED';
    this.budget = normalizeBudget(this.mode, options.budget);
    this.keepLoaded = options.keepLoaded ?? '5m';
    if (options.runtime) this.registerRuntime(options.runtime);
    for (const runtime of options.runtimes ?? []) this.registerRuntime(runtime);
    this.readyPromise = this.hydrate();
    if (options.host) {
      this.hostUnsubscribe = options.host.subscribe?.(signals => this.setResourceSignals(signals));
      void options.host.readSignals().then(signals => { if (signals) this.setResourceSignals(signals); }).catch(() => undefined);
    }
  }

  async ready(): Promise<void> { await this.readyPromise; }
  get currentMode(): ResourceMode { return this.mode; }
  get isBackgroundPaused(): boolean { return this.backgroundPaused; }
  get queueLength(): number { return this.queue.length; }
  get activeJobCount(): number { return this.heldSlots(); }
  get currentBudget(): ResourceBudget { return clone(this.budget); }
  get currentSignals(): AIResourceSignals { return clone(this.signals); }

  registerRuntime(runtime: AIModelRuntime): void {
    const model = normalizeModel(runtime.model);
    const id = formatAIModelRef(model);
    const existing = this.runtimes.get(id);
    if (existing && existing.runtime !== runtime) throw new AIResourceSchedulerError('INVALID_ARGUMENT', `Runtime already registered for ${id}`);
    if (existing) return;
    this.runtimes.set(id, { runtime, state: { model, lifecycle: 'UNLOADED', activeJobs: 0, queuedJobs: 0, loadCount: 0, loadTimeMs: 0 } });
  }

  registerHandler(kind: string, handler: InferenceJobHandler): void {
    if (!isSafeId(kind, 128)) throw new AIResourceSchedulerError('INVALID_ARGUMENT', 'Invalid inference handler kind');
    this.kindHandlers.set(kind, handler);
    this.pump();
  }

  attachHandler(jobId: string, handler: InferenceJobHandler): void {
    if (!isSafeId(jobId)) throw new AIResourceSchedulerError('INVALID_ARGUMENT', 'Invalid inference job id');
    if (!this.jobs.has(jobId)) throw new AIResourceSchedulerError('JOB_NOT_FOUND', `Inference job ${jobId} was not found`);
    this.handlers.set(jobId, handler);
    this.pump();
  }

  subscribe(listener: (event: InferenceJobEvent) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }

  async enqueue<T>(request: InferenceJobRequest<T>): Promise<InferenceJob> {
    validateRequest(request);
    if (request.priority === 'USER_INTERACTIVE' || request.priority === 'ACTIVE_AGENT') this.requestPreemption(request.priority);
    await this.ready();
    if (this.disposed) throw new AIResourceSchedulerError('FAILED', 'AI resource scheduler is closed');
    const id = request.id ?? randomId('inference');
    if (this.jobs.has(id)) throw new AIResourceSchedulerError('DUPLICATE_JOB', `Inference job ${id} already exists`);
    const model = normalizeModel(request.model);
    const queued = this.queue.length + [...this.jobs.values()].filter(job => job.state === 'paused').length;
    if (queued >= this.effectiveBudget().maxQueuedJobs) throw new AIResourceSchedulerError('QUEUE_FULL', 'Inference queue is full');
    const queuedForAgent = [...this.jobs.values()].filter(job => job.agentId === request.agentId && (job.state === 'queued' || job.state === 'paused')).length;
    if (queuedForAgent >= this.effectiveBudget().perAgentMaxQueued) throw new AIResourceSchedulerError('AGENT_QUOTA', 'Agent inference queue quota is full');
    const createdAt = nowIso(this.now);
    const timeoutMs = boundedInt(request.timeoutMs ?? this.effectiveBudget().defaultJobTimeoutMs, 100, this.effectiveBudget().maxJobTimeoutMs, this.effectiveBudget().defaultJobTimeoutMs);
    const initialPaused = this.shouldPauseNewJob(request.priority, Boolean(request.cheap), false);
    const job: InferenceJob = {
      version: 1, id, agentId: request.agentId, ...(request.sessionId ? { sessionId: request.sessionId } : {}), model,
      priority: request.priority, kind: request.kind, cheap: Boolean(request.cheap), persist: request.persist !== false,
      state: initialPaused ? 'paused' : 'queued', createdAt, queuedAt: createdAt, updatedAt: createdAt, timeoutMs,
      maxAttempts: boundedInt(request.maxAttempts ?? 1, 1, 3, 1), attempt: 0, pauseReason: initialPaused ? 'resource_mode' : undefined,
      ...(sanitizeMetadata(request.metadata) ? { metadata: sanitizeMetadata(request.metadata) } : {}),
    };
    this.jobs.set(id, job);
    this.handlers.set(id, request.handler as StoredHandler);
    if (request.onToken) this.tokenHandlers.set(id, request.onToken);
    if (!initialPaused) this.queue.enqueue(job);
    await this.persist();
    this.emit({ type: 'queued', job });
    this.pump();
    return clone(job);
  }

  async run<T>(request: InferenceJobRequest<T>): Promise<T> {
    const job = await this.enqueue(request);
    return this.waitFor<T>(job.id);
  }

  async submit<T>(request: InferenceJobRequest<T>): Promise<InferenceJob> { return this.enqueue(request); }

  async waitFor<T>(jobId: string): Promise<T> {
    await this.ready();
    const job = this.jobs.get(jobId);
    if (!job) throw new AIResourceSchedulerError('JOB_NOT_FOUND', `Inference job ${jobId} was not found`);
    if (job.state === 'completed') { await this.writes; return this.results.get(jobId) as T; }
    if (terminal(job.state)) throw this.errors.get(jobId) ?? new AIResourceSchedulerError(job.errorCode ?? 'FAILED', job.errorMessage ?? 'Inference job failed');
    const value = await this.makeDeferred(jobId).promise; await this.writes; return value as T;
  }

  async cancel(jobId: string): Promise<InferenceJob> {
    await this.ready();
    const job = this.requireJob(jobId);
    if (terminal(job.state)) return clone(job);
    const active = this.active.get(jobId);
    if (active) { active.controller.abort(); active.resume?.(); }
    this.queue.remove(jobId);
    this.finish(jobId, 'cancelled', 'CANCELLED', 'Inference job cancelled');
    return clone(this.requireJob(jobId));
  }

  async cancelJob(jobId: string): Promise<InferenceJob> { return this.cancel(jobId); }

  async pause(jobId: string, reason: 'user' | 'resource_mode' | 'preempted' | 'resource_pressure' = 'user'): Promise<InferenceJob> {
    await this.ready();
    const job = this.requireJob(jobId);
    if (terminal(job.state) || job.state === 'paused') return clone(job);
    const active = this.active.get(jobId);
    if (!active) { this.queue.remove(jobId); this.updateJob(jobId, { state: 'paused', pauseReason: reason }); await this.persist(); this.emit({ type: 'paused', job: this.requireJob(jobId) }); return clone(this.requireJob(jobId)); }
    active.pauseRequested = true;
    if (active.paused) this.emit({ type: 'paused', job });
    return clone(job);
  }

  async pauseJob(jobId: string): Promise<InferenceJob> { return this.pause(jobId); }

  async resume(jobId: string): Promise<InferenceJob> {
    await this.ready();
    const job = this.requireJob(jobId);
    if (terminal(job.state)) return clone(job);
    const active = this.active.get(jobId);
    if (active?.paused) { active.pauseRequested = false; active.resume?.(); return clone(job); }
    if (job.state === 'paused') {
      if (this.shouldPauseNewJob(job.priority, job.cheap, true)) return clone(job);
      this.updateJob(jobId, { state: 'queued', pauseReason: undefined, updatedAt: nowIso(this.now) });
      this.queue.enqueue(this.requireJob(jobId));
      await this.persist();
      this.emit({ type: 'resumed', job: this.requireJob(jobId) });
      this.pump();
    }
    return clone(this.requireJob(jobId));
  }

  async resumeJob(jobId: string): Promise<InferenceJob> { return this.resume(jobId); }

  async setMode(mode: ResourceMode): Promise<void> {
    if (!AI_RESOURCE_MODES.includes(mode)) throw new AIResourceSchedulerError('INVALID_ARGUMENT', 'Invalid AI resource mode');
    await this.ready();
    this.mode = mode; this.budget = normalizeBudget(mode);
    if (mode === 'GAMING' || mode === 'BATTERY') this.backgroundPaused = true;
    else if (!this.backgroundPauseExplicit) this.backgroundPaused = false;
    for (const job of this.jobs.values()) {
      if (!background(job.priority) || terminal(job.state)) continue;
      if (this.shouldPauseNewJob(job.priority, job.cheap, false)) {
        if (job.state === 'queued') this.queue.remove(job.id);
        this.updateJob(job.id, { state: 'paused', pauseReason: 'resource_mode' });
        const active = this.active.get(job.id); if (active) active.pauseRequested = true;
      } else if (job.state === 'paused' && job.pauseReason === 'resource_mode') {
        const active = this.active.get(job.id); if (active?.paused) { active.pauseRequested = false; active.resume?.(); } else { this.updateJob(job.id, { state: 'queued', pauseReason: undefined }); this.queue.enqueue(this.requireJob(job.id)); }
      }
    }
    await this.persist();
    this.pump();
  }

  async setResourceMode(mode: ResourceMode): Promise<void> { return this.setMode(mode); }

  async pauseBackground(): Promise<void> {
    await this.ready(); this.backgroundPaused = true; this.backgroundPauseExplicit = true;
    for (const job of this.jobs.values()) if (background(job.priority) && !terminal(job.state)) { if (job.state === 'queued') this.queue.remove(job.id); this.updateJob(job.id, { state: 'paused', pauseReason: 'user' }); const active = this.active.get(job.id); if (active) active.pauseRequested = true; }
    await this.persist();
  }

  async resumeBackground(): Promise<void> {
    await this.ready(); this.backgroundPauseExplicit = false; this.backgroundPaused = this.mode === 'GAMING' || this.mode === 'BATTERY';
    for (const job of this.jobs.values()) if (background(job.priority) && job.state === 'paused' && (job.pauseReason === 'user' || job.pauseReason === 'resource_mode')) { if (this.shouldPauseNewJob(job.priority, job.cheap, true)) continue; const active = this.active.get(job.id); if (active?.paused) { active.pauseRequested = false; active.resume?.(); } else { this.updateJob(job.id, { state: 'queued', pauseReason: undefined }); this.queue.enqueue(this.requireJob(job.id)); } }
    await this.persist(); this.pump();
  }

  async setResourceSignals(signals: AIResourceSignals): Promise<void> {
    await this.ready();
    this.signals = clampSignals(signals);
    const pressure = this.isPressureHigh();
    for (const job of this.jobs.values()) if (background(job.priority) && !terminal(job.state)) {
      if (pressure) { if (job.state === 'queued') this.queue.remove(job.id); this.updateJob(job.id, { state: 'paused', pauseReason: 'resource_pressure' }); const active = this.active.get(job.id); if (active) active.pauseRequested = true; }
      else if (job.state === 'paused' && job.pauseReason === 'resource_pressure' && (!this.backgroundPaused || this.mode === 'GAMING' && job.priority === 'RECOMMENDATION' && job.cheap)) { const active = this.active.get(job.id); if (active?.paused) { active.pauseRequested = false; active.resume?.(); } else { this.updateJob(job.id, { state: 'queued', pauseReason: undefined }); this.queue.enqueue(this.requireJob(job.id)); } }
    }
    await this.persist(); this.pump();
  }

  async setSignals(signals: AIResourceSignals): Promise<void> { return this.setResourceSignals(signals); }

  async unloadModel(model?: AIModelRef | string): Promise<void> {
    await this.ready();
    const ids = model ? [formatAIModelRef(normalizeModel(model))] : [...this.runtimes.keys()];
    for (const id of ids) {
      const record = this.runtimes.get(id); if (!record) continue;
      if (record.state.activeJobs > 0) throw new AIResourceSchedulerError('RESOURCE_PRESSURE', `Model ${id} is busy`);
      await this.unloadRuntime(id, record);
    }
    await this.persist();
  }

  listJobs(): readonly InferenceJob[] { return [...this.jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(clone); }
  getJob(jobId: string): InferenceJob | undefined { const value = this.jobs.get(jobId); return value ? clone(value) : undefined; }
  listRuntimes(): readonly RuntimeResourceState[] { return [...this.runtimes.values()].map(record => clone(record.state)); }
  runtimeState(model: AIModelRef | string): RuntimeResourceState | undefined { const record = this.runtimes.get(formatAIModelRef(normalizeModel(model))); return record ? clone(record.state) : undefined; }
  getMetrics(): SchedulerMetrics { return { ...this.metricsState, queueLength: this.queue.length, activeJobs: this.heldSlots(), pausedJobs: [...this.jobs.values()].filter(job => job.state === 'paused').length }; }
  metrics(): SchedulerMetrics { return this.getMetrics(); }
  async snapshot(): Promise<AIResourceSchedulerSnapshot> { await this.ready(); return this.makeSnapshot(); }

  close(): void {
    this.disposed = true; this.hostUnsubscribe?.(); this.hostUnsubscribe = undefined;
    for (const timer of this.idleTimers.values()) clearTimeout(timer); this.idleTimers.clear();
    for (const active of this.active.values()) { clearTimeout(active.timer); active.controller.abort(); active.resume?.(); }
    this.active.clear(); this.queue.clear();
  }

  private makeDeferred(jobId: string): Deferred {
    const existing = this.deferred.get(jobId); if (existing) return existing;
    let resolve!: (value: unknown) => void; let reject!: (error: Error) => void;
    const promise = new Promise<unknown>((yes, no) => { resolve = yes; reject = no; });
    const deferred = { promise, resolve, reject }; this.deferred.set(jobId, deferred); return deferred;
  }

  private pump(): void {
    if (this.pumpScheduled || this.disposed) return;
    this.pumpScheduled = true;
    queueMicrotask(() => { this.pumpScheduled = false; this.pumpNow(); });
  }

  private pumpNow(): void {
    if (this.disposed) return;
    const effective = this.effectiveBudget();
    while (this.heldSlots() + this.starting.size < effective.maxConcurrency) {
      const job = this.queue.take(this.now(), effective.starvationAfterMs, candidate => this.canStart(candidate, effective), this.activeByAgent, this.lastAgent);
      if (!job) break;
      this.lastAgent = job.agentId;
      void this.start(job).catch(error => this.finish(job.id, 'failed', 'FAILED', safeError(error)));
    }
    this.metricsState = { ...this.metricsState, queueLength: this.queue.length, activeJobs: this.heldSlots(), pausedJobs: [...this.jobs.values()].filter(job => job.state === 'paused').length };
  }

  private canStart(job: InferenceJob, budget: ResourceBudget): boolean {
    if (job.state !== 'queued' || !this.handlerFor(job)) return false;
    if (this.backgroundPaused && background(job.priority) && !(this.mode === 'GAMING' && job.priority === 'RECOMMENDATION' && job.cheap)) return false;
    if (this.shouldPauseNewJob(job.priority, job.cheap, true)) return false;
    const activeCount = (this.activeByAgent.get(job.agentId) ?? 0) + (this.startingByAgent.get(job.agentId) ?? 0);
    if (activeCount >= budget.perAgentMaxActive) return false;
    const backgroundActive = this.heldByPriority(true) + this.startingByPriority(true);
    const foregroundActive = this.heldByPriority(false) + this.startingByPriority(false);
    if (background(job.priority)) return backgroundActive < budget.backgroundConcurrency;
    return foregroundActive < budget.foregroundConcurrency;
  }

  private requestPreemption(priority: InferencePriority): void {
    const score = PRIORITY_SCORE[priority];
    for (const active of this.active.values()) {
      if (active.paused) continue;
      const job = this.jobs.get(active.jobId);
      if (job && PRIORITY_SCORE[job.priority] < score && background(job.priority)) active.pauseRequested = true;
    }
  }
  private hasHigherPriorityWaiting(job: InferenceJob): boolean {
    return this.queue.list().some(candidate => PRIORITY_SCORE[candidate.priority] > PRIORITY_SCORE[job.priority]);
  }

  private async start(job: InferenceJob): Promise<void> {
    const handler = this.handlerFor(job);
    if (!handler) { this.finish(job.id, 'failed', 'NO_HANDLER', `No handler is registered for ${job.kind}`); return; }
    this.starting.add(job.id); this.incrementStartingAgent(job.agentId, 1);
    let active: ActiveExecution | undefined;
    try {
      const runtime = await this.ensureRuntime(job.model);
      const startedAt = this.now();
      const controller = new AbortController();
      const lease: ModelLease = { version: 1, id: randomId('lease'), ownerJobId: job.id, model: clone(job.model), priority: job.priority, createdAt: nowIso(this.now), expiresAt: new Date(startedAt + job.timeoutMs).toISOString(), cancellable: true };
      active = { jobId: job.id, controller, timer: setTimeout(() => { active!.timedOut = true; controller.abort(); }, job.timeoutMs), runtime, lease, startedAt, pauseRequested: false, paused: false, timedOut: false, slotHeld: true };
      this.starting.delete(job.id); this.incrementStartingAgent(job.agentId, -1);
      this.active.set(job.id, active); this.incrementAgent(job.agentId, 1); runtime.state = { ...runtime.state, lifecycle: 'BUSY', activeJobs: runtime.state.activeJobs + 1, lastUsedAt: nowIso(this.now), error: undefined }; this.updateJob(job.id, { state: 'running', startedAt: nowIso(this.now), attempt: job.attempt + 1, updatedAt: nowIso(this.now) });
      const waitMs = Math.max(0, startedAt - Date.parse(job.queuedAt));
      this.metricsState = { ...this.metricsState, waitTimeMs: average(this.metricsState.waitTimeMs, waitMs, this.metricsState.completedJobs + this.metricsState.failedJobs + 1) };
      await this.persist(); this.emit({ type: 'started', job: this.requireJob(job.id) });
      const execution = active;
      const value = await handler({ job: this.requireJob(job.id), runtime: runtime.runtime, lease, signal: controller.signal, checkpoint: () => this.checkpoint(execution), yieldIfNeeded: () => this.checkpoint(execution), emitToken: token => this.emitToken(job.id, token) });
      if (controller.signal.aborted) throw new AIResourceSchedulerError('CANCELLED', 'Inference job was cancelled');
      const duration = Math.max(0, this.now() - startedAt); this.metricsState = { ...this.metricsState, inferenceTimeMs: average(this.metricsState.inferenceTimeMs, duration, this.metricsState.completedJobs + this.metricsState.failedJobs + 1) };
      this.finish(job.id, 'completed', undefined, undefined, value, duration);
    } catch (error) {
      const duration = active ? Math.max(0, this.now() - active.startedAt) : 0;
      if (active?.controller.signal.aborted) {
        const current = this.requireJob(job.id);
        if (current.state === 'paused' && !active.timedOut) { /* checkpoint will resume or cancel */ }
        else if (active.timedOut) this.finish(job.id, 'failed', 'TIMEOUT', 'Inference job timed out', undefined, duration);
        else this.finish(job.id, 'cancelled', 'CANCELLED', 'Inference job was cancelled', undefined, duration);
      } else {
        const code = error instanceof AIResourceSchedulerError ? error.code : 'FAILED';
        const current = this.requireJob(job.id);
        if (code === 'MODEL_CRASHED' && current.attempt < current.maxAttempts) { this.updateJob(job.id, { state: 'queued', pauseReason: 'crash_recovery', errorCode: undefined, errorMessage: undefined }); this.queue.enqueue(this.requireJob(job.id)); await this.persist(); this.pump(); }
        else this.finish(job.id, 'failed', code, safeError(error), undefined, duration);
      }
    } finally {
      this.starting.delete(job.id); this.incrementStartingAgent(job.agentId, -1);
      if (active) { clearTimeout(active.timer); if (this.active.get(job.id) === active) this.releaseSlot(active); this.scheduleIdleUnload(active.runtime); }
      this.pump();
    }
  }

  private async checkpoint(active: ActiveExecution): Promise<void> {
    if (active.controller.signal.aborted) throw new AIResourceSchedulerError('CANCELLED', 'Inference job was cancelled');
    const job = this.requireJob(active.jobId);
    if (!active.pauseRequested && !this.hasHigherPriorityWaiting(job) && !(this.backgroundPaused && background(job.priority)) && !this.isPressureHigh()) return;
    if (!active.paused) {
      active.paused = true; this.releaseSlot(active); this.updateJob(active.jobId, { state: 'paused', pauseReason: this.backgroundPaused ? 'resource_mode' : 'preempted', updatedAt: nowIso(this.now) });
      await this.persist(); this.emit({ type: 'paused', job: this.requireJob(active.jobId) }); this.pump();
    }
    await new Promise<void>(resolve => { active.resume = resolve; });
    active.resume = undefined;
    if (active.controller.signal.aborted) throw new AIResourceSchedulerError('CANCELLED', 'Inference job was cancelled');
    while (!this.canReacquire(active)) await delay(10);
    this.acquireSlot(active); active.paused = false; active.pauseRequested = false; this.updateJob(active.jobId, { state: 'running', pauseReason: undefined, updatedAt: nowIso(this.now) }); await this.persist(); this.emit({ type: 'resumed', job: this.requireJob(active.jobId) });
  }

  private canReacquire(active: ActiveExecution): boolean {
    const budget = this.effectiveBudget(); const job = this.requireJob(active.jobId); if (this.backgroundPaused && background(job.priority) && !(this.mode === 'GAMING' && job.priority === 'RECOMMENDATION' && job.cheap)) return false; if (this.shouldPauseNewJob(job.priority, job.cheap, true)) return false; if (this.heldSlots() >= budget.maxConcurrency) return false; if ((this.activeByAgent.get(job.agentId) ?? 0) >= budget.perAgentMaxActive) return false; const bg = this.heldByPriority(true) - (active.slotHeld && background(job.priority) ? 1 : 0); const fg = this.heldByPriority(false) - (active.slotHeld && !background(job.priority) ? 1 : 0); return background(job.priority) ? bg < budget.backgroundConcurrency : fg < budget.foregroundConcurrency;
  }

  private acquireSlot(active: ActiveExecution): void { active.slotHeld = true; this.incrementAgent(this.requireJob(active.jobId).agentId, 1); active.runtime.state = { ...active.runtime.state, activeJobs: active.runtime.state.activeJobs + 1, lifecycle: 'BUSY', lastUsedAt: nowIso(this.now) }; }
  private releaseSlot(active: ActiveExecution): void { if (!active.slotHeld) return; active.slotHeld = false; const job = this.jobs.get(active.jobId); if (job) this.incrementAgent(job.agentId, -1); active.runtime.state = { ...active.runtime.state, activeJobs: Math.max(0, active.runtime.state.activeJobs - 1), lifecycle: active.runtime.state.activeJobs <= 1 ? 'IDLE' : 'BUSY', lastUsedAt: nowIso(this.now) }; }
  private incrementAgent(agentId: string, delta: number): void { const next = Math.max(0, (this.activeByAgent.get(agentId) ?? 0) + delta); if (next) this.activeByAgent.set(agentId, next); else this.activeByAgent.delete(agentId); }
  private incrementStartingAgent(agentId: string, delta: number): void { const next = Math.max(0, (this.startingByAgent.get(agentId) ?? 0) + delta); if (next) this.startingByAgent.set(agentId, next); else this.startingByAgent.delete(agentId); }
  private heldSlots(): number { return [...this.active.values()].filter(active => active.slotHeld).length; }
  private heldByPriority(wantBackground: boolean): number { return [...this.active.values()].filter(active => active.slotHeld && background(this.requireJob(active.jobId).priority) === wantBackground).length; }
  private startingByPriority(wantBackground: boolean): number { return [...this.starting].filter(jobId => { const job = this.jobs.get(jobId); return !!job && background(job.priority) === wantBackground; }).length; }

  private async ensureRuntime(modelValue: AIModelRef): Promise<RuntimeRecord> {
    const model = normalizeModel(modelValue); const id = formatAIModelRef(model); let record = this.runtimes.get(id);
    if (!record) {
      let creation = this.runtimeCreations.get(id);
      if (!creation) {
        creation = (async () => { if (!this.runtimeFactory) throw new AIResourceSchedulerError('MODEL_UNAVAILABLE', `No runtime is configured for ${id}`); const runtime = await this.runtimeFactory!(model); if (formatAIModelRef(runtime.model) !== id) throw new AIResourceSchedulerError('INVALID_ARGUMENT', `Runtime model does not match ${id}`); this.registerRuntime(runtime); return this.runtimes.get(id)!; })();
        this.runtimeCreations.set(id, creation);
      }
      try { record = await creation; } finally { if (this.runtimeCreations.get(id) === creation) this.runtimeCreations.delete(id); }
    }
    if (record.unloadTimer) { clearTimeout(record.unloadTimer); record.unloadTimer = undefined; this.idleTimers.delete(id); }
    if (record.state.lifecycle === 'LOADING' && record.loadPromise) { await record.loadPromise; return record; }
    if (record.state.lifecycle === 'READY' || record.state.lifecycle === 'BUSY' || record.state.lifecycle === 'IDLE') return record;
    const startedAt = this.now(); record.state = { ...record.state, lifecycle: 'LOADING', error: undefined };
    const load = async () => { if (record!.state.lifecycle === 'FAILED') await record!.runtime.recover?.(); await record!.runtime.load?.(); };
    record.loadPromise = load().then(() => { const elapsed = Math.max(0, this.now() - startedAt); record!.state = { ...record!.state, lifecycle: 'READY', loadedAt: nowIso(this.now), loadCount: record!.state.loadCount + 1, loadTimeMs: elapsed, error: undefined }; this.metricsState = { ...this.metricsState, modelLoadTimeMs: average(this.metricsState.modelLoadTimeMs, elapsed, record!.state.loadCount) }; }).catch(error => { record!.state = { ...record!.state, lifecycle: 'FAILED', error: safeError(error) }; throw new AIResourceSchedulerError('MODEL_CRASHED', `Model ${id} failed to load: ${safeError(error)}`); }).finally(() => { record!.loadPromise = undefined; });
    await record.loadPromise; return record;
  }

  private scheduleIdleUnload(record: RuntimeRecord): void {
    if (record.state.activeJobs > 0 || this.keepLoaded === 'always') return;
    const id = formatAIModelRef(record.state.model); const delayMs = this.keepLoaded === 'never' ? 0 : this.keepLoaded === '5m' ? 5 * 60_000 : 15 * 60_000;
    if (record.unloadTimer) clearTimeout(record.unloadTimer);
    record.unloadTimer = setTimeout(() => { void this.unloadRuntime(id, record).catch(() => undefined); }, delayMs); (record.unloadTimer as unknown as { unref?: () => void }).unref?.(); this.idleTimers.set(id, record.unloadTimer);
  }
  private async unloadRuntime(id: string, record: RuntimeRecord): Promise<void> { if (record.state.activeJobs > 0 || record.state.lifecycle === 'UNLOADED' || record.state.lifecycle === 'UNLOADING') return; record.state = { ...record.state, lifecycle: 'UNLOADING' }; await record.runtime.unload?.(); record.state = { ...record.state, lifecycle: 'UNLOADED', activeJobs: 0 }; if (record.unloadTimer) clearTimeout(record.unloadTimer); record.unloadTimer = undefined; this.idleTimers.delete(id); }

  private finish(jobId: string, state: InferenceJobState, errorCode?: InferenceErrorCode, errorMessage?: string, value?: unknown, inferenceTimeMs?: number): void {
    const job = this.jobs.get(jobId); if (!job || terminal(job.state)) return;
    this.queue.remove(jobId); const completedAt = nowIso(this.now); this.updateJob(jobId, { state, completedAt, updatedAt: completedAt, ...(errorCode ? { errorCode } : {}), ...(errorMessage ? { errorMessage: errorMessage.slice(0, 512) } : {}), ...(inferenceTimeMs === undefined ? {} : { inferenceTimeMs }) }); const persistence = this.persist();
    if (state === 'completed') { this.results.set(jobId, value); this.trimResults(); this.deferred.get(jobId)?.resolve(value); this.metricsState = { ...this.metricsState, completedJobs: this.metricsState.completedJobs + 1 }; this.emit({ type: 'completed', job: this.requireJob(jobId) }); }
    else if (state === 'cancelled') { this.errors.set(jobId, new AIResourceSchedulerError(errorCode ?? 'CANCELLED', errorMessage ?? 'Inference cancelled')); this.deferred.get(jobId)?.reject(this.errors.get(jobId)!); this.metricsState = { ...this.metricsState, cancellations: this.metricsState.cancellations + 1 }; this.emit({ type: 'cancelled', job: this.requireJob(jobId) }); }
    else { this.errors.set(jobId, new AIResourceSchedulerError(errorCode ?? 'FAILED', errorMessage ?? 'Inference failed')); this.deferred.get(jobId)?.reject(this.errors.get(jobId)!); this.metricsState = { ...this.metricsState, failedJobs: this.metricsState.failedJobs + 1 }; this.emit({ type: state === 'crashed' ? 'failed' : 'failed', job: this.requireJob(jobId) }); }
    this.tokenHandlers.delete(jobId);
    void persistence;
  }

  private trimResults(): void { while (this.results.size > 64) this.results.delete(this.results.keys().next().value!); while (this.errors.size > 64) this.errors.delete(this.errors.keys().next().value!); }
  private emit(event: InferenceJobEvent): void { for (const listener of this.listeners) { try { listener({ ...event, job: clone(event.job) }); } catch { /* observers are isolated from scheduling */ } } }
  private emitToken(jobId: string, token: string): void { if (typeof token !== 'string' || token.length > 16_384) return; const job = this.jobs.get(jobId); if (!job) return; this.tokenHandlers.get(jobId)?.(token); this.emit({ type: 'token', job, token }); }
  private updateJob(jobId: string, patch: Partial<InferenceJob>): void { const current = this.jobs.get(jobId); if (!current) return; this.jobs.set(jobId, { ...current, ...patch, updatedAt: patch.updatedAt ?? nowIso(this.now) } as InferenceJob); }
  private requireJob(jobId: string): InferenceJob { const value = this.jobs.get(jobId); if (!value) throw new AIResourceSchedulerError('JOB_NOT_FOUND', `Inference job ${jobId} was not found`); return value; }
  private handlerFor(job: InferenceJob): StoredHandler | undefined { return this.handlers.get(job.id) ?? this.kindHandlers.get(job.kind); }
  private effectiveBudget(): ResourceBudget { const base = this.budget; const pressure = this.isPressureHigh(); if (!pressure && !this.signals.foregroundHeavyApp) return base; return { ...base, maxConcurrency: Math.min(base.maxConcurrency, 1), foregroundConcurrency: Math.min(base.foregroundConcurrency, 1), backgroundConcurrency: 0 }; }
  private isPressureHigh(): boolean { return this.signals.ramPressure === 'high' || this.signals.vramPressure === 'high' || this.signals.thermalState === 'critical' || (this.signals.cpuUtilization ?? 0) >= .95 || (this.signals.gpuUtilization ?? 0) >= .98 || (this.signals.charging === false && (this.signals.batteryLevel ?? 1) <= .1); }
  private shouldPauseNewJob(priority: InferencePriority, cheap: boolean, queued: boolean): boolean { if (!background(priority)) return false; if (this.mode === 'GAMING' && priority === 'RECOMMENDATION' && cheap) return this.isPressureHigh(); if (this.backgroundPaused) return true; if (this.mode === 'GAMING') return true; if (this.mode === 'BATTERY') return true; if (this.isPressureHigh()) return true; return false; }

  private async hydrate(): Promise<void> {
    const raw = await this.storage.read(); if (!raw) return;
    const snapshot = parseSnapshot(raw); this.mode = snapshot.mode; this.budget = normalizeBudget(this.mode, snapshot.budget); this.keepLoaded = snapshot.keepLoaded; this.signals = snapshot.signals; this.backgroundPaused = snapshot.backgroundPaused; this.backgroundPauseExplicit = snapshot.backgroundPauseExplicit;
    for (const job of snapshot.jobs) {
      const recovered = job.state === 'running' ? ({ ...job, state: 'queued' as const, pauseReason: 'crash_recovery' as const, errorCode: undefined, errorMessage: undefined, updatedAt: nowIso(this.now) } satisfies InferenceJob) : job;
      this.jobs.set(recovered.id, recovered); if (recovered.state === 'queued') this.queue.enqueue(recovered);
    }
  }
  private makeSnapshot(): AIResourceSchedulerSnapshot { const jobs = [...this.jobs.values()].filter(job => job.persist).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, this.budget.maxPersistedJobs); return { version: 1, mode: this.mode, backgroundPaused: this.backgroundPaused, backgroundPauseExplicit: this.backgroundPauseExplicit, keepLoaded: this.keepLoaded, budget: clone(this.budget), signals: clone(this.signals), jobs: jobs.map(clone), runtimes: this.listRuntimes(), metrics: this.getMetrics() }; }
  private async persist(): Promise<void> { const operation = this.writes.then(() => this.storage.write(this.makeSnapshot())); this.writes = operation.catch(() => undefined); await operation; }
}

function validateRequest(request: InferenceJobRequest): void {
  if (!isSafeId(request.agentId) || (request.sessionId !== undefined && !isSafeId(request.sessionId)) || !isSafeId(request.kind) || !INFERENCE_PRIORITIES.includes(request.priority) || (request.id !== undefined && !isSafeId(request.id)) || typeof request.handler !== 'function') throw new AIResourceSchedulerError('INVALID_ARGUMENT', 'Invalid inference job request');
  normalizeModel(request.model);
}
function parseSnapshot(value: unknown): AIResourceSchedulerSnapshot {
  if (!value || typeof value !== 'object' || (value as { version?: unknown }).version !== 1) throw new AIResourceSchedulerError('FAILED', 'Invalid AI scheduler state');
  const candidate = value as Partial<AIResourceSchedulerSnapshot>;
  if (!AI_RESOURCE_MODES.includes(candidate.mode as ResourceMode) || !Array.isArray(candidate.jobs) || !Array.isArray(candidate.runtimes) || !candidate.budget || !candidate.metrics) throw new AIResourceSchedulerError('FAILED', 'Incomplete AI scheduler state');
  const jobs = candidate.jobs.map(parseJob).filter(job => job.persist).slice(-4_096);
  return { version: 1, mode: candidate.mode as ResourceMode, backgroundPaused: Boolean(candidate.backgroundPaused), backgroundPauseExplicit: Boolean(candidate.backgroundPauseExplicit), keepLoaded: candidate.keepLoaded === 'never' || candidate.keepLoaded === '15m' || candidate.keepLoaded === 'always' ? candidate.keepLoaded : '5m', budget: normalizeBudget(candidate.mode as ResourceMode, candidate.budget), signals: clampSignals(candidate.signals), jobs, runtimes: [], metrics: candidate.metrics as SchedulerMetrics };
}
function parseJob(value: unknown): InferenceJob {
  if (!value || typeof value !== 'object') throw new AIResourceSchedulerError('FAILED', 'Invalid persisted inference job');
  const candidate = value as InferenceJob;
  if (candidate.version !== 1 || !isSafeId(candidate.id) || !isSafeId(candidate.agentId) || !isSafeId(candidate.kind) || !INFERENCE_PRIORITIES.includes(candidate.priority) || !INFERENCE_JOB_STATES.includes(candidate.state) || !Number.isSafeInteger(candidate.timeoutMs) || !Number.isSafeInteger(candidate.attempt)) throw new AIResourceSchedulerError('FAILED', 'Invalid persisted inference job');
  return clone({ ...candidate, model: normalizeModel(candidate.model), metadata: sanitizeMetadata(candidate.metadata) });
}
function average(previous: number, next: number, count: number): number { return count <= 1 ? next : Math.round(previous + (next - previous) / count); }
function delay(ms: number): Promise<void> { return new Promise(resolve => setTimeout(resolve, ms)); }

/** Create one shared runtime adapter for a provider/model pair. */
export function providerRuntime(provider: AIProvider, model: AIModelRef): AIModelRuntime {
  const candidate = provider as AIProvider & { load?: (model: AIModelRef) => Promise<void>; unload?: () => Promise<void>; recover?: () => Promise<void> };
  return { model: clone(model), load: candidate.load ? () => candidate.load!(clone(model)) : undefined, unload: candidate.unload ? () => candidate.unload!() : undefined, recover: candidate.recover ? () => candidate.recover!() : undefined, infer: async <T = unknown>(input: unknown, signal: AbortSignal): Promise<T> => provider.complete({ ...(input as AIProviderRequest), signal }) as Promise<T> };
}

export interface ScheduledGatewayOptions {
  readonly scheduler: AIResourceScheduler;
  readonly agentId: string;
  readonly sessionId?: string;
  readonly priority?: InferencePriority;
  readonly kind?: string;
  readonly timeoutMs?: number;
}

/** Lets existing AgentRuntime gateways share one scheduler/runtime without changing Agent identity. */
export class ScheduledAgentModelGateway implements AgentModelGateway {
  readonly execution: AgentModelGateway['execution'];
  readonly model?: AIModelRef;
  constructor(private readonly gateway: AgentModelGateway, private readonly options: ScheduledGatewayOptions) { this.execution = gateway.execution; this.model = gateway.model ? clone(gateway.model) : undefined; }
  async complete(request: AgentModelRequest): Promise<AgentModelResponse> { return this.options.scheduler.run({ agentId: this.options.agentId, sessionId: request.sessionId, model: request.model ?? this.model ?? { provider: 'unknown', model: 'unknown' }, priority: this.options.priority ?? 'ACTIVE_AGENT', kind: this.options.kind ?? 'agent-runtime', timeoutMs: this.options.timeoutMs, handler: ({ signal, runtime }) => runtime.infer<AgentModelResponse>({ ...request, signal }, signal) }); }
  stream(request: AgentModelRequest): AsyncIterable<AgentModelStreamChunk> {
    const gateway = this.gateway; const scheduler = this.options.scheduler; const priority = this.options.priority ?? 'ACTIVE_AGENT'; const kind = this.options.kind ?? 'agent-runtime';
    return scheduledStream<AgentModelStreamChunk, AgentModelResponse>(scheduler, { agentId: this.options.agentId, sessionId: request.sessionId, model: request.model ?? this.model ?? { provider: 'unknown', model: 'unknown' }, priority, kind, timeoutMs: this.options.timeoutMs, handler: async context => {
      if (!gateway.stream) return context.runtime.infer<AgentModelResponse>({ ...request, signal: context.signal }, context.signal);
      let final: AgentModelResponse | undefined;
      for await (const chunk of gateway.stream({ ...request, signal: context.signal })) { if (chunk.type === 'token') context.emitToken(chunk.text); else final = chunk.response; }
      return final ?? { text: '', toolProposals: [] };
    } }, chunk => chunk.type === 'token' ? chunk : undefined, result => ({ type: 'result', response: result }));
  }
}

/** Wraps a typed AIProvider for callers that want AIRouter requests scheduled. */
export class ScheduledAIProvider implements AIProvider {
  readonly id: string;
  readonly scope: AIProvider['scope'];
  readonly models: readonly AIProvider['models'][number][];
  constructor(private readonly provider: AIProvider, private readonly options: ScheduledGatewayOptions) { this.id = provider.id; this.scope = provider.scope; this.models = provider.models.map(model => ({ ...model, ref: { ...model.ref } })); }
  async complete(request: AIProviderRequest): Promise<AIProviderResponse> { return this.options.scheduler.run({ agentId: this.options.agentId, priority: this.options.priority ?? 'USER_INTERACTIVE', kind: this.options.kind ?? 'ai-provider', timeoutMs: this.options.timeoutMs, model: request.model, handler: ({ signal, runtime }) => runtime.infer<AIProviderResponse>({ ...request, signal }, signal) }); }
}

class SchedulerEventQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = [];
  private readonly waiters: Array<{ resolve: (value: IteratorResult<T>) => void; reject: (error: Error) => void }> = [];
  private ended = false; private failure?: Error;
  push(value: T): void { if (this.ended) return; const waiter = this.waiters.shift(); if (waiter) waiter.resolve({ value, done: false }); else this.values.push(value); }
  close(error?: Error): void { if (this.ended) return; this.ended = true; this.failure = error; while (this.waiters.length) { const waiter = this.waiters.shift()!; if (error) waiter.reject(error); else waiter.resolve({ value: undefined as unknown as T, done: true }); } }
  async next(): Promise<IteratorResult<T>> { if (this.values.length) return { value: this.values.shift()!, done: false }; if (this.ended) { if (this.failure) throw this.failure; return { value: undefined as unknown as T, done: true }; } return new Promise((resolve, reject) => this.waiters.push({ resolve, reject })); }
  [Symbol.asyncIterator](): AsyncIterator<T> { return this; }
}

function scheduledStream<E, R>(scheduler: AIResourceScheduler, request: InferenceJobRequest<R>, select: (event: E) => E | undefined, result: (value: R) => E): AsyncIterable<E> {
  const queue = new SchedulerEventQueue<E>();
  return (async function* () {
    const job = await scheduler.enqueue({ ...request, onToken: token => { const selected = select({ type: 'token', text: token } as unknown as E); if (selected) queue.push(selected); }, handler: async context => { const value = await request.handler(context); queue.push(result(value)); return value; } });
    const completion = scheduler.waitFor<R>(job.id);
    let finished = false;
    completion.then(() => { finished = true; queue.close(); }, error => { finished = true; queue.close(error instanceof Error ? error : new Error(String(error))); });
    try { yield* queue; } finally { if (!finished) await scheduler.cancel(job.id).catch(() => undefined); }
  })();
}
