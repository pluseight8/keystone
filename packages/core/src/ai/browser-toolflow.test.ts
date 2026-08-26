import { describe, expect, it } from 'vitest';
import {
  BrowserAgentRuntime,
  type BrowserHostAdapter,
  type BrowserPageState,
} from '@keystone/browser-engine';
import { ToolExecutor, ToolPolicy, ToolRegistry, SkillRegistry, computeSkillIntegrityHash } from './tools.js';
import { ToolFlowCompiler, ToolFlowExecutor } from './toolflow.js';
import { registerBrowserToolFlowTools } from './browser-toolflow.js';

function page(tabId: string, url: string, revision = 1): BrowserPageState {
  return {
    version: 1,
    tabId,
    url,
    origin: new URL(url).origin,
    title: 'ToolFlow test page',
    pageRevision: revision,
    dataClass: 'PUBLIC',
    visibleText: 'typed browser page',
    interactiveElements: [],
    updatedAt: new Date().toISOString(),
  };
}

function host(): BrowserHostAdapter {
  const pages = new Map<string, BrowserPageState>();
  return {
    async observe(tabId) { return pages.get(tabId) ?? page(tabId, 'https://example.test/'); },
    async openTab(tabId, url) { const value = page(tabId, url); pages.set(tabId, value); return { page: value }; },
    async execute(_intent, context) { return { page: pages.get(context.tabId) }; },
  };
}

describe('Browser ToolFlow adapter', () => {
  it('executes only typed BrowserAgentRuntime operations and returns a bounded artifact', async () => {
    const registry = new ToolRegistry();
    const browser = new BrowserAgentRuntime({ host: host(), toolPolicy: { authorizeBrowserIntent: () => true } });
    const session = browser.createSession({ id: 'browser-flow-session', ownerAgentId: 'agent-run' });
    registerBrowserToolFlowTools(registry, { runtime: browser });
    const skills = new SkillRegistry();
    const manifest = {
      version: 1 as const,
      id: 'browser-flow-skill',
      name: 'Browser ToolFlow skill',
      packageVersion: '1.0.0',
      instructions: 'Use only typed browser tools.',
      toolIds: ['browser.openTab', 'browser.observe'],
      declaredCapabilities: ['DEVICE_ACTION', 'READ_PRIVATE'] as const,
      source: 'builtin' as const,
    };
    const integrityHash = await computeSkillIntegrityHash(manifest);
    await skills.install({ ...manifest, integrityHash, enabled: true, approvedCapabilities: ['DEVICE_ACTION', 'READ_PRIVATE'] }, { approvedCapabilities: ['DEVICE_ACTION', 'READ_PRIVATE'] });
    const compiler = new ToolFlowCompiler({ registry, skills });
    const flow = compiler.compile({
      id: 'browser-flow',
      creator: { kind: 'AgentRun', id: 'agent-run' },
      defaultSkillId: 'browser-flow-skill',
      allowedTools: ['browser.openTab', 'browser.observe'],
      allowedCapabilities: ['DEVICE_ACTION', 'READ_PRIVATE'],
      allowedDataScopes: [{ dataClasses: ['PUBLIC', 'USER_EXPLICIT', 'PRIVATE'] }],
      steps: [
        { id: 'open', op: 'CALL_TOOL', toolId: 'browser.openTab', args: { sessionId: session.id, url: 'https://example.test/' }, as: 'tab' },
        { id: 'observe', op: 'CALL_TOOL', toolId: 'browser.observe', args: { sessionId: session.id, tabId: { path: 'id', from: { ref: 'tab' } } }, as: 'page' },
        { id: 'return', op: 'RETURN', value: { path: 'visibleText', from: { ref: 'page' } } },
      ],
    });
    const result = await new ToolFlowExecutor({ registry, skills, toolExecutor: new ToolExecutor(registry, skills, { policy: new ToolPolicy({ authorize: () => true }), confirmation: { confirm: async () => true } }) }).execute(flow);
    expect(result.status).toBe('COMPLETED');
    expect(result.value).toBe('typed browser page');
    expect(result.trace.toolCalls).toBe(2);
    expect(result.artifact?.sourceToolCalls.map(call => call.toolId)).toEqual(['browser.openTab', 'browser.observe']);
  });
});
