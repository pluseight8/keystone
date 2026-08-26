import { describe, expect, it } from 'vitest';
import { SodiumCryptoProvider } from '../crypto.js';
import { AISettingsService } from '../ai/privacy.js';
import { InMemorySettingsStorage, SettingsService } from './settings.js';
import { OwnerAuthorityService, PluginSettingsBoundary, type SettingsMutationIntent } from './owner-authority.js';

async function authorities() {
  const crypto = new SodiumCryptoProvider(); const keys = await crypto.generateIdentity();
  const base = { ownerIdentityId: keys.publicKey, ownerPublicKey: keys.publicKey, deviceId: 'device-a', sessionId: 'session-a', crypto, ownerPrivateKey: keys.privateKey, requestLifetimeMs: 60_000 };
  const owner = new OwnerAuthorityService(base); const verifier = new OwnerAuthorityService({ ...base, ownerPrivateKey: undefined });
  return { crypto, owner, verifier };
}

function mutation(path: string, actor: SettingsMutationIntent['actor'], ownerRequestId?: string, extra: Partial<SettingsMutationIntent> = {}): SettingsMutationIntent {
  return { version: 1, kind: 'settings_mutation_intent', mutationId: `mutation:${path}:${actor}`, actor, actorId: actor === 'OWNER' ? 'owner' : 'agent-a', ...(ownerRequestId ? { ownerRequestId } : {}), path, action: 'set', value: true, createdAt: new Date().toISOString(), ...extra };
}

describe('OwnerAuthorityService', () => {
  it('requires a fresh signed owner request for AI settings changes', async () => {
    const { owner, verifier } = await authorities(); const request = await owner.createOwnerRequest({ sourceInteraction: 'Change the assistant language', requested: [{ path: 'appearance.language', value: 'ru', action: 'set' }] });
    expect(await verifier.acceptOwnerRequest(request)).toBe(true);
    const allowed = await verifier.authorizeMutation(mutation('appearance.language', 'LOCAL_AI', request.requestId, { value: 'ru' }));
    expect(allowed.allowed).toBe(true); expect(allowed.decision).toBe('ALLOW');
    const missing = await verifier.authorizeMutation(mutation('appearance.theme', 'LOCAL_AI'));
    expect(missing.allowed).toBe(false); expect(missing.decision).toBe('DENY');
  });

  it('requires preview for privacy and double confirmation for security', async () => {
    const { owner } = await authorities(); const privacyRequest = await owner.createOwnerRequest({ sourceInteraction: 'Adjust privacy', requested: [{ path: 'privacy.presence', value: false }] });
    const preview = await owner.authorizeMutation(mutation('privacy.presence', 'LOCAL_AI', privacyRequest.requestId, { value: false }));
    expect(preview.decision).toBe('PREVIEW_REQUIRED');
    const privacyAllowed = await owner.authorizeMutation(mutation('privacy.presence', 'LOCAL_AI', privacyRequest.requestId, { value: false }), { confirmed: true });
    expect(privacyAllowed.allowed).toBe(true);
    const securityRequest = await owner.createOwnerRequest({ sourceInteraction: 'Revoke device', requested: [{ path: 'devices.device-b', action: 'revoke' }] });
    const one = await owner.authorizeMutation(mutation('devices.device-b', 'LOCAL_AI', securityRequest.requestId, { action: 'revoke', value: undefined }));
    expect(one.allowed).toBe(false); expect(one.confirmation).toBe('DOUBLE_CONFIRM');
    const two = await owner.authorizeMutation(mutation('devices.device-b', 'LOCAL_AI', securityRequest.requestId, { action: 'revoke', value: undefined }), { confirmed: true, doubleConfirmed: true });
    expect(two.allowed).toBe(true);
  });

  it('always denies immutable policy and remote agents', async () => {
    const { owner } = await authorities();
    const immutable = await owner.authorizeMutation(mutation('immutable.mandatoryPolicy', 'OWNER'));
    expect(immutable.allowed).toBe(false); expect(immutable.decision).toBe('DENY'); expect(immutable.confirmation).toBe('ALWAYS_DENY');
    const remote = await owner.authorizeMutation(mutation('appearance.language', 'REMOTE_AGENT'));
    expect(remote.allowed).toBe(false); expect(remote.reason).toMatch(/remote agents/i);
  });

  it('enforces skill and plugin capability/namespace boundaries', async () => {
    const { owner } = await authorities(); const request = await owner.createOwnerRequest({ sourceInteraction: 'Allow a bounded plugin preference', requested: [{ path: 'plugin.calendar.defaultView', value: 'week' }] });
    const plugin = new PluginSettingsBoundary(owner);
    const denied = await plugin.authorize(mutation('plugin.calendar.defaultView', 'PLUGIN', request.requestId, { value: 'week' }), { pluginId: 'calendar', namespace: 'plugin.calendar', canWrite: false, expiresAt: new Date(Date.now() + 10_000).toISOString() });
    expect(denied.allowed).toBe(false);
    const allowed = await plugin.authorize(mutation('plugin.calendar.defaultView', 'PLUGIN', request.requestId, { value: 'week' }), { pluginId: 'calendar', namespace: 'plugin.calendar', canWrite: true, expiresAt: new Date(Date.now() + 10_000).toISOString() }, { confirmed: true });
    expect(allowed.allowed).toBe(true);
    const skill = await owner.authorizeMutation(mutation('appearance.language', 'SKILL', request.requestId, { capability: undefined, value: 'week' }));
    expect(skill.allowed).toBe(false);
  });

  it('rejects replayed/wrong-signature owner requests and expires old requests', async () => {
    const { owner, verifier, crypto } = await authorities(); const request = await owner.createOwnerRequest({ sourceInteraction: 'Set language', requested: [{ path: 'appearance.language', value: 'ru' }] });
    expect(await verifier.acceptOwnerRequest(request)).toBe(true); expect(await verifier.acceptOwnerRequest(request)).toBe(false);
    const forged = { ...request, requestId: 'forged', signature: await crypto.sign('wrong', (await crypto.generateIdentity()).privateKey) };
    expect(await verifier.acceptOwnerRequest(forged)).toBe(false);
    const expired = await owner.createOwnerRequest({ sourceInteraction: 'Set language', requested: [{ path: 'appearance.language', value: 'ru' }], expiresAt: new Date(Date.now() + 1_000).toISOString() });
    await new Promise(resolve => setTimeout(resolve, 1_100));
    const stale = await owner.authorizeMutation(mutation('appearance.language', 'LOCAL_AI', expired.requestId, { value: 'ru' }));
    expect(stale.allowed).toBe(false); expect(stale.decision).toBe('STALE_REQUEST');
  });

  it('connects authority to settings adapters instead of allowing AI bypasses', async () => {
    const { owner } = await authorities(); const request = await owner.createOwnerRequest({ sourceInteraction: 'Switch language', requested: [{ path: 'appearance.language', value: 'ru' }] });
    const settings = new SettingsService(new InMemorySettingsStorage());
    await settings.updateByAuthority({ appearance: { language: 'ru' } }, { authority: owner, intent: mutation('appearance.language', 'LOCAL_AI', request.requestId, { value: 'ru' }) });
    expect(settings.snapshot().appearance.language).toBe('ru');
    const ai = new AISettingsService(); await expect(ai.updateByAuthority({ remoteEnabled: false }, { authority: owner, intent: mutation('ai.remoteEnabled', 'REMOTE_AGENT', request.requestId, { value: false }) })).rejects.toThrow();
  });
});
