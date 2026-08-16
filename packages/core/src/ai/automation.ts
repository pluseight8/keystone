/**
 * Local-first scheduled and event-driven Agent automation.
 *
 * This module is an adapter above AgentRuntime and Chronos.  It never grants
 * a trigger new capabilities: every job uses the session allowlists captured
 * when the automation was created.  Sensitive jobs stop at an explicit
 * approval state instead of attempting to run unattended.
 */

import {
  Chronos,
  nextCronDate,
  type ChronosAction,
  type ChronosAuditEntry,
  type ChronosEventSource,
  type ChronosPowerMonitor,
  type ChronosRule,
  type ChronosRunContext,
  type ChronosStore,
  type ChronosSystemEvent,
} from '../agents/chronos.js';
import type { NodeId } from '../types.js';
import {
  AgentError,
  AgentRuntime,
  type Agent,
  type AgentContextCapability,
  type AgentRunInput,
} from './agents.js';
import type { AIContextItem, AIDataClass } from './privacy.js';
import {
  ToolRegistry,
  SkillRegistry,
  type ToolCapability,
} from './tools.js';

export const AGENT_AUTOMATION_VERSION = 1 as const;
export const AGENT_AUTOMATION_PREFIX = 'keystone-agent-automation:';

export const AGENT_EVENT_TYPES = [
  'dm.received',
  'community.mention',
  'file.created',
  'track.created',
  'video.created',
  'live.started',
  'device.security',
  'system.local',
] as const;
export type AgentEventType = (typeof AGENT_EVENT_TYPES)[number];

export type AgentAutomationErrorCode =
  | 'INVALID_ARGUMENT'
  | 'AUTOMATION_NOT_FOUND'
  | 'JOB_NOT_FOUND'
  | 'AGENT_NOT_FOUND'
  | 'CAPABILITY_REVOKED'
  | 'PRIVATE_EXTERNAL_FALLBACK_DENIED'
  | 'WAITING_FOR_APPROVAL'
  | 'CONCURRENCY_LIMIT'
  | 'RESOURCE_BUDGET'
  | 'TRIGGER_STORM'
  | 'RECURSION_BLOCKED'
  | 'MAX_RETRIES'
  | 'FAILED';

export class AgentAutomationError extends Error {
  constructor(readonly code: AgentAutomationErrorCode, message: string) {
    super(message);
    this.name = 'AgentAutomationError';
  }
}

export type MissedRunPolicy = 'run_once' | 'skip';

export interface AgentSchedule {
  readonly cron: string;
  readonly timeZone?: string;
  readonly missedRunPolicy?: MissedRunPolicy;
}

export interface AgentEventTrigger {
  readonly eventType: AgentEventType;
  readonly filter?: Readonly<Record<string, string>>;
}

export type AgentTrigger =
  | { readonly type: 'schedule'; readonly schedule: AgentSchedule }
  | { readonly type: 'event'; readonly event: AgentEventTrigger };

export interface AgentTriggerEvent {
  readonly id: string;
  readonly eventType: AgentEventType;
  readonly occurredAt: string;
  readonly dataClass: AIDataClass;
  readonly payload?: unknown;
  readonly source?: string;
  /** Causal automation ids supplied by typed host adapters. */
  readonly causedBy?: readonly string[];
}

export interface AgentExecutionBudget {
  readonly maxRuntimeMs: number;
  readonly maxToolCalls: number;
  readonly maxModelCalls: number;
  readonly maxRetries: number;
  readonly retryBackoffMs: number;
  readonly dailyResourceUnits: number;
}

export interface AgentAutomation {
  readonly version: 1;
  readonly id: string;
  readonly name: string;
  readonly instruction: string;
  readonly agentId: string;
  readonly sessionId: string;
  readonly enabled: boolean;
  readonly trigger: AgentTrigger;
  readonly toolIds: readonly string[];
  readonly skillIds: readonly string[];
  readonly contextCapabilities: readonly AgentContextCapability[];
  readonly privacyClass: Agent['privacyClass'];
  readonly requiresApproval: boolean;
  readonly capabilities: readonly ToolCapability[];
  readonly budget: AgentExecutionBudget;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastScheduledAt?: string;
  readonly nextRunAt?: string;
}

export type AgentJobState =
  | 'queued'
  | 'waiting_for_approval'
  | 'running'
  | 'paused'
  | 'retry_wait'
  | 'succeeded'
  | 'failed'
  | 'skipped'
  | 'cancelled'
  | 'missed';

export interface AgentJob {
  readonly version: 1;
  readonly id: string;
  readonly automationId: string;
  readonly triggerType: AgentTrigger['type'];
  readonly triggerEventId?: string;
  readonly triggerEventType?: AgentEventType;
  readonly triggerDataClass?: AIDataClass;
  readonly scheduledFor?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly state: AgentJobState;
  readonly attempt: number;
  readonly agentRunId?: string;
  readonly nextAttemptAt?: string;
  readonly approvalState: 'not_required' | 'pending' | 'approved' | 'rejected';
  readonly missed: boolean;
  readonly lastErrorCode?: string;
}

export type AgentJobRunState = 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface AgentJobRun {
  readonly version: 1;
  readonly id: string;
  readonly jobId: string;
  readonly automationId: string;
  readonly attempt: number;
  readonly state: AgentJobRunState;
  readonly agentRunId?: string;
  readonly modelCalls: number;
  readonly toolCalls: number;
  readonly resourceUnits: number;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly errorCode?: string;
  readonly approvalState: 'not_required' | 'approved';
}

export interface AgentAutomationAuditEntry {
  readonly id: string;
  readonly automationId: string;
  readonly agentId: string;
  readonly jobId?: string;
  readonly jobRunId?: string;
  readonly trigger: string;
  readonly tools: readonly string[];
  readonly resultStatus: string;
  readonly approvalState: string;
  readonly timestamp: string;
  readonly errorCode?: string;
}

export interface AgentAutomationStateStore {
  read(): Promise<unknown | undefined>;
  write(value: unknown): Promise<void>;
}

export class InMemoryAgentAutomationStateStore implements AgentAutomationStateStore {
  private value?: unknown;
  async read(): Promise<unknown | undefined> { return this.value === undefined ? undefined : structuredClone(this.value); }
  async write(value: unknown): Promise<void> { this.value = structuredClone(value); }
}

export class InMemoryAgentAutomationChronosStore implements ChronosStore {
  private readonly rules = new Map<string, ChronosRule>();
  private readonly entries: ChronosAuditEntry[] = [];
  async listRules(): Promise<readonly ChronosRule[]> { return [...this.rules.values()].map(clone); }
  async putRule(rule: ChronosRule): Promise<void> { this.rules.set(rule.id, clone(rule)); }
  async deleteRule(id: string): Promise<void> { this.rules.delete(id); }
  async appendAudit(entry: ChronosAuditEntry): Promise<void> { this.entries.push(clone(entry)); while (this.entries.length > 2_000) this.entries.shift(); }
  listAudits(): readonly ChronosAuditEntry[] { return this.entries.map(clone); }
}

export interface AgentAutomationEventSource extends ChronosEventSource {
  emit(event: ChronosSystemEvent): Promise<void>;
}

export class InMemoryAgentAutomationEventSource implements AgentAutomationEventSource {
  private readonly handlers = new Set<(event: ChronosSystemEvent) => void | Promise<void>>();
  subscribe(handler: (event: ChronosSystemEvent) => void | Promise<void>): () => void { this.handlers.add(handler); return () => this.handlers.delete(handler); }
  async emit(event: ChronosSystemEvent): Promise<void> { await Promise.all([...this.handlers].map(handler => handler(event))); }
}

export interface AgentAutomationOptions {
  readonly runtime: AgentRuntime;
  readonly registry: ToolRegistry;
  readonly skills: SkillRegistry;
  readonly storage?: AgentAutomationStateStore;
  readonly chronosStore?: ChronosStore;
  /** Typed host adapter for local events; it must not grant capabilities. */
  readonly events?: AgentAutomationEventSource;
  readonly power?: ChronosPowerMonitor;
  readonly localNodeId?: NodeId;
  readonly now?: () => Date;
  readonly setTimer?: (handler: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  readonly clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
  readonly maxConcurrentJobs?: number;
  readonly maxPendingJobs?: number;
  readonly maxTriggerEventsPerMinute?: number;
  readonly maxCausalDepth?: number;
  readonly maxAuditEntries?: number;
}

export interface CreateAgentAutomationInput {
  readonly id?: string;
  readonly name: string;
  readonly instruction: string;
  readonly agentId: string;
  readonly trigger: AgentTrigger;
  readonly toolIds?: readonly string[];
  readonly skillIds?: readonly string[];
  readonly contextCapabilities?: readonly AgentContextCapability[];
  readonly budget?: Partial<AgentExecutionBudget>;
  readonly enabled?: boolean;
}

export interface UpdateAgentAutomationInput {
  readonly name?: string;
  readonly instruction?: string;
  readonly agentId?: string;
  readonly trigger?: AgentTrigger;
  readonly toolIds?: readonly string[];
  readonly skillIds?: readonly string[];
  readonly contextCapabilities?: readonly AgentContextCapability[];
  readonly budget?: Partial<AgentExecutionBudget>;
  readonly enabled?: boolean;
}

interface AutomationSnapshot {
  version: 1;
  automations: AgentAutomation[];
  jobs: AgentJob[];
  jobRuns: AgentJobRun[];
  seenEventIds: string[];
  resourceDay: string;
  resourceUnits: number;
  audits: AgentAutomationAuditEntry[];
}

interface DispatchOptions {
  readonly event?: AgentTriggerEvent;
  readonly scheduledFor?: string;
  readonly missed?: boolean;
  readonly manual?: boolean;
}

interface JobCounters { modelCalls: number; toolCalls: number; limit?: string; }

const SENSITIVE_CAPABILITIES = new Set<ToolCapability>(['WRITE_PRIVATE', 'NETWORK_SEND', 'DEVICE_ACTION', 'DESTRUCTIVE', 'SECURITY_SENSITIVE']);

export class AgentAutomationService {
  private readonly runtime: AgentRuntime;
  private readonly registry: ToolRegistry;
  private readonly skills: SkillRegistry;
  private readonly storage: AgentAutomationStateStore;
  private readonly chronosStore: ChronosStore;
  private readonly eventSource: AgentAutomationEventSource;
  private readonly chronos: Chronos;
  private readonly power: ChronosPowerMonitor;
  private readonly localNodeId: NodeId;
  private readonly now: () => Date;
  private readonly setTimer: (handler: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  private readonly clearTimer: (timer: ReturnType<typeof setTimeout>) => void;
  private readonly maxConcurrentJobs: number;
  private readonly maxPendingJobs: number;
  private readonly maxTriggerEventsPerMinute: number;
  private readonly maxCausalDepth: number;
  private readonly maxAuditEntries: number;
  private readonly automations = new Map<string, AgentAutomation>();
  private readonly jobs = new Map<string, AgentJob>();
  private readonly jobRuns = new Map<string, AgentJobRun>();
  private readonly audits: AgentAutomationAuditEntry[] = [];
  private readonly seenEventIds = new Set<string>();
  private readonly retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly activeJobs = new Set<string>();
  private readonly completions = new Map<string, Promise<AgentJob>>();
  private readonly cancellation = new Set<string>();
  private readonly readyPromise: Promise<void>;
  private writes: Promise<void> = Promise.resolve();
  private started = false;
  private resourceDay = '';
  private resourceUnits = 0;
  private eventWindowStart = 0;
  private eventWindowCount = 0;

  constructor(options: AgentAutomationOptions) {
    this.runtime = options.runtime;
    this.registry = options.registry;
    this.skills = options.skills;
    this.storage = options.storage ?? new InMemoryAgentAutomationStateStore();
    this.chronosStore = options.chronosStore ?? new InMemoryAgentAutomationChronosStore();
    this.eventSource = options.events ?? new InMemoryAgentAutomationEventSource();
    this.power = options.power ?? { isDeviceAwake: () => true, canRunBackgroundWork: () => true };
    this.localNodeId = options.localNodeId ?? 'local-agent-automation';
    this.now = options.now ?? (() => new Date());
    this.setTimer = options.setTimer ?? ((handler, delayMs) => setTimeout(handler, delayMs));
    this.clearTimer = options.clearTimer ?? (timer => clearTimeout(timer));
    this.maxConcurrentJobs = positiveInt(options.maxConcurrentJobs ?? 2, 1, 32);
    this.maxPendingJobs = positiveInt(options.maxPendingJobs ?? 256, 1, 10_000);
    this.maxTriggerEventsPerMinute = positiveInt(options.maxTriggerEventsPerMinute ?? 120, 1, 10_000);
    this.maxCausalDepth = positiveInt(options.maxCausalDepth ?? 8, 1, 32);
    this.maxAuditEntries = positiveInt(options.maxAuditEntries ?? 500, 1, 5_000);
    this.chronos = new Chronos({
      localNodeId: this.localNodeId,
      store: this.chronosStore,
      runner: { run: (action, context) => this.runChronosAction(action, context) },
      power: this.power,
      events: this.eventSource,
      now: () => this.now(),
      setTimer: this.setTimer,
      clearTimer: this.clearTimer,
    });
    this.readyPromise = this.hydrate();
  }

  async ready(): Promise<void> { await this.readyPromise; }
  get scheduler(): Chronos { return this.chronos; }
  get eventBus(): AgentAutomationEventSource { return this.eventSource; }

  async start(): Promise<void> {
    await this.ready();
    if (this.started) return;
    this.started = true;
    for (const automation of this.automations.values()) await this.syncRule(automation);
    await this.chronos.start();
    await this.recoverJobs();
    await this.handleMissedSchedules();
    this.armRetries();
  }

  stop(): void {
    this.started = false;
    this.chronos.stop();
    for (const timer of this.retryTimers.values()) this.clearTimer(timer);
    this.retryTimers.clear();
    for (const jobId of this.activeJobs) {
      const runId = this.jobs.get(jobId)?.agentRunId;
      if (runId) void this.runtime.cancelRun(runId).catch(() => undefined);
    }
  }

  async create(input: CreateAgentAutomationInput): Promise<AgentAutomation> {
    await this.start();
    const id = input.id ?? crypto.randomUUID();
    if (!safeId(id) || this.automations.has(id)) throw new AgentAutomationError('INVALID_ARGUMENT', 'Automation id is invalid or already exists');
    const value = await this.buildAutomation(input, id);
    this.automations.set(id, value);
    await this.persist();
    await this.syncRule(value);
    return clone(value);
  }

  async update(id: string, input: UpdateAgentAutomationInput): Promise<AgentAutomation> {
    await this.start();
    if (input.name !== undefined && (!input.name.trim() || input.name.length > 160) || input.instruction !== undefined && (!input.instruction.trim() || input.instruction.length > 1_000_000)) throw new AgentAutomationError('INVALID_ARGUMENT', 'Automation name or instruction is invalid');
    const current = this.requireAutomation(id);
    const agentId = input.agentId ?? current.agentId;
    const needsSession = agentId !== current.agentId || input.toolIds !== undefined || input.skillIds !== undefined || input.contextCapabilities !== undefined;
    let sessionId = current.sessionId;
    let toolIds = current.toolIds;
    let skillIds = current.skillIds;
    let contextCapabilities = current.contextCapabilities;
    if (needsSession) {
      const agent = await this.requireRuntimeAgent(agentId);
      const session = await this.runtime.createSession({ agentId, title: input.name ?? current.name, toolIds: input.toolIds ?? current.toolIds, skillIds: input.skillIds ?? current.skillIds, contextCapabilities: input.contextCapabilities ?? current.contextCapabilities });
      sessionId = session.id; toolIds = session.toolIds; skillIds = session.skillIds; contextCapabilities = session.contextCapabilities;
      this.assertPrivatePolicy(agent);
    }
    const agent = await this.requireRuntimeAgent(agentId);
    this.assertPrivatePolicy(agent);
    const trigger = input.trigger ?? current.trigger;
    const budget = normalizeBudget(agent, { ...current.budget, ...input.budget });
    const capabilities = this.capabilitiesFor(toolIds);
    const next: AgentAutomation = { ...current, name: input.name?.trim() || current.name, instruction: input.instruction?.trim() || current.instruction, agentId, sessionId, trigger: validateTrigger(trigger), toolIds: [...toolIds], skillIds: [...skillIds], contextCapabilities: [...contextCapabilities], privacyClass: agent.privacyClass, requiresApproval: capabilities.some(capability => SENSITIVE_CAPABILITIES.has(capability)), capabilities, budget, enabled: input.enabled ?? current.enabled, updatedAt: this.timestamp(), nextRunAt: nextRunFor(trigger, this.now()) };
    this.automations.set(id, next);
    await this.persist();
    await this.syncRule(next);
    return clone(next);
  }

  async setEnabled(id: string, enabled: boolean): Promise<AgentAutomation> {
    await this.start();
    const current = this.requireAutomation(id);
    const next = { ...current, enabled: !!enabled, updatedAt: this.timestamp(), nextRunAt: enabled ? nextRunFor(current.trigger, this.now()) : undefined };
    this.automations.set(id, next);
    if (!enabled) for (const job of this.jobs.values()) if (job.automationId === id && job.state === 'retry_wait') {
      const timer = this.retryTimers.get(job.id); if (timer) { this.clearTimer(timer); this.retryTimers.delete(job.id); }
      this.jobs.set(job.id, { ...job, state: 'skipped', updatedAt: this.timestamp(), lastErrorCode: 'DISABLED' });
    }
    await this.persist();
    await this.syncRule(next);
    return clone(next);
  }

  async remove(id: string): Promise<void> {
    await this.start();
    this.requireAutomation(id);
    this.automations.delete(id);
    await this.chronos.removeRule(chronosRuleId(id));
    for (const job of this.jobs.values()) if (job.automationId === id && !terminalJob(job.state)) {
      this.cancellation.add(job.id);
      if (job.agentRunId) await this.runtime.cancelRun(job.agentRunId).catch(() => undefined);
      const timer = this.retryTimers.get(job.id); if (timer) { this.clearTimer(timer); this.retryTimers.delete(job.id); }
      this.jobs.set(job.id, { ...job, state: 'cancelled', updatedAt: this.timestamp(), approvalState: job.approvalState, lastErrorCode: 'AUTOMATION_REMOVED' });
    }
    await this.persist();
  }

  async list(): Promise<readonly AgentAutomation[]> { await this.ready(); return [...this.automations.values()].map(clone); }
  async get(id: string): Promise<AgentAutomation | undefined> { await this.ready(); const value = this.automations.get(id); return value ? clone(value) : undefined; }
  async listJobs(automationId?: string): Promise<readonly AgentJob[]> { await this.ready(); return [...this.jobs.values()].filter(job => !automationId || job.automationId === automationId).sort(compareNewest).map(clone); }
  async getJob(id: string): Promise<AgentJob | undefined> { await this.ready(); const value = this.jobs.get(id); return value ? clone(value) : undefined; }
  async listJobRuns(jobId?: string): Promise<readonly AgentJobRun[]> { await this.ready(); return [...this.jobRuns.values()].filter(run => !jobId || run.jobId === jobId).sort((a, b) => b.startedAt.localeCompare(a.startedAt)).map(clone); }
  async listPendingApprovals(): Promise<readonly AgentJob[]> { return (await this.listJobs()).filter(job => job.state === 'waiting_for_approval'); }
  async auditLog(): Promise<readonly AgentAutomationAuditEntry[]> { await this.ready(); return this.audits.map(clone); }
  async waitForJob(id: string): Promise<AgentJob> { await this.ready(); this.requireJob(id); const completion = this.completions.get(id); if (completion) return clone(await completion); for (;;) { const job = this.requireJob(id); if (terminalJob(job.state) || job.state === 'waiting_for_approval' || job.state === 'paused' || job.state === 'retry_wait') return clone(job); await sleep(5); } }

  async runNow(id: string): Promise<AgentJob> {
    await this.start();
    const automation = this.requireAutomation(id);
    if (!automation.enabled) throw new AgentAutomationError('INVALID_ARGUMENT', 'Disabled automation cannot run manually');
    const job = await this.dispatch(automation, { manual: true, scheduledFor: this.timestamp() });
    return this.waitForJob(job.id);
  }

  async publishEvent(event: AgentTriggerEvent): Promise<boolean> {
    await this.start();
    validateEvent(event, this.maxCausalDepth);
    if (this.seenEventIds.has(event.id)) return false;
    if (!this.allowEventRate()) { await this.auditStorm(event); return false; }
    this.seenEventIds.add(event.id);
    while (this.seenEventIds.size > 10_000) this.seenEventIds.delete(this.seenEventIds.values().next().value as string);
    await this.persist();
    await this.eventSource.emit({ type: 'system', eventType: event.eventType, eventId: event.id, payload: event.payload, dataClass: event.dataClass, occurredAt: event.occurredAt, ...(event.causedBy ? { causedBy: [...event.causedBy] } : {}) });
    return true;
  }

  async approveJob(jobId: string): Promise<AgentJob> {
    await this.start();
    const job = this.requireJob(jobId);
    if (job.state !== 'waiting_for_approval') return clone(job);
    const next = { ...job, state: 'queued' as const, approvalState: 'approved' as const, updatedAt: this.timestamp() };
    this.jobs.set(jobId, next); await this.persist();
    await this.auditFor(next, 'queued', 'approved');
    await this.launch(jobId);
    return clone(this.jobs.get(jobId)!);
  }

  async rejectJob(jobId: string): Promise<AgentJob> {
    await this.start();
    const job = this.requireJob(jobId);
    if (job.state !== 'waiting_for_approval') return clone(job);
    const next = { ...job, state: 'cancelled' as const, approvalState: 'rejected' as const, updatedAt: this.timestamp(), lastErrorCode: 'APPROVAL_REJECTED' };
    this.jobs.set(jobId, next); await this.persist(); await this.auditFor(next, 'cancelled', 'rejected'); return clone(next);
  }

  async pauseJob(jobId: string): Promise<AgentJob> {
    await this.start();
    const job = this.requireJob(jobId);
    if (terminalJob(job.state) || job.state === 'waiting_for_approval') return clone(job);
    this.cancellation.add(jobId);
    if (job.agentRunId) await this.runtime.cancelRun(job.agentRunId).catch(() => undefined);
    const next = { ...job, state: 'paused' as const, updatedAt: this.timestamp() };
    this.jobs.set(jobId, next); await this.persist(); return clone(next);
  }

  async resumeJob(jobId: string): Promise<AgentJob> {
    await this.start();
    const job = this.requireJob(jobId);
    if (job.state !== 'paused') return clone(job);
    this.cancellation.delete(jobId);
    this.jobs.set(jobId, { ...job, state: 'queued', updatedAt: this.timestamp() }); await this.persist(); await this.launch(jobId); return clone(this.jobs.get(jobId)!);
  }

  async cancelJob(jobId: string): Promise<AgentJob> {
    await this.start();
    const job = this.requireJob(jobId);
    if (terminalJob(job.state)) return clone(job);
    this.cancellation.add(jobId);
    if (job.agentRunId) await this.runtime.cancelRun(job.agentRunId).catch(() => undefined);
    const next = { ...job, state: 'cancelled' as const, approvalState: job.approvalState, updatedAt: this.timestamp(), lastErrorCode: 'CANCELLED' };
    this.jobs.set(jobId, next); await this.persist(); await this.auditFor(next, 'cancelled', job.approvalState); return clone(next);
  }

  private async buildAutomation(input: CreateAgentAutomationInput, id: string): Promise<AgentAutomation> {
    if (!input.name.trim() || input.name.length > 160 || !input.instruction.trim() || input.instruction.length > 1_000_000) throw new AgentAutomationError('INVALID_ARGUMENT', 'Automation name or instruction is invalid');
    const agent = await this.requireRuntimeAgent(input.agentId);
    this.assertPrivatePolicy(agent);
    const trigger = validateTrigger(input.trigger);
    const session = await this.runtime.createSession({ agentId: agent.id, title: input.name, toolIds: input.toolIds ?? agent.toolIds, skillIds: input.skillIds ?? agent.skillIds, contextCapabilities: input.contextCapabilities ?? agent.contextCapabilities });
    const capabilities = this.capabilitiesFor(session.toolIds);
    const budget = normalizeBudget(agent, input.budget);
    const timestamp = this.timestamp();
    return { version: 1, id, name: input.name.trim(), instruction: input.instruction.trim(), agentId: agent.id, sessionId: session.id, enabled: input.enabled ?? true, trigger, toolIds: [...session.toolIds], skillIds: [...session.skillIds], contextCapabilities: [...session.contextCapabilities], privacyClass: agent.privacyClass, requiresApproval: capabilities.some(capability => SENSITIVE_CAPABILITIES.has(capability)), capabilities, budget, createdAt: timestamp, updatedAt: timestamp, nextRunAt: nextRunFor(trigger, this.now()) };
  }

  private async requireRuntimeAgent(agentId: string): Promise<Agent> {
    const agent = await this.runtime.getAgent(agentId);
    if (!agent) throw new AgentAutomationError('AGENT_NOT_FOUND', `Agent ${agentId} was not found`);
    return agent;
  }

  private assertPrivatePolicy(agent: Agent): void {
    if (agent.privacyClass === 'PRIVATE' && agent.modelPolicy === 'orchestrated-external') throw new AgentAutomationError('PRIVATE_EXTERNAL_FALLBACK_DENIED', 'Private automation requires local or trusted AI');
  }

  private capabilitiesFor(toolIds: readonly string[]): ToolCapability[] {
    const values = new Set<ToolCapability>();
    for (const toolId of toolIds) {
      const tool = this.registry.get(toolId);
      if (!tool) throw new AgentAutomationError('CAPABILITY_REVOKED', `Tool ${toolId} is no longer registered`);
      for (const capability of tool.capabilities) values.add(capability);
    }
    return [...values];
  }

  private async syncRule(automation: AgentAutomation): Promise<void> {
    const rule: ChronosRule = { version: 1, id: chronosRuleId(automation.id), name: `Agent automation: ${automation.name}`.slice(0, 256), enabled: automation.enabled, trigger: automation.trigger.type === 'schedule' ? { type: 'schedule', cron: automation.trigger.schedule.cron, ...(automation.trigger.schedule.timeZone ? { timeZone: automation.trigger.schedule.timeZone } : {}) } : { type: 'system', eventType: automation.trigger.event.eventType }, action: { type: 'ai.workflow', instruction: `${AGENT_AUTOMATION_PREFIX}${automation.id}` }, allowSelfDelegation: false, createdAt: automation.createdAt };
    await this.chronos.upsertRule(rule);
  }

  private async runChronosAction(action: ChronosAction, context: ChronosRunContext): Promise<{ summary: string }> {
    if (action.type !== 'ai.workflow' || !action.instruction.startsWith(AGENT_AUTOMATION_PREFIX)) return { summary: 'No agent automation action' };
    const id = action.instruction.slice(AGENT_AUTOMATION_PREFIX.length);
    const automation = this.requireAutomation(id);
    if (!automation.enabled) return { summary: 'Automation is disabled' };
    const event = context.event?.type === 'system' ? fromChronosEvent(context.event) : undefined;
    if (automation.trigger.type === 'event' && !event) return { summary: 'Invalid automation event rejected' };
    const job = await this.dispatch(automation, { event, scheduledFor: context.event?.occurredAt ?? this.timestamp() });
    if (job.state === 'queued' || job.state === 'running') await this.waitForJob(job.id);
    return { summary: this.jobs.get(job.id)?.state === 'waiting_for_approval' ? 'Waiting for approval' : 'Agent automation completed' };
  }

  private async dispatch(automation: AgentAutomation, options: DispatchOptions): Promise<AgentJob> {
    if (!automation.enabled && !options.manual) return this.createSkippedJob(automation, options, 'DISABLED');
    if (options.event && options.event.causedBy?.includes(automation.id)) return this.createSkippedJob(automation, options, 'RECURSION_BLOCKED');
    if (options.event && (options.event.causedBy?.length ?? 0) >= this.maxCausalDepth) return this.createSkippedJob(automation, options, 'MAX_CAUSAL_DEPTH');
    if (options.event && automation.trigger.type === 'event' && !matchesFilter(options.event.payload, automation.trigger.event.filter)) return this.createSkippedJob(automation, options, 'FILTER_MISMATCH');
    const triggerKey = options.manual ? `manual:${crypto.randomUUID()}` : options.event ? `event:${options.event.id}` : `schedule:${options.scheduledFor ?? this.timestamp()}`;
    const jobId = options.manual ? `agent-job-${randomId()}` : deterministicAutomationJobId(automation.id, triggerKey);
    const existing = this.jobs.get(jobId);
    if (existing) return clone(existing);
    const pending = [...this.jobs.values()].filter(job => !terminalJob(job.state)).length;
    if (pending >= this.maxPendingJobs) return this.createSkippedJob(automation, options, 'PENDING_LIMIT');
    const timestamp = this.timestamp();
    const job: AgentJob = { version: 1, id: jobId, automationId: automation.id, triggerType: automation.trigger.type, ...(options.event ? { triggerEventId: options.event.id, triggerEventType: options.event.eventType, triggerDataClass: options.event.dataClass } : {}), ...(options.scheduledFor ? { scheduledFor: options.scheduledFor } : {}), createdAt: timestamp, updatedAt: timestamp, state: automation.requiresApproval ? 'waiting_for_approval' : 'queued', attempt: 0, approvalState: automation.requiresApproval ? 'pending' : 'not_required', missed: options.missed === true };
    this.jobs.set(jobId, job);
    if (automation.trigger.type === 'schedule' && options.scheduledFor) this.updateLastSchedule(automation.id, options.scheduledFor);
    await this.persist();
    await this.auditFor(job, automation.requiresApproval ? 'waiting_for_approval' : 'queued', job.approvalState);
    if (job.state === 'queued') {
      const completion = this.launch(jobId);
      this.completions.set(jobId, completion);
      await completion;
    }
    return clone(this.jobs.get(jobId)!);
  }

  private async createSkippedJob(automation: AgentAutomation, options: DispatchOptions, reason: string): Promise<AgentJob> {
    const key = options.event ? `event:${options.event.id}` : options.scheduledFor ? `schedule:${options.scheduledFor}` : `skip:${this.timestamp()}`;
    const id = deterministicAutomationJobId(automation.id, key);
    const existing = this.jobs.get(id); if (existing) return clone(existing);
    const timestamp = this.timestamp();
    const job: AgentJob = { version: 1, id, automationId: automation.id, triggerType: automation.trigger.type, ...(options.event ? { triggerEventId: options.event.id, triggerEventType: options.event.eventType, triggerDataClass: options.event.dataClass } : {}), ...(options.scheduledFor ? { scheduledFor: options.scheduledFor } : {}), createdAt: timestamp, updatedAt: timestamp, state: reason === 'MISSED' ? 'missed' : 'skipped', attempt: 0, approvalState: 'not_required', missed: reason === 'MISSED', lastErrorCode: reason };
    this.jobs.set(id, job); await this.persist(); await this.auditFor(job, job.state, job.approvalState, reason); return clone(job);
  }

  private async launch(jobId: string): Promise<AgentJob> {
    if (this.activeJobs.has(jobId)) return clone(this.jobs.get(jobId)!);
    let job = this.requireJob(jobId); const automation = this.requireAutomation(job.automationId);
    if (job.state !== 'queued') return clone(job);
    if (!automation.enabled) {
      const next = { ...job, state: 'skipped' as const, updatedAt: this.timestamp(), lastErrorCode: 'DISABLED' };
      this.jobs.set(jobId, next); await this.persist(); await this.auditFor(next, 'skipped', next.approvalState, 'DISABLED'); return clone(next);
    }
    if (this.activeJobs.size >= this.maxConcurrentJobs) {
      const next = { ...job, state: 'skipped' as const, updatedAt: this.timestamp(), lastErrorCode: 'CONCURRENCY_LIMIT' };
      this.jobs.set(jobId, next); await this.persist(); await this.auditFor(next, 'skipped', next.approvalState, 'CONCURRENCY_LIMIT'); return clone(next);
    }
    if (!this.allowResourceUnit(automation)) { const next = { ...job, state: 'skipped' as const, updatedAt: this.timestamp(), lastErrorCode: 'RESOURCE_BUDGET' }; this.jobs.set(jobId, next); await this.persist(); await this.auditFor(next, 'skipped', next.approvalState, 'RESOURCE_BUDGET'); return clone(next); }
    try { this.validateCapabilities(automation); } catch (error) { const next = { ...job, state: 'failed' as const, updatedAt: this.timestamp(), lastErrorCode: error instanceof AgentAutomationError ? error.code : 'CAPABILITY_REVOKED' }; this.jobs.set(jobId, next); await this.persist(); await this.auditFor(next, 'failed', next.approvalState, next.lastErrorCode); return clone(next); }
    this.activeJobs.add(jobId);
    const attempt = job.attempt + 1;
    const jobRunId = deterministicAutomationRunId(job.id, attempt);
    const timestamp = this.timestamp();
    const jobRun: AgentJobRun = { version: 1, id: jobRunId, jobId, automationId: automation.id, attempt, state: 'running', modelCalls: 0, toolCalls: 0, resourceUnits: 0, startedAt: timestamp, approvalState: automation.requiresApproval ? 'approved' : 'not_required' };
    this.jobRuns.set(jobRunId, jobRun);
    job = { ...job, state: 'running', attempt, updatedAt: timestamp, approvalState: automation.requiresApproval ? 'approved' : job.approvalState };
    this.jobs.set(jobId, job); await this.persist(); await this.auditFor(job, 'started', job.approvalState);
    const counters: JobCounters = { modelCalls: 0, toolCalls: 0 };
    try {
      const session = await this.runtime.getSession(automation.sessionId);
      if (!session) throw new AgentAutomationError('FAILED', 'Automation session is unavailable');
      const attachments = this.eventAttachment(job, session.contextCapabilities);
      const input: AgentRunInput = { text: automation.instruction, ...(attachments ? { attachments } : {}), limits: { maxRuntimeMs: automation.budget.maxRuntimeMs, maxToolIterations: automation.budget.maxModelCalls } };
      const agentRun = await this.runtime.startRun(session.id, input);
      this.jobs.set(jobId, { ...this.jobs.get(jobId)!, agentRunId: agentRun.id, updatedAt: this.timestamp() });
      await this.persist();
      const monitor = this.monitorAgentRun(agentRun.id, automation, counters, jobId);
      const completed = await this.runtime.waitForRun(agentRun.id);
      await monitor;
      counters.modelCalls = Math.max(counters.modelCalls, completed.iteration);
      counters.toolCalls = Math.max(counters.toolCalls, completed.toolCallCount);
      if (counters.limit) throw new AgentAutomationError('RESOURCE_BUDGET', counters.limit);
      const state: AgentJobRunState = completed.state === 'cancelled' ? 'cancelled' : completed.state === 'completed' ? 'succeeded' : 'failed';
      const errorCode = completed.errorCode;
      const units = 1 + counters.modelCalls + counters.toolCalls;
      if (this.resourceUnits + units > automation.budget.dailyResourceUnits) throw new AgentAutomationError('RESOURCE_BUDGET', 'Daily local resource budget exhausted');
      this.resourceUnits += units;
      this.jobRuns.set(jobRunId, { ...this.jobRuns.get(jobRunId)!, state, agentRunId: completed.id, modelCalls: counters.modelCalls, toolCalls: counters.toolCalls, resourceUnits: units, completedAt: this.timestamp(), ...(errorCode ? { errorCode } : {}) });
      const current = this.jobs.get(jobId)!;
      if (this.cancellation.has(jobId) || current.state === 'paused') this.jobs.set(jobId, { ...current, state: current.state === 'paused' ? 'paused' : 'cancelled', updatedAt: this.timestamp() });
      else if (state === 'succeeded') this.jobs.set(jobId, { ...current, state: 'succeeded', updatedAt: this.timestamp() });
      else await this.finishFailedJob(current, errorCode ?? state.toUpperCase());
    } catch (error) {
      const code = error instanceof AgentAutomationError ? error.code : error instanceof AgentError ? error.code : 'FAILED';
      const currentRun = this.jobRuns.get(jobRunId);
      if (currentRun?.state === 'running') this.jobRuns.set(jobRunId, { ...currentRun, state: 'failed', completedAt: this.timestamp(), errorCode: code });
      const current = this.jobs.get(jobId)!;
      if (!this.cancellation.has(jobId) && current.state !== 'paused') await this.finishFailedJob(current, code);
      else if (current.state !== 'paused') this.jobs.set(jobId, { ...current, state: 'cancelled', updatedAt: this.timestamp(), lastErrorCode: 'CANCELLED' });
    } finally {
      this.activeJobs.delete(jobId); this.cancellation.delete(jobId); this.completions.delete(jobId); await this.persist();
      const final = this.jobs.get(jobId)!; await this.auditFor(final, final.state, final.approvalState, final.lastErrorCode);
    }
    return clone(this.jobs.get(jobId)!);
  }

  private async monitorAgentRun(agentRunId: string, automation: AgentAutomation, counters: JobCounters, jobId: string): Promise<void> {
    for await (const event of this.runtime.streamRun(agentRunId)) {
      if (event.type === 'assistant') counters.modelCalls += 1;
      if (event.type === 'tool_call') counters.toolCalls += 1;
      if (counters.modelCalls > automation.budget.maxModelCalls) counters.limit = 'MAX_MODEL_CALLS';
      if (counters.toolCalls > automation.budget.maxToolCalls) counters.limit = 'MAX_TOOL_CALLS';
      if (1 + counters.modelCalls + counters.toolCalls + this.resourceUnits > automation.budget.dailyResourceUnits) counters.limit = 'DAILY_RESOURCE_BUDGET';
      if (counters.limit) { await this.runtime.cancelRun(agentRunId).catch(() => undefined); return; }
      if (this.cancellation.has(jobId)) return;
    }
  }

  private validateCapabilities(automation: AgentAutomation): void {
    for (const toolId of automation.toolIds) {
      const tool = this.registry.get(toolId);
      if (!tool) throw new AgentAutomationError('CAPABILITY_REVOKED', `Tool ${toolId} is no longer registered`);
      for (const skillId of automation.skillIds) {
        const skill = this.skills.get(skillId);
        if (!skill || !skill.enabled || !skill.toolIds.includes(toolId) || !tool.capabilities.every(capability => skill.approvedCapabilities.includes(capability))) throw new AgentAutomationError('CAPABILITY_REVOKED', `Skill capability for ${toolId} is no longer approved`);
      }
    }
  }

  private eventAttachment(job: AgentJob, capabilities: readonly AgentContextCapability[]): readonly AIContextItem[] | undefined {
    if (!job.triggerEventId || !capabilities.includes('ATTACHMENTS')) return undefined;
    return [{ id: `automation-event:${job.triggerEventId}`, source: 'chronos-event', dataClass: job.triggerDataClass ?? 'PUBLIC', value: { eventId: job.triggerEventId, eventType: job.triggerEventType } }];
  }

  private eventForJob(job: AgentJob): AgentTriggerEvent | undefined { return job.triggerEventId && job.triggerEventType ? { id: job.triggerEventId, eventType: job.triggerEventType, occurredAt: job.scheduledFor ?? this.timestamp(), dataClass: job.triggerDataClass ?? 'PUBLIC' } : undefined; }

  private async finishFailedJob(job: AgentJob, errorCode: string): Promise<void> {
    const automation = this.requireAutomation(job.automationId);
    if (job.attempt <= automation.budget.maxRetries && automation.enabled) {
      const nextAttemptAt = new Date(this.now().getTime() + backoff(automation.budget.retryBackoffMs, job.attempt)).toISOString();
      const next = { ...job, state: 'retry_wait' as const, nextAttemptAt, updatedAt: this.timestamp(), lastErrorCode: errorCode };
      this.jobs.set(job.id, next); await this.persist(); await this.auditFor(next, 'retry_scheduled', next.approvalState, errorCode); this.scheduleRetry(next); return;
    }
    this.jobs.set(job.id, { ...job, state: 'failed', updatedAt: this.timestamp(), lastErrorCode: errorCode });
  }

  private scheduleRetry(job: AgentJob): void {
    if (!job.nextAttemptAt) return;
    const delayMs = Math.max(0, Date.parse(job.nextAttemptAt) - this.now().getTime());
    const existing = this.retryTimers.get(job.id); if (existing) this.clearTimer(existing);
    const timer = this.setTimer(() => { this.retryTimers.delete(job.id); void this.retryJob(job.id); }, Math.min(delayMs, 2_147_000_000));
    this.retryTimers.set(job.id, timer);
  }

  private async retryJob(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId); if (!job || job.state !== 'retry_wait') return;
    const automation = this.automations.get(job.automationId);
    if (!automation?.enabled) { const next = { ...job, state: 'skipped' as const, updatedAt: this.timestamp(), lastErrorCode: 'DISABLED' }; this.jobs.set(jobId, next); await this.persist(); if (automation) await this.auditFor(next, 'skipped', next.approvalState, 'DISABLED'); return; }
    this.jobs.set(jobId, { ...job, state: 'queued', nextAttemptAt: undefined, updatedAt: this.timestamp() }); await this.persist(); const completion = this.launch(jobId); this.completions.set(jobId, completion); await completion;
  }

  private armRetries(): void { for (const job of this.jobs.values()) if (job.state === 'retry_wait') this.scheduleRetry(job); }

  private async recoverJobs(): Promise<void> {
    for (const job of [...this.jobs.values()]) {
      if (job.state === 'running') {
        const run = [...this.jobRuns.values()].find(value => value.jobId === job.id && value.attempt === job.attempt);
        if (run) this.jobRuns.set(run.id, { ...run, state: 'failed', completedAt: this.timestamp(), errorCode: 'CRASHED' });
        const automation = this.automations.get(job.automationId);
        if (automation && job.attempt <= automation.budget.maxRetries) { this.jobs.set(job.id, { ...job, state: 'retry_wait', nextAttemptAt: this.timestamp(), updatedAt: this.timestamp(), lastErrorCode: 'CRASHED' }); }
        else this.jobs.set(job.id, { ...job, state: 'failed', updatedAt: this.timestamp(), lastErrorCode: 'CRASHED' });
      }
    }
    await this.persist();
    for (const job of this.jobs.values()) if (job.state === 'queued') { const completion = this.launch(job.id); this.completions.set(job.id, completion); }
  }

  private async handleMissedSchedules(): Promise<void> {
    const now = this.now();
    for (const automation of this.automations.values()) {
      if (!automation.enabled || automation.trigger.type !== 'schedule') continue;
      const base = automation.lastScheduledAt ? new Date(automation.lastScheduledAt) : automation.nextRunAt ? new Date(automation.nextRunAt) : undefined;
      if (!base || !Number.isFinite(base.getTime())) continue;
      const occurrence = automation.lastScheduledAt ? nextCronDate(automation.trigger.schedule.cron, base, automation.trigger.schedule.timeZone) : base;
      if (occurrence.getTime() > now.getTime()) continue;
      const options: DispatchOptions = { scheduledFor: occurrence.toISOString(), missed: true };
      if ((automation.trigger.schedule.missedRunPolicy ?? 'run_once') === 'skip') {
        this.updateLastSchedule(automation.id, occurrence.toISOString());
        await this.createSkippedJob(automation, options, 'MISSED');
        await this.persist();
      } else await this.dispatch(automation, options);
    }
  }

  private updateLastSchedule(id: string, scheduledFor: string): void {
    const automation = this.automations.get(id); if (!automation || automation.trigger.type !== 'schedule') return;
    this.automations.set(id, { ...automation, lastScheduledAt: scheduledFor, nextRunAt: nextRunFor(automation.trigger, this.now()), updatedAt: this.timestamp() });
  }

  private allowEventRate(): boolean {
    const now = this.now().getTime();
    if (now - this.eventWindowStart >= 60_000) { this.eventWindowStart = now; this.eventWindowCount = 0; }
    if (this.eventWindowCount >= this.maxTriggerEventsPerMinute) return false;
    this.eventWindowCount += 1; return true;
  }

  private async auditStorm(event: AgentTriggerEvent): Promise<void> {
    const timestamp = this.timestamp();
    const entry: AgentAutomationAuditEntry = { id: crypto.randomUUID(), automationId: 'system', agentId: 'system', trigger: event.eventType, tools: [], resultStatus: 'trigger_storm_bounded', approvalState: 'not_required', timestamp, errorCode: 'TRIGGER_STORM' };
    this.audits.push(entry); this.trimAudits(); await this.persist();
  }

  private async auditFor(job: AgentJob, resultStatus: string, approvalState: string, errorCode?: string): Promise<void> {
    const automation = this.automations.get(job.automationId); if (!automation) return;
    const run = [...this.jobRuns.values()].find(value => value.jobId === job.id && value.attempt === job.attempt);
    const entry: AgentAutomationAuditEntry = { id: crypto.randomUUID(), automationId: automation.id, agentId: automation.agentId, ...(job.id ? { jobId: job.id } : {}), ...(run ? { jobRunId: run.id } : {}), trigger: triggerLabel(automation.trigger), tools: [...automation.toolIds], resultStatus, approvalState, timestamp: this.timestamp(), ...(errorCode ? { errorCode: errorCode.slice(0, 120) } : {}) };
    this.audits.push(entry); this.trimAudits();
    const chronosEntry: ChronosAuditEntry = { id: entry.id, ruleId: chronosRuleId(automation.id), ruleName: automation.name.slice(0, 256), nodeId: this.localNodeId, status: chronosStatus(resultStatus), timestamp: entry.timestamp, message: errorCode ? `Agent automation ${resultStatus}: ${errorCode}` : `Agent automation ${resultStatus}`, automationId: automation.id, agentId: automation.agentId, trigger: entry.trigger, tools: entry.tools, resultStatus, approvalState };
    await this.chronosStore.appendAudit(chronosEntry);
    await this.persist();
  }

  private trimAudits(): void { while (this.audits.length > this.maxAuditEntries) this.audits.shift(); }
  private allowResourceUnit(automation: AgentAutomation): boolean { this.refreshResourceDay(); return this.resourceUnits < automation.budget.dailyResourceUnits; }
  private refreshResourceDay(): void { const day = this.now().toISOString().slice(0, 10); if (this.resourceDay !== day) { this.resourceDay = day; this.resourceUnits = 0; } }

  private async hydrate(): Promise<void> {
    const raw = await this.storage.read(); if (raw === undefined) { this.refreshResourceDay(); return; }
    const snapshot = parseSnapshot(raw);
    for (const automation of snapshot.automations) this.automations.set(automation.id, automation);
    for (const job of snapshot.jobs) this.jobs.set(job.id, job);
    for (const run of snapshot.jobRuns) this.jobRuns.set(run.id, run);
    for (const id of snapshot.seenEventIds) this.seenEventIds.add(id);
    this.resourceDay = snapshot.resourceDay; this.resourceUnits = snapshot.resourceUnits; this.audits.push(...snapshot.audits.slice(-this.maxAuditEntries)); this.refreshResourceDay();
  }

  private async persist(): Promise<void> { const snapshot = this.snapshot(); const operation = this.writes.then(() => this.storage.write(snapshot)); this.writes = operation.catch(() => undefined); await operation; }
  private snapshot(): AutomationSnapshot { return { version: 1, automations: [...this.automations.values()].map(clone), jobs: [...this.jobs.values()].map(clone), jobRuns: [...this.jobRuns.values()].map(clone), seenEventIds: [...this.seenEventIds], resourceDay: this.resourceDay, resourceUnits: this.resourceUnits, audits: this.audits.map(clone) }; }
  private timestamp(): string { return this.now().toISOString(); }
  private requireAutomation(id: string): AgentAutomation { const value = this.automations.get(id); if (!value) throw new AgentAutomationError('AUTOMATION_NOT_FOUND', `Automation ${id} was not found`); return value; }
  private requireJob(id: string): AgentJob { const value = this.jobs.get(id); if (!value) throw new AgentAutomationError('JOB_NOT_FOUND', `Job ${id} was not found`); return value; }
}

function validateTrigger(value: AgentTrigger): AgentTrigger {
  if (!value || typeof value !== 'object') throw new AgentAutomationError('INVALID_ARGUMENT', 'Automation trigger is invalid');
  if (value.type === 'schedule') {
    if (!value.schedule || typeof value.schedule !== 'object' || typeof value.schedule.cron !== 'string' || !value.schedule.cron.trim()) throw new AgentAutomationError('INVALID_ARGUMENT', 'Schedule is invalid');
    try { nextCronDate(value.schedule.cron, new Date(), value.schedule.timeZone); }
    catch { throw new AgentAutomationError('INVALID_ARGUMENT', 'Schedule cron or time zone is invalid'); }
    if (value.schedule.missedRunPolicy && !['run_once', 'skip'].includes(value.schedule.missedRunPolicy)) throw new AgentAutomationError('INVALID_ARGUMENT', 'Missed-run policy is invalid');
    return clone(value);
  }
  if (value.type === 'event' && value.event && typeof value.event === 'object' && AGENT_EVENT_TYPES.includes(value.event.eventType)) {
    if (value.event.filter && (Object.keys(value.event.filter).length > 32 || Object.entries(value.event.filter).some(([key, item]) => !safeFilterKey(key) || typeof item !== 'string' || item.length > 256))) throw new AgentAutomationError('INVALID_ARGUMENT', 'Event filter is invalid');
    return clone(value);
  }
  throw new AgentAutomationError('INVALID_ARGUMENT', 'Automation trigger type is unsupported');
}

function normalizeBudget(agent: Agent, input?: Partial<AgentExecutionBudget>): AgentExecutionBudget {
  const maxModelCalls = intWithin(input?.maxModelCalls ?? agent.maxToolIterations, 0, agent.maxToolIterations);
  const maxRuntimeMs = intWithin(input?.maxRuntimeMs ?? agent.maxRuntimeMs, 100, agent.maxRuntimeMs);
  return { maxRuntimeMs, maxToolCalls: positiveInt(input?.maxToolCalls ?? 32, 1, 10_000), maxModelCalls, maxRetries: positiveInt(input?.maxRetries ?? 0, 0, 10), retryBackoffMs: positiveInt(input?.retryBackoffMs ?? 1_000, 0, 86_400_000), dailyResourceUnits: positiveInt(input?.dailyResourceUnits ?? 100, 1, 1_000_000) };
}

function validateEvent(value: AgentTriggerEvent, maxCausalDepth: number): void {
  if (!value || !safeId(value.id) || !AGENT_EVENT_TYPES.includes(value.eventType) || !Number.isFinite(Date.parse(value.occurredAt)) || !['PUBLIC', 'USER_EXPLICIT', 'PRIVATE', 'SECRET'].includes(value.dataClass) || (value.causedBy?.length ?? 0) > maxCausalDepth) throw new AgentAutomationError('INVALID_ARGUMENT', 'Automation event is invalid');
  if (value.source && !safeId(value.source)) throw new AgentAutomationError('INVALID_ARGUMENT', 'Automation event source is invalid');
}

function matchesFilter(payload: unknown, filter?: Readonly<Record<string, string>>): boolean {
  if (!filter) return true;
  if (!payload || typeof payload !== 'object') return false;
  const record = payload as Record<string, unknown>;
  return Object.entries(filter).every(([key, expected]) => typeof record[key] === 'string' && record[key] === expected);
}
function safeFilterKey(value: string): boolean { return /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/.test(value); }

function fromChronosEvent(event: Extract<ChronosSystemEvent, { type: 'system' }>): AgentTriggerEvent | undefined {
  if (!AGENT_EVENT_TYPES.includes(event.eventType as AgentEventType) || !event.eventId) return undefined;
  return { id: event.eventId, eventType: event.eventType as AgentEventType, occurredAt: event.occurredAt, dataClass: event.dataClass ?? 'PUBLIC', payload: event.payload, ...(event.causedBy ? { causedBy: [...event.causedBy] } : {}) };
}

function chronosRuleId(id: string): string { return `agent-automation:${id}`; }
function triggerLabel(trigger: AgentTrigger): string { return trigger.type === 'schedule' ? `schedule:${trigger.schedule.cron}` : `event:${trigger.event.eventType}`; }
function nextRunFor(trigger: AgentTrigger, now: Date): string | undefined { return trigger.type === 'schedule' ? nextCronDate(trigger.schedule.cron, now, trigger.schedule.timeZone).toISOString() : undefined; }
function deterministicAutomationJobId(automationId: string, key: string): string { return `agent-job-${fnv64(`${automationId}:${key}`)}`; }
function deterministicAutomationRunId(jobId: string, attempt: number): string { return `agent-job-run-${fnv64(`${jobId}:${attempt}`)}`; }
function backoff(base: number, attempt: number): number { return Math.min(86_400_000, base * 2 ** Math.max(0, attempt - 1)); }
function chronosStatus(value: string): ChronosAuditEntry['status'] { if (value === 'started') return 'started'; if (value === 'succeeded') return 'succeeded'; if (value === 'delegated') return 'delegated'; if (value === 'skipped' || value === 'missed') return 'skipped'; if (value === 'waiting_for_approval') return 'waiting_for_approval'; if (value === 'retry_scheduled') return 'retry_scheduled'; if (value === 'cancelled') return 'cancelled'; return 'failed'; }
function terminalJob(value: AgentJobState): boolean { return value === 'succeeded' || value === 'failed' || value === 'skipped' || value === 'cancelled' || value === 'missed'; }
function compareNewest(a: AgentJob, b: AgentJob): number { return b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id); }
function positiveInt(value: number, min: number, max: number): number { if (!Number.isSafeInteger(value) || value < min || value > max) throw new AgentAutomationError('INVALID_ARGUMENT', 'Automation numeric limit is invalid'); return value; }
function intWithin(value: number, min: number, max: number): number { return positiveInt(value, min, max); }
function safeId(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value); }
function clone<T>(value: T): T { return structuredClone(value); }
function randomId(): string { return crypto.randomUUID(); }
function fnv64(value: string): string { let hash = 14695981039346656037n; for (const byte of new TextEncoder().encode(value)) { hash ^= BigInt(byte); hash = BigInt.asUintN(64, hash * 1099511628211n); } return hash.toString(16).padStart(16, '0'); }
function sleep(ms: number): Promise<void> { return new Promise(resolve => setTimeout(resolve, ms)); }

function parseSnapshot(value: unknown): AutomationSnapshot {
  if (!value || typeof value !== 'object' || (value as { version?: unknown }).version !== 1) throw new AgentAutomationError('FAILED', 'Invalid automation state version');
  const candidate = value as Partial<AutomationSnapshot>;
  if (!Array.isArray(candidate.automations) || !Array.isArray(candidate.jobs) || !Array.isArray(candidate.jobRuns) || !Array.isArray(candidate.seenEventIds) || !Array.isArray(candidate.audits) || typeof candidate.resourceDay !== 'string' || typeof candidate.resourceUnits !== 'number') throw new AgentAutomationError('FAILED', 'Invalid automation state shape');
  const automations = candidate.automations.map(parseAutomation); const jobs = candidate.jobs.map(parseJob); const jobRuns = candidate.jobRuns.map(parseJobRun);
  const automationIds = new Set(automations.map(value => value.id)); const jobIds = new Set(jobs.map(value => value.id));
  if (automationIds.size !== automations.length || jobIds.size !== jobs.length || jobs.some(value => !automationIds.has(value.automationId)) || jobRuns.some(value => !jobIds.has(value.jobId))) throw new AgentAutomationError('FAILED', 'Invalid automation state references');
  return { version: 1, automations, jobs, jobRuns, seenEventIds: candidate.seenEventIds.filter(safeId).slice(-10_000), resourceDay: candidate.resourceDay, resourceUnits: Math.max(0, candidate.resourceUnits), audits: candidate.audits.map(value => clone(value)).slice(-5_000) };
}

function parseAutomation(value: unknown): AgentAutomation { if (!value || typeof value !== 'object') throw new AgentAutomationError('FAILED', 'Invalid automation'); const candidate = value as AgentAutomation; if (candidate.version !== 1 || !safeId(candidate.id) || !safeId(candidate.agentId) || !safeId(candidate.sessionId) || typeof candidate.name !== 'string' || typeof candidate.instruction !== 'string' || !Array.isArray(candidate.toolIds) || !Array.isArray(candidate.skillIds) || !Array.isArray(candidate.contextCapabilities) || !candidate.trigger || !candidate.budget) throw new AgentAutomationError('FAILED', 'Invalid automation'); validateTrigger(candidate.trigger); return clone(candidate); }
function parseJob(value: unknown): AgentJob { if (!value || typeof value !== 'object') throw new AgentAutomationError('FAILED', 'Invalid automation job'); const candidate = value as AgentJob; if (candidate.version !== 1 || !safeId(candidate.id) || !safeId(candidate.automationId) || !['queued','waiting_for_approval','running','paused','retry_wait','succeeded','failed','skipped','cancelled','missed'].includes(candidate.state) || !Number.isSafeInteger(candidate.attempt)) throw new AgentAutomationError('FAILED', 'Invalid automation job'); return clone(candidate); }
function parseJobRun(value: unknown): AgentJobRun { if (!value || typeof value !== 'object') throw new AgentAutomationError('FAILED', 'Invalid automation job run'); const candidate = value as AgentJobRun; if (candidate.version !== 1 || !safeId(candidate.id) || !safeId(candidate.jobId) || !safeId(candidate.automationId) || !['running','succeeded','failed','cancelled'].includes(candidate.state) || !Number.isSafeInteger(candidate.attempt) || !Number.isSafeInteger(candidate.modelCalls) || !Number.isSafeInteger(candidate.toolCalls)) throw new AgentAutomationError('FAILED', 'Invalid automation job run'); return clone(candidate); }
