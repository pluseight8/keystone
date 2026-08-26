import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ToolExecutor, ToolRegistry, SkillRegistry, computeSkillIntegrityHash } from './tools.js';
import { ToolFlowCompiler, ToolFlowExecutor } from './toolflow.js';

describe('ToolFlow benchmark counters', () => {
  it('compares repeated model/tool round trips with one model proposal plus a flow', async () => {
    const registry = new ToolRegistry();
    registry.register({ version: 1, id: 'bench.echo', name: 'Benchmark echo', description: 'Bounded benchmark tool', capabilities: ['READ_PRIVATE'], inputSchema: z.object({ value: z.number() }).strict(), outputSchema: z.object({ value: z.number() }).strict(), resultClass: 'PUBLIC', execute: input => ({ value: input.value }) });
    const skills = new SkillRegistry(); const manifest = { version: 1 as const, id: 'bench-skill', name: 'Benchmark skill', packageVersion: '1.0.0', instructions: 'Use benchmark tool.', toolIds: ['bench.echo'], declaredCapabilities: ['READ_PRIVATE'] as const, source: 'builtin' as const }; const integrityHash = await computeSkillIntegrityHash(manifest); await skills.install({ ...manifest, integrityHash, enabled: true, approvedCapabilities: ['READ_PRIVATE'] }, { approvedCapabilities: ['READ_PRIVATE'] });
    const toolExecutor = new ToolExecutor(registry, skills); const compiler = new ToolFlowCompiler({ registry, skills }); const executor = new ToolFlowExecutor({ registry, skills, toolExecutor });
    const values = Array.from({ length: 8 }, (_unused, index) => index + 1);
    const flow = compiler.compile({ id: 'bench-flow', creator: { kind: 'AgentRun', id: 'bench-run' }, defaultSkillId: 'bench-skill', allowedTools: ['bench.echo'], allowedCapabilities: ['READ_PRIVATE'], allowedDataScopes: [{ dataClasses: ['PUBLIC'] }], budget: { maxIterations: 8, maxToolCalls: 8, maxExpansion: 8 }, steps: [{ id: 'map', op: 'MAP', input: values, steps: [{ id: 'call', op: 'CALL_TOOL', toolId: 'bench.echo', skillId: 'bench-skill', args: { value: { ref: 'item' } } }] }, { id: 'return', op: 'RETURN' }] });
    let repeatedModelRoundTrips = 0; let repeatedToolCalls = 0; const startedA = performance.now();
    for (const value of values) { repeatedModelRoundTrips += 1; const intent = registry.issueIntent({ toolId: 'bench.echo', skillId: 'bench-skill', arguments: { value }, requestedCapabilities: ['READ_PRIVATE'], source: 'local' }); await toolExecutor.execute(intent); repeatedToolCalls += 1; }
    const elapsedA = performance.now() - startedA;
    let flowModelRoundTrips = 1; const startedB = performance.now(); const result = await executor.execute(flow); const elapsedB = performance.now() - startedB;
    expect(result.status).toBe('COMPLETED'); expect(result.trace.toolCalls).toBe(values.length); expect(flowModelRoundTrips).toBe(1);
    // Keep the measured counters in the test output; wall time is intentionally
    // informational because CI hosts have different scheduling characteristics.
    console.info(JSON.stringify({ repeatedModelRoundTrips, repeatedToolCalls, flowModelRoundTrips, flowToolCalls: result.trace.toolCalls, repeatedMs: Number(elapsedA.toFixed(3)), flowMs: Number(elapsedB.toFixed(3)) }));
  });
});
