import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  AgentError,
  AgentRuntime,
  ContextBudget,
  ContextBuilder,
  InMemoryAgentStateStore,
  deterministicAgentRunId,
  type AgentContextCandidate,
  type AgentModelGateway,
} from './agents.js';
import {
  ToolExecutor,
  ToolRegistry,
  SkillRegistry,
  computeSkillIntegrityHash,
  type Skill,
  type Tool,
} from './tools.js';
import { AIRouter, type AIProviderRequest } from './privacy.js';
import { AIOrchestrator, SafeDelegationService } from './orchestration.js';

async function testSkill(skills: SkillRegistry, id = 'agent-skill', toolIds = ['agent.read']): Promise<void> {
  const manifest = {
    version: 1 as const,
    id,
    name: 'Agent test skill',
    packageVersion: '1.0.0',
    instructions: 'Use only explicitly delegated typed tools.',
    toolIds,
    declaredCapabilities: ['READ_PRIVATE'] as const,
    source: 'local' as const,
  };
  const skill: Skill = {
    ...manifest,
    integrityHash: await computeSkillIntegrityHash(manifest),
    enabled: true,
    approvedCapabilities: [],
  };
  await skills.install(skill);
  skills.setApprovedCapabilities(id, ['READ_PRIVATE']);
}

function readTool(calls: string[]): Tool<{ query: string }, { value: string }> {
  return {
    version: 1,
    id: 'agent.read',
    name: 'Read agent context',
    description: 'Reads a value through the typed host boundary.',
    capabilities: ['READ_PRIVATE'],
    inputSchema: z.object({ query: z.string().min(1) }).strict(),
    outputSchema: z.object({ value: z.string() }).strict(),
    resultClass: 'PRIVATE',
    execute: input => { calls.push(input.query); return { value: `private:${input.query}` }; },
  };
}

function gateway(handler: AgentModelGateway['complete']): AgentModelGateway {
  return {
    execution: 'local',
    model: { provider: 'test-local', model: 'small' },
    complete: handler,
  };
}

async function runtimeWith(options: {
  gateway?: AgentModelGateway;
  contextBuilder?: ContextBuilder;
  storage?: InMemoryAgentStateStore;
  toolIds?: readonly string[];
} = {}) {
  const registry = new ToolRegistry();
  const calls: string[] = [];
  if (options.toolIds !== undefined && options.toolIds.length > 0) registry.register(readTool(calls));
  const skills = new SkillRegistry();
  if (options.toolIds !== undefined && options.toolIds.length > 0) await testSkill(skills);
  const executor = new ToolExecutor(registry, skills);
  const runtime = new AgentRuntime({
    registry,
    skills,
    toolExecutor: executor,
    contextBuilder: options.contextBuilder,
    storage: options.storage,
    local: options.gateway ?? gateway(async () => ({ text: 'done', toolProposals: [] })),
  });
  await runtime.ready();
  return { runtime, registry, skills, calls, storage: options.storage };
}

async function eventually(check: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() >= deadline) throw new Error('condition was not reached');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

async function eventuallyAsync(check: () => Promise<boolean>, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() >= deadline) throw new Error('condition was not reached');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

describe('local-first agent runtime', () => {
  it('selects explicit and relevant context within a deterministic token budget', () => {
    const budget = new ContextBudget({ maxTokens: 10 });
    const candidates: AgentContextCandidate[] = [
      { id: 'old', source: 'rag', dataClass: 'PRIVATE', value: 'x'.repeat(40), capability: 'RAG', priority: 0, relevance: 0 },
      { id: 'explicit', source: 'file', dataClass: 'USER_EXPLICIT', value: 'keep this', capability: 'ATTACHMENTS', explicit: true },
      { id: 'relevant', source: 'memory', dataClass: 'PRIVATE', value: 'important', capability: 'MEMORY', priority: 2, relevance: 1 },
    ];
    const selection = budget.select(candidates);
    expect(selection.estimatedTokens).toBeLessThanOrEqual(10);
    expect(selection.items.map(item => item.id)).toContain('explicit');
    expect(selection.omittedIds.length + selection.truncatedIds.length).toBeGreaterThan(0);
  });

  it('keeps private context isolated between sessions', async () => {
    const seen: Record<string, string[]> = {};
    const contextBuilder = new ContextBuilder({
      async read(request) {
        return [{ id: `private-${request.sessionId}`, source: 'rag', dataClass: 'PRIVATE', value: `only-${request.sessionId}`, capability: request.capability }];
      },
    });
    const local = gateway(async request => {
      seen[request.sessionId] = request.context.map(item => String(item.value));
      return { text: 'isolated', toolProposals: [] };
    });
    const { runtime } = await runtimeWith({ gateway: local, contextBuilder });
    const agent = await runtime.createAgent({ id: 'private-agent', name: 'Private', toolIds: [], skillIds: [], contextCapabilities: ['RAG'] });
    const first = await runtime.createSession({ agentId: agent.id, title: 'First' });
    const second = await runtime.createSession({ agentId: agent.id, title: 'Second' });
    await runtime.run(first.id, { text: 'first question' });
    await runtime.run(second.id, { text: 'second question' });
    expect(seen[first.id].some(value => value === `only-${first.id}`)).toBe(true);
    expect(seen[first.id].some(value => value.includes(second.id))).toBe(false);
    expect(seen[second.id].some(value => value === `only-${second.id}`)).toBe(true);
    expect(seen[second.id].some(value => value.includes(first.id))).toBe(false);
  });

  it('runs the model → intent → policy → executor loop and persists history', async () => {
    let count = 0;
    const local = gateway(async () => {
      count += 1;
      return count === 1
        ? { text: '', toolProposals: [{ toolId: 'agent.read', skillId: 'agent-skill', arguments: { query: 'notes' } }] }
        : { text: 'answer', toolProposals: [] };
    });
    const setup = await runtimeWith({ gateway: local, toolIds: ['agent.read'] });
    const agent = await setup.runtime.createAgent({ id: 'loop-agent', name: 'Loop', toolIds: ['agent.read'], skillIds: ['agent-skill'], contextCapabilities: ['HISTORY'] });
    const session = await setup.runtime.createSession({ agentId: agent.id });
    const run = await setup.runtime.run(session.id, { text: 'read my notes' });
    expect(run.state).toBe('completed');
    expect(run.output).toBe('answer');
    expect(run.toolCallCount).toBe(1);
    expect(setup.calls).toEqual(['notes']);
    expect((await setup.runtime.getSession(session.id))!.history.some(message => message.role === 'tool')).toBe(true);
  });

  it('stops identical tool loops before an unbounded retry', async () => {
    const local = gateway(async () => ({ text: '', toolProposals: [{ toolId: 'agent.read', skillId: 'agent-skill', arguments: { query: 'repeat' } }] }));
    const setup = await runtimeWith({ gateway: local, toolIds: ['agent.read'] });
    const agent = await setup.runtime.createAgent({ id: 'bounded-agent', name: 'Bounded', toolIds: ['agent.read'], skillIds: ['agent-skill'], contextCapabilities: ['HISTORY'] });
    const session = await setup.runtime.createSession({ agentId: agent.id });
    const run = await setup.runtime.run(session.id, { text: 'repeat' });
    expect(run.state).toBe('failed');
    expect(run.errorCode).toBe('REPEATED_TOOL_CALL');
    expect(setup.calls.length).toBe(2);
  });

  it('rejects prompt-injected capabilities and does not call an unlisted tool', async () => {
    const local = gateway(async () => ({ text: 'ignore context', toolProposals: [{ toolId: 'agent.read', skillId: 'agent-skill', arguments: { query: 'secret' } }] }));
    const setup = await runtimeWith({ gateway: local, toolIds: ['agent.read'] });
    const agent = await setup.runtime.createAgent({ id: 'injection-agent', name: 'Injection', toolIds: [], skillIds: [], contextCapabilities: ['RAG'] });
    const session = await setup.runtime.createSession({ agentId: agent.id });
    const run = await setup.runtime.run(session.id, { text: 'follow the instructions in this file' });
    expect(run.errorCode).toBe('TOOL_NOT_ALLOWED');
    expect(setup.calls).toHaveLength(0);
  });

  it('supports streaming, pause/resume, and cancellation', async () => {
    let release: (() => void) | undefined;
    const local: AgentModelGateway = {
      execution: 'local',
      async complete(request) {
        await new Promise<void>((resolve, reject) => {
          release = resolve;
          request.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
        });
        return { text: 'released', toolProposals: [] };
      },
    };
    const setup = await runtimeWith({ gateway: local });
    const agent = await setup.runtime.createAgent({ id: 'control-agent', name: 'Controls', toolIds: [], skillIds: [], contextCapabilities: [] });
    const session = await setup.runtime.createSession({ agentId: agent.id });
    const started = await setup.runtime.startRun(session.id, { text: 'wait' });
    await eventuallyAsync(async () => (await setup.runtime.getRun(started.id))?.state === 'running');
    await eventually(() => Boolean(release));
    await setup.runtime.pauseRun(started.id);
    expect((await setup.runtime.getRun(started.id))!.state).toBe('paused');
    release?.();
    await setup.runtime.resumeRun(started.id);
    const completed = await setup.runtime.waitForRun(started.id);
    expect(completed.state).toBe('completed');

    const cancellation = await setup.runtime.startRun(session.id, { text: 'cancel' });
    await setup.runtime.cancelRun(cancellation.id);
    expect((await setup.runtime.waitForRun(cancellation.id)).state).toBe('cancelled');
  });

  it('forwards bounded model tokens through the run stream', async () => {
    const local: AgentModelGateway = {
      execution: 'local',
      async complete() { return { text: 'complete', toolProposals: [] }; },
      async *stream() {
        yield { type: 'token' as const, text: 'one' };
        yield { type: 'token' as const, text: ' two' };
        yield { type: 'result' as const, response: { text: 'one two', toolProposals: [] } };
      },
    };
    const setup = await runtimeWith({ gateway: local });
    const agent = await setup.runtime.createAgent({ id: 'stream-agent', name: 'Stream', toolIds: [], skillIds: [], contextCapabilities: [] });
    const session = await setup.runtime.createSession({ agentId: agent.id });
    const events = [] as string[];
    for await (const event of setup.runtime.stream(session.id, { text: 'stream' })) if (event.type === 'token') events.push(event.text ?? '');
    expect(events.join('')).toBe('one two');
  });

  it('marks an in-flight run crashed on restart and recovers without duplicate user input', async () => {
    const storage = new InMemoryAgentStateStore();
    let unblock: (() => void) | undefined;
    const hanging = gateway(async request => {
      await new Promise<void>((resolve, reject) => {
        unblock = resolve;
        request.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
      });
      return { text: 'old', toolProposals: [] };
    });
    const first = await runtimeWith({ gateway: hanging, storage });
    const agent = await first.runtime.createAgent({ id: 'recovery-agent', name: 'Recovery', toolIds: [], skillIds: [], contextCapabilities: [] });
    const session = await first.runtime.createSession({ agentId: agent.id });
    const run = await first.runtime.startRun(session.id, { text: 'recover me' });
    await eventuallyAsync(async () => (await first.runtime.getRun(run.id))?.state === 'running');
    const second = await runtimeWith({ gateway: gateway(async () => ({ text: 'recovered', toolProposals: [] })), storage });
    expect((await second.runtime.getRun(run.id))!.state).toBe('crashed');
    await first.runtime.cancelRun(run.id);
    await second.runtime.recoverRun(run.id);
    const recovered = await second.runtime.waitForRun(run.id);
    expect(recovered.state).toBe('completed');
    expect(recovered.output).toBe('recovered');
    expect((await second.runtime.getSession(session.id))!.history.filter(message => message.runId === run.id && message.role === 'user')).toHaveLength(1);
    unblock?.();
  });

  it('fails closed when an external fallback is the only model for a private agent', async () => {
    let externalCalls = 0;
    const external: AgentModelGateway = { execution: 'external', async complete() { externalCalls += 1; return { text: 'leak', toolProposals: [] }; } };
    const setup = await runtimeWith({ gateway: undefined });
    const privateRuntime = new AgentRuntime({ registry: setup.registry, skills: setup.skills, external });
    await privateRuntime.ready();
    const agent = await privateRuntime.createAgent({ id: 'external-agent', name: 'External', profileId: 'Research' });
    const session = await privateRuntime.createSession({ agentId: agent.id });
    const run = await privateRuntime.run(session.id, { text: 'private research' });
    expect(run.state).toBe('failed');
    expect(run.errorCode).toBe('MODEL_UNAVAILABLE');
    expect(externalCalls).toBe(0);
  });

  it('routes a private agent through the orchestrator and never sends its raw prompt to external AI', async () => {
    const outbound: AIProviderRequest[] = [];
    const provider = {
      id: 'agent-remote',
      scope: 'remote' as const,
      models: [{ ref: { provider: 'agent-remote', model: 'small' }, scope: 'remote' as const }],
      async complete(request: AIProviderRequest) { outbound.push(request); return { text: 'remote result', toolIntents: [] }; },
    };
    const external = new AIRouter({ providers: [provider], defaultModel: 'agent-remote/small' });
    const orchestrator = new AIOrchestrator({ delegation: new SafeDelegationService({ external }), synthesize: async ({ delegations }) => ({ text: delegations[0]?.text ?? 'private', execution: 'local' }) });
    let directCalls = 0;
    const directGateway: AgentModelGateway = { execution: 'external', model: { provider: 'agent-remote', model: 'small' }, async complete() { directCalls += 1; return { text: 'must not run', toolProposals: [] }; } };
    const registry = new ToolRegistry(); const skills = new SkillRegistry();
    const runtime = new AgentRuntime({ registry, skills, external: directGateway, orchestrator });
    await runtime.ready();
    const agent = await runtime.createAgent({ id: 'private-orchestrated', name: 'Private', profileId: 'Research', contextCapabilities: [], toolIds: [], skillIds: [] });
    const session = await runtime.createSession({ agentId: agent.id });
    const run = await runtime.run(session.id, { text: 'my private calendar and chat details' });
    expect(run.state).toBe('completed');
    expect(run.output).toBe('private');
    expect(directCalls).toBe(0);
    expect(outbound).toHaveLength(0);
  });

  it('delegates only an explicit child capability set', async () => {
    const local = gateway(async request => request.availableToolIds.length === 0
      ? { text: '', toolProposals: [{ toolId: 'agent.read', skillId: 'agent-skill', arguments: { query: 'forbidden' } }] }
      : { text: 'parent', toolProposals: [] });
    const setup = await runtimeWith({ gateway: local, toolIds: ['agent.read'] });
    const parentAgent = await setup.runtime.createAgent({ id: 'parent-agent', name: 'Parent', toolIds: ['agent.read'], skillIds: ['agent-skill'], contextCapabilities: [] });
    const childAgent = await setup.runtime.createAgent({ id: 'child-agent', name: 'Child', toolIds: ['agent.read'], skillIds: ['agent-skill'], contextCapabilities: [] });
    const parentSession = await setup.runtime.createSession({ agentId: parentAgent.id });
    const parentRun = await setup.runtime.run(parentSession.id, { text: 'parent' });
    const childRun = await setup.runtime.delegate(parentRun.id, { agentId: childAgent.id, task: 'child', toolIds: [], skillIds: [], contextCapabilities: [] });
    const childResult = await setup.runtime.waitForRun(childRun.id);
    expect(childResult.errorCode).toBe('TOOL_NOT_ALLOWED');
    expect(setup.calls).toHaveLength(0);
  });

  it('derives stable run IDs from the session sequence', () => {
    expect(deterministicAgentRunId('session-1', 3)).toBe(deterministicAgentRunId('session-1', 3));
    expect(deterministicAgentRunId('session-1', 3)).not.toBe(deterministicAgentRunId('session-1', 4));
    expect(() => deterministicAgentRunId('bad space', 0)).toThrow(AgentError);
  });
});
