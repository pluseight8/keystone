/**
 * Installable, declarative Keystone Skills.
 *
 * A SkillPackage is data and instructions only.  It is deliberately not a
 * plugin runtime: no package can register executable code, extend ToolPolicy,
 * evaluate JavaScript, access a shell, or silently acquire capabilities.
 * ToolRegistry/ToolExecutor remain the only executable boundary.
 */
import { canonicalJson } from '../crypto.js';
import { sha256 } from '../social/content.js';
import {
  SkillRegistry,
  ToolExecutor,
  ToolRegistry,
  ToolSecurityError,
  computeSkillIntegrityHash,
  type Skill,
  type SkillCapability,
  type ToolCapability,
  type ToolIntent,
  type ToolResult,
} from './tools.js';
import type { AIContextItem, AIDataClass } from './privacy.js';
import type { AgentContextCandidate, AgentContextSource, AgentContextSourceRequest } from './agents.js';
import { MandatorySafetySurfaceRegistry } from '../security/safety-surfaces.js';
import { SafetyRuntime, SafetySurfaceGate } from '../security/content-safety.js';

export const SKILL_PACKAGE_SYSTEM_VERSION = 1 as const;
export const SKILL_PACKAGE_MAX_INSTRUCTIONS = 256 * 1024;
export const SKILL_PACKAGE_MAX_FILES = 128;
export const SKILL_PACKAGE_MAX_DEPENDENCIES = 128;
export const SKILL_PACKAGE_MAX_TAGS = 64;
export const SKILL_PACKAGE_MAX_INSTALLED = 2_000;
export const SKILL_PACKAGE_MAX_INDEX_RESULTS = 32;
export const SKILL_PACKAGE_MAX_CONTEXT_SKILLS = 8;
export const SKILL_PACKAGE_MAX_CANDIDATES = 256;
export const SKILL_PACKAGE_MAX_PROPOSALS = 256;

export type SkillPackageSourceKind = 'builtin' | 'local' | 'local-file' | 'file-object' | 'url' | 'p2p' | 'imported';
export type SkillSourceKind = SkillPackageSourceKind;
export interface SkillSource {
  readonly kind: SkillPackageSourceKind;
  readonly reference: string;
  readonly provenance?: { readonly objectId?: string; readonly sourceId?: string; readonly receivedAt?: string };
}

export type SkillDependencyKind = 'skill' | 'tool' | 'capability' | 'host' | 'keystone' | 'plugin';
export interface SkillDependency {
  readonly id: string;
  readonly kind: SkillDependencyKind;
  readonly versionRange?: string;
  readonly optional?: boolean;
  readonly description?: string;
}

export interface SkillCompatibility {
  readonly minKeystoneVersion?: string;
  readonly maxKeystoneVersion?: string;
  readonly platforms?: readonly ('linux' | 'windows' | 'macos' | 'android' | 'ios' | 'web' | 'any')[];
  readonly runtimes?: readonly string[];
  readonly warnings?: readonly string[];
}

export interface SkillAuthorReference {
  readonly identityId?: string;
  readonly reference?: string;
  /** Display names are labels only and never authority. */
  readonly displayName?: string;
}

export interface SkillIntegrity {
  readonly algorithm: 'sha256';
  readonly contentHash: string;
  readonly manifestHash: string;
}

export interface SkillAuthorSignature {
  readonly algorithm: 'ed25519' | 'identity';
  readonly value: string;
  readonly publicKey?: string;
}

/** The normalized, versioned package manifest.  Instructions are declarative. */
export interface SkillManifest {
  readonly formatVersion: 1;
  readonly skillId: string;
  readonly name: string;
  readonly description: string;
  readonly author: SkillAuthorReference;
  readonly version: string;
  readonly entrypoint: string;
  readonly instructions: string;
  readonly tags: readonly string[];
  readonly requiredTools: readonly string[];
  readonly requiredCapabilities: readonly ToolCapability[];
  readonly optionalCapabilities: readonly ToolCapability[];
  readonly dataScopes: readonly string[];
  readonly dependencies: readonly SkillDependency[];
  readonly compatibility: SkillCompatibility;
  readonly integrity: SkillIntegrity;
  readonly authorSignature?: SkillAuthorSignature;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SkillDeclarativeTest {
  readonly id: string;
  readonly description: string;
  readonly input?: unknown;
  readonly expected?: unknown;
  readonly requiredTools?: readonly string[];
}

export interface SkillPackageFile {
  readonly path: string;
  readonly content: string;
  readonly contentHash?: string;
}

export interface SkillPackage {
  readonly version: 1;
  readonly manifest: SkillManifest;
  readonly source: SkillSource;
  readonly files?: readonly SkillPackageFile[];
  readonly tests?: readonly SkillDeclarativeTest[];
  /** Imported formats remain explicitly untrusted even after normalization. */
  readonly untrusted?: boolean;
}

export interface SkillRevision {
  readonly version: 1;
  readonly revisionId: string;
  readonly skillId: string;
  readonly packageVersion: string;
  readonly package: SkillPackage;
  readonly verifiedAt: string;
  readonly verified: boolean;
  readonly source: SkillSource;
  readonly createdAt: string;
  readonly supersedes?: string;
}

export type SkillInstallationState = 'installed' | 'enabled' | 'disabled' | 'uninstalled';
export interface SkillInstallation {
  readonly version: 1;
  readonly skillId: string;
  readonly revisionId: string;
  readonly packageVersion: string;
  readonly state: SkillInstallationState;
  readonly enabled: boolean;
  readonly approvedCapabilities: readonly ToolCapability[];
  readonly approvedDataScopes: readonly string[];
  readonly installedAt: string;
  readonly updatedAt: string;
  readonly source: SkillSource;
}

/** Options that are safe to expose from desktop/mobile host adapters. */
export interface SkillPackageInstallOptions {
  readonly userApproved?: boolean;
  readonly enabled?: boolean;
  readonly approvedCapabilities?: readonly ToolCapability[];
  readonly approvedDataScopes?: readonly string[];
}

export interface SkillIndexEntry {
  readonly skillId: string;
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly tags: readonly string[];
  readonly capabilitySummary: readonly ToolCapability[];
  readonly dataScopes: readonly string[];
  readonly requiredTools: readonly string[];
  readonly enabled: boolean;
  readonly applicability?: readonly string[];
  readonly source: SkillSourceKind;
  readonly untrusted: boolean;
}

export interface SkillReview {
  readonly version: 1;
  readonly package: SkillPackage;
  readonly integrity: SkillIntegrityStatus;
  readonly dependencies: SkillDependencyResolution;
  readonly evaluation: SkillEvaluationResult;
  readonly requestedCapabilities: readonly ToolCapability[];
  readonly requestedTools: readonly string[];
  readonly requestedDataScopes: readonly string[];
  readonly compatibilityWarnings: readonly string[];
  readonly requiresPermissionReview: boolean;
  readonly canInstall: boolean;
}

export interface SkillIntegrityStatus {
  readonly contentHashValid: boolean;
  readonly manifestHashValid: boolean;
  readonly signature: 'verified' | 'unsigned' | 'unverified' | 'invalid';
  readonly source: SkillSource;
  readonly details?: string;
}

export interface SkillDependencyResolution {
  readonly ok: boolean;
  readonly orderedSkillIds: readonly string[];
  readonly missing: readonly SkillDependency[];
  readonly incompatible: readonly SkillDependency[];
  readonly cycles: readonly (readonly string[])[];
  readonly optionalMissing: readonly SkillDependency[];
  readonly unresolvedPlugins: readonly SkillDependency[];
}

export interface SkillEvaluationResult {
  readonly ok: boolean;
  readonly checks: readonly { readonly id: string; readonly ok: boolean; readonly detail?: string }[];
  readonly warnings: readonly string[];
  readonly errors: readonly string[];
  readonly score: number;
}

export interface SkillCandidate {
  readonly version: 1;
  readonly candidateId: string;
  readonly skillId?: string;
  readonly title: string;
  readonly summary: string;
  readonly instructions: string;
  readonly toolIds: readonly string[];
  readonly requiredCapabilities: readonly ToolCapability[];
  readonly dataScopes: readonly string[];
  readonly evidence: readonly SkillExperienceEvidence[];
  readonly fingerprint: string;
  readonly status: 'pending' | 'approved' | 'rejected' | 'expired';
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SkillExperienceEvidence {
  readonly runId: string;
  readonly procedureId: string;
  readonly success: boolean;
  readonly toolIds: readonly string[];
  readonly stepCount: number;
  readonly occurredAt: string;
  readonly dataClass?: AIDataClass;
}

export interface SkillExperience {
  readonly runId: string;
  readonly procedureId: string;
  readonly success: boolean;
  readonly toolIds: readonly string[];
  readonly stepCount: number;
  readonly occurredAt?: string;
  readonly title?: string;
  readonly summary?: string;
  readonly instructions?: string;
  readonly requiredCapabilities?: readonly ToolCapability[];
  readonly dataScopes?: readonly string[];
  readonly dataClass?: AIDataClass;
}

export interface SkillRevisionProposal {
  readonly version: 1;
  readonly proposalId: string;
  readonly skillId: string;
  readonly baseRevisionId: string;
  readonly proposedRevision: SkillRevision;
  readonly reason: string;
  readonly diff: SkillRevisionDiff;
  readonly evaluation: SkillEvaluationResult;
  readonly status: 'pending' | 'accepted' | 'rejected';
  readonly requiresPermissionReview: boolean;
  readonly createdAt: string;
  readonly reviewedAt?: string;
}

export interface SkillRevisionDiff {
  readonly changed: readonly string[];
  readonly capabilitiesBefore: readonly ToolCapability[];
  readonly capabilitiesAfter: readonly ToolCapability[];
  readonly toolsBefore: readonly string[];
  readonly toolsAfter: readonly string[];
  readonly dataScopesBefore?: readonly string[];
  readonly dataScopesAfter?: readonly string[];
  readonly expectedBenefit: string;
}

export interface SkillPackageStateStore {
  read(): Promise<unknown | undefined>;
  write(value: unknown): Promise<void>;
}

export class InMemorySkillPackageStateStore implements SkillPackageStateStore {
  private value?: unknown;
  async read(): Promise<unknown | undefined> { return this.value === undefined ? undefined : structuredClone(this.value); }
  async write(value: unknown): Promise<void> { this.value = structuredClone(value); }
  corrupt(value: unknown): void { this.value = value; }
}
/** Host-owned durable adapter. The host may wrap the backend with encryption. */
export class PersistentSkillPackageStateStore implements SkillPackageStateStore {
  constructor(private readonly backend: SkillPackageStateStore) {}
  read(): Promise<unknown | undefined> { return this.backend.read(); }
  write(value: unknown): Promise<void> { return this.backend.write(value); }
}

export interface SkillPackageStateSnapshot {
  readonly version: 1;
  readonly packages: readonly SkillPackage[];
  readonly revisions: readonly SkillRevision[];
  readonly installations: readonly SkillInstallation[];
  readonly candidates: readonly SkillCandidate[];
  readonly proposals: readonly SkillRevisionProposal[];
}

export type SkillPackageErrorCode =
  | 'INVALID_PACKAGE' | 'INVALID_MANIFEST' | 'INTEGRITY_MISMATCH' | 'AUTHOR_SIGNATURE_INVALID'
  | 'PERMISSION_REVIEW_REQUIRED' | 'DEPENDENCY_MISSING' | 'DEPENDENCY_CYCLE' | 'DEPENDENCY_INCOMPATIBLE'
  | 'COMPATIBILITY_UNSUPPORTED' | 'NOT_FOUND' | 'ALREADY_INSTALLED' | 'NOT_INSTALLED' | 'NOT_ENABLED'
  | 'REVISION_NOT_FOUND' | 'EVALUATION_FAILED' | 'BOUNDS_EXCEEDED' | 'UNTRUSTED_INSTRUCTION'
  | 'UPDATE_REQUIRES_REVIEW' | 'PLUGIN_UNRESOLVED' | 'CONFLICT' | 'PERSISTENCE';

export class SkillPackageError extends Error {
  constructor(readonly code: SkillPackageErrorCode, message: string) { super(message); this.name = 'SkillPackageError'; }
}

export interface SkillSignatureVerifier {
  verify(input: { readonly payload: string; readonly signature: SkillAuthorSignature; readonly author: SkillAuthorReference }): Promise<boolean> | boolean;
}

export interface SkillIntegrityVerifierOptions { readonly signatureVerifier?: SkillSignatureVerifier; readonly requireAuthorSignature?: boolean; }

export class SkillIntegrityVerifier {
  constructor(private readonly options: SkillIntegrityVerifierOptions = {}) {}
  async computeManifestHash(manifest: SkillManifest): Promise<string> { return sha256(new TextEncoder().encode(canonicalJson(stripManifestIntegrity(manifest)))); }
  async computeContentHash(pkg: SkillPackage): Promise<string> {
    const payload = canonicalJson({ version: pkg.version, manifest: stripManifestIntegrity(pkg.manifest), source: pkg.source, files: pkg.files ?? [], tests: pkg.tests ?? [] });
    return sha256(new TextEncoder().encode(payload));
  }
  async verify(pkg: SkillPackage): Promise<SkillIntegrityStatus> {
    validateSkillPackage(pkg);
    const manifestHash = await this.computeManifestHash(pkg.manifest);
    const contentHash = await this.computeContentHash(pkg);
    const manifestValid = manifestHash.toLowerCase() === pkg.manifest.integrity.manifestHash.toLowerCase();
    const contentValid = contentHash.toLowerCase() === pkg.manifest.integrity.contentHash.toLowerCase();
    let signature: SkillIntegrityStatus['signature'] = 'unsigned';
    if (pkg.manifest.authorSignature) {
      if (!this.options.signatureVerifier) signature = 'unverified';
      else signature = await this.options.signatureVerifier.verify({ payload: canonicalJson({ manifest: stripManifestIntegrity(pkg.manifest), contentHash }), signature: pkg.manifest.authorSignature, author: pkg.manifest.author }) ? 'verified' : 'invalid';
    }
    if (!manifestValid || !contentValid) throw new SkillPackageError('INTEGRITY_MISMATCH', 'Skill manifest/content hash does not match the package');
    if (signature === 'invalid') throw new SkillPackageError('AUTHOR_SIGNATURE_INVALID', 'Skill author signature rejected');
    if (signature === 'unverified' && this.options.requireAuthorSignature) throw new SkillPackageError('AUTHOR_SIGNATURE_INVALID', 'Author signature verification is required by policy');
    return { contentHashValid: contentValid, manifestHashValid: manifestValid, signature, source: structuredClone(pkg.source) };
  }
  verifyPackage(pkg: SkillPackage): Promise<SkillIntegrityStatus> { return this.verify(pkg); }
}

export interface SkillDependencyResolverOptions {
  readonly packages?: () => readonly SkillPackage[];
  readonly tools?: () => readonly string[];
  readonly capabilities?: () => readonly ToolCapability[];
  readonly hosts?: () => readonly string[];
  readonly keystoneVersion?: string;
}

export class SkillDependencyResolver {
  private readonly packages: () => readonly SkillPackage[];
  private readonly tools?: () => readonly string[];
  private readonly capabilities?: () => readonly ToolCapability[];
  private readonly hosts?: () => readonly string[];
  private readonly keystoneVersion?: string;
  constructor(options: SkillDependencyResolverOptions = {}) { this.packages = options.packages ?? (() => []); this.tools = options.tools; this.capabilities = options.capabilities; this.hosts = options.hosts; this.keystoneVersion = options.keystoneVersion; }
  resolve(skill: SkillPackage, installed: readonly SkillPackage[] = this.packages()): SkillDependencyResolution {
    const byId = new Map(installed.map(value => [value.manifest.skillId, value])); byId.set(skill.manifest.skillId, skill);
    const missing: SkillDependency[] = []; const incompatible: SkillDependency[] = []; const optionalMissing: SkillDependency[] = []; const unresolvedPlugins: SkillDependency[] = []; const cycles: string[][] = []; const ordered: string[] = []; const visiting = new Set<string>(); const visited = new Set<string>();
    if (this.keystoneVersion) {
      const compatibility = skill.manifest.compatibility;
      if (compatibility.minKeystoneVersion && compareVersion(parseVersion(this.keystoneVersion), parseVersion(compatibility.minKeystoneVersion)) < 0) incompatible.push({ id: 'keystone', kind: 'keystone', versionRange: `>=${compatibility.minKeystoneVersion}` });
      if (compatibility.maxKeystoneVersion && compareVersion(parseVersion(this.keystoneVersion), parseVersion(compatibility.maxKeystoneVersion)) > 0) incompatible.push({ id: 'keystone', kind: 'keystone', versionRange: `<=${compatibility.maxKeystoneVersion}` });
    }
    const visit = (current: SkillPackage): void => {
      const id = current.manifest.skillId;
      if (visiting.has(id)) { cycles.push([...visiting, id]); return; }
      if (visited.has(id)) return;
      visiting.add(id);
      for (const dependency of current.manifest.dependencies) {
        if (dependency.kind === 'plugin') { (dependency.optional ? optionalMissing : unresolvedPlugins).push(dependency); continue; }
        if (dependency.kind === 'skill') {
          const target = byId.get(dependency.id);
          if (!target) { (dependency.optional ? optionalMissing : missing).push(dependency); continue; }
          if (dependency.versionRange && !satisfiesVersion(target.manifest.version, dependency.versionRange)) { (dependency.optional ? optionalMissing : incompatible).push(dependency); continue; }
          visit(target);
        } else if (dependency.kind === 'tool' && this.tools && !this.tools().includes(dependency.id)) {
          (dependency.optional ? optionalMissing : missing).push(dependency);
        } else if (dependency.kind === 'capability' && this.capabilities && !this.capabilities().includes(dependency.id as ToolCapability)) {
          (dependency.optional ? optionalMissing : missing).push(dependency);
        } else if (dependency.kind === 'host' && (!this.hosts || !this.hosts().includes(dependency.id))) {
          (dependency.optional ? optionalMissing : missing).push(dependency);
        } else if (dependency.kind === 'keystone' && this.keystoneVersion && dependency.versionRange && !satisfiesVersion(this.keystoneVersion, dependency.versionRange)) {
          (dependency.optional ? optionalMissing : incompatible).push(dependency);
        }
      }
      visiting.delete(id); visited.add(id); ordered.push(id);
    };
    visit(skill);
    return { ok: missing.length === 0 && incompatible.length === 0 && cycles.length === 0 && unresolvedPlugins.length === 0, orderedSkillIds: ordered, missing, incompatible, cycles, optionalMissing, unresolvedPlugins };
  }
  resolveDependencies(skill: SkillPackage, installed?: readonly SkillPackage[]): SkillDependencyResolution { return this.resolve(skill, installed); }
}

export interface SkillEvaluatorOptions { readonly maxInstructions?: number; readonly availableTools?: () => readonly string[]; readonly availableCapabilities?: () => readonly ToolCapability[]; }

export class SkillEvaluator {
  private readonly maxInstructions: number;
  private readonly availableTools?: () => readonly string[];
  private readonly availableCapabilities?: () => readonly ToolCapability[];
  constructor(options: SkillEvaluatorOptions = {}) { this.maxInstructions = options.maxInstructions ?? SKILL_PACKAGE_MAX_INSTRUCTIONS; this.availableTools = options.availableTools; this.availableCapabilities = options.availableCapabilities; }
  evaluate(pkg: SkillPackage): SkillEvaluationResult {
    const checks: { id: string; ok: boolean; detail?: string }[] = []; const warnings: string[] = []; const errors: string[] = []; const instructions = pkg.manifest.instructions;
    checks.push({ id: 'schema', ok: true });
    const availableTools = this.availableTools ? new Set(this.availableTools()) : undefined; const unavailableTools = availableTools ? pkg.manifest.requiredTools.filter(tool => !availableTools.has(tool)) : [];
    checks.push({ id: 'required-tools', ok: unavailableTools.length === 0, ...(unavailableTools.length ? { detail: unavailableTools.join(', ') } : {}) }); if (unavailableTools.length) errors.push(`Missing required tools: ${unavailableTools.join(', ')}`);
    const availableCapabilities = this.availableCapabilities ? new Set(this.availableCapabilities()) : undefined; const unavailableCapabilities = availableCapabilities ? pkg.manifest.requiredCapabilities.filter(capability => !availableCapabilities.has(capability)) : [];
    checks.push({ id: 'required-capabilities', ok: unavailableCapabilities.length === 0, ...(unavailableCapabilities.length ? { detail: unavailableCapabilities.join(', ') } : {}) }); if (unavailableCapabilities.length) errors.push(`Missing required capabilities: ${unavailableCapabilities.join(', ')}`);
    const suspicious = /(\b(?:eval|exec|shell|subprocess|child_process|arbitrary\s+filesystem|unrestricted\s+network)\b|ignore\s+(?:(?:all|any|the)\s+)?(?:previous|system|keystone|tool)\s+(?:instructions?|policy)|bypass\s+(?:tool|security|system|keystone)?\s*policy|install\s+(?:another\s+)?(?:skill|package)|(?:modify|rewrite|self[- ]modify)\s+(?:this\s+)?skill|reveal\s+(?:private|secret)\s+(?:key|data|context))/i.test(instructions);
    checks.push({ id: 'instruction-safety', ok: !suspicious, ...(suspicious ? { detail: 'Instruction contains executable or policy-bypass language' } : {}) }); if (suspicious) errors.push('Instructions contain executable or policy-bypass language');
    const loopHint = /(while\s+true|repeat\s+forever|infinite\s+loop|without\s+(?:a\s+)?limit)/i.test(instructions); checks.push({ id: 'bounded-loop', ok: !loopHint }); if (loopHint) errors.push('Instructions do not describe a bounded procedure');
    const tests = pkg.tests ?? [];
    const testsValid = tests.length <= 128 && tests.every(test => isSafeId(test.id) && safeText(test.description, 2_000) && (!test.requiredTools || test.requiredTools.every(tool => isSafeId(tool))));
    checks.push({ id: 'declarative-tests', ok: testsValid, ...(testsValid ? {} : { detail: 'Declarative tests are malformed or exceed bounds' }) });
    if (!testsValid) errors.push('Declarative tests are malformed or exceed bounds');
    if (pkg.untrusted || pkg.source.kind === 'imported' || pkg.source.kind === 'url' || pkg.source.kind === 'p2p') warnings.push('External or imported instructions are untrusted data');
    if (pkg.manifest.author.displayName && !pkg.manifest.author.identityId && !pkg.manifest.author.reference) warnings.push('Author display name is not an authority reference');
    checks.push({ id: 'declarative-only', ok: !pkg.files?.some(file => /\.(?:js|mjs|cjs|ts|sh|bat|ps1|wasm)$/i.test(file.path)), detail: pkg.files?.some(file => /\.(?:js|mjs|cjs|ts|sh|bat|ps1|wasm)$/i.test(file.path)) ? 'Executable file payloads are not allowed' : undefined });
    if (checks.at(-1)?.ok === false) errors.push('Executable file payloads are not allowed');
    const ok = errors.length === 0; return { ok, checks, warnings, errors, score: Math.max(0, Math.min(1, (checks.filter(check => check.ok).length / Math.max(1, checks.length)))) };
  }
  validate(pkg: SkillPackage): SkillEvaluationResult { return this.evaluate(pkg); }
}

export interface SkillPackageRegistryOptions {
  readonly legacyRegistry?: SkillRegistry;
  readonly toolRegistry?: ToolRegistry;
  readonly state?: SkillPackageStateStore;
  readonly now?: () => Date;
  readonly verifier?: SkillIntegrityVerifier;
  readonly evaluator?: SkillEvaluator;
  readonly dependencyResolver?: SkillDependencyResolver;
  readonly keystoneVersion?: string;
  readonly maxInstalled?: number;
  readonly protectedSurfaces?: MandatorySafetySurfaceRegistry;
}

export class SkillPackageRegistry {
  readonly legacyRegistry?: SkillRegistry;
  readonly toolRegistry?: ToolRegistry;
  readonly state: SkillPackageStateStore;
  private readonly now: () => Date;
  private readonly verifier: SkillIntegrityVerifier;
  private readonly evaluator: SkillEvaluator;
  private readonly dependencyResolver: SkillDependencyResolver;
  private readonly maxInstalled: number;
  private readonly protectedSurfaces: MandatorySafetySurfaceRegistry;
  private readonly packages = new Map<string, SkillPackage>();
  private readonly revisions = new Map<string, SkillRevision[]>();
  private readonly installations = new Map<string, SkillInstallation>();
  private readonly candidates = new Map<string, SkillCandidate>();
  private readonly proposals = new Map<string, SkillRevisionProposal>();
  /** External/received packages are exposed only after a successful surface evaluation. */
  private readonly gatedPackages = new Set<string>();
  private readyPromise: Promise<void>;
  constructor(options: SkillPackageRegistryOptions = {}) {
    this.legacyRegistry = options.legacyRegistry; this.toolRegistry = options.toolRegistry; this.state = options.state ?? new InMemorySkillPackageStateStore(); this.now = options.now ?? (() => new Date()); this.verifier = options.verifier ?? new SkillIntegrityVerifier();
    this.evaluator = options.evaluator ?? new SkillEvaluator(this.toolRegistry ? { availableTools: () => this.toolRegistry!.list().map(tool => tool.id), availableCapabilities: () => [...new Set(this.toolRegistry!.list().flatMap(tool => tool.capabilities))] } : {});
    this.dependencyResolver = options.dependencyResolver ?? new SkillDependencyResolver({ packages: () => [...this.packages.values()], ...(this.toolRegistry ? { tools: () => this.toolRegistry!.list().map(tool => tool.id), capabilities: () => [...new Set(this.toolRegistry!.list().flatMap(tool => tool.capabilities))] } : {}), ...(options.keystoneVersion ? { keystoneVersion: options.keystoneVersion } : {}) }); this.maxInstalled = clamp(options.maxInstalled ?? SKILL_PACKAGE_MAX_INSTALLED, 1, SKILL_PACKAGE_MAX_INSTALLED); this.protectedSurfaces = options.protectedSurfaces ?? new MandatorySafetySurfaceRegistry(new SafetySurfaceGate(new SafetyRuntime())); this.readyPromise = this.hydrate();
  }
  async ready(): Promise<void> { await this.readyPromise; }
  async list(): Promise<readonly SkillInstallation[]> { await this.ready(); return [...this.installations.values()].map(clone); }
  listInstalled(): Promise<readonly SkillInstallation[]> { return this.list(); }
  async listPackages(): Promise<readonly SkillPackage[]> { await this.ready(); const safe: SkillPackage[] = []; for (const value of this.packages.values()) if (!requiresSkillSurface(value) || await this.surfaceEligible(value)) safe.push(clone(value)); return safe; }
  async get(skillId: string): Promise<SkillPackage | undefined> { await this.ready(); const value = this.packages.get(skillId); if (!value || requiresSkillSurface(value) && !(await this.surfaceEligible(value))) return undefined; return clone(value); }
  async loadForRuntime(skillId: string, maxInstructions = SKILL_PACKAGE_MAX_INSTRUCTIONS): Promise<SkillPackage> { const value = await this.get(skillId); if (!value) throw new SkillPackageError('NOT_FOUND', `Skill ${skillId} is not installed`); if (value.manifest.instructions.length > maxInstructions) throw new SkillPackageError('BOUNDS_EXCEEDED', 'Skill instructions exceed the runtime bound'); return value; }
  async installation(skillId: string): Promise<SkillInstallation | undefined> { await this.ready(); const value = this.installations.get(skillId); return value ? clone(value) : undefined; }
  async getRevision(skillId: string, revisionId?: string): Promise<SkillRevision | undefined> { await this.ready(); const values = this.revisions.get(skillId) ?? []; const value = revisionId ? values.find(item => item.revisionId === revisionId) : values.at(-1); return value && await this.surfaceEligible(value.package) ? clone(value) : undefined; }
  async revisionsList(skillId: string): Promise<readonly SkillRevision[]> { await this.ready(); const safe: SkillRevision[] = []; for (const value of this.revisions.get(skillId) ?? []) if (await this.surfaceEligible(value.package)) safe.push(clone(value)); return safe; }
  /** Project one verified package into a host-provided legacy ToolExecutor registry. */
  async projectLegacy(skillId: string, target: SkillRegistry): Promise<void> { await this.ready(); const pkg = this.packages.get(skillId); const installation = this.installations.get(skillId); if (!pkg || !installation) throw new SkillPackageError('NOT_FOUND', `Skill ${skillId} is not installed`); await this.syncLegacy(pkg, installation, target); }
  async prepareReview(pkg: SkillPackage): Promise<SkillReview> {
    await this.ready(); validateSkillPackage(pkg); if (requiresSkillSurface(pkg)) { if (!(await this.surfaceEligible(pkg))) throw new SkillPackageError('EVALUATION_FAILED', 'Received Skill package failed mandatory safety gating'); this.gatedPackages.add(pkg.manifest.skillId); } const integrity = await this.verifier.verify(pkg); const dependencies = this.dependencyResolver.resolve(pkg, [...this.packages.values()]); const evaluation = this.evaluator.evaluate(pkg); const current = this.installations.get(pkg.manifest.skillId); const currentPackage = this.packages.get(pkg.manifest.skillId); const requestedCapabilities = [...new Set([...pkg.manifest.requiredCapabilities, ...pkg.manifest.optionalCapabilities])]; const compatibilityWarnings = [...(pkg.manifest.compatibility.warnings ?? [])];
    if (pkg.manifest.compatibility.platforms?.length && !pkg.manifest.compatibility.platforms.includes('any')) compatibilityWarnings.push(`Supported platforms: ${pkg.manifest.compatibility.platforms.join(', ')}`);
    const requiresPermissionReview = !current || !containsAll(current.approvedCapabilities, requestedCapabilities) || !containsAll(current.approvedDataScopes, pkg.manifest.dataScopes) || !currentPackage || !containsAll(currentPackage.manifest.requiredTools, pkg.manifest.requiredTools);
    return { version: 1, package: clone(pkg), integrity, dependencies, evaluation, requestedCapabilities, requestedTools: [...pkg.manifest.requiredTools], requestedDataScopes: [...pkg.manifest.dataScopes], compatibilityWarnings, requiresPermissionReview, canInstall: dependencies.ok && evaluation.ok };
  }
  async install(pkg: SkillPackage, options: { readonly userApproved?: boolean; readonly enabled?: boolean; readonly approvedCapabilities?: readonly ToolCapability[]; readonly approvedDataScopes?: readonly string[]; readonly replace?: boolean } = {}): Promise<SkillInstallation> {
    await this.ready(); if (options.userApproved !== true) throw new SkillPackageError('PERMISSION_REVIEW_REQUIRED', 'Skill installation requires explicit user review'); const review = await this.prepareReview(pkg); if (!review.canInstall) throw new SkillPackageError(review.dependencies.cycles.length ? 'DEPENDENCY_CYCLE' : review.dependencies.unresolvedPlugins.length ? 'PLUGIN_UNRESOLVED' : review.dependencies.missing.length ? 'DEPENDENCY_MISSING' : 'EVALUATION_FAILED', [...review.dependencies.missing.map(value => value.id), ...review.dependencies.unresolvedPlugins.map(value => value.id), ...review.evaluation.errors].join('; ') || 'Skill evaluation failed');
    const existing = this.installations.get(pkg.manifest.skillId); if (existing && !options.replace) throw new SkillPackageError('ALREADY_INSTALLED', `Skill ${pkg.manifest.skillId} is already installed; use update`); if (!existing && this.installations.size >= this.maxInstalled) throw new SkillPackageError('BOUNDS_EXCEEDED', 'Installed Skill limit reached'); const declaredCapabilities = [...new Set([...pkg.manifest.requiredCapabilities, ...pkg.manifest.optionalCapabilities])]; const suppliedCapabilities = [...new Set(options.approvedCapabilities ?? (existing?.approvedCapabilities ?? []))]; const undeclaredCapabilities = suppliedCapabilities.filter(capability => !declaredCapabilities.includes(capability)); if (undeclaredCapabilities.length && options.approvedCapabilities !== undefined) throw new SkillPackageError('PERMISSION_REVIEW_REQUIRED', 'Approved Skill capabilities must be declared by the Skill'); const approved = suppliedCapabilities.filter(capability => declaredCapabilities.includes(capability)); if (!containsAll(approved, pkg.manifest.requiredCapabilities)) throw new SkillPackageError('PERMISSION_REVIEW_REQUIRED', 'Required Skill capabilities have not been approved'); const declaredDataScopes = new Set(pkg.manifest.dataScopes); const suppliedDataScopes = [...new Set(options.approvedDataScopes ?? (existing?.approvedDataScopes ?? pkg.manifest.dataScopes))]; const undeclaredDataScopes = suppliedDataScopes.filter(scope => !declaredDataScopes.has(scope)); if (undeclaredDataScopes.length && options.approvedDataScopes !== undefined) throw new SkillPackageError('PERMISSION_REVIEW_REQUIRED', 'Approved data scopes must be declared by the Skill'); const dataScopes = suppliedDataScopes.filter(scope => declaredDataScopes.has(scope)); if (!containsAll(dataScopes, pkg.manifest.dataScopes)) throw new SkillPackageError('PERMISSION_REVIEW_REQUIRED', 'All Skill data scopes must be approved'); const revision: SkillRevision = { version: 1, revisionId: randomId('skill-revision'), skillId: pkg.manifest.skillId, packageVersion: pkg.manifest.version, package: clone(pkg), verifiedAt: this.now().toISOString(), verified: true, source: clone(pkg.source), createdAt: this.now().toISOString(), ...(existing ? { supersedes: existing.revisionId } : {}) }; this.packages.set(pkg.manifest.skillId, clone(pkg)); this.revisions.set(pkg.manifest.skillId, [...(this.revisions.get(pkg.manifest.skillId) ?? []), revision].slice(-32)); const enabled = options.enabled === true; const installation: SkillInstallation = { version: 1, skillId: pkg.manifest.skillId, revisionId: revision.revisionId, packageVersion: pkg.manifest.version, state: enabled ? 'enabled' : 'disabled', enabled, approvedCapabilities: approved, approvedDataScopes: dataScopes, installedAt: existing?.installedAt ?? this.now().toISOString(), updatedAt: this.now().toISOString(), source: clone(pkg.source) }; this.installations.set(pkg.manifest.skillId, installation); await this.syncLegacy(pkg, installation); await this.persist(); return clone(installation);
  }
  async enable(skillId: string): Promise<SkillInstallation> { const current = await this.requireInstallation(skillId); const next = { ...current, enabled: true, state: 'enabled' as const, updatedAt: this.now().toISOString() }; this.installations.set(skillId, next); this.legacyRegistry?.enable(skillId); await this.persist(); return clone(next); }
  setEnabled(skillId: string, enabled: boolean): Promise<SkillInstallation> { return enabled ? this.enable(skillId) : this.disable(skillId); }
  async disable(skillId: string): Promise<SkillInstallation> { const current = await this.requireInstallation(skillId); const next = { ...current, enabled: false, state: 'disabled' as const, updatedAt: this.now().toISOString() }; this.installations.set(skillId, next); this.legacyRegistry?.disable(skillId); await this.persist(); return clone(next); }
  async uninstall(skillId: string): Promise<void> { await this.ready(); if (!this.installations.has(skillId)) throw new SkillPackageError('NOT_INSTALLED', `Skill ${skillId} is not installed`); this.installations.delete(skillId); this.packages.delete(skillId); this.revisions.delete(skillId); this.legacyRegistry?.remove(skillId); await this.persist(); }
  async update(pkg: SkillPackage, options: SkillPackageInstallOptions = {}): Promise<SkillInstallation> { await this.ready(); if (!this.installations.has(pkg.manifest.skillId)) throw new SkillPackageError('NOT_INSTALLED', `Skill ${pkg.manifest.skillId} is not installed`); const old = this.installations.get(pkg.manifest.skillId)!; const review = await this.prepareReview(pkg); if (review.requiresPermissionReview && options.userApproved !== true) throw new SkillPackageError('UPDATE_REQUIRES_REVIEW', 'Skill update requests a new permission review'); return this.install(pkg, { ...options, replace: true, userApproved: true, enabled: options.enabled ?? old.enabled, approvedCapabilities: options.approvedCapabilities ?? old.approvedCapabilities, approvedDataScopes: options.approvedDataScopes ?? old.approvedDataScopes }); }
  async rollback(skillId: string, revisionId?: string, options: { readonly userApproved?: boolean; readonly enabled?: boolean } = {}): Promise<SkillInstallation> { await this.ready(); if (options.userApproved !== true) throw new SkillPackageError('PERMISSION_REVIEW_REQUIRED', 'Rollback requires explicit user review'); const revision = await this.getRevision(skillId, revisionId); if (!revision) throw new SkillPackageError('REVISION_NOT_FOUND', 'Verified Skill revision was not found'); const current = await this.requireInstallation(skillId); return this.install(revision.package, { replace: true, userApproved: true, enabled: options.enabled ?? current.enabled, approvedDataScopes: current.approvedDataScopes }); }
  async createCandidate(candidate: SkillCandidate): Promise<SkillCandidate> { await this.ready(); validateCandidate(candidate); if (!(await this.candidateSurfaceEligible(candidate))) throw new SkillPackageError('EVALUATION_FAILED', 'Skill preview failed mandatory safety gating'); if (this.candidates.size >= SKILL_PACKAGE_MAX_CANDIDATES) throw new SkillPackageError('BOUNDS_EXCEEDED', 'Skill candidate limit reached'); this.candidates.set(candidate.candidateId, clone(candidate)); await this.persist(); return clone(candidate); }
  async candidatesList(): Promise<readonly SkillCandidate[]> { await this.ready(); const safe: SkillCandidate[] = []; for (const value of this.candidates.values()) if (await this.candidateSurfaceEligible(value)) safe.push(clone(value)); return safe; }
  listCandidates(): Promise<readonly SkillCandidate[]> { return this.candidatesList(); }
  async getCandidate(candidateId: string): Promise<SkillCandidate | undefined> { await this.ready(); const value = this.candidates.get(candidateId); return value && await this.candidateSurfaceEligible(value) ? clone(value) : undefined; }
  async rejectCandidate(candidateId: string): Promise<SkillCandidate> { await this.ready(); const current = this.candidates.get(candidateId); if (!current) throw new SkillPackageError('NOT_FOUND', 'Skill candidate not found'); const next = { ...current, status: 'rejected' as const, updatedAt: this.now().toISOString() }; this.candidates.set(candidateId, next); await this.persist(); return clone(next); }
  reject(candidateId: string): Promise<SkillCandidate> { return this.rejectCandidate(candidateId); }
  async saveProposal(proposal: SkillRevisionProposal): Promise<SkillRevisionProposal> { await this.ready(); if (this.proposals.size >= SKILL_PACKAGE_MAX_PROPOSALS) throw new SkillPackageError('BOUNDS_EXCEEDED', 'Skill revision proposal limit reached'); this.proposals.set(proposal.proposalId, clone(proposal)); await this.persist(); return clone(proposal); }
  async proposalsList(skillId?: string): Promise<readonly SkillRevisionProposal[]> { await this.ready(); const safe: SkillRevisionProposal[] = []; for (const value of this.proposals.values()) if ((!skillId || value.skillId === skillId) && await this.surfaceEligible(value.proposedRevision.package)) safe.push(clone(value)); return safe; }
  index(): readonly SkillIndexEntry[] { return [...this.packages.values()].filter(pkg => !requiresSkillSurface(pkg) || this.gatedPackages.has(pkg.manifest.skillId)).map(pkg => { const installation = this.installations.get(pkg.manifest.skillId); return { skillId: pkg.manifest.skillId, name: pkg.manifest.name, description: pkg.manifest.description, version: pkg.manifest.version, tags: [...pkg.manifest.tags], capabilitySummary: [...new Set([...pkg.manifest.requiredCapabilities, ...pkg.manifest.optionalCapabilities])], dataScopes: [...pkg.manifest.dataScopes], requiredTools: [...pkg.manifest.requiredTools], enabled: installation?.enabled === true, source: pkg.source.kind, untrusted: pkg.untrusted === true || pkg.source.kind === 'imported' || pkg.source.kind === 'url' || pkg.source.kind === 'p2p' }; }); }
  private async surfaceEligible(pkg: SkillPackage): Promise<boolean> { return (await this.protectedSurfaces.evaluate('SKILL_PACKAGES', { objectId: pkg.manifest.skillId, domain: 'PUBLIC', value: pkg, content: pkg, sourceType: 'skill', verified: true, authorized: true, sharing: true })) !== undefined; }
  private async candidateSurfaceEligible(candidate: SkillCandidate): Promise<boolean> { return (await this.protectedSurfaces.evaluate('SKILL_PACKAGES', { objectId: candidate.candidateId, domain: 'PUBLIC', value: candidate, content: candidate, sourceType: 'skill-preview', verified: true, authorized: true, sharing: true })) !== undefined; }
  private async requireInstallation(skillId: string): Promise<SkillInstallation> { await this.ready(); const value = this.installations.get(skillId); if (!value) throw new SkillPackageError('NOT_INSTALLED', `Skill ${skillId} is not installed`); return value; }
  private async syncLegacy(pkg: SkillPackage, installation: SkillInstallation, target = this.legacyRegistry): Promise<void> { if (!target) return; const manifest = { version: 1 as const, id: pkg.manifest.skillId, name: pkg.manifest.name, packageVersion: pkg.manifest.version, instructions: pkg.manifest.instructions, toolIds: pkg.manifest.requiredTools, declaredCapabilities: pkg.manifest.requiredCapabilities, source: pkg.source.kind === 'builtin' ? 'builtin' as const : 'local' as const }; const skill: Skill = { ...manifest, integrityHash: await computeSkillIntegrityHash(manifest), enabled: installation.enabled, approvedCapabilities: installation.approvedCapabilities }; target.upsertProjected(skill); }
  private async persist(): Promise<void> { const snapshot: SkillPackageStateSnapshot = { version: 1, packages: [...this.packages.values()], revisions: [...this.revisions.values()].flat(), installations: [...this.installations.values()], candidates: [...this.candidates.values()], proposals: [...this.proposals.values()] }; await this.state.write(snapshot); }
  private async hydrate(): Promise<void> {
    const raw = await this.state.read();
    if (!raw || typeof raw !== 'object') return;
    const value = raw as Partial<SkillPackageStateSnapshot>;
    if (value.version !== 1 || !Array.isArray(value.packages) || !Array.isArray(value.revisions) || !Array.isArray(value.installations)) throw new SkillPackageError('PERSISTENCE', 'Skill package state is corrupt');
    if (value.packages.length > this.maxInstalled || value.revisions.length > this.maxInstalled * 32 || (value.candidates?.length ?? 0) > SKILL_PACKAGE_MAX_CANDIDATES || (value.proposals?.length ?? 0) > SKILL_PACKAGE_MAX_PROPOSALS) throw new SkillPackageError('PERSISTENCE', 'Skill package state exceeds bounds');
    for (const candidate of value.packages) {
      if (!isSkillPackage(candidate)) throw new SkillPackageError('PERSISTENCE', 'Persisted Skill package is invalid');
      try { await this.verifier.verify(candidate); } catch { throw new SkillPackageError('PERSISTENCE', 'Persisted Skill package integrity is invalid'); }
      if (requiresSkillSurface(candidate)) { if (!(await this.surfaceEligible(candidate))) throw new SkillPackageError('PERSISTENCE', 'Persisted received Skill package failed mandatory safety gating'); this.gatedPackages.add(candidate.manifest.skillId); }
      this.packages.set(candidate.manifest.skillId, clone(candidate));
    }
    for (const revision of value.revisions) {
      if (!isSkillRevision(revision)) throw new SkillPackageError('PERSISTENCE', 'Persisted Skill revision is invalid');
      this.revisions.set(revision.skillId, [...(this.revisions.get(revision.skillId) ?? []), clone(revision)]);
    }
    for (const installation of value.installations) {
      if (!isSkillInstallation(installation) || !this.packages.has(installation.skillId) || !(this.revisions.get(installation.skillId) ?? []).some(revision => revision.revisionId === installation.revisionId)) throw new SkillPackageError('PERSISTENCE', 'Persisted Skill installation is invalid');
      this.installations.set(installation.skillId, clone(installation));
    }
    for (const candidate of value.candidates ?? []) { if (!isSkillCandidate(candidate)) throw new SkillPackageError('PERSISTENCE', 'Persisted Skill candidate is invalid'); this.candidates.set(candidate.candidateId, clone(candidate)); }
    for (const proposal of value.proposals ?? []) { if (!isSkillProposal(proposal)) throw new SkillPackageError('PERSISTENCE', 'Persisted Skill proposal is invalid'); this.proposals.set(proposal.proposalId, clone(proposal)); }
    for (const pkg of this.packages.values()) { const installation = this.installations.get(pkg.manifest.skillId); if (installation) await this.syncLegacy(pkg, installation); }
  }
}

export interface SkillInstallerOptions { readonly registry: SkillPackageRegistry; readonly verifier?: SkillIntegrityVerifier; readonly evaluator?: SkillEvaluator; readonly fetchPackage?: (source: SkillSource) => Promise<SkillPackage>; }

export class SkillInstaller {
  private readonly registry: SkillPackageRegistry;
  private readonly verifier: SkillIntegrityVerifier;
  private readonly evaluator: SkillEvaluator;
  private readonly fetchPackage?: (source: SkillSource) => Promise<SkillPackage>;
  constructor(options: SkillInstallerOptions) { this.registry = options.registry; this.verifier = options.verifier ?? new SkillIntegrityVerifier(); this.evaluator = options.evaluator ?? new SkillEvaluator(); this.fetchPackage = options.fetchPackage; }
  async review(pkg: SkillPackage): Promise<SkillReview> { return this.registry.prepareReview(await this.normalizeImportedIntegrity(pkg)); }
  prepare(pkg: SkillPackage): Promise<SkillReview> { return this.review(pkg); }
  async install(pkg: SkillPackage, options: SkillPackageInstallOptions = {}): Promise<SkillInstallation> { const normalized = await this.normalizeImportedIntegrity(pkg); await this.verifier.verify(normalized); const review = await this.registry.prepareReview(normalized); if (!review.evaluation.ok) throw new SkillPackageError('EVALUATION_FAILED', review.evaluation.errors.join('; ')); return this.registry.install(normalized, options); }
  installPackage(pkg: SkillPackage, options?: Parameters<SkillInstaller['install']>[1]): Promise<SkillInstallation> { return this.install(pkg, options); }
  update(pkg: SkillPackage, options?: Parameters<SkillInstaller['install']>[1]): Promise<SkillInstallation> { return this.registry.update(pkg, options); }
  rollback(skillId: string, revisionId?: string, options?: { readonly userApproved?: boolean; readonly enabled?: boolean }): Promise<SkillInstallation> { return this.registry.rollback(skillId, revisionId, options); }
  uninstall(skillId: string): Promise<void> { return this.registry.uninstall(skillId); }
  async installFromSource(source: SkillSource, options: { readonly userApproved?: boolean; readonly enabled?: boolean; readonly approvedCapabilities?: readonly ToolCapability[]; readonly approvedDataScopes?: readonly string[] } = {}): Promise<SkillInstallation> { if (!this.fetchPackage) throw new SkillPackageError('INVALID_PACKAGE', 'A host source resolver is required for this installation source'); const pkg = await this.fetchPackage(source); if (pkg.source.kind !== source.kind || pkg.source.reference !== source.reference) throw new SkillPackageError('INVALID_PACKAGE', 'Package provenance does not match the requested source'); return this.install(pkg, options); }
  async installFromJson(value: string | Uint8Array, source: SkillSource, options: { readonly userApproved?: boolean; readonly enabled?: boolean; readonly approvedCapabilities?: readonly ToolCapability[]; readonly approvedDataScopes?: readonly string[] } = {}): Promise<SkillInstallation> { let parsed: unknown; try { parsed = JSON.parse(typeof value === 'string' ? value : new TextDecoder().decode(value)); } catch { throw new SkillPackageError('INVALID_PACKAGE', 'Skill package JSON is invalid'); } if (!isRecord(parsed)) throw new SkillPackageError('INVALID_PACKAGE', 'Skill package must be an object'); const pkg = normalizeSkillPackage(parsed, source); return this.install(pkg, options); }
  importCompatible(value: unknown, source: SkillSource = { kind: 'imported', reference: 'external' }): SkillPackage { return normalizeCompatibleSkill(value, source); }
  async installImported(value: unknown, source: SkillSource = { kind: 'imported', reference: 'external' }, options: { readonly userApproved?: boolean; readonly enabled?: boolean; readonly approvedCapabilities?: readonly ToolCapability[]; readonly approvedDataScopes?: readonly string[] } = {}): Promise<SkillInstallation> { const pkg = this.importCompatible(value, source); const integrity = await this.verifier.computeContentHash(pkg); const manifestHash = await this.verifier.computeManifestHash(pkg.manifest); const normalized = { ...pkg, manifest: { ...pkg.manifest, integrity: { algorithm: 'sha256' as const, contentHash: integrity, manifestHash } } }; return this.install(normalized, options); }
  private async normalizeImportedIntegrity(pkg: SkillPackage): Promise<SkillPackage> { const integrity = pkg.manifest?.integrity; const missing = !integrity || !integrity.contentHash || !integrity.manifestHash; if (!missing || pkg.source.kind !== 'imported') return pkg; const contentHash = await this.verifier.computeContentHash(pkg); const manifestHash = await this.verifier.computeManifestHash({ ...pkg.manifest, integrity: { algorithm: 'sha256', contentHash, manifestHash: '' } }); return { ...pkg, manifest: { ...pkg.manifest, integrity: { algorithm: 'sha256', contentHash, manifestHash } } }; }
}

export interface SkillResolverOptions { readonly registry: SkillPackageRegistry; }
export interface SkillResolveOptions { readonly limit?: number; readonly maxInstructions?: number; readonly tags?: readonly string[]; readonly dataScopes?: readonly string[]; readonly enabledOnly?: boolean; }

export class SkillResolver {
  private readonly registry: SkillPackageRegistry;
  constructor(options: SkillResolverOptions | SkillPackageRegistry) { this.registry = options instanceof SkillPackageRegistry ? options : options.registry; }
  lightweightIndex(): readonly SkillIndexEntry[] { return this.registry.index(); }
  index(): readonly SkillIndexEntry[] { return this.lightweightIndex(); }
  search(query: string, options: SkillResolveOptions = {}): readonly SkillIndexEntry[] { const needle = query.trim().toLocaleLowerCase(); const requiredTags = new Set(options.tags ?? []); const requiredScopes = new Set(options.dataScopes ?? []); const limit = clamp(options.limit ?? SKILL_PACKAGE_MAX_INDEX_RESULTS, 1, SKILL_PACKAGE_MAX_INDEX_RESULTS); return this.lightweightIndex().filter(entry => (!options.enabledOnly || entry.enabled) && [...requiredTags].every(tag => entry.tags.includes(tag)) && [...requiredScopes].every(scope => entry.dataScopes.includes(scope))).map(entry => ({ entry, score: scoreSkill(entry, needle) })).filter(value => !needle || value.score > 0).sort((a, b) => b.score - a.score || a.entry.skillId.localeCompare(b.entry.skillId)).slice(0, limit).map(value => value.entry); }
  selectRelevant(query: string, options?: SkillResolveOptions): readonly SkillIndexEntry[] { return this.search(query, options); }
  resolve(query: string, options?: SkillResolveOptions): readonly SkillIndexEntry[] { return this.search(query, options); }
  async load(skillId: string, options: { readonly maxInstructions?: number } = {}): Promise<SkillPackage> { const pkg = await this.registry.get(skillId); if (!pkg) throw new SkillPackageError('NOT_FOUND', `Skill ${skillId} is not installed`); if (pkg.manifest.instructions.length > (options.maxInstructions ?? SKILL_PACKAGE_MAX_INSTRUCTIONS)) throw new SkillPackageError('BOUNDS_EXCEEDED', 'Skill instructions exceed the context bound'); return pkg; }
  async loadRelevant(query: string, options: SkillResolveOptions = {}): Promise<readonly SkillPackage[]> { const selected = this.search(query, options); const maxInstructions = options.maxInstructions ?? 64 * 1024; const output: SkillPackage[] = []; let remaining = maxInstructions; for (const entry of selected.slice(0, SKILL_PACKAGE_MAX_CONTEXT_SKILLS)) { const pkg = await this.load(entry.skillId, { maxInstructions: maxInstructions }); const cost = estimateTokens(pkg.manifest.instructions); if (cost > remaining) continue; remaining -= cost; output.push(pkg); } return output; }
  async contextCandidates(request: { readonly query?: string; readonly limit?: number; readonly maxInstructions?: number }): Promise<readonly AgentContextCandidate[]> { const packages = await this.loadRelevant(request.query ?? '', { limit: request.limit ?? SKILL_PACKAGE_MAX_CONTEXT_SKILLS, maxInstructions: request.maxInstructions ?? 32 * 1024, enabledOnly: true }); return packages.map(pkg => ({ id: `skill:${pkg.manifest.skillId}:${pkg.manifest.version}`, dataClass: 'PUBLIC', source: 'skill-instructions', label: pkg.manifest.name, value: pkg.manifest.instructions, capability: 'LOCAL_SEARCH' as const, priority: 2, relevance: 1, tokenEstimate: estimateTokens(pkg.manifest.instructions) })); }
}

/** A ContextBuilder-compatible bounded source; full instructions load only after routing. */
export class SkillContextSource implements AgentContextSource {
  readonly id = 'skills';
  constructor(private readonly resolver: SkillResolver) {}
  async read(request: AgentContextSourceRequest): Promise<readonly AgentContextCandidate[]> { return this.resolver.contextCandidates({ query: request.query, limit: SKILL_PACKAGE_MAX_CONTEXT_SKILLS, maxInstructions: 32 * 1024 }); }
}

export interface SkillRuntimeScope { readonly skillId: string; readonly revisionId: string; readonly instructions: string; readonly toolIds: readonly string[]; readonly approvedCapabilities: readonly ToolCapability[]; readonly approvedDataScopes: readonly string[]; readonly untrusted: boolean; }
export class SkillRuntime {
  private readonly legacy: SkillRegistry;
  private readonly executor: ToolExecutor;
  constructor(private readonly packages: SkillPackageRegistry, private readonly tools: ToolRegistry, executor?: ToolExecutor) { this.legacy = packages.legacyRegistry ?? new SkillRegistry(); this.executor = executor ?? new ToolExecutor(tools, this.legacy); }
  async open(skillId: string, scope: { readonly allowedCapabilities?: readonly ToolCapability[]; readonly allowedDataScopes?: readonly string[]; readonly maxInstructions?: number } = {}): Promise<SkillRuntimeScope> { const pkg = await this.packages.loadForRuntime(skillId, scope.maxInstructions); const installation = await this.packages.installation(skillId); if (!installation?.enabled) throw new SkillPackageError('NOT_ENABLED', `Skill ${skillId} is not enabled`); const declaredCapabilities = [...new Set([...pkg.manifest.requiredCapabilities, ...pkg.manifest.optionalCapabilities])]; const allowed = [...new Set(scope.allowedCapabilities ?? installation.approvedCapabilities)]; if (!containsAll(installation.approvedCapabilities, allowed) || !containsAll(declaredCapabilities, allowed) || !containsAll(allowed, pkg.manifest.requiredCapabilities)) throw new SkillPackageError('PERMISSION_REVIEW_REQUIRED', 'Skill is outside the current capability scope'); const dataScopes = [...new Set(scope.allowedDataScopes ?? installation.approvedDataScopes)]; if (!containsAll(installation.approvedDataScopes, dataScopes) || !containsAll(dataScopes, pkg.manifest.dataScopes)) throw new SkillPackageError('PERMISSION_REVIEW_REQUIRED', 'Skill is outside the current data scope'); const revision = await this.packages.getRevision(skillId, installation.revisionId); if (!revision) throw new SkillPackageError('REVISION_NOT_FOUND', 'Skill revision is unavailable'); await this.packages.projectLegacy(skillId, this.legacy); return { skillId, revisionId: revision.revisionId, instructions: pkg.manifest.instructions, toolIds: [...pkg.manifest.requiredTools], approvedCapabilities: [...allowed], approvedDataScopes: [...dataScopes], untrusted: pkg.untrusted === true || pkg.source.kind === 'imported' || pkg.source.kind === 'url' || pkg.source.kind === 'p2p' }; }
  async issueIntent(scope: SkillRuntimeScope, input: { readonly toolId: string; readonly arguments: unknown; readonly source?: 'local' | 'personal_trusted' | 'external'; readonly requestedCapabilities?: readonly ToolCapability[] }): Promise<ToolIntent> { if (!scope.toolIds.includes(input.toolId)) throw new SkillPackageError('PERMISSION_REVIEW_REQUIRED', 'Skill tool is outside its declared tool set'); const tool = this.tools.get(input.toolId); if (!tool) throw new SkillPackageError('NOT_FOUND', `Skill tool ${input.toolId} is unavailable`); if (!containsAll(scope.approvedCapabilities, tool.capabilities)) throw new SkillPackageError('PERMISSION_REVIEW_REQUIRED', 'Skill tool capability is outside the approved scope'); return this.tools.issueIntent({ toolId: input.toolId, skillId: scope.skillId, arguments: input.arguments, requestedCapabilities: input.requestedCapabilities ?? tool.capabilities, source: input.source ?? 'local', viaOrchestrator: input.source === 'external' }); }
  execute<O = unknown>(intent: ToolIntent): Promise<ToolResult<O>> { return this.executor.execute<O>(intent); }
}

export interface SkillLearningOptions { readonly minSuccessfulRuns?: number; readonly maxEvidence?: number; readonly registry: SkillPackageRegistry; readonly now?: () => Date; }
export class SkillLearningService {
  private readonly minSuccessfulRuns: number; private readonly maxEvidence: number; private readonly now: () => Date; private readonly registry: SkillPackageRegistry; private readonly history = new Map<string, SkillExperienceEvidence[]>();
  constructor(options: SkillLearningOptions) { this.minSuccessfulRuns = Math.max(2, Math.min(32, Math.trunc(options.minSuccessfulRuns ?? 3))); this.maxEvidence = Math.max(2, Math.min(128, Math.trunc(options.maxEvidence ?? 16))); this.now = options.now ?? (() => new Date()); this.registry = options.registry; }
  async observe(experience: SkillExperience): Promise<SkillCandidate | undefined> { validateExperience(experience); const fingerprint = procedureFingerprint(experience); const values = this.history.get(fingerprint) ?? []; values.push({ runId: experience.runId, procedureId: experience.procedureId, success: experience.success, toolIds: [...experience.toolIds], stepCount: experience.stepCount, occurredAt: experience.occurredAt ?? this.now().toISOString(), ...(experience.dataClass ? { dataClass: experience.dataClass } : {}) }); this.history.set(fingerprint, values.slice(-this.maxEvidence)); const successful = values.filter(value => value.success); if (!experience.success || successful.length < this.minSuccessfulRuns) return undefined; const existing = (await this.registry.candidatesList()).find(value => value.fingerprint === fingerprint && value.status !== 'rejected'); if (existing) return existing; const candidate: SkillCandidate = { version: 1, candidateId: randomId('skill-candidate'), title: (experience.title ?? `Reusable ${experience.procedureId}`).slice(0, 160), summary: (experience.summary ?? 'Repeated successful procedure detected').slice(0, 2_000), instructions: (experience.instructions ?? `Repeat the bounded procedure ${experience.procedureId} using only the declared tools.`).slice(0, SKILL_PACKAGE_MAX_INSTRUCTIONS), toolIds: [...new Set(experience.toolIds)].slice(0, 128), requiredCapabilities: [...new Set(experience.requiredCapabilities ?? [])], dataScopes: [...new Set(experience.dataScopes ?? [])], evidence: successful.slice(-this.maxEvidence), fingerprint, status: 'pending', createdAt: this.now().toISOString(), updatedAt: this.now().toISOString() }; return this.registry.createCandidate(candidate); }
  reject(candidateId: string): Promise<SkillCandidate> { return this.registry.rejectCandidate(candidateId); }
  async approve(candidateId: string, packageInput?: { readonly skillId?: string; readonly name?: string; readonly description?: string; readonly author?: SkillAuthorReference; readonly version?: string }): Promise<SkillReview> { const candidate = await this.registry.getCandidate(candidateId); if (!candidate) throw new SkillPackageError('NOT_FOUND', 'Skill candidate not found'); const packageId = packageInput?.skillId ?? `learned.${candidate.candidateId}`; const now = this.now().toISOString(); const manifestBase: Omit<SkillManifest, 'integrity'> = { formatVersion: 1, skillId: packageId, name: packageInput?.name ?? candidate.title, description: packageInput?.description ?? candidate.summary, author: packageInput?.author ?? { reference: 'local-learning' }, version: packageInput?.version ?? '0.1.0', entrypoint: 'instructions', instructions: candidate.instructions, tags: ['learned'], requiredTools: candidate.toolIds, requiredCapabilities: candidate.requiredCapabilities, optionalCapabilities: [], dataScopes: candidate.dataScopes, dependencies: [], compatibility: {}, createdAt: now, updatedAt: now }; const draft: SkillPackage = { version: 1, manifest: { ...manifestBase, integrity: { algorithm: 'sha256', contentHash: '', manifestHash: '' } }, source: { kind: 'local-file', reference: `learning:${candidate.candidateId}` }, untrusted: true }; const verifier = new SkillIntegrityVerifier(); const contentHash = await verifier.computeContentHash(draft); const manifestHash = await verifier.computeManifestHash({ ...draft.manifest, integrity: { algorithm: 'sha256', contentHash, manifestHash: '' } }); const pkg = { ...draft, manifest: { ...draft.manifest, integrity: { algorithm: 'sha256' as const, contentHash, manifestHash } } }; const review = await this.registry.prepareReview(pkg); await this.registry.createCandidate({ ...candidate, status: 'approved', updatedAt: now }); return review; }
  async installCandidate(candidateId: string, packageInput?: { readonly skillId?: string; readonly name?: string; readonly description?: string; readonly author?: SkillAuthorReference; readonly version?: string }, options: { readonly enabled?: boolean; readonly approvedCapabilities?: readonly ToolCapability[]; readonly approvedDataScopes?: readonly string[] } = {}): Promise<SkillInstallation> { const review = await this.approve(candidateId, packageInput); if (!review.canInstall) throw new SkillPackageError('EVALUATION_FAILED', review.evaluation.errors.join('; ')); const installation = await this.registry.install(review.package, { userApproved: true, enabled: options.enabled, approvedCapabilities: options.approvedCapabilities ?? review.package.manifest.requiredCapabilities, approvedDataScopes: options.approvedDataScopes ?? review.package.manifest.dataScopes }); return installation; }
}
export { SkillLearningService as ProceduralLearningService };

export interface SkillRevisionServiceOptions { readonly registry: SkillPackageRegistry; readonly evaluator?: SkillEvaluator; readonly now?: () => Date; }
export class SkillRevisionService {
  private readonly registry: SkillPackageRegistry; private readonly evaluator: SkillEvaluator; private readonly now: () => Date;
  constructor(options: SkillRevisionServiceOptions) { this.registry = options.registry; this.evaluator = options.evaluator ?? new SkillEvaluator(); this.now = options.now ?? (() => new Date()); }
  async propose(skillId: string, input: { readonly instructions?: string; readonly name?: string; readonly description?: string; readonly requiredTools?: readonly string[]; readonly requiredCapabilities?: readonly ToolCapability[]; readonly optionalCapabilities?: readonly ToolCapability[]; readonly dataScopes?: readonly string[]; readonly reason: string; readonly expectedBenefit: string }): Promise<SkillRevisionProposal> { const current = await this.registry.get(skillId); const installation = await this.registry.installation(skillId); const base = await this.registry.getRevision(skillId, installation?.revisionId); if (!current || !base || !installation) throw new SkillPackageError('NOT_FOUND', 'Installed Skill revision not found'); const manifest: SkillManifest = { ...current.manifest, ...(input.name ? { name: input.name } : {}), ...(input.description ? { description: input.description } : {}), ...(input.instructions !== undefined ? { instructions: input.instructions } : {}), ...(input.requiredTools ? { requiredTools: [...input.requiredTools] } : {}), ...(input.requiredCapabilities ? { requiredCapabilities: [...input.requiredCapabilities] } : {}), ...(input.optionalCapabilities ? { optionalCapabilities: [...input.optionalCapabilities] } : {}), ...(input.dataScopes ? { dataScopes: [...input.dataScopes] } : {}), version: incrementPatch(current.manifest.version), updatedAt: this.now().toISOString(), integrity: { algorithm: 'sha256', contentHash: '', manifestHash: '' } }; const draft: SkillPackage = { version: 1, manifest, source: { kind: 'local-file', reference: `revision:${skillId}` }, untrusted: true }; const verifier = new SkillIntegrityVerifier(); const contentHash = await verifier.computeContentHash(draft); const manifestHash = await verifier.computeManifestHash({ ...manifest, integrity: { algorithm: 'sha256', contentHash, manifestHash: '' } }); const pkg: SkillPackage = { ...draft, manifest: { ...manifest, integrity: { algorithm: 'sha256', contentHash, manifestHash } } }; const evaluation = this.evaluator.evaluate(pkg); const diff = revisionDiff(current.manifest, pkg.manifest, input.expectedBenefit); const proposal: SkillRevisionProposal = { version: 1, proposalId: randomId('skill-proposal'), skillId, baseRevisionId: base.revisionId, proposedRevision: { version: 1, revisionId: randomId('skill-revision'), skillId, packageVersion: pkg.manifest.version, package: pkg, verifiedAt: this.now().toISOString(), verified: evaluation.ok, source: pkg.source, createdAt: this.now().toISOString(), supersedes: base.revisionId }, reason: input.reason.slice(0, 2_000), diff, evaluation, status: 'pending', requiresPermissionReview: !sameCapabilities(diff.capabilitiesBefore, diff.capabilitiesAfter) || canonicalJson(diff.toolsBefore) !== canonicalJson(diff.toolsAfter) || canonicalJson(current.manifest.dataScopes) !== canonicalJson(pkg.manifest.dataScopes), createdAt: this.now().toISOString() }; return this.registry.saveProposal(proposal); }
  proposeRevision(skillId: string, input: Parameters<SkillRevisionService['propose']>[1]): Promise<SkillRevisionProposal> { return this.propose(skillId, input); }
  async accept(proposalId: string, options: { readonly userApproved?: boolean; readonly approvedCapabilities?: readonly ToolCapability[]; readonly approvedDataScopes?: readonly string[]; readonly enabled?: boolean } = {}): Promise<SkillInstallation> { const proposal = (await this.registry.proposalsList()).find(value => value.proposalId === proposalId); if (!proposal) throw new SkillPackageError('NOT_FOUND', 'Skill revision proposal not found'); if (proposal.status !== 'pending') throw new SkillPackageError('CONFLICT', 'Skill revision proposal is already reviewed'); if (options.userApproved !== true) throw new SkillPackageError('PERMISSION_REVIEW_REQUIRED', 'Skill revision acceptance requires explicit user review'); if (!proposal.evaluation.ok) throw new SkillPackageError('EVALUATION_FAILED', 'Skill revision evaluation failed'); const current = await this.registry.installation(proposal.skillId); const installation = await this.registry.update(proposal.proposedRevision.package, { userApproved: true, enabled: options.enabled ?? current?.enabled, approvedCapabilities: options.approvedCapabilities ?? current?.approvedCapabilities, approvedDataScopes: options.approvedDataScopes ?? current?.approvedDataScopes }); await this.registry.saveProposal({ ...proposal, status: 'accepted', reviewedAt: this.now().toISOString() }); return installation; }
  acceptProposal(proposalId: string, options?: Parameters<SkillRevisionService['accept']>[1]): Promise<SkillInstallation> { return this.accept(proposalId, options); }
  async reject(proposalId: string): Promise<SkillRevisionProposal> { const proposal = (await this.registry.proposalsList()).find(value => value.proposalId === proposalId); if (!proposal) throw new SkillPackageError('NOT_FOUND', 'Skill revision proposal not found'); const next = { ...proposal, status: 'rejected' as const, reviewedAt: this.now().toISOString() }; await this.registry.saveProposal(next); return next; }
}

function stripManifestIntegrity(manifest: SkillManifest): Omit<SkillManifest, 'integrity' | 'authorSignature'> { const { integrity: _integrity, authorSignature: _authorSignature, ...rest } = manifest; return rest; }
function validateSkillPackage(pkg: SkillPackage): void {
  if (!pkg || pkg.version !== 1 || !pkg.manifest) throw new SkillPackageError('INVALID_PACKAGE', 'Skill package version is invalid');
  const manifest = pkg.manifest;
  if (manifest.formatVersion !== 1 || !safeId(manifest.skillId) || !safeText(manifest.name, 256) || manifest.name.length === 0 || !safeText(manifest.description, 8_000) || manifest.description.length === 0 || !safeVersion(manifest.version) || !safeText(manifest.entrypoint, 160) || manifest.entrypoint.length === 0 || !safeText(manifest.instructions, SKILL_PACKAGE_MAX_INSTRUCTIONS) || manifest.instructions.length === 0) throw new SkillPackageError('INVALID_MANIFEST', 'Skill manifest fields are invalid');
  if (!manifest.author || typeof manifest.author !== 'object' || (!manifest.author.identityId && !manifest.author.reference && !manifest.author.displayName)) throw new SkillPackageError('INVALID_MANIFEST', 'Skill author reference is required');
  if (manifest.author.identityId !== undefined && !safeText(manifest.author.identityId, 512)) throw new SkillPackageError('INVALID_MANIFEST', 'Skill author identity is invalid');
  if (manifest.author.reference !== undefined && !safeText(manifest.author.reference, 2_000)) throw new SkillPackageError('INVALID_MANIFEST', 'Skill author reference is invalid');
  if (manifest.author.displayName !== undefined && !safeText(manifest.author.displayName, 256)) throw new SkillPackageError('INVALID_MANIFEST', 'Skill author display name is invalid');
  if (!Array.isArray(manifest.tags) || manifest.tags.length > SKILL_PACKAGE_MAX_TAGS || manifest.tags.some(tag => !safeText(tag, 80) || tag.length === 0)) throw new SkillPackageError('INVALID_MANIFEST', 'Skill tags are invalid');
  if (!Array.isArray(manifest.requiredTools) || !Array.isArray(manifest.requiredCapabilities) || !Array.isArray(manifest.optionalCapabilities) || !Array.isArray(manifest.dataScopes) || !Array.isArray(manifest.dependencies)) throw new SkillPackageError('INVALID_MANIFEST', 'Skill dependency/capability fields are invalid');
  if (!manifest.integrity || manifest.integrity.algorithm !== 'sha256' || !/^[a-f0-9]{64}$/i.test(manifest.integrity.contentHash) || !/^[a-f0-9]{64}$/i.test(manifest.integrity.manifestHash)) throw new SkillPackageError('INVALID_MANIFEST', 'Skill integrity metadata is invalid');
  if (manifest.dependencies.length > SKILL_PACKAGE_MAX_DEPENDENCIES || manifest.dependencies.some(dependency => !isSafeId(dependency.id) || !['skill', 'tool', 'capability', 'host', 'keystone', 'plugin'].includes(dependency.kind)) || manifest.requiredTools.some(value => !isSafeId(value)) || [...manifest.requiredCapabilities, ...manifest.optionalCapabilities].some(value => !isToolCapability(value)) || manifest.dataScopes.some(value => !safeText(value, 160) || value.length === 0)) throw new SkillPackageError('INVALID_MANIFEST', 'Skill tool/capability fields are invalid');
  if (pkg.files) {
    const totalBytes = pkg.files.reduce((sum, file) => sum + (typeof file.content === 'string' ? file.content.length : Number.MAX_SAFE_INTEGER), 0);
    if (pkg.files.length > SKILL_PACKAGE_MAX_FILES || totalBytes > 2 * 1024 * 1024 || pkg.files.some(file => !safeText(file.path, 240) || file.path.length === 0 || !safeText(file.content, SKILL_PACKAGE_MAX_INSTRUCTIONS))) throw new SkillPackageError('BOUNDS_EXCEEDED', 'Skill package files exceed bounds');
  }
  if (!pkg.source || !['builtin', 'local', 'local-file', 'file-object', 'url', 'p2p', 'imported'].includes(pkg.source.kind) || !safeText(pkg.source.reference, 2_000) || pkg.source.reference.length === 0) throw new SkillPackageError('INVALID_PACKAGE', 'Skill source is invalid');
}
function normalizeSkillPackage(value: Record<string, unknown>, source: SkillSource): SkillPackage { const manifestValue = isRecord(value.manifest) ? value.manifest : value; const manifest = normalizeManifest(manifestValue); const rawIntegrity = isRecord(manifestValue.integrity) ? manifestValue.integrity : undefined; const integrity = rawIntegrity && rawIntegrity.algorithm === 'sha256' && typeof rawIntegrity.contentHash === 'string' && typeof rawIntegrity.manifestHash === 'string' ? { algorithm: 'sha256' as const, contentHash: rawIntegrity.contentHash, manifestHash: rawIntegrity.manifestHash } : manifest.integrity; const signature = isRecord(manifestValue.authorSignature) && typeof manifestValue.authorSignature.value === 'string' && (manifestValue.authorSignature.algorithm === 'ed25519' || manifestValue.authorSignature.algorithm === 'identity') ? { algorithm: manifestValue.authorSignature.algorithm, value: manifestValue.authorSignature.value, ...(typeof manifestValue.authorSignature.publicKey === 'string' ? { publicKey: manifestValue.authorSignature.publicKey } : {}) } as SkillAuthorSignature : manifest.authorSignature; return { version: 1, manifest: { ...manifest, integrity, ...(signature ? { authorSignature: signature } : {}) }, source, files: Array.isArray(value.files) ? value.files as SkillPackageFile[] : undefined, tests: Array.isArray(value.tests) ? value.tests as SkillDeclarativeTest[] : undefined, untrusted: value.untrusted === true || source.kind === 'imported' }; }
function normalizeCompatibleSkill(value: unknown, source: SkillSource): SkillPackage { if (!isRecord(value)) throw new SkillPackageError('INVALID_PACKAGE', 'Imported Skill format must be an object'); const id = String(value.skillId ?? value.id ?? value.name ?? ''); const instructions = String(value.instructions ?? value.content ?? value.prompt ?? ''); const now = new Date().toISOString(); const author = isRecord(value.author) ? { ...(typeof value.author.identityId === 'string' ? { identityId: value.author.identityId } : {}), ...(typeof value.author.reference === 'string' ? { reference: value.author.reference } : {}), ...(typeof value.author.displayName === 'string' ? { displayName: value.author.displayName } : {}) } : typeof value.author === 'string' && value.author.trim() ? { displayName: value.author } : { reference: 'imported-unknown' }; const manifestBase: Omit<SkillManifest, 'integrity'> = { formatVersion: 1, skillId: id, name: String(value.name ?? id), description: String(value.description ?? 'Imported Skill instructions'), author, version: String(value.version ?? value.packageVersion ?? '0.1.0'), entrypoint: String(value.entrypoint ?? 'instructions'), instructions, tags: arrayOfStrings(value.tags), requiredTools: arrayOfStrings(value.requiredTools ?? value.toolIds ?? value.tools), requiredCapabilities: arrayOfCapabilities(value.requiredCapabilities ?? value.declaredCapabilities), optionalCapabilities: arrayOfCapabilities(value.optionalCapabilities), dataScopes: arrayOfStrings(value.dataScopes), dependencies: normalizeDependencies(value.dependencies), compatibility: isRecord(value.compatibility) ? value.compatibility as SkillCompatibility : {}, createdAt: typeof value.createdAt === 'string' ? value.createdAt : now, updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : now }; const draft: SkillPackage = { version: 1, manifest: { ...manifestBase, integrity: { algorithm: 'sha256', contentHash: '', manifestHash: '' } }, source, untrusted: true }; return draft; }
function requiresSkillSurface(pkg: SkillPackage): boolean { return pkg.untrusted === true || pkg.source.kind === 'p2p' || pkg.source.kind === 'url' || pkg.source.kind === 'imported' || pkg.source.kind === 'file-object'; }
function normalizeManifest(value: Record<string, unknown>): SkillManifest { const source = normalizeCompatibleSkill(value, { kind: 'local-file', reference: 'normalized' }); return source.manifest; }
function normalizeDependencies(value: unknown): SkillDependency[] { if (!Array.isArray(value)) return []; return value.filter(isRecord).map(item => ({ id: String(item.id ?? ''), kind: (['skill', 'tool', 'capability', 'host', 'keystone', 'plugin'].includes(String(item.kind)) ? String(item.kind) : 'skill') as SkillDependencyKind, ...(typeof item.versionRange === 'string' ? { versionRange: item.versionRange } : {}), ...(item.optional === true ? { optional: true } : {}), ...(typeof item.description === 'string' ? { description: item.description.slice(0, 512) } : {}) })); }
function arrayOfStrings(value: unknown): string[] { return Array.isArray(value) ? value.filter(item => typeof item === 'string').map(item => item.slice(0, 256)) : []; }
function arrayOfCapabilities(value: unknown): ToolCapability[] { return arrayOfStrings(value).filter(isToolCapability); }
function isToolCapability(value: unknown): value is ToolCapability { return ['READ_PRIVATE', 'WRITE_PRIVATE', 'NETWORK_SEND', 'DEVICE_ACTION', 'DESTRUCTIVE', 'SECURITY_SENSITIVE'].includes(String(value)); }
function isSkillPackage(value: unknown): value is SkillPackage { try { validateSkillPackage(value as SkillPackage); return true; } catch { return false; } }
function isSkillRevision(value: unknown): value is SkillRevision { return Boolean(isRecord(value) && value.version === 1 && typeof value.revisionId === 'string' && typeof value.skillId === 'string' && isSkillPackage(value.package)); }
function isSkillInstallation(value: unknown): value is SkillInstallation { return Boolean(isRecord(value) && value.version === 1 && typeof value.skillId === 'string' && typeof value.revisionId === 'string' && typeof value.packageVersion === 'string' && typeof value.enabled === 'boolean' && Array.isArray(value.approvedCapabilities)); }
function isSkillCandidate(value: unknown): value is SkillCandidate { return Boolean(isRecord(value) && value.version === 1 && typeof value.candidateId === 'string' && typeof value.title === 'string' && typeof value.instructions === 'string' && Array.isArray(value.evidence)); }
function isSkillProposal(value: unknown): value is SkillRevisionProposal { return Boolean(isRecord(value) && value.version === 1 && typeof value.proposalId === 'string' && typeof value.skillId === 'string' && isSkillRevision(value.proposedRevision)); }
function validateCandidate(value: SkillCandidate): void { if (value.version !== 1 || !safeId(value.candidateId) || !safeText(value.title, 160) || !safeText(value.instructions, SKILL_PACKAGE_MAX_INSTRUCTIONS) || value.evidence.length > 128) throw new SkillPackageError('INVALID_PACKAGE', 'Skill candidate is invalid'); }
function validateExperience(value: SkillExperience): void { if (!safeText(value.runId, 256) || !safeText(value.procedureId, 256) || !Number.isSafeInteger(value.stepCount) || value.stepCount < 1 || value.stepCount > 512 || !Array.isArray(value.toolIds) || value.toolIds.length > 128) throw new SkillPackageError('INVALID_PACKAGE', 'Skill experience is invalid'); }
function procedureFingerprint(value: SkillExperience): string { return canonicalJson({ procedureId: value.procedureId, toolIds: [...new Set(value.toolIds)].sort(), stepCount: value.stepCount, requiredCapabilities: [...new Set(value.requiredCapabilities ?? [])].sort(), dataScopes: [...new Set(value.dataScopes ?? [])].sort() }); }
function revisionDiff(before: SkillManifest, after: SkillManifest, benefit: string): SkillRevisionDiff { const changed: string[] = []; if (before.name !== after.name) changed.push('name'); if (before.description !== after.description) changed.push('description'); if (before.instructions !== after.instructions) changed.push('instructions'); if (canonicalJson(before.requiredTools) !== canonicalJson(after.requiredTools)) changed.push('requiredTools'); if (canonicalJson(before.requiredCapabilities) !== canonicalJson(after.requiredCapabilities)) changed.push('requiredCapabilities'); if (canonicalJson(before.optionalCapabilities) !== canonicalJson(after.optionalCapabilities)) changed.push('optionalCapabilities'); if (canonicalJson(before.dataScopes) !== canonicalJson(after.dataScopes)) changed.push('dataScopes'); return { changed, capabilitiesBefore: [...before.requiredCapabilities, ...before.optionalCapabilities], capabilitiesAfter: [...after.requiredCapabilities, ...after.optionalCapabilities], toolsBefore: [...before.requiredTools], toolsAfter: [...after.requiredTools], dataScopesBefore: [...before.dataScopes], dataScopesAfter: [...after.dataScopes], expectedBenefit: benefit.slice(0, 2_000) }; }
function sameCapabilities(left: readonly ToolCapability[], right: readonly ToolCapability[]): boolean { return left.length === right.length && left.every(value => right.includes(value)); }
function scoreSkill(entry: SkillIndexEntry, query: string): number { if (!query) return 1; const haystack = `${entry.name} ${entry.description} ${entry.tags.join(' ')} ${entry.requiredTools.join(' ')}`.toLocaleLowerCase(); if (haystack === query) return 100; if (haystack.includes(query)) return 40 + query.length / Math.max(1, haystack.length); let cursor = 0; let score = 0; for (const char of query) { const position = haystack.indexOf(char, cursor); if (position < 0) return 0; score += position === cursor ? 3 : 1; cursor = position + 1; } return score / Math.max(1, haystack.length); }
function satisfiesVersion(version: string, range: string): boolean { const current = parseVersion(version); const value = range.trim(); if (!value || value === '*' || value === 'latest') return true; const match = /^(\^|~|>=|<=|>|<|=)?\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(value); if (!match) return false; const target = [Number(match[2]), Number(match[3] ?? 0), Number(match[4] ?? 0)]; const compare = compareVersion(current, target); switch (match[1]) { case '^': return current[0] === target[0] && compare >= 0; case '~': return current[0] === target[0] && current[1] === target[1] && compare >= 0; case '>=': return compare >= 0; case '<=': return compare <= 0; case '>': return compare > 0; case '<': return compare < 0; default: return compare === 0; } }
function incrementPatch(value: string): string { const parsed = parseVersion(value); return `${parsed[0]}.${parsed[1]}.${parsed[2] + 1}`; }
function parseVersion(value: string): [number, number, number] { const match = /^(\d+)\.(\d+)\.(\d+)/.exec(value); return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : [0, 0, 0]; }
function compareVersion(left: readonly number[], right: readonly number[]): number { for (let index = 0; index < 3; index += 1) if ((left[index] ?? 0) !== (right[index] ?? 0)) return (left[index] ?? 0) - (right[index] ?? 0); return 0; }
function isSafeId(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value); }
function safeId(value: string): string { if (!isSafeId(value)) throw new SkillPackageError('INVALID_MANIFEST', 'Skill identifier is invalid'); return value; }
function safeVersion(value: string): boolean { return typeof value === 'string' && /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(value); }
function safeText(value: string, max: number): boolean { return typeof value === 'string' && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value); }
function containsAll<T>(haystack: readonly T[], needles: readonly T[]): boolean { return needles.every(value => haystack.includes(value)); }
function clone<T>(value: T): T { return structuredClone(value); }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }
function randomId(prefix: string): string { const uuid = globalThis.crypto?.randomUUID?.(); if (!uuid) throw new Error('Secure randomness is unavailable'); return `${prefix}-${uuid}`; }
function estimateTokens(value: unknown): number { return Math.max(1, Math.ceil((typeof value === 'string' ? value : JSON.stringify(value)).length / 4)); }
function clamp(value: number, min: number, max: number): number { return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.trunc(value))) : min; }
