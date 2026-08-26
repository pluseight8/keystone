import { canonicalJson, type CryptoProvider } from '../crypto.js';
import type { DeviceSessionKeys } from '../identity.js';
import type { Envelope, EnvelopeSecurity, UnsignedEnvelope } from '../connectivity.js';
import type { KeystoneDeliveryInterface } from '../connectivity.js';
import type { NodeId } from '../types.js';
import type { CommunityEvent } from './community-storage.js';
import { CommunityService } from './communities.js';
import {
  type CommunityInviteObject,
  type CommunityObject,
  type EncryptedContentReference,
  communityInviteObjectSchema,
  communityObjectSchema,
} from './object-model.js';
import type { EncryptedSocialStateStore } from './storage.js';
import { createContentManifest, contentUri, type ContentId, type ContentManifest } from './content.js';

/**
 * Private Communities deliberately use a small, explicit group-key protocol.
 * It is not MLS, Double Ratchet, or a claim of forward secrecy.  Epoch keys
 * are generated locally, wrapped to each device with libsodium crypto_box,
 * and payloads use XChaCha20-Poly1305-IETF with authenticated metadata.
 */
export const PRIVATE_COMMUNITY_PROTOCOL = 'keystone.private-community.v1' as const;
export const PRIVATE_HISTORY_POLICY = 'current-only' as const;
const INVITE_TYPE = 'social.private_community_invite';
const JOIN_TYPE = 'social.private_community_join';
const KEY_UPDATE_TYPE = 'social.private_community_key_update';
const EVENT_TYPE = 'social.private_community_event';
const REVOCATION_TYPE = 'social.private_community_revocation';
const LEAVE_TYPE = 'social.private_community_leave';
const MAX_LIFETIME_MS = 10 * 60_000;
const MAX_SEEN = 8_192;
const MAX_BOOTSTRAP_EVENTS = 512;

export interface PrivateCommunityMemberKey { nodeId: NodeId; encryptionPublicKey: string; }
export interface PrivateCommunityState {
  version: 1;
  communityId: string;
  owner: NodeId;
  epoch: number;
  keyId: string;
  /** base64url XChaCha key; encrypted at rest by the storage implementation. */
  key: string;
  historyPolicy: typeof PRIVATE_HISTORY_POLICY;
  members: readonly PrivateCommunityMemberKey[];
  revokedDevices: readonly NodeId[];
}
export interface PrivateCommunityStateStorage {
  get(communityId: string): Promise<PrivateCommunityState | undefined>;
  save(value: PrivateCommunityState): Promise<void>;
  list(): Promise<readonly PrivateCommunityState[]>;
  hasSeen(value: string): Promise<boolean>;
  markSeen(value: string): Promise<void>;
}

type ProtectedState = { nonce: string; ciphertext: string };
type PersistentValue = { version: 1; records: Record<string, ProtectedState>; seen: Record<string, true> };

/**
 * Durable private state.  The host backend may itself be encrypted, but this
 * namespace encrypts epoch keys once more with a key derived from the local
 * device encryption key.  A backend copy therefore never contains a group key
 * in clear text.
 */
export class PersistentPrivateCommunityStateStorage implements PrivateCommunityStateStorage {
  private value?: PersistentValue;
  private loading?: Promise<PersistentValue>;
  private writes: Promise<void> = Promise.resolve();
  private readonly ready = loadSodium();

  constructor(private readonly backend: EncryptedSocialStateStore, private readonly local: DeviceSessionKeys) {}

  async get(communityId: string): Promise<PrivateCommunityState | undefined> {
    const value = (await this.load()).records[communityId];
    return value ? this.open(value) : undefined;
  }

  async save(state: PrivateCommunityState): Promise<void> {
    validateState(state);
    const value = await this.load();
    value.records[state.communityId] = await this.seal(state);
    await this.commit(value);
  }

  async list(): Promise<readonly PrivateCommunityState[]> {
    const records = await this.load();
    return Promise.all(Object.values(records.records).map(value => this.open(value)));
  }

  async hasSeen(value: string): Promise<boolean> { return !!(await this.load()).seen[value]; }

  async markSeen(value: string): Promise<void> {
    if (!value || value.length > 512) throw new Error('Invalid private replay marker');
    const state = await this.load();
    state.seen[value] = true;
    const keys = Object.keys(state.seen);
    if (keys.length > MAX_SEEN) delete state.seen[keys[0]!];
    await this.commit(state);
  }

  private async seal(state: PrivateCommunityState): Promise<ProtectedState> {
    const sodium = await this.ready;
    const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
    const ciphertext = sodium.crypto_secretbox_easy(JSON.stringify(state), nonce, await this.storageKey(sodium));
    return { nonce: encode(nonce), ciphertext: encode(ciphertext) };
  }

  private async open(value: ProtectedState): Promise<PrivateCommunityState> {
    const sodium = await this.ready;
    try {
      const plaintext = sodium.crypto_secretbox_open_easy(decode(value.ciphertext), decode(value.nonce), await this.storageKey(sodium));
      const parsed = JSON.parse(new TextDecoder().decode(plaintext)) as PrivateCommunityState;
      validateState(parsed);
      return structuredClone(parsed);
    } catch {
      throw new Error('Private community state authentication failed');
    }
  }

  private async storageKey(sodium: any): Promise<Uint8Array> {
    return sodium.crypto_generichash(32, sodium.from_string('keystone:private-community-state:v1'), decode(this.local.encryptionPrivateKey));
  }

  private async load(): Promise<PersistentValue> {
    if (this.value) return this.value;
    this.loading ??= this.backend.read().then(value => {
      if (!value) return this.value = { version: 1, records: {}, seen: {} };
      if (!value || typeof value !== 'object' || (value as Partial<PersistentValue>).version !== 1 || !(value as Partial<PersistentValue>).records || !(value as Partial<PersistentValue>).seen) throw new Error('Invalid private community storage');
      return this.value = structuredClone(value as PersistentValue);
    });
    return this.loading;
  }

  private async commit(value: PersistentValue): Promise<void> {
    const snapshot = structuredClone(value);
    const operation = this.writes.then(() => this.backend.write(snapshot));
    this.writes = operation.catch(() => undefined);
    await operation;
    this.value = value;
  }
}

/** Short alias used by host integrations that already call other stores `Persistent...Storage`. */
export class PersistentPrivateCommunityStorage extends PersistentPrivateCommunityStateStorage {}

/** A deterministic test storage; protocol tests still exercise AEAD payloads. */
export class InMemoryPrivateCommunityStateStorage implements PrivateCommunityStateStorage {
  private readonly values = new Map<string, PrivateCommunityState>();
  private readonly seen = new Set<string>();
  async get(id: string) { const value = this.values.get(id); return value ? structuredClone(value) : undefined; }
  async save(value: PrivateCommunityState) { validateState(value); this.values.set(value.communityId, structuredClone(value)); }
  async list() { return [...this.values.values()].map(value => structuredClone(value)); }
  async hasSeen(value: string) { return this.seen.has(value); }
  async markSeen(value: string) { this.seen.add(value); if (this.seen.size > MAX_SEEN) this.seen.delete(this.seen.values().next().value as string); }
}

export interface PrivateEncryptedPayload {
  version: 1;
  algorithm: 'xchacha20poly1305';
  epoch: number;
  keyId: string;
  nonce: string;
  ciphertext: string;
}
export interface PrivateEncryptedAttachment {
  contentUri: string;
  contentId: ContentId;
  manifest: ContentManifest;
  nonce: string;
  epoch: number;
  keyId: string;
}

export interface PrivateCommunityInviteBootstrap {
  version: 1;
  protocol: typeof PRIVATE_COMMUNITY_PROTOCOL;
  id: string;
  recipient: NodeId;
  owner: NodeId;
  ownerEncryptionPublicKey: string;
  community: CommunityObject;
  invite: CommunityInviteObject;
  bootstrapEvents: readonly CommunityEvent[];
  issuedAt: string;
  signature: string;
}
type UnsignedInviteBootstrap = Omit<PrivateCommunityInviteBootstrap, 'signature'>;

export interface PrivateCommunityJoinRequest {
  version: 1;
  protocol: typeof PRIVATE_COMMUNITY_PROTOCOL;
  id: string;
  communityId: string;
  inviteId: string;
  requester: NodeId;
  encryptionPublicKey: string;
  issuedAt: string;
  signature: string;
}
type UnsignedJoinRequest = Omit<PrivateCommunityJoinRequest, 'signature'>;

export interface PrivateCommunityKeyUpdate {
  version: 1;
  protocol: typeof PRIVATE_COMMUNITY_PROTOCOL;
  id: string;
  communityId: string;
  actor: NodeId;
  recipient: NodeId;
  epoch: number;
  previousEpoch: number;
  keyId: string;
  members: readonly PrivateCommunityMemberKey[];
  historyPolicy: typeof PRIVATE_HISTORY_POLICY;
  membershipEvent?: CommunityEvent;
  bootstrapEvents: readonly CommunityEvent[];
  keyNonce: string;
  encryptedKey: string;
  issuedAt: string;
  signature: string;
}
type UnsignedKeyUpdate = Omit<PrivateCommunityKeyUpdate, 'signature'>;
export interface PrivateCommunityRevocationNotice {
  version: 1;
  protocol: typeof PRIVATE_COMMUNITY_PROTOCOL;
  id: string;
  communityId: string;
  actor: NodeId;
  recipient: NodeId;
  epoch: number;
  membershipEvent: CommunityEvent;
  issuedAt: string;
  signature: string;
}
type UnsignedRevocationNotice = Omit<PrivateCommunityRevocationNotice, 'signature'>;

export interface PrivateCommunityServiceOptions {
  now?: () => number;
  peers?: readonly DeviceSessionKeys[];
}

/** Local authority, epoch and object projection for one device. */
export class PrivateCommunityService {
  private readonly peers = new Map<NodeId, DeviceSessionKeys>();
  private readonly pending = new Map<string, PrivateCommunityInviteBootstrap>();
  private mutation: Promise<void> = Promise.resolve();
  private readonly now: () => number;
  private readonly sodium = loadSodium();

  constructor(
    private readonly storage: PrivateCommunityStateStorage,
    private readonly communities: CommunityService,
    private readonly crypto: CryptoProvider,
    private readonly local: DeviceSessionKeys,
    options: PrivateCommunityServiceOptions = {},
  ) {
    this.now = options.now ?? (() => Date.now());
    for (const peer of options.peers ?? []) this.registerPeer(peer);
    this.registerPeer(local);
  }

  registerPeer(peer: DeviceSessionKeys): void { this.peers.set(peer.nodeId, peer); }
  peer(nodeId: NodeId): DeviceSessionKeys | undefined { return this.peers.get(nodeId); }
  async state(communityId: string): Promise<PrivateCommunityState | undefined> { return this.storage.get(communityId); }
  async communitiesList(): Promise<readonly PrivateCommunityState[]> { return this.storage.list(); }
  async hasSeenEnvelope(value: string): Promise<boolean> { return this.storage.hasSeen(value); }
  async markSeenEnvelope(value: string): Promise<void> { await this.storage.markSeen(value); }
  async isMember(communityId: string, nodeId = this.local.nodeId): Promise<boolean> { return !!(await this.storage.get(communityId))?.members.some(member => member.nodeId === nodeId); }
  async activeMembers(communityId: string): Promise<readonly PrivateCommunityMemberKey[]> { return (await this.requireState(communityId)).members; }

  async createCommunity(input: { name: string; description?: string; avatarUri?: string; bannerUri?: string; rules?: string; visibility: 'private' | 'contacts' }): Promise<CommunityObject> {
    if (input.visibility !== 'private' && input.visibility !== 'contacts') throw new Error('Private community visibility required');
    const community = await this.communities.createCommunity(input);
    const key = await randomKey();
    const state = await this.stateFor(community.id, community.author, 1, key, [this.local]);
    await this.storage.save(state);
    return community;
  }

  /** Creates a minimal encrypted invite bootstrap. It is never sent through public discovery. */
  async prepareInvite(communityId: string, recipient: NodeId, roleIds: readonly string[] = []): Promise<PrivateCommunityInviteBootstrap> {
    const state = await this.requireState(communityId);
    if (state.owner !== this.local.nodeId) throw new Error('Only the community owner can distribute private epochs');
    if (!this.peers.has(recipient)) throw new Error('Unknown recipient device key');
    if (state.members.some(member => member.nodeId === recipient)) throw new Error('Device is already a private member');
    const invite = await this.communities.createInvite(communityId, { recipient, roleIds });
    const projection = await this.communities.projection(communityId);
    if (!projection) throw new Error('Private community projection unavailable');
    const bootstrapEvents = await this.bootstrapEvents(communityId, invite);
    const unsigned: UnsignedInviteBootstrap = {
      version: 1, protocol: PRIVATE_COMMUNITY_PROTOCOL, id: crypto.randomUUID(), recipient, owner: this.local.nodeId,
      ownerEncryptionPublicKey: this.local.encryptionPublicKey, community: projection.community, invite, bootstrapEvents, issuedAt: this.date(),
    };
    return { ...unsigned, signature: await this.sign(unsigned) };
  }

  async acceptInvite(bootstrap: PrivateCommunityInviteBootstrap): Promise<PrivateCommunityJoinRequest> {
    if (!isInviteBootstrap(bootstrap) || bootstrap.recipient !== this.local.nodeId) throw new Error('Invalid private community invite');
    if (!(await this.crypto.verify(canonicalJson(unsignedInvite(bootstrap)), bootstrap.signature, bootstrap.owner))) throw new Error('Private invite signature rejected');
    const ownerPeer = this.peers.get(bootstrap.owner);
    if (!ownerPeer || ownerPeer.encryptionPublicKey !== bootstrap.ownerEncryptionPublicKey || bootstrap.community.author !== bootstrap.owner) throw new Error('Private invite owner key mismatch');
    communityObjectSchema.parse(bootstrap.community); communityInviteObjectSchema.parse(bootstrap.invite);
    if (bootstrap.invite.payload.communityId !== bootstrap.community.id || bootstrap.invite.payload.recipient !== this.local.nodeId) throw new Error('Private invite recipient mismatch');
    for (const event of [bootstrap.community, ...bootstrap.bootstrapEvents, bootstrap.invite]) if (!(await this.communities.ingest(event))) throw new Error('Private invite bootstrap rejected');
    this.pending.set(bootstrap.invite.payload.inviteId, structuredClone(bootstrap));
    const unsigned: UnsignedJoinRequest = { version: 1, protocol: PRIVATE_COMMUNITY_PROTOCOL, id: crypto.randomUUID(), communityId: bootstrap.community.id, inviteId: bootstrap.invite.payload.inviteId, requester: this.local.nodeId, encryptionPublicKey: this.local.encryptionPublicKey, issuedAt: this.date() };
    return { ...unsigned, signature: await this.sign(unsigned) };
  }

  /** Owner accepts a signed join request and returns one encrypted key update per active device. */
  async acceptJoin(request: PrivateCommunityJoinRequest): Promise<readonly PrivateCommunityKeyUpdate[]> {
    return this.serialized(() => this.acceptJoinUnlocked(request));
  }

  private async acceptJoinUnlocked(request: PrivateCommunityJoinRequest): Promise<readonly PrivateCommunityKeyUpdate[]> {
    if (!isJoinRequest(request)) throw new Error('Invalid private join request');
    if (!(await this.crypto.verify(canonicalJson(unsignedJoin(request)), request.signature, request.requester))) throw new Error('Private join signature rejected');
    if (this.local.nodeId !== (await this.requireState(request.communityId)).owner) throw new Error('Only the owner can accept private joins');
    const state = await this.requireState(request.communityId);
    if (state.members.some(member => member.nodeId === request.requester)) throw new Error('Private join request already accepted');
    const peer = this.peers.get(request.requester);
    if (!peer || peer.encryptionPublicKey !== request.encryptionPublicKey) throw new Error('Untrusted member device key');
    const bootstrap = this.pending.get(request.inviteId) ?? await this.findInvite(request.communityId, request.inviteId);
    if (!bootstrap || bootstrap.invite.payload.recipient !== request.requester) throw new Error('Private invite is not valid for requester');
    if (bootstrap.invite.payload.expiresAt && Date.parse(bootstrap.invite.payload.expiresAt) <= this.now()) throw new Error('Private invite has expired');
    const event = await this.communities.invite(request.communityId, request.requester, bootstrap.invite.payload.roleIds);
    const members = [...state.members, { nodeId: request.requester, encryptionPublicKey: request.encryptionPublicKey }];
    return this.rotate(state, members, event, request.requester);
  }

  async changeMembership(communityId: string, member: NodeId, action: 'leave' | 'kick' | 'ban' | 'unban', reason = `Private membership: ${action}`): Promise<readonly PrivateCommunityKeyUpdate[]> {
    return this.serialized(() => this.changeMembershipUnlocked(communityId, member, action, reason));
  }

  private async changeMembershipUnlocked(communityId: string, member: NodeId, action: 'leave' | 'kick' | 'ban' | 'unban', reason: string): Promise<readonly PrivateCommunityKeyUpdate[]> {
    const state = await this.requireState(communityId);
    if (state.owner !== this.local.nodeId) throw new Error('Only the owner can rotate private membership epochs');
    if (member === state.owner) throw new Error('Private owner is protected');
    // CommunityService intentionally only permits a device to author its own
    // leave event.  The owner-side private rotation path records a leave as a
    // signed kick-equivalent moderation event, preserving the same fail-closed
    // projection while ensuring the epoch is rotated immediately.
    const event = action === 'leave' ? await this.communities.moderate(communityId, member, 'kick', { reason: `${reason} (leave)` }) : await this.communities.moderate(communityId, member, action === 'unban' ? 'unban' : action, { reason });
    const members = action === 'unban' ? [...state.members.filter(value => value.nodeId !== member), this.requirePeerKey(member)] : state.members.filter(value => value.nodeId !== member);
    const revokedDevices = action === 'unban' ? state.revokedDevices.filter(value => value !== member) : [...new Set([...state.revokedDevices, member])];
    return this.rotate(state, members, event, undefined, revokedDevices);
  }

  /** Device revocation is deliberately an identity-level membership change. */
  async revokeDevice(communityId: string, device: NodeId, reason = 'Device revoked'): Promise<readonly PrivateCommunityKeyUpdate[]> {
    return this.changeMembership(communityId, device, 'ban', reason);
  }

  /** A member-authored leave request is signed by the leaving device and sent to the owner. */
  async createLeaveEvent(communityId: string): Promise<CommunityEvent> {
    const state = await this.requireState(communityId);
    if (!state.members.some(member => member.nodeId === this.local.nodeId) || state.revokedDevices.includes(this.local.nodeId)) throw new Error('Private community membership revoked');
    const event = await this.communities.leave(communityId);
    await this.storage.save({ ...state, members: state.members.filter(member => member.nodeId !== this.local.nodeId), revokedDevices: [...new Set([...state.revokedDevices, this.local.nodeId])] });
    return event;
  }

  async acceptLeave(event: CommunityEvent): Promise<readonly PrivateCommunityKeyUpdate[]> {
    return this.serialized(async () => {
      if (event.type !== 'community_member' || event.payload.action !== 'leave' || event.author !== event.payload.member) throw new Error('Invalid private leave event');
      const state = await this.requireState(event.payload.communityId);
      if (state.owner !== this.local.nodeId || !state.members.some(member => member.nodeId === event.payload.member)) throw new Error('Private leave is not authorized');
      if (!(await this.communities.ingest(event))) throw new Error('Private leave signature rejected');
      const members = state.members.filter(member => member.nodeId !== event.payload.member);
      return this.rotate(state, members, event, undefined, [...new Set([...state.revokedDevices, event.payload.member])]);
    });
  }

  async postMessage(communityId: string, channelId: string, text: string, options: { trackIds?: readonly string[]; videoIds?: readonly string[]; liveIds?: readonly string[]; fileIds?: readonly string[]; contentUris?: readonly string[]; encryptedContent?: readonly EncryptedContentReference[]; mentionIds?: readonly NodeId[]; replyTo?: string } = {}): Promise<CommunityEvent> {
    await this.requireState(communityId);
    return this.communities.postMessage(communityId, channelId, text, options.trackIds ?? [], options.videoIds ?? [], options.liveIds ?? [], options);
  }

  async encryptEvent(event: CommunityEvent): Promise<PrivateEncryptedPayload> {
    const communityId = event.payload.communityId;
    const state = await this.requireState(communityId);
    if (event.author !== this.local.nodeId) throw new Error('Private event author does not match local device');
    if (!state.members.some(member => member.nodeId === this.local.nodeId) || state.revokedDevices.includes(this.local.nodeId)) throw new Error('Private community membership revoked');
    return this.encryptJson(state, event);
  }

  async decryptEvent(payload: PrivateEncryptedPayload, sender: NodeId): Promise<CommunityEvent> {
    if (!isEncryptedPayload(payload)) throw new Error('Invalid private ciphertext');
    const states = await this.storage.list();
    const state = states.find(value => value.epoch === payload.epoch && value.keyId === payload.keyId && value.members.some(member => member.nodeId === this.local.nodeId) && !value.revokedDevices.includes(this.local.nodeId));
    if (!state) throw new Error('Private epoch is unavailable or revoked');
    const value = await this.decryptJson(state, payload);
    const event = value as CommunityEvent;
    if (!event || typeof event !== 'object' || event.payload?.communityId !== state.communityId || event.author !== sender) throw new Error('Private event identity mismatch');
    const accepted = await this.communities.ingest(event);
    if (!accepted) throw new Error('Private signed object rejected');
    return accepted;
  }

  /** Encrypts bytes before creating a content manifest, so the public hash is a ciphertext hash. */
  async encryptAttachment(communityId: string, bytes: Uint8Array, options: { mimeType: string; name?: string; chunkSize?: number } ): Promise<PrivateEncryptedAttachment & { bytes: Uint8Array }> {
    const state = await this.requireState(communityId);
    const nonce = (await this.sodium).randombytes_buf((await this.sodium).crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
    const ciphertext = (await this.sodium).crypto_aead_xchacha20poly1305_ietf_encrypt(bytes, canonicalJson({ protocol: PRIVATE_COMMUNITY_PROTOCOL, communityId, epoch: state.epoch, keyId: state.keyId, kind: 'attachment' }), null, nonce, decode(state.key));
    const encryptedBytes = new Uint8Array(ciphertext);
    const manifest = await createContentManifest(encryptedBytes, options);
    return { bytes: encryptedBytes, contentUri: contentUri(manifest.contentId), contentId: manifest.contentId, manifest, nonce: encode(nonce), epoch: state.epoch, keyId: state.keyId };
  }

  async decryptAttachment(attachment: PrivateEncryptedAttachment, bytes: Uint8Array, communityId: string): Promise<Uint8Array> {
    const state = await this.requireState(communityId);
    if (state.epoch !== attachment.epoch || state.keyId !== attachment.keyId) throw new Error('Private attachment epoch is unavailable');
    const manifest = await createContentManifest(bytes, { mimeType: attachment.manifest.mimeType, name: attachment.manifest.name, chunkSize: attachment.manifest.chunkSize });
    if (manifest.contentId !== attachment.contentId) throw new Error('Private attachment content hash rejected');
    try {
      return new Uint8Array((await this.sodium).crypto_aead_xchacha20poly1305_ietf_decrypt(null, bytes, canonicalJson({ protocol: PRIVATE_COMMUNITY_PROTOCOL, communityId, epoch: state.epoch, keyId: state.keyId, kind: 'attachment' }), decode(attachment.nonce), decode(state.key)));
    } catch { throw new Error('Private attachment authentication failed'); }
  }

  async applyKeyUpdate(update: PrivateCommunityKeyUpdate): Promise<PrivateCommunityState> {
    if (!isKeyUpdate(update) || update.recipient !== this.local.nodeId) throw new Error('Invalid private key update');
    if (!(await this.crypto.verify(canonicalJson(unsignedKeyUpdate(update)), update.signature, update.actor))) throw new Error('Private key update signature rejected');
    const existing = await this.storage.get(update.communityId);
    if (existing) {
      if (update.previousEpoch !== existing.epoch || update.epoch !== existing.epoch + 1) throw new Error('Private epoch replay or gap rejected');
      if (update.actor !== existing.owner || !existing.members.some(member => member.nodeId === update.actor) || existing.revokedDevices.includes(update.actor)) throw new Error('Private key update actor is not the owner');
    } else {
      const bootstrapCommunity = update.bootstrapEvents.find((event): event is CommunityObject => event.type === 'community');
      if (!bootstrapCommunity || bootstrapCommunity.visibility === 'public' || update.actor !== bootstrapCommunity.author) throw new Error('Private bootstrap actor rejected');
    }
    if (!update.members.some(member => member.nodeId === this.local.nodeId) || update.members.some(member => !member.nodeId || !member.encryptionPublicKey)) {
      throw new Error('Private key update does not grant this device access');
    }
    for (const event of update.bootstrapEvents) if (!(await this.communities.ingest(event))) throw new Error('Private bootstrap event rejected');
    if (update.membershipEvent && !(await this.communities.ingest(update.membershipEvent))) throw new Error('Private membership event rejected');
    const peer = this.peers.get(update.actor);
    if (existing && update.actor !== existing.owner) throw new Error('Private key update owner mismatch');
    if (peer && peer.encryptionPublicKey !== update.members.find(member => member.nodeId === update.actor)?.encryptionPublicKey) throw new Error('Private actor device key changed without rotation');
    const wrappedKey = await this.openDirect(update.keyNonce, update.encryptedKey, update.actor);
    let key: Uint8Array;
    try { key = decode(JSON.parse(new TextDecoder().decode(wrappedKey)) as string); } catch { throw new Error('Invalid private epoch key'); }
    if (key.length !== 32) throw new Error('Invalid private epoch key');
    const value: PrivateCommunityState = { version: 1, communityId: update.communityId, owner: existing?.owner ?? update.actor, epoch: update.epoch, keyId: update.keyId, key: encode(key), historyPolicy: PRIVATE_HISTORY_POLICY, members: update.members.map(member => ({ ...member })), revokedDevices: existing?.revokedDevices.filter(value => update.members.every(member => member.nodeId !== value)) ?? [] };
    validateState(value);
    await this.storage.save(value);
    return value;
  }

  async createRevocationNotice(communityId: string, recipient: NodeId): Promise<PrivateCommunityRevocationNotice> {
    const state = await this.requireState(communityId);
    if (state.owner !== this.local.nodeId || state.members.some(member => member.nodeId === recipient)) throw new Error('Private revocation notice is not applicable');
    const event = (await this.communities.events(communityId)).filter((value): value is CommunityEvent & { type: 'community_member' } => value.type === 'community_member' && value.payload.member === recipient && ['kick', 'ban'].includes(value.payload.action)).at(-1);
    if (!event) throw new Error('Private membership revocation event not found');
    const unsigned: UnsignedRevocationNotice = { version: 1, protocol: PRIVATE_COMMUNITY_PROTOCOL, id: crypto.randomUUID(), communityId, actor: this.local.nodeId, recipient, epoch: state.epoch, membershipEvent: event, issuedAt: this.date() };
    return { ...unsigned, signature: await this.sign(unsigned) };
  }

  async applyRevocationNotice(notice: PrivateCommunityRevocationNotice): Promise<PrivateCommunityState> {
    if (!isRevocationNotice(notice) || notice.recipient !== this.local.nodeId) throw new Error('Invalid private revocation notice');
    if (!(await this.crypto.verify(canonicalJson(unsignedRevocation(notice)), notice.signature, notice.actor))) throw new Error('Private revocation signature rejected');
    const state = await this.requireState(notice.communityId);
    if (state.owner !== notice.actor || notice.epoch !== state.epoch + 1 || state.revokedDevices.includes(this.local.nodeId)) throw new Error('Private revocation epoch rejected');
    if (notice.membershipEvent.type !== 'community_member' || notice.membershipEvent.payload.member !== this.local.nodeId || !['kick', 'ban'].includes(notice.membershipEvent.payload.action)) throw new Error('Private revocation target rejected');
    if (!(await this.communities.ingest(notice.membershipEvent))) throw new Error('Private revocation membership rejected');
    const next: PrivateCommunityState = { ...state, members: state.members.filter(member => member.nodeId !== this.local.nodeId), revokedDevices: [...new Set([...state.revokedDevices, this.local.nodeId])] };
    await this.storage.save(next);
    return next;
  }

  async sealDirect(recipient: NodeId, plaintext: unknown): Promise<{ nonce: string; ciphertext: string }> {
    const peer = this.peers.get(recipient); if (!peer) throw new Error('Unknown private recipient key');
    const sodium = await this.sodium; const nonce = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES); const ciphertext = sodium.crypto_box_easy(JSON.stringify(plaintext), nonce, decode(peer.encryptionPublicKey), decode(this.local.encryptionPrivateKey));
    return { nonce: encode(nonce), ciphertext: encode(ciphertext) };
  }

  async openDirect(nonce: string, ciphertext: string, sender: NodeId, senderEncryptionPublicKey?: string): Promise<Uint8Array> {
    const peer = this.peers.get(sender); if (!peer) throw new Error('Unknown private sender key');
    if (senderEncryptionPublicKey && senderEncryptionPublicKey !== peer.encryptionPublicKey) throw new Error('Private sender key mismatch');
    try { return new Uint8Array((await this.sodium).crypto_box_open_easy(decode(ciphertext), decode(nonce), decode(peer.encryptionPublicKey), decode(this.local.encryptionPrivateKey))); } catch { throw new Error('Private direct ciphertext authentication failed'); }
  }

  async directKeyUpdate(update: Omit<PrivateCommunityKeyUpdate, 'encryptedKey' | 'keyNonce' | 'signature'>, key: Uint8Array): Promise<PrivateCommunityKeyUpdate> {
    const wrapped = await this.sealDirect(update.recipient, encode(key));
    const unsigned: UnsignedKeyUpdate = { ...update, keyNonce: wrapped.nonce, encryptedKey: wrapped.ciphertext };
    return { ...unsigned, signature: await this.sign(unsigned) };
  }

  private async rotate(state: PrivateCommunityState, members: readonly PrivateCommunityMemberKey[], membershipEvent: CommunityEvent, newMember?: NodeId, revokedDevices = state.revokedDevices): Promise<readonly PrivateCommunityKeyUpdate[]> {
    const key = await randomKey(); const epoch = state.epoch + 1; const keyId = await this.crypto.hash(`${state.communityId}:${epoch}:${encode(key)}`); const next: PrivateCommunityState = { version: 1, communityId: state.communityId, owner: state.owner, epoch, keyId, key: encode(key), historyPolicy: PRIVATE_HISTORY_POLICY, members: uniqueMembers(members), revokedDevices: [...new Set(revokedDevices)] };
    validateState(next); await this.storage.save(next);
    const bootstrapEvents = newMember ? await this.bootstrapEvents(state.communityId) : [];
    const updates: PrivateCommunityKeyUpdate[] = [];
    for (const member of next.members) {
      if (member.nodeId === this.local.nodeId) continue;
      const unsigned: Omit<PrivateCommunityKeyUpdate, 'encryptedKey' | 'keyNonce' | 'signature'> = { version: 1, protocol: PRIVATE_COMMUNITY_PROTOCOL, id: crypto.randomUUID(), communityId: state.communityId, actor: this.local.nodeId, recipient: member.nodeId, epoch, previousEpoch: state.epoch, keyId, members: next.members, historyPolicy: PRIVATE_HISTORY_POLICY, ...(membershipEvent ? { membershipEvent } : {}), bootstrapEvents, issuedAt: this.date() };
      updates.push(await this.directKeyUpdate(unsigned, key));
    }
    return updates;
  }

  private async encryptJson(state: PrivateCommunityState, value: unknown): Promise<PrivateEncryptedPayload> {
    const sodium = await this.sodium; const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES); const aad = canonicalJson({ protocol: PRIVATE_COMMUNITY_PROTOCOL, communityId: state.communityId, epoch: state.epoch, keyId: state.keyId }); const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(JSON.stringify(value), aad, null, nonce, decode(state.key)); return { version: 1, algorithm: 'xchacha20poly1305', epoch: state.epoch, keyId: state.keyId, nonce: encode(nonce), ciphertext: encode(ciphertext) };
  }
  private async decryptJson(state: PrivateCommunityState, payload: PrivateEncryptedPayload): Promise<unknown> { const sodium = await this.sodium; const aad = canonicalJson({ protocol: PRIVATE_COMMUNITY_PROTOCOL, communityId: state.communityId, epoch: state.epoch, keyId: state.keyId }); try { const plaintext = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, decode(payload.ciphertext), aad, decode(payload.nonce), decode(state.key)); return JSON.parse(new TextDecoder().decode(plaintext)); } catch { throw new Error('Private ciphertext authentication failed'); } }
  private async requireState(communityId: string): Promise<PrivateCommunityState> { const state = await this.storage.get(communityId); if (!state) throw new Error('Private community state unavailable'); return state; }
  private async stateFor(communityId: string, owner: NodeId, epoch: number, key: Uint8Array, members: readonly DeviceSessionKeys[]): Promise<PrivateCommunityState> { const keyId = await this.crypto.hash(`${communityId}:${epoch}:${encode(key)}`); return { version: 1, communityId, owner, epoch, keyId, key: encode(key), historyPolicy: PRIVATE_HISTORY_POLICY, members: members.map(member => ({ nodeId: member.nodeId, encryptionPublicKey: member.encryptionPublicKey })), revokedDevices: [] }; }
  private async findInvite(communityId: string, inviteId: string): Promise<PrivateCommunityInviteBootstrap | undefined> { const projection = await this.communities.projection(communityId); if (!projection) return undefined; const events = (await this.communities.events(communityId)).filter(event => event.type !== 'community_message'); const invite = events.find((event): event is CommunityInviteObject => event.type === 'community_invite' && event.payload.inviteId === inviteId); return invite ? { version: 1, protocol: PRIVATE_COMMUNITY_PROTOCOL, id: invite.id, recipient: invite.payload.recipient ?? '', owner: projection.community.author, ownerEncryptionPublicKey: this.peers.get(projection.community.author)?.encryptionPublicKey ?? '', community: projection.community, invite, bootstrapEvents: events, issuedAt: invite.createdAt, signature: '' } : undefined; }
  private async bootstrapEvents(communityId: string, invite?: CommunityInviteObject): Promise<readonly CommunityEvent[]> { const events = (await this.communities.events(communityId)).filter(event => event.type === 'community' || event.type === 'role' || event.type === 'channel' || event.type === 'community_category'); const latestCommunity = events.filter(event => event.type === 'community').at(-1); const result: CommunityEvent[] = events.filter(event => event !== latestCommunity); if (latestCommunity) result.unshift(latestCommunity); if (invite) result.push(invite); if (result.length > MAX_BOOTSTRAP_EVENTS) throw new Error('Private community bootstrap is too large'); return result; }
  private requirePeerKey(nodeId: NodeId): PrivateCommunityMemberKey { const peer = this.peers.get(nodeId); if (!peer) throw new Error('Unknown private member device'); return { nodeId, encryptionPublicKey: peer.encryptionPublicKey }; }
  private async serialized<T>(operation: () => Promise<T>): Promise<T> { const next = this.mutation.then(operation); this.mutation = next.then(() => undefined, () => undefined); return next; }
  private sign(value: object): Promise<string> { return this.crypto.sign(canonicalJson(value), this.local.privateKey); }
  private date(): string { return new Date(this.now()).toISOString(); }
}

export interface PrivateCommunityReplicationStats { accepted: number; rejected: number; duplicate: number; }

/** Signed-envelope transport adapter. Public replication never calls this path. */
export class PrivateCommunityReplicationService {
  private readonly unsubscribe: () => void;
  private readonly blocked = new Set<NodeId>();
  private acceptedCount = 0; private rejectedCount = 0; private duplicateCount = 0;
  constructor(private readonly transport: KeystoneDeliveryInterface, private readonly privateCommunities: PrivateCommunityService, private readonly security: EnvelopeSecurity, private readonly local: DeviceSessionKeys, private readonly now: () => number = () => Date.now()) {
    this.unsubscribe = transport.onMessage(envelope => { void this.receive(envelope); });
  }
  close(): void { this.unsubscribe(); }
  stats(): PrivateCommunityReplicationStats { return { accepted: this.acceptedCount, rejected: this.rejectedCount, duplicate: this.duplicateCount }; }
  block(peer: NodeId): void { this.blocked.add(peer); }
  unblock(peer: NodeId): void { this.blocked.delete(peer); }
  async invite(peer: NodeId, communityId: string, roleIds: readonly string[] = []): Promise<PrivateCommunityInviteBootstrap> { const bootstrap = await this.privateCommunities.prepareInvite(communityId, peer, roleIds); await this.sendDirect(peer, INVITE_TYPE, bootstrap); return bootstrap; }
  async acceptInvite(bootstrap: PrivateCommunityInviteBootstrap): Promise<PrivateCommunityJoinRequest> { const request = await this.privateCommunities.acceptInvite(bootstrap); await this.sendDirect(bootstrap.owner, JOIN_TYPE, request); return request; }
  async leave(communityId: string): Promise<void> { const event = await this.privateCommunities.createLeaveEvent(communityId); const state = await this.privateCommunities.state(communityId); if (!state) throw new Error('Private community state unavailable'); await this.sendDirect(state.owner, LEAVE_TYPE, event); }
  async acceptJoin(request: PrivateCommunityJoinRequest): Promise<readonly PrivateCommunityKeyUpdate[]> { const updates = await this.privateCommunities.acceptJoin(request); for (const update of updates) await this.sendDirect(update.recipient, KEY_UPDATE_TYPE, update); return updates; }
  async publishEvent(peer: NodeId, event: CommunityEvent): Promise<void> { const payload = await this.privateCommunities.encryptEvent(event); await this.send(peer, EVENT_TYPE, payload); }
  async broadcastEvent(event: CommunityEvent): Promise<void> { const communityId = event.payload.communityId; for (const member of await this.privateCommunities.activeMembers(communityId)) if (member.nodeId !== this.local.nodeId && !this.blocked.has(member.nodeId)) await this.publishEvent(member.nodeId, event); }
  async rotateAndBroadcast(communityId: string, member: NodeId, action: 'leave' | 'kick' | 'ban' | 'unban', reason?: string): Promise<readonly PrivateCommunityKeyUpdate[]> { const updates = await this.privateCommunities.changeMembership(communityId, member, action, reason); for (const update of updates) await this.sendDirect(update.recipient, KEY_UPDATE_TYPE, update); if (action !== 'unban') { try { const notice = await this.privateCommunities.createRevocationNotice(communityId, member); await this.sendDirect(member, REVOCATION_TYPE, notice); } catch { /* An offline/revoked device need not receive the notice; it still lacks the new epoch key. */ } } return updates; }
  async sendRaw(peer: NodeId, type: string, body: unknown): Promise<void> { await this.send(peer, type, body); }

  private async sendDirect(peer: NodeId, type: string, value: unknown): Promise<void> { const body = await this.privateCommunities.sealDirect(peer, value); await this.send(peer, type, { algorithm: 'crypto_box', senderEncryptionPublicKey: this.local.encryptionPublicKey, ...body }); }
  private async send(peer: NodeId, type: string, body: unknown): Promise<void> { if (this.blocked.has(peer)) throw new Error('Blocked private community peer rejected'); const unsigned: UnsignedEnvelope = { version: 1, type, id: crypto.randomUUID(), sender: this.local.nodeId, recipient: peer, nonce: crypto.randomUUID(), expiresAt: new Date(this.now() + MAX_LIFETIME_MS).toISOString(), body }; const envelope: Envelope = { ...unsigned, signature: await this.security.sign(unsigned) }; await this.transport.connect(peer); await this.transport.send(peer, envelope); }
  private async receive(envelope: Envelope): Promise<void> {
    if (![INVITE_TYPE, JOIN_TYPE, KEY_UPDATE_TYPE, EVENT_TYPE, REVOCATION_TYPE, LEAVE_TYPE].includes(envelope.type) || envelope.recipient !== this.local.nodeId || this.blocked.has(envelope.sender)) return;
    const expiry = Date.parse(envelope.expiresAt); if (!Number.isFinite(expiry) || expiry <= this.now() || expiry - this.now() > MAX_LIFETIME_MS) { this.rejectedCount++; return; }
    if (await this.privateCommunities.hasSeenEnvelope(envelope.nonce)) { this.duplicateCount++; return; }
    if (!(await this.security.verify(envelope))) { this.rejectedCount++; return; }
    const body = envelope.body as { algorithm?: string; senderEncryptionPublicKey?: string; nonce?: string; ciphertext?: string };
    try {
      let value: unknown;
      if (envelope.type === EVENT_TYPE) {
        value = await this.privateCommunities.decryptEvent(body as PrivateEncryptedPayload, envelope.sender);
      } else {
        if (body.algorithm !== 'crypto_box' || !body.nonce || !body.ciphertext || body.senderEncryptionPublicKey !== this.privateCommunities.peer(envelope.sender)?.encryptionPublicKey) throw new Error('Private direct envelope key mismatch');
        const plaintext = await this.privateCommunities.openDirect(body.nonce, body.ciphertext, envelope.sender, body.senderEncryptionPublicKey); value = JSON.parse(new TextDecoder().decode(plaintext));
        if (envelope.type === INVITE_TYPE) {
          const request = await this.privateCommunities.acceptInvite(value as PrivateCommunityInviteBootstrap);
          await this.sendDirect((value as PrivateCommunityInviteBootstrap).owner, JOIN_TYPE, request);
        }
        else if (envelope.type === JOIN_TYPE) { const updates = await this.privateCommunities.acceptJoin(value as PrivateCommunityJoinRequest); for (const update of updates) await this.sendDirect(update.recipient, KEY_UPDATE_TYPE, update); }
        else if (envelope.type === KEY_UPDATE_TYPE) await this.privateCommunities.applyKeyUpdate(value as PrivateCommunityKeyUpdate);
        else if (envelope.type === REVOCATION_TYPE) await this.privateCommunities.applyRevocationNotice(value as PrivateCommunityRevocationNotice);
        else if (envelope.type === LEAVE_TYPE) { const updates = await this.privateCommunities.acceptLeave(value as CommunityEvent); for (const update of updates) await this.sendDirect(update.recipient, KEY_UPDATE_TYPE, update); }
      }
      await this.privateCommunities.markSeenEnvelope(envelope.nonce); this.acceptedCount++; void value;
    } catch { this.rejectedCount++; }
  }
}

function validateState(state: PrivateCommunityState): void {
  if (state.version !== 1 || !state.communityId || !state.owner || !Number.isInteger(state.epoch) || state.epoch < 1 || !state.keyId || !state.key || state.historyPolicy !== PRIVATE_HISTORY_POLICY || !Array.isArray(state.members) || !state.members.length || state.members.some(member => !member.nodeId || typeof member.encryptionPublicKey !== 'string') || state.members.some((member, index) => state.members.findIndex(candidate => candidate.nodeId === member.nodeId) !== index)) throw new Error('Invalid private community state');
  if (!state.members.some(member => member.nodeId === state.owner)) throw new Error('Private owner must be a member');
  try { if (decode(state.key).length !== 32 || state.members.some(member => decode(member.encryptionPublicKey).length !== 32)) throw new Error('Invalid private epoch key'); } catch { throw new Error('Invalid private key material'); }
}
function uniqueMembers(values: readonly PrivateCommunityMemberKey[]): PrivateCommunityMemberKey[] { const output: PrivateCommunityMemberKey[] = []; for (const value of values) if (!output.some(item => item.nodeId === value.nodeId)) output.push({ ...value }); return output; }
function isInviteBootstrap(value: unknown): value is PrivateCommunityInviteBootstrap { const candidate = value as Partial<PrivateCommunityInviteBootstrap>; return !!candidate && candidate.version === 1 && candidate.protocol === PRIVATE_COMMUNITY_PROTOCOL && typeof candidate.id === 'string' && typeof candidate.recipient === 'string' && typeof candidate.owner === 'string' && typeof candidate.signature === 'string' && Array.isArray(candidate.bootstrapEvents); }
function unsignedInvite(value: PrivateCommunityInviteBootstrap): UnsignedInviteBootstrap { const { signature: _signature, ...unsigned } = value; return unsigned; }
function isJoinRequest(value: unknown): value is PrivateCommunityJoinRequest { const candidate = value as Partial<PrivateCommunityJoinRequest>; return !!candidate && candidate.version === 1 && candidate.protocol === PRIVATE_COMMUNITY_PROTOCOL && typeof candidate.id === 'string' && typeof candidate.communityId === 'string' && typeof candidate.inviteId === 'string' && typeof candidate.requester === 'string' && typeof candidate.encryptionPublicKey === 'string' && typeof candidate.signature === 'string'; }
function unsignedJoin(value: PrivateCommunityJoinRequest): UnsignedJoinRequest { const { signature: _signature, ...unsigned } = value; return unsigned; }
function isEncryptedPayload(value: unknown): value is PrivateEncryptedPayload { const candidate = value as Partial<PrivateEncryptedPayload>; return !!candidate && candidate.version === 1 && candidate.algorithm === 'xchacha20poly1305' && Number.isInteger(candidate.epoch) && typeof candidate.keyId === 'string' && typeof candidate.nonce === 'string' && typeof candidate.ciphertext === 'string'; }
function isKeyUpdate(value: unknown): value is PrivateCommunityKeyUpdate { const candidate = value as Partial<PrivateCommunityKeyUpdate>; return !!candidate && candidate.version === 1 && candidate.protocol === PRIVATE_COMMUNITY_PROTOCOL && typeof candidate.id === 'string' && typeof candidate.communityId === 'string' && typeof candidate.actor === 'string' && typeof candidate.recipient === 'string' && Number.isInteger(candidate.epoch) && Number.isInteger(candidate.previousEpoch) && typeof candidate.keyId === 'string' && Array.isArray(candidate.members) && candidate.historyPolicy === PRIVATE_HISTORY_POLICY && typeof candidate.keyNonce === 'string' && typeof candidate.encryptedKey === 'string' && typeof candidate.issuedAt === 'string' && typeof candidate.signature === 'string' && Array.isArray(candidate.bootstrapEvents); }
function unsignedKeyUpdate(value: PrivateCommunityKeyUpdate): UnsignedKeyUpdate { const { signature: _signature, ...unsigned } = value; return unsigned; }
function isRevocationNotice(value: unknown): value is PrivateCommunityRevocationNotice { const candidate = value as Partial<PrivateCommunityRevocationNotice>; return !!candidate && candidate.version === 1 && candidate.protocol === PRIVATE_COMMUNITY_PROTOCOL && typeof candidate.id === 'string' && typeof candidate.communityId === 'string' && typeof candidate.actor === 'string' && typeof candidate.recipient === 'string' && Number.isInteger(candidate.epoch) && !!candidate.membershipEvent && typeof candidate.issuedAt === 'string' && typeof candidate.signature === 'string'; }
function unsignedRevocation(value: PrivateCommunityRevocationNotice): UnsignedRevocationNotice { const { signature: _signature, ...unsigned } = value; return unsigned; }
async function randomKey(): Promise<Uint8Array> { return (await loadSodium()).randombytes_buf(32); }
async function loadSodium(): Promise<any> { const { default: sodium } = await import('libsodium-wrappers'); await sodium.ready; return sodium; }
function encode(value: Uint8Array): string { let binary = ''; value.forEach(byte => { binary += String.fromCharCode(byte); }); return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, ''); }
function decode(value: string): Uint8Array { const normalized = value.replace(/-/g, '+').replace(/_/g, '/'); return Uint8Array.from(atob(normalized + '='.repeat((4 - normalized.length % 4) % 4)), char => char.charCodeAt(0)); }
