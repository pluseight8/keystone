import { describe, expect, it } from 'vitest';
import {
  AIEgressFirewall,
  AIRouter,
  type AIProvider,
  type AIProviderRequest,
} from './privacy.js';
import {
  AIOrchestrator,
  AIOrchestrationPolicyError,
  SafeDelegationService,
  type AISubtask,
} from './orchestration.js';

function remoteProvider(options: { onRequest?: (request: AIProviderRequest) => void; response?: string; toolIntents?: AIProvider['complete'] extends (request: AIProviderRequest) => Promise<infer R> ? R extends { toolIntents: infer T } ? T : never : never; delayMs?: number }): AIProvider {
  return {
    id: 'test-remote',
    scope: 'remote',
    models: [{ ref: { provider: 'test-remote', model: 'large' }, scope: 'remote', displayName: 'Test external', contextLimit: 8_192 }],
    async complete(request) {
      options.onRequest?.(request);
      if (options.delayMs) await new Promise(resolve => setTimeout(resolve, options.delayMs));
      return { text: options.response ?? `external:${request.userText}`, toolIntents: options.toolIntents ?? [] };
    },
  };
}

function safeSubtask(overrides: Partial<AISubtask> = {}): AISubtask {
  return {
    id: 'route',
    objective: 'Suggest a four-day Tokyo route for a technology enthusiast who prefers quiet neighbourhoods.',
    safeForExternal: true,
    sourceIds: ['memory:preferences'],
    ...overrides,
  };
}

describe('Private AI orchestration', () => {
  it('keeps the original private request local and sends only the isolated public subtask', async () => {
    const outbound: AIProviderRequest[] = [];
    const external = new AIRouter({ providers: [remoteProvider({ onRequest: request => outbound.push(request) })], defaultModel: 'test-remote/large' });
    const delegation = new SafeDelegationService({ external, firewall: new AIEgressFirewall(), maxParallel: 2 });
    const orchestrator = new AIOrchestrator({ delegation, synthesize: async ({ request, delegations }) => {
      expect(request.userText).toContain('calendar private appointment');
      expect(delegations[0].text).toContain('external:');
      return { text: 'assembled locally', execution: 'local' };
    } });
    const result = await orchestrator.run({
      taskPrivacy: 'private',
      userText: 'Plan my trip around calendar private appointment and my preferences',
      context: [{ id: 'calendar:1', source: 'calendar', dataClass: 'PRIVATE', value: 'calendar private appointment' }],
      history: [{ id: 'chat:1', source: 'chat', dataClass: 'PRIVATE', value: 'private chat history' }],
      attachments: [{ id: 'file:1', source: 'file', dataClass: 'PRIVATE', value: 'private attachment' }],
      nestedContext: [{ id: 'rag:1', source: 'rag', dataClass: 'PRIVATE', value: 'private RAG result' }],
      subtasks: [safeSubtask()],
    });
    expect(result.text).toBe('assembled locally');
    expect(result.privacyIndicator).toBe('external_isolated_subtask');
    expect(outbound).toHaveLength(1);
    expect(outbound[0].userText).toBe(safeSubtask().objective);
    expect(outbound[0].userText).not.toContain('calendar private appointment');
    expect(outbound[0].context).toEqual([]);
    expect(JSON.stringify(outbound[0])).not.toContain('private chat history');
    expect(JSON.stringify(outbound[0])).not.toContain('private attachment');
    expect(JSON.stringify(outbound[0])).not.toContain('private RAG result');
    expect(result.provenance.steps.some(step => step.kind === 'local_synthesis' && step.execution === 'local')).toBe(true);
  });

  it('fails closed instead of relying on redaction when a subtask contains private context', async () => {
    let calls = 0;
    const external = new AIRouter({ providers: [remoteProvider({ onRequest: () => { calls++; } })], defaultModel: 'test-remote/large' });
    const delegation = new SafeDelegationService({ external });
    await expect(delegation.delegate(safeSubtask({ context: [{ id: 'chat:1', source: 'chat', dataClass: 'PRIVATE', value: 'do not send' }] }))).rejects.toThrow(/private/i);
    expect(calls).toBe(0);
  });

  it('rejects private overlap and malicious tool requests', async () => {
    let calls = 0;
    const external = new AIRouter({ providers: [remoteProvider({ onRequest: () => { calls++; }, toolIntents: [{ name: 'read_private', arguments: {}, dataClass: 'PRIVATE' }] })], defaultModel: 'test-remote/large' });
    const delegation = new SafeDelegationService({ external });
    const orchestrator = new AIOrchestrator({ delegation, synthesize: async () => ({ text: 'local', execution: 'local' }) });
    await expect(orchestrator.run({ taskPrivacy: 'private', userText: 'private request', context: [{ id: 'secret-source', dataClass: 'PRIVATE', value: 'do not leak' }], subtasks: [safeSubtask({ objective: 'do not leak' })] })).rejects.toThrow(/private|external/i);
    await expect(delegation.delegate(safeSubtask())).rejects.toBeInstanceOf(AIOrchestrationPolicyError);
    await expect(delegation.delegate(safeSubtask({ id: 'private-tool', requestedTools: [{ name: 'read', dataClass: 'PRIVATE' }] }))).rejects.toThrow(/private/i);
    expect(calls).toBe(1);
  });

  it('runs several safe subtasks with bounded parallelism and preserves order', async () => {
    let active = 0;
    let peak = 0;
    const external = new AIRouter({ providers: [remoteProvider({ delayMs: 10, onRequest: request => { active++; peak = Math.max(peak, active); setTimeout(() => { active--; }, 10); } })], defaultModel: 'test-remote/large' });
    const delegation = new SafeDelegationService({ external, maxParallel: 2 });
    const subtasks = ['one', 'two', 'three'].map((id, index) => safeSubtask({ id, objective: `public subtask ${index}` }));
    const results = await delegation.delegateMany(subtasks, { planId: 'plan' });
    expect(results.map(value => value.subtaskId)).toEqual(['one', 'two', 'three']);
    expect(peak).toBeLessThanOrEqual(2);
  });

  it('supports private-only mode without calling an external provider', async () => {
    let calls = 0;
    const external = new AIRouter({ providers: [remoteProvider({ onRequest: () => { calls++; } })], defaultModel: 'test-remote/large' });
    const orchestrator = new AIOrchestrator({ delegation: new SafeDelegationService({ external }), defaultMode: 'private-only', synthesize: async () => ({ text: 'private answer', execution: 'local' }) });
    const result = await orchestrator.run({ mode: 'private-only', taskPrivacy: 'private', userText: 'use my private context', context: [{ id: 'memory:1', dataClass: 'PRIVATE', value: 'private' }], subtasks: [] });
    expect(result.text).toBe('private answer');
    expect(result.privacyIndicator).toBe('processed_privately');
    expect(calls).toBe(0);
  });

  it('executes an unsafe/private subtask locally instead of falling back to external AI', async () => {
    let externalCalls = 0;
    let localCalls = 0;
    const external = new AIRouter({ providers: [remoteProvider({ onRequest: () => { externalCalls++; } })], defaultModel: 'test-remote/large' });
    const local: AIProvider = {
      id: 'test-local', scope: 'local', models: [{ ref: { provider: 'test-local', model: 'small' }, scope: 'local', contextLimit: 8_192 }],
      async complete(request) { localCalls++; return { text: `local:${request.userText}`, toolIntents: [] }; },
    };
    const orchestrator = new AIOrchestrator({ local: new AIRouter({ providers: [local], defaultModel: 'test-local/small' }), delegation: new SafeDelegationService({ external }), defaultMode: 'private-only' });
    const result = await orchestrator.run({ mode: 'private-only', taskPrivacy: 'private', userText: 'summarise my private notes', context: [{ id: 'memory:1', dataClass: 'PRIVATE', value: 'private notes' }], subtasks: [safeSubtask({ safeForExternal: false, context: [{ id: 'memory:1', dataClass: 'PRIVATE', value: 'private notes' }] })] });
    expect(result.privacyIndicator).toBe('processed_privately');
    expect(result.delegations[0].execution).toBe('local');
    expect(localCalls).toBe(2);
    expect(externalCalls).toBe(0);
  });

  it('prefers local execution for safe subtasks in local-preferred mode', async () => {
    let externalCalls = 0;
    let localCalls = 0;
    const external = new AIRouter({ providers: [remoteProvider({ onRequest: () => { externalCalls++; } })], defaultModel: 'test-remote/large' });
    const local: AIProvider = { id: 'preferred-local', scope: 'local', models: [{ ref: { provider: 'preferred-local', model: 'small' }, scope: 'local', contextLimit: 4_096 }], async complete() { localCalls++; return { text: 'local result', toolIntents: [] }; } };
    const orchestrator = new AIOrchestrator({ local: new AIRouter({ providers: [local], defaultModel: 'preferred-local/small' }), delegation: new SafeDelegationService({ external }), defaultMode: 'local-preferred' });
    const result = await orchestrator.run({ mode: 'local-preferred', userText: 'public question', subtasks: [safeSubtask()] });
    expect(result.delegations[0].execution).toBe('local');
    expect(localCalls).toBe(2);
    expect(externalCalls).toBe(0);
  });

  it('cancels before egress and enforces a bounded timeout', async () => {
    let calls = 0;
    const external = new AIRouter({ providers: [remoteProvider({ delayMs: 500, onRequest: () => { calls++; } })], defaultModel: 'test-remote/large' });
    const delegation = new SafeDelegationService({ external, timeoutMs: 100 });
    const controller = new AbortController();
    controller.abort();
    await expect(delegation.delegate(safeSubtask(), { signal: controller.signal })).rejects.toThrow(/cancel/i);
    await expect(delegation.delegate(safeSubtask({ id: 'timeout' }))).rejects.toThrow(/cancel/i);
    expect(calls).toBe(1);
  });
});
