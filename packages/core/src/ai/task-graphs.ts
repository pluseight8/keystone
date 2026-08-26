/**
 * Bounded DAG orchestration for the persistent Agent Bot.
 *
 * Task graphs deliberately reuse EphemeralAgentWorkerService.  They add only
 * planning, dependency, artifact, and lifecycle state; model loading,
 * inference scheduling, ToolPolicy, ContextCacheManager, and privacy
 * enforcement remain in their existing services.
 */

import { canonicalJson } from '../crypto.js';
import type { AIContextItem, AIDataClass, AIModelRef } from './privacy.js';
import {
  EphemeralAgentWorkerService,
  type WorkerCapabilityGrantInput,
  type WorkerDataScope,
  type WorkerExecution,
  type WorkerResult,
  type WorkerType,
  WORKER_TYPES,
} from './workers.js';
import type { InferencePriority } from './resource-scheduler.js';
import type { ToolCapability } from './tools.js';
import type { ToolFlowExecutor, ToolFlowProgram } from './toolflow.js';
import { SecretRedactionPolicy } from '../security/secrets.js';

export const TASK_GRAPH_VERSION = 1 as const;

export const TASK_GRAPH_LIFECYCLES = ['PLANNING', 'READY', 'RUNNING', 'WAITING', 'PAUSED', 'COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED'] as const;
export type TaskGraphLifecycle = (typeof TASK_GRAPH_LIFECYCLES)[number];

export const TASK_NODE_STATUSES = ['PENDING', 'READY', 'RUNNING', 'WAITING', 'PAUSED', 'COMPLETED', 'FAILED', 'CANCELLED', 'SKIPPED', 'STALE', 'REMOVED'] as const;
export type TaskNodeStatus = (typeof TASK_NODE_STATUSES)[number];

export const TASK_ARTIFACT_KINDS = ['text', 'structured', 'object_references', 'citations', 'file_reference', 'error'] as const;
export type TaskArtifactKind = (typeof TASK_ARTIFACT_KINDS)[number];

export type TaskGraphErrorCode =
  | 'INVALID_ARGUMENT'
  | 'GRAPH_NOT_FOUND'
  | 'GRAPH_ALREADY_EXISTS'
  | 'GRAPH_TERMINAL'
  | 'GRAPH_REVISION_CONFLICT'
  | 'GRAPH_CYCLE'
  | 'GRAPH_MISSING_DEPENDENCY'
  | 'GRAPH_DUPLICATE_NODE'
  | 'GRAPH_IMPOSSIBLE_DEPENDENCY'
  | 'GRAPH_SIZE_LIMIT'
  | 'GRAPH_DEPTH_LIMIT'
  | 'GRAPH_FANOUT_LIMIT'
  | 'GRAPH_CAPABILITY_DENIED'
  | 'GRAPH_SCOPE_DENIED'
  | 'GRAPH_EXTERNAL_PRIVATE'
  | 'GRAPH_STALLED'
  | 'GRAPH_RUNTIME_LIMIT'
  | 'GRAPH_INFERENCE_LIMIT'
  | 'GRAPH_TOOL_LIMIT'
  | 'GRAPH_RETRY_LIMIT'
  | 'GRAPH_ARTIFACT_LIMIT'
  | 'GRAPH_ARTIFACT_TOO_LARGE'
  | 'GRAPH_ARTIFACT_INVALID'
  | 'GRAPH_STALE_RESULT'
  | 'GRAPH_DEPENDENCY_FAILED'
  | 'GRAPH_AGENT_UNAVAILABLE'
  | 'GRAPH_TOOLFLOW_UNAVAILABLE'
  | 'GRAPH_CANCELLED'
  | 'GRAPH_PAUSED'
  | 'FAILED';

export class TaskGraphError extends Error {
  constructor(readonly code: TaskGraphErrorCode, message: string) {
    super(message);
    this.name = 'TaskGraphError';
  }
}

export interface TaskDependencyRef {
  readonly nodeId: string;
  readonly required?: boolean;
  /** Artifact IDs that this edge is expected to provide. */
  readonly inputRefs?: readonly string[];
}

/** String dependencies remain accepted for compact graph declarations. */
export type TaskDependency = string | TaskDependencyRef;

export interface TaskRetryPolicy {
  readonly maxAttempts: number;
  readonly backoffMs?: number;
  readonly retryableCodes?: readonly string[];
}

export interface TaskAssignment {
  readonly kind?: 'worker' | 'agent' | 'flow';
  readonly workerType?: WorkerType;
  readonly agentId?: string;
  readonly execution?: WorkerExecution;
  readonly model?: AIModelRef;
  readonly toolIds?: readonly string[];
  readonly skillIds?: readonly string[];
  readonly capabilities?: readonly ToolCapability[];
  readonly dataScope?: WorkerDataScope;
  readonly grant?: WorkerCapabilityGrantInput;
  readonly toolFlow?: ToolFlowProgram;
}

export interface TaskNode {
  readonly version: 1;
  readonly id: string;
  readonly title: string;
  readonly objective: string;
  readonly workerType: WorkerType;
  readonly agentId?: string;
  readonly assignment: TaskAssignment;
  readonly dependencies: readonly TaskDependency[];
  readonly requiredCapabilities: readonly ToolCapability[];
  readonly allowedDataScopes: readonly WorkerDataScope[];
  readonly contextItems: readonly AIContextItem[];
  readonly inputRefs: readonly string[];
  readonly outputRefs: readonly string[];
  readonly priority: InferencePriority;
  readonly timeoutMs: number;
  readonly retryPolicy: TaskRetryPolicy;
  readonly status: TaskNodeStatus;
  readonly nodeRevision: number;
  readonly attempt: number;
  readonly workerId?: string;
  readonly errorCode?: TaskGraphErrorCode | string;
  readonly errorMessage?: string;
  readonly outputArtifactIds: readonly string[];
  readonly startedAt?: string;
  readonly completedAt?: string;
  /** Optional bounded ToolFlow for mechanical work inside this node. */
  readonly toolFlow?: ToolFlowProgram;
}

export interface TaskNodeInput {
  readonly id: string;
  readonly title?: string;
  readonly objective: string;
  readonly workerType?: WorkerType;
  readonly agentId?: string;
  readonly assignment?: TaskAssignment;
  readonly dependencies?: readonly TaskDependency[];
  readonly requiredCapabilities?: readonly ToolCapability[];
  readonly allowedDataScopes?: readonly WorkerDataScope[];
  readonly contextItems?: readonly AIContextItem[];
  readonly inputRefs?: readonly string[];
  readonly outputRefs?: readonly string[];
  readonly priority?: InferencePriority;
  readonly timeoutMs?: number;
  readonly retryPolicy?: Partial<TaskRetryPolicy>;
  readonly toolFlow?: ToolFlowProgram;
}

export interface TaskGraphBudget {
  readonly maxNodes: number;
  readonly maxConcurrentNodes: number;
  readonly maxDepth: number;
  readonly maxFanOut: number;
  readonly maxInferenceJobs: number;
  readonly maxToolCalls: number;
  readonly maxRetries: number;
  readonly maxRuntimeMs: number;
  readonly maxContextTokens: number;
  readonly maxGeneratedArtifacts: number;
  readonly maxArtifactBytes: number;
}

export interface TaskArtifactCitation {
  readonly id: string;
  readonly sourceType?: string;
  readonly dataClass: AIDataClass;
}

export interface TaskArtifactProvenance {
  readonly producerNodeId: string;
  readonly workerId?: string;
  readonly sourceIds: readonly string[];
  readonly graphRevision: number;
  readonly nodeRevision: number;
}

export interface TaskArtifact {
  readonly version: 1;
  readonly id: string;
  readonly graphId: string;
  readonly graphRevision: number;
  readonly producerNodeId: string;
  readonly nodeRevision: number;
  readonly kind: TaskArtifactKind;
  readonly value?: unknown;
  readonly objectReferences: readonly string[];
  readonly citations: readonly TaskArtifactCitation[];
  readonly provenance: readonly TaskArtifactProvenance[];
  readonly dataClass: AIDataClass;
  readonly scope: WorkerDataScope;
  readonly integrity: string;
  readonly sizeBytes: number;
  readonly createdAt: string;
}

export interface TaskArtifactInput {
  readonly id?: string;
  readonly kind?: TaskArtifactKind;
  readonly value?: unknown;
  readonly objectReferences?: readonly string[];
  readonly citations?: readonly TaskArtifactCitation[];
  readonly dataClass?: AIDataClass;
  readonly scope?: WorkerDataScope;
}

export interface AgentTaskGraph {
  readonly version: 1;
  readonly id: string;
  readonly goal: string;
  readonly parentAgentId: string;
  readonly parentRunId?: string;
  readonly execution: WorkerExecution;
  readonly model?: AIModelRef;
  readonly allowedCapabilities: readonly ToolCapability[];
  readonly allowedDataScopes: readonly WorkerDataScope[];
  readonly budget: TaskGraphBudget;
  readonly nodes: readonly TaskNode[];
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TaskGraphInput {
  readonly id?: string;
  readonly goal: string;
  readonly parentAgentId: string;
  readonly parentRunId?: string;
  readonly execution?: WorkerExecution;
  readonly model?: AIModelRef;
  readonly allowedCapabilities?: readonly ToolCapability[];
  readonly allowedDataScopes?: readonly WorkerDataScope[];
  readonly contextItems?: readonly AIContextItem[];
  readonly budget?: Partial<TaskGraphBudget>;
  readonly nodes: readonly TaskNodeInput[];
}

export interface TaskGraphCounters {
  readonly inferenceJobs: number;
  readonly toolCalls: number;
  readonly retries: number;
  readonly generatedArtifacts: number;
  readonly artifactBytes: number;
}

export interface TaskGraphSummary {
  readonly output?: string;
  readonly completedNodeIds: readonly string[];
  readonly failedNodeIds: readonly string[];
  readonly skippedNodeIds: readonly string[];
  readonly artifactIds: readonly string[];
}

export interface TaskGraphState {
  version: 1;
  graph: AgentTaskGraph;
  lifecycle: TaskGraphLifecycle;
  graphRevision: number;
  nodes: readonly TaskNode[];
  artifacts: readonly TaskArtifact[];
  counters: TaskGraphCounters;
  summary?: TaskGraphSummary;
  errorCode?: TaskGraphErrorCode | string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TaskGraphResult extends TaskGraphSummary {
  readonly graphId: string;
  readonly lifecycle: TaskGraphLifecycle;
  readonly graphRevision: number;
  readonly state: TaskGraphState;
}

export interface TaskGraphStateStore {
  read(): Promise<unknown | undefined>;
  write(value: unknown): Promise<void>;
}

export class InMemoryTaskGraphStateStore implements TaskGraphStateStore {
  private value?: unknown;
  async read(): Promise<unknown | undefined> { return this.value === undefined ? undefined : structuredClone(this.value); }
  async write(value: unknown): Promise<void> { this.value = structuredClone(value); }
}

export interface TaskGraphPlanOutput {
  readonly graph: AgentTaskGraph;
  readonly topologicalOrder: readonly string[];
  readonly depths: Readonly<Record<string, number>>;
}

export interface TaskGraphPlannerOptions {
  readonly now?: () => number;
}

export interface TaskGraphReplanInput {
  readonly expectedRevision?: number;
  readonly goal?: string;
  readonly addNodes?: readonly TaskNodeInput[];
  readonly updateNodes?: readonly { id: string; patch: Partial<TaskNodeInput> }[];
  readonly removeNodeIds?: readonly string[];
  readonly reason?: string;
  readonly allowCapabilityExpansion?: boolean;
}

export interface TaskGraphAgentRunInput {
  readonly graph: AgentTaskGraph;
  readonly node: TaskNode;
  readonly context: readonly AIContextItem[];
  readonly artifacts: readonly TaskArtifact[];
  readonly signal: AbortSignal;
}

export type TaskGraphAgentExecutor = (input: TaskGraphAgentRunInput) => Promise<WorkerResult | TaskArtifactInput | readonly TaskArtifactInput[]>;

export interface TaskGraphExecutorOptions {
  readonly workerService: EphemeralAgentWorkerService;
  readonly storage?: TaskGraphStateStore;
  readonly planner?: TaskGraphPlanner;
  readonly now?: () => number;
  readonly runAgent?: TaskGraphAgentExecutor;
  /** Optional ToolFlow runtime used for mechanical internal node work. */
  readonly toolFlowExecutor?: ToolFlowExecutor;
  readonly validateCapabilityExpansion?: (input: { graph: AgentTaskGraph; requestedCapabilities: readonly ToolCapability[]; requestedDataScopes: readonly WorkerDataScope[]; reason?: string }) => Promise<boolean> | boolean;
}

interface GraphExecution {
  readonly controller: AbortController;
  readonly running: Map<string, Promise<void>>;
  completion?: Promise<TaskGraphState>;
  paused: boolean;
  wake?: () => void;
}

interface NormalizedGraphInput {
  readonly id: string;
  readonly goal: string;
  readonly parentAgentId: string;
  readonly parentRunId?: string;
  readonly execution: WorkerExecution;
  readonly model?: AIModelRef;
  readonly allowedCapabilities: readonly ToolCapability[];
  readonly allowedDataScopes: readonly WorkerDataScope[];
  readonly budget: TaskGraphBudget;
  readonly nodes: readonly TaskNode[];
}

const DEFAULT_BUDGET: TaskGraphBudget = {
  maxNodes: 32,
  maxConcurrentNodes: 3,
  maxDepth: 8,
  maxFanOut: 8,
  maxInferenceJobs: 48,
  maxToolCalls: 96,
  maxRetries: 8,
  maxRuntimeMs: 10 * 60_000,
  maxContextTokens: 16_384,
  maxGeneratedArtifacts: 128,
  maxArtifactBytes: 256 * 1024,
};

const PRIORITIES: readonly InferencePriority[] = ['USER_INTERACTIVE', 'ACTIVE_AGENT', 'BROWSER', 'AGENT_SOCIAL', 'AUTOMATION', 'RECOMMENDATION', 'MEMORY_CONSOLIDATION', 'BACKGROUND'];
const DATA_CLASSES: readonly AIDataClass[] = ['PUBLIC', 'USER_EXPLICIT', 'PRIVATE', 'SECRET'];
const CAPABILITIES: readonly ToolCapability[] = ['READ_PRIVATE', 'WRITE_PRIVATE', 'NETWORK_SEND', 'DEVICE_ACTION', 'DESTRUCTIVE', 'SECURITY_SENSITIVE'];

function clone<T>(value: T): T { return structuredClone(value); }
function nowIso(now: () => number): string { return new Date(now()).toISOString(); }
function randomId(prefix: string): string { return `${prefix}-${crypto.randomUUID()}`; }
function safeId(value: unknown, max = 256): value is string { return typeof value === 'string' && value.length > 0 && value.length <= max && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value); }
function safeText(value: unknown, max = 64_000): value is string { return typeof value === 'string' && value.trim().length > 0 && value.length <= max; }
function boundedInt(value: number | undefined, min: number, max: number, fallback: number): number { return Number.isSafeInteger(value) ? Math.max(min, Math.min(max, value!)) : fallback; }
function unique<T>(values: readonly T[], max = 512): T[] { return [...new Set(values)].slice(0, max); }
function isPrivate(value: AIDataClass): boolean { return value === 'PRIVATE' || value === 'SECRET'; }
function assertNoManagedSecret(value: unknown, message = 'Task graph cannot carry managed secret material'): void { if (SecretRedactionPolicy.containsManagedSecret(value)) throw new TaskGraphError('GRAPH_SCOPE_DENIED', message); }
function maxDataClass(left: AIDataClass, right: AIDataClass): AIDataClass { const rank: Record<AIDataClass, number> = { PUBLIC: 0, USER_EXPLICIT: 1, PRIVATE: 2, SECRET: 3 }; return rank[left] >= rank[right] ? left : right; }
function terminalGraph(value: TaskGraphLifecycle): boolean { return value === 'COMPLETED' || value === 'PARTIAL' || value === 'FAILED' || value === 'CANCELLED'; }
function terminalNode(value: TaskNodeStatus): boolean { return value === 'COMPLETED' || value === 'FAILED' || value === 'CANCELLED' || value === 'SKIPPED' || value === 'REMOVED'; }
function dependencyId(value: TaskDependency): string { return typeof value === 'string' ? value : value.nodeId; }
function dependencyRequired(value: TaskDependency): boolean { return typeof value === 'string' ? true : value.required !== false; }
function dependencyInputRefs(value: TaskDependency): readonly string[] { return typeof value === 'string' ? [] : value.inputRefs ?? []; }
function serialSize(value: unknown): number { try { return new TextEncoder().encode(JSON.stringify(value) ?? String(value)).byteLength; } catch { return Number.MAX_SAFE_INTEGER; } }
function digest(value: unknown): string { assertNoManagedSecret(value, 'Task graph integrity payload contains managed secret material'); const text = canonicalJson(value); let a = 2166136261; let b = 16777619; for (let index = 0; index < text.length; index += 1) { const code = text.charCodeAt(index); a = Math.imul(a ^ code, 16777619); b = Math.imul(b ^ (code + index), 2246822519); } return `artifact-${(a >>> 0).toString(16).padStart(8, '0')}${(b >>> 0).toString(16).padStart(8, '0')}`; }
function normalizeModel(model: AIModelRef | undefined): AIModelRef | undefined { if (!model) return undefined; if (!safeId(model.provider, 128) || !safeId(model.model, 128)) throw new TaskGraphError('INVALID_ARGUMENT', 'Invalid graph model'); return { provider: model.provider, model: model.model }; }
function normalizeCapabilities(values: readonly ToolCapability[] | undefined): ToolCapability[] { const result = unique((values ?? []).filter(value => CAPABILITIES.includes(value))); if ((values ?? []).some(value => !CAPABILITIES.includes(value))) throw new TaskGraphError('INVALID_ARGUMENT', 'Unknown graph capability'); return result; }
function normalizeDataScopes(values: readonly WorkerDataScope[] | undefined, fallback: readonly WorkerDataScope[]): WorkerDataScope[] { const source = values?.length ? values : fallback; return source.map(scope => { const dataClasses = scope.dataClasses ?? []; if (dataClasses.some(value => !DATA_CLASSES.includes(value))) throw new TaskGraphError('INVALID_ARGUMENT', 'Unknown data class in graph scope'); if (scope.sourceKinds?.some(value => !safeId(value)) || scope.objectIds?.some(value => !safeId(value))) throw new TaskGraphError('INVALID_ARGUMENT', 'Invalid graph scope restriction'); return { dataClasses: unique(dataClasses), ...(scope.sourceKinds?.length ? { sourceKinds: unique(scope.sourceKinds) } : {}), ...(scope.objectIds?.length ? { objectIds: unique(scope.objectIds) } : {}) }; }).filter(scope => scope.dataClasses.length > 0); }
function scopeAllows(scope: WorkerDataScope, dataClass: AIDataClass, source?: string, objectId?: string): boolean { if (!scope.dataClasses.includes(dataClass)) return false; if (scope.sourceKinds?.length && (!source || !scope.sourceKinds.includes(source))) return false; if (scope.objectIds?.length && (!objectId || !scope.objectIds.includes(objectId))) return false; return true; }
function anyScopeAllows(scopes: readonly WorkerDataScope[], dataClass: AIDataClass, source?: string, objectId?: string): boolean { return scopes.some(scope => scopeAllows(scope, dataClass, source, objectId)); }
function scopeSubset(child: WorkerDataScope, parents: readonly WorkerDataScope[]): boolean {
  const restrictionSubset = (childValues: readonly string[] | undefined, parentValues: readonly string[] | undefined): boolean => {
    if (!childValues?.length) return !parentValues?.length;
    if (!parentValues?.length) return true;
    return childValues.every(value => parentValues.includes(value));
  };
  return child.dataClasses.every(value => parents.some(parent => parent.dataClasses.includes(value) && restrictionSubset(child.sourceKinds, parent.sourceKinds) && restrictionSubset(child.objectIds, parent.objectIds)));
}
function normalizeBudget(input?: Partial<TaskGraphBudget>): TaskGraphBudget { const value = input ?? {}; return { maxNodes: boundedInt(value.maxNodes, 1, 256, DEFAULT_BUDGET.maxNodes), maxConcurrentNodes: boundedInt(value.maxConcurrentNodes, 1, 32, DEFAULT_BUDGET.maxConcurrentNodes), maxDepth: boundedInt(value.maxDepth, 1, 64, DEFAULT_BUDGET.maxDepth), maxFanOut: boundedInt(value.maxFanOut, 1, 32, DEFAULT_BUDGET.maxFanOut), maxInferenceJobs: boundedInt(value.maxInferenceJobs, 1, 1_024, DEFAULT_BUDGET.maxInferenceJobs), maxToolCalls: boundedInt(value.maxToolCalls, 0, 4_096, DEFAULT_BUDGET.maxToolCalls), maxRetries: boundedInt(value.maxRetries, 0, 128, DEFAULT_BUDGET.maxRetries), maxRuntimeMs: boundedInt(value.maxRuntimeMs, 100, 3_600_000, DEFAULT_BUDGET.maxRuntimeMs), maxContextTokens: boundedInt(value.maxContextTokens, 256, 128_000, DEFAULT_BUDGET.maxContextTokens), maxGeneratedArtifacts: boundedInt(value.maxGeneratedArtifacts, 1, 4_096, DEFAULT_BUDGET.maxGeneratedArtifacts), maxArtifactBytes: boundedInt(value.maxArtifactBytes, 1_024, 4 * 1024 * 1024, DEFAULT_BUDGET.maxArtifactBytes) }; }
function normalizeRetry(value: Partial<TaskRetryPolicy> | undefined): TaskRetryPolicy { return { maxAttempts: boundedInt(value?.maxAttempts, 1, 8, 1), ...(value?.backoffMs === undefined ? {} : { backoffMs: boundedInt(value.backoffMs, 0, 60_000, 0) }), ...(value?.retryableCodes?.length ? { retryableCodes: unique(value.retryableCodes.filter(value => safeId(value))) } : {}) }; }
function normalizeAssignment(node: TaskNodeInput): TaskAssignment { const input = node.assignment ?? {}; const kind = input.kind ?? (input.toolFlow || node.toolFlow ? 'flow' : input.agentId ?? node.agentId ? 'agent' : 'worker'); if (kind !== 'worker' && kind !== 'agent' && kind !== 'flow') throw new TaskGraphError('INVALID_ARGUMENT', `Invalid assignment kind for node ${node.id}`); const workerType = input.workerType ?? node.workerType ?? 'Analysis'; if (!WORKER_TYPES.includes(workerType)) throw new TaskGraphError('INVALID_ARGUMENT', `Invalid worker type for node ${node.id}`); const toolFlow = input.toolFlow ?? node.toolFlow; const assignment: TaskAssignment = { ...input, kind, workerType, ...(input.agentId ?? node.agentId ? { agentId: input.agentId ?? node.agentId } : {}), ...(toolFlow ? { toolFlow } : {}) }; if (kind === 'agent' && (!assignment.agentId || !safeId(assignment.agentId))) throw new TaskGraphError('INVALID_ARGUMENT', `Agent assignment missing for node ${node.id}`); if (kind === 'flow' && !toolFlow) throw new TaskGraphError('INVALID_ARGUMENT', `ToolFlow assignment missing for node ${node.id}`); return assignment; }

export class TaskGraphPlanner {
  private readonly now: () => number;
  constructor(options: TaskGraphPlannerOptions = {}) { this.now = options.now ?? Date.now; }

  plan(input: TaskGraphInput): TaskGraphPlanOutput {
    const normalized = this.normalize(input);
    const graph: AgentTaskGraph = { version: 1, id: normalized.id, goal: normalized.goal, parentAgentId: normalized.parentAgentId, ...(normalized.parentRunId ? { parentRunId: normalized.parentRunId } : {}), execution: normalized.execution, ...(normalized.model ? { model: normalized.model } : {}), allowedCapabilities: Object.freeze([...normalized.allowedCapabilities]), allowedDataScopes: Object.freeze(normalized.allowedDataScopes.map(clone)), budget: normalized.budget, nodes: Object.freeze(normalized.nodes.map(clone)), revision: 1, createdAt: nowIso(this.now), updatedAt: nowIso(this.now) };
    const order = this.topologicalOrder(graph.nodes); const depths = this.depths(graph.nodes, order); return { graph, topologicalOrder: order, depths };
  }

  /** Validates a new node set against an existing graph policy. */
  validateNodes(nodes: readonly TaskNodeInput[], policy: Pick<AgentTaskGraph, 'budget' | 'allowedCapabilities' | 'allowedDataScopes'>): { nodes: readonly TaskNode[]; topologicalOrder: readonly string[]; depths: Readonly<Record<string, number>> } {
    const normalized = this.normalizeNodes(nodes, policy.budget, policy.allowedDataScopes, policy.allowedCapabilities); const order = this.topologicalOrder(normalized); const depths = this.depths(normalized, order); if (Object.values(depths).some(depth => depth > policy.budget.maxDepth)) throw new TaskGraphError('GRAPH_DEPTH_LIMIT', 'Graph depth budget exceeded'); return { nodes: normalized, topologicalOrder: order, depths };
  }

  private normalize(input: TaskGraphInput): NormalizedGraphInput {
    assertNoManagedSecret(input);
    if (!safeText(input.goal) || !safeId(input.parentAgentId)) throw new TaskGraphError('INVALID_ARGUMENT', 'Graph goal or parent agent is invalid');
    const budgetValue = normalizeBudget(input.budget); const id = input.id ?? randomId('graph'); if (!safeId(id)) throw new TaskGraphError('INVALID_ARGUMENT', 'Graph id is invalid');
    const execution = input.execution ?? 'local'; if (!['local', 'personal_trusted', 'external'].includes(execution)) throw new TaskGraphError('INVALID_ARGUMENT', 'Graph execution is invalid');
    const allowedCapabilities = normalizeCapabilities(input.allowedCapabilities); const allowedDataScopes = normalizeDataScopes(input.allowedDataScopes, [{ dataClasses: ['PUBLIC', 'USER_EXPLICIT'] }]); const nodes = this.normalizeNodes(input.nodes, budgetValue, allowedDataScopes, allowedCapabilities); if (nodes.length > budgetValue.maxNodes) throw new TaskGraphError('GRAPH_SIZE_LIMIT', 'Graph node budget exceeded');
    const order = this.topologicalOrder(nodes); const depths = this.depths(nodes, order); if (Object.values(depths).some(depth => depth > budgetValue.maxDepth)) throw new TaskGraphError('GRAPH_DEPTH_LIMIT', 'Graph depth budget exceeded');
    return { id, goal: input.goal.trim(), parentAgentId: input.parentAgentId, ...(input.parentRunId ? { parentRunId: input.parentRunId } : {}), execution, ...(normalizeModel(input.model) ? { model: normalizeModel(input.model) } : {}), allowedCapabilities, allowedDataScopes, budget: budgetValue, nodes };
  }

  private normalizeNodes(inputs: readonly TaskNodeInput[], budgetValue: TaskGraphBudget, graphScopes: readonly WorkerDataScope[], graphCapabilities: readonly ToolCapability[]): TaskNode[] {
    if (!Array.isArray(inputs) || inputs.length === 0) throw new TaskGraphError('INVALID_ARGUMENT', 'A graph needs at least one node'); if (inputs.length > budgetValue.maxNodes) throw new TaskGraphError('GRAPH_SIZE_LIMIT', 'Graph node budget exceeded');
    const seen = new Set<string>(); const nodes = inputs.map(input => {
      assertNoManagedSecret(input, `Task node ${input.id} contains managed secret material`);
      if (!safeId(input.id) || seen.has(input.id)) throw new TaskGraphError(seen.has(input.id) ? 'GRAPH_DUPLICATE_NODE' : 'INVALID_ARGUMENT', `Invalid or duplicate graph node ${input.id}`); seen.add(input.id); if (!safeText(input.objective) || input.objective.length > 64_000) throw new TaskGraphError('INVALID_ARGUMENT', `Invalid objective for node ${input.id}`);
      const assignment = normalizeAssignment(input); const requiredCapabilities = normalizeCapabilities(input.requiredCapabilities); const assignmentCapabilities = normalizeCapabilities(assignment.capabilities ?? assignment.grant?.capabilities); if (!requiredCapabilities.every(value => graphCapabilities.includes(value)) || !assignmentCapabilities.every(value => graphCapabilities.includes(value))) throw new TaskGraphError('GRAPH_CAPABILITY_DENIED', `Node ${input.id} requests an undeclared capability`);
      const allowedDataScopes = normalizeDataScopes(input.allowedDataScopes, graphScopes); if (!allowedDataScopes.every(scope => scopeSubset(scope, graphScopes))) throw new TaskGraphError('GRAPH_SCOPE_DENIED', `Node ${input.id} scope exceeds graph scope`);
      if (assignment.toolFlow) { if (assignment.toolFlow.allowedCapabilities.some(value => !graphCapabilities.includes(value))) throw new TaskGraphError('GRAPH_CAPABILITY_DENIED', `ToolFlow for node ${input.id} requests an undeclared capability`); if (assignment.toolFlow.allowedDataScopes.some(scope => !scopeSubset(scope, graphScopes))) throw new TaskGraphError('GRAPH_SCOPE_DENIED', `ToolFlow for node ${input.id} exceeds graph scope`); }
      const dependencies: TaskDependency[] = unique<TaskDependency>((input.dependencies ?? []).map((dependency: TaskDependency): TaskDependency => typeof dependency === 'string' ? dependency : { nodeId: dependency.nodeId, ...(dependency.required === undefined ? {} : { required: dependency.required }), ...(dependency.inputRefs?.length ? { inputRefs: unique<string>(dependency.inputRefs.filter((ref: string) => safeId(ref))) } : {}) }));
      const refs: string[] = unique<string>((input.inputRefs ?? []).filter((ref: string) => safeId(ref))); const outputRefs: string[] = unique<string>((input.outputRefs?.length ? input.outputRefs : [`${input.id}:result`]).filter((ref: string) => safeId(ref)));
      if (input.priority !== undefined && !PRIORITIES.includes(input.priority)) throw new TaskGraphError('INVALID_ARGUMENT', `Invalid priority for node ${input.id}`);
      const node: TaskNode = { version: 1, id: input.id, title: (input.title?.trim() || input.id).slice(0, 256), objective: input.objective.trim(), workerType: assignment.workerType ?? input.workerType ?? 'Analysis', ...(assignment.agentId ? { agentId: assignment.agentId } : input.agentId ? { agentId: input.agentId } : {}), assignment, dependencies, requiredCapabilities, allowedDataScopes, contextItems: Object.freeze((input.contextItems ?? []).map(clone)), inputRefs: refs, outputRefs, priority: input.priority ?? 'BACKGROUND', timeoutMs: boundedInt(input.timeoutMs, 100, 600_000, 120_000), retryPolicy: normalizeRetry(input.retryPolicy), status: 'PENDING', nodeRevision: 1, attempt: 0, outputArtifactIds: [], ...(assignment.toolFlow ? { toolFlow: clone(assignment.toolFlow) } : {}) };
      return node;
    });
    const ids = new Set(nodes.map(node => node.id)); const children = new Map<string, number>(); for (const node of nodes) for (const dependency of node.dependencies) { const id = dependencyId(dependency); if (!ids.has(id)) throw new TaskGraphError('GRAPH_MISSING_DEPENDENCY', `Node ${node.id} depends on missing node ${id}`); if (id === node.id) throw new TaskGraphError('GRAPH_IMPOSSIBLE_DEPENDENCY', `Node ${node.id} depends on itself`); children.set(id, (children.get(id) ?? 0) + 1); const edgeRefs = dependencyInputRefs(dependency); if (edgeRefs.length) { const parent = nodes.find(candidate => candidate.id === id)!; if (parent.outputRefs.length && edgeRefs.some(ref => !parent.outputRefs.includes(ref))) throw new TaskGraphError('GRAPH_IMPOSSIBLE_DEPENDENCY', `Dependency ${id} cannot provide requested artifact`); } }
    if ([...children.values()].some(value => value > budgetValue.maxFanOut)) throw new TaskGraphError('GRAPH_FANOUT_LIMIT', 'Graph fan-out budget exceeded');
    return nodes;
  }

  private topologicalOrder(nodes: readonly TaskNode[]): string[] {
    const map = new Map(nodes.map(node => [node.id, node])); const indegree = new Map(nodes.map(node => [node.id, 0])); const outgoing = new Map<string, string[]>(); for (const node of nodes) for (const dependency of node.dependencies) { const id = dependencyId(dependency); if (!map.has(id)) throw new TaskGraphError('GRAPH_MISSING_DEPENDENCY', `Node ${node.id} depends on missing node ${id}`); indegree.set(node.id, (indegree.get(node.id) ?? 0) + 1); outgoing.set(id, [...(outgoing.get(id) ?? []), node.id]); }
    const queue = [...nodes.filter(node => indegree.get(node.id) === 0).map(node => node.id)].sort(); const order: string[] = []; while (queue.length) { const id = queue.shift()!; order.push(id); for (const next of outgoing.get(id) ?? []) { const value = (indegree.get(next) ?? 1) - 1; indegree.set(next, value); if (value === 0) queue.push(next); } queue.sort(); }
    if (order.length !== nodes.length) throw new TaskGraphError('GRAPH_CYCLE', 'Task graph contains a cycle'); return order;
  }

  private depths(nodes: readonly TaskNode[], order: readonly string[]): Record<string, number> { const map = new Map(nodes.map(node => [node.id, node])); const result: Record<string, number> = {}; for (const id of order) { const node = map.get(id)!; result[id] = node.dependencies.length ? Math.max(...node.dependencies.map(dependency => (result[dependencyId(dependency)] ?? 0) + 1)) : 0; } return result; }
}

export class TaskGraphExecutor {
  private readonly workerService: EphemeralAgentWorkerService;
  private readonly storage: TaskGraphStateStore;
  private readonly planner: TaskGraphPlanner;
  private readonly now: () => number;
  private readonly runAgent?: TaskGraphAgentExecutor;
  private readonly toolFlowExecutor?: ToolFlowExecutor;
  private readonly validateCapabilityExpansion?: TaskGraphExecutorOptions['validateCapabilityExpansion'];
  private readonly graphs = new Map<string, TaskGraphState>();
  private readonly active = new Map<string, GraphExecution>();
  private writes: Promise<void> = Promise.resolve();
  private readonly readyPromise: Promise<void>;

  constructor(options: TaskGraphExecutorOptions) { this.workerService = options.workerService; this.storage = options.storage ?? new InMemoryTaskGraphStateStore(); this.planner = options.planner ?? new TaskGraphPlanner({ now: options.now }); this.now = options.now ?? Date.now; this.runAgent = options.runAgent; this.toolFlowExecutor = options.toolFlowExecutor; this.validateCapabilityExpansion = options.validateCapabilityExpansion; this.readyPromise = this.hydrate(); }
  async ready(): Promise<void> { await this.readyPromise; }

  async plan(input: TaskGraphInput): Promise<TaskGraphPlanOutput> { await this.ready(); return this.planner.plan(input); }
  async createGraph(input: TaskGraphInput): Promise<TaskGraphState> { await this.ready(); const plan = this.planner.plan(input); if (this.graphs.has(plan.graph.id)) throw new TaskGraphError('GRAPH_ALREADY_EXISTS', `Graph ${plan.graph.id} already exists`); const timestamp = nowIso(this.now); const state: TaskGraphState = { version: 1, graph: plan.graph, lifecycle: 'READY', graphRevision: plan.graph.revision, nodes: plan.graph.nodes, artifacts: [], counters: { inferenceJobs: 0, toolCalls: 0, retries: 0, generatedArtifacts: 0, artifactBytes: 0 }, createdAt: timestamp, updatedAt: timestamp }; this.graphs.set(state.graph.id, state); await this.persist(); return clone(state); }
  async create(input: TaskGraphInput): Promise<TaskGraphState> { return this.createGraph(input); }
  async get(graphId: string): Promise<TaskGraphState | undefined> { await this.ready(); const state = this.graphs.get(graphId); return state ? clone(state) : undefined; }
  async getGraph(graphId: string): Promise<TaskGraphState | undefined> { return this.get(graphId); }
  async list(): Promise<readonly TaskGraphState[]> { await this.ready(); return [...this.graphs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(clone); }

  async run(graphId: string): Promise<TaskGraphState> { await this.ready(); const state = this.requireGraph(graphId); if (terminalGraph(state.lifecycle)) return clone(state); const existing = this.active.get(graphId); if (existing?.completion) return clone(await existing.completion); const controller = new AbortController(); const execution: GraphExecution = { controller, running: new Map(), paused: state.lifecycle === 'PAUSED' }; const completion = this.drive(graphId, execution); execution.completion = completion; this.active.set(graphId, execution); try { return clone(await completion); } finally { if (this.active.get(graphId) === execution) this.active.delete(graphId); } }
  async start(graphId: string): Promise<TaskGraphState> { return this.run(graphId); }
  async runGraph(graphId: string): Promise<TaskGraphState> { return this.run(graphId); }
  async runResult(graphId: string): Promise<TaskGraphResult> { const state = await this.run(graphId); return { graphId, lifecycle: state.lifecycle, graphRevision: state.graphRevision, ...(state.summary ?? { completedNodeIds: [], failedNodeIds: [], skippedNodeIds: [], artifactIds: [] }), state }; }
  async execute(graphId: string): Promise<TaskGraphState> { return this.run(graphId); }
  async waitFor(graphId: string): Promise<TaskGraphState> { const active = this.active.get(graphId); if (active?.completion) return clone(await active.completion); return this.getRequired(graphId); }

  async pause(graphId: string): Promise<TaskGraphState> { const state = this.requireGraph(graphId); if (terminalGraph(state.lifecycle)) return clone(state); const execution = this.active.get(graphId); this.updateState(state, { lifecycle: 'PAUSED' }); if (execution) { execution.paused = true; await Promise.all([...execution.running.keys()].map(nodeId => this.pauseNodeWorker(state, nodeId))); execution.wake?.(); } await this.persist(); return clone(this.requireGraph(graphId)); }
  async pauseGraph(graphId: string): Promise<TaskGraphState> { return this.pause(graphId); }
  async resume(graphId: string): Promise<TaskGraphState> { const state = this.requireGraph(graphId); if (terminalGraph(state.lifecycle)) return clone(state); const execution = this.active.get(graphId); this.updateState(state, { lifecycle: 'RUNNING' }); if (execution) { execution.paused = false; await Promise.all([...execution.running.keys()].map(nodeId => this.resumeNodeWorker(state, nodeId))); execution.wake?.(); } await this.persist(); return clone(this.requireGraph(graphId)); }
  async resumeGraph(graphId: string): Promise<TaskGraphState> { return this.resume(graphId); }
  async cancel(graphId: string): Promise<TaskGraphState> { const state = this.requireGraph(graphId); if (terminalGraph(state.lifecycle)) return clone(state); const execution = this.active.get(graphId); execution?.controller.abort(); this.updateState(state, { lifecycle: 'CANCELLED', errorCode: 'GRAPH_CANCELLED', errorMessage: 'Graph cancelled by user' }); const runningNodeIds = execution ? [...execution.running.keys()] : state.nodes.filter(node => node.workerId && !terminalNode(node.status)).map(node => node.id); await Promise.all(runningNodeIds.map(nodeId => this.cancelNodeWorker(state, nodeId))); const nodes = state.nodes.map(node => terminalNode(node.status) ? node : { ...node, status: 'CANCELLED' as const, errorCode: 'GRAPH_CANCELLED' as const, errorMessage: 'Cancelled by user', completedAt: nowIso(this.now) }); this.updateState(state, { nodes, graph: { ...state.graph, nodes, updatedAt: nowIso(this.now) } }); execution?.wake?.(); await this.persist(); return clone(this.requireGraph(graphId)); }
  async cancelGraph(graphId: string): Promise<TaskGraphState> { return this.cancel(graphId); }
  async stop(graphId: string): Promise<TaskGraphState> { return this.cancel(graphId); }

  async skipNode(graphId: string, nodeId: string): Promise<TaskGraphState> { const state = this.requireGraph(graphId); const node = this.requireNode(state, nodeId); if (node.status === 'RUNNING') throw new TaskGraphError('INVALID_ARGUMENT', 'Running node cannot be skipped'); this.replaceNode(state, node, { status: 'SKIPPED', errorCode: 'SKIPPED', errorMessage: 'Skipped by user', completedAt: nowIso(this.now) }); await this.persist(); this.wake(graphId); return clone(state); }
  async retryNode(graphId: string, nodeId: string): Promise<TaskGraphState> { const state = this.requireGraph(graphId); const node = this.requireNode(state, nodeId); if (!['FAILED', 'CANCELLED', 'SKIPPED', 'STALE'].includes(node.status)) throw new TaskGraphError('INVALID_ARGUMENT', 'Only a failed or skipped node can be retried'); this.clearNodeArtifacts(state, nodeId); this.replaceNode(state, node, { status: 'PENDING', errorCode: undefined, errorMessage: undefined, attempt: 0, outputArtifactIds: [], completedAt: undefined, nodeRevision: node.nodeRevision + 1 }); this.updateState(state, { lifecycle: 'READY', errorCode: undefined, errorMessage: undefined }); await this.persist(); this.wake(graphId); return clone(state); }
  async removePendingNode(graphId: string, nodeId: string): Promise<TaskGraphState> { const state = this.requireGraph(graphId); const node = this.requireNode(state, nodeId); if (['RUNNING', 'COMPLETED'].includes(node.status)) throw new TaskGraphError('INVALID_ARGUMENT', 'Only pending nodes can be removed'); this.replaceNode(state, node, { status: 'REMOVED', errorCode: 'REMOVED', errorMessage: 'Removed by user', completedAt: nowIso(this.now) }); await this.persist(); this.wake(graphId); return clone(state); }
  async removeNode(graphId: string, nodeId: string): Promise<TaskGraphState> { return this.removePendingNode(graphId, nodeId); }

  async changeGoal(graphId: string, goal: string): Promise<TaskGraphState> { if (!safeText(goal)) throw new TaskGraphError('INVALID_ARGUMENT', 'Graph goal is invalid'); const state = this.requireGraph(graphId); await this.invalidateForRevision(state, state.nodes.map(node => node.id), goal.trim()); return clone(state); }

  async replan(graphId: string, input: TaskGraphReplanInput): Promise<TaskGraphState> {
    const state = this.requireGraph(graphId); if (input.expectedRevision !== undefined && input.expectedRevision !== state.graphRevision) throw new TaskGraphError('GRAPH_REVISION_CONFLICT', 'Graph revision is stale');
    const existing = new Map(state.nodes.map(node => [node.id, node])); const changed = new Set<string>(); for (const id of input.removeNodeIds ?? []) { if (!existing.has(id)) throw new TaskGraphError('GRAPH_NOT_FOUND', `Node ${id} was not found`); existing.delete(id); changed.add(id); }
    for (const update of input.updateNodes ?? []) { const previous = existing.get(update.id); if (!previous) throw new TaskGraphError('GRAPH_NOT_FOUND', `Node ${update.id} was not found`); const next = { ...this.toNodeInput(previous), ...update.patch, id: update.id }; existing.set(update.id, next as TaskNode); changed.add(update.id); }
    for (const node of input.addNodes ?? []) { if (existing.has(node.id)) throw new TaskGraphError('GRAPH_DUPLICATE_NODE', `Node ${node.id} already exists`); existing.set(node.id, node as TaskNode); changed.add(node.id); }
    const nodeInputs = [...existing.values()].map(value => this.toNodeInput(value)); const requestedCapabilities = unique(nodeInputs.flatMap(node => [...(node.requiredCapabilities ?? []), ...(node.assignment?.capabilities ?? []), ...(node.assignment?.grant?.capabilities ?? [])])); const requestedScopes = normalizeDataScopes(nodeInputs.flatMap(node => node.allowedDataScopes ?? []), state.graph.allowedDataScopes); const expandedCaps = requestedCapabilities.filter(value => !state.graph.allowedCapabilities.includes(value)); const expandedScopes = requestedScopes.filter(scope => !scopeSubset(scope, state.graph.allowedDataScopes)); if ((expandedCaps.length || expandedScopes.length) && (!input.allowCapabilityExpansion || !this.validateCapabilityExpansion || !await this.validateCapabilityExpansion({ graph: state.graph, requestedCapabilities: expandedCaps, requestedDataScopes: expandedScopes, reason: input.reason }))) throw new TaskGraphError('GRAPH_CAPABILITY_DENIED', 'Replanning cannot expand graph authority without policy approval');
    const validated = this.planner.validateNodes(nodeInputs, { budget: state.graph.budget, allowedCapabilities: expandedCaps.length ? [...state.graph.allowedCapabilities, ...expandedCaps] : state.graph.allowedCapabilities, allowedDataScopes: expandedScopes.length ? [...state.graph.allowedDataScopes, ...expandedScopes] : state.graph.allowedDataScopes }); const nextRevision = state.graphRevision + 1; const affected = new Set([...changed, ...this.descendants(validated.nodes, changed)]);
    const timestamp = nowIso(this.now); const nextNodes = validated.nodes.map(node => { const old = state.nodes.find(candidate => candidate.id === node.id); const invalidated = affected.has(node.id); return { ...node, ...(old && !invalidated ? { status: old.status, nodeRevision: old.nodeRevision, attempt: old.attempt, workerId: old.workerId, errorCode: old.errorCode, errorMessage: old.errorMessage, outputArtifactIds: old.outputArtifactIds, startedAt: old.startedAt, completedAt: old.completedAt } : { status: 'STALE' as const, nodeRevision: (old?.nodeRevision ?? 0) + 1, attempt: 0, workerId: old?.workerId, outputArtifactIds: [] }) }; });
    const graph: AgentTaskGraph = { ...state.graph, ...(input.goal ? { goal: input.goal.trim() } : {}), allowedCapabilities: expandedCaps.length ? [...state.graph.allowedCapabilities, ...expandedCaps] : state.graph.allowedCapabilities, allowedDataScopes: expandedScopes.length ? [...state.graph.allowedDataScopes, ...expandedScopes] : state.graph.allowedDataScopes, nodes: nextNodes, revision: nextRevision, updatedAt: timestamp }; const artifacts = state.artifacts.filter(artifact => !affected.has(artifact.producerNodeId));
    // Publish the revision before cancellation so an in-flight node cannot
    // finalize the old plan while a replan is in progress.
    this.updateState(state, { graph, graphRevision: nextRevision, nodes: nextNodes, artifacts, lifecycle: 'READY', summary: undefined, errorCode: undefined, errorMessage: undefined });
    await Promise.all([...affected].map(nodeId => this.cancelNodeWorker(state, nodeId)));
    const clearedNodes = this.requireGraph(graphId).nodes.map(node => affected.has(node.id) ? { ...node, workerId: undefined } : node);
    this.updateState(state, { nodes: clearedNodes, graph: { ...state.graph, nodes: clearedNodes, updatedAt: timestamp } });
    await this.persist(); this.wake(graphId); return clone(this.requireGraph(graphId));
  }

  verifyArtifact(artifact: TaskArtifact): boolean { return artifact.integrity === digest({ id: artifact.id, graphId: artifact.graphId, graphRevision: artifact.graphRevision, producerNodeId: artifact.producerNodeId, nodeRevision: artifact.nodeRevision, kind: artifact.kind, value: artifact.value, objectReferences: artifact.objectReferences, citations: artifact.citations, provenance: artifact.provenance, dataClass: artifact.dataClass, scope: artifact.scope, sizeBytes: artifact.sizeBytes, createdAt: artifact.createdAt }); }

  private async drive(graphId: string, execution: GraphExecution): Promise<TaskGraphState> {
    const startedAt = this.now(); const state = this.requireGraph(graphId); this.updateState(state, { lifecycle: execution.paused ? 'PAUSED' : 'RUNNING' }); await this.persist();
    while (true) {
      const current = this.requireGraph(graphId); if (execution.controller.signal.aborted || current.lifecycle === 'CANCELLED') { this.updateState(current, { lifecycle: 'CANCELLED', errorCode: 'GRAPH_CANCELLED' }); await this.persist(); return clone(current); }
      if (this.now() - startedAt > current.graph.budget.maxRuntimeMs) { await this.failGraph(current, 'GRAPH_RUNTIME_LIMIT', 'Graph runtime budget exceeded'); return clone(current); }
      if (execution.paused || current.lifecycle === 'PAUSED') { this.updateState(current, { lifecycle: 'PAUSED' }); await this.waitForWake(execution); continue; }
      this.markBlocked(current); const ready = current.nodes.filter(node => ['PENDING', 'STALE'].includes(node.status) && this.dependenciesReady(current, node));
      while (ready.length && execution.running.size < current.graph.budget.maxConcurrentNodes) { const node = ready.shift()!; if (current.counters.inferenceJobs >= current.graph.budget.maxInferenceJobs) { this.replaceNode(current, node, { status: 'FAILED', errorCode: 'GRAPH_INFERENCE_LIMIT', errorMessage: 'Graph inference-job budget exceeded', completedAt: nowIso(this.now) }); continue; } this.updateCounters(current, { inferenceJobs: current.counters.inferenceJobs + 1 }); const promise = this.executeNode(current.graph.id, node.id, execution); execution.running.set(node.id, promise); void promise.finally(() => { if (execution.running.get(node.id) === promise) execution.running.delete(node.id); }).catch(() => undefined); }
      if (execution.running.size) { this.updateState(current, { lifecycle: 'RUNNING' }); await Promise.race([...execution.running.values()]); continue; }
      const refreshed = this.requireGraph(graphId); if (refreshed.nodes.every(node => terminalNode(node.status))) { await this.finalize(refreshed); return clone(this.requireGraph(graphId)); }
      const pending = refreshed.nodes.filter(node => ['PENDING', 'STALE'].includes(node.status)); if (pending.length) { await this.failGraph(refreshed, 'GRAPH_STALLED', 'No runnable node remains'); return clone(this.requireGraph(graphId)); }
      this.updateState(refreshed, { lifecycle: 'WAITING' }); await this.waitForWake(execution);
    }
  }

  private async executeNode(graphId: string, nodeId: string, execution: GraphExecution): Promise<void> {
    const initial = this.requireNode(this.requireGraph(graphId), nodeId); const graphRevision = this.requireGraph(graphId).graphRevision; const nodeRevision = initial.nodeRevision; const maxAttempts = initial.retryPolicy.maxAttempts; let attempt = initial.attempt;
    while (attempt < maxAttempts) {
      const state = this.requireGraph(graphId); const node = this.requireNode(state, nodeId); if (execution.controller.signal.aborted || state.lifecycle === 'CANCELLED') { this.replaceNode(state, node, { status: 'CANCELLED', errorCode: 'GRAPH_CANCELLED', completedAt: nowIso(this.now) }); return; } if (state.graphRevision !== graphRevision || node.nodeRevision !== nodeRevision) return;
      attempt += 1; this.replaceNode(state, node, { status: 'RUNNING', attempt, startedAt: nowIso(this.now), errorCode: undefined, errorMessage: undefined }); await this.persist();
      try {
        const artifacts = this.inputsForNode(state, node); const context = this.contextForNode(state, node, artifacts); const result = await this.runAssigned(state, node, context, artifacts, execution.controller.signal, graphRevision, nodeRevision, attempt); const current = this.requireGraph(graphId); const currentNode = this.requireNode(current, nodeId); if (current.graphRevision !== graphRevision || currentNode.nodeRevision !== nodeRevision) throw new TaskGraphError('GRAPH_STALE_RESULT', 'Node result belongs to an older graph revision'); const generated = this.artifactsFromResult(current, currentNode, result, graphRevision, nodeRevision); this.commitArtifacts(current, currentNode, generated); this.replaceNode(current, currentNode, { status: 'COMPLETED', outputArtifactIds: generated.map(artifact => artifact.id), completedAt: nowIso(this.now), workerId: currentNode.workerId }); await this.persist(); return;
      } catch (error) {
        const current = this.requireGraph(graphId); const currentNode = this.requireNode(current, nodeId); if (current.graphRevision !== graphRevision || currentNode.nodeRevision !== nodeRevision) return; if (error instanceof TaskGraphError && error.code === 'GRAPH_CANCELLED') { this.replaceNode(current, currentNode, { status: 'CANCELLED', errorCode: error.code, errorMessage: error.message, completedAt: nowIso(this.now) }); return; }
        const code = error instanceof TaskGraphError ? error.code : 'FAILED'; const retryable = attempt < maxAttempts && current.counters.retries < current.graph.budget.maxRetries && current.counters.inferenceJobs < current.graph.budget.maxInferenceJobs && (!currentNode.retryPolicy.retryableCodes?.length || currentNode.retryPolicy.retryableCodes.includes(code)); if (retryable) { this.updateCounters(current, { retries: current.counters.retries + 1, inferenceJobs: current.counters.inferenceJobs + 1 }); if (currentNode.retryPolicy.backoffMs) await delay(currentNode.retryPolicy.backoffMs); continue; } const finalCode = attempt < maxAttempts && current.counters.inferenceJobs >= current.graph.budget.maxInferenceJobs ? 'GRAPH_INFERENCE_LIMIT' : code; this.replaceNode(current, currentNode, { status: 'FAILED', errorCode: finalCode, errorMessage: error instanceof Error ? error.message.slice(0, 512) : String(error).slice(0, 512), completedAt: nowIso(this.now) }); await this.persist(); return;
      }
    }
  }

  private inputsForNode(state: TaskGraphState, node: TaskNode): TaskArtifact[] { const dependencies = new Set(node.dependencies.map(dependencyId)); const requestedRefs = new Set([...node.inputRefs, ...node.dependencies.flatMap(dependencyInputRefs)]); const artifacts: TaskArtifact[] = []; for (const artifact of state.artifacts) { if (!dependencies.has(artifact.producerNodeId) || artifact.graphRevision > state.graphRevision) continue; const producer = state.nodes.find(candidate => candidate.id === artifact.producerNodeId); if (!producer || producer.status !== 'COMPLETED' || producer.nodeRevision !== artifact.nodeRevision) continue; if (requestedRefs.size && !requestedRefs.has(artifact.id) && !requestedRefs.has(artifact.producerNodeId)) continue; if (!this.verifyArtifact(artifact)) throw new TaskGraphError('GRAPH_ARTIFACT_INVALID', `Artifact ${artifact.id} failed integrity verification`); if (!anyScopeAllows(node.allowedDataScopes, artifact.dataClass) || !scopeSubset(artifact.scope, node.allowedDataScopes)) throw new TaskGraphError('GRAPH_SCOPE_DENIED', `Node ${node.id} cannot receive artifact ${artifact.id}`); artifacts.push(artifact); } return artifacts; }
  private contextForNode(state: TaskGraphState, node: TaskNode, artifacts: readonly TaskArtifact[]): AIContextItem[] { const items: AIContextItem[] = node.contextItems.map(clone); for (const artifact of artifacts) { items.push({ id: artifact.id, source: 'task-artifact', dataClass: artifact.dataClass, value: { kind: artifact.kind, value: clone(artifact.value), objectReferences: artifact.objectReferences, citations: artifact.citations, provenance: artifact.provenance, integrity: artifact.integrity } }); } if (serialSize(items) > state.graph.budget.maxContextTokens * 4) throw new TaskGraphError('GRAPH_ARTIFACT_TOO_LARGE', 'Node context exceeds graph context budget'); return items; }
  private async runAssigned(state: TaskGraphState, node: TaskNode, context: readonly AIContextItem[], artifacts: readonly TaskArtifact[], signal: AbortSignal, graphRevision: number, nodeRevision: number, attempt: number): Promise<WorkerResult | TaskArtifactInput | readonly TaskArtifactInput[]> {
    if (signal.aborted) throw new TaskGraphError('GRAPH_CANCELLED', 'Graph was cancelled before node execution'); const assignment = node.assignment; const execution = assignment.execution ?? state.graph.execution; const dataClasses = unique(node.allowedDataScopes.flatMap(scope => scope.dataClasses)); if (execution === 'external' && (context.some(item => isPrivate(item.dataClass)) || dataClasses.some(isPrivate))) throw new TaskGraphError('GRAPH_EXTERNAL_PRIVATE', 'External graph node cannot receive private context or scope');
    const toolFlow = assignment.toolFlow ?? node.toolFlow;
    if (assignment.kind === 'flow' || toolFlow) {
      if (!toolFlow || !this.toolFlowExecutor) throw new TaskGraphError('GRAPH_TOOLFLOW_UNAVAILABLE', 'No ToolFlow executor is configured for this node');
      if (toolFlow.allowedCapabilities.some(capability => !state.graph.allowedCapabilities.includes(capability))) throw new TaskGraphError('GRAPH_CAPABILITY_DENIED', `ToolFlow for node ${node.id} exceeds graph capabilities`);
      if (toolFlow.allowedDataScopes.some(scope => !scopeSubset(scope, node.allowedDataScopes))) throw new TaskGraphError('GRAPH_SCOPE_DENIED', `ToolFlow for node ${node.id} exceeds node scope`);
      const inputClass = context.reduce<AIDataClass>((current, item) => maxDataClass(current, item.dataClass), 'PUBLIC');
      const result = await this.toolFlowExecutor.execute(toolFlow, { input: context.map(clone), inputDataClass: inputClass, signal });
      if (result.status === 'CANCELLED') throw new TaskGraphError('GRAPH_CANCELLED', 'ToolFlow was cancelled');
      if (result.status === 'FAILED' || !result.artifact) throw new TaskGraphError('FAILED', result.errorCode ?? 'ToolFlow failed');
      const artifact = result.artifact;
      return { kind: 'structured', value: clone(result.value), objectReferences: artifact.citations.map(citation => citation.id), citations: artifact.citations.map(citation => ({ id: citation.id, sourceType: citation.sourceType, dataClass: citation.dataClass })), dataClass: result.dataClass, scope: { dataClasses: [result.dataClass], ...(artifact.privacyScope.sourceKinds ? { sourceKinds: artifact.privacyScope.sourceKinds } : {}), ...(artifact.privacyScope.objectIds ? { objectIds: artifact.privacyScope.objectIds } : {}) } };
    }
    if (assignment.kind === 'agent') { if (!this.runAgent) throw new TaskGraphError('GRAPH_AGENT_UNAVAILABLE', 'No AgentRuntime adapter is configured'); return this.runAgent({ graph: state.graph, node, context, artifacts, signal }); }
    const assignmentCapabilities = assignment.capabilities ?? assignment.grant?.capabilities ?? []; if (assignmentCapabilities.some(capability => !state.graph.allowedCapabilities.includes(capability))) throw new TaskGraphError('GRAPH_CAPABILITY_DENIED', `Node ${node.id} grant requests an undeclared capability`); if (assignment.dataScope && !scopeSubset(assignment.dataScope, node.allowedDataScopes)) throw new TaskGraphError('GRAPH_SCOPE_DENIED', `Node ${node.id} grant scope exceeds node scope`); const grantScope: WorkerDataScope = { dataClasses: dataClasses.length ? dataClasses : ['PUBLIC'], ...(assignment.dataScope?.sourceKinds ? { sourceKinds: assignment.dataScope.sourceKinds } : {}), ...(assignment.dataScope?.objectIds ? { objectIds: assignment.dataScope.objectIds } : {}) }; const required = unique([...node.requiredCapabilities, ...assignmentCapabilities]); if (!node.requiredCapabilities.every(capability => assignmentCapabilities.includes(capability))) throw new TaskGraphError('GRAPH_CAPABILITY_DENIED', `Node ${node.id} grant does not cover required capability`);
    const remainingTools = Math.max(0, state.graph.budget.maxToolCalls - state.counters.toolCalls); const worker = await this.workerService.createWorker({ parentAgentId: state.graph.parentAgentId, parentRunId: `${state.graph.id}:${graphRevision}:${node.id}:${nodeRevision}:attempt:${attempt}`, type: assignment.workerType ?? node.workerType, objective: node.objective, context, objectReferences: node.inputRefs, execution, model: assignment.model ?? state.graph.model, budget: { maxRuntimeMs: node.timeoutMs, maxToolCalls: remainingTools, maxRetries: 0, maxModelCalls: 8, maxContextTokens: state.graph.budget.maxContextTokens }, grant: { ...assignment.grant, toolIds: assignment.toolIds ?? assignment.grant?.toolIds, skillIds: assignment.skillIds ?? assignment.grant?.skillIds, capabilities: required, dataScope: grantScope, maxRuntimeMs: node.timeoutMs } }); const currentNode = this.requireNode(this.requireGraph(state.graph.id), node.id); this.replaceNode(this.requireGraph(state.graph.id), currentNode, { workerId: worker.id }); const result = await this.workerService.runWorker(worker.id); if (signal.aborted) throw new TaskGraphError('GRAPH_CANCELLED', 'Graph was cancelled during node execution'); const current = this.requireGraph(state.graph.id); this.updateCounters(current, { toolCalls: current.counters.toolCalls + result.toolsUsed.length }); if (current.counters.toolCalls > current.graph.budget.maxToolCalls) throw new TaskGraphError('GRAPH_TOOL_LIMIT', 'Graph tool-call budget exceeded'); return result;
  }

  private artifactsFromResult(state: TaskGraphState, node: TaskNode, result: WorkerResult | TaskArtifactInput | readonly TaskArtifactInput[], graphRevision: number, nodeRevision: number): TaskArtifact[] { const values: readonly TaskArtifactInput[] = isWorkerResult(result) ? [{ kind: result.status === 'completed' ? 'text' : 'error', value: result.output ?? result.errorCode, citations: result.sources.map(source => ({ id: source.id, ...(source.sourceType ? { sourceType: source.sourceType } : {}), dataClass: source.dataClass })), dataClass: result.dataClasses.find(isPrivate) ?? result.dataClasses[0] ?? 'PUBLIC', scope: { dataClasses: result.dataClasses.length ? result.dataClasses : ['PUBLIC'] } }] : Array.isArray(result) ? result : [result]; if (isWorkerResult(result) && result.status !== 'completed') throw new TaskGraphError('FAILED', 'Worker did not complete the assigned node'); if (!values.length) throw new TaskGraphError('GRAPH_ARTIFACT_INVALID', 'Node returned no artifact'); const ids = values.map((value, index) => value.id ?? node.outputRefs[index] ?? `${node.id}:result${values.length > 1 ? `:${index}` : ''}`); if (new Set(ids).size !== ids.length) throw new TaskGraphError('GRAPH_ARTIFACT_INVALID', 'Node returned duplicate artifact IDs'); const artifacts: TaskArtifact[] = values.map((value, index) => this.makeArtifact(state, node, value, ids[index]!, graphRevision, nodeRevision)); if (artifacts.some(artifact => artifact.sizeBytes > state.graph.budget.maxArtifactBytes)) throw new TaskGraphError('GRAPH_ARTIFACT_TOO_LARGE', 'Generated artifact exceeds graph size budget'); return artifacts; }
  private makeArtifact(state: TaskGraphState, node: TaskNode, input: TaskArtifactInput, id: string, graphRevision: number, nodeRevision: number): TaskArtifact { if (!safeId(id)) throw new TaskGraphError('GRAPH_ARTIFACT_INVALID', 'Artifact id is invalid'); const dataClass = input.dataClass ?? 'PUBLIC'; if (!DATA_CLASSES.includes(dataClass)) throw new TaskGraphError('GRAPH_ARTIFACT_INVALID', 'Artifact data class is invalid'); if (input.kind !== undefined && !TASK_ARTIFACT_KINDS.includes(input.kind)) throw new TaskGraphError('GRAPH_ARTIFACT_INVALID', 'Artifact kind is invalid'); const defaultScope = node.allowedDataScopes.find(scope => scope.dataClasses.includes(dataClass)); if (!defaultScope || !anyScopeAllows(node.allowedDataScopes, dataClass)) throw new TaskGraphError('GRAPH_SCOPE_DENIED', `Node ${node.id} cannot publish ${dataClass} artifact`); const scopeCandidate = input.scope ?? { dataClasses: [dataClass], ...(defaultScope.sourceKinds ? { sourceKinds: defaultScope.sourceKinds } : {}), ...(defaultScope.objectIds ? { objectIds: defaultScope.objectIds } : {}) }; const scope = normalizeDataScopes([scopeCandidate], node.allowedDataScopes)[0]; if (!scope || !scopeAllows(scope, dataClass) || !scopeSubset(scope, node.allowedDataScopes)) throw new TaskGraphError('GRAPH_SCOPE_DENIED', `Artifact ${id} scope exceeds node scope`); const value = clone(input.value); const objectReferences = unique((input.objectReferences ?? []).filter(value => safeId(value))); const citations = (input.citations ?? []).slice(0, 128).map(citation => { if (!safeId(citation.id) || !DATA_CLASSES.includes(citation.dataClass)) throw new TaskGraphError('GRAPH_ARTIFACT_INVALID', `Artifact ${id} citation is invalid`); return { id: citation.id, ...(citation.sourceType ? { sourceType: citation.sourceType } : {}), dataClass: citation.dataClass }; }); const provenance: TaskArtifactProvenance[] = [{ producerNodeId: node.id, ...(node.workerId ? { workerId: node.workerId } : {}), sourceIds: citations.map(citation => citation.id), graphRevision, nodeRevision }]; const createdAt = nowIso(this.now); const sizeBytes = serialSize({ id, value, objectReferences, citations, provenance, dataClass, scope }); if (sizeBytes > state.graph.budget.maxArtifactBytes) throw new TaskGraphError('GRAPH_ARTIFACT_TOO_LARGE', 'Artifact exceeds graph size budget'); const artifact: TaskArtifact = { version: 1, id, graphId: state.graph.id, graphRevision, producerNodeId: node.id, nodeRevision, kind: input.kind ?? 'structured', ...(value === undefined ? {} : { value }), objectReferences, citations, provenance, dataClass, scope, integrity: '', sizeBytes, createdAt }; return { ...artifact, integrity: digest({ id: artifact.id, graphId: artifact.graphId, graphRevision: artifact.graphRevision, producerNodeId: artifact.producerNodeId, nodeRevision: artifact.nodeRevision, kind: artifact.kind, value: artifact.value, objectReferences: artifact.objectReferences, citations: artifact.citations, provenance: artifact.provenance, dataClass: artifact.dataClass, scope: artifact.scope, sizeBytes: artifact.sizeBytes, createdAt: artifact.createdAt }) }; }
  private commitArtifacts(state: TaskGraphState, node: TaskNode, artifacts: readonly TaskArtifact[]): void { const removed = state.artifacts.filter(artifact => artifact.producerNodeId === node.id); const existing = state.artifacts.filter(artifact => artifact.producerNodeId !== node.id); const nextCount = state.counters.generatedArtifacts - removed.length + artifacts.length; const nextBytes = state.counters.artifactBytes - removed.reduce((sum, artifact) => sum + artifact.sizeBytes, 0) + artifacts.reduce((sum, artifact) => sum + artifact.sizeBytes, 0); if (nextCount > state.graph.budget.maxGeneratedArtifacts) throw new TaskGraphError('GRAPH_ARTIFACT_LIMIT', 'Graph artifact budget exceeded'); if (nextBytes > state.graph.budget.maxArtifactBytes * state.graph.budget.maxGeneratedArtifacts) throw new TaskGraphError('GRAPH_ARTIFACT_TOO_LARGE', 'Graph artifact byte budget exceeded'); this.updateState(state, { artifacts: [...existing, ...artifacts], counters: { ...state.counters, generatedArtifacts: nextCount, artifactBytes: nextBytes } }); }
  private markBlocked(state: TaskGraphState): void { for (const node of state.nodes) { if (!['PENDING', 'STALE'].includes(node.status)) continue; const blockers = node.dependencies.map(dependency => ({ node: this.requireNode(state, dependencyId(dependency)), required: dependencyRequired(dependency) })).filter(value => value.required && ['FAILED', 'CANCELLED', 'REMOVED'].includes(value.node.status)); if (blockers.length) this.replaceNode(state, node, { status: 'FAILED', errorCode: 'GRAPH_DEPENDENCY_FAILED', errorMessage: `Dependency ${blockers[0].node.id} failed`, completedAt: nowIso(this.now) }); } }
  private dependenciesReady(state: TaskGraphState, node: TaskNode): boolean { return node.dependencies.every(dependency => { const dependencyNode = this.requireNode(state, dependencyId(dependency)); if (dependencyNode.status === 'COMPLETED') return true; return !dependencyRequired(dependency) && ['FAILED', 'CANCELLED', 'SKIPPED', 'REMOVED'].includes(dependencyNode.status); }); }
  private descendants(nodes: readonly TaskNode[], roots: ReadonlySet<string>): string[] { const result = new Set<string>(); let changed = true; while (changed) { changed = false; for (const node of nodes) if (!result.has(node.id) && node.dependencies.some(dependency => roots.has(dependencyId(dependency)) || result.has(dependencyId(dependency)))) { result.add(node.id); changed = true; } } return [...result]; }
  private clearNodeArtifacts(state: TaskGraphState, nodeId: string): void { const removed = state.artifacts.filter(artifact => artifact.producerNodeId === nodeId); this.updateState(state, { artifacts: state.artifacts.filter(artifact => artifact.producerNodeId !== nodeId), counters: { ...state.counters, generatedArtifacts: Math.max(0, state.counters.generatedArtifacts - removed.length), artifactBytes: Math.max(0, state.counters.artifactBytes - removed.reduce((sum, artifact) => sum + artifact.sizeBytes, 0)) } }); }
  private async invalidateForRevision(state: TaskGraphState, nodeIds: readonly string[], goal?: string): Promise<void> {
    const changed = new Set(nodeIds);
    const affected = new Set([...changed, ...this.descendants(state.nodes, changed)]);
    const nextRevision = state.graphRevision + 1;
    const timestamp = nowIso(this.now);
    const nodes = state.nodes.map(node => affected.has(node.id) ? { ...node, status: 'STALE' as const, nodeRevision: node.nodeRevision + 1, attempt: 0, outputArtifactIds: [], errorCode: undefined, errorMessage: undefined, startedAt: undefined, completedAt: undefined } : node);
    const graph = { ...state.graph, ...(goal ? { goal } : {}), nodes, revision: nextRevision, updatedAt: timestamp };
    // Publish the new revision before cancelling workers. In-flight results
    // then fail the revision check instead of being able to finalize the old DAG.
    this.updateState(state, { graph, graphRevision: nextRevision, nodes, artifacts: state.artifacts.filter(artifact => !affected.has(artifact.producerNodeId)), lifecycle: 'READY', summary: undefined, errorCode: undefined, errorMessage: undefined });
    await Promise.all([...affected].map(nodeId => this.cancelNodeWorker(state, nodeId)));
    const clearedNodes = this.requireGraph(state.graph.id).nodes.map(node => affected.has(node.id) ? { ...node, workerId: undefined } : node);
    this.updateState(state, { nodes: clearedNodes, graph: { ...state.graph, nodes: clearedNodes, updatedAt: timestamp } });
    await this.persist();
    this.wake(state.graph.id);
  }
  private async finalize(state: TaskGraphState): Promise<void> { const failed = state.nodes.filter(node => ['FAILED', 'CANCELLED', 'REMOVED', 'SKIPPED', 'STALE'].includes(node.status)).map(node => node.id); const completed = state.nodes.filter(node => node.status === 'COMPLETED').map(node => node.id); const skipped = state.nodes.filter(node => ['SKIPPED', 'REMOVED'].includes(node.status)).map(node => node.id); const output = [...state.nodes].reverse().flatMap(node => node.outputArtifactIds.map(id => state.artifacts.find(artifact => artifact.id === id))).find(artifact => artifact?.kind === 'text')?.value; const lifecycle: TaskGraphLifecycle = failed.length ? completed.length ? 'PARTIAL' : 'FAILED' : 'COMPLETED'; const summary: TaskGraphSummary = { ...(typeof output === 'string' ? { output: output.slice(0, 64_000) } : {}), completedNodeIds: completed, failedNodeIds: failed, skippedNodeIds: skipped, artifactIds: state.artifacts.map(artifact => artifact.id) }; this.updateState(state, { lifecycle, summary, errorCode: lifecycle === 'FAILED' ? 'GRAPH_DEPENDENCY_FAILED' : undefined }); await this.persist(); }
  private async failGraph(state: TaskGraphState, code: TaskGraphErrorCode, message: string): Promise<void> { this.updateState(state, { lifecycle: 'FAILED', errorCode: code, errorMessage: message }); await this.persist(); }
  private updateState(state: TaskGraphState, patch: Partial<TaskGraphState>): void { Object.assign(state, patch, { updatedAt: nowIso(this.now) }); this.graphs.set(state.graph.id, state); }
  private updateCounters(state: TaskGraphState, patch: Partial<TaskGraphCounters>): void { this.updateState(state, { counters: { ...state.counters, ...patch } }); }
  private replaceNode(state: TaskGraphState, node: TaskNode, patch: Partial<TaskNode>): void { const next = { ...node, ...patch } as TaskNode; const nodes = state.nodes.map(value => value.id === node.id ? next : value); this.updateState(state, { nodes, graph: { ...state.graph, nodes, updatedAt: nowIso(this.now) } }); }
  private requireGraph(graphId: string): TaskGraphState { const state = this.graphs.get(graphId); if (!state) throw new TaskGraphError('GRAPH_NOT_FOUND', `Graph ${graphId} was not found`); return state; }
  private async getRequired(graphId: string): Promise<TaskGraphState> { await this.ready(); return clone(this.requireGraph(graphId)); }
  private requireNode(state: TaskGraphState, nodeId: string): TaskNode { const node = state.nodes.find(value => value.id === nodeId); if (!node) throw new TaskGraphError('GRAPH_NOT_FOUND', `Node ${nodeId} was not found`); return node; }
  private toNodeInput(node: TaskNode): TaskNodeInput { return { id: node.id, title: node.title, objective: node.objective, workerType: node.workerType, agentId: node.agentId, assignment: node.assignment, dependencies: node.dependencies, requiredCapabilities: node.requiredCapabilities, allowedDataScopes: node.allowedDataScopes, contextItems: node.contextItems, inputRefs: node.inputRefs, outputRefs: node.outputRefs, priority: node.priority, timeoutMs: node.timeoutMs, retryPolicy: node.retryPolicy, ...(node.toolFlow ? { toolFlow: node.toolFlow } : {}) }; }
  private async pauseNodeWorker(state: TaskGraphState, nodeId: string): Promise<void> { const node = this.requireNode(state, nodeId); if (node.workerId) { await this.workerService.pauseWorker(node.workerId).catch(() => undefined); this.replaceNode(state, node, { status: 'PAUSED' }); } }
  private async resumeNodeWorker(state: TaskGraphState, nodeId: string): Promise<void> { const node = this.requireNode(state, nodeId); if (node.workerId) { await this.workerService.resumeWorker(node.workerId).catch(() => undefined); this.replaceNode(state, node, { status: 'RUNNING' }); } }
  private async cancelNodeWorker(state: TaskGraphState, nodeId: string): Promise<void> { const node = this.requireNode(state, nodeId); if (node.workerId) await this.workerService.cancelWorker(node.workerId).catch(() => undefined); }
  private wake(graphId: string): void { const execution = this.active.get(graphId); execution?.wake?.(); execution && (execution.wake = undefined); }
  private waitForWake(execution: GraphExecution): Promise<void> { return new Promise(resolve => { execution.wake = resolve; }); }
  private async hydrate(): Promise<void> { const raw = await this.storage.read(); if (!raw) return; if (!raw || typeof raw !== 'object' || (raw as { version?: unknown }).version !== 1 || !Array.isArray((raw as { graphs?: unknown }).graphs)) throw new TaskGraphError('FAILED', 'Invalid task graph storage'); for (const value of (raw as { graphs: TaskGraphState[] }).graphs) { if (!value?.graph?.id || !TASK_GRAPH_LIFECYCLES.includes(value.lifecycle)) continue; const recovered = ['RUNNING', 'WAITING'].includes(value.lifecycle) ? { ...value, lifecycle: 'PAUSED' as const, errorCode: 'GRAPH_PAUSED' as const, errorMessage: 'Graph paused during restart', updatedAt: nowIso(this.now) } : value; this.graphs.set(recovered.graph.id, clone(recovered)); } }
  private async persist(): Promise<void> { const snapshot = { version: 1 as const, graphs: [...this.graphs.values()].map(clone) }; const operation = this.writes.then(() => this.storage.write(snapshot)); this.writes = operation.catch(() => undefined); await operation; }
}

function isWorkerResult(value: WorkerResult | TaskArtifactInput | readonly TaskArtifactInput[]): value is WorkerResult { return !Array.isArray(value) && typeof value === 'object' && value !== null && 'status' in value && 'workerId' in value && 'taskId' in value; }
function delay(ms: number): Promise<void> { return new Promise(resolve => setTimeout(resolve, ms)); }
