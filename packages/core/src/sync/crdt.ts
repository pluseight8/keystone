import * as Y from 'yjs';
import type { NodeId } from '../types.js';
import type { Envelope, EnvelopeSecurity, UnsignedEnvelope } from '../connectivity.js';
import type { KeystoneDeliveryInterface } from '../connectivity.js';

export interface CrdtSyncOptions { documentId?: string; localNodeId: NodeId; selfPeers?: readonly NodeId[]; expiresInMs?: number; security?: EnvelopeSecurity; }
export interface PersonalEcosystemDocument {
  /** User-authored Life Map entities, notes and context are intentionally opaque to the transport. */
  lifeMap: Y.Map<unknown>;
  notes: Y.Map<unknown>;
  contextCapsules: Y.Map<unknown>;
  aiChat: Y.Array<unknown>;
}

export function createPersonalEcosystemDocument(document = new Y.Doc()): PersonalEcosystemDocument {
  const lifeMap = document.getMap('lifeMap');
  // Nested maps make each node/edge an independent CRDT value. A drag on one
  // device therefore cannot overwrite a concurrent edit to another entity.
  // Convert the early array representation in-place so existing documents keep
  // their content while gaining per-entity CRDT updates.
  for (const key of ['nodes', 'edges'] as const) {
    const existing = lifeMap.get(key);
    if (existing instanceof Y.Map) continue;
    const collection = new Y.Map<unknown>();
    if (Array.isArray(existing)) {
      existing.forEach(item => {
        if (item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string') {
          collection.set((item as { id: string }).id, item);
        }
      });
    }
    lifeMap.set(key, collection);
  }
  return {
    lifeMap,
    notes: document.getMap('notes'),
    contextCapsules: document.getMap('contextCapsules'),
    aiChat: document.getArray('aiChat'),
  };
}
export interface CrdtUpdateBody { documentId: string; update: string; }
export interface CrdtSyncRequestBody { documentId: string; stateVector?: string; }
export type CrdtMessageBody = CrdtUpdateBody | CrdtSyncRequestBody;

/** Replicates a Y.Doc over Transport envelopes. No server or persistence layer is involved. */
export class CrdtSyncAdapter {
  readonly document: Y.Doc;
  private readonly seenNonces = new Set<string>();
  private readonly peers = new Set<NodeId>(); private readonly unsubscribe: () => void; private readonly documentId: string; private started = false;
  constructor(document: Y.Doc, private readonly transport: KeystoneDeliveryInterface, private readonly options: CrdtSyncOptions) {
    this.document = document; this.documentId = options.documentId ?? 'life-map'; (options.selfPeers ?? []).forEach(peer => this.peers.add(peer));
    this.document.on('update', this.onLocalUpdate); this.unsubscribe = transport.onMessage(envelope => { void this.onEnvelope(envelope).catch(() => undefined); });
  }
  addSelfPeer(peer: NodeId): void { this.peers.add(peer); }
  removeSelfPeer(peer: NodeId): void { this.peers.delete(peer); }
  async start(peers: readonly NodeId[] = [...this.peers]): Promise<void> { this.started = true; for (const peer of peers) { this.peers.add(peer); await this.transport.connect(peer); await this.requestSync(peer); } }
  async requestSync(peer: NodeId, stateVector = Y.encodeStateVector(this.document)): Promise<void> { this.assertPeer(peer); await this.send(peer, 'crdt.sync.request', { documentId: this.documentId, stateVector: toBase64(stateVector) }); }
  async stop(): Promise<void> { this.started = false; this.unsubscribe(); this.document.off('update', this.onLocalUpdate); }
  private readonly onLocalUpdate = (update: Uint8Array, origin: unknown): void => { if (!this.started || origin === this) return; for (const peer of this.peers) void this.send(peer, 'crdt.update', { documentId: this.documentId, update: toBase64(update) }); };
  private async onEnvelope(envelope: Envelope): Promise<void> {
    if (envelope.recipient !== this.options.localNodeId || !this.peers.has(envelope.sender)) return;
    if (!isLiveEnvelope(envelope) || this.seenNonces.has(envelope.nonce)) return;
    if (this.options.security && !(await this.options.security.verify(envelope))) return;
    this.seenNonces.add(envelope.nonce);
    if (envelope.type === 'crdt.update') { const body = validateUpdate(envelope.body, this.documentId); Y.applyUpdate(this.document, fromBase64(body.update), this); return; }
    if (envelope.type === 'crdt.sync.request') { const body = validateRequest(envelope.body, this.documentId); const update = body.stateVector ? Y.encodeStateAsUpdate(this.document, fromBase64(body.stateVector)) : Y.encodeStateAsUpdate(this.document); await this.send(envelope.sender, 'crdt.update', { documentId: this.documentId, update: toBase64(update) }); }
  }
  private async send(peer: NodeId, type: string, body: CrdtMessageBody): Promise<void> {
    this.assertPeer(peer);
    const unsigned: UnsignedEnvelope = { version: 1, type, id: crypto.randomUUID(), sender: this.options.localNodeId, recipient: peer, nonce: crypto.randomUUID(), expiresAt: new Date(Date.now() + (this.options.expiresInMs ?? 60_000)).toISOString(), body };
    const envelope: Envelope = { ...unsigned, signature: this.options.security ? await this.options.security.sign(unsigned) : '' };
    await this.transport.send(peer, envelope);
  }
  private assertPeer(peer: NodeId): void { if (!this.peers.has(peer)) throw new Error(`Peer is not a trusted Self device: ${peer}`); }
}
function validateUpdate(value: unknown, documentId: string): CrdtUpdateBody { if (!value || typeof value !== 'object') throw new Error('Invalid CRDT update'); const v = value as Record<string, unknown>; if (v.documentId !== documentId || typeof v.update !== 'string') throw new Error('Invalid CRDT update'); fromBase64(v.update); return { documentId, update: v.update }; }
function validateRequest(value: unknown, documentId: string): CrdtSyncRequestBody { if (!value || typeof value !== 'object') throw new Error('Invalid CRDT sync request'); const v = value as Record<string, unknown>; if (v.documentId !== documentId || (v.stateVector !== undefined && typeof v.stateVector !== 'string')) throw new Error('Invalid CRDT sync request'); if (v.stateVector) fromBase64(v.stateVector); return { documentId, stateVector: v.stateVector as string | undefined }; }
function toBase64(value: Uint8Array): string { let binary = ''; value.forEach(byte => { binary += String.fromCharCode(byte); }); return btoa(binary); }
function fromBase64(value: string): Uint8Array { try { const binary = atob(value); return Uint8Array.from(binary, char => char.charCodeAt(0)); } catch { throw new Error('Invalid base64 update'); } }

function isLiveEnvelope(envelope: Envelope): boolean { return Date.parse(envelope.expiresAt) > Date.now(); }
