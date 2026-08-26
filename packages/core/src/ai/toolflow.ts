/**
 * ToolFlow is the deliberately small, data-only workflow runtime used by
 * Agent runs, workers and task graphs.  A model may propose this program, but
 * it never gets to execute code: the compiler validates a bounded tree and the
 * executor invokes only already-registered typed Tools through ToolExecutor.
 *
 * The runtime keeps values in a privacy-labelled envelope.  The envelope is
 * not part of the model-facing DSL and is never written to the execution
 * trace, which lets local callers retain private results without leaking them
 * through diagnostics.
 */

import { canonicalJson } from '../crypto.js';
import type { AIDataClass } from './privacy.js';
import { SecretRedactionPolicy } from '../security/secrets.js';
import {
  type Tool,
  type ToolCapability,
  type ToolExecutionSource,
  type ToolIntent,
  type ToolResult,
  ToolExecutor,
  ToolRegistry,
  SkillRegistry,
} from './tools.js';

export const TOOL_FLOW_VERSION = 1 as const;

export const TOOL_FLOW_OPERATIONS = [
  'CALL_TOOL', 'MAP', 'FILTER', 'SORT', 'LIMIT', 'SELECT', 'TRANSFORM',
  'IF', 'FOREACH', 'PARALLEL', 'JOIN', 'ASSERT', 'RETURN',
] as const;
export type ToolFlowOperation = (typeof TOOL_FLOW_OPERATIONS)[number];

export const TOOL_FLOW_EXECUTIONS = ['local', 'personal_trusted', 'external'] as const;
export type ToolFlowExecutionSource = (typeof TOOL_FLOW_EXECUTIONS)[number];

export const TOOL_FLOW_VALUE_TYPES = ['unknown', 'null', 'string', 'number', 'boolean', 'object', 'array'] as const;
export type ToolFlowValueType = (typeof TOOL_FLOW_VALUE_TYPES)[number];

export type ToolFlowErrorCode =
  | 'INVALID_PROGRAM'
  | 'UNKNOWN_OPERATION'
  | 'UNKNOWN_TOOL'
  | 'UNKNOWN_SKILL'
  | 'INVALID_REFERENCE'
  | 'CYCLE'
  | 'RECURSION'
  | 'EXPANSION_LIMIT'
  | 'BUDGET_EXCEEDED'
  | 'CAPABILITY_MISMATCH'
  | 'PRIVACY_VIOLATION'
  | 'INVALID_INTEGRITY'
  | 'EXPIRED'
  | 'TOOL_FAILED'
  | 'ASSERTION_FAILED'
  | 'RETRY_LIMIT'
  | 'INTERMEDIATE_LIMIT'
  | 'PARALLEL_LIMIT'
  | 'CANCELLED'
  | 'PAUSED'
  | 'DUPLICATE_EXECUTION'
  | 'FAILED';

export class ToolFlowError extends Error {
  constructor(readonly code: ToolFlowErrorCode, message: string, readonly stepId?: string) {
    super(message);
    this.name = 'ToolFlowError';
  }
}

export type ToolFlowJsonValue = null | string | number | boolean | readonly ToolFlowJsonValue[] | { readonly [key: string]: ToolFlowJsonValue };

/**
 * Expressions are intentionally data-only.  `ref`, `var` and `path` are the
 * only evaluation primitives; there is no callback, script, shell or eval
 * escape hatch.
 */
export type ToolFlowExpression =
  | ToolFlowJsonValue
  | { readonly ref: string }
  | { readonly var: string }
  | { readonly path: string; readonly from?: ToolFlowExpression }
  | { readonly literal: ToolFlowJsonValue; readonly dataClass?: AIDataClass; readonly sourceRefs?: readonly string[] }
  | readonly ToolFlowExpression[]
  | { readonly [key: string]: ToolFlowExpression };

export interface ToolFlowVariableDeclaration {
  readonly name: string;
  readonly type?: ToolFlowValueType;
  readonly dataClass?: AIDataClass;
  readonly initial?: ToolFlowExpression;
}

export interface ToolFlowDataScope {
  readonly dataClasses: readonly AIDataClass[];
  readonly sourceKinds?: readonly string[];
  readonly objectIds?: readonly string[];
}

export interface ToolFlowRetryPolicy {
  readonly maxAttempts: number;
  readonly backoffMs?: number;
  readonly retryableCodes?: readonly string[];
}

export interface ToolFlowStep {
  readonly version?: 1;
  readonly id: string;
  readonly op: ToolFlowOperation | string;
  readonly as?: string;
  readonly toolId?: string;
  readonly skillId?: string;
  readonly requestedCapabilities?: readonly ToolCapability[];
  readonly args?: ToolFlowExpression;
  readonly input?: ToolFlowExpression;
  readonly items?: ToolFlowExpression;
  readonly predicate?: ToolFlowExpression;
  readonly condition?: ToolFlowExpression;
  readonly expression?: ToolFlowExpression;
  readonly value?: ToolFlowExpression;
  readonly count?: ToolFlowExpression;
  readonly limit?: ToolFlowExpression;
  readonly path?: string;
  readonly fields?: readonly string[];
  readonly key?: string | ToolFlowExpression;
  readonly direction?: 'asc' | 'desc';
  readonly separator?: string;
  readonly itemVar?: string;
  readonly indexVar?: string;
  readonly then?: readonly ToolFlowStep[];
  readonly else?: readonly ToolFlowStep[];
  readonly steps?: readonly ToolFlowStep[];
  readonly branches?: readonly (readonly ToolFlowStep[])[];
  readonly retry?: ToolFlowRetryPolicy;
  /** A failed call is returned as a typed ToolResult instead of aborting. */
  readonly continueOnError?: boolean;
}

export interface ToolFlowBudget {
  readonly maxSteps: number;
  readonly maxIterations: number;
  readonly maxParallelism: number;
  readonly maxToolCalls: number;
  readonly maxRuntimeMs: number;
  readonly maxIntermediateBytes: number;
  readonly maxNestingDepth: number;
  readonly maxExpansion: number;
  readonly maxRetries: number;
  readonly maxTraceEntries: number;
}

export type ToolFlowCreatorKind = 'AgentRun' | 'WorkerRun';
export interface ToolFlowCreator {
  readonly kind: ToolFlowCreatorKind;
  readonly id: string;
}

export interface ToolFlowProgram {
  readonly version: 1;
  readonly id: string;
  readonly creator: ToolFlowCreator;
  readonly creatorAgentRunId?: string;
  readonly creatorWorkerRunId?: string;
  readonly execution: ToolFlowExecutionSource;
  readonly defaultSkillId?: string;
  readonly allowedTools: readonly string[];
  readonly allowedCapabilities: readonly ToolCapability[];
  readonly allowedDataScopes: readonly ToolFlowDataScope[];
  readonly variables: readonly ToolFlowVariableDeclaration[];
  readonly steps: readonly ToolFlowStep[];
  readonly budget: ToolFlowBudget;
  readonly expiry: string;
  readonly revision: number;
  readonly integrity: string;
}

/** Public shorthand used by Agent/Worker integrations. */
export type ToolFlow = ToolFlowProgram;

export interface ToolFlowInput {
  readonly id?: string;
  readonly creator?: ToolFlowCreator | string;
  readonly creatorAgentRunId?: string;
  readonly creatorWorkerRunId?: string;
  readonly execution?: ToolFlowExecutionSource;
  readonly defaultSkillId?: string;
  readonly allowedTools: readonly string[];
  readonly allowedCapabilities?: readonly ToolCapability[];
  readonly allowedDataScopes?: readonly ToolFlowDataScope[];
  readonly variables?: readonly ToolFlowVariableDeclaration[];
  readonly steps: readonly ToolFlowStep[];
  readonly budget?: Partial<ToolFlowBudget>;
  readonly expiry?: string;
  readonly revision?: number;
  readonly integrity?: string;
}

export interface ToolFlowCostEstimate {
  readonly steps: number;
  readonly toolCalls: number;
  readonly maxParallelism: number;
  readonly maxExpansion: number;
  readonly intermediateBytes: number;
  readonly runtimeClass: 'constant' | 'bounded-iteration' | 'parallel-bounded';
}

export interface ToolFlowValidationResult {
  readonly valid: boolean;
  readonly errors: readonly { readonly code: ToolFlowErrorCode; readonly message: string; readonly stepId?: string }[];
  readonly cost?: ToolFlowCostEstimate;
}

export interface ToolFlowCompilerOptions {
  readonly registry?: ToolRegistry;
  readonly skills?: SkillRegistry;
  readonly now?: () => number;
}

export interface ToolFlowValidatorOptions extends ToolFlowCompilerOptions {}

export interface ToolFlowTraceEntry {
  readonly stepId: string;
  readonly op: ToolFlowOperation;
  readonly status: 'started' | 'completed' | 'failed' | 'skipped';
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly toolId?: string;
  readonly intentId?: string;
  readonly calls?: number;
  readonly iteration?: number;
  readonly inputBytes?: number;
  readonly outputBytes?: number;
  readonly dataClass?: AIDataClass;
  readonly sourceRefs?: readonly string[];
  readonly errorCode?: ToolFlowErrorCode | string;
}

export interface ToolFlowTrace {
  readonly version: 1;
  readonly id: string;
  readonly flowId: string;
  readonly executionId: string;
  readonly entries: readonly ToolFlowTraceEntry[];
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly steps: number;
  readonly toolCalls: number;
  readonly dataClass: AIDataClass;
}

export interface ToolFlowToolCall {
  readonly stepId: string;
  readonly toolId: string;
  readonly skillId: string;
  readonly intentId: string;
  readonly auditId: string;
  readonly dataClass: AIDataClass;
  readonly ok: boolean;
}

export interface ToolFlowCitation {
  readonly id: string;
  readonly sourceType?: string;
  readonly dataClass: AIDataClass;
}

export interface ToolFlowArtifact {
  readonly version: 1;
  readonly id: string;
  readonly flowId: string;
  readonly executionId: string;
  readonly result: unknown;
  readonly sourceToolCalls: readonly ToolFlowToolCall[];
  readonly citations: readonly ToolFlowCitation[];
  readonly provenance: {
    readonly creator: ToolFlowCreator;
    readonly flowRevision: number;
    readonly execution: ToolFlowExecutionSource;
  };
  readonly privacyScope: ToolFlowDataScope;
  readonly integrity: string;
  readonly executionTraceRef: string;
}

export type ToolFlowResultStatus = 'COMPLETED' | 'PARTIAL' | 'FAILED' | 'CANCELLED';

export interface ToolFlowResult {
  readonly version: 1;
  readonly flowId: string;
  readonly executionId: string;
  readonly status: ToolFlowResultStatus;
  readonly value?: unknown;
  readonly dataClass: AIDataClass;
  readonly artifact?: ToolFlowArtifact;
  readonly artifacts: readonly ToolFlowArtifact[];
  readonly trace: ToolFlowTrace;
  readonly traceRef: string;
  readonly failures: readonly { readonly stepId: string; readonly code: string }[];
  readonly errorCode?: ToolFlowErrorCode | string;
}

export interface ToolFlowVariableValue {
  readonly value: unknown;
  readonly dataClass?: AIDataClass;
  readonly sourceRefs?: readonly string[];
}

export interface ToolFlowExecutionOptions {
  readonly executionId?: string;
  readonly input?: unknown;
  readonly inputDataClass?: AIDataClass;
  readonly variables?: Readonly<Record<string, ToolFlowExpression | ToolFlowVariableValue>>;
  readonly initialVariables?: Readonly<Record<string, ToolFlowExpression | ToolFlowVariableValue>>;
  readonly signal?: AbortSignal;
  readonly onTrace?: (entry: ToolFlowTraceEntry) => void;
}

export interface ToolFlowExecutionHandle {
  readonly executionId: string;
  readonly promise: Promise<ToolFlowResult>;
  pause(): boolean;
  resume(): boolean;
  cancel(): boolean;
}

const DEFAULT_BUDGET: ToolFlowBudget = {
  maxSteps: 256,
  maxIterations: 128,
  maxParallelism: 4,
  maxToolCalls: 128,
  maxRuntimeMs: 10 * 60_000,
  maxIntermediateBytes: 512 * 1024,
  maxNestingDepth: 8,
  maxExpansion: 256,
  maxRetries: 8,
  maxTraceEntries: 512,
};

const CAPABILITIES: readonly ToolCapability[] = ['READ_PRIVATE', 'WRITE_PRIVATE', 'NETWORK_SEND', 'DEVICE_ACTION', 'DESTRUCTIVE', 'SECURITY_SENSITIVE'];
const DATA_CLASSES: readonly AIDataClass[] = ['PUBLIC', 'USER_EXPLICIT', 'PRIVATE', 'SECRET'];
const FORBIDDEN_KEYS = new Set(['eval', 'evaluate', 'script', 'shell', 'command', 'python', 'javascript', 'code', 'spawn', 'dynamicFlow', 'invokeFlow']);

function clone<T>(value: T): T {
  try { return structuredClone(value); } catch { return value; }
}
function safeId(value: unknown, max = 256): value is string { return typeof value === 'string' && value.length > 0 && value.length <= max && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value); }
function safeText(value: unknown, max = 64_000): value is string { return typeof value === 'string' && value.trim().length > 0 && value.length <= max; }
function boundedInt(value: number | undefined, min: number, max: number, fallback: number): number { return Number.isSafeInteger(value) ? Math.max(min, Math.min(max, value!)) : fallback; }
function nowIso(now: () => number): string { return new Date(now()).toISOString(); }
function randomId(prefix: string): string { return `${prefix}-${crypto.randomUUID()}`; }
function normalizeRef(value: string): string { return value.startsWith('$') ? value.slice(1) : value; }
function isPrivate(dataClass: AIDataClass): boolean { return dataClass === 'PRIVATE' || dataClass === 'SECRET'; }
function classRank(dataClass: AIDataClass): number { return DATA_CLASSES.indexOf(dataClass); }
function maxClass(left: AIDataClass, right: AIDataClass): AIDataClass { return classRank(left) >= classRank(right) ? left : right; }
function unique<T>(values: readonly T[], max = 512): T[] { return [...new Set(values)].slice(0, max); }
function serialSize(value: unknown): number {
  try {
    const encoded = JSON.stringify(value, (_key, child) => child instanceof Uint8Array ? Array.from(child) : child);
    return new TextEncoder().encode(encoded ?? 'null').byteLength;
  } catch { return Number.MAX_SAFE_INTEGER; }
}
function stableDigest(value: unknown): string {
  const text = canonicalJson(value);
  let a = 2166136261;
  let b = 16777619;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    a = Math.imul(a ^ code, 16777619);
    b = Math.imul(b ^ (code + index), 2246822519);
  }
  return `toolflow-${(a >>> 0).toString(16).padStart(8, '0')}${(b >>> 0).toString(16).padStart(8, '0')}`;
}
function integrityPayload(program: Omit<ToolFlowProgram, 'integrity'> | ToolFlowProgram): unknown {
  const { integrity: _integrity, ...payload } = program as ToolFlowProgram;
  return payload;
}
function digestProgram(program: Omit<ToolFlowProgram, 'integrity'> | ToolFlowProgram): string { return stableDigest(integrityPayload(program)); }
function isoOrUndefined(value: string | undefined): number | undefined { if (!value) return undefined; const parsed = Date.parse(value); return Number.isFinite(parsed) ? parsed : undefined; }
function typeOfValue(value: unknown): ToolFlowValueType { if (value === null) return 'null'; if (Array.isArray(value)) return 'array'; if (typeof value === 'string') return 'string'; if (typeof value === 'number') return 'number'; if (typeof value === 'boolean') return 'boolean'; if (typeof value === 'object') return 'object'; return 'unknown'; }
function errorCode(error: unknown): string { return error instanceof ToolFlowError ? error.code : error instanceof Error ? error.message.slice(0, 128) : String(error).slice(0, 128); }
function safeSourceRefs(values: readonly string[] | undefined): string[] { return unique((values ?? []).filter(value => safeId(value, 512)), 256); }
function assertNoManagedSecret(value: unknown, message = 'ToolFlow cannot carry managed secret material'): void {
  if (SecretRedactionPolicy.containsManagedSecret(value)) throw new ToolFlowError('PRIVACY_VIOLATION', message);
}

function normalizeScope(scope: ToolFlowDataScope): ToolFlowDataScope {
  if (!scope || !Array.isArray(scope.dataClasses) || !scope.dataClasses.length || scope.dataClasses.some(value => !DATA_CLASSES.includes(value))) throw new ToolFlowError('INVALID_PROGRAM', 'ToolFlow data scope is invalid');
  const sourceKinds = unique((scope.sourceKinds ?? []).filter(value => safeId(value, 128)));
  const objectIds = unique((scope.objectIds ?? []).filter(value => safeId(value, 256)));
  if ((scope.sourceKinds ?? []).length !== sourceKinds.length || (scope.objectIds ?? []).length !== objectIds.length) throw new ToolFlowError('INVALID_PROGRAM', 'ToolFlow data scope contains invalid identifiers');
  return { dataClasses: unique(scope.dataClasses), ...(sourceKinds.length ? { sourceKinds } : {}), ...(objectIds.length ? { objectIds } : {}) };
}
function scopeAllows(scopes: readonly ToolFlowDataScope[], dataClass: AIDataClass, source?: string, objectId?: string): boolean {
  return scopes.some(scope => scope.dataClasses.includes(dataClass) && (!scope.sourceKinds?.length || Boolean(source && scope.sourceKinds.includes(source))) && (!scope.objectIds?.length || Boolean(objectId && scope.objectIds.includes(objectId))));
}
function scopeSubset(child: ToolFlowDataScope, parents: readonly ToolFlowDataScope[]): boolean {
  const subset = (childValues: readonly string[] | undefined, parentValues: readonly string[] | undefined): boolean => {
    if (!childValues?.length) return !parentValues?.length;
    if (!parentValues?.length) return true;
    return childValues.every(value => parentValues.includes(value));
  };
  return child.dataClasses.every(dataClass => parents.some(parent => parent.dataClasses.includes(dataClass) && subset(child.sourceKinds, parent.sourceKinds) && subset(child.objectIds, parent.objectIds)));
}
function normalizeBudget(value?: Partial<ToolFlowBudget>): ToolFlowBudget {
  return {
    maxSteps: boundedInt(value?.maxSteps, 1, 100_000, DEFAULT_BUDGET.maxSteps),
    maxIterations: boundedInt(value?.maxIterations, 1, 10_000, DEFAULT_BUDGET.maxIterations),
    maxParallelism: boundedInt(value?.maxParallelism, 1, 64, DEFAULT_BUDGET.maxParallelism),
    maxToolCalls: boundedInt(value?.maxToolCalls, 0, 10_000, DEFAULT_BUDGET.maxToolCalls),
    maxRuntimeMs: boundedInt(value?.maxRuntimeMs, 100, 3_600_000, DEFAULT_BUDGET.maxRuntimeMs),
    maxIntermediateBytes: boundedInt(value?.maxIntermediateBytes, 1_024, 64 * 1024 * 1024, DEFAULT_BUDGET.maxIntermediateBytes),
    maxNestingDepth: boundedInt(value?.maxNestingDepth, 1, 64, DEFAULT_BUDGET.maxNestingDepth),
    maxExpansion: boundedInt(value?.maxExpansion, 1, 100_000, DEFAULT_BUDGET.maxExpansion),
    maxRetries: boundedInt(value?.maxRetries, 0, 1_000, DEFAULT_BUDGET.maxRetries),
    maxTraceEntries: boundedInt(value?.maxTraceEntries, 1, 100_000, DEFAULT_BUDGET.maxTraceEntries),
  };
}
function normalizeRetry(value: ToolFlowRetryPolicy | undefined): ToolFlowRetryPolicy | undefined {
  if (!value) return undefined;
  const maxAttempts = boundedInt(value.maxAttempts, 1, 32, 1);
  if (!Number.isSafeInteger(value.maxAttempts) || maxAttempts !== value.maxAttempts) throw new ToolFlowError('INVALID_PROGRAM', 'ToolFlow retry attempts are invalid');
  const retryableCodes = unique((value.retryableCodes ?? []).filter(code => safeId(code, 128)));
  return { maxAttempts, ...(value.backoffMs === undefined ? {} : { backoffMs: boundedInt(value.backoffMs, 0, 60_000, 0) }), ...(retryableCodes.length ? { retryableCodes } : {}) };
}
function normalizeStep(step: ToolFlowStep, seen = new WeakSet<object>()): ToolFlowStep {
  if (!step || typeof step !== 'object' || !safeId(step.id) || typeof step.op !== 'string') throw new ToolFlowError('INVALID_PROGRAM', 'ToolFlow step is invalid');
  if (seen.has(step as object)) throw new ToolFlowError('CYCLE', `ToolFlow step ${step.id} contains a cycle`, step.id);
  seen.add(step as object);
  const normalized: ToolFlowStep = {
    ...step,
    id: step.id,
    op: step.op,
    ...(step.as ? { as: step.as } : {}),
    ...(step.retry ? { retry: normalizeRetry(step.retry) } : {}),
    ...(step.steps ? { steps: step.steps.map(child => normalizeStep(child, seen)) } : {}),
    ...(step.then ? { then: step.then.map(child => normalizeStep(child, seen)) } : {}),
    ...(step.else ? { else: step.else.map(child => normalizeStep(child, seen)) } : {}),
    ...(step.branches ? { branches: step.branches.map(branch => branch.map(child => normalizeStep(child, seen))) } : {}),
  };
  seen.delete(step as object);
  return normalized;
}

function expressionReferences(value: unknown, output: Set<string>, seen = new WeakSet<object>()): void {
  if (value === null || typeof value !== 'object') return;
  if (seen.has(value as object)) throw new ToolFlowError('CYCLE', 'ToolFlow expression contains a cycle');
  seen.add(value as object);
  if (Array.isArray(value)) { value.forEach(item => expressionReferences(item, output, seen)); seen.delete(value as object); return; }
  const record = value as Record<string, unknown>;
  if (typeof record.ref === 'string') { output.add(normalizeRef(record.ref)); seen.delete(value as object); return; }
  if (typeof record.var === 'string') { output.add(normalizeRef(record.var)); seen.delete(value as object); return; }
  if (typeof record.path === 'string' && record.from !== undefined) expressionReferences(record.from, output, seen);
  if ('literal' in record) { seen.delete(value as object); return; }
  for (const [key, child] of Object.entries(record)) {
    if (FORBIDDEN_KEYS.has(key.toLowerCase())) throw new ToolFlowError('INVALID_PROGRAM', `Forbidden dynamic key ${key}`);
    expressionReferences(child, output, seen);
  }
  seen.delete(value as object);
}

function collectForbidden(value: unknown, seen = new WeakSet<object>()): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  if (seen.has(value as object)) throw new ToolFlowError('CYCLE', 'ToolFlow contains a cyclic object');
  seen.add(value as object);
  if (Array.isArray(value)) { for (const item of value) { const found = collectForbidden(item, seen); if (found) return found; } seen.delete(value as object); return undefined; }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEYS.has(key.toLowerCase())) return key;
    const found = collectForbidden(child, seen); if (found) return found;
  }
  seen.delete(value as object);
  return undefined;
}

function literalArrayLength(expression: ToolFlowExpression | undefined): number | undefined {
  if (Array.isArray(expression)) return expression.length;
  if (expression && typeof expression === 'object' && 'literal' in expression && Array.isArray((expression as { literal: unknown }).literal)) return ((expression as { literal: readonly unknown[] }).literal).length;
  return undefined;
}

function expressionByteEstimate(expression: unknown): number { return Math.min(64 * 1024 * 1024, serialSize(expression)); }

/** Performs static validation and cost estimation without executing tools. */
export class ToolFlowValidator {
  private readonly registry?: ToolRegistry;
  private readonly skills?: SkillRegistry;
  private readonly now: () => number;
  constructor(options: ToolFlowValidatorOptions = {}) { this.registry = options.registry; this.skills = options.skills; this.now = options.now ?? Date.now; }

  validate(program: ToolFlowProgram): ToolFlowValidationResult {
    const errors: Array<{ code: ToolFlowErrorCode; message: string; stepId?: string }> = [];
    let cost: ToolFlowCostEstimate | undefined;
    try { cost = this.validateOrThrow(program); } catch (error) { const value = error instanceof ToolFlowError ? error : new ToolFlowError('INVALID_PROGRAM', String(error)); errors.push({ code: value.code, message: value.message, ...(value.stepId ? { stepId: value.stepId } : {}) }); }
    return { valid: errors.length === 0, errors, ...(cost ? { cost } : {}) };
  }

  assertValid(program: ToolFlowProgram): ToolFlowCostEstimate {
    return this.validateOrThrow(program);
  }

  verifyIntegrity(program: ToolFlowProgram): boolean { return safeId(program.integrity, 256) && digestProgram(program) === program.integrity; }

  private validateOrThrow(program: ToolFlowProgram): ToolFlowCostEstimate {
    if (!program || typeof program !== 'object' || program.version !== 1 || !safeId(program.id)) throw new ToolFlowError('INVALID_PROGRAM', 'ToolFlow program header is invalid');
    if (!program.creator || !['AgentRun', 'WorkerRun'].includes(program.creator.kind) || !safeId(program.creator.id)) throw new ToolFlowError('INVALID_PROGRAM', 'ToolFlow creator must be an AgentRun or WorkerRun');
    if (!TOOL_FLOW_EXECUTIONS.includes(program.execution)) throw new ToolFlowError('INVALID_PROGRAM', 'ToolFlow execution source is invalid');
    if (program.execution === 'external') throw new ToolFlowError('PRIVACY_VIOLATION', 'External AI cannot execute a ToolFlow');
    if (!Array.isArray(program.allowedTools) || program.allowedTools.some(toolId => !safeId(toolId))) throw new ToolFlowError('INVALID_PROGRAM', 'ToolFlow allowed tools are invalid');
    if (program.allowedCapabilities.some(capability => !CAPABILITIES.includes(capability))) throw new ToolFlowError('CAPABILITY_MISMATCH', 'ToolFlow contains an unknown capability');
    const allowedDataScopes = program.allowedDataScopes.map(normalizeScope);
    if (!allowedDataScopes.length) throw new ToolFlowError('PRIVACY_VIOLATION', 'ToolFlow must declare data scopes');
    if (!Array.isArray(program.steps)) throw new ToolFlowError('INVALID_PROGRAM', 'ToolFlow steps are invalid');
    if (!Number.isSafeInteger(program.revision) || program.revision < 1) throw new ToolFlowError('INVALID_PROGRAM', 'ToolFlow revision is invalid');
    const expiry = isoOrUndefined(program.expiry); if (expiry === undefined) throw new ToolFlowError('INVALID_PROGRAM', 'ToolFlow expiry is invalid');
    if (expiry <= this.now()) throw new ToolFlowError('EXPIRED', 'ToolFlow has expired');
    const budget = normalizeBudget(program.budget);
    if (!this.verifyIntegrity(program)) throw new ToolFlowError('INVALID_INTEGRITY', 'ToolFlow integrity does not match its program');
    const forbidden = collectForbidden(program.steps); if (forbidden) throw new ToolFlowError('INVALID_PROGRAM', `Forbidden dynamic field ${forbidden}`);
    const known = new Set<string>(['input', 'last', 'item', 'index']);
    for (const variable of program.variables) {
      if (!safeId(variable.name) || known.has(normalizeRef(variable.name))) throw new ToolFlowError('INVALID_PROGRAM', `Invalid or duplicate ToolFlow variable ${variable.name}`);
      if (variable.type && !TOOL_FLOW_VALUE_TYPES.includes(variable.type)) throw new ToolFlowError('INVALID_PROGRAM', `Unknown ToolFlow variable type ${variable.type}`);
      if (variable.dataClass && !DATA_CLASSES.includes(variable.dataClass)) throw new ToolFlowError('INVALID_PROGRAM', `Unknown ToolFlow variable data class ${variable.dataClass}`);
      if (variable.initial !== undefined) this.assertRefs(variable.initial, known);
      known.add(normalizeRef(variable.name));
    }
    const estimate = this.validateSequence(program.steps, new Set(known), 0, budget, program, allowedDataScopes);
    if (estimate.steps > budget.maxSteps || estimate.toolCalls > budget.maxToolCalls) throw new ToolFlowError('BUDGET_EXCEEDED', 'Static ToolFlow cost exceeds the declared budget');
    if (estimate.maxParallelism > budget.maxParallelism) throw new ToolFlowError('PARALLEL_LIMIT', 'Static ToolFlow parallelism exceeds the declared budget');
    if (estimate.maxExpansion > budget.maxExpansion) throw new ToolFlowError('EXPANSION_LIMIT', 'Static ToolFlow expansion exceeds the declared budget');
    if (estimate.intermediateBytes > budget.maxIntermediateBytes) throw new ToolFlowError('INTERMEDIATE_LIMIT', 'Static ToolFlow intermediate data exceeds the declared budget');
    return estimate;
  }

  private assertRefs(expression: unknown, known: ReadonlySet<string>): void {
    const refs = new Set<string>(); expressionReferences(expression, refs);
    for (const ref of refs) if (!known.has(ref)) throw new ToolFlowError('INVALID_REFERENCE', `ToolFlow references unknown variable ${ref}`);
  }

  private validateSequence(steps: readonly ToolFlowStep[], known: Set<string>, depth: number, budget: ToolFlowBudget, program: ToolFlowProgram, scopes: readonly ToolFlowDataScope[]): ToolFlowCostEstimate {
    if (depth > budget.maxNestingDepth) throw new ToolFlowError('RECURSION', 'ToolFlow nesting depth exceeds the declared budget');
    const seen = new Set<string>();
    let estimate: ToolFlowCostEstimate = { steps: 0, toolCalls: 0, maxParallelism: 1, maxExpansion: 1, intermediateBytes: 0, runtimeClass: 'constant' };
    for (const step of steps) {
      if (seen.has(step.id)) throw new ToolFlowError('CYCLE', `ToolFlow step ${step.id} is duplicated`, step.id);
      seen.add(step.id);
      if (!TOOL_FLOW_OPERATIONS.includes(step.op as ToolFlowOperation)) throw new ToolFlowError('UNKNOWN_OPERATION', `Unknown ToolFlow operation ${step.op}`, step.id);
      const op = step.op as ToolFlowOperation;
      for (const field of ['args', 'input', 'items', 'predicate', 'condition', 'expression', 'value', 'count', 'limit', 'key']) {
        const value = (step as unknown as Record<string, unknown>)[field]; if (value !== undefined) this.assertRefs(value, known);
      }
      if (step.as !== undefined && (!safeId(step.as) || ['input', 'last', 'item', 'index'].includes(normalizeRef(step.as)))) throw new ToolFlowError('INVALID_PROGRAM', `Invalid ToolFlow output variable ${step.as}`, step.id);
      if (op === 'CALL_TOOL') {
        if (!safeId(step.toolId) || !program.allowedTools.includes(step.toolId)) throw new ToolFlowError('UNKNOWN_TOOL', `Tool ${step.toolId ?? '(missing)'} is not allowed by this flow`, step.id);
        if (!this.registry) throw new ToolFlowError('UNKNOWN_TOOL', 'A ToolRegistry is required to validate CALL_TOOL', step.id);
        const tool = this.registry.get(step.toolId); if (!tool) throw new ToolFlowError('UNKNOWN_TOOL', `Unknown tool ${step.toolId}`, step.id);
        const skillId = step.skillId ?? program.defaultSkillId; if (!safeId(skillId)) throw new ToolFlowError('UNKNOWN_SKILL', `ToolFlow step ${step.id} has no skill`, step.id);
        if (!this.skills) throw new ToolFlowError('UNKNOWN_SKILL', 'A SkillRegistry is required to validate CALL_TOOL', step.id);
        if (!this.skills.get(skillId)) throw new ToolFlowError('UNKNOWN_SKILL', `Unknown skill ${skillId}`, step.id);
        if (!tool.capabilities.every(capability => program.allowedCapabilities.includes(capability))) throw new ToolFlowError('CAPABILITY_MISMATCH', `Tool ${step.toolId} requests a capability outside the flow grant`, step.id);
        if (step.requestedCapabilities && (step.requestedCapabilities.length !== tool.capabilities.length || !tool.capabilities.every(capability => step.requestedCapabilities!.includes(capability)))) throw new ToolFlowError('CAPABILITY_MISMATCH', `Tool ${step.toolId} capability declaration does not match the registry`, step.id);
        const resultClass = typeof tool.resultClass === 'string' ? tool.resultClass : undefined;
        if (resultClass && !scopeAllows(scopes, resultClass)) throw new ToolFlowError('PRIVACY_VIOLATION', `Tool ${step.toolId} can produce ${resultClass}, outside the flow scope`, step.id);
        estimate = addCost(estimate, { steps: 1, toolCalls: 1, maxParallelism: 1, maxExpansion: 1, intermediateBytes: expressionByteEstimate(step.args), runtimeClass: 'constant' });
      } else {
        estimate = addCost(estimate, { steps: 1, toolCalls: 0, maxParallelism: 1, maxExpansion: 1, intermediateBytes: expressionByteEstimate(step.input ?? step.items ?? step.value), runtimeClass: 'constant' });
      }
      if (op === 'MAP' || op === 'FOREACH' || op === 'FILTER') {
        const child = step.steps ?? [];
        const childKnown = new Set(known); childKnown.add(normalizeRef(step.itemVar ?? 'item')); childKnown.add(normalizeRef(step.indexVar ?? 'index'));
        if (step.predicate !== undefined) this.assertRefs(step.predicate, childKnown);
        const nested = this.validateSequence(child, childKnown, depth + 1, budget, program, scopes);
        const literalLength = literalArrayLength(step.input ?? step.items);
        const multiplier = Math.min(budget.maxIterations, literalLength ?? budget.maxIterations);
        estimate = multiplyCost(estimate, nested, multiplier);
        estimate = { ...estimate, maxExpansion: Math.max(estimate.maxExpansion, multiplier * Math.max(1, nested.maxExpansion)), runtimeClass: 'bounded-iteration' };
      }
      if (op === 'IF') {
        const thenCost = this.validateSequence(step.then ?? [], new Set(known), depth + 1, budget, program, scopes);
        const elseCost = this.validateSequence(step.else ?? [], new Set(known), depth + 1, budget, program, scopes);
        estimate = addCost(estimate, { steps: Math.max(thenCost.steps, elseCost.steps), toolCalls: Math.max(thenCost.toolCalls, elseCost.toolCalls), maxParallelism: Math.max(thenCost.maxParallelism, elseCost.maxParallelism), maxExpansion: Math.max(thenCost.maxExpansion, elseCost.maxExpansion), intermediateBytes: Math.max(thenCost.intermediateBytes, elseCost.intermediateBytes), runtimeClass: 'bounded-iteration' });
      }
      if (op === 'PARALLEL') {
        const branches = step.branches ?? (step.steps ? step.steps.map(value => [value]) : []);
        if (!branches.length) throw new ToolFlowError('INVALID_PROGRAM', 'PARALLEL requires branches', step.id);
        if (branches.length > budget.maxParallelism) throw new ToolFlowError('PARALLEL_LIMIT', 'PARALLEL branch count exceeds the declared budget', step.id);
        let parallel: ToolFlowCostEstimate = { steps: 0, toolCalls: 0, maxParallelism: branches.length, maxExpansion: branches.length, intermediateBytes: 0, runtimeClass: 'parallel-bounded' };
        for (const branch of branches) parallel = addCost(parallel, this.validateSequence(branch, new Set(known), depth + 1, budget, program, scopes));
        estimate = addCost(estimate, { ...parallel, maxParallelism: Math.max(branches.length, parallel.maxParallelism), runtimeClass: 'parallel-bounded' });
      }
      if (step.as) known.add(normalizeRef(step.as));
    }
    return estimate;
  }
}

function addCost(left: ToolFlowCostEstimate, right: ToolFlowCostEstimate): ToolFlowCostEstimate {
  return { steps: left.steps + right.steps, toolCalls: left.toolCalls + right.toolCalls, maxParallelism: Math.max(left.maxParallelism, right.maxParallelism), maxExpansion: Math.max(left.maxExpansion, right.maxExpansion), intermediateBytes: left.intermediateBytes + right.intermediateBytes, runtimeClass: left.runtimeClass === 'parallel-bounded' || right.runtimeClass === 'parallel-bounded' ? 'parallel-bounded' : left.runtimeClass === 'bounded-iteration' || right.runtimeClass === 'bounded-iteration' ? 'bounded-iteration' : 'constant' };
}
function multiplyCost(base: ToolFlowCostEstimate, nested: ToolFlowCostEstimate, multiplier: number): ToolFlowCostEstimate {
  return { steps: base.steps + nested.steps * multiplier, toolCalls: base.toolCalls + nested.toolCalls * multiplier, maxParallelism: Math.max(base.maxParallelism, nested.maxParallelism), maxExpansion: Math.max(base.maxExpansion, nested.maxExpansion * multiplier), intermediateBytes: base.intermediateBytes + nested.intermediateBytes, runtimeClass: 'bounded-iteration' };
}

/** Compiles a model proposal into the normalized, integrity-bearing program. */
export class ToolFlowCompiler {
  private readonly validator: ToolFlowValidator;
  private readonly now: () => number;
  constructor(options: ToolFlowCompilerOptions = {}) { this.now = options.now ?? Date.now; this.validator = new ToolFlowValidator({ ...options, now: this.now }); }

  compile(input: ToolFlowInput | ToolFlowProgram): ToolFlowProgram {
    assertNoManagedSecret(input);
    if ((input as ToolFlowProgram).version === 1 && typeof (input as ToolFlowProgram).integrity === 'string') {
      this.validator.assertValid(input as ToolFlowProgram);
      return clone(input as ToolFlowProgram);
    }
    const source = input as ToolFlowInput;
    const creatorInput = source.creator ?? (source.creatorAgentRunId ? { kind: 'AgentRun' as const, id: source.creatorAgentRunId } : source.creatorWorkerRunId ? { kind: 'WorkerRun' as const, id: source.creatorWorkerRunId } : undefined);
    const creator = typeof creatorInput === 'string' ? { kind: 'AgentRun' as const, id: creatorInput } : creatorInput;
    if (!creator) throw new ToolFlowError('INVALID_PROGRAM', 'ToolFlow creator is required');
    const execution = source.execution ?? 'local';
    const allowedDataScopes = (source.allowedDataScopes?.length ? source.allowedDataScopes : [{ dataClasses: ['PUBLIC', 'USER_EXPLICIT'] as const }]).map(normalizeScope);
    const budget = normalizeBudget(source.budget);
    const expiry = source.expiry ?? new Date(this.now() + Math.min(budget.maxRuntimeMs, 15 * 60_000)).toISOString();
    const programWithoutIntegrity: Omit<ToolFlowProgram, 'integrity'> = {
      version: 1,
      id: source.id ?? randomId('toolflow'),
      creator: clone(creator),
      ...(source.creatorAgentRunId ? { creatorAgentRunId: source.creatorAgentRunId } : creator.kind === 'AgentRun' ? { creatorAgentRunId: creator.id } : {}),
      ...(source.creatorWorkerRunId ? { creatorWorkerRunId: source.creatorWorkerRunId } : creator.kind === 'WorkerRun' ? { creatorWorkerRunId: creator.id } : {}),
      execution,
      ...(source.defaultSkillId ? { defaultSkillId: source.defaultSkillId } : {}),
      allowedTools: unique(source.allowedTools ?? []),
      allowedCapabilities: unique(source.allowedCapabilities ?? []),
      allowedDataScopes,
      variables: (source.variables ?? []).map(variable => ({ ...variable, ...(variable.initial !== undefined ? { initial: clone(variable.initial) } : {}) })),
      steps: (source.steps ?? []).map(step => normalizeStep(step)),
      budget,
      expiry,
      revision: source.revision ?? 1,
    };
    const program = { ...programWithoutIntegrity, integrity: digestProgram(programWithoutIntegrity) } as ToolFlowProgram;
    this.validator.assertValid(program);
    return clone(program);
  }

  validate(program: ToolFlowProgram): ToolFlowValidationResult { return this.validator.validate(program); }
  estimate(program: ToolFlowProgram): ToolFlowCostEstimate { return this.validator.assertValid(program); }
}

interface RuntimeValue {
  readonly value: unknown;
  readonly dataClass: AIDataClass;
  readonly sourceRefs: readonly string[];
  readonly toolCalls: readonly ToolFlowToolCall[];
}
type Environment = Map<string, RuntimeValue>;
interface SequenceResult { readonly value?: RuntimeValue; readonly returned: boolean; }
interface FlowState {
  readonly executionId: string;
  readonly program: ToolFlowProgram;
  readonly controller: AbortController;
  readonly startedAt: number;
  readonly traceId: string;
  readonly traceEntries: ToolFlowTraceEntry[];
  readonly toolCalls: ToolFlowToolCall[];
  readonly failures: Array<{ stepId: string; code: string }>;
  steps: number;
  iterations: number;
  calls: number;
  retries: number;
  expansion: number;
  dataClass: AIDataClass;
  paused: boolean;
  pausePromise?: Promise<void>;
  resumePause?: () => void;
  onTrace?: (entry: ToolFlowTraceEntry) => void;
}

export interface ToolFlowExecutorOptions extends ToolFlowCompilerOptions {
  readonly registry: ToolRegistry;
  readonly skills: SkillRegistry;
  readonly toolExecutor?: ToolExecutor;
  readonly validator?: ToolFlowValidator;
}

/** Executes a validated flow with bounded, cooperative control flow. */
export class ToolFlowExecutor {
  private readonly registry: ToolRegistry;
  private readonly skills: SkillRegistry;
  private readonly toolExecutor: ToolExecutor;
  private readonly compiler: ToolFlowCompiler;
  private readonly validator: ToolFlowValidator;
  private readonly now: () => number;
  private readonly active = new Map<string, FlowState>();
  private readonly activeByFlow = new Map<string, string>();

  constructor(options: ToolFlowExecutorOptions);
  constructor(registry: ToolRegistry, skills: SkillRegistry, options?: Omit<ToolFlowExecutorOptions, 'registry' | 'skills'>);
  constructor(first: ToolFlowExecutorOptions | ToolRegistry, second?: SkillRegistry, third: Omit<ToolFlowExecutorOptions, 'registry' | 'skills'> = {}) {
    const options = first instanceof ToolRegistry ? { ...third, registry: first, skills: second! } as ToolFlowExecutorOptions : first;
    this.registry = options.registry;
    this.skills = options.skills;
    this.now = options.now ?? Date.now;
    this.validator = options.validator ?? new ToolFlowValidator({ registry: this.registry, skills: this.skills, now: this.now });
    this.compiler = new ToolFlowCompiler({ registry: this.registry, skills: this.skills, now: this.now });
    this.toolExecutor = options.toolExecutor ?? new ToolExecutor(this.registry, this.skills);
  }

  compile(input: ToolFlowInput | ToolFlowProgram): ToolFlowProgram { return this.compiler.compile(input); }
  validate(program: ToolFlowProgram): ToolFlowValidationResult { return this.validator.validate(program); }
  getTrace(executionId: string): ToolFlowTrace | undefined { const state = this.active.get(executionId); return state ? this.traceSnapshot(state) : undefined; }
  listActive(): readonly string[] { return [...this.active.keys()]; }

  start(programInput: ToolFlowProgram | ToolFlowInput, options: ToolFlowExecutionOptions = {}): ToolFlowExecutionHandle {
    assertNoManagedSecret(options.input);
    assertNoManagedSecret(options.variables);
    assertNoManagedSecret(options.initialVariables);
    const program = (programInput as ToolFlowProgram).version === 1 && typeof (programInput as ToolFlowProgram).integrity === 'string' ? clone(programInput as ToolFlowProgram) : this.compiler.compile(programInput as ToolFlowInput);
    this.validator.assertValid(program);
    const executionId = options.executionId ?? randomId('toolflow-run');
    if (!safeId(executionId) || this.active.has(executionId)) throw new ToolFlowError('DUPLICATE_EXECUTION', `ToolFlow execution ${executionId} already exists`);
    const controller = new AbortController();
    const state: FlowState = { executionId, program, controller, startedAt: this.now(), traceId: randomId('toolflow-trace'), traceEntries: [], toolCalls: [], failures: [], steps: 0, iterations: 0, calls: 0, retries: 0, expansion: 0, dataClass: 'PUBLIC', paused: false, onTrace: options.onTrace };
    if (options.signal) {
      if (options.signal.aborted) controller.abort(options.signal.reason);
      else options.signal.addEventListener('abort', () => controller.abort(options.signal?.reason), { once: true });
    }
    this.active.set(executionId, state);
    this.activeByFlow.set(program.id, executionId);
    const promise = this.executeState(state, options).finally(() => {
      this.active.delete(executionId);
      if (this.activeByFlow.get(program.id) === executionId) this.activeByFlow.delete(program.id);
    });
    return { executionId, promise, pause: () => this.pause(executionId), resume: () => this.resume(executionId), cancel: () => this.cancel(executionId) };
  }

  execute(program: ToolFlowProgram | ToolFlowInput, options: ToolFlowExecutionOptions = {}): Promise<ToolFlowResult> { return this.start(program, options).promise; }
  run(program: ToolFlowProgram | ToolFlowInput, options: ToolFlowExecutionOptions = {}): Promise<ToolFlowResult> { return this.execute(program, options); }

  pause(executionOrFlowId: string): boolean {
    const state = this.findState(executionOrFlowId); if (!state || state.controller.signal.aborted) return false;
    state.paused = true;
    return true;
  }
  resume(executionOrFlowId: string): boolean {
    const state = this.findState(executionOrFlowId); if (!state) return false;
    state.paused = false;
    state.resumePause?.(); state.resumePause = undefined; state.pausePromise = undefined;
    return true;
  }
  cancel(executionOrFlowId: string): boolean {
    const state = this.findState(executionOrFlowId); if (!state) return false;
    state.controller.abort('cancelled'); state.resumePause?.(); state.resumePause = undefined; state.pausePromise = undefined;
    return true;
  }

  private findState(executionOrFlowId: string): FlowState | undefined { return this.active.get(executionOrFlowId) ?? this.active.get(this.activeByFlow.get(executionOrFlowId) ?? ''); }

  private async executeState(state: FlowState, options: ToolFlowExecutionOptions): Promise<ToolFlowResult> {
    const env: Environment = new Map();
    let inputValue = this.runtimeValue(undefined, 'PUBLIC');
    let sequence: SequenceResult | undefined;
    let status: ToolFlowResultStatus = 'COMPLETED';
    let errorCodeValue: string | undefined;
    try {
      inputValue = this.runtimeValue(options.input, options.inputDataClass ?? (options.input === undefined ? 'PUBLIC' : 'USER_EXPLICIT'));
      if (!scopeAllows(state.program.allowedDataScopes, inputValue.dataClass)) throw new ToolFlowError('PRIVACY_VIOLATION', `Flow input ${inputValue.dataClass} is outside the declared scope`);
      env.set('input', inputValue); env.set('last', inputValue);
      for (const declaration of state.program.variables) if (declaration.initial !== undefined) {
        const initial = await this.resolveExpression(declaration.initial, env, state);
        const value = declaration.dataClass ? { ...initial, dataClass: maxClass(initial.dataClass, declaration.dataClass) } : initial;
        if (declaration.type && declaration.type !== 'unknown' && typeOfValue(value.value) !== declaration.type) throw new ToolFlowError('INVALID_PROGRAM', `Initial value for ${declaration.name} does not match its declared type`);
        if (!scopeAllows(state.program.allowedDataScopes, value.dataClass)) throw new ToolFlowError('PRIVACY_VIOLATION', `Flow variable ${declaration.name} is outside the declared scope`);
        env.set(normalizeRef(declaration.name), value);
      }
      const supplied = options.variables ?? options.initialVariables ?? {};
      for (const [name, value] of Object.entries(supplied)) {
        const declaration = state.program.variables.find(item => normalizeRef(item.name) === normalizeRef(name));
        let variable = this.variableValue(value);
        if (declaration?.dataClass) variable = { ...variable, dataClass: maxClass(variable.dataClass, declaration.dataClass) };
        if (declaration?.type && declaration.type !== 'unknown' && typeOfValue(variable.value) !== declaration.type) throw new ToolFlowError('INVALID_PROGRAM', `Supplied value for ${name} does not match its declared type`);
        if (!scopeAllows(state.program.allowedDataScopes, variable.dataClass)) throw new ToolFlowError('PRIVACY_VIOLATION', `Flow variable ${name} is outside the declared scope`);
        env.set(normalizeRef(name), variable);
      }
      sequence = await this.executeSequence(state.program.steps, env, state, 0);
      const output = sequence.value ?? env.get('last') ?? inputValue;
      state.dataClass = output.dataClass;
      status = state.failures.length ? 'PARTIAL' : 'COMPLETED';
      return this.makeResult(state, status, output);
    } catch (error) {
      errorCodeValue = errorCode(error);
      if (error instanceof ToolFlowError && error.code === 'CANCELLED') status = 'CANCELLED';
      else status = state.failures.length ? 'PARTIAL' : 'FAILED';
      const output = env.get('last');
      state.dataClass = output?.dataClass ?? state.dataClass;
      return this.makeResult(state, status, output, errorCodeValue);
    }
  }

  private async checkpoint(state: FlowState): Promise<void> {
    if (state.controller.signal.aborted) throw new ToolFlowError('CANCELLED', 'ToolFlow was cancelled');
    if (this.now() - state.startedAt > state.program.budget.maxRuntimeMs) throw new ToolFlowError('BUDGET_EXCEEDED', 'ToolFlow runtime budget exceeded');
    while (state.paused) {
      if (!state.pausePromise) state.pausePromise = new Promise<void>(resolve => { state.resumePause = resolve; });
      await state.pausePromise;
      if (state.controller.signal.aborted) throw new ToolFlowError('CANCELLED', 'ToolFlow was cancelled');
    }
  }

  private async executeSequence(steps: readonly ToolFlowStep[], env: Environment, state: FlowState, depth: number): Promise<SequenceResult> {
    if (depth > state.program.budget.maxNestingDepth) throw new ToolFlowError('RECURSION', 'ToolFlow nesting depth exceeded');
    let last = env.get('last');
    for (const step of steps) {
      await this.checkpoint(state);
      state.steps += 1;
      if (state.steps > state.program.budget.maxSteps) throw new ToolFlowError('BUDGET_EXCEEDED', 'ToolFlow step budget exceeded', step.id);
      const started = nowIso(this.now);
      this.trace(state, { stepId: step.id, op: step.op as ToolFlowOperation, status: 'started', startedAt: started });
      try {
        const result = await this.executeStep(step, env, state, depth);
        if (result.value) { last = result.value; env.set('last', result.value); if (step.as) { env.set(normalizeRef(step.as), result.value); this.checkIntermediate(env, state); } }
        this.trace(state, { stepId: step.id, op: step.op as ToolFlowOperation, status: result.value ? 'completed' : 'skipped', startedAt: started, completedAt: nowIso(this.now), ...(result.value ? { dataClass: result.value.dataClass, outputBytes: serialSize(result.value.value), sourceRefs: result.value.sourceRefs } : {}) });
        if (result.returned) return { value: result.value ?? last, returned: true };
      } catch (error) {
        this.trace(state, { stepId: step.id, op: step.op as ToolFlowOperation, status: 'failed', startedAt: started, completedAt: nowIso(this.now), errorCode: errorCode(error) });
        throw error instanceof ToolFlowError && error.stepId ? error : new ToolFlowError(error instanceof ToolFlowError ? error.code : 'FAILED', error instanceof Error ? error.message : String(error), step.id);
      }
    }
    return { value: last, returned: false };
  }

  private async executeStep(step: ToolFlowStep, env: Environment, state: FlowState, depth: number): Promise<SequenceResult> {
    const inputExpression = step.input ?? step.items;
    switch (step.op) {
      case 'CALL_TOOL': return { value: await this.callTool(step, env, state), returned: false };
      case 'MAP': return { value: await this.map(step, env, state, depth, false), returned: false };
      case 'FOREACH': return { value: await this.map(step, env, state, depth, true), returned: false };
      case 'FILTER': return { value: await this.filter(step, env, state, depth), returned: false };
      case 'SORT': return { value: await this.sort(step, env, state), returned: false };
      case 'LIMIT': return { value: await this.limit(step, env, state), returned: false };
      case 'SELECT': return { value: await this.select(step, env, state), returned: false };
      case 'TRANSFORM': return { value: await this.transform(step, env, state, depth), returned: false };
      case 'IF': {
        const condition = await this.resolveExpression(step.condition ?? step.predicate, env, state);
        const branch = condition.value ? step.then ?? [] : step.else ?? [];
        return this.executeSequence(branch, new Map(env), state, depth + 1);
      }
      case 'PARALLEL': return { value: await this.parallel(step, env, state, depth), returned: false };
      case 'JOIN': return { value: await this.join(step, env, state), returned: false };
      case 'ASSERT': {
        const condition = await this.resolveExpression(step.condition ?? step.predicate ?? step.value, env, state);
        if (!condition.value) throw new ToolFlowError('ASSERTION_FAILED', 'ToolFlow assertion failed', step.id);
        return { value: condition, returned: false };
      }
      case 'RETURN': return { value: await this.resolveExpression(step.value ?? inputExpression ?? { ref: 'last' }, env, state), returned: true };
      default: throw new ToolFlowError('UNKNOWN_OPERATION', `Unknown ToolFlow operation ${step.op}`, step.id);
    }
  }

  private async callTool(step: ToolFlowStep, env: Environment, state: FlowState): Promise<RuntimeValue> {
    const toolId = step.toolId!; const skillId = step.skillId ?? state.program.defaultSkillId!; const tool = this.registry.get(toolId);
    if (!tool) throw new ToolFlowError('UNKNOWN_TOOL', `Unknown tool ${toolId}`, step.id);
    const args = await this.resolveExpression(step.args ?? {}, env, state);
    const retry = step.retry; const maxAttempts = retry?.maxAttempts ?? 1;
    let lastError: string | undefined;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      await this.checkpoint(state);
      state.calls += 1;
      if (state.calls > state.program.budget.maxToolCalls) throw new ToolFlowError('BUDGET_EXCEEDED', 'ToolFlow tool-call budget exceeded', step.id);
      const intent: ToolIntent = this.registry.issueIntent({ toolId, skillId, arguments: args.value, requestedCapabilities: [...tool.capabilities], source: state.program.execution as ToolExecutionSource, viaOrchestrator: false });
      let result: ToolResult<unknown>;
      try { result = await this.toolExecutor.execute(intent, { signal: state.controller.signal }); }
      catch (error) {
        lastError = errorCode(error);
        this.recordCall(state, step, intent, undefined, false);
        if (attempt < maxAttempts && this.retryAllowed(retry, lastError, state)) { await this.backoff(retry?.backoffMs ?? 0, state); continue; }
        throw new ToolFlowError('TOOL_FAILED', lastError, step.id);
      }
      this.recordCall(state, step, intent, result, result.ok);
      if (result.ok) {
        if (!scopeAllows(state.program.allowedDataScopes, result.dataClass)) throw new ToolFlowError('PRIVACY_VIOLATION', `Tool ${toolId} returned ${result.dataClass} outside the flow scope`, step.id);
        const refs = extractSourceRefs(result.value);
        return { value: clone(result.value), dataClass: result.dataClass, sourceRefs: safeSourceRefs([...refs, `tool:${intent.intentId}`]), toolCalls: [{ stepId: step.id, toolId, skillId, intentId: intent.intentId, auditId: result.auditId, dataClass: result.dataClass, ok: result.ok }] };
      }
      lastError = result.errorCode ?? 'TOOL_FAILED';
      state.failures.push({ stepId: step.id, code: lastError });
      if (attempt < maxAttempts && this.retryAllowed(retry, lastError, state)) { await this.backoff(retry?.backoffMs ?? 0, state); continue; }
      if (step.continueOnError) return { value: clone(result), dataClass: result.dataClass, sourceRefs: [`tool:${intent.intentId}`], toolCalls: [{ stepId: step.id, toolId, skillId, intentId: intent.intentId, auditId: result.auditId, dataClass: result.dataClass, ok: false }] };
      throw new ToolFlowError('TOOL_FAILED', lastError, step.id);
    }
    throw new ToolFlowError('RETRY_LIMIT', lastError ?? 'ToolFlow retry limit exceeded', step.id);
  }

  private recordCall(state: FlowState, step: ToolFlowStep, intent: ToolIntent, result: ToolResult<unknown> | undefined, ok: boolean): void {
    if (result) state.toolCalls.push({ stepId: step.id, toolId: intent.toolId, skillId: intent.skillId, intentId: intent.intentId, auditId: result.auditId, dataClass: result.dataClass, ok });
    this.trace(state, { stepId: step.id, op: 'CALL_TOOL', status: ok ? 'completed' : 'failed', startedAt: nowIso(this.now), completedAt: nowIso(this.now), toolId: intent.toolId, intentId: intent.intentId, calls: state.calls, ...(result ? { dataClass: result.dataClass } : {}) });
  }

  private retryAllowed(retry: ToolFlowRetryPolicy | undefined, code: string, state: FlowState): boolean {
    if (!retry?.retryableCodes?.length || !retry.retryableCodes.includes(code)) return false;
    state.retries += 1;
    if (state.retries > state.program.budget.maxRetries) throw new ToolFlowError('RETRY_LIMIT', 'ToolFlow retry budget exceeded');
    return true;
  }
  private async backoff(ms: number, state: FlowState): Promise<void> { if (ms <= 0) return; await new Promise<void>((resolve, reject) => { const timer = setTimeout(resolve, ms); if (state.controller.signal.aborted) { clearTimeout(timer); reject(new ToolFlowError('CANCELLED', 'ToolFlow was cancelled')); } }); }

  private async resolveExpression(expression: ToolFlowExpression | undefined, env: Environment, state: FlowState): Promise<RuntimeValue> {
    await this.checkpoint(state);
    if (expression === undefined) return { value: undefined, dataClass: 'PUBLIC', sourceRefs: [], toolCalls: [] };
    if (expression === null || typeof expression !== 'object') return this.runtimeValue(expression, 'PUBLIC');
    if (Array.isArray(expression)) {
      const values = await Promise.all(expression.map(item => this.resolveExpression(item, env, state)));
      return this.combine(values, values.map(item => item.value));
    }
    const record = expression as Record<string, unknown>;
    if (typeof record.ref === 'string' || typeof record.var === 'string') {
      const name = normalizeRef(String(record.ref ?? record.var)); const value = env.get(name); if (!value) throw new ToolFlowError('INVALID_REFERENCE', `Unknown ToolFlow variable ${name}`); return value;
    }
    if (typeof record.path === 'string') {
      const base = record.from === undefined ? env.get('last') : await this.resolveExpression(record.from as ToolFlowExpression, env, state);
      if (!base) throw new ToolFlowError('INVALID_REFERENCE', 'Path has no source value');
      return { ...base, value: readPath(base.value, record.path) };
    }
    if ('literal' in record) {
      const dataClass = DATA_CLASSES.includes(record.dataClass as AIDataClass) ? record.dataClass as AIDataClass : 'PUBLIC';
      return { value: clone(record.literal), dataClass, sourceRefs: safeSourceRefs(record.sourceRefs as readonly string[] | undefined), toolCalls: [] };
    }
    const entries = await Promise.all(Object.entries(record).map(async ([key, value]) => [key, await this.resolveExpression(value as ToolFlowExpression, env, state)] as const));
    return this.combine(entries.map(([, value]) => value), Object.fromEntries(entries.map(([key, value]) => [key, value.value])));
  }

  private variableValue(value: ToolFlowExpression | ToolFlowVariableValue): RuntimeValue {
    if (value && typeof value === 'object' && 'value' in value && ('dataClass' in value || 'sourceRefs' in value)) {
      const candidate = value as ToolFlowVariableValue; return { value: clone(candidate.value), dataClass: candidate.dataClass ?? 'PUBLIC', sourceRefs: safeSourceRefs(candidate.sourceRefs), toolCalls: [] };
    }
    return { value: clone(value), dataClass: 'PUBLIC', sourceRefs: [], toolCalls: [] };
  }
  private runtimeValue(value: unknown, dataClass: AIDataClass, sourceRefs: readonly string[] = []): RuntimeValue { return { value: clone(value), dataClass, sourceRefs: safeSourceRefs(sourceRefs), toolCalls: [] }; }
  private combine(values: readonly RuntimeValue[], value: unknown): RuntimeValue { return { value: clone(value), dataClass: values.reduce<AIDataClass>((current, item) => maxClass(current, item.dataClass), 'PUBLIC'), sourceRefs: safeSourceRefs(values.flatMap(item => item.sourceRefs)), toolCalls: values.flatMap(item => item.toolCalls) }; }

  private async map(step: ToolFlowStep, env: Environment, state: FlowState, depth: number, forEach: boolean): Promise<RuntimeValue> {
    const source = await this.resolveExpression(step.input ?? step.items ?? { ref: 'last' }, env, state); if (!Array.isArray(source.value)) throw new ToolFlowError('INVALID_PROGRAM', `${step.op} requires an array`, step.id);
    const items = source.value.slice(0, state.program.budget.maxExpansion); if (source.value.length > state.program.budget.maxExpansion) throw new ToolFlowError('EXPANSION_LIMIT', `${step.op} input exceeds expansion budget`, step.id);
    const values = await this.mapItems(items, async (item, index) => {
      state.iterations += 1; if (state.iterations > state.program.budget.maxIterations) throw new ToolFlowError('EXPANSION_LIMIT', 'ToolFlow iteration budget exceeded', step.id);
      const child = new Map(env); child.set(normalizeRef(step.itemVar ?? 'item'), this.runtimeValue(item, source.dataClass, source.sourceRefs)); child.set(normalizeRef(step.indexVar ?? 'index'), this.runtimeValue(index, 'PUBLIC')); child.set('last', this.runtimeValue(item, source.dataClass, source.sourceRefs));
      const result = step.steps?.length ? await this.executeSequence(step.steps, child, state, depth + 1) : { value: child.get(normalizeRef(step.itemVar ?? 'item')), returned: false };
      return result.value ?? this.runtimeValue(undefined, source.dataClass, source.sourceRefs);
    }, false, state);
    state.expansion += values.length; if (state.expansion > state.program.budget.maxExpansion) throw new ToolFlowError('EXPANSION_LIMIT', 'ToolFlow expansion budget exceeded', step.id);
    return this.combine([source, ...values], values.map(value => value.value));
  }

  private async filter(step: ToolFlowStep, env: Environment, state: FlowState, depth: number): Promise<RuntimeValue> {
    const source = await this.resolveExpression(step.input ?? step.items ?? { ref: 'last' }, env, state); if (!Array.isArray(source.value)) throw new ToolFlowError('INVALID_PROGRAM', 'FILTER requires an array', step.id);
    const kept: RuntimeValue[] = [];
    for (let index = 0; index < source.value.length; index += 1) {
      state.iterations += 1; if (state.iterations > state.program.budget.maxIterations) throw new ToolFlowError('EXPANSION_LIMIT', 'ToolFlow iteration budget exceeded', step.id);
      const child = new Map(env); child.set(normalizeRef(step.itemVar ?? 'item'), this.runtimeValue(source.value[index], source.dataClass, source.sourceRefs)); child.set(normalizeRef(step.indexVar ?? 'index'), this.runtimeValue(index, 'PUBLIC')); child.set('last', this.runtimeValue(source.value[index], source.dataClass, source.sourceRefs));
      const predicate = step.predicate !== undefined ? await this.resolveExpression(step.predicate, child, state) : step.steps?.length ? (await this.executeSequence(step.steps, child, state, depth + 1)).value ?? this.runtimeValue(false, 'PUBLIC') : child.get(normalizeRef(step.itemVar ?? 'item'))!;
      if (predicate.value) kept.push(this.runtimeValue(source.value[index], maxClass(source.dataClass, predicate.dataClass), source.sourceRefs));
    }
    return this.combine([source, ...kept], kept.map(value => value.value));
  }

  private async sort(step: ToolFlowStep, env: Environment, state: FlowState): Promise<RuntimeValue> {
    const source = await this.resolveExpression(step.input ?? step.items ?? { ref: 'last' }, env, state); if (!Array.isArray(source.value)) throw new ToolFlowError('INVALID_PROGRAM', 'SORT requires an array', step.id);
    const keyed: Array<{ item: unknown; key: unknown; index: number }> = [];
    for (let index = 0; index < source.value.length; index += 1) {
      const child = new Map(env); child.set('item', this.runtimeValue(source.value[index], source.dataClass, source.sourceRefs)); child.set('index', this.runtimeValue(index, 'PUBLIC')); child.set('last', this.runtimeValue(source.value[index], source.dataClass, source.sourceRefs));
      const key = step.key === undefined ? source.value[index] : typeof step.key === 'string' ? readPath(source.value[index], step.key) : (await this.resolveExpression(step.key, child, state)).value;
      keyed.push({ item: source.value[index], key, index });
    }
    keyed.sort((left, right) => compareValues(left.key, right.key) * (step.direction === 'desc' ? -1 : 1) || left.index - right.index);
    return { value: keyed.map(entry => entry.item), dataClass: source.dataClass, sourceRefs: source.sourceRefs, toolCalls: source.toolCalls };
  }

  private async limit(step: ToolFlowStep, env: Environment, state: FlowState): Promise<RuntimeValue> {
    const source = await this.resolveExpression(step.input ?? step.items ?? { ref: 'last' }, env, state); if (!Array.isArray(source.value)) throw new ToolFlowError('INVALID_PROGRAM', 'LIMIT requires an array', step.id);
    const countValue = await this.resolveExpression(step.count ?? step.limit ?? step.value, env, state); const count = boundedInt(typeof countValue.value === 'number' ? countValue.value : undefined, 0, state.program.budget.maxExpansion, 0);
    return { value: source.value.slice(0, count), dataClass: maxClass(source.dataClass, countValue.dataClass), sourceRefs: source.sourceRefs, toolCalls: [...source.toolCalls, ...countValue.toolCalls] };
  }

  private async select(step: ToolFlowStep, env: Environment, state: FlowState): Promise<RuntimeValue> {
    const source = await this.resolveExpression(step.input ?? step.items ?? { ref: 'last' }, env, state);
    if (step.fields?.length) {
      const pick = (value: unknown): unknown => Object.fromEntries(step.fields!.filter(field => safePath(field)).map(field => [field, readPath(value, field)]));
      return { value: Array.isArray(source.value) ? source.value.map(pick) : pick(source.value), dataClass: source.dataClass, sourceRefs: source.sourceRefs, toolCalls: source.toolCalls };
    }
    if (step.path) {
      const wholeArrayPath = Array.isArray(source.value) && /^\d+(?:\.|$)/.test(step.path);
      return { ...source, value: wholeArrayPath ? readPath(source.value, step.path) : Array.isArray(source.value) ? source.value.map(item => readPath(item, step.path!)) : readPath(source.value, step.path) };
    }
    return source;
  }

  private async transform(step: ToolFlowStep, env: Environment, state: FlowState, depth: number): Promise<RuntimeValue> {
    if (step.expression !== undefined || step.value !== undefined) return this.resolveExpression(step.expression ?? step.value, env, state);
    if (step.steps?.length) { const child = await this.executeSequence(step.steps, new Map(env), state, depth + 1); return child.value ?? this.runtimeValue(undefined, 'PUBLIC'); }
    return this.resolveExpression(step.input ?? step.items ?? { ref: 'last' }, env, state);
  }

  private async parallel(step: ToolFlowStep, env: Environment, state: FlowState, depth: number): Promise<RuntimeValue> {
    const branches = step.branches ?? (step.steps ? step.steps.map(value => [value]) : []); if (!branches.length) throw new ToolFlowError('INVALID_PROGRAM', 'PARALLEL requires branches', step.id);
    if (branches.length > state.program.budget.maxParallelism) throw new ToolFlowError('PARALLEL_LIMIT', 'PARALLEL branch count exceeds budget', step.id);
    const outputs = await this.mapItems(branches, async branch => { const result = await this.executeSequence(branch, new Map(env), state, depth + 1); return result.value ?? this.runtimeValue(undefined, 'PUBLIC'); }, true, state);
    return this.combine(outputs, outputs.map(value => value.value));
  }

  private async join(step: ToolFlowStep, env: Environment, state: FlowState): Promise<RuntimeValue> {
    const source = await this.resolveExpression(step.input ?? step.items ?? { ref: 'last' }, env, state);
    if (!Array.isArray(source.value)) return source;
    const value = step.separator !== undefined ? source.value.map(item => typeof item === 'string' ? item : JSON.stringify(item)).join(step.separator) : source.value.flatMap(item => Array.isArray(item) ? item : [item]);
    return { value, dataClass: source.dataClass, sourceRefs: source.sourceRefs, toolCalls: source.toolCalls };
  }

  private async mapItems<T>(items: readonly T[], worker: (item: T, index: number) => Promise<RuntimeValue>, parallel: boolean, state: FlowState): Promise<RuntimeValue[]> {
    if (!parallel || items.length <= 1) { const result: RuntimeValue[] = []; for (let index = 0; index < items.length; index += 1) result.push(await worker(items[index]!, index)); return result; }
    const result = new Array<RuntimeValue>(items.length); let cursor = 0; const concurrency = Math.min(state.program.budget.maxParallelism, items.length);
    await Promise.all(Array.from({ length: concurrency }, async () => { for (;;) { const index = cursor++; if (index >= items.length) return; await this.checkpoint(state); result[index] = await worker(items[index]!, index); } }));
    return result;
  }

  private checkIntermediate(env: Environment, state: FlowState): void { const bytes = serialSize([...env.entries()].map(([name, value]) => ({ name, value: value.value }))); if (bytes > state.program.budget.maxIntermediateBytes) throw new ToolFlowError('INTERMEDIATE_LIMIT', 'ToolFlow intermediate data exceeds budget'); }
  private trace(state: FlowState, entry: ToolFlowTraceEntry): void { if (state.traceEntries.length >= state.program.budget.maxTraceEntries) throw new ToolFlowError('BUDGET_EXCEEDED', 'ToolFlow trace budget exceeded'); state.traceEntries.push(entry); try { state.onTrace?.(clone(entry)); } catch { /* observers cannot affect execution */ } }
  private traceSnapshot(state: FlowState): ToolFlowTrace { return { version: 1, id: state.traceId, flowId: state.program.id, executionId: state.executionId, entries: state.traceEntries.map(clone), startedAt: new Date(state.startedAt).toISOString(), steps: state.steps, toolCalls: state.calls, dataClass: state.dataClass }; }

  private makeResult(state: FlowState, status: ToolFlowResultStatus, output?: RuntimeValue, error?: string): ToolFlowResult {
    const trace = this.traceSnapshot(state); const finalValue = output?.value; const dataClass = output?.dataClass ?? state.dataClass; state.dataClass = dataClass;
    assertNoManagedSecret(finalValue);
    const artifact = output ? this.makeArtifact(state, output, trace) : undefined;
    return { version: 1, flowId: state.program.id, executionId: state.executionId, status, ...(finalValue === undefined ? {} : { value: clone(finalValue) }), dataClass, ...(artifact ? { artifact } : {}), artifacts: artifact ? [artifact] : [], trace: { ...trace, completedAt: nowIso(this.now) }, traceRef: trace.id, failures: state.failures.map(clone), ...(error ? { errorCode: error } : {}) };
  }
  private makeArtifact(state: FlowState, output: RuntimeValue, trace: ToolFlowTrace): ToolFlowArtifact {
    assertNoManagedSecret(output.value, 'ToolFlow artifact contains managed secret material');
    const citations: ToolFlowCitation[] = output.sourceRefs.filter(ref => !ref.startsWith('tool:')).slice(0, 128).map(id => ({ id, dataClass: output.dataClass }));
    const privacyScope: ToolFlowDataScope = { dataClasses: [output.dataClass], ...(citations.length ? { objectIds: citations.map(citation => citation.id) } : {}) };
    const payload = { version: 1 as const, id: `${state.executionId}:artifact`, flowId: state.program.id, executionId: state.executionId, result: output.value, sourceToolCalls: state.toolCalls, citations, provenance: { creator: state.program.creator, flowRevision: state.program.revision, execution: state.program.execution }, privacyScope, executionTraceRef: trace.id };
    return { ...payload, integrity: stableDigest(payload) };
  }
}

export function prepareToolFlowArtifactForExternal(artifact: ToolFlowArtifact): ToolFlowArtifact {
  if (artifact.privacyScope.dataClasses.some(isPrivate)) throw new ToolFlowError('PRIVACY_VIOLATION', 'Private ToolFlow artifacts cannot cross the external AI boundary');
  assertNoManagedSecret(artifact, 'ToolFlow artifact contains managed secret material');
  return clone(artifact);
}

function extractSourceRefs(value: unknown, output: string[] = [], depth = 0): string[] {
  if (depth > 4 || output.length >= 128 || value === null || typeof value !== 'object') return output;
  if (Array.isArray(value)) { for (const item of value.slice(0, 64)) extractSourceRefs(item, output, depth + 1); return output; }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if ((key === 'id' || key === 'objectId' || key === 'contentId' || key === 'sourceId' || key === 'fileId' || key === 'trackId' || key === 'videoId') && typeof child === 'string' && safeId(child, 512)) output.push(child);
    else if (typeof child === 'object') extractSourceRefs(child, output, depth + 1);
  }
  return unique(output, 128);
}
function readPath(value: unknown, path: string): unknown {
  if (!safePath(path)) return undefined;
  return path.split('.').reduce<unknown>((current, key) => current && typeof current === 'object' && !['__proto__', 'prototype', 'constructor'].includes(key) ? (current as Record<string, unknown>)[key] : undefined, value);
}
function safePath(path: string): boolean { return typeof path === 'string' && path.length > 0 && path.length <= 256 && /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/.test(path); }
function compareValues(left: unknown, right: unknown): number {
  if (left === right) return 0;
  if (left === undefined) return 1;
  if (right === undefined) return -1;
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  const l = typeof left === 'string' ? left : JSON.stringify(left);
  const r = typeof right === 'string' ? right : JSON.stringify(right);
  return String(l).localeCompare(String(r));
}
