/**
 * Typed AI tools and source-available skills.
 *
 * This module is deliberately separate from the model/provider layer.  Models
 * can only propose a ToolIntent; the registry issues a capability-checked
 * object and ToolExecutor is the only component that invokes a host adapter.
 * A skill is an integrity-checked manifest, not executable JavaScript.  In particular,
 * there is no shell, eval, arbitrary filesystem or unrestricted network tool in
 * this API.
 */

import { canonicalJson } from '../crypto.js';
import { sha256 } from '../social/content.js';
import {
  AI_DATA_CLASSES,
  type AIContextItem,
  type AIDataClass,
  type AIModelRef,
} from './privacy.js';
import { z } from 'zod';

export const TOOL_SYSTEM_VERSION = 1 as const;

export const TOOL_CAPABILITIES = [
  'READ_PRIVATE',
  'WRITE_PRIVATE',
  'NETWORK_SEND',
  'DEVICE_ACTION',
  'DESTRUCTIVE',
  'SECURITY_SENSITIVE',
] as const;
export type ToolCapability = (typeof TOOL_CAPABILITIES)[number];
/** Stable names for callers that model a capability as an id/manifest field. */
export type ToolCapabilityId = ToolCapability;
export type SkillCapability = ToolCapability;
export const toolCapabilitySchema = z.enum(TOOL_CAPABILITIES);

export type ToolExecutionSource = 'local' | 'personal_trusted' | 'external';
export const toolExecutionSourceSchema = z.enum(['local', 'personal_trusted', 'external']);

const idSchema = z.string().min(1).max(256).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const safeTextSchema = z.string().min(1).max(16_384);

export interface ToolExecutionContext {
  readonly intent: ToolIntent;
  readonly toolId: string;
  readonly skillId: string;
  readonly source: ToolExecutionSource;
  readonly model?: AIModelRef;
  readonly signal?: AbortSignal;
}

export interface Tool<I = unknown, O = unknown> {
  readonly version: 1;
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly capabilities: readonly ToolCapability[];
  readonly inputSchema: z.ZodType<I>;
  readonly outputSchema: z.ZodType<O>;
  /** A fixed class is safest; a classifier is allowed for typed host results. */
  readonly resultClass: AIDataClass | ((value: O) => AIDataClass);
  readonly sensitive?: boolean;
  readonly execute: (input: I, context: ToolExecutionContext) => Promise<O> | O;
}

/** Alias for hosts that prefer the more explicit name. */
export type ToolDefinition<I = unknown, O = unknown> = Tool<I, O>;

export interface ToolIntent {
  readonly version: 1;
  readonly intentId: string;
  readonly toolId: string;
  readonly skillId: string;
  readonly arguments: unknown;
  readonly requestedCapabilities: readonly ToolCapability[];
  readonly source: ToolExecutionSource;
  /** External model output is executable only when explicitly routed by Phase 31. */
  readonly viaOrchestrator: boolean;
  readonly issuedAt: string;
  readonly model?: AIModelRef;
}

export interface ToolIntentInput {
  readonly toolId: string;
  readonly skillId: string;
  readonly arguments: unknown;
  readonly requestedCapabilities?: readonly ToolCapability[];
  readonly source: ToolExecutionSource;
  readonly viaOrchestrator?: boolean;
  readonly intentId?: string;
  readonly issuedAt?: string;
  readonly model?: AIModelRef;
}

export type ToolErrorCode =
  | 'invalid_tool'
  | 'invalid_arguments'
  | 'forged_intent'
  | 'duplicate_intent'
  | 'skill_missing'
  | 'skill_disabled'
  | 'tool_not_declared'
  | 'capability_not_declared'
  | 'capability_not_approved'
  | 'external_private_tool'
  | 'external_tool_not_orchestrated'
  | 'policy_denied'
  | 'policy_adapter_required'
  | 'confirmation_required'
  | 'confirmation_cancelled'
  | 'invalid_tool_result'
  | 'tool_failed'
  | 'aborted';

export class ToolSecurityError extends Error {
  constructor(readonly code: ToolErrorCode, message: string) {
    super(message);
    this.name = 'ToolSecurityError';
  }
}

export interface ToolResult<O = unknown> {
  readonly version: 1;
  readonly intentId: string;
  readonly toolId: string;
  readonly skillId: string;
  readonly ok: boolean;
  readonly dataClass: AIDataClass;
  readonly value?: O;
  readonly errorCode?: ToolErrorCode;
  readonly sideEffectApplied: boolean;
  readonly auditId: string;
}

export interface Skill {
  readonly version: 1;
  readonly id: string;
  readonly name: string;
  readonly packageVersion: string;
  readonly instructions: string;
  readonly toolIds: readonly string[];
  readonly declaredCapabilities: readonly ToolCapability[];
  /** SHA-256 of the canonical manifest, excluding mutable approval state. */
  readonly integrityHash: string;
  readonly source: 'builtin' | 'local';
  readonly enabled: boolean;
  readonly approvedCapabilities: readonly ToolCapability[];
}

const skillManifestSchema = z.object({
  version: z.literal(1),
  id: idSchema,
  name: safeTextSchema.max(256),
  packageVersion: z.string().min(1).max(64),
  instructions: z.string().max(32_768),
  toolIds: z.array(idSchema).max(256),
  declaredCapabilities: z.array(toolCapabilitySchema).max(TOOL_CAPABILITIES.length),
  integrityHash: z.string().regex(/^[a-f0-9]{64}$/i),
  source: z.enum(['builtin', 'local']),
  enabled: z.boolean(),
  approvedCapabilities: z.array(toolCapabilitySchema).max(TOOL_CAPABILITIES.length),
}).strict();

export interface ToolAuditRecord {
  readonly id: string;
  readonly at: string;
  readonly model?: AIModelRef;
  readonly source: ToolExecutionSource;
  readonly skillId: string;
  readonly toolId: string;
  readonly intentId: string;
  readonly requestedCapabilities: readonly ToolCapability[];
  readonly policyDecision: 'allow' | 'deny' | 'confirmation_required' | 'cancelled' | 'executed' | 'failed';
  readonly confirmation: 'none' | 'pending' | 'approved' | 'cancelled' | 'denied';
  readonly resultClassification?: AIDataClass;
  readonly errorCode?: ToolErrorCode;
}

export class ToolAuditLog {
  private readonly entries: ToolAuditRecord[] = [];
  constructor(private readonly maxEntries = 256, private readonly now: () => number = Date.now) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) throw new Error('Tool audit limit must be positive');
  }
  append(value: Omit<ToolAuditRecord, 'id' | 'at'>): ToolAuditRecord {
    const record: ToolAuditRecord = Object.freeze({ ...value, id: crypto.randomUUID(), at: new Date(this.now()).toISOString(), requestedCapabilities: [...value.requestedCapabilities] });
    this.entries.push(record);
    while (this.entries.length > this.maxEntries) this.entries.shift();
    return record;
  }
  list(): readonly ToolAuditRecord[] { return this.entries.map(entry => structuredClone(entry)); }
  clear(): void { this.entries.splice(0); }
}

function uniqueCapabilities(value: readonly ToolCapability[]): ToolCapability[] {
  return [...new Set(value)];
}

function containsAll(haystack: readonly ToolCapability[], needles: readonly ToolCapability[]): boolean {
  return needles.every(item => haystack.includes(item));
}

function capabilityListEqual(left: readonly ToolCapability[], right: readonly ToolCapability[]): boolean {
  return left.length === right.length && containsAll(left, right) && containsAll(right, left);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export class ToolRegistry {
  private readonly tools = new Map<string, Tool<unknown, unknown>>();
  private readonly issued = new WeakSet<object>();
  private readonly claimed = new WeakSet<object>();
  private readonly issuedIds = new Set<string>();

  register<I, O>(tool: Tool<I, O>): void {
    if (tool.version !== 1 || !idSchema.safeParse(tool.id).success || !tool.name || !tool.description) throw new ToolSecurityError('invalid_tool', 'Tool manifest is invalid');
    const capabilities = uniqueCapabilities(tool.capabilities);
    if (!capabilities.length || capabilities.length !== tool.capabilities.length || capabilities.some(capability => !toolCapabilitySchema.safeParse(capability).success)) throw new ToolSecurityError('invalid_tool', 'Tool capabilities are invalid');
    if (!tool.inputSchema || typeof tool.inputSchema.safeParse !== 'function' || !tool.outputSchema || typeof tool.outputSchema.safeParse !== 'function') throw new ToolSecurityError('invalid_tool', 'Tool schemas are required');
    if (typeof tool.execute !== 'function') throw new ToolSecurityError('invalid_tool', 'Tool executor is required');
    if (this.tools.has(tool.id)) throw new ToolSecurityError('invalid_tool', `Tool ${tool.id} is already registered`);
    this.tools.set(tool.id, tool as unknown as Tool<unknown, unknown>);
  }

  registerMany(tools: readonly Tool[]): void { tools.forEach(tool => this.register(tool)); }
  get(id: string): Tool<unknown, unknown> | undefined { return this.tools.get(id); }
  list(): readonly Tool<unknown, unknown>[] { return [...this.tools.values()]; }

  /** Issue an opaque, one-use intent after validating its input schema. */
  issueIntent(input: ToolIntentInput): ToolIntent {
    if (!idSchema.safeParse(input.toolId).success || !idSchema.safeParse(input.skillId).success) throw new ToolSecurityError('invalid_tool', 'Tool intent identifiers are invalid');
    if (!toolExecutionSourceSchema.safeParse(input.source).success) throw new ToolSecurityError('invalid_tool', 'Tool intent source is invalid');
    const tool = this.tools.get(input.toolId);
    if (!tool) throw new ToolSecurityError('invalid_tool', `Unknown tool ${input.toolId}`);
    const parsed = tool.inputSchema.safeParse(input.arguments);
    if (!parsed.success) throw new ToolSecurityError('invalid_arguments', `Invalid arguments for ${input.toolId}`);
    const expected = [...tool.capabilities];
    const requested = uniqueCapabilities(input.requestedCapabilities ?? expected);
    if (!capabilityListEqual(requested, expected)) throw new ToolSecurityError('invalid_tool', 'Requested capabilities do not match tool capabilities');
    if (input.source === 'external' && input.viaOrchestrator !== true) throw new ToolSecurityError('invalid_tool', 'External tool intents must be issued through the orchestrator');
    const intentId = input.intentId ?? crypto.randomUUID();
    if (!idSchema.safeParse(intentId).success || this.issuedIds.has(intentId)) throw new ToolSecurityError('duplicate_intent', 'Tool intent id was already issued');
    const intent = Object.freeze({
      version: 1 as const,
      intentId,
      toolId: input.toolId,
      skillId: input.skillId,
      arguments: deepFreeze(clone(parsed.data)),
      requestedCapabilities: Object.freeze([...expected]),
      source: input.source,
      viaOrchestrator: input.viaOrchestrator === true,
      issuedAt: input.issuedAt ?? new Date().toISOString(),
      ...(input.model ? { model: deepFreeze(clone(input.model)) } : {}),
    });
    this.issued.add(intent);
    this.issuedIds.add(intentId);
    return intent;
  }

  isIssued(intent: ToolIntent): boolean { return typeof intent === 'object' && intent !== null && this.issued.has(intent as object); }
  claim(intent: ToolIntent): boolean {
    if (!this.isIssued(intent) || this.claimed.has(intent as object)) return false;
    this.claimed.add(intent as object);
    return true;
  }
}

export interface SkillInstallOptions {
  readonly verifyHash?: (canonicalManifest: string) => Promise<string> | string;
}

export interface SkillApprovalOptions {
  /** Approval is supplied by the user-facing policy, never trusted from a package manifest. */
  readonly approvedCapabilities?: readonly ToolCapability[];
}

export function skillIntegrityPayload(skill: Pick<Skill, 'version' | 'id' | 'name' | 'packageVersion' | 'instructions' | 'toolIds' | 'declaredCapabilities' | 'source'>): string {
  return canonicalJson({ version: skill.version, id: skill.id, name: skill.name, packageVersion: skill.packageVersion, instructions: skill.instructions, toolIds: [...skill.toolIds], declaredCapabilities: [...skill.declaredCapabilities], source: skill.source });
}

export async function computeSkillIntegrityHash(skill: Pick<Skill, 'version' | 'id' | 'name' | 'packageVersion' | 'instructions' | 'toolIds' | 'declaredCapabilities' | 'source'>): Promise<string> {
  return sha256(new TextEncoder().encode(skillIntegrityPayload(skill)));
}

export class SkillRegistry {
  private readonly skills = new Map<string, Skill>();
  private readonly verifyHash: (canonicalManifest: string) => Promise<string>;
  constructor(options: SkillInstallOptions = {}) {
    this.verifyHash = async value => options.verifyHash ? await options.verifyHash(value) : await sha256(new TextEncoder().encode(value));
  }

  async install(skill: Skill, approval: SkillApprovalOptions = {}): Promise<Skill> {
    const parsed = skillManifestSchema.parse(skill) as Skill;
    if (this.skills.has(parsed.id)) throw new ToolSecurityError('invalid_tool', `Skill ${parsed.id} is already installed`);
    const declared = uniqueCapabilities(parsed.declaredCapabilities);
    const requestedApproval = uniqueCapabilities(approval.approvedCapabilities ?? []);
    if (declared.length !== parsed.declaredCapabilities.length || requestedApproval.length !== (approval.approvedCapabilities ?? []).length || !containsAll(declared, requestedApproval)) throw new ToolSecurityError('invalid_tool', 'Skill capability approval is invalid');
    const expected = await this.verifyHash(skillIntegrityPayload(parsed));
    if (expected.toLowerCase() !== parsed.integrityHash.toLowerCase()) throw new ToolSecurityError('invalid_tool', 'Skill integrity hash mismatch');
    const normalized = Object.freeze({ ...parsed, toolIds: Object.freeze([...new Set(parsed.toolIds)]), declaredCapabilities: Object.freeze(declared), approvedCapabilities: Object.freeze(requestedApproval) });
    this.skills.set(parsed.id, normalized);
    return clone(normalized);
  }

  /** Compatibility alias for hosts that call manifest installation registration. */
  register(skill: Skill, approval: SkillApprovalOptions = {}): Promise<Skill> { return this.install(skill, approval); }

  get(id: string): Skill | undefined { const skill = this.skills.get(id); return skill ? clone(skill) : undefined; }
  list(): readonly Skill[] { return [...this.skills.values()].map(skill => clone(skill)); }
  setEnabled(id: string, enabled: boolean): Skill { return this.update(id, { enabled }); }
  enable(id: string): Skill { return this.setEnabled(id, true); }
  disable(id: string): Skill { return this.setEnabled(id, false); }
  approveCapabilities(id: string, capabilities: readonly ToolCapability[]): Skill {
    const skill = this.require(id);
    const requested = uniqueCapabilities(capabilities);
    if (!containsAll(skill.declaredCapabilities, requested)) throw new ToolSecurityError('invalid_tool', 'Skill requested an undeclared capability');
    return this.update(id, { approvedCapabilities: [...new Set([...skill.approvedCapabilities, ...requested])] });
  }
  revokeCapabilities(id: string, capabilities: readonly ToolCapability[]): Skill {
    const revoked = new Set(capabilities);
    return this.update(id, { approvedCapabilities: skillWithout(this.require(id).approvedCapabilities, revoked) });
  }
  approve(id: string, capabilities: readonly ToolCapability[]): Skill { return this.approveCapabilities(id, capabilities); }
  revoke(id: string, capabilities: readonly ToolCapability[]): Skill { return this.revokeCapabilities(id, capabilities); }
  setApprovedCapabilities(id: string, capabilities: readonly ToolCapability[]): Skill {
    const skill = this.require(id);
    const approved = uniqueCapabilities(capabilities);
    if (!containsAll(skill.declaredCapabilities, approved)) throw new ToolSecurityError('invalid_tool', 'Skill requested an undeclared capability');
    return this.update(id, { approvedCapabilities: approved });
  }
  private require(id: string): Skill { const skill = this.skills.get(id); if (!skill) throw new ToolSecurityError('skill_missing', `Skill ${id} is not installed`); return skill; }
  private update(id: string, changes: Partial<Pick<Skill, 'enabled' | 'approvedCapabilities'>>): Skill {
    const current = this.require(id);
    const next = Object.freeze({ ...current, ...changes, approvedCapabilities: Object.freeze([...(changes.approvedCapabilities ?? current.approvedCapabilities)]) });
    this.skills.set(id, next);
    return clone(next);
  }
}

function skillWithout(values: readonly ToolCapability[], revoked: ReadonlySet<ToolCapability>): ToolCapability[] { return values.filter(value => !revoked.has(value)); }

export interface ToolPolicyInput {
  readonly intent: ToolIntent;
  readonly tool: Tool<unknown, unknown>;
  readonly skill: Skill;
}

export interface ToolPolicyDecision {
  readonly allowed: boolean;
  readonly reason?: ToolErrorCode;
  readonly requiresConfirmation: boolean;
  readonly requiresDoubleConfirmation: boolean;
  readonly requestedCapabilities: readonly ToolCapability[];
}

export interface ToolPolicyOptions {
  /** Adapter to existing Keystone authorization/consent policy for mutations. */
  readonly authorize?: (input: ToolPolicyInput) => Promise<boolean> | boolean;
}

const mutationCapabilities = new Set<ToolCapability>(['WRITE_PRIVATE', 'NETWORK_SEND', 'DEVICE_ACTION', 'DESTRUCTIVE', 'SECURITY_SENSITIVE']);
const doubleConfirmationCapabilities = new Set<ToolCapability>(['DESTRUCTIVE', 'SECURITY_SENSITIVE']);

export class ToolPolicy {
  constructor(private readonly options: ToolPolicyOptions = {}) {}
  async evaluate(input: ToolPolicyInput): Promise<ToolPolicyDecision> {
    const capabilities = [...input.tool.capabilities];
    const requiresConfirmation = capabilities.some(capability => mutationCapabilities.has(capability));
    const requiresDoubleConfirmation = input.tool.sensitive === true || capabilities.some(capability => doubleConfirmationCapabilities.has(capability));
    const base = { requiresConfirmation, requiresDoubleConfirmation, requestedCapabilities: capabilities } as const;
    if (!input.skill.enabled) return { ...base, allowed: false, reason: 'skill_disabled' };
    if (!input.skill.toolIds.includes(input.tool.id)) return { ...base, allowed: false, reason: 'tool_not_declared' };
    if (!containsAll(input.skill.declaredCapabilities, capabilities)) return { ...base, allowed: false, reason: 'capability_not_declared' };
    if (!containsAll(input.skill.approvedCapabilities, capabilities)) return { ...base, allowed: false, reason: 'capability_not_approved' };
    if (input.intent.source === 'external' && !input.intent.viaOrchestrator) return { ...base, allowed: false, reason: 'external_tool_not_orchestrated' };
    if (input.intent.source === 'external' && capabilities.includes('READ_PRIVATE')) return { ...base, allowed: false, reason: 'external_private_tool' };
    const resultClass = typeof input.tool.resultClass === 'string' ? input.tool.resultClass : undefined;
    if (input.intent.source === 'external' && (resultClass === undefined || resultClass === 'PRIVATE' || resultClass === 'SECRET')) return { ...base, allowed: false, reason: 'external_private_tool' };
    if (requiresConfirmation && !this.options.authorize) return { ...base, allowed: false, reason: 'policy_adapter_required' };
    if (requiresConfirmation && !(await this.options.authorize?.(input))) return { ...base, allowed: false, reason: 'policy_denied' };
    return { ...base, allowed: true };
  }
}

export interface ToolConfirmationRequest {
  readonly step: 1 | 2;
  readonly intentId: string;
  readonly toolId: string;
  readonly skillId: string;
  readonly capabilities: readonly ToolCapability[];
  readonly message: string;
}

export interface ToolConfirmationBoundary {
  confirm(request: ToolConfirmationRequest): Promise<boolean | { readonly approved: boolean }>;
}

function approved(value: boolean | { readonly approved: boolean }): boolean { return typeof value === 'boolean' ? value : value.approved; }

export interface ToolExecutorOptions {
  readonly policy?: ToolPolicy;
  readonly confirmation?: ToolConfirmationBoundary;
  readonly audit?: ToolAuditLog;
}

export class ToolExecutor {
  readonly audit: ToolAuditLog;
  private readonly policy: ToolPolicy;
  private readonly confirmation?: ToolConfirmationBoundary;
  constructor(private readonly registry: ToolRegistry, private readonly skills: SkillRegistry, options: ToolExecutorOptions = {}) {
    this.policy = options.policy ?? new ToolPolicy();
    this.confirmation = options.confirmation;
    this.audit = options.audit ?? new ToolAuditLog();
  }

  async execute<O = unknown>(intent: ToolIntent, options: { readonly signal?: AbortSignal } = {}): Promise<ToolResult<O>> {
    if (!this.registry.claim(intent)) {
      const code: Extract<ToolErrorCode, 'forged_intent' | 'duplicate_intent'> = this.registry.isIssued(intent) ? 'duplicate_intent' : 'forged_intent';
      throw new ToolSecurityError(code, code === 'duplicate_intent' ? 'Tool intent was already consumed' : 'Tool intent was not issued by ToolRegistry');
    }
    const tool = this.registry.get(intent.toolId);
    const skill = this.skills.get(intent.skillId);
    if (!tool) throw new ToolSecurityError('invalid_tool', 'Registered tool disappeared');
    if (!skill) return this.denied<O>(intent, 'skill_missing', false);
    const parsed = tool.inputSchema.safeParse(intent.arguments);
    if (!parsed.success) throw new ToolSecurityError('invalid_arguments', `Invalid arguments for ${intent.toolId}`);
    const decision = await this.policy.evaluate({ intent, tool, skill });
    if (!decision.allowed) {
      this.audit.append({ model: intent.model, source: intent.source, skillId: intent.skillId, toolId: intent.toolId, intentId: intent.intentId, requestedCapabilities: decision.requestedCapabilities, policyDecision: 'deny', confirmation: 'denied', errorCode: decision.reason });
      return this.result<O>(intent, false, 'PUBLIC', decision.reason ?? 'policy_denied', false);
    }
    if (options.signal?.aborted) return this.denied<O>(intent, 'aborted', false);
    let confirmationState: ToolAuditRecord['confirmation'] = 'none';
    if (decision.requiresConfirmation) {
      if (!this.confirmation) {
        this.audit.append({ model: intent.model, source: intent.source, skillId: intent.skillId, toolId: intent.toolId, intentId: intent.intentId, requestedCapabilities: decision.requestedCapabilities, policyDecision: 'confirmation_required', confirmation: 'denied', errorCode: 'confirmation_required' });
        return this.result<O>(intent, false, 'PUBLIC', 'confirmation_required', false);
      }
      confirmationState = 'pending';
      const request = (step: 1 | 2): ToolConfirmationRequest => ({ step, intentId: intent.intentId, toolId: intent.toolId, skillId: intent.skillId, capabilities: decision.requestedCapabilities, message: step === 2 ? `Confirm again: ${tool.name}` : `Confirm ${tool.name}` });
      if (!approved(await this.confirmation.confirm(request(1)))) {
        this.audit.append({ model: intent.model, source: intent.source, skillId: intent.skillId, toolId: intent.toolId, intentId: intent.intentId, requestedCapabilities: decision.requestedCapabilities, policyDecision: 'cancelled', confirmation: 'cancelled', errorCode: 'confirmation_cancelled' });
        return this.result<O>(intent, false, 'PUBLIC', 'confirmation_cancelled', false);
      }
      if (decision.requiresDoubleConfirmation && !approved(await this.confirmation.confirm(request(2)))) {
        this.audit.append({ model: intent.model, source: intent.source, skillId: intent.skillId, toolId: intent.toolId, intentId: intent.intentId, requestedCapabilities: decision.requestedCapabilities, policyDecision: 'cancelled', confirmation: 'cancelled', errorCode: 'confirmation_cancelled' });
        return this.result<O>(intent, false, 'PUBLIC', 'confirmation_cancelled', false);
      }
      confirmationState = 'approved';
    }
    try {
      const output = await tool.execute(parsed.data, { intent, toolId: tool.id, skillId: skill.id, source: intent.source, ...(intent.model ? { model: intent.model } : {}), ...(options.signal ? { signal: options.signal } : {}) });
      const validated = tool.outputSchema.safeParse(output);
      if (!validated.success) {
        this.audit.append({ model: intent.model, source: intent.source, skillId: intent.skillId, toolId: intent.toolId, intentId: intent.intentId, requestedCapabilities: decision.requestedCapabilities, policyDecision: 'failed', confirmation: confirmationState, errorCode: 'invalid_tool_result' });
        return this.result<O>(intent, false, 'PUBLIC', 'invalid_tool_result', false);
      }
      const dataClass = typeof tool.resultClass === 'function' ? tool.resultClass(validated.data) : tool.resultClass;
      if (!AI_DATA_CLASSES.includes(dataClass)) throw new Error('Invalid tool result classification');
      this.audit.append({ model: intent.model, source: intent.source, skillId: intent.skillId, toolId: intent.toolId, intentId: intent.intentId, requestedCapabilities: decision.requestedCapabilities, policyDecision: 'executed', confirmation: confirmationState, resultClassification: dataClass });
      return this.result<O>(intent, true, dataClass, undefined, decision.requiresConfirmation, clone(validated.data) as O);
    } catch {
      this.audit.append({ model: intent.model, source: intent.source, skillId: intent.skillId, toolId: intent.toolId, intentId: intent.intentId, requestedCapabilities: decision.requestedCapabilities, policyDecision: 'failed', confirmation: confirmationState, errorCode: 'tool_failed' });
      return this.result<O>(intent, false, 'PUBLIC', 'tool_failed', false);
    }
  }

  private denied<O = unknown>(intent: ToolIntent, code: ToolErrorCode, sideEffect: boolean): ToolResult<O> { this.audit.append({ model: intent.model, source: intent.source, skillId: intent.skillId, toolId: intent.toolId, intentId: intent.intentId, requestedCapabilities: intent.requestedCapabilities, policyDecision: code === 'aborted' ? 'cancelled' : 'deny', confirmation: 'none', errorCode: code }); return this.result<O>(intent, false, 'PUBLIC', code, sideEffect); }
  private result<O>(intent: ToolIntent, ok: boolean, dataClass: AIDataClass, errorCode: ToolErrorCode | undefined, sideEffectApplied: boolean, value?: O): ToolResult<O> { return { version: 1, intentId: intent.intentId, toolId: intent.toolId, skillId: intent.skillId, ok, dataClass, ...(value === undefined ? {} : { value }), ...(errorCode ? { errorCode } : {}), sideEffectApplied, auditId: crypto.randomUUID() }; }
}

/** Explicit opt-in bridge; no ToolResult is ever sent to a provider automatically. */
export function prepareToolResultForExternal<O>(result: ToolResult<O>): ToolResult<O> {
  if (result.dataClass === 'PRIVATE' || result.dataClass === 'SECRET') throw new ToolSecurityError('invalid_tool', 'Private tool results cannot cross the external AI boundary');
  return clone(result);
}

export interface KeystoneToolHost {
  searchMemory?: (input: SearchMemoryInput, context: ToolExecutionContext) => Promise<unknown> | unknown;
  searchMessages?: (input: SearchMessagesInput, context: ToolExecutionContext) => Promise<unknown> | unknown;
  searchFiles?: (input: SearchQueryInput, context: ToolExecutionContext) => Promise<unknown> | unknown;
  searchMusic?: (input: SearchQueryInput, context: ToolExecutionContext) => Promise<unknown> | unknown;
  searchVideos?: (input: SearchQueryInput, context: ToolExecutionContext) => Promise<unknown> | unknown;
  searchCommunities?: (input: SearchQueryInput, context: ToolExecutionContext) => Promise<unknown> | unknown;
  readAllowedFile?: (input: ReadAllowedFileInput, context: ToolExecutionContext) => Promise<unknown> | unknown;
  sendMessage?: (input: SendMessageInput, context: ToolExecutionContext) => Promise<unknown> | unknown;
  createGroup?: (input: CreateGroupInput, context: ToolExecutionContext) => Promise<unknown> | unknown;
  createCommunityPost?: (input: CreateCommunityPostInput, context: ToolExecutionContext) => Promise<unknown> | unknown;
  playTrack?: (input: PlayTrackInput, context: ToolExecutionContext) => Promise<unknown> | unknown;
  openVideo?: (input: OpenVideoInput, context: ToolExecutionContext) => Promise<unknown> | unknown;
  managePlaylist?: (input: ManagePlaylistInput, context: ToolExecutionContext) => Promise<unknown> | unknown;
  createReminder?: (input: CreateReminderInput, context: ToolExecutionContext) => Promise<unknown> | unknown;
  searchLocalContent?: (input: SearchLocalContentInput, context: ToolExecutionContext) => Promise<unknown> | unknown;
  openKeystoneObject?: (input: OpenKeystoneObjectInput, context: ToolExecutionContext) => Promise<unknown> | unknown;
}

export const searchQuerySchema = z.object({ query: z.string().trim().min(1).max(512), limit: z.number().int().min(1).max(100).optional() }).strict();
export type SearchQueryInput = z.infer<typeof searchQuerySchema>;
export type SearchMemoryInput = SearchQueryInput;
export const searchMessagesSchema = z.object({ query: z.string().trim().min(1).max(512), conversationId: idSchema.optional(), limit: z.number().int().min(1).max(100).optional() }).strict();
export type SearchMessagesInput = z.infer<typeof searchMessagesSchema>;
export const readAllowedFileSchema = z.object({ fileId: idSchema, offset: z.number().int().nonnegative().optional(), limit: z.number().int().min(1).max(4 * 1024 * 1024).optional() }).strict();
export type ReadAllowedFileInput = z.infer<typeof readAllowedFileSchema>;
export const sendMessageSchema = z.object({ peerId: idSchema, text: z.string().min(1).max(32_000), conversationId: idSchema.optional() }).strict();
export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export const createGroupSchema = z.object({ title: z.string().trim().min(1).max(256), members: z.array(idSchema).min(1).max(256), avatarUri: z.string().url().max(2_048).optional() }).strict();
export type CreateGroupInput = z.infer<typeof createGroupSchema>;
export const createCommunityPostSchema = z.object({ communityId: idSchema, channelId: idSchema, text: z.string().min(1).max(32_000), references: z.array(idSchema).max(32).optional() }).strict();
export type CreateCommunityPostInput = z.infer<typeof createCommunityPostSchema>;
export const playTrackSchema = z.object({ trackId: idSchema, positionMs: z.number().int().nonnegative().optional() }).strict();
export type PlayTrackInput = z.infer<typeof playTrackSchema>;
export const openVideoSchema = z.object({ videoId: idSchema, positionMs: z.number().int().nonnegative().optional() }).strict();
export type OpenVideoInput = z.infer<typeof openVideoSchema>;
export const managePlaylistSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), name: z.string().trim().min(1).max(256) }).strict(),
  z.object({ action: z.literal('add'), playlistId: idSchema, trackId: idSchema }).strict(),
  z.object({ action: z.literal('remove'), playlistId: idSchema, trackId: idSchema }).strict(),
  z.object({ action: z.literal('rename'), playlistId: idSchema, name: z.string().trim().min(1).max(256) }).strict(),
]);
export type ManagePlaylistInput = z.infer<typeof managePlaylistSchema>;
export const createReminderSchema = z.object({ title: z.string().trim().min(1).max(512), dueAt: z.string().min(1).max(128).optional(), cron: z.string().min(1).max(256).optional(), instruction: z.string().max(16_384).optional() }).strict().refine(value => Boolean(value.dueAt || value.cron), { message: 'A reminder requires dueAt or cron' });
export type CreateReminderInput = z.infer<typeof createReminderSchema>;
export const searchLocalContentSchema = z.object({ query: z.string().trim().min(1).max(512), scope: z.enum(['all', 'public', 'private', 'messages', 'files', 'music', 'videos', 'communities']).default('all'), limit: z.number().int().min(1).max(100).optional() }).strict();
export type SearchLocalContentInput = z.infer<typeof searchLocalContentSchema>;
export const openKeystoneObjectSchema = z.object({ objectId: idSchema }).strict();
export type OpenKeystoneObjectInput = z.infer<typeof openKeystoneObjectSchema>;

interface KeystoneToolSpec<I> {
  id: string;
  name: string;
  description: string;
  capabilities: readonly ToolCapability[];
  resultClass: AIDataClass;
  inputSchema: z.ZodType<I>;
  hostMethod: keyof KeystoneToolHost;
  sensitive?: boolean;
}

const searchSpecs: readonly KeystoneToolSpec<unknown>[] = [
  { id: 'searchMemory', name: 'Search memory', description: 'Search the user-approved local memory index.', capabilities: ['READ_PRIVATE'], resultClass: 'PRIVATE', inputSchema: searchQuerySchema, hostMethod: 'searchMemory' },
  { id: 'searchMessages', name: 'Search messages', description: 'Search conversations the user can access.', capabilities: ['READ_PRIVATE'], resultClass: 'PRIVATE', inputSchema: searchMessagesSchema, hostMethod: 'searchMessages' },
  { id: 'searchFiles', name: 'Search files', description: 'Search indexed Keystone FileObjects.', capabilities: ['READ_PRIVATE'], resultClass: 'PRIVATE', inputSchema: searchQuerySchema, hostMethod: 'searchFiles' },
  { id: 'searchMusic', name: 'Search music', description: 'Search local music objects.', capabilities: ['READ_PRIVATE'], resultClass: 'PRIVATE', inputSchema: searchQuerySchema, hostMethod: 'searchMusic' },
  { id: 'searchVideos', name: 'Search videos', description: 'Search local video objects.', capabilities: ['READ_PRIVATE'], resultClass: 'PRIVATE', inputSchema: searchQuerySchema, hostMethod: 'searchVideos' },
  { id: 'searchCommunities', name: 'Search communities', description: 'Search communities visible to this device.', capabilities: ['READ_PRIVATE'], resultClass: 'PRIVATE', inputSchema: searchQuerySchema, hostMethod: 'searchCommunities' },
  { id: 'readAllowedFile', name: 'Read an allowed file', description: 'Read a FileObject through the host content policy.', capabilities: ['READ_PRIVATE'], resultClass: 'PRIVATE', inputSchema: readAllowedFileSchema, hostMethod: 'readAllowedFile' },
  { id: 'searchLocalContent', name: 'Search local content', description: 'Search the local unified content index.', capabilities: ['READ_PRIVATE'], resultClass: 'PRIVATE', inputSchema: searchLocalContentSchema, hostMethod: 'searchLocalContent' },
  { id: 'openKeystoneObject', name: 'Open a Keystone object', description: 'Open an object the local policy allows.', capabilities: ['READ_PRIVATE'], resultClass: 'PRIVATE', inputSchema: openKeystoneObjectSchema, hostMethod: 'openKeystoneObject' },
];

const actionSpecs: readonly KeystoneToolSpec<unknown>[] = [
  { id: 'sendMessage', name: 'Send a message', description: 'Send a message through Keystone messaging.', capabilities: ['WRITE_PRIVATE', 'NETWORK_SEND'], resultClass: 'PRIVATE', inputSchema: sendMessageSchema, hostMethod: 'sendMessage' },
  { id: 'createGroup', name: 'Create a group', description: 'Create a signed group conversation.', capabilities: ['WRITE_PRIVATE', 'NETWORK_SEND'], resultClass: 'PRIVATE', inputSchema: createGroupSchema, hostMethod: 'createGroup' },
  { id: 'createCommunityPost', name: 'Create a community post', description: 'Post through the existing Community policy.', capabilities: ['WRITE_PRIVATE', 'NETWORK_SEND'], resultClass: 'PRIVATE', inputSchema: createCommunityPostSchema, hostMethod: 'createCommunityPost' },
  { id: 'playTrack', name: 'Play a track', description: 'Start playback through the host media adapter.', capabilities: ['DEVICE_ACTION'], resultClass: 'PUBLIC', inputSchema: playTrackSchema, hostMethod: 'playTrack' },
  { id: 'openVideo', name: 'Open a video', description: 'Open a VideoObject through the host media adapter.', capabilities: ['DEVICE_ACTION'], resultClass: 'PUBLIC', inputSchema: openVideoSchema, hostMethod: 'openVideo' },
  { id: 'managePlaylist', name: 'Manage a playlist', description: 'Create or edit a local playlist.', capabilities: ['WRITE_PRIVATE'], resultClass: 'PRIVATE', inputSchema: managePlaylistSchema, hostMethod: 'managePlaylist' },
  { id: 'createReminder', name: 'Create a reminder', description: 'Create a local Chronos reminder.', capabilities: ['WRITE_PRIVATE'], resultClass: 'PRIVATE', inputSchema: createReminderSchema, hostMethod: 'createReminder' },
];

function createHostTool<I>(host: KeystoneToolHost, spec: KeystoneToolSpec<I>): Tool<I, unknown> | undefined {
  const handler = host[spec.hostMethod] as ((input: I, context: ToolExecutionContext) => Promise<unknown> | unknown) | undefined;
  if (!handler) return undefined;
  return { version: 1, id: spec.id, name: spec.name, description: spec.description, capabilities: spec.capabilities, inputSchema: spec.inputSchema, outputSchema: z.unknown(), resultClass: spec.resultClass, ...(spec.sensitive ? { sensitive: true } : {}), execute: (input, context) => handler(input, context) };
}

/** Build only adapters supplied by the host; absent adapters cannot be invoked. */
export function createKeystoneTools(host: KeystoneToolHost): readonly Tool[] {
  return [...searchSpecs, ...actionSpecs].flatMap(spec => { const tool = createHostTool(host, spec); return tool ? [tool] : []; });
}

export function createKeystoneToolRegistry(host: KeystoneToolHost): ToolRegistry {
  const registry = new ToolRegistry();
  registry.registerMany(createKeystoneTools(host));
  return registry;
}

const builtinSearchIds = searchSpecs.map(spec => spec.id);
const builtinActionIds = actionSpecs.map(spec => spec.id);

/** Built-in manifests contain no executable package code and start unapproved. */
export async function createBuiltInSkills(): Promise<readonly Skill[]> {
  const manifests = [
    { version: 1 as const, id: 'keystone-search', name: 'Keystone search', packageVersion: '1.0.0', instructions: 'Search only objects available through the local Keystone policy.', toolIds: builtinSearchIds, declaredCapabilities: ['READ_PRIVATE'] as const, source: 'builtin' as const },
    { version: 1 as const, id: 'keystone-actions', name: 'Keystone actions', packageVersion: '1.0.0', instructions: 'Propose typed Keystone actions; mutations require host policy and confirmation.', toolIds: builtinActionIds, declaredCapabilities: ['WRITE_PRIVATE', 'NETWORK_SEND', 'DEVICE_ACTION'] as const, source: 'builtin' as const },
  ];
  return Promise.all(manifests.map(async manifest => ({ ...manifest, integrityHash: await computeSkillIntegrityHash(manifest), enabled: true, approvedCapabilities: [] as readonly ToolCapability[] })));
}

export async function installBuiltInSkills(registry: SkillRegistry): Promise<readonly Skill[]> {
  const skills = await createBuiltInSkills();
  for (const skill of skills) await registry.install(skill);
  return registry.list();
}

/** A safe, metadata-only representation for UI and audit views. */
export function describeSkill(skill: Skill): Pick<Skill, 'id' | 'name' | 'packageVersion' | 'source' | 'enabled' | 'toolIds' | 'declaredCapabilities' | 'approvedCapabilities'> {
  return { id: skill.id, name: skill.name, packageVersion: skill.packageVersion, source: skill.source, enabled: skill.enabled, toolIds: [...skill.toolIds], declaredCapabilities: [...skill.declaredCapabilities], approvedCapabilities: [...skill.approvedCapabilities] };
}

/** Convert a public result to an AI context item only when a caller explicitly opts in. */
export function toPublicAIContext<O>(result: ToolResult<O>): AIContextItem {
  const safe = prepareToolResultForExternal(result);
  if (safe.dataClass !== 'PUBLIC' && safe.dataClass !== 'USER_EXPLICIT') throw new ToolSecurityError('invalid_tool', 'Only public or explicitly supplied results can become external context');
  return { id: `tool-result:${safe.intentId}`, dataClass: safe.dataClass, source: 'tool-result', value: clone(safe.value) };
}
