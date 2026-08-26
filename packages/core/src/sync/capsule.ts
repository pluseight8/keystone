import * as Y from 'yjs';
import { randomBytes } from 'node:crypto';
import type { Envelope, EnvelopeSecurity, UnsignedEnvelope } from '../connectivity.js';
import type { KeystoneDeliveryInterface } from '../connectivity.js';
import type { NodeId } from '../types.js';
import { BoundedFrameDecoder, encodeBoundedFrame, parseBoundedJson } from '../security/protocol-security.js';

export interface CapsuleInvitation { version: 1; capsuleId: string; seed: Uint8Array; ephemeralPublicKey: Uint8Array }
export interface CapsuleCursor { type: 'cursor'; capsuleId: string; participantId: string; name: string; x: number; y: number; sentAt: number }
export interface CapsuleDocument { id: string; document: Y.Doc; nodes: Y.Map<unknown>; edges: Y.Map<unknown>; resources: Y.Map<unknown> }
export interface CapsuleNetworkOptions {
  participant: { id: string; name: string };
  /** Canonical Keystone-to-Keystone delivery authority. */
  transport?: KeystoneDeliveryInterface;
  /** Application envelope authentication for the Fabric delivery path. */
  security?: EnvelopeSecurity;
  /** The participant's authenticated Keystone node id. */
  localNodeId?: NodeId;
  /** Explicit capsule peers. Routing/physical provider choice remains in Fabric. */
  peers?: readonly NodeId[];
  now?: () => number;
}

const TOKEN_PREFIX = 'kcap1_';
const MAX_FRAME_BYTES = 2 * 1024 * 1024;

/** Creates a true Yjs subdocument. Its updates are separate from the private parent document. */
export function createContextCapsule(parent: Y.Doc, capsuleId: string = crypto.randomUUID()): CapsuleDocument {
  if (!validId(capsuleId)) throw new Error('Invalid capsule id');
  const registry = parent.getMap<unknown>('contextCapsules');
  const existing = registry.get(capsuleId);
  if (existing instanceof Y.Doc) return capsuleDocument(capsuleId, existing);
  const document = new Y.Doc({ guid: `keystone-capsule:${capsuleId}`, autoLoad: true });
  document.getMap('meta').set('capsuleId', capsuleId);
  parent.transact(() => registry.set(capsuleId, document), 'create-context-capsule');
  return capsuleDocument(capsuleId, document);
}

/** Copies only explicitly selected records into the isolated subdocument. */
export function isolateLifeMapSubgraph(parent: Y.Doc, capsule: CapsuleDocument, selectedIds: readonly string[]): void {
  const selected = new Set(selectedIds); const lifeMap = parent.getMap<unknown>('lifeMap');
  const sourceNodes = lifeMap.get('nodes'); const sourceEdges = lifeMap.get('edges');
  capsule.document.transact(() => {
    capsule.nodes.clear(); capsule.edges.clear();
    forEachMap(sourceNodes, (value, id) => { if (selected.has(id)) capsule.nodes.set(id, clonePublicRecord(value)); });
    forEachMap(sourceEdges, (value, id) => { const edge = toRecord(value); if (edge && selected.has(String(edge.source)) && selected.has(String(edge.target))) capsule.edges.set(id, clonePublicRecord(edge)); });
  }, 'isolate-life-map-subgraph');
}

/** The token is a bearer capability: possession grants access to exactly one unguessable capsule topic. */
export function createCapsuleInvitation(capsuleId: string, ephemeralPublicKey: Uint8Array, seed: Uint8Array = randomBytes(32)): string {
  if (!validId(capsuleId) || seed.length !== 32 || ephemeralPublicKey.length !== 32) throw new Error('Invalid capsule invitation input');
  const payload = { v: 1, c: capsuleId, s: base64url(seed), e: base64url(ephemeralPublicKey) };
  return `${TOKEN_PREFIX}${base64url(Buffer.from(JSON.stringify(payload), 'utf8'))}`;
}

export function parseCapsuleInvitation(tokenOrLink: string): CapsuleInvitation {
  const token = tokenOrLink.startsWith('keystone://') ? decodeURIComponent(tokenOrLink.split('/join/')[1]?.split(/[?#]/)[0] ?? '') : tokenOrLink.trim();
  if (!token.startsWith(TOKEN_PREFIX) || token.length > 2_000) throw new Error('Invalid capsule invitation token');
  let raw: unknown;
  try { raw = parseBoundedJson(Buffer.from(token.slice(TOKEN_PREFIX.length), 'base64url'), { maxDepth: 4, maxCollectionItems: 8, maxStringBytes: 512, maxNodes: 32 }); } catch { throw new Error('Invalid capsule invitation token'); }
  if (!raw || typeof raw !== 'object') throw new Error('Invalid capsule invitation token');
  const value = raw as Record<string, unknown>; const seed = decode32(value.s); const ephemeralPublicKey = decode32(value.e);
  if (value.v !== 1 || typeof value.c !== 'string' || !validId(value.c)) throw new Error('Invalid capsule invitation token');
  return { version: 1, capsuleId: value.c, seed, ephemeralPublicKey };
}

export function capsuleInvitationLink(token: string): string { parseCapsuleInvitation(token); return `keystone://capsule/join/${encodeURIComponent(token)}`; }

/**
 * Replicates only one capsule Y.Doc over its own Hyperswarm topic. Cursor/tap
 * presence uses a short-lived HyperDHT stream and is never written to Yjs.
 */
export class CapsuleNetwork {
  private readonly now: () => number;
  private readonly cursorHandlers = new Set<(cursor: CapsuleCursor) => void>();
  private readonly peers: readonly NodeId[];
  private readonly transport?: KeystoneDeliveryInterface;
  private readonly security?: EnvelopeSecurity;
  private readonly localNodeId?: NodeId;
  private unsubscribe?: () => void;
  private invitation?: CapsuleInvitation; private started = false;
  constructor(readonly capsule: CapsuleDocument, private readonly options: CapsuleNetworkOptions) {
    if (!options.participant.id.trim() || !options.participant.name.trim()) throw new Error('Participant identity is required');
    this.transport = options.transport; this.security = options.security; this.localNodeId = options.localNodeId;
    this.peers = [...new Set(options.peers ?? [])].filter(peer => peer !== this.localNodeId);
    this.now = options.now ?? Date.now;
    if (this.transport && (!this.security || !this.localNodeId)) throw new Error('Fabric-backed CapsuleNetwork requires localNodeId and EnvelopeSecurity');
  }

  /** Starts an owner session and returns its bearer invitation token. */
  async host(seed: Uint8Array = randomBytes(32)): Promise<string> {
    if (this.started) throw new Error('Capsule network is already started');
    // The second key in the invitation remains an opaque, per-session
    // bootstrap nonce for link compatibility. It is not a route or identity;
    // Fabric peers are authenticated by the application envelope instead.
    const token = createCapsuleInvitation(this.capsule.id, randomBytes(32), seed);
    await this.start(parseCapsuleInvitation(token), true);
    return token;
  }

  /** Joins only the capsule named by the invitation; the private parent doc is never attached. */
  async join(tokenOrLink: string): Promise<void> { if (this.started) throw new Error('Capsule network is already started'); await this.start(parseCapsuleInvitation(tokenOrLink), false); }

  onCursor(handler: (cursor: CapsuleCursor) => void): () => void { this.cursorHandlers.add(handler); return () => this.cursorHandlers.delete(handler); }

  broadcastCursor(position: { x: number; y: number }): void {
    if (!this.invitation || !Number.isFinite(position.x) || !Number.isFinite(position.y)) return;
    const message: CapsuleCursor = { type: 'cursor', capsuleId: this.capsule.id, participantId: this.options.participant.id.slice(0, 128), name: this.options.participant.name.slice(0, 80), x: position.x, y: position.y, sentAt: this.now() };
    this.cursorHandlers.forEach(handler => handler(message)); void this.broadcast({ t: 'cursor', cursor: message });
  }

  async close(): Promise<void> {
    this.started = false; this.capsule.document.off('update', this.onDocumentUpdate); this.unsubscribe?.(); this.unsubscribe = undefined;
  }

  private async start(invitation: CapsuleInvitation, owner: boolean): Promise<void> {
    if (invitation.capsuleId !== this.capsule.id) throw new Error('Invitation does not match capsule');
    this.invitation = invitation; this.started = true;
    this.capsule.document.on('update', this.onDocumentUpdate);
    if (!this.transport) return;
    if (!this.security || !this.localNodeId) throw new Error('Fabric-backed CapsuleNetwork is missing authentication');
    this.unsubscribe = this.transport.onMessage(envelope => { void this.receive(envelope); });
    // Fabric has no implicit socket/bearer connection. A participant asks
    // each explicitly supplied peer for the current state after joining.
    await this.broadcast({ t: 'sv', s: base64url(Y.encodeStateVector(this.capsule.document)), owner });
  }

  private readonly onDocumentUpdate = (update: Uint8Array, origin: unknown): void => { if (origin === this || !this.started) return; void this.broadcast({ t: 'u', u: base64url(update) }); };

  private async broadcast(message: Record<string, unknown>): Promise<void> {
    if (!this.transport || !this.security || !this.localNodeId) return;
    for (const peer of this.peers) {
      try { await this.send(peer, message); } catch { /* local-first: the next explicit sync retries */ }
    }
  }

  private async send(peer: NodeId, message: Record<string, unknown>): Promise<void> {
    if (!this.transport || !this.security || !this.localNodeId) return;
    const unsigned: UnsignedEnvelope = { version: 1, type: 'sync.context_capsule', id: crypto.randomUUID(), sender: this.localNodeId, recipient: peer, nonce: crypto.randomUUID(), expiresAt: new Date(this.now() + 60_000).toISOString(), body: { capsuleId: this.capsule.id, message } };
    await this.transport.connect(peer); await this.transport.send(peer, { ...unsigned, signature: await this.security.sign(unsigned) });
  }

  private async receive(envelope: Envelope): Promise<void> {
    if (!this.started || !this.transport || !this.security || !this.localNodeId || envelope.type !== 'sync.context_capsule' || envelope.recipient !== this.localNodeId) return;
    if (this.peers.length && !this.peers.includes(envelope.sender)) return;
    if (Date.parse(envelope.expiresAt) <= this.now() || !(await this.security.verify(envelope))) return;
    const body = envelope.body && typeof envelope.body === 'object' ? envelope.body as { capsuleId?: unknown; message?: unknown } : {};
    if (body.capsuleId !== this.capsule.id || !body.message || typeof body.message !== 'object') return;
    const message = body.message as Record<string, unknown>;
    try {
      if (message.t === 'u' && typeof message.u === 'string') Y.applyUpdate(this.capsule.document, decodeBytes(message.u), this);
      else if (message.t === 'sv' && typeof message.s === 'string') await this.send(envelope.sender, { t: 'u', u: base64url(Y.encodeStateAsUpdate(this.capsule.document, decodeBytes(message.s))) });
      else if (message.t === 'cursor' && message.cursor && typeof message.cursor === 'object') { const cursor = validateCursor(message.cursor as Record<string, unknown>, this.capsule.id, this.now()); if (cursor) this.cursorHandlers.forEach(handler => handler(cursor)); }
    } catch { /* malformed/untrusted capsule updates are discarded */ }
  }
}

class FrameReader {
  private readonly decoder = new BoundedFrameDecoder({ maxFrameBytes: MAX_FRAME_BYTES, maxPendingBytes: MAX_FRAME_BYTES * 2 });
  constructor(private readonly receive: (value: Record<string, unknown>) => void) {}
  push(chunk: Buffer): void { if (chunk.byteLength > MAX_FRAME_BYTES * 2) return; let frames; try { frames = this.decoder.push(chunk); } catch { return; } for (const frame of frames) { try { const value = parseBoundedJson<Record<string, unknown>>(frame.bytes, { maxDepth: 16, maxCollectionItems: 512, maxStringBytes: MAX_FRAME_BYTES * 2, maxNodes: 4096 }); if (value && typeof value === 'object' && !Array.isArray(value)) this.receive(value); } catch { /* discard malformed untrusted frames */ } } }
}
function capsuleDocument(id: string, document: Y.Doc): CapsuleDocument { return { id, document, nodes: document.getMap('nodes'), edges: document.getMap('edges'), resources: document.getMap('resources') }; }
function validId(value: string): boolean { return value.length > 0 && value.length <= 160 && /^[a-zA-Z0-9._:-]+$/.test(value); }
function base64url(value: Uint8Array): string { return Buffer.from(value).toString('base64url'); }
function decodeBytes(value: string): Uint8Array { if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid base64url value'); return new Uint8Array(Buffer.from(value, 'base64url')); }
function decode32(value: unknown): Uint8Array { if (typeof value !== 'string') throw new Error('Invalid capsule invitation token'); const result = decodeBytes(value); if (result.length !== 32) throw new Error('Invalid capsule invitation token'); return result; }
function forEachMap(value: unknown, callback: (value: unknown, key: string) => void): void { if (value instanceof Y.Map) value.forEach(callback); }
function toRecord(value: unknown): Record<string, unknown> | undefined { if (!value || typeof value !== 'object') return undefined; const candidate = value as { toJSON?: () => unknown }; const json = candidate.toJSON?.() ?? value; return json && typeof json === 'object' && !Array.isArray(json) ? json as Record<string, unknown> : undefined; }
function clonePublicRecord(value: unknown): unknown { const record = toRecord(value); if (!record) return value; const privateKey = /^(private|secret|token|password|credential|owner|acl|device|internal)/i; return Object.fromEntries(Object.entries(record).filter(([key]) => !privateKey.test(key)).map(([key, child]) => [key, child && typeof child === 'object' ? structuredClone(child) : child])); }
function validateCursor(value: Record<string, unknown>, capsuleId: string, now: number): CapsuleCursor | undefined {
  if (value.type !== 'cursor' || value.capsuleId !== capsuleId || typeof value.participantId !== 'string' || !value.participantId || value.participantId.length > 128 || typeof value.name !== 'string' || !value.name || value.name.length > 80 || typeof value.x !== 'number' || !Number.isFinite(value.x) || typeof value.y !== 'number' || !Number.isFinite(value.y) || typeof value.sentAt !== 'number' || Math.abs(now - value.sentAt) > 30_000) return undefined;
  return value as unknown as CapsuleCursor;
}
