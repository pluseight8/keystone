/**
 * Durable, local-first workboards for long-running Agent work.
 *
 * A TaskGraph describes one bounded execution.  A Workboard owns the
 * durable queue around many executions: claims are leases, updates are
 * revisioned, dependencies are a DAG, and NEEDS_USER is an explicit stop
 * boundary.  The module does not create a scheduler or a second permission
 * system; execution is delegated to the existing TaskGraph/ToolFlow/worker
 * adapters and optional AIResourceScheduler.
 */

import { canonicalJson, type CryptoProvider } from '../crypto.js';
import type { Envelope, EnvelopeSecurity, UnsignedEnvelope } from '../connectivity.js';
import type { KeystoneDeliveryInterface } from '../connectivity.js';
import type { AIDataClass, AIContextItem } from './privacy.js';
import type { ToolCapability } from './tools.js';
import type { ToolFlowProgram } from './toolflow.js';
import type { InferencePriority, AIResourceScheduler } from './resource-scheduler.js';
import type { TaskGraphExecutor, TaskGraphState } from './task-graphs.js';
import { MandatorySafetySurfaceRegistry } from '../security/safety-surfaces.js';
import { SafetyRuntime, SafetySurfaceGate } from '../security/content-safety.js';
import { SecretRedactionPolicy } from '../security/secrets.js';

export const WORKBOARD_VERSION = 1 as const;
export const WORKBOARD_ENVELOPE = 'ai.workboard.v1' as const;
const WORKBOARD_ACK_ENVELOPE = 'ai.workboard.ack.v1' as const;

export const WORK_ITEM_STATUSES = [
  'BACKLOG', 'TODO', 'READY', 'RUNNING', 'BLOCKED', 'NEEDS_USER',
  'PAUSED', 'REVIEW', 'DONE', 'FAILED', 'CANCELLED',
] as const;
export type WorkItemStatus = (typeof WORK_ITEM_STATUSES)[number];

export const WORKBOARD_KINDS = ['PERSONAL', 'SHARED_SPACE'] as const;
export type WorkboardKind = (typeof WORKBOARD_KINDS)[number];

export const WORKBOARD_ACTOR_KINDS = ['human', 'agent', 'worker'] as const;
export type WorkboardActorKind = (typeof WORKBOARD_ACTOR_KINDS)[number];

export type WorkItemPriority = number | 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT' | 'low' | 'normal' | 'high' | 'urgent';
export type WorkboardExecutionMode = 'local' | 'personal_trusted' | 'external';
export type WorkboardMemberRole = 'owner' | 'editor' | 'viewer' | 'agent';
export type WorkboardClaimState = 'active' | 'released' | 'completed' | 'stale' | 'cancelled';
export type WorkboardDataScope = {
  readonly dataClasses: readonly AIDataClass[];
  readonly sourceKinds?: readonly string[];
  readonly objectIds?: readonly string[];
};

export interface WorkboardActor {
  readonly kind: WorkboardActorKind;
  readonly id: string;
  /** Human identity which owns an Agent/Worker. */
  readonly ownerIdentityId?: string;
}

export interface WorkboardMember {
  readonly identityId: string;
  readonly role: WorkboardMemberRole;
  readonly agentId?: string;
  readonly permissions?: readonly string[];
  readonly joinedAt: string;
  readonly removedAt?: string;
}

export interface WorkboardPolicy {
  readonly maxActiveWorkItems: number;
  readonly maxAgents: number;
  readonly maxConcurrentClaims: number;
  readonly maxTaskGraphs: number;
  readonly maxRetries: number;
  readonly maxArtifactStorageBytes: number;
  readonly maxBackgroundInference: number;
  readonly claimLeaseMs: number;
  readonly staleAfterMs: number;
  readonly maxItems: number;
  readonly maxCommentsPerItem: number;
  readonly maxActivity: number;
  readonly maxInboxEntries: number;
  readonly allowRemoteAgents: boolean;
  readonly requireExplicitAgentGrant: boolean;
}

export interface Workboard {
  readonly version: 1;
  readonly id: string;
  readonly kind: WorkboardKind;
  readonly title: string;
  readonly description: string;
  readonly creator: WorkboardActor;
  readonly ownerIdentityId: string;
  readonly spaceId?: string;
  readonly members: readonly WorkboardMember[];
  readonly policy: WorkboardPolicy;
  readonly allowedCapabilities: readonly ToolCapability[];
  readonly allowedDataScopes: readonly WorkboardDataScope[];
  readonly execution: WorkboardExecutionMode;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly signature: string;
}

export interface WorkItemDependency {
  readonly version: 1;
  readonly id: string;
  readonly boardId: string;
  readonly workItemId: string;
  readonly dependsOnItemId: string;
  readonly required: boolean;
  readonly createdBy: WorkboardActor;
  readonly createdAt: string;
  readonly revision: number;
  readonly signature: string;
}

export interface WorkItemRetryPolicy {
  readonly maxAttempts: number;
  readonly backoffMs: number;
  readonly retryableCodes: readonly string[];
}

export interface WorkItemClaim {
  readonly version: 1;
  readonly id: string;
  readonly boardId: string;
  readonly workItemId: string;
  readonly actor: WorkboardActor;
  readonly executionKey: string;
  readonly issuedAt: string;
  readonly heartbeatAt: string;
  readonly expiresAt: string;
  readonly leaseVersion: number;
  readonly state: WorkboardClaimState;
  readonly signature: string;
}

export type WorkItemCommentKind = 'agent_note' | 'human_note' | 'progress_update' | 'blocked_reason' | 'artifact_attached' | 'status_transition';

export interface WorkItemComment {
  readonly version: 1;
  readonly id: string;
  readonly boardId: string;
  readonly workItemId: string;
  readonly author: WorkboardActor;
  readonly kind: WorkItemCommentKind;
  readonly text: string;
  readonly dataClass: AIDataClass;
  readonly sourceRefs: readonly string[];
  readonly createdAt: string;
  readonly provenance: { readonly actorKind: WorkboardActorKind; readonly actorId: string; readonly ownerIdentityId?: string };
  readonly signature: string;
}

export interface WorkItemArtifact {
  readonly version: 1;
  readonly id: string;
  readonly boardId: string;
  readonly workItemId: string;
  readonly producer: WorkboardActor;
  readonly kind: 'task_graph' | 'tool_flow' | 'worker_result' | 'file_reference' | 'object_reference' | 'text' | 'structured';
  readonly value?: unknown;
  readonly objectReferences: readonly string[];
  readonly sourceRefs: readonly string[];
  readonly dataClass: AIDataClass;
  readonly scope: WorkboardDataScope;
  readonly integrity: string;
  readonly sizeBytes: number;
  readonly createdAt: string;
  readonly signature: string;
}

export type WorkboardActivityKind =
  | 'board_created' | 'item_created' | 'item_updated' | 'status_transition'
  | 'dependency_added' | 'claim_started' | 'claim_heartbeat' | 'claim_renewed'
  | 'claim_released' | 'claim_stale' | 'claim_completed' | 'comment_added'
  | 'artifact_attached' | 'needs_user' | 'user_response' | 'retry' | 'conflict'
  | 'automation_triggered' | 'space_grant' | 'space_revoke';

export interface WorkboardActivity {
  readonly version: 1;
  readonly id: string;
  readonly boardId: string;
  readonly workItemId?: string;
  readonly actor: WorkboardActor;
  readonly kind: WorkboardActivityKind;
  readonly fromStatus?: WorkItemStatus;
  readonly toStatus?: WorkItemStatus;
  readonly reason?: string;
  readonly revision: number;
  readonly createdAt: string;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
  readonly signature: string;
}

export interface WorkboardUserRequest {
  readonly id: string;
  readonly boardId: string;
  readonly workItemId: string;
  readonly requestedBy: WorkboardActor;
  readonly reason: 'owner_decision' | 'confirmation' | 'missing_information' | 'capability';
  readonly prompt: string;
  readonly dataClass?: AIDataClass;
  readonly createdAt: string;
  readonly expiresAt?: string;
  readonly state: 'pending' | 'answered' | 'expired' | 'dismissed';
  readonly response?: string;
  readonly respondedAt?: string;
  readonly responseActor?: WorkboardActor;
}

export interface WorkboardInboxEntry extends WorkboardUserRequest { readonly notificationId: string; }

export interface WorkItem {
  readonly version: 1;
  readonly id: string;
  readonly boardId: string;
  readonly title: string;
  readonly objective: string;
  readonly creator: WorkboardActor;
  readonly assignee?: WorkboardActor;
  readonly priority: WorkItemPriority;
  readonly dependencies: readonly WorkItemDependency[];
  readonly capabilities: readonly ToolCapability[];
  readonly dataScopes: readonly WorkboardDataScope[];
  readonly dueAt?: string;
  /** Optional reference to the canonical CalendarEvent for scheduling UI. */
  readonly calendarEventId?: string;
  readonly retryPolicy: WorkItemRetryPolicy;
  readonly taskGraphId?: string;
  readonly toolFlow?: ToolFlowProgram;
  readonly spaceId?: string;
  readonly artifacts: readonly WorkItemArtifact[];
  readonly comments: readonly WorkItemComment[];
  readonly status: WorkItemStatus;
  readonly revision: number;
  readonly retryCount: number;
  readonly claimId?: string;
  readonly lastExecutionKey?: string;
  readonly activeExecutionKey?: string;
  readonly needsUser?: WorkboardUserRequest;
  readonly errorCode?: string;
  readonly errorMessage?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly signature: string;
}

export interface WorkboardSnapshot {
  readonly version: 1;
  readonly boards: readonly Workboard[];
  readonly items: readonly WorkItem[];
  readonly claims: readonly WorkItemClaim[];
  readonly dependencies: readonly WorkItemDependency[];
  readonly comments: readonly WorkItemComment[];
  readonly artifacts: readonly WorkItemArtifact[];
  readonly activity: readonly WorkboardActivity[];
  readonly inbox: readonly WorkboardInboxEntry[];
  readonly seenEvents: readonly string[];
}

export interface WorkboardStateStore {
  read(): Promise<unknown | undefined>;
  write(value: unknown): Promise<void>;
}

export class InMemoryWorkboardStateStore implements WorkboardStateStore {
  private value?: unknown;
  async read(): Promise<unknown | undefined> { return this.value === undefined ? undefined : structuredClone(this.value); }
  async write(value: unknown): Promise<void> { this.value = structuredClone(value); }
}

export interface WorkboardExecutionInput {
  readonly board: Workboard;
  readonly item: WorkItem;
  readonly claim: WorkItemClaim;
  readonly context: readonly AIContextItem[];
  readonly signal: AbortSignal;
}

export interface WorkboardExecutionResult {
  readonly status?: 'DONE' | 'REVIEW' | 'NEEDS_USER' | 'FAILED';
  readonly errorCode?: string;
  readonly errorMessage?: string;
  readonly artifacts?: readonly WorkboardArtifactInput[];
  readonly comment?: string;
  readonly needsUser?: { readonly reason: WorkboardUserRequest['reason']; readonly prompt: string; readonly expiresAt?: string };
}

export interface WorkboardArtifactInput {
  readonly id?: string;
  readonly kind?: WorkItemArtifact['kind'];
  readonly value?: unknown;
  readonly objectReferences?: readonly string[];
  readonly sourceRefs?: readonly string[];
  readonly dataClass?: AIDataClass;
  readonly scope?: WorkboardDataScope;
}

export interface WorkboardExecutionAdapters {
  readonly execute?: (input: WorkboardExecutionInput) => Promise<WorkboardExecutionResult>;
  readonly runTaskGraph?: (input: WorkboardExecutionInput & { readonly taskGraphId: string }) => Promise<WorkboardExecutionResult | TaskGraphState>;
  readonly runToolFlow?: (input: WorkboardExecutionInput & { readonly toolFlow: ToolFlowProgram }) => Promise<WorkboardExecutionResult>;
  readonly runWorker?: (input: WorkboardExecutionInput & { readonly actor: WorkboardActor }) => Promise<WorkboardExecutionResult>;
  readonly runAgent?: (input: WorkboardExecutionInput & { readonly actor: WorkboardActor }) => Promise<WorkboardExecutionResult>;
  readonly cancel?: (input: Pick<WorkboardExecutionInput, 'board' | 'item' | 'claim'>) => Promise<void>;
}

export interface WorkboardReplicationAdapter {
  publish(event: WorkboardEvent, recipients?: readonly string[]): Promise<void>;
  subscribe(listener: (event: WorkboardEvent) => void | Promise<unknown>): () => void;
}

export interface WorkboardSigner {
  readonly sign: (payload: string) => Promise<string> | string;
  readonly verify?: (payload: string, signature: string, actor: WorkboardActor) => Promise<boolean> | boolean;
}

export interface WorkboardEvent {
  readonly version: 1;
  readonly id: string;
  readonly boardId: string;
  readonly actor: WorkboardActor;
  readonly operation: 'board.upsert' | 'item.upsert' | 'claim.upsert' | 'dependency.add' | 'comment.add' | 'artifact.add' | 'activity.add' | 'inbox.upsert';
  readonly targetId: string;
  readonly revision: number;
  readonly payload: unknown;
  readonly createdAt: string;
  readonly signature: string;
}

export interface WorkboardServiceOptions {
  readonly identityId: string;
  readonly agentId?: string;
  readonly storage?: WorkboardStateStore;
  readonly now?: () => number;
  readonly policy?: Partial<WorkboardPolicy>;
  readonly signer?: WorkboardSigner;
  readonly replication?: WorkboardReplicationAdapter;
  readonly execution?: WorkboardExecutionAdapters;
  readonly scheduler?: AIResourceScheduler;
  readonly authorize?: (input: { readonly action: string; readonly actor: WorkboardActor; readonly board: Workboard; readonly item?: WorkItem }) => Promise<boolean> | boolean;
  readonly canUseSpace?: (input: { readonly action: string; readonly spaceId: string; readonly actor: WorkboardActor }) => Promise<boolean> | boolean;
  readonly onActivity?: (activity: WorkboardActivity) => void | Promise<void>;
  readonly onNeedsUser?: (entry: WorkboardInboxEntry) => void | Promise<void>;
  /** Mandatory recipient-local safety boundary for shared Workboards. */
  readonly protectedSurfaces?: MandatorySafetySurfaceRegistry;
}

export class WorkboardError extends Error {
  constructor(readonly code: WorkboardErrorCode, message: string) { super(message); this.name = 'WorkboardError'; }
}

export type WorkboardErrorCode =
  | 'INVALID_ARGUMENT' | 'BOARD_NOT_FOUND' | 'ITEM_NOT_FOUND' | 'CLAIM_NOT_FOUND'
  | 'BOARD_EXISTS' | 'ITEM_EXISTS' | 'REVISION_CONFLICT' | 'NOT_AUTHORIZED'
  | 'AGENT_NOT_GRANTED' | 'REMOTE_AGENT_DENIED' | 'SPACE_PERMISSION_DENIED'
  | 'INVALID_STATUS' | 'DEPENDENCY_NOT_FOUND' | 'DEPENDENCY_CYCLE'
  | 'DEPENDENCY_BLOCKED' | 'CLAIM_CONFLICT' | 'CLAIM_EXPIRED' | 'CLAIM_STALE'
  | 'DUPLICATE_EXECUTION' | 'BUDGET_EXCEEDED' | 'ARTIFACT_LIMIT'
  | 'ARTIFACT_SCOPE_DENIED' | 'NEEDS_USER' | 'EXECUTOR_UNAVAILABLE'
  | 'BACKGROUND_PAUSED' | 'WORK_ITEM_TERMINAL' | 'INVALID_EVENT' | 'INVALID_SIGNATURE'
  | 'REPLAY' | 'CONFLICT' | 'FAILED';

const DATA_CLASSES: readonly AIDataClass[] = ['PUBLIC', 'USER_EXPLICIT', 'PRIVATE', 'SECRET'];
const CAPABILITIES: readonly ToolCapability[] = ['READ_PRIVATE', 'WRITE_PRIVATE', 'NETWORK_SEND', 'DEVICE_ACTION', 'DESTRUCTIVE', 'SECURITY_SENSITIVE'];
const PRIORITIES: readonly InferencePriority[] = ['USER_INTERACTIVE', 'ACTIVE_AGENT', 'BROWSER', 'AGENT_SOCIAL', 'AUTOMATION', 'RECOMMENDATION', 'MEMORY_CONSOLIDATION', 'BACKGROUND'];
const DEFAULT_POLICY: WorkboardPolicy = { maxActiveWorkItems: 16, maxAgents: 8, maxConcurrentClaims: 4, maxTaskGraphs: 16, maxRetries: 3, maxArtifactStorageBytes: 64 * 1024 * 1024, maxBackgroundInference: 2, claimLeaseMs: 5 * 60_000, staleAfterMs: 10 * 60_000, maxItems: 512, maxCommentsPerItem: 256, maxActivity: 2_048, maxInboxEntries: 256, allowRemoteAgents: true, requireExplicitAgentGrant: true };

function clone<T>(value: T): T { try { return structuredClone(value); } catch { return value; } }
function stripUndefined<T>(value: T): T { if (Array.isArray(value)) return value.filter(item => item !== undefined).map(item => stripUndefined(item)) as T; if (value && typeof value === 'object') { const result: Record<string, unknown> = {}; for (const [key, item] of Object.entries(value as Record<string, unknown>)) if (item !== undefined) result[key] = stripUndefined(item); return result as T; } return value; }
function safeId(value: unknown, max = 256): value is string { return typeof value === 'string' && value.length > 0 && value.length <= max && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value); }
function safeIdentityId(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\u0000-\u001f\u007f]/.test(value); }
function safeText(value: unknown, max = 64_000): value is string { return typeof value === 'string' && value.trim().length > 0 && value.length <= max; }
function nowIso(now: () => number): string { return new Date(now()).toISOString(); }
function randomId(prefix: string): string { return `${prefix}-${crypto.randomUUID()}`; }
function boundedInt(value: number | undefined, min: number, max: number, fallback: number): number { return Number.isSafeInteger(value) ? Math.max(min, Math.min(max, value!)) : fallback; }
function unique<T>(values: readonly T[], max = 512): T[] { return [...new Set(values)].slice(0, max); }
function rank(value: AIDataClass): number { return DATA_CLASSES.indexOf(value); }
function maxDataClass(left: AIDataClass, right: AIDataClass): AIDataClass { return rank(left) >= rank(right) ? left : right; }
function isPrivate(value: AIDataClass): boolean { return value === 'PRIVATE' || value === 'SECRET'; }
function priorityValue(value: WorkItemPriority): number { if (typeof value === 'number') return Math.max(0, Math.min(100, value)); return ({ LOW: 20, low: 20, NORMAL: 40, normal: 40, HIGH: 70, high: 70, URGENT: 100, urgent: 100 } as Record<string, number>)[value] ?? 40; }
function scopeSubset(child: WorkboardDataScope, parent: readonly WorkboardDataScope[]): boolean { const subset = (values: readonly string[] | undefined, parents: readonly string[] | undefined) => !values?.length ? !parents?.length : !parents?.length || values.every(value => parents.includes(value)); return child.dataClasses.every(value => parent.some(scope => scope.dataClasses.includes(value) && subset(child.sourceKinds, scope.sourceKinds) && subset(child.objectIds, scope.objectIds))); }
function scopeAllows(scopes: readonly WorkboardDataScope[], dataClass: AIDataClass): boolean { return scopes.some(scope => scope.dataClasses.includes(dataClass)); }
function serialSize(value: unknown): number { try { return new TextEncoder().encode(JSON.stringify(value) ?? 'null').byteLength; } catch { return Number.MAX_SAFE_INTEGER; } }
function assertNoManagedSecret(value: unknown, message = 'Workboard cannot carry managed secret material'): void { if (SecretRedactionPolicy.containsManagedSecret(value)) throw new WorkboardError('NOT_AUTHORIZED', message); }
function digest(value: unknown): string { assertNoManagedSecret(value, 'Workboard integrity payload contains managed secret material'); const text = canonicalJson(value); let a = 2166136261; let b = 16777619; for (let i = 0; i < text.length; i += 1) { const code = text.charCodeAt(i); a = Math.imul(a ^ code, 16777619); b = Math.imul(b ^ (code + i), 2246822519); } return `workboard-${(a >>> 0).toString(16).padStart(8, '0')}${(b >>> 0).toString(16).padStart(8, '0')}`; }
function unsigned(value: { readonly signature: string }): Record<string, unknown> { const { signature: _signature, ...payload } = value as Record<string, unknown>; return payload; }
function actorKey(actor: WorkboardActor): string { return `${actor.kind}:${actor.id}`; }
function sameActor(left: WorkboardActor, right: WorkboardActor): boolean { return left.kind === right.kind && left.id === right.id && (left.ownerIdentityId ?? '') === (right.ownerIdentityId ?? ''); }
function validDate(value: string | undefined): boolean { return value === undefined || Number.isFinite(Date.parse(value)); }
function claimExpired(claim: WorkItemClaim, now: number, staleAfterMs: number): boolean { return claim.state === 'active' && (Date.parse(claim.expiresAt) <= now || now - Date.parse(claim.heartbeatAt) > staleAfterMs); }
function terminalStatus(status: WorkItemStatus): boolean { return status === 'DONE' || status === 'FAILED' || status === 'CANCELLED'; }

function normalizePolicy(value?: Partial<WorkboardPolicy>): WorkboardPolicy { const input = value ?? {}; return { maxActiveWorkItems: boundedInt(input.maxActiveWorkItems, 1, 10_000, DEFAULT_POLICY.maxActiveWorkItems), maxAgents: boundedInt(input.maxAgents, 1, 256, DEFAULT_POLICY.maxAgents), maxConcurrentClaims: boundedInt(input.maxConcurrentClaims, 1, 256, DEFAULT_POLICY.maxConcurrentClaims), maxTaskGraphs: boundedInt(input.maxTaskGraphs, 0, 10_000, DEFAULT_POLICY.maxTaskGraphs), maxRetries: boundedInt(input.maxRetries, 0, 100, DEFAULT_POLICY.maxRetries), maxArtifactStorageBytes: boundedInt(input.maxArtifactStorageBytes, 1_024, 512 * 1024 * 1024, DEFAULT_POLICY.maxArtifactStorageBytes), maxBackgroundInference: boundedInt(input.maxBackgroundInference, 0, 256, DEFAULT_POLICY.maxBackgroundInference), claimLeaseMs: boundedInt(input.claimLeaseMs, 1_000, 24 * 60 * 60_000, DEFAULT_POLICY.claimLeaseMs), staleAfterMs: boundedInt(input.staleAfterMs, 1_000, 7 * 24 * 60 * 60_000, DEFAULT_POLICY.staleAfterMs), maxItems: boundedInt(input.maxItems, 1, 100_000, DEFAULT_POLICY.maxItems), maxCommentsPerItem: boundedInt(input.maxCommentsPerItem, 1, 10_000, DEFAULT_POLICY.maxCommentsPerItem), maxActivity: boundedInt(input.maxActivity, 1, 100_000, DEFAULT_POLICY.maxActivity), maxInboxEntries: boundedInt(input.maxInboxEntries, 1, 10_000, DEFAULT_POLICY.maxInboxEntries), allowRemoteAgents: input.allowRemoteAgents !== false, requireExplicitAgentGrant: input.requireExplicitAgentGrant !== false }; }
function normalizeScopes(value: readonly WorkboardDataScope[] | undefined, fallback: readonly WorkboardDataScope[] = [{ dataClasses: ['PUBLIC', 'USER_EXPLICIT'] }]): WorkboardDataScope[] { const scopes = value?.length ? value : fallback; return scopes.map(scope => { const dataClasses = unique(scope.dataClasses.filter(value => DATA_CLASSES.includes(value))); if (!dataClasses.length || dataClasses.length !== scope.dataClasses.length) throw new WorkboardError('INVALID_ARGUMENT', 'Invalid Workboard data scope'); const sourceKinds = unique((scope.sourceKinds ?? []).filter(value => safeId(value, 128))); const objectIds = unique((scope.objectIds ?? []).filter(value => safeId(value, 256))); if (sourceKinds.length !== (scope.sourceKinds ?? []).length || objectIds.length !== (scope.objectIds ?? []).length) throw new WorkboardError('INVALID_ARGUMENT', 'Invalid Workboard scope restriction'); return { dataClasses, ...(sourceKinds.length ? { sourceKinds } : {}), ...(objectIds.length ? { objectIds } : {}) }; }); }
function normalizeCapabilities(value: readonly ToolCapability[] | undefined): ToolCapability[] { const values = unique(value ?? []); if (values.some(capability => !CAPABILITIES.includes(capability))) throw new WorkboardError('INVALID_ARGUMENT', 'Unknown Workboard capability'); return values; }
function normalizePriority(value: WorkItemPriority | undefined): WorkItemPriority { if (value === undefined) return 'NORMAL'; if (typeof value === 'number') return boundedInt(value, 0, 100, 40); if (['LOW', 'NORMAL', 'HIGH', 'URGENT', 'low', 'normal', 'high', 'urgent'].includes(value)) return value; throw new WorkboardError('INVALID_ARGUMENT', 'Invalid WorkItem priority'); }
function normalizeRetry(value: Partial<WorkItemRetryPolicy> | undefined, policy: WorkboardPolicy): WorkItemRetryPolicy { const maxAttempts = boundedInt(value?.maxAttempts, 1, policy.maxRetries + 1, 1); const retryableCodes = unique((value?.retryableCodes ?? []).filter(value => safeId(value, 128))); return { maxAttempts, backoffMs: boundedInt(value?.backoffMs, 0, 60_000, 0), retryableCodes }; }

export class WorkboardService {
  private readonly identityId: string;
  private readonly defaultAgentId?: string;
  private readonly storage: WorkboardStateStore;
  private readonly now: () => number;
  private readonly defaultPolicy: WorkboardPolicy;
  private readonly signer?: WorkboardSigner;
  private readonly replication?: WorkboardReplicationAdapter;
  private readonly execution?: WorkboardExecutionAdapters;
  private readonly scheduler?: AIResourceScheduler;
  private readonly authorize?: WorkboardServiceOptions['authorize'];
  private readonly canUseSpace?: WorkboardServiceOptions['canUseSpace'];
  private readonly onActivity?: WorkboardServiceOptions['onActivity'];
  private readonly onNeedsUser?: WorkboardServiceOptions['onNeedsUser'];
  private readonly protectedSurfaces: MandatorySafetySurfaceRegistry;
  private readonly boards = new Map<string, Workboard>();
  private readonly items = new Map<string, WorkItem>();
  private readonly claims = new Map<string, WorkItemClaim>();
  private readonly dependencies = new Map<string, WorkItemDependency>();
  private readonly comments = new Map<string, WorkItemComment>();
  private readonly artifacts = new Map<string, WorkItemArtifact>();
  private readonly activities: WorkboardActivity[] = [];
  private readonly inbox = new Map<string, WorkboardInboxEntry>();
  private readonly seenEvents = new Set<string>();
  private readonly pendingEvents: WorkboardEvent[] = [];
  private readonly activeExecutions = new Map<string, { controller: AbortController; claim: WorkItemClaim; promise: Promise<WorkboardExecutionResult> }>();
  private writes: Promise<void> = Promise.resolve();
  private readyPromise: Promise<void>;
  private unsubscribeReplication?: () => void;
  private closed = false;

  constructor(options: WorkboardServiceOptions) {
    if (!safeIdentityId(options.identityId)) throw new WorkboardError('INVALID_ARGUMENT', 'Workboard identity is invalid');
    this.identityId = options.identityId; this.defaultAgentId = options.agentId; this.storage = options.storage ?? new InMemoryWorkboardStateStore(); this.now = options.now ?? Date.now; this.defaultPolicy = normalizePolicy(options.policy); this.signer = options.signer; this.replication = options.replication; this.execution = options.execution; this.scheduler = options.scheduler; this.authorize = options.authorize; this.canUseSpace = options.canUseSpace; this.onActivity = options.onActivity; this.onNeedsUser = options.onNeedsUser; this.protectedSurfaces = options.protectedSurfaces ?? new MandatorySafetySurfaceRegistry(new SafetySurfaceGate(new SafetyRuntime())); this.readyPromise = this.hydrate();
    if (this.replication) this.unsubscribeReplication = this.replication.subscribe(event => { if (this.seenEvents.has(event.id)) return; return this.applyEvent(event); });
  }

  async ready(): Promise<void> { await this.readyPromise; }
  close(): void { this.closed = true; this.unsubscribeReplication?.(); this.unsubscribeReplication = undefined; for (const value of this.activeExecutions.values()) value.controller.abort(); }
  get localIdentityId(): string { return this.identityId; }
  get localActor(): WorkboardActor { return this.defaultAgentId ? { kind: 'agent', id: this.defaultAgentId, ownerIdentityId: this.identityId } : { kind: 'human', id: this.identityId }; }
  async listBoards(): Promise<readonly Workboard[]> { await this.ready(); const result: Workboard[] = []; for (const board of this.boards.values()) if (board.kind !== 'SHARED_SPACE' || await this.surfaceEligible(board.id, board)) result.push(clone(board)); return result; }
  async getBoard(boardId: string): Promise<Workboard | undefined> { await this.ready(); const board = this.boards.get(boardId); if (!board || board.kind === 'SHARED_SPACE' && !(await this.surfaceEligible(board.id, board))) return undefined; return clone(board); }
  async listItems(boardId: string, statuses?: readonly WorkItemStatus[]): Promise<readonly WorkItem[]> { await this.ready(); const board = this.requireBoard(boardId); const allowed = statuses ? new Set(statuses) : undefined; const values = [...this.items.values()].filter(item => item.boardId === boardId && (!allowed || allowed.has(item.status))); const safe = board.kind !== 'SHARED_SPACE' ? values : (await Promise.all(values.map(async item => await this.surfaceEligible(item.id, item) ? item : undefined))).filter((item): item is WorkItem => !!item); return safe.sort((a, b) => priorityValue(b.priority) - priorityValue(a.priority) || a.createdAt.localeCompare(b.createdAt)).map(item => this.hydrateItem(item)); }
  async getWorkItem(boardId: string, itemId: string): Promise<WorkItem | undefined> { await this.ready(); const board = this.boards.get(boardId); const item = this.items.get(itemId); if (!board || !item || item.boardId !== boardId) return undefined; if (board.kind === 'SHARED_SPACE' && !(await this.surfaceEligible(item.id, item))) return undefined; return this.hydrateItem(item); }
  async listClaims(boardId?: string): Promise<readonly WorkItemClaim[]> { await this.ready(); const safe: WorkItemClaim[] = []; for (const claim of this.claims.values()) { const board = this.boards.get(claim.boardId); if ((!boardId || claim.boardId === boardId) && (board?.kind !== 'SHARED_SPACE' || await this.surfaceEligible(claim.id, claim))) safe.push(clone(claim)); } return safe; }
  async listActivity(boardId: string, itemId?: string): Promise<readonly WorkboardActivity[]> { await this.ready(); const board = this.boards.get(boardId); const values = this.activities.filter(value => value.boardId === boardId && (!itemId || value.workItemId === itemId)); const safe = board?.kind !== 'SHARED_SPACE' ? values : (await Promise.all(values.map(async value => await this.surfaceEligible(value.id, value) ? value : undefined))).filter((value): value is WorkboardActivity => !!value); return safe.map(clone); }
  async listComments(boardId: string, itemId?: string): Promise<readonly WorkItemComment[]> { await this.ready(); const board = this.boards.get(boardId); const values = [...this.comments.values()].filter(value => value.boardId === boardId && (!itemId || value.workItemId === itemId)); const safe = board?.kind !== 'SHARED_SPACE' ? values : (await Promise.all(values.map(async value => await this.surfaceEligible(value.id, value) ? value : undefined))).filter((value): value is WorkItemComment => !!value); return safe.map(clone); }
  async listArtifacts(boardId: string, itemId?: string): Promise<readonly WorkItemArtifact[]> { await this.ready(); const board = this.boards.get(boardId); const values = [...this.artifacts.values()].filter(value => value.boardId === boardId && (!itemId || value.workItemId === itemId)); const safe = board?.kind !== 'SHARED_SPACE' ? values : (await Promise.all(values.map(async value => await this.surfaceEligible(value.id, value) ? value : undefined))).filter((value): value is WorkItemArtifact => !!value); return safe.map(clone); }
  async listOwnerInbox(includeAnswered = false): Promise<readonly WorkboardInboxEntry[]> { await this.ready(); const values = [...this.inbox.values()].filter(value => includeAnswered || value.state === 'pending'); const safe: WorkboardInboxEntry[] = []; for (const value of values) { const board = this.boards.get(value.boardId); if (board?.kind !== 'SHARED_SPACE' || await this.surfaceEligible(value.id, value)) safe.push(value); } return safe.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(clone); }
  async listNeedsUser(boardId?: string): Promise<readonly WorkboardInboxEntry[]> { const values = await this.listOwnerInbox(); return values.filter(value => !boardId || value.boardId === boardId); }
  async snapshot(): Promise<WorkboardSnapshot> {
    await this.ready();
    const source = this.makeSnapshot();
    const sharedBoards = new Set(source.boards.filter(value => value.kind === 'SHARED_SPACE').map(value => value.id));
    const boards = (await Promise.all(source.boards.map(async value => !sharedBoards.has(value.id) || await this.surfaceEligible(value.id, value) ? value : undefined))).filter((value): value is Workboard => !!value);
    const boardIds = new Set(boards.map(value => value.id));
    const filter = async <T extends { readonly id: string; readonly boardId: string }>(values: readonly T[]): Promise<readonly T[]> => { const filtered = await Promise.all(values.filter(value => boardIds.has(value.boardId)).map(async value => !sharedBoards.has(value.boardId) || await this.surfaceEligible(value.id, value) ? value : undefined)); return filtered.filter(value => value !== undefined) as T[]; };
    return { ...source, boards, items: await filter(source.items), claims: await filter(source.claims), dependencies: await filter(source.dependencies), comments: await filter(source.comments), artifacts: await filter(source.artifacts), activity: await filter(source.activity), inbox: await filter(source.inbox) };
  }

  // Short lifecycle aliases keep the Workboard boundary ergonomic for desktop,
  // mobile and automation adapters without introducing another state machine.
  async list(boardId: string, statuses?: readonly WorkItemStatus[]): Promise<readonly WorkItem[]> { return this.listItems(boardId, statuses); }
  async get(boardId: string, itemId: string): Promise<WorkItem | undefined> { return this.getWorkItem(boardId, itemId); }
  async createItem(boardId: string, input: Parameters<WorkboardService['createWorkItem']>[1], actor?: WorkboardActor): Promise<WorkItem> { return this.createWorkItem(boardId, input, actor); }
  async claim(boardId: string, itemId: string, options?: Parameters<WorkboardService['claimWorkItem']>[2]): Promise<WorkItemClaim> { return this.claimWorkItem(boardId, itemId, options); }
  async heartbeat(claimId: string, actor?: WorkboardActor): Promise<WorkItemClaim> { return this.heartbeatClaim(claimId, actor); }
  async renew(claimId: string, actor?: WorkboardActor, leaseMs?: number): Promise<WorkItemClaim> { return this.renewClaim(claimId, actor, leaseMs); }
  async release(claimId: string, actor?: WorkboardActor, state?: Extract<WorkboardClaimState, 'released' | 'completed' | 'cancelled'>): Promise<WorkItemClaim> { return this.releaseClaim(claimId, actor, state); }
  async run(boardId: string, itemId: string, options?: Parameters<WorkboardService['runWorkItem']>[2]): Promise<WorkItem> { return this.runWorkItem(boardId, itemId, options); }
  async pause(boardId: string, itemId: string, actor?: WorkboardActor): Promise<WorkItem> { return this.pauseWorkItem(boardId, itemId, actor); }
  async resume(boardId: string, itemId: string, actor?: WorkboardActor): Promise<WorkItem> { return this.resumeWorkItem(boardId, itemId, actor); }
  async cancel(boardId: string, itemId: string, actor?: WorkboardActor): Promise<WorkItem> { return this.cancelWorkItem(boardId, itemId, actor); }
  async retry(boardId: string, itemId: string, actor?: WorkboardActor): Promise<WorkItem> { return this.retryWorkItem(boardId, itemId, actor); }
  async ownerInbox(includeAnswered = false): Promise<readonly WorkboardInboxEntry[]> { return this.listOwnerInbox(includeAnswered); }

  async createWorkboard(input: { readonly id?: string; readonly kind?: WorkboardKind; readonly title: string; readonly description?: string; readonly spaceId?: string; readonly members?: readonly WorkboardMember[]; readonly policy?: Partial<WorkboardPolicy>; readonly allowedCapabilities?: readonly ToolCapability[]; readonly allowedDataScopes?: readonly WorkboardDataScope[]; readonly execution?: WorkboardExecutionMode }, actor: WorkboardActor = { kind: 'human', id: this.identityId }): Promise<Workboard> {
    await this.ready(); this.assertIdentity(actor); if (!safeText(input.title, 200)) throw new WorkboardError('INVALID_ARGUMENT', 'Workboard title is invalid'); const id = input.id ?? randomId('workboard'); if (!safeId(id) || this.boards.has(id)) throw new WorkboardError(this.boards.has(id) ? 'BOARD_EXISTS' : 'INVALID_ARGUMENT', 'Workboard id is invalid or already exists'); const kind = input.kind ?? (input.spaceId ? 'SHARED_SPACE' : 'PERSONAL'); if (!WORKBOARD_KINDS.includes(kind)) throw new WorkboardError('INVALID_ARGUMENT', 'Workboard kind is invalid'); if (kind === 'SHARED_SPACE' && (!safeId(input.spaceId) || !input.spaceId)) throw new WorkboardError('INVALID_ARGUMENT', 'Shared Workboard requires a Space reference'); const createdAt = nowIso(this.now); const policy = normalizePolicy({ ...this.defaultPolicy, ...input.policy }); const defaultMembers: WorkboardMember[] = [{ identityId: this.identityId, role: 'owner', joinedAt: createdAt }]; if (this.defaultAgentId && kind === 'PERSONAL') defaultMembers.push({ identityId: this.identityId, agentId: this.defaultAgentId, role: 'agent', joinedAt: createdAt }); const members = this.normalizeMembers([...defaultMembers, ...(input.members ?? [])]); const allowedDataScopes = normalizeScopes(input.allowedDataScopes); const allowedCapabilities = normalizeCapabilities(input.allowedCapabilities); if (input.execution === 'external' && allowedDataScopes.some(scope => scope.dataClasses.some(isPrivate))) throw new WorkboardError('NOT_AUTHORIZED', 'External Workboard cannot declare private scope'); const unsignedBoard = { version: 1 as const, id, kind, title: input.title.trim(), description: input.description?.trim().slice(0, 4_000) ?? '', creator: clone(actor), ownerIdentityId: this.identityId, ...(input.spaceId ? { spaceId: input.spaceId } : {}), members, policy, allowedCapabilities, allowedDataScopes, execution: input.execution ?? 'local', revision: 1, createdAt, updatedAt: createdAt }; const board = await this.withSignature(unsignedBoard); if (kind === 'SHARED_SPACE' && !(await this.surfaceEligible(board.id, board))) throw new WorkboardError('NOT_AUTHORIZED', 'Shared Workboard failed mandatory safety gating'); this.boards.set(id, board); await this.emitActivity(board, undefined, actor, 'board_created', undefined, undefined, undefined, 1); await this.publish('board.upsert', board.id, board.revision, board, actor, board.id); return clone(board); }

  async create(input: Parameters<WorkboardService['createWorkboard']>[0], actor?: WorkboardActor): Promise<Workboard> { return this.createWorkboard(input, actor); }

  async addMember(boardId: string, member: WorkboardMember, actor: WorkboardActor = this.localActor): Promise<Workboard> { const board = await this.authorizeBoard(boardId, actor, 'manage_members'); if (!safeIdentityId(member.identityId) || !['owner', 'editor', 'viewer', 'agent'].includes(member.role) || (member.agentId !== undefined && !safeId(member.agentId))) throw new WorkboardError('INVALID_ARGUMENT', 'Invalid Workboard member'); if (member.role === 'agent' && !member.agentId) throw new WorkboardError('AGENT_NOT_GRANTED', 'Agent member requires an explicit agent id'); const existingAgentIds = new Set(board.members.filter(value => !value.removedAt && value.agentId).map(value => value.agentId!)); if (member.agentId && !existingAgentIds.has(member.agentId) && existingAgentIds.size >= board.policy.maxAgents) throw new WorkboardError('BUDGET_EXCEEDED', 'Workboard agent budget exceeded'); const next = this.normalizeMembers([...board.members.filter(value => !(value.identityId === member.identityId && value.agentId === member.agentId)), { ...member, joinedAt: member.joinedAt || nowIso(this.now) }]); const updated = await this.updateBoard(board, { members: next }, actor); await this.emitActivity(updated, undefined, actor, 'space_grant', undefined, undefined, undefined, updated.revision); return updated; }
  async removeMember(boardId: string, identityId: string, agentId?: string, actor: WorkboardActor = this.localActor): Promise<Workboard> { const board = await this.authorizeBoard(boardId, actor, 'manage_members'); if (identityId === board.ownerIdentityId && !agentId) throw new WorkboardError('NOT_AUTHORIZED', 'Workboard owner cannot be removed'); const next = board.members.map(member => member.identityId === identityId && member.agentId === agentId ? { ...member, removedAt: nowIso(this.now) } : member); const updated = await this.updateBoard(board, { members: next }, actor); await this.emitActivity(updated, undefined, actor, 'space_revoke', undefined, undefined, undefined, updated.revision); return updated; }

  async createWorkItem(boardId: string, input: { readonly id?: string; readonly title: string; readonly objective: string; readonly creator?: WorkboardActor; readonly assignee?: WorkboardActor; readonly priority?: WorkItemPriority; readonly capabilities?: readonly ToolCapability[]; readonly dataScopes?: readonly WorkboardDataScope[]; readonly dueAt?: string; readonly calendarEventId?: string; readonly retryPolicy?: Partial<WorkItemRetryPolicy>; readonly taskGraphId?: string; readonly toolFlow?: ToolFlowProgram; readonly spaceId?: string; readonly status?: WorkItemStatus; readonly context?: readonly AIContextItem[] }, actor: WorkboardActor = this.localActor): Promise<WorkItem> {
    const board = await this.authorizeBoard(boardId, actor, 'item.write'); if (!safeText(input.title, 256) || !safeText(input.objective, 64_000)) throw new WorkboardError('INVALID_ARGUMENT', 'WorkItem title or objective is invalid'); if (input.status !== undefined && !WORK_ITEM_STATUSES.includes(input.status)) throw new WorkboardError('INVALID_STATUS', 'Unknown WorkItem status'); if (input.calendarEventId !== undefined && !safeId(input.calendarEventId, 512)) throw new WorkboardError('INVALID_ARGUMENT', 'Calendar event reference is invalid'); if (input.dueAt !== undefined && !validDate(input.dueAt)) throw new WorkboardError('INVALID_ARGUMENT', 'WorkItem due date is invalid'); if (this.itemsFor(boardId).length >= board.policy.maxItems) throw new WorkboardError('BUDGET_EXCEEDED', 'Workboard item budget exceeded'); const id = input.id ?? randomId('work-item'); if (!safeId(id) || this.items.has(id)) throw new WorkboardError(this.items.has(id) ? 'ITEM_EXISTS' : 'INVALID_ARGUMENT', 'WorkItem id is invalid or already exists'); const creator = input.creator ?? actor; this.assertIdentityOrBoardActor(board, creator); if (input.assignee) this.assertAssignment(board, input.assignee); const capabilities = normalizeCapabilities(input.capabilities); if (!capabilities.every(value => board.allowedCapabilities.includes(value))) throw new WorkboardError('NOT_AUTHORIZED', 'WorkItem capability grant exceeds Workboard policy'); const dataScopes = normalizeScopes(input.dataScopes, board.allowedDataScopes); if (!dataScopes.every(scope => scopeSubset(scope, board.allowedDataScopes))) throw new WorkboardError('NOT_AUTHORIZED', 'WorkItem data scope exceeds board policy'); if (input.toolFlow && input.toolFlow.execution === 'external') throw new WorkboardError('NOT_AUTHORIZED', 'External ToolFlow execution is not allowed on a Workboard'); if (input.taskGraphId && this.itemsFor(boardId).filter(value => value.taskGraphId).length >= board.policy.maxTaskGraphs) throw new WorkboardError('BUDGET_EXCEEDED', 'Workboard TaskGraph budget exceeded'); const createdAt = nowIso(this.now); const unsignedItem = { version: 1 as const, id, boardId, title: input.title.trim(), objective: input.objective.trim(), creator: clone(creator), ...(input.assignee ? { assignee: clone(input.assignee) } : {}), priority: normalizePriority(input.priority), dependencies: [] as readonly WorkItemDependency[], capabilities, dataScopes, ...(input.dueAt ? { dueAt: input.dueAt } : {}), ...(input.calendarEventId ? { calendarEventId: input.calendarEventId } : {}), retryPolicy: normalizeRetry(input.retryPolicy, board.policy), ...(input.taskGraphId ? { taskGraphId: input.taskGraphId } : {}), ...(input.toolFlow ? { toolFlow: clone(input.toolFlow) } : {}), ...(input.spaceId ?? board.spaceId ? { spaceId: input.spaceId ?? board.spaceId } : {}), artifacts: [], comments: [], status: input.status ?? 'TODO', revision: 1, retryCount: 0, createdAt, updatedAt: createdAt }; const item = await this.withSignature(unsignedItem); if (board.kind === 'SHARED_SPACE' && !(await this.surfaceEligible(item.id, item))) throw new WorkboardError('NOT_AUTHORIZED', 'Shared Workboard item failed mandatory safety gating'); this.items.set(id, item); await this.emitActivity(board, item, actor, 'item_created', undefined, item.status, undefined, item.revision); await this.publish('item.upsert', id, item.revision, item, actor, board.id); return this.hydrateItem(item); }

  async addDependency(boardId: string, itemId: string, dependsOnItemId: string, options: { readonly required?: boolean; readonly actor?: WorkboardActor } = {}): Promise<WorkItem> { const actor = options.actor ?? this.localActor; const board = await this.authorizeBoard(boardId, actor, 'item.write'); const item = this.requireItem(boardId, itemId); this.requireItem(boardId, dependsOnItemId); if (itemId === dependsOnItemId) throw new WorkboardError('DEPENDENCY_CYCLE', 'WorkItem cannot depend on itself'); const edge: WorkItemDependency = await this.makeSignedDependency({ version: 1, id: randomId('dependency'), boardId, workItemId: itemId, dependsOnItemId, required: options.required !== false, createdBy: actor, createdAt: nowIso(this.now), revision: item.revision + 1 }); const nextDependencies = [...item.dependencies.filter(value => value.dependsOnItemId !== dependsOnItemId), edge]; this.assertNoDependencyCycle(boardId, itemId, nextDependencies); const waiting = nextDependencies.some(value => value.required && this.items.get(value.dependsOnItemId)?.status !== 'DONE'); const nextStatus = waiting && ['TODO', 'READY'].includes(item.status) ? 'BLOCKED' : item.status; const updated = await this.updateItem(item, { dependencies: nextDependencies, ...(nextStatus !== item.status ? { status: nextStatus, errorCode: 'DEPENDENCY_BLOCKED', errorMessage: 'Required dependency is not complete' } : {}) }, actor); this.dependencies.set(edge.id, edge); await this.emitActivity(board, updated, actor, 'dependency_added', item.status, nextStatus, undefined, updated.revision); await this.publish('dependency.add', edge.id, edge.revision, edge, actor, boardId); return this.hydrateItem(updated); }

  async updateWorkItem(boardId: string, itemId: string, patch: Partial<Pick<WorkItem, 'title' | 'objective' | 'assignee' | 'priority' | 'capabilities' | 'dataScopes' | 'dueAt' | 'calendarEventId' | 'retryPolicy' | 'status' | 'taskGraphId' | 'toolFlow'>>, actor: WorkboardActor = this.localActor, expectedRevision?: number): Promise<WorkItem> { const board = await this.authorizeBoard(boardId, actor, 'item.write'); const item = this.requireItem(boardId, itemId); if (expectedRevision !== undefined && expectedRevision !== item.revision) throw new WorkboardError('REVISION_CONFLICT', 'WorkItem revision changed'); if (patch.calendarEventId !== undefined && !safeId(patch.calendarEventId, 512)) throw new WorkboardError('INVALID_ARGUMENT', 'Calendar event reference is invalid'); if (patch.dueAt !== undefined && !validDate(patch.dueAt)) throw new WorkboardError('INVALID_ARGUMENT', 'WorkItem due date is invalid'); if (patch.assignee) this.assertAssignment(board, patch.assignee); if (patch.status && patch.status !== item.status) return this.transitionWorkItem(boardId, itemId, patch.status, actor, undefined, expectedRevision); if (patch.capabilities && !normalizeCapabilities(patch.capabilities).every(value => board.allowedCapabilities.includes(value))) throw new WorkboardError('NOT_AUTHORIZED', 'WorkItem capability grant exceeds board policy'); if (patch.dataScopes && !normalizeScopes(patch.dataScopes).every(scope => scopeSubset(scope, board.allowedDataScopes))) throw new WorkboardError('NOT_AUTHORIZED', 'WorkItem scope exceeds board policy'); const updated = await this.updateItem(item, { ...patch, ...(patch.capabilities ? { capabilities: normalizeCapabilities(patch.capabilities) } : {}), ...(patch.dataScopes ? { dataScopes: normalizeScopes(patch.dataScopes) } : {}), ...(patch.priority !== undefined ? { priority: normalizePriority(patch.priority) } : {}) }, actor); await this.emitActivity(board, updated, actor, 'item_updated', item.status, updated.status, undefined, updated.revision); await this.publish('item.upsert', updated.id, updated.revision, updated, actor, boardId); return this.hydrateItem(updated); }

  async transitionWorkItem(boardId: string, itemId: string, status: WorkItemStatus, actor: WorkboardActor = this.localActor, reason?: string, expectedRevision?: number): Promise<WorkItem> { if (!WORK_ITEM_STATUSES.includes(status)) throw new WorkboardError('INVALID_STATUS', 'Unknown WorkItem status'); const board = await this.authorizeBoard(boardId, actor, 'item.write'); const item = this.requireItem(boardId, itemId); if (expectedRevision !== undefined && expectedRevision !== item.revision) throw new WorkboardError('REVISION_CONFLICT', 'WorkItem revision changed'); if (terminalStatus(item.status) && status !== 'READY' && status !== 'TODO') throw new WorkboardError('WORK_ITEM_TERMINAL', 'Terminal WorkItem requires explicit retry before continuing'); if (status === 'RUNNING' && !item.claimId) throw new WorkboardError('CLAIM_CONFLICT', 'RUNNING WorkItem must have an active claim'); if (['TODO', 'READY', 'RUNNING'].includes(status) && this.hasFailedDependency(item)) { const blocked = await this.updateItem(item, { status: 'BLOCKED', errorCode: 'DEPENDENCY_BLOCKED', errorMessage: 'Required dependency failed' }, actor); await this.emitActivity(board, blocked, actor, 'status_transition', item.status, 'BLOCKED', reason, blocked.revision); throw new WorkboardError('DEPENDENCY_BLOCKED', 'Required dependency failed'); } const updated = await this.updateItem(item, { status, ...(status !== 'NEEDS_USER' ? { needsUser: undefined } : {}), ...(status !== 'FAILED' ? { errorCode: undefined, errorMessage: undefined } : {}) }, actor); await this.emitActivity(board, updated, actor, 'status_transition', item.status, status, reason, updated.revision); await this.publish('item.upsert', updated.id, updated.revision, updated, actor, boardId); return this.hydrateItem(updated); }

  async claimWorkItem(boardId: string, itemId: string, options: { readonly actor?: WorkboardActor; readonly executionKey?: string; readonly leaseMs?: number; readonly expectedRevision?: number } = {}): Promise<WorkItemClaim> { const actor = options.actor ?? this.localActor; const board = await this.authorizeBoard(boardId, actor, 'item.claim'); const item = this.requireItem(boardId, itemId); await this.recoverStaleClaims(boardId); const current = this.requireItem(boardId, itemId); if (options.expectedRevision !== undefined && options.expectedRevision !== current.revision) throw new WorkboardError('REVISION_CONFLICT', 'WorkItem revision changed'); if (current.status === 'NEEDS_USER') throw new WorkboardError('NEEDS_USER', 'WorkItem is waiting for owner input'); if (terminalStatus(current.status) && current.lastExecutionKey !== options.executionKey) throw new WorkboardError('WORK_ITEM_TERMINAL', 'Terminal WorkItem must be retried explicitly'); if (this.hasFailedDependency(current)) { const blocked = await this.markBlocked(current, actor); await this.emitActivity(board, blocked, actor, 'status_transition', current.status, 'BLOCKED', 'Required dependency failed', blocked.revision); await this.publish('item.upsert', blocked.id, blocked.revision, blocked, actor, boardId); throw new WorkboardError('DEPENDENCY_BLOCKED', 'WorkItem is blocked by a failed dependency'); } if (current.dependencies.length && !this.dependenciesReady(current)) { const blocked = await this.updateItem(current, { status: 'BLOCKED', errorCode: 'DEPENDENCY_BLOCKED', errorMessage: 'Required dependency is not complete' }, actor); await this.emitActivity(board, blocked, actor, 'status_transition', current.status, 'BLOCKED', 'Waiting for required dependency', blocked.revision); await this.publish('item.upsert', blocked.id, blocked.revision, blocked, actor, boardId); throw new WorkboardError('DEPENDENCY_BLOCKED', 'WorkItem is waiting for a required dependency'); } const existing = current.claimId ? this.claims.get(current.claimId) : undefined; if (existing?.state === 'active') { if (sameActor(existing.actor, actor) && (!options.executionKey || options.executionKey === existing.executionKey)) return clone(existing); throw new WorkboardError('CLAIM_CONFLICT', 'WorkItem already has an active claim'); } const key = options.executionKey ?? randomId('execution'); if (current.activeExecutionKey === key || current.lastExecutionKey === key) throw new WorkboardError('DUPLICATE_EXECUTION', 'This execution key was already used'); const activeClaims = [...this.claims.values()].filter(value => value.boardId === boardId && value.state === 'active'); if (activeClaims.length >= board.policy.maxConcurrentClaims) throw new WorkboardError('BUDGET_EXCEEDED', 'Concurrent Workboard claim budget exceeded'); const activeItems = this.itemsFor(boardId).filter(value => ['RUNNING', 'NEEDS_USER', 'PAUSED'].includes(value.status)).length; if (activeItems >= board.policy.maxActiveWorkItems && current.status !== 'RUNNING') throw new WorkboardError('BUDGET_EXCEEDED', 'Active Workboard item budget exceeded'); const issuedAt = nowIso(this.now); const leaseMs = boundedInt(options.leaseMs, 1_000, 24 * 60 * 60_000, board.policy.claimLeaseMs); const claimId = `claim-${current.id}-${key.slice(0, 48)}`; const unsignedClaim = { version: 1 as const, id: claimId, boardId, workItemId: itemId, actor: clone(actor), executionKey: key, issuedAt, heartbeatAt: issuedAt, expiresAt: new Date(this.now() + leaseMs).toISOString(), leaseVersion: 1, state: 'active' as const }; const claim = await this.withSignature(unsignedClaim); this.claims.set(claim.id, claim); const updated = await this.updateItem(current, { claimId: claim.id, activeExecutionKey: key, status: 'RUNNING' }, actor); await this.emitActivity(board, updated, actor, 'claim_started', current.status, 'RUNNING', undefined, updated.revision, { claimId: claim.id, executionKey: key }); await this.publish('claim.upsert', claim.id, claim.leaseVersion, claim, actor, boardId); await this.publish('item.upsert', updated.id, updated.revision, updated, actor, boardId); return clone(claim); }

  async heartbeatClaim(claimId: string, actor: WorkboardActor = this.localActor): Promise<WorkItemClaim> { await this.ready(); const current = this.claims.get(claimId); if (!current) throw new WorkboardError('CLAIM_NOT_FOUND', 'Claim not found'); if (!sameActor(current.actor, actor)) throw new WorkboardError('NOT_AUTHORIZED', 'Only the claimant may heartbeat'); if (current.state !== 'active') throw new WorkboardError('CLAIM_STALE', 'Claim is not active'); if (claimExpired(current, this.now(), this.board(current.boardId).policy.staleAfterMs)) throw new WorkboardError('CLAIM_EXPIRED', 'Claim has expired'); const next = await this.updateClaim(current, { heartbeatAt: nowIso(this.now), leaseVersion: current.leaseVersion + 1 }); this.claims.set(claimId, next); await this.emitActivity(this.board(current.boardId), this.requireItem(current.boardId, current.workItemId), actor, 'claim_heartbeat', undefined, undefined, undefined, next.leaseVersion, { claimId }); await this.publish('claim.upsert', next.id, next.leaseVersion, next, actor, next.boardId); return clone(next); }

  async renewClaim(claimId: string, actor: WorkboardActor = this.localActor, leaseMs?: number): Promise<WorkItemClaim> { const current = this.requireClaim(claimId); if (!sameActor(current.actor, actor)) throw new WorkboardError('NOT_AUTHORIZED', 'Only the claimant may renew'); if (current.state !== 'active') throw new WorkboardError('CLAIM_STALE', 'Claim is not active'); if (claimExpired(current, this.now(), this.board(current.boardId).policy.staleAfterMs)) throw new WorkboardError('CLAIM_EXPIRED', 'Claim has expired'); const duration = boundedInt(leaseMs, 1_000, 24 * 60 * 60_000, this.board(current.boardId).policy.claimLeaseMs); const next = await this.updateClaim(current, { heartbeatAt: nowIso(this.now), expiresAt: new Date(this.now() + duration).toISOString(), leaseVersion: current.leaseVersion + 1 }); this.claims.set(claimId, next); await this.emitActivity(this.board(current.boardId), this.requireItem(current.boardId, current.workItemId), actor, 'claim_renewed', undefined, undefined, undefined, next.leaseVersion, { claimId }); await this.publish('claim.upsert', next.id, next.leaseVersion, next, actor, next.boardId); return clone(next); }

  async releaseClaim(claimId: string, actor: WorkboardActor = this.localActor, state: Extract<WorkboardClaimState, 'released' | 'completed' | 'cancelled'> = 'released'): Promise<WorkItemClaim> { const current = this.requireClaim(claimId); if (!sameActor(current.actor, actor) && !this.isOwner(current.boardId, actor)) throw new WorkboardError('NOT_AUTHORIZED', 'Only the claimant or owner may release'); if (current.state !== 'active') return clone(current); const next = await this.updateClaim(current, { state, heartbeatAt: nowIso(this.now), leaseVersion: current.leaseVersion + 1 }); this.claims.set(claimId, next); const item = this.requireItem(current.boardId, current.workItemId); const status = state === 'completed' ? 'DONE' : state === 'cancelled' ? 'CANCELLED' : item.status === 'NEEDS_USER' ? 'NEEDS_USER' : this.dependenciesReady(item) ? 'READY' : 'BLOCKED'; const updated = await this.updateItem(item, { claimId: undefined, activeExecutionKey: undefined, ...(state === 'completed' ? { lastExecutionKey: current.executionKey } : {}), status }, actor); await this.emitActivity(this.board(current.boardId), updated, actor, state === 'completed' ? 'claim_completed' : 'claim_released', item.status, status, undefined, updated.revision, { claimId }); await this.publish('claim.upsert', next.id, next.leaseVersion, next, actor, next.boardId); await this.publish('item.upsert', updated.id, updated.revision, updated, actor, next.boardId); if (state === 'completed') await this.unblockDependents(current.boardId, current.workItemId, actor); return clone(next); }

  async recoverStaleClaims(boardId?: string): Promise<readonly WorkItemClaim[]> { await this.ready(); const recovered: WorkItemClaim[] = []; for (const claim of [...this.claims.values()]) { if (claim.state !== 'active' || (boardId && claim.boardId !== boardId) || !claimExpired(claim, this.now(), this.board(claim.boardId).policy.staleAfterMs)) continue; const next = await this.updateClaim(claim, { state: 'stale', leaseVersion: claim.leaseVersion + 1 }); this.claims.set(claim.id, next); const item = this.requireItem(claim.boardId, claim.workItemId); const status = this.dependenciesReady(item) ? 'READY' : 'BLOCKED'; const updated = await this.updateItem(item, { claimId: undefined, activeExecutionKey: undefined, status, errorCode: 'CLAIM_STALE', errorMessage: 'Claim expired or heartbeat stopped' }, { kind: 'human', id: this.identityId }); await this.emitActivity(this.board(claim.boardId), updated, this.localActor, 'claim_stale', item.status, status, 'Claim expired or heartbeat stopped', updated.revision, { claimId: claim.id }); await this.publish('claim.upsert', next.id, next.leaseVersion, next, this.localActor, next.boardId); await this.publish('item.upsert', updated.id, updated.revision, updated, this.localActor, next.boardId); recovered.push(next); } await this.persist(); return recovered.map(clone); }

  async runWorkItem(boardId: string, itemId: string, options: { readonly actor?: WorkboardActor; readonly executionKey?: string; readonly context?: readonly AIContextItem[]; readonly signal?: AbortSignal; readonly foreground?: boolean } = {}): Promise<WorkItem> {
    const actor = options.actor ?? this.localActor; const board = await this.authorizeBoard(boardId, actor, 'item.run'); let item = this.requireItem(boardId, itemId); if (item.status === 'NEEDS_USER') throw new WorkboardError('NEEDS_USER', 'WorkItem is waiting for owner input'); if (this.scheduler && !options.foreground && (this.scheduler.currentMode === 'GAMING' || this.scheduler.currentMode === 'BATTERY' || this.scheduler.isBackgroundPaused)) { const paused = await this.transitionWorkItem(boardId, itemId, 'PAUSED', actor, 'Background Workboard execution paused by resource mode'); return paused; } const requestedContext = options.context ?? []; if (requestedContext.some(value => !this.contextAllowed(item.dataScopes, value))) throw new WorkboardError('NOT_AUTHORIZED', 'WorkItem context exceeds its declared data scope'); const executionKey = options.executionKey ?? randomId('execution'); const maxAttempts = Math.min(item.retryPolicy.maxAttempts, board.policy.maxRetries + 1); for (let attempt = 0; attempt < maxAttempts; attempt += 1) { const claim = await this.claimWorkItem(boardId, itemId, { actor, executionKey: attempt === 0 ? executionKey : `${executionKey}:retry:${attempt}` }); item = this.requireItem(boardId, itemId); const controller = new AbortController(); const abort = () => controller.abort(options.signal?.reason); if (options.signal) { if (options.signal.aborted) controller.abort(options.signal.reason); else options.signal.addEventListener('abort', abort, { once: true }); } const input: WorkboardExecutionInput = { board, item: this.hydrateItem(item), claim, context: requestedContext.map(clone), signal: controller.signal }; const runPromise = this.execute(input); this.activeExecutions.set(itemId, { controller, claim, promise: runPromise }); try { const result = await runPromise; this.activeExecutions.delete(itemId); if (result.needsUser || result.status === 'NEEDS_USER') { const request = await this.requestUserInput(boardId, itemId, { requestedBy: actor, reason: result.needsUser?.reason ?? 'owner_decision', prompt: result.needsUser?.prompt ?? result.errorMessage ?? 'Agent work requires owner input', expiresAt: result.needsUser?.expiresAt }); await this.releaseClaim(claim.id, actor, 'released'); return this.requireItem(boardId, itemId); } if (result.artifacts) for (const artifact of result.artifacts) await this.attachArtifact(boardId, itemId, artifact, actor); if (result.comment) await this.addComment(boardId, itemId, { kind: actor.kind === 'human' ? 'human_note' : 'progress_update', text: result.comment, author: actor }, actor); const finalStatus = result.status ?? 'DONE'; if (finalStatus === 'FAILED') throw new WorkboardError('FAILED', result.errorMessage ?? result.errorCode ?? 'WorkItem execution failed'); await this.releaseClaim(claim.id, actor, finalStatus === 'DONE' ? 'completed' : 'released'); if (finalStatus !== 'DONE') await this.transitionWorkItem(boardId, itemId, finalStatus, actor); return this.requireItem(boardId, itemId); } catch (error) { this.activeExecutions.delete(itemId); if (options.signal?.aborted || (error instanceof WorkboardError && error.code === 'BACKGROUND_PAUSED')) { await this.releaseClaim(claim.id, actor, 'released').catch(() => undefined); throw error; } const code = error instanceof WorkboardError ? error.code : 'FAILED'; const message = error instanceof Error ? error.message : String(error); const current = this.requireItem(boardId, itemId); await this.releaseClaim(claim.id, actor, 'released').catch(() => undefined); const shouldRetry = attempt + 1 < maxAttempts && (item.retryPolicy.retryableCodes.length === 0 || item.retryPolicy.retryableCodes.includes(code)); if (shouldRetry) { await this.updateItem(this.requireItem(boardId, itemId), { retryCount: current.retryCount + 1, status: 'READY', errorCode: code, errorMessage: message.slice(0, 512) }, actor); await this.emitActivity(board, this.requireItem(boardId, itemId), actor, 'retry', 'FAILED', 'READY', message.slice(0, 256), this.requireItem(boardId, itemId).revision); continue; } const failed = await this.updateItem(this.requireItem(boardId, itemId), { status: 'FAILED', errorCode: code, errorMessage: message.slice(0, 512) }, actor); await this.emitActivity(board, failed, actor, 'status_transition', 'RUNNING', 'FAILED', message.slice(0, 256), failed.revision); await this.publish('item.upsert', failed.id, failed.revision, failed, actor, boardId); return this.hydrateItem(failed); } finally { if (options.signal) options.signal.removeEventListener('abort', abort); } }
    return this.hydrateItem(item); }

  async pauseWorkItem(boardId: string, itemId: string, actor: WorkboardActor = this.localActor): Promise<WorkItem> { const board = await this.authorizeBoard(boardId, actor, 'item.pause'); const item = this.requireItem(boardId, itemId); const active = this.activeExecutions.get(itemId); if (active) { active.controller.abort('paused'); await this.execution?.cancel?.({ board, item, claim: active.claim }).catch(() => undefined); } if (item.claimId) await this.releaseClaim(item.claimId, actor, 'released').catch(() => undefined); return this.transitionWorkItem(boardId, itemId, 'PAUSED', actor, 'Paused by user'); }
  async resumeWorkItem(boardId: string, itemId: string, actor: WorkboardActor = this.localActor): Promise<WorkItem> { await this.authorizeBoard(boardId, actor, 'item.resume'); const item = this.requireItem(boardId, itemId); if (item.status !== 'PAUSED') return this.hydrateItem(item); return this.transitionWorkItem(boardId, itemId, 'READY', actor, 'Resumed'); }
  async cancelWorkItem(boardId: string, itemId: string, actor: WorkboardActor = this.localActor): Promise<WorkItem> { const board = await this.authorizeBoard(boardId, actor, 'item.cancel'); const item = this.requireItem(boardId, itemId); const active = this.activeExecutions.get(itemId); if (active) { active.controller.abort('cancelled'); await this.execution?.cancel?.({ board, item, claim: active.claim }).catch(() => undefined); } if (item.claimId) await this.releaseClaim(item.claimId, actor, 'cancelled').catch(() => undefined); return this.transitionWorkItem(boardId, itemId, 'CANCELLED', actor, 'Cancelled by user'); }
  async retryWorkItem(boardId: string, itemId: string, actor: WorkboardActor = this.localActor): Promise<WorkItem> { const board = await this.authorizeBoard(boardId, actor, 'item.retry'); const item = this.requireItem(boardId, itemId); if (!['FAILED', 'CANCELLED', 'BLOCKED'].includes(item.status)) throw new WorkboardError('INVALID_STATUS', 'Only failed, cancelled or blocked items can be retried'); const updated = await this.updateItem(item, { status: this.dependenciesReady(item) ? 'READY' : 'BLOCKED', errorCode: undefined, errorMessage: undefined, claimId: undefined, activeExecutionKey: undefined }, actor); await this.emitActivity(board, updated, actor, 'retry', item.status, updated.status, undefined, updated.revision); await this.publish('item.upsert', updated.id, updated.revision, updated, actor, boardId); return this.hydrateItem(updated); }

  async addComment(boardId: string, itemId: string, input: { readonly author?: WorkboardActor; readonly kind?: WorkItemCommentKind; readonly text: string; readonly dataClass?: AIDataClass; readonly sourceRefs?: readonly string[] }, actor: WorkboardActor = this.localActor): Promise<WorkItemComment> { const board = await this.authorizeBoard(boardId, actor, 'comment.write'); const item = this.requireItem(boardId, itemId); if (!safeText(input.text, 64_000)) throw new WorkboardError('INVALID_ARGUMENT', 'Comment is invalid'); const author = input.author ?? actor; this.assertIdentityOrBoardActor(board, author); const dataClass = input.dataClass ?? 'PUBLIC'; if (!DATA_CLASSES.includes(dataClass) || !scopeAllows(item.dataScopes, dataClass)) throw new WorkboardError('ARTIFACT_SCOPE_DENIED', 'Comment data class is outside WorkItem scope'); if (item.comments.length >= board.policy.maxCommentsPerItem) throw new WorkboardError('BUDGET_EXCEEDED', 'WorkItem comment budget exceeded'); const unsignedComment = { version: 1 as const, id: randomId('work-comment'), boardId, workItemId: itemId, author: clone(author), kind: input.kind ?? (author.kind === 'human' ? 'human_note' : 'agent_note'), text: input.text.trim(), dataClass, sourceRefs: unique((input.sourceRefs ?? []).filter(value => safeId(value))), createdAt: nowIso(this.now), provenance: { actorKind: author.kind, actorId: author.id, ...(author.ownerIdentityId ? { ownerIdentityId: author.ownerIdentityId } : {}) } }; const comment = await this.withSignature(unsignedComment); this.comments.set(comment.id, comment); const updated = await this.updateItem(item, { comments: [...item.comments, comment] }, actor); await this.emitActivity(board, updated, author, 'comment_added', undefined, undefined, undefined, updated.revision, { commentId: comment.id }); await this.publish('comment.add', comment.id, updated.revision, comment, author, boardId); return clone(comment); }

  async attachArtifact(boardId: string, itemId: string, input: WorkboardArtifactInput, actor: WorkboardActor = this.localActor): Promise<WorkItemArtifact> { const board = await this.authorizeBoard(boardId, actor, 'artifact.attach'); const item = this.requireItem(boardId, itemId); const producer = actor; const dataClass = input.dataClass ?? 'PUBLIC'; if (!DATA_CLASSES.includes(dataClass) || !scopeAllows(item.dataScopes, dataClass)) throw new WorkboardError('ARTIFACT_SCOPE_DENIED', 'Artifact data class is outside WorkItem scope'); const scope = normalizeScopes(input.scope ? [input.scope] : undefined, item.dataScopes)[0]!; if (!scopeSubset(scope, item.dataScopes)) throw new WorkboardError('ARTIFACT_SCOPE_DENIED', 'Artifact scope exceeds WorkItem scope'); const objectReferences = unique((input.objectReferences ?? []).filter(value => safeId(value))); const sourceRefs = unique((input.sourceRefs ?? []).filter(value => safeId(value))); const id = input.id ?? randomId('work-artifact'); if (!safeId(id) || this.artifacts.has(id)) throw new WorkboardError(this.artifacts.has(id) ? 'CONFLICT' : 'INVALID_ARGUMENT', 'Artifact id is invalid or already exists'); const payload = { id, boardId, workItemId: itemId, producer, kind: input.kind ?? 'structured', value: clone(input.value), objectReferences, sourceRefs, dataClass, scope }; const sizeBytes = serialSize(payload); const currentBytes = [...this.artifacts.values()].filter(value => value.boardId === boardId).reduce((sum, value) => sum + value.sizeBytes, 0); if (currentBytes + sizeBytes > board.policy.maxArtifactStorageBytes) throw new WorkboardError('ARTIFACT_LIMIT', 'Workboard artifact budget exceeded'); const unsignedArtifact = { version: 1 as const, ...payload, integrity: digest(payload), sizeBytes, createdAt: nowIso(this.now) }; const artifact = await this.withSignature(unsignedArtifact); this.artifacts.set(id, artifact); const updated = await this.updateItem(item, { artifacts: [...item.artifacts, artifact] }, actor); await this.emitActivity(board, updated, producer, 'artifact_attached', undefined, undefined, undefined, updated.revision, { artifactId: id, dataClass }); await this.publish('artifact.add', id, updated.revision, artifact, producer, boardId); return clone(artifact); }

  async requestUserInput(boardId: string, itemId: string, input: { readonly requestedBy?: WorkboardActor; readonly reason: WorkboardUserRequest['reason']; readonly prompt: string; readonly expiresAt?: string }, actor: WorkboardActor = this.localActor): Promise<WorkboardInboxEntry> { const board = await this.authorizeBoard(boardId, actor, 'needs_user'); const item = this.requireItem(boardId, itemId); if (!safeText(input.prompt, 4_000) || !validDate(input.expiresAt)) throw new WorkboardError('INVALID_ARGUMENT', 'Owner request is invalid'); const requestedBy = input.requestedBy ?? actor; const request: WorkboardUserRequest = { id: randomId('work-request'), boardId, workItemId: itemId, requestedBy: clone(requestedBy), reason: input.reason, prompt: input.prompt.trim(), createdAt: nowIso(this.now), ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}), state: 'pending' }; const entry: WorkboardInboxEntry = { ...request, notificationId: randomId('work-notification') }; this.inbox.set(entry.id, entry); const updated = await this.updateItem(item, { status: 'NEEDS_USER', needsUser: request, claimId: undefined, activeExecutionKey: undefined }, actor); await this.emitActivity(board, updated, actor, 'needs_user', item.status, 'NEEDS_USER', input.prompt.slice(0, 256), updated.revision); await this.publish('item.upsert', updated.id, updated.revision, updated, actor, boardId); await this.publish('inbox.upsert', entry.id, 1, entry, actor, boardId); await this.onNeedsUser?.(clone(entry)); return clone(entry); }

  async respondToUser(boardId: string, itemId: string, response: string, actor: WorkboardActor = { kind: 'human', id: this.identityId }): Promise<WorkItem> { const board = await this.authorizeBoard(boardId, actor, 'owner.respond'); if (actor.kind !== 'human' || actor.id !== board.ownerIdentityId) throw new WorkboardError('NOT_AUTHORIZED', 'Only the board owner may respond'); const item = this.requireItem(boardId, itemId); const request = item.needsUser; if (!request || request.state !== 'pending') return this.hydrateItem(item); if (!safeText(response, 16_000)) throw new WorkboardError('INVALID_ARGUMENT', 'Owner response is invalid'); const entry = this.inbox.get(request.id); if (entry) this.inbox.set(request.id, { ...entry, state: 'answered', response: response.trim(), respondedAt: nowIso(this.now), responseActor: clone(actor) }); const nextRequest = { ...request, state: 'answered' as const, response: response.trim(), respondedAt: nowIso(this.now), responseActor: clone(actor) }; const updated = await this.updateItem(item, { needsUser: nextRequest, status: 'READY', errorCode: undefined, errorMessage: undefined }, actor); await this.emitActivity(board, updated, actor, 'user_response', 'NEEDS_USER', 'READY', undefined, updated.revision); await this.publish('item.upsert', updated.id, updated.revision, updated, actor, boardId); return this.hydrateItem(updated); }

  async triggerFromAutomation(boardId: string, input: { readonly itemId?: string; readonly title: string; readonly objective: string; readonly actor?: WorkboardActor; readonly source?: string }): Promise<WorkItem> { const board = await this.authorizeBoard(boardId, input.actor ?? this.localActor, 'automation.trigger'); const actor = input.actor ?? this.localActor; const item = await this.createWorkItem(boardId, { id: input.itemId, title: input.title, objective: input.objective, creator: actor, status: 'READY' }, actor); await this.emitActivity(board, item, actor, 'automation_triggered', undefined, item.status, input.source?.slice(0, 128), item.revision); return item; }

  async handleAutomationEvent(event: { readonly id: string; readonly boardId: string; readonly title: string; readonly objective: string; readonly actor?: WorkboardActor; readonly source?: string }): Promise<WorkItem | undefined> { const key = `automation:${event.id}`; if (this.seenEvents.has(key)) return undefined; this.seenEvents.add(key); return this.triggerFromAutomation(event.boardId, { itemId: `automation-${event.id}`, title: event.title, objective: event.objective, actor: event.actor, source: event.source }); }

  async applyEvent(event: WorkboardEvent): Promise<boolean> { await this.ready(); if (!event || event.version !== 1 || !safeId(event.id) || !safeId(event.boardId) || !safeId(event.targetId) || !safeIdentityId(event.actor.id)) throw new WorkboardError('INVALID_EVENT', 'Invalid Workboard event'); if (this.seenEvents.has(event.id)) throw new WorkboardError('REPLAY', 'Workboard event replayed'); if (!(await this.verifyEvent(event))) throw new WorkboardError('INVALID_SIGNATURE', 'Workboard event signature is invalid'); const knownBoard = this.boards.get(event.boardId); if (knownBoard?.kind === 'SHARED_SPACE' && !(await this.surfaceEligible(event.targetId, event.payload))) throw new WorkboardError('NOT_AUTHORIZED', 'Shared Workboard event failed mandatory safety gating'); if (event.operation !== 'board.upsert' && !this.boards.has(event.boardId)) { if (!this.pendingEvents.some(value => value.id === event.id)) this.pendingEvents.push(clone(event)); return false; } this.seenEvents.add(event.id); if (event.actor.id === this.identityId && event.actor.kind === 'human') return false; let applied: boolean; switch (event.operation) { case 'board.upsert': applied = await this.applyBoardEvent(event); if (applied) await this.drainPending(event.boardId); return applied; case 'item.upsert': applied = await this.applyItemEvent(event); break; case 'claim.upsert': applied = await this.applyClaimEvent(event); break; case 'dependency.add': applied = await this.applyDependencyEvent(event); break; case 'comment.add': applied = await this.applyCommentEvent(event); break; case 'artifact.add': applied = await this.applyArtifactEvent(event); break; case 'activity.add': applied = await this.applyActivityEvent(event); break; case 'inbox.upsert': applied = await this.applyInboxEvent(event); break; default: throw new WorkboardError('INVALID_EVENT', 'Unknown Workboard operation'); } return applied; }

  private async execute(input: WorkboardExecutionInput): Promise<WorkboardExecutionResult> { const work = async (signal: AbortSignal = input.signal) => { const scopedInput = signal === input.signal ? input : { ...input, signal }; if (scopedInput.item.taskGraphId && this.execution?.runTaskGraph) { const result = await this.execution.runTaskGraph({ ...scopedInput, taskGraphId: scopedInput.item.taskGraphId }); return this.normalizeExecutionResult(result); } if (scopedInput.item.toolFlow && this.execution?.runToolFlow) return this.execution.runToolFlow({ ...scopedInput, toolFlow: scopedInput.item.toolFlow }); if (scopedInput.item.assignee?.kind === 'worker' && this.execution?.runWorker) return this.execution.runWorker({ ...scopedInput, actor: scopedInput.item.assignee }); if (scopedInput.item.assignee?.kind === 'agent' && this.execution?.runAgent) return this.execution.runAgent({ ...scopedInput, actor: scopedInput.item.assignee }); if (this.execution?.execute) return this.execution.execute(scopedInput); throw new WorkboardError('EXECUTOR_UNAVAILABLE', 'No Workboard execution adapter is configured'); }; if (!this.scheduler || input.board.execution === 'local' && input.item.assignee?.kind === 'human') return work(input.signal); const priority: InferencePriority = input.board.execution === 'local' ? 'BACKGROUND' : 'ACTIVE_AGENT'; return this.scheduler.run({ agentId: input.board.creator.id, sessionId: `workboard:${input.board.id}`, model: { provider: 'workboard', model: 'shared-runtime' }, priority, kind: 'workboard-item', timeoutMs: input.claim.expiresAt ? Math.max(100, Date.parse(input.claim.expiresAt) - this.now()) : undefined, handler: async ({ signal }) => workWithSignal(work, signal, input.signal) }); }
  private normalizeExecutionResult(value: WorkboardExecutionResult | TaskGraphState): WorkboardExecutionResult { if (typeof value === 'object' && 'lifecycle' in value) { if (value.lifecycle === 'COMPLETED') return { status: 'DONE' }; if (value.lifecycle === 'PARTIAL') return { status: 'REVIEW' }; if (value.lifecycle === 'PAUSED') return { status: 'NEEDS_USER', needsUser: { reason: 'owner_decision', prompt: 'TaskGraph is paused and needs a continuation decision' } }; return { status: 'FAILED', errorCode: value.errorCode ?? 'TASK_GRAPH_FAILED', errorMessage: value.errorMessage }; } return value; }

  private async updateBoard(board: Workboard, patch: Partial<Pick<Workboard, 'members' | 'description' | 'title' | 'policy' | 'allowedCapabilities' | 'allowedDataScopes'>> , actor: WorkboardActor): Promise<Workboard> { const timestamp = nowIso(this.now); const { signature: _signature, ...without } = { ...board, ...patch, revision: board.revision + 1, updatedAt: timestamp }; const next = await this.withSignature(without); this.boards.set(board.id, next); await this.publish('board.upsert', next.id, next.revision, next, actor, next.id); return clone(next); }
  private async updateItem(item: WorkItem, patch: Partial<WorkItem>, actor: WorkboardActor): Promise<WorkItem> { const timestamp = nowIso(this.now); const { signature: _signature, ...without } = { ...item, ...patch, revision: item.revision + 1, updatedAt: timestamp }; const next = await this.withSignature(without); const board = this.boards.get(item.boardId); if (board?.kind === 'SHARED_SPACE' && !(await this.surfaceEligible(next.id, next))) { const addedComments = (patch.comments ?? []).filter(comment => !item.comments.some(existing => existing.id === comment.id)); for (const comment of addedComments) this.comments.delete(comment.id); const addedArtifacts = (patch.artifacts ?? []).filter(artifact => !item.artifacts.some(existing => existing.id === artifact.id)); for (const artifact of addedArtifacts) this.artifacts.delete(artifact.id); throw new WorkboardError('NOT_AUTHORIZED', 'Shared Workboard item failed mandatory safety gating'); } this.items.set(item.id, next); await this.persist(); return next; }
  private async updateClaim(claim: WorkItemClaim, patch: Partial<WorkItemClaim>): Promise<WorkItemClaim> { const { signature: _signature, ...without } = { ...claim, ...patch }; return this.withSignature(without); }
  private async withSignature<T extends object>(value: T): Promise<T & { readonly signature: string }> { assertNoManagedSecret(value, 'Workboard state contains managed secret material'); const normalized = stripUndefined(value); const payload = canonicalJson(normalized); const signature = this.signer ? await this.signer.sign(payload) : digest(normalized); return { ...normalized, signature };
  }
  private async makeSignedDependency(value: Omit<WorkItemDependency, 'signature'>): Promise<WorkItemDependency> { return this.withSignature(value); }
  private async drainPending(boardId: string): Promise<void> { const pending = this.pendingEvents.splice(0); for (const event of pending) { if (event.boardId !== boardId) { this.pendingEvents.push(event); continue; } try { await this.applyEvent(event); } catch { /* malformed or unauthorized pending events remain rejected */ } } }
  private async publish(operation: WorkboardEvent['operation'], targetId: string, revision: number, payload: unknown, actor: WorkboardActor, boardId: string): Promise<void> { const board = this.boards.get(boardId); if (board?.kind === 'SHARED_SPACE' && !(await this.surfaceEligible(targetId, payload))) throw new WorkboardError('NOT_AUTHORIZED', 'Shared Workboard publication failed mandatory safety gating'); const unsignedEvent = { version: 1 as const, id: randomId('work-event'), boardId, actor: clone(actor), operation, targetId, revision, payload: clone(payload), createdAt: nowIso(this.now) }; const event = await this.withSignature(unsignedEvent); this.seenEvents.add(event.id); try { await this.replication?.publish(event, this.recipients(boardId)); } catch { /* A production adapter queues while offline; local durable state must remain usable. */ } await this.persist(); }
  private recipients(boardId: string): string[] { const board = this.boards.get(boardId); return board ? board.members.filter(member => !member.removedAt && member.identityId !== this.identityId).map(member => member.identityId) : []; }
  private async verifyEvent(event: WorkboardEvent): Promise<boolean> { if (SecretRedactionPolicy.containsManagedSecret(event.payload)) return false; if (this.signer?.verify) return Boolean(await this.signer.verify(canonicalJson(unsigned(event)), event.signature, event.actor)); return digest(unsigned(event)) === event.signature; }
  private async surfaceEligible(objectId: string, value: unknown): Promise<boolean> { return (await this.protectedSurfaces.evaluate('WORKBOARDS', { objectId, domain: 'SHARED_SPACE', value, content: value, sourceType: 'workboard', verified: true, authorized: true, sharing: true })) !== undefined; }
  private async applyBoardEvent(event: WorkboardEvent): Promise<boolean> { const payload = event.payload as Workboard; if (!payload || payload.version !== 1 || payload.id !== event.targetId) throw new WorkboardError('INVALID_EVENT', 'Invalid Workboard board payload'); if (payload.kind === 'SHARED_SPACE' && !(await this.surfaceEligible(payload.id, payload))) throw new WorkboardError('NOT_AUTHORIZED', 'Shared Workboard event failed mandatory safety gating'); const current = this.boards.get(payload.id); if (current && current.revision > payload.revision) return false; if (current && current.revision === payload.revision && current.signature >= payload.signature) return false; if (payload.kind === 'SHARED_SPACE' && payload.spaceId && this.canUseSpace && !(await this.canUseSpace({ action: 'workboard.read', spaceId: payload.spaceId, actor: this.localActor }))) return false; this.boards.set(payload.id, clone(payload)); await this.persist(); return true; }
  private async applyItemEvent(event: WorkboardEvent): Promise<boolean> { const payload = event.payload as WorkItem; if (!payload || payload.version !== 1 || payload.id !== event.targetId || !this.boards.has(payload.boardId)) throw new WorkboardError('INVALID_EVENT', 'Invalid WorkItem payload'); const board = this.boards.get(payload.boardId)!; if (board.kind === 'SHARED_SPACE' && !(await this.surfaceEligible(payload.id, payload))) throw new WorkboardError('NOT_AUTHORIZED', 'Shared WorkItem event failed mandatory safety gating'); if (!this.actorAllowed(board, event.actor, 'item.write')) throw new WorkboardError('NOT_AUTHORIZED', 'Remote actor cannot update WorkItem'); const current = this.items.get(payload.id); if (current && current.revision > payload.revision) return false; if (current && current.revision === payload.revision && current.signature >= payload.signature) return false; this.items.set(payload.id, clone(payload)); await this.persist(); return true; }
  private async applyClaimEvent(event: WorkboardEvent): Promise<boolean> { const payload = event.payload as WorkItemClaim; if (!payload || payload.version !== 1 || payload.id !== event.targetId || !this.boards.has(payload.boardId)) throw new WorkboardError('INVALID_EVENT', 'Invalid WorkItem claim payload'); const board = this.boards.get(payload.boardId)!; if (board.kind === 'SHARED_SPACE' && !(await this.surfaceEligible(payload.id, payload))) throw new WorkboardError('NOT_AUTHORIZED', 'Shared Workboard claim failed mandatory safety gating'); if (!this.actorAllowed(board, event.actor, 'item.claim')) throw new WorkboardError('NOT_AUTHORIZED', 'Remote actor cannot claim WorkItem'); const current = this.claims.get(payload.id); if (current && current.leaseVersion > payload.leaseVersion) return false; if (current && current.leaseVersion === payload.leaseVersion && current.signature >= payload.signature) return false; if (payload.state === 'active') { const item = this.items.get(payload.workItemId); if (item?.claimId && item.claimId !== payload.id) { const other = this.claims.get(item.claimId); if (other?.state === 'active' && other.actor.id !== payload.actor.id && other.signature >= payload.signature) return false; } } this.claims.set(payload.id, clone(payload)); const item = this.items.get(payload.workItemId); /* Claim events may race with item revisions on real transports. Never let an old active lease regress a terminal or newer item revision back to RUNNING. */ if (item && payload.state === 'active' && (!item.claimId || item.claimId === payload.id) && item.revision <= payload.leaseVersion && !terminalStatus(item.status)) this.items.set(item.id, { ...item, claimId: payload.id, activeExecutionKey: payload.executionKey, status: 'RUNNING', revision: Math.max(item.revision, payload.leaseVersion), updatedAt: payload.issuedAt }); await this.persist(); return true; }
  private async applyDependencyEvent(event: WorkboardEvent): Promise<boolean> { const payload = event.payload as WorkItemDependency; if (!payload || payload.version !== 1 || payload.id !== event.targetId || !this.items.has(payload.workItemId)) throw new WorkboardError('INVALID_EVENT', 'Invalid WorkItem dependency payload'); const board = this.boards.get(payload.boardId); if (!board || !this.actorAllowed(board, event.actor, 'item.write')) throw new WorkboardError('NOT_AUTHORIZED', 'Remote actor cannot add dependency'); if (board.kind === 'SHARED_SPACE' && !(await this.surfaceEligible(payload.id, payload))) throw new WorkboardError('NOT_AUTHORIZED', 'Shared Workboard dependency failed mandatory safety gating'); if (this.dependencies.has(payload.id)) return false; const item = this.requireItem(payload.boardId, payload.workItemId); const dependencies = [...item.dependencies, clone(payload)]; this.assertNoDependencyCycle(payload.boardId, payload.workItemId, dependencies); this.dependencies.set(payload.id, clone(payload)); const waiting = payload.required && this.items.get(payload.dependsOnItemId)?.status !== 'DONE'; const status = waiting && ['TODO', 'READY'].includes(item.status) ? 'BLOCKED' : item.status; this.items.set(item.id, { ...item, dependencies, ...(status !== item.status ? { status, errorCode: 'DEPENDENCY_BLOCKED', errorMessage: 'Required dependency is not complete' } : {}), revision: item.revision + 1, updatedAt: payload.createdAt }); await this.persist(); return true; }
  private async applyCommentEvent(event: WorkboardEvent): Promise<boolean> { const payload = event.payload as WorkItemComment; if (!payload || payload.version !== 1 || payload.id !== event.targetId || !this.items.has(payload.workItemId)) throw new WorkboardError('INVALID_EVENT', 'Invalid WorkItem comment payload'); const board = this.boards.get(payload.boardId); if (!board || !this.actorAllowed(board, event.actor, 'comment.write')) throw new WorkboardError('NOT_AUTHORIZED', 'Remote actor cannot add comment'); if (board.kind === 'SHARED_SPACE' && !(await this.surfaceEligible(payload.id, payload))) throw new WorkboardError('NOT_AUTHORIZED', 'Shared Workboard comment failed mandatory safety gating'); if (this.comments.has(payload.id)) return false; this.comments.set(payload.id, clone(payload)); const item = this.items.get(payload.workItemId)!; this.items.set(item.id, { ...item, comments: [...item.comments, clone(payload)], revision: item.revision + 1, updatedAt: payload.createdAt }); await this.persist(); return true; }
  private async applyArtifactEvent(event: WorkboardEvent): Promise<boolean> { const payload = event.payload as WorkItemArtifact; if (!payload || payload.version !== 1 || payload.id !== event.targetId || !this.items.has(payload.workItemId)) throw new WorkboardError('INVALID_EVENT', 'Invalid WorkItem artifact payload'); const board = this.boards.get(payload.boardId); if (!board || !this.actorAllowed(board, event.actor, 'artifact.attach')) throw new WorkboardError('NOT_AUTHORIZED', 'Remote actor cannot attach artifact'); if (board.kind === 'SHARED_SPACE' && !(await this.surfaceEligible(payload.id, payload))) throw new WorkboardError('NOT_AUTHORIZED', 'Shared Workboard artifact failed mandatory safety gating'); if (this.artifacts.has(payload.id)) return false; if (!scopeAllows(this.requireItem(payload.boardId, payload.workItemId).dataScopes, payload.dataClass)) throw new WorkboardError('ARTIFACT_SCOPE_DENIED', 'Remote artifact scope denied'); this.artifacts.set(payload.id, clone(payload)); const item = this.items.get(payload.workItemId)!; this.items.set(item.id, { ...item, artifacts: [...item.artifacts, clone(payload)], revision: item.revision + 1, updatedAt: payload.createdAt }); await this.persist(); return true; }
  private async applyActivityEvent(event: WorkboardEvent): Promise<boolean> { const payload = event.payload as WorkboardActivity; if (!payload || payload.version !== 1 || payload.id !== event.targetId || !this.boards.has(payload.boardId)) throw new WorkboardError('INVALID_EVENT', 'Invalid Workboard activity payload'); const board = this.boards.get(payload.boardId)!; if (board.kind === 'SHARED_SPACE' && !(await this.surfaceEligible(payload.id, payload))) throw new WorkboardError('NOT_AUTHORIZED', 'Shared Workboard activity failed mandatory safety gating'); if (this.activities.some(value => value.id === payload.id)) return false; this.activities.push(clone(payload)); this.trimActivity(payload.boardId); await this.persist(); return true; }
  private async applyInboxEvent(event: WorkboardEvent): Promise<boolean> { const payload = event.payload as WorkboardInboxEntry; if (!payload || !payload.id || payload.boardId !== event.boardId) throw new WorkboardError('INVALID_EVENT', 'Invalid Workboard inbox payload'); const board = this.boards.get(payload.boardId); if (board?.kind === 'SHARED_SPACE' && !(await this.surfaceEligible(payload.id, payload))) throw new WorkboardError('NOT_AUTHORIZED', 'Shared Workboard inbox event failed mandatory safety gating'); if (payload.requestedBy.kind !== 'human' && payload.dataClass === 'SECRET') throw new WorkboardError('NOT_AUTHORIZED', 'Secret owner requests cannot replicate'); this.inbox.set(payload.id, clone(payload)); await this.persist(); return true; }

  private async emitActivity(board: Workboard, item: WorkItem | undefined, actor: WorkboardActor, kind: WorkboardActivityKind, fromStatus?: WorkItemStatus, toStatus?: WorkItemStatus, reason?: string, revision = board.revision, metadata?: Readonly<Record<string, string | number | boolean>>): Promise<void> { const activity = await this.withSignature({ version: 1 as const, id: randomId('work-activity'), boardId: board.id, ...(item ? { workItemId: item.id } : {}), actor: clone(actor), kind, ...(fromStatus ? { fromStatus } : {}), ...(toStatus ? { toStatus } : {}), ...(reason ? { reason: reason.slice(0, 512) } : {}), revision, createdAt: nowIso(this.now), ...(metadata ? { metadata: Object.fromEntries(Object.entries(metadata).slice(0, 16)) } : {}) }); this.activities.push(activity); this.trimActivity(board.id); await this.onActivity?.(clone(activity)); await this.publish('activity.add', activity.id, activity.revision, activity, actor, board.id); }
  private trimActivity(boardId: string): void { const board = this.boards.get(boardId); const max = board?.policy.maxActivity ?? this.defaultPolicy.maxActivity; const values = this.activities.filter(value => value.boardId === boardId); while (values.length > max) { const oldest = values.shift(); if (!oldest) break; const index = this.activities.findIndex(value => value.id === oldest.id); if (index >= 0) this.activities.splice(index, 1); } }
  private hydrateItem(item: WorkItem): WorkItem { const claims = item.claimId ? this.claims.get(item.claimId) : undefined; if (claims && claimExpired(claims, this.now(), this.board(item.boardId).policy.staleAfterMs)) void this.recoverStaleClaims(item.boardId); return clone(item); }
  private itemsFor(boardId: string): WorkItem[] { return [...this.items.values()].filter(item => item.boardId === boardId); }
  private board(boardId: string): Workboard { return this.requireBoard(boardId); }
  private requireBoard(boardId: string): Workboard { const board = this.boards.get(boardId); if (!board) throw new WorkboardError('BOARD_NOT_FOUND', `Workboard ${boardId} was not found`); return board; }
  private requireItem(boardId: string, itemId: string): WorkItem { const item = this.items.get(itemId); if (!item || item.boardId !== boardId) throw new WorkboardError('ITEM_NOT_FOUND', `WorkItem ${itemId} was not found`); return item; }
  private requireClaim(claimId: string): WorkItemClaim { const claim = this.claims.get(claimId); if (!claim) throw new WorkboardError('CLAIM_NOT_FOUND', `Claim ${claimId} was not found`); return claim; }
  private isOwner(boardId: string, actor: WorkboardActor): boolean { const board = this.requireBoard(boardId); return actor.kind === 'human' && actor.id === board.ownerIdentityId; }
  private assertIdentity(actor: WorkboardActor): void { if (actor.kind !== 'human' || actor.id !== this.identityId) throw new WorkboardError('NOT_AUTHORIZED', 'Only the local human identity may create a Workboard'); }
  private assertIdentityOrBoardActor(board: Workboard, actor: WorkboardActor): void { if (actor.kind === 'human' && actor.id === board.ownerIdentityId) return; if (actor.ownerIdentityId && actor.ownerIdentityId !== board.ownerIdentityId) throw new WorkboardError('NOT_AUTHORIZED', 'Actor owner identity does not match Workboard'); if (actor.kind === 'human' && actor.id !== board.ownerIdentityId) throw new WorkboardError('NOT_AUTHORIZED', 'Human actor is not a Workboard member'); }
  private async authorizeBoard(boardId: string, actor: WorkboardActor, action: string): Promise<Workboard> { const board = this.requireBoard(boardId); if (!this.actorAllowed(board, actor, action)) throw new WorkboardError('NOT_AUTHORIZED', `Workboard permission denied for ${action}`); if (board.spaceId && this.canUseSpace && !(await this.canUseSpace({ action, spaceId: board.spaceId, actor }))) throw new WorkboardError('SPACE_PERMISSION_DENIED', 'Shared Space policy denied Workboard action'); if (this.authorize && !(await this.authorize({ action, actor, board, item: undefined }))) throw new WorkboardError('NOT_AUTHORIZED', `Workboard policy denied ${action}`); return board; }
  private actorAllowed(board: Workboard, actor: WorkboardActor, action: string): boolean { if (actor.kind === 'human' && actor.id === board.ownerIdentityId) return true; const member = board.members.find(value => value.identityId === (actor.ownerIdentityId ?? actor.id) && !value.removedAt && (actor.kind !== 'agent' || value.agentId === actor.id || value.role === 'agent')); if (!member) return false; if (actor.kind === 'agent' && board.policy.requireExplicitAgentGrant && !member.agentId) return false; if (actor.kind === 'worker' && !member.agentId && !member.permissions?.includes('worker.execute')) return false; if (actor.kind === 'agent' && !board.policy.allowRemoteAgents && actor.ownerIdentityId !== this.identityId) return false; if (member.role === 'viewer' && !['read', 'activity.read'].some(value => action.includes(value))) return false; if (member.permissions?.length) return member.permissions.includes(action) || member.permissions.includes('*') || member.role === 'owner' || member.role === 'editor'; return member.role !== 'viewer'; }
  private assertAssignment(board: Workboard, actor: WorkboardActor): void { if (actor.kind === 'agent' && (!actor.ownerIdentityId || actor.ownerIdentityId !== board.ownerIdentityId) && !board.policy.allowRemoteAgents) throw new WorkboardError('REMOTE_AGENT_DENIED', 'Remote Agent assignment is disabled'); if (!this.actorAllowed(board, actor, 'item.claim')) throw new WorkboardError('AGENT_NOT_GRANTED', 'Agent/Worker has no explicit Workboard grant'); }
  private normalizeMembers(values: readonly WorkboardMember[]): WorkboardMember[] { const result = new Map<string, WorkboardMember>(); for (const value of values) { if (!safeIdentityId(value.identityId) || !['owner', 'editor', 'viewer', 'agent'].includes(value.role) || (value.agentId !== undefined && !safeId(value.agentId))) throw new WorkboardError('INVALID_ARGUMENT', 'Invalid Workboard member'); result.set(`${value.identityId}:${value.agentId ?? ''}`, { identityId: value.identityId, role: value.role, ...(value.agentId ? { agentId: value.agentId } : {}), ...(value.permissions?.length ? { permissions: unique(value.permissions.filter(value => safeId(value, 128))) } : {}), joinedAt: value.joinedAt || nowIso(this.now), ...(value.removedAt ? { removedAt: value.removedAt } : {}) }); } if (!result.has(`${this.identityId}:`)) result.set(`${this.identityId}:`, { identityId: this.identityId, role: 'owner', joinedAt: nowIso(this.now) }); return [...result.values()]; }
  private assertNoDependencyCycle(boardId: string, itemId: string, dependencies: readonly WorkItemDependency[]): void { const graph = new Map<string, string[]>(); for (const value of this.itemsFor(boardId)) graph.set(value.id, value.dependencies.map(edge => edge.dependsOnItemId)); graph.set(itemId, dependencies.map(edge => edge.dependsOnItemId)); const visiting = new Set<string>(); const visited = new Set<string>(); const walk = (id: string): boolean => { if (visiting.has(id)) return true; if (visited.has(id)) return false; visiting.add(id); for (const child of graph.get(id) ?? []) if (walk(child)) return true; visiting.delete(id); visited.add(id); return false; }; if (walk(itemId)) throw new WorkboardError('DEPENDENCY_CYCLE', 'WorkItem dependency cycle detected'); }
  private hasFailedDependency(item: WorkItem): boolean { return item.dependencies.some(edge => edge.required && ['FAILED', 'CANCELLED'].includes(this.items.get(edge.dependsOnItemId)?.status ?? 'FAILED')); }
  private dependenciesReady(item: WorkItem): boolean { return item.dependencies.every(edge => { const dependency = this.items.get(edge.dependsOnItemId); return dependency?.status === 'DONE' || (!edge.required && ['FAILED', 'CANCELLED', 'DONE'].includes(dependency?.status ?? 'FAILED')); }); }
  private contextAllowed(scopes: readonly WorkboardDataScope[], context: AIContextItem): boolean { return scopes.some(scope => scope.dataClasses.includes(context.dataClass) && (!scope.sourceKinds?.length || !context.source || scope.sourceKinds.includes(context.source)) && (!scope.objectIds?.length || scope.objectIds.includes(context.id))); }
  private markBlocked(item: WorkItem, actor: WorkboardActor): Promise<WorkItem> { return this.updateItem(item, { status: 'BLOCKED', errorCode: 'DEPENDENCY_BLOCKED', errorMessage: 'Required dependency failed' }, actor); }
  private async unblockDependents(boardId: string, completedItemId: string, actor: WorkboardActor): Promise<void> { const board = this.board(boardId); for (const dependent of this.itemsFor(boardId)) { if (dependent.status !== 'BLOCKED' || !dependent.dependencies.some(edge => edge.required && edge.dependsOnItemId === completedItemId) || !this.dependenciesReady(dependent)) continue; const updated = await this.updateItem(dependent, { status: 'READY', errorCode: undefined, errorMessage: undefined }, actor); await this.emitActivity(board, updated, actor, 'status_transition', dependent.status, 'READY', 'Required dependencies completed', updated.revision); await this.publish('item.upsert', updated.id, updated.revision, updated, actor, boardId); } }
  private makeSnapshot(): WorkboardSnapshot { return { version: 1, boards: [...this.boards.values()].map(clone), items: [...this.items.values()].map(clone), claims: [...this.claims.values()].map(clone), dependencies: [...this.dependencies.values()].map(clone), comments: [...this.comments.values()].map(clone), artifacts: [...this.artifacts.values()].map(clone), activity: this.activities.map(clone), inbox: [...this.inbox.values()].map(clone), seenEvents: [...this.seenEvents].slice(-20_000) }; }
  private async persist(): Promise<void> { if (this.closed) return; const snapshot = this.makeSnapshot(); const operation = this.writes.then(() => this.storage.write(snapshot)); this.writes = operation.catch(() => undefined); await operation; }
  private async hydrate(): Promise<void> { const raw = await this.storage.read(); if (!raw) return; if (!raw || typeof raw !== 'object' || (raw as { version?: unknown }).version !== 1) throw new WorkboardError('FAILED', 'Invalid Workboard state version'); const snapshot = raw as WorkboardSnapshot; for (const board of snapshot.boards ?? []) if (board?.version === 1 && safeId(board.id)) this.boards.set(board.id, clone(board)); for (const item of snapshot.items ?? []) if (item?.version === 1 && safeId(item.id) && this.boards.has(item.boardId)) this.items.set(item.id, clone(item)); for (const claim of snapshot.claims ?? []) if (claim?.version === 1 && safeId(claim.id) && this.boards.has(claim.boardId)) this.claims.set(claim.id, clone(claim)); for (const dependency of snapshot.dependencies ?? []) if (dependency?.version === 1 && safeId(dependency.id)) this.dependencies.set(dependency.id, clone(dependency)); for (const comment of snapshot.comments ?? []) if (comment?.version === 1 && safeId(comment.id)) this.comments.set(comment.id, clone(comment)); for (const artifact of snapshot.artifacts ?? []) if (artifact?.version === 1 && safeId(artifact.id)) this.artifacts.set(artifact.id, clone(artifact)); this.activities.push(...(snapshot.activity ?? []).filter(value => value?.version === 1).map(clone)); for (const entry of snapshot.inbox ?? []) if (entry?.id && entry?.boardId) this.inbox.set(entry.id, clone(entry)); for (const id of snapshot.seenEvents ?? []) if (safeId(id, 512)) this.seenEvents.add(id); }
}

/** Stable product-facing name; the implementation remains the single Workboard service. */
export class AgentWorkboardService extends WorkboardService {}

async function workWithSignal(work: (signal: AbortSignal) => Promise<WorkboardExecutionResult>, schedulerSignal: AbortSignal, callerSignal: AbortSignal): Promise<WorkboardExecutionResult> { if (callerSignal.aborted || schedulerSignal.aborted) throw new WorkboardError('FAILED', 'Workboard execution cancelled'); const controller = new AbortController(); const abort = () => controller.abort(); if (callerSignal.aborted) controller.abort(); else callerSignal.addEventListener('abort', abort, { once: true }); if (schedulerSignal.aborted) controller.abort(); else schedulerSignal.addEventListener('abort', abort, { once: true }); try { return await work(controller.signal); } finally { callerSignal.removeEventListener('abort', abort); schedulerSignal.removeEventListener('abort', abort); } }

/** Production transport adapter: EnvelopeSecurity authenticates the peer and
 * WorkboardService verifies the signed event body before applying it. */
export class WorkboardTransportReplication implements WorkboardReplicationAdapter {
  private readonly handlers = new Set<(event: WorkboardEvent) => void | Promise<unknown>>();
  private readonly unsubscribe: () => void;
  private readonly transport: KeystoneDeliveryInterface;
  private readonly security: EnvelopeSecurity;
  private readonly localIdentityId: string;
  private readonly peers: readonly string[];
  private readonly now: () => number;
  private readonly pending = new Map<string, WorkboardEvent[]>();
  private readonly retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly acknowledgements = new Map<string, { readonly promise: Promise<void>; readonly resolve: () => void; readonly reject: (error: Error) => void; readonly timer: ReturnType<typeof setTimeout> }>();
  constructor(options: { readonly transport: KeystoneDeliveryInterface; readonly security: EnvelopeSecurity; readonly localIdentityId: string; readonly peers?: readonly string[]; readonly now?: () => number }) { this.transport = options.transport; this.security = options.security; this.localIdentityId = options.localIdentityId; this.peers = options.peers ?? []; this.now = options.now ?? Date.now; this.unsubscribe = this.transport.onMessage(envelope => { void this.receive(envelope); }); }
  subscribe(listener: (event: WorkboardEvent) => void | Promise<unknown>): () => void { this.handlers.add(listener); return () => this.handlers.delete(listener); }
  async publish(event: WorkboardEvent, recipients?: readonly string[]): Promise<void> { for (const peer of recipients ?? this.peers) { if (peer === this.localIdentityId) continue; await this.flush(peer); try { await this.send(event, peer); } catch { const pending = this.pending.get(peer) ?? []; if (!pending.some(value => value.id === event.id)) pending.push(clone(event)); this.pending.set(peer, pending); this.scheduleRetry(peer); throw new Error(`Workboard peer ${peer} is offline`); } } }
  close(): void { this.unsubscribe(); this.handlers.clear(); this.pending.clear(); for (const timer of this.retryTimers.values()) clearTimeout(timer); this.retryTimers.clear(); for (const waiter of this.acknowledgements.values()) { clearTimeout(waiter.timer); waiter.reject(new Error('Workboard replication closed')); } this.acknowledgements.clear(); }
  async flush(peer?: string): Promise<void> { const peers = peer ? [peer] : [...this.pending.keys()]; for (const recipient of peers) { const events = this.pending.get(recipient) ?? []; while (events.length) { const event = events[0]!; try { await this.send(event, recipient); events.shift(); } catch { await this.transport.reconnect?.(recipient).catch(() => undefined); break; } } if (!events.length) { this.pending.delete(recipient); const timer = this.retryTimers.get(recipient); if (timer) { clearTimeout(timer); this.retryTimers.delete(recipient); } } else this.scheduleRetry(recipient); } }
  pendingCount(peer?: string): number { return peer ? (this.pending.get(peer)?.length ?? 0) : [...this.pending.values()].reduce((sum, events) => sum + events.length, 0); }
  private scheduleRetry(peer: string): void { if (this.retryTimers.has(peer)) return; const timer = setTimeout(() => { this.retryTimers.delete(peer); void this.flush(peer); }, 500); this.retryTimers.set(peer, timer); }
  private async send(event: WorkboardEvent, peer: string): Promise<void> { const unsigned: UnsignedEnvelope = { version: 1, type: WORKBOARD_ENVELOPE, id: randomId('work-envelope'), sender: this.localIdentityId, recipient: peer, nonce: crypto.randomUUID(), expiresAt: new Date(this.now() + 10 * 60_000).toISOString(), body: event }; const acknowledgement = this.waitForAcknowledgement(peer, event.id); await this.transport.connect(peer); await this.transport.send(peer, { ...unsigned, signature: await this.security.sign(unsigned) }); await acknowledgement; }
  private waitForAcknowledgement(peer: string, eventId: string): Promise<void> { const key = `${peer}:${eventId}`; const existing = this.acknowledgements.get(key); if (existing) return existing.promise; let resolvePromise!: () => void; let rejectPromise!: (error: Error) => void; const promise = new Promise<void>((resolve, reject) => { resolvePromise = () => { clearTimeout(timer); this.acknowledgements.delete(key); resolve(); }; rejectPromise = (error: Error) => { clearTimeout(timer); this.acknowledgements.delete(key); reject(error); }; }); const timer = setTimeout(() => { this.acknowledgements.delete(key); rejectPromise(new Error('Workboard acknowledgement timeout')); }, 2_000); this.acknowledgements.set(key, { promise, timer, resolve: resolvePromise, reject: rejectPromise }); return promise; }
  private async receive(envelope: Envelope): Promise<void> { if (envelope.recipient !== this.localIdentityId || Date.parse(envelope.expiresAt) <= this.now() || !(await this.security.verify(envelope))) return; if (envelope.type === WORKBOARD_ACK_ENVELOPE) { const body = envelope.body as { readonly eventId?: unknown } | undefined; if (typeof body?.eventId !== 'string') return; this.acknowledgements.get(`${envelope.sender}:${body.eventId}`)?.resolve(); return; } if (envelope.type !== WORKBOARD_ENVELOPE || !envelope.body || typeof envelope.body !== 'object') return; const event = envelope.body as WorkboardEvent; if (event.version !== 1 || !safeId(event.id)) return; try { for (const handler of this.handlers) await handler(clone(event)); await this.sendAcknowledgement(envelope.sender, event.id); } catch { /* Do not acknowledge malformed or unauthorized events; sender will retry through its durable pending queue. */ } }
  private async sendAcknowledgement(peer: string, eventId: string): Promise<void> { const unsigned: UnsignedEnvelope = { version: 1, type: WORKBOARD_ACK_ENVELOPE, id: randomId('work-ack'), sender: this.localIdentityId, recipient: peer, nonce: crypto.randomUUID(), expiresAt: new Date(this.now() + 2 * 60_000).toISOString(), body: { eventId } }; if (!this.transport.isPeerConnected?.(peer)) await this.transport.connect(peer); await this.transport.send(peer, { ...unsigned, signature: await this.security.sign(unsigned) }); }
}
