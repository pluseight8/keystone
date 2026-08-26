import { describe, expect, it } from 'vitest';
import { ToolFlowCompiler, ToolFlowExecutor } from './toolflow.js';
import { ToolRegistry, SkillRegistry, ToolExecutor } from './tools.js';
import { AIResourceScheduler, type AIModelRuntime } from './resource-scheduler.js';
import { EphemeralAgentWorkerService } from './workers.js';
import { TaskGraphExecutor } from './task-graphs.js';

describe('ToolFlow integration with TaskGraphExecutor', () => {
  it('runs a mechanical flow as a bounded graph node and publishes its artifact protocol', async () => {
    const registry = new ToolRegistry();
    const skills = new SkillRegistry();
    const flowExecutor = new ToolFlowExecutor({ registry, skills, toolExecutor: new ToolExecutor(registry, skills) });
    const compiler = new ToolFlowCompiler({ registry, skills });
    const flow = compiler.compile({
      id: 'graph-flow', creator: { kind: 'AgentRun', id: 'agent-run' }, allowedTools: [], allowedCapabilities: [],
      allowedDataScopes: [{ dataClasses: ['PUBLIC', 'USER_EXPLICIT'] }],
      steps: [{ id: 'select', op: 'SELECT', path: '0.value.value', input: { ref: 'input' } }, { id: 'return', op: 'RETURN' }],
    });
    const model = { provider: 'test', model: 'shared' } as const;
    const runtime: AIModelRuntime = { model, async infer<T>(input: unknown): Promise<T> { return input as T; } };
    const scheduler = new AIResourceScheduler({ runtime, keepLoaded: 'always' });
    const workers = new EphemeralAgentWorkerService({ scheduler, model });
    const graphs = new TaskGraphExecutor({ workerService: workers, toolFlowExecutor: flowExecutor });
    const graph = await graphs.createGraph({ id: 'graph-with-flow', goal: 'mechanical', parentAgentId: 'agent', allowedDataScopes: [{ dataClasses: ['PUBLIC', 'USER_EXPLICIT'] }], nodes: [{ id: 'flow-node', objective: 'run flow', contextItems: [{ id: 'source', source: 'test', dataClass: 'PUBLIC', value: { value: 'done' } }], toolFlow: flow }] });
    const result = await graphs.run(graph.graph.id);
    expect(result.lifecycle).toBe('COMPLETED');
    expect(result.artifacts[0]?.value).toBe('done');
    scheduler.close();
  });
});
