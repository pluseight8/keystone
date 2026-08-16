import { describe, expect, it } from 'vitest';
import {
  AgentAutomationError,
  AgentAutomationService,
  InMemoryAgentAutomationChronosStore,
  InMemoryAgentAutomationEventSource,
  InMemoryAgentAutomationStateStore,
  type AgentTriggerEvent,
} from './automation.js';
import { AgentRuntime, type AgentModelGateway } from './agents.js';
import { computeSkillIntegrityHash, SkillRegistry, ToolRegistry, type Skill, type Tool } from './tools.js';
import { z } from 'zod';

function localGateway(handler?: AgentModelGateway['complete']): AgentModelGateway {
  return { execution: 'local', model: { provider: 'test-local', model: 'small' }, complete: handler ?? (async () => ({ text: 'done', toolProposals: [] })) };
}

async function runtimeWith(gateway?: AgentModelGateway, storage?: InMemoryAgentAutomationStateStore) {
  const registry = new ToolRegistry();
  const skills = new SkillRegistry();
  const runtime = new AgentRuntime({ registry, skills, storage, local: gateway ?? localGateway() });
  await runtime.ready();
  const agent = await runtime.createAgent({ id: `automation-agent-${crypto.randomUUID()}`, name: 'Automation test agent', profileId: 'Personal', toolIds: [], skillIds: [], contextCapabilities: [] });
  return { runtime, registry, skills, agent };
}

function scheduleTrigger() {
  return { type: 'schedule' as const, schedule: { cron: '*/5 * * * *', missedRunPolicy: 'run_once' as const } };
}

function eventTrigger(eventType: 'file.created' | 'live.started' = 'file.created') {
  return { type: 'event' as const, event: { eventType } };
}

async function eventually(check: () => Promise<boolean> | boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() >= deadline) throw new Error('condition was not reached');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

describe('AgentAutomationService', () => {
  it('runs a scheduled automation through the Chronos action bridge', async () => {
    const setup = await runtimeWith();
    const chronosStore = new InMemoryAgentAutomationChronosStore();
    const service = new AgentAutomationService({ runtime: setup.runtime, registry: setup.registry, skills: setup.skills, chronosStore });
    const automation = await service.create({ name: 'Morning summary', instruction: 'Summarize local unread communities', agentId: setup.agent.id, trigger: scheduleTrigger() });
    await service.scheduler.runNow(`agent-automation:${automation.id}`);
    const job = (await service.listJobs(automation.id))[0]!;
    expect(job.state).toBe('succeeded');
    expect((await service.listJobRuns(job.id))[0]?.state).toBe('succeeded');
    expect(chronosStore.listAudits().some(entry => entry.automationId === automation.id && entry.resultStatus === 'succeeded' && entry.agentId === setup.agent.id)).toBe(true);
    service.stop();
  });

  it('dispatches typed events once and rejects replayed event ids', async () => {
    const setup = await runtimeWith();
    const service = new AgentAutomationService({ runtime: setup.runtime, registry: setup.registry, skills: setup.skills, maxTriggerEventsPerMinute: 8 });
    const automation = await service.create({ name: 'Classify files', instruction: 'Classify the new file locally', agentId: setup.agent.id, trigger: eventTrigger() });
    const event: AgentTriggerEvent = { id: 'event-file-1', eventType: 'file.created', occurredAt: new Date().toISOString(), dataClass: 'PRIVATE', payload: { fileId: 'file-1' } };
    expect(await service.publishEvent(event)).toBe(true);
    expect(await service.publishEvent(event)).toBe(false);
    await eventually(async () => (await service.listJobs(automation.id)).length === 1);
    expect((await service.listJobs(automation.id))[0]?.triggerEventId).toBe(event.id);
    service.stop();
  });

  it('holds sensitive automations at the approval boundary until explicitly approved', async () => {
    const sensitive: Tool<unknown, { ok: true }> = { version: 1, id: 'automation.write', name: 'Write private state', description: 'Test mutation', capabilities: ['WRITE_PRIVATE'], inputSchema: z.object({}).strict(), outputSchema: z.object({ ok: z.literal(true) }).strict(), resultClass: 'PRIVATE', execute: () => ({ ok: true }) };
    const registry = new ToolRegistry(); registry.register(sensitive);
    const skills = new SkillRegistry();
    const runtime = new AgentRuntime({ registry, skills, local: localGateway() }); await runtime.ready();
    const agent = await runtime.createAgent({ id: 'sensitive-automation-agent', name: 'Sensitive automation agent', profileId: 'Personal', toolIds: ['automation.write'], skillIds: [], contextCapabilities: [] });
    const service = new AgentAutomationService({ runtime, registry, skills });
    const automation = await service.create({ name: 'Save classification', instruction: 'Save the local result', agentId: agent.id, trigger: scheduleTrigger(), toolIds: ['automation.write'], skillIds: [] });
    const waiting = await service.runNow(automation.id);
    expect(waiting.state).toBe('waiting_for_approval');
    expect((await service.listPendingApprovals()).map(job => job.id)).toContain(waiting.id);
    const approved = await service.approveJob(waiting.id);
    expect(approved.state).toBe('succeeded');
    service.stop();
  });

  it('retries failed model runs with bounded backoff', async () => {
    let calls = 0;
    const setup = await runtimeWith(localGateway(async () => { calls += 1; if (calls === 1) throw new Error('temporary model failure'); return { text: 'recovered', toolProposals: [] }; }));
    const service = new AgentAutomationService({ runtime: setup.runtime, registry: setup.registry, skills: setup.skills });
    const automation = await service.create({ name: 'Retry local summary', instruction: 'Retry safely', agentId: setup.agent.id, trigger: scheduleTrigger(), budget: { maxRetries: 1, retryBackoffMs: 0 } });
    const first = await service.runNow(automation.id);
    expect(first.state).toBe('retry_wait');
    await eventually(async () => (await service.getJob(first.id))?.state === 'succeeded');
    expect(calls).toBe(2);
    service.stop();
  });

  it('runs one missed schedule after restart according to the missed-run policy', async () => {
    const agentStorage = new InMemoryAgentAutomationStateStore(); const automationStorage = new InMemoryAgentAutomationStateStore();
    let now = new Date('2026-01-01T00:01:00.000Z');
    const first = await runtimeWith(undefined, agentStorage);
    const service1 = new AgentAutomationService({ runtime: first.runtime, registry: first.registry, skills: first.skills, storage: automationStorage, now: () => new Date(now) });
    const automation = await service1.create({ name: 'Missed daily summary', instruction: 'Run once after waking', agentId: first.agent.id, trigger: { type: 'schedule', schedule: { cron: '0 0 * * *', timeZone: 'UTC', missedRunPolicy: 'run_once' } } });
    expect(automation.nextRunAt).toBe('2026-01-02T00:00:00.000Z');
    service1.stop(); now = new Date('2026-01-03T00:01:00.000Z');
    const second = await runtimeWith(undefined, agentStorage);
    const service2 = new AgentAutomationService({ runtime: second.runtime, registry: second.registry, skills: second.skills, storage: automationStorage, now: () => new Date(now) });
    await service2.start();
    await eventually(async () => (await service2.listJobs(automation.id)).length === 1);
    const missed = (await service2.listJobs(automation.id))[0]!;
    expect(missed.missed).toBe(true); expect(missed.state).toBe('succeeded');
    service2.stop();
  });

  it('stops future jobs immediately when an approved skill is revoked', async () => {
    const registry = new ToolRegistry();
    const read: Tool<unknown, { value: string }> = { version: 1, id: 'automation.read', name: 'Read local state', description: 'Test read', capabilities: ['READ_PRIVATE'], inputSchema: z.object({}).strict(), outputSchema: z.object({ value: z.string() }).strict(), resultClass: 'PRIVATE', execute: () => ({ value: 'private' }) };
    registry.register(read);
    const skills = new SkillRegistry();
    const manifest = { version: 1 as const, id: 'automation-skill', name: 'Automation skill', packageVersion: '1.0.0', instructions: 'Use the typed reader.', toolIds: ['automation.read'], declaredCapabilities: ['READ_PRIVATE'] as const, source: 'local' as const };
    const skill: Skill = { ...manifest, integrityHash: await computeSkillIntegrityHash(manifest), enabled: true, approvedCapabilities: [] };
    await skills.install(skill, { approvedCapabilities: ['READ_PRIVATE'] });
    const runtime = new AgentRuntime({ registry, skills, local: localGateway() }); await runtime.ready();
    const agent = await runtime.createAgent({ id: 'revocation-automation-agent', name: 'Revocation automation agent', profileId: 'Personal', toolIds: ['automation.read'], skillIds: ['automation-skill'], contextCapabilities: [] });
    const service = new AgentAutomationService({ runtime, registry, skills });
    const automation = await service.create({ name: 'Revocable local job', instruction: 'Read local state', agentId: agent.id, trigger: scheduleTrigger(), toolIds: ['automation.read'], skillIds: ['automation-skill'] });
    expect((await service.runNow(automation.id)).state).toBe('succeeded');
    skills.disable('automation-skill');
    const denied = await service.runNow(automation.id);
    expect(denied.state).toBe('failed'); expect(denied.lastErrorCode).toBe('CAPABILITY_REVOKED');
    service.stop();
  });

  it('fails closed for private agents configured for external fallback', async () => {
    const registry = new ToolRegistry();
    const skills = new SkillRegistry();
    const runtime = new AgentRuntime({ registry, skills, external: { execution: 'external', complete: async () => ({ text: 'external', toolProposals: [] }) } });
    await runtime.ready();
    const agent = await runtime.createAgent({ id: 'private-external-agent', name: 'Private external', profileId: 'Research', toolIds: [], skillIds: [], contextCapabilities: [] });
    const service = new AgentAutomationService({ runtime, registry, skills });
    await expect(service.create({ name: 'Private remote job', instruction: 'Must stay local', agentId: agent.id, trigger: scheduleTrigger() })).rejects.toMatchObject({ code: 'PRIVATE_EXTERNAL_FALLBACK_DENIED' });
    service.stop();
  });

  it('bounds trigger storms and blocks causal recursion', async () => {
    const setup = await runtimeWith();
    const service = new AgentAutomationService({ runtime: setup.runtime, registry: setup.registry, skills: setup.skills, maxTriggerEventsPerMinute: 1 });
    const automation = await service.create({ name: 'Live notification', instruction: 'Create a local notification', agentId: setup.agent.id, trigger: eventTrigger('live.started') });
    const base = { eventType: 'live.started' as const, occurredAt: new Date().toISOString(), dataClass: 'PUBLIC' as const };
    expect(await service.publishEvent({ ...base, id: 'live-recursion', causedBy: [automation.id] })).toBe(true);
    await eventually(async () => (await service.listJobs(automation.id)).some(job => job.lastErrorCode === 'RECURSION_BLOCKED'));
    expect(await service.publishEvent({ ...base, id: 'live-1' })).toBe(false);
    expect(await service.publishEvent({ ...base, id: 'live-2' })).toBe(false);
    expect((await service.auditLog()).some(entry => entry.errorCode === 'TRIGGER_STORM')).toBe(true);
    service.stop();
  });

  it('recovers queued/running state from durable automation storage', async () => {
    const agentStorage = new InMemoryAgentAutomationStateStore();
    const automationStorage = new InMemoryAgentAutomationStateStore();
    const first = await runtimeWith(localGateway(async () => { await new Promise(() => undefined); return { text: 'never', toolProposals: [] }; }), agentStorage);
    const service1 = new AgentAutomationService({ runtime: first.runtime, registry: first.registry, skills: first.skills, storage: automationStorage });
    const automation = await service1.create({ name: 'Crash recovery', instruction: 'Recover after restart', agentId: first.agent.id, trigger: scheduleTrigger(), budget: { maxRetries: 1, retryBackoffMs: 0 } });
    const pending = service1.runNow(automation.id);
    let running: string | undefined;
    await eventually(async () => { const jobs = await service1.listJobs(automation.id); running = jobs[0]?.id; return jobs[0]?.state === 'running'; });
    const second = await runtimeWith(undefined, agentStorage);
    const service2 = new AgentAutomationService({ runtime: second.runtime, registry: second.registry, skills: second.skills, storage: automationStorage });
    await service2.start();
    await eventually(async () => (await service2.getJob(running!))?.state === 'retry_wait' || (await service2.getJob(running!))?.state === 'failed');
    const current = await service1.getJob(running!);
    if (current?.agentRunId) await first.runtime.cancelRun(current.agentRunId).catch(() => undefined);
    service1.stop(); service2.stop(); void pending.catch(() => undefined);
  });
});
