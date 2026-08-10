/// <reference path="../../types/hyperswarm.d.ts" />
/// <reference path="../../types/hyperdht.d.ts" />
import * as Y from 'yjs';
import Hyperswarm from 'hyperswarm';
import DHT from 'hyperdht';
import { createHash, randomBytes } from 'node:crypto';
import type { SwarmConnection } from 'hyperswarm';
import type { DHTServer, KeyPair, RelaySocket } from 'hyperdht';

export interface CapsuleInvitation { version: 1; capsuleId: string; seed: Uint8Array; ephemeralPublicKey: Uint8Array }
export interface CapsuleCursor { type: 'cursor'; capsuleId: string; participantId: string; name: string; x: number; y: number; sentAt: number }
export interface CapsuleDocument { id: string; document: Y.Doc; nodes: Y.Map<unknown>; edges: Y.Map<unknown>; resources: Y.Map<unknown> }
export interface CapsuleNetworkOptions {
  participant: { id: string; name: string };
  swarmFactory?: () => Hyperswarm;
  dhtFactory?: () => DHT;
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
  try { raw = JSON.parse(Buffer.from(token.slice(TOKEN_PREFIX.length), 'base64url').toString('utf8')); } catch { throw new Error('Invalid capsule invitation token'); }
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
  private readonly swarm: Hyperswarm; private readonly dht: DHT; private readonly now: () => number;
  private readonly connections = new Set<SwarmConnection>(); private readonly cursorHandlers = new Set<(cursor: CapsuleCursor) => void>();
  private readonly ephemeralSockets = new Set<RelaySocket>(); private server?: DHTServer; private ownerKeys?: KeyPair; private topic?: Buffer;
  private invitation?: CapsuleInvitation; private started = false;
  constructor(readonly capsule: CapsuleDocument, private readonly options: CapsuleNetworkOptions) {
    if (!options.participant.id.trim() || !options.participant.name.trim()) throw new Error('Participant identity is required');
    this.swarm = options.swarmFactory?.() ?? new Hyperswarm(); this.dht = options.dhtFactory?.() ?? new DHT(); this.now = options.now ?? Date.now;
  }

  /** Starts an owner session and returns its bearer invitation token. */
  async host(seed: Uint8Array = randomBytes(32)): Promise<string> {
    if (this.started) throw new Error('Capsule network is already started');
    this.ownerKeys = DHT.keyPair();
    const token = createCapsuleInvitation(this.capsule.id, this.ownerKeys.publicKey, seed);
    await this.start(parseCapsuleInvitation(token), true);
    return token;
  }

  /** Joins only the capsule named by the invitation; the private parent doc is never attached. */
  async join(tokenOrLink: string): Promise<void> { if (this.started) throw new Error('Capsule network is already started'); await this.start(parseCapsuleInvitation(tokenOrLink), false); }

  onCursor(handler: (cursor: CapsuleCursor) => void): () => void { this.cursorHandlers.add(handler); return () => this.cursorHandlers.delete(handler); }

  broadcastCursor(position: { x: number; y: number }): void {
    if (!this.invitation || !Number.isFinite(position.x) || !Number.isFinite(position.y)) return;
    const message: CapsuleCursor = { type: 'cursor', capsuleId: this.capsule.id, participantId: this.options.participant.id.slice(0, 128), name: this.options.participant.name.slice(0, 80), x: position.x, y: position.y, sentAt: this.now() };
    this.cursorHandlers.forEach(handler => handler(message)); this.broadcastEphemeral(message);
  }

  async close(): Promise<void> {
    this.started = false; this.capsule.document.off('update', this.onDocumentUpdate);
    for (const socket of this.ephemeralSockets) (socket as RelaySocket & { destroy?: () => void }).destroy?.(); this.ephemeralSockets.clear();
    await this.server?.close(); await this.swarm.destroy({ force: true }); await this.dht.destroy();
  }

  private async start(invitation: CapsuleInvitation, owner: boolean): Promise<void> {
    if (invitation.capsuleId !== this.capsule.id) throw new Error('Invitation does not match capsule');
    this.invitation = invitation; this.started = true; this.topic = topicFor(invitation.seed);
    this.swarm.on('connection', connection => this.attachSync(connection));
    this.swarm.join(this.topic, { server: true, client: true });
    this.capsule.document.on('update', this.onDocumentUpdate);
    if (owner) {
      this.server = this.dht.createServer(socket => this.attachEphemeral(socket, true));
      await this.server.listen(this.ownerKeys);
    } else this.attachEphemeral(this.dht.connect(Buffer.from(invitation.ephemeralPublicKey)), false);
    await this.swarm.flush();
  }

  private readonly onDocumentUpdate = (update: Uint8Array, origin: unknown): void => { if (origin === this) return; this.broadcastSync({ t: 'u', u: base64url(update) }); };
  private attachSync(connection: SwarmConnection): void {
    this.connections.add(connection); const reader = new FrameReader(message => {
      if (message.t === 'u' && typeof message.u === 'string') Y.applyUpdate(this.capsule.document, decodeBytes(message.u), this);
      if (message.t === 'sv' && typeof message.s === 'string') writeFrame(connection, { t: 'u', u: base64url(Y.encodeStateAsUpdate(this.capsule.document, decodeBytes(message.s))) });
    });
    connection.on('data', chunk => reader.push(Buffer.from(chunk))); connection.on('close', () => this.connections.delete(connection)); connection.on('error', () => this.connections.delete(connection));
    writeFrame(connection, { t: 'sv', s: base64url(Y.encodeStateVector(this.capsule.document)) });
  }
  private broadcastSync(message: Record<string, unknown>): void { for (const connection of this.connections) writeFrame(connection, message); }
  private attachEphemeral(socket: RelaySocket, relay: boolean): void {
    this.ephemeralSockets.add(socket); const reader = new FrameReader(value => {
      const cursor = validateCursor(value, this.capsule.id, this.now()); if (!cursor) return;
      this.cursorHandlers.forEach(handler => handler(cursor));
      if (relay) for (const peer of this.ephemeralSockets) if (peer !== socket) writeFrame(peer, cursor);
    });
    socket.on('data', chunk => reader.push(Buffer.from(chunk))); socket.on('close', () => this.ephemeralSockets.delete(socket)); socket.on('error', () => this.ephemeralSockets.delete(socket));
  }
  private broadcastEphemeral(cursor: CapsuleCursor): void { for (const socket of this.ephemeralSockets) writeFrame(socket, cursor); }
}

class FrameReader {
  private buffer = Buffer.alloc(0);
  constructor(private readonly receive: (value: Record<string, unknown>) => void) {}
  push(chunk: Buffer): void { this.buffer = Buffer.concat([this.buffer, chunk]); while (this.buffer.length >= 4) { const length = this.buffer.readUInt32BE(0); if (length > MAX_FRAME_BYTES) { this.buffer = Buffer.alloc(0); return; } if (this.buffer.length < length + 4) return; const body = this.buffer.subarray(4, length + 4); this.buffer = this.buffer.subarray(length + 4); try { const value = JSON.parse(body.toString('utf8')); if (value && typeof value === 'object' && !Array.isArray(value)) this.receive(value); } catch { /* discard malformed untrusted frames */ } } }
}
function writeFrame(stream: NodeJS.WritableStream, value: unknown): void { const body = Buffer.from(JSON.stringify(value), 'utf8'); if (body.length > MAX_FRAME_BYTES) throw new Error('Capsule frame is too large'); const frame = Buffer.allocUnsafe(body.length + 4); frame.writeUInt32BE(body.length, 0); body.copy(frame, 4); stream.write(frame); }
function capsuleDocument(id: string, document: Y.Doc): CapsuleDocument { return { id, document, nodes: document.getMap('nodes'), edges: document.getMap('edges'), resources: document.getMap('resources') }; }
function topicFor(seed: Uint8Array): Buffer { return createHash('sha256').update('keystone/context-capsule/v1').update(seed).digest(); }
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
