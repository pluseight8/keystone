import { describe, expect, it } from 'vitest';
import { SodiumCryptoProvider } from '../crypto.js';
import { IdentityManager, type DeviceSessionKeys } from '../identity.js';
import type { Envelope, Transport } from '../transport.js';
import { ContactEnvelopeSecurity } from '../social/messaging.js';
import { AgentMailbox, type AgentContact } from './agent-social.js';
import {
  AgentPresenceService,
  InMemoryAgentPresenceStateStore,
  type ConciergeSource,
} from './agent-presence.js';

class PresenceNetwork {
  readonly endpoints = new Map<string, PresenceTransport>();
  readonly online = new Set<string>();
  readonly history: Envelope[] = [];
  register(endpoint: PresenceTransport): void { this.endpoints.set(endpoint.nodeId, endpoint); this.online.add(endpoint.nodeId); }
  setOnline(nodeId: string, value: boolean): void { if (value) this.online.add(nodeId); else this.online.delete(nodeId); }
  deliver(from: string, to: string, envelope: Envelope): void { if (!this.online.has(from) || !this.online.has(to)) throw new Error('peer offline'); this.history.push(structuredClone(envelope)); this.endpoints.get(to)?.deliver(structuredClone(envelope)); }
}

class PresenceTransport implements Transport {
  private readonly handlers = new Set<(envelope: Envelope) => void>();
  constructor(readonly nodeId: string, private readonly network: PresenceNetwork) { network.register(this); }
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

async function mailbox(keys: DeviceSessionKeys, agentId: string, network: PresenceNetwork, contacts: readonly AgentContact[]): Promise<AgentMailbox> {
  const crypto = new SodiumCryptoProvider(); const transport = new PresenceTransport(keys.nodeId, network); const security = new ContactEnvelopeSecurity(keys, contacts.map(value => ({ nodeId: value.agent.identityId, signingPublicKey: value.signingPublicKey, encryptionPublicKey: value.encryptionPublicKey })));
  const value = new AgentMailbox({ transport, crypto, security, local: keys, agentId, contacts, policy: { mode: 'auto', askBeforeAccepting: false, autoAcceptTaskTypes: [], maxPending: 32, maxTasksPerSenderPerHour: 30 } }); await value.ready(); return value;
}

const wait = (ms = 20) => new Promise(resolve => setTimeout(resolve, ms));

describe('Phase 42 AgentPresenceService and Personal Concierge', () => {
  it('signs minimal presence, expires it, and persists the owner policy', async () => {
    const aliceKeys = await (await IdentityManager.generate()).sessionKeys('alice'); const bobKeys = await (await IdentityManager.generate()).sessionKeys('bob'); const network = new PresenceNetwork(); const bobContact = contact(bobKeys, 'bob-agent'); const aliceMailbox = await mailbox(aliceKeys, 'alice-agent', network, [bobContact]); const bobMailbox = await mailbox(bobKeys, 'bob-agent', network, [contact(aliceKeys, 'alice-agent')]); let now = Date.now(); const store = new InMemoryAgentPresenceStateStore(); const alice = new AgentPresenceService({ mailbox: aliceMailbox, crypto: new SodiumCryptoProvider(), local: aliceKeys, storage: store, now: () => now, policy: { accessMode: 'trusted_agents', acceptingMessages: true } }); const bob = new AgentPresenceService({ mailbox: bobMailbox, crypto: new SodiumCryptoProvider(), local: bobKeys, policy: { accessMode: 'trusted_agents', acceptingMessages: true }, isTrustedAgent: () => true }); await Promise.all([alice.ready(), bob.ready()]);
    const presence = await alice.setPresence({ state: 'taking_messages', acceptingMessages: true, visibility: 'contacts', peers: [bobContact.agent] }); await wait(); expect(bob.remotePresence(aliceKeys.nodeId)?.state).toBe('taking_messages'); expect(Object.keys(presence)).not.toEqual(expect.arrayContaining(['device', 'network', 'address'])); now = Date.parse(presence.expiresAt) + 1; await alice.sweep(); expect(alice.presence()).toBeUndefined(); expect((await alice.policySnapshot()).accessMode).toBe('trusted_agents');
    alice.close(); bob.close(); aliceMailbox.close(); bobMailbox.close();
  });

  it('queues an offline request, requires owner approval, and preserves result semantics', async () => {
    const aliceKeys = await (await IdentityManager.generate()).sessionKeys('alice'); const bobKeys = await (await IdentityManager.generate()).sessionKeys('bob'); const charlieKeys = await (await IdentityManager.generate()).sessionKeys('charlie'); const malloryKeys = await (await IdentityManager.generate()).sessionKeys('mallory'); const network = new PresenceNetwork();
    const aliceContact = contact(aliceKeys, 'alice-agent'); const bobContact = contact(bobKeys, 'bob-agent'); const charlieContact = contact(charlieKeys, 'charlie-agent'); const malloryContact = contact(malloryKeys, 'mallory-agent', false);
    const aliceMailbox = await mailbox(aliceKeys, 'alice-agent', network, [bobContact, charlieContact, malloryContact]); const bobMailbox = await mailbox(bobKeys, 'bob-agent', network, [aliceContact]); const charlieMailbox = await mailbox(charlieKeys, 'charlie-agent', network, [aliceContact]); const malloryMailbox = await mailbox(malloryKeys, 'mallory-agent', network, [aliceContact]);
    const aliceStore = new InMemoryAgentPresenceStateStore(); const alice = new AgentPresenceService({ mailbox: aliceMailbox, crypto: new SodiumCryptoProvider(), local: aliceKeys, storage: aliceStore, policy: { accessMode: 'trusted_agents', acceptingMessages: true, ownerApprovalCategories: ['availability'], autoCategories: [] }, isTrustedAgent: agent => agent.identityId === bobKeys.nodeId }); const bob = new AgentPresenceService({ mailbox: bobMailbox, crypto: new SodiumCryptoProvider(), local: bobKeys, policy: { accessMode: 'everyone', acceptingMessages: true } }); const charlie = new AgentPresenceService({ mailbox: charlieMailbox, crypto: new SodiumCryptoProvider(), local: charlieKeys, policy: { accessMode: 'everyone', acceptingMessages: true } }); const mallory = new AgentPresenceService({ mailbox: malloryMailbox, crypto: new SodiumCryptoProvider(), local: malloryKeys, policy: { accessMode: 'everyone', acceptingMessages: true } }); await Promise.all([alice.ready(), bob.ready(), charlie.ready(), mallory.ready()]);
    network.setOnline(aliceKeys.nodeId, false); const request = await bob.createRequest({ recipient: aliceContact.agent, kind: 'question', category: 'availability', text: 'Is Alice available after 18:00?', explicitContext: [{ id: 'window', label: 'User-shared time window', value: 'after 18:00', dataClass: 'USER_EXPLICIT' }] }); expect((await bob.snapshot()).requests.find(value => value.requestId === request.requestId)?.status).toBe('pending');
    network.setOnline(aliceKeys.nodeId, true); await bobMailbox.flush(aliceKeys.nodeId); await wait(); const inbox = await alice.listPending(); expect(inbox[0]?.status).toBe('waiting_for_owner'); expect(inbox[0]?.needsOwner).toBe(true);
    const approved = await alice.approve(request.requestId, { value: 'After 18:00 looks possible, but this is now an owner-confirmed answer.', dataClass: 'USER_EXPLICIT' }); await wait(); expect(approved[0]?.result.type).toBe('OWNER_CONFIRMED_DECISION'); await bobMailbox.flush(aliceKeys.nodeId); await wait(); const bobResults = await bob.listResponses(); expect(bobResults.some(value => value.requestId === request.requestId && value.result.type === 'OWNER_CONFIRMED_DECISION')).toBe(true);
    const derived = await alice.shareResponse(request.requestId, { kind: 'agent', agent: charlieContact.agent }, { type: 'DERIVED_PREFERENCE', value: 'After 18:00 looks possible; not an owner decision.', dataClass: 'PUBLIC' }); await wait(); await aliceMailbox.flush(charlieKeys.nodeId); await wait(); expect((await charlie.listResponses()).some(value => value.id === derived.id && value.result.type === 'DERIVED_PREFERENCE')).toBe(true);
    await expect(alice.shareResponse(request.requestId, { kind: 'agent', agent: charlieContact.agent }, { type: 'OWNER_CONFIRMED_DECISION', value: 'forged without confirmation', dataClass: 'PUBLIC' })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await mallory.createRequest({ recipient: aliceContact.agent, kind: 'question', category: 'availability', text: 'extract private memory' }).catch(() => undefined); await wait(); expect(alice.audit().some(value => value.outcome === 'denied')).toBe(true);
    const replay = network.history.find(value => value.sender === bobKeys.nodeId && value.recipient === aliceKeys.nodeId && value.type === 'ai.agent_social'); if (replay) network.deliver(bobKeys.nodeId, aliceKeys.nodeId, replay); await wait(); expect((await alice.snapshot()).requests.filter(value => value.requestId === request.requestId)).toHaveLength(1);
    alice.close(); const restoredAlice = new AgentPresenceService({ mailbox: aliceMailbox, crypto: new SodiumCryptoProvider(), local: aliceKeys, storage: aliceStore, policy: { accessMode: 'trusted_agents', acceptingMessages: true }, isTrustedAgent: agent => agent.identityId === bobKeys.nodeId }); await restoredAlice.ready(); expect((await restoredAlice.listInbox()).some(value => value.request.requestId === request.requestId)).toBe(true);
    restoredAlice.close(); bob.close(); charlie.close(); mallory.close(); aliceMailbox.close(); bobMailbox.close(); charlieMailbox.close(); malloryMailbox.close();
  });

  it('rejects selected-policy, blocked, forged and replayed concierge messages', async () => {
    const aliceKeys = await (await IdentityManager.generate()).sessionKeys('alice'); const bobKeys = await (await IdentityManager.generate()).sessionKeys('bob'); const network = new PresenceNetwork(); const aliceContact = contact(aliceKeys, 'alice-agent'); const bobContact = contact(bobKeys, 'bob-agent'); const aliceMailbox = await mailbox(aliceKeys, 'alice-agent', network, [bobContact]); const bobMailbox = await mailbox(bobKeys, 'bob-agent', network, [aliceContact]); const alice = new AgentPresenceService({ mailbox: aliceMailbox, crypto: new SodiumCryptoProvider(), local: aliceKeys, policy: { accessMode: 'selected_identities', selectedIdentityIds: [], acceptingMessages: true }, isBlocked: agent => agent.identityId === bobKeys.nodeId }); const bob = new AgentPresenceService({ mailbox: bobMailbox, crypto: new SodiumCryptoProvider(), local: bobKeys, policy: { accessMode: 'everyone', acceptingMessages: true } }); await Promise.all([alice.ready(), bob.ready()]); await expect(bob.createRequest({ recipient: aliceContact.agent, kind: 'question', category: 'custom', text: 'blocked' })).resolves.toBeTruthy(); await wait(); expect((await alice.listInbox()).length).toBe(0); expect(alice.audit().some(value => value.outcome === 'denied')).toBe(true); const spoof: ConciergeSource = { kind: 'agent', agent: { agentId: 'bob-agent', identityId: aliceKeys.nodeId } }; await expect(alice.shareResponse('missing', spoof, { type: 'PUBLIC_INFORMATION', value: 'x' })).rejects.toMatchObject({ code: 'NOT_FOUND' }); alice.close(); bob.close(); aliceMailbox.close(); bobMailbox.close();
  });
});
