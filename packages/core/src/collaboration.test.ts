import { describe, expect, it } from 'vitest';
import type { Envelope, EnvelopeSecurity, KeystoneDeliveryInterface } from './connectivity.js';
import type { NodeId } from './types.js';
import { CollaborationService, InMemoryCollaborationStateStore, SodiumCollaborationCipher, renderSafeCommentText, type CollaborationCipher, type TextDocumentSnapshot } from './collaboration.js';
import type { CanvasDocument } from './vault-canvas.js';
import type { DeviceSessionKeys } from './identity.js';
import type { Workboard, WorkItem } from './ai/workboards.js';

interface QueuedEnvelope { readonly from: NodeId; readonly to: NodeId; readonly envelope: Envelope; }

class ControlledCollaborationNetwork {
  readonly queued: QueuedEnvelope[] = [];
  readonly sent: QueuedEnvelope[] = [];
  private readonly endpoints = new Map<NodeId, TestDelivery>();
  private readonly online = new Set<NodeId>();
  private paused = false;

  register(transport: TestDelivery): void { this.endpoints.set(transport.nodeId, transport); this.online.add(transport.nodeId); }
  setOnline(nodeId: NodeId, online: boolean): void { if (online) this.online.add(nodeId); else this.online.delete(nodeId); }
  pauseDelivery(value: boolean): void { this.paused = value; }
  connect(from: NodeId, to: NodeId): void { if (!this.online.has(from) || !this.online.has(to)) throw new Error('peer offline'); }
  transmit(from: NodeId, to: NodeId, envelope: Envelope): void { this.connect(from, to); const value = { from, to, envelope: structuredClone(envelope) }; this.sent.push(value); if (this.paused) this.queued.push(value); else this.deliver(value); }
  async drain(order?: readonly number[]): Promise<void> { const values = this.queued.splice(0); const selected = order ? order.map(index => values[index]).filter((value): value is QueuedEnvelope => !!value) : values; selected.forEach(value => this.deliver(value)); await settle(); }
  inject(to: NodeId, envelope: Envelope): void { this.endpoints.get(to)?.deliver(structuredClone(envelope)); }
  private deliver(value: QueuedEnvelope): void { this.endpoints.get(value.to)?.deliver(structuredClone(value.envelope)); }
}

class TestDelivery implements KeystoneDeliveryInterface {
  private readonly handlers = new Set<(envelope: Envelope) => void | Promise<void>>();
  constructor(readonly nodeId: NodeId, private readonly network: ControlledCollaborationNetwork) { network.register(this); }
  async connect(peer: NodeId): Promise<void> { this.network.connect(this.nodeId, peer); }
  async send(envelope: Envelope): Promise<void>;
  async send(peer: NodeId, envelope: Envelope): Promise<void>;
  async send(peerOrEnvelope: NodeId | Envelope, maybeEnvelope?: Envelope): Promise<void> { const envelope = maybeEnvelope ?? peerOrEnvelope as Envelope; return this.sendTo(maybeEnvelope ? peerOrEnvelope as NodeId : envelope.recipient, envelope); }
  onMessage(handler: (envelope: Envelope) => void | Promise<void>): () => void { this.handlers.add(handler); return () => this.handlers.delete(handler); }
  isPeerConnected(peer: NodeId): boolean { try { this.network.connect(this.nodeId, peer); return true; } catch { return false; } }
  isDeterministic(): boolean { return true; }
  async close(): Promise<void> { this.handlers.clear(); }
  deliver(envelope: Envelope): void { this.handlers.forEach(handler => { void handler(envelope); }); }
  private async sendTo(peer: NodeId, envelope: Envelope): Promise<void> { if (envelope.sender !== this.nodeId || envelope.recipient !== peer) throw new Error('envelope identity mismatch'); this.network.transmit(this.nodeId, peer, envelope); }
}

class TestEnvelopeSecurity implements EnvelopeSecurity {
  constructor(private readonly local: NodeId, private readonly secrets: ReadonlyMap<NodeId, string>) {}
  async sign(envelope: Omit<Envelope, 'signature'>): Promise<string> { return `${this.secrets.get(this.local)}:${JSON.stringify(envelope)}`; }
  async verify(envelope: Envelope): Promise<boolean> { const { signature, ...unsigned } = envelope; return signature === `${this.secrets.get(envelope.sender)}:${JSON.stringify(unsigned)}`; }
}

class TestCipher implements CollaborationCipher {
  async seal(input: { readonly recipient: NodeId; readonly value: unknown }): Promise<unknown> { return { recipient: input.recipient, value: btoa(JSON.stringify(input.value)) }; }
  async open(input: { readonly recipient: NodeId; readonly value: unknown }): Promise<unknown> { const value = input.value as { recipient?: unknown; value?: unknown }; if (value.recipient !== input.recipient || typeof value.value !== 'string') throw new Error('cipher mismatch'); return JSON.parse(atob(value.value)) as unknown; }
}

function service(network: ControlledCollaborationNetwork, identityId: NodeId, secrets: ReadonlyMap<NodeId, string>, options: { readonly store?: InMemoryCollaborationStateStore; readonly cipher?: CollaborationCipher; readonly now?: () => number } = {}): CollaborationService {
  const delivery = new TestDelivery(identityId, network);
  return new CollaborationService({ identityId, delivery, security: new TestEnvelopeSecurity(identityId, secrets), store: options.store, cipher: options.cipher, now: options.now, policy: { autoFlushMs: 60, presenceMinIntervalMs: 50 } });
}

async function settle(): Promise<void> { for (let index = 0; index < 8; index += 1) await new Promise(resolve => setTimeout(resolve, 0)); }
function textInitial(title = 'Shared note'): TextDocumentSnapshot { return { version: 1, title, content: '', metadata: { source: 'test' } }; }
function canvasInitial(): CanvasDocument { const now = new Date().toISOString(); return { version: 1, id: 'canvas-1', vaultId: 'vault-1', revision: 1, createdAt: now, updatedAt: now, nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, selection: { nodeIds: [], edgeIds: [] }, metadata: { title: 'Shared Canvas' } }; }
function workboardInitial(): { version: 1; board: Workboard; items: readonly WorkItem[] } { const now = new Date().toISOString(); const actor = { kind: 'human', id: 'alice' } as const; return { version: 1, board: { version: 1, id: 'board-1', kind: 'SHARED_SPACE', title: 'Shared Board', description: '', creator: actor, ownerIdentityId: 'alice', spaceId: 'space-1', members: [], policy: {} as Workboard['policy'], allowedCapabilities: [], allowedDataScopes: [], execution: 'local', revision: 1, createdAt: now, updatedAt: now, signature: 'fixture' }, items: [] }; }

describe('R0P81 CollaborationService', () => {
  it('shares a Y.Text note, converges offline edits, carries comments, and expires presence separately', async () => {
    const network = new ControlledCollaborationNetwork(); const secrets = new Map([['alice', 'a'], ['bob', 'b']]); let clock = Date.now();
    const alice = service(network, 'alice', secrets, { now: () => clock }); const bob = service(network, 'bob', secrets, { now: () => clock });
    await Promise.all([alice.ready(), bob.ready()]); await alice.createObject({ id: 'note-1', kind: 'note', initial: textInitial() }); const invitation = await alice.createInvitation('note-1', { invitee: 'bob', role: 'editor' }); await settle();
    expect(bob.listObjects().map(value => value.id)).toContain('note-1'); await bob.acceptInvitation(invitation.id); await settle(); expect(bob.getInfo('note-1').participants.find(value => value.identityId === 'bob')?.status).toBe('active');
    await alice.edit('note-1', { type: 'insert', index: 0, text: 'Alice' }); await settle(); expect((await bob.snapshot<TextDocumentSnapshot>('note-1')).content).toBe('Alice');
    const deliveredUpdate = [...network.sent].reverse().find(value => value.from === 'alice' && value.to === 'bob' && value.envelope.type === 'keystone.collaboration.update'); expect(deliveredUpdate).toBeTruthy(); network.inject('bob', deliveredUpdate!.envelope); network.inject('bob', deliveredUpdate!.envelope); await settle(); expect(bob.stats().replayed).toBeGreaterThan(0); expect((await bob.snapshot<TextDocumentSnapshot>('note-1')).content).toBe('Alice');
    network.pauseDelivery(true); await alice.edit('note-1', { type: 'insert', index: 5, text: ' / A' }); await bob.edit('note-1', { type: 'insert', index: 0, text: 'Bob / ' }); expect(network.queued.length).toBeGreaterThanOrEqual(2); network.pauseDelivery(false); await network.drain(); await settle();
    const left = await alice.snapshot<TextDocumentSnapshot>('note-1'); const right = await bob.snapshot<TextDocumentSnapshot>('note-1'); expect(left.content).toBe(right.content); expect(left.content).toContain('Alice'); expect(left.content).toContain('Bob');
    await bob.addComment('note-1', '<untrusted> comment'); await settle(); expect(alice.comments('note-1')[0]?.body).toBe('<untrusted> comment'); expect(renderSafeCommentText('<untrusted>')).toBe('&lt;untrusted&gt;');
    expect((await bob.publishPresence('note-1', { status: 'editing', cursor: { anchor: 1, head: 3 } })).sent).toBe(true); await settle(); expect(alice.presence('note-1')[0]?.peerId).toBe('bob'); clock += 20_000; alice.prunePresence('note-1'); expect(alice.presence('note-1')).toHaveLength(0);
    await alice.close(); await bob.close();
  });

  it('enforces owner/editor/commenter/viewer roles, invitation expiry, and revocation epochs', async () => {
    const network = new ControlledCollaborationNetwork(); const secrets = new Map([['alice', 'a'], ['bob', 'b'], ['charlie', 'c'], ['dana', 'd']]); const alice = service(network, 'alice', secrets); const bob = service(network, 'bob', secrets); const charlie = service(network, 'charlie', secrets); const dana = service(network, 'dana', secrets); await Promise.all([alice.ready(), bob.ready(), charlie.ready(), dana.ready()]);
    await alice.createObject({ id: 'roles-1', kind: 'document', initial: textInitial('Roles') }); const editorInvite = await alice.createInvitation('roles-1', { invitee: 'bob', role: 'editor' }); const viewerInvite = await alice.createInvitation('roles-1', { invitee: 'charlie', role: 'viewer' }); const commenterInvite = await alice.createInvitation('roles-1', { invitee: 'dana', role: 'commenter' }); await settle(); await bob.acceptInvitation(editorInvite.id); await charlie.acceptInvitation(viewerInvite.id); await dana.acceptInvitation(commenterInvite.id); await settle();
    await expect(charlie.edit('roles-1', { type: 'insert', index: 0, text: 'nope' })).rejects.toMatchObject({ code: 'NOT_AUTHORIZED' }); await expect(dana.edit('roles-1', { type: 'insert', index: 0, text: 'nope' })).rejects.toMatchObject({ code: 'NOT_AUTHORIZED' }); await expect(charlie.addComment('roles-1', 'viewer cannot comment')).rejects.toMatchObject({ code: 'NOT_AUTHORIZED' }); await dana.addComment('roles-1', 'commenter can annotate'); await settle();
    const oldEpoch = alice.getInfo('roles-1').epoch; await alice.revoke('roles-1', 'bob'); await settle(); expect(bob.getInfo('roles-1').participants.find(value => value.identityId === 'bob')?.status).toBe('revoked'); expect(alice.getInfo('roles-1').epoch).toBe(oldEpoch + 1); await expect(bob.edit('roles-1', { type: 'insert', index: 0, text: 'revoked' })).rejects.toMatchObject({ code: 'NOT_AUTHORIZED' });
    await alice.close(); await bob.close(); await charlie.close(); await dana.close();
  });

  it('rejects forged, cross-object, oversized and replayed updates, and detects persisted tampering', async () => {
    const network = new ControlledCollaborationNetwork(); const secrets = new Map([['alice', 'a'], ['mallory', 'm']]); const alice = service(network, 'alice', secrets); const mallory = service(network, 'mallory', secrets); await Promise.all([alice.ready(), mallory.ready()]); await alice.createObject({ id: 'secure-1', kind: 'document', initial: textInitial() });
    const forged = { version: 1 as const, type: 'keystone.collaboration.update', id: 'forged', sender: 'mallory', recipient: 'alice', nonce: 'forged-nonce', expiresAt: new Date(Date.now() + 10_000).toISOString(), body: { version: 1 as const, protocol: 'keystone.collaboration.r0p81', kind: 'update', objectId: 'secure-1', epoch: 1, actor: 'mallory', operationId: 'forged-op', target: 'content', update: btoa('not-yjs') } }; network.inject('alice', { ...forged, signature: await new TestEnvelopeSecurity('mallory', secrets).sign(forged) }); await settle(); expect(alice.stats().rejected).toBeGreaterThan(0);
    const cross = { ...forged, id: 'cross', nonce: 'cross-nonce', body: { ...forged.body, objectId: 'other-object', operationId: 'cross-op' }, signature: '' }; network.inject('alice', { ...cross, signature: await new TestEnvelopeSecurity('mallory', secrets).sign(cross) }); await settle(); expect(alice.getInfo('secure-1').pendingUpdates).toBe(0);
    const huge = { ...forged, id: 'huge', nonce: 'huge-nonce', body: { ...forged.body, operationId: 'huge-op', update: btoa('x'.repeat(600_000)) }, signature: '' }; network.inject('alice', { ...huge, signature: await new TestEnvelopeSecurity('mallory', secrets).sign(huge) }); await settle(); expect(alice.stats().rejected).toBeGreaterThan(1);
    const store = new InMemoryCollaborationStateStore(); store.corrupt({ version: 99, objects: [] }); const tampered = service(network, 'alice', secrets, { store }); await expect(tampered.ready()).rejects.toMatchObject({ code: 'CORRUPT_STATE' }); await alice.close(); await mallory.close();
  });

  it('restarts persisted Yjs state and exposes real Canvas/Workboard adapters', async () => {
    const network = new ControlledCollaborationNetwork(); const secrets = new Map([['alice', 'a']]); const store = new InMemoryCollaborationStateStore(); const first = service(network, 'alice', secrets, { store }); await first.ready(); await first.createObject({ id: 'canvas-1', kind: 'canvas', initial: canvasInitial() }); await first.edit('canvas-1', { type: 'create_node', node: { id: 'node-1', kind: 'TEXT_CARD', x: 10, y: 20, width: 120, height: 80, title: 'Shared card', text: 'Card body' } }); const initialBoard = workboardInitial(); await first.createObject({ id: 'board-1', kind: 'workboard', initial: initialBoard }); await first.close();
    const restarted = service(network, 'alice', secrets, { store }); await restarted.ready(); expect((await restarted.snapshot<CanvasDocument>('canvas-1')).nodes).toHaveLength(1); expect((await restarted.snapshot('board-1') as { items: readonly WorkItem[] }).items).toHaveLength(0); await restarted.close();
  });

  it('keeps private collaboration behind an application cipher boundary', async () => {
    const network = new ControlledCollaborationNetwork(); const secrets = new Map([['alice', 'a'], ['bob', 'b']]); const alice = service(network, 'alice', secrets, { cipher: new TestCipher() }); const bob = service(network, 'bob', secrets, { cipher: new TestCipher() }); await Promise.all([alice.ready(), bob.ready()]); await expect(alice.createObject({ id: 'private-1', kind: 'note', private: true, initial: textInitial('Private') })).resolves.toBeTruthy(); const invitation = await alice.createInvitation('private-1', { invitee: 'bob', role: 'editor' }); await settle(); await bob.acceptInvitation(invitation.id); await settle(); await alice.edit('private-1', { type: 'replace', text: 'E2E protected content' }); await settle(); expect((await bob.snapshot<TextDocumentSnapshot>('private-1')).content).toBe('E2E protected content'); await alice.close(); await bob.close();
  });

  it('provides the reusable Sodium collaboration cipher', async () => {
    const { IdentityManager } = await import('./identity.js'); const alice = await (await IdentityManager.generate()).sessionKeys('alice'); const bob = await (await IdentityManager.generate()).sessionKeys('bob'); const cipherAlice = new SodiumCollaborationCipher(alice, [alice, bob]); const cipherBob = new SodiumCollaborationCipher(bob, [alice, bob]); const sealed = await cipherAlice.seal({ objectId: 'private', sender: alice.nodeId, recipient: bob.nodeId, epoch: 1, value: { text: 'secret' } }); await expect(cipherBob.open({ objectId: 'private', sender: alice.nodeId, recipient: bob.nodeId, epoch: 1, value: sealed })).resolves.toEqual({ text: 'secret' });
  });
});
