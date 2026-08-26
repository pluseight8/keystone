import { describe, expect, it } from 'vitest';
import { SodiumCryptoProvider } from '../crypto.js';
import { IdentityManager, type DeviceSessionKeys } from '../identity.js';
import type { Envelope, Transport } from '../transport.js';
import { ContactEnvelopeSecurity } from '../social/messaging.js';
import { AgentMailbox, type AgentContact } from './agent-social.js';
import { AgentNegotiationService, InMemoryNegotiationStateStore, type NegotiationConstraint } from './agent-negotiation.js';

class Network {
  readonly endpoints = new Map<string, Endpoint>();
  readonly online = new Set<string>();
  readonly history: Envelope[] = [];
  register(endpoint: Endpoint): void { this.endpoints.set(endpoint.nodeId, endpoint); this.online.add(endpoint.nodeId); }
  setOnline(nodeId: string, online: boolean): void { if (online) this.online.add(nodeId); else this.online.delete(nodeId); }
  deliver(from: string, to: string, envelope: Envelope): void { if (!this.online.has(from) || !this.online.has(to)) throw new Error('offline'); this.history.push(structuredClone(envelope)); this.endpoints.get(to)?.deliver(structuredClone(envelope)); }
}
class Endpoint implements Transport {
  private readonly handlers = new Set<(envelope: Envelope) => void>();
  constructor(readonly nodeId: string, private readonly network: Network) { network.register(this); }
  async connect(peer: string): Promise<void> { if (!this.network.online.has(this.nodeId) || !this.network.online.has(peer)) throw new Error('offline'); }
  async send(envelope: Envelope): Promise<void>;
  async send(peer: string, envelope: Envelope): Promise<void>;
  async send(peerOrEnvelope: string | Envelope, maybeEnvelope?: Envelope): Promise<void> { const envelope = maybeEnvelope ?? peerOrEnvelope as Envelope; this.network.deliver(this.nodeId, maybeEnvelope ? peerOrEnvelope as string : envelope.recipient, envelope); }
  onMessage(handler: (envelope: Envelope) => void): () => void { this.handlers.add(handler); return () => this.handlers.delete(handler); }
  isPeerConnected(peer: string): boolean { return this.network.online.has(this.nodeId) && this.network.online.has(peer); }
  async close(): Promise<void> { this.handlers.clear(); this.network.online.delete(this.nodeId); }
  deliver(envelope: Envelope): void { for (const handler of this.handlers) handler(envelope); }
}
function contact(keys: DeviceSessionKeys, agentId: string, trusted = true): AgentContact { const now = new Date().toISOString(); return { version: 1, agent: { identityId: keys.nodeId, agentId }, signingPublicKey: keys.publicKey, encryptionPublicKey: keys.encryptionPublicKey, trusted, createdAt: now, updatedAt: now }; }
async function make(name: string, keys: DeviceSessionKeys, network: Network, peers: readonly AgentContact[], storage: InMemoryNegotiationStateStore, evaluator?: ConstructorParameters<typeof AgentNegotiationService>[0]['evaluator']): Promise<{ mailbox: AgentMailbox; negotiation: AgentNegotiationService }> {
  const crypto = new SodiumCryptoProvider(); const transport = new Endpoint(keys.nodeId, network); const security = new ContactEnvelopeSecurity(keys, peers.map(value => ({ nodeId: value.agent.identityId, signingPublicKey: value.signingPublicKey, encryptionPublicKey: value.encryptionPublicKey }))); const mailbox = new AgentMailbox({ transport, crypto, security, local: keys, agentId: `${name}-agent`, contacts: peers, policy: { mode: 'auto', askBeforeAccepting: false, autoAcceptTaskTypes: ['availability'], maxPending: 64, maxTasksPerSenderPerHour: 30 } }); await mailbox.ready(); const negotiation = new AgentNegotiationService({ mailbox, crypto, local: keys, storage, policy: { mode: 'ALLOW_SAFE_NEGOTIATIONS', askBeforeAccepting: false, defaultDisclosure: 'BOOLEAN' }, evaluator }); await negotiation.ready(); return { mailbox, negotiation };
}
function waitFor(ms = 30): Promise<void> { return new Promise(resolve => setTimeout(resolve, ms)); }

describe('Phase 40 private agent negotiation', () => {
  it('reaches a common option through offline/reconnect and survives restart without sending constraints', async () => {
    const alice = await (await IdentityManager.generate()).sessionKeys('alice'); const bob = await (await IdentityManager.generate()).sessionKeys('bob'); const charlie = await (await IdentityManager.generate()).sessionKeys('charlie'); const mallory = await (await IdentityManager.generate()).sessionKeys('mallory'); const network = new Network();
    const aliceContact = contact(alice, 'alice-agent'); const bobContact = contact(bob, 'bob-agent'); const charlieContact = contact(charlie, 'charlie-agent'); const malloryContact = contact(mallory, 'mallory-agent'); const constraint: NegotiationConstraint = { id: 'calendar-window', label: 'Local availability', dataClass: 'PRIVATE', disclosure: 'RANGE', localOnly: true };
    const aliceState = new InMemoryNegotiationStateStore(); const bobState = new InMemoryNegotiationStateStore(); const charlieState = new InMemoryNegotiationStateStore();
    const evaluate = async ({ proposal }: { proposal: { options: readonly { id: string }[] } }) => ({ decision: 'accept' as const, selectedOptionIds: proposal.options.filter(option => option.id === 'sat-18').map(option => option.id), disclosure: 'BOOLEAN' as const, derived: { available: true }, score: 0.9 });
    const alicePair = await make('alice', alice, network, [bobContact, charlieContact], aliceState); const charliePair = await make('charlie', charlie, network, [aliceContact], charlieState, evaluate); const bobPair = await make('bob', bob, network, [aliceContact], bobState, evaluate); network.setOnline(bob.nodeId, false); bobPair.negotiation.close(); bobPair.mailbox.close();
    const session = await alicePair.negotiation.createSession({ title: 'Choose a common time', category: 'coordination', participants: [bobContact.agent, charlieContact.agent], strategy: 'UNANIMOUS', disclosureDefault: 'BOOLEAN', constraints: [constraint] }); const proposal = await alicePair.negotiation.propose(session.id, { options: [{ id: 'fri-18', label: 'Friday 18:00', dataClass: 'PUBLIC' }, { id: 'sat-18', label: 'Saturday 18:00', dataClass: 'PUBLIC' }] });
    await alicePair.negotiation.flush(); await waitFor(); expect((await charliePair.negotiation.listResponses(session.id)).length).toBe(1); expect(JSON.stringify(network.history)).not.toContain('calendar-window-private-value');
    network.setOnline(bob.nodeId, true); const bobRestart = await make('bob', bob, network, [aliceContact], bobState, evaluate); await alicePair.negotiation.flush(bob.nodeId); await waitFor(60); expect((await bobRestart.negotiation.listProposals(session.id)).some(value => value.id === proposal.id)).toBe(true); expect((await alicePair.negotiation.listResponses(session.id)).length).toBeGreaterThanOrEqual(2);
    const result = await alicePair.negotiation.finalize(session.id); expect(result.status).toBe('completed'); expect(result.selectedOptionIds).toEqual(['sat-18']); await alicePair.negotiation.flush(bob.nodeId); await waitFor(); expect((await bobRestart.negotiation.listResults()).some(value => value.id === result.id)).toBe(true);
    const persisted = await bobState.read(); expect(JSON.stringify(persisted)).not.toContain('calendar-window-private-value');
    const replay = network.history.filter(value => value.sender === alice.nodeId && value.recipient === bob.nodeId && value.type === 'ai.agent_social').at(-1); if (replay) network.deliver(alice.nodeId, bob.nodeId, replay); await waitFor(); expect((await bobRestart.mailbox.snapshot()).audit.some(value => value.event === 'security.rejected')).toBe(true);
    await expect(alicePair.negotiation.createSession({ title: 'No Mallory', category: 'coordination', participants: [malloryContact.agent], constraints: [constraint] })).rejects.toMatchObject({ code: 'UNKNOWN_CONTACT' });
    alicePair.negotiation.close(); alicePair.mailbox.close(); charliePair.negotiation.close(); charliePair.mailbox.close(); bobRestart.negotiation.close(); bobRestart.mailbox.close();
  });

  it('rejects private derived values and duplicate votes', async () => {
    const alice = await (await IdentityManager.generate()).sessionKeys('alice'); const bob = await (await IdentityManager.generate()).sessionKeys('bob'); const network = new Network(); const aliceContact = contact(alice, 'alice-agent'); const bobContact = contact(bob, 'bob-agent'); const a = await make('alice', alice, network, [bobContact], new InMemoryNegotiationStateStore()); const b = await make('bob', bob, network, [aliceContact], new InMemoryNegotiationStateStore());
    const session = await a.negotiation.createSession({ title: 'Safe', participants: [bobContact.agent], constraints: [{ id: 'private', label: 'Private fact', dataClass: 'PRIVATE', disclosure: 'REDACTED', localOnly: true }] }); const proposal = await a.negotiation.propose(session.id, { options: [{ id: 'one', label: 'One', dataClass: 'PUBLIC' }] }); await a.negotiation.flush(bob.nodeId); await waitFor();
    await expect(b.negotiation.respond(session.id, proposal.id, { decision: 'accept', selectedOptionIds: ['one'], disclosure: 'EXACT', derived: { secret: 'private value' } })).rejects.toMatchObject({ code: 'UNSHAREABLE_DATA' }); const response = await b.negotiation.respond(session.id, proposal.id, { decision: 'accept', selectedOptionIds: ['one'], disclosure: 'BOOLEAN', derived: { available: true } }); await a.negotiation.flush(bob.nodeId); await expect(b.negotiation.respond(session.id, proposal.id, { decision: 'accept', selectedOptionIds: ['one'], disclosure: 'BOOLEAN', derived: { available: true } })).rejects.toMatchObject({ code: 'DUPLICATE' }); expect(response.selectedOptionIds).toEqual(['one']);
    a.negotiation.close(); a.mailbox.close(); b.negotiation.close(); b.mailbox.close();
  });

  it('queues a proposal promptly when a stale connected hint meets an offline peer', async () => {
    const alice = await (await IdentityManager.generate()).sessionKeys('alice'); const bob = await (await IdentityManager.generate()).sessionKeys('bob'); const network = new Network(); const aliceContact = contact(alice, 'alice-agent'); const bobContact = contact(bob, 'bob-agent'); const alicePair = await make('alice', alice, network, [bobContact], new InMemoryNegotiationStateStore()); const bobPair = await make('bob', bob, network, [aliceContact], new InMemoryNegotiationStateStore());
    const session = await alicePair.negotiation.createSession({ title: 'Offline proposal', participants: [bobContact.agent] }); await alicePair.negotiation.flush(bob.nodeId); await waitFor();

    network.setOnline(bob.nodeId, false);
    const originalConnected = alicePair.mailbox.isPeerConnected; const originalFlush = alicePair.mailbox.flush;
    alicePair.mailbox.isPeerConnected = () => true;
    alicePair.mailbox.flush = async () => new Promise<void>(() => undefined);
    const proposalPromise = alicePair.negotiation.propose(session.id, { options: [{ id: 'one', label: 'One', dataClass: 'PUBLIC' }] });
    const proposal = await Promise.race([proposalPromise, waitFor(150).then(() => undefined)]);
    expect(proposal).toBeDefined();
    expect((await alicePair.mailbox.snapshot()).outbox.some(value => value.peer === bob.nodeId)).toBe(true);

    alicePair.mailbox.flush = originalFlush; alicePair.mailbox.isPeerConnected = originalConnected; network.setOnline(bob.nodeId, true); const before = network.history.length; await alicePair.negotiation.flush(bob.nodeId); await waitFor();
    if (!proposal) throw new Error('Proposal was not queued');
    expect(network.history.length - before).toBe(1); expect((await bobPair.negotiation.listProposals(session.id)).filter(value => value.id === proposal.id)).toHaveLength(1); await alicePair.negotiation.flush(bob.nodeId); await waitFor(); expect((await bobPair.negotiation.listProposals(session.id)).filter(value => value.id === proposal.id)).toHaveLength(1);
    alicePair.negotiation.close(); alicePair.mailbox.close(); bobPair.negotiation.close(); bobPair.mailbox.close();
  });
});
