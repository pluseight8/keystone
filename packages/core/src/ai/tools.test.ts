import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  ToolExecutor,
  ToolPolicy,
  ToolRegistry,
  SkillRegistry,
  ToolSecurityError,
  computeSkillIntegrityHash,
  prepareToolResultForExternal,
  toPublicAIContext,
  type Skill,
  type Tool,
  type ToolCapability,
} from './tools.js';

async function installSkill(registry: SkillRegistry, input: {
  id?: string;
  declaredCapabilities: readonly ToolCapability[];
  approvedCapabilities?: readonly ToolCapability[];
  toolIds?: readonly string[];
  enabled?: boolean;
}): Promise<Skill> {
  const manifest = {
    version: 1 as const,
    id: input.id ?? 'test-skill',
    name: 'Test skill',
    packageVersion: '1.0.0',
    instructions: 'Use only typed Keystone tools.',
    toolIds: input.toolIds ?? ['test.read'],
    declaredCapabilities: input.declaredCapabilities,
    source: 'local' as const,
  };
  const skill: Skill = {
    ...manifest,
    integrityHash: await computeSkillIntegrityHash(manifest),
    enabled: input.enabled ?? true,
    approvedCapabilities: input.approvedCapabilities ?? input.declaredCapabilities,
  };
  await registry.install({ ...skill, approvedCapabilities: [] });
  if (input.approvedCapabilities?.length || input.approvedCapabilities === undefined) registry.setApprovedCapabilities(skill.id, input.approvedCapabilities ?? input.declaredCapabilities);
  return { ...skill, approvedCapabilities: input.approvedCapabilities ?? input.declaredCapabilities };
}

function readTool(calls: { value: string[] }): Tool<{ query: string }, { value: string }> {
  return {
    version: 1,
    id: 'test.read',
    name: 'Read test memory',
    description: 'Read a test value through a policy boundary.',
    capabilities: ['READ_PRIVATE'],
    inputSchema: z.object({ query: z.string().min(1) }).strict(),
    outputSchema: z.object({ value: z.string() }).strict(),
    resultClass: 'PRIVATE',
    execute: input => { calls.value.push(input.query); return { value: 'private result' }; },
  };
}

describe('typed AI tools and skill capability boundary', () => {
  it('allows local private reads only through a registered, approved tool', async () => {
    const calls = { value: [] as string[] };
    const registry = new ToolRegistry();
    registry.register(readTool(calls));
    const skills = new SkillRegistry();
    await installSkill(skills, { declaredCapabilities: ['READ_PRIVATE'] });
    const intent = registry.issueIntent({ toolId: 'test.read', skillId: 'test-skill', source: 'local', arguments: { query: 'notes' } });
    const result = await new ToolExecutor(registry, skills).execute<{ value: string }>(intent);
    expect(result.ok).toBe(true);
    expect(result.dataClass).toBe('PRIVATE');
    expect(result.value?.value).toBe('private result');
    expect(calls.value).toEqual(['notes']);
  });

  it('denies an external private tool even when the model claims orchestrator provenance', async () => {
    const calls = { value: [] as string[] };
    const registry = new ToolRegistry();
    registry.register(readTool(calls));
    const skills = new SkillRegistry();
    await installSkill(skills, { declaredCapabilities: ['READ_PRIVATE'] });
    const intent = registry.issueIntent({ toolId: 'test.read', skillId: 'test-skill', source: 'external', viaOrchestrator: true, arguments: { query: 'secret' } });
    const result = await new ToolExecutor(registry, skills).execute(intent);
    expect(result).toMatchObject({ ok: false, errorCode: 'external_private_tool', sideEffectApplied: false });
    expect(calls.value).toHaveLength(0);
  });

  it('rejects a skill whose manifest does not declare the tool capability', async () => {
    const registry = new ToolRegistry();
    registry.register({ ...readTool({ value: [] }), id: 'test.write', capabilities: ['WRITE_PRIVATE'], resultClass: 'PRIVATE' });
    const skills = new SkillRegistry();
    await installSkill(skills, { declaredCapabilities: ['READ_PRIVATE'], toolIds: ['test.write'] });
    const intent = registry.issueIntent({ toolId: 'test.write', skillId: 'test-skill', source: 'local', arguments: { query: 'write' }, requestedCapabilities: ['WRITE_PRIVATE'] });
    const result = await new ToolExecutor(registry, skills).execute(intent);
    expect(result).toMatchObject({ ok: false, errorCode: 'capability_not_declared' });
  });

  it('does not let a skill invoke a registered tool outside its tool allowlist', async () => {
    const registry = new ToolRegistry();
    registry.register(readTool({ value: [] }));
    const skills = new SkillRegistry();
    await installSkill(skills, { declaredCapabilities: ['READ_PRIVATE'], toolIds: ['some.other.tool'] });
    const intent = registry.issueIntent({ toolId: 'test.read', skillId: 'test-skill', source: 'local', arguments: { query: 'not allowed' } });
    const result = await new ToolExecutor(registry, skills).execute(intent);
    expect(result).toMatchObject({ ok: false, errorCode: 'tool_not_declared' });
  });

  it('rejects forged and replayed ToolIntent objects before a handler runs', async () => {
    const calls = { value: [] as string[] };
    const registry = new ToolRegistry();
    registry.register(readTool(calls));
    const skills = new SkillRegistry();
    await installSkill(skills, { declaredCapabilities: ['READ_PRIVATE'] });
    const intent = registry.issueIntent({ toolId: 'test.read', skillId: 'test-skill', source: 'local', arguments: { query: 'one' } });
    const executor = new ToolExecutor(registry, skills);
    await expect(executor.execute(structuredClone(intent))).rejects.toMatchObject({ code: 'forged_intent' });
    await executor.execute(intent);
    await expect(executor.execute(intent)).rejects.toMatchObject({ code: 'duplicate_intent' });
    expect(() => registry.issueIntent({ toolId: 'test.read', skillId: 'test-skill', source: 'local', intentId: intent.intentId, arguments: { query: 'reissued' } })).toThrow(/already issued/i);
    expect(calls.value).toEqual(['one']);
  });

  it('requires two confirmations for destructive tools and never exposes arguments in audit', async () => {
    let calls = 0;
    const registry = new ToolRegistry();
    const destructive: Tool<{ id: string }, { deleted: boolean }> = {
      version: 1,
      id: 'test.delete',
      name: 'Delete test data',
      description: 'Delete only data explicitly approved by the host.',
      capabilities: ['DESTRUCTIVE'],
      inputSchema: z.object({ id: z.string() }).strict(),
      outputSchema: z.object({ deleted: z.boolean() }).strict(),
      resultClass: 'PRIVATE',
      execute: () => { calls += 1; return { deleted: true }; },
    };
    registry.register(destructive);
    const skills = new SkillRegistry();
    await installSkill(skills, { id: 'destructive-skill', toolIds: ['test.delete'], declaredCapabilities: ['DESTRUCTIVE'] });
    const steps: number[] = [];
    const executor = new ToolExecutor(registry, skills, { policy: new ToolPolicy({ authorize: () => true }), confirmation: { confirm: async request => { steps.push(request.step); return true; } } });
    const intent = registry.issueIntent({ toolId: 'test.delete', skillId: 'destructive-skill', source: 'local', arguments: { id: 'secret-id' } });
    const result = await executor.execute(intent);
    expect(result.ok).toBe(true);
    expect(steps).toEqual([1, 2]);
    expect(calls).toBe(1);
    expect(JSON.stringify(executor.audit.list())).not.toContain('secret-id');
  });

  it('cancelling confirmation has no side effect', async () => {
    let calls = 0;
    const registry = new ToolRegistry();
    registry.register({ ...readTool({ value: [] }), id: 'test.write', capabilities: ['WRITE_PRIVATE'], resultClass: 'PRIVATE', execute: () => { calls += 1; return { value: 'should not run' }; } });
    const skills = new SkillRegistry();
    await installSkill(skills, { declaredCapabilities: ['WRITE_PRIVATE'], toolIds: ['test.write'] });
    const executor = new ToolExecutor(registry, skills, { policy: new ToolPolicy({ authorize: () => true }), confirmation: { confirm: async () => false } });
    const intent = registry.issueIntent({ toolId: 'test.write', skillId: 'test-skill', source: 'local', arguments: { query: 'cancel' }, requestedCapabilities: ['WRITE_PRIVATE'] });
    const result = await executor.execute(intent);
    expect(result).toMatchObject({ ok: false, errorCode: 'confirmation_cancelled', sideEffectApplied: false });
    expect(calls).toBe(0);
  });

  it('revoking a skill capability takes effect immediately', async () => {
    const calls = { value: [] as string[] };
    const registry = new ToolRegistry();
    registry.register(readTool(calls));
    const skills = new SkillRegistry();
    await installSkill(skills, { declaredCapabilities: ['READ_PRIVATE'] });
    const executor = new ToolExecutor(registry, skills);
    await executor.execute(registry.issueIntent({ toolId: 'test.read', skillId: 'test-skill', source: 'local', arguments: { query: 'before' } }));
    skills.revokeCapabilities('test-skill', ['READ_PRIVATE']);
    const result = await executor.execute(registry.issueIntent({ toolId: 'test.read', skillId: 'test-skill', source: 'local', arguments: { query: 'after' } }));
    expect(result).toMatchObject({ ok: false, errorCode: 'capability_not_approved' });
    expect(calls.value).toEqual(['before']);
  });

  it('schema-validates tool input and verifies skill integrity', async () => {
    const registry = new ToolRegistry();
    registry.register(readTool({ value: [] }));
    const skills = new SkillRegistry();
    await expect(installSkill(skills, { declaredCapabilities: ['READ_PRIVATE'] })).resolves.toBeTruthy();
    expect(() => registry.issueIntent({ toolId: 'test.read', skillId: 'test-skill', source: 'local', arguments: { query: '' } })).toThrow(ToolSecurityError);
    const bad: Skill = { ...(await skills.get('test-skill'))!, integrityHash: '0'.repeat(64) };
    await expect(new SkillRegistry().install(bad)).rejects.toMatchObject({ code: 'invalid_tool' });
  });

  it('does not trust capabilities embedded in an installed skill package', async () => {
    const registry = new SkillRegistry();
    const manifest = { version: 1 as const, id: 'untrusted', name: 'Untrusted', packageVersion: '1.0.0', instructions: 'untrusted', toolIds: ['test.read'], declaredCapabilities: ['READ_PRIVATE'] as const, source: 'local' as const };
    await registry.register({ ...manifest, integrityHash: await computeSkillIntegrityHash(manifest), enabled: true, approvedCapabilities: ['READ_PRIVATE'] });
    expect(registry.get('untrusted')?.approvedCapabilities).toEqual([]);
  });

  it('does not let private ToolResult cross external AI, while public results remain explicit', () => {
    const privateResult = { version: 1 as const, intentId: 'private', toolId: 'read', skillId: 'skill', ok: true, dataClass: 'PRIVATE' as const, value: { secret: 'x' }, sideEffectApplied: false, auditId: 'a' };
    expect(() => prepareToolResultForExternal(privateResult)).toThrow(/Private tool results/);
    const publicResult = { ...privateResult, intentId: 'public', dataClass: 'PUBLIC' as const, value: { title: 'public' } };
    expect(toPublicAIContext(publicResult).value).toEqual({ title: 'public' });
  });
});
