/**
 * Private-first AI orchestration.
 *
 * The orchestrator is intentionally additive to the local AI router and the
 * Personal AI Mesh.  A delegation plan contains only a neutral subtask (and
 * source identifiers), never the original Keystone request.  External
 * execution is a separate service so every subtask has an explicit firewall
 * preflight and cannot accidentally use AIRouter fallbacks.
 */

import {
  AIEgressFirewall,
  AIRouter,
  AIPrivacyError,
  PrivateAIUnavailableError,
  formatAIModelRef,
  parseAIModelRef,
  type AIContextItem,
  type AIDataClass,
  type AIModelRef,
  type AIRequest,
  type AIToolDefinition,
  type AIOrchestrationMode,
} from './privacy.js';
import {
  AIComputeRouter,
  type AIComputeRouteRequest,
  type AIComputeTarget,
} from './personal-mesh.js';

export type { AIOrchestrationMode } from './privacy.js';

export type AIExecutionKind = 'local' | 'personal_trusted' | 'external';
export type AIPrivacyIndicator = 'processed_privately' | 'external_isolated_subtask';

export type AIProvenanceStepKind =
  | 'local_context'
  | 'local_planning'
  | 'trusted_execution'
  | 'external_delegation'
  | 'external_result'
  | 'local_synthesis'
  | 'blocked';

/** Provenance contains metadata only; prompt and context values are excluded. */
export interface AIProvenanceStep {
  id: string;
  at: string;
  kind: AIProvenanceStepKind;
  execution: AIExecutionKind;
  sourceIds: readonly string[];
  dataClasses: readonly AIDataClass[];
  provider?: string;
  model?: AIModelRef;
  subtaskId?: string;
  summary: string;
}

export interface AIProvenance {
  readonly steps: readonly AIProvenanceStep[];
  readonly indicator: AIPrivacyIndicator;
}

/**
 * A neutral task produced by local/trusted planning.  `objective` is the only
 * user text sent to an external model.  `safeForExternal` is an attestation,
 * not a redaction mechanism: all values are still checked structurally below.
 */
export interface AISubtask {
  id: string;
  objective: string;
  safeForExternal: boolean;
  sourceIds: readonly string[];
  /** Public or explicitly user-supplied context is allowed; private context is not. */
  context?: readonly AIContextItem[];
  systemPrompt?: string;
  systemDataClass?: AIDataClass;
  requestedTools?: readonly AIToolDefinition[];
  model?: AIModelRef | string;
}

export interface DelegationPlan {
  id: string;
  version: 1;
  mode: AIOrchestrationMode;
  createdAt: string;
  finalExecutor: 'local' | 'personal_trusted';
  sourceIds: readonly string[];
  subtasks: readonly AISubtask[];
  provenance?: readonly AIProvenanceStep[];
}

export type DelegationResultStatus = 'completed' | 'cancelled' | 'denied' | 'failed';

export interface DelegationResult {
  id: string;
  planId: string;
  subtaskId: string;
  status: DelegationResultStatus;
  execution: AIExecutionKind;
  text?: string;
  provider?: string;
  model?: AIModelRef;
  sourceIds: readonly string[];
  dataClasses: readonly AIDataClass[];
  startedAt: string;
  completedAt: string;
  errorCode?: string;
  provenance: readonly AIProvenanceStep[];
}

export interface AIOrchestratorRequest extends AIRequest {
  mode?: AIOrchestrationMode;
  /** A plan is generated locally by a host planner, or supplied by a trusted caller. */
  plan?: DelegationPlan;
  /** Convenience form for hosts that do not persist a plan. */
  subtasks?: readonly AISubtask[];
}

export interface AIOrchestratorResult {
  text: string;
  plan: DelegationPlan;
  delegations: readonly DelegationResult[];
  synthesisExecution: 'local' | 'personal_trusted';
  provenance: AIProvenance;
  privacyIndicator: AIPrivacyIndicator;
}

export interface SafeDelegationOptions {
  external: AIRouter;
  firewall?: AIEgressFirewall;
  maxParallel?: number;
  timeoutMs?: number;
}

export interface DelegateManyOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  planId?: string;
}

export class AIOrchestrationPolicyError extends AIPrivacyError {
  constructor(message: string, readonly code = 'delegation_policy_denied') {
    super(message);
    this.name = 'AIOrchestrationPolicyError';
  }
}

export class DelegationCancelledError extends Error {
  constructor(message = 'AI delegation was cancelled') {
    super(message);
    this.name = 'DelegationCancelledError';
  }
}

export interface AIOrchestratorHooks {
  /** Runs only on local/trusted compute and receives the original private request. */
  plan?(request: AIOrchestratorRequest): Promise<DelegationPlan>;
  /** Final synthesis is always local or trusted; never external. */
  synthesize?(input: {
    request: AIOrchestratorRequest;
    plan: DelegationPlan;
    delegations: readonly DelegationResult[];
    provenance: readonly AIProvenanceStep[];
    signal?: AbortSignal;
  }): Promise<string | { text: string; execution?: 'local' | 'personal_trusted' }>;
}

export interface AIOrchestratorOptions extends AIOrchestratorHooks {
  local?: AIRouter;
  personal?: AIComputeRouter;
  personalTarget?: AIComputeTarget;
  delegation?: SafeDelegationService;
  defaultMode?: AIOrchestrationMode;
  maxParallelSubtasks?: number;
  now?: () => number;
}

/**
 * Firewall-backed external delegation. It accepts only explicitly safe
 * subtasks and never receives an original user request.
 */
export class SafeDelegationService {
  readonly firewall: AIEgressFirewall;
  readonly maxParallel: number;
  readonly timeoutMs: number;
  private readonly external: AIRouter;

  constructor(options: SafeDelegationOptions) {
    this.external = options.external;
    this.firewall = options.firewall ?? options.external.firewall;
    this.maxParallel = clampInt(options.maxParallel ?? 2, 1, 16);
    this.timeoutMs = clampInt(options.timeoutMs ?? 120_000, 100, 900_000);
  }

  async delegate(subtask: AISubtask, options: DelegateManyOptions = {}): Promise<DelegationResult> {
    const planId = options.planId ?? 'unassigned';
    const started = new Date().toISOString();
    const sourceIds = [...subtask.sourceIds];
    try {
      if (options.signal?.aborted) throw new DelegationCancelledError();
      const request = this.safeRequest(subtask);
      const model = request.model as AIModelRef;
      // This explicit call is intentional even though AIRouter applies the
      // firewall again. It makes the boundary visible and testable per task.
      const payload = this.firewall.assert('remote', model, request);
      if (payload.context.some(item => item.dataClass !== 'PUBLIC' && item.dataClass !== 'USER_EXPLICIT')) {
        throw new AIOrchestrationPolicyError('External delegation payload contains private context', 'private_context');
      }
      const timeout = timeoutSignal(options.signal, options.timeoutMs ?? this.timeoutMs);
      let response: Awaited<ReturnType<AIRouter['run']>>;
      try {
        response = await abortable(this.external.run({ ...request, signal: timeout.signal }), timeout.signal);
      } finally {
        timeout.cancel();
      }
      if (response.scope !== 'remote') throw new AIOrchestrationPolicyError('External delegation resolved to a non-external model', 'wrong_scope');
      if (typeof response.text !== 'string') throw new AIOrchestrationPolicyError('External provider returned invalid text', 'invalid_result');
      // External tool intents are never executed or passed to another model.
      // Treat any request for a tool/private context as an explicit denial.
      if (response.toolIntents.length) throw new AIOrchestrationPolicyError('External provider requested a tool or private context', 'external_tool_request');
      const result: DelegationResult = {
        id: randomId(), planId, subtaskId: subtask.id, status: 'completed', execution: 'external', text: response.text,
        provider: response.model.provider, model: { ...response.model }, sourceIds,
        dataClasses: contextClasses(subtask.context), startedAt: started, completedAt: new Date().toISOString(),
        provenance: [provenance('external_delegation', 'external', sourceIds, contextClasses(subtask.context), `Delegated isolated subtask ${subtask.id}`, response.model, subtask.id), provenance('external_result', 'external', sourceIds, ['PUBLIC'], 'External result received', response.model, subtask.id)],
      };
      return result;
    } catch (error) {
      if (isAbortError(error, options.signal)) throw new DelegationCancelledError();
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  /** Bounded fan-out; result order is the caller's subtask order. */
  async delegateMany(subtasks: readonly AISubtask[], options: DelegateManyOptions = {}): Promise<readonly DelegationResult[]> {
    if (options.signal?.aborted) throw new DelegationCancelledError();
    // Validate every task before starting any worker, so a private task later
    // in a batch cannot race a valid task out to a provider.
    for (const subtask of subtasks) {
      const request = this.safeRequest(subtask);
      this.firewall.assert('remote', request.model as AIModelRef, request);
    }
    const results = new Array<DelegationResult>(subtasks.length);
    let next = 0;
    const workers = Array.from({ length: Math.min(this.maxParallel, Math.max(1, subtasks.length)) }, async () => {
      for (;;) {
        if (options.signal?.aborted) throw new DelegationCancelledError();
        const index = next++;
        if (index >= subtasks.length) return;
        results[index] = await this.delegate(subtasks[index], options);
      }
    });
    await Promise.all(workers);
    return results;
  }

  private safeRequest(subtask: AISubtask): AIRequest {
    validateSubtaskShape(subtask);
    if (!subtask.safeForExternal) throw new AIOrchestrationPolicyError('Subtask is not attested safe for external delegation', 'unsafe_subtask');
    if ((subtask.context ?? []).some(item => item.dataClass === 'PRIVATE' || item.dataClass === 'SECRET')) throw new AIOrchestrationPolicyError('PRIVATE/SECRET context cannot be delegated', 'private_context');
    if (subtask.systemDataClass === 'PRIVATE' || subtask.systemDataClass === 'SECRET') throw new AIOrchestrationPolicyError('Private system data cannot be delegated', 'private_system');
    if ((subtask.requestedTools ?? []).some(tool => tool.dataClass === 'PRIVATE' || tool.dataClass === 'SECRET')) throw new AIOrchestrationPolicyError('Private tools cannot be delegated', 'private_tool');
    const model = this.resolveRemoteModel(subtask.model);
    const request: AIRequest = {
      model,
      userText: subtask.objective,
      taskPrivacy: 'public',
      ...(subtask.systemPrompt ? { systemPrompt: subtask.systemPrompt, systemDataClass: subtask.systemDataClass ?? 'PUBLIC' } : {}),
      context: [...subtask.context ?? []],
      requestedTools: [...subtask.requestedTools ?? []],
    };
    // No history, attachment, nested context or tool intent is ever copied.
    return request;
  }

  private resolveRemoteModel(value?: AIModelRef | string): AIModelRef {
    if (value) {
      const ref = typeof value === 'string' ? parseAIModelRef(value) : { ...value };
      const descriptor = this.external.listModels().find(item => formatAIModelRef(item.ref) === formatAIModelRef(ref));
      if (!descriptor || descriptor.scope !== 'remote') throw new AIOrchestrationPolicyError('Selected delegation model is not an external model', 'wrong_scope');
      return { ...descriptor.ref };
    }
    const descriptor = this.external.listModels().find(item => item.scope === 'remote');
    if (!descriptor) throw new AIOrchestrationPolicyError('No external model is available for safe delegation', 'no_external_model');
    return { ...descriptor.ref };
  }
}

/** Local-first assistant coordinator with a bounded, auditable external edge. */
export class AIOrchestrator {
  private currentMode: AIOrchestrationMode;
  private readonly now: () => number;
  private readonly local?: AIRouter;
  private readonly personal?: AIComputeRouter;
  private readonly delegation?: SafeDelegationService;
  private readonly hooks: AIOrchestratorHooks;
  private readonly personalTarget?: AIComputeTarget;
  private latest?: AIOrchestratorResult;

  constructor(options: AIOrchestratorOptions = {}) {
    this.currentMode = options.defaultMode ?? 'balanced';
    this.now = options.now ?? (() => Date.now());
    this.local = options.local;
    this.personal = options.personal;
    this.delegation = options.delegation;
    this.hooks = options;
    this.personalTarget = options.personalTarget;
  }

  get mode(): AIOrchestrationMode { return this.currentMode; }
  setMode(mode: AIOrchestrationMode): void { validateMode(mode); this.currentMode = mode; }
  get lastResult(): Readonly<AIOrchestratorResult> | undefined { return this.latest ? cloneOrchestratorResult(this.latest) : undefined; }

  async run(request: AIOrchestratorRequest): Promise<AIOrchestratorResult> {
    const mode = request.mode ?? this.currentMode;
    validateMode(mode);
    if (typeof request.userText !== 'string' || !request.userText.trim()) throw new AIOrchestrationPolicyError('AI request text is empty', 'empty_request');
    if (request.signal?.aborted) throw new DelegationCancelledError();
    const plan = await this.makePlan(request, mode);
    validatePlan(plan, request, mode);
    const steps: AIProvenanceStep[] = [
      provenance('local_context', 'local', contextSourceIds(request), contextClasses([...request.context ?? [], ...request.history ?? [], ...request.attachments ?? [], ...request.nestedContext ?? []]), 'Private context remains on Keystone local/trusted execution'),
      provenance('local_planning', plan.finalExecutor, plan.sourceIds, ['PRIVATE'], plan.subtasks.length ? 'Local/trusted planner created isolated subtasks' : 'No external delegation was requested'),
      ...(plan.provenance ?? []),
    ];
    const delegations: DelegationResult[] = [];
    const externalTasks: AISubtask[] = [];
    const localTasks: AISubtask[] = [];
    const localFirst = mode === 'local-preferred' && Boolean(this.personal || this.local);
    for (const subtask of plan.subtasks) {
      if (mode !== 'private-only' && subtask.safeForExternal && this.delegation && !localFirst) externalTasks.push(subtask);
      else localTasks.push(subtask);
    }
    for (const subtask of localTasks.splice(0)) {
      try {
        const result = await this.executeLocalSubtask(subtask, plan.id, request.signal);
        delegations.push(result);
        steps.push(...result.provenance);
      } catch (error) {
        if (localFirst && subtask.safeForExternal && this.delegation) externalTasks.push(subtask);
        else throw error;
      }
    }
    if (externalTasks.length) {
      try {
        const values = await this.delegation!.delegateMany(externalTasks, { signal: request.signal, timeoutMs: this.delegation!.timeoutMs, planId: plan.id });
        delegations.push(...values);
        steps.push(...values.flatMap(result => result.provenance));
      } catch (error) {
        if (error instanceof DelegationCancelledError) throw error;
        if (localFirst) throw error;
        // A safe-delegation failure is never a private fallback. Keep the
        // final response local and expose a bounded blocked provenance entry.
        steps.push(provenance('blocked', 'external', externalTasks.flatMap(task => task.sourceIds), ['PRIVATE'], `External delegation failed closed (${failureCode(error)})`));
        for (const subtask of externalTasks) {
          const result = await this.executeLocalSubtask(subtask, plan.id, request.signal);
          delegations.push(result);
          steps.push(...result.provenance);
        }
      }
    }
    delegations.sort((a, b) => plan.subtasks.findIndex(value => value.id === a.subtaskId) - plan.subtasks.findIndex(value => value.id === b.subtaskId));
    const synthesis = await this.synthesize(request, plan, delegations, steps);
    steps.push(provenance('local_synthesis', synthesis.execution, plan.sourceIds, ['PRIVATE'], 'Final answer assembled on local/trusted execution'));
    const hasExternal = delegations.some(result => result.execution === 'external' && result.status === 'completed');
    const result: AIOrchestratorResult = {
      text: synthesis.text,
      plan: clonePlan(plan),
      delegations: delegations.map(cloneDelegationResult),
      synthesisExecution: synthesis.execution,
      provenance: { steps: steps.map(cloneProvenance), indicator: hasExternal ? 'external_isolated_subtask' : 'processed_privately' },
      privacyIndicator: hasExternal ? 'external_isolated_subtask' : 'processed_privately',
    };
    this.latest = result;
    return cloneOrchestratorResult(result);
  }

  private async makePlan(request: AIOrchestratorRequest, mode: AIOrchestrationMode): Promise<DelegationPlan> {
    if (request.plan) return clonePlan(request.plan);
    if (request.subtasks) return { id: randomId(), version: 1, mode, createdAt: new Date(this.now()).toISOString(), finalExecutor: this.personal ? 'personal_trusted' : 'local', sourceIds: contextSourceIds(request), subtasks: request.subtasks.map(cloneSubtask) };
    if (this.hooks.plan) return clonePlan(await this.hooks.plan(request));
    return { id: randomId(), version: 1, mode, createdAt: new Date(this.now()).toISOString(), finalExecutor: this.personal ? 'personal_trusted' : 'local', sourceIds: contextSourceIds(request), subtasks: [] };
  }

  private async executeLocalSubtask(subtask: AISubtask, planId: string, signal?: AbortSignal): Promise<DelegationResult> {
    const started = new Date(this.now()).toISOString();
    const request: AIComputeRouteRequest = { model: subtask.model, userText: subtask.objective, taskPrivacy: 'private', systemPrompt: subtask.systemPrompt, systemDataClass: subtask.systemDataClass, context: subtask.context, requestedTools: subtask.requestedTools, target: this.personalTarget, signal };
    try {
      if (this.personal) {
        const response = await this.personal.complete(request);
        const model = response.model;
        return { id: randomId(), planId, subtaskId: subtask.id, status: 'completed', execution: 'personal_trusted', text: response.text, ...(model ? { model } : {}), sourceIds: [...subtask.sourceIds], dataClasses: contextClasses(subtask.context), startedAt: started, completedAt: new Date(this.now()).toISOString(), provenance: [provenance('trusted_execution', 'personal_trusted', subtask.sourceIds, contextClasses(subtask.context), `Subtask ${subtask.id} executed on trusted personal compute`, model, subtask.id)] };
      }
      if (!this.local) throw new PrivateAIUnavailableError();
      const response = await this.local.run({ ...request, model: undefined });
      if (response.scope !== 'local') throw new PrivateAIUnavailableError('Final private execution resolved to an external model');
      return { id: randomId(), planId, subtaskId: subtask.id, status: 'completed', execution: 'local', text: response.text, model: { ...response.model }, sourceIds: [...subtask.sourceIds], dataClasses: contextClasses(subtask.context), startedAt: started, completedAt: new Date(this.now()).toISOString(), provenance: [provenance('trusted_execution', 'local', subtask.sourceIds, contextClasses(subtask.context), `Subtask ${subtask.id} executed locally`, response.model, subtask.id)] };
    } catch (error) {
      if (isAbortError(error, signal)) throw new DelegationCancelledError();
      throw error;
    }
  }

  private async synthesize(request: AIOrchestratorRequest, plan: DelegationPlan, delegations: readonly DelegationResult[], steps: readonly AIProvenanceStep[]): Promise<{ text: string; execution: 'local' | 'personal_trusted' }> {
    if (this.hooks.synthesize) {
      const value = await this.hooks.synthesize({ request, plan, delegations, provenance: steps, signal: request.signal });
      if (typeof value !== 'string' && (!value || typeof value !== 'object')) throw new Error('Local synthesis returned invalid result');
      const text = typeof value === 'string' ? value : value.text;
      const requestedExecution = typeof value === 'string' ? undefined : (value as { execution?: unknown }).execution;
      if (requestedExecution !== undefined && requestedExecution !== 'local' && requestedExecution !== 'personal_trusted') throw new AIOrchestrationPolicyError('Final synthesis must remain local or trusted', 'external_synthesis');
      const execution = typeof value === 'string' ? (this.personal ? 'personal_trusted' : 'local') : (requestedExecution as 'local' | 'personal_trusted' | undefined) ?? (this.personal ? 'personal_trusted' : 'local');
      if (typeof text !== 'string') throw new Error('Local synthesis returned invalid text');
      return { text, execution };
    }
    const resultContext: AIContextItem[] = delegations.filter(result => result.status === 'completed' && typeof result.text === 'string').map(result => ({ id: `delegation:${result.subtaskId}`, dataClass: 'PUBLIC', source: 'ai-delegation', value: result.text }));
    const synthesisRequest: AIComputeRouteRequest = { ...request, model: undefined, taskPrivacy: 'private', context: [...request.context ?? [], ...resultContext], history: request.history, attachments: request.attachments, nestedContext: request.nestedContext, target: this.personalTarget, signal: request.signal };
    if (this.personal) { const value = await this.personal.complete(synthesisRequest); return { text: value.text, execution: 'personal_trusted' }; }
    if (this.local) { const value = await this.local.run(synthesisRequest); if (value.scope !== 'local') throw new PrivateAIUnavailableError('Final private synthesis resolved to an external model'); return { text: value.text, execution: 'local' }; }
    throw new PrivateAIUnavailableError('No local or trusted AI runtime is available for final synthesis');
  }
}

function validateMode(value: unknown): asserts value is AIOrchestrationMode { if (value !== 'private-only' && value !== 'balanced' && value !== 'local-preferred') throw new Error('Invalid AI orchestration mode'); }

function validatePlan(plan: DelegationPlan, request: AIOrchestratorRequest, mode: AIOrchestrationMode): void {
  if (!plan || plan.version !== 1 || !safeId(plan.id) || plan.mode !== mode || !['local', 'personal_trusted'].includes(plan.finalExecutor) || !Array.isArray(plan.sourceIds) || !Number.isFinite(Date.parse(plan.createdAt)) || !Array.isArray(plan.subtasks) || plan.subtasks.length > 32) throw new AIOrchestrationPolicyError('Invalid delegation plan', 'invalid_plan');
  const seen = new Set<string>();
  for (const id of plan.sourceIds) if (!safeId(id)) throw new AIOrchestrationPolicyError('Invalid provenance source id', 'invalid_source');
  if (plan.provenance) {
    if (!Array.isArray(plan.provenance) || plan.provenance.length > 64) throw new AIOrchestrationPolicyError('Invalid plan provenance', 'invalid_provenance');
    for (const step of plan.provenance) {
      if (!step || !safeId(step.id) || !['local_context', 'local_planning', 'trusted_execution', 'external_delegation', 'external_result', 'local_synthesis', 'blocked'].includes(step.kind) || !['local', 'personal_trusted', 'external'].includes(step.execution) || !Array.isArray(step.sourceIds) || !Array.isArray(step.dataClasses) || typeof step.summary !== 'string' || step.summary.length > 240) throw new AIOrchestrationPolicyError('Invalid plan provenance', 'invalid_provenance');
      if (step.sourceIds.some((sourceId: unknown) => !safeId(sourceId)) || step.dataClasses.some((dataClass: unknown) => !['PUBLIC', 'USER_EXPLICIT', 'PRIVATE', 'SECRET'].includes(dataClass as string))) throw new AIOrchestrationPolicyError('Invalid plan provenance', 'invalid_provenance');
      if (step.model) { try { formatAIModelRef(step.model); } catch { throw new AIOrchestrationPolicyError('Invalid plan provenance model', 'invalid_provenance'); } }
      assertNoPrivateText(step.summary, request, 'provenance');
    }
  }
  for (const subtask of plan.subtasks) {
    validateSubtaskShape(subtask);
    if (seen.has(subtask.id)) throw new AIOrchestrationPolicyError('Duplicate delegation subtask id', 'duplicate_subtask');
    seen.add(subtask.id);
    for (const sourceId of subtask.sourceIds) if (!safeId(sourceId)) throw new AIOrchestrationPolicyError('Invalid subtask source id', 'invalid_source');
    if (subtask.safeForExternal) assertNoPrivateOverlap(subtask, request);
  }
}

function validateSubtaskShape(value: AISubtask): void {
  if (!value || !safeId(value.id) || typeof value.objective !== 'string' || !value.objective.trim() || value.objective.length > 1_000_000 || typeof value.safeForExternal !== 'boolean' || !Array.isArray(value.sourceIds)) throw new AIOrchestrationPolicyError('Invalid AI subtask', 'invalid_subtask');
  if (value.sourceIds.some(sourceId => !safeId(sourceId))) throw new AIOrchestrationPolicyError('Invalid subtask source id', 'invalid_source');
  if (value.systemDataClass && !['PUBLIC', 'USER_EXPLICIT', 'PRIVATE', 'SECRET'].includes(value.systemDataClass)) throw new AIOrchestrationPolicyError('Invalid subtask data class', 'invalid_class');
  if (value.systemDataClass && !value.systemPrompt) throw new AIOrchestrationPolicyError('Subtask system data class has no system prompt', 'invalid_system');
  if (value.context && !Array.isArray(value.context)) throw new AIOrchestrationPolicyError('Invalid subtask context', 'invalid_context');
  if (value.requestedTools && !Array.isArray(value.requestedTools)) throw new AIOrchestrationPolicyError('Invalid subtask tools', 'invalid_tools');
}

/** Rejects accidental copying of private source values into a supposedly safe objective. */
function assertNoPrivateOverlap(subtask: AISubtask, request: AIOrchestratorRequest): void {
  assertNoPrivateText(subtask.objective, request, 'private_prompt');
}

function assertNoPrivateText(text: string, request: AIOrchestratorRequest, code: string): void {
  const taskPrivacy = request.taskPrivacy ?? request.privacy ?? 'general';
  const privateValues = [...request.context ?? [], ...request.history ?? [], ...request.attachments ?? [], ...request.nestedContext ?? []].filter(item => item.dataClass === 'PRIVATE' || item.dataClass === 'SECRET').map(item => stringify(item.value)).filter(value => value.length >= 4);
  if (taskPrivacy === 'private' && text.trim() === request.userText.trim()) throw new AIOrchestrationPolicyError('Private user prompt cannot be delegated', code);
  if (privateValues.some(value => text.includes(value))) throw new AIOrchestrationPolicyError('Private source content appears in an external subtask', code);
}

function contextClasses(items: readonly AIContextItem[] | undefined): AIDataClass[] { const values = new Set<AIDataClass>((items ?? []).map(item => item.dataClass)); return ['PUBLIC', 'USER_EXPLICIT', 'PRIVATE', 'SECRET'].filter(value => values.has(value as AIDataClass)) as AIDataClass[]; }
function contextSourceIds(request: Pick<AIRequest, 'context' | 'history' | 'attachments' | 'nestedContext'>): string[] { return [...request.context ?? [], ...request.history ?? [], ...request.attachments ?? [], ...request.nestedContext ?? []].map(item => item.id).filter(safeId); }
function provenance(kind: AIProvenanceStepKind, execution: AIExecutionKind, sourceIds: readonly string[], dataClasses: readonly AIDataClass[], summary: string, model?: AIModelRef, subtaskId?: string): AIProvenanceStep { return { id: randomId(), at: new Date().toISOString(), kind, execution, sourceIds: [...sourceIds], dataClasses: [...dataClasses], ...(model ? { provider: model.provider, model: { ...model } } : {}), ...(subtaskId ? { subtaskId } : {}), summary: summary.slice(0, 240) }; }
function cloneSubtask(value: AISubtask): AISubtask { return { ...value, sourceIds: [...value.sourceIds], ...(value.context ? { context: value.context.map(item => ({ ...item, value: cloneValue(item.value) })) } : {}), ...(value.requestedTools ? { requestedTools: value.requestedTools.map(tool => ({ ...tool })) } : {}), ...(value.model ? { model: typeof value.model === 'string' ? value.model : { ...value.model } } : {}) }; }
function clonePlan(value: DelegationPlan): DelegationPlan { return { ...value, sourceIds: [...value.sourceIds], subtasks: value.subtasks.map(cloneSubtask), ...(value.provenance ? { provenance: value.provenance.map(cloneProvenance) } : {}) }; }
function cloneDelegationResult(value: DelegationResult): DelegationResult { return { ...value, ...(value.model ? { model: { ...value.model } } : {}), sourceIds: [...value.sourceIds], dataClasses: [...value.dataClasses], provenance: value.provenance.map(cloneProvenance) }; }
function cloneProvenance(value: AIProvenanceStep): AIProvenanceStep { return { ...value, sourceIds: [...value.sourceIds], dataClasses: [...value.dataClasses], ...(value.model ? { model: { ...value.model } } : {}) }; }
function cloneOrchestratorResult(value: AIOrchestratorResult): AIOrchestratorResult { return { ...value, plan: clonePlan(value.plan), delegations: value.delegations.map(cloneDelegationResult), provenance: { indicator: value.provenance.indicator, steps: value.provenance.steps.map(cloneProvenance) } }; }
function cloneValue(value: unknown): unknown { try { return structuredClone(value); } catch { return stringify(value); } }
function stringify(value: unknown): string { if (typeof value === 'string') return value.slice(0, 1_000_000); try { const result = JSON.stringify(value); return typeof result === 'string' ? result.slice(0, 1_000_000) : String(value); } catch { return '[unserializable]'; } }
function safeId(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value); }
function randomId(): string { return `${globalThis.crypto.randomUUID()}`; }
function clampInt(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, Number.isSafeInteger(value) ? value : min)); }
function failureCode(error: unknown): string { return error instanceof AIOrchestrationPolicyError ? error.code : error instanceof DelegationCancelledError ? 'cancelled' : 'provider_failure'; }
function isAbortError(error: unknown, signal?: AbortSignal): boolean { return !!signal?.aborted || error instanceof DelegationCancelledError || (error instanceof Error && error.name === 'AbortError'); }
function timeoutSignal(parent: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), clampInt(timeoutMs, 100, 900_000));
  const finish = () => { clearTimeout(timer); };
  let onParentAbort: (() => void) | undefined;
  if (parent) { if (parent.aborted) controller.abort(); else { onParentAbort = () => { controller.abort(); finish(); }; parent.addEventListener('abort', onParentAbort, { once: true }); } }
  controller.signal.addEventListener('abort', finish, { once: true });
  return { signal: controller.signal, cancel: () => { finish(); if (parent && onParentAbort) parent.removeEventListener('abort', onParentAbort); } };
}
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new DelegationCancelledError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DelegationCancelledError());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(value => { signal.removeEventListener('abort', onAbort); resolve(value); }, error => { signal.removeEventListener('abort', onAbort); reject(error); });
  });
}
