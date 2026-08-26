import { describe, expect, it } from 'vitest';
import type { Envelope, EnvelopeSecurity, KeystoneDeliveryInterface } from '../connectivity.js';
import {
  CanvasSharedObjectAdapter,
  CollaborationService,
  InMemoryCollaborationStateStore,
  WorkboardSharedObjectAdapter,
  type CollaborationStateStore,
  type TextDocumentSnapshot,
} from '../collaboration.js';
import type { CanvasDocument } from '../vault-canvas.js';
import type { Workboard, WorkItem } from '../ai/workboards.js';

type NodeId = string;

class ScaleNetwork {
  private readonly endpoints = new Map<NodeId, ScaleDelivery>();
  private readonly online = new Set<NodeId>();
  register(endpoint: ScaleDelivery): void { this.endpoints.set(endpoint.nodeId, endpoint); this.online.add(endpoint.nodeId); }
  setOnline(nodeId: NodeId, online: boolean): void { if (online) this.online.add(nodeId); else this.online.delete(nodeId); }
  connect(from: NodeId, to: NodeId): void { if (!this.online.has(from) || !this.online.has(to)) throw new Error('peer offline'); }
  isOnline(from: NodeId, to: NodeId): boolean { return this.online.has(from) && this.online.has(to); }
  transmit(from: NodeId, to: NodeId, envelope: Envelope): void {
    this.connect(from, to);
    const target = this.endpoints.get(to); if (!target) throw new Error('peer unavailable');
    queueMicrotask(() => target.deliver(structuredClone(envelope)));
  }
}

class ScaleDelivery implements KeystoneDeliveryInterface {
  private readonly handlers = new Set<(envelope: Envelope) => void | Promise<void>>();
  constructor(readonly nodeId: NodeId, private readonly network: ScaleNetwork) { network.register(this); }
  async connect(peer: NodeId): Promise<void> { this.network.connect(this.nodeId, peer); }
  async send(envelope: Envelope): Promise<void>;
  async send(peer: NodeId, envelope: Envelope): Promise<void>;
  async send(peerOrEnvelope: NodeId | Envelope, maybeEnvelope?: Envelope): Promise<void> {
    const envelope = maybeEnvelope ?? peerOrEnvelope as Envelope;
    const peer = maybeEnvelope ? peerOrEnvelope as NodeId : envelope.recipient;
    this.network.transmit(this.nodeId, peer, envelope);
  }
  onMessage(handler: (envelope: Envelope) => void | Promise<void>): () => void { this.handlers.add(handler); return () => this.handlers.delete(handler); }
  isPeerConnected(peer: NodeId): boolean { return this.network.isOnline(this.nodeId, peer); }
  isDeterministic(): boolean { return true; }
  close(): Promise<void> { this.handlers.clear(); return Promise.resolve(); }
  deliver(envelope: Envelope): void { this.handlers.forEach(handler => { void handler(envelope); }); }
}

class ScaleSecurity implements EnvelopeSecurity {
  constructor(private readonly local: NodeId, private readonly secrets: ReadonlyMap<NodeId, string>) {}
  async sign(envelope: Omit<Envelope, 'signature'>): Promise<string> { return `${this.secrets.get(this.local)}:${JSON.stringify(envelope)}`; }
  async verify(envelope: Envelope): Promise<boolean> { const { signature, ...unsigned } = envelope; return signature === `${this.secrets.get(envelope.sender)}:${JSON.stringify(unsigned)}`; }
}

class FileLikeStore implements CollaborationStateStore {
  private value?: unknown;
  async read(): Promise<unknown | undefined> { return this.value === undefined ? undefined : structuredClone(this.value); }
  async write(value: unknown): Promise<void> { this.value = structuredClone(value); }
}

function makeService(network: ScaleNetwork, id: NodeId, secrets: ReadonlyMap<NodeId, string>, store: CollaborationStateStore = new InMemoryCollaborationStateStore()): CollaborationService {
  const delivery = new ScaleDelivery(id, network);
  return new CollaborationService({ identityId: id, delivery, security: new ScaleSecurity(id, secrets), store, policy: { maxParticipants: 64, maxPendingUpdates: 8, autoFlushMs: 50, presenceMinIntervalMs: 100 } });
}

function initialNote(): TextDocumentSnapshot { return { version: 1, title: 'R0P81 scale note', content: '', metadata: { benchmark: 'r0p81' } }; }
function initialCanvas(nodeCount: number): CanvasDocument {
  const now = new Date().toISOString();
  return { version: 1, id: 'scale-canvas', vaultId: 'scale-vault', revision: 1, createdAt: now, updatedAt: now, nodes: Array.from({ length: nodeCount }, (_, index) => ({ id: `node-${index}`, kind: 'TEXT_CARD' as const, x: index % 100, y: Math.floor(index / 100), width: 120, height: 80, title: `Node ${index}`, text: 'bounded canvas text' })), edges: [], viewport: { x: 0, y: 0, zoom: 1 }, selection: { nodeIds: [], edgeIds: [] }, metadata: { title: 'R0P81 scale canvas' } };
}
function initialWorkboard(itemCount: number): { readonly version: 1; readonly board: Workboard; readonly items: readonly WorkItem[] } {
  const now = new Date().toISOString();
  const actor = { kind: 'human', id: 'scale-owner' } as const;
  const board = { version: 1 as const, id: 'scale-board', kind: 'SHARED_SPACE' as const, title: 'R0P81 scale board', description: '', creator: actor, ownerIdentityId: 'scale-owner', spaceId: 'scale-space', members: [], policy: {} as Workboard['policy'], allowedCapabilities: [], allowedDataScopes: [], execution: 'local' as const, revision: 1, createdAt: now, updatedAt: now, signature: 'scale-fixture' };
  const items = Array.from({ length: itemCount }, (_, index) => ({ version: 1 as const, id: `item-${index}`, boardId: board.id, status: 'TODO' as const } as unknown as WorkItem));
  return { version: 1, board, items };
}

describe('R0P81 collaboration scale and resource bounds', () => {
  it('processes 10k durable edits and retains bounded local state', async () => {
    const network = new ScaleNetwork(); const secrets = new Map<NodeId, string>([['scale-owner', 'owner']]); const service = makeService(network, 'scale-owner', secrets, new FileLikeStore()); await service.ready();
    await service.createObject({ id: 'scale-note', kind: 'note', initial: initialNote() });
    const started = performance.now();
    for (let index = 0; index < 10_000; index += 1) await service.edit('scale-note', { type: 'insert', index, text: String(index % 10) });
    const durationMs = Math.round(performance.now() - started); const snapshot = await service.snapshot<TextDocumentSnapshot>('scale-note');
    expect(snapshot.content).toHaveLength(10_000); expect(service.stats().pendingUpdates).toBe(0); expect(service.stats().listeners).toBe(0); expect(durationMs).toBeLessThan(120_000);
    console.log(`[R0P81-PERF] ${JSON.stringify({ durableEdits: 10_000, durationMs, contentBytes: new TextEncoder().encode(snapshot.content).byteLength, pendingUpdates: service.stats().pendingUpdates })}`);
    await service.close();
  }, 180_000);

  it('supports 50+ active collaborators, coalesces presence, and bounds the outbox', async () => {
    const names = ['scale-owner', ...Array.from({ length: 51 }, (_, index) => `scale-peer-${index}`)]; const secrets = new Map(names.map(name => [name, name] as const)); const network = new ScaleNetwork();
    const services = new Map(names.map(name => [name, makeService(network, name, secrets)] as const)); await Promise.all([...services.values()].map(service => service.ready()));
    const owner = services.get('scale-owner')!; await owner.createObject({ id: 'scale-shared-note', kind: 'note', initial: initialNote() });
    for (const name of names.slice(1)) { const invitation = await owner.createInvitation('scale-shared-note', { invitee: name, role: 'editor' }); await settle(); await services.get(name)!.acceptInvitation(invitation.id); await settle(); }
    expect(owner.getInfo('scale-shared-note').participants.filter(value => value.status === 'active')).toHaveLength(52);
    const listeners = Array.from({ length: 128 }, () => owner.subscribe(() => undefined)); listeners.forEach(unsubscribe => unsubscribe()); expect(owner.stats().listeners).toBe(0);
    expect((await owner.publishPresence('scale-shared-note', { status: 'editing', cursor: { anchor: 1, head: 2 } })).sent).toBe(true);
    let coalesced = 0; for (let index = 0; index < 100; index += 1) if ((await owner.publishPresence('scale-shared-note', { status: 'editing', cursor: { anchor: index, head: index + 1 } })).coalesced) coalesced++;
    expect(coalesced).toBeGreaterThanOrEqual(99);
    for (const name of names.slice(1)) network.setOnline(name, false);
    for (let index = 0; index < 8; index += 1) await owner.edit('scale-shared-note', { type: 'replace', text: `queued-${index}` });
    expect(owner.getInfo('scale-shared-note').pendingUpdates).toBe(8);
    await expect(owner.edit('scale-shared-note', { type: 'replace', text: 'over-bound' })).rejects.toMatchObject({ code: 'OBJECT_LIMIT' });
    for (const name of names.slice(1)) network.setOnline(name, true);
    await eventually(async () => owner.getInfo('scale-shared-note').pendingUpdates === 0);
    await Promise.all([...services.values()].map(service => service.close()));
  }, 180_000);

  it('hydrates large Canvas and Workboard adapter projections within object bounds', async () => {
    const network = new ScaleNetwork(); const secrets = new Map<NodeId, string>([['scale-large', 'large']]); const service = makeService(network, 'scale-large', secrets); await service.ready();
    const canvasNodes = 2_500; const workItems = 2_500;
    await service.createObject({ id: 'large-canvas', kind: 'canvas', adapter: new CanvasSharedObjectAdapter(), initial: initialCanvas(canvasNodes) });
    await service.createObject({ id: 'large-workboard', kind: 'workboard', adapter: new WorkboardSharedObjectAdapter(), initial: initialWorkboard(workItems) });
    expect((await service.snapshot<CanvasDocument>('large-canvas')).nodes).toHaveLength(canvasNodes); expect((await service.snapshot<{ readonly items: readonly WorkItem[] }>('large-workboard')).items).toHaveLength(workItems);
    expect(service.stats().objects).toBe(2); await service.close();
  }, 180_000);
});

async function settle(): Promise<void> { for (let index = 0; index < 8; index += 1) await new Promise(resolve => setTimeout(resolve, 0)); }
async function eventually(condition: () => Promise<boolean>, timeoutMs = 10_000): Promise<void> { const until = Date.now() + timeoutMs; while (Date.now() < until) { if (await condition()) return; await new Promise(resolve => setTimeout(resolve, 25)); } throw new Error(`Timed out after ${timeoutMs}ms`); }
