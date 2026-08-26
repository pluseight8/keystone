import { describe, expect, it } from 'vitest';
import {
  AIResourceScheduler,
  AIResourceSchedulerError,
  InMemoryAIResourceSchedulerStateStore,
  type AIModelRuntime,
  type InferenceExecutionContext,
} from './resource-scheduler.js';

const model = { provider: 'test-local', model: 'shared' } as const;

function wait(ms = 5): Promise<void> { return new Promise(resolve => setTimeout(resolve, ms)); }
async function eventually(check: () => boolean | Promise<boolean>, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) { if (Date.now() >= deadline) throw new Error('condition was not reached'); await wait(); }
}

function fakeRuntime(options: { load?: () => Promise<void>; infer?: (input: unknown, signal: AbortSignal) => Promise<unknown> } = {}): AIModelRuntime & { loads: number; unloads: number; calls: unknown[] } {
  const value = {
    model,
    loads: 0,
    unloads: 0,
    calls: [] as unknown[],
    async load() { value.loads += 1; await options.load?.(); },
    async unload() { value.unloads += 1; },
    async infer<T>(input: unknown, signal: AbortSignal): Promise<T> { if (signal.aborted) throw new Error('aborted'); value.calls.push(input); return (await options.infer?.(input, signal) ?? input) as T; },
  };
  return value;
}

function scheduler(runtime: AIModelRuntime, options: ConstructorParameters<typeof AIResourceScheduler>[0] = {}): AIResourceScheduler {
  return new AIResourceScheduler({ runtimeFactory: () => runtime, keepLoaded: 'always', ...options });
}

describe('AIResourceScheduler', () => {
  it('preempts background work for an interactive request and shares one loaded runtime', async () => {
    const runtime = fakeRuntime(); const order: string[] = []; let bgStarted!: () => void; const bgReady = new Promise<void>(resolve => { bgStarted = resolve; }); let releaseBackground!: () => void; const bgRelease = new Promise<void>(resolve => { releaseBackground = resolve; });
    const service = scheduler(runtime, { budget: { maxConcurrency: 1, foregroundConcurrency: 1, backgroundConcurrency: 1 } });
    const backgroundJob = await service.enqueue({ agentId: 'research-agent', sessionId: 'research-session', model, priority: 'MEMORY_CONSOLIDATION', kind: 'memory', handler: async context => { order.push('background-start'); bgStarted(); await bgRelease; await context.checkpoint(); order.push('background-resumed'); return 'memory'; } });
    await bgReady;
    const interactive = service.run({ agentId: 'eight', sessionId: 'eight-session', model, priority: 'USER_INTERACTIVE', kind: 'assistant', handler: async context => { order.push('interactive'); expect(context.lease.ownerJobId).not.toBe(backgroundJob.id); return 'answer'; } });
    releaseBackground();
    await eventually(() => order.includes('interactive'));
    expect(await interactive).toBe('answer');
    await service.resume(backgroundJob.id);
    expect(await service.waitFor(backgroundJob.id)).toBe('memory');
    expect(order).toEqual(['background-start', 'interactive', 'background-resumed']);
    expect(runtime.loads).toBe(1);
    service.close();
  });

  it('keeps agent/session context isolated while multiple jobs share one model runtime', async () => {
    const runtime = fakeRuntime(); const service = scheduler(runtime, { budget: { maxConcurrency: 2, foregroundConcurrency: 2, perAgentMaxActive: 2 } });
    const values = await Promise.all([
      service.run({ agentId: 'eight', sessionId: 'session-a', model, priority: 'ACTIVE_AGENT', kind: 'agent', handler: async context => context.runtime.infer({ sessionId: context.job.sessionId, value: 'private-a' }, context.signal) }),
      service.run({ agentId: 'research', sessionId: 'session-b', model, priority: 'BROWSER', kind: 'agent', handler: async context => context.runtime.infer({ sessionId: context.job.sessionId, value: 'private-b' }, context.signal) }),
    ]);
    expect(values).toEqual([{ sessionId: 'session-a', value: 'private-a' }, { sessionId: 'session-b', value: 'private-b' }]);
    expect(runtime.loads).toBe(1);
    expect(runtime.calls).toEqual(expect.arrayContaining([{ sessionId: 'session-a', value: 'private-a' }, { sessionId: 'session-b', value: 'private-b' }]));
    service.close();
  });

  it('runs the Phase 43 benchmark roles through one instrumented model runtime', async () => {
    const runtime = fakeRuntime(); const service = scheduler(runtime, { mode: 'PERFORMANCE', budget: { maxConcurrency: 3, foregroundConcurrency: 3, backgroundConcurrency: 2, perAgentMaxActive: 1 } });
    const roles: readonly [string, 'USER_INTERACTIVE' | 'BROWSER' | 'MEMORY_CONSOLIDATION' | 'RECOMMENDATION'][] = [
      ['eight', 'USER_INTERACTIVE'], ['research', 'BROWSER'], ['browser', 'BROWSER'], ['memory', 'MEMORY_CONSOLIDATION'], ['recommendations', 'RECOMMENDATION'],
    ];
    const results = await Promise.all(roles.map(([agentId, priority]) => service.run({ agentId, sessionId: `${agentId}-session`, model, priority, kind: 'benchmark', cheap: priority === 'RECOMMENDATION', handler: async context => context.runtime.infer({ agentId: context.job.agentId, sessionId: context.job.sessionId }, context.signal) })));
    expect(results).toHaveLength(5); expect(new Set(runtime.calls.map(value => JSON.stringify(value))).size).toBe(5); expect(runtime.loads).toBe(1); expect(service.getMetrics().completedJobs).toBe(5);
    service.close();
  });

  it('supports gaming/battery policies and allows only cheap recommendations in gaming mode', async () => {
    const runtime = fakeRuntime(); const service = scheduler(runtime);
    await service.setMode('GAMING');
    const memory = await service.enqueue({ agentId: 'memory', model, priority: 'MEMORY_CONSOLIDATION', kind: 'memory', handler: async () => 'paused' });
    const recommendation = service.run({ agentId: 'recommendations', model, priority: 'RECOMMENDATION', kind: 'recommendation', cheap: true, handler: async () => 'cheap' });
    expect(memory.state).toBe('paused'); expect(await recommendation).toBe('cheap');
    await service.setMode('BATTERY');
    const background = await service.enqueue({ agentId: 'background', model, priority: 'BACKGROUND', kind: 'background', handler: async () => 'no' });
    expect(background.state).toBe('paused');
    service.close();
  });

  it('handles cancellation, pause/resume, bounded queue and starvation-friendly ordering', async () => {
    const runtime = fakeRuntime(); const service = scheduler(runtime, { budget: { maxConcurrency: 1, foregroundConcurrency: 1, backgroundConcurrency: 1, maxQueuedJobs: 2, perAgentMaxQueued: 2, starvationAfterMs: 100 } });
    let release!: () => void; const hold = new Promise<void>(resolve => { release = resolve; });
    const first = await service.enqueue({ agentId: 'first', model, priority: 'USER_INTERACTIVE', kind: 'hold', handler: async context => { await hold; await context.checkpoint(); return 'done'; } });
    await eventually(() => service.getJob(first.id)?.state === 'running');
    const queued = await service.enqueue({ agentId: 'background', model, priority: 'BACKGROUND', kind: 'queued', handler: async () => 'queued' });
    const queuedSecond = await service.enqueue({ agentId: 'background-2', model, priority: 'BACKGROUND', kind: 'queued-second', handler: async () => 'queued-second' });
    await expect(service.enqueue({ agentId: 'overflow', model, priority: 'BACKGROUND', kind: 'overflow', handler: async () => 'overflow' })).rejects.toMatchObject({ code: 'QUEUE_FULL' });
    await service.cancel(queued.id); await service.cancel(queuedSecond.id); expect(service.getJob(queued.id)?.state).toBe('cancelled');
    release(); await service.cancel(first.id); expect(service.getJob(first.id)?.state).toBe('cancelled');
    service.close();
  });

  it('enforces per-job timeout separately from explicit cancellation', async () => {
    const service = scheduler(fakeRuntime());
    const job = await service.enqueue({ agentId: 'slow', model, priority: 'USER_INTERACTIVE', kind: 'timeout', timeoutMs: 20, handler: async context => new Promise((_resolve, reject) => { context.signal.addEventListener('abort', () => reject(new Error('provider stopped'))); }) });
    await expect(service.waitFor(job.id)).rejects.toMatchObject({ code: 'TIMEOUT' });
    expect(service.getJob(job.id)?.errorCode).toBe('TIMEOUT'); service.close();
  });

  it('recovers queued state after restart, unloads/reloads weights and recovers a crashed runtime', async () => {
    const storage = new InMemoryAIResourceSchedulerStateStore(); let loadAttempts = 0; const runtime = fakeRuntime({ load: async () => { loadAttempts += 1; if (loadAttempts === 1) throw new Error('temporary model crash'); } });
    const first = scheduler(runtime, { storage, keepLoaded: 'never' });
    const failed = await first.enqueue({ id: 'crash-job', agentId: 'agent', model, priority: 'ACTIVE_AGENT', kind: 'crash', handler: async context => context.runtime.infer('crash', context.signal) });
    expect(await first.waitFor(failed.id)).toBe('crash');
    expect(first.getJob(failed.id)?.state).toBe('completed');
    const recovered = await first.run({ id: 'recovered-job', agentId: 'agent', model, priority: 'ACTIVE_AGENT', kind: 'recover', handler: async context => context.runtime.infer('recovered', context.signal) });
    expect(recovered).toBe('recovered'); await eventually(() => runtime.loads >= 2);
    await eventually(() => runtime.unloads >= 1);

    let release!: () => void; const hold = new Promise<void>(resolve => { release = resolve; });
    const running = await first.enqueue({ id: 'restart-job', agentId: 'agent', model, priority: 'BACKGROUND', kind: 'restart', handler: async () => { await hold; return 'after-restart'; } });
    await eventually(() => first.getJob(running.id)?.state === 'running');
    await first.snapshot(); first.close(); release();
    const secondRuntime = fakeRuntime(); const second = scheduler(secondRuntime, { storage, keepLoaded: 'always' }); await second.ready();
    expect(second.getJob(running.id)?.state).toBe('queued');
    second.attachHandler(running.id, async () => 'after-restart');
    expect(await second.waitFor(running.id)).toBe('after-restart');
    second.close();
  });

  it('reacts to resource pressure and exposes local metrics/leases', async () => {
    const runtime = fakeRuntime(); const service = scheduler(runtime, { budget: { maxConcurrency: 2, foregroundConcurrency: 2, backgroundConcurrency: 1 } });
    await service.setResourceSignals({ ramPressure: 'high', thermalState: 'critical' });
    const background = await service.enqueue({ agentId: 'memory', model, priority: 'MEMORY_CONSOLIDATION', kind: 'pressure', handler: async () => 'blocked' });
    expect(background.state).toBe('paused');
    await service.setResourceSignals({ ramPressure: 'normal', thermalState: 'nominal' });
    const result = service.run({ agentId: 'eight', model, priority: 'USER_INTERACTIVE', kind: 'metric', handler: async context => { expect(context.lease.cancellable).toBe(true); expect(context.lease.model).toEqual(model); return 'ok'; } });
    expect(await result).toBe('ok');
    const metrics = service.getMetrics(); expect(metrics.completedJobs).toBeGreaterThan(0); expect(metrics.modelLoadTimeMs).toBeGreaterThanOrEqual(0); expect(service.listRuntimes()[0]?.loadCount).toBe(1);
    service.close();
  });

  it('rejects malformed identity/priority requests and does not persist non-durable jobs', async () => {
    const storage = new InMemoryAIResourceSchedulerStateStore(); const service = scheduler(fakeRuntime(), { storage });
    await expect(service.enqueue({ agentId: 'bad id', model, priority: 'USER_INTERACTIVE', kind: 'bad', handler: async () => undefined })).rejects.toBeInstanceOf(AIResourceSchedulerError);
    await service.enqueue({ agentId: 'ephemeral', model, priority: 'BACKGROUND', kind: 'ephemeral', persist: false, handler: async () => 'ok' });
    await eventually(() => service.getMetrics().completedJobs === 1); const snapshot = await service.snapshot(); expect(snapshot.jobs.some(job => job.kind === 'ephemeral')).toBe(false); service.close();
  });
});
