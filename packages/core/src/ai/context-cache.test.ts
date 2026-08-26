import { describe, expect, it } from 'vitest';
import {
  AIContextCacheManager,
  InMemoryContextCacheStateStore,
  type ContextSummarizer,
} from './context-cache.js';
import { AIResourceScheduler, type AIModelRuntime } from './resource-scheduler.js';
import type { AIModelRef } from './privacy.js';

const model = { provider: 'test-local', model: 'shared' } as const;
const otherModel = { provider: 'test-local', model: 'new-model' } as const;

function runtimeFactory(loads: { count: number } = { count: 0 }): (ref: AIModelRef) => AIModelRuntime {
  return ref => ({
    model: ref,
    async load() { loads.count += 1; },
    async unload() {},
    async infer<T>(input: unknown): Promise<T> { return input as T; },
  });
}

function scheduler(runtimeFactoryInput: (ref: AIModelRef) => AIModelRuntime = runtimeFactory()) {
  return new AIResourceScheduler({ runtimeFactory: runtimeFactoryInput, keepLoaded: 'always', budget: { maxConcurrency: 2, foregroundConcurrency: 1, backgroundConcurrency: 2 } });
}

function context(prompt = 'current user request') {
  return { currentPrompt: prompt, tokenBudget: 128, reservedOutputTokens: 16, toolSchemaTokens: 8 } as const;
}

describe('AIContextCacheManager', () => {
  it('keeps Eight, Research and Browser namespaces isolated while sharing one model runtime', async () => {
    const loads = { count: 0 }; const service = scheduler(runtimeFactory(loads)); const cache = new AIContextCacheManager({ policy: { maxHotSessions: 3, maxWarmSessions: 3 } });
    await Promise.all([
      cache.registerSession({ agentId: 'eight', sessionId: 'session', namespace: 'eight/session' }),
      cache.registerSession({ agentId: 'research', sessionId: 'session', namespace: 'research/session' }),
      cache.registerSession({ agentId: 'browser', sessionId: 'session', namespace: 'browser/session' }),
    ]);
    const plans = await Promise.all(['eight', 'research', 'browser'].map(agentId => cache.runWithScheduler(service, { agentId, sessionId: 'session', model, priority: 'ACTIVE_AGENT', kind: 'context-test' }, context(), async plan => plan)));
    expect(plans.map(plan => plan.namespace)).toEqual(['eight/session', 'research/session', 'browser/session']);
    expect(new Set(plans.map(plan => plan.sessionId))).toEqual(new Set(['session']));
    expect(loads.count).toBe(1);
    service.close();
  });

  it('moves HOT to WARM and then COLD under pressure without losing the snapshot', async () => {
    const service = scheduler(); const cache = new AIContextCacheManager({ policy: { maxTotalKvRamBytes: 8 * 1024 * 1024, maxTotalKvVramBytes: 8 * 1024 * 1024, perSessionKvRamBytes: 4 * 1024 * 1024, perSessionKvVramBytes: 4 * 1024 * 1024, maxHotSessions: 1, maxWarmSessions: 1 } });
    await cache.registerSession({ agentId: 'eight', sessionId: 'one' }); await cache.registerSession({ agentId: 'research', sessionId: 'two' });
    await cache.appendTurn({ agentId: 'eight', sessionId: 'one' }, { id: 'turn-1', role: 'user', text: 'private durable turn', dataClass: 'PRIVATE', createdAt: new Date().toISOString() }, { memoryIds: ['memory-1'] });
    await cache.runWithScheduler(service, { agentId: 'eight', sessionId: 'one', model, priority: 'ACTIVE_AGENT', kind: 'context-test' }, context(), async plan => plan);
    expect(cache.getSession({ agentId: 'eight', sessionId: 'one' })?.tier).toBe('WARM');
    await cache.runWithScheduler(service, { agentId: 'research', sessionId: 'two', model, priority: 'ACTIVE_AGENT', kind: 'context-test' }, context(), async plan => plan);
    expect(cache.getSession({ agentId: 'eight', sessionId: 'one' })?.tier).toBe('COLD');
    const restored = await cache.restore({ agentId: 'eight', sessionId: 'one' }, model, context('restore this')); expect(restored.source).toBe('SNAPSHOT'); expect(restored.snapshot?.referencedMemoryIds).toContain('memory-1');
    service.close();
  });

  it('protects the interactive context and evicts background caches in gaming/battery modes', async () => {
    const service = scheduler(); const cache = new AIContextCacheManager({ policy: { maxHotSessions: 4, maxWarmSessions: 4 } });
    await cache.registerSession({ agentId: 'eight', sessionId: 'interactive' }); await cache.registerSession({ agentId: 'memory', sessionId: 'background' });
    await cache.runWithScheduler(service, { agentId: 'memory', sessionId: 'background', model, priority: 'MEMORY_CONSOLIDATION', kind: 'memory' }, context(), async plan => plan);
    await cache.runWithScheduler(service, { agentId: 'eight', sessionId: 'interactive', model, priority: 'USER_INTERACTIVE', kind: 'assistant' }, { ...context(), interactive: true }, async plan => plan);
    expect(cache.getSession({ agentId: 'eight', sessionId: 'interactive' })?.tier).toBe('HOT');
    await cache.setMode('GAMING'); expect(cache.getSession({ agentId: 'memory', sessionId: 'background' })?.tier).toBe('COLD'); expect(cache.getSession({ agentId: 'eight', sessionId: 'interactive' })?.tier).toBe('HOT');
    await cache.setMode('BATTERY'); expect(cache.getSession({ agentId: 'eight', sessionId: 'interactive' })?.tier).toBe('HOT');
    service.close();
  });

  it('freezes an old COLD session without removing its durable snapshot', async () => {
    let clock = Date.now(); const service = scheduler(); const cache = new AIContextCacheManager({ now: () => clock, policy: { maxHotSessions: 1, maxWarmSessions: 1, frozenIdleMs: 10 } });
    await cache.registerSession({ agentId: 'eight', sessionId: 'old' }); await cache.appendTurn({ agentId: 'eight', sessionId: 'old' }, { id: 'old-turn', role: 'user', text: 'durable', dataClass: 'PRIVATE', createdAt: new Date(clock).toISOString() });
    await cache.runWithScheduler(service, { agentId: 'eight', sessionId: 'old', model, priority: 'ACTIVE_AGENT', kind: 'freeze' }, context(), async plan => plan); await cache.evict({ agentId: 'eight', sessionId: 'old' }); clock += 100; await cache.sweep();
    const state = cache.getSession({ agentId: 'eight', sessionId: 'old' }); expect(state?.tier).toBe('FROZEN'); expect(state?.snapshot?.recentTurns[0]?.id).toBe('old-turn'); service.close();
  });

  it('restores every restarted session as COLD and rebuilds after a model change', async () => {
    const storage = new InMemoryContextCacheStateStore(); const first = new AIContextCacheManager({ storage }); await first.registerSession({ agentId: 'eight', sessionId: 'one' });
    await first.appendTurn({ agentId: 'eight', sessionId: 'one' }, { id: 'turn', role: 'assistant', text: 'answer', dataClass: 'PRIVATE', createdAt: new Date().toISOString() }, { objectIds: ['video-1'] });
    const restarted = new AIContextCacheManager({ storage }); await restarted.ready(); const state = restarted.getSession({ agentId: 'eight', sessionId: 'one' }); expect(state?.tier).toBe('COLD'); expect(state?.restoreRequired).toBe(true); expect(state?.snapshot?.referencedObjectIds).toContain('video-1');
    const service = scheduler(ref => ({ ...runtimeFactory()(ref), model: ref })); await restarted.runWithScheduler(service, { agentId: 'eight', sessionId: 'one', model: otherModel, priority: 'USER_INTERACTIVE', kind: 'restore' }, context(), async plan => plan); expect(restarted.getSession({ agentId: 'eight', sessionId: 'one' })?.model).toEqual(otherModel); service.close();
  });

  it('keeps the current prompt, drops low-priority retrieval first, and marks untrusted content', async () => {
    const cache = new AIContextCacheManager({ policy: { maxSnapshotTokens: 256 } }); await cache.registerSession({ agentId: 'eight', sessionId: 'one' });
    const plan = await cache.restore({ agentId: 'eight', sessionId: 'one' }, model, { currentPrompt: 'MUST SURVIVE', tokenBudget: 10, reservedOutputTokens: 2, retrievedContext: [{ id: 'web-low', dataClass: 'PUBLIC', source: 'web', sourceKind: 'web', value: 'very low priority remote page', priority: -50, tokenEstimate: 50 }] });
    expect(plan.currentPrompt).toBe('MUST SURVIVE'); expect(plan.droppedRetrievedIds).toContain('web-low'); expect(plan.untrustedSourceIds).toEqual([]);
    const withRoom = await cache.restore({ agentId: 'eight', sessionId: 'one' }, model, { currentPrompt: 'MUST SURVIVE', tokenBudget: 64, retrievedContext: [{ id: 'web', dataClass: 'PUBLIC', source: 'web', sourceKind: 'web', value: 'remote content', priority: 1 }] }); expect(withRoom.untrustedSourceIds).toContain('web');
  });

  it('allows only local/trusted private summarization and preserves original turns', async () => {
    const external: ContextSummarizer = { execution: 'external', async summarize() { throw new Error('must not execute'); } }; const cache = new AIContextCacheManager({ summarizer: external }); await cache.registerSession({ agentId: 'eight', sessionId: 'one' }); await cache.appendTurn({ agentId: 'eight', sessionId: 'one' }, { id: 'private-turn', role: 'user', text: 'private fact', dataClass: 'PRIVATE', createdAt: new Date().toISOString() });
    await expect(cache.compact({ agentId: 'eight', sessionId: 'one' })).rejects.toMatchObject({ code: 'CONTEXT_PRIVACY' });
    const local = new AIContextCacheManager({ summarizer: { execution: 'local', async summarize(input) { return { text: 'safe summary', sourceTurnIds: input.turns.map(turn => turn.id), generatedBy: 'local', provenance: { sourceIds: input.turns.map(turn => turn.id), dataClasses: ['PRIVATE'], trust: 'local' }, createdAt: new Date().toISOString() }; } } }); await local.registerSession({ agentId: 'eight', sessionId: 'one' }); await local.appendTurn({ agentId: 'eight', sessionId: 'one' }, { id: 'private-turn', role: 'user', text: 'private fact', dataClass: 'PRIVATE', createdAt: new Date().toISOString() }); const snapshot = await local.compact({ agentId: 'eight', sessionId: 'one' }); expect(snapshot.compactSummary?.text).toBe('safe summary'); expect(snapshot.recentTurns[0]?.text).toBe('private fact');
  });

  it('runs through the scheduler and bounds a 12-session benchmark to one shared runtime', async () => {
    const loads = { count: 0 }; const service = scheduler(runtimeFactory(loads)); const cache = new AIContextCacheManager({ policy: { maxHotSessions: 2, maxWarmSessions: 2, maxTotalKvRamBytes: 32 * 1024 * 1024, maxTotalKvVramBytes: 32 * 1024 * 1024, perSessionKvRamBytes: 4 * 1024 * 1024, perSessionKvVramBytes: 4 * 1024 * 1024 } });
    for (let i = 0; i < 12; i++) await cache.registerSession({ agentId: i === 0 ? 'eight' : `worker-${i}`, sessionId: `session-${i}` });
    await Promise.all(cache.listSessions().map(state => cache.runWithScheduler(service, { agentId: state.agentId, sessionId: state.sessionId, model, priority: state.agentId === 'eight' ? 'USER_INTERACTIVE' : 'BACKGROUND', kind: 'benchmark' }, { ...context(), interactive: state.agentId === 'eight' }, async plan => plan)));
    const states = cache.listSessions(); const eight = states.find(state => state.agentId === 'eight'); expect(eight?.interactivePinned).toBe(true); expect(['HOT', 'WARM']).toContain(eight?.tier); expect(states.filter(state => state.tier === 'HOT').length).toBeLessThanOrEqual(2); expect(states.filter(state => state.tier === 'WARM').length).toBeLessThanOrEqual(2); expect(states.some(state => state.tier === 'COLD')).toBe(true); expect(loads.count).toBe(1); service.close();
  });
});
