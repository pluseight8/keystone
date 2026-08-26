import { describe, expect, it } from 'vitest';
import {
  BehaviorSafetyService,
  InMemoryBehaviorStateStore,
  InMemoryInteractionPolicyStore,
  InMemorySafetyCacheStateStore,
  InMemorySafetyPolicyStateStore,
  InteractionSafetyPolicy,
  MandatorySafetyPolicy,
  SafetyCache,
  SafetyPolicyController,
  SafetyRuntime,
  SafetySurfaceIndex,
  type SafetyDecisionToken,
} from './content-safety.js';

describe('Phase 56 Content Safety Runtime', () => {
  it('keeps private copies while blocking a shared/public transition', async () => {
    const runtime = new SafetyRuntime();
    const personal = await runtime.evaluate({ objectId: 'note-1', domain: 'PRIVATE_SELF', content: 'historical war note', text: 'historical war note' });
    expect(personal.decision).toBe('ALLOW');
    const shared = await runtime.preflightShare({ objectId: 'note-1', domain: 'PUBLIC', content: 'explicit nude video', text: 'explicit nude video' });
    expect(shared.decision).toMatch(/BLOCK|HIDE|QUARANTINE|REVIEW/);
    expect(runtime.personalCopy('note-1')).toBe('historical war note');
  });

  it('does not trust a sender SAFE attestation and protects a typed surface', async () => {
    const runtime = new SafetyRuntime();
    const evaluated = await runtime.evaluate({ objectId: 'mallory-object', domain: 'PUBLIC', content: 'explicit nude', text: 'explicit nude', senderAttestation: { contentHash: 'wrong', labels: [], classifierVersion: 'attacker', policyVersion: 'fake', timestamp: new Date().toISOString(), signature: 'fake' } });
    expect(evaluated.decision).not.toBe('ALLOW');
    const surface = new SafetySurfaceIndex();
    expect(await surface.add(evaluated as never)).toBe(false);
  });

  it('allows deterministic safe text without generative AI and exposes local status', async () => {
    const runtime = new SafetyRuntime();
    const value = await runtime.preflightShare({ objectId: 'safe-1', domain: 'PUBLIC', content: 'A short project update', text: 'A short project update' });
    expect(value.decision).toBe('ALLOW');
    expect(value.token).toBeDefined();
    expect(runtime.status()).toMatch(/LIMITED|LOCAL_AI_RECOMMENDED/);
    expect(runtime.metrics().localAIEscalations).toBe(0);
    const eligible = await runtime.toSurfaceEligible(value);
    expect(await new SafetySurfaceIndex().add(eligible)).toBe(true);
  });

  it('invalidates a decision token when bytes, policy or classifier version changes', async () => {
    const cache = new SafetyCache({ store: new InMemorySafetyCacheStateStore() });
    const first = new SafetyRuntime({ cache, classifierVersion: 'rules-1' });
    const result = await first.preflightShare({ objectId: 'hash-1', domain: 'PUBLIC', content: 'safe text', text: 'safe text' });
    expect(await first.validateToken(result.token!, { objectId: 'hash-1', contentHash: result.contentHash, domain: 'PUBLIC' })).toBe(true);
    expect(await first.validateToken(result.token!, { objectId: 'hash-1', contentHash: 'changed', domain: 'PUBLIC' })).toBe(false);
    const second = new SafetyRuntime({ cache, mandatoryPolicy: new MandatorySafetyPolicy({ version: 'rules-policy-2' }), classifierVersion: 'rules-1' });
    expect(await second.validateToken(result.token!, { objectId: 'hash-1', contentHash: result.contentHash, domain: 'PUBLIC' })).toBe(false);
  });

  it('requires an explicit owner intent for stricter preferences and cannot weaken mandatory rules', () => {
    const controller = new SafetyPolicyController();
    expect(() => controller.applyPreferences({ stricterCategories: ['POLITICAL_CONTENT'] }, { version: 1, explicitOwnerRequest: true, source: 'OWNER', requestId: 'owner-1', requestedAt: new Date().toISOString(), fields: ['stricterCategories'] })).not.toThrow();
    expect(() => controller.applyPreferences({ hideUncertain: false }, { version: 1, explicitOwnerRequest: true, source: 'OWNER', requestId: 'owner-2', requestedAt: new Date().toISOString(), fields: ['hideUncertain'] })).not.toThrow();
    expect(controller.mandatory.configurationClass).toBe('MANDATORY');
    expect(() => controller.applyPreferences({ restrictedDomains: ['PUBLIC'] }, { version: 1, explicitOwnerRequest: true, source: 'REMOTE_AGENT' as never, requestId: 'bad', requestedAt: new Date().toISOString(), fields: ['restrictedDomains'] })).toThrow();
  });

  it('restores owner safety preferences without restoring or weakening mandatory policy', async () => {
    const store = new InMemorySafetyPolicyStateStore();
    const first = new SafetyPolicyController(new MandatorySafetyPolicy(), undefined, store);
    await first.ready();
    first.applyPreferences({ stricterCategories: ['DISTURBING_CONTENT'], restrictedDomains: ['DISCOVERY'] }, { version: 1, explicitOwnerRequest: true, source: 'OWNER', requestId: 'persist-owner', requestedAt: new Date().toISOString(), fields: ['stricterCategories', 'restrictedDomains'] });
    await new Promise(resolve => setTimeout(resolve, 0));
    const restored = new SafetyPolicyController(new MandatorySafetyPolicy(), undefined, store); await restored.ready();
    expect(restored.preferencesSnapshot().stricterCategories).toContain('DISTURBING_CONTENT');
    expect(restored.preferencesSnapshot().restrictedDomains).toContain('DISCOVERY');
    expect(restored.mandatory.configurationClass).toBe('MANDATORY');
  });

  it('persists recipient-local block, mute and behavior protections', async () => {
    const policyStore = new InMemoryInteractionPolicyStore();
    const policy = new InteractionSafetyPolicy({ store: policyStore });
    await policy.block('peer-mallory'); await policy.mute('peer-muted');
    expect(policy.canInteract({ peer: 'peer-mallory', kind: 'dm' })).toBe(false);
    expect(policy.allowsDiscovery('peer-mallory')).toBe(false);
    expect(policy.allowsNotification('peer-muted')).toBe(false);
    const restored = new InteractionSafetyPolicy({ store: policyStore }); await restored.ready();
    expect(restored.isBlocked('peer-mallory')).toBe(true);
    const behavior = new BehaviorSafetyService({ store: new InMemoryBehaviorStateStore() });
    await behavior.observe({ peer: 'peer-mallory', kind: 'dm', afterBlock: true });
    expect(behavior.snapshot('peer-mallory').state).toMatch(/BLOCK_EVASION|SEVERE_RESTRICTION/);
  });

  it('fails closed for malformed or unverified shared input without granting permissions', async () => {
    const runtime = new SafetyRuntime();
    const malformed = await runtime.evaluate({ domain: 'INVALID_DOMAIN' as never, objectId: 'bad', content: 'x' });
    expect(malformed.decision).toBe('CLASSIFICATION_FAILED');
    const unverified = await runtime.evaluate({ objectId: 'unverified', domain: 'PUBLIC', content: 'safe text', text: 'safe text', verified: false, authorized: false });
    expect(unverified.decision).not.toBe('ALLOW');
    expect((unverified as unknown as { permissions?: unknown }).permissions).toBeUndefined();
  });

  it('rejects forged and stale token shapes at the protected surface boundary', async () => {
    const runtime = new SafetyRuntime(); const value = await runtime.preflightShare({ objectId: 'safe-shape', domain: 'PUBLIC', content: 'safe', text: 'safe' });
    const forged: SafetyDecisionToken = { ...value.token!, decision: 'ALLOW', integrity: 'forged' };
    expect(await runtime.validateToken(forged, { objectId: value.objectId, contentHash: value.contentHash, domain: value.domain })).toBe(false);
    const index = new SafetySurfaceIndex(); expect(await index.add({ ...value, kind: 'SurfaceEligibleObject', decision: 'ALLOW', token: forged } as never)).toBe(false);
  });

  it('applies the same boundary to arbitrary fixture identities and domains', async () => {
    const runtime = new SafetyRuntime();
    const identities = ['id-a', 'id-b', 'id-c', 'id-d', 'id-e', 'id-f'];
    const domains = ['DIRECT_SHARED', 'GROUP_SHARED', 'SHARED_SPACE', 'COMMUNITY', 'PUBLIC', 'DISCOVERY'] as const;
    const results = await Promise.all(identities.map((identity, index) => runtime.preflightShare({ objectId: `${identity}-object`, domain: domains[index]!, content: `safe message from ${identity}`, text: `safe message from ${identity}` })));
    expect(results.every(result => result.token && result.objectId.endsWith('-object'))).toBe(true);
    expect(new Set(results.map(result => result.contentHash)).size).toBe(identities.length);
  });
});
