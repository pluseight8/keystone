/**
 * Shared Vault collaboration on the existing Vault/Yjs/Noise boundaries.
 *
 * A Shared Vault is not a second content system: Markdown and the existing
 * Canvas service remain the durable representation.  The protocol below is a
 * small, typed replication layer with membership/epoch checks, bounded
 * envelopes and optional host persistence.  Private payloads are encrypted
 * before they leave this module; when a host cannot provide a device key,
 * private replication fails closed rather than silently sending plaintext.
 */
import * as Y from 'yjs';
import type { CryptoProvider } from './crypto.js';
import { canonicalJson } from './crypto.js';
import type { DeviceSessionKeys } from './identity.js';
import type { Envelope, EnvelopeSecurity, UnsignedEnvelope } from './connectivity.js';
import type { KeystoneDeliveryInterface } from './connectivity.js';
import type { CanvasDocument, CanvasMutation, CanvasEdge, CanvasNode, CanvasService } from './vault-canvas.js';
import type { MarkdownNote, VaultNoteIndex, VaultService } from './vaults.js';
import { VaultError } from './vaults.js';
import { MandatorySafetySurfaceRegistry } from './security/safety-surfaces.js';
import { SafetyRuntime, SafetySurfaceGate, type ContentDomain } from './security/content-safety.js';
import { FileContainmentService, type QuarantineEntry } from './security/untrusted-content.js';
import { sha256 } from './social/content.js';

export const SHARED_VAULT_VERSION = 1 as const;
export const SHARED_VAULT_MAX_OBJECT_BYTES = 4 * 1024 * 1024;
export const SHARED_VAULT_MAX_PENDING = 4_096;
export const SHARED_VAULT_MAX_SEEN = 8_192;
export const SHARED_VAULT_MAX_PRESENCE = 512;

export type SharedVaultKind = 'PERSONAL' | 'SHARED';
export type SharedVaultVisibility = 'public' | 'private' | 'contacts';
export type SharedVaultHistoryPolicy = 'CURRENT_STATE_ONLY' | 'SHARED_HISTORY';
export type SharedVaultPermission =
  | 'VIEW'
  | 'EDIT'
  | 'CREATE_NOTE'
  | 'DELETE_OWN'
  | 'DELETE_ALL'
  | 'MOVE'
  | 'MANAGE_ATTACHMENTS'
  | 'MANAGE_CANVAS'
  | 'INVITE'
  | 'REMOVE_MEMBER'
  | 'MANAGE_PERMISSIONS';
export type SharedVaultRole = 'owner' | 'editor' | 'viewer' | 'custom';

export interface SharedVaultMembership {
  readonly identityId: string;
  readonly devices?: readonly string[];
  readonly role: SharedVaultRole;
  readonly permissions: readonly SharedVaultPermission[];
  readonly joinedAt: string;
  readonly addedBy: string;
  readonly removedAt?: string;
  readonly revokedAt?: string;
}
export interface SharedVaultKeyEpoch {
  readonly version: 1;
  readonly epoch: number;
  readonly keyId: string;
  readonly createdAt: string;
  readonly rotatedFor?: 'join' | 'leave' | 'kick' | 'ban' | 'device-revocation' | 'permissions' | 'manual';
  readonly revokedIdentities?: readonly string[];
}
export interface SharedVault {
  readonly version: 1;
  readonly id: string;
  readonly ownerIdentityId: string;
  readonly kind: SharedVaultKind;
  readonly title: string;
  readonly description?: string;
  readonly visibility: SharedVaultVisibility;
  readonly historyPolicy: SharedVaultHistoryPolicy;
  readonly members: readonly SharedVaultMembership[];
  readonly epoch: SharedVaultKeyEpoch;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly signature?: string;
}
export interface SharedVaultInvitation {
  readonly version: 1;
  readonly id: string;
  readonly vault: SharedVault;
  readonly recipientIdentityId: string;
  readonly inviterIdentityId: string;
  readonly epoch: number;
  readonly wrappedKey?: { readonly nonce: string; readonly ciphertext: string; readonly senderEncryptionPublicKey: string };
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly signature: string;
}
export interface VaultDocumentReplica {
  readonly version: 1;
  readonly vaultId: string;
  readonly noteId: string;
  readonly epoch: number;
  readonly revision: number;
  readonly content: string;
  readonly stateVector: string;
  readonly updatedAt: string;
  readonly conflict?: 'EXPLICIT_CONFLICT' | 'STALE_REFERENCE';
}
export interface VaultCollaborationSession {
  readonly version: 1;
  readonly id: string;
  readonly vaultId: string;
  readonly actorIdentityId: string;
  readonly startedAt: string;
  readonly lastActivityAt: string;
  readonly state: 'ACTIVE' | 'OFFLINE' | 'REVOKED' | 'ENDED';
}
export interface SharedVaultPresence {
  readonly identityId: string;
  readonly deviceId?: string;
  readonly state: 'editing' | 'viewing' | 'idle' | 'offline';
  readonly noteId?: string;
  readonly expiresAt: string;
}
export interface SharedVaultStateStore { read(): Promise<unknown | undefined>; write(value: unknown): Promise<void>; }
export class InMemorySharedVaultStateStore implements SharedVaultStateStore {
  private value?: unknown;
  async read(): Promise<unknown | undefined> { return this.value === undefined ? undefined : structuredClone(this.value); }
  async write(value: unknown): Promise<void> { this.value = structuredClone(value); }
  corrupt(value: unknown): void { this.value = value; }
}

/**
 * Production durable state boundary.  The complete Shared Vault snapshot
 * (epoch keys, Markdown projections, Canvas projections and opaque attachment
 * references) is authenticated and encrypted before reaching the host
 * backend.  The backend only sees a versioned nonce/ciphertext envelope.
 */
export class PersistentSharedVaultStateStore implements SharedVaultStateStore {
  private readonly ready = loadSodium();
  constructor(private readonly backend: SharedVaultStateStore, private readonly local: DeviceSessionKeys) {}
  async read(): Promise<unknown | undefined> {
    const raw = await this.backend.read();
    if (raw === undefined) return undefined;
    if (!isRecord(raw) || raw.version !== 1 || typeof raw.nonce !== 'string' || typeof raw.ciphertext !== 'string') throw new SharedVaultError('CORRUPT_STATE', 'Encrypted Shared Vault state envelope is corrupt');
    try {
      const sodium = await this.ready;
      const plaintext = sodium.crypto_secretbox_open_easy(decode(raw.ciphertext), decode(raw.nonce), await this.storageKey(sodium));
      return JSON.parse(new TextDecoder().decode(plaintext));
    } catch {
      throw new SharedVaultError('CORRUPT_STATE', 'Encrypted Shared Vault state authentication failed');
    }
  }
  async write(value: unknown): Promise<void> {
    const sodium = await this.ready;
    const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
    const ciphertext = sodium.crypto_secretbox_easy(JSON.stringify(value), nonce, await this.storageKey(sodium));
    await this.backend.write({ version: 1, nonce: encode(nonce), ciphertext: encode(ciphertext) });
  }
  private async storageKey(sodium: any): Promise<Uint8Array> { return new Uint8Array(sodium.crypto_generichash(32, sodium.from_string('keystone:shared-vault-state:v1'), decode(this.local.encryptionPrivateKey))); }
}

export interface SharedVaultServiceOptions {
  readonly vault: VaultService;
  readonly identityId?: string;
  readonly device?: DeviceSessionKeys;
  readonly crypto?: CryptoProvider;
  readonly privateKey?: string;
  readonly trustedPublicKeys?: Readonly<Record<string, string>>;
  readonly trustedEncryptionPublicKeys?: Readonly<Record<string, string>>;
  readonly transport?: KeystoneDeliveryInterface;
  readonly security?: EnvelopeSecurity;
  readonly state?: SharedVaultStateStore;
  readonly canvas?: CanvasService;
  readonly now?: () => number;
  readonly maxPending?: number;
  readonly historyPolicy?: SharedVaultHistoryPolicy;
  /** Optional host diagnostics hook; errors never escape transport listeners. */
  readonly onError?: (error: unknown) => void;
  /** Mandatory recipient-local safety gate for shared/public vault objects. */
  readonly protectedSurfaces?: MandatorySafetySurfaceRegistry;
  /** Plaintext materialization crosses R0P59; ciphertext references stay opaque. */
  readonly containment?: FileContainmentService;
}
export interface SharedVaultCreateInput { readonly id?: string; readonly title: string; readonly description?: string; readonly kind?: SharedVaultKind; readonly visibility?: SharedVaultVisibility; readonly historyPolicy?: SharedVaultHistoryPolicy; }
export interface SharedVaultNoteInput { readonly path: string; readonly content?: string; }
export interface SharedVaultNoteUpdate { readonly content: string; readonly baseRevision?: number; }
export interface SharedVaultAttachmentReference { readonly version: 1; readonly id: string; readonly vaultId: string; readonly contentId: string; readonly sourceAttachmentId?: string; readonly name: string; readonly mimeType: string; readonly size: number; readonly ownerIdentityId: string; readonly encrypted: boolean; readonly createdAt: string; }
export interface SharedVaultAttachmentInput { readonly id?: string; readonly contentId?: string; readonly encryptedContentId?: string; readonly sourceAttachmentId?: string; readonly name: string; readonly mimeType: string; readonly size: number; }
export interface SharedVaultPendingMessage { readonly peer: string; readonly envelope: Envelope; }
export interface SharedVaultSnapshot {
  readonly version: 1;
  readonly vaults: readonly SharedVault[];
  readonly replicas: readonly VaultDocumentReplica[];
  readonly pending: readonly SharedVaultPendingMessage[];
  readonly seen: readonly string[];
  /**
   * Epoch key material is runtime-only.  Snapshots carry only device-bound
   * AEAD ciphertext, so even an in-memory/test state store cannot expose a
   * plaintext group key through JSON or generic application state.
   */
  readonly epochKeys?: readonly { readonly vaultId: string; readonly epoch: number; readonly epochSecretNonce: string; readonly epochSecretCiphertext: string }[];
  /** Note ownership is explicit: a Shared Vault must never expose unrelated local notes. */
  readonly noteIds?: readonly { readonly vaultId: string; readonly noteIds: readonly string[] }[];
  readonly remoteNotes?: readonly RemoteNoteRecord[];
  readonly memberEncryptionKeys?: readonly { readonly identityId: string; readonly publicKey: string }[];
  readonly canvasDocuments?: readonly CanvasDocument[];
  readonly attachmentReferences?: readonly SharedVaultAttachmentReference[];
}

export class SharedVaultError extends Error {
  constructor(readonly code: 'INVALID_ARGUMENT' | 'NOT_FOUND' | 'NOT_AUTHORIZED' | 'INVALID_SIGNATURE' | 'INVALID_EPOCH' | 'REPLAY' | 'BOUNDS_EXCEEDED' | 'CORRUPT_STATE' | 'TRANSPORT' | 'PRIVATE_KEY_UNAVAILABLE' | 'CONFLICT', message: string) { super(message); this.name = 'SharedVaultError'; }
}

interface ReplicaRecord { readonly doc: Y.Doc; readonly text: Y.Text; revision: number; epoch: number; updatedAt: string; }
interface RemoteNoteRecord { readonly noteId: string; readonly vaultId: string; readonly path: string; readonly title: string; content: string; body: string; revision: number; modifiedAt: string; readonly author?: string; }
interface WireBody {
  readonly kind: 'invite' | 'event' | 'crdt' | 'canvas' | 'key' | 'ack' | 'sync';
  readonly vaultId: string;
  readonly eventId: string;
  readonly actor: string;
  readonly epoch: number;
  readonly action?: string;
  readonly noteId?: string;
  readonly update?: string;
  readonly nonce?: string;
  readonly ciphertext?: string;
  readonly data?: unknown;
}

export class SharedVaultService {
  readonly identityId: string;
  private readonly vault: VaultService;
  private readonly device?: DeviceSessionKeys;
  private readonly crypto?: CryptoProvider;
  private readonly privateKey?: string;
  private readonly trustedPublicKeys: Readonly<Record<string, string>>;
  private readonly trustedEncryptionPublicKeys: Readonly<Record<string, string>>;
  private readonly transport?: KeystoneDeliveryInterface;
  private readonly security?: EnvelopeSecurity;
  private readonly state: SharedVaultStateStore;
  private readonly canvas?: CanvasService;
  private readonly now: () => number;
  private readonly maxPending: number;
  private readonly onError?: (error: unknown) => void;
  private readonly records = new Map<string, SharedVault>();
  private readonly replicas = new Map<string, ReplicaRecord>();
  private readonly pending: SharedVaultPendingMessage[] = [];
  private readonly inboundPending: Envelope[] = [];
  private readonly seen = new Set<string>();
  private readonly presence = new Map<string, SharedVaultPresence>();
  private readonly sessions = new Map<string, VaultCollaborationSession>();
  private readonly remoteNotes = new Map<string, RemoteNoteRecord>();
  private readonly vaultNoteIds = new Map<string, Set<string>>();
  private readonly memberEncryptionKeys = new Map<string, string>();
  private readonly sharedCanvases = new Map<string, CanvasDocument>();
  private readonly attachmentReferences = new Map<string, SharedVaultAttachmentReference>();
  private readonly peers = new Map<string, DeviceSessionKeys>();
  private readonly protectedSurfaces: MandatorySafetySurfaceRegistry;
  private readonly containment: FileContainmentService;
  private readyPromise: Promise<void>;
  private unsubscribe?: () => void;

  constructor(options: SharedVaultServiceOptions) {
    this.vault = options.vault; this.identityId = options.identityId ?? options.vault.identityId; this.device = options.device; this.crypto = options.crypto; this.privateKey = options.privateKey ?? options.device?.privateKey; this.trustedPublicKeys = options.trustedPublicKeys ?? {}; this.trustedEncryptionPublicKeys = options.trustedEncryptionPublicKeys ?? {}; if (this.device) this.memberEncryptionKeys.set(this.identityId, this.device.encryptionPublicKey); Object.entries(this.trustedEncryptionPublicKeys).forEach(([identityId, key]) => this.memberEncryptionKeys.set(identityId, key)); this.transport = options.transport; this.security = options.security; this.state = options.state ?? new InMemorySharedVaultStateStore(); this.canvas = options.canvas; this.now = options.now ?? Date.now; this.maxPending = clamp(options.maxPending ?? SHARED_VAULT_MAX_PENDING, 1, SHARED_VAULT_MAX_PENDING); this.onError = options.onError; this.protectedSurfaces = options.protectedSurfaces ?? new MandatorySafetySurfaceRegistry(new SafetySurfaceGate(new SafetyRuntime())); this.containment = options.containment ?? new FileContainmentService();
    if (this.transport) this.unsubscribe = this.transport.onMessage(envelope => { void this.receiveAuthorized(envelope).catch(error => this.onError?.(error)); });
    this.readyPromise = this.hydrate();
  }
  async ready(): Promise<void> { await this.readyPromise; }
  async close(): Promise<void> { this.unsubscribe?.(); this.unsubscribe = undefined; await this.persist(); }
  async list(actor = this.identityId): Promise<readonly SharedVault[]> { await this.ready(); const values = [...this.records.values()].filter(value => this.isMember(value, actor)); return (await Promise.all(values.map(async value => await this.surfaceEligible(value.id, value.visibility === 'public' ? 'PUBLIC' : 'SHARED_SPACE', value) ? clone(value) : undefined))).filter((value): value is SharedVault => !!value); }
  async get(vaultId: string, actor = this.identityId): Promise<SharedVault | undefined> { await this.ready(); const value = this.records.get(vaultId); if (!value || !this.isMember(value, actor) || !await this.surfaceEligible(value.id, value.visibility === 'public' ? 'PUBLIC' : 'SHARED_SPACE', value)) return undefined; return clone(value); }
  async create(input: SharedVaultCreateInput, actor = this.identityId): Promise<SharedVault> { await this.ready(); if (actor !== this.identityId) throw new SharedVaultError('NOT_AUTHORIZED', 'Only the local identity may create a Vault'); const now = iso(this.now()); const id = input.id ?? randomId('shared-vault'); const historyPolicy = input.historyPolicy ?? 'CURRENT_STATE_ONLY'; if (historyPolicy === 'SHARED_HISTORY' && !this.hasSecureHistory()) throw new SharedVaultError('NOT_AUTHORIZED', 'Shared history requires an authenticated encrypted host'); const epoch = makeEpoch(1, now, 'manual'); const members: SharedVaultMembership[] = [{ identityId: actor, role: 'owner', permissions: [...ALL_PERMISSIONS], joinedAt: now, addedBy: actor }]; const value: SharedVault = { version: 1, id: safeId(id), ownerIdentityId: actor, kind: input.kind ?? 'SHARED', title: bounded(input.title, 240, true), ...(input.description ? { description: bounded(input.description, 4_000) } : {}), visibility: input.visibility ?? 'private', historyPolicy, members, epoch, revision: 1, createdAt: now, updatedAt: now, ...(await this.signObject({ id, ownerIdentityId: actor, kind: input.kind ?? 'SHARED', title: input.title, visibility: input.visibility ?? 'private', epoch })) }; if (value.kind === 'SHARED' && !(await this.surfaceEligible(value.id, value.visibility === 'public' ? 'PUBLIC' : 'SHARED_SPACE', value))) throw new SharedVaultError('NOT_AUTHORIZED', 'Shared Vault object failed mandatory safety gating'); this.records.set(id, value); this.setEpochKey(id, epoch.epoch, await randomKey()); await this.persist(); return clone(value); }
  createSharedVault(input: SharedVaultCreateInput, actor?: string): Promise<SharedVault> { return this.create(input, actor); }
  async invite(vaultId: string, recipientIdentityId: string, recipientDevice?: DeviceSessionKeys, actor = this.identityId): Promise<SharedVaultInvitation> { await this.ready(); let record = this.require(vaultId); this.assertPermission(record, actor, 'INVITE'); const recipient = safeIdentity(recipientIdentityId); if (recipientDevice) this.memberEncryptionKeys.set(recipient, recipientDevice.encryptionPublicKey); if (!record.members.some(value => value.identityId === recipient && !value.removedAt)) record = await this.addMember(vaultId, recipient, 'editor', undefined, actor); const now = this.now(); const expiresAt = new Date(now + 86_400_000).toISOString(); let wrappedKey: SharedVaultInvitation['wrappedKey']; if (record.visibility !== 'public') { const key = this.epochKey(record.id, record.epoch.epoch); if (!key || !recipientDevice || !this.device) throw new SharedVaultError('PRIVATE_KEY_UNAVAILABLE', 'Private invite requires recipient and device encryption keys'); wrappedKey = await sealKey(recipientDevice, key, this.device.encryptionPrivateKey, this.device.encryptionPublicKey); }
    const unsigned = { version: 1 as const, id: randomId('invite'), vault: clone(record), recipientIdentityId: recipient, inviterIdentityId: actor, epoch: record.epoch.epoch, ...(wrappedKey ? { wrappedKey } : {}), createdAt: new Date(now).toISOString(), expiresAt }; const signature = await this.sign(canonicalJson(unsigned), actor); const invitation = { ...unsigned, signature }; await this.sendTo(recipient, { kind: 'invite', vaultId, eventId: invitation.id, actor, epoch: record.epoch.epoch, data: invitation }); return clone(invitation); }
  async acceptInvite(invitation: SharedVaultInvitation, actor = this.identityId): Promise<SharedVault> { await this.ready(); if (invitation.version !== 1 || invitation.recipientIdentityId !== actor || Date.parse(invitation.expiresAt) <= this.now()) throw new SharedVaultError('NOT_AUTHORIZED', 'Invitation is expired or addressed to another identity'); if (!(await this.verifyObject(invitation, invitation.inviterIdentityId))) throw new SharedVaultError('INVALID_SIGNATURE', 'Invitation signature rejected'); if (!(await this.surfaceEligible(invitation.vault.id, invitation.vault.visibility === 'public' ? 'PUBLIC' : 'SHARED_SPACE', invitation.vault))) throw new SharedVaultError('NOT_AUTHORIZED', 'Shared Vault invitation failed mandatory safety gating'); const current = this.records.get(invitation.vault.id); if (current && current.epoch.epoch > invitation.epoch) throw new SharedVaultError('INVALID_EPOCH', 'Invitation uses an old epoch'); if (invitation.vault.visibility !== 'public') { if (!invitation.wrappedKey || !this.device) throw new SharedVaultError('PRIVATE_KEY_UNAVAILABLE', 'Private invite key is unavailable'); const senderKey = invitation.wrappedKey.senderEncryptionPublicKey; if (!senderKey || this.trustedEncryptionPublicKeys[invitation.inviterIdentityId] && this.trustedEncryptionPublicKeys[invitation.inviterIdentityId] !== senderKey) throw new SharedVaultError('INVALID_SIGNATURE', 'Inviter encryption key is unknown'); const key = await openKey(invitation.wrappedKey, this.device.encryptionPrivateKey, senderKey); this.setEpochKey(invitation.vault.id, invitation.epoch, key); }
    const alreadyMember = invitation.vault.members.some(value => value.identityId === actor); const members: SharedVaultMembership[] = alreadyMember ? [...invitation.vault.members] : [...invitation.vault.members, { identityId: actor, role: 'viewer', permissions: ['VIEW'], joinedAt: new Date(this.now()).toISOString(), addedBy: invitation.inviterIdentityId }]; if (invitation.wrappedKey) this.memberEncryptionKeys.set(invitation.inviterIdentityId, invitation.wrappedKey.senderEncryptionPublicKey); const value: SharedVault = { ...invitation.vault, members, revision: invitation.vault.revision + (alreadyMember ? 0 : 1), updatedAt: iso(this.now()) }; this.records.set(value.id, value); await this.persist(); await this.drainInbound(value.id); return clone(value); }
  async addMember(vaultId: string, identityId: string, role: SharedVaultRole = 'editor', permissions?: readonly SharedVaultPermission[], actor = this.identityId): Promise<SharedVault> { const record = this.require(vaultId); this.assertPermission(record, actor, 'INVITE'); if (record.members.some(value => value.identityId === identityId && !value.removedAt)) return clone(record); const member: SharedVaultMembership = { identityId: safeIdentity(identityId), role, permissions: [...(permissions ?? rolePermissions(role))], joinedAt: iso(this.now()), addedBy: actor }; return this.updateMembership(record, [...record.members, member], 'join', actor); }
  async removeMember(vaultId: string, identityId: string, reason: 'leave' | 'kick' | 'ban' | 'device-revocation' = 'kick', actor = this.identityId): Promise<SharedVault> { const record = this.require(vaultId); this.assertPermission(record, actor, 'REMOVE_MEMBER'); if (identityId === record.ownerIdentityId) throw new SharedVaultError('NOT_AUTHORIZED', 'Vault owner cannot be removed'); const members = record.members.map(member => member.identityId === identityId ? { ...member, removedAt: iso(this.now()), revokedAt: reason === 'ban' ? iso(this.now()) : member.revokedAt } : member); return this.updateMembership(record, members, reason, actor); }
  async revokeDevice(vaultId: string, identityId: string, deviceId: string, actor = this.identityId): Promise<SharedVault> { const record = this.require(vaultId); this.assertPermission(record, actor, 'MANAGE_PERMISSIONS'); const members = record.members.map(member => member.identityId === identityId ? { ...member, devices: (member.devices ?? []).filter(value => value !== deviceId) } : member); return this.updateMembership(record, members, 'device-revocation', actor); }
  async setPermissions(vaultId: string, identityId: string, permissions: readonly SharedVaultPermission[], actor = this.identityId): Promise<SharedVault> { const record = this.require(vaultId); this.assertPermission(record, actor, 'MANAGE_PERMISSIONS'); const normalized = normalizePermissions(permissions); const members = record.members.map(member => member.identityId === identityId ? { ...member, permissions: normalized } : member); return this.updateMembership(record, members, 'permissions', actor); }
  can(vaultId: string, identityId: string, permission: SharedVaultPermission): boolean { const value = this.records.get(vaultId); return !!value && this.isMember(value, identityId) && hasPermission(value, identityId, permission); }

  async createNote(vaultId: string, input: SharedVaultNoteInput, actor = this.identityId): Promise<MarkdownNote> { const record = this.require(vaultId); this.assertPermission(record, actor, 'CREATE_NOTE'); const note = await this.vault.createNote(input, actor); if (!(await this.surfaceEligible(`${vaultId}:${note.id}`, record.visibility === 'public' ? 'PUBLIC' : 'SHARED_SPACE', note))) throw new SharedVaultError('NOT_AUTHORIZED', 'Shared Vault note failed mandatory SafetySurfaceGate'); this.noteIds(vaultId).add(note.id); this.remoteNotes.set(`${vaultId}:${note.id}`, { noteId: note.id, vaultId, path: note.path, title: note.title, content: note.content, body: note.body, revision: note.revision, modifiedAt: note.modifiedAt, author: actor }); await this.broadcastEvent(record, 'create_note', actor, { noteId: note.id, path: note.path, title: note.title, content: note.content, body: note.body, revision: note.revision }); return note; }
  async readNote(vaultId: string, noteId: string, actor = this.identityId): Promise<MarkdownNote | undefined> { const record = this.require(vaultId); this.assertPermission(record, actor, 'VIEW'); if (!this.noteIds(vaultId).has(noteId) && !this.remoteNotes.has(`${vaultId}:${noteId}`)) return undefined; const note = await this.vault.getNote(noteId, actor); if (note && await this.surfaceEligible(`${vaultId}:${note.id}`, record.visibility === 'public' ? 'PUBLIC' : 'SHARED_SPACE', note)) return note; const remote = this.remoteNotes.get(`${vaultId}:${noteId}`); const value = remote ? remoteMarkdown(remote) : undefined; return value && await this.surfaceEligible(`${vaultId}:${value.id}`, record.visibility === 'public' ? 'PUBLIC' : 'SHARED_SPACE', value) ? value : undefined; }
  async listNotes(vaultId: string, actor = this.identityId): Promise<readonly MarkdownNote[]> { const record = this.require(vaultId); this.assertPermission(record, actor, 'VIEW'); const notes: MarkdownNote[] = []; for (const noteId of this.noteIds(vaultId)) { const note = await this.vault.getNote(noteId, actor); if (note && await this.surfaceEligible(`${vaultId}:${note.id}`, record.visibility === 'public' ? 'PUBLIC' : 'SHARED_SPACE', note)) notes.push(note); } for (const value of this.remoteNotes.values()) if (value.vaultId === vaultId && !notes.some(note => note.id === value.noteId)) { const note = remoteMarkdown(value); if (await this.surfaceEligible(`${vaultId}:${note.id}`, record.visibility === 'public' ? 'PUBLIC' : 'SHARED_SPACE', note)) notes.push(note); } return notes; }
  async updateNote(vaultId: string, noteId: string, update: SharedVaultNoteUpdate, actor = this.identityId): Promise<MarkdownNote> { const record = this.require(vaultId); this.assertPermission(record, actor, 'EDIT'); if (!this.noteIds(vaultId).has(noteId)) throw new SharedVaultError('NOT_FOUND', 'Shared note not found'); if (update.content.length > SHARED_VAULT_MAX_OBJECT_BYTES) throw new SharedVaultError('BOUNDS_EXCEEDED', 'Shared note update is too large'); const local = await this.vault.getNote(noteId, actor); const current = this.remoteNotes.get(`${vaultId}:${noteId}`); if (!local && !current) throw new SharedVaultError('NOT_FOUND', 'Shared note not found'); if (update.baseRevision !== undefined && update.baseRevision !== (local?.revision ?? current?.revision)) throw new SharedVaultError('CONFLICT', 'Shared note base revision is stale'); const note = local ? await this.vault.updateNote(noteId, { content: update.content, ...(update.baseRevision === undefined ? {} : { baseRevision: update.baseRevision }) }, actor) : remoteMarkdown({ ...current!, content: update.content, body: update.content, revision: current!.revision + 1, modifiedAt: iso(this.now()) }); if (!(await this.surfaceEligible(`${vaultId}:${note.id}`, record.visibility === 'public' ? 'PUBLIC' : 'SHARED_SPACE', note))) throw new SharedVaultError('NOT_AUTHORIZED', 'Shared Vault note failed mandatory SafetySurfaceGate'); this.remoteNotes.set(`${vaultId}:${noteId}`, { noteId, vaultId, path: note.path, title: note.title, content: note.content, body: note.body, revision: note.revision, modifiedAt: note.modifiedAt, author: current?.author ?? actor }); await this.broadcastEvent(record, 'update_note', actor, { noteId, revision: note.revision, content: note.content, body: note.body }); return note; }
  async deleteNote(vaultId: string, noteId: string, actor = this.identityId): Promise<void> { const record = this.require(vaultId); if (!this.noteIds(vaultId).has(noteId)) throw new SharedVaultError('NOT_FOUND', 'Shared note not found'); const note = await this.vault.getNote(noteId, actor); const remote = this.remoteNotes.get(`${vaultId}:${noteId}`); if (!note && !remote) throw new SharedVaultError('NOT_FOUND', 'Shared note not found'); const owns = remote?.author === actor; const allowed = hasPermission(record, actor, 'DELETE_ALL') || (hasPermission(record, actor, 'DELETE_OWN') && owns); if (!allowed) throw new SharedVaultError('NOT_AUTHORIZED', 'Deleting this note is not allowed'); if (note) await this.vault.deleteNote(noteId, actor); this.noteIds(vaultId).delete(noteId); this.remoteNotes.delete(`${vaultId}:${noteId}`); await this.broadcastEvent(record, 'delete_note', actor, { noteId }); }
  async moveNote(vaultId: string, noteId: string, folder: string, actor = this.identityId): Promise<MarkdownNote> { const record = this.require(vaultId); this.assertPermission(record, actor, 'MOVE'); if (!this.noteIds(vaultId).has(noteId)) throw new SharedVaultError('NOT_FOUND', 'Shared note not found'); const local = await this.vault.getNote(noteId, actor); const current = this.remoteNotes.get(`${vaultId}:${noteId}`); if (!local && !current) throw new SharedVaultError('NOT_FOUND', 'Shared note not found'); const note = local ? await this.vault.moveNote(noteId, folder, actor) : remoteMarkdown({ ...current!, path: cleanSharedPath(folder, current!.path), modifiedAt: iso(this.now()) }); if (!(await this.surfaceEligible(`${vaultId}:${note.id}`, record.visibility === 'public' ? 'PUBLIC' : 'SHARED_SPACE', note))) throw new SharedVaultError('NOT_AUTHORIZED', 'Shared Vault note failed mandatory SafetySurfaceGate'); this.remoteNotes.set(`${vaultId}:${noteId}`, { noteId, vaultId, path: note.path, title: note.title, content: note.content, body: note.body, revision: note.revision, modifiedAt: note.modifiedAt, ...(current?.author ? { author: current.author } : {}) }); await this.broadcastEvent(record, 'move_note', actor, { noteId, path: note.path }); return note; }

  async applyCrdtUpdate(vaultId: string, noteId: string, update: Uint8Array, actor = this.identityId, epoch = this.require(vaultId).epoch.epoch): Promise<VaultDocumentReplica> { const record = this.require(vaultId); this.assertPermission(record, actor, 'EDIT'); if (update.byteLength > SHARED_VAULT_MAX_OBJECT_BYTES) throw new SharedVaultError('BOUNDS_EXCEEDED', 'CRDT update is too large'); if (epoch !== record.epoch.epoch) throw new SharedVaultError('INVALID_EPOCH', 'CRDT update epoch is stale'); const key = `${vaultId}:${noteId}`; const replica = this.replica(key, record.epoch.epoch); const updateId = await digest(update); if (this.seen.has(updateId)) throw new SharedVaultError('REPLAY', 'CRDT update was already applied'); this.seen.add(updateId); Y.applyUpdate(replica.doc, update, this); const text = replica.text.toString(); const note = await this.vault.getNote(noteId, actor); const remote = this.remoteNotes.get(`${vaultId}:${noteId}`); if (!note && !remote) throw new SharedVaultError('NOT_FOUND', 'CRDT note not found'); if (note) { const next = await this.vault.updateNote(noteId, { content: text, baseRevision: note.revision }, actor).catch((error: unknown) => { if (error instanceof VaultError && error.code === 'CONFLICT') throw new SharedVaultError('CONFLICT', error.message); throw error; }); this.remoteNotes.set(`${vaultId}:${noteId}`, { noteId, vaultId, path: next.path, title: next.title, content: next.content, body: next.body, revision: next.revision, modifiedAt: next.modifiedAt, ...(remote?.author ? { author: remote.author } : {}) }); replica.revision = next.revision; } else { const current = remote as RemoteNoteRecord; const next = remoteMarkdown({ ...current, content: text, body: text, revision: current.revision + 1, modifiedAt: iso(this.now()) }); this.remoteNotes.set(`${vaultId}:${noteId}`, { noteId, vaultId, path: next.path, title: next.title, content: next.content, body: next.body, revision: next.revision, modifiedAt: next.modifiedAt, ...(current.author ? { author: current.author } : {}) }); replica.revision = next.revision; } replica.updatedAt = iso(this.now()); replica.epoch = epoch; await this.persist(); await this.broadcastCrdt(record, noteId, update, actor, epoch, updateId); return this.replicaSnapshot(vaultId, noteId, replica); }
  async openReplica(vaultId: string, noteId: string, actor = this.identityId): Promise<VaultDocumentReplica> { const record = this.require(vaultId); this.assertPermission(record, actor, 'VIEW'); const note = await this.vault.getNote(noteId, actor); const remote = this.remoteNotes.get(`${vaultId}:${noteId}`); if (!note && !remote) throw new SharedVaultError('NOT_FOUND', 'Shared note not found'); const replica = this.replica(`${vaultId}:${noteId}`, record.epoch.epoch); const body = note?.body ?? remote?.body ?? ''; if (replica.text.length === 0 && body) replica.text.insert(0, body); replica.revision = note?.revision ?? remote?.revision ?? replica.revision; return this.replicaSnapshot(vaultId, noteId, replica); }
  getDocumentReplica(vaultId: string, noteId: string, actor = this.identityId): Promise<VaultDocumentReplica> { return this.openReplica(vaultId, noteId, actor); }
  async applyCanvasMutation(vaultId: string, canvasId: string, mutation: CanvasMutation, actor = this.identityId): Promise<CanvasDocument> { const record = this.require(vaultId); this.assertPermission(record, actor, 'MANAGE_CANVAS'); let current = this.sharedCanvases.get(`${vaultId}:${canvasId}`); if (!current && this.canvas) { try { const local = await this.canvas.getCanvas(canvasId, actor); if (local) current = normalizeSharedCanvas(local, vaultId); } catch { /* a remote Shared Vault may not have a local Canvas file */ } } if (!current) current = emptySharedCanvas(canvasId, vaultId, `Shared Vault: ${record.title}`, this.now()); const next = applySharedCanvasMutation(current, mutation, this.now()); this.sharedCanvases.set(`${vaultId}:${canvasId}`, next); if (this.canvas) { try { const local = await this.canvas.getCanvas(canvasId, actor); if (local) await this.canvas.applyMutation(canvasId, { ...mutation, baseRevision: local.revision }, actor); } catch { /* shared projection remains durable even when a host has no local canvas file */ } } await this.persist(); await this.broadcastEvent(record, 'canvas_mutation', actor, { canvasId, mutation, document: next }); return clone(next); }
  async getSharedCanvas(vaultId: string, canvasId: string, actor = this.identityId): Promise<CanvasDocument | undefined> { await this.ready(); const record = this.require(vaultId); this.assertPermission(record, actor, 'VIEW'); const value = this.sharedCanvases.get(`${vaultId}:${canvasId}`); return value && await this.surfaceEligible(`${vaultId}:${value.id}`, record.visibility === 'public' ? 'PUBLIC' : 'SHARED_SPACE', value) ? clone(value) : undefined; }
  async listSharedCanvases(vaultId: string, actor = this.identityId): Promise<readonly CanvasDocument[]> { await this.ready(); const record = this.require(vaultId); this.assertPermission(record, actor, 'VIEW'); const safe: CanvasDocument[] = []; for (const value of this.sharedCanvases.values()) if (value.vaultId === vaultId && await this.surfaceEligible(`${vaultId}:${value.id}`, record.visibility === 'public' ? 'PUBLIC' : 'SHARED_SPACE', value)) safe.push(clone(value)); return safe; }
  async addAttachmentReference(vaultId: string, input: SharedVaultAttachmentInput, actor = this.identityId): Promise<SharedVaultAttachmentReference> { const record = this.require(vaultId); this.assertPermission(record, actor, 'MANAGE_ATTACHMENTS'); if (record.visibility !== 'public' && !input.encryptedContentId) throw new SharedVaultError('PRIVATE_KEY_UNAVAILABLE', 'Private attachment requires an encrypted content reference'); const contentId = record.visibility === 'public' ? safeContentId(input.contentId ?? '') : safeContentId(input.encryptedContentId ?? ''); if (!Number.isSafeInteger(input.size) || input.size < 0 || input.size > SHARED_VAULT_MAX_OBJECT_BYTES * 1024) throw new SharedVaultError('BOUNDS_EXCEEDED', 'Attachment size is outside the safe bound'); const value: SharedVaultAttachmentReference = { version: 1, id: safeId(input.id ?? randomId('shared-attachment')), vaultId, contentId, ...(input.sourceAttachmentId ? { sourceAttachmentId: safeId(input.sourceAttachmentId) } : {}), name: bounded(input.name, 512, true), mimeType: bounded(input.mimeType, 160, true), size: input.size, ownerIdentityId: actor, encrypted: record.visibility !== 'public', createdAt: iso(this.now()) }; if (!(await this.surfaceEligible(`${vaultId}:${value.id}`, record.visibility === 'public' ? 'PUBLIC' : 'SHARED_SPACE', value))) throw new SharedVaultError('NOT_AUTHORIZED', 'Shared Vault attachment failed mandatory SafetySurfaceGate'); this.attachmentReferences.set(`${vaultId}:${value.id}`, value); await this.persist(); await this.broadcastEvent(record, 'attachment_ref', actor, value); return clone(value); }
  /** Decrypted attachment bytes are still untrusted input and enter quarantine
   * before a host can inspect or render them. The stored reference remains an
   * opaque content ID; ciphertext itself is never classified as plaintext. */
  async materializeAttachmentBytes(vaultId: string, attachmentId: string, bytes: Uint8Array, actor = this.identityId, sourceIdentity = actor): Promise<QuarantineEntry> {
    const record = this.require(vaultId); this.assertPermission(record, actor, 'VIEW'); const reference = this.attachmentReferences.get(`${vaultId}:${safeId(attachmentId)}`); if (!reference) throw new SharedVaultError('NOT_FOUND', 'Shared Vault attachment reference not found');
    const contentHash = `sha256-${await sha256(bytes)}`; return this.containment.receive({ version: 1, transferId: `vault:${vaultId}:${reference.id}`, sourceIdentity, objectId: reference.sourceAttachmentId ?? reference.id, ...(reference.encrypted ? {} : { contentId: reference.contentId }), filename: reference.name, mimeType: reference.mimeType, size: bytes.byteLength, visibility: record.visibility === 'public' ? 'shared' : 'private', encrypted: false, provenance: [{ kind: 'SHARED', contentHash, objectId: reference.sourceAttachmentId ?? reference.id, sourceIdentity, at: iso(this.now()) }] }, bytes);
  }
  receiveSharedAttachmentBytes(vaultId: string, attachmentId: string, bytes: Uint8Array, actor?: string, sourceIdentity?: string): Promise<QuarantineEntry> { return this.materializeAttachmentBytes(vaultId, attachmentId, bytes, actor, sourceIdentity); }
  async listAttachmentReferences(vaultId: string, actor = this.identityId): Promise<readonly SharedVaultAttachmentReference[]> { await this.ready(); const record = this.require(vaultId); this.assertPermission(record, actor, 'VIEW'); const safe: SharedVaultAttachmentReference[] = []; for (const value of this.attachmentReferences.values()) if (value.vaultId === vaultId && await this.surfaceEligible(`${vaultId}:${value.id}`, record.visibility === 'public' ? 'PUBLIC' : 'SHARED_SPACE', value)) safe.push(clone(value)); return safe; }
  async removeAttachmentReference(vaultId: string, attachmentId: string, actor = this.identityId): Promise<void> { const record = this.require(vaultId); this.assertPermission(record, actor, 'MANAGE_ATTACHMENTS'); const key = `${vaultId}:${safeId(attachmentId)}`; if (!this.attachmentReferences.delete(key)) throw new SharedVaultError('NOT_FOUND', 'Shared attachment reference not found'); await this.persist(); await this.broadcastEvent(record, 'attachment_ref_delete', actor, { attachmentId }); }
  async setPresence(vaultId: string, value: Omit<SharedVaultPresence, 'expiresAt'> & { ttlMs?: number }): Promise<SharedVaultPresence> { const record = this.require(vaultId); this.assertPermission(record, value.identityId, 'VIEW'); const expiresAt = new Date(this.now() + clamp(value.ttlMs ?? 30_000, 1_000, 120_000)).toISOString(); const presence = { ...value, expiresAt }; this.presence.set(`${vaultId}:${value.identityId}`, presence); while (this.presence.size > SHARED_VAULT_MAX_PRESENCE) this.presence.delete(this.presence.keys().next().value as string); return clone(presence); }
  listPresence(vaultId: string): readonly SharedVaultPresence[] { const now = this.now(); return [...this.presence.entries()].filter(([key, value]) => key.startsWith(`${vaultId}:`) && Date.parse(value.expiresAt) > now).map(([, value]) => clone(value)); }
  startSession(vaultId: string, actor = this.identityId): VaultCollaborationSession { const record = this.require(vaultId); this.assertPermission(record, actor, 'VIEW'); const now = iso(this.now()); const session: VaultCollaborationSession = { version: 1, id: randomId('vault-session'), vaultId, actorIdentityId: actor, startedAt: now, lastActivityAt: now, state: 'ACTIVE' }; this.sessions.set(session.id, session); return clone(session); }
  endSession(sessionId: string, state: 'ENDED' | 'OFFLINE' | 'REVOKED' = 'ENDED'): void { const current = this.sessions.get(sessionId); if (current) this.sessions.set(sessionId, { ...current, state, lastActivityAt: iso(this.now()) }); }
  async flushPending(): Promise<void> { for (const value of [...this.pending]) { try { await this.transport?.connect(value.peer); await this.transport?.send(value.peer, value.envelope); this.pending.splice(this.pending.indexOf(value), 1); } catch { /* retained for a later reconnect */ } } await this.persist(); }
  pendingCount(): number { return this.pending.length; }

  private async updateMembership(record: SharedVault, members: readonly SharedVaultMembership[], reason: SharedVaultKeyEpoch['rotatedFor'], actor: string): Promise<SharedVault> { const nextEpoch = makeEpoch(record.epoch.epoch + 1, iso(this.now()), reason, reason === 'kick' || reason === 'ban' || reason === 'leave' ? members.filter(value => value.removedAt).map(value => value.identityId) : undefined); const value: SharedVault = { ...record, members: members.map(clone), epoch: nextEpoch, revision: record.revision + 1, updatedAt: iso(this.now()), ...(await this.signObject({ id: record.id, revision: record.revision + 1, epoch: nextEpoch.epoch, actor })) }; const key = await randomKey(); if (record.visibility !== 'public' && this.transport && (!this.device || !this.privateKey || !this.crypto || !this.security)) throw new SharedVaultError('PRIVATE_KEY_UNAVAILABLE', 'Private membership rotation requires authenticated device encryption'); if (record.visibility !== 'public' && this.transport) for (const member of value.members) if (member.identityId !== this.identityId && !member.removedAt && !member.revokedAt && !this.memberEncryptionKey(member.identityId)) throw new SharedVaultError('PRIVATE_KEY_UNAVAILABLE', `Encryption key for member ${member.identityId} is unavailable`); this.records.set(record.id, value); this.setEpochKey(record.id, nextEpoch.epoch, key); await this.persist(); if (record.visibility === 'public') await this.broadcastEvent(value, 'membership', actor, { vault: value }); else if (this.transport) await this.broadcastMembership(value, actor, key); return clone(value); }
  private async broadcastMembership(record: SharedVault, actor: string, key: Uint8Array): Promise<void> { for (const member of record.members) { if (member.identityId === this.identityId || member.removedAt || member.revokedAt) continue; const publicKey = this.memberEncryptionKey(member.identityId); if (!publicKey || !this.device || !this.privateKey) throw new SharedVaultError('PRIVATE_KEY_UNAVAILABLE', `Encryption key for member ${member.identityId} is unavailable`); const wrappedKey = await sealKeyForPublicKey(publicKey, key, this.device.encryptionPrivateKey, this.device.encryptionPublicKey); const encrypted = await encryptBytes(key, new TextEncoder().encode(canonicalJson(record)), `vault:${record.id}:${record.epoch.epoch}:membership`); await this.sendTo(member.identityId, { kind: 'key', vaultId: record.id, eventId: randomId('vault-key-update'), actor, epoch: record.epoch.epoch, data: { wrappedKey, nonce: encrypted.nonce, ciphertext: encrypted.ciphertext } }); } }
  private async broadcastEvent(record: SharedVault, action: string, actor: string, data: unknown): Promise<void> { const eventId = randomId('vault-event'); const plaintext = { kind: 'event' as const, vaultId: record.id, eventId, actor, epoch: record.epoch.epoch, action, data }; if (!(await this.surfaceEligible(record.id, record.visibility === 'public' ? 'PUBLIC' : 'SHARED_SPACE', data))) throw new SharedVaultError('NOT_AUTHORIZED', 'Shared Vault event failed mandatory SafetySurfaceGate'); this.seen.add(eventId); const payload = await this.encryptWire(record, plaintext); for (const member of record.members) if (member.identityId !== this.identityId && !member.removedAt) await this.sendTo(member.identityId, payload); await this.persist(); }
  private async broadcastCrdt(record: SharedVault, noteId: string, update: Uint8Array, actor: string, epoch: number, updateId: string): Promise<void> { const body = await this.encryptWire(record, { kind: 'crdt', vaultId: record.id, eventId: updateId, actor, epoch, noteId, update: encode(update) }); for (const member of record.members) if (member.identityId !== this.identityId && !member.removedAt) await this.sendTo(member.identityId, body); }
  private async sendTo(peer: string, body: WireBody): Promise<void> { if (!this.transport) return; const record = this.records.get(body.vaultId); if (!(await this.wireSurfaceEligible(body, record))) throw new SharedVaultError('NOT_AUTHORIZED', 'Shared Vault payload failed mandatory SafetySurfaceGate'); if (new TextEncoder().encode(canonicalJson(body)).byteLength > SHARED_VAULT_MAX_OBJECT_BYTES) throw new SharedVaultError('BOUNDS_EXCEEDED', 'Shared Vault envelope is too large'); const unsigned: UnsignedEnvelope = { version: 1, type: 'shared-vault', id: randomId('envelope'), sender: this.identityId, recipient: peer, nonce: randomId('nonce'), expiresAt: new Date(this.now() + 120_000).toISOString(), body }; const envelope: Envelope = { ...unsigned, signature: this.security ? await this.security.sign(unsigned) : await this.sign(canonicalJson(unsigned), this.identityId) }; try { await this.transport.connect(peer); await this.transport.send(peer, envelope); } catch (error) { this.onError?.(error); this.pending.push({ peer, envelope }); while (this.pending.length > this.maxPending) this.pending.shift(); }
  }
  private queueInbound(envelope: Envelope): void { if (this.inboundPending.some(value => value.id === envelope.id)) return; this.inboundPending.push(envelope); while (this.inboundPending.length > 256) this.inboundPending.shift(); }
  private async drainInbound(vaultId: string): Promise<void> { const all = this.inboundPending.splice(0); const queued = all.filter(envelope => parseWire(envelope.body)?.vaultId === vaultId); this.inboundPending.push(...all.filter(envelope => !queued.includes(envelope))); for (const envelope of queued) await this.receiveAuthorized(envelope).catch(error => this.onError?.(error)); }
  private async receiveLegacy(envelope: Envelope): Promise<void> { if (envelope.type !== 'shared-vault' || envelope.recipient !== this.identityId || Date.parse(envelope.expiresAt) <= this.now() || this.seen.has(envelope.id) || !this.peerKnown(envelope.sender)) return; if (this.security && !(await this.security.verify(envelope))) throw new SharedVaultError('INVALID_SIGNATURE', 'Shared Vault envelope signature rejected'); if (!this.security && this.crypto && !(await this.verify(canonicalJson(stripSignature(envelope)), envelope.signature, envelope.sender))) return; this.seen.add(envelope.id); let body = parseWire(envelope.body); if (!body) throw new SharedVaultError('INVALID_ARGUMENT', 'Malformed Shared Vault envelope'); if (body.kind === 'invite') { if (body.data && isInvitation(body.data)) await this.acceptInvite(body.data, this.identityId); return; } const record = this.records.get(body.vaultId); if (!record || !this.isMember(record, envelope.sender)) throw new SharedVaultError('NOT_AUTHORIZED', 'Sender is not a Shared Vault member'); if (body.kind === 'key') { if (record.visibility === 'public' || body.epoch !== record.epoch.epoch + 1 || !this.device || !isRecord(body.data)) throw new SharedVaultError('INVALID_EPOCH', 'Shared Vault key update rejected'); const wrapped = body.data.wrappedKey; const nonce = body.data.nonce; const ciphertext = body.data.ciphertext; if (!isWrappedKey(wrapped) || typeof nonce !== 'string' || typeof ciphertext !== 'string') throw new SharedVaultError('INVALID_ARGUMENT', 'Malformed Shared Vault key update'); const knownSenderKey = this.memberEncryptionKey(envelope.sender); if (knownSenderKey && knownSenderKey !== wrapped.senderEncryptionPublicKey) throw new SharedVaultError('INVALID_SIGNATURE', 'Shared Vault sender encryption key changed unexpectedly'); const key = await openKey(wrapped, this.device.encryptionPrivateKey, wrapped.senderEncryptionPublicKey); const plaintext = await decryptBytes(key, nonce, ciphertext, `vault:${record.id}:${body.epoch}:membership`); let next: SharedVault; try { next = JSON.parse(new TextDecoder().decode(plaintext)) as SharedVault; } catch { throw new SharedVaultError('INVALID_ARGUMENT', 'Malformed Shared Vault membership update'); } if (!isSharedVault(next) || next.id !== record.id || next.epoch.epoch !== body.epoch || next.revision !== record.revision + 1 || !this.isMember(next, this.identityId)) throw new SharedVaultError('INVALID_EPOCH', 'Shared Vault membership update is invalid'); if (!next.signature || !await this.verify(canonicalJson({ id: next.id, revision: next.revision, epoch: next.epoch.epoch, actor: envelope.sender }), next.signature, envelope.sender)) throw new SharedVaultError('INVALID_SIGNATURE', 'Shared Vault membership signature rejected'); this.memberEncryptionKeys.set(envelope.sender, wrapped.senderEncryptionPublicKey); this.records.set(next.id, clone(next)); this.setEpochKey(next.id, next.epoch.epoch, key); await this.persist(); return; } if (body.epoch !== record.epoch.epoch) throw new SharedVaultError('INVALID_EPOCH', 'Shared Vault epoch rejected'); if (record.visibility !== 'public' && body.nonce && body.ciphertext) body = await this.decryptWire(record, body); if (body.kind === 'event') { const data = isRecord(body.data) ? body.data : {}; if (body.action === 'canvas_mutation') { if (!hasPermission(record, envelope.sender, 'MANAGE_CANVAS') || typeof data.canvasId !== 'string' || !isCanvasMutation(data.mutation)) throw new SharedVaultError('NOT_AUTHORIZED', 'Shared Canvas mutation rejected'); const current = this.sharedCanvases.get(`${body.vaultId}:${data.canvasId}`); const document = isCanvasDocument(data.document) ? data.document : current; if (!document) throw new SharedVaultError('NOT_FOUND', 'Shared Canvas bootstrap is unavailable'); this.sharedCanvases.set(`${body.vaultId}:${data.canvasId}`, isCanvasDocument(data.document) ? clone(data.document) : applySharedCanvasMutation(document, data.mutation, this.now())); await this.persist(); return; } const noteId = typeof data.noteId === 'string' ? data.noteId : undefined; if (body.action === 'create_note' && noteId && typeof data.path === 'string' && typeof data.content === 'string') { this.noteIds(body.vaultId).add(noteId); this.remoteNotes.set(`${body.vaultId}:${noteId}`, { noteId, vaultId: body.vaultId, path: data.path, title: typeof data.title === 'string' ? data.title : data.path, content: data.content, body: typeof data.body === 'string' ? data.body : data.content, revision: typeof data.revision === 'number' ? data.revision : 1, modifiedAt: iso(this.now()), author: envelope.sender }); } if (body.action === 'update_note' && noteId) { const current = this.remoteNotes.get(`${body.vaultId}:${noteId}`); if (current && typeof data.content === 'string') this.remoteNotes.set(`${body.vaultId}:${noteId}`, { ...current, content: data.content, body: typeof data.body === 'string' ? data.body : data.content, revision: typeof data.revision === 'number' ? data.revision : current.revision + 1, modifiedAt: iso(this.now()) }); } if (body.action === 'delete_note' && noteId) { this.noteIds(body.vaultId).delete(noteId); this.remoteNotes.delete(`${body.vaultId}:${noteId}`); } if (body.action === 'move_note' && noteId && typeof data.path === 'string') { const current = this.remoteNotes.get(`${body.vaultId}:${noteId}`); if (current) this.remoteNotes.set(`${body.vaultId}:${noteId}`, { ...current, path: data.path, modifiedAt: iso(this.now()) }); } await this.persist(); return; } if (body.kind === 'crdt') { if (!body.noteId || !body.update) throw new SharedVaultError('INVALID_ARGUMENT', 'Malformed CRDT body'); const update = decode(body.update); const replica = this.replica(`${body.vaultId}:${body.noteId}`, body.epoch); const updateId = body.eventId; if (this.seen.has(updateId)) throw new SharedVaultError('REPLAY', 'Shared CRDT event replayed'); this.seen.add(updateId); Y.applyUpdate(replica.doc, update, this); const note = await this.vault.getNote(body.noteId, this.identityId); const remote = this.remoteNotes.get(`${body.vaultId}:${body.noteId}`); if (note) { try { const next = await this.vault.updateNote(body.noteId, { content: replica.text.toString(), baseRevision: note.revision }, this.identityId); replica.revision = next.revision; } catch { replica.updatedAt = iso(this.now()); } } else if (remote) { this.remoteNotes.set(`${body.vaultId}:${body.noteId}`, { ...remote, content: replica.text.toString(), body: replica.text.toString(), revision: remote.revision + 1, modifiedAt: iso(this.now()) }); } await this.persist(); }
  }
  private async receiveAuthorized(envelope: Envelope): Promise<void> {
    if (envelope.type !== 'shared-vault' || envelope.recipient !== this.identityId || Date.parse(envelope.expiresAt) <= this.now() || this.seen.has(envelope.id) || !this.peerKnown(envelope.sender)) return;
    if (this.security && !(await this.security.verify(envelope))) return;
    if (!this.security && this.crypto && !(await this.verify(canonicalJson(stripSignature(envelope)), envelope.signature, envelope.sender))) return;
    const parsed = parseWire(envelope.body);
    if (!parsed) return this.receiveLegacy(envelope);
    if (parsed.kind === 'key' && !this.records.has(parsed.vaultId)) { this.seen.add(envelope.id); return; }
    if (parsed.kind === 'key') { const record = this.records.get(parsed.vaultId); const domain = record?.visibility === 'public' ? 'PUBLIC' as const : 'SHARED_SPACE' as const; if (!await this.surfaceEligible(parsed.vaultId, domain, parsed)) return; }
    if (parsed.kind === 'invite' || parsed.kind === 'key') return this.receiveLegacy(envelope);
    const record = this.records.get(parsed.vaultId);
    if (!record) { this.queueInbound(envelope); return; }
    if (!this.isMember(record, envelope.sender)) return this.receiveLegacy(envelope);
    let body = parsed;
    if (record.visibility !== 'public') { if (!body.nonce || !body.ciphertext) throw new SharedVaultError('INVALID_ARGUMENT', 'Private Shared Vault payload is not encrypted'); try { body = await this.decryptWire(record, body); } catch { throw new SharedVaultError('INVALID_SIGNATURE', `Private Shared Vault payload authentication failed (epoch ${body.epoch}, local ${record.epoch.epoch})`); } }
    if (!(await this.surfaceEligible(body.vaultId, record.visibility === 'public' ? 'PUBLIC' : 'SHARED_SPACE', body))) return;
    if (body.kind === 'crdt' && !hasPermission(record, envelope.sender, 'EDIT')) throw new SharedVaultError('NOT_AUTHORIZED', 'Shared CRDT update rejected');
    if (body.kind !== 'event') return this.receiveLegacy(envelope);
    const data = isRecord(body.data) ? body.data : {};
    const action = body.action ?? '';
    if (action === 'membership' && record.visibility === 'public') {
      const candidate: SharedVault | undefined = isSharedVault(data.vault) ? data.vault : Array.isArray(data.members) && isRecord(data.epoch) ? { ...record, members: data.members as SharedVaultMembership[], epoch: data.epoch as unknown as SharedVaultKeyEpoch, revision: record.revision + 1, updatedAt: iso(this.now()) } : undefined;
      if (!candidate || candidate.id !== record.id || candidate.epoch.epoch !== record.epoch.epoch + 1 || candidate.revision !== record.revision + 1 || !this.isMember(candidate, this.identityId)) throw new SharedVaultError('INVALID_EPOCH', 'Public Shared Vault membership update is invalid');
      const permission: SharedVaultPermission = candidate.epoch.rotatedFor === 'permissions' || candidate.epoch.rotatedFor === 'device-revocation' ? 'MANAGE_PERMISSIONS' : candidate.epoch.rotatedFor === 'join' ? 'INVITE' : 'REMOVE_MEMBER';
      if (!hasPermission(record, envelope.sender, permission)) throw new SharedVaultError('NOT_AUTHORIZED', 'Public Shared Vault membership update is unauthorized');
      if (candidate.signature && !await this.verify(canonicalJson({ id: candidate.id, revision: candidate.revision, epoch: candidate.epoch.epoch, actor: envelope.sender }), candidate.signature, envelope.sender)) throw new SharedVaultError('INVALID_SIGNATURE', 'Public Shared Vault membership signature rejected');
      this.seen.add(envelope.id); this.records.set(candidate.id, clone(candidate)); await this.persist(); return;
    }
    const required: SharedVaultPermission | undefined = action === 'create_note' ? 'CREATE_NOTE' : action === 'update_note' ? 'EDIT' : action === 'move_note' ? 'MOVE' : action === 'canvas_mutation' ? 'MANAGE_CANVAS' : action === 'attachment_ref' || action === 'attachment_ref_delete' ? 'MANAGE_ATTACHMENTS' : undefined;
    if (required && !hasPermission(record, envelope.sender, required)) throw new SharedVaultError('NOT_AUTHORIZED', 'Shared Vault event requires ' + required);
    if (action === 'delete_note') { const noteId = typeof data.noteId === 'string' ? data.noteId : ''; const current = this.remoteNotes.get(parsed.vaultId + ':' + noteId); if (!hasPermission(record, envelope.sender, 'DELETE_ALL') && !(hasPermission(record, envelope.sender, 'DELETE_OWN') && current?.author === envelope.sender)) throw new SharedVaultError('NOT_AUTHORIZED', 'Shared note deletion rejected'); }
    if (action === 'attachment_ref') { if (!isAttachmentReference(data) || data.vaultId !== record.id || data.encrypted !== (record.visibility !== 'public')) throw new SharedVaultError('INVALID_ARGUMENT', 'Malformed Shared attachment reference'); this.seen.add(envelope.id); this.attachmentReferences.set(record.id + ':' + data.id, clone(data)); await this.persist(); return; }
    if (action === 'attachment_ref_delete') { if (typeof data.attachmentId !== 'string') throw new SharedVaultError('INVALID_ARGUMENT', 'Malformed Shared attachment deletion'); this.seen.add(envelope.id); this.attachmentReferences.delete(record.id + ':' + data.attachmentId); await this.persist(); return; }
    return this.receiveLegacy(envelope);
  }
  private async surfaceEligible(objectId: string, domain: ContentDomain, value: unknown): Promise<boolean> {
    const evaluated = await this.protectedSurfaces.evaluate('SHARED_VAULTS', { objectId, domain, value, content: value, sourceType: 'vault', verified: true, authorized: true, sharing: true });
    return evaluated !== undefined;
  }
  /**
   * Private Vault wire bodies contain ciphertext by design.  Gate the
   * plaintext object before encryption and gate it again after decryption;
   * the transport boundary itself is evaluated against a bounded structural
   * projection so random ciphertext is never misclassified as user content.
   */
  private async wireSurfaceEligible(body: WireBody, record: SharedVault | undefined): Promise<boolean> {
    if (record?.visibility === 'public') {
      const value = body.kind === 'event' && isRecord(body.data) ? body.data : body;
      return this.surfaceEligible(body.vaultId, 'PUBLIC', value);
    }
    const structural = {
      protocol: 'encrypted-shared-vault',
      kind: body.kind,
      vaultId: body.vaultId,
      eventId: body.eventId,
      actor: body.actor,
      epoch: body.epoch,
      ...(body.action ? { action: body.action } : {}),
      ...(body.noteId ? { noteId: body.noteId } : {}),
    };
    return this.surfaceEligible(body.vaultId, 'SHARED_SPACE', structural);
  }
  private require(vaultId: string): SharedVault { const value = this.records.get(vaultId); if (!value) throw new SharedVaultError('NOT_FOUND', `Shared Vault not found: ${vaultId}`); return value; }
  private isMember(record: SharedVault, identityId: string): boolean { return record.members.some(value => value.identityId === identityId && !value.removedAt && !value.revokedAt); }
  private assertPermission(record: SharedVault, actor: string, permission: SharedVaultPermission): void { if (!this.isMember(record, actor) || !hasPermission(record, actor, permission)) throw new SharedVaultError('NOT_AUTHORIZED', `Missing Shared Vault permission: ${permission}`); }
  private replica(key: string, epoch: number): ReplicaRecord { let value = this.replicas.get(key); if (!value) { const doc = new Y.Doc(); value = { doc, text: doc.getText('markdown'), revision: 1, epoch, updatedAt: iso(this.now()) }; this.replicas.set(key, value); } return value; }
  private replicaSnapshot(vaultId: string, noteId: string, value: ReplicaRecord): VaultDocumentReplica { return { version: 1, vaultId, noteId, epoch: value.epoch, revision: value.revision, content: value.text.toString(), stateVector: encode(Y.encodeStateVector(value.doc)), updatedAt: value.updatedAt }; }
  private epochKey(vaultId: string, epoch: number): Uint8Array | undefined { const record = this.epochKeys.get(`${vaultId}:${epoch}`); return record ? decode(record) : undefined; }
  private readonly epochKeys = new Map<string, string>();
  private setEpochKey(vaultId: string, epoch: number, key: Uint8Array): void { this.epochKeys.set(`${vaultId}:${epoch}`, encode(key)); }
  private hasSecureHistory(): boolean { return Boolean(this.security && this.device); }
  private async encryptWire(record: SharedVault, body: WireBody): Promise<WireBody> { if (record.visibility === 'public') return body; const key = this.epochKey(record.id, record.epoch.epoch); if (!key) throw new SharedVaultError('PRIVATE_KEY_UNAVAILABLE', 'Private epoch key is unavailable'); const encrypted = await encryptBytes(key, new TextEncoder().encode(canonicalJson(body)), `vault:${record.id}:${record.epoch.epoch}`); return { kind: body.kind, vaultId: record.id, eventId: body.eventId, actor: body.actor, epoch: body.epoch, nonce: encrypted.nonce, ciphertext: encrypted.ciphertext }; }
  private async decryptWire(record: SharedVault, body: WireBody): Promise<WireBody> { if (record.visibility === 'public') return body; if (!body.nonce || !body.ciphertext) throw new SharedVaultError('INVALID_ARGUMENT', 'Private Shared Vault body is not encrypted'); const key = this.epochKey(record.id, record.epoch.epoch); if (!key) throw new SharedVaultError('PRIVATE_KEY_UNAVAILABLE', 'Private epoch key is unavailable'); const plaintext = await decryptBytes(key, body.nonce, body.ciphertext, `vault:${record.id}:${record.epoch.epoch}`); const parsed = JSON.parse(new TextDecoder().decode(plaintext)); const value = parseWire(parsed); if (!value) throw new SharedVaultError('INVALID_ARGUMENT', 'Private Shared Vault body is malformed'); return value; }
  private async sign(value: string, actor: string): Promise<string> { if (!this.crypto || !this.privateKey || actor !== this.identityId) return ''; return this.crypto.sign(value, this.privateKey); }
  private async verify(value: string, signature: string, signer: string): Promise<boolean> { const key = this.trustedPublicKeys[signer]; return Boolean(this.crypto && key && signature && this.crypto.verify(value, signature, key)); }
  private async signObject(value: Record<string, unknown>): Promise<{ signature?: string }> { const signature = await this.sign(canonicalJson(value), this.identityId); return signature ? { signature } : {}; }
  private async verifyObject(value: { readonly signature: string }, signer: string): Promise<boolean> { const { signature: _signature, ...without } = value as Record<string, unknown>; return this.verify(canonicalJson(without), value.signature, signer); }
  private peerKnown(peer: string): boolean { return peer === this.identityId || this.recordsHasPeer(peer) || Boolean(this.trustedPublicKeys[peer]); }
  private recordsHasPeer(peer: string): boolean { return [...this.records.values()].some(value => value.members.some(member => member.identityId === peer && !member.removedAt)); }
  private memberEncryptionKey(identityId: string): string | undefined { return this.memberEncryptionKeys.get(identityId) ?? this.trustedEncryptionPublicKeys[identityId]; }
  private noteIds(vaultId: string): Set<string> { let ids = this.vaultNoteIds.get(vaultId); if (!ids) { ids = new Set<string>(); this.vaultNoteIds.set(vaultId, ids); } return ids; }
  private async snapshotKey(): Promise<Uint8Array> { if (!this.device) throw new SharedVaultError('PRIVATE_KEY_UNAVAILABLE', 'Device-bound snapshot protection is unavailable'); const sodium = await loadSodium(); const encryptionKey = decode(this.device.encryptionPrivateKey); try { return new Uint8Array(sodium.crypto_generichash(32, sodium.from_string('keystone:shared-vault-epoch-state:v1'), encryptionKey)); } finally { encryptionKey.fill(0); } }
  private async sealEpochSnapshot(vaultId: string, epoch: number, encodedKey: string): Promise<{ vaultId: string; epoch: number; epochSecretNonce: string; epochSecretCiphertext: string }> { const key = await this.snapshotKey(); const plaintext = decode(encodedKey); try { const encrypted = await encryptBytes(key, plaintext, `snapshot:${vaultId}:${epoch}`); return { vaultId, epoch, epochSecretNonce: encrypted.nonce, epochSecretCiphertext: encrypted.ciphertext }; } finally { key.fill(0); plaintext.fill(0); } }
  private async openEpochSnapshot(value: { readonly vaultId: string; readonly epoch: number; readonly epochSecretNonce: string; readonly epochSecretCiphertext: string }): Promise<string> { const key = await this.snapshotKey(); let plaintext: Uint8Array | undefined; try { plaintext = await decryptBytes(key, value.epochSecretNonce, value.epochSecretCiphertext, `snapshot:${value.vaultId}:${value.epoch}`); if (plaintext.length !== 32) throw new Error('Invalid epoch secret'); return encode(plaintext); } finally { key.fill(0); plaintext?.fill(0); } }
  private async persist(): Promise<void> { const replicas = [...this.replicas].map(([key, value]) => ({ key, ...this.replicaSnapshot(key.split(':')[0]!, key.slice(key.indexOf(':') + 1), value) })); const epochKeys = this.device ? await Promise.all([...this.epochKeys].map(([compound, key]) => { const split = compound.lastIndexOf(':'); return this.sealEpochSnapshot(compound.slice(0, split), Number(compound.slice(split + 1)), key); })) : undefined; const snapshot: SharedVaultSnapshot = { version: 1, vaults: [...this.records.values()], replicas, pending: this.pending.map(clone), seen: [...this.seen].slice(-SHARED_VAULT_MAX_SEEN), ...(epochKeys ? { epochKeys } : {}), noteIds: [...this.vaultNoteIds].map(([vaultId, noteIds]) => ({ vaultId, noteIds: [...noteIds] })), remoteNotes: [...this.remoteNotes.values()].map(clone), memberEncryptionKeys: [...this.memberEncryptionKeys].map(([identityId, publicKey]) => ({ identityId, publicKey })), canvasDocuments: [...this.sharedCanvases.values()].map(clone), attachmentReferences: [...this.attachmentReferences.values()].map(clone) }; await this.state.write(snapshot); }
  private async hydrate(): Promise<void> { await this.vault.ready(); const raw = await this.state.read(); if (!raw) return; if (!isSnapshot(raw)) throw new SharedVaultError('CORRUPT_STATE', 'Shared Vault state is corrupt'); for (const value of raw.vaults) if (value.members.some(member => member.identityId === this.identityId && !member.removedAt)) this.records.set(value.id, clone(value)); for (const value of raw.replicas) { const replica = this.replica(`${value.vaultId}:${value.noteId}`, value.epoch); replica.revision = value.revision; replica.updatedAt = value.updatedAt; if (value.content) replica.text.insert(0, value.content); } for (const value of raw.epochKeys ?? []) { if (!this.device || !isEpochSnapshot(value) || !safeId(value.vaultId) || !Number.isSafeInteger(value.epoch)) continue; try { this.epochKeys.set(`${value.vaultId}:${value.epoch}`, await this.openEpochSnapshot(value)); } catch { /* fail closed: metadata survives, private key authority does not */ } } for (const value of raw.noteIds ?? []) if (typeof value.vaultId === 'string' && Array.isArray(value.noteIds)) this.vaultNoteIds.set(value.vaultId, new Set(value.noteIds.filter(noteId => typeof noteId === 'string'))); for (const value of raw.remoteNotes ?? []) if (isRemoteNote(value)) { this.remoteNotes.set(`${value.vaultId}:${value.noteId}`, clone(value)); this.noteIds(value.vaultId).add(value.noteId); } for (const value of raw.memberEncryptionKeys ?? []) if (typeof value.identityId === 'string' && typeof value.publicKey === 'string') this.memberEncryptionKeys.set(value.identityId, value.publicKey); for (const value of raw.canvasDocuments ?? []) if (isCanvasDocument(value)) this.sharedCanvases.set(`${value.vaultId}:${value.id}`, clone(value)); for (const value of raw.attachmentReferences ?? []) if (isAttachmentReference(value)) this.attachmentReferences.set(`${value.vaultId}:${value.id}`, clone(value)); this.pending.push(...raw.pending.map(clone)); raw.seen.forEach(value => this.seen.add(value)); }
}

/** Named replication facade for hosts that want to keep collaboration separate. */
export class SharedVaultReplicationService extends SharedVaultService {}

const ALL_PERMISSIONS: readonly SharedVaultPermission[] = ['VIEW', 'EDIT', 'CREATE_NOTE', 'DELETE_OWN', 'DELETE_ALL', 'MOVE', 'MANAGE_ATTACHMENTS', 'MANAGE_CANVAS', 'INVITE', 'REMOVE_MEMBER', 'MANAGE_PERMISSIONS'];
function rolePermissions(role: SharedVaultRole): readonly SharedVaultPermission[] { if (role === 'owner') return ALL_PERMISSIONS; if (role === 'editor') return ['VIEW', 'EDIT', 'CREATE_NOTE', 'DELETE_OWN', 'MOVE', 'MANAGE_ATTACHMENTS', 'MANAGE_CANVAS']; if (role === 'custom') return []; return ['VIEW']; }
function hasPermission(vault: SharedVault, identityId: string, permission: SharedVaultPermission): boolean { const member = vault.members.find(value => value.identityId === identityId && !value.removedAt && !value.revokedAt); return !!member && (member.permissions.includes(permission) || rolePermissions(member.role).includes(permission)); }
function normalizePermissions(values: readonly SharedVaultPermission[]): SharedVaultPermission[] { const unique = [...new Set(values)]; if (unique.some(value => !ALL_PERMISSIONS.includes(value))) throw new SharedVaultError('INVALID_ARGUMENT', 'Unknown Shared Vault permission'); return unique; }
function makeEpoch(epoch: number, createdAt: string, rotatedFor: SharedVaultKeyEpoch['rotatedFor'], revokedIdentities?: readonly string[]): SharedVaultKeyEpoch { return { version: 1, epoch, keyId: randomId('vault-key'), createdAt, rotatedFor, ...(revokedIdentities?.length ? { revokedIdentities } : {}) }; }
function safeIdentity(value: string): string { if (typeof value !== 'string' || value.length < 1 || value.length > 512 || /[\u0000-\u001f\u007f]/.test(value)) throw new SharedVaultError('INVALID_ARGUMENT', 'Identity is invalid'); return value; }
function safeId(value: string): string { if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value)) throw new SharedVaultError('INVALID_ARGUMENT', 'Identifier is invalid'); return value; }
function safeContentId(value: string): string { if (typeof value !== 'string' || value.length < 8 || value.length > 512 || /[^A-Za-z0-9._:/-]/.test(value)) throw new SharedVaultError('INVALID_ARGUMENT', 'Content reference is invalid'); return value; }
function bounded(value: string, max: number, required = false): string { if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new SharedVaultError('INVALID_ARGUMENT', 'Text is invalid'); return value; }
function iso(now: number): string { return new Date(now).toISOString(); }
function randomId(prefix: string): string { const uuid = globalThis.crypto?.randomUUID?.(); if (!uuid) throw new Error('Secure randomness is unavailable'); return `${prefix}-${uuid}`; }
function clone<T>(value: T): T { return structuredClone(value); }
function clamp(value: number, min: number, max: number): number { return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.trunc(value))) : min; }
function encode(bytes: Uint8Array): string { let binary = ''; bytes.forEach(byte => { binary += String.fromCharCode(byte); }); return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, ''); }
function decode(value: string): Uint8Array { const normalized = value.replace(/-/g, '+').replace(/_/g, '/'); const binary = atob(normalized + '='.repeat((4 - normalized.length % 4) % 4)); return Uint8Array.from(binary, char => char.charCodeAt(0)); }
async function digest(value: Uint8Array): Promise<string> { const hash = await crypto.subtle.digest('SHA-256', value as Uint8Array<ArrayBuffer>); return encode(new Uint8Array(hash)); }
async function loadSodium(): Promise<any> { const { default: sodium } = await import('libsodium-wrappers'); await sodium.ready; return sodium; }
async function encryptBytes(key: Uint8Array, plaintext: Uint8Array, aad: string): Promise<{ nonce: string; ciphertext: string }> { const sodium = await loadSodium(); const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES); const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(plaintext, aad, null, nonce, key); return { nonce: encode(nonce), ciphertext: encode(ciphertext) }; }
async function decryptBytes(key: Uint8Array, nonce: string, ciphertext: string, aad: string): Promise<Uint8Array> { try { const sodium = await loadSodium(); return new Uint8Array(sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, decode(ciphertext), aad, decode(nonce), key)); } catch { throw new SharedVaultError('INVALID_SIGNATURE', 'Shared Vault ciphertext authentication failed'); } }
async function sealKey(peer: DeviceSessionKeys, key: Uint8Array, privateKey: string, publicKey: string): Promise<{ nonce: string; ciphertext: string; senderEncryptionPublicKey: string }> { const sodium = await loadSodium(); const nonce = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES); const ciphertext = sodium.crypto_box_easy(encode(key), nonce, decode(peer.encryptionPublicKey), decode(privateKey)); return { nonce: encode(nonce), ciphertext: encode(ciphertext), senderEncryptionPublicKey: publicKey }; }
async function sealKeyForPublicKey(recipientPublicKey: string, key: Uint8Array, privateKey: string, publicKey: string): Promise<{ nonce: string; ciphertext: string; senderEncryptionPublicKey: string }> { const sodium = await loadSodium(); const nonce = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES); const ciphertext = sodium.crypto_box_easy(encode(key), nonce, decode(recipientPublicKey), decode(privateKey)); return { nonce: encode(nonce), ciphertext: encode(ciphertext), senderEncryptionPublicKey: publicKey }; }
async function openKey(value: { nonce: string; ciphertext: string; senderEncryptionPublicKey: string }, privateKey: string, senderPublicKey: string): Promise<Uint8Array> { try { const sodium = await loadSodium(); const bytes = sodium.crypto_box_open_easy(decode(value.ciphertext), decode(value.nonce), decode(senderPublicKey), decode(privateKey)); return decode(new TextDecoder().decode(bytes)); } catch { throw new SharedVaultError('PRIVATE_KEY_UNAVAILABLE', 'Shared Vault key unwrap failed'); } }
function parseWire(value: unknown): WireBody | undefined { if (!value || typeof value !== 'object') return undefined; const item = value as Partial<WireBody>; if (!['invite', 'event', 'crdt', 'canvas', 'key', 'ack', 'sync'].includes(item.kind ?? '') || typeof item.vaultId !== 'string' || typeof item.eventId !== 'string' || typeof item.actor !== 'string' || !Number.isSafeInteger(item.epoch)) return undefined; return item as WireBody; }
function isInvitation(value: unknown): value is SharedVaultInvitation { return Boolean(value && typeof value === 'object' && (value as SharedVaultInvitation).version === 1 && typeof (value as SharedVaultInvitation).id === 'string' && typeof (value as SharedVaultInvitation).signature === 'string' && typeof (value as SharedVaultInvitation).recipientIdentityId === 'string' && !!(value as SharedVaultInvitation).vault); }
function isSnapshot(value: unknown): value is SharedVaultSnapshot { return Boolean(value && typeof value === 'object' && (value as SharedVaultSnapshot).version === 1 && Array.isArray((value as SharedVaultSnapshot).vaults) && Array.isArray((value as SharedVaultSnapshot).replicas) && Array.isArray((value as SharedVaultSnapshot).pending) && Array.isArray((value as SharedVaultSnapshot).seen)); }
function isEpochSnapshot(value: unknown): value is NonNullable<SharedVaultSnapshot['epochKeys']>[number] { return Boolean(value && typeof value === 'object' && typeof (value as { vaultId?: unknown }).vaultId === 'string' && Number.isSafeInteger((value as { epoch?: unknown }).epoch) && typeof (value as { epochSecretNonce?: unknown }).epochSecretNonce === 'string' && typeof (value as { epochSecretCiphertext?: unknown }).epochSecretCiphertext === 'string'); }
function stripSignature(value: Envelope): UnsignedEnvelope { const { signature: _signature, ...unsigned } = value; return unsigned; }
async function randomKey(): Promise<Uint8Array> { const sodium = await loadSodium(); return new Uint8Array(sodium.randombytes_buf(32)); }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }
function isRemoteNote(value: unknown): value is RemoteNoteRecord { if (!value || typeof value !== 'object') return false; const item = value as Partial<RemoteNoteRecord>; return typeof item.noteId === 'string' && typeof item.vaultId === 'string' && typeof item.path === 'string' && typeof item.title === 'string' && typeof item.content === 'string' && typeof item.body === 'string' && Number.isSafeInteger(item.revision) && typeof item.modifiedAt === 'string'; }
function isAttachmentReference(value: unknown): value is SharedVaultAttachmentReference { if (!value || typeof value !== 'object') return false; const item = value as Partial<SharedVaultAttachmentReference>; return item.version === 1 && typeof item.id === 'string' && typeof item.vaultId === 'string' && typeof item.contentId === 'string' && typeof item.name === 'string' && typeof item.mimeType === 'string' && Number.isSafeInteger(item.size) && typeof item.ownerIdentityId === 'string' && typeof item.encrypted === 'boolean' && typeof item.createdAt === 'string'; }
function isWrappedKey(value: unknown): value is { readonly nonce: string; readonly ciphertext: string; readonly senderEncryptionPublicKey: string } { return Boolean(value && typeof value === 'object' && typeof (value as { nonce?: unknown }).nonce === 'string' && typeof (value as { ciphertext?: unknown }).ciphertext === 'string' && typeof (value as { senderEncryptionPublicKey?: unknown }).senderEncryptionPublicKey === 'string'); }
function isSharedVault(value: unknown): value is SharedVault { return Boolean(value && typeof value === 'object' && (value as SharedVault).version === 1 && typeof (value as SharedVault).id === 'string' && typeof (value as SharedVault).ownerIdentityId === 'string' && Array.isArray((value as SharedVault).members) && !!(value as SharedVault).epoch && Number.isSafeInteger((value as SharedVault).revision)); }
function isCanvasDocument(value: unknown): value is CanvasDocument { return Boolean(value && typeof value === 'object' && (value as CanvasDocument).version === 1 && typeof (value as CanvasDocument).id === 'string' && typeof (value as CanvasDocument).vaultId === 'string' && Number.isSafeInteger((value as CanvasDocument).revision) && Array.isArray((value as CanvasDocument).nodes) && Array.isArray((value as CanvasDocument).edges)); }
function isCanvasMutation(value: unknown): value is CanvasMutation { return Boolean(value && typeof value === 'object' && ['create_node', 'move', 'resize', 'update_node', 'delete', 'connect', 'disconnect', 'group', 'ungroup', 'set_viewport', 'set_selection'].includes((value as { type?: unknown }).type as string)); }
function emptySharedCanvas(id: string, vaultId: string, title: string, now: number): CanvasDocument { const timestamp = iso(now); return { version: 1, id: safeId(id), vaultId: safeId(vaultId), revision: 0, createdAt: timestamp, updatedAt: timestamp, nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, selection: { nodeIds: [], edgeIds: [] }, metadata: { title } }; }
function normalizeSharedCanvas(document: CanvasDocument, vaultId: string): CanvasDocument { return { ...clone(document), vaultId: safeId(vaultId) }; }
function cleanSharedPath(folder: string, currentPath: string): string { const normalized = folder.replace(/\\/g, '/').split('/').filter(Boolean).filter(part => part !== '.' && part !== '..').join('/'); const filename = currentPath.split('/').pop() ?? 'note.md'; return normalized ? `${normalized}/${filename}` : filename; }
function applySharedCanvasMutation(document: CanvasDocument, mutation: CanvasMutation, now: number): CanvasDocument { if (mutation.baseRevision !== undefined && mutation.baseRevision !== document.revision) throw new SharedVaultError('CONFLICT', 'Shared Canvas base revision is stale'); let nodes = document.nodes.map(clone); let edges = document.edges.map(clone); switch (mutation.type) { case 'create_node': if (nodes.some(node => node.id === mutation.node.id)) throw new SharedVaultError('CONFLICT', 'Shared Canvas node already exists'); nodes.push(clone(mutation.node)); break; case 'move': { const ids = new Set(mutation.nodeIds); nodes = nodes.map(node => ids.has(node.id) ? { ...node, x: node.x + mutation.dx, y: node.y + mutation.dy } : node); break; } case 'resize': nodes = nodes.map(node => node.id === mutation.nodeId ? { ...node, width: mutation.width, height: mutation.height } : node); break; case 'update_node': nodes = nodes.map(node => node.id === mutation.nodeId ? { ...node, ...clone(mutation.patch) } : node); break; case 'delete': { const ids = new Set(mutation.nodeIds); nodes = nodes.filter(node => !ids.has(node.id)); edges = edges.filter(edge => !ids.has(edge.sourceNodeId) && !ids.has(edge.targetNodeId) && !(mutation.edgeIds ?? []).includes(edge.id)); break; } case 'connect': if (!edges.some(edge => edge.id === mutation.edge.id)) edges.push(clone(mutation.edge)); break; case 'disconnect': edges = edges.filter(edge => !mutation.edgeIds.includes(edge.id)); break; case 'group': { const ids = new Set(mutation.childIds); const group = clone(mutation.group); nodes = [...nodes.filter(node => !ids.has(node.id)), group, ...nodes.filter(node => ids.has(node.id)).map(node => ({ ...node, parentId: group.id }))]; nodes = nodes.map(node => node.id === group.id ? { ...node, childIds: [...mutation.childIds] } : node); break; } case 'ungroup': nodes = nodes.filter(node => node.id !== mutation.groupId).map(node => node.parentId === mutation.groupId ? { ...node, parentId: undefined } : node); break; case 'set_viewport': return { ...document, viewport: clone(mutation.viewport), revision: document.revision + 1, updatedAt: iso(now) }; case 'set_selection': return { ...document, selection: clone(mutation.selection), revision: document.revision + 1, updatedAt: iso(now) }; }
  const existing = new Set(nodes.map(node => node.id)); const edgeIds = new Set(edges.map(edge => edge.id)); return { ...document, nodes, edges: edges.filter(edge => existing.has(edge.sourceNodeId) && existing.has(edge.targetNodeId)), selection: { nodeIds: document.selection.nodeIds.filter(id => existing.has(id)), edgeIds: document.selection.edgeIds.filter(id => edgeIds.has(id)) }, revision: document.revision + 1, updatedAt: iso(now) }; }
function mergeSharedCanvasDocuments(left: CanvasDocument, right: CanvasDocument): CanvasDocument { if (left.id !== right.id || left.vaultId !== right.vaultId) throw new SharedVaultError('INVALID_ARGUMENT', 'Shared Canvas identity mismatch'); const nodes = new Map<string, CanvasNode>(); for (const node of [...left.nodes, ...right.nodes]) { const current = nodes.get(node.id); if (!current || canonicalJson(node) > canonicalJson(current)) nodes.set(node.id, clone(node)); } const edges = new Map<string, CanvasEdge>(); for (const edge of [...left.edges, ...right.edges]) { const current = edges.get(edge.id); if (!current || canonicalJson(edge) > canonicalJson(current)) edges.set(edge.id, clone(edge)); } const nodeIds = new Set(nodes.keys()); const edgeList = [...edges.values()].filter(edge => nodeIds.has(edge.sourceNodeId) && nodeIds.has(edge.targetNodeId)); return { ...left, nodes: [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)), edges: edgeList.sort((a, b) => a.id.localeCompare(b.id)), viewport: right.revision >= left.revision ? clone(right.viewport) : clone(left.viewport), selection: { nodeIds: [...new Set([...left.selection.nodeIds, ...right.selection.nodeIds])].filter(id => nodeIds.has(id)).sort(), edgeIds: [...new Set([...left.selection.edgeIds, ...right.selection.edgeIds])].filter(id => edgeList.some(edge => edge.id === id)).sort() }, metadata: canonicalJson(right.metadata) >= canonicalJson(left.metadata) ? clone(right.metadata) : clone(left.metadata), revision: Math.max(left.revision, right.revision), updatedAt: left.updatedAt >= right.updatedAt ? left.updatedAt : right.updatedAt }; }
function remoteMarkdown(value: { readonly noteId: string; readonly vaultId: string; readonly path: string; readonly title: string; readonly content: string; readonly body: string; readonly revision: number; readonly modifiedAt: string }): MarkdownNote { return { version: 1, id: value.noteId, vaultId: value.vaultId, kind: 'note', path: value.path, name: value.path.split('/').pop() ?? value.path, parentPath: value.path.includes('/') ? value.path.slice(0, value.path.lastIndexOf('/')) : '', size: new TextEncoder().encode(value.content).byteLength, mimeType: 'text/markdown', modifiedAt: value.modifiedAt, contentHash: '', title: value.title, content: value.content, body: value.body, frontmatter: {}, aliases: [], tags: [], headings: [], blocks: [], links: [], revision: value.revision, untrusted: true }; }
