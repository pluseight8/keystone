import { describe, expect, it } from 'vitest';
import {
  AgentWorkboardService,
  InMemoryWorkboardStateStore,
  WorkboardError,
  type WorkboardEvent,
  type WorkboardReplicationAdapter,
} from './workboards.js';

const publicScope = { dataClasses: ['PUBLIC'] as const };

function expectWorkboardError(error: unknown, code: string): void {
  expect(error).toBeInstanceOf(WorkboardError);
  expect((error as WorkboardError).code).toBe(code);
}

class ReplicationBus {
  private readonly listeners = new Map<string, Set<(event: WorkboardEvent) => void>>();
  private readonly online = new Set<string>();
  private readonly queued = new Map<string, WorkboardEvent[]>();

  adapter(identityId: string): WorkboardReplicationAdapter {
    this.listeners.set(identityId, new Set());
    this.online.add(identityId);
    return {
      publish: async (event, recipients = []) => {
        for (const recipient of recipients) {
          if (!this.online.has(recipient)) {
            const pending = this.queued.get(recipient) ?? [];
            pending.push(structuredClone(event));
            this.queued.set(recipient, pending);
            continue;
          }
          for (const listener of this.listeners.get(recipient) ?? []) listener(structuredClone(event));
        }
      },
      subscribe: listener => {
        this.listeners.get(identityId)!.add(listener);
        return () => this.listeners.get(identityId)?.delete(listener);
      },
    };
  }

  setOnline(identityId: string, online: boolean): void {
    if (online) {
      this.online.add(identityId);
      const pending = this.queued.get(identityId) ?? [];
      this.queued.delete(identityId);
      for (const event of pending) for (const listener of this.listeners.get(identityId) ?? []) listener(structuredClone(event));
    } else this.online.delete(identityId);
  }
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  await Promise.resolve();
}

describe('AgentWorkboardService', () => {
  it('persists claims, stale recovery, dependency DAGs and duplicate execution protection', async () => {
    let now = Date.parse('2026-01-01T00:00:00.000Z');
    const storage = new InMemoryWorkboardStateStore();
    const service = new AgentWorkboardService({
      identityId: 'alice',
      storage,
      now: () => now,
      policy: { claimLeaseMs: 1_000, staleAfterMs: 1_000, maxConcurrentClaims: 2 },
    });
    const board = await service.createWorkboard({ id: 'board-lifecycle', title: 'Release board', allowedDataScopes: [publicScope] });
    const first = await service.createWorkItem(board.id, { id: 'prepare', title: 'Prepare', objective: 'prepare artifact', dataScopes: [publicScope] });
    const second = await service.createWorkItem(board.id, { id: 'publish', title: 'Publish', objective: 'publish artifact', dataScopes: [publicScope] });
    await service.addDependency(board.id, second.id, first.id);

    await expect(service.claimWorkItem(board.id, second.id, { executionKey: 'publish-before-prepare' })).rejects.toMatchObject({ code: 'DEPENDENCY_BLOCKED' });
    expect((await service.getWorkItem(board.id, second.id))?.status).toBe('BLOCKED');

    const claim = await service.claimWorkItem(board.id, first.id, { executionKey: 'prepare-1' });
    now += 2_001;
    const recovered = await service.recoverStaleClaims(board.id);
    expect(recovered[0]?.state).toBe('stale');
    expect((await service.getWorkItem(board.id, first.id))?.status).toBe('READY');

    const secondClaim = await service.claimWorkItem(board.id, first.id, { executionKey: 'prepare-2' });
    await service.heartbeatClaim(secondClaim.id);
    await service.releaseClaim(secondClaim.id, undefined, 'completed');
    expect((await service.getWorkItem(board.id, first.id))?.status).toBe('DONE');
    expect((await service.getWorkItem(board.id, second.id))?.status).toBe('READY');
    await expect(service.claimWorkItem(board.id, first.id, { executionKey: 'prepare-2' })).rejects.toMatchObject({ code: 'DUPLICATE_EXECUTION' });
    expect(claim.executionKey).toBe('prepare-1');

    const restarted = new AgentWorkboardService({ identityId: 'alice', storage, now: () => now });
    await restarted.ready();
    expect((await restarted.getBoard(board.id))?.title).toBe('Release board');
    expect((await restarted.getWorkItem(board.id, second.id))?.status).toBe('READY');
  });

  it('keeps NEEDS_USER as a durable stop and resumes only after owner response', async () => {
    const storage = new InMemoryWorkboardStateStore();
    const service = new AgentWorkboardService({
      identityId: 'alice',
      storage,
      execution: { execute: async () => ({ status: 'NEEDS_USER', needsUser: { reason: 'owner_decision', prompt: 'Choose a release channel' } }) },
    });
    const board = await service.createWorkboard({ id: 'board-approval', title: 'Approval board', allowedDataScopes: [publicScope] });
    const item = await service.createWorkItem(board.id, { id: 'approval', title: 'Release', objective: 'release safely', dataScopes: [publicScope] });
    const stopped = await service.runWorkItem(board.id, item.id, { executionKey: 'approval-1' });
    expect(stopped.status).toBe('NEEDS_USER');
    expect((await service.listNeedsUser(board.id))).toHaveLength(1);
    const resumed = await service.respondToUser(board.id, item.id, 'stable');
    expect(resumed.status).toBe('READY');
    expect(resumed.needsUser?.response).toBe('stable');
  });

  it('routes TaskGraph/ToolFlow work through typed adapters and protects private artifacts', async () => {
    const calls: string[] = [];
    const service = new AgentWorkboardService({
      identityId: 'alice',
      execution: {
        runTaskGraph: async input => { calls.push(`graph:${input.taskGraphId}`); return { lifecycle: 'COMPLETED' } as never; },
        runToolFlow: async input => { calls.push(`flow:${input.toolFlow.id}`); return { status: 'DONE', comment: 'flow complete' }; },
      },
    });
    const board = await service.createWorkboard({ id: 'board-adapters', title: 'Adapters', allowedDataScopes: [{ dataClasses: ['PUBLIC', 'PRIVATE'] }] });
    const graphItem = await service.createWorkItem(board.id, { id: 'graph-item', title: 'Graph', objective: 'run graph', taskGraphId: 'graph-1', dataScopes: [publicScope] });
    expect((await service.runWorkItem(board.id, graphItem.id)).status).toBe('DONE');
    const flowItem = await service.createWorkItem(board.id, { id: 'flow-item', title: 'Flow', objective: 'run flow', toolFlow: { id: 'flow-1' } as never, dataScopes: [publicScope] });
    expect((await service.runWorkItem(board.id, flowItem.id)).status).toBe('DONE');
    expect(calls).toEqual(['graph:graph-1', 'flow:flow-1']);
    const artifact = await service.attachArtifact(board.id, flowItem.id, { kind: 'structured', value: { ok: true }, dataClass: 'PUBLIC' });
    expect(artifact.integrity).toMatch(/^workboard-/);
    await expect(service.attachArtifact(board.id, flowItem.id, { value: 'secret', dataClass: 'PRIVATE' })).rejects.toMatchObject({ code: 'ARTIFACT_SCOPE_DENIED' });
  });

  it('rejects context that is broader than the WorkItem scope before an executor can see it', async () => {
    let received = 0;
    const service = new AgentWorkboardService({ identityId: 'alice', execution: { execute: async input => { received = input.context.length; return { status: 'DONE' }; } } });
    const board = await service.createWorkboard({ id: 'board-context', title: 'Context boundary', allowedDataScopes: [publicScope] });
    const item = await service.createWorkItem(board.id, { id: 'context-item', title: 'Context', objective: 'bounded context', dataScopes: [publicScope] });
    await expect(service.runWorkItem(board.id, item.id, { context: [{ id: 'private', source: 'memory', dataClass: 'PRIVATE', value: 'secret' }] })).rejects.toMatchObject({ code: 'NOT_AUTHORIZED' });
    expect(received).toBe(0);
  });

  it('replicates a durable board between independent identities, queues offline delivery and rejects spoofed events', async () => {
    const bus = new ReplicationBus();
    const alice = new AgentWorkboardService({ identityId: 'alice', replication: bus.adapter('alice') });
    const bob = new AgentWorkboardService({ identityId: 'bob', replication: bus.adapter('bob') });
    const mallory = new AgentWorkboardService({ identityId: 'mallory', replication: bus.adapter('mallory') });
    bus.setOnline('bob', false);
    const board = await alice.createWorkboard({ id: 'board-p2p', title: 'P2P board', members: [{ identityId: 'bob', role: 'editor', joinedAt: new Date().toISOString() }], allowedDataScopes: [publicScope] });
    const item = await alice.createWorkItem(board.id, { id: 'offline-item', title: 'Offline item', objective: 'deliver after reconnect', dataScopes: [publicScope] });
    expect(await bob.getBoard(board.id)).toBeUndefined();
    bus.setOnline('bob', true);
    await settle();
    expect((await bob.getBoard(board.id))?.id).toBe(board.id);
    expect((await bob.getWorkItem(board.id, item.id))?.id).toBe(item.id);
    const bobClaim = await bob.claimWorkItem(board.id, item.id, { actor: { kind: 'human', id: 'bob' }, executionKey: 'bob-1' });
    await settle();
    expect((await alice.listClaims(board.id)).some(claim => claim.id === bobClaim.id)).toBe(true);
    const forged = { version: 1, id: 'forged-event', boardId: board.id, actor: { kind: 'human', id: 'mallory' }, operation: 'item.upsert', targetId: item.id, revision: 99, payload: { ...item, revision: 99 }, createdAt: new Date().toISOString(), signature: 'not-a-valid-signature' } as WorkboardEvent;
    await expect(mallory.applyEvent(forged)).rejects.toMatchObject({ code: 'INVALID_SIGNATURE' });
  });

  it('forbids dependency cycles, remote execution without grants, and private external workboards', async () => {
    const service = new AgentWorkboardService({ identityId: 'alice' });
    const board = await service.createWorkboard({ id: 'board-policy', title: 'Policy board', allowedDataScopes: [publicScope] });
    const a = await service.createWorkItem(board.id, { id: 'a', title: 'A', objective: 'A', dataScopes: [publicScope] });
    const b = await service.createWorkItem(board.id, { id: 'b', title: 'B', objective: 'B', dataScopes: [publicScope] });
    await service.addDependency(board.id, a.id, b.id);
    await expect(service.addDependency(board.id, b.id, a.id)).rejects.toMatchObject({ code: 'DEPENDENCY_CYCLE' });
    await expect(service.createWorkItem(board.id, { title: 'Remote', objective: 'remote', assignee: { kind: 'agent', id: 'orbit', ownerIdentityId: 'bob' }, dataScopes: [publicScope] })).rejects.toMatchObject({ code: 'AGENT_NOT_GRANTED' });
    await expect(service.createWorkboard({ id: 'external-private', title: 'No leak', execution: 'external', allowedDataScopes: [{ dataClasses: ['PRIVATE'] }] })).rejects.toMatchObject({ code: 'NOT_AUTHORIZED' });
  });
});
