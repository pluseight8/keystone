import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { SkillRegistry, ToolExecutor, ToolRegistry, type Tool } from './tools.js';
import {
  InMemorySkillPackageStateStore,
  SkillDependencyResolver,
  SkillEvaluator,
  SkillIntegrityVerifier,
  SkillLearningService,
  SkillPackageError,
  SkillPackageRegistry,
  SkillResolver,
  SkillRevisionService,
  SkillRuntime,
  type SkillManifest,
  type SkillPackage,
} from './skill-packages.js';

async function packageFor(input: Partial<Pick<SkillManifest, 'skillId' | 'name' | 'version' | 'instructions' | 'requiredTools' | 'requiredCapabilities' | 'optionalCapabilities' | 'dataScopes' | 'dependencies'>> = {}, source: SkillPackage['source'] = { kind: 'local-file', reference: 'fixture' }): Promise<SkillPackage> {
  const now = new Date().toISOString();
  const base: Omit<SkillManifest, 'integrity'> = {
    formatVersion: 1,
    skillId: input.skillId ?? 'fixture.skill',
    name: input.name ?? 'Fixture Skill',
    description: 'A bounded declarative fixture Skill.',
    author: { identityId: 'fixture-author', displayName: 'Fixture author' },
    version: input.version ?? '1.0.0',
    entrypoint: 'instructions',
    instructions: input.instructions ?? 'Use the declared typed tool once and return its bounded result.',
    tags: ['fixture'],
    requiredTools: input.requiredTools ?? [],
    requiredCapabilities: input.requiredCapabilities ?? [],
    optionalCapabilities: input.optionalCapabilities ?? [],
    dataScopes: input.dataScopes ?? [],
    dependencies: input.dependencies ?? [],
    compatibility: {},
    createdAt: now,
    updatedAt: now,
  };
  const verifier = new SkillIntegrityVerifier();
  const draft: SkillPackage = { version: 1, manifest: { ...base, integrity: { algorithm: 'sha256', contentHash: '', manifestHash: '' } }, source };
  const contentHash = await verifier.computeContentHash(draft);
  const manifestHash = await verifier.computeManifestHash({ ...draft.manifest, integrity: { algorithm: 'sha256', contentHash, manifestHash: '' } });
  return { ...draft, manifest: { ...base, integrity: { algorithm: 'sha256', contentHash, manifestHash } } };
}

function readTool(calls: string[]): Tool<{ value: string }, { value: string }> {
  return { version: 1, id: 'fixture.read', name: 'Fixture reader', description: 'Reads a bounded fixture value.', capabilities: ['READ_PRIVATE'], inputSchema: z.object({ value: z.string() }).strict(), outputSchema: z.object({ value: z.string() }).strict(), resultClass: 'PRIVATE', execute: input => { calls.push(input.value); return { value: input.value }; } };
}

describe('installable declarative Skill packages', () => {
  it('requires review, installs disabled, then executes through ToolPolicy', async () => {
    const calls: string[] = []; const tools = new ToolRegistry(); tools.register(readTool(calls)); const legacy = new SkillRegistry(); const registry = new SkillPackageRegistry({ legacyRegistry: legacy, toolRegistry: tools });
    const pkg = await packageFor({ skillId: 'fixture.reader', requiredTools: ['fixture.read'], requiredCapabilities: ['READ_PRIVATE'] });
    await expect(registry.install(pkg)).rejects.toMatchObject({ code: 'PERMISSION_REVIEW_REQUIRED' });
    const review = await registry.prepareReview(pkg); expect(review.canInstall).toBe(true); expect(review.requiresPermissionReview).toBe(true);
    const installation = await registry.install(pkg, { userApproved: true, enabled: false, approvedCapabilities: ['READ_PRIVATE'] }); expect(installation.enabled).toBe(false);
    await expect(new SkillRuntime(registry, tools).open(pkg.manifest.skillId)).rejects.toMatchObject({ code: 'NOT_ENABLED' });
    await registry.enable(pkg.manifest.skillId); const runtime = new SkillRuntime(registry, tools); const scope = await runtime.open(pkg.manifest.skillId);
    const result = await runtime.execute<{ value: string }>(await runtime.issueIntent(scope, { toolId: 'fixture.read', arguments: { value: 'ok' } })); expect(result.ok).toBe(true); expect(calls).toEqual(['ok']); expect(legacy.get(pkg.manifest.skillId)?.enabled).toBe(true);
  });

  it('rejects tampered content and forged author signatures', async () => {
    const pkg = await packageFor(); const verifier = new SkillIntegrityVerifier({ signatureVerifier: { verify: () => false } });
    await expect(verifier.verify({ ...pkg, manifest: { ...pkg.manifest, instructions: 'tampered' } })).rejects.toMatchObject({ code: 'INTEGRITY_MISMATCH' });
    const signed = await packageFor(); const withSignature = { ...signed, manifest: { ...signed.manifest, authorSignature: { algorithm: 'ed25519' as const, value: 'forged' } } }; const hash = await verifier.computeContentHash(withSignature); const manifestHash = await verifier.computeManifestHash({ ...withSignature.manifest, integrity: { algorithm: 'sha256', contentHash: hash, manifestHash: '' } });
    await expect(verifier.verify({ ...withSignature, manifest: { ...withSignature.manifest, integrity: { algorithm: 'sha256', contentHash: hash, manifestHash } } })).rejects.toMatchObject({ code: 'AUTHOR_SIGNATURE_INVALID' });
  });

  it('requires a fresh review for capability expansion and supports verified rollback', async () => {
    const registry = new SkillPackageRegistry(); const v1 = await packageFor({ skillId: 'fixture.evolve', requiredCapabilities: ['READ_PRIVATE'] }); await registry.install(v1, { userApproved: true, approvedCapabilities: ['READ_PRIVATE'] });
    const v2 = await packageFor({ skillId: 'fixture.evolve', version: '1.1.0', requiredCapabilities: ['READ_PRIVATE', 'WRITE_PRIVATE'], instructions: 'Read, then ask ToolPolicy before writing.' });
    await expect(registry.update(v2)).rejects.toMatchObject({ code: 'UPDATE_REQUIRES_REVIEW' });
    await registry.update(v2, { userApproved: true, approvedCapabilities: ['READ_PRIVATE', 'WRITE_PRIVATE'] }); const revisions = await registry.revisionsList('fixture.evolve'); expect(revisions).toHaveLength(2);
    await expect(registry.rollback('fixture.evolve', revisions[0]!.revisionId)).rejects.toMatchObject({ code: 'PERMISSION_REVIEW_REQUIRED' });
    const rolled = await registry.rollback('fixture.evolve', revisions[0]!.revisionId, { userApproved: true }); expect(rolled.packageVersion).toBe('1.0.0');
  });

  it('detects missing dependencies and cycles without installing plugins', async () => {
    const resolver = new SkillDependencyResolver({ packages: () => [] }); const missing = await packageFor({ skillId: 'fixture.missing', dependencies: [{ id: 'not-installed', kind: 'skill' }] }); expect(resolver.resolve(missing).ok).toBe(false); expect(resolver.resolve(missing).missing[0]?.id).toBe('not-installed');
    const a = await packageFor({ skillId: 'fixture.a', dependencies: [{ id: 'fixture.b', kind: 'skill' }] }); const b = await packageFor({ skillId: 'fixture.b', dependencies: [{ id: 'fixture.a', kind: 'skill' }] }); const cycle = new SkillDependencyResolver({ packages: () => [a, b] }).resolve(a, [a, b]); expect(cycle.cycles.length).toBeGreaterThan(0);
    const plugin = await packageFor({ skillId: 'fixture.plugin', dependencies: [{ id: 'future-plugin', kind: 'plugin' }] }); expect(new SkillDependencyResolver().resolve(plugin).ok).toBe(false);
  });

  it('routes only relevant Skills and bounds full instruction loading', async () => {
    const registry = new SkillPackageRegistry(); for (let index = 0; index < 120; index += 1) { const pkg = await packageFor({ skillId: `fixture.skill-${index}`, name: `Skill ${index}`, instructions: `Procedure for topic-${index}.` }); await registry.install(pkg, { userApproved: true, enabled: true }); }
    const resolver = new SkillResolver(registry); expect(resolver.lightweightIndex()).toHaveLength(120); expect(resolver.search('Skill 42', { limit: 4 })).toHaveLength(1); const loaded = await resolver.loadRelevant('Skill', { limit: 50, maxInstructions: 80 }); expect(loaded.length).toBeLessThanOrEqual(8);
    const candidates = await resolver.contextCandidates({ query: 'Skill 42', maxInstructions: 64 }); expect(candidates).toHaveLength(1); expect(candidates[0]!.value).toContain('topic-42');
  });

  it('creates candidates only after repeated success and keeps procedural memory separate', async () => {
    const registry = new SkillPackageRegistry(); const learning = new SkillLearningService({ registry, minSuccessfulRuns: 3 });
    expect(await learning.observe({ runId: 'run-1', procedureId: 'summarize', success: true, toolIds: ['fixture.read'], stepCount: 1 })).toBeUndefined();
    expect(await learning.observe({ runId: 'run-2', procedureId: 'summarize', success: true, toolIds: ['fixture.read'], stepCount: 1 })).toBeUndefined(); const candidate = await learning.observe({ runId: 'run-3', procedureId: 'summarize', success: true, toolIds: ['fixture.read'], stepCount: 1, instructions: 'Use fixture.read once.' }); expect(candidate?.status).toBe('pending'); expect((await registry.list()).length).toBe(0);
    const review = await learning.approve(candidate!.candidateId); expect(review.package.manifest.skillId).toContain('learned.'); expect((await registry.list()).length).toBe(0);
  });

  it('proposes reviewable revisions and preserves persistence across restart', async () => {
    const store = new InMemorySkillPackageStateStore(); const first = new SkillPackageRegistry({ state: store }); const pkg = await packageFor({ skillId: 'fixture.persist' }); await first.install(pkg, { userApproved: true }); const revisionService = new SkillRevisionService({ registry: first }); const proposal = await revisionService.propose(pkg.manifest.skillId, { instructions: 'Use the same bounded procedure with a clearer output.', reason: 'Observed repeated success', expectedBenefit: 'Clearer result' }); expect(proposal.status).toBe('pending'); await expect(revisionService.accept(proposal.proposalId)).rejects.toMatchObject({ code: 'PERMISSION_REVIEW_REQUIRED' }); await revisionService.accept(proposal.proposalId, { userApproved: true });
    const second = new SkillPackageRegistry({ state: store }); await second.ready(); expect((await second.installation(pkg.manifest.skillId))?.packageVersion).toBe('1.0.1'); expect((await second.proposalsList(pkg.manifest.skillId))[0]?.status).toBe('accepted');
  });

  it('normalizes an imported Agent-Skills-like package as untrusted data', async () => {
    const registry = new SkillPackageRegistry(); const imported = { id: 'imported.skill', name: 'Imported', description: 'Imported instructions', version: '1.0.0', instructions: 'Use a bounded typed tool.', toolIds: [], declaredCapabilities: [], tags: ['imported'] }; const installer = new (await import('./skill-packages.js')).SkillInstaller({ registry }); const pkg = installer.importCompatible(imported); expect(pkg.untrusted).toBe(true); expect(pkg.source.kind).toBe('imported'); const review = await installer.review(pkg); expect(review.canInstall).toBe(true); expect(review.integrity.signature).toBe('unsigned');
  });

  it('keeps package and ToolExecutor lifecycles safe without a legacy registry', async () => {
    const calls: string[] = []; const tools = new ToolRegistry(); tools.register(readTool(calls)); const registry = new SkillPackageRegistry({ toolRegistry: tools }); const v1 = await packageFor({ skillId: 'fixture.lifecycle', requiredTools: ['fixture.read'], requiredCapabilities: ['READ_PRIVATE'] }); await registry.install(v1, { userApproved: true, enabled: true, approvedCapabilities: ['READ_PRIVATE'] }); const runtime = new SkillRuntime(registry, tools); const scope = await runtime.open(v1.manifest.skillId); expect((await runtime.execute(await runtime.issueIntent(scope, { toolId: 'fixture.read', arguments: { value: 'no-legacy' } }))).ok).toBe(true); const v2 = await packageFor({ skillId: 'fixture.lifecycle', version: '1.0.1', requiredTools: ['fixture.read'], requiredCapabilities: ['READ_PRIVATE'], instructions: 'Same bounded procedure, clearer output.' }); await registry.update(v2); await expect(registry.update(v2, { approvedCapabilities: ['WRITE_PRIVATE'], userApproved: true })).rejects.toMatchObject({ code: 'PERMISSION_REVIEW_REQUIRED' }); await registry.uninstall(v1.manifest.skillId); expect(await registry.installation(v1.manifest.skillId)).toBeUndefined(); expect(calls).toEqual(['no-legacy']);
  });
});
