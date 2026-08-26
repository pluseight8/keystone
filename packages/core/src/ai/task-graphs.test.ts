import { describe, expect, it } from 'vitest';
import {
  AIResourceScheduler,
  type AIModelRuntime,
} from './resource-scheduler.js';
import {
  EphemeralAgentWorkerService,
  type WorkerModelExecutor,
} from './workers.js';
import {
  TaskGraphError,
  TaskGraphExecutor,
  InMemoryTaskGraphStateStore,
  TaskGraphPlanner,
  type TaskGraphInput,
} from './task-graphs.js';

const model = { provider: 'test-local', model: 'shared' } as const;

function wait(ms = 5): Promise<void> { return new Promise(resolve => setTimeout(resolve, ms)); }

async function eventually(check: () => boolean | Promise<boolean>, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() >= deadline) throw new Error('condition was not reached');
    await wait();
  }
}

function makeRuntime(loads: { count: number }): AIModelRuntime {
  return {
    model,
    async load() { loads.count += 1; },
    async unload() {},
    async infer<T>(input: unknown): Promise<T> { return input as T; },
  };
}

function makeHarness(modelExecutor: WorkerModelExecutor, options: { maxConcurrency?: number; storage?: ConstructorParameters<typeof TaskGraphExecutor>[0]['storage'] } = {}) {
  const loads = { count: 0 };
  const runtime = makeRuntime(loads);
  const scheduler = new AIResourceScheduler({
    runtimeFactory: () => runtime,
    keepLoaded: 'always',
    budget: { maxConcurrency: options.maxConcurrency ?? 3, foregroundConcurrency: 1, backgroundConcurrency: options.maxConcurrency ?? 3, maxQueuedJobs: 64 },
  });
  const workers = new EphemeralAgentWorkerService({ scheduler, model, modelExecutor });
  const graphs = new TaskGraphExecutor({ workerService: workers, storage: options.storage });
  return { graphs, workers, scheduler, loads };
}

function publicContext(id: string) {
  return { id, source: 'shared', dataClass: 'PUBLIC' as const, value: `context:${id}` };
}

function graphInput(overrides: Partial<TaskGraphInput> = {}): TaskGraphInput {
  return {
    id: overrides.id ?? `graph-${crypto.randomUUID()}`,
    goal: overrides.goal ?? 'complete bounded task',
    parentAgentId: overrides.parentAgentId ?? 'eight',
    nodes: overrides.nodes ?? [{ id: 'one', objective: 'produce result', contextItems: [publicContext('source')] }],
    ...overrides,
  };
}

describe('TaskGraphPlanner and TaskGraphExecutor', () => {
  it('executes sequential dependencies and passes only verified artifacts forward', async () => {
    const requests: string[][] = [];
    const harness = makeHarness(async request => { requests.push(request.context.map(item => item.source ?? '')); return { text: `${request.objective}:done`, sourceIds: request.context.map(item => item.id) }; });
    const graph = await harness.graphs.createGraph(graphInput({ id: 'graph-sequential', nodes: [
      { id: 'collect', objective: 'collect facts', outputRefs: ['collect:result'], contextItems: [publicContext('facts')] },
      { id: 'summarize', objective: 'summarize facts', dependencies: [{ nodeId: 'collect', inputRefs: ['collect:result'] }], inputRefs: ['collect:result'] },
    ] }));
    const result = await harness.graphs.run(graph.graph.id);
    expect(result.lifecycle).toBe('COMPLETED');
    expect(result.summary?.completedNodeIds).toEqual(['collect', 'summarize']);
    expect(result.summary?.output).toBe('summarize facts:done');
    expect(requests[0]).toContain('shared');
    expect(requests[1]).toContain('task-artifact');
    expect(result.artifacts).toHaveLength(2);
    expect(result.artifacts.every(artifact => harness.graphs.verifyArtifact(artifact))).toBe(true);
    harness.scheduler.close();
  });

  it('runs independent nodes in parallel while sharing one model runtime', async () => {
    let active = 0; let peak = 0;
    const harness = makeHarness(async request => { active += 1; peak = Math.max(peak, active); await wait(25); active -= 1; return { text: request.objective }; }, { maxConcurrency: 2 });
    const graph = await harness.graphs.createGraph(graphInput({ id: 'graph-parallel', budget: { maxConcurrentNodes: 2 }, nodes: [
      { id: 'a', objective: 'parallel a' }, { id: 'b', objective: 'parallel b' },
    ] }));
    const result = await harness.graphs.run(graph.graph.id);
    expect(result.lifecycle).toBe('COMPLETED');
    expect(peak).toBe(2);
    expect(harness.loads.count).toBe(1);
    harness.scheduler.close();
  });

  it('rejects duplicate, missing and cyclic dependencies before execution', async () => {
    const planner = new TaskGraphPlanner();
    expect(() => planner.plan(graphInput({ id: 'graph-cycle', nodes: [{ id: 'a', objective: 'a', dependencies: ['b'] }, { id: 'b', objective: 'b', dependencies: ['a'] }] }))).toThrowError(new TaskGraphError('GRAPH_CYCLE', 'Task graph contains a cycle'));
    expect(() => planner.plan(graphInput({ id: 'graph-missing', nodes: [{ id: 'a', objective: 'a', dependencies: ['missing'] }] }))).toThrowError(/missing node/);
    expect(() => planner.plan(graphInput({ id: 'graph-duplicate', nodes: [{ id: 'a', objective: 'a' }, { id: 'a', objective: 'again' }] }))).toThrowError(/duplicate/);
  });

  it('bounds graph size, depth, fan-out and per-node capability declarations', async () => {
    const planner = new TaskGraphPlanner();
    expect(() => planner.plan(graphInput({ id: 'graph-size', budget: { maxNodes: 1 }, nodes: [{ id: 'a', objective: 'a' }, { id: 'b', objective: 'b' }] }))).toThrowError(/node budget/);
    expect(() => planner.plan(graphInput({ id: 'graph-depth', budget: { maxDepth: 1 }, nodes: [{ id: 'a', objective: 'a' }, { id: 'b', objective: 'b', dependencies: ['a'] }, { id: 'c', objective: 'c', dependencies: ['b'] }] }))).toThrowError(/depth budget/);
    expect(() => planner.plan(graphInput({ id: 'graph-fanout', budget: { maxFanOut: 1 }, nodes: [{ id: 'root', objective: 'root' }, { id: 'a', objective: 'a', dependencies: ['root'] }, { id: 'b', objective: 'b', dependencies: ['root'] }] }))).toThrowError(/fan-out/);
    expect(() => planner.plan(graphInput({ id: 'graph-capability', nodes: [{ id: 'private', objective: 'private', requiredCapabilities: ['READ_PRIVATE'] }] }))).toThrowError(/capability/);
  });

  it('returns a partial result when one branch fails and its dependent is blocked', async () => {
    const harness = makeHarness(async request => { if (request.objective.includes('fail')) throw new Error('provider failed'); return { text: 'ok' }; });
    const graph = await harness.graphs.createGraph(graphInput({ id: 'graph-partial', nodes: [
      { id: 'good', objective: 'good branch' }, { id: 'bad', objective: 'fail branch' }, { id: 'blocked', objective: 'blocked branch', dependencies: ['bad'] },
    ] }));
    const result = await harness.graphs.run(graph.graph.id);
    expect(result.lifecycle).toBe('PARTIAL');
    expect(result.summary?.completedNodeIds).toContain('good');
    expect(result.summary?.failedNodeIds).toEqual(expect.arrayContaining(['bad', 'blocked']));
    harness.scheduler.close();
  });

  it('supports pause/resume, cancellation and bounded retries', async () => {
    let calls = 0;
    const harness = makeHarness(async request => { calls += 1; if (request.objective === 'retry' && calls === 1) throw new Error('temporary'); await wait(10); return { text: 'done' }; });
    const graph = await harness.graphs.createGraph(graphInput({ id: 'graph-controls', budget: { maxRetries: 1 }, nodes: [{ id: 'retry', objective: 'retry', retryPolicy: { maxAttempts: 2 } }] }));
    await harness.graphs.pause(graph.graph.id);
    expect((await harness.graphs.get(graph.graph.id))?.lifecycle).toBe('PAUSED');
    const run = harness.graphs.run(graph.graph.id);
    await wait(10);
    await harness.graphs.resume(graph.graph.id);
    const controlled = await run;
    expect(controlled.lifecycle).toBe('COMPLETED');
    expect(calls).toBe(2);

    const cancellation = await harness.graphs.createGraph(graphInput({ id: 'graph-cancel', nodes: [{ id: 'long', objective: 'long' }] }));
    const pending = harness.graphs.run(cancellation.graph.id);
    await eventually(async () => (await harness.graphs.get(cancellation.graph.id))?.nodes.some(node => node.status === 'RUNNING') === true);
    await harness.graphs.cancel(cancellation.graph.id);
    expect((await pending).lifecycle).toBe('CANCELLED');
    harness.scheduler.close();
  });

  it('invalidates stale results on revision and keeps private artifacts out of external nodes', async () => {
    let release!: () => void;
    const hold = new Promise<void>(resolve => { release = resolve; });
    const harness = makeHarness(async request => { if (request.objective === 'old') await hold; return { text: request.objective }; });
    const graph = await harness.graphs.createGraph(graphInput({ id: 'graph-revision', nodes: [{ id: 'node', objective: 'old' }] }));
    const pending = harness.graphs.run(graph.graph.id);
    await eventually(async () => (await harness.graphs.get(graph.graph.id))?.nodes[0]?.status === 'RUNNING');
    const revised = await harness.graphs.changeGoal(graph.graph.id, 'new goal');
    expect(revised.graphRevision).toBe(2);
    release();
    const result = await pending;
    expect(result.lifecycle).toBe('COMPLETED');
    expect(result.graphRevision).toBe(2);
    expect(result.summary?.output).toBe('old');

    const external = await harness.graphs.createGraph(graphInput({ id: 'graph-external-private', execution: 'external', allowedDataScopes: [{ dataClasses: ['PRIVATE'] }], nodes: [{ id: 'private', objective: 'private', contextItems: [{ id: 'secret', source: 'memory', dataClass: 'PRIVATE', value: 'secret' }] }] }));
    const externalResult = await harness.graphs.run(external.graph.id);
    expect(externalResult.lifecycle).toBe('FAILED');
    expect(externalResult.nodes[0]?.errorCode).toBe('GRAPH_EXTERNAL_PRIVATE');
    harness.scheduler.close();
  });

  it('enforces least-context scope and rejects tampered artifacts', async () => {
    const harness = makeHarness(async () => ({ text: 'public result' }));
    const graph = await harness.graphs.createGraph(graphInput({ id: 'graph-artifact', nodes: [{ id: 'node', objective: 'artifact' }] }));
    const result = await harness.graphs.run(graph.graph.id);
    const artifact = result.artifacts[0]!;
    expect(harness.graphs.verifyArtifact(artifact)).toBe(true);
    expect(harness.graphs.verifyArtifact({ ...artifact, value: 'tampered' })).toBe(false);
    await expect(harness.graphs.createGraph(graphInput({ id: 'graph-scope', allowedDataScopes: [{ dataClasses: ['PUBLIC'], sourceKinds: ['shared'] }], nodes: [{ id: 'node', objective: 'scope', allowedDataScopes: [{ dataClasses: ['PUBLIC'] }] }] }))).rejects.toMatchObject({ code: 'GRAPH_SCOPE_DENIED' });
    harness.scheduler.close();
  });

  it('does not pass a private artifact into a public-only dependent node', async () => {
    const harness = makeHarness(async request => request.objective === 'private producer' ? { text: 'secret' } : { text: 'should not run' });
    const graph = await harness.graphs.createGraph(graphInput({ id: 'graph-private-artifact', allowedDataScopes: [{ dataClasses: ['PUBLIC', 'PRIVATE'] }], nodes: [
      { id: 'producer', objective: 'private producer', allowedDataScopes: [{ dataClasses: ['PRIVATE'] }], contextItems: [{ id: 'secret', source: 'memory', dataClass: 'PRIVATE', value: 'secret' }] },
      { id: 'consumer', objective: 'public consumer', dependencies: ['producer'], allowedDataScopes: [{ dataClasses: ['PUBLIC'] }] },
    ] }));
    const result = await harness.graphs.run(graph.graph.id);
    expect(result.lifecycle).toBe('PARTIAL');
    expect(result.nodes.find(node => node.id === 'consumer')?.errorCode).toBe('GRAPH_SCOPE_DENIED');
    harness.scheduler.close();
  });

  it('replans only the changed branch and restores durable graph metadata', async () => {
    const storage = new InMemoryTaskGraphStateStore();
    const harness = makeHarness(async request => ({ text: request.objective }), { storage });
    const graph = await harness.graphs.createGraph(graphInput({ id: 'graph-replan', nodes: [{ id: 'first', objective: 'first' }] }));
    const revised = await harness.graphs.replan(graph.graph.id, { expectedRevision: 1, updateNodes: [{ id: 'first', patch: { objective: 'updated' } }], addNodes: [{ id: 'second', objective: 'second', dependencies: ['first'] }] });
    expect(revised.graphRevision).toBe(2);
    expect(revised.nodes.find(node => node.id === 'first')?.status).toBe('STALE');
    expect(revised.nodes.find(node => node.id === 'second')?.status).toBe('STALE');
    const result = await harness.graphs.run(graph.graph.id);
    expect(result.lifecycle).toBe('COMPLETED');
    expect(result.summary?.completedNodeIds).toEqual(['first', 'second']);
    const restarted = new TaskGraphExecutor({ workerService: harness.workers, storage });
    await restarted.ready();
    expect((await restarted.get(graph.graph.id))?.graphRevision).toBe(2);

    const preserved = await harness.graphs.createGraph(graphInput({ id: 'graph-preserve', nodes: [{ id: 'source', objective: 'source' }, { id: 'consumer', objective: 'consumer', dependencies: ['source'] }] }));
    expect((await harness.graphs.run(preserved.graph.id)).lifecycle).toBe('COMPLETED');
    const preservedPlan = await harness.graphs.replan(preserved.graph.id, { updateNodes: [{ id: 'consumer', patch: { objective: 'consumer updated' } }] });
    expect(preservedPlan.nodes.find(node => node.id === 'source')?.status).toBe('COMPLETED');
    expect((await harness.graphs.run(preserved.graph.id)).lifecycle).toBe('COMPLETED');
    harness.scheduler.close();
  });
});
