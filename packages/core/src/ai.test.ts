import { describe, expect, it } from 'vitest';
import { AICommandProcessor, type AIModelAdapter } from './index.js';
import type { JsonValue, RegisteredAddonTool } from '@keystone/addons';
import type { AIAddonRegistry } from './ai.js';
import { testCrypto } from './testing.js';
describe('AICommandProcessor', () => { it('creates a strict action for a trusted node', async () => { const model: AIModelAdapter = { kind:'local', async complete(){ return { name:'create_node_action', arguments:{ intent:'order_food', targetNodeId:'son', requestedFields:['delivery_address'], parameters:{ item:'pizza' } } }; } }; const action = await new AICommandProcessor(model, testCrypto).process('Закажи сыну пиццу', [{ nodeId:'son', displayName:'Иван', aliases:['сын'], allowedFields:['delivery_address'] }]); expect(action.targetNodeId).toBe('son'); expect(action.requiresConfirmation).toBe(true); expect(action.actionHash).toBeTruthy(); }); it('rejects hallucinated nodes', async () => { const model: AIModelAdapter = { kind:'api', async complete(){ return { name:'create_node_action', arguments:{ intent:'order_food', targetNodeId:'invented', requestedFields:[], parameters:{} } }; } }; await expect(new AICommandProcessor(model, testCrypto).process('test', [])).rejects.toThrow(/untrusted/); }); });

describe('AICommandProcessor addon hooks', () => {
  it('routes model arguments through the registered AddonEngine tool boundary', async () => {
    const tool: RegisteredAddonTool = { addonId:'org.example.review', addonName:'Review', id:'summarize', qualifiedName:'org.example.review:summarize', name:'Summarize', description:'Summarize notes', parameters:{ type:'object', required:['text'], properties:{ text:{ type:'string' } }, additionalProperties:false } };
    let executed: JsonValue | undefined;
    const addons: AIAddonRegistry = { listTools: () => [tool], async executeTool(_name, input) { executed = input; return { ok:true }; } };
    const model: AIModelAdapter = { kind:'local', async complete(input) { return { name:input.tool.name, arguments:{ text:'week' } }; } };
    await expect(new AICommandProcessor(model, testCrypto, addons).processAddonTool('Summarize my week', tool.qualifiedName)).resolves.toEqual({ ok:true });
    expect(executed).toEqual({ text:'week' });
  });
});
