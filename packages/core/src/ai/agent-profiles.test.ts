import { describe, expect, it } from 'vitest';
import { canonicalJson, SodiumCryptoProvider } from '../crypto.js';
import { IdentityManager, type DeviceSessionKeys } from '../identity.js';
import type { Envelope, Transport } from '../transport.js';
import { ContactEnvelopeSecurity, SodiumDirectMessageCipher } from '../social/messaging.js';
import {
  AgentMailbox,
  type AgentContact,
} from './agent-social.js';
import {
  AgentProfileService,
  InMemoryAgentProfileStateStore,
  createAgentProtocolResult,
  createOwnerConfirmation,
  validateAgentProtocolResult,
} from './agent-profiles.js';
import { AgentSocialGraphService, InMemoryAgentSocialGraphStateStore } from './agent-social-graph.js';

class ProfileNetwork {
  readonly endpoints = new Map<string, ProfileTransport>();
  readonly online = new Set<string>();
  register(endpoint: ProfileTransport): void { this.endpoints.set(endpoint.nodeId, endpoint); this.online.add(endpoint.nodeId); }
  setOnline(nodeId: string, enabled: boolean): void { if (enabled) this.online.add(nodeId); else this.online.delete(nodeId); }
  deliver(from: string, to: string, envelope: Envelope): void { if (!this.online.has(from) || !this.online.has(to)) throw new Error('peer offline'); this.endpoints.get(to)?.deliver(structuredClone(envelope)); }
}

class ProfileTransport implements Transport {
  private readonly handlers = new Set<(envelope: Envelope) => void>();
  constructor(readonly nodeId: string, private readonly network: ProfileNetwork) { network.register(this); }
  async connect(peer: string): Promise<void> { if (!this.network.online.has(this.nodeId) || !this.network.online.has(peer)) throw new Error('peer offline'); }
  async send(envelope: Envelope): Promise<void>;
  async send(peer: string, envelope: Envelope): Promise<void>;
  async send(peerOrEnvelope: string | Envelope, maybeEnvelope?: Envelope): Promise<void> { const envelope = maybeEnvelope ?? peerOrEnvelope as Envelope; this.network.deliver(this.nodeId, maybeEnvelope ? peerOrEnvelope as string : envelope.recipient, envelope); }
  onMessage(handler: (envelope: Envelope) => void): () => void { this.handlers.add(handler); return () => this.handlers.delete(handler); }
  isPeerConnected(peer: string): boolean { return this.network.online.has(this.nodeId) && this.network.online.has(peer); }
  async close(): Promise<void> { this.handlers.clear(); this.network.online.delete(this.nodeId); }
  deliver(envelope: Envelope): void { this.handlers.forEach(handler => handler(envelope)); }
}

function contact(keys: DeviceSessionKeys, agentId: string, trusted = true): AgentContact { const now = new Date().toISOString(); return { version: 1, agent: { agentId, identityId: keys.nodeId }, signingPublicKey: keys.publicKey, encryptionPublicKey: keys.encryptionPublicKey, trusted, createdAt: now, updatedAt: now }; }

async function mailbox(name: string, keys: DeviceSessionKeys, network: ProfileNetwork, contacts: readonly AgentContact[]): Promise<AgentMailbox> {
  const crypto = new SodiumCryptoProvider(); const transport = new ProfileTransport(keys.nodeId, network); const security = new ContactEnvelopeSecurity(keys, contacts.map(value => ({ nodeId: value.agent.identityId, signingPublicKey: value.signingPublicKey, encryptionPublicKey: value.encryptionPublicKey })));
  const value = new AgentMailbox({ transport, crypto, security, local: keys, agentId: `${name}-mailbox`, contacts, storage: new (await import('./agent-social.js')).InMemoryAgentMailboxStateStore(), policy: { mode: 'auto', askBeforeAccepting: false, autoAcceptTaskTypes: [], maxPending: 32, maxTasksPerSenderPerHour: 30 } }); await value.ready(); return value;
}

const wait = (ms = 30) => new Promise(resolve => setTimeout(resolve, ms));

describe('Phase 41 AgentProfile and Agent Social Graph', () => {
  it('publishes owner-bound profiles, keeps trust separate from human relationships, and persists visibility changes', async () => {
    const aliceKeys = await (await IdentityManager.generate()).sessionKeys('alice'); const bobKeys = await (await IdentityManager.generate()).sessionKeys('bob'); const charlieKeys = await (await IdentityManager.generate()).sessionKeys('charlie'); const malloryKeys = await (await IdentityManager.generate()).sessionKeys('mallory'); const network = new ProfileNetwork();
    const all = [contact(aliceKeys, 'alice-mailbox'), contact(bobKeys, 'bob-mailbox'), contact(charlieKeys, 'charlie-mailbox'), contact(malloryKeys, 'mallory-mailbox')];
    const alice = await mailbox('alice', aliceKeys, network, all.slice(1)); const bob = await mailbox('bob', bobKeys, network, [all[0], all[2], all[3]]); const charlie = await mailbox('charlie', charlieKeys, network, [all[0], all[1], all[3]]); const mallory = await mailbox('mallory', malloryKeys, network, [all[1]]);
    const aliceStore = new InMemoryAgentProfileStateStore(); const bobStore = new InMemoryAgentProfileStateStore(); const aliceProfiles = new AgentProfileService({ mailbox: alice, crypto: new SodiumCryptoProvider(), local: aliceKeys, storage: aliceStore }); const bobProfiles = new AgentProfileService({ mailbox: bob, crypto: new SodiumCryptoProvider(), local: bobKeys, storage: bobStore }); const charlieProfiles = new AgentProfileService({ mailbox: charlie, crypto: new SodiumCryptoProvider(), local: charlieKeys });
    const aliceGraph = new AgentSocialGraphService({ mailbox: alice, crypto: new SodiumCryptoProvider(), local: aliceKeys, profiles: aliceProfiles, storage: new InMemoryAgentSocialGraphStateStore() }); const bobGraph = new AgentSocialGraphService({ mailbox: bob, crypto: new SodiumCryptoProvider(), local: bobKeys, profiles: bobProfiles, storage: new InMemoryAgentSocialGraphStateStore() }); await Promise.all([aliceProfiles.ready(), bobProfiles.ready(), charlieProfiles.ready(), aliceGraph.ready(), bobGraph.ready()]);
    const eight = await aliceProfiles.create({ agentId: 'eight', displayName: 'Eight', description: 'Personal AI', agentType: 'Personal', capabilitiesSummary: ['planning', 'research'], interests: ['Coding'], specializations: ['Planning'], visibility: 'public' }); await aliceProfiles.publish('eight'); await wait();
    expect((await bobProfiles.get('eight', aliceKeys.nodeId))?.ownerIdentityId).toBe(aliceKeys.nodeId); expect((await charlieProfiles.publicProfiles()).map(value => value.agentId)).toContain('eight'); expect((await bobGraph.get({ agentId: 'eight', identityId: aliceKeys.nodeId }))?.trusted).toBe(false);
    await bobGraph.setTrusted({ agentId: 'eight', identityId: aliceKeys.nodeId }, true, true); await wait(); expect(bobGraph.isTrusted({ agentId: 'eight', identityId: aliceKeys.nodeId })).toBe(true); expect(bobGraph.isTrusted({ agentId: 'eight', identityId: aliceKeys.nodeId })).toBe(true); expect((aliceGraph.get({ agentId: 'eight', identityId: aliceKeys.nodeId }))?.trusted).not.toBe(true);
    const { signature: _signature, ...unsignedEight } = eight; const forged = { ...eight, signature: await new SodiumCryptoProvider().sign(canonicalJson(unsignedEight), malloryKeys.privateKey) }; await mallory.sendAgentProfile(bobKeys.nodeId, forged); await wait(); expect(bobProfiles.audit().some(value => value.event === 'security.rejected')).toBe(true);
    await aliceProfiles.update('eight', { visibility: 'private' }); await aliceProfiles.publish('eight'); await wait(); expect((await bobProfiles.publicProfiles()).some(value => value.agentId === 'eight')).toBe(false);
    const tombstone = await aliceProfiles.tombstone('eight'); await aliceProfiles.publish('eight'); await wait(); expect((await bobProfiles.get('eight', aliceKeys.nodeId))?.status).toBeUndefined();
    const persisted = new AgentProfileService({ mailbox: bob, crypto: new SodiumCryptoProvider(), local: bobKeys, storage: bobStore }); await persisted.ready(); expect((await persisted.snapshot()).profiles.find(value => value.agentId === 'eight')?.status).toBe('tombstoned'); expect(tombstone.revision).toBeGreaterThan(eight.revision);
    const orbit = await aliceProfiles.create({ agentId: 'orbit', displayName: 'Orbit', agentType: 'Research', visibility: 'public' }); await aliceProfiles.publish('orbit'); await wait(); const revoked = await aliceProfiles.revoke('orbit'); await aliceProfiles.publish('orbit'); await wait(); expect((await bobProfiles.publicProfiles()).some(value => value.agentId === 'orbit')).toBe(false); expect((await bobGraph.get({ agentId: 'orbit', identityId: aliceKeys.nodeId }))?.revoked).toBe(true); expect(revoked.status).toBe('revoked');
    persisted.close(); aliceGraph.close(); bobGraph.close(); aliceProfiles.close(); bobProfiles.close(); charlieProfiles.close(); alice.close(); bob.close(); charlie.close(); mallory.close();
  });

  it('keeps relationship events signed and applies mute/block locally without granting remote trust', async () => {
    const aliceKeys = await (await IdentityManager.generate()).sessionKeys('alice'); const bobKeys = await (await IdentityManager.generate()).sessionKeys('bob'); const network = new ProfileNetwork(); const bobContact = contact(bobKeys, 'bob-mailbox'); const alice = await mailbox('alice', aliceKeys, network, [bobContact]); const bob = await mailbox('bob', bobKeys, network, [contact(aliceKeys, 'alice-mailbox')]); const aliceGraph = new AgentSocialGraphService({ mailbox: alice, crypto: new SodiumCryptoProvider(), local: aliceKeys }); const bobGraph = new AgentSocialGraphService({ mailbox: bob, crypto: new SodiumCryptoProvider(), local: bobKeys }); await Promise.all([aliceGraph.ready(), bobGraph.ready()]);
    const orbit = { agentId: 'orbit', identityId: aliceKeys.nodeId }; await bobGraph.setTrusted(orbit, true, false); expect(bobGraph.isTrusted(orbit)).toBe(true); await bobGraph.setMuted(orbit, true); await bobGraph.setBlocked(orbit, true); expect(bobGraph.isMuted(orbit)).toBe(true); expect(bobGraph.isBlocked(orbit)).toBe(true); expect(bobGraph.contacts()).toHaveLength(0); const event = (await bobGraph.snapshot()).events.find(value => value.action === 'block'); expect(event?.ownerIdentityId).toBe(bobKeys.nodeId); await expect(bobGraph.ingest(event!, aliceKeys.nodeId)).rejects.toMatchObject({ code: 'UNAUTHORIZED' }); aliceGraph.close(); bobGraph.close(); alice.close(); bob.close();
  });

  it('requires owner confirmation for OWNER_CONFIRMED_DECISION', async () => {
    const keys = await (await IdentityManager.generate()).sessionKeys('alice'); const crypto = new SodiumCryptoProvider(); const confirmation = await createOwnerConfirmation({ requestId: 'approval-1', actionHash: 'action-hash' }, crypto, keys); const result = await createAgentProtocolResult({ agent: { agentId: 'eight', identityId: keys.nodeId }, type: 'OWNER_CONFIRMED_DECISION', value: 'Bob agreed', ownerConfirmation: confirmation }, crypto, keys); await expect(validateAgentProtocolResult(result, crypto, keys.publicKey)).resolves.toMatchObject({ type: 'OWNER_CONFIRMED_DECISION' }); await expect(validateAgentProtocolResult({ ...result, value: 'tampered' }, crypto, keys.publicKey)).rejects.toMatchObject({ code: 'INVALID_SIGNATURE' }); await expect(createAgentProtocolResult({ agent: { agentId: 'eight', identityId: keys.nodeId }, type: 'OWNER_CONFIRMED_DECISION', value: 'unconfirmed' }, crypto, keys)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
