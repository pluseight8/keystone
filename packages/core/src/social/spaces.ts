/**
 * Keystone Shared Spaces.
 *
 * This module is intentionally additive: it uses Yjs for the durable shared
 * document, but does not change the generic CRDT adapter.  Every update is
 * wrapped in a signed, permission-checked Keystone envelope.  Private spaces
 * add an explicit epoch key protocol; this is group encryption, not a claim of
 * MLS, Double Ratchet or forward secrecy.
 */
import * as Y from 'yjs';
import { canonicalJson, type CryptoProvider } from '../crypto.js';
import type { DeviceSessionKeys } from '../identity.js';
import type { Envelope, EnvelopeSecurity, UnsignedEnvelope } from '../connectivity.js';
import type { KeystoneDeliveryInterface } from '../connectivity.js';
import type { NodeId } from '../types.js';
import type { AIDataClass } from '../ai/privacy.js';
import type { EncryptedSocialStateStore } from './storage.js';
import { SafetyRuntime, SafetySurfaceGate } from '../security/content-safety.js';
import { MandatorySafetySurfaceRegistry } from '../security/safety-surfaces.js';
import { FileContainmentService, type QuarantineEntry } from '../security/untrusted-content.js';
import { sha256 } from './content.js';

export const SHARED_SPACE_VERSION = 1 as const;
export const SHARED_SPACE_PROTOCOL = 'keystone.shared-space.v1' as const;
export const SHARED_SPACE_ENVELOPE = 'social.shared_space';
export const SHARED_SPACE_MAX_LIFETIME_MS = 10 * 60_000;
export const SHARED_SPACE_MAX_OBJECT_BYTES = 512 * 1024;
export const SHARED_SPACE_MAX_SEEN = 16_384;
export const SHARED_SPACE_MAX_ACTIVITY = 4_096;

export type SharedSpaceVisibility = 'public' | 'private';
export type SharedSpaceMemberKind = 'human' | 'agent';
export type SharedSpaceRole = 'owner' | 'admin' | 'editor' | 'commenter' | 'viewer' | 'agent';
export type SharedTaskStatus = 'todo' | 'in_progress' | 'done' | 'cancelled';

export const SHARED_SPACE_PERMISSIONS = [
  'space.read', 'space.write', 'document.read', 'document.write',
  'note.read', 'note.write', 'task.read', 'task.write', 'task.assign',
  'file.reference', 'comment.write', 'link.write', 'context.share',
  'member.manage', 'agent.participate', 'activity.read',
] as const;
export type SharedSpacePermission = (typeof SHARED_SPACE_PERMISSIONS)[number];

export interface SharedSpaceMember {
  readonly identityId: NodeId;
  readonly kind: SharedSpaceMemberKind;
  readonly agentId?: string;
  readonly role: SharedSpaceRole;
  readonly permissions?: readonly SharedSpacePermission[];
  readonly joinedAt: string;
  readonly removedAt?: string;
}

export interface SpaceAgentGrant {
  readonly id: string;
  readonly agentId: string;
  readonly identityId: NodeId;
  readonly permissions: readonly SharedSpacePermission[];
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly maxUses: number;
  readonly used: number;
  readonly revoked: boolean;
}

export interface SharedSpace {
  readonly version: 1;
  readonly id: string;
  readonly owner: NodeId;
  readonly title: string;
  readonly description: string;
  readonly visibility: SharedSpaceVisibility;
  readonly members: readonly SharedSpaceMember[];
  readonly agentGrants: readonly SpaceAgentGrant[];
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly signature: string;
}

export interface SharedDocument {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly createdBy: NodeId;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
}

export interface SharedNote {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly createdBy: NodeId;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
}

export interface TaskList {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly createdBy: NodeId;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SharedTask {
  readonly id: string;
  readonly listId: string;
  readonly title: string;
  readonly description?: string;
  readonly status: SharedTaskStatus;
  readonly assignee?: NodeId;
  readonly createdBy: NodeId;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
}

export interface WorkspaceFileReference {
  readonly id: string;
  readonly fileId: string;
  readonly contentId?: string;
  readonly contentUri?: string;
  readonly filename?: string;
  readonly mimeType?: string;
  readonly size?: number;
  readonly visibility: SharedSpaceVisibility;
  readonly sharedBy: NodeId;
  readonly createdAt: string;
}

export interface WorkspaceComment {
  readonly id: string;
  readonly objectId: string;
  readonly text: string;
  readonly author: NodeId;
  readonly createdAt: string;
  readonly replyTo?: string;
  readonly tombstone?: boolean;
}

export interface SharedLink {
  readonly id: string;
  readonly url: string;
  readonly title?: string;
  readonly description?: string;
  readonly addedBy: NodeId;
  readonly createdAt: string;
}

export interface SharedContextPublication {
  readonly id: string;
  readonly sourceId: string;
  readonly kind: string;
  readonly value: unknown;
  readonly dataClass: 'PUBLIC' | 'USER_EXPLICIT';
  readonly sharedBy: NodeId;
  readonly createdAt: string;
}

export interface SpaceActivityEvent {
  readonly id: string;
  readonly spaceId: string;
  readonly actor: NodeId;
  readonly agentId?: string;
  readonly action: string;
  readonly objectId?: string;
  readonly at: string;
  readonly dataClass?: 'PUBLIC' | 'USER_EXPLICIT';
}

export interface SharedSpaceStateStore {
  read(): Promise<unknown | undefined>;
  write(value: unknown): Promise<void>;
}

export class InMemorySharedSpaceStateStore implements SharedSpaceStateStore {
  private value?: unknown;
  async read(): Promise<unknown | undefined> { return this.value === undefined ? undefined : structuredClone(this.value); }
  async write(value: unknown): Promise<void> { this.value = structuredClone(value); }
}

/** Encrypts the complete workspace snapshot with the host device key. */
export class PersistentSharedSpaceStateStore implements SharedSpaceStateStore {
  private value?: { version: 1; nonce: string; ciphertext: string };
  private loading?: Promise<void>;
  private writes: Promise<void> = Promise.resolve();
  private readonly sodium = loadSodium();
  constructor(private readonly backend: EncryptedSocialStateStore, private readonly local: DeviceSessionKeys) {}
  async read(): Promise<unknown | undefined> {
    await this.load();
    if (!this.value) return undefined;
    const sodium = await this.sodium;
    try {
      const plaintext = sodium.crypto_secretbox_open_easy(decode(this.value.ciphertext), decode(this.value.nonce), await this.storageKey(sodium));
      return JSON.parse(new TextDecoder().decode(plaintext));
    } catch { throw new Error('Shared Space snapshot authentication failed'); }
  }
  async write(value: unknown): Promise<void> {
    const sodium = await this.sodium;
    const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
    const ciphertext = sodium.crypto_secretbox_easy(JSON.stringify(value), nonce, await this.storageKey(sodium));
    const next = { version: 1 as const, nonce: encode(nonce), ciphertext: encode(ciphertext) };
    const operation = this.writes.then(() => this.backend.write(next));
    this.writes = operation.catch(() => undefined);
    await operation; this.value = next;
  }
  private async load(): Promise<void> {
    if (this.value || this.loading) return this.loading ?? Promise.resolve();
    this.loading = this.backend.read().then(value => {
      if (value === undefined) return;
      if (!value || typeof value !== 'object' || (value as { version?: unknown }).version !== 1 || typeof (value as { nonce?: unknown }).nonce !== 'string' || typeof (value as { ciphertext?: unknown }).ciphertext !== 'string') throw new Error('Invalid Shared Space snapshot');
      this.value = value as { version: 1; nonce: string; ciphertext: string };
    });
    return this.loading;
  }
  private async storageKey(sodium: any): Promise<Uint8Array> { return sodium.crypto_generichash(32, sodium.from_string('keystone:shared-space-state:v1'), decode(this.local.encryptionPrivateKey)); }
}

export interface SharedSpaceServiceOptions {
  readonly transport: KeystoneDeliveryInterface;
  readonly crypto: CryptoProvider;
  readonly security: EnvelopeSecurity;
  readonly local: DeviceSessionKeys;
  readonly storage?: SharedSpaceStateStore;
  readonly peers?: readonly DeviceSessionKeys[];
  readonly localAgentId?: string;
  readonly now?: () => number;
  readonly onActivity?: (event: SpaceActivityEvent) => void | Promise<void>;
  readonly protectedSurfaces?: MandatorySafetySurfaceRegistry;
  /** Shared bytes are materialized through the R0P59 quarantine boundary. */
  readonly containment?: FileContainmentService;
}

export interface SharedSpaceSnapshot {
  readonly version: 1;
  /**
   * Runtime epoch keys are never part of the snapshot.  A private space only
   * persists an authenticated ciphertext produced with the local device
   * encryption key; the plaintext key remains a runtime-only value.
   */
  readonly spaces: readonly (SharedSpace & {
    readonly privateEpoch?: number;
    readonly privateKeyId?: string;
    readonly epochSecretNonce?: string;
    readonly epochSecretCiphertext?: string;
  })[];
  readonly documents: readonly { spaceId: string; state: string }[];
  readonly pending: readonly SharedSpacePendingMessage[];
  readonly seen: readonly string[];
  readonly activity: readonly SpaceActivityEvent[];
}

export interface SharedSpacePendingMessage { readonly peer: NodeId; readonly body: SpaceMessage; }

interface SpaceRecord {
  space: SharedSpace;
  document: Y.Doc;
  privateKey?: string;
  privateEpoch?: number;
  privateKeyId?: string;
}

type SpaceMessage =
  | { readonly kind: 'space'; readonly space: SharedSpace }
  | { readonly kind: 'membership'; readonly spaceId: string; readonly eventId: string; readonly actor: NodeId; readonly action: 'add' | 'remove' | 'agent_grant' | 'agent_revoke'; readonly member?: SharedSpaceMember; readonly memberKey?: string; readonly removed?: boolean; readonly revision: number; readonly signature: string; readonly space?: SharedSpace }
  | { readonly kind: 'key_update'; readonly spaceId: string; readonly actor: NodeId; readonly recipient: NodeId; readonly epoch: number; readonly previousEpoch: number; readonly keyId: string; readonly nonce: string; readonly ciphertext: string; readonly metadataNonce: string; readonly metadataCiphertext: string; readonly signature: string }
  | { readonly kind: 'crdt'; readonly spaceId: string; readonly actor: NodeId; readonly agentId?: string; readonly opId: string; readonly epoch?: number; readonly keyId?: string; readonly nonce?: string; readonly ciphertext?: string; readonly update?: string; readonly signature: string }
  | { readonly kind: 'sync_request'; readonly spaceId: string; readonly stateVector?: string }
  | { readonly kind: 'sync_state'; readonly spaceId: string; readonly epoch?: number; readonly keyId?: string; readonly nonce?: string; readonly ciphertext?: string; readonly update?: string; readonly signature: string };

export class SharedSpaceError extends Error {
  constructor(readonly code: SharedSpaceErrorCode, message: string) { super(message); this.name = 'SharedSpaceError'; }
}
export type SharedSpaceErrorCode = 'INVALID_ARGUMENT' | 'INVALID_SIGNATURE' | 'NOT_AUTHORIZED' | 'NOT_FOUND' | 'REPLAY' | 'PRIVATE_KEY_UNAVAILABLE' | 'INVALID_EPOCH' | 'UNSHAREABLE_DATA' | 'TRANSPORT' | 'INVALID_STATE';

export class SharedSpaceService {
  private readonly transport: KeystoneDeliveryInterface;
  private readonly crypto: CryptoProvider;
  private readonly security: EnvelopeSecurity;
  private readonly local: DeviceSessionKeys;
  private readonly storage: SharedSpaceStateStore;
  private readonly peers = new Map<NodeId, DeviceSessionKeys>();
  private readonly now: () => number;
  private readonly localAgentId?: string;
  private readonly protectedSurfaces: MandatorySafetySurfaceRegistry;
  private readonly containment: FileContainmentService;
  private readonly records = new Map<string, SpaceRecord>();
  /**
   * Read-side proof cache for CRDT objects.  A remote update is not allowed to
   * become visible merely because its envelope was authenticated: every
   * materialized object must have passed the mandatory Shared Space gate.
   */
  private readonly safeObjectIds = new Map<string, Set<string>>();
  private readonly pending: SharedSpacePendingMessage[] = [];
  private readonly seen = new Set<string>();
  private readonly activityEntries: SpaceActivityEvent[] = [];
  private readonly pendingRequests = new Map<string, { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private readonly unsubscribe: () => void;
  private writes: Promise<void> = Promise.resolve();
  private inbound: Promise<void> = Promise.resolve();
  private readyPromise: Promise<void>;
  private closed = false;
  private rejected = 0;
  private accepted = 0;

  constructor(options: SharedSpaceServiceOptions) {
    this.transport = options.transport; this.crypto = options.crypto; this.security = options.security; this.local = options.local;
    this.storage = options.storage ?? new InMemorySharedSpaceStateStore(); this.now = options.now ?? (() => Date.now()); this.localAgentId = options.localAgentId;
    this.protectedSurfaces = options.protectedSurfaces ?? new MandatorySafetySurfaceRegistry(new SafetySurfaceGate(new SafetyRuntime())); this.containment = options.containment ?? new FileContainmentService();
    for (const peer of options.peers ?? []) this.peers.set(peer.nodeId, peer); this.peers.set(this.local.nodeId, this.local);
    this.unsubscribe = this.transport.onMessage(envelope => { this.inbound = this.inbound.then(() => this.receive(envelope)).catch(() => { this.rejected += 1; }); });
    this.readyPromise = this.hydrate();
    this.onActivity = options.onActivity;
  }
  private readonly onActivity?: SharedSpaceServiceOptions['onActivity'];

  async ready(): Promise<void> { await this.readyPromise; }
  close(): void { this.closed = true; this.unsubscribe(); for (const value of this.pendingRequests.values()) { clearTimeout(value.timer); value.reject(new SharedSpaceError('TRANSPORT', 'Shared Space service closed')); } this.pendingRequests.clear(); }
  stats(): { accepted: number; rejected: number; pending: number; spaces: number } { return { accepted: this.accepted, rejected: this.rejected, pending: this.pending.length, spaces: this.records.size }; }
  audit(): readonly SpaceActivityEvent[] { return this.activityEntries.map(clone); }
  listSpaces(): readonly SharedSpace[] { return [...this.records.values()].map(value => clone(value.space)); }
  getSpace(spaceId: string): SharedSpace | undefined { return this.records.get(spaceId) ? clone(this.records.get(spaceId)!.space) : undefined; }
  listActivities(spaceId: string): readonly SpaceActivityEvent[] { return this.activityEntries.filter(value => value.spaceId === spaceId).map(clone); }
  registerPeer(peer: DeviceSessionKeys): void { this.peers.set(peer.nodeId, peer); }
  pendingCount(): number { return this.pending.length; }
  rejectionCount(): number { return this.rejected; }

  async createSpace(input: { title: string; description?: string; visibility?: SharedSpaceVisibility; members?: readonly { identityId: NodeId; role?: Exclude<SharedSpaceRole, 'owner'>; permissions?: readonly SharedSpacePermission[] }[] }): Promise<SharedSpace> {
    await this.ready();
    if (!input.title?.trim() || input.title.length > 200 || (input.description ?? '').length > 4_000) throw new SharedSpaceError('INVALID_ARGUMENT', 'Invalid Shared Space title or description');
    const createdAt = iso(this.now()); const id = randomId();
    const members = uniqueMembers([{ identityId: this.local.nodeId, kind: 'human', role: 'owner', joinedAt: createdAt }, ...(input.members ?? []).map(value => ({ identityId: value.identityId, kind: 'human' as const, role: value.role ?? 'viewer' as const, ...(value.permissions ? { permissions: normalizePermissions(value.permissions) } : {}), joinedAt: createdAt }))]);
    for (const member of members) if (!this.peers.has(member.identityId)) throw new SharedSpaceError('INVALID_ARGUMENT', `Unknown member device: ${member.identityId}`);
    const unsigned = { version: 1 as const, id, owner: this.local.nodeId, title: input.title.trim(), description: input.description?.trim() ?? '', visibility: input.visibility ?? 'public', members, agentGrants: [] as readonly SpaceAgentGrant[], revision: 1, createdAt, updatedAt: createdAt };
    const space: SharedSpace = { ...unsigned, signature: await this.crypto.sign(canonicalJson(unsigned), this.local.privateKey) };
    if (!await this.surfaceEligible(space.id, space)) throw new SharedSpaceError('UNSHAREABLE_DATA', 'Shared Space metadata failed SafetySurfaceGate');
    const record: SpaceRecord = { space, document: this.newDocument(id) };
    if (space.visibility === 'private') { const key = await randomBytes(32); record.privateKey = encode(key); record.privateEpoch = 1; record.privateKeyId = await this.crypto.hash(`${id}:1:${record.privateKey}`); }
    this.safeObjectIds.set(id, new Set());
    this.records.set(id, record); await this.persist(); await this.activity(id, 'space.created', id); return clone(space);
  }

  async publish(spaceId: string, peers?: readonly NodeId[]): Promise<void> {
    await this.ready(); const record = this.requireRecord(spaceId); this.assertReadable(record);
    const recipients = peers ?? record.space.members.filter(member => member.identityId !== this.local.nodeId && !member.removedAt).map(member => member.identityId);
    for (const peer of recipients) { if (!record.space.members.some(member => member.identityId === peer && !member.removedAt)) throw new SharedSpaceError('NOT_AUTHORIZED', 'Space recipient is not an active member'); await this.sendCurrent(peer, record); }
    await this.flushPending();
  }

  async sync(spaceId: string, peer: NodeId): Promise<void> {
    await this.ready(); const record = this.requireRecord(spaceId); this.assertReadable(record);
    const stateVector = encode(Y.encodeStateVector(record.document));
    await this.send(peer, { kind: 'sync_request', spaceId, stateVector }); await this.flushPending(peer);
  }

  async flushPending(peer?: NodeId): Promise<void> {
    await this.ready(); if (!this.pending.length) return;
    const queued = this.pending.splice(0); const keep: SharedSpacePendingMessage[] = [];
    for (const item of queued) { if (peer && item.peer !== peer) { keep.push(item); continue; } try { await this.send(item.peer, item.body); } catch { keep.push(item); } }
    this.pending.unshift(...keep.slice(0, 4096)); await this.persist();
  }

  async addMember(spaceId: string, member: { identityId: NodeId; role?: Exclude<SharedSpaceRole, 'owner'>; permissions?: readonly SharedSpacePermission[] }): Promise<SharedSpace> {
    await this.ready(); const record = this.requireRecord(spaceId); this.assertPermission(record, 'member.manage'); if (record.space.owner !== this.local.nodeId) throw new SharedSpaceError('NOT_AUTHORIZED', 'Only the owner may add members');
    if (!this.peers.has(member.identityId)) throw new SharedSpaceError('INVALID_ARGUMENT', 'Unknown member device'); if (record.space.members.some(value => value.identityId === member.identityId && !value.removedAt)) throw new SharedSpaceError('INVALID_ARGUMENT', 'Member already exists');
    const now = iso(this.now()); const nextMember: SharedSpaceMember = { identityId: member.identityId, kind: 'human', role: member.role ?? 'viewer', ...(member.permissions ? { permissions: normalizePermissions(member.permissions) } : {}), joinedAt: now };
    const next = await this.updateSpace(record, { members: [...record.space.members.filter(value => !(value.identityId === member.identityId && value.removedAt)), nextMember] });
    await this.membershipBroadcast(record, 'add', nextMember, next); return clone(next);
  }

  async removeMember(spaceId: string, identityId: NodeId): Promise<SharedSpace> {
    await this.ready(); const record = this.requireRecord(spaceId); this.assertPermission(record, 'member.manage'); if (record.space.owner !== this.local.nodeId || identityId === record.space.owner) throw new SharedSpaceError('NOT_AUTHORIZED', 'Only the owner may remove a protected member');
    const current = record.space.members.find(value => value.identityId === identityId && !value.removedAt); if (!current) throw new SharedSpaceError('NOT_FOUND', 'Member not found');
    const nextMember: SharedSpaceMember = { ...current, removedAt: iso(this.now()) }; const next = await this.updateSpace(record, { members: record.space.members.map(value => value.identityId === identityId ? nextMember : value) });
    await this.membershipBroadcast(record, 'remove', nextMember, next); return clone(next);
  }
  /** Explicit names keep moderation/device callers readable; all paths use the same signed removal + epoch rotation. */
  async kickMember(spaceId: string, identityId: NodeId): Promise<SharedSpace> { return this.removeMember(spaceId, identityId); }
  async banMember(spaceId: string, identityId: NodeId): Promise<SharedSpace> { return this.removeMember(spaceId, identityId); }
  async revokeDevice(spaceId: string, identityId: NodeId): Promise<SharedSpace> { return this.removeMember(spaceId, identityId); }

  async grantAgent(spaceId: string, input: { agentId: string; identityId: NodeId; permissions: readonly SharedSpacePermission[]; expiresAt?: string; maxUses?: number }): Promise<SpaceAgentGrant> {
    await this.ready(); const record = this.requireRecord(spaceId); this.assertPermission(record, 'member.manage'); if (!safeId(input.agentId) || !this.peers.has(input.identityId)) throw new SharedSpaceError('INVALID_ARGUMENT', 'Invalid agent grant');
    const now = iso(this.now()); const expiresAt = input.expiresAt ?? new Date(this.now() + SHARED_SPACE_MAX_LIFETIME_MS).toISOString(); if (!validExpiry(expiresAt, this.now())) throw new SharedSpaceError('INVALID_ARGUMENT', 'Invalid agent grant expiry');
    const grant: SpaceAgentGrant = { id: randomId(), agentId: input.agentId, identityId: input.identityId, permissions: normalizePermissions(input.permissions), issuedAt: now, expiresAt, maxUses: Math.max(1, Math.min(10_000, input.maxUses ?? 100)), used: 0, revoked: false };
    const next = await this.updateSpace(record, { agentGrants: [...record.space.agentGrants.filter(value => !(value.identityId === grant.identityId && value.agentId === grant.agentId && !value.revoked)), grant] });
    await this.membershipBroadcast(record, 'agent_grant', undefined, next); return clone(next.agentGrants.find(value => value.id === grant.id)!);
  }

  async revokeAgent(spaceId: string, agentId: string, identityId: NodeId): Promise<SharedSpace> {
    await this.ready(); const record = this.requireRecord(spaceId); this.assertPermission(record, 'member.manage');
    const grant = record.space.agentGrants.find(value => value.agentId === agentId && value.identityId === identityId && !value.revoked); if (!grant) throw new SharedSpaceError('NOT_FOUND', 'Agent grant not found');
    const next = await this.updateSpace(record, { agentGrants: record.space.agentGrants.map(value => value.id === grant.id ? { ...value, revoked: true } : value) });
    await this.membershipBroadcast(record, 'agent_revoke', undefined, next); return clone(next);
  }

  async createDocument(spaceId: string, input: { title: string; body?: string }): Promise<SharedDocument> { return this.createCrdtObject<SharedDocument>(spaceId, 'documents', { id: await this.objectId(spaceId, 'document'), title: input.title, body: input.body ?? '' }); }
  async updateDocument(spaceId: string, id: string, patch: Partial<Pick<SharedDocument, 'title' | 'body'>>): Promise<SharedDocument> { return this.updateCrdtObject<SharedDocument>(spaceId, 'documents', id, patch); }
  async createNote(spaceId: string, input: { title: string; body?: string }): Promise<SharedNote> { return this.createCrdtObject<SharedNote>(spaceId, 'notes', { id: await this.objectId(spaceId, 'note'), title: input.title, body: input.body ?? '' }); }
  async updateNote(spaceId: string, id: string, patch: Partial<Pick<SharedNote, 'title' | 'body'>>): Promise<SharedNote> { return this.updateCrdtObject<SharedNote>(spaceId, 'notes', id, patch); }
  async createTaskList(spaceId: string, input: { title: string; description?: string }): Promise<TaskList> { return this.createCrdtObject<TaskList>(spaceId, 'taskLists', { id: await this.objectId(spaceId, 'task-list'), title: input.title, description: input.description }); }
  async createTask(spaceId: string, input: { listId: string; title: string; description?: string; assignee?: NodeId }): Promise<SharedTask> { return this.createCrdtObject<SharedTask>(spaceId, 'tasks', { id: await this.objectId(spaceId, 'task'), listId: input.listId, title: input.title, description: input.description, status: 'todo', ...(input.assignee ? { assignee: input.assignee } : {}) }); }
  async updateTask(spaceId: string, id: string, patch: Partial<Pick<SharedTask, 'title' | 'description' | 'status' | 'assignee'>>): Promise<SharedTask> { await this.ready(); const record = this.requireRecord(spaceId); this.assertPermission(record, 'task.write'); if (Object.prototype.hasOwnProperty.call(patch, 'assignee')) this.assertPermission(record, 'task.assign'); return this.updateCrdtObject<SharedTask>(spaceId, 'tasks', id, patch); }
  async attachFileReference(spaceId: string, input: Omit<WorkspaceFileReference, 'id' | 'sharedBy' | 'createdAt'>): Promise<WorkspaceFileReference> { return this.createCrdtObject<WorkspaceFileReference>(spaceId, 'files', { ...input, id: await this.objectId(spaceId, 'file-ref') }); }
  /** Materialize decrypted/shared bytes only as a quarantined object.  The
   * shared reference never grants preview or execution authority. */
  async materializeFileBytes(spaceId: string, fileReferenceId: string, bytes: Uint8Array, sourceIdentity = this.local.nodeId): Promise<QuarantineEntry> {
    await this.ready(); const record = this.requireRecord(spaceId); this.assertPermission(record, 'file.reference'); const reference = this.listFileReferences(spaceId).find(value => value.id === fileReferenceId); if (!reference) throw new SharedSpaceError('NOT_FOUND', 'Shared file reference not found');
    const contentHash = `sha256-${await sha256(bytes)}`; return this.containment.receive({ version: 1, transferId: `space:${spaceId}:${fileReferenceId}`, sourceIdentity, objectId: reference.fileId, ...(reference.visibility === 'public' && reference.contentId ? { contentId: reference.contentId } : {}), ...(reference.filename ? { filename: reference.filename } : {}), ...(reference.mimeType ? { mimeType: reference.mimeType } : {}), size: bytes.byteLength, visibility: reference.visibility === 'public' ? 'shared' : 'private', encrypted: false, provenance: [{ kind: 'SHARED', contentHash, objectId: reference.fileId, sourceIdentity, at: new Date(this.now()).toISOString() }] }, bytes);
  }
  receiveSharedFileBytes(spaceId: string, fileReferenceId: string, bytes: Uint8Array, sourceIdentity?: string): Promise<QuarantineEntry> { return this.materializeFileBytes(spaceId, fileReferenceId, bytes, sourceIdentity); }
  async addComment(spaceId: string, input: { objectId: string; text: string; replyTo?: string }): Promise<WorkspaceComment> { return this.createCrdtObject<WorkspaceComment>(spaceId, 'comments', { id: await this.objectId(spaceId, 'comment'), objectId: input.objectId, text: input.text, ...(input.replyTo ? { replyTo: input.replyTo } : {}) }); }
  async tombstoneComment(spaceId: string, id: string): Promise<WorkspaceComment> { return this.updateCrdtObject<WorkspaceComment>(spaceId, 'comments', id, { tombstone: true }); }
  async addLink(spaceId: string, input: { url: string; title?: string; description?: string }): Promise<SharedLink> { return this.createCrdtObject<SharedLink>(spaceId, 'links', { id: await this.objectId(spaceId, 'link'), ...input }); }

  async shareWithSpace(spaceId: string, input: { sourceId: string; kind: string; value: unknown; dataClass: AIDataClass }): Promise<SharedContextPublication> {
    await this.ready(); const record = this.requireRecord(spaceId); this.assertPermission(record, 'context.share'); if (input.dataClass !== 'PUBLIC' && input.dataClass !== 'USER_EXPLICIT') throw new SharedSpaceError('UNSHAREABLE_DATA', 'Only PUBLIC or USER_EXPLICIT context may be shared');
    if (!safeId(input.sourceId) || !input.kind || stringify(input.value).length > 64_000) throw new SharedSpaceError('INVALID_ARGUMENT', 'Invalid shared context');
    const publication: SharedContextPublication = { id: await this.objectId(spaceId, 'context'), sourceId: input.sourceId, kind: input.kind.slice(0, 120), value: structuredClone(input.value), dataClass: input.dataClass, sharedBy: this.local.nodeId, createdAt: iso(this.now()) };
    if (!await this.surfaceEligible(publication.id, publication)) throw new SharedSpaceError('UNSHAREABLE_DATA', 'Shared context failed SafetySurfaceGate');
    await this.setMapValue(record, 'context', publication.id, publication, 'context.share'); return clone(publication);
  }

  listDocuments(spaceId: string): readonly SharedDocument[] { return this.listMap(spaceId, 'documents') as SharedDocument[]; }
  listNotes(spaceId: string): readonly SharedNote[] { return this.listMap(spaceId, 'notes') as SharedNote[]; }
  listTaskLists(spaceId: string): readonly TaskList[] { return this.listMap(spaceId, 'taskLists') as TaskList[]; }
  listTasks(spaceId: string): readonly SharedTask[] { return this.listMap(spaceId, 'tasks') as SharedTask[]; }
  listFileReferences(spaceId: string): readonly WorkspaceFileReference[] { return this.listMap(spaceId, 'files') as WorkspaceFileReference[]; }
  listComments(spaceId: string): readonly WorkspaceComment[] { return this.listMap(spaceId, 'comments') as WorkspaceComment[]; }
  listLinks(spaceId: string): readonly SharedLink[] { return this.listMap(spaceId, 'links') as SharedLink[]; }
  listSharedContext(spaceId: string): readonly SharedContextPublication[] { return this.listMap(spaceId, 'context') as SharedContextPublication[]; }

  private async createCrdtObject<T>(spaceId: string, root: string, value: Record<string, unknown>): Promise<T> {
    await this.ready(); const record = this.requireRecord(spaceId); const permission = permissionForRoot(root, 'write'); this.assertPermission(record, permission);
    const now = iso(this.now()); const object = { ...value, createdBy: this.local.nodeId, createdAt: now, updatedAt: now, version: 1 } as T;
    await this.setMapValue(record, root, String(value.id), object, permission); return clone(object) as T;
  }
  private async updateCrdtObject<T>(spaceId: string, root: string, id: string, patch: Record<string, unknown>): Promise<T> {
    await this.ready(); const record = this.requireRecord(spaceId); const permission = permissionForRoot(root, 'write'); this.assertPermission(record, permission); if (!safeId(id)) throw new SharedSpaceError('INVALID_ARGUMENT', 'Invalid object id');
    const map = record.document.getMap<unknown>(root); const current = map.get(id); if (!current || typeof current !== 'object') throw new SharedSpaceError('NOT_FOUND', 'Shared object not found');
    const currentObject = current instanceof Y.Map ? Object.fromEntries(current.entries()) : current as Record<string, unknown>;
    const next = { ...currentObject, ...sanitizePatch(patch), updatedAt: iso(this.now()), version: Number(currentObject.version ?? 1) + 1 };
    if (!await this.surfaceEligible(id, next)) throw new SharedSpaceError('UNSHAREABLE_DATA', 'Shared Space object failed SafetySurfaceGate');
    await this.setMapValue(record, root, id, { ...sanitizePatch(patch), updatedAt: next.updatedAt, version: next.version }, permission); return clone(next) as T;
  }
  private async setMapValue(record: SpaceRecord, root: string, id: string, value: unknown, permission: SharedSpacePermission): Promise<void> {
    if (!await this.surfaceEligible(id, value)) throw new SharedSpaceError('UNSHAREABLE_DATA', 'Shared Space object failed SafetySurfaceGate');
    const map = record.document.getMap<unknown>(root); const object = value as Record<string, unknown>;
    record.document.transact(() => {
      const current = map.get(id); const nested = current instanceof Y.Map ? current as Y.Map<unknown> : new Y.Map<unknown>();
      if (!(current instanceof Y.Map)) map.set(id, nested);
      for (const [key, item] of Object.entries(object)) nested.set(key, structuredClone(item));
    }, 'local');
    const safe = this.safeObjectIds.get(record.space.id) ?? new Set<string>(); safe.add(`${root}:${id}`); this.safeObjectIds.set(record.space.id, safe);
    await this.persist(); await this.activity(record.space.id, `${root}.${permission.split('.')[1] ?? 'write'}`, id);
  }
  private listMap(spaceId: string, root: string): readonly unknown[] { const record = this.records.get(spaceId); if (!record) return []; this.assertPermission(record, permissionForRoot(root, 'read')); const safe = this.safeObjectIds.get(spaceId) ?? new Set<string>(); return [...record.document.getMap<unknown>(root).entries()].filter(([id]) => safe.has(`${root}:${id}`)).map(([, value]) => clone(value instanceof Y.Map ? Object.fromEntries(value.entries()) : value)).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))); }
  private newDocument(spaceId: string): Y.Doc { const document = new Y.Doc({ guid: `keystone:shared-space:${spaceId}` }); for (const root of ['documents', 'notes', 'taskLists', 'tasks', 'files', 'comments', 'links', 'context']) document.getMap(root); document.on('update', (update: Uint8Array, origin: unknown) => { if (origin === this) return; const id = this.spaceForDocument(document); if (id) void this.queueLocalUpdate(id, update); }); return document; }
  private spaceForDocument(document: Y.Doc): string | undefined { for (const [id, record] of this.records) if (record.document === document) return id; return undefined; }
  private async queueLocalUpdate(spaceId: string, update: Uint8Array): Promise<void> { const record = this.records.get(spaceId); if (!record || this.closed) return; try { const opId = await this.crypto.hash(`${spaceId}:${this.local.nodeId}:${await this.crypto.randomNonce()}`); const body = await this.makeCrdtMessage(record, opId, update); for (const member of record.space.members.filter(value => value.identityId !== this.local.nodeId && !value.removedAt)) { try { await this.send(member.identityId, body); } catch { this.pending.push({ peer: member.identityId, body }); } } trimPending(this.pending); await this.persist(); } catch { this.rejected += 1; } }
  private async makeCrdtMessage(record: SpaceRecord, opId: string, update: Uint8Array): Promise<SpaceMessage> {
    const encoded = encode(update); const encrypted = record.space.visibility === 'private' ? await this.encrypt(record, encoded, `crdt:${opId}`) : undefined;
    const unsigned: Omit<Extract<SpaceMessage, { kind: 'crdt' }>, 'signature'> = record.space.visibility === 'private' ? { kind: 'crdt', spaceId: record.space.id, actor: this.local.nodeId, ...(this.localAgentId ? { agentId: this.localAgentId } : {}), opId, epoch: record.privateEpoch, keyId: record.privateKeyId, nonce: encrypted!.nonce, ciphertext: encrypted!.ciphertext } : { kind: 'crdt', spaceId: record.space.id, actor: this.local.nodeId, ...(this.localAgentId ? { agentId: this.localAgentId } : {}), opId, update: encoded };
    return { ...unsigned, signature: await this.crypto.sign(canonicalJson(unsigned), this.local.privateKey) } as SpaceMessage;
  }
  private async receive(envelope: Envelope): Promise<void> {
    await this.ready(); if (this.closed || envelope.type !== SHARED_SPACE_ENVELOPE || envelope.recipient !== this.local.nodeId) return;
    if (!validEnvelope(envelope.expiresAt, this.now()) || this.seen.has(envelope.id) || this.seen.has(envelope.nonce) || !(await this.security.verify(envelope))) { this.rejected += 1; return; }
    this.seen.add(envelope.id); this.seen.add(envelope.nonce); trimSet(this.seen, SHARED_SPACE_MAX_SEEN);
    const body = parseMessage(envelope.body); if (!body) { this.rejected += 1; return; }
    if (!await this.surfaceEligible(envelope.id, body)) { this.rejected += 1; return; }
    try {
      if (body.kind === 'space') await this.receiveSpace(envelope, body.space);
      else if (body.kind === 'membership') await this.receiveMembership(envelope, body);
      else if (body.kind === 'key_update') await this.receiveKeyUpdate(envelope, body);
      else if (body.kind === 'crdt') await this.receiveCrdt(envelope, body);
      else if (body.kind === 'sync_request') await this.receiveSyncRequest(envelope, body);
      else await this.receiveSyncState(envelope, body);
      this.accepted += 1;
    } catch { this.rejected += 1; }
  }
  private async receiveSpace(envelope: Envelope, space: SharedSpace): Promise<void> {
    if (!space || space.version !== 1 || space.owner !== envelope.sender || !(await verifyObject(this.crypto, space, space.owner)) || !space.members.some(value => value.identityId === this.local.nodeId && !value.removedAt)) throw new SharedSpaceError('NOT_AUTHORIZED', 'Space metadata rejected');
    if (space.visibility === 'private') throw new SharedSpaceError('NOT_AUTHORIZED', 'Private metadata requires an encrypted key update');
    if (!await this.protectedSurfaces.evaluate('SHARED_SPACES', { objectId: space.id, value: space, content: `${space.title}\n${space.description}`, text: `${space.title} ${space.description}`, domain: 'SHARED_SPACE', sourceType: 'space', verified: true, authorized: true, sharing: true })) throw new SharedSpaceError('UNSHAREABLE_DATA', 'Shared Space metadata failed SafetySurfaceGate');
    const existing = this.records.get(space.id); if (existing && existing.space.revision >= space.revision) return;
    const record = existing ?? { space, document: this.newDocument(space.id) }; record.space = space; if (!this.safeObjectIds.has(space.id)) this.safeObjectIds.set(space.id, new Set()); this.records.set(space.id, record); await this.persist(); await this.activity(space.id, 'space.received', space.id);
  }
  private async receiveMembership(envelope: Envelope, body: Extract<SpaceMessage, { kind: 'membership' }>): Promise<void> {
    const record = this.records.get(body.spaceId); if (!record || record.space.owner !== envelope.sender || body.actor !== envelope.sender || !(await verifyBody(this.crypto, body, body.actor))) throw new SharedSpaceError('INVALID_SIGNATURE', 'Membership event rejected');
    const marker = `membership:${body.eventId}`; if (this.seen.has(marker)) throw new SharedSpaceError('REPLAY', 'Membership event replayed'); this.seen.add(marker); trimSet(this.seen, SHARED_SPACE_MAX_SEEN);
    if (body.revision <= record.space.revision) return;
    if (body.action === 'remove' && body.member) record.space = { ...record.space, members: record.space.members.map(value => value.identityId === body.member!.identityId ? body.member! : value), revision: body.revision, updatedAt: iso(this.now()) };
    else if (body.action === 'remove' && body.removed) record.space = { ...record.space, members: record.space.members.map(value => value.identityId === this.local.nodeId && !value.removedAt ? { ...value, removedAt: iso(this.now()) } : value), revision: body.revision, updatedAt: iso(this.now()) };
    else if (body.action === 'add' && body.member) record.space = { ...record.space, members: uniqueMembers([...record.space.members.filter(value => value.identityId !== body.member!.identityId), body.member]), revision: body.revision, updatedAt: iso(this.now()) };
    else if (body.space) record.space = body.space;
    if (!await this.surfaceEligible(record.space.id, record.space)) throw new SharedSpaceError('UNSHAREABLE_DATA', 'Shared Space membership failed SafetySurfaceGate');
    await this.persist(); await this.activity(body.spaceId, `membership.${body.action}`, body.memberKey);
  }
  private async receiveKeyUpdate(envelope: Envelope, body: Extract<SpaceMessage, { kind: 'key_update' }>): Promise<void> {
    if (body.recipient !== this.local.nodeId || body.actor !== envelope.sender || !(await verifyBody(this.crypto, body, body.actor))) throw new SharedSpaceError('INVALID_SIGNATURE', 'Space key update rejected');
    const peer = this.peers.get(body.actor); if (!peer || peer.encryptionPublicKey !== this.peers.get(body.actor)?.encryptionPublicKey) throw new SharedSpaceError('INVALID_SIGNATURE', 'Unknown key-update sender');
    const existing = this.records.get(body.spaceId); if (existing && existing.space.owner !== body.actor) throw new SharedSpaceError('NOT_AUTHORIZED', 'Space owner mismatch');
    if (existing && body.epoch < (existing.privateEpoch ?? 0)) throw new SharedSpaceError('INVALID_EPOCH', 'Stale space epoch');
    if (existing && body.epoch === existing.privateEpoch && body.keyId === existing.privateKeyId) return;
    if (existing && body.previousEpoch !== (existing.privateEpoch ?? 0)) throw new SharedSpaceError('INVALID_EPOCH', 'Space epoch gap');
    const key = await this.openKey(peer, body.nonce, body.ciphertext); const metadata = JSON.parse(new TextDecoder().decode(await this.decryptBytes(key, body.metadataNonce, body.metadataCiphertext, `metadata:${body.spaceId}:${body.epoch}`))) as Omit<SharedSpace, 'signature'> & { signature: string };
    if (!metadata || metadata.id !== body.spaceId || metadata.owner !== body.actor || !metadata.members.some(value => value.identityId === this.local.nodeId && !value.removedAt)) throw new SharedSpaceError('NOT_AUTHORIZED', 'Space key membership rejected');
    const space = { ...metadata, signature: metadata.signature } as SharedSpace; if (!(await verifyObject(this.crypto, space, space.owner))) throw new SharedSpaceError('INVALID_SIGNATURE', 'Encrypted space metadata rejected'); if (!await this.surfaceEligible(space.id, space)) throw new SharedSpaceError('UNSHAREABLE_DATA', 'Encrypted Shared Space metadata failed SafetySurfaceGate');
    const record = existing ?? { space, document: this.newDocument(body.spaceId) }; record.space = space; record.privateKey = encode(key); record.privateEpoch = body.epoch; record.privateKeyId = body.keyId; this.safeObjectIds.get(body.spaceId) ?? this.safeObjectIds.set(body.spaceId, new Set()); this.records.set(body.spaceId, record); await this.persist();
  }
  private async receiveCrdt(envelope: Envelope, body: Extract<SpaceMessage, { kind: 'crdt' }>): Promise<void> {
    const record = this.records.get(body.spaceId); if (!record || !this.isMember(record, envelope.sender, body.agentId) || body.actor !== envelope.sender || !(await verifyBody(this.crypto, body, body.actor))) throw new SharedSpaceError('NOT_AUTHORIZED', 'CRDT actor is not a space member');
    if (!await this.protectedSurfaces.evaluate('SHARED_SPACES', { objectId: body.opId, content: body.update ?? body.ciphertext ?? '', text: body.update ?? '', domain: 'SHARED_SPACE', sourceType: 'space', verified: true, authorized: true, sharing: true })) throw new SharedSpaceError('UNSHAREABLE_DATA', 'Shared Space update failed SafetySurfaceGate');
    if (this.seen.has(`op:${body.opId}`)) return; this.seen.add(`op:${body.opId}`); trimSet(this.seen, SHARED_SPACE_MAX_SEEN);
    let encoded = body.update; if (record.space.visibility === 'private') { if (!body.epoch || body.epoch !== record.privateEpoch || body.keyId !== record.privateKeyId || !record.privateKey || !body.nonce || !body.ciphertext) throw new SharedSpaceError('INVALID_EPOCH', 'Private CRDT epoch rejected'); encoded = new TextDecoder().decode(await this.decryptBytes(decode(record.privateKey), body.nonce, body.ciphertext, `crdt:${body.opId}`)); }
    if (!encoded) throw new SharedSpaceError('INVALID_ARGUMENT', 'Missing CRDT update'); Y.applyUpdate(record.document, decode(encoded), this); if (!await this.refreshSafeObjects(record)) throw new SharedSpaceError('UNSHAREABLE_DATA', 'Shared Space CRDT update failed SafetySurfaceGate'); await this.persist(); await this.activity(body.spaceId, 'crdt.received', body.opId);
  }
  private async receiveSyncRequest(envelope: Envelope, body: Extract<SpaceMessage, { kind: 'sync_request' }>): Promise<void> { const record = this.records.get(body.spaceId); if (!record || !this.isMember(record, envelope.sender)) throw new SharedSpaceError('NOT_AUTHORIZED', 'Sync requester is not a member'); const update = body.stateVector ? Y.encodeStateAsUpdate(record.document, decode(body.stateVector)) : Y.encodeStateAsUpdate(record.document); const message = record.space.visibility === 'private' ? await this.makeEncryptedSyncState(record, update) : await this.makePublicSyncState(record, update); await this.send(envelope.sender, message); }
  private async receiveSyncState(envelope: Envelope, body: Extract<SpaceMessage, { kind: 'sync_state' }>): Promise<void> { const record = this.records.get(body.spaceId); if (!record || !this.isMember(record, envelope.sender) || !(await verifyBody(this.crypto, body, envelope.sender))) throw new SharedSpaceError('NOT_AUTHORIZED', 'Sync state rejected'); let encoded = body.update; if (record.space.visibility === 'private') { if (!record.privateKey || body.epoch !== record.privateEpoch || body.keyId !== record.privateKeyId || !body.nonce || !body.ciphertext) throw new SharedSpaceError('INVALID_EPOCH', 'Sync epoch rejected'); encoded = new TextDecoder().decode(await this.decryptBytes(decode(record.privateKey), body.nonce, body.ciphertext, `sync:${body.spaceId}:${body.epoch}`)); } if (encoded) { Y.applyUpdate(record.document, decode(encoded), this); if (!await this.refreshSafeObjects(record)) throw new SharedSpaceError('UNSHAREABLE_DATA', 'Shared Space sync state failed SafetySurfaceGate'); } await this.persist(); }
  private async makeEncryptedSyncState(record: SpaceRecord, update: Uint8Array): Promise<SpaceMessage> { const op = await this.encrypt(record, encode(update), `sync:${record.space.id}:${record.privateEpoch}`); const unsigned = { kind: 'sync_state' as const, spaceId: record.space.id, epoch: record.privateEpoch, keyId: record.privateKeyId, nonce: op.nonce, ciphertext: op.ciphertext }; return { ...unsigned, signature: await this.crypto.sign(canonicalJson(unsigned), this.local.privateKey) }; }
  private async makePublicSyncState(record: SpaceRecord, update: Uint8Array): Promise<SpaceMessage> { const unsigned = { kind: 'sync_state' as const, spaceId: record.space.id, update: encode(update) }; return { ...unsigned, signature: await this.crypto.sign(canonicalJson(unsigned), this.local.privateKey) }; }
  private async membershipBroadcast(record: SpaceRecord, action: Extract<SpaceMessage, { kind: 'membership' }>['action'], member: SharedSpaceMember | undefined, next: SharedSpace): Promise<void> {
    const eventId = await this.crypto.randomNonce();
    for (const value of next.members) if (value.identityId !== this.local.nodeId && (!value.removedAt || action === 'remove')) {
      const unsigned = { kind: 'membership' as const, spaceId: next.id, eventId, actor: this.local.nodeId, action, ...(next.visibility === 'public' && member ? { member, memberKey: member.identityId } : {}), ...(next.visibility === 'private' && action === 'remove' && member?.identityId === value.identityId ? { removed: true } : {}), revision: next.revision } as const;
      const unsignedBody = { ...unsigned, ...(next.visibility === 'public' ? { space: next } : {}) };
      const body: SpaceMessage = { ...unsignedBody, signature: await this.crypto.sign(canonicalJson(unsignedBody), this.local.privateKey) } as SpaceMessage;
      try { await this.send(value.identityId, body); } catch { this.pending.push({ peer: value.identityId, body }); }
    }
    if (next.visibility === 'private') await this.broadcastPrivateKeys(next, record.privateEpoch === undefined ? 1 : (record.privateEpoch + 1));
    await this.persist();
  }
  private async broadcastPrivateKeys(space: SharedSpace, epoch: number): Promise<void> {
    const record = this.requireRecord(space.id); const key = await randomBytes(32); const keyId = await this.crypto.hash(`${space.id}:${epoch}:${encode(key)}`); record.space = space; record.privateKey = encode(key); record.privateEpoch = epoch; record.privateKeyId = keyId; await this.persist();
    for (const member of space.members.filter(value => !value.removedAt && value.identityId !== this.local.nodeId)) { const peer = this.peers.get(member.identityId); if (!peer) continue; const body = await this.makeKeyUpdate(record, member.identityId, peer, key, epoch, keyId); try { await this.send(member.identityId, body); } catch { this.pending.push({ peer: member.identityId, body }); } }
  }
  private async makeKeyUpdate(record: SpaceRecord, recipient: NodeId, peer: DeviceSessionKeys, key: Uint8Array, epoch: number, keyId: string): Promise<SpaceMessage> {
    const wrapped = await this.sealKey(peer, key); const metadata = await this.encryptBytes(key, new TextEncoder().encode(JSON.stringify(record.space)), `metadata:${record.space.id}:${epoch}`); const unsigned = { kind: 'key_update' as const, spaceId: record.space.id, actor: this.local.nodeId, recipient, epoch, previousEpoch: epoch - 1, keyId, nonce: wrapped.nonce, ciphertext: wrapped.ciphertext, metadataNonce: metadata.nonce, metadataCiphertext: metadata.ciphertext }; return { ...unsigned, signature: await this.crypto.sign(canonicalJson(unsigned), this.local.privateKey) };
  }
  private async sendCurrent(peer: NodeId, record: SpaceRecord): Promise<void> {
    if (record.space.visibility === 'private') { if (!record.privateKey || !record.privateEpoch || !record.privateKeyId) throw new SharedSpaceError('PRIVATE_KEY_UNAVAILABLE', 'Private space key unavailable'); const target = this.peers.get(peer); if (!target) throw new SharedSpaceError('INVALID_ARGUMENT', 'Unknown peer key'); await this.send(peer, await this.makeKeyUpdate(record, peer, target, decode(record.privateKey), record.privateEpoch, record.privateKeyId)); const update = Y.encodeStateAsUpdate(record.document); await this.send(peer, await this.makeEncryptedSyncState(record, update)); }
    else { await this.send(peer, { kind: 'space', space: record.space }); const update = Y.encodeStateAsUpdate(record.document); await this.send(peer, await this.makePublicSyncState(record, update)); }
  }
  private async updateSpace(record: SpaceRecord, patch: Partial<Pick<SharedSpace, 'members' | 'agentGrants'>>): Promise<SharedSpace> { const unsigned = { ...record.space, ...patch, revision: record.space.revision + 1, updatedAt: iso(this.now()) }; const { signature: _signature, ...without } = unsigned; const next: SharedSpace = { ...without, signature: await this.crypto.sign(canonicalJson(without), this.local.privateKey) }; if (!await this.surfaceEligible(next.id, next)) throw new SharedSpaceError('UNSHAREABLE_DATA', 'Shared Space metadata failed SafetySurfaceGate'); record.space = next; await this.persist(); return next; }
  private async activity(spaceId: string, action: string, objectId?: string, dataClass?: 'PUBLIC' | 'USER_EXPLICIT'): Promise<void> { const event: SpaceActivityEvent = { id: randomId(), spaceId, actor: this.local.nodeId, ...(this.localAgentId ? { agentId: this.localAgentId } : {}), action, ...(objectId ? { objectId } : {}), at: iso(this.now()), ...(dataClass ? { dataClass } : {}) }; this.activityEntries.push(event); trimArray(this.activityEntries, SHARED_SPACE_MAX_ACTIVITY); await this.persist(); await this.onActivity?.(clone(event)); }
  private async objectId(_spaceId: string, _kind: string): Promise<string> { return randomId(); }
  private async persist(): Promise<void> {
    const spaces = await Promise.all([...this.records.values()].map(value => this.serializeSpace(value)));
    const snapshot: SharedSpaceSnapshot = { version: 1, spaces, documents: [...this.records.entries()].map(([spaceId, value]) => ({ spaceId, state: encode(Y.encodeStateAsUpdate(value.document)) })), pending: this.pending.map(clone), seen: [...this.seen].slice(-SHARED_SPACE_MAX_SEEN), activity: this.activityEntries.slice(-SHARED_SPACE_MAX_ACTIVITY).map(clone) };
    const operation = this.writes.then(() => this.storage.write(snapshot)); this.writes = operation.catch(() => undefined); await operation;
  }
  private async serializeSpace(record: SpaceRecord): Promise<SharedSpaceSnapshot['spaces'][number]> {
    const base = { ...record.space, ...(record.privateEpoch !== undefined ? { privateEpoch: record.privateEpoch } : {}), ...(record.privateKeyId ? { privateKeyId: record.privateKeyId } : {}) };
    if (!record.privateKey || record.space.visibility !== 'private') return base;
    const sealed = await this.sealSnapshotSecret(record.space.id, record.privateKey, record.privateEpoch ?? 0, record.privateKeyId ?? '');
    return { ...base, epochSecretNonce: sealed.nonce, epochSecretCiphertext: sealed.ciphertext };
  }
  private async hydrate(): Promise<void> {
    const raw = await this.storage.read(); if (!raw) return; const snapshot = parseSnapshot(raw);
    const legacyById = legacySpaceSecrets(raw);
    let migratedLegacy = false;
    for (const space of snapshot.spaces) {
      if (!await this.surfaceEligible(space.id, space)) continue;
      const record: SpaceRecord = { space, document: this.newDocument(space.id) };
      const state = snapshot.documents.find(value => value.spaceId === space.id); if (state) Y.applyUpdate(record.document, decode(state.state), this);
      record.privateEpoch = space.privateEpoch ?? legacyById.get(space.id)?.epoch;
      record.privateKeyId = space.privateKeyId ?? legacyById.get(space.id)?.keyId;
      if (space.visibility === 'private') {
        try {
          if (space.epochSecretNonce && space.epochSecretCiphertext) record.privateKey = await this.openSnapshotSecret(space.id, space.epochSecretNonce, space.epochSecretCiphertext, record.privateEpoch ?? 0, record.privateKeyId ?? '');
          else if (legacyById.has(space.id)) { record.privateKey = legacyById.get(space.id)!.key; migratedLegacy = true; }
          else continue;
        } catch { continue; }
      }
      if (!await this.refreshSafeObjects(record)) continue; this.records.set(space.id, record);
    }
    this.pending.push(...snapshot.pending.map(clone)); for (const id of snapshot.seen) this.seen.add(id); this.activityEntries.push(...snapshot.activity.map(clone));
    if (migratedLegacy) await this.persist();
  }
  private async refreshSafeObjects(record: SpaceRecord): Promise<boolean> { const safe = new Set<string>(); for (const root of ['documents', 'notes', 'taskLists', 'tasks', 'files', 'comments', 'links', 'context']) { for (const [id, value] of record.document.getMap<unknown>(root).entries()) { const object = value instanceof Y.Map ? Object.fromEntries(value.entries()) : value; if (await this.surfaceEligible(id, object)) safe.add(`${root}:${id}`); } } this.safeObjectIds.set(record.space.id, safe); return true; }
  private requireRecord(spaceId: string): SpaceRecord { const record = this.records.get(spaceId); if (!record) throw new SharedSpaceError('NOT_FOUND', `Shared Space not found: ${spaceId}`); return record; }
  private assertReadable(record: SpaceRecord): void { if (!this.isMember(record, this.local.nodeId, this.localAgentId)) throw new SharedSpaceError('NOT_AUTHORIZED', 'Not a Shared Space member'); }
  private assertPermission(record: SpaceRecord, permission: SharedSpacePermission): void { if (!this.isMember(record, this.local.nodeId, this.localAgentId) || !hasPermission(record.space, this.local.nodeId, this.localAgentId, permission, this.now())) throw new SharedSpaceError('NOT_AUTHORIZED', `Missing Shared Space permission: ${permission}`); }
  private isMember(record: SpaceRecord, identityId: NodeId, agentId?: string): boolean { if (agentId) { const member = record.space.members.find(value => value.identityId === identityId && !value.removedAt && value.kind === 'agent' && value.agentId === agentId); const grant = record.space.agentGrants.find(value => value.identityId === identityId && value.agentId === agentId && !value.revoked && Date.parse(value.expiresAt) > this.now() && value.used < value.maxUses); return !!grant || !!member; } return !!record.space.members.find(value => value.identityId === identityId && !value.removedAt && value.kind === 'human'); }
  private async send(peer: NodeId, body: SpaceMessage): Promise<void> { if (!this.peers.has(peer)) throw new SharedSpaceError('TRANSPORT', 'Unknown Shared Space peer'); if (!await this.surfaceEligible(`space-message:${peer}:${body.kind}`, body)) throw new SharedSpaceError('UNSHAREABLE_DATA', 'Shared Space payload failed SafetySurfaceGate'); const unsigned: UnsignedEnvelope = { version: 1, type: SHARED_SPACE_ENVELOPE, id: randomId(), sender: this.local.nodeId, recipient: peer, nonce: await this.crypto.randomNonce(), expiresAt: new Date(this.now() + SHARED_SPACE_MAX_LIFETIME_MS).toISOString(), body }; if (new TextEncoder().encode(canonicalJson(body)).byteLength > SHARED_SPACE_MAX_OBJECT_BYTES) throw new SharedSpaceError('INVALID_ARGUMENT', 'Shared Space message is too large'); await this.transport.connect(peer); await this.transport.send(peer, { ...unsigned, signature: await this.security.sign(unsigned) }); }
  private async surfaceEligible(objectId: string, value: unknown): Promise<boolean> { return (await this.protectedSurfaces.evaluate('SHARED_SPACES', { objectId, value, content: value, text: stringify(value), domain: 'SHARED_SPACE', sourceType: 'space', verified: true, authorized: true, sharing: true })) !== undefined; }
  private async encrypt(record: SpaceRecord, plaintext: string, aad: string): Promise<{ nonce: string; ciphertext: string }> { if (!record.privateKey) throw new SharedSpaceError('PRIVATE_KEY_UNAVAILABLE', 'Private space key unavailable'); return this.encryptBytes(decode(record.privateKey), new TextEncoder().encode(plaintext), aad); }
  /** Snapshot protection is deliberately separate from the group epoch key.
   * The storage backend therefore receives ciphertext even when it is an
   * in-memory/test backend, while restart recovery remains device-scoped. */
  private async snapshotKey(): Promise<Uint8Array> { const sodium = await loadSodium(); const encryptionKey = decode(this.local.encryptionPrivateKey); try { return new Uint8Array(sodium.crypto_generichash(32, sodium.from_string('keystone:shared-space-epoch-state:v1'), encryptionKey)); } finally { encryptionKey.fill(0); } }
  private async sealSnapshotSecret(spaceId: string, secret: string, epoch: number, keyId: string): Promise<{ nonce: string; ciphertext: string }> { const key = await this.snapshotKey(); const plaintext = new TextEncoder().encode(secret); try { return await this.encryptBytes(key, plaintext, `snapshot:${spaceId}:${epoch}:${keyId}`); } finally { key.fill(0); plaintext.fill(0); } }
  private async openSnapshotSecret(spaceId: string, nonce: string, ciphertext: string, epoch: number, keyId: string): Promise<string> { const key = await this.snapshotKey(); let plaintext: Uint8Array | undefined; try { plaintext = await this.decryptBytes(key, nonce, ciphertext, `snapshot:${spaceId}:${epoch}:${keyId}`); const value = new TextDecoder().decode(plaintext); if (decode(value).length !== 32) throw new Error('Invalid epoch secret'); return value; } finally { key.fill(0); plaintext?.fill(0); } }
  private async encryptBytes(key: Uint8Array, plaintext: Uint8Array, aad: string): Promise<{ nonce: string; ciphertext: string }> { const sodium = await loadSodium(); const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES); const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(plaintext, aad, null, nonce, key); return { nonce: encode(nonce), ciphertext: encode(ciphertext) }; }
  private async decryptBytes(key: Uint8Array, nonce: string, ciphertext: string, aad: string): Promise<Uint8Array> { try { const sodium = await loadSodium(); return new Uint8Array(sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, decode(ciphertext), aad, decode(nonce), key)); } catch { throw new SharedSpaceError('INVALID_SIGNATURE', 'Shared Space ciphertext authentication failed'); } }
  private async sealKey(peer: DeviceSessionKeys, key: Uint8Array): Promise<{ nonce: string; ciphertext: string }> { const sodium = await loadSodium(); const nonce = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES); const ciphertext = sodium.crypto_box_easy(encode(key), nonce, decode(peer.encryptionPublicKey), decode(this.local.encryptionPrivateKey)); return { nonce: encode(nonce), ciphertext: encode(ciphertext) }; }
  private async openKey(peer: DeviceSessionKeys, nonce: string, ciphertext: string): Promise<Uint8Array> { try { const sodium = await loadSodium(); const value = sodium.crypto_box_open_easy(decode(ciphertext), decode(nonce), decode(peer.encryptionPublicKey), decode(this.local.encryptionPrivateKey)); const key = decode(new TextDecoder().decode(value)); if (key.length !== 32) throw new Error('key'); return key; } catch { throw new SharedSpaceError('PRIVATE_KEY_UNAVAILABLE', 'Private Shared Space key unwrap failed'); } }
}

function permissionForRoot(root: string, action: 'read' | 'write'): SharedSpacePermission { if (root === 'documents') return `document.${action}` as SharedSpacePermission; if (root === 'notes') return `note.${action}` as SharedSpacePermission; if (root === 'tasks' || root === 'taskLists') return `task.${action}` as SharedSpacePermission; if (root === 'files') return 'file.reference'; if (root === 'comments') return 'comment.write'; if (root === 'links') return 'link.write'; return 'context.share'; }
function rolePermissions(role: SharedSpaceRole): readonly SharedSpacePermission[] { if (role === 'owner' || role === 'admin') return SHARED_SPACE_PERMISSIONS; if (role === 'editor') return ['space.read', 'document.read', 'document.write', 'note.read', 'note.write', 'task.read', 'task.write', 'task.assign', 'file.reference', 'comment.write', 'link.write', 'context.share', 'activity.read']; if (role === 'commenter') return ['space.read', 'document.read', 'note.read', 'task.read', 'comment.write', 'activity.read']; if (role === 'agent') return ['space.read', 'document.read', 'comment.write', 'agent.participate']; return ['space.read', 'document.read', 'note.read', 'task.read', 'activity.read']; }
function hasPermission(space: SharedSpace, identityId: NodeId, agentId: string | undefined, permission: SharedSpacePermission, now: number): boolean { const member = space.members.find(value => value.identityId === identityId && !value.removedAt && (agentId ? value.kind === 'agent' && value.agentId === agentId : value.kind === 'human')); const grant = agentId ? space.agentGrants.find(value => value.identityId === identityId && value.agentId === agentId && !value.revoked && Date.parse(value.expiresAt) > now && value.used < value.maxUses && value.permissions.includes(permission)) : undefined; return !!grant || !!member && (member.permissions?.includes(permission) || rolePermissions(member.role).includes(permission)); }
function uniqueMembers(values: readonly SharedSpaceMember[]): SharedSpaceMember[] { const map = new Map<string, SharedSpaceMember>(); for (const value of values) { const key = `${value.identityId}:${value.agentId ?? ''}`; const { permissions: _permissions, ...withoutPermissions } = value; map.set(key, value.permissions?.length ? { ...withoutPermissions, permissions: normalizePermissions(value.permissions) } : withoutPermissions); } const result = [...map.values()]; if (result.filter(value => value.role === 'owner' && !value.removedAt).length !== 1) throw new SharedSpaceError('INVALID_STATE', 'Shared Space must have exactly one owner'); return result; }
function normalizePermissions(values: readonly SharedSpacePermission[]): SharedSpacePermission[] { if (!Array.isArray(values) || values.length > SHARED_SPACE_PERMISSIONS.length) throw new SharedSpaceError('INVALID_ARGUMENT', 'Invalid Shared Space permissions'); const unique = [...new Set(values)]; if (unique.some(value => !SHARED_SPACE_PERMISSIONS.includes(value))) throw new SharedSpaceError('INVALID_ARGUMENT', 'Unknown Shared Space permission'); return unique; }
function sanitizePatch(value: Record<string, unknown>): Record<string, unknown> { const output: Record<string, unknown> = {}; for (const [key, item] of Object.entries(value)) { if (['id', 'createdBy', 'createdAt', 'version'].includes(key)) continue; if (typeof item === 'string' && item.length > 64_000) throw new SharedSpaceError('INVALID_ARGUMENT', 'Shared field is too large'); output[key] = structuredClone(item); } return output; }
function parseMessage(value: unknown): SpaceMessage | undefined { if (!value || typeof value !== 'object') return undefined; const candidate = value as SpaceMessage; if (!['space', 'membership', 'key_update', 'crdt', 'sync_request', 'sync_state'].includes(candidate.kind)) return undefined; return candidate; }
async function verifyObject(crypto: CryptoProvider, value: SharedSpace, signer: NodeId): Promise<boolean> { return verifyBody(crypto, value, signer); }
async function verifyBody(crypto: CryptoProvider, value: { readonly signature: string }, signer: NodeId): Promise<boolean> { try { const { signature: _signature, ...unsigned } = value as Record<string, unknown>; return await crypto.verify(canonicalJson(unsigned), value.signature, signer); } catch { return false; } }
function parseSnapshot(value: unknown): SharedSpaceSnapshot { if (!value || typeof value !== 'object' || (value as { version?: unknown }).version !== 1) throw new SharedSpaceError('INVALID_STATE', 'Invalid Shared Space state version'); const candidate = value as Partial<SharedSpaceSnapshot>; if (!Array.isArray(candidate.spaces) || !Array.isArray(candidate.documents) || !Array.isArray(candidate.pending) || !Array.isArray(candidate.seen) || !Array.isArray(candidate.activity)) throw new SharedSpaceError('INVALID_STATE', 'Invalid Shared Space state shape'); return { version: 1, spaces: candidate.spaces.map(value => parseSpace(value)), documents: candidate.documents.filter(value => !!value && safeId((value as { spaceId?: unknown }).spaceId) && typeof (value as { state?: unknown }).state === 'string').map(value => ({ spaceId: (value as { spaceId: string }).spaceId, state: (value as { state: string }).state })), pending: candidate.pending.filter(value => !!value && safeId((value as { peer?: unknown }).peer) && !!parseMessage((value as { body?: unknown }).body)).map(value => ({ peer: (value as { peer: NodeId }).peer, body: parseMessage((value as { body: unknown }).body)! })), seen: candidate.seen.filter(safeId).slice(-SHARED_SPACE_MAX_SEEN), activity: candidate.activity.filter(value => !!value && safeId((value as { id?: unknown }).id) && safeId((value as { spaceId?: unknown }).spaceId)).slice(-SHARED_SPACE_MAX_ACTIVITY) as SpaceActivityEvent[] }; }
function parseSpace(value: unknown): SharedSpaceSnapshot['spaces'][number] {
  if (!value || typeof value !== 'object') throw new SharedSpaceError('INVALID_STATE', 'Invalid Shared Space object');
  const candidate = value as Record<string, unknown>;
  const space = candidate as unknown as SharedSpace;
  if (space.version !== 1 || !safeId(space.id) || !safeId(space.owner) || typeof space.title !== 'string' || typeof space.description !== 'string' || !['public', 'private'].includes(space.visibility) || !Array.isArray(space.members) || !Array.isArray(space.agentGrants) || !Number.isSafeInteger(space.revision) || space.revision < 1 || !Number.isFinite(Date.parse(space.createdAt)) || !Number.isFinite(Date.parse(space.updatedAt)) || typeof space.signature !== 'string') throw new SharedSpaceError('INVALID_STATE', 'Invalid Shared Space object');
  uniqueMembers(space.members);
  const parsed: SharedSpaceSnapshot['spaces'][number] = { version: 1, id: space.id, owner: space.owner, title: space.title, description: space.description, visibility: space.visibility, members: clone(space.members), agentGrants: clone(space.agentGrants), revision: space.revision, createdAt: space.createdAt, updatedAt: space.updatedAt, signature: space.signature,
    ...(Number.isSafeInteger(candidate.privateEpoch) ? { privateEpoch: candidate.privateEpoch as number } : Number.isSafeInteger(candidate.epoch) ? { privateEpoch: candidate.epoch as number } : {}),
    ...(typeof candidate.privateKeyId === 'string' ? { privateKeyId: candidate.privateKeyId } : typeof candidate.epochKeyId === 'string' ? { privateKeyId: candidate.epochKeyId } : {}),
    ...(typeof candidate.epochSecretNonce === 'string' && typeof candidate.epochSecretCiphertext === 'string' ? { epochSecretNonce: candidate.epochSecretNonce, epochSecretCiphertext: candidate.epochSecretCiphertext } : {}) };
  return parsed;
}
interface LegacySpaceSecret { readonly key: string; readonly epoch?: number; readonly keyId?: string; }
function legacySpaceSecrets(value: unknown): ReadonlyMap<string, LegacySpaceSecret> {
  const output = new Map<string, LegacySpaceSecret>(); const spaces = value && typeof value === 'object' && Array.isArray((value as { spaces?: unknown }).spaces) ? (value as { spaces: readonly unknown[] }).spaces : [];
  for (const item of spaces) {
    if (!item || typeof item !== 'object') continue; const candidate = item as Record<string, unknown>; if (typeof candidate.id !== 'string' || typeof candidate.privateKey !== 'string') continue;
    try { if (decode(candidate.privateKey).length !== 32) continue; } catch { continue; }
    output.set(candidate.id, { key: candidate.privateKey, ...(Number.isSafeInteger(candidate.privateEpoch) ? { epoch: candidate.privateEpoch as number } : {}), ...(typeof candidate.privateKeyId === 'string' ? { keyId: candidate.privateKeyId } : {}) });
  }
  return output;
}
function validEnvelope(value: string, now: number): boolean { const expiry = Date.parse(value); return Number.isFinite(expiry) && expiry > now - 1_000 && expiry - now <= SHARED_SPACE_MAX_LIFETIME_MS + 1_000; }
function validExpiry(value: string, now: number): boolean { const expiry = Date.parse(value); return Number.isFinite(expiry) && expiry > now && expiry - now <= SHARED_SPACE_MAX_LIFETIME_MS; }
function iso(now: number): string { return new Date(now).toISOString(); }
function randomId(): string { return `${globalThis.crypto.randomUUID()}`; }
function safeId(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9_-][A-Za-z0-9._:-]{0,255}$/.test(value); }
function clone<T>(value: T): T { return structuredClone(value); }
function trimSet(values: Set<string>, max: number): void { while (values.size > max) values.delete(values.values().next().value as string); }
function trimArray<T>(values: T[], max: number): void { while (values.length > max) values.shift(); }
function trimPending(values: SharedSpacePendingMessage[]): void { while (values.length > 4096) values.shift(); }
function stringify(value: unknown): string { try { return JSON.stringify(value) ?? String(value); } catch { return '[unserializable]'; } }
function encode(bytes: Uint8Array): string { let binary = ''; bytes.forEach(byte => { binary += String.fromCharCode(byte); }); return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, ''); }
function decode(value: string): Uint8Array { const normalized = value.replace(/-/g, '+').replace(/_/g, '/'); return Uint8Array.from(atob(normalized + '='.repeat((4 - normalized.length % 4) % 4)), char => char.charCodeAt(0)); }
async function randomBytes(size: number): Promise<Uint8Array> { return (await loadSodium()).randombytes_buf(size); }
async function loadSodium(): Promise<any> { const { default: sodium } = await import('libsodium-wrappers'); await sodium.ready; return sodium; }
