import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalJson, SodiumCryptoProvider } from '../crypto.js';
import { ContentCache, ContentFetcher, contentUri, createContentManifest, type ContentManifest, type ContentProvider } from '../social/content.js';
import { StreamingPlaybackSource } from '../social/music.js';
import { VideoPlaybackSource } from '../social/video.js';
import { buildShortFeed } from '../social/shorts.js';
import { LocalDiscoveryIndex } from '../social/discovery.js';
import { DistributedHarness, settle } from './distributed-harness.js';
import { FileTransferManager, type FileProviderDirectory } from '../social/files.js';
import { createUnifiedContextSources, UnifiedContextResolver } from '../ai/context.js';

const roots: string[] = [];
afterEach(async () => { await settle(); await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function harness(names = ['alice', 'bob', 'mallory']) { const root = await mkdtemp(join(tmpdir(), 'keystone-distributed-')); roots.push(root); return DistributedHarness.create(root, names); }
async function eventually(check: () => Promise<boolean>, attempts = 40): Promise<void> { for (let index = 0; index < attempts; index += 1) { if (await check()) return; await settle(); } throw new Error('Condition did not converge'); }

class BytesProvider implements ContentProvider {
  calls = 0;
  constructor(readonly id: string, private readonly source: Uint8Array, private readonly manifest: ContentManifest, private readonly failure?: { index: number; corrupt?: boolean }) {}
  async getChunk(_contentId: ContentManifest['contentId'], index: number): Promise<Uint8Array> {
    this.calls++; if (this.failure?.index === index && !this.failure.corrupt) throw new Error('interrupted provider');
    const value = this.source.subarray(index * this.manifest.chunkSize, Math.min(this.source.length, (index + 1) * this.manifest.chunkSize));
    return this.failure?.index === index && this.failure.corrupt ? Uint8Array.from(value, byte => byte ^ 0xff) : value;
  }
}

describe('distributed harness: production protocol services over a controlled transport boundary', () => {
  it('replicates a generic shared Calendar with offline delivery, RSVP, privacy and restart state', async () => {
    const network = await harness(['alice', 'bob', 'charlie', 'mallory']); const alice = network.node('alice'); const bob = network.node('bob'); const charlie = network.node('charlie'); const mallory = network.node('mallory');
    const calendar = await alice.calendar.createCalendar({ id: 'calendar-phase51', name: 'Project schedule', visibility: 'shared', timezone: 'Europe/Moscow', members: [{ identityId: bob.keys.nodeId, role: 'editor', disclosure: 'FULL_EVENT' }, { identityId: charlie.keys.nodeId, role: 'viewer', disclosure: 'FREE_BUSY' }] }); await settle();
    expect((await bob.calendar.getCalendar(calendar.id, bob.keys.nodeId))?.id).toBe(calendar.id);
    const event = await alice.calendar.createEvent(calendar.id, { id: 'calendar-event-phase51', title: 'Design review', description: 'Shared details', start: '2026-08-20T10:00:00.000Z', end: '2026-08-20T11:00:00.000Z', visibility: 'shared', participants: [{ identityId: bob.keys.nodeId }] }); await settle();
    expect((await bob.calendar.getEvent(event.id, bob.keys.nodeId))?.title).toBe('Design review'); expect((await charlie.calendar.getEvent(event.id, charlie.keys.nodeId))?.title).toBe('BUSY');
    const rsvp = await bob.calendar.respond(event.id, 'ACCEPTED'); await settle(); await alice.calendarReplication.flush(bob.keys.nodeId); expect((await alice.calendar.getEvent(event.id))?.participants.find(value => value.identityId === bob.keys.nodeId)?.rsvp).toBe('ACCEPTED'); void rsvp;
    network.network.setOnline(bob.keys.nodeId, false); const offlineEvent = await alice.calendar.createEvent(calendar.id, { id: 'calendar-event-offline', title: 'Offline delivery', start: '2026-08-21T10:00:00.000Z', end: '2026-08-21T11:00:00.000Z' }); expect(alice.calendarReplication.pendingCount(bob.keys.nodeId)).toBeGreaterThan(0); network.network.setOnline(bob.keys.nodeId, true); await alice.calendarReplication.flush(bob.keys.nodeId); await settle(); expect((await bob.calendar.getEvent(offlineEvent.id, bob.keys.nodeId))?.id).toBe(offlineEvent.id);
    const replay = network.network.history().find(value => value.envelope.type === 'social.calendar' && (value.envelope.body as { targetId?: string }).targetId === offlineEvent.id); expect(replay).toBeDefined(); if (replay) network.network.inject(bob.keys.nodeId, replay.envelope); await settle(); expect((await bob.calendar.getEvent(offlineEvent.id, bob.keys.nodeId))?.title).toBe('Offline delivery');
    const restartedBob = await network.restart('bob'); expect((await restartedBob.calendar.getEvent(offlineEvent.id, restartedBob.keys.nodeId))?.id).toBe(offlineEvent.id); await expect(charlie.calendar.getEvent(event.id, mallory.keys.nodeId)).resolves.toBeUndefined(); await network.close();
  });

  it('resolves an authorized Alice context across a replicated DM and Shared Space task', async () => {
    const network = await harness(['alice', 'bob', 'mallory']); const alice = network.node('alice'), bob = network.node('bob'), mallory = network.node('mallory');
    const conversation = await alice.messages.createConversation(bob.keys.nodeId); await settle();
    const message = await bob.messages.sendText(alice.keys.nodeId, 'Trip itinerary: book the quiet hotel'); await settle();
    const space = await alice.spaces.createSpace({ title: 'Trip', description: 'Shared trip plan', members: [{ identityId: bob.keys.nodeId, role: 'editor' }] });
    const list = await alice.spaces.createTaskList(space.id, { title: 'Trip tasks' }); const task = await alice.spaces.createTask(space.id, { listId: list.id, title: 'Book the quiet hotel', description: 'Use the itinerary Bob sent' });
    const resolver = new UnifiedContextResolver({ viewerId: alice.keys.nodeId, sources: createUnifiedContextSources({ messages: alice.messages, spaces: alice.spaces }, alice.keys.nodeId) }); await resolver.refresh();
    const result = await resolver.resolve({ text: 'Bob trip itinerary hotel' });
    expect(result.citations.map(value => value.objectId)).toEqual(expect.arrayContaining([message.id, task.id]));
    expect(result.citations.every(value => value.permissionScope)).toBe(true);
    const malloryResolver = new UnifiedContextResolver({ viewerId: mallory.keys.nodeId, sources: createUnifiedContextSources({ messages: mallory.messages, spaces: mallory.spaces }, mallory.keys.nodeId) }); await malloryResolver.refresh();
    const malloryResult = await malloryResolver.resolve({ text: 'Bob trip itinerary hotel' }); expect(malloryResult.citations.map(value => value.objectId)).not.toContain(message.id); expect(malloryResult.citations.map(value => value.objectId)).not.toContain(task.id);
    await network.close(); void conversation;
  });

  it('delivers a signed encrypted direct message and persists both independent nodes across restart', async () => {
    const network = await harness(['alice', 'bob']); const alice = network.node('alice'), bob = network.node('bob');
    const sent = await alice.messages.sendText(bob.keys.nodeId, 'Hello Bob'); await settle(); const conversation = await alice.messages.createConversation(bob.keys.nodeId);
    expect((await bob.messages.history(conversation.id)).map(message => message.payload.kind === 'text' ? message.payload.text : '')).toEqual(['Hello Bob']);
    const restartedBob = await network.restart('bob'); const restartedAlice = await network.restart('alice');
    expect((await restartedBob.messages.history(conversation.id)).map(message => message.id)).toEqual([sent.id]);
    expect((await restartedAlice.messages.history(conversation.id)).map(message => message.id)).toEqual([sent.id]);
    await network.close();
  });

  it('runs a bounded signed agent visit and room without exposing private context', async () => {
    const network = await harness(['alice', 'bob', 'charlie', 'mallory']); const alice = network.node('alice'), bob = network.node('bob'), charlie = network.node('charlie'), mallory = network.node('mallory');
    const invitation = await alice.visits.createInvitation({ agentId: 'bob-agent', identityId: bob.keys.nodeId }, [{ capability: 'talk_to_host_agent' }]); await alice.visits.sendInvitation(invitation.id); await settle();
    expect((await bob.visits.listInvitations()).map(value => value.id)).toContain(invitation.id);
    const accepted = await bob.visits.acceptInvitation(invitation.id, { approvalMode: 'ALLOW_THIS_VISIT', capabilities: [{ grantId: 'talk', capability: 'talk_to_host_agent', issuedAt: new Date().toISOString(), expiresAt: invitation.expiresAt, maxUses: 2 }] }); await settle();
    const result = await alice.visits.request(accepted.visit.id, { operation: 'talk_to_host_agent', input: 'public coordination' }); expect(result).toMatchObject({ dataClass: 'PUBLIC', value: 'bob accepted' });
    await expect(alice.visits.request(accepted.visit.id, { operation: 'read_private_memory', input: 'private Memory', dataClass: 'PRIVATE' })).rejects.toMatchObject({ code: 'UNSHAREABLE_DATA' });
    const replay = network.network.history().find(value => value.envelope.type === 'ai.agent_visit' && (value.envelope.body as { kind?: string }).kind === 'request'); expect(replay).toBeDefined(); if (replay) network.network.inject(bob.keys.nodeId, replay.envelope); await settle(); expect(bob.visits.stats().rejected).toBeGreaterThan(0);
    const forged = { version: 1 as const, type: 'ai.agent_visit', id: 'forged-envelope', sender: mallory.keys.nodeId, recipient: bob.keys.nodeId, nonce: 'forged-nonce', expiresAt: new Date(Date.now() + 60_000).toISOString(), body: { kind: 'invitation', invitation: { id: 'forged-visit', visitor: { agentId: 'alice-agent', identityId: alice.keys.nodeId }, host: { agentId: 'bob-agent', identityId: bob.keys.nodeId } } }, signature: 'invalid' } as never;
    network.network.inject(bob.keys.nodeId, forged); await settle(); expect(bob.visits.stats().rejected).toBeGreaterThan(0);
    await bob.visits.revokeVisit(accepted.visit.id, 'revoked'); for (let attempt = 0; attempt < 20; attempt += 1) { if ((await alice.visits.listVisits()).find(value => value.id === accepted.visit.id)?.status === 'revoked') break; await settle(); } expect((await alice.visits.listVisits()).find(value => value.id === accepted.visit.id)?.status).toBe('revoked');
    await expect(alice.visits.request(accepted.visit.id, { operation: 'talk_to_host_agent', input: 'after revoke' })).rejects.toMatchObject({ code: 'VISIT_REVOKED' });
    const room = await alice.visits.createRoom({ title: 'bounded room', members: [{ agentId: 'bob-agent', identityId: bob.keys.nodeId }, { agentId: 'charlie-agent', identityId: charlie.keys.nodeId }], sharedContext: [{ id: 'scope', label: 'Scope', value: 'public coordination', dataClass: 'USER_EXPLICIT' }] }); await alice.visits.publishRoom(room.id); await settle(); expect((await bob.visits.listRooms()).some(value => value.id === room.id)).toBe(true); expect((await charlie.visits.listRooms()).some(value => value.id === room.id)).toBe(true); await alice.visits.sendRoomMessage(room.id, 'room message'); await settle();
    expect((await mallory.visits.listRooms()).some(value => value.id === room.id)).toBe(false);
    const restartedAlice = await network.restart('alice'); expect((await restartedAlice.visits.listVisits()).find(value => value.id === accepted.visit.id)?.status).toBe('revoked'); await network.close();
  });

  it('delivers asynchronous Agent Social tasks after offline/reconnect and keeps only explicit context', async () => {
    const network = await harness(['alice', 'bob', 'charlie', 'mallory']); const alice = network.node('alice'), bob = network.node('bob'), charlie = network.node('charlie'), mallory = network.node('mallory');
    const bobRef = { agentId: 'bob-agent', identityId: bob.keys.nodeId };
    network.network.setOnline(bob.keys.nodeId, false);
    const task = await alice.agentSocial.createTask({ recipient: bobRef, taskType: 'availability', prompt: 'Can Bob meet tomorrow?', explicitContext: [{ id: 'window', label: 'Explicit time window', value: 'tomorrow 10:00', dataClass: 'USER_EXPLICIT' }] });
    expect((await alice.agentSocial.snapshot()).outbox.length).toBe(1);
    network.network.setOnline(bob.keys.nodeId, true); await alice.agentSocial.flush(bob.keys.nodeId); await settle();
    expect((await bob.agentSocial.listInbox()).some(value => value.taskId === task.taskId)).toBe(true);
    await eventually(() => alice.agentSocial.listResponses().then(values => values.some(value => value.taskId === task.taskId && value.status === 'completed')));
    const room = await alice.agentSocial.createAsyncRoom({ title: 'Async research', members: [{ agentId: 'bob-agent', identityId: bob.keys.nodeId }, { agentId: 'charlie-agent', identityId: charlie.keys.nodeId }], sharedContext: [{ id: 'scope', label: 'Shared scope', value: 'public research only', dataClass: 'PUBLIC' }] }); await alice.agentSocial.flush(); await settle();
    expect((await bob.agentSocial.listRooms()).some(value => value.id === room.id)).toBe(true); expect((await charlie.agentSocial.listRooms()).some(value => value.id === room.id)).toBe(true);
    await alice.agentSocial.addRoomContribution(room.id, { text: 'Alice contribution', context: [{ id: 'source', label: 'Explicit source', value: 'paper-1', dataClass: 'USER_EXPLICIT' }] }); await alice.agentSocial.flush(); await settle(); expect((await bob.agentSocial.listContributions(room.id)).length).toBe(1);
    await expect(alice.agentSocial.createTask({ recipient: bobRef, taskType: 'custom', prompt: 'read my Memory', explicitContext: [{ id: 'memory', label: 'Private Memory', value: 'secret', dataClass: 'PRIVATE' as never }] })).rejects.toMatchObject({ code: 'UNSHAREABLE_DATA' });
    const restartedBob = await network.restart('bob'); expect((await restartedBob.agentSocial.listInbox()).some(value => value.taskId === task.taskId)).toBe(true);
    await restartedBob.agentSocial.setTrustPolicy({ blockedIdentityIds: [mallory.keys.nodeId] }); const spoof = await mallory.agentSocial.createTask({ recipient: bobRef, taskType: 'custom', prompt: 'spoof', explicitContext: [{ id: 'x', label: 'x', value: 'x', dataClass: 'PUBLIC' }] }); await mallory.agentSocial.flush(bob.keys.nodeId); await settle(); expect((await restartedBob.agentSocial.listInbox()).some(value => value.taskId === spoof.taskId)).toBe(false); expect(restartedBob.agentSocial.audit().some(value => value.outcome === 'denied')).toBe(true);
    await network.close();
  });

  it('reaches a private-constraint consensus through the asynchronous negotiation service', async () => {
    const network = await harness(['alice', 'bob', 'charlie', 'mallory']); const alice = network.node('alice'), bob = network.node('bob'), charlie = network.node('charlie');
    network.network.setOnline(bob.keys.nodeId, false);
    const session = await alice.agentNegotiation.createSession({ title: 'Common meeting window', category: 'coordination', participants: [{ agentId: 'bob-agent', identityId: bob.keys.nodeId }, { agentId: 'charlie-agent', identityId: charlie.keys.nodeId }], strategy: 'UNANIMOUS', disclosureDefault: 'BOOLEAN', constraints: [{ id: 'calendar', label: 'Local calendar availability', dataClass: 'PRIVATE', disclosure: 'RANGE', localOnly: true }] });
    const proposal = await alice.agentNegotiation.propose(session.id, { options: [{ id: 'fri-18', label: 'Friday 18:00', dataClass: 'PUBLIC' }, { id: 'sat-18', label: 'Saturday 18:00', dataClass: 'PUBLIC' }] });
    expect((await alice.agentSocial.snapshot()).outbox.length).toBeGreaterThan(0);
    network.network.setOnline(bob.keys.nodeId, true); await alice.agentNegotiation.flush(); await eventually(async () => (await charlie.agentNegotiation.listResponses(session.id)).length === 1); await eventually(async () => (await bob.agentNegotiation.listResponses(session.id)).length === 1); await bob.agentNegotiation.flush(alice.keys.nodeId); await settle();
    const result = await alice.agentNegotiation.finalize(session.id); expect(result.status).toBe('completed'); expect(result.selectedOptionIds).toEqual(['sat-18']); await settle();
    expect((await bob.agentNegotiation.listResults()).some(value => value.id === result.id)).toBe(true); expect(JSON.stringify(network.network.history())).not.toContain('calendar-private-value'); expect(JSON.stringify(await bob.agentNegotiation.snapshot())).not.toContain('calendar-private-value');
    const restartedBob = await network.restart('bob'); expect((await restartedBob.agentNegotiation.listResults()).some(value => value.id === result.id)).toBe(true); expect((await restartedBob.agentNegotiation.listProposals(session.id)).some(value => value.id === proposal.id)).toBe(true); await network.close();
  });

  it('replicates Shared Space CRDT edits, encrypted epochs, agent grants, and durable restart state', async () => {
    const network = await harness(['alice', 'bob', 'charlie', 'mallory']); const alice = network.node('alice'), bob = network.node('bob'), charlie = network.node('charlie'), mallory = network.node('mallory');
    const space = await alice.spaces.createSpace({ title: 'Trip', description: 'Collaborative plan', members: [{ identityId: bob.keys.nodeId, role: 'editor' }, { identityId: charlie.keys.nodeId, role: 'editor' }] });
    const document = await alice.spaces.createDocument(space.id, { title: 'Plan', body: 'start' }); await alice.spaces.publish(space.id); await settle();
    expect(bob.spaces.getSpace(space.id)?.id).toBe(space.id); expect(charlie.spaces.listDocuments(space.id)[0]?.body).toBe('start');
    const fileReference = await alice.spaces.attachFileReference(space.id, { fileId: 'file-object-1', contentUri: 'keystone://content/sha256-example', filename: 'plan.txt', mimeType: 'text/plain', size: 12, visibility: 'public' }); await settle(); await alice.spaces.publish(space.id); await settle(); expect(bob.spaces.listFileReferences(space.id).map(value => value.fileId)).toContain(fileReference.fileId);
    network.network.partition(bob.keys.nodeId, charlie.keys.nodeId, true); await bob.spaces.updateDocument(space.id, document.id, { body: 'Bob edit' }); await charlie.spaces.updateDocument(space.id, document.id, { title: 'Charlie edit' }); await settle(); await alice.spaces.publish(space.id); await settle();
    expect(bob.spaces.listDocuments(space.id)[0]).toMatchObject({ body: 'Bob edit', title: 'Charlie edit' }); expect(charlie.spaces.listDocuments(space.id)[0]).toMatchObject({ body: 'Bob edit', title: 'Charlie edit' });
    const restartedBob = await network.restart('bob'); expect(restartedBob.spaces.listDocuments(space.id)[0]).toMatchObject({ body: 'Bob edit', title: 'Charlie edit' });
    const privateSpace = await alice.spaces.createSpace({ title: 'Private Trip', description: 'encrypted', visibility: 'private', members: [{ identityId: bob.keys.nodeId, role: 'editor' }] }); await alice.spaces.publish(privateSpace.id); await settle(); const privateDoc = await alice.spaces.createDocument(privateSpace.id, { title: 'Secret', body: 'only members' }); await settle(); expect(restartedBob.spaces.listDocuments(privateSpace.id)[0]?.body).toBe('only members');
    await alice.spaces.removeMember(privateSpace.id, bob.keys.nodeId); await settle(); expect(() => restartedBob.spaces.listDocuments(privateSpace.id)).toThrow(); await expect(restartedBob.spaces.updateDocument(privateSpace.id, privateDoc.id, { body: 'spoof' })).rejects.toThrow();
    const forged = { version: 1 as const, type: 'social.shared_space', id: crypto.randomUUID(), sender: mallory.keys.nodeId, recipient: alice.keys.nodeId, nonce: crypto.randomUUID(), expiresAt: new Date(Date.now() + 60_000).toISOString(), body: { kind: 'space', space }, signature: 'invalid' } as never; network.network.inject(alice.keys.nodeId, forged); await settle(); expect(alice.spaces.rejectionCount()).toBeGreaterThan(0); await network.close();
  });

  it('queues exact offline delivery, tolerates duplicate/reordered envelopes, and persists replay protection', async () => {
    const network = await harness(['alice', 'bob']); const alice = network.node('alice'), bob = network.node('bob');
    network.network.setOnline(bob.keys.nodeId, false);
    const sent = []; for (const text of ['Message 1', 'Message 2', 'Message 3']) sent.push(await alice.messages.sendText(bob.keys.nodeId, text));
    expect((await alice.messageStorage.pending(bob.keys.nodeId)).length).toBe(3);
    network.network.setOnline(bob.keys.nodeId, true); await alice.messages.flush(bob.keys.nodeId); await settle();
    const conversation = await alice.messages.createConversation(bob.keys.nodeId);
    expect((await bob.messages.history(conversation.id)).map(message => message.id)).toEqual(sent.map(message => message.id));
    const replay = network.network.history().find(value => value.envelope.type === 'social.message');
    if (replay) network.network.inject(bob.keys.nodeId, replay.envelope);
    await settle(); expect((await bob.messages.history(conversation.id)).length).toBe(3);
    const restarted = await network.restart('bob');
    if (replay) network.network.inject(restarted.keys.nodeId, replay.envelope);
    await settle(); expect((await restarted.messages.history(conversation.id)).length).toBe(3);
    await network.close();
  });

  it('runs a persistent signed group conversation with offline delivery, roles, unread state, and content references', async () => {
    const network = await harness(['alice', 'bob', 'charlie', 'mallory']); const alice = network.node('alice'), bob = network.node('bob'), charlie = network.node('charlie'), mallory = network.node('mallory');
    const group = await alice.groups.create({ title: 'Keystone crew', members: [bob.keys.nodeId, charlie.keys.nodeId] }); await settle();
    expect((await bob.groups.list()).map(value => value.id)).toEqual([group.id]); expect((await charlie.groups.get(group.id))?.id).toBe(group.id); expect((await bob.groups.get(group.id))?.adminIds).toEqual([alice.keys.nodeId]);
    await expect(bob.groups.addMember(group.id, mallory.keys.nodeId)).rejects.toThrow('Administrator role required');
    const first = await alice.groups.sendText(group.id, 'Hello everyone'); await settle(); expect((await bob.groups.history(group.id)).map(value => value.id)).toContain(first.id); expect((await charlie.groups.history(group.id)).map(value => value.id)).toContain(first.id);
    const replay = network.network.history().find(value => value.to === bob.keys.nodeId && value.envelope.type === 'social.message'); if (replay) { network.network.inject(bob.keys.nodeId, replay.envelope); network.network.inject(bob.keys.nodeId, replay.envelope); await settle(); } expect((await bob.groups.history(group.id)).filter(value => value.id === first.id)).toHaveLength(1);
    network.network.setOnline(charlie.keys.nodeId, false); const second = await alice.groups.sendText(group.id, 'While Charlie is offline'); await settle(); expect((await bob.groups.history(group.id)).map(value => value.id)).toContain(second.id); expect((await charlie.groups.history(group.id)).map(value => value.id)).not.toContain(second.id);
    network.network.setOnline(charlie.keys.nodeId, true); await alice.messages.flush(charlie.keys.nodeId); await settle(); expect((await charlie.groups.history(group.id)).map(value => value.id)).toContain(second.id);
    const reply = await bob.groups.sendText(group.id, 'Reply', { replyTo: first.id, quote: { messageId: first.id, text: 'Hello everyone' } }); const reaction = await bob.groups.react(group.id, first.id, '👍'); const edited = await bob.groups.editText(group.id, reply.id, 'Edited reply'); const deleted = await alice.groups.deleteMessage(group.id, first.id); await settle();
    expect(reply.payload.kind === 'text' && reply.payload.replyTo).toBe(first.id); expect(reaction.payload.kind === 'reaction' && reaction.payload.targetMessageId).toBe(first.id); expect(edited.supersedes).toBe(reply.id); expect(deleted.deleted).toBe(true); expect((await charlie.groups.history(group.id)).map(value => value.id)).toEqual(expect.arrayContaining([reply.id, reaction.id, edited.id, deleted.id]));
    expect((await bob.groups.get(group.id))?.unreadCount).toBeGreaterThan(0); await bob.groups.markRead(group.id, deleted.id); expect((await bob.groups.get(group.id))?.unreadCount).toBe(0);
    await alice.groups.typing(group.id, true); await settle(); expect(bob.messages.typingPeers(group.id)).toContain(alice.keys.nodeId); await alice.groups.typing(group.id, false); await settle(); expect(bob.messages.typingPeers(group.id)).not.toContain(alice.keys.nodeId);
    const manifest = await createContentManifest(Uint8Array.from({ length: 1024 }, (_, index) => index % 251), { mimeType: 'application/octet-stream' }); const attachment = { contentUri: contentUri(manifest.contentId), name: 'file.bin', mimeType: 'application/octet-stream', size: manifest.byteLength }; const attachmentMessage = await alice.groups.sendAttachments(group.id, [attachment], { caption: 'shared file' }); await settle(); expect((await charlie.groups.history(group.id)).some(value => value.id === attachmentMessage.id && value.payload.kind === 'attachment')).toBe(true);
    await expect(mallory.groups.sendText(group.id, 'spoof')).rejects.toThrow('Not a conversation member');
    await alice.groups.addMember(group.id, mallory.keys.nodeId); await settle(); expect((await mallory.groups.get(group.id))?.members).toContain(mallory.keys.nodeId); await alice.groups.removeMember(group.id, mallory.keys.nodeId); await settle(); expect((await mallory.groups.get(group.id))?.members).not.toContain(mallory.keys.nodeId);
    const restarted = await network.restart('charlie'); expect((await restarted.groups.get(group.id))?.members).toEqual(group.members); expect((await restarted.groups.history(group.id)).map(value => value.id)).toContain(second.id); await network.close();
  });

  it('orders logical messages after physical reordering and rejects invalid signatures, malformed input, and author spoofing', async () => {
    const network = await harness(['alice', 'bob', 'mallory']); const alice = network.node('alice'), bob = network.node('bob'), mallory = network.node('mallory');
    network.network.pauseDelivery(); const sent = [];
    for (const text of ['1', '2', '3', '4', '5']) sent.push(await alice.messages.sendText(bob.keys.nodeId, text));
    const unique = [...new Map(network.network.pending().filter(value => value.envelope.type === 'social.message').map(value => [value.envelope.id, value])).values()];
    network.network.clearPending(); network.network.pauseDelivery(false);
    for (const index of [3, 1, 4, 0, 2]) network.network.inject(bob.keys.nodeId, unique[index]!.envelope);
    await settle();
    const conversation = await alice.messages.createConversation(bob.keys.nodeId);
    expect((await bob.messages.history(conversation.id)).map(message => message.payload.kind === 'text' ? message.payload.text : '')).toEqual(['1', '2', '3', '4', '5']);
    const wire = network.network.history().find(value => value.envelope.type === 'social.message') ?? { envelope: { version: 1 as const, type: 'social.message', id: crypto.randomUUID(), sender: alice.keys.nodeId, recipient: bob.keys.nodeId, nonce: crypto.randomUUID(), expiresAt: new Date(Date.now() + 60_000).toISOString(), body: {}, signature: 'invalid' } };
    network.network.inject(bob.keys.nodeId, { ...wire.envelope, nonce: crypto.randomUUID(), signature: 'invalid' });
    network.network.inject(bob.keys.nodeId, { ...wire.envelope, nonce: crypto.randomUUID(), sender: mallory.keys.nodeId });
    network.network.inject(bob.keys.nodeId, { ...wire.envelope, nonce: crypto.randomUUID(), body: { malformed: true } });
    await settle(); expect((await bob.messages.history(conversation.id)).map(message => message.id)).toEqual(sent.map(message => message.id));
    await network.close();
  });

  it('replicates signed community create/invite/role/channel/message and rejects unauthorized moderation effects', async () => {
    const network = await harness(); const alice = network.node('alice'), bob = network.node('bob'), mallory = network.node('mallory');
    const community = await alice.communities.createCommunity({ name: 'Keystone test' });
    const role = await alice.communities.createRole(community.id, { name: 'Moderator', permissions: ['create_channel', 'post_message', 'moderate'] });
    const invite = await alice.communities.invite(community.id, bob.keys.nodeId, [role.payload.roleId]);
    for (const event of [community, role, invite]) await alice.communityReplication.publish(bob.keys.nodeId, event);
    await settle(); const channel = await bob.communities.createChannel(community.id, { name: 'general', kind: 'text' }); await bob.communityReplication.publish(alice.keys.nodeId, channel);
    const message = await bob.communities.postMessage(community.id, channel.payload.channelId, 'Hello community'); await bob.communityReplication.publish(alice.keys.nodeId, message);
    for (const event of [community, role, invite, channel]) await mallory.communities.ingest(event);
    const unsigned = { version: 1 as const, type: 'community_message' as const, id: crypto.randomUUID(), author: mallory.keys.nodeId, createdAt: new Date().toISOString(), visibility: 'community' as const, references: [{ id: community.id, type: 'community' as const }, { id: channel.payload.channelId, type: 'channel' as const }], payload: { communityId: community.id, channelId: channel.payload.channelId, messageId: crypto.randomUUID(), text: 'forged community message', trackIds: [], videoIds: [], liveIds: [], logicalClock: 2 } };
    const forged = { ...unsigned, signature: await new SodiumCryptoProvider().sign(canonicalJson(unsigned), mallory.keys.privateKey) };
    await mallory.communityReplication.publish(alice.keys.nodeId, forged);
    await settle(); expect((await alice.communities.messages(community.id, channel.payload.channelId)).map(value => value.payload.text)).toEqual(['Hello community']);
    await mallory.communities.ingest(community); await expect(mallory.communities.moderate(community.id, bob.keys.nodeId, 'ban')).rejects.toThrow('Community permission denied');
    expect((await alice.communities.projection(community.id))?.members.get(bob.keys.nodeId)?.banned).toBe(false);
    await network.close();
  });

  it('resumes content-addressed transfer from verified chunks and rejects corrupt providers without trusting their claimed content id', async () => {
    const source = Uint8Array.from({ length: 96 * 1024 }, (_, index) => index % 251); const manifest = await createContentManifest(source, { mimeType: 'application/octet-stream', chunkSize: 16 * 1024 });
    const cache = new ContentCache(source.length * 2), fetcher = new ContentFetcher(cache);
    await expect(fetcher.download(manifest, [new BytesProvider('interrupted', source, manifest, { index: 3 })])).rejects.toThrow('interrupted provider');
    expect(cache.missing(manifest)).toEqual([3, 4, 5]);
    const result = await fetcher.download(manifest, [new BytesProvider('corrupt', source, manifest, { index: 3, corrupt: true }), new BytesProvider('healthy', source, manifest)]);
    expect(result).toEqual(source); expect(await cache.read(manifest.contentId)).toEqual(source);
  });

  it('keeps one deterministic Track object across direct message, community, library and playlist, then streams it to Bob', async () => {
    const network = await harness(['alice', 'bob']); const alice = network.node('alice'), bob = network.node('bob');
    const artist = await alice.music.createArtist({ name: 'Alice Artist', profileId: alice.keys.nodeId });
    const bytes = Uint8Array.from({ length: 80 * 1024 }, (_, index) => index % 251);
    const imported = await alice.music.importTrack({ bytes, mimeType: 'audio/ogg', name: 'one.ogg', chunkSize: 16 * 1024, title: 'One Track', artistIds: [artist.payload.artistId], durationMs: 60_000, codec: 'opus', explicit: false, rights: { declaredRightsHolder: { name: 'Alice Rights' }, license: 'CC-BY' } }, alice.content);
    const again = await alice.music.importTrack({ bytes, mimeType: 'audio/ogg', name: 'one.ogg', chunkSize: 16 * 1024, title: 'One Track', artistIds: [artist.payload.artistId], durationMs: 60_000, codec: 'opus', explicit: false, rights: { declaredRightsHolder: { name: 'Alice Rights' }, license: 'CC-BY' } }, alice.content);
    expect(again.track.id).toBe(imported.track.id); expect(imported.track.id).toBe(imported.track.payload.trackId);
    const library = await alice.music.saveToLibrary(imported.track.id); const playlist = await alice.music.createPlaylist({ title: 'Alice playlist', trackIds: [], collaborative: false }); const revisedPlaylist = await alice.music.addTrackToPlaylist(playlist, imported.track.id);
    const direct = await alice.messages.sendTrack(bob.keys.nodeId, imported.track.id, imported.track.payload.title); const community = await alice.communities.createCommunity({ name: 'Tracks' }); const channel = await alice.communities.createChannel(community.id, { name: 'music', kind: 'media' }); const post = await alice.communities.postMessage(community.id, channel.payload.channelId, 'Listen', [imported.track.id]);
    await alice.musicReplication.publish(bob.keys.nodeId, artist); await alice.musicReplication.publish(bob.keys.nodeId, imported.track); await alice.communityReplication.publish(bob.keys.nodeId, community); await alice.communityReplication.publish(bob.keys.nodeId, channel); await alice.communityReplication.publish(bob.keys.nodeId, post); await settle();
    const conversation = await alice.messages.createConversation(bob.keys.nodeId); const receivedMessage = (await bob.messages.history(conversation.id))[0]!; const received = (await bob.music.tracks())[0]!;
    expect(direct.references[0]?.id).toBe(imported.track.id); expect(receivedMessage.references[0]?.id).toBe(imported.track.id); expect(post.payload.trackIds).toEqual([imported.track.id]); expect(received.id).toBe(imported.track.id); expect(library.payload.trackId).toBe(imported.track.id); expect(revisedPlaylist.payload.trackIds).toEqual([imported.track.id]);
    const corrupt: ContentProvider = { id: 'corrupt', async getChunk() { return new Uint8Array(16 * 1024); } };
    const bobCache = new ContentCache(bytes.length * 2); const source = new StreamingPlaybackSource(bobCache, { async manifest(id) { return id === imported.manifest.contentId ? imported.manifest : undefined; }, async providers() { return [corrupt, alice.content]; } });
    const first = await source.open(received as Extract<typeof received, { type: 'track' }>); expect(first.chunkIndex).toBe(0); expect(first.bytes).toEqual(bytes.subarray(0, 16 * 1024)); expect(bobCache.missing(imported.manifest)).toEqual([1, 2, 3, 4]);
    const resumed = await source.open(received as Extract<typeof received, { type: 'track' }>, 36_000); expect(resumed.chunkIndex).toBe(3); expect(bobCache.hasChunk(imported.manifest.contentId, 0)).toBe(true); expect(bobCache.hasChunk(imported.manifest.contentId, 3)).toBe(true);
    const restartedAlice = await network.restart('alice'); expect((await restartedAlice.music.library())[0]?.payload.trackId).toBe(imported.track.id); expect((await restartedAlice.music.playlists()).some(value => value.payload.trackIds.includes(imported.track.id))).toBe(true); await network.close();
  });

  it('keeps one deterministic Video object across direct message and community, then range-streams it to Bob', async () => {
    const network = await harness(['alice', 'bob']); const alice = network.node('alice'), bob = network.node('bob'); const bytes = Uint8Array.from({ length: 80 * 1024 }, (_, index) => index % 251);
    const imported = await alice.videos.import({ bytes, mimeType: 'video/webm', name: 'one.webm', chunkSize: 16 * 1024, title: 'One Video', description: 'P2P video', durationMs: 60_000, dimensions: { width: 1280, height: 720 }, videoStream: { codec: 'vp9', container: 'webm' }, audioStream: { codec: 'opus', channels: 2 }, publishedAt: new Date().toISOString(), shortForm: { caption: 'P2P short', aspectRatio: '9:16' } }, alice.videoContent);
    const duplicate = await alice.videos.import({ bytes, mimeType: 'video/webm', name: 'one.webm', chunkSize: 16 * 1024, title: 'One Video', description: 'P2P video', durationMs: 60_000, dimensions: { width: 1280, height: 720 }, videoStream: { codec: 'vp9', container: 'webm' }, audioStream: { codec: 'opus', channels: 2 }, publishedAt: imported.video.payload.publishedAt, shortForm: { caption: 'P2P short', aspectRatio: '9:16' } }, alice.videoContent); expect(duplicate.video.id).toBe(imported.video.id);
    const direct = await alice.messages.sendVideo(bob.keys.nodeId, imported.video.id, imported.video.payload.title); const community = await alice.communities.createCommunity({ name: 'Video' }); const channel = await alice.communities.createChannel(community.id, { name: 'video', kind: 'media' }); const post = await alice.communities.postMessage(community.id, channel.payload.channelId, 'Watch', [], [imported.video.id]);
    await alice.videoReplication.publish(bob.keys.nodeId, imported.video); await alice.communityReplication.publish(bob.keys.nodeId, community); await alice.communityReplication.publish(bob.keys.nodeId, channel); await alice.communityReplication.publish(bob.keys.nodeId, post); await settle(); const received = (await bob.videos.videos())[0]!; const conversation = await alice.messages.createConversation(bob.keys.nodeId);
    expect(received.id).toBe(imported.video.id); expect(received.payload.shortForm?.aspectRatio).toBe('9:16'); expect(buildShortFeed([received]).map(item => item.id)).toEqual([imported.video.id]); expect((await bob.messages.history(conversation.id))[0]?.references[0]?.id).toBe(imported.video.id); expect(post.payload.videoIds).toEqual([imported.video.id]);
    const corrupt: ContentProvider = { id: 'corrupt', async getChunk() { return new Uint8Array(16 * 1024); } }; const cache = new ContentCache(bytes.length * 2); const source = new VideoPlaybackSource(cache, { async manifest(id) { return id === imported.manifest.contentId ? imported.manifest : undefined; }, async providers() { return [corrupt, alice.videoContent]; } }); const first = await source.open(received); expect(first.chunkIndex).toBe(0); expect(cache.missing(imported.manifest)).toEqual([1, 2, 3, 4]); const seek = await source.open(received, 36_000); expect(seek.chunkIndex).toBe(3); const restarted = await network.restart('alice'); expect((await restarted.videos.videos())[0]?.id).toBe(imported.video.id); await network.close();
  });

  it('projects a replicated Video into the receiver local notifications', async () => {
    const network = await harness(['alice', 'bob']); const alice = network.node('alice'), bob = network.node('bob'); const bytes = Uint8Array.from({ length: 16 * 1024 }, (_, index) => index % 251);
    const imported = await bob.videos.import({ bytes, mimeType: 'video/webm', title: 'Bob short', durationMs: 10_000, dimensions: { width: 9, height: 16 }, videoStream: { codec: 'vp9', container: 'webm' }, shortForm: { aspectRatio: '9:16' } }, bob.videoContent);
    await bob.videoReplication.publish(alice.keys.nodeId, imported.video); await settle();
    expect((await alice.notifications.list()).some(item => item.category === 'short' && item.objectId === imported.video.id)).toBe(true);
    await network.close();
  });

  it('propagates signed social graph events, applies block/mute policy, and survives restart', async () => {
    const network = await harness(['alice', 'bob', 'charlie', 'mallory']); const alice = network.node('alice'), bob = network.node('bob'), charlie = network.node('charlie'), mallory = network.node('mallory');
    const profile = await alice.graph.publishProfile({ displayName: 'Alice', handle: 'alice_local', bannerUri: 'keystone://profile/banner', bio: 'local', links: [] }); await alice.graphReplication.publish(bob.keys.nodeId, profile); await settle(); expect((await bob.graph.profile(alice.keys.nodeId))?.id).toBe(profile.id);
    const follow = await alice.graph.follow(bob.keys.nodeId); await alice.graphReplication.publish(bob.keys.nodeId, follow); await settle(); expect(await bob.graph.followers()).toEqual([alice.keys.nodeId]); expect((await bob.notifications.list()).some(item => item.category === 'follow' && item.objectId === follow.id)).toBe(true);
    const replay = network.network.history().find(value => value.envelope.type === 'social.graph_object' && value.from === alice.keys.nodeId && value.to === bob.keys.nodeId); if (replay) network.network.inject(bob.keys.nodeId, replay.envelope); await settle(); expect(await bob.graph.followers()).toEqual([alice.keys.nodeId]);
    const charlieFollow = await charlie.graph.follow(alice.keys.nodeId); await charlie.graphReplication.publish(alice.keys.nodeId, charlieFollow); await settle(); expect((await alice.graph.followers()).includes(charlie.keys.nodeId)).toBe(true); await alice.graph.setBlocked(charlie.keys.nodeId, true); alice.graphReplication.block(charlie.keys.nodeId); await settle(); expect((await alice.graph.followers()).includes(charlie.keys.nodeId)).toBe(false); expect((await alice.notifications.list()).every(item => item.actor !== charlie.keys.nodeId)).toBe(true);
    const spoof = await mallory.graph.follow(alice.keys.nodeId); await mallory.graphReplication.publish(alice.keys.nodeId, spoof); const wire = network.network.history().find(value => value.envelope.type === 'social.graph_object' && value.from === mallory.keys.nodeId && value.to === alice.keys.nodeId); expect(wire).toBeDefined(); if (wire) network.network.inject(alice.keys.nodeId, { ...wire.envelope, body: { object: { ...spoof, payload: { target: bob.keys.nodeId, action: 'follow' } } }, nonce: crypto.randomUUID() }); await settle(); expect(alice.graphReplication.stats().rejected).toBeGreaterThan(0);
    const restartedBob = await network.restart('bob'); expect((await restartedBob.graph.followers()).includes(alice.keys.nodeId)).toBe(true); expect((await restartedBob.notifications.list()).some(item => item.category === 'follow')).toBe(true); await network.close();
  });

  it('replicates one signed Live object to Bob and Charlie, shares it through existing social references, and propagates end state', async () => {
    const network = await harness(['alice', 'bob', 'charlie']); const alice = network.node('alice'), bob = network.node('bob'), charlie = network.node('charlie');
    const artist = await alice.music.createArtist({ name: 'Live Artist', profileId: crypto.randomUUID() });
    const track = await alice.music.createTrack({ title: 'Now playing', artistIds: [artist.payload.artistId], audioUri: 'keystone://content/sha256-' + 'a'.repeat(64), durationMs: 30_000, codec: 'opus', explicit: false, rights: { declaredRightsHolder: { name: 'Live Artist' } } });
    const scheduled = await alice.live.create({ title: 'Alice Live', description: 'Signed P2P session', category: 'music', creatorProfileId: crypto.randomUUID(), trackId: track.payload.trackId, startsAt: new Date().toISOString(), tracks: { audio: true, video: true, screen: false } });
    const live = await alice.live.start(scheduled);
    for (const peer of [bob, charlie]) await alice.liveReplication.publish(peer.keys.nodeId, live);
    await settle();
    expect((await bob.live.getBroadcast(live.payload.broadcastId))?.id).toBe(live.id); expect((await charlie.live.getBroadcast(live.payload.broadcastId))?.id).toBe(live.id);
    const dm = await alice.messages.sendLive(bob.keys.nodeId, live.payload.broadcastId, live.payload.title); expect(dm.references[0]?.id).toBe(live.payload.broadcastId); await settle();
    const community = await alice.communities.createCommunity({ name: 'Live community' }); const channel = await alice.communities.createChannel(community.id, { name: 'live', kind: 'media' }); const post = await alice.communities.postMessage(community.id, channel.payload.channelId, 'We are live', [], [], [live.payload.broadcastId]);
    await alice.communityReplication.publish(bob.keys.nodeId, community); await alice.communityReplication.publish(bob.keys.nodeId, channel); await alice.communityReplication.publish(bob.keys.nodeId, post); await settle();
    expect(post.payload.liveIds).toEqual([live.payload.broadcastId]); const conversation = await alice.messages.createConversation(bob.keys.nodeId); expect((await bob.messages.history(conversation.id))[0]?.references[0]?.id).toBe(live.payload.broadcastId);
    await expect(alice.live.create({ title: 'Missing community', startsAt: new Date().toISOString(), tracks: { audio: true, video: false, screen: false } }, 'community')).rejects.toThrow('community reference');
    const communityLive = await alice.live.start(await alice.live.create({ title: 'Community Live', communityId: community.id, startsAt: new Date().toISOString(), tracks: { audio: true, video: true, screen: false } }, 'community')); await alice.liveReplication.publish(bob.keys.nodeId, communityLive); await settle(); expect((await bob.live.getBroadcast(communityLive.payload.broadcastId))?.visibility).toBe('community');
    const chat = await alice.live.sendChat(live, { text: 'Welcome Bob and Charlie' }); const reaction = await alice.live.react(live, '❤️'); for (const peer of [bob, charlie]) { await alice.liveReplication.publish(peer.keys.nodeId, chat); await alice.liveReplication.publish(peer.keys.nodeId, reaction); }
    await settle(); expect((await bob.live.chats(live.payload.broadcastId)).map(value => value.payload.kind)).toEqual(['message', 'reaction']); expect((await charlie.live.chats(live.payload.broadcastId)).length).toBe(2);
    const ended = await alice.live.end(live); for (const peer of [bob, charlie]) await alice.liveReplication.publish(peer.keys.nodeId, ended); await settle();
    expect((await bob.live.getBroadcast(live.payload.broadcastId))?.payload.state).toBe('ended'); expect((await charlie.live.getBroadcast(live.payload.broadcastId))?.payload.state).toBe('ended'); const restartedBob = await network.restart('bob'); expect((await restartedBob.live.getBroadcast(live.payload.broadcastId))?.payload.state).toBe('ended');
    await expect(alice.liveReplication.publish(bob.keys.nodeId, await alice.live.create({ title: 'Contacts-only', startsAt: new Date().toISOString(), tracks: { audio: true, video: false, screen: false } }, 'contacts'))).rejects.toThrow('encrypted group');
    await network.close();
  });

  it('keeps private direct messages out of public discovery data by construction', async () => {
    const network = await harness(['alice', 'bob']); const alice = network.node('alice'), bob = network.node('bob');
    const message = await alice.messages.sendText(bob.keys.nodeId, 'not public'); await settle();
    expect(message.visibility).toBe('private'); expect((await bob.messageStorage.getMessage(message.id))?.visibility).toBe('private');
    const index = new LocalDiscoveryIndex(); expect(index.index(message)).toBe(false); expect(index.publicAdvertisement()).toEqual([]);
    await network.close();
  });

  it('replicates one public discovery graph to Bob and Charlie without duplicating object ids', async () => {
    const network = await harness(['alice', 'bob', 'charlie', 'mallory']); const alice = network.node('alice'), bob = network.node('bob'), charlie = network.node('charlie'), mallory = network.node('mallory');
    const artist = await alice.music.createArtist({ name: 'Discovery Artist', profileId: alice.keys.nodeId });
    const audio = Uint8Array.from({ length: 32 * 1024 }, (_, index) => index % 251);
    const importedTrack = await alice.music.importTrack({ bytes: audio, mimeType: 'audio/ogg', title: 'Discovery Track', artistIds: [artist.payload.artistId], durationMs: 30_000, codec: 'opus', explicit: false, rights: { declaredRightsHolder: { name: 'Discovery Artist' } } }, alice.content);
    const video = await alice.videos.import({ bytes: audio, mimeType: 'video/webm', title: 'Discovery Short', durationMs: 30_000, dimensions: { width: 720, height: 1280 }, videoStream: { codec: 'vp9', container: 'webm' }, shortForm: { caption: 'Discovery caption', aspectRatio: '9:16' } }, alice.videoContent);
    const live = await alice.live.start(await alice.live.create({ title: 'Discovery Live', category: 'music', startsAt: new Date().toISOString(), tracks: { audio: true, video: true, screen: false } }));
    const community = await alice.communities.createCommunity({ name: 'Discovery Community', description: 'Public P2P community' });
    const objects = [artist, importedTrack.track, video.video, live, community];
    for (const peer of [bob, charlie]) for (const object of objects) await alice.discoveryReplication.publish(peer.keys.nodeId, object);
    await settle();
    await bob.discovery.follow(alice.keys.nodeId);
    const bobHome = await bob.discovery.feed({ surface: 'home', limit: 20 }); const bobSearch = await bob.discovery.search({ query: 'Discovery', scope: 'public', limit: 20 });
    expect(new Set(bobHome.items.map(item => item.object.id)).size).toBe(bobHome.items.length);
    expect(bobHome.items.map(item => item.object.id)).toEqual(expect.arrayContaining([importedTrack.track.id, video.video.id, live.id]));
    expect(bobSearch.items.map(item => item.object.id)).toEqual(expect.arrayContaining([community.id, importedTrack.track.id, video.video.id, live.id]));
    const charlieSearch = await charlie.discovery.search({ query: 'Discovery', scope: 'public', limit: 20 }); expect(charlieSearch.items.map(item => item.object.id)).toEqual(expect.arrayContaining([community.id, importedTrack.track.id, video.video.id, live.id]));
    const dm = await alice.messages.sendTrack(bob.keys.nodeId, importedTrack.track.id, importedTrack.track.payload.title);
    const channel = await alice.communities.createChannel(community.id, { name: 'media', kind: 'media' }); const post = await alice.communities.postMessage(community.id, channel.payload.channelId, 'One object reference', [importedTrack.track.id]);
    expect(dm.references[0]?.id).toBe(importedTrack.track.id); expect(post.payload.trackIds).toEqual([importedTrack.track.id]); expect(bobHome.items.some(item => item.object.id === importedTrack.track.id)).toBe(true);
    const privateTrack = await alice.music.createTrack({ title: 'Contacts only', artistIds: [artist.payload.artistId], audioUri: importedTrack.track.payload.audioUri, durationMs: 30_000, codec: 'opus', explicit: false, rights: {} }, 'contacts');
    await expect(alice.discoveryReplication.publish(bob.keys.nodeId, privateTrack)).rejects.toThrow('public objects');
    const wire = network.network.history().find(value => value.envelope.type === 'social.discovery_object' && value.to === bob.keys.nodeId); expect(wire).toBeDefined(); if (wire) network.network.inject(bob.keys.nodeId, { ...wire.envelope, body: { object: { malformed: true } }, nonce: crypto.randomUUID() });
    await settle(); expect(bob.discoveryReplication.stats().rejected).toBeGreaterThan(0);
    const restartedBob = await network.restart('bob'); expect((await restartedBob.discovery.search({ query: 'Discovery Track', scope: 'local' })).items.map(item => item.object.id)).toContain(importedTrack.track.id);
    expect((await mallory.discovery.search({ query: 'Discovery', scope: 'public' })).items).toHaveLength(0);
    await network.close();
  });

  it('fails closed instead of transmitting contacts-only community content without group encryption', async () => {
    const network = await harness(['alice', 'bob']); const alice = network.node('alice'), bob = network.node('bob');
    const community = await alice.communities.createCommunity({ name: 'contacts only', visibility: 'contacts' });
    await expect(alice.communityReplication.publish(bob.keys.nodeId, community)).rejects.toThrow('public communities only');
    await network.close();
  });

  it('converges delayed public-community updates after a member runtime restart', async () => {
    const network = await harness(['alice', 'bob']); const alice = network.node('alice'), bob = network.node('bob');
    const community = await alice.communities.createCommunity({ name: 'durable public community' });
    const role = await alice.communities.createRole(community.id, { name: 'Member', permissions: ['post_message'] });
    const invite = await alice.communities.invite(community.id, bob.keys.nodeId, [role.payload.roleId]);
    for (const event of [community, role, invite]) await alice.communityReplication.publish(bob.keys.nodeId, event);
    await settle(); network.network.pauseDelivery();
    const channel = await alice.communities.createChannel(community.id, { name: 'delayed', kind: 'text' });
    const message = await alice.communities.postMessage(community.id, channel.payload.channelId, 'arrives after restart');
    await alice.communityReplication.publish(bob.keys.nodeId, channel); await alice.communityReplication.publish(bob.keys.nodeId, message);
    const restartedBob = await network.restart('bob'); network.network.pauseDelivery(false); await network.network.drain();
    expect((await restartedBob.communities.projection(community.id))?.members.get(restartedBob.keys.nodeId)?.roleIds).toEqual([role.payload.roleId]);
    expect((await restartedBob.communities.messages(community.id, channel.payload.channelId)).map(value => value.payload.text)).toEqual(['arrives after restart']);
    await network.close();
  });

  it('runs Phase 24 community roles, channels, invites and moderation over the signed transport boundary', async () => {
    const network = await harness(['alice', 'bob', 'charlie', 'mallory']); const alice = network.node('alice'), bob = network.node('bob'), charlie = network.node('charlie'), mallory = network.node('mallory');
    const community = await alice.communities.createCommunity({ name: 'Keystone Moderators', description: 'P2P governance', visibility: 'public' });
    const role = await alice.communities.createRole(community.id, { name: 'Moderator', position: 10, permissions: ['post_message', 'moderate', 'pin_messages', 'moderate_messages'] });
    const invite = await alice.communities.createInvite(community.id, { recipient: bob.keys.nodeId, roleIds: [role.payload.roleId] });
    const category = await alice.communities.createCategory(community.id, { name: 'Main', position: 0 });
    const channel = await alice.communities.createChannel(community.id, { name: 'general', kind: 'text', categoryId: category.payload.categoryId });
    for (const peer of [bob, charlie]) for (const event of [community, role, invite, category, channel]) await alice.communityReplication.publish(peer.keys.nodeId, event);
    await settle();
    const bobAccepted = await bob.communities.acceptInvite(invite.payload.inviteId); await bob.communityReplication.publish(alice.keys.nodeId, bobAccepted); await bob.communityReplication.publish(charlie.keys.nodeId, bobAccepted);
    const charlieJoin = await charlie.communities.join(community.id); await charlie.communityReplication.publish(alice.keys.nodeId, charlieJoin); await alice.communityReplication.publish(bob.keys.nodeId, charlieJoin); await settle();
    const bobModeration = await bob.communities.moderate(community.id, charlie.keys.nodeId, 'ban', { reason: 'Repeated spam' }); await bob.communityReplication.publish(alice.keys.nodeId, bobModeration); await bob.communityReplication.publish(charlie.keys.nodeId, bobModeration); await settle();
    expect((await alice.communities.projection(community.id))?.members.get(charlie.keys.nodeId)).toMatchObject({ active: false, banned: true });
    expect((await charlie.communities.projection(community.id))?.members.get(charlie.keys.nodeId)).toMatchObject({ active: false, banned: true });
    await expect(charlie.communities.createChannel(community.id, { name: 'admin-spoof', kind: 'text' })).rejects.toThrow('Community permission denied');
    await expect(charlie.communities.postMessage(community.id, channel.payload.channelId, 'after removal')).rejects.toThrow('Community permission denied');
    const replay = network.network.history().find(value => value.to === bob.keys.nodeId && value.envelope.type === 'social.community_event'); expect(replay).toBeDefined(); if (replay) { network.network.inject(bob.keys.nodeId, replay.envelope); network.network.inject(bob.keys.nodeId, replay.envelope); await settle(); }
    expect(bob.communityReplication.stats().duplicate).toBeGreaterThan(0);
    await mallory.communities.ingest(community); const unauthorized = await mallory.communities.join(community.id); await mallory.communityReplication.publish(alice.keys.nodeId, unauthorized); await settle(); expect(await alice.communities.can(community.id, mallory.keys.nodeId, 'manage_roles')).toBe(false);
    network.network.setOnline(bob.keys.nodeId, false); const delayed = await alice.communities.createChannel(community.id, { name: 'after-reconnect', kind: 'text' }); await expect(alice.communityReplication.publish(bob.keys.nodeId, delayed)).rejects.toThrow('offline'); network.network.setOnline(bob.keys.nodeId, true); await alice.communityReplication.publish(bob.keys.nodeId, delayed); await settle();
    const restartedBob = await network.restart('bob'); expect((await restartedBob.communities.projection(community.id))?.channels.get(delayed.payload.channelId)?.payload.name).toBe('after-reconnect'); expect((await restartedBob.communities.projection(community.id))?.members.get(charlie.keys.nodeId)?.banned).toBe(true);
    await alice.communities.setNotificationSettings(community.id, { muted: true, mutedChannels: [channel.payload.channelId] }); const restartedAlice = await network.restart('alice'); expect((await restartedAlice.communities.notificationSettings(community.id))).toMatchObject({ muted: true, mutedChannels: [channel.payload.channelId] });
    await network.close();
  });

  it('runs Phase 25 encrypted private Community epochs with signed invite, rotation and restart', async () => {
    const network = await harness(['alice', 'bob', 'charlie', 'mallory']); const alice = network.node('alice'), bob = network.node('bob'), charlie = network.node('charlie'), mallory = network.node('mallory');
    const community = await alice.privateCommunities.createCommunity({ name: 'Private operators', visibility: 'private' });
    const channel = await alice.communities.createChannel(community.id, { name: 'encrypted', kind: 'text' });
    const invite = await alice.privateCommunityReplication.invite(bob.keys.nodeId, community.id); await settle();
    expect((await bob.privateCommunities.state(community.id))?.epoch).toBe(2);
    const first = await alice.privateCommunities.postMessage(community.id, channel.payload.channelId, 'encrypted before Charlie'); await alice.privateCommunityReplication.broadcastEvent(first); await settle();
    expect((await bob.communities.messages(community.id, channel.payload.channelId)).map(value => value.payload.text)).toContain('encrypted before Charlie');
    const charlieInvite = await alice.privateCommunityReplication.invite(charlie.keys.nodeId, community.id); await settle(); expect(charlieInvite.recipient).toBe(charlie.keys.nodeId); expect((await charlie.privateCommunities.state(community.id))?.epoch).toBe(3);
    const bobEpochBeforeRemoval = (await bob.privateCommunities.state(community.id))!.epoch;
    await alice.privateCommunityReplication.rotateAndBroadcast(community.id, bob.keys.nodeId, 'ban', 'revoked device'); await settle();
    const after = await alice.privateCommunities.postMessage(community.id, channel.payload.channelId, 'only current members'); await alice.privateCommunityReplication.broadcastEvent(after); await settle();
    expect((await bob.privateCommunities.state(community.id))?.epoch).toBe(bobEpochBeforeRemoval);
    expect((await bob.communities.messages(community.id, channel.payload.channelId)).map(value => value.payload.text)).not.toContain('only current members');
    expect((await charlie.communities.messages(community.id, channel.payload.channelId)).map(value => value.payload.text)).toContain('only current members');
    const privateWire = network.network.history().find(value => value.envelope.type === 'social.private_community_event' && value.to === charlie.keys.nodeId); expect(privateWire).toBeDefined(); if (privateWire) { network.network.inject(charlie.keys.nodeId, privateWire.envelope); network.network.inject(charlie.keys.nodeId, privateWire.envelope); await settle(); }
    expect(charlie.privateCommunityReplication.stats().duplicate).toBeGreaterThan(0);
    const spoof = { ...(privateWire?.envelope ?? {}), nonce: crypto.randomUUID(), sender: mallory.keys.nodeId, signature: 'invalid' } as any; network.network.inject(charlie.keys.nodeId, spoof); await settle(); expect(charlie.privateCommunityReplication.stats().rejected).toBeGreaterThan(0);
    const restartedCharlie = await network.restart('charlie'); expect((await restartedCharlie.privateCommunities.state(community.id))?.epoch).toBeGreaterThanOrEqual(3);
    expect((await mallory.discovery.search({ query: 'Private operators', scope: 'public' })).items).toEqual([]);
    await network.close();
  });

  it('converges queued private state after a network partition is healed without leaking it to Mallory', async () => {
    const network = await harness(); const alice = network.node('alice'), bob = network.node('bob'), mallory = network.node('mallory');
    network.network.partition(alice.keys.nodeId, bob.keys.nodeId); const message = await alice.messages.sendText(bob.keys.nodeId, 'partitioned');
    network.network.partition(alice.keys.nodeId, bob.keys.nodeId, false); await alice.messages.flush(bob.keys.nodeId); await settle();
    const conversation = await alice.messages.createConversation(bob.keys.nodeId);
    expect((await bob.messages.history(conversation.id)).map(value => value.id)).toContain(message.id);
    expect(await mallory.messageStorage.getMessage(message.id)).toBeUndefined();
    await network.close();
  });

  it('runs Phase 26 FileObject replication, provider failover, integrity checks and restart metadata', async () => {
    const network = await harness(['alice', 'bob', 'charlie', 'mallory']); const alice = network.node('alice'), bob = network.node('bob'), charlie = network.node('charlie'), mallory = network.node('mallory');
    const source = Uint8Array.from({ length: 128 * 1024 }, (_, index) => index % 251); const imported = await alice.files.import({ bytes: source, filename: 'large-keystone.bin', mimeType: 'application/octet-stream', visibility: 'public', chunkSize: 16 * 1024 }); await alice.filePolicy.register(imported.file, { userOwned: true });
    await alice.fileReplication.publish(bob.keys.nodeId, imported.file); await alice.fileReplication.publish(charlie.keys.nodeId, imported.file); await settle(); const received = await bob.files.get(imported.file.id); expect(received?.id).toBe(imported.file.id); expect((await charlie.files.get(imported.file.id))?.id).toBe(imported.file.id);
    const direct = await alice.messages.sendFile(bob.keys.nodeId, imported.file, 'Shared canonical file'); const fileCommunity = await alice.communities.createCommunity({ name: 'Files' }); const fileChannel = await alice.communities.createChannel(fileCommunity.id, { name: 'files', kind: 'media' }); const communityPost = await alice.communities.postMessage(fileCommunity.id, fileChannel.payload.channelId, 'Same file object', [], [], [], { fileIds: [imported.file.id] }); expect(direct.references).toEqual([{ id: imported.file.id, type: 'file_object' }]); expect(communityPost.references.at(-1)?.id).toBe(imported.file.id);
    let aliceOnline = true; const failingAlice = new BytesProvider('alice', source, imported.manifest, { index: 2 }); const corruptMallory = new BytesProvider('mallory', source, imported.manifest, { index: 0, corrupt: true }); const healthyCharlie = new BytesProvider('charlie', source, imported.manifest); const directory: FileProviderDirectory = { async manifest() { return imported.manifest; }, async providers() { return aliceOnline ? [corruptMallory, failingAlice, healthyCharlie] : [corruptMallory, healthyCharlie]; } }; const transfer = new FileTransferManager(bob.content.cache, directory, bob.filePolicy, 3);
    expect(transfer.state(received!).status).toBe('idle'); const result = await transfer.download(received!, { maxParallel: 3 }); expect(result).toEqual(source); expect(corruptMallory.calls).toBeGreaterThan(0); expect(failingAlice.calls).toBeGreaterThan(0); expect(transfer.state(received!).status).toBe('complete'); aliceOnline = false; expect(bob.filePolicy.availability(received!, imported.manifest, await directory.providers(imported.manifest.contentId)).status).toBe('AVAILABLE LOCAL');
    const partialCache = new ContentCache(source.length * 2); let onlyAlice = true; const partialDirectory: FileProviderDirectory = { async manifest() { return imported.manifest; }, async providers() { return onlyAlice ? [failingAlice] : [healthyCharlie]; } }; const partialTransfer = new FileTransferManager(partialCache, partialDirectory, undefined, 1); await expect(partialTransfer.download(received!, { maxParallel: 1 })).rejects.toThrow(); expect(partialCache.missing(imported.manifest)).toContain(2); onlyAlice = false; expect(await partialTransfer.resume(received!)).toEqual(source); expect(healthyCharlie.calls).toBeGreaterThan(0);
    const wire = network.network.history().find(value => value.envelope.type === 'social.file_object' && value.to === bob.keys.nodeId); expect(wire).toBeDefined(); if (wire) { network.network.inject(bob.keys.nodeId, wire.envelope); network.network.inject(bob.keys.nodeId, wire.envelope); await settle(); }
    const restartedBob = await network.restart('bob'); expect((await restartedBob.files.get(imported.file.id))?.id).toBe(imported.file.id); expect(await mallory.files.get(imported.file.id)).toBeUndefined(); await network.close();
  });

  it('runs durable Agent Workboard claims and offline reconnect through authenticated Transport', async () => {
    const network = await harness(['alice', 'bob', 'charlie', 'mallory']); const alice = network.node('alice'), bob = network.node('bob'), mallory = network.node('mallory');
    network.network.setOnline(bob.keys.nodeId, false);
    const board = await alice.workboards.createWorkboard({ id: 'integration-workboard', title: 'Keystone release', members: [{ identityId: bob.keys.nodeId, role: 'editor', joinedAt: new Date().toISOString() }], allowedDataScopes: [{ dataClasses: ['PUBLIC'] }] });
    const first = await alice.workboards.createWorkItem(board.id, { id: 'integration-prepare', title: 'Prepare', objective: 'prepare release notes', dataScopes: [{ dataClasses: ['PUBLIC'] }] });
    const second = await alice.workboards.createWorkItem(board.id, { id: 'integration-publish', title: 'Publish', objective: 'publish after prepare', dataScopes: [{ dataClasses: ['PUBLIC'] }] });
    await alice.workboards.addDependency(board.id, second.id, first.id);
    expect(await bob.workboards.getBoard(board.id)).toBeUndefined();
    network.network.setOnline(bob.keys.nodeId, true); await alice.workboardReplication.flush(bob.keys.nodeId); await settle();
    expect((await bob.workboards.getBoard(board.id))?.id).toBe(board.id); expect((await bob.workboards.getWorkItem(board.id, second.id))?.status).toBe('BLOCKED');
    const claim = await bob.workboards.claimWorkItem(board.id, first.id, { actor: { kind: 'human', id: bob.keys.nodeId }, executionKey: 'bob-release-1' }); await settle(); expect((await alice.workboards.listClaims(board.id)).some(value => value.id === claim.id)).toBe(true);
    await bob.workboards.releaseClaim(claim.id, { kind: 'human', id: bob.keys.nodeId }, 'completed'); await settle(); expect((await alice.workboards.getWorkItem(board.id, second.id))?.status).toBe('READY');
    const forged = { version: 1 as const, id: crypto.randomUUID(), boardId: board.id, actor: { kind: 'human' as const, id: mallory.keys.nodeId }, operation: 'item.upsert' as const, targetId: first.id, revision: 99, payload: { ...(await alice.workboards.getWorkItem(board.id, first.id))!, revision: 99 }, createdAt: new Date().toISOString(), signature: 'invalid' };
    await expect(mallory.workboards.applyEvent(forged)).rejects.toMatchObject({ code: 'INVALID_SIGNATURE' });
    const restarted = await network.restart('bob'); expect((await restarted.workboards.getBoard(board.id))?.id).toBe(board.id); expect((await restarted.workboards.getWorkItem(board.id, second.id))?.status).toBe('READY'); await network.close();
  });
});
