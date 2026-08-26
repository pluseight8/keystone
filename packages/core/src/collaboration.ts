/**
 * R0P81 local-first collaboration.
 *
 * This module is the single application collaboration boundary.  Yjs is the
 * only CRDT implementation used here; transports, relays and providers never
 * receive an object-specific route choice or a private plaintext payload.
 * Durable updates are state-vector deltas.  Presence is deliberately kept in
 * a separate, bounded, expiring channel and is never persisted or applied to
 * a Y.Doc.
 */

import * as Y from 'yjs';
import type { KeystoneDeliveryInterface, Envelope, EnvelopeSecurity } from './connectivity.js';
import type { NodeId } from './types.js';
import { applyCanvasMutation, validateCanvasDocument, type CanvasDocument, type CanvasMutation } from './vault-canvas.js';
import type { DeviceSessionKeys } from './identity.js';
import { SodiumDirectMessageCipher } from './social/messaging.js';
import type { Workboard, WorkItem, WorkItemStatus } from './ai/workboards.js';

export const COLLABORATION_PROTOCOL = 'keystone.collaboration.r0p81' as const;
export const COLLABORATION_VERSION = 1 as const;

export type CollaborationObjectKind = 'document' | 'note' | 'canvas' | 'workboard' | 'shared-vault' | 'calendar' | 'custom';
export type CollaborationRole = 'owner' | 'editor' | 'commenter' | 'viewer';
export type CollaborationParticipantStatus = 'active' | 'pending' | 'revoked';
export type CollaborationAction = 'read' | 'edit' | 'comment' | 'manage-members';
export type CollaborationUpdateTarget = 'content' | 'comments';

export interface CollaborationPolicy {
  readonly maxUpdateBytes: number;
  readonly maxStateVectorBytes: number;
  readonly maxObjectBytes: number;
  readonly maxComments: number;
  readonly maxCommentBytes: number;
  readonly maxParticipants: number;
  readonly maxPendingUpdates: number;
  readonly maxPendingPresence: number;
  readonly presenceTtlMs: number;
  readonly presenceMinIntervalMs: number;
  readonly presenceMaxBytes: number;
  readonly autoFlushMs: number;
}

export const DEFAULT_COLLABORATION_POLICY: CollaborationPolicy = {
  maxUpdateBytes: 512 * 1024,
  maxStateVectorBytes: 128 * 1024,
  maxObjectBytes: 8 * 1024 * 1024,
  maxComments: 10_000,
  maxCommentBytes: 16 * 1024,
  maxParticipants: 256,
  maxPendingUpdates: 8_192,
  maxPendingPresence: 512,
  presenceTtlMs: 15_000,
  presenceMinIntervalMs: 100,
  presenceMaxBytes: 16 * 1024,
  autoFlushMs: 750,
};

export interface CollaborationParticipant {
  readonly identityId: NodeId;
  readonly role: CollaborationRole;
  readonly status: CollaborationParticipantStatus;
  readonly joinedAt: string;
  readonly expiresAt?: string;
  readonly invitationId?: string;
}

export type CollaborationInvitationStatus = 'pending' | 'accepted' | 'expired' | 'revoked';

export interface CollaborationInvitation {
  readonly version: 1;
  readonly id: string;
  readonly objectId: string;
  readonly spaceId?: string;
  readonly objectKind: CollaborationObjectKind;
  readonly inviter: NodeId;
  readonly invitee: NodeId;
  readonly role: Exclude<CollaborationRole, 'owner'>;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly status: CollaborationInvitationStatus;
}

export interface CollaborationComment {
  readonly version: 1;
  readonly id: string;
  readonly objectId: string;
  readonly authorId: NodeId;
  /** Plain text only. Rendering layers must not interpret this as markup. */
  readonly body: string;
  readonly createdAt: string;
  readonly resolved: boolean;
}

export interface CollaborationPresence {
  readonly version: 1;
  readonly objectId: string;
  readonly peerId: NodeId;
  readonly epoch: number;
  readonly status?: 'active' | 'idle' | 'editing';
  readonly cursor?: { readonly anchor: number; readonly head: number };
  readonly selection?: readonly string[];
  readonly updatedAt: string;
  readonly expiresAt: string;
}

export interface CollaborationChange {
  readonly objectId: string;
  readonly target: CollaborationUpdateTarget;
  readonly actor: NodeId;
  readonly operationId: string;
  readonly origin: 'local' | 'remote';
}

export interface SharedObjectAdapter<TSnapshot = unknown, TEdit = unknown> {
  readonly kind: CollaborationObjectKind;
  readonly name: string;
  initialize(doc: Y.Doc, initial?: TSnapshot): void;
  snapshot(doc: Y.Doc): TSnapshot;
  applyLocalEdit(doc: Y.Doc, edit: TEdit): void;
  validate(doc: Y.Doc): void;
}

export interface TextDocumentSnapshot {
  readonly version: 1;
  readonly title: string;
  readonly content: string;
  readonly metadata: Readonly<Record<string, string | number | boolean>>;
}

export type TextDocumentEdit =
  | { readonly type: 'insert'; readonly index: number; readonly text: string }
  | { readonly type: 'delete'; readonly index: number; readonly length: number }
  | { readonly type: 'replace'; readonly text: string }
  | { readonly type: 'set_title'; readonly title: string }
  | { readonly type: 'set_metadata'; readonly key: string; readonly value: string | number | boolean | undefined };

const EMPTY_TEXT_DOCUMENT: TextDocumentSnapshot = { version: 1, title: 'Untitled', content: '', metadata: {} };

/** Y.Text-backed adapter for both document and Markdown-note collaboration. */
export class TextDocumentSharedObjectAdapter implements SharedObjectAdapter<TextDocumentSnapshot, TextDocumentEdit> {
  readonly name = 'Y.Text document/note adapter';
  constructor(readonly kind: 'document' | 'note' = 'document', private readonly maxContentBytes = 2 * 1024 * 1024) {}

  initialize(doc: Y.Doc, initial: TextDocumentSnapshot = EMPTY_TEXT_DOCUMENT): void {
    const meta = doc.getMap<unknown>('r0p81.text.meta');
    const content = doc.getText('r0p81.text.content');
    if (meta.has('initialized')) return;
    const value = normalizeTextSnapshot(initial);
    doc.transact(() => {
      meta.set('initialized', true);
      meta.set('title', value.title);
      meta.set('metadata', JSON.stringify(value.metadata));
      if (value.content) content.insert(0, value.content);
    }, 'r0p81-initialize');
  }

  snapshot(doc: Y.Doc): TextDocumentSnapshot {
    const meta = doc.getMap<unknown>('r0p81.text.meta');
    let metadata: Readonly<Record<string, string | number | boolean>> = {};
    try {
      const parsed = JSON.parse(String(meta.get('metadata') ?? '{}')) as unknown;
      if (isRecord(parsed)) metadata = normalizeMetadata(parsed);
    } catch { metadata = {}; }
    return { version: 1, title: boundedText(String(meta.get('title') ?? 'Untitled'), 512, 'title'), content: doc.getText('r0p81.text.content').toString(), metadata };
  }

  applyLocalEdit(doc: Y.Doc, edit: TextDocumentEdit): void {
    const content = doc.getText('r0p81.text.content');
    const meta = doc.getMap<unknown>('r0p81.text.meta');
    doc.transact(() => {
      if (edit.type === 'insert') {
        assertIndex(edit.index, content.length);
        const text = boundedText(edit.text, this.maxContentBytes, 'insert');
        content.insert(edit.index, text);
      } else if (edit.type === 'delete') {
        assertIndex(edit.index, content.length);
        if (!Number.isSafeInteger(edit.length) || edit.length < 0 || edit.length > content.length - edit.index) throw new CollaborationError('INVALID_EDIT', 'Text delete range is invalid');
        content.delete(edit.index, edit.length);
      } else if (edit.type === 'replace') {
        const text = boundedText(edit.text, this.maxContentBytes, 'replace');
        content.delete(0, content.length); if (text) content.insert(0, text);
      } else if (edit.type === 'set_title') {
        meta.set('title', boundedText(edit.title, 512, 'title'));
      } else {
        if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(edit.key)) throw new CollaborationError('INVALID_EDIT', 'Metadata key is invalid');
        if (edit.value === undefined) {
          const values = readMetadata(meta); delete values[edit.key]; meta.set('metadata', JSON.stringify(values));
        } else {
          const values = readMetadata(meta); values[edit.key] = edit.value; meta.set('metadata', JSON.stringify(values));
        }
      }
    }, 'r0p81-local-edit');
    this.validate(doc);
  }

  validate(doc: Y.Doc): void {
    const snapshot = this.snapshot(doc);
    if (new TextEncoder().encode(snapshot.content).byteLength > this.maxContentBytes) throw new CollaborationError('OBJECT_LIMIT', 'Text document exceeds its content bound');
    normalizeTextSnapshot(snapshot);
  }
}

export interface CanvasCollaborationEditReplace { readonly type: 'replace_document'; readonly document: CanvasDocument; }
export type CanvasCollaborationEdit = CanvasMutation | CanvasCollaborationEditReplace;

/** Canvas adapter reuses the existing pure Canvas mutation/validation rules. */
export class CanvasSharedObjectAdapter implements SharedObjectAdapter<CanvasDocument, CanvasCollaborationEdit> {
  readonly kind = 'canvas' as const;
  readonly name = 'CanvasService business-rule adapter';
  constructor(private readonly maxNodes = 10_000, private readonly maxEdges = 20_000) {}

  initialize(doc: Y.Doc, initial?: CanvasDocument): void {
    const state = doc.getMap<unknown>('r0p81.canvas');
    if (state.has('json')) return;
    if (!initial) throw new CollaborationError('INVALID_EDIT', 'Canvas collaboration requires an initial CanvasDocument');
    validateCanvasDocument(initial, this.maxNodes, this.maxEdges);
    state.set('json', JSON.stringify(initial));
  }

  snapshot(doc: Y.Doc): CanvasDocument {
    const raw = doc.getMap<unknown>('r0p81.canvas').get('json');
    if (typeof raw !== 'string') throw new CollaborationError('CORRUPT_STATE', 'Canvas CRDT state is missing');
    let parsed: unknown; try { parsed = JSON.parse(raw); } catch { throw new CollaborationError('CORRUPT_STATE', 'Canvas CRDT state is not JSON'); }
    validateCanvasDocument(parsed as CanvasDocument, this.maxNodes, this.maxEdges);
    return structuredClone(parsed as CanvasDocument);
  }

  applyLocalEdit(doc: Y.Doc, edit: CanvasCollaborationEdit): void {
    const current = this.snapshot(doc);
    const next = edit.type === 'replace_document' ? structuredClone(edit.document) : applyCanvasMutation(current, edit, this.maxNodes, this.maxEdges);
    validateCanvasDocument(next, this.maxNodes, this.maxEdges);
    doc.transact(() => { doc.getMap<unknown>('r0p81.canvas').set('json', JSON.stringify(next)); }, 'r0p81-local-edit');
  }

  validate(doc: Y.Doc): void { this.snapshot(doc); }
}

export interface WorkboardCollaborationSnapshot {
  readonly version: 1;
  readonly board: Workboard;
  readonly items: readonly WorkItem[];
}

export type WorkboardCollaborationEdit =
  | { readonly type: 'upsert_item'; readonly item: WorkItem }
  | { readonly type: 'remove_item'; readonly itemId: string }
  | { readonly type: 'replace_board'; readonly board: Workboard };

export interface WorkboardCollaborationRules {
  /** Inject AgentWorkboardService-backed authorization/status validation here. */
  readonly validateEdit?: (snapshot: WorkboardCollaborationSnapshot, edit: WorkboardCollaborationEdit) => void;
}

/**
 * Workboard adapter keeps the canonical Workboard/WorkItem shapes and exposes a
 * typed hook for AgentWorkboardService business rules.  It never executes an
 * Agent, ToolFlow, plugin or task graph as a consequence of a CRDT update.
 */
export class WorkboardSharedObjectAdapter implements SharedObjectAdapter<WorkboardCollaborationSnapshot, WorkboardCollaborationEdit> {
  readonly kind = 'workboard' as const;
  readonly name = 'AgentWorkboardService business-rule adapter';
  constructor(private readonly rules: WorkboardCollaborationRules = {}, private readonly maxItems = 10_000) {}

  initialize(doc: Y.Doc, initial?: WorkboardCollaborationSnapshot): void {
    const state = doc.getMap<unknown>('r0p81.workboard');
    if (state.has('board')) return;
    if (!initial || initial.version !== 1) throw new CollaborationError('INVALID_EDIT', 'Workboard collaboration requires an initial board');
    this.validateSnapshot(initial);
    state.set('board', JSON.stringify(initial.board));
    const items = doc.getMap<unknown>('r0p81.workboard.items');
    for (const item of initial.items) items.set(item.id, JSON.stringify(item));
  }

  snapshot(doc: Y.Doc): WorkboardCollaborationSnapshot {
    const state = doc.getMap<unknown>('r0p81.workboard');
    const boardRaw = state.get('board'); if (typeof boardRaw !== 'string') throw new CollaborationError('CORRUPT_STATE', 'Workboard board state is missing');
    let board: Workboard; try { board = JSON.parse(boardRaw) as Workboard; } catch { throw new CollaborationError('CORRUPT_STATE', 'Workboard board state is invalid'); }
    const items: WorkItem[] = [];
    for (const [id, value] of doc.getMap<unknown>('r0p81.workboard.items')) { if (typeof value !== 'string') throw new CollaborationError('CORRUPT_STATE', `Workboard item ${id} is invalid`); try { items.push(JSON.parse(value) as WorkItem); } catch { throw new CollaborationError('CORRUPT_STATE', `Workboard item ${id} is invalid`); } }
    const snapshot = { version: 1 as const, board, items };
    this.validateSnapshot(snapshot);
    return structuredClone(snapshot);
  }

  applyLocalEdit(doc: Y.Doc, edit: WorkboardCollaborationEdit): void {
    const current = this.snapshot(doc); this.rules.validateEdit?.(current, edit);
    if (edit.type === 'upsert_item' && edit.item.boardId !== current.board.id) throw new CollaborationError('INVALID_EDIT', 'WorkItem belongs to another Workboard');
    if (edit.type === 'remove_item' && !current.items.some(item => item.id === edit.itemId)) throw new CollaborationError('INVALID_EDIT', 'WorkItem does not exist');
    doc.transact(() => {
      const state = doc.getMap<unknown>('r0p81.workboard'); const items = doc.getMap<unknown>('r0p81.workboard.items');
      if (edit.type === 'replace_board') state.set('board', JSON.stringify(edit.board));
      else if (edit.type === 'upsert_item') items.set(edit.item.id, JSON.stringify(edit.item));
      else items.delete(edit.itemId);
    }, 'r0p81-local-edit');
    this.validate(doc);
  }

  validate(doc: Y.Doc): void { this.validateSnapshot(this.snapshot(doc)); }

  private validateSnapshot(snapshot: WorkboardCollaborationSnapshot): void {
    if (!snapshot.board || snapshot.board.version !== 1 || typeof snapshot.board.id !== 'string' || !snapshot.board.id) throw new CollaborationError('CORRUPT_STATE', 'Workboard board shape is invalid');
    if (snapshot.items.length > this.maxItems) throw new CollaborationError('OBJECT_LIMIT', 'Workboard item bound exceeded');
    const ids = new Set<string>();
    for (const item of snapshot.items) {
      if (!item || item.version !== 1 || item.boardId !== snapshot.board.id || !item.id || ids.has(item.id)) throw new CollaborationError('CORRUPT_STATE', 'Workboard item shape is invalid');
      if (!isWorkItemStatus(item.status)) throw new CollaborationError('CORRUPT_STATE', 'Workboard item status is invalid');
      ids.add(item.id);
    }
  }
}

export interface CollaborationStateStore {
  read(): Promise<unknown | undefined>;
  write(value: unknown): Promise<void>;
}

export class InMemoryCollaborationStateStore implements CollaborationStateStore {
  private value?: unknown;
  async read(): Promise<unknown | undefined> { return this.value === undefined ? undefined : structuredClone(this.value); }
  async write(value: unknown): Promise<void> { this.value = structuredClone(value); }
  corrupt(value: unknown): void { this.value = structuredClone(value); }
}

export interface CollaborationCipher {
  seal(input: { readonly objectId: string; readonly sender: NodeId; readonly recipient: NodeId; readonly epoch: number; readonly value: unknown }): Promise<unknown>;
  open(input: { readonly objectId: string; readonly sender: NodeId; readonly recipient: NodeId; readonly epoch: number; readonly value: unknown }): Promise<unknown>;
}

/** Adapter over the existing recipient-keyed SodiumDirectMessageCipher. */
export class SodiumCollaborationCipher implements CollaborationCipher {
  private readonly cipher = new SodiumDirectMessageCipher();
  private readonly peers: ReadonlyMap<NodeId, DeviceSessionKeys>;
  constructor(private readonly local: DeviceSessionKeys, peers: ReadonlyMap<NodeId, DeviceSessionKeys> | readonly DeviceSessionKeys[]) {
    if (Array.isArray(peers)) this.peers = new Map(peers.map((peer: DeviceSessionKeys) => [peer.nodeId, peer] as const));
    else this.peers = peers as ReadonlyMap<NodeId, DeviceSessionKeys>;
  }
  async seal(input: { readonly objectId: string; readonly sender: NodeId; readonly recipient: NodeId; readonly epoch: number; readonly value: unknown }): Promise<unknown> {
    if (input.sender !== this.local.nodeId) throw new CollaborationError('PRIVATE_KEY_UNAVAILABLE', 'Collaboration cipher sender mismatch');
    const peer = this.peers.get(input.recipient); if (!peer) throw new CollaborationError('PRIVATE_KEY_UNAVAILABLE', 'Recipient encryption key is unavailable');
    const encrypted = await this.cipher.encrypt(JSON.stringify(input.value), this.local.encryptionPrivateKey, peer.encryptionPublicKey);
    return { version: 1, algorithm: 'xsalsa20poly1305', nonce: encrypted.nonce, ciphertext: encrypted.ciphertext };
  }
  async open(input: { readonly objectId: string; readonly sender: NodeId; readonly recipient: NodeId; readonly epoch: number; readonly value: unknown }): Promise<unknown> {
    if (input.recipient !== this.local.nodeId) throw new CollaborationError('PRIVATE_KEY_UNAVAILABLE', 'Collaboration cipher recipient mismatch');
    const peer = this.peers.get(input.sender); if (!peer || !isRecord(input.value) || input.value.algorithm !== 'xsalsa20poly1305' || typeof input.value.nonce !== 'string' || typeof input.value.ciphertext !== 'string') throw new CollaborationError('PRIVATE_KEY_UNAVAILABLE', 'Collaboration ciphertext is malformed');
    try { return JSON.parse(await this.cipher.decrypt(input.value, this.local.encryptionPrivateKey, peer.encryptionPublicKey)) as unknown; } catch { throw new CollaborationError('PRIVATE_KEY_UNAVAILABLE', 'Collaboration ciphertext authentication failed'); }
  }
}

export interface CollaborationServiceOptions {
  readonly identityId: NodeId;
  readonly delivery: KeystoneDeliveryInterface;
  readonly security: EnvelopeSecurity;
  readonly adapters?: readonly SharedObjectAdapter[];
  readonly store?: CollaborationStateStore;
  readonly cipher?: CollaborationCipher;
  readonly policy?: Partial<CollaborationPolicy>;
  readonly now?: () => number;
}

export interface CreateCollaborativeObjectInput<TSnapshot = unknown> {
  readonly id?: string;
  readonly kind: CollaborationObjectKind;
  readonly spaceId?: string;
  readonly private?: boolean;
  readonly adapter?: SharedObjectAdapter<TSnapshot, unknown>;
  readonly initial?: TSnapshot;
}

export interface CollaborationObjectInfo {
  readonly id: string;
  readonly kind: CollaborationObjectKind;
  readonly spaceId?: string;
  readonly private: boolean;
  readonly epoch: number;
  readonly ownerId: NodeId;
  readonly participants: readonly CollaborationParticipant[];
  readonly invitations: readonly CollaborationInvitation[];
  readonly pendingUpdates: number;
}

interface PendingUpdate {
  readonly operationId: string;
  readonly target: CollaborationUpdateTarget;
  readonly objectId: string;
  readonly epoch: number;
  readonly actor: NodeId;
  readonly update: string;
  readonly peers: Set<NodeId>;
  attempts: number;
  lastAttemptAt: number;
}

interface StoredObject {
  readonly id: string;
  readonly kind: CollaborationObjectKind;
  readonly spaceId?: string;
  readonly private: boolean;
  readonly ownerId: NodeId;
  epoch: number;
  readonly adapter: SharedObjectAdapter<any, any>;
  readonly doc: Y.Doc;
  readonly comments: Y.Doc;
  readonly participants: Map<NodeId, CollaborationParticipant>;
  readonly invitations: Map<string, CollaborationInvitation>;
  readonly pending: Map<string, PendingUpdate>;
  readonly seen: Set<string>;
  readonly presence: Map<NodeId, CollaborationPresence>;
  readonly lastPresenceSent: Map<NodeId, number>;
  readonly presenceTimers: Map<NodeId, ReturnType<typeof setTimeout>>;
  readonly listeners: Set<(change: CollaborationChange) => void>;
  lastSyncByPeer: Map<NodeId, number>;
}

interface PersistedPendingUpdate {
  readonly operationId: string;
  readonly target: CollaborationUpdateTarget;
  readonly objectId: string;
  readonly epoch: number;
  readonly actor: NodeId;
  readonly update: string;
  readonly peers: readonly NodeId[];
  readonly attempts: number;
  readonly lastAttemptAt: number;
}

interface PersistedObject {
  readonly version: 1;
  readonly id: string;
  readonly kind: CollaborationObjectKind;
  readonly spaceId?: string;
  readonly private: boolean;
  readonly ownerId: NodeId;
  readonly epoch: number;
  readonly contentState: string;
  readonly commentState: string;
  readonly participants: readonly CollaborationParticipant[];
  readonly invitations: readonly CollaborationInvitation[];
  readonly pending: readonly PersistedPendingUpdate[];
}

interface PersistedState { readonly version: 1; readonly objects: readonly PersistedObject[]; }

type WireKind = 'update' | 'sync.request' | 'sync.response' | 'invite' | 'invite.accept' | 'membership' | 'presence';
interface WireBase { readonly version: 1; readonly protocol: typeof COLLABORATION_PROTOCOL; readonly kind: WireKind | 'protected'; readonly objectId: string; readonly epoch: number; }
interface ProtectedWire extends WireBase { readonly kind: 'protected'; readonly protected: unknown; }
type WireBody = WireBase & Record<string, unknown> | ProtectedWire;

const MAX_ENVELOPE_LIFETIME_MS = 10 * 60_000;
const PRESENCE_TYPE = 'keystone.collaboration.presence.live';

export class CollaborationError extends Error {
  constructor(readonly code: 'INVALID_ARGUMENT' | 'INVALID_EDIT' | 'NOT_FOUND' | 'NOT_AUTHORIZED' | 'INVITATION_EXPIRED' | 'STALE_EPOCH' | 'REPLAY' | 'MALFORMED_UPDATE' | 'OBJECT_LIMIT' | 'CORRUPT_STATE' | 'PRIVATE_KEY_UNAVAILABLE' | 'DELIVERY_UNAVAILABLE' | 'PRESENCE_REJECTED', message: string) { super(message); this.name = 'CollaborationError'; }
}

/**
 * First-class collaboration service for notes/documents, Canvas and
 * Workboards.  Application code sees a delivery interface only; this class
 * has no raw Transport, Hyperswarm or provider dependency.
 */
export class CollaborationService {
  private readonly identityId: NodeId;
  private readonly delivery: KeystoneDeliveryInterface;
  private readonly security: EnvelopeSecurity;
  private readonly store: CollaborationStateStore;
  private readonly cipher?: CollaborationCipher;
  private readonly policy: CollaborationPolicy;
  private readonly now: () => number;
  private readonly adapters = new Map<CollaborationObjectKind, SharedObjectAdapter<any, any>>();
  private readonly objects = new Map<string, StoredObject>();
  private readonly listeners = new Set<(change: CollaborationChange) => void>();
  private readonly unsubscribe: () => void;
  private readonly readyPromise: Promise<void>;
  private flushTimer?: ReturnType<typeof setInterval>;
  private closed = false;
  private accepted = 0;
  private rejected = 0;
  private replayed = 0;
  private presenceRejected = 0;

  constructor(options: CollaborationServiceOptions) {
    if (!options.identityId || !options.delivery || !options.security) throw new CollaborationError('INVALID_ARGUMENT', 'CollaborationService requires identity, delivery and envelope security');
    this.identityId = options.identityId; this.delivery = options.delivery; this.security = options.security; this.store = options.store ?? new InMemoryCollaborationStateStore(); this.cipher = options.cipher; this.now = options.now ?? Date.now;
    this.policy = normalizePolicy(options.policy);
    for (const adapter of options.adapters ?? [new TextDocumentSharedObjectAdapter('document'), new TextDocumentSharedObjectAdapter('note'), new CanvasSharedObjectAdapter(), new WorkboardSharedObjectAdapter()]) this.registerAdapter(adapter);
    this.unsubscribe = this.delivery.onMessage(envelope => { void this.receive(envelope); });
    this.readyPromise = this.hydrate();
  }

  async ready(): Promise<void> { await this.readyPromise; }

  registerAdapter(adapter: SharedObjectAdapter): void {
    if (!adapter || !adapter.kind || !adapter.name || typeof adapter.initialize !== 'function' || typeof adapter.applyLocalEdit !== 'function') throw new CollaborationError('INVALID_ARGUMENT', 'SharedObjectAdapter is incomplete');
    this.adapters.set(adapter.kind, adapter);
  }

  subscribe(listener: (change: CollaborationChange) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }

  subscribeObject(objectId: string, listener: (change: CollaborationChange) => void): () => void { const object = this.requireObject(objectId); object.listeners.add(listener); return () => object.listeners.delete(listener); }

  async createObject<TSnapshot = unknown>(input: CreateCollaborativeObjectInput<TSnapshot>): Promise<CollaborationObjectInfo> {
    await this.ready(); this.assertOpen();
    const id = input.id ?? randomId('collab'); assertObjectId(id);
    if (this.objects.has(id)) throw new CollaborationError('INVALID_ARGUMENT', 'Collaborative object already exists');
    const adapter = input.adapter ?? this.adapters.get(input.kind);
    if (!adapter) throw new CollaborationError('INVALID_ARGUMENT', `No SharedObjectAdapter registered for ${input.kind}`);
    if (input.private && !this.cipher) throw new CollaborationError('PRIVATE_KEY_UNAVAILABLE', 'Private collaboration requires an application E2E cipher');
    const doc = new Y.Doc(); const comments = new Y.Doc(); adapter.initialize(doc, input.initial); adapter.validate(doc); this.assertObjectSize(doc, comments);
    const participant: CollaborationParticipant = { identityId: this.identityId, role: 'owner', status: 'active', joinedAt: nowIso(this.now) };
    const object: StoredObject = { id, kind: input.kind, ...(input.spaceId ? { spaceId: input.spaceId } : {}), private: input.private === true, ownerId: this.identityId, epoch: 1, adapter, doc, comments, participants: new Map([[this.identityId, participant]]), invitations: new Map(), pending: new Map(), seen: new Set(), presence: new Map(), lastPresenceSent: new Map(), presenceTimers: new Map(), listeners: new Set(), lastSyncByPeer: new Map() };
    this.objects.set(id, object); await this.persist(); return this.toInfo(object);
  }

  listObjects(): readonly CollaborationObjectInfo[] { return [...this.objects.values()].map(object => this.toInfo(object)); }

  info(objectId: string): CollaborationObjectInfo { return this.toInfo(this.requireObject(objectId)); }

  getInfo(objectId: string): CollaborationObjectInfo { return this.toInfo(this.requireObject(objectId)); }

  async snapshot<TSnapshot = unknown>(objectId: string): Promise<TSnapshot> { await this.ready(); const object = this.requireObject(objectId); this.requirePermission(object, 'read'); return structuredClone(object.adapter.snapshot(object.doc) as TSnapshot); }

  async edit<TEdit = unknown, TSnapshot = unknown>(objectId: string, edit: TEdit): Promise<TSnapshot> {
    await this.ready(); this.assertOpen(); const object = this.requireObject(objectId); this.requirePermission(object, 'edit');
    this.assertPendingCapacity(object);
    const stateVector = Y.encodeStateVector(object.doc); const operationId = randomId('collab-op');
    object.adapter.applyLocalEdit(object.doc, edit); object.adapter.validate(object.doc); this.assertObjectSize(object.doc, object.comments);
    const update = Y.encodeStateAsUpdate(object.doc, stateVector); if (!update.byteLength) return structuredClone(object.adapter.snapshot(object.doc) as TSnapshot);
    await this.queueUpdate(object, { operationId, target: 'content', objectId: object.id, epoch: object.epoch, actor: this.identityId, update: encodeBase64(update), peers: new Set(this.activePeers(object)), attempts: 0, lastAttemptAt: 0 });
    return structuredClone(object.adapter.snapshot(object.doc) as TSnapshot);
  }

  async addComment(objectId: string, body: string): Promise<CollaborationComment> {
    await this.ready(); this.assertOpen(); const object = this.requireObject(objectId); this.requirePermission(object, 'comment');
    this.assertPendingCapacity(object);
    const text = sanitizeCommentText(body, this.policy.maxCommentBytes); const current = this.comments(object.id);
    if (current.length >= this.policy.maxComments) throw new CollaborationError('OBJECT_LIMIT', 'Comment bound exceeded');
    const comment: CollaborationComment = { version: 1, id: randomId('comment'), objectId, authorId: this.identityId, body: text, createdAt: nowIso(this.now), resolved: false };
    const stateVector = Y.encodeStateVector(object.comments); object.comments.getArray<string>('r0p81.comments').push([JSON.stringify(comment)]);
    this.validateComments(object); this.assertObjectSize(object.doc, object.comments);
    const update = Y.encodeStateAsUpdate(object.comments, stateVector); await this.queueUpdate(object, { operationId: randomId('collab-comment'), target: 'comments', objectId, epoch: object.epoch, actor: this.identityId, update: encodeBase64(update), peers: new Set(this.activePeers(object)), attempts: 0, lastAttemptAt: 0 });
    return comment;
  }

  comments(objectId: string): readonly CollaborationComment[] {
    const object = this.requireObject(objectId); this.requirePermission(object, 'read'); const values: CollaborationComment[] = [];
    for (const raw of object.comments.getArray<string>('r0p81.comments').toArray()) { try { const value = JSON.parse(raw) as CollaborationComment; if (isComment(value) && value.objectId === objectId) values.push(value); } catch { /* malformed local comment is ignored */ } }
    return values.sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)).map(value => structuredClone(value));
  }

  async createInvitation(objectId: string, input: { readonly invitee: NodeId; readonly role: Exclude<CollaborationRole, 'owner'>; readonly expiresAt?: string }): Promise<CollaborationInvitation> {
    await this.ready(); this.assertOpen(); const object = this.requireObject(objectId); this.requirePermission(object, 'manage-members');
    if (input.invitee === this.identityId || !input.invitee || !['editor', 'commenter', 'viewer'].includes(input.role)) throw new CollaborationError('INVALID_ARGUMENT', 'Invitation target or role is invalid');
    if (object.participants.get(input.invitee)?.status === 'active') throw new CollaborationError('INVALID_ARGUMENT', 'Identity is already a collaborator');
    if (object.participants.size >= this.policy.maxParticipants) throw new CollaborationError('OBJECT_LIMIT', 'Participant bound exceeded');
    const expiresAt = input.expiresAt ?? new Date(this.now() + 24 * 60 * 60_000).toISOString(); const expires = Date.parse(expiresAt);
    if (!Number.isFinite(expires) || expires <= this.now() || expires - this.now() > 7 * 24 * 60 * 60_000) throw new CollaborationError('INVALID_ARGUMENT', 'Invitation expiry is invalid');
    const invitation: CollaborationInvitation = { version: 1, id: randomId('invite'), objectId, ...(object.spaceId ? { spaceId: object.spaceId } : {}), objectKind: object.kind, inviter: this.identityId, invitee: input.invitee, role: input.role, createdAt: nowIso(this.now), expiresAt, status: 'pending' };
    object.invitations.set(invitation.id, invitation); await this.persist();
    await this.sendInvitation(object, invitation).catch(() => undefined); return invitation;
  }

  listInvitations(objectId?: string): readonly CollaborationInvitation[] { const values = [...this.objects.values()].flatMap(object => [...object.invitations.values()]); return values.filter(value => !objectId || value.objectId === objectId).map(value => structuredClone(value)); }

  async acceptInvitation(invitationId: string): Promise<void> {
    await this.ready(); this.assertOpen(); const found = this.findInvitation(invitationId); if (!found) throw new CollaborationError('NOT_FOUND', 'Invitation not found'); const { object, invitation } = found;
    if (invitation.invitee !== this.identityId) throw new CollaborationError('NOT_AUTHORIZED', 'Invitation belongs to another identity'); if (Date.parse(invitation.expiresAt) <= this.now()) { object.invitations.set(invitation.id, { ...invitation, status: 'expired' }); await this.persist(); throw new CollaborationError('INVITATION_EXPIRED', 'Invitation has expired'); }
    if (invitation.status !== 'pending') throw new CollaborationError('INVALID_ARGUMENT', 'Invitation is not pending');
    object.invitations.set(invitation.id, { ...invitation, status: 'accepted' }); await this.persist();
    const body = { version: 1 as const, protocol: COLLABORATION_PROTOCOL, kind: 'invite.accept' as const, objectId: object.id, epoch: object.epoch, invitationId: invitation.id };
    await this.sendWire(object, invitation.inviter, body).catch(() => undefined);
  }

  async setRole(objectId: string, identityId: NodeId, role: Exclude<CollaborationRole, 'owner'>): Promise<void> {
    await this.ready(); this.assertOpen(); const object = this.requireObject(objectId); this.requirePermission(object, 'manage-members'); const current = object.participants.get(identityId);
    if (!current || current.status === 'revoked' || identityId === object.ownerId || !['editor', 'commenter', 'viewer'].includes(role)) throw new CollaborationError('NOT_AUTHORIZED', 'Cannot change this collaborator role');
    object.epoch += 1; object.participants.set(identityId, { ...current, role }); await this.persist(); await this.broadcastMembership(object);
  }

  async revoke(objectId: string, identityId: NodeId): Promise<void> {
    await this.ready(); this.assertOpen(); const object = this.requireObject(objectId); this.requirePermission(object, 'manage-members'); const current = object.participants.get(identityId);
    if (!current || identityId === object.ownerId || current.status === 'revoked') throw new CollaborationError('NOT_AUTHORIZED', 'Cannot revoke this collaborator');
    object.epoch += 1; object.participants.set(identityId, { ...current, status: 'revoked' }); await this.persist(); await this.broadcastMembership(object);
  }

  async reconnect(peer: NodeId): Promise<void> { await this.ready(); try { await this.delivery.reconnect?.(peer); } finally { await this.flush(peer); } }

  async flush(peer?: NodeId): Promise<void> {
    await this.ready(); if (this.closed) return;
    for (const object of this.objects.values()) {
      this.expireInvitations(object);
      for (const pending of [...object.pending.values()]) await this.tryPending(object, pending, peer);
      for (const invitation of object.invitations.values()) if (invitation.status === 'pending' && invitation.inviter === this.identityId && Date.parse(invitation.expiresAt) > this.now() && (!peer || invitation.invitee === peer)) await this.sendInvitation(object, invitation).catch(() => undefined);
      for (const invitation of object.invitations.values()) if (invitation.status === 'accepted' && invitation.invitee === this.identityId && invitation.inviter !== this.identityId && (!peer || invitation.inviter === peer)) await this.sendInviteAccept(object, invitation).catch(() => undefined);
      for (const collaborator of this.activePeers(object)) if (!peer || collaborator === peer) await this.requestSync(object, collaborator).catch(() => undefined);
    }
    await this.persist();
  }

  async publishPresence(objectId: string, input: { readonly status?: CollaborationPresence['status']; readonly cursor?: { readonly anchor: number; readonly head: number }; readonly selection?: readonly string[] }): Promise<{ readonly sent: boolean; readonly coalesced: boolean }> {
    await this.ready(); this.assertOpen(); const object = this.requireObject(objectId); this.requirePermission(object, 'read'); const peers = this.activePeers(object); if (!peers.length) return { sent: false, coalesced: false };
    const now = this.now(); const sanitized = makePresence(object, this.identityId, input, now, this.policy); const last = object.lastPresenceSent.get(this.identityId) ?? 0;
    if (now - last < this.policy.presenceMinIntervalMs) {
      if (object.presenceTimers.has(this.identityId)) return { sent: false, coalesced: true };
      const timer = setTimeout(() => { object.presenceTimers.delete(this.identityId); void this.publishPresence(objectId, input); }, this.policy.presenceMinIntervalMs - (now - last)); object.presenceTimers.set(this.identityId, timer); return { sent: false, coalesced: true };
    }
    object.lastPresenceSent.set(this.identityId, now); const body = { version: 1 as const, protocol: COLLABORATION_PROTOCOL, kind: 'presence' as const, objectId, epoch: object.epoch, presence: sanitized };
    let sent = false; for (const peer of peers) { try { await this.sendWire(object, peer, body); sent = true; } catch { /* presence is best effort and never enters durable queues */ } }
    return { sent, coalesced: false };
  }

  presence(objectId: string): readonly CollaborationPresence[] {
    const object = this.requireObject(objectId); this.prunePresenceState(object); return [...object.presence.values()].map(value => structuredClone(value));
  }

  prunePresence(objectId?: string): void { for (const object of this.objects.values()) if (!objectId || object.id === objectId) this.prunePresenceState(object); }

  stats(): { readonly objects: number; readonly pendingUpdates: number; readonly listeners: number; readonly presenceEntries: number; readonly accepted: number; readonly rejected: number; readonly replayed: number; readonly presenceRejected: number } {
    return { objects: this.objects.size, pendingUpdates: [...this.objects.values()].reduce((sum, value) => sum + value.pending.size, 0), listeners: this.listeners.size, presenceEntries: [...this.objects.values()].reduce((sum, value) => sum + value.presence.size, 0), accepted: this.accepted, rejected: this.rejected, replayed: this.replayed, presenceRejected: this.presenceRejected };
  }

  async close(): Promise<void> { if (this.closed) return; this.closed = true; if (this.flushTimer) clearInterval(this.flushTimer); for (const object of this.objects.values()) for (const timer of object.presenceTimers.values()) clearTimeout(timer); this.unsubscribe(); await this.persist(); }

  private async hydrate(): Promise<void> {
    const raw = await this.store.read(); if (raw === undefined) { this.startFlushTimer(); return; }
    if (!isRecord(raw) || raw.version !== 1 || !Array.isArray(raw.objects)) throw new CollaborationError('CORRUPT_STATE', 'Collaboration store version is invalid');
    for (const value of raw.objects) {
      if (!isPersistedObject(value)) throw new CollaborationError('CORRUPT_STATE', 'Collaboration object state is malformed');
      const adapter = this.adapters.get(value.kind); if (!adapter) throw new CollaborationError('CORRUPT_STATE', `No adapter for persisted ${value.kind} object`); if (value.private && !this.cipher) throw new CollaborationError('PRIVATE_KEY_UNAVAILABLE', 'Private collaboration state requires an E2E cipher');
      const doc = new Y.Doc(); const comments = new Y.Doc(); try { Y.applyUpdate(doc, decodeBase64(value.contentState)); Y.applyUpdate(comments, decodeBase64(value.commentState)); adapter.validate(doc); this.assertObjectSize(doc, comments); } catch (error) { throw new CollaborationError('CORRUPT_STATE', error instanceof Error ? error.message : 'Persisted collaboration state is invalid'); }
      const participants = new Map<NodeId, CollaborationParticipant>(value.participants.map(participant => [participant.identityId, participant])); const invitations = new Map(value.invitations.map(invitation => [invitation.id, invitation]));
      const object: StoredObject = { id: value.id, kind: value.kind, ...(value.spaceId ? { spaceId: value.spaceId } : {}), private: value.private, ownerId: value.ownerId, epoch: value.epoch, adapter, doc, comments, participants, invitations, pending: new Map(value.pending.map(pending => [pending.operationId, { ...pending, peers: new Set(pending.peers) }])), seen: new Set(), presence: new Map(), lastPresenceSent: new Map(), presenceTimers: new Map(), listeners: new Set(), lastSyncByPeer: new Map() };
      this.objects.set(object.id, object);
    }
    this.startFlushTimer();
  }

  private startFlushTimer(): void { const timer = setInterval(() => { void this.flush(); }, this.policy.autoFlushMs); this.flushTimer = timer; (timer as unknown as { unref?: () => void }).unref?.(); }

  private async queueUpdate(object: StoredObject, pending: PendingUpdate): Promise<void> {
    // A local-only object has no delivery obligation yet.  Its complete Yjs
    // state is already durable and a future invite/sync exchanges the current
    // state vector, so retaining one pending entry per historical edit would
    // turn normal offline local use into artificial outbox exhaustion.
    if (!pending.peers.size) { await this.persist(); this.emit({ objectId: object.id, target: pending.target, actor: this.identityId, operationId: pending.operationId, origin: 'local' }); return; }
    if (object.pending.size >= this.policy.maxPendingUpdates) throw new CollaborationError('OBJECT_LIMIT', 'Durable collaboration outbox bound exceeded');
    object.pending.set(pending.operationId, pending); await this.persist(); await this.tryPending(object, pending);
    this.emit({ objectId: object.id, target: pending.target, actor: this.identityId, operationId: pending.operationId, origin: 'local' });
  }

  private async tryPending(object: StoredObject, pending: PendingUpdate, onlyPeer?: NodeId): Promise<void> {
    if (pending.epoch !== object.epoch) return;
    const peers = [...pending.peers].filter(peer => !onlyPeer || peer === onlyPeer); if (!peers.length) return;
    pending.attempts += 1; pending.lastAttemptAt = this.now();
    for (const peer of peers) {
      try { await this.sendUpdate(object, peer, pending); pending.peers.delete(peer); } catch { /* retain durable update for a later reconnect/flush */ }
    }
    if (!pending.peers.size) object.pending.delete(pending.operationId);
  }

  private async sendUpdate(object: StoredObject, peer: NodeId, pending: PendingUpdate): Promise<void> {
    const plain = { version: 1 as const, protocol: COLLABORATION_PROTOCOL, kind: 'update' as const, objectId: object.id, epoch: pending.epoch, actor: pending.actor, operationId: pending.operationId, target: pending.target, update: pending.update };
    await this.sendWire(object, peer, plain);
  }

  private async sendInvitation(object: StoredObject, invitation: CollaborationInvitation): Promise<void> {
    const body = { version: 1 as const, protocol: COLLABORATION_PROTOCOL, kind: 'invite' as const, objectId: object.id, epoch: object.epoch, invitation, objectKind: object.kind, ...(object.spaceId ? { spaceId: object.spaceId } : {}), private: object.private, ownerId: object.ownerId, contentState: encodeBase64(Y.encodeStateAsUpdate(object.doc)), commentState: encodeBase64(Y.encodeStateAsUpdate(object.comments)) };
    await this.sendWire(object, invitation.invitee, body);
  }

  private async sendInviteAccept(object: StoredObject, invitation: CollaborationInvitation): Promise<void> {
    const body = { version: 1 as const, protocol: COLLABORATION_PROTOCOL, kind: 'invite.accept' as const, objectId: object.id, epoch: object.epoch, invitationId: invitation.id };
    await this.sendWire(object, invitation.inviter, body);
  }

  private async broadcastMembership(object: StoredObject): Promise<void> {
    const body = { version: 1 as const, protocol: COLLABORATION_PROTOCOL, kind: 'membership' as const, objectId: object.id, epoch: object.epoch, ownerId: object.ownerId, participants: [...object.participants.values()], invitations: [...object.invitations.values()], contentState: encodeBase64(Y.encodeStateAsUpdate(object.doc)), commentState: encodeBase64(Y.encodeStateAsUpdate(object.comments)) };
    for (const peer of [...object.participants.values()].filter(value => value.identityId !== this.identityId && value.status !== 'pending').map(value => value.identityId)) await this.sendWire(object, peer, body).catch(() => undefined);
  }

  private async requestSync(object: StoredObject, peer: NodeId): Promise<void> {
    const last = object.lastSyncByPeer.get(peer) ?? 0; if (this.now() - last < 1_000) return; object.lastSyncByPeer.set(peer, this.now());
    const body = { version: 1 as const, protocol: COLLABORATION_PROTOCOL, kind: 'sync.request' as const, objectId: object.id, epoch: object.epoch, stateVector: encodeBase64(Y.encodeStateVector(object.doc)), commentStateVector: encodeBase64(Y.encodeStateVector(object.comments)) };
    await this.sendWire(object, peer, body);
  }

  private async sendWire(object: StoredObject, peer: NodeId, plain: Record<string, unknown> & { objectId: string; epoch: number }): Promise<void> {
    const body = object.private ? await this.protect(object, peer, plain) : plain;
    const type = plain.kind === 'presence' ? PRESENCE_TYPE : `keystone.collaboration.${plain.kind}`;
    await this.sendPlain(peer, type, body);
  }

  private async protect(object: StoredObject, peer: NodeId, plain: Record<string, unknown> & { objectId: string; epoch: number }): Promise<ProtectedWire> {
    if (!this.cipher) throw new CollaborationError('PRIVATE_KEY_UNAVAILABLE', 'Private collaboration requires an E2E cipher');
    return { version: 1, protocol: COLLABORATION_PROTOCOL, kind: 'protected', objectId: object.id, epoch: object.epoch, protected: await this.cipher.seal({ objectId: object.id, sender: this.identityId, recipient: peer, epoch: object.epoch, value: plain }) };
  }

  private async sendPlain(peer: NodeId, type: string, body: unknown): Promise<void> {
    const unsigned = { version: 1 as const, type, id: randomId('collab-envelope'), sender: this.identityId, recipient: peer, nonce: randomId('collab-nonce'), expiresAt: new Date(this.now() + MAX_ENVELOPE_LIFETIME_MS).toISOString(), body };
    const envelope: Envelope = { ...unsigned, signature: await this.security.sign(unsigned) }; await this.delivery.connect(peer); await this.delivery.send(peer, envelope);
  }

  private async receive(envelope: Envelope): Promise<void> {
    try {
      await this.ready(); if (this.closed || envelope.recipient !== this.identityId || !envelope.type.startsWith('keystone.collaboration.')) return;
      if (Date.parse(envelope.expiresAt) <= this.now() || !(await this.security.verify(envelope))) { this.reject(); return; }
      const body = envelope.body; if (!isRecord(body) || body.protocol !== COLLABORATION_PROTOCOL || body.version !== 1 || typeof body.objectId !== 'string') { this.reject(); return; }
      let plain: Record<string, unknown>;
      if (body.kind === 'protected') {
        if (!this.cipher) { this.reject(); return; }
        const opened = await this.cipher.open({ objectId: body.objectId, sender: envelope.sender, recipient: this.identityId, epoch: Number(body.epoch), value: body.protected }); if (!isRecord(opened)) { this.reject(); return; } plain = opened;
      } else plain = body;
      if (plain.protocol !== COLLABORATION_PROTOCOL || plain.version !== 1 || plain.objectId !== body.objectId || typeof plain.kind !== 'string') { this.reject(); return; }
      if (plain.kind === 'invite') await this.receiveInvitation(envelope, plain); else if (plain.kind === 'invite.accept') await this.receiveInvitationAccept(envelope, plain); else if (plain.kind === 'membership') await this.receiveMembership(envelope, plain); else if (plain.kind === 'update') await this.receiveUpdate(envelope, plain); else if (plain.kind === 'sync.request') await this.receiveSyncRequest(envelope, plain); else if (plain.kind === 'sync.response') await this.receiveSyncResponse(envelope, plain); else if (plain.kind === 'presence') await this.receivePresence(envelope, plain); else { this.reject(); return; }
      this.accepted += 1;
    } catch { this.reject(); }
  }

  private async receiveInvitation(envelope: Envelope, body: Record<string, unknown>): Promise<void> {
    const invitation = isInvitation(body.invitation) ? body.invitation : undefined;
    if (!invitation || invitation.objectId !== body.objectId || invitation.inviter !== envelope.sender || invitation.invitee !== this.identityId || body.ownerId !== envelope.sender || body.objectKind !== invitation.objectKind || typeof body.contentState !== 'string' || typeof body.commentState !== 'string' || typeof body.private !== 'boolean' || !Number.isSafeInteger(body.epoch)) { this.reject(); return; }
    if (Date.parse(invitation.expiresAt) <= this.now()) return;
    if (body.private && !this.cipher) { this.reject(); return; }
    const objectId = body.objectId as string; const existing = this.objects.get(objectId);
    if (existing) { existing.invitations.set(invitation.id, invitation); await this.persist(); return; }
    const adapter = this.adapters.get(invitation.objectKind); if (!adapter) { this.reject(); return; }
    const doc = new Y.Doc(); const comments = new Y.Doc(); try { Y.applyUpdate(doc, decodeBase64Bounded(body.contentState, this.policy.maxObjectBytes)); Y.applyUpdate(comments, decodeBase64Bounded(body.commentState, this.policy.maxObjectBytes)); adapter.validate(doc); this.assertObjectSize(doc, comments); } catch { this.reject(); return; }
    const owner: CollaborationParticipant = { identityId: envelope.sender, role: 'owner', status: 'active', joinedAt: invitation.createdAt };
    const local: CollaborationParticipant = { identityId: this.identityId, role: invitation.role, status: 'pending', joinedAt: invitation.createdAt, invitationId: invitation.id };
    const object: StoredObject = { id: objectId, kind: invitation.objectKind as CollaborationObjectKind, ...(typeof body.spaceId === 'string' ? { spaceId: body.spaceId } : {}), private: body.private as boolean, ownerId: envelope.sender, epoch: Number(body.epoch), adapter, doc, comments, participants: new Map([[owner.identityId, owner], [local.identityId, local]]), invitations: new Map([[invitation.id, invitation]]), pending: new Map(), seen: new Set(), presence: new Map(), lastPresenceSent: new Map(), presenceTimers: new Map(), listeners: new Set(), lastSyncByPeer: new Map() };
    this.objects.set(object.id, object); await this.persist();
  }

  private async receiveInvitationAccept(envelope: Envelope, body: Record<string, unknown>): Promise<void> {
    const object = this.objects.get(body.objectId as string); if (!object || this.identityId !== object.ownerId || typeof body.invitationId !== 'string') { this.reject(); return; }
    const invitation = object.invitations.get(body.invitationId); if (!invitation || invitation.invitee !== envelope.sender || invitation.status !== 'pending' || Date.parse(invitation.expiresAt) <= this.now()) { this.reject(); return; }
    object.epoch += 1; object.invitations.set(invitation.id, { ...invitation, status: 'accepted' }); object.participants.set(invitation.invitee, { identityId: invitation.invitee, role: invitation.role, status: 'active', joinedAt: invitation.createdAt, invitationId: invitation.id }); await this.persist(); await this.broadcastMembership(object);
  }

  private async receiveMembership(envelope: Envelope, body: Record<string, unknown>): Promise<void> {
    const object = this.objects.get(body.objectId as string); if (!object || envelope.sender !== object.ownerId || body.ownerId !== object.ownerId || !Number.isSafeInteger(body.epoch) || (body.epoch as number) < object.epoch || !Array.isArray(body.participants) || !Array.isArray(body.invitations)) { this.reject(); return; }
    const participants = body.participants.filter(isParticipant); const invitations = body.invitations.filter(isInvitation); if (!participants.some(value => value.identityId === object.ownerId && value.role === 'owner' && value.status === 'active') || participants.length > this.policy.maxParticipants) { this.reject(); return; }
    object.epoch = body.epoch as number; object.participants.clear(); participants.forEach(value => object.participants.set(value.identityId, value)); object.invitations.clear(); invitations.forEach(value => object.invitations.set(value.id, value)); for (const pending of object.pending.values()) if (pending.epoch !== object.epoch) object.pending.delete(pending.operationId); await this.persist();
  }

  private async receiveUpdate(envelope: Envelope, body: Record<string, unknown>): Promise<void> {
    const object = this.objects.get(body.objectId as string); if (!object || !isNodeId(envelope.sender) || body.actor !== envelope.sender || !isNodeId(body.actor) || !['content', 'comments'].includes(String(body.target)) || typeof body.operationId !== 'string' || typeof body.update !== 'string' || body.epoch !== object.epoch) { if (object && body.epoch !== object.epoch) this.rejected += 1; this.reject(); return; }
    this.requireRemotePermission(object, envelope.sender, body.target === 'comments' ? 'comment' : 'edit'); if (object.seen.has(body.operationId)) { this.replayed += 1; return; }
    const update = decodeBase64Bounded(body.update, this.policy.maxUpdateBytes); try { if (body.target === 'comments') Y.applyUpdate(object.comments, update); else Y.applyUpdate(object.doc, update); if (body.target === 'comments') this.validateComments(object); else object.adapter.validate(object.doc); this.assertObjectSize(object.doc, object.comments); } catch { this.reject(); return; }
    object.seen.add(body.operationId); trimSet(object.seen, 20_000); await this.persist(); this.emit({ objectId: object.id, target: body.target as CollaborationUpdateTarget, actor: envelope.sender, operationId: body.operationId, origin: 'remote' });
  }

  private async receiveSyncRequest(envelope: Envelope, body: Record<string, unknown>): Promise<void> {
    const object = this.objects.get(body.objectId as string); if (!object || !isNodeId(envelope.sender) || (!this.isActive(object, envelope.sender) && !object.participants.has(envelope.sender)) || typeof body.stateVector !== 'string' || typeof body.commentStateVector !== 'string') { this.reject(); return; }
    const vector = decodeBase64Bounded(body.stateVector, this.policy.maxStateVectorBytes); const commentVector = decodeBase64Bounded(body.commentStateVector, this.policy.maxStateVectorBytes); const response = { version: 1 as const, protocol: COLLABORATION_PROTOCOL, kind: 'sync.response' as const, objectId: object.id, epoch: object.epoch, stateUpdate: encodeBase64(Y.encodeStateAsUpdate(object.doc, vector)), commentUpdate: encodeBase64(Y.encodeStateAsUpdate(object.comments, commentVector)), ownerId: object.ownerId, participants: [...object.participants.values()], invitations: [...object.invitations.values()] };
    await this.sendWire(object, envelope.sender, response).catch(() => undefined);
  }

  private async receiveSyncResponse(envelope: Envelope, body: Record<string, unknown>): Promise<void> {
    const object = this.objects.get(body.objectId as string); if (!object || !isNodeId(envelope.sender) || envelope.sender !== object.ownerId || !Number.isSafeInteger(body.epoch) || (body.epoch as number) < object.epoch || typeof body.stateUpdate !== 'string' || typeof body.commentUpdate !== 'string' || !Array.isArray(body.participants) || !Array.isArray(body.invitations)) { this.reject(); return; }
    const participants = body.participants.filter(isParticipant); if (!participants.length) { this.reject(); return; }
    object.epoch = body.epoch as number; object.participants.clear(); participants.forEach(value => object.participants.set(value.identityId, value)); object.invitations.clear(); body.invitations.filter(isInvitation).forEach(value => object.invitations.set(value.id, value)); for (const pending of object.pending.values()) if (pending.epoch !== object.epoch) object.pending.delete(pending.operationId);
    const local = object.participants.get(this.identityId); if (!local || local.status === 'revoked') { await this.persist(); return; }
    // A sync response is a state-vector delta, but unlike an individual live
    // update it may legitimately contain the complete bounded object after a
    // long offline interval.  Keep the object-level limit as the guard here;
    // the live update path remains bounded by maxUpdateBytes.
    try { Y.applyUpdate(object.doc, decodeBase64Bounded(body.stateUpdate, this.policy.maxObjectBytes)); Y.applyUpdate(object.comments, decodeBase64Bounded(body.commentUpdate, this.policy.maxObjectBytes)); object.adapter.validate(object.doc); this.validateComments(object); this.assertObjectSize(object.doc, object.comments); } catch { this.reject(); return; }
    await this.persist();
  }

  private async receivePresence(envelope: Envelope, body: Record<string, unknown>): Promise<void> {
    const object = this.objects.get(body.objectId as string); const presence = body.presence; if (!object || !isNodeId(envelope.sender) || body.epoch !== object.epoch || !this.isActive(object, envelope.sender) || !isPresence(presence) || presence.peerId !== envelope.sender || presence.objectId !== object.id || Date.parse(presence.expiresAt) <= this.now() || byteLength(JSON.stringify(body)) > this.policy.presenceMaxBytes || containsForbiddenPresenceFields(presence)) { this.presenceRejected += 1; this.reject(); return; }
    if (!object.presence.has(envelope.sender) && object.presence.size >= this.policy.maxPendingPresence) { this.presenceRejected += 1; this.reject(); return; }
    object.presence.set(envelope.sender, presence); this.prunePresenceState(object);
  }

  private expireInvitations(object: StoredObject): void { for (const invitation of object.invitations.values()) if (invitation.status === 'pending' && Date.parse(invitation.expiresAt) <= this.now()) object.invitations.set(invitation.id, { ...invitation, status: 'expired' }); }

  private prunePresenceState(object: StoredObject): void { for (const [peer, value] of object.presence) if (Date.parse(value.expiresAt) <= this.now()) object.presence.delete(peer); }

  private validateComments(object: StoredObject): void { const values = object.comments.getArray<string>('r0p81.comments').toArray(); if (values.length > this.policy.maxComments) throw new CollaborationError('OBJECT_LIMIT', 'Comment bound exceeded'); for (const value of values) { if (byteLength(value) > this.policy.maxCommentBytes || !isComment(JSON.parse(value))) throw new CollaborationError('MALFORMED_UPDATE', 'Comment update is malformed'); } }

  private assertObjectSize(doc: Y.Doc, comments: Y.Doc): void { if (Y.encodeStateAsUpdate(doc).byteLength + Y.encodeStateAsUpdate(comments).byteLength > this.policy.maxObjectBytes) throw new CollaborationError('OBJECT_LIMIT', 'Collaborative object exceeds its byte bound'); }

  private requireObject(objectId: string): StoredObject { assertObjectId(objectId); const object = this.objects.get(objectId); if (!object) throw new CollaborationError('NOT_FOUND', `Collaborative object ${objectId} was not found`); return object; }

  private requirePermission(object: StoredObject, action: CollaborationAction): void { const participant = object.participants.get(this.identityId); if (!participant || participant.status !== 'active') throw new CollaborationError('NOT_AUTHORIZED', 'Identity is not an active collaborator'); if (action === 'edit' && !['owner', 'editor'].includes(participant.role)) throw new CollaborationError('NOT_AUTHORIZED', 'Role cannot edit durable content'); if (action === 'comment' && participant.role === 'viewer') throw new CollaborationError('NOT_AUTHORIZED', 'Viewer cannot comment'); if (action === 'manage-members' && participant.role !== 'owner') throw new CollaborationError('NOT_AUTHORIZED', 'Only the owner manages collaborators'); }

  private requireRemotePermission(object: StoredObject, peer: NodeId, action: CollaborationAction): void { const participant = object.participants.get(peer); if (!participant || participant.status !== 'active' || (action === 'edit' && !['owner', 'editor'].includes(participant.role)) || (action === 'comment' && participant.role === 'viewer')) throw new CollaborationError('NOT_AUTHORIZED', 'Remote collaborator role cannot perform this action'); }

  private assertPendingCapacity(object: StoredObject): void { if (this.activePeers(object).length && object.pending.size >= this.policy.maxPendingUpdates) throw new CollaborationError('OBJECT_LIMIT', 'Durable collaboration outbox bound exceeded'); }

  private isActive(object: StoredObject, peer: NodeId): boolean { return object.participants.get(peer)?.status === 'active'; }
  private activePeers(object: StoredObject): NodeId[] { return [...object.participants.values()].filter(value => value.status === 'active' && value.identityId !== this.identityId).map(value => value.identityId); }

  private findInvitation(id: string): { readonly object: StoredObject; readonly invitation: CollaborationInvitation } | undefined { for (const object of this.objects.values()) { const invitation = object.invitations.get(id); if (invitation) return { object, invitation }; } return undefined; }

  private toInfo(object: StoredObject): CollaborationObjectInfo { return { id: object.id, kind: object.kind, ...(object.spaceId ? { spaceId: object.spaceId } : {}), private: object.private, epoch: object.epoch, ownerId: object.ownerId, participants: [...object.participants.values()].map(value => structuredClone(value)), invitations: [...object.invitations.values()].map(value => structuredClone(value)), pendingUpdates: object.pending.size }; }

  private emit(change: CollaborationChange): void { this.listeners.forEach(listener => listener(change)); this.objects.get(change.objectId)?.listeners.forEach(listener => listener(change)); }

  private reject(): void { this.rejected += 1; }

  private assertOpen(): void { if (this.closed) throw new CollaborationError('DELIVERY_UNAVAILABLE', 'CollaborationService is closed'); }

  private async persist(): Promise<void> { const objects: PersistedObject[] = []; for (const object of this.objects.values()) objects.push({ version: 1, id: object.id, kind: object.kind, ...(object.spaceId ? { spaceId: object.spaceId } : {}), private: object.private, ownerId: object.ownerId, epoch: object.epoch, contentState: encodeBase64(Y.encodeStateAsUpdate(object.doc)), commentState: encodeBase64(Y.encodeStateAsUpdate(object.comments)), participants: [...object.participants.values()], invitations: [...object.invitations.values()], pending: [...object.pending.values()].map(value => ({ operationId: value.operationId, target: value.target, objectId: value.objectId, epoch: value.epoch, actor: value.actor, update: value.update, peers: [...value.peers], attempts: value.attempts, lastAttemptAt: value.lastAttemptAt })) }); await this.store.write({ version: 1, objects }); }
}

export function renderSafeCommentText(value: string): string { return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }

function normalizePolicy(input: Partial<CollaborationPolicy> | undefined): CollaborationPolicy {
  const merged = { ...DEFAULT_COLLABORATION_POLICY, ...(input ?? {}) };
  for (const key of Object.keys(DEFAULT_COLLABORATION_POLICY) as (keyof CollaborationPolicy)[]) if (!Number.isSafeInteger(merged[key]) || merged[key] <= 0) throw new CollaborationError('INVALID_ARGUMENT', `Collaboration policy ${key} is invalid`);
  return merged;
}

function normalizeTextSnapshot(value: TextDocumentSnapshot): TextDocumentSnapshot { if (!value || value.version !== 1) throw new CollaborationError('INVALID_EDIT', 'Text document snapshot version is invalid'); return { version: 1, title: boundedText(value.title, 512, 'title'), content: boundedText(value.content, 2 * 1024 * 1024, 'content'), metadata: normalizeMetadata(value.metadata) }; }
function normalizeMetadata(value: unknown): Readonly<Record<string, string | number | boolean>> { if (!isRecord(value)) throw new CollaborationError('INVALID_EDIT', 'Metadata is invalid'); const result: Record<string, string | number | boolean> = {}; for (const [key, item] of Object.entries(value)) { if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(key) || !['string', 'number', 'boolean'].includes(typeof item) || (typeof item === 'string' && item.length > 4_096) || (typeof item === 'number' && !Number.isFinite(item))) throw new CollaborationError('INVALID_EDIT', 'Metadata value is invalid'); result[key] = item as string | number | boolean; } return result; }
function readMetadata(meta: Y.Map<unknown>): Record<string, string | number | boolean> { try { return { ...normalizeMetadata(JSON.parse(String(meta.get('metadata') ?? '{}'))) }; } catch { return {}; } }
function boundedText(value: string, maxBytes: number, field: string): string { if (typeof value !== 'string' || byteLength(value) > maxBytes) throw new CollaborationError('INVALID_EDIT', `${field} exceeds its bound`); return value; }
function assertIndex(index: number, length: number): void { if (!Number.isSafeInteger(index) || index < 0 || index > length) throw new CollaborationError('INVALID_EDIT', 'Text index is invalid'); }
function sanitizeCommentText(value: string, maxBytes: number): string { if (typeof value !== 'string') throw new CollaborationError('INVALID_ARGUMENT', 'Comment must be text'); const normalized = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').trim(); if (!normalized || byteLength(normalized) > maxBytes) throw new CollaborationError('INVALID_ARGUMENT', 'Comment text is invalid'); return normalized; }
function makePresence(object: StoredObject, peerId: NodeId, input: { readonly status?: CollaborationPresence['status']; readonly cursor?: { readonly anchor: number; readonly head: number }; readonly selection?: readonly string[] }, now: number, policy: CollaborationPolicy): CollaborationPresence { const cursor = input.cursor && Number.isSafeInteger(input.cursor.anchor) && Number.isSafeInteger(input.cursor.head) && input.cursor.anchor >= 0 && input.cursor.head >= 0 ? { anchor: Math.min(input.cursor.anchor, 10_000_000), head: Math.min(input.cursor.head, 10_000_000) } : undefined; const selection = input.selection?.filter(value => typeof value === 'string' && value.length <= 256).slice(0, 256); const value: CollaborationPresence = { version: 1, objectId: object.id, peerId, epoch: object.epoch, ...(input.status ? { status: input.status } : {}), ...(cursor ? { cursor } : {}), ...(selection?.length ? { selection } : {}), updatedAt: new Date(now).toISOString(), expiresAt: new Date(now + policy.presenceTtlMs).toISOString() }; if (containsForbiddenPresenceFields(value) || byteLength(JSON.stringify(value)) > policy.presenceMaxBytes) throw new CollaborationError('PRESENCE_REJECTED', 'Presence payload is invalid'); return value; }
function containsForbiddenPresenceFields(value: unknown): boolean { if (!isRecord(value)) return true; return Object.keys(value).some(key => /location|latitude|longitude|lat|lon|gps|address|route/i.test(key)); }
function isComment(value: unknown): value is CollaborationComment { return isRecord(value) && value.version === 1 && typeof value.id === 'string' && typeof value.objectId === 'string' && typeof value.authorId === 'string' && typeof value.body === 'string' && typeof value.createdAt === 'string' && typeof value.resolved === 'boolean'; }
function isParticipant(value: unknown): value is CollaborationParticipant { return isRecord(value) && typeof value.identityId === 'string' && ['owner', 'editor', 'commenter', 'viewer'].includes(String(value.role)) && ['active', 'pending', 'revoked'].includes(String(value.status)) && typeof value.joinedAt === 'string' && (!value.expiresAt || typeof value.expiresAt === 'string') && (!value.invitationId || typeof value.invitationId === 'string'); }
function isInvitation(value: unknown): value is CollaborationInvitation { return isRecord(value) && value.version === 1 && typeof value.id === 'string' && typeof value.objectId === 'string' && typeof value.objectKind === 'string' && typeof value.inviter === 'string' && typeof value.invitee === 'string' && ['editor', 'commenter', 'viewer'].includes(String(value.role)) && typeof value.createdAt === 'string' && typeof value.expiresAt === 'string' && ['pending', 'accepted', 'expired', 'revoked'].includes(String(value.status)); }
function isPresence(value: unknown): value is CollaborationPresence { return isRecord(value) && value.version === 1 && typeof value.objectId === 'string' && typeof value.peerId === 'string' && Number.isSafeInteger(value.epoch) && typeof value.updatedAt === 'string' && typeof value.expiresAt === 'string' && (!value.status || ['active', 'idle', 'editing'].includes(String(value.status))) && (!value.cursor || (isRecord(value.cursor) && Number.isSafeInteger(value.cursor.anchor) && Number.isSafeInteger(value.cursor.head))) && (!value.selection || Array.isArray(value.selection)); }
function isPersistedObject(value: unknown): value is PersistedObject { return isRecord(value) && value.version === 1 && typeof value.id === 'string' && typeof value.kind === 'string' && typeof value.private === 'boolean' && typeof value.ownerId === 'string' && Number.isSafeInteger(value.epoch) && typeof value.contentState === 'string' && typeof value.commentState === 'string' && Array.isArray(value.participants) && Array.isArray(value.invitations) && Array.isArray(value.pending) && value.participants.every(isParticipant) && value.invitations.every(isInvitation) && value.pending.every(isPersistedPending); }
function isPersistedPending(value: unknown): value is PersistedPendingUpdate { return isRecord(value) && typeof value.operationId === 'string' && ['content', 'comments'].includes(String(value.target)) && typeof value.objectId === 'string' && Number.isSafeInteger(value.epoch) && typeof value.actor === 'string' && typeof value.update === 'string' && Array.isArray(value.peers) && value.peers.every(value => typeof value === 'string') && Number.isSafeInteger(value.attempts) && Number.isFinite(value.lastAttemptAt); }
function isWorkItemStatus(value: unknown): value is WorkItemStatus { return ['BACKLOG', 'TODO', 'READY', 'RUNNING', 'BLOCKED', 'NEEDS_USER', 'PAUSED', 'REVIEW', 'DONE', 'FAILED', 'CANCELLED'].includes(String(value)); }
function isNodeId(value: unknown): value is NodeId { return typeof value === 'string' && value.length > 0 && value.length <= 256; }
function isRecord(value: unknown): value is Record<string, any> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function assertObjectId(value: string): void { if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value)) throw new CollaborationError('INVALID_ARGUMENT', 'Collaboration object id is invalid'); }
function randomId(prefix: string): string { const id = globalThis.crypto?.randomUUID?.(); if (!id) throw new CollaborationError('INVALID_ARGUMENT', 'Secure randomness is unavailable'); return `${prefix}-${id}`; }
function nowIso(now: () => number): string { return new Date(now()).toISOString(); }
function byteLength(value: string): number { return new TextEncoder().encode(value).byteLength; }
function encodeBase64(value: Uint8Array): string { let binary = ''; for (const byte of value) binary += String.fromCharCode(byte); return globalThis.btoa(binary); }
function decodeBase64(value: string): Uint8Array { if (typeof value !== 'string' || value.length > 16 * 1024 * 1024) throw new CollaborationError('MALFORMED_UPDATE', 'Base64 payload is too large'); try { const binary = globalThis.atob(value); const output = new Uint8Array(binary.length); for (let index = 0; index < binary.length; index += 1) output[index] = binary.charCodeAt(index); return output; } catch { throw new CollaborationError('MALFORMED_UPDATE', 'Base64 payload is invalid'); } }
function decodeBase64Bounded(value: string, maxBytes: number): Uint8Array { const output = decodeBase64(value); if (output.byteLength > maxBytes) throw new CollaborationError('MALFORMED_UPDATE', 'Binary collaboration payload exceeds its bound'); return output; }
function trimSet(set: Set<string>, max: number): void { while (set.size > max) set.delete(set.values().next().value as string); }
