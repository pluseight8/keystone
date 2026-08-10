import { describe, expect, it } from 'vitest';
import { AddonEngine, AddonSecurityError, type AddonActivation, type AddonSandboxRuntime, type JsonValue, type SandboxHostCall } from './index.js';

const manifest = {
  schema: 'keystone.addon.v1',
  id: 'org.example.review',
  name: 'Review',
  version: '1.0.0',
  entrypoint: 'dist/addon.js',
  permissions: ['ai_prompt', 'life_map_read'],
} as const;

function runtime(activation: AddonActivation, onTool?: (input: JsonValue) => JsonValue): AddonSandboxRuntime & { hostCall?: (call: SandboxHostCall) => Promise<JsonValue> } {
  const value: AddonSandboxRuntime & { hostCall?: (call: SandboxHostCall) => Promise<JsonValue> } = {
    isolation: 'test',
    async load(input) {
      value.hostCall = input.hostCall;
      return {
        async invoke(method, payload) { if (method === 'activate') return activation as unknown as JsonValue; return onTool?.(payload) ?? null; },
        async dispose() {},
      };
    },
  };
  return value;
}

describe('AddonEngine', () => {
  it('registers namespaced tools, custom nodes and declarative widgets', async () => {
    const sandbox = runtime({ apiVersion: 1, hooks: {
      tools: [{ id: 'summarize', name: 'Summarize', description: 'Summarize text', parameters: { type: 'object', required: ['text'], additionalProperties: false, properties: { text: { type: 'string' } } }, requiredCapabilities: ['ai_prompt'] }],
      customNodes: [{ id: 'review', displayName: 'Review', glyph: 'R', color: '#663399' }],
      widgets: [{ id: 'status', displayName: 'Status', slot: 'dashboard', view: { kind: 'metric', title: 'Review status' } }],
    } }, input => input);
    const engine = new AddonEngine({ runtime: sandbox, confirmation: { async confirm() { return true; } } });
    await engine.install(manifest, new Uint8Array([1]));
    expect(engine.listTools()[0]?.qualifiedName).toBe('org.example.review:summarize');
    expect(engine.listCustomNodes()[0]?.qualifiedType).toBe('org.example.review:review');
    expect(engine.listWidgets()[0]?.qualifiedId).toBe('org.example.review:status');
    await expect(engine.executeTool('org.example.review:summarize', { text: 'hello' })).resolves.toEqual({ text: 'hello' });
    await expect(engine.executeTool('org.example.review:summarize', { unexpected: true })).rejects.toThrow(/required|not allowed/);
  });

  it('denies undeclared capabilities before a host handler is called', async () => {
    const sandbox = runtime({ apiVersion: 1 });
    const engine = new AddonEngine({ runtime: sandbox, confirmation: { async confirm() { return true; } }, capabilities: { p2p_request: async () => ({ sent: true }) } });
    await engine.install(manifest, new Uint8Array([1]));
    await expect(sandbox.hostCall?.({ capability: 'p2p_request', operation: 'send', input: {}, reason: 'Contact peer' })).rejects.toMatchObject({ code: 'CAPABILITY_NOT_DECLARED' } satisfies Partial<AddonSecurityError>);
  });

  it('requires an action-scoped swipe approval for every Life Map read', async () => {
    const prompts: string[] = [];
    const audits: string[] = [];
    const sandbox = runtime({ apiVersion: 1 });
    const engine = new AddonEngine({
      runtime: sandbox,
      consent: { async evaluateAddonAction(input) { audits.push(input.action); return { mode: 'double_confirmation', allowed: false }; } },
      confirmation: { async confirm(request) { prompts.push(request.message); return prompts.length === 1; } },
      capabilities: { life_map_read: async () => ({ nodes: [] }) },
    });
    await engine.install(manifest, new Uint8Array([1]));
    await expect(sandbox.hostCall?.({ capability: 'life_map_read', operation: 'snapshot', input: {}, reason: 'Build weekly review' })).resolves.toEqual({ nodes: [] });
    await expect(sandbox.hostCall?.({ capability: 'life_map_read', operation: 'snapshot', input: {}, reason: 'Read again' })).rejects.toMatchObject({ code: 'USER_DENIED' } satisfies Partial<AddonSecurityError>);
    expect(prompts).toEqual(['Аддон Review запрашивает доступ...', 'Аддон Review запрашивает доступ...']);
    expect(audits).toEqual(['addon_life_map_read', 'addon_life_map_read']);
  });
});
