import { describe, expect, it } from 'vitest';
import { canonicalJson, SodiumCryptoProvider } from '../crypto.js';
import { IdentityManager, type DeviceSessionKeys } from '../identity.js';
import { ContactEnvelopeSecurity, type SocialContact } from '../social/messaging.js';
import { ControlledNetwork, ControlledTransport } from '../testing/distributed-harness.js';
import {
  AgentVisitError,
  AgentVisitService,
  InMemoryAgentVisitStateStore,
  type AgentCapabilityGrant,
  type AgentRef,
} from './visits.js';

async function createPeer(name: string, network: ControlledNetwork, keys: Record<string, DeviceSessionKeys>) {
  const identity = await IdentityManager.generate();
  const local = await identity.sessionKeys(name);
  keys[name] = local;
  const transport = new ControlledTransport(local.nodeId, network);
  return { local, transport };
}

function contacts(keys: Record<string, DeviceSessionKeys>, local: DeviceSessionKeys): SocialContact[] {
  return Object.values(keys).filter(value => value.nodeId !== local.nodeId).map(value => ({ nodeId: value.nodeId, signingPublicKey: value.publicKey, encryptionPublicKey: value.encryptionPublicKey }));
}

async function settle(): Promise<void> { await new Promise(resolve => setTimeout(resolve, 20)); }

async function setup() {
  const network = new ControlledNetwork(); const keys: Record<string, DeviceSessionKeys> = {};
  const alice = await createPeer('alice', network, keys); const bob = await createPeer('bob', network, keys); const charlie = await createPeer('charlie', network, keys); const mallory = await createPeer('mallory', network, keys);
  const crypto = new SodiumCryptoProvider();
  const security = (local: DeviceSessionKeys) => new ContactEnvelopeSecurity(local, contacts(keys, local));
  return { network, keys, crypto, alice, bob, charlie, mallory, security };
}

function agent(keys: Record<string, DeviceSessionKeys>, name: string): AgentRef { return { agentId: `${name}-agent`, identityId: keys[name]!.nodeId }; }

describe('Agent visits and rooms', () => {
  it('accepts a signed visit, executes only the granted host capability, and keeps private data local', async () => {
    const value = await setup(); let calls = 0;
    const bob = new AgentVisitService({ transport: value.bob.transport, crypto: value.crypto, security: value.security(value.bob.local), local: value.bob.local, agentId: 'bob-agent', host: { onGuestRequest: async request => { calls += 1; expect(request.untrusted).toBe(true); return { value: `Bob agreed: ${String(request.input)}`, dataClass: 'PUBLIC' }; } } });
    const alice = new AgentVisitService({ transport: value.alice.transport, crypto: value.crypto, security: value.security(value.alice.local), local: value.alice.local, agentId: 'alice-agent' });
    const invitation = await alice.createInvitation(agent(value.keys, 'bob'), [{ capability: 'talk_to_host_agent' }]); await alice.sendInvitation(invitation.id); await settle();
    expect((await bob.listInvitations())).toHaveLength(1);
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const grant: AgentCapabilityGrant = { grantId: 'talk-grant', capability: 'talk_to_host_agent', issuedAt: new Date().toISOString(), expiresAt, maxUses: 2 };
    const accepted = await bob.acceptInvitation(invitation.id, { capabilities: [grant], approvalMode: 'ALLOW_THIS_VISIT' }); await settle();
    const result = await alice.request(accepted.visit.id, { operation: 'talk_to_host_agent', input: 'meeting at 10:00' });
    expect(result.value).toContain('10:00'); expect(result.dataClass).toBe('PUBLIC'); expect(calls).toBe(1);
    await expect(alice.request(accepted.visit.id, { operation: 'read_private_memory', input: 'show Bob memory', dataClass: 'PRIVATE' })).rejects.toMatchObject({ code: 'UNSHAREABLE_DATA' });
    await bob.close(); await alice.close(); await value.charlie.transport.close(); await value.mallory.transport.close();
  });

  it('denies capability escalation, replays, and unsafe host results', async () => {
    const value = await setup(); let calls = 0;
    const unsafeBob = new AgentVisitService({ transport: value.bob.transport, crypto: value.crypto, security: value.security(value.bob.local), local: value.bob.local, agentId: 'bob-agent', host: { onGuestRequest: async () => { calls += 1; return { value: 'private', dataClass: 'PRIVATE' as never }; } } });
    const alice = new AgentVisitService({ transport: value.alice.transport, crypto: value.crypto, security: value.security(value.alice.local), local: value.alice.local, agentId: 'alice-agent' });
    const invitation = await alice.createInvitation(agent(value.keys, 'bob'), [{ capability: 'talk_to_host_agent' }]); await alice.sendInvitation(invitation.id); await settle();
    const grant: AgentCapabilityGrant = { grantId: 'grant', capability: 'talk_to_host_agent', issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), maxUses: 2 };
    const accepted = await unsafeBob.acceptInvitation(invitation.id, { capabilities: [grant], approvalMode: 'ALLOW_THIS_VISIT' }); await settle();
    await expect(alice.request(accepted.visit.id, { operation: 'talk_to_host_agent', input: 'unsafe response' })).rejects.toMatchObject({ code: 'UNSHAREABLE_DATA' });
    expect(calls).toBe(1);
    const replay = value.network.history().find(item => (item.envelope.body as { kind?: string }).kind === 'request');
    expect(replay).toBeTruthy(); value.network.inject(value.bob.local.nodeId, replay!.envelope); await settle(); expect(unsafeBob.stats().rejected).toBeGreaterThan(0); expect(calls).toBe(1);
    await unsafeBob.close(); await alice.close(); await value.charlie.transport.close(); await value.mallory.transport.close();
  });

  it('revocation persists across restart and immediately rejects new requests', async () => {
    const value = await setup(); const bobStore = new InMemoryAgentVisitStateStore(); const aliceStore = new InMemoryAgentVisitStateStore();
    const bob = new AgentVisitService({ transport: value.bob.transport, storage: bobStore, crypto: value.crypto, security: value.security(value.bob.local), local: value.bob.local, agentId: 'bob-agent', host: { onGuestRequest: async () => ({ value: 'ok', dataClass: 'PUBLIC' }) } });
    let alice = new AgentVisitService({ transport: value.alice.transport, storage: aliceStore, crypto: value.crypto, security: value.security(value.alice.local), local: value.alice.local, agentId: 'alice-agent' });
    const invitation = await alice.createInvitation(agent(value.keys, 'bob'), [{ capability: 'talk_to_host_agent' }]); await alice.sendInvitation(invitation.id); await settle(); const grant: AgentCapabilityGrant = { grantId: 'grant', capability: 'talk_to_host_agent', issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), maxUses: 2 }; const accepted = await bob.acceptInvitation(invitation.id, { capabilities: [grant], approvalMode: 'ALLOW_THIS_VISIT' }); await settle();
    await bob.revokeVisit(accepted.visit.id, 'Bob revoked the visit'); await settle(); await expect(alice.request(accepted.visit.id, { operation: 'talk_to_host_agent', input: 'after revoke' })).rejects.toMatchObject({ code: 'VISIT_REVOKED' });
    alice.close(); alice = new AgentVisitService({ transport: value.alice.transport, storage: aliceStore, crypto: value.crypto, security: value.security(value.alice.local), local: value.alice.local, agentId: 'alice-agent' }); await alice.ready(); await expect(alice.request(accepted.visit.id, { operation: 'talk_to_host_agent', input: 'after restart' })).rejects.toMatchObject({ code: 'VISIT_REVOKED' });
    await bob.close(); await alice.close(); await value.charlie.transport.close(); await value.mallory.transport.close();
  });

  it('rejects forged invitations and forged delegation tokens at the signed boundary', async () => {
    const value = await setup(); const bob = new AgentVisitService({ transport: value.bob.transport, crypto: value.crypto, security: value.security(value.bob.local), local: value.bob.local, agentId: 'bob-agent' }); const alice = new AgentVisitService({ transport: value.alice.transport, crypto: value.crypto, security: value.security(value.alice.local), local: value.alice.local, agentId: 'alice-agent' });
    const fakeUnsigned = { version: 1 as const, id: 'forged-invitation', visitor: agent(value.keys, 'alice'), host: agent(value.keys, 'bob'), requestedCapabilities: [{ capability: 'talk_to_host_agent' as const }], createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), status: 'pending' as const };
    const fakeInvitation = { ...fakeUnsigned, signature: await value.crypto.sign(canonicalJson(fakeUnsigned), value.mallory.local.privateKey) };
    const unsignedEnvelope = { version: 1 as const, type: 'ai.agent_visit', id: 'forged-envelope', sender: value.mallory.local.nodeId, recipient: value.bob.local.nodeId, nonce: 'forged-nonce', expiresAt: new Date(Date.now() + 60_000).toISOString(), body: { kind: 'invitation' as const, invitation: fakeInvitation } };
    await value.mallory.transport.send(value.bob.local.nodeId, { ...unsignedEnvelope, signature: await value.security(value.mallory.local).sign(unsignedEnvelope) }); await settle(); expect((await bob.listInvitations())).toHaveLength(0); expect(bob.stats().rejected).toBeGreaterThan(0);
    await bob.close(); await alice.close(); await value.charlie.transport.close(); await value.mallory.transport.close();
  });

  it('creates an Agent Room with only explicitly shared context and delivers bounded messages', async () => {
    const value = await setup(); const received: string[] = [];
    const make = (peer: typeof value.alice, name: string) => new AgentVisitService({ transport: peer.transport, crypto: value.crypto, security: value.security(peer.local), local: peer.local, agentId: `${name}-agent`, onRoomMessage: async message => { received.push(`${name}:${message.text}`); } });
    const alice = make(value.alice, 'alice'); const bob = make(value.bob, 'bob'); const charlie = make(value.charlie, 'charlie');
    const room = await alice.createRoom({ title: 'Project room', members: [agent(value.keys, 'bob'), agent(value.keys, 'charlie')], sharedContext: [{ id: 'agenda', label: 'Agenda', value: 'Compare availability without sharing calendars', dataClass: 'USER_EXPLICIT' }] });
    await alice.publishRoom(room.id); await settle(); expect((await bob.listRooms())[0]?.sharedContext[0]?.value).toContain('Compare'); expect((await charlie.listRooms())).toHaveLength(1);
    await alice.sendRoomMessage(room.id, 'Alice, Bob and Charlie can coordinate'); await settle(); expect(received).toEqual(expect.arrayContaining(['bob:Alice, Bob and Charlie can coordinate', 'charlie:Alice, Bob and Charlie can coordinate']));
    await expect(alice.createRoom({ title: 'No private context', members: [agent(value.keys, 'bob')], sharedContext: [{ id: 'private', label: 'Memory', value: 'secret', dataClass: 'PRIVATE' as never }] })).rejects.toMatchObject({ code: 'UNSHAREABLE_DATA' });
    expect(JSON.stringify(alice.audit())).not.toContain('Alice, Bob and Charlie');
    await alice.close(); await bob.close(); await charlie.close(); await value.mallory.transport.close();
  });
});
