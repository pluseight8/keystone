import { describe, expect, it } from 'vitest';
import {
  MandatorySafetySurfaceRegistry,
  PROTECTED_SURFACES,
  PROTECTED_SURFACE_MANIFEST,
} from './safety-surfaces.js';
import { SafetyRuntime, SafetySurfaceGate, type SafetyEvaluationRequest } from './content-safety.js';

const safeRequest = (surface: string, objectId = `object-${surface}`): SafetyEvaluationRequest<{ title: string }> => ({
  objectId,
  domain: 'PUBLIC',
  sourceType: 'discovery',
  value: { title: `safe ${surface}` },
  content: { title: `safe ${surface}` },
  text: `safe ${surface}`,
  verified: true,
  authorized: true,
  sharing: true,
});

describe('mandatory SafetySurfaceGate wiring', () => {
  it('enumerates every registered protected surface and exposes a mandatory gate adapter', () => {
    const registry = new MandatorySafetySurfaceRegistry(new SafetySurfaceGate(new SafetyRuntime()));
    expect(registry.allSurfacesHaveMandatoryGate()).toBe(true);
    for (const surface of PROTECTED_SURFACES) expect(registry.adapter(surface).surface).toBe(surface);
  });

  it('declares every protected surface as mandatory and token-only', () => {
    expect(PROTECTED_SURFACE_MANIFEST).toHaveLength(PROTECTED_SURFACES.length);
    expect(PROTECTED_SURFACE_MANIFEST.every(value => value.requiresSafety && value.accepts === 'SurfaceEligibleObject' && value.missingGate === 'FAIL_CLOSED')).toBe(true);
  });

  it('fails closed when the host has no safety adapter', async () => {
    const registry = new MandatorySafetySurfaceRegistry(undefined);
    for (const surface of PROTECTED_SURFACES) {
      expect(registry.hasMandatoryGate(surface)).toBe(false);
      expect(await registry.evaluate(surface, safeRequest(surface))).toBeUndefined();
      expect(await registry.accept(surface, { kind: 'RawIncomingObject' })).toBeUndefined();
    }
  });

  it('rejects raw, verified and authorized values at every protected boundary', async () => {
    const registry = new MandatorySafetySurfaceRegistry(new SafetySurfaceGate(new SafetyRuntime()));
    const raw = { kind: 'RawIncomingObject', objectId: 'raw', contentHash: 'hash', domain: 'PUBLIC', value: 'raw', receivedAt: new Date().toISOString() };
    const verified = { ...raw, kind: 'VerifiedObject', verifiedBy: 'SIGNATURE' };
    const authorized = { ...verified, kind: 'AuthorizedObject', authorizationScope: 'surface' };
    for (const surface of PROTECTED_SURFACES) {
      const adapter = registry.adapter(surface);
      expect(await adapter.display(raw as never)).toBeUndefined();
      expect(await adapter.display(verified as never)).toBeUndefined();
      expect(await adapter.display(authorized as never)).toBeUndefined();
      expect(await adapter.index(raw as never)).toBe(false);
    }
  });

  it('rejects cached tokens bound to another hash, domain or policy version', async () => {
    const first = new SafetyRuntime({ classifierVersion: 'surface-test-1' });
    const eligible = await first.toSurfaceEligible(await first.preflightShare(safeRequest('HOME', 'cached')));
    const second = new SafetyRuntime({ classifierVersion: 'surface-test-2' });
    const registry = new MandatorySafetySurfaceRegistry(new SafetySurfaceGate(second));
    expect(await registry.accept('HOME', eligible)).toBeUndefined();
    expect(await registry.accept('HOME', { ...eligible, contentHash: 'changed' })).toBeUndefined();
    expect(await registry.accept('HOME', { ...eligible, domain: 'COMMUNITY' })).toBeUndefined();
  });

  it('keeps owner-local content available without sending it through a shared gate', async () => {
    const runtime = new SafetyRuntime();
    const local = await runtime.evaluate({ objectId: 'private-note', domain: 'PRIVATE_SELF', content: 'private owner note', text: 'private owner note' });
    expect(local.decision).toBe('ALLOW');
    expect(runtime.personalCopy('private-note')).toBe('private owner note');
    const registry = new MandatorySafetySurfaceRegistry(new SafetySurfaceGate(runtime));
    expect(await registry.evaluate('HOME', { objectId: 'private-note', domain: 'PRIVATE_SELF', content: 'private owner note', text: 'private owner note' })).toBeUndefined();
  });

  it('works without a generative local AI adapter for all protected surfaces', async () => {
    const runtime = new SafetyRuntime();
    const registry = new MandatorySafetySurfaceRegistry(new SafetySurfaceGate(runtime));
    for (const surface of PROTECTED_SURFACES) {
      const eligible = await registry.evaluate(surface, safeRequest(surface));
      expect(eligible?.kind).toBe('SurfaceEligibleObject');
      expect(await registry.store(surface, eligible!)).toBe(true);
      expect(registry.values(surface)).toHaveLength(1);
    }
    expect(runtime.metrics().localAIEscalations).toBe(0);
  });

  it('does not trust a malicious peer that labels blocked content SAFE', async () => {
    const runtime = new SafetyRuntime();
    const registry = new MandatorySafetySurfaceRegistry(new SafetySurfaceGate(runtime));
    const request: SafetyEvaluationRequest = {
      objectId: 'malicious-safe', domain: 'PUBLIC', sourceType: 'chat',
      content: 'explicit nude sexual content', text: 'explicit nude sexual content',
      senderAttestation: { contentHash: 'attacker-hash', labels: [], classifierVersion: 'attacker', policyVersion: 'attacker', timestamp: new Date().toISOString(), signature: 'attacker-safe' },
      verified: true, authorized: true, sharing: true,
    };
    expect(await registry.evaluate('DIRECT_CHAT', request)).toBeUndefined();
    expect(await registry.evaluate('COMMUNITIES', request)).toBeUndefined();
    expect(await registry.evaluate('VIDEO', request)).toBeUndefined();
  });
});
