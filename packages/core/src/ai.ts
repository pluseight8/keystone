import { canonicalJson, type CryptoProvider } from './crypto.js';
import type { NodeId } from './types.js';
import type { DeviceSync } from './sync/handoff.js';

export type AIProviderKind = 'local' | 'oauth' | 'api';
export interface TrustedNode { nodeId: NodeId; displayName: string; aliases: string[]; allowedFields: string[]; role?: import('./types.js').Role; }
export interface ModelToolCall { name: 'create_node_action' | 'ui_action' | 'cross_device_action'; arguments: unknown; }
export interface UIElement { id?: string; text?: string; contentDescription?: string; role?: string; clickable?: boolean; enabled?: boolean; bounds?: { x: number; y: number; width: number; height: number }; children?: UIElement[]; }
export type UIAction = { kind: 'tap'; elementId?: string; x?: number; y?: number } | { kind: 'swipe'; x1: number; y1: number; x2: number; y2: number; durationMs: number } | { kind: 'type'; text: string; elementId?: string };
export interface AIModelAdapter { kind: AIProviderKind; complete(input: { system: string; user: string; tool: typeof ACTION_TOOL | typeof UI_ACTION_TOOL | typeof CROSS_DEVICE_TOOL }): Promise<ModelToolCall>; }
export interface ActionPayload { version: 1; intent: 'order_food' | 'send_message' | 'research' | 'unknown'; targetNodeId: NodeId | null; requestedFields: string[]; parameters: Record<string, string>; requiresConfirmation: true; actionHash: string; }

export const ACTION_TOOL = { name: 'create_node_action', description: 'Create one scoped Keystone action. Never invent a node or personal data.', parameters: { type: 'object', additionalProperties: false, required: ['intent','targetNodeId','requestedFields','parameters'], properties: { intent: { enum: ['order_food','send_message','research','unknown'] }, targetNodeId: { type: ['string','null'] }, requestedFields: { type: 'array', items: { type: 'string' } }, parameters: { type: 'object', additionalProperties: { type: 'string' } } } } } as const;
export const UI_ACTION_TOOL = { name: 'ui_action', description: 'Choose one UI action from the supplied accessibility tree. Never click outside a matched element.', parameters: { type: 'object', additionalProperties: false, required: ['kind'], properties: { kind: { enum: ['tap','swipe','type'] }, elementId: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' }, x1: { type: 'number' }, y1: { type: 'number' }, x2: { type: 'number' }, y2: { type: 'number' }, durationMs: { type: 'number' }, text: { type: 'string', maxLength: 4096 } } } } as const;
export const CROSS_DEVICE_TOOL = { name: 'cross_device_action', description: 'Route a basic action to one trusted Self device. Critical OS automation is never allowed by this tool.', parameters: { type: 'object', additionalProperties: false, required: ['kind','targetNodeId'], properties: { kind: { enum: ['clipboard','browser_tab','file_offer'] }, targetNodeId: { type: 'string' }, text: { type: 'string', maxLength: 1_000_000 }, url: { type: 'string', pattern: '^https?://' }, title: { type: 'string', maxLength: 512 }, transferId: { type: 'string' }, name: { type: 'string', maxLength: 512 }, size: { type: 'integer', minimum: 0, maximum: 10737418240 }, mimeType: { type: 'string', maxLength: 256 }, sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' } } } } as const;
export const KEYSTONE_SYSTEM_PROMPT = `You are Keystone's intent router, not an autonomous authority. Nodes are user-owned devices identified only by the supplied trusted-node list. Never invent a node, identity, address, preference, price, or successful outcome. If the target is ambiguous or missing, return intent "unknown" and targetNodeId null. Request the minimum data fields. Do not put personal data in parameters. Every external side effect and every disclosure requires explicit double confirmation. Return only a create_node_action tool call matching its schema.`;

export class AICommandProcessor {
  constructor(private readonly model: AIModelAdapter, private readonly crypto: CryptoProvider) {}
  async process(command: string, nodes: readonly TrustedNode[]): Promise<ActionPayload> { if (!command.trim()) throw new Error('Command is empty'); const context = nodes.map(n => ({ nodeId: n.nodeId, displayName: n.displayName, aliases: n.aliases, allowedFields: n.allowedFields, role: n.role })); const call = await this.model.complete({ system: `${KEYSTONE_SYSTEM_PROMPT}\nTrusted nodes: ${canonicalJson(context)}`, user: command, tool: ACTION_TOOL }); if (call.name !== 'create_node_action') throw new Error('Model returned an unsupported tool'); const action = validateAction(call.arguments, nodes); const unsigned = { version: 1 as const, ...action, requiresConfirmation: true as const }; return { ...unsigned, actionHash: await this.crypto.hash(canonicalJson(unsigned)) }; }
  async processUIAction(command: string, tree: UIElement): Promise<{ version: 1; action: UIAction; actionHash: string; requiresConfirmation: true }> {
    if (!command.trim()) throw new Error('Command is empty');
    const call = await this.model.complete({ system: `${UI_ACTION_SYSTEM_PROMPT}\nUI tree: ${canonicalJson(tree)}`, user: command, tool: UI_ACTION_TOOL });
    if (call.name !== 'ui_action') throw new Error('Model returned an unsupported UI tool');
    const action = validateUIAction(call.arguments, tree); const unsigned = { version: 1 as const, action, requiresConfirmation: true as const };
    return { ...unsigned, actionHash: await this.crypto.hash(canonicalJson(unsigned)) };
  }
}
export type CrossDeviceAction = { version: 1; targetNodeId: NodeId; payload: import('./sync/handoff.js').HandoffPayload; implicitTrust: true; actionHash: string };
/** Local-LLM skill for non-critical Self-device routing. */
export class CrossDeviceActionSkill {
  constructor(private readonly model: AIModelAdapter, private readonly crypto: CryptoProvider, private readonly deviceSync?: DeviceSync) {}
  async process(command: string, nodes: readonly TrustedNode[]): Promise<CrossDeviceAction> {
    if (!command.trim()) throw new Error('Command is empty');
    const selfNodes = nodes.filter(node => node.role === 'Self');
    const call = await this.model.complete({ system: `Route only clipboard, browser_tab, or file_offer to the supplied Self nodes. Never perform OS automation. If ambiguous, reject. Self nodes: ${canonicalJson(selfNodes)}`, user: command, tool: CROSS_DEVICE_TOOL });
    if (call.name !== CROSS_DEVICE_TOOL.name) throw new Error('Model returned an unsupported cross-device tool');
    const value = validateCrossDevice(call.arguments, selfNodes);
    const unsigned = { version: 1 as const, ...value, implicitTrust: true as const };
    return { ...unsigned, actionHash: await this.crypto.hash(canonicalJson(unsigned)) };
  }
  /** Plan and, when a DeviceSync is supplied, deliver the packet over P2P. */
  async execute(command: string, nodes: readonly TrustedNode[]): Promise<CrossDeviceAction> {
    const action = await this.process(command, nodes);
    if (!this.deviceSync) throw new Error('DeviceSync is not configured');
    await this.deviceSync.send(action.targetNodeId, action.payload);
    return action;
  }
}
export const UI_ACTION_SYSTEM_PROMPT = 'You are a constrained computer-use planner. Select exactly one visible, enabled element from the supplied tree. Coordinates must be inside its bounds. UI actions always require Double Confirmation before execution.';
function flatten(root: UIElement): UIElement[] { return [root, ...(root.children ?? []).flatMap(flatten)]; }
function validateUIAction(value: unknown, tree: UIElement): UIAction { if (!value || typeof value !== 'object') throw new Error('Invalid UI action'); const v = value as Record<string, unknown>; const all = flatten(tree); const id = typeof v.elementId === 'string' ? all.find(n => n.id === v.elementId) : undefined; if (v.kind === 'tap' || v.kind === 'type') { if (!id || id.enabled === false) throw new Error('UI element is not present or enabled'); if (v.kind === 'type' && (typeof v.text !== 'string' || v.text.length > 4096)) throw new Error('Invalid text'); if (v.kind === 'tap' && (typeof v.x !== 'number' || typeof v.y !== 'number')) throw new Error('Tap requires coordinates'); return v.kind === 'tap' ? { kind:'tap', elementId:id.id, x:v.x as number, y:v.y as number } : { kind:'type', elementId:id.id, text:v.text as string }; } if (v.kind === 'swipe' && [v.x1,v.y1,v.x2,v.y2,v.durationMs].every(x => typeof x === 'number')) return { kind:'swipe', x1:v.x1 as number,y1:v.y1 as number,x2:v.x2 as number,y2:v.y2 as number,durationMs:Math.max(100,Math.min(10000,v.durationMs as number)) }; throw new Error('Invalid UI action'); }
export interface OpenAICompatibleOptions { kind: AIProviderKind; endpoint: string; model: string; getAccessToken?: () => Promise<string>; apiKey?: string; }
/** Works with local OpenAI-compatible runtimes and remote OAuth/API providers. */
export class OpenAICompatibleAdapter implements AIModelAdapter {
  readonly kind: AIProviderKind;
  constructor(private readonly options: OpenAICompatibleOptions) { this.kind = options.kind; }
  async complete(input: { system: string; user: string; tool: typeof ACTION_TOOL | typeof UI_ACTION_TOOL | typeof CROSS_DEVICE_TOOL }): Promise<ModelToolCall> { const token = this.options.apiKey ?? await this.options.getAccessToken?.(); const response = await fetch(this.options.endpoint, { method:'POST', headers:{ 'content-type':'application/json', ...(token ? { authorization:`Bearer ${token}` } : {}) }, body:JSON.stringify({ model:this.options.model, temperature:0, messages:[{role:'system',content:input.system},{role:'user',content:input.user}], tools:[{type:'function',function:input.tool}], tool_choice:{type:'function',function:{name:input.tool.name}} }) }); if (!response.ok) throw new Error(`AI provider failed with HTTP ${response.status}`); const json = await response.json() as any; const call = json?.choices?.[0]?.message?.tool_calls?.[0]?.function; if ((call?.name !== ACTION_TOOL.name && call?.name !== UI_ACTION_TOOL.name && call?.name !== CROSS_DEVICE_TOOL.name) || typeof call.arguments !== 'string') throw new Error('AI provider did not return the required tool call'); let args: unknown; try { args = JSON.parse(call.arguments); } catch { throw new Error('AI provider returned invalid tool JSON'); } return { name:call.name, arguments:args }; }
}
function validateCrossDevice(value: unknown, nodes: readonly TrustedNode[]): { targetNodeId: NodeId; payload: import('./sync/handoff.js').HandoffPayload } {
  if (!value || typeof value !== 'object') throw new Error('Invalid cross-device action'); const v = value as Record<string, unknown>; if (typeof v.targetNodeId !== 'string' || !nodes.some(node => node.nodeId === v.targetNodeId && node.role === 'Self')) throw new Error('Target is not a trusted Self device');
  if (v.kind === 'clipboard' && typeof v.text === 'string' && v.text.length <= 1_000_000) return { targetNodeId: v.targetNodeId, payload: { kind:'clipboard', text:v.text } };
  if (v.kind === 'browser_tab' && typeof v.url === 'string' && /^https?:\/\//i.test(v.url)) return { targetNodeId: v.targetNodeId, payload: { kind:'browser_tab', url:v.url, ...(typeof v.title === 'string' ? { title:v.title } : {}) } };
  if (v.kind === 'file_offer' && typeof v.transferId === 'string' && typeof v.name === 'string' && Number.isSafeInteger(v.size) && (v.size as number) >= 0 && (v.size as number) <= 10 * 1024 ** 3) return { targetNodeId: v.targetNodeId, payload: { kind:'file_offer', transferId:v.transferId, name:v.name, size:v.size as number, ...(typeof v.mimeType === 'string' ? { mimeType:v.mimeType } : {}), ...(typeof v.sha256 === 'string' ? { sha256:v.sha256 } : {}) } };
  throw new Error('Invalid cross-device payload');
}
function validateAction(value: unknown, nodes: readonly TrustedNode[]): Omit<ActionPayload,'version'|'requiresConfirmation'|'actionHash'> { if (!value || typeof value !== 'object') throw new Error('Invalid action payload'); const v = value as Record<string, unknown>; const intents = ['order_food','send_message','research','unknown'] as const; if (!intents.includes(v.intent as any)) throw new Error('Invalid intent'); if (v.targetNodeId !== null && typeof v.targetNodeId !== 'string') throw new Error('Invalid target node'); const node = nodes.find(n => n.nodeId === v.targetNodeId); if (v.targetNodeId !== null && !node) throw new Error('Model selected an untrusted node'); if (!Array.isArray(v.requestedFields) || !v.requestedFields.every(x => typeof x === 'string')) throw new Error('Invalid requested fields'); if (node && !(v.requestedFields as string[]).every(field => node.allowedFields.includes(field))) throw new Error('Model requested a forbidden field'); if (!v.parameters || typeof v.parameters !== 'object' || Array.isArray(v.parameters) || !Object.values(v.parameters).every(x => typeof x === 'string')) throw new Error('Invalid parameters'); return { intent: v.intent as any, targetNodeId: v.targetNodeId as string|null, requestedFields: [...new Set(v.requestedFields as string[])], parameters: v.parameters as Record<string,string> }; }
