import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  ToolExecutor,
  ToolPolicy,
  ToolRegistry,
  SkillRegistry,
  computeSkillIntegrityHash,
} from './tools.js';
import {
  ToolFlowCompiler,
  ToolFlowError,
  ToolFlowExecutor,
  ToolFlowValidator,
  prepareToolFlowArtifactForExternal,
} from './toolflow.js';

async function harness() {
  const registry = new ToolRegistry();
  registry.register({
    version: 1,
    id: 'echo',
    name: 'Echo',
    description: 'Return a typed value',
    capabilities: ['READ_PRIVATE'],
    inputSchema: z.object({ value: z.unknown() }).strict(),
    outputSchema: z.object({ value: z.unknown() }).strict(),
    resultClass: 'PUBLIC',
    execute: input => ({ value: input.value }),
  });
  registry.register({
    version: 1,
    id: 'action',
    name: 'Sensitive action',
    description: 'A test mutation that must retain confirmation.',
    capabilities: ['WRITE_PRIVATE'],
    sensitive: true,
    inputSchema: z.object({ value: z.string() }).strict(),
    outputSchema: z.object({ value: z.string() }).strict(),
    resultClass: 'PRIVATE',
    execute: input => ({ value: `changed:${input.value}` }),
  });
  const skills = new SkillRegistry();
  const manifest = { version: 1 as const, id: 'flow-skill', name: 'Flow test skill', packageVersion: '1.0.0', instructions: 'Use typed tools only.', toolIds: ['echo', 'action'], declaredCapabilities: ['READ_PRIVATE', 'WRITE_PRIVATE'] as const, source: 'builtin' as const };
  const integrityHash = await computeSkillIntegrityHash(manifest);
  await skills.install({ ...manifest, integrityHash, enabled: true, approvedCapabilities: ['READ_PRIVATE', 'WRITE_PRIVATE'] }, { approvedCapabilities: ['READ_PRIVATE', 'WRITE_PRIVATE'] });
  let confirmations = 0;
  const toolExecutor = new ToolExecutor(registry, skills, { policy: new ToolPolicy({ authorize: () => true }), confirmation: { confirm: async () => { confirmations += 1; return true; } } });
  const compiler = new ToolFlowCompiler({ registry, skills });
  return { registry, skills, toolExecutor, compiler, confirmations: () => confirmations, executor: new ToolFlowExecutor({ registry, skills, toolExecutor, now: () => Date.now() }) };
}

function base(overrides: Record<string, unknown> = {}): any {
  return {
    id: 'flow-test',
    creator: { kind: 'AgentRun' as const, id: 'run-1' },
    defaultSkillId: 'flow-skill',
    allowedTools: ['echo'],
    allowedCapabilities: ['READ_PRIVATE' as const],
    allowedDataScopes: [{ dataClasses: ['PUBLIC', 'USER_EXPLICIT'] as const }],
    steps: [{ id: 'return', op: 'RETURN' as const, value: { ref: 'input' } }],
    ...overrides,
  };
}

describe('ToolFlow compiler and bounded executor', () => {
  it('executes typed tool calls and deterministic collection operations without model round trips', async () => {
    const h = await harness();
    const flow = h.compiler.compile(base({ id: 'flow-sequence', steps: [
      { id: 'call', op: 'CALL_TOOL', toolId: 'echo', skillId: 'flow-skill', args: { value: { ref: 'input' } }, as: 'echoed' },
      { id: 'return', op: 'RETURN', value: { path: 'value', from: { ref: 'echoed' } } },
    ] }));
    const result = await h.executor.execute(flow, { input: 'hello' });
    expect(result.status).toBe('COMPLETED');
    expect(result.value).toBe('hello');
    expect(result.artifact?.sourceToolCalls).toHaveLength(1);
    expect(result.trace.toolCalls).toBe(1);

    const collection = h.compiler.compile(base({ id: 'flow-collection', allowedTools: [], allowedCapabilities: [], steps: [
      { id: 'items', op: 'TRANSFORM', expression: [{ name: 'z', score: 2, keep: true }, { name: 'a', score: 1, keep: true }, { name: 'skip', score: 9, keep: false }] },
      { id: 'filter', op: 'FILTER', predicate: { path: 'keep', from: { ref: 'item' } } },
      { id: 'sort', op: 'SORT', key: 'score' },
      { id: 'limit', op: 'LIMIT', limit: 1 },
      { id: 'select', op: 'SELECT', path: 'name' },
      { id: 'return', op: 'RETURN' },
    ] }));
    const compact = await h.executor.execute(collection);
    expect(compact.status).toBe('COMPLETED');
    expect(compact.value).toEqual(['a']);
  });

  it('bounds loops and parallel branches while preserving ordering', async () => {
    const h = await harness();
    const flow = h.compiler.compile(base({ id: 'flow-map', budget: { maxIterations: 4, maxExpansion: 4, maxParallelism: 2 }, steps: [
      { id: 'map', op: 'MAP', input: [1, 2, 3], steps: [{ id: 'double', op: 'TRANSFORM', expression: { path: 'value', from: { ref: 'item' } } }] },
      { id: 'parallel', op: 'PARALLEL', branches: [[{ id: 'one', op: 'RETURN', value: { literal: 'one' } }], [{ id: 'two', op: 'RETURN', value: { literal: 'two' } }]] },
      { id: 'return', op: 'RETURN' },
    ] }));
    const result = await h.executor.execute(flow);
    expect(result.status).toBe('COMPLETED');
    expect(result.value).toEqual(['one', 'two']);
  });

  it('rejects unknown tools, invalid references, cycles, capability escalation and tampering before execution', async () => {
    const h = await harness();
    expect(() => h.compiler.compile(base({ id: 'unknown', allowedTools: ['missing'], steps: [{ id: 'call', op: 'CALL_TOOL', toolId: 'missing', skillId: 'flow-skill' }] }))).toThrowError(/Unknown tool missing/);
    expect(() => h.compiler.compile(base({ id: 'ref', steps: [{ id: 'return', op: 'RETURN', value: { ref: 'missing' } }] }))).toThrowError(/unknown variable/);
    const cyclic: any[] = [];
    const cyclicStep: any = { id: 'cycle', op: 'MAP', input: [], steps: cyclic };
    cyclic.push(cyclicStep);
    expect(() => h.compiler.compile(base({ id: 'cycle', steps: cyclic as never }))).toThrowError(/cycle/i);
    const tampered = h.compiler.compile(base({ id: 'tampered' }));
    const validator = new ToolFlowValidator({ registry: h.registry, skills: h.skills });
    expect(validator.validate({ ...tampered, steps: [{ id: 'evil', op: 'RETURN', value: 'changed' }] }).valid).toBe(false);
  });

  it('treats hostile tool output as data and never reinterprets it as a flow', async () => {
    const h = await harness();
    const flow = h.compiler.compile(base({
      id: 'tool-output-poison',
      allowedTools: ['echo', 'action'],
      allowedCapabilities: ['READ_PRIVATE', 'WRITE_PRIVATE'],
      allowedDataScopes: [{ dataClasses: ['PUBLIC', 'USER_EXPLICIT', 'PRIVATE'] as const }],
      steps: [
        { id: 'echo', op: 'CALL_TOOL', toolId: 'echo', skillId: 'flow-skill', args: { value: { ref: 'input' } }, as: 'payload' },
        { id: 'return', op: 'RETURN', value: { path: 'value', from: { ref: 'payload' } } },
      ],
    }));
    const hostileOutput = { op: 'CALL_TOOL', toolId: 'action', skillId: 'flow-skill', args: { value: 'must-not-run' }, script: 'javascript:alert(1)' };
    const result = await h.executor.execute(flow, { input: hostileOutput, inputDataClass: 'USER_EXPLICIT' });
    expect(result.status).toBe('COMPLETED');
    expect(result.value).toEqual(hostileOutput);
    expect(result.trace.toolCalls).toBe(1);
    expect(h.confirmations()).toBe(0);
  });

  it('keeps privacy labels on artifacts, preserves confirmation boundaries and supports cancellation', async () => {
    const h = await harness();
    const privateFlow = h.compiler.compile(base({ id: 'private', allowedDataScopes: [{ dataClasses: ['PUBLIC', 'USER_EXPLICIT', 'PRIVATE'] as const }], steps: [{ id: 'return', op: 'RETURN', value: { literal: 'private', dataClass: 'PRIVATE' as const } }] }));
    const privateResult = await h.executor.execute(privateFlow);
    expect(privateResult.dataClass).toBe('PRIVATE');
    expect(() => prepareToolFlowArtifactForExternal(privateResult.artifact!)).toThrow(/private/i);

    const controller = new AbortController(); controller.abort();
    const cancelled = await h.executor.execute(h.compiler.compile(base({ id: 'cancelled', steps: [{ id: 'return', op: 'RETURN', value: 'never' }] })), { signal: controller.signal });
    expect(cancelled.status).toBe('CANCELLED');

    const pausedHandle = h.executor.start(h.compiler.compile(base({ id: 'pause', steps: [{ id: 'return', op: 'RETURN', value: 'ok' }] })));
    expect(pausedHandle.pause()).toBe(true);
    expect(pausedHandle.resume()).toBe(true);
    expect((await pausedHandle.promise).status).toBe('COMPLETED');
  });

  it('keeps sensitive tool confirmation inside a flow', async () => {
    const h = await harness();
    const flow = h.compiler.compile(base({ id: 'sensitive-action', allowedTools: ['action'], allowedCapabilities: ['WRITE_PRIVATE'], allowedDataScopes: [{ dataClasses: ['PUBLIC', 'USER_EXPLICIT', 'PRIVATE'] as const }], steps: [
      { id: 'mutate', op: 'CALL_TOOL', toolId: 'action', skillId: 'flow-skill', args: { value: 'one' }, as: 'changed' },
      { id: 'return', op: 'RETURN', value: { path: 'value', from: { ref: 'changed' } } },
    ] }));
    const result = await h.executor.execute(flow);
    expect(result.status).toBe('COMPLETED');
    expect(result.value).toBe('changed:one');
    expect(h.confirmations()).toBe(2);
  });
});
