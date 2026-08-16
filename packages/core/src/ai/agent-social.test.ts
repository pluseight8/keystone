import { describe, expect, it } from 'vitest';
import { SodiumCryptoProvider } from '../crypto.js';
import { IdentityManager, type DeviceSessionKeys } from '../identity.js';
import type { Envelope, Transport } from '../transport.js';
import { ContactEnvelopeSecurity, SodiumDirectMessageCipher } from '../social/messaging.js';
import { AgentMailbox, AgentSocialError, type AgentContact, type AgentPresence } from './agent-social.js';
import type { AgentRef, AgentSharedContext } from './visits.js';

class MailboxNetwork {
  readonly endpoints = new Map<string, MailboxTransport>();
  readonly online = new Set<string>();
  readonly history: Envelope[] = [];
  register(endpoint: MailboxTransport): void { this.endpoints.set(endpoint.nodeId, endpoint); this.online.add(endpoint.nodeId); }
  setOnline(nodeId: string, online: boolean): void { if (online) this.online.add(nodeId); else this.online.delete(nodeId); }
  deliver(from: string, to: string, envelope: Envelope): void { if (!this.online.has(from) || !this.online.has(to)) throw new Error('peer offline'); this.history.push(structuredClone(envelope)); this.endpoints.get(to)?.deliver(structuredClone(envelope)); }
}

class MailboxTransport implements Transport {
  private readonly handlers = new Set<(envelope: Envelope) => void>();
  constructor(readonly nodeId: string, private readonly network: MailboxNetwork) { network.register(this); }
  async connect(peer: string): Promise<void> { if (!this.network.online.has(this.nodeId) || !this.network.online.has(peer)) throw new Error('peer offline'); }
  async send(envelope: Envelope): Promise<void>;
  async send(peer: string, envelope: Envelope): Promise<void>;
  async send(peerOrEnvelope: string | Envelope, maybeEnvelope?: Envelope): Promise<void> { const envelope = maybeEnvelope ?? peerOrEnvelope as Envelope; await this.sendTo(maybeEnvelope ? peerOrEnvelope as string : envelope.recipient, envelope); }
  private async sendTo(peer: string, envelope: Envelope): Promise<void> { this.network.deliver(this.nodeId, peer, envelope); }
  onMessage(handler: (envelope: Envelope) => void): () => void { this.handlers.add(handler); return () => this.handlers.delete(handler); }
  isPeerConnected(peer: string): boolean { return this.network.online.has(this.nodeId) && this.network.online.has(peer); }
  async close(): Promise<void> { this.handlers.clear(); this.network.online.delete(this.nodeId); }
  deliver(envelope: Envelope): void { this.handlers.forEach(handler => handler(envelope)); }
}

function contact(keys: DeviceSessionKeys, agentId: string, trusted = true): AgentContact { const now = new Date().toISOString(); return { version: 1, agent: { agentId, identityId: keys.nodeId }, signingPublicKey: keys.publicKey, encryptionPublicKey: keys.encryptionPublicKey, trusted, createdAt: now, updatedAt: now }; }
function shared(dataClass: AgentSharedContext['dataClass'] = 'USER_EXPLICIT'): AgentSharedContext { return { id: 'meeting-window', label: 'Explicit shared window', value: 'tomorrow at 10:00', dataClass }; }

async function makeMailbox(name: string, keys: DeviceSessionKeys, network: MailboxNetwork, peers: readonly AgentContact[], storage?: import('./agent-social.js').AgentMailboxStateStore, policy: import('./agent-social.js').AgentTrustPolicy = { version: 1, mode: 'auto', allowedIdentityIds: [], allowedAgentIds: [], blockedIdentityIds: [], blockedAgentIds: [], askBeforeAccepting: false, autoAcceptTaskTypes: ['availability'], maxPending: 32, maxTasksPerSenderPerHour: 30 }, executor?: (task: import('./agent-social.js').AgentTaskRequest) => Promise<import('./agent-social.js').AgentTaskResult>): Promise<AgentMailbox> {
  const local = keys; const crypto = new SodiumCryptoProvider(); const transport = new MailboxTransport(local.nodeId, network); const security = new ContactEnvelopeSecurity(local, peers.map(value => ({ nodeId: value.agent.identityId, signingPublicKey: value.signingPublicKey, encryptionPublicKey: value.encryptionPublicKey }))); const mailbox = new AgentMailbox({ transport, crypto, security, local, agentId: `${name}-agent`, contacts: peers, storage, policy, executor: executor ? { execute: async task => executor(task) } : undefined }); await mailbox.ready(); return mailbox;
}

describe('Phase 39 asynchronous agent social protocol', () => {
  it('delivers an encrypted task and response across offline/reconnect with durable state', async () => {
    const aliceKeys = await (await IdentityManager.generate()).sessionKeys('alice'); const bobKeys = await (await IdentityManager.generate()).sessionKeys('bob'); const malloryKeys = await (await IdentityManager.generate()).sessionKeys('mallory'); const network = new MailboxNetwork();
    const aliceContact = contact(aliceKeys, 'alice-agent'); const bobContact = contact(bobKeys, 'bob-agent'); const malloryContact = contact(malloryKeys, 'mallory-agent'); const aliceStorage = new (await import('./agent-social.js')).InMemoryAgentMailboxStateStore(); const bobStorage = new (await import('./agent-social.js')).InMemoryAgentMailboxStateStore();
    const alice = await makeMailbox('alice', aliceKeys, network, [bobContact], aliceStorage, undefined, undefined); const bob = await makeMailbox('bob', bobKeys, network, [aliceContact], bobStorage, { version: 1, mode: 'ask', allowedIdentityIds: [], allowedAgentIds: [], blockedIdentityIds: [], blockedAgentIds: [], askBeforeAccepting: true, autoAcceptTaskTypes: [], maxPending: 32, maxTasksPerSenderPerHour: 30 }, async task => ({ value: { accepted: true, request: task.prompt }, dataClass: 'USER_EXPLICIT' }));
    network.setOnline(bobKeys.nodeId, false);
    const task = await alice.createTask({ recipient: bobContact.agent, taskType: 'availability', prompt: 'Can you be available tomorrow?', explicitContext: [shared()] });
    expect((await alice.snapshot()).outbox.length).toBe(1); expect((await bob.listInbox()).length).toBe(0);
    network.setOnline(bobKeys.nodeId, true); await alice.flush(bobKeys.nodeId); await new Promise(resolve => setTimeout(resolve, 20));
    expect((await bob.listInbox())[0]?.taskId).toBe(task.taskId); expect((await alice.listReceipts()).some(value => value.taskId === task.taskId && value.status === 'delivered')).toBe(true);
    network.setOnline(aliceKeys.nodeId, false); const responsePromise = bob.acceptTask(task.taskId); await responsePromise; expect((await bob.snapshot()).outbox.length).toBeGreaterThan(0);
    network.setOnline(aliceKeys.nodeId, true); await bob.flush(aliceKeys.nodeId); await new Promise(resolve => setTimeout(resolve, 20)); expect((await alice.listResponses()).some(value => value.taskId === task.taskId && value.status === 'completed')).toBe(true);
    bob.close(); const bobRestarted = await makeMailbox('bob', bobKeys, network, [aliceContact], bobStorage, { version: 1, mode: 'ask', allowedIdentityIds: [], allowedAgentIds: [], blockedIdentityIds: [], blockedAgentIds: [], askBeforeAccepting: true, autoAcceptTaskTypes: [], maxPending: 32, maxTasksPerSenderPerHour: 30 }, async current => ({ value: { accepted: true, request: current.prompt }, dataClass: 'USER_EXPLICIT' })); expect((await bobRestarted.listInbox()).some(value => value.taskId === task.taskId)).toBe(true);
    await expect(alice.createTask({ recipient: bobContact.agent, taskType: 'availability', prompt: 'secret', explicitContext: [shared('PRIVATE' as never)] })).rejects.toBeInstanceOf(AgentSocialError);
    expect((await alice.snapshot()).audit.some(value => value.event === 'task.sent')).toBe(true); void malloryContact;
    alice.close(); bobRestarted.close();
  });

  it('rejects forged/replayed senders, capability escalation, and private room context', async () => {
    const aliceKeys = await (await IdentityManager.generate()).sessionKeys('alice'); const bobKeys = await (await IdentityManager.generate()).sessionKeys('bob'); const malloryKeys = await (await IdentityManager.generate()).sessionKeys('mallory'); const network = new MailboxNetwork();
    const aliceContact = contact(aliceKeys, 'alice-agent'); const bobContact = contact(bobKeys, 'bob-agent'); const mallory = contact(malloryKeys, 'mallory-agent'); const alice = await makeMailbox('alice', aliceKeys, network, [bobContact]); const bob = await makeMailbox('bob', bobKeys, network, [aliceContact]); const malloryBox = await makeMailbox('mallory', malloryKeys, network, [bobContact]);
    await expect(alice.createTask({ recipient: bobContact.agent, taskType: 'research', prompt: 'private', explicitContext: [shared('PRIVATE' as never)] })).rejects.toMatchObject({ code: 'UNSHAREABLE_DATA' });
    const capability = await alice.issueCapability({ recipient: bobContact.agent, scope: 'availability.read', taskTypes: ['availability'], expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(), maxUses: 1 }); const task = await alice.createTask({ recipient: bobContact.agent, taskType: 'availability', prompt: 'bounded request', explicitContext: [shared()], capabilities: [capability] }); await expect(alice.createTask({ recipient: bobContact.agent, taskType: 'availability', prompt: 'capability replay', explicitContext: [shared()], capabilities: [capability] })).rejects.toMatchObject({ code: 'CAPABILITY_DENIED' }); await alice.flush(bobKeys.nodeId); await new Promise(resolve => setTimeout(resolve, 20)); expect((await bob.listInbox()).some(value => value.taskId === task.taskId)).toBe(true);
    const replay = network.history.find(value => value.sender === aliceKeys.nodeId && value.recipient === bobKeys.nodeId && value.type === 'ai.agent_social'); if (replay) network.deliver(aliceKeys.nodeId, bobKeys.nodeId, replay); await new Promise(resolve => setTimeout(resolve, 20)); expect((await bob.snapshot()).audit.some(value => value.event === 'security.rejected')).toBe(true);
    const unsigned = { version: 1 as const, id: crypto.randomUUID(), kind: 'task' as const, task: { ...task, sender: { agentId: 'alice-agent', identityId: aliceKeys.nodeId }, signature: task.signature } }; const forgedUnsigned = { version: 1 as const, type: 'ai.agent_social', id: crypto.randomUUID(), sender: malloryKeys.nodeId, recipient: bobKeys.nodeId, nonce: crypto.randomUUID(), expiresAt: new Date(Date.now() + 60_000).toISOString(), body: await new SodiumDirectMessageCipher().encrypt(JSON.stringify(unsigned), malloryKeys.encryptionPrivateKey, bobKeys.encryptionPublicKey) }; const mallorySecurity = new ContactEnvelopeSecurity(malloryKeys, [{ nodeId: bobKeys.nodeId, signingPublicKey: bobKeys.publicKey, encryptionPublicKey: bobKeys.encryptionPublicKey }]); await network.endpoints.get(malloryKeys.nodeId)?.send(bobKeys.nodeId, { ...forgedUnsigned, signature: await mallorySecurity.sign(forgedUnsigned) }); await new Promise(resolve => setTimeout(resolve, 20)); expect((await bob.snapshot()).audit.some(value => value.event === 'security.rejected')).toBe(true);
    const room = await alice.createAsyncRoom({ title: 'Trip', members: [bobContact.agent], sharedContext: [shared()] }); await alice.flush(bobKeys.nodeId); await new Promise(resolve => setTimeout(resolve, 20)); expect((await bob.listRooms()).some(value => value.id === room.id)).toBe(true); await expect(alice.createAsyncRoom({ title: 'Secret', members: [bobContact.agent], sharedContext: [shared('PRIVATE' as never)] })).rejects.toMatchObject({ code: 'UNSHAREABLE_DATA' });
    malloryBox.close(); alice.close(); bob.close(); void mallory;
  });

  it('keeps presence minimal and obeys trust/blocked policies', async () => {
    const aliceKeys = await (await IdentityManager.generate()).sessionKeys('alice'); const bobKeys = await (await IdentityManager.generate()).sessionKeys('bob'); const network = new MailboxNetwork(); const bobContact = contact(bobKeys, 'bob-agent', false); const alice = await makeMailbox('alice', aliceKeys, network, [bobContact]); await alice.setTrustPolicy({ mode: 'trusted-only' }); await expect(alice.createTask({ recipient: bobContact.agent, taskType: 'custom', prompt: 'blocked', explicitContext: [shared()] })).rejects.toMatchObject({ code: 'POLICY_DENIED' }); const presence = await alice.setPresence({ state: 'available', acceptingTasks: true, peers: [bobContact.agent] }); expect(presence.state).toBe('available'); const parsed = JSON.parse(JSON.stringify(presence)) as AgentPresence; expect(Object.keys(parsed)).toEqual(expect.arrayContaining(['agent', 'state', 'acceptingTasks', 'updatedAt', 'expiresAt', 'signature'])); alice.close();
  });
});
