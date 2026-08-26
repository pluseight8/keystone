import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AIContextCacheManager } from './context-cache.js';
import { AIResourceScheduler, type AIModelRuntime } from './resource-scheduler.js';
import {
  EphemeralAgentWorkerService,
  InMemoryWorkerStateStore,
  type WorkerModelExecutor,
  type WorkerExternalRequest,
} from './workers.js';
import type { AIModelRef } from './privacy.js';
import {
  ToolExecutor,
  ToolRegistry,
  SkillRegistry,
  computeSkillIntegrityHash,
  type ToolIntent,
} from './tools.js';

const model = { provider: 'test-local', model: 'shared' } as const;

function makeScheduler(loads: { count: number }, options: ConstructorParameters<typeof AIResourceScheduler>[0] = {}): AIResourceScheduler {
  const runtimeFactory = (ref: AIModelRef): AIModelRuntime => ({ model: ref, async load() { loads.count += 1; }, async unload() {}, async infer<T>(input: unknown) { return input as T; } });
  return new AIResourceScheduler({ runtimeFactory, keepLoaded: 'always', budget: { maxConcurrency: 2, foregroundConcurrency: 2, backgroundConcurrency: 1, maxQueuedJobs: 64 }, ...options });
}

function publicContext(id: string, source = 'shared') { return { id, source, dataClass: 'PUBLIC' as const, value: `context-${id}` }; }

async function makeTooling() {
  const registry = new ToolRegistry(); const skills = new SkillRegistry();
  registry.register({ version: 1, id: 'readShared', name: 'Read shared', description: 'Read explicitly shared context', capabilities: ['READ_PRIVATE'], inputSchema: z.object({ query: z.string() }).strict(), outputSchema: z.object({ value: z.string() }).strict(), resultClass: 'PRIVATE', execute: input => ({ value: `read:${input.query}` }) });
  const manifest = { version: 1 as const, id: 'worker-skill', name: 'Worker skill', packageVersion: '1.0.0', instructions: 'Use only the delegated worker tool.', toolIds: ['readShared'], declaredCapabilities: ['READ_PRIVATE'] as const, source: 'builtin' as const };
  const integrityHash = await computeSkillIntegrityHash(manifest); await skills.install({ ...manifest, integrityHash, enabled: true, approvedCapabilities: ['READ_PRIVATE'] });
  return { registry, skills, executor: new ToolExecutor(registry, skills) };
}

describe('EphemeralAgentWorkerService', () => {
  it('runs Research, Browser, Coding and Planning workers through one model runtime', async () => {
    const loads = { count: 0 }; const scheduler = makeScheduler(loads); const cache = new AIContextCacheManager({ policy: { maxHotSessions: 2, maxWarmSessions: 2 } }); const modelExecutor: WorkerModelExecutor = async request => ({ text: `${request.type}:${request.objective}`, sourceIds: request.context.map(item => item.id), confidence: 0.9 }); const service = new EphemeralAgentWorkerService({ scheduler, model, contextCache: cache, modelExecutor });
    const workers = await Promise.all((['Research', 'Browser', 'Coding', 'Planning'] as const).map(type => service.createWorker({ parentAgentId: 'bot', parentRunId: 'run-1', type, objective: `compare ${type}`, context: [publicContext(`${type.toLowerCase()}-source`)] })));
    const results = await Promise.all(workers.map(worker => service.runWorker(worker.id))); expect(results.map(result => result.status)).toEqual(['completed', 'completed', 'completed', 'completed']); expect(loads.count).toBe(1); expect(new Set(results.map(result => result.workerId)).size).toBe(4);
    for (const worker of workers) { const state = await service.get(worker.id); expect(state?.state).toBe('COMPLETED'); expect(cache.getSession({ agentId: worker.id, sessionId: `worker-session-${worker.id}` })?.tier).toBe('COLD'); }
    scheduler.close();
  });

  it('keeps Browser context minimal and rejects private Memory without an explicit grant', async () => {
    const scheduler = makeScheduler({ count: 0 }); const service = new EphemeralAgentWorkerService({ scheduler, model, modelExecutor: async () => ({ text: 'ok' }) });
    await expect(service.createWorker({ parentAgentId: 'bot', type: 'Browser', objective: 'browse', context: [{ id: 'memory', source: 'memory', dataClass: 'PRIVATE', value: 'secret' }] })).rejects.toMatchObject({ code: 'WORKER_CONTEXT_DENIED' });
    const worker = await service.createWorker({ parentAgentId: 'bot', type: 'Browser', objective: 'browse public page', context: [publicContext('page', 'web')] }); expect((await service.runWorker(worker.id)).status).toBe('completed'); scheduler.close();
  });

  it('enforces a scoped capability grant and does not allow capability escalation', async () => {
    const tooling = await makeTooling(); const scheduler = makeScheduler({ count: 0 }); let intent!: ToolIntent; let calls = 0;
    const service = new EphemeralAgentWorkerService({ scheduler, model, toolExecutor: tooling.executor, toolRegistry: tooling.registry, modelExecutor: async request => { calls += 1; if (calls === 1) return { toolIntents: [intent] }; return { text: 'tool result' }; } });
    intent = tooling.registry.issueIntent({ toolId: 'readShared', skillId: 'worker-skill', arguments: { query: 'allowed' }, source: 'local' });
    const worker = await service.createWorker({ parentAgentId: 'bot', type: 'Planning', objective: 'read shared note', context: [{ id: 'note', source: 'shared', dataClass: 'PRIVATE', value: 'note' }], grant: { toolIds: ['readShared'], skillIds: ['worker-skill'], capabilities: ['READ_PRIVATE'], dataScope: { dataClasses: ['PRIVATE'], sourceKinds: ['shared'] }, maxUses: 1 } });
    const result = await service.runWorker(worker.id); expect(result.status).toBe('completed'); expect(result.toolsUsed).toEqual(['readShared']); expect(calls).toBe(2);
    const unauthorized = await service.createWorker({ parentAgentId: 'bot', type: 'Planning', objective: 'cannot use tool', grant: { toolIds: [], skillIds: [], capabilities: [], dataScope: { dataClasses: ['PUBLIC'] } }, context: [publicContext('shared')] });
    const badIntent = tooling.registry.issueIntent({ toolId: 'readShared', skillId: 'worker-skill', arguments: { query: 'denied' }, source: 'local' });
    const badService = new EphemeralAgentWorkerService({ scheduler: makeScheduler({ count: 0 }), model, toolExecutor: tooling.executor, toolRegistry: tooling.registry, modelExecutor: async () => ({ toolIntents: [badIntent] }) }); const badWorker = await badService.createWorker({ parentAgentId: 'bot', type: 'Planning', objective: 'escalate', context: [publicContext('public')], grant: { dataScope: { dataClasses: ['PUBLIC'] } } }); const badResult = await badService.runWorker(badWorker.id); expect(badResult.status).toBe('failed'); expect(badResult.errorCode).toBe('WORKER_GRANT_DENIED'); await badService.destroyWorker(badWorker.id); await service.destroyWorker(unauthorized.id); scheduler.close();
  });

  it('denies private external workers and allows only safe external public work', async () => {
    const scheduler = makeScheduler({ count: 0 }); const external = async (request: WorkerExternalRequest) => ({ text: `external:${request.objective}` }); const service = new EphemeralAgentWorkerService({ scheduler, model, externalExecutor: external });
    await expect(service.createWorker({ parentAgentId: 'bot', type: 'Analysis', execution: 'external', objective: 'private analysis', context: [{ id: 'private', source: 'shared', dataClass: 'PRIVATE', value: 'secret' }], grant: { dataScope: { dataClasses: ['PRIVATE'] } } })).rejects.toMatchObject({ code: 'WORKER_PRIVACY' });
    const worker = await service.createWorker({ parentAgentId: 'bot', type: 'Analysis', execution: 'external', objective: 'public analysis', context: [publicContext('public')], grant: { dataScope: { dataClasses: ['PUBLIC'] } } }); expect((await service.runWorker(worker.id)).output).toBe('external:public analysis'); scheduler.close();
  });

  it('cancels a running worker and cleans its runtime context', async () => {
    const scheduler = makeScheduler({ count: 0 }); const cache = new AIContextCacheManager(); let started!: () => void; const ready = new Promise<void>(resolve => { started = resolve; }); const service = new EphemeralAgentWorkerService({ scheduler, model, contextCache: cache, modelExecutor: async request => { started(); await new Promise<void>(resolve => request.signal.addEventListener('abort', () => resolve(), { once: true })); return { text: 'never' }; } });
    const worker = await service.createWorker({ parentAgentId: 'bot', type: 'Research', objective: 'long task', context: [publicContext('source')] }); const pending = service.runWorker(worker.id); await ready; await service.cancelWorker(worker.id); const result = await pending; expect(result.status).toBe('cancelled'); expect((await service.get(worker.id))?.state).toBe('CANCELLED'); expect(cache.getSession({ agentId: worker.id, sessionId: `worker-session-${worker.id}` })?.estimatedKvRamBytes).toBe(0); scheduler.close();
  });

  it('bounds fan-out, blocks recursive workers and deduplicates equivalent subtasks', async () => {
    const scheduler = makeScheduler({ count: 0 }); const service = new EphemeralAgentWorkerService({ scheduler, model, maxWorkersPerParent: 2, maxWorkerDepth: 1, modelExecutor: async () => ({ text: 'ok' }) });
    const first = await service.createWorker({ parentAgentId: 'bot', type: 'Research', objective: 'same', grant: { canSpawnWorkers: true }, context: [publicContext('one')] });
    await expect(service.createWorker({ parentAgentId: 'bot', type: 'Research', objective: 'same', grant: { canSpawnWorkers: true }, context: [publicContext('one')] })).rejects.toMatchObject({ code: 'WORKER_DUPLICATE_TASK' });
    const second = await service.createWorker({ parentAgentId: 'bot', type: 'Browser', objective: 'second', grant: { canSpawnWorkers: true }, context: [publicContext('two')] }); await expect(service.createWorker({ parentAgentId: 'bot', type: 'Coding', objective: 'third', context: [publicContext('three')] })).rejects.toMatchObject({ code: 'WORKER_FANOUT_LIMIT' });
    const child = await service.createWorker({ parentAgentId: 'bot', parentWorkerId: first.id, type: 'Analysis', objective: 'child', context: [publicContext('child')] }); await expect(service.createWorker({ parentAgentId: 'bot', parentWorkerId: child.id, type: 'Planning', objective: 'grandchild', context: [publicContext('grandchild')] })).rejects.toMatchObject({ code: 'WORKER_RECURSION_DENIED' }); await service.destroyWorker(first.id); await service.destroyWorker(second.id); scheduler.close();
  });

  it('requires explicit promotion and rejects stale or spoofed results', async () => {
    const scheduler = makeScheduler({ count: 0 }); let promoted = ''; const service = new EphemeralAgentWorkerService({ scheduler, model, modelExecutor: async () => ({ text: 'done' }), onPromote: async (_worker, input) => { promoted = input.agentId ?? 'new-agent'; return promoted; } }); const worker = await service.createWorker({ parentAgentId: 'bot', type: 'Planning', objective: 'plan', context: [publicContext('plan')] }); await service.runWorker(worker.id); await expect(service.promoteToAgent(worker.id, { confirmed: false })).rejects.toMatchObject({ code: 'WORKER_PROMOTION_CONFIRMATION' }); const result = await service.getResult(worker.id); expect(result && service.verifyResult(result)).toBe(true); expect(result && service.verifyResult({ ...result, id: 'spoofed' })).toBe(false); expect((await service.promoteToAgent(worker.id, { confirmed: true, agentId: 'saved-agent' })).agentId).toBe('saved-agent'); expect(promoted).toBe('saved-agent'); scheduler.close();
  });

  it('persists only bounded completed result metadata, not worker context', async () => {
    const storage = new InMemoryWorkerStateStore(); const scheduler = makeScheduler({ count: 0 }); const first = new EphemeralAgentWorkerService({ scheduler, model, storage, modelExecutor: async () => ({ text: 'persisted' }) }); const worker = await first.createWorker({ parentAgentId: 'bot', type: 'Summarization', objective: 'private objective', context: [{ id: 'private', source: 'shared', dataClass: 'PRIVATE', value: 'secret context' }], grant: { dataScope: { dataClasses: ['PRIVATE'], sourceKinds: ['shared'] } } }); await first.runWorker(worker.id); const restarted = new EphemeralAgentWorkerService({ scheduler, model, storage }); await restarted.ready(); const restored = await restarted.get(worker.id); expect(restored?.state).toBe('COMPLETED'); expect(restored?.task.contextItems).toEqual([]); expect((await restarted.getResult(worker.id))?.output).toBe('persisted'); scheduler.close();
  });
});
