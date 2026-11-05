import { mkdir, mkdtemp, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { createSocket } from 'node:dgram';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcess } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import DHT from 'hyperdht';
import { IdentityManager } from '../identity.js';

type Role = 'alice' | 'alice_device' | 'alice_phone' | 'alice_tablet' | 'bob' | 'charlie' | 'mallory';
type Command = { id: string; action: string; peer?: Role; providers?: Role[]; target?: Role; members?: Role[]; text?: string; fileId?: string; communityId?: string; channelId?: string; conversationId?: string; messageId?: string; visitId?: string; agentTaskId?: string; roomId?: string; spaceId?: string; negotiationId?: string; proposalId?: string; boardId?: string; workItemId?: string; calendarId?: string; eventId?: string; operation?: string; broadcastId?: string; manifest?: unknown; interruptAt?: number; visibility?: 'public' | 'private'; publicationVisibility?: 'PUBLIC' | 'UNLISTED' | 'CONTACTS' | 'FOLLOWERS' | 'SELECTED_IDENTITIES' | 'SPACE'; presenceVisibility?: 'public' | 'contacts' | 'selected'; category?: string; resultType?: string; dataClass?: 'PUBLIC' | 'USER_EXPLICIT'; meshRequest?: unknown; meshAuthorization?: unknown; objectId?: string; objectType?: string; objectVersion?: string; payload?: unknown; metadata?: unknown; reason?: string; confirm?: boolean };
type Response = { ok: boolean; result?: any; error?: string };

const roots: string[] = [];
const peers: ChildProcess[] = [];
const peerLogs = new Map<string, string>();
let shutdownRequested = false;
let cleanupInstalled = false;

/**
 * A peer runs Vitest, which in turn owns a fork worker.  Keep the complete
 * peer tree in its own process group so an interrupted real-network run
 * cannot orphan workers and retain hundreds of megabytes after the parent
 * exits.  Windows has no portable negative-PID process-group equivalent, so
 * it uses the ChildProcess fallback.
 */
function signalPeerTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  if (process.platform !== 'win32') {
    try { process.kill(-child.pid, signal); return; } catch { /* fall back to the direct child */ }
  }
  try { child.kill(signal); } catch { /* already exited */ }
}

function signalAllPeers(signal: NodeJS.Signals): void {
  for (const peer of peers) signalPeerTree(peer, signal);
}

function installInterruptCleanup(): void {
  if (cleanupInstalled) return;
  cleanupInstalled = true;
  const terminate = (signal: NodeJS.Signals): void => {
    if (shutdownRequested) return;
    shutdownRequested = true;
    signalAllPeers('SIGTERM');
    const timer = setTimeout(() => {
      signalAllPeers('SIGKILL');
      process.exit(signal === 'SIGINT' ? 130 : 143);
    }, 500);
    timer.unref?.();
  };
  process.once('SIGINT', () => terminate('SIGINT'));
  process.once('SIGTERM', () => terminate('SIGTERM'));
  process.once('exit', () => signalAllPeers('SIGKILL'));
}

afterEach(async () => { await Promise.all(peers.splice(0).map(stopProcess)); if (process.env.KEEP_REAL_NETWORK_ROOT !== '1') await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

describe('real Hyperswarm network validation', () => {
  it('connects independent Keystone processes through Noise, persists restart state, and carries signed data', async () => {
    const root = await mkdtemp(join(tmpdir(), 'keystone-real-network-')); roots.push(root);
    const port = await freeUdpPort(); const bootstrap = DHT.bootstrapper(port, '127.0.0.1');
    try {
      const aliceSeed = (await IdentityManager.generate()).masterSeed;
      const seeds = { alice: aliceSeed, alice_device: (await IdentityManager.generate()).masterSeed, alice_phone: aliceSeed, alice_tablet: aliceSeed, bob: (await IdentityManager.generate()).masterSeed, charlie: (await IdentityManager.generate()).masterSeed, mallory: (await IdentityManager.generate()).masterSeed } as Record<Role, string>;
      const configPath = join(root, 'network.json'); await atomicWrite(configPath, { root, bootstrap: `127.0.0.1:${port}`, seeds });
      let alice = await startPeer('alice', configPath); let aliceDevice = await startPeer('alice_device', configPath); const alicePhone = await startPeer('alice_phone', configPath); const aliceTablet = await startPeer('alice_tablet', configPath); const bob = await startPeer('bob', configPath); let charlie = await startPeer('charlie', configPath); const mallory = await startPeer('mallory', configPath);
      const first = await command(root, 'alice', { action: 'sendText', peer: 'bob', text: 'signed over Noise' }); await eventually(async () => (await command(root, 'bob', { action: 'history', peer: 'alice' })).result.messages.some((message: { id: string }) => message.id === first.result.id));
      const aliceContext = await command(root, 'alice', { action: 'contextRead', text: 'signed over Noise' }); expect(aliceContext.result.status).toBe('found'); expect(aliceContext.result.citations.map((value: { objectId: string }) => value.objectId)).toContain(first.result.id);
      await command(root, 'alice', { action: 'replayLast', peer: 'bob' }); await pause(250);
      expect((await command(root, 'bob', { action: 'history', peer: 'alice' })).result.messages.filter((message: { id: string }) => message.id === first.result.id)).toHaveLength(1);

      // R0P76: location is a controlled provider source carried over the real
      // Fabric/Hyperswarm path. The application envelope is recipient-E2E
      // encrypted and the receiver only sees the coarsened representation.
      const locationShare = await command(root, 'alice', { action: 'locationCreate', peer: 'bob' });
      const locationShareId = locationShare.result.shareId as string;
      await eventually(async () => (await command(root, 'bob', { action: 'locationRead', objectId: locationShareId })).result.share?.precision === 'APPROXIMATE', 20_000);
      await command(root, 'alice', { action: 'locationSend', objectId: locationShareId });
      await eventually(async () => { const read = (await command(root, 'bob', { action: 'locationRead', objectId: locationShareId })).result; return read.share?.fix?.precision === 'APPROXIMATE' && read.share?.fix?.provenance === 'REMOTE_SHARED'; }, 20_000);
      const locationRead = await command(root, 'bob', { action: 'locationRead', objectId: locationShareId });
      expect(locationRead.result.share.fix.latitude).not.toBe(55.751244);
      await command(root, 'alice', { action: 'locationStop', objectId: locationShareId });
      await eventually(async () => (await command(root, 'bob', { action: 'locationRead', objectId: locationShareId })).result.share?.state === 'STOPPED', 20_000);

      await command(root, 'bob', { action: 'stop' }); await waitExit(bob); const restartedBob = await startPeer('bob', configPath);
      expect((await command(root, 'bob', { action: 'history', peer: 'alice' })).result.messages.map((message: { text: string }) => message.text)).toContain('signed over Noise');

      await command(root, 'bob', { action: 'stop' }); await waitExit(restartedBob);
      const queued = await command(root, 'alice', { action: 'sendText', peer: 'bob', text: 'offline then reconnect' });
      expect(queued.ok).toBe(true);
      await startPeer('bob', configPath); await command(root, 'alice', { action: 'flush', peer: 'bob' });
      await eventually(async () => (await command(root, 'bob', { action: 'history', peer: 'alice' })).result.messages.some((message: { id: string }) => message.id === queued.result.id), 20_000);

      const toBob = await command(root, 'alice', { action: 'sendText', peer: 'bob', text: 'for Bob only' });
      const toMallory = await command(root, 'alice', { action: 'sendText', peer: 'mallory', text: 'for Mallory only' });
      await eventually(async () => (await command(root, 'mallory', { action: 'history', peer: 'alice' })).result.messages.some((message: { id: string }) => message.id === toMallory.result.id));
      expect((await command(root, 'bob', { action: 'history', peer: 'alice' })).result.messages.some((message: { id: string }) => message.id === toBob.result.id)).toBe(true);
      expect((await command(root, 'bob', { action: 'history', peer: 'alice' })).result.messages.some((message: { id: string }) => message.id === toMallory.result.id)).toBe(false);

      // Phase 39: an asynchronous Agent Social task is encrypted and queued
      // while Bob's independent process is offline.  Bob later accepts it,
      // while Alice is offline, and the signed result is delivered after her
      // process reconnects.  No Memory/RAG/private payload is wired into the
      // production executor; only an explicit bounded projection crosses the
      // mailbox.  The same production path carries an asynchronous room.
      await command(root, 'bob', { action: 'agentPolicy', text: 'ask' });
      await command(root, 'bob', { action: 'stop' }); await waitExit(restartedBob);
      const agentTask = await command(root, 'alice', { action: 'agentTaskSend', peer: 'bob', text: 'Can you be available tomorrow?' });
      expect(agentTask.result.outbox).toBeGreaterThan(0);
      await startPeer('bob', configPath); await command(root, 'alice', { action: 'agentSocialFlush', peer: 'bob' });
      await eventually(async () => (await command(root, 'bob', { action: 'agentSocialRead' })).result.inbox.some((value: { taskId: string }) => value.taskId === agentTask.result.taskId), 20_000);
      await command(root, 'alice', { action: 'stop' }); await waitExit(alice); alice = await startPeer('alice', configPath);
      await command(root, 'bob', { action: 'agentTaskAccept', agentTaskId: agentTask.result.taskId }); await command(root, 'bob', { action: 'agentSocialFlush', peer: 'alice' });
      await eventually(async () => (await command(root, 'alice', { action: 'agentSocialRead' })).result.responses.some((value: { taskId: string; status: string }) => value.taskId === agentTask.result.taskId && value.status === 'completed'), 20_000);
      const agentRoom = await command(root, 'alice', { action: 'agentRoomCreate', members: ['bob', 'charlie'], text: 'Asynchronous production room' });
      await eventually(async () => (await command(root, 'bob', { action: 'agentSocialRead' })).result.rooms.some((value: { id: string }) => value.id === agentRoom.result.roomId), 20_000);
      await eventually(async () => (await command(root, 'charlie', { action: 'agentSocialRead' })).result.rooms.some((value: { id: string }) => value.id === agentRoom.result.roomId), 20_000);
      await command(root, 'alice', { action: 'agentRoomPost', roomId: agentRoom.result.roomId, text: 'Only explicitly shared room contribution' });
      await eventually(async () => (await command(root, 'bob', { action: 'agentSocialRead' })).result.contributions.some((value: { roomId: string; text: string }) => value.roomId === agentRoom.result.roomId && value.text === 'Only explicitly shared room contribution'), 20_000);
      expect((await command(root, 'mallory', { action: 'agentSocialRead' })).result.rooms.some((value: { id: string }) => value.id === agentRoom.result.roomId)).toBe(false);

      // Phase 40: a signed negotiation uses the asynchronous agent mailbox.
      // Bob's process is offline while Alice creates the session; after Bob
      // reconnects his local evaluator returns only a derived boolean/score.
      // Constraint metadata is persisted, but private values never enter the
      // serialized production envelope.
      await command(root, 'bob', { action: 'negotiationPolicy', text: 'safe' });
      await command(root, 'bob', { action: 'stop' });
      const negotiation = await command(root, 'alice', { action: 'negotiationCreate', members: ['bob', 'charlie'], text: 'Find a common meeting window' });
      const negotiationId = negotiation.result.negotiationId as string;
      const proposal = await command(root, 'alice', { action: 'negotiationPropose', negotiationId });
      await command(root, 'alice', { action: 'negotiationFlush', peer: 'charlie' });
      await eventually(async () => (await command(root, 'charlie', { action: 'negotiationRead', negotiationId })).result.responses.length > 0, 20_000, () => [...peerLogs.entries()].map(([name, log]) => `${name}: ${log.slice(-8_000)}`).join('\n'));
      const wire = await command(root, 'alice', { action: 'negotiationWire' }); expect(wire.result.serialized).not.toContain('private schedule'); expect(wire.result.serialized).not.toContain('LOCAL_PRIVATE_CONSTRAINT');
      await startPeer('bob', configPath); await command(root, 'alice', { action: 'negotiationFlush', peer: 'bob' });
      await eventually(async () => { const read = (await command(root, 'bob', { action: 'negotiationRead', negotiationId })).result; return read.proposals.some((item: { id: string }) => item.id === proposal.result.proposalId) && read.responses.length > 0; }, 20_000, () => [...peerLogs.entries()].map(([name, log]) => `${name}: ${log.slice(-8_000)}`).join('\n'));
      await eventually(async () => (await command(root, 'alice', { action: 'negotiationRead', negotiationId })).result.responses.length >= 2, 20_000);
      const negotiationResult = await command(root, 'alice', { action: 'negotiationFinalize', negotiationId }); expect(negotiationResult.result.status).toBe('completed'); expect(negotiationResult.result.selectedOptionIds).toEqual(['sat-18']);
      await eventually(async () => (await command(root, 'bob', { action: 'negotiationRead', negotiationId })).result.results.some((item: { sessionId: string; status: string }) => item.sessionId === negotiationId && item.status === 'completed'), 20_000);
      const forgedNegotiation = await commandMaybe(root, 'alice', { action: 'negotiationRespond', negotiationId, proposalId: 'forged-proposal' }); expect(forgedNegotiation.ok).toBe(false);

      // Phase 41: owner-bound AgentProfile and a separate agent-only graph.
      // Alice publishes Eight through the authenticated AgentMailbox; Bob and
      // Charlie receive only the public profile, and Bob's explicit trust is
      // independent from any human follow state.
      const eight = await command(root, 'alice', { action: 'agentProfileCreate', agentTaskId: 'eight', text: 'Eight', visibility: 'public' }); expect(eight.result.signature).toBeTruthy();
      await command(root, 'alice', { action: 'agentProfilePublish', agentTaskId: 'eight' });
      await eventually(async () => (await command(root, 'bob', { action: 'agentProfileRead', peer: 'alice' })).result.profiles.some((value: { agentId: string; displayName: string }) => value.agentId === 'eight' && value.displayName === 'Eight'), 20_000);
      await eventually(async () => (await command(root, 'charlie', { action: 'agentProfileRead', peer: 'alice' })).result.profiles.some((value: { agentId: string }) => value.agentId === 'eight'), 20_000);
      const beforeTrust = await command(root, 'bob', { action: 'agentProfileGraph' }); expect(beforeTrust.result.relationships.some((value: { agent: { agentId: string }; trusted: boolean }) => value.agent.agentId === 'eight' && value.trusted)).toBe(false);
      await command(root, 'bob', { action: 'agentProfileTrust', peer: 'alice', agentTaskId: 'eight' }); await eventually(async () => (await command(root, 'bob', { action: 'agentProfileGraph' })).result.relationships.some((value: { agent: { agentId: string }; trusted: boolean }) => value.agent.agentId === 'eight' && value.trusted), 20_000);
      const spoof = await command(root, 'mallory', { action: 'agentProfileSpoof', peer: 'bob', agentTaskId: 'eight' }); expect(spoof.result.forged).toBe(true); await eventually(async () => (await command(root, 'bob', { action: 'agentProfileRead', text: 'all', peer: 'alice' })).result.audit.some((value: { event: string; outcome: string }) => value.event === 'security.rejected' && value.outcome === 'denied'), 20_000);
      await command(root, 'alice', { action: 'agentProfileHide', agentTaskId: 'eight' }); await eventually(async () => !(await command(root, 'bob', { action: 'agentProfileRead', peer: 'alice' })).result.profiles.some((value: { agentId: string }) => value.agentId === 'eight'), 20_000);
      await command(root, 'bob', { action: 'stop' }); await startPeer('bob', configPath); await eventually(async () => { const read = (await command(root, 'bob', { action: 'agentProfileRead', text: 'all', peer: 'alice' })).result; return read.profiles.some((value: { agentId: string; visibility: string }) => value.agentId === 'eight' && value.visibility === 'private'); }, 20_000);

      // Phase 42: signed, expiring AgentPresence and the Personal Concierge
      // boundary. Bob queues a question while Alice is offline; after
      // reconnect it remains WAITING_FOR_OWNER until Alice explicitly signs a
      // confirmed response. Charlie receives only an explicitly shared
      // derived statement, while spoofed presence/results are rejected.
      await command(root, 'alice', { action: 'agentConciergePolicy', text: 'trusted' });
      await command(root, 'alice', { action: 'agentPresenceSet', text: 'taking_messages', presenceVisibility: 'contacts' });
      await command(root, 'alice', { action: 'stop' }); await waitExit(alice);
      const conciergeRequest = await command(root, 'bob', { action: 'agentConciergeRequest', peer: 'alice', category: 'availability', text: 'Is Alice available after 18:00?' }); expect(conciergeRequest.ok).toBe(true); expect(conciergeRequest.result.outbox).toBeGreaterThan(0);
      alice = await startPeer('alice', configPath); await command(root, 'bob', { action: 'agentConciergeFlush', peer: 'alice' });
      await eventually(async () => { const read = (await command(root, 'alice', { action: 'agentConciergeRead' })).result; return read.inbox.some((item: { request: { requestId: string }; status: string }) => item.request.requestId === conciergeRequest.result.requestId && item.status === 'waiting_for_owner'); }, 20_000);
      const approvedConcierge = await command(root, 'alice', { action: 'agentConciergeApprove', agentTaskId: conciergeRequest.result.requestId, text: 'After 18:00 looks possible, but only this owner-confirmed response is authoritative.', resultType: 'OWNER_CONFIRMED_DECISION', dataClass: 'USER_EXPLICIT' }); expect(approvedConcierge.result.responses[0].type).toBe('OWNER_CONFIRMED_DECISION');
      await eventually(async () => (await command(root, 'bob', { action: 'agentConciergeRead' })).result.responses.some((item: { requestId: string; result: { type: string } }) => item.requestId === conciergeRequest.result.requestId && item.result.type === 'OWNER_CONFIRMED_DECISION'), 20_000);
      const sharedConcierge = await command(root, 'alice', { action: 'agentConciergeShare', peer: 'charlie', agentTaskId: conciergeRequest.result.requestId, text: 'After 18:00 looks possible; this is a derived preference, not a decision.', resultType: 'DERIVED_PREFERENCE', dataClass: 'PUBLIC' });
      await eventually(async () => (await command(root, 'charlie', { action: 'agentConciergeRead' })).result.responses.some((item: { id: string; result: { type: string } }) => item.id === sharedConcierge.result.responseId && item.result.type === 'DERIVED_PREFERENCE'), 20_000);
      await command(root, 'mallory', { action: 'agentPresenceSpoof', peer: 'alice' }); await command(root, 'mallory', { action: 'agentConciergeSpoof', peer: 'alice', agentTaskId: conciergeRequest.result.requestId }); await pause(500);
      expect((await command(root, 'alice', { action: 'agentSocialRead' })).result.rejected).toBeGreaterThan(0);
      expect((await command(root, 'alice', { action: 'agentConciergeRead' })).result.inbox.some((item: { request: { requestId: string }; status: string }) => item.request.requestId === conciergeRequest.result.requestId && item.status === 'answered')).toBe(true);

      // Phase 50: the durable Workboard uses the same production
      // Hyperswarm/Noise envelope path. Alice publishes one board/item, Bob
      // claims and completes it, Charlie is viewer-only, and Mallory's forged
      // revision is rejected before it can alter durable state.
      const workboard = await command(root, 'alice', { action: 'workboardCreate', members: ['bob', 'charlie'], text: 'Production Workboard' });
      const boardId = workboard.result.boardId as string; const workItemId = workboard.result.workItemId as string;
      await eventually(async () => (await command(root, 'bob', { action: 'workboardRead', boardId })).result?.items.some((item: { id: string }) => item.id === workItemId), 20_000);
      await eventually(async () => (await command(root, 'charlie', { action: 'workboardRead', boardId })).result?.items.some((item: { id: string }) => item.id === workItemId), 20_000);
      const viewerClaim = await commandMaybe(root, 'charlie', { action: 'workboardClaim', boardId, workItemId }); expect(viewerClaim.ok).toBe(false);
      const bobClaim = await command(root, 'bob', { action: 'workboardClaim', boardId, workItemId });
      await eventually(async () => (await command(root, 'alice', { action: 'workboardRead', boardId })).result?.claims.some((claim: { id: string; state: string }) => claim.id === bobClaim.result.claimId && claim.state === 'active'), 20_000);
      await command(root, 'bob', { action: 'workboardComplete', boardId, workItemId });
      await eventually(async () => (await command(root, 'alice', { action: 'workboardRead', boardId })).result?.items.some((item: { id: string; status: string }) => item.id === workItemId && item.status === 'DONE'), 20_000);
      const workboardSpoof = await commandMaybe(root, 'mallory', { action: 'workboardSpoof', peer: 'alice', boardId, workItemId }); expect(workboardSpoof.ok).toBe(false);

      // Phase 51: Calendar is a generic signed object layer over the same
      // production Hyperswarm/Noise transport. Alice publishes one shared
      // calendar, Bob receives full event access, Charlie receives only
      // FREE_BUSY, Bob RSVPs, and offline/restart delivery remains durable.
      const sharedCalendar = await command(root, 'alice', { action: 'calendarCreate', members: ['bob', 'charlie'], calendarId: 'production-calendar', text: 'Production Calendar' });
      const calendarId = sharedCalendar.result.calendarId as string;
      const calendarEvent = await command(root, 'alice', { action: 'calendarEventCreate', calendarId, eventId: 'production-calendar-event', peer: 'bob', text: 'Production P2P event' });
      const calendarEventId = calendarEvent.result.eventId as string;
      await eventually(async () => (await command(root, 'bob', { action: 'calendarEventRead', eventId: calendarEventId })).result?.title === 'Production P2P event', 20_000);
      await eventually(async () => (await command(root, 'charlie', { action: 'calendarEventRead', eventId: calendarEventId })).result?.title === 'BUSY', 20_000);
      const calendarRsvp = await command(root, 'bob', { action: 'calendarRSVP', eventId: calendarEventId, text: 'ACCEPTED' }); expect(calendarRsvp.result.rsvp).toBe('ACCEPTED');
      await eventually(async () => (await command(root, 'alice', { action: 'calendarEventRead', eventId: calendarEventId })).result?.participants.some((value: { identityId: string; rsvp: string }) => value.rsvp === 'ACCEPTED'), 20_000);
      await command(root, 'bob', { action: 'stop' });
      const offlineCalendarEvent = await command(root, 'alice', { action: 'calendarEventCreate', calendarId, eventId: 'production-calendar-offline', text: 'Offline calendar delivery' });
      const offlineCalendarEventId = offlineCalendarEvent.result.eventId as string;
      await startPeer('bob', configPath); await command(root, 'alice', { action: 'flush', peer: 'bob' });
      await eventually(async () => (await command(root, 'bob', { action: 'calendarEventRead', eventId: offlineCalendarEventId })).result?.title === 'Offline calendar delivery', 20_000);
      const calendarSpoof = await command(root, 'mallory', { action: 'calendarSpoof', peer: 'alice', calendarId, eventId: calendarEventId }); expect(calendarSpoof.result.rejected).toBe(true);
      await pause(500); expect((await command(root, 'alice', { action: 'calendarEventRead', eventId: calendarEventId })).result?.title).toBe('Production P2P event');

      // Phase 23: the same signed group conversation over independent
      // Hyperswarm/Noise processes, including offline delivery and role checks.
      const group = await command(root, 'alice', { action: 'groupCreate', members: ['bob', 'charlie'], text: 'Production Keystone group' });
      const conversationId = group.result.conversationId as string;
      await eventually(async () => (await command(root, 'bob', { action: 'groupRead', conversationId })).result?.conversationId === conversationId);
      await eventually(async () => (await command(root, 'charlie', { action: 'groupRead', conversationId })).result?.conversationId === conversationId);
      const firstGroup = await command(root, 'alice', { action: 'groupSend', conversationId, text: 'Hello group over Noise' });
      await eventually(async () => (await command(root, 'bob', { action: 'groupRead', conversationId })).result.messages.some((message: { id: string }) => message.id === firstGroup.result.id));
      await command(root, 'charlie', { action: 'stop' }); await waitExit(charlie);
      const offlineGroup = await command(root, 'alice', { action: 'groupSend', conversationId, text: 'Charlie can receive this after reconnect' });
      await eventually(async () => (await command(root, 'bob', { action: 'groupRead', conversationId })).result.messages.some((message: { id: string }) => message.id === offlineGroup.result.id));
      charlie = await startPeer('charlie', configPath); await command(root, 'alice', { action: 'flush', peer: 'charlie' });
      await eventually(async () => (await command(root, 'charlie', { action: 'groupRead', conversationId })).result.messages.some((message: { id: string }) => message.id === offlineGroup.result.id), 20_000);
      const reply = await command(root, 'bob', { action: 'groupReply', conversationId, messageId: firstGroup.result.id, text: 'Bob reply' });
      await command(root, 'bob', { action: 'groupReact', conversationId, messageId: firstGroup.result.id, text: '👍' });
      await command(root, 'bob', { action: 'groupEdit', conversationId, messageId: reply.result.id, text: 'Bob edited reply' });
      await command(root, 'alice', { action: 'groupDelete', conversationId, messageId: firstGroup.result.id });
      await eventually(async () => (await command(root, 'charlie', { action: 'groupRead', conversationId })).result.messages.some((message: { id: string; deleted?: boolean }) => message.id !== firstGroup.result.id && message.deleted === true));
      expect((await command(root, 'bob', { action: 'groupRead', conversationId })).result.unread).toBeGreaterThan(0);
      await command(root, 'bob', { action: 'groupRead', conversationId });
      const unauthorizedAdd = await commandMaybe(root, 'bob', { action: 'groupAdd', conversationId, peer: 'mallory' }); expect(unauthorizedAdd.ok).toBe(false);
      const unauthorizedSend = await commandMaybe(root, 'mallory', { action: 'groupSend', conversationId, text: 'spoofed group message' }); expect(unauthorizedSend.ok).toBe(false);

      const served = await command(root, 'alice', { action: 'contentServe' });
      const interrupted = await command(root, 'bob', { action: 'contentFetch', peer: 'alice', manifest: served.result.manifest, interruptAt: 2 });
      expect(interrupted.result).toMatchObject({ complete: false, missing: expect.arrayContaining([2]) });
      expect((await command(root, 'bob', { action: 'contentFetch', peer: 'alice', manifest: served.result.manifest })).result).toEqual({ complete: true, missing: [] });
      const groupAttachment = await command(root, 'alice', { action: 'groupAttach', conversationId, manifest: served.result.manifest });
      await eventually(async () => (await command(root, 'charlie', { action: 'groupRead', conversationId })).result.messages.some((message: { id: string; kind: string }) => message.id === groupAttachment.result.id && message.kind === 'attachment'));
      await command(root, 'alice', { action: 'groupRemove', conversationId, peer: 'charlie' });
      await eventually(async () => !(await command(root, 'charlie', { action: 'groupRead', conversationId })).result.members.includes((await command(root, 'charlie', { action: 'socialRead' })).result.identity));

      // Phase 26: the canonical FileObject is exchanged through signed
      // production envelopes, while its content is fetched in verified chunks
      // from independent providers. The first transfer is interrupted; after
      // Charlie becomes a provider, Bob completes it without Alice online.
      const file = await command(root, 'alice', { action: 'filePublish', peer: 'bob' });
      await eventually(async () => (await command(root, 'bob', { action: 'fileRead', fileId: file.result.fileId })).result?.fileId === file.result.fileId, 20_000);
      const fileInterrupted = await command(root, 'bob', { action: 'fileFetch', peer: 'alice', providers: ['alice'], fileId: file.result.fileId, manifest: file.result.manifest, interruptAt: 2 });
      expect(fileInterrupted.result.complete).toBe(false); expect(fileInterrupted.result.missing).toEqual(expect.arrayContaining([2]));
      await command(root, 'bob', { action: 'stop' }); const restartedFileBob = await startPeer('bob', configPath); await eventually(async () => (await command(root, 'bob', { action: 'fileRead', fileId: file.result.fileId })).result?.fileId === file.result.fileId, 20_000);
      await command(root, 'alice', { action: 'filePublish', peer: 'charlie' }); await command(root, 'charlie', { action: 'fileSeed', peer: 'alice', manifest: file.result.manifest });
      await command(root, 'alice', { action: 'stop' }); await waitExit(alice); const restartedFileAlice = await startPeer('alice', configPath); void restartedFileAlice;
      const fileResumed = await command(root, 'bob', { action: 'fileFetch', providers: ['charlie'], fileId: file.result.fileId, manifest: file.result.manifest });
      expect(fileResumed.result).toMatchObject({ complete: true, bytes: 192 * 1024, status: 'complete' });
      void restartedFileBob;

      // R0P59: a malicious peer may sign a FileObject and label PE-like bytes
      // as an image, but the completed production transfer is still quarantined
      // before inspection/preview.  The remote filename is metadata only.
      const hostileFile = await command(root, 'mallory', { action: 'fileHostilePublish', peer: 'bob' });
      await eventually(async () => (await command(root, 'bob', { action: 'fileRead', fileId: hostileFile.result.fileId })).result?.fileId === hostileFile.result.fileId, 20_000);
      const hostileTransfer = await command(root, 'bob', { action: 'fileFetch', peer: 'mallory', providers: ['mallory'], fileId: hostileFile.result.fileId, manifest: hostileFile.result.manifest });
      expect(hostileTransfer.result).toMatchObject({ complete: true, status: 'complete' });
      expect(hostileTransfer.result.quarantined).toEqual(expect.arrayContaining([expect.objectContaining({ objectId: hostileFile.result.fileId, state: 'QUARANTINED' })]));
      const hostileInspection = await command(root, 'bob', { action: 'fileInspect', fileId: hostileFile.result.fileId });
      expect(hostileInspection.result).toMatchObject({ state: 'INSPECTED', risk: 'CRITICAL', executableRisk: 'CRITICAL', mismatch: true });
      expect(hostileInspection.result.preview).toBeUndefined();

      const music = await command(root, 'alice', { action: 'musicPublish', peer: 'bob' }); await eventually(async () => (await command(root, 'bob', { action: 'musicPlay', peer: 'alice', manifest: music.result.manifest })).result.trackId === music.result.trackId);
      const video = await command(root, 'alice', { action: 'videoPublish', peer: 'bob' }); expect(video.result.short).toBe(true); await eventually(async () => { const played = (await command(root, 'bob', { action: 'videoPlay', peer: 'alice', manifest: video.result.manifest })).result; return played.videoId === video.result.videoId && played.short === true && played.feed === true; });

      const community = await command(root, 'alice', { action: 'communityPublish', peer: 'bob' }); await eventually(async () => (await command(root, 'bob', { action: 'communityRead', communityId: community.result.communityId, channelId: community.result.channelId })).result.messages.includes('community over Hyperswarm'));

      // Phase 24: real independent CommunityService processes. Bob receives a
      // signed moderator role, Charlie joins after discovery, and moderation
      // cannot be bypassed by a member or by Mallory's signed spoof.
      const phase24 = await command(root, 'alice', { action: 'communityPhase24Create', members: ['bob', 'charlie'] });
      const phaseCommunityId = phase24.result.communityId as string; const phaseChannelId = phase24.result.channelId as string; const phaseEvents = phase24.result.eventIds as string[];
      await eventually(async () => { const state = (await command(root, 'bob', { action: 'communityPhase24Read', communityId: phaseCommunityId })).result; return state?.members.some((member: { identity: string; active: boolean }) => member.active); });
      const charlieJoin = await command(root, 'charlie', { action: 'communityPhase24Join', peer: 'alice', communityId: phaseCommunityId });
      await command(root, 'alice', { action: 'communityPhase24Relay', peer: 'bob', communityId: phaseCommunityId, messageId: charlieJoin.result.eventId });
      const aliceIdentity = (await command(root, 'alice', { action: 'socialRead' })).result.identity as string;
      await eventually(async () => (await command(root, 'bob', { action: 'communityPhase24Read', communityId: phaseCommunityId })).result.members.some((member: { identity: string; active: boolean }) => member.active && member.identity !== aliceIdentity));
      const bobBan = await command(root, 'bob', { action: 'communityPhase24Moderate', peer: 'alice', target: 'charlie', communityId: phaseCommunityId, text: 'ban', messageId: 'Repeated spam' });
      await command(root, 'bob', { action: 'communityPhase24Relay', peer: 'charlie', communityId: phaseCommunityId, messageId: bobBan.result.eventId });
      await eventually(async () => (await command(root, 'alice', { action: 'communityPhase24Read', communityId: phaseCommunityId })).result.audit.some((entry: { action: string; target?: string }) => entry.action === 'ban' && !!entry.target));
      const charlieAdmin = await commandMaybe(root, 'charlie', { action: 'communityPhase24Moderate', peer: 'alice', target: 'bob', communityId: phaseCommunityId, text: 'ban', messageId: 'spoof' }); expect(charlieAdmin.ok).toBe(false);
      for (const eventId of phaseEvents.slice(0, 4)) await command(root, 'alice', { action: 'communityPhase24Relay', peer: 'mallory', communityId: phaseCommunityId, messageId: eventId });
      await command(root, 'mallory', { action: 'communityPhase24SpoofRole', peer: 'alice', communityId: phaseCommunityId });
      const aliceState = await command(root, 'alice', { action: 'communityPhase24Read', communityId: phaseCommunityId }); expect(aliceState.result.roles).toHaveLength(1);
      await command(root, 'alice', { action: 'communityPhase24Replay', peer: 'mallory' }); await pause(250); expect((await command(root, 'mallory', { action: 'communityPhase24Read', communityId: phaseCommunityId })).result.roles).toHaveLength(1);
      await command(root, 'bob', { action: 'stop' }); const offlineRelay = await commandMaybe(root, 'alice', { action: 'communityPhase24Relay', peer: 'bob', communityId: phaseCommunityId, messageId: phaseEvents[3] }); expect(offlineRelay.ok).toBe(false); const restartedPhaseBob = await startPeer('bob', configPath);
      await eventually(async () => (await command(root, 'bob', { action: 'communityPhase24Read', communityId: phaseCommunityId })).result?.communityId === phaseCommunityId, 20_000);
      const phaseBobState = (await command(root, 'bob', { action: 'communityPhase24Read', communityId: phaseCommunityId })).result; expect(phaseBobState.channels.some((channel: { id: string }) => channel.id === phaseChannelId)).toBe(true); expect(phaseBobState.members.some((member: { identity: string; banned: boolean }) => member.banned)).toBe(true);

      // Phase 25: private Community uses a separate encrypted path. The
      // invite, join, epoch rotation and ciphertext all cross real
      // Hyperswarm/Noise processes; public replication is never used.
      const privateCreated = await command(root, 'alice', { action: 'privateCreate' });
      const privateCommunityId = privateCreated.result.communityId as string; const privateChannelId = privateCreated.result.channelId as string;
      await command(root, 'alice', { action: 'privateInvite', peer: 'bob', communityId: privateCommunityId });
      await eventually(async () => (await command(root, 'bob', { action: 'privateRead', communityId: privateCommunityId })).result?.epoch === 2, 20_000);
      const privateFirst = await command(root, 'alice', { action: 'privateSend', communityId: privateCommunityId, channelId: privateChannelId, text: 'encrypted over production transport' });
      await eventually(async () => (await command(root, 'bob', { action: 'privateRead', communityId: privateCommunityId })).result.messages.some((message: { id: string }) => message.id === privateFirst.result.eventId), 20_000);
      await command(root, 'alice', { action: 'privateInvite', peer: 'charlie', communityId: privateCommunityId });
      await eventually(async () => (await command(root, 'charlie', { action: 'privateRead', communityId: privateCommunityId })).result?.epoch === 3, 20_000);
      expect((await command(root, 'charlie', { action: 'privateRead', communityId: privateCommunityId })).result.messages.some((message: { text: string }) => message.text === 'encrypted over production transport')).toBe(false);
      const bobEpoch = (await command(root, 'bob', { action: 'privateRead', communityId: privateCommunityId })).result.epoch as number;
      await command(root, 'alice', { action: 'privateRemove', peer: 'bob', communityId: privateCommunityId, text: 'ban', messageId: 'device revoked' });
      await eventually(async () => (await command(root, 'charlie', { action: 'privateRead', communityId: privateCommunityId })).result?.epoch === 4, 20_000);
      expect((await command(root, 'bob', { action: 'privateRead', communityId: privateCommunityId })).result.epoch).toBe(bobEpoch);
      await eventually(async () => !(await command(root, 'bob', { action: 'privateRead', communityId: privateCommunityId })).result.members.includes((await command(root, 'bob', { action: 'socialRead' })).result.identity), 20_000);
      const privateAfter = await command(root, 'alice', { action: 'privateSend', communityId: privateCommunityId, channelId: privateChannelId, text: 'only current epoch' });
      await eventually(async () => (await command(root, 'charlie', { action: 'privateRead', communityId: privateCommunityId })).result.messages.some((message: { id: string }) => message.id === privateAfter.result.eventId), 20_000);
      expect((await command(root, 'bob', { action: 'privateRead', communityId: privateCommunityId })).result.messages.some((message: { id: string }) => message.id === privateAfter.result.eventId)).toBe(false);
      // Mallory may already be quarantined after the earlier forged profile /
      // concierge traffic.  A quarantined hostile peer must fail closed; the
      // important invariant is that Alice's epoch remains unchanged.
      const privateSpoof = await commandMaybe(root, 'mallory', { action: 'privateSpoof', peer: 'alice' });
      if (privateSpoof.ok) await pause(250);
      await eventually(async () => (await command(root, 'alice', { action: 'privateRead', communityId: privateCommunityId })).result?.epoch === 4);
      const privateReplay = await commandMaybe(root, 'alice', { action: 'privateReplay', peer: 'charlie' });
      if (privateReplay.ok) await pause(250);
      const privateTamper = await commandMaybe(root, 'alice', { action: 'privateTamper', peer: 'charlie' });
      if (privateTamper.ok) await pause(250);
      await command(root, 'charlie', { action: 'stop' }); await waitExit(charlie); charlie = await startPeer('charlie', configPath);
      await eventually(async () => (await command(root, 'charlie', { action: 'privateRead', communityId: privateCommunityId })).result?.epoch === 4, 20_000);
      await command(root, 'alice', { action: 'stop' }); await waitExit(alice); const restartedPrivateAlice = await startPeer('alice', configPath);
      await eventually(async () => (await command(root, 'alice', { action: 'privateRead', communityId: privateCommunityId })).result?.epoch === 4, 20_000);
      await command(root, 'bob', { action: 'stop' }); await waitExit(bob); const restartedPrivateBob = await startPeer('bob', configPath);
      await eventually(async () => (await command(root, 'bob', { action: 'privateRead', communityId: privateCommunityId })).result?.epoch === bobEpoch, 20_000);
      void restartedPrivateAlice; void restartedPrivateBob;
      expect((await command(root, 'mallory', { action: 'privateRead', communityId: privateCommunityId })).result).toBeUndefined();

      // Phase 54: the Shared Vault layer uses the existing production
      // Hyperswarm/Noise transport.  Alice rotates an encrypted epoch while
      // inviting Bob; the note arrives as the same Shared Vault object, and
      // the recorded wire body contains ciphertext rather than Markdown.
      const sharedVaultCreate = await command(root, 'alice', { action: 'sharedVaultCreate', text: 'Production Shared Vault' } as any);
      const sharedVaultId = sharedVaultCreate.result.vaultId as string;
      await command(root, 'alice', { action: 'sharedVaultInvite', peer: 'bob', sharedVaultId } as any);
      await eventually(async () => (await command(root, 'bob', { action: 'sharedVaultRead', sharedVaultId } as any)).result?.epoch === 2, 20_000);
      const sharedVaultNote = await command(root, 'alice', { action: 'sharedVaultNote', sharedVaultId, text: 'encrypted shared vault note' } as any);
      await eventually(async () => { const bobSharedRead = (await command(root, 'bob', { action: 'sharedVaultRead', sharedVaultId } as any)).result; return (bobSharedRead as { notes?: readonly { id: string; content: string }[] } | undefined)?.notes?.some(note => note.id === sharedVaultNote.result.noteId && note.content.includes('encrypted shared vault note')); }, 20_000);
      const sharedVaultWire = await command(root, 'alice', { action: 'sharedVaultWire' } as any);
      expect(sharedVaultWire.result.ciphertext).toBe(true);
      const sharedVaultBobEpoch = (await command(root, 'bob', { action: 'sharedVaultRead', sharedVaultId } as any)).result.epoch as number;
      await command(root, 'alice', { action: 'sharedVaultRemove', peer: 'bob', sharedVaultId } as any);
      expect((await command(root, 'alice', { action: 'sharedVaultRead', sharedVaultId } as any)).result.epoch).toBe(sharedVaultBobEpoch + 1);
      expect((await command(root, 'mallory', { action: 'sharedVaultRead', sharedVaultId } as any)).result).toBeUndefined();

      await command(root, 'alice', { action: 'webrtcOffer', peer: 'bob' }); await eventually(async () => (await command(root, 'bob', { action: 'signals' })).result.signals.some((signal: { type: string; callId: string }) => signal.type === 'call_offer' && signal.callId === 'network-call'));
      // R0P79: the production Hyperswarm/Noise path carries versioned Keystone
      // call signalling. This proves application signalling only; media remains
      // a separate host WebRTC boundary and is not overclaimed here.
      const callId = `network-call-${crypto.randomUUID()}`; const sessionId = `network-session-${crypto.randomUUID()}`;
      await command(root, 'alice', { action: 'callSignal', peer: 'bob', callSignalType: 'CALL_INVITE', callId, sessionId, sequence: 0, mode: 'audio' } as any);
      await eventually(async () => (await command(root, 'bob', { action: 'signals' })).result.signals.some((signal: { type: string; callId: string }) => signal.type === 'CALL_INVITE' && signal.callId === callId));
      await command(root, 'bob', { action: 'callSignal', peer: 'alice', callSignalType: 'CALL_ACCEPT', callId, sessionId, sequence: 1, mode: 'audio', payload: { deviceId: 'bob', claimId: `claim-${callId}` } } as any);
      await eventually(async () => (await command(root, 'alice', { action: 'signals' })).result.signals.some((signal: { type: string; callId: string }) => signal.type === 'CALL_ACCEPT' && signal.callId === callId));
      await command(root, 'alice', { action: 'callSignal', peer: 'bob', callSignalType: 'CALL_SIGNAL', callId, sessionId, sequence: 2, payload: { kind: 'ice', candidate: { candidate: 'candidate:keystone-network-proof', sdpMid: '0', sdpMLineIndex: 0 } } } as any);
      await eventually(async () => (await command(root, 'bob', { action: 'signals' })).result.signals.some((signal: { type: string; callId: string }) => signal.type === 'CALL_SIGNAL' && signal.callId === callId));
      await command(root, 'alice', { action: 'callSignal', peer: 'bob', callSignalType: 'CALL_END', callId, sessionId, sequence: 3, payload: { reason: 'hangup' } } as any);
      await eventually(async () => (await command(root, 'bob', { action: 'signals' })).result.signals.some((signal: { type: string; callId: string }) => signal.type === 'CALL_END' && signal.callId === callId));
      const live = await command(root, 'alice', { action: 'livePublish', peer: 'bob' });
      await command(root, 'alice', { action: 'livePublish', peer: 'charlie', broadcastId: live.result.broadcastId });
      await eventually(async () => (await command(root, 'bob', { action: 'liveRead', broadcastId: live.result.broadcastId })).result?.state === 'live');
      await eventually(async () => (await command(root, 'charlie', { action: 'liveRead', broadcastId: live.result.broadcastId })).result?.state === 'live');
      await command(root, 'alice', { action: 'liveSignal', peer: 'bob', broadcastId: live.result.broadcastId }); await command(root, 'alice', { action: 'liveSignal', peer: 'charlie', broadcastId: live.result.broadcastId });
      await eventually(async () => (await command(root, 'bob', { action: 'signals' })).result.signals.some((signal: { type: string; callId: string }) => signal.type === 'call_offer' && signal.callId === `live-${live.result.broadcastId}`));
      await eventually(async () => (await command(root, 'charlie', { action: 'signals' })).result.signals.some((signal: { type: string; callId: string }) => signal.type === 'call_offer' && signal.callId === `live-${live.result.broadcastId}`));
      await command(root, 'bob', { action: 'liveAnswer', peer: 'alice', broadcastId: live.result.broadcastId }); await eventually(async () => (await command(root, 'alice', { action: 'signals' })).result.signals.some((signal: { type: string; callId: string }) => signal.type === 'call_answer' && signal.callId === `live-${live.result.broadcastId}`));
      await command(root, 'alice', { action: 'liveChat', peer: 'bob', broadcastId: live.result.broadcastId, text: 'hello from Alice live' }); await eventually(async () => { const read = (await command(root, 'bob', { action: 'liveRead', broadcastId: live.result.broadcastId })).result; return read?.state === 'live' && read.chatCount === 1; });
      await command(root, 'bob', { action: 'stop' }); await waitExit(bob); await startPeer('bob', configPath); await command(root, 'alice', { action: 'livePublish', peer: 'bob', broadcastId: live.result.broadcastId }); await eventually(async () => (await command(root, 'bob', { action: 'liveRead', broadcastId: live.result.broadcastId })).result?.state === 'live'); await command(root, 'alice', { action: 'liveSignal', peer: 'bob', broadcastId: live.result.broadcastId }); await eventually(async () => (await command(root, 'bob', { action: 'signals' })).result.signals.some((signal: { type: string; callId: string }) => signal.type === 'call_offer' && signal.callId === `live-${live.result.broadcastId}`));
      const ended = await command(root, 'alice', { action: 'liveEnd', peer: 'bob', broadcastId: live.result.broadcastId }); await command(root, 'alice', { action: 'liveEnd', peer: 'charlie', broadcastId: live.result.broadcastId });
      await eventually(async () => (await command(root, 'bob', { action: 'liveRead', broadcastId: ended.result.broadcastId })).result?.state === 'ended'); await eventually(async () => (await command(root, 'charlie', { action: 'liveRead', broadcastId: ended.result.broadcastId })).result?.state === 'ended');

      const discovery = await command(root, 'alice', { action: 'discoveryPublish', peer: 'bob' });
      await command(root, 'alice', { action: 'discoveryPublish', peer: 'charlie' });
      await command(root, 'bob', { action: 'discoveryFollow', peer: 'alice' });
      await eventually(async () => { const read = (await command(root, 'bob', { action: 'discoveryRead', text: 'Discovery' })).result; return read.search.some((item: { id: string }) => item.id === discovery.result.ids.find((id: string) => id)); });
      const bobDiscovery = (await command(root, 'bob', { action: 'discoveryRead', text: 'Discovery' })).result;
      const charlieDiscovery = (await command(root, 'charlie', { action: 'discoveryRead', text: 'Discovery' })).result;
      expect(bobDiscovery.search.map((item: { id: string }) => item.id)).toEqual(expect.arrayContaining(discovery.result.ids));
      expect(charlieDiscovery.search.map((item: { id: string }) => item.id)).toEqual(expect.arrayContaining(discovery.result.ids));
      expect(bobDiscovery.feed.map((item: { id: string }) => item.id)).toEqual(expect.arrayContaining(discovery.result.ids.filter((id: string, index: number) => ['track', 'video', 'live_broadcast'].includes(discovery.result.types[index]))));
      await command(root, 'mallory', { action: 'discoverySpoof', peer: 'bob' });
      await eventually(async () => (await command(root, 'bob', { action: 'discoveryStats' })).result.rejected > 0);
      // Real transport regression: Mallory sends a valid signed public object
      // carrying an attacker-controlled SAFE label. Bob's recipient-local
      // SafetySurfaceGate evaluates the payload before Discovery/Search can see it.
      const beforeSafetyRejects = (await command(root, 'bob', { action: 'discoveryStats' })).result.rejected as number;
      const malicious = await command(root, 'mallory', { action: 'discoveryMaliciousSafe', peer: 'bob' });
      await eventually(async () => (await command(root, 'bob', { action: 'discoveryStats' })).result.rejected > beforeSafetyRejects);
      const afterMalicious = (await command(root, 'bob', { action: 'discoveryRead', text: 'explicit nude' })).result;
      expect(afterMalicious.search.some((item: { id: string }) => item.id === malicious.result.postId)).toBe(false);
      await command(root, 'bob', { action: 'stop' }); await waitExit(restartedBob); const discoveryBobRestarted = await startPeer('bob', configPath);
      const persistedDiscovery = (await command(root, 'bob', { action: 'discoveryRead', text: 'Discovery' })).result;
      expect(persistedDiscovery.search.map((item: { id: string }) => item.id)).toEqual(expect.arrayContaining(discovery.result.ids));

      // Phase 22: signed Profiles/social graph and local notifications over the
      // same production Hyperswarm/Noise transport.
      const aliceProfile = await command(root, 'alice', { action: 'profilePublish', peer: 'bob' });
      await eventually(async () => (await command(root, 'bob', { action: 'profileRead', peer: 'alice' })).result?.id === aliceProfile.result.id);
      await command(root, 'alice', { action: 'follow', peer: 'bob' });
      await eventually(async () => (await command(root, 'bob', { action: 'socialRead' })).result.followers.includes((await command(root, 'alice', { action: 'socialRead' })).result.identity));
      await eventually(async () => (await command(root, 'bob', { action: 'notificationRead' })).result.notifications.some((item: { category: string }) => item.category === 'follow'));
      const bobVideo = await command(root, 'bob', { action: 'videoPublish', peer: 'alice' });
      await eventually(async () => { const value = (await command(root, 'alice', { action: 'notificationRead' })).result; return value.notifications.some((item: { category: string; objectId: string }) => item.category === 'short' && item.objectId === bobVideo.result.videoId); });
      await eventually(async () => (await command(root, 'alice', { action: 'discoveryRead', text: 'Noise video' })).result.search.some((item: { id: string }) => item.id === bobVideo.result.videoId));
      await command(root, 'charlie', { action: 'follow', peer: 'alice' });
      await eventually(async () => (await command(root, 'alice', { action: 'socialRead' })).result.followers.length > 0);
      await command(root, 'alice', { action: 'block', peer: 'charlie' });
      const charlieId = (await command(root, 'charlie', { action: 'socialRead' })).result.identity;
      await eventually(async () => !(await command(root, 'alice', { action: 'socialRead' })).result.followers.includes(charlieId));
      await command(root, 'mallory', { action: 'socialSpoof', peer: 'alice' });
      await eventually(async () => (await command(root, 'alice', { action: 'socialStats' })).result.rejected > 0);
      expect((await command(root, 'alice', { action: 'notificationRead' })).result.notifications.every((item: { actor: string }) => item.actor !== charlieId)).toBe(true);
      await command(root, 'bob', { action: 'stop' }); await waitExit(discoveryBobRestarted); const socialBobRestarted = await startPeer('bob', configPath);
      await eventually(async () => (await command(root, 'bob', { action: 'socialRead' })).result.followers.length > 0);
      expect((await command(root, 'bob', { action: 'notificationStats' })).result.total).toBeGreaterThan(0);
      // Phase 27: a second independent process is authorized as Alice's
      // trusted device, receives the signed lifecycle, and is rejected after
      // revocation. Mallory's authority spoof is rejected as well.
      const authorization = await command(root, 'alice', { action: 'deviceAuthorize', peer: 'alice_device', text: 'Alice tablet', messageId: 'android' });
      await eventually(async () => (await command(root, 'alice_device', { action: 'deviceRead' })).result.devices.some((device: { deviceId: string; name: string; revoked: boolean }) => device.deviceId === authorization.result.deviceId && device.name === 'Alice tablet' && !device.revoked), 20_000);
      const privileged = await command(root, 'alice_device', { action: 'devicePrivileged', peer: 'alice', text: 'settings.update' });
      await eventually(async () => (await command(root, 'alice', { action: 'deviceStats' })).result.accepted > 0, 20_000);
      // R0P73: Personal Device Mesh enrollment is a separate owner-authorized
      // device identity, not an inference from the human DeviceService label.
      // The request, authorization, replication receipt, restart and revocation
      // all cross the production Fabric/Hyperswarm/Noise path.
      const meshRequest = await command(root, 'alice_phone', { action: 'meshEnrollRequest', text: 'Alice phone mesh', messageId: 'android' });
      const meshAuthorization = await command(root, 'alice', { action: 'meshAuthorize', meshRequest: meshRequest.result.request, confirm: true });
      expect((await command(root, 'alice_phone', { action: 'meshAccept', meshAuthorization: meshAuthorization.result.authorization })).result.accepted).toBe(true);
      await eventually(async () => (await command(root, 'alice', { action: 'meshRead' })).result.devices.some((device: { deviceId: string; state: string }) => device.deviceId === meshRequest.result.request.deviceId && device.state === 'TRUSTED'), 20_000);
      const meshObject = await command(root, 'alice', { action: 'meshReplicate', peer: 'alice_phone', objectId: 'mesh:trip-plan', objectType: 'shared-note', objectVersion: '1', payload: { title: 'Trip plan', body: 'same signed object' } });
      expect(meshObject.result.requests).toHaveLength(1);
      await command(root, 'alice', { action: 'meshFlush', peer: 'alice_phone' });
      await eventually(async () => (await command(root, 'alice_phone', { action: 'meshRead' })).result.replicas.some((replica: { objectId: string; status: string }) => replica.objectId === 'mesh:trip-plan' && replica.status === 'CONFIRMED'), 20_000);
      await command(root, 'alice_phone', { action: 'stop' }); await waitExit(alicePhone);
      const offlineMeshObject = await command(root, 'alice', { action: 'meshReplicate', peer: 'alice_phone', objectId: 'mesh:offline', objectType: 'note', objectVersion: '1', payload: { body: 'resume after restart' } });
      expect(offlineMeshObject.result.requests).toHaveLength(1);
      expect((await command(root, 'alice', { action: 'meshRead', peer: 'alice_phone' })).result.pending.length).toBeGreaterThan(0);
      const restartedAlicePhone = await startPeer('alice_phone', configPath); void restartedAlicePhone;
      await command(root, 'alice', { action: 'meshFlush', peer: 'alice_phone' });
      await eventually(async () => (await command(root, 'alice_phone', { action: 'meshRead' })).result.replicas.some((replica: { objectId: string; status: string }) => replica.objectId === 'mesh:offline' && replica.status === 'CONFIRMED'), 20_000);
      const meshRevocation = await command(root, 'alice', { action: 'meshRevoke', peer: 'alice_phone', reason: 'lost phone' });
      await eventually(async () => (await command(root, 'alice_phone', { action: 'meshRead' })).result.revoked === true, 20_000);
      expect((await commandMaybe(root, 'alice_phone', { action: 'meshReplicate', peer: 'alice', objectId: 'mesh:revoked', objectType: 'note', payload: { body: 'must reject' } })).ok).toBe(false);
      const revocation = await command(root, 'alice', { action: 'deviceRevoke', peer: 'alice_device', text: 'device removed by owner' });
      await eventually(async () => (await command(root, 'alice_device', { action: 'deviceRead' })).result.devices.some((device: { deviceId: string; revoked: boolean }) => device.deviceId === revocation.result.deviceId && device.revoked), 20_000);
      const revokedAttempt = await commandMaybe(root, 'alice_device', { action: 'devicePrivileged', peer: 'alice', text: 'settings.update' }); expect(revokedAttempt.ok).toBe(false);
      await command(root, 'alice_device', { action: 'devicePrivilegedSpoof', peer: 'alice', text: privileged.result.eventId });
      await eventually(async () => (await command(root, 'alice', { action: 'deviceRead' })).result.events.rejected > 0, 20_000);
      await command(root, 'bob', { action: 'deviceSpoof', peer: 'alice' }); await command(root, 'mallory', { action: 'deviceSpoof', peer: 'alice' }); await eventually(async () => (await command(root, 'alice', { action: 'deviceRead' })).result.events.suspicious > 1, 20_000);
      await command(root, 'alice_device', { action: 'stop' }); await waitExit(aliceDevice); aliceDevice = await startPeer('alice_device', configPath);
      await eventually(async () => (await command(root, 'alice_device', { action: 'deviceRead' })).result.devices.some((device: { deviceId: string; revoked: boolean }) => device.deviceId === revocation.result.deviceId && device.revoked), 20_000);
      // Phase 28: export the durable Alice state, destroy the old installation,
      // and restore it into a fresh process. The recovered process derives the
      // same identity from the encrypted backup and continues talking to Bob.
      const recoverySecret = 'phase28-real-network-recovery-secret';
      const identityBeforeRecovery = (await command(root, 'alice', { action: 'socialRead' })).result.identity as string;
      await command(root, 'alice', { action: 'settingsSet', text: 'ru' });
      const backup = await command(root, 'alice', { action: 'backupCreate', text: recoverySecret });
      expect(backup.result.manifest.version).toBe(2); expect(backup.result.manifest.cacheIncluded).toBe(false);
      expect((await command(root, 'alice', { action: 'backupInspect' })).result.sections).toContain('private-communities');
      const oldInstall = join(root, 'alice-old-installation'); await rm(oldInstall, { recursive: true, force: true });
      await command(root, 'alice', { action: 'stop' }); await waitExit(alice); await rename(join(root, 'alice'), oldInstall);
      alice = await startPeer('alice', configPath, { restoreFile: join(oldInstall, 'phase28-backup.keystone'), restoreSecret: recoverySecret });
      await eventually(async () => (await command(root, 'alice', { action: 'socialRead' })).result.identity === identityBeforeRecovery, 20_000);
      expect((await command(root, 'alice', { action: 'settingsRead' })).result.appearance.language).toBe('ru');
      expect((await command(root, 'alice', { action: 'privateRead', communityId: privateCommunityId })).result?.epoch).toBe(4);
      const recoveredMessage = await command(root, 'alice', { action: 'sendText', peer: 'bob', text: 'continued after device migration' });
      await eventually(async () => (await command(root, 'bob', { action: 'history', peer: 'alice' })).result.messages.some((message: { id: string }) => message.id === recoveredMessage.result.id), 20_000);
      const postMigrationRevocation = await command(root, 'alice', { action: 'deviceRevoke', peer: 'alice_device', text: 'old installation revoked after recovery' });
      await eventually(async () => (await command(root, 'alice_device', { action: 'deviceRead' })).result.devices.some((device: { deviceId: string; revoked: boolean }) => device.deviceId === postMigrationRevocation.result.deviceId && device.revoked), 20_000);
      expect((await commandMaybe(root, 'alice_device', { action: 'devicePrivileged', peer: 'alice', text: 'settings.update' })).ok).toBe(false);

      // Phase 30: two independent Alice devices use the model physically
      // hosted by Alice Laptop. The fake provider is behind PersonalAIHost's
      // AIProvider boundary; tokens still cross real Hyperswarm/Noise frames.
      const laptopAdvertisement = await command(root, 'alice_phone', { action: 'aiDiscover', peer: 'alice' });
      expect(laptopAdvertisement.result.capability).toBe('AI_COMPUTE');
      expect(laptopAdvertisement.result.models[0].ref).toEqual({ provider: 'test-host', model: 'qwen' });
      const [phoneInference, tabletInference] = await Promise.all([
        command(root, 'alice_phone', { action: 'aiInfer', peer: 'alice', text: 'phone private inference' }),
        command(root, 'alice_tablet', { action: 'aiInfer', peer: 'alice', text: 'tablet private inference' }),
      ]);
      expect(phoneInference.result.text).toBe('Alice-host ' + 'stream works');
      expect(tabletInference.result.text).toBe('Alice-host ' + 'stream works');
      expect((await command(root, 'alice', { action: 'aiStats' })).result.maxConcurrent).toBe(2);
      const unauthorizedBob = await commandMaybe(root, 'bob', { action: 'aiDiscover', peer: 'alice' });
      expect(unauthorizedBob.ok).toBe(false);
      const unauthorizedMallory = await commandMaybe(root, 'mallory', { action: 'aiDiscover', peer: 'alice' });
      expect(unauthorizedMallory.ok).toBe(false);
      const revokedPhone = await command(root, 'alice', { action: 'aiRevoke', peer: 'alice_phone', text: 'trusted AI access revoked' });
      expect(revokedPhone.result.revoked).toBe(true);
      expect((await commandMaybe(root, 'alice_phone', { action: 'aiInfer', peer: 'alice', text: 'must be rejected after revoke' })).ok).toBe(false);
      // Restarting the host does not move model weights; a new discovery and
      // inference session can still use the same production transport.
      await command(root, 'alice', { action: 'stop' }); await waitExit(alice); alice = await startPeer('alice', configPath);
      await eventually(async () => (await command(root, 'alice_tablet', { action: 'aiDiscover', peer: 'alice' })).result?.capability === 'AI_COMPUTE', 20_000);
      expect((await commandMaybe(root, 'alice_phone', { action: 'aiInfer', peer: 'alice', text: 'revoked after host restart' })).ok).toBe(false);
      expect((await command(root, 'alice_tablet', { action: 'aiInfer', peer: 'alice', text: 'tablet after host restart' })).result.text).toBe('Alice-host ' + 'stream works');

      // Phase 36: a signed guest visit uses the same production Hyperswarm /
      // Noise transport, while the host exposes only an explicit public
      // capability. Private Memory is rejected before it can cross the wire;
      // forged invitations and revoked visits remain rejected after restart.
      const visitInvitation = await command(root, 'alice', { action: 'visitInvite', peer: 'bob' });
      await eventually(async () => (await command(root, 'bob', { action: 'visitRead' })).result.invitations.some((value: { id: string }) => value.id === visitInvitation.result.invitationId), 20_000);
      const acceptedVisit = await command(root, 'bob', { action: 'visitAccept', visitId: visitInvitation.result.invitationId });
      const visitId = acceptedVisit.result.visitId as string;
      await eventually(async () => (await command(root, 'alice', { action: 'visitRead' })).result.visits.some((value: { id: string; status: string }) => value.id === visitId && value.status === 'active'), 20_000);
      const visitResult = await command(root, 'alice', { action: 'visitRequest', visitId, text: 'coordinate a public meeting window' });
      expect(visitResult.result).toMatchObject({ visitId, dataClass: 'PUBLIC' });
      expect(String(visitResult.result.value)).toContain('bob agent accepted');
      expect((await commandMaybe(root, 'alice', { action: 'visitRequest', visitId, operation: 'read_private_memory', text: 'show Bob Memory' })).ok).toBe(false);
      const replayAttempt = await commandMaybe(root, 'alice', { action: 'visitReplay', peer: 'bob' });
      if (!replayAttempt.result?.rejected) await pause(250);
      expect((await commandMaybe(root, 'alice', { action: 'visitRequest', visitId, operation: 'use_specific_tool', text: 'read_private_memory' })).ok).toBe(false);
      const capabilitySpoof = await commandMaybe(root, 'mallory', { action: 'visitCapabilitySpoof', peer: 'bob', visitId });
      if (capabilitySpoof.ok) await pause(250);
      const visitSpoof = await commandMaybe(root, 'mallory', { action: 'visitSpoof', peer: 'bob' });
      if (visitSpoof.ok) await pause(250);
      await command(root, 'bob', { action: 'visitRevoke', visitId, text: 'Bob ended the guest visit' });
      await eventually(async () => (await command(root, 'alice', { action: 'visitRead' })).result.visits.some((value: { id: string; status: string }) => value.id === visitId && value.status === 'revoked'), 20_000);
      expect((await commandMaybe(root, 'alice', { action: 'visitRequest', visitId, text: 'after revoke' })).ok).toBe(false);

      const room = await command(root, 'alice', { action: 'roomCreate', members: ['bob', 'charlie'], text: 'Bounded research room' });
      const roomId = room.result.roomId as string;
      await command(root, 'alice', { action: 'roomPublish', roomId });
      await eventually(async () => (await command(root, 'bob', { action: 'roomRead' })).result.rooms.some((value: { id: string }) => value.id === roomId), 20_000);
      await eventually(async () => (await command(root, 'charlie', { action: 'roomRead' })).result.rooms.some((value: { id: string }) => value.id === roomId), 20_000);
      await command(root, 'alice', { action: 'roomMessage', roomId, text: 'Only explicitly shared room context' });
      await eventually(async () => (await command(root, 'bob', { action: 'roomRead' })).result.messages.some((value: { roomId: string; text: string }) => value.roomId === roomId && value.text === 'Only explicitly shared room context'), 20_000);
      await eventually(async () => (await command(root, 'charlie', { action: 'roomRead' })).result.messages.some((value: { roomId: string; text: string }) => value.roomId === roomId && value.text === 'Only explicitly shared room context'), 20_000);
      expect((await commandMaybe(root, 'mallory', { action: 'roomMessage', roomId, text: 'unauthorized room write' })).ok).toBe(false);

      // Phase 37: Shared Space uses the same production Hyperswarm/Noise
      // transport, with signed membership and Yjs state updates.  The private
      // case sends only recipient-wrapped epoch keys and ciphertext.
      const shared = await command(root, 'alice', { action: 'spaceCreate', members: ['bob', 'charlie'], text: 'Production Trip' });
      const sharedSpaceId = shared.result.spaceId as string; const sharedDocumentId = shared.result.documentId as string;
      await command(root, 'alice', { action: 'spacePublish', spaceId: sharedSpaceId });
      await eventually(async () => (await command(root, 'bob', { action: 'spaceRead', spaceId: sharedSpaceId })).result.documents.some((value: { id: string }) => value.id === sharedDocumentId), 20_000);
      await eventually(async () => (await command(root, 'charlie', { action: 'spaceRead', spaceId: sharedSpaceId })).result.documents.some((value: { id: string }) => value.id === sharedDocumentId), 20_000);
      const agentGrant = await command(root, 'alice', { action: 'spaceGrantAgent', spaceId: sharedSpaceId, peer: 'bob' });
      expect(agentGrant.result.agentId).toBe('bob-agent');
      const agentEdit = await eventually(async () => { const response = await commandMaybe(root, 'bob', { action: 'spaceAgentEdit', spaceId: sharedSpaceId, messageId: sharedDocumentId, text: 'Bob Agent production edit' }); return response.ok ? response : undefined; }, 20_000);
      expect(agentEdit.result.body).toBe('Bob Agent production edit');
      await eventually(async () => (await command(root, 'alice', { action: 'spaceRead', spaceId: sharedSpaceId })).result.documents.some((value: { id: string; body: string }) => value.id === sharedDocumentId && value.body === 'Bob Agent production edit'), 20_000);
      const privateShared = await command(root, 'alice', { action: 'spaceCreate', members: ['bob'], visibility: 'private', text: 'Private Production Trip' });
      const privateSpaceId = privateShared.result.spaceId as string; const privateDocumentId = privateShared.result.documentId as string;
      await command(root, 'alice', { action: 'spacePublish', spaceId: privateSpaceId });
      await eventually(async () => (await command(root, 'bob', { action: 'spaceRead', spaceId: privateSpaceId })).result.documents.some((value: { id: string }) => value.id === privateDocumentId), 20_000);
      await command(root, 'alice', { action: 'spaceRemove', spaceId: privateSpaceId, peer: 'bob', text: 'epoch rotation after removal' });
      await eventually(async () => !(await commandMaybe(root, 'bob', { action: 'spaceRead', spaceId: privateSpaceId })).ok, 20_000);
      expect((await commandMaybe(root, 'mallory', { action: 'spaceRead', spaceId: sharedSpaceId })).ok).toBe(false);

      await command(root, 'alice', { action: 'stop' }); await waitExit(alice); alice = await startPeer('alice', configPath);
      await eventually(async () => (await command(root, 'alice', { action: 'visitRead' })).result.visits.some((value: { id: string; status: string }) => value.id === visitId && value.status === 'revoked'), 20_000);
      expect((await commandMaybe(root, 'alice', { action: 'visitRequest', visitId, text: 'revoked after restart' })).ok).toBe(false);
      // ChildProcess handles become stale after the repeated role restarts
      // above.  Probe each currently running role through its command channel
      // instead of asserting exitCode on an old handle.
      for (const liveRole of ['bob', 'alice_device', 'alice_phone', 'alice_tablet', 'charlie', 'mallory'] as Role[]) {
        expect((await command(root, liveRole, { action: 'meshRead' })).ok).toBe(true);
      }
      await Promise.all((['alice', 'alice_device', 'alice_phone', 'alice_tablet', 'bob', 'charlie', 'mallory'] as Role[]).map(peer => command(root, peer, { action: 'stop' })));
      await Promise.all(peers.map(waitExit));
    } finally { await bootstrap.destroy(); }
  }, 300_000);

  it('publishes signed immutable revisions and fetches the same content over production Hyperswarm', async () => {
    const root = await mkdtemp(join(tmpdir(), 'keystone-real-publication-')); roots.push(root);
    const port = await freeUdpPort(); const bootstrap = DHT.bootstrapper(port, '127.0.0.1');
    try {
      const roleNames: Role[] = ['alice', 'alice_device', 'alice_phone', 'alice_tablet', 'bob', 'charlie', 'mallory'];
      const seeds = Object.fromEntries(await Promise.all(roleNames.map(async name => [name, (await IdentityManager.generate()).masterSeed] as const))) as unknown as Record<Role, string>;
      const configPath = join(root, 'network.json'); await atomicWrite(configPath, { root, bootstrap: `127.0.0.1:${port}`, seeds });
      const alice = await startPeer('alice', configPath); const bob = await startPeer('bob', configPath);
      const body = `Phase 80 production publication\n${'immutable-content-'.repeat(16_000)}`;
      const draft = await command(root, 'alice', { action: 'publicationCreate', text: 'Alice personal page', payload: body });
      const published = await command(root, 'alice', { action: 'publicationPublish', objectId: draft.result.draftId, peer: 'bob', publicationVisibility: 'PUBLIC' });
      const publicationId = published.result.publicationId as string;
      await eventually(async () => (await command(root, 'bob', { action: 'publicationRead', objectId: publicationId })).result.latest?.revisionAddress === published.result.revisionAddress, 30_000);
      const fetched = await command(root, 'bob', { action: 'publicationFetch', objectId: publicationId, peer: 'alice' });
      expect(fetched.result).toMatchObject({ publicationId, revisionAddress: published.result.revisionAddress, contentId: published.result.contentId });
      expect(fetched.result.content).toBe(body);

      const updatedBody = `${body}\nrevision-2`;
      const updated = await command(root, 'alice', { action: 'publicationUpdate', objectId: publicationId, peer: 'bob', text: 'Alice personal page v2', payload: updatedBody, publicationVisibility: 'PUBLIC' });
      await eventually(async () => (await command(root, 'bob', { action: 'publicationRead', objectId: publicationId })).result.latest?.revisionAddress === updated.result.revisionAddress, 30_000);
      const oldRevision = await command(root, 'bob', { action: 'publicationRead', objectId: publicationId, messageId: published.result.revisionAddress });
      expect(oldRevision.result.exact).toMatchObject({ revisionAddress: published.result.revisionAddress, revisionNumber: 1, title: 'Alice personal page' });
      const oldFetched = await command(root, 'bob', { action: 'publicationFetch', objectId: publicationId, peer: 'alice', messageId: published.result.revisionAddress });
      expect(oldFetched.result.content).toBe(body);
      const latestFetched = await command(root, 'bob', { action: 'publicationFetch', objectId: publicationId, peer: 'alice' });
      expect(latestFetched.result).toMatchObject({ revisionAddress: updated.result.revisionAddress, content: updatedBody });

      await command(root, 'alice', { action: 'publicationUnpublish', objectId: publicationId });
      expect((await command(root, 'alice', { action: 'publicationRead', objectId: publicationId })).result.latest).toBeUndefined();
      await command(root, 'alice', { action: 'stop' }); await command(root, 'bob', { action: 'stop' });
      await Promise.all([waitExit(alice), waitExit(bob)]);
    } finally { await bootstrap.destroy(); }
  }, 120_000);

  it('retries a queued direct message after sender and recipient restart without manual flush', async () => {
    const root = await mkdtemp(join(tmpdir(), 'keystone-real-delivery-')); roots.push(root);
    const port = await freeUdpPort(); const bootstrap = DHT.bootstrapper(port, '127.0.0.1');
    try {
      const roleNames: Role[] = ['alice', 'alice_device', 'alice_phone', 'alice_tablet', 'bob', 'charlie', 'mallory'];
      const seeds = Object.fromEntries(await Promise.all(roleNames.map(async name => [name, (await IdentityManager.generate()).masterSeed] as const))) as unknown as Record<Role, string>;
      const configPath = join(root, 'network.json'); await atomicWrite(configPath, { root, bootstrap: `127.0.0.1:${port}`, seeds });
      let alice = await startPeer('alice', configPath); let mallory = await startPeer('mallory', configPath);
      const warmup = await command(root, 'alice', { action: 'sendText', peer: 'mallory', text: 'warmup delivery' });
      await eventually(async () => (await command(root, 'mallory', { action: 'history', peer: 'alice' })).result.messages.some((message: { id: string }) => message.id === warmup.result.id), 20_000);
      await command(root, 'mallory', { action: 'stop' }); await waitExit(mallory);
      const queued = await command(root, 'alice', { action: 'sendText', peer: 'mallory', text: 'queued across restart' });
      expect(queued.ok).toBe(true);
      // The sender must recover its durable outbox too; reconnect delivery
      // cannot depend on the original process's in-memory retry timer.
      await command(root, 'alice', { action: 'stop' }); await waitExit(alice);
      alice = await startPeer('alice', configPath);
      mallory = await startPeer('mallory', configPath);
      await eventually(async () => (await command(root, 'mallory', { action: 'history', peer: 'alice' })).result.messages.some((message: { id: string }) => message.id === queued.result.id), 20_000);
      const history = (await command(root, 'mallory', { action: 'history', peer: 'alice' })).result.messages;
      expect(history.filter((message: { id: string }) => message.id === queued.result.id)).toHaveLength(1);
      await command(root, 'alice', { action: 'stop' }); await command(root, 'mallory', { action: 'stop' });
      await Promise.all([waitExit(alice), waitExit(mallory)]);
    } finally { await bootstrap.destroy(); }
  }, 120_000);
});

async function startPeer(role: Role, configPath: string, options: { directory?: string; restoreFile?: string; restoreSecret?: string } = {}): Promise<ChildProcess> {
  const coreRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url)))); const vitest = join(coreRoot, 'node_modules', 'vitest', 'vitest.mjs');
  const directory = options.directory ?? join(dirname(configPath), role); await mkdir(directory, { recursive: true, mode: 0o700 });
  await Promise.all(['ready.json', 'command.json'].map(name => unlink(join(directory, name)).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; })));
  const restoreSecretEnv = 'KEYSTONE_NETWORK_RESTORE_' + 'SECRET';
  const started = Date.now();
  installInterruptCleanup();
  const child = spawn(process.execPath, [vitest, 'run', 'src/testing/network-peer.test.ts', '--pool=forks', '--poolOptions.forks.singleFork=true'], { cwd: coreRoot, detached: process.platform !== 'win32', env: { ...process.env, KEYSTONE_NETWORK_TIMELINE: process.env.KEYSTONE_NETWORK_TIMELINE, KEYSTONE_NETWORK_CONFIG: configPath, KEYSTONE_NETWORK_ROLE: role, KEYSTONE_NETWORK_DIRECTORY: directory, ...(options.restoreFile ? { KEYSTONE_NETWORK_RESTORE_FILE: options.restoreFile } : {}), ...(options.restoreSecret ? { [restoreSecretEnv]: options.restoreSecret } : {}) }, stdio: ['ignore', 'pipe', 'pipe'] });
  peers.push(child); let output = ''; peerLogs.set(role, output); child.stdout?.on('data', value => { output += value; peerLogs.set(role, output); process.env.KEYSTONE_NETWORK_TIMELINE === '1' && process.stderr.write(`[${role}] ${String(value)}`); }); child.stderr?.on('data', value => { output += value; peerLogs.set(role, output); process.env.KEYSTONE_NETWORK_TIMELINE === '1' && process.stderr.write(`[${role}] ${String(value)}`); });
  await eventually(async () => !!(await readJson(join(dirname(configPath), role, 'ready.json'))), 30_000, () => output);
  if (process.env.KEYSTONE_NETWORK_TIMELINE === '1') console.error(`[R0P67-TIMELINE] ${new Date().toISOString()} harness.startPeer role=${role} durationMs=${Date.now() - started}`);
  return child;
}

async function command(root: string, role: Role, input: Omit<Command, 'id'>): Promise<Response> {
  const started = Date.now(); const id = crypto.randomUUID(), directory = join(root, role); await atomicWrite(join(directory, 'command.json'), { id, ...input });
  const response = await eventually(async () => readJson<Response>(join(directory, `response-${id}.json`)), 30_000, () => [...peerLogs.entries()].map(([name, log]) => `${name}: ${log.slice(-2_000)}`).join('\n'));
  if (process.env.KEYSTONE_NETWORK_TIMELINE === '1') console.error(`[R0P67-TIMELINE] ${new Date().toISOString()} harness.command role=${role} action=${input.action} durationMs=${Date.now() - started}`);
  if (!response.ok) throw new Error(`${role} command ${input.action} failed: ${response.error}`); return response;
}
async function commandMaybe(root: string, role: Role, input: Omit<Command, 'id'>): Promise<Response> {
  const id = crypto.randomUUID(), directory = join(root, role); await atomicWrite(join(directory, 'command.json'), { id, ...input });
  return eventually(async () => readJson<Response>(join(directory, `response-${id}.json`)), 30_000);
}
// A condition that throws (e.g. "Track not received" before replication lands) means "not yet"; keep polling and report the last error on timeout.
async function eventually<T>(condition: () => Promise<T | false | undefined>, timeout = 12_000, detail?: () => string): Promise<T> { const end = Date.now() + timeout; let lastError: unknown; while (Date.now() < end) { try { const value = await condition(); if (value) return value; } catch (error) { lastError = error; } await pause(50); } throw new Error(`Timed out after ${timeout}ms${lastError ? ` (last error: ${lastError instanceof Error ? lastError.message : String(lastError)})` : ''}${detail ? `: ${detail()}` : ''}`); }
async function freeUdpPort(): Promise<number> { const socket = createSocket('udp4'); await new Promise<void>((resolve, reject) => { socket.once('error', reject); socket.bind(0, '127.0.0.1', () => resolve()); }); const address = socket.address(); socket.close(); return typeof address === 'string' ? 0 : address.port; }
async function readJson<T>(path: string): Promise<T | undefined> { try { return JSON.parse(await readFile(path, 'utf8')) as T; } catch (error: any) { if (error?.code === 'ENOENT' || error instanceof SyntaxError) return undefined; throw error; } }
async function atomicWrite(path: string, value: unknown): Promise<void> { const temporary = `${path}.${crypto.randomUUID()}.tmp`; await writeFile(temporary, JSON.stringify(value), { mode: 0o600 }); await rename(temporary, path); }
async function stopProcess(process: ChildProcess): Promise<void> { if (childExited(process)) return; const terminated = waitExit(process); signalPeerTree(process, 'SIGTERM'); await Promise.race([terminated, pause(2_000)]); if (!childExited(process)) { const killed = waitExit(process); signalPeerTree(process, 'SIGKILL'); await Promise.race([killed, pause(500)]); } }
function childExited(process: ChildProcess): boolean { return process.exitCode !== null || process.signalCode !== null; }
function waitExit(process: ChildProcess): Promise<void> { return childExited(process) ? Promise.resolve() : new Promise(resolve => process.once('exit', () => resolve())); }
function pause(ms: number): Promise<void> { return new Promise(resolve => setTimeout(resolve, ms)); }
