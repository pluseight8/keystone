import { canonicalJson, type CryptoProvider } from '../crypto.js';
import type { DeviceSessionKeys } from '../identity.js';
import type { Envelope, EnvelopeSecurity, Transport, UnsignedEnvelope } from '../transport.js';
import type { NodeId } from '../types.js';
import { KEYSTONE_OBJECT_VERSION, type ConversationEventObject, type FileObject, type MessageAttachment, type MessageObject, type MessagePayload, conversationEventObjectSchema, messageObjectSchema, unsignedObject } from './object-model.js';
import { contentUri } from './content.js';
import type { PeerAbuseGuard } from './safety.js';

const MAX_CIPHERTEXT_BYTES = 128 * 1024;
const MAX_ENVELOPE_LIFETIME_MS = 10 * 60_000;
const MESSAGE_TYPES = new Set(['social.message', 'social.conversation_event', 'social.delivery_ack', 'social.read_ack', 'social.typing', 'social.presence']);

export interface SocialContact {
  /** Existing Keystone device identity. No username registry is involved. */
  nodeId: NodeId;
  signingPublicKey: string;
  encryptionPublicKey: string;
}
export interface DirectConversation {
  id: string;
  /** `participants` is retained for direct-chat compatibility; group chats use `members`. */
  participants: readonly NodeId[];
  createdAt: string;
  kind?: 'direct' | 'group';
  title?: string;
  avatarUri?: string;
  members?: readonly NodeId[];
  adminIds?: readonly NodeId[];
  lastReadAt?: string;
  unreadCount?: number;
  lastMessageId?: string;
  lastMessageAt?: string;
  lastMessagePreview?: string;
  pinned?: boolean;
  archived?: boolean;
  muted?: boolean;
  draft?: string;
  revision?: number;
  lastEventId?: string;
}
export interface PendingEnvelope { id: string; peer: NodeId; envelope: Envelope; attempts: number; nextAttemptAt: number; }
export interface DirectMessageEvent { kind: 'message' | 'conversation' | 'typing' | 'presence' | 'read'; peer: NodeId; conversationId?: string; messageId?: string; isTyping?: boolean; presence?: 'online' | 'offline'; conversation?: ConversationEventObject; /** Present for local/remote message events; never leaves the existing encrypted message path. */ message?: MessageObject; }
export interface SendTextOptions { replyTo?: string; quote?: { messageId: string; text: string }; }
export interface SendAttachmentOptions extends SendTextOptions { caption?: string; }

/** Persistence is host-provided; this prevents private messages from entering public CRDT/discovery. */
export interface SocialStorage {
  getConversation(id: string): Promise<DirectConversation | undefined>;
  listConversations(): Promise<readonly DirectConversation[]>;
  saveConversation(value: DirectConversation): Promise<void>;
  upsertMessage(value: MessageObject): Promise<boolean>;
  getMessage(id: string): Promise<MessageObject | undefined>;
  messages(conversationId: string): Promise<readonly MessageObject[]>;
  nextLogicalClock(conversationId: string): Promise<number>;
  enqueue(value: PendingEnvelope): Promise<void>;
  pending(peer?: NodeId): Promise<readonly PendingEnvelope[]>;
  replacePending(value: PendingEnvelope): Promise<void>;
  removePending(id: string): Promise<void>;
  hasSeen(nonce: string): Promise<boolean>;
  markSeen(nonce: string): Promise<void>;
  isBlocked(peer: NodeId): Promise<boolean>;
  setBlocked(peer: NodeId, blocked: boolean): Promise<void>;
  acknowledge(messageId: string, read: boolean): Promise<void>;
  deliveryState(messageId: string): Promise<'pending' | 'delivered' | 'read' | undefined>;
  hasSeenObject(id: string): Promise<boolean>;
  markSeenObject(id: string): Promise<void>;
}

/** Suitable only for tests and development fixtures. Production hosts must inject durable encrypted storage. */
export class InMemorySocialStorage implements SocialStorage {
  private readonly conversations = new Map<string, DirectConversation>(); private readonly values = new Map<string, MessageObject>();
  private readonly outbox = new Map<string, PendingEnvelope>(); private readonly nonces = new Set<string>(); private readonly blocked = new Set<NodeId>();
  private readonly clocks = new Map<string, number>(); private readonly acknowledgements = new Map<string, boolean>();
  async getConversation(id: string) { return this.conversations.get(id); }
  async listConversations() { return [...this.conversations.values()].map(value => structuredClone(value)); }
  async saveConversation(value: DirectConversation) { this.conversations.set(value.id, structuredClone(value)); }
  async upsertMessage(value: MessageObject) { if (this.values.has(value.id)) return false; this.values.set(value.id, structuredClone(value)); return true; }
  async getMessage(id: string) { const value = this.values.get(id); return value ? structuredClone(value) : undefined; }
  async messages(conversationId: string) { return [...this.values.values()].filter(value => value.payload.conversationId === conversationId).sort(compareMessages).map(value => structuredClone(value)); }
  async nextLogicalClock(conversationId: string) { const next = (this.clocks.get(conversationId) ?? 0) + 1; this.clocks.set(conversationId, next); return next; }
  async enqueue(value: PendingEnvelope) { this.outbox.set(value.id, structuredClone(value)); }
  async pending(peer?: NodeId) { return [...this.outbox.values()].filter(value => !peer || value.peer === peer).map(value => structuredClone(value)); }
  async replacePending(value: PendingEnvelope) { this.outbox.set(value.id, structuredClone(value)); }
  async removePending(id: string) { this.outbox.delete(id); }
  async hasSeen(nonce: string) { return this.nonces.has(nonce); }
  async markSeen(nonce: string) { this.nonces.add(nonce); }
  async isBlocked(peer: NodeId) { return this.blocked.has(peer); }
  async setBlocked(peer: NodeId, blocked: boolean) { if (blocked) this.blocked.add(peer); else this.blocked.delete(peer); }
  async acknowledge(messageId: string, read: boolean) { this.acknowledgements.set(messageId, read); }
  async deliveryState(messageId: string) { const value = this.acknowledgements.get(messageId); return value === undefined ? (this.values.has(messageId) ? 'pending' : undefined) : value ? 'read' : 'delivered'; }
  private readonly seenObjects = new Set<string>();
  async hasSeenObject(id: string) { return this.seenObjects.has(id); }
  async markSeenObject(id: string) { this.seenObjects.add(id); }
}

export class DirectMessageService {
  private readonly contacts = new Map<NodeId, SocialContact>(); private readonly unsubscribe: () => void; private readonly listeners = new Set<(event: DirectMessageEvent) => void>();
  private readonly typing = new Map<string, Map<NodeId, ReturnType<typeof setTimeout>>>();
  private readonly presence = new Map<NodeId, 'online' | 'offline'>();
  private typingEnabled = true; private readReceiptsEnabled = true; private presenceEnabled = true;
  private conversationPolicy?: (conversationId: string, sender: NodeId) => Promise<boolean>;
  constructor(
    private readonly transport: Transport,
    private readonly storage: SocialStorage,
    private readonly crypto: CryptoProvider,
    private readonly local: DeviceSessionKeys,
    contacts: readonly SocialContact[],
    private readonly security: EnvelopeSecurity,
    private readonly cipher: DirectMessageCipher,
    private readonly now: () => number = () => Date.now(),
    private readonly abuse?: PeerAbuseGuard,
  ) { contacts.forEach(contact => this.contacts.set(contact.nodeId, contact)); this.unsubscribe = transport.onMessage(envelope => { void this.receive(envelope); }); }
  close(): void { this.unsubscribe(); for (const peers of this.typing.values()) for (const timer of peers.values()) clearTimeout(timer); this.typing.clear(); }
  get localNodeId(): NodeId { return this.local.nodeId; }
  subscribe(listener: (event: DirectMessageEvent) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  setConversationPolicy(policy: ((conversationId: string, sender: NodeId) => Promise<boolean>) | undefined): void { this.conversationPolicy = policy; }
  setTypingIndicatorsEnabled(enabled: boolean): void { this.typingEnabled = enabled; if (!enabled) { for (const peers of this.typing.values()) for (const timer of peers.values()) clearTimeout(timer); this.typing.clear(); } }
  setReadReceiptsEnabled(enabled: boolean): void { this.readReceiptsEnabled = enabled; }
  setPresenceEnabled(enabled: boolean): void { this.presenceEnabled = enabled; if (!enabled) this.presence.clear(); }
  async conversations(): Promise<readonly DirectConversation[]> { return this.storage.listConversations(); }
  async createConversation(peer: NodeId): Promise<DirectConversation> {
    this.contact(peer); const id = await directConversationId(this.local.nodeId, peer); const existing = await this.storage.getConversation(id); if (existing) return existing;
    const participants = [this.local.nodeId, peer].sort() as [NodeId, NodeId]; const conversation = { id, participants, createdAt: new Date(this.now()).toISOString() };
    await this.storage.saveConversation(conversation); return conversation;
  }
  async sendText(peer: NodeId, text: string, options: SendTextOptions = {}): Promise<MessageObject> {
    if (await this.storage.isBlocked(peer)) throw new Error('Cannot send to a blocked identity');
    if (!text.trim() || text.length > 16_384) throw new Error('Invalid message text');
    const conversation = await this.createConversation(peer);
    if (options.replyTo) await this.assertConversationMessage(conversation.id, options.replyTo);
    return this.publish(peer, { conversationId: conversation.id, kind: 'text', text, logicalClock: await this.storage.nextLogicalClock(conversation.id), ...options, attachments: [] });
  }
  async react(peer: NodeId, targetMessageId: string, emoji: string): Promise<MessageObject> {
    if (!emoji || emoji.length > 32) throw new Error('Invalid reaction'); const conversation = await this.createConversation(peer); await this.assertConversationMessage(conversation.id, targetMessageId);
    return this.publish(peer, { conversationId: conversation.id, kind: 'reaction', targetMessageId, emoji, logicalClock: await this.storage.nextLogicalClock(conversation.id) });
  }
  async sendAttachments(peer: NodeId, attachments: readonly MessageAttachment[], options: SendAttachmentOptions = {}): Promise<MessageObject> {
    if (!attachments.length || attachments.length > 32 || attachments.some(attachment => !/^keystone:\/\/content\/sha256-[a-f0-9]{64}$/i.test(attachment.contentUri))) throw new Error('Invalid message attachments'); if (options.caption && options.caption.length > 16_384) throw new Error('Invalid attachment caption');
    const conversation = await this.createConversation(peer); if (options.replyTo) await this.assertConversationMessage(conversation.id, options.replyTo);
    return this.publish(peer, { conversationId: conversation.id, kind: 'attachment', attachments: [...attachments], logicalClock: await this.storage.nextLogicalClock(conversation.id), ...(options.caption ? { text: options.caption } : {}), ...(options.replyTo ? { replyTo: options.replyTo } : {}), ...(options.quote ? { quote: options.quote } : {}) });
  }
  /** Sends a reference to the canonical FileObject; bytes remain in content-addressed storage. */
  async sendFile(peer: NodeId, file: Pick<FileObject, 'id' | 'payload'>, caption = ''): Promise<MessageObject> {
    const conversation = await this.createConversation(peer);
    const attachment: MessageAttachment = { fileId: file.id, contentUri: contentUri(file.payload.contentId as `sha256-${string}`), name: file.payload.filename, mimeType: file.payload.mimeType, size: file.payload.size };
    return this.publish(peer, { conversationId: conversation.id, kind: 'attachment', attachments: [attachment], logicalClock: await this.storage.nextLogicalClock(conversation.id), ...(caption ? { text: caption } : {}) }, {}, [{ id: file.id, type: 'file_object' }]);
  }
  async editText(peer: NodeId, messageId: string, text: string): Promise<MessageObject> {
    if (!text.trim() || text.length > 16_384) throw new Error('Invalid message text'); const original = await this.ownTextMessage(messageId); const conversation = await this.createConversation(peer); if (original.payload.conversationId !== conversation.id) throw new Error('Message belongs to another conversation');
    return this.publish(peer, { ...original.payload, text, logicalClock: await this.storage.nextLogicalClock(conversation.id) }, { supersedes: original.id, updatedAt: new Date(this.now()).toISOString() });
  }
  async deleteMessage(peer: NodeId, messageId: string): Promise<MessageObject> {
    const original = await this.ownTextMessage(messageId); const conversation = await this.createConversation(peer); if (original.payload.conversationId !== conversation.id) throw new Error('Message belongs to another conversation');
    return this.publish(peer, { ...original.payload, logicalClock: await this.storage.nextLogicalClock(conversation.id) }, { supersedes: original.id, deleted: true, updatedAt: new Date(this.now()).toISOString() });
  }
  async history(conversationId: string, options: { limit?: number; before?: string } = {}): Promise<readonly MessageObject[]> {
    const values = await this.storage.messages(conversationId); const before = options.before ? values.findIndex(value => value.id === options.before) : -1;
    const bounded = before >= 0 ? values.slice(0, before) : values; const limit = Math.max(1, Math.min(500, options.limit ?? 500)); return bounded.slice(Math.max(0, bounded.length - limit));
  }
  async searchMessages(query: string, conversationId?: string): Promise<readonly MessageObject[]> {
    const normalized = query.trim().toLocaleLowerCase(); if (!normalized) return [];
    const conversations = conversationId ? [conversationId] : (await this.storage.listConversations()).map(value => value.id); const values: MessageObject[] = [];
    for (const id of conversations) for (const value of await this.storage.messages(id)) {
      const haystack = value.payload.kind === 'reaction' ? value.payload.emoji : `${value.payload.kind === 'attachment' ? value.payload.text ?? '' : value.payload.text} ${value.references.map(reference => reference.id).join(' ')}`;
      if (haystack.toLocaleLowerCase().includes(normalized)) values.push(value);
    }
    return values;
  }
  async deliveryState(messageId: string): Promise<'pending' | 'delivered' | 'read' | undefined> { return this.storage.deliveryState(messageId); }
  async markRead(peer: NodeId, messageId: string): Promise<void> { if (!/^[0-9a-f-]{36}$/i.test(messageId)) throw new Error('Invalid message id'); const message = await this.storage.getMessage(messageId); if (message) await this.markConversationRead(message.payload.conversationId); if (!this.readReceiptsEnabled) return; await this.queue(peer, 'social.read_ack', { messageId, ...(message ? { conversationId: message.payload.conversationId } : {}) }); await this.flush(peer); }
  async sendTyping(peer: NodeId, isTyping: boolean): Promise<void> { if (!this.typingEnabled) return; const conversation = await this.createConversation(peer); await this.sendConversationTyping(conversation.id, [peer], isTyping); }
  async sendConversationTyping(conversationId: string, recipients: readonly NodeId[], isTyping: boolean): Promise<void> { if (!this.typingEnabled) return; await this.ensureLocalParticipant(conversationId); for (const peer of uniquePeers(recipients, this.local.nodeId)) { await this.queue(peer, 'social.typing', { conversationId, isTyping: !!isTyping }); await this.flush(peer); } }
  async sendConversationRead(conversationId: string, peer: NodeId, messageId?: string): Promise<void> { await this.ensureLocalParticipant(conversationId); if (!this.readReceiptsEnabled) return; this.contact(peer); await this.queue(peer, 'social.read_ack', { conversationId, ...(messageId ? { messageId } : {}) }); await this.flush(peer); }
  async sendPresence(peer: NodeId, state: 'online' | 'offline'): Promise<void> { if (!this.presenceEnabled) return; this.contact(peer); await this.queue(peer, 'social.presence', { state }); await this.flush(peer); }
  presenceOf(peer: NodeId): 'online' | 'offline' | undefined { return this.presence.get(peer); }
  typingPeers(conversationId: string): readonly NodeId[] { return [...(this.typing.get(conversationId)?.keys() ?? [])]; }
  async markConversationRead(conversationId: string): Promise<void> { const conversation = await this.storage.getConversation(conversationId); if (!conversation) throw new Error('Unknown conversation'); await this.storage.saveConversation({ ...conversation, unreadCount: 0, lastReadAt: new Date(this.now()).toISOString() }); }
  async setConversationFlag(conversationId: string, flag: 'pinned' | 'archived' | 'muted', value: boolean): Promise<DirectConversation> { const conversation = await this.storage.getConversation(conversationId); if (!conversation) throw new Error('Unknown conversation'); const updated = { ...conversation, [flag]: !!value }; await this.storage.saveConversation(updated); return updated; }
  async setDraft(conversationId: string, draft: string): Promise<DirectConversation> { if (draft.length > 16_384) throw new Error('Draft is too large'); const conversation = await this.storage.getConversation(conversationId); if (!conversation) throw new Error('Unknown conversation'); const updated = { ...conversation, draft: draft || undefined }; await this.storage.saveConversation(updated); return updated; }
  async sendConversationMessage(conversationId: string, recipients: readonly NodeId[], payload: MessagePayload, revision: Pick<MessageObject, 'supersedes' | 'updatedAt' | 'deleted'> = {}, references: MessageObject['references'] = []): Promise<MessageObject> {
    if (payload.conversationId !== conversationId) throw new Error('Message conversation mismatch'); const conversation = await this.ensureLocalParticipant(conversationId); const members = conversation.kind === 'group' ? conversation.members ?? conversation.participants : conversation.participants; const peers = uniquePeers(recipients, this.local.nodeId); if (!peers.length) throw new Error('Conversation has no recipients'); peers.forEach(peer => { this.contact(peer); if (!members.includes(peer)) throw new Error('Recipient is not a conversation member'); }); return this.publishToPeers(peers, payload, revision, references);
  }
  async sendConversationEvent(recipients: readonly NodeId[], event: ConversationEventObject): Promise<void> { conversationEventObjectSchema.parse(event); if (event.author !== this.local.nodeId || !event.payload.members.includes(this.local.nodeId)) throw new Error('Conversation event author mismatch'); for (const peer of uniquePeers(recipients, this.local.nodeId)) { this.contact(peer); await this.queue(peer, 'social.conversation_event', { event }); await this.flush(peer); } }
  async block(peer: NodeId): Promise<void> { await this.storage.setBlocked(peer, true); }
  async unblock(peer: NodeId): Promise<void> { await this.storage.setBlocked(peer, false); }
  async flush(peer?: NodeId): Promise<void> {
    for (const item of await this.storage.pending(peer)) {
      try { await this.transport.connect(item.peer); await this.transport.send(item.peer, item.envelope); if (item.envelope.type === 'social.message') await this.storage.replacePending({ ...item, attempts: item.attempts + 1, nextAttemptAt: this.now() + retryDelay(item.attempts) }); else await this.storage.removePending(item.id); }
      catch { await this.storage.replacePending({ ...item, attempts: item.attempts + 1, nextAttemptAt: this.now() + retryDelay(item.attempts) }); }
    }
  }
  private async queue(peer: NodeId, type: string, value: unknown): Promise<void> {
    const contact = this.contact(peer); const plaintext = JSON.stringify(value); const body = await this.cipher.encrypt(plaintext, this.local.encryptionPrivateKey, contact.encryptionPublicKey);
    if (body.ciphertext.length > MAX_CIPHERTEXT_BYTES) throw new Error('Encrypted message exceeds protocol limit');
    const unsigned: UnsignedEnvelope = { version: 1, type, id: crypto.randomUUID(), sender: this.local.nodeId, recipient: peer, nonce: await this.crypto.randomNonce(), expiresAt: new Date(this.now() + MAX_ENVELOPE_LIFETIME_MS).toISOString(), body };
    const envelope = { ...unsigned, signature: await this.security.sign(unsigned) }; await this.storage.enqueue({ id: envelope.id, peer, envelope, attempts: 0, nextAttemptAt: this.now() });
  }
  async sendTrack(peer: NodeId, trackId: string, title: string): Promise<MessageObject> {
    if (!/^[0-9a-f]{64}$/i.test(trackId) && !/^[0-9a-f-]{36}$/i.test(trackId)) throw new Error('Invalid track reference');
    const conversation = await this.createConversation(peer);
    return this.publish(peer, { conversationId: conversation.id, kind: 'text', text: title.trim() || 'Track', logicalClock: await this.storage.nextLogicalClock(conversation.id), attachments: [] }, {}, [{ id: trackId, type: 'track' }]);
  }
  async sendVideo(peer: NodeId, videoId: string, title: string): Promise<MessageObject> {
    if (!/^[0-9a-f]{64}$/i.test(videoId) && !/^[0-9a-f-]{36}$/i.test(videoId)) throw new Error('Invalid video reference');
    const conversation = await this.createConversation(peer);
    return this.publish(peer, { conversationId: conversation.id, kind: 'text', text: title.trim() || 'Video', logicalClock: await this.storage.nextLogicalClock(conversation.id), attachments: [] }, {}, [{ id: videoId, type: 'video' }]);
  }
  async sendLive(peer: NodeId, broadcastId: string, title: string): Promise<MessageObject> {
    if (!/^[0-9a-f]{64}$/i.test(broadcastId) && !/^[0-9a-f-]{36}$/i.test(broadcastId)) throw new Error('Invalid live reference');
    const conversation = await this.createConversation(peer);
    return this.publish(peer, { conversationId: conversation.id, kind: 'text', text: title.trim() || 'Live', logicalClock: await this.storage.nextLogicalClock(conversation.id), attachments: [] }, {}, [{ id: broadcastId, type: 'live_broadcast' }]);
  }
  async sendShort(peer: NodeId, shortId: string, title: string): Promise<MessageObject> { return this.sendReference(peer, shortId, title, 'short_video'); }
  async sendProfile(peer: NodeId, profileId: string, title: string): Promise<MessageObject> { return this.sendReference(peer, profileId, title, 'identity.profile'); }
  async sendCommunity(peer: NodeId, communityId: string, title: string): Promise<MessageObject> { return this.sendReference(peer, communityId, title, 'community'); }
  private async sendReference(peer: NodeId, objectId: string, title: string, type: MessageObject['references'][number]['type']): Promise<MessageObject> {
    if (!/^[0-9a-f]{64}$/i.test(objectId) && !/^[0-9a-f-]{36}$/i.test(objectId)) throw new Error('Invalid object reference'); const conversation = await this.createConversation(peer);
    return this.publish(peer, { conversationId: conversation.id, kind: 'text', text: title.trim() || type, logicalClock: await this.storage.nextLogicalClock(conversation.id), attachments: [] }, {}, [{ id: objectId, type }]);
  }
  private async publish(peer: NodeId, payload: MessagePayload, revision: Pick<MessageObject, 'supersedes' | 'updatedAt' | 'deleted'> = {}, references: MessageObject['references'] = []): Promise<MessageObject> {
    return this.publishToPeers([peer], payload, revision, references);
  }
  private async publishToPeers(peers: readonly NodeId[], payload: MessagePayload, revision: Pick<MessageObject, 'supersedes' | 'updatedAt' | 'deleted'> = {}, references: MessageObject['references'] = []): Promise<MessageObject> {
    for (const peer of peers) if (await this.storage.isBlocked(peer)) throw new Error('Cannot send to a blocked identity'); const createdAt = new Date(this.now()).toISOString();
    const unsigned = { version: KEYSTONE_OBJECT_VERSION as 1, type: 'message' as const, id: crypto.randomUUID(), author: this.local.nodeId, createdAt, visibility: 'private' as const, references, payload, ...revision };
    const message: MessageObject = { ...unsigned, signature: await this.crypto.sign(canonicalJson(unsigned), this.local.privateKey) };
    await this.storage.upsertMessage(message); await this.touchConversation(message, false); this.emit({ kind: 'message', peer: peers[0]!, conversationId: payload.conversationId, messageId: message.id, message });
    for (const peer of peers) { await this.queue(peer, 'social.message', { message }); await this.flush(peer); } return message;
  }
  private async ensureLocalParticipant(conversationId: string): Promise<DirectConversation> { const conversation = await this.storage.getConversation(conversationId); if (!conversation) throw new Error('Unknown conversation'); const members = conversation.kind === 'group' ? conversation.members ?? conversation.participants : conversation.participants; if (!members.includes(this.local.nodeId)) throw new Error('Not a conversation member'); return conversation; }
  private async assertConversationMessage(conversationId: string, messageId: string): Promise<MessageObject> { const message = await this.storage.getMessage(messageId); if (!message || message.payload.conversationId !== conversationId) throw new Error('Unknown conversation message'); return message; }
  private async ownTextMessage(messageId: string): Promise<MessageObject & { payload: Extract<MessagePayload, { kind: 'text' }> }> { const message = await this.storage.getMessage(messageId); if (!message || message.author !== this.local.nodeId || message.payload.kind !== 'text' || message.deleted) throw new Error('Message cannot be changed'); return message as MessageObject & { payload: Extract<MessagePayload, { kind: 'text' }> }; }
  private async receive(envelope: Envelope): Promise<void> {
    if (!MESSAGE_TYPES.has(envelope.type) || envelope.recipient !== this.local.nodeId || Date.parse(envelope.expiresAt) <= this.now() || Date.parse(envelope.expiresAt) - this.now() > MAX_ENVELOPE_LIFETIME_MS) return;
    if (!this.contacts.has(envelope.sender) || await this.storage.isBlocked(envelope.sender) || await this.storage.hasSeen(envelope.nonce) || !(await this.security.verify(envelope))) return;
    if (this.abuse && !this.abuse.allow({ peer: envelope.sender, kind: envelope.type, bytes: ciphertextBytes(envelope.body), knownContact: true })) return;
    if (!hasBoundedCiphertext(envelope.body)) { this.abuse?.malformed(envelope.sender); return; }
    const body = await this.cipher.decrypt(envelope.body, this.local.encryptionPrivateKey, this.contact(envelope.sender).encryptionPublicKey).catch(() => undefined); if (!body) { this.abuse?.malformed(envelope.sender); return; }
    let payload: any; try { payload = JSON.parse(body); } catch { this.abuse?.malformed(envelope.sender); return; }
    await this.storage.markSeen(envelope.nonce);
    if (envelope.type === 'social.conversation_event') {
      let event: ConversationEventObject; try { event = conversationEventObjectSchema.parse(payload.event); } catch { this.abuse?.malformed(envelope.sender); return; }
      if (event.author !== envelope.sender || !(await this.crypto.verify(canonicalJson(unsignedObject(event)), event.signature, this.contact(envelope.sender).signingPublicKey))) { this.abuse?.malformed(envelope.sender); return; }
      if (await this.storage.hasSeenObject(event.id)) return; await this.storage.markSeenObject(event.id); this.emit({ kind: 'conversation', peer: envelope.sender, conversationId: event.payload.conversationId, conversation: event }); return;
    }
    if (envelope.type === 'social.message') {
      let message: MessageObject; try { message = messageObjectSchema.parse(payload.message); } catch { this.abuse?.malformed(envelope.sender); return; }
      if (message.author !== envelope.sender || !(await this.crypto.verify(canonicalJson(unsignedObject(message)), message.signature, this.contact(envelope.sender).signingPublicKey))) { this.abuse?.malformed(envelope.sender); return; }
      if (this.conversationPolicy && !(await this.conversationPolicy(message.payload.conversationId, envelope.sender))) return;
      if (await this.storage.upsertMessage(message)) { await this.touchConversation(message, true); this.emit({ kind: 'message', peer: envelope.sender, conversationId: message.payload.conversationId, messageId: message.id, message }); await this.queue(envelope.sender, 'social.delivery_ack', { messageId: message.id, deliveryEnvelopeId: envelope.id }); await this.flush(envelope.sender); }
      return;
    }
    if (envelope.type === 'social.typing') { if (typeof payload.isTyping !== 'boolean') return; const conversationId = typeof payload.conversationId === 'string' ? payload.conversationId : undefined; this.updateTyping(conversationId, envelope.sender, payload.isTyping); this.emit({ kind: 'typing', peer: envelope.sender, conversationId, isTyping: payload.isTyping }); return; }
    if (envelope.type === 'social.presence') { if (payload.state !== 'online' && payload.state !== 'offline') return; this.presence.set(envelope.sender, payload.state); this.emit({ kind: 'presence', peer: envelope.sender, presence: payload.state }); return; }
    if (typeof payload.messageId !== 'string') return;
    if (envelope.type === 'social.delivery_ack' && typeof payload.deliveryEnvelopeId === 'string') await this.storage.removePending(payload.deliveryEnvelopeId);
    await this.storage.acknowledge(payload.messageId, envelope.type === 'social.read_ack'); if (envelope.type === 'social.read_ack') this.emit({ kind: 'read', peer: envelope.sender, messageId: payload.messageId });
  }
  private async touchConversation(message: MessageObject, remote: boolean): Promise<void> {
    let conversation = await this.storage.getConversation(message.payload.conversationId);
    if (!conversation && remote && message.author !== this.local.nodeId && message.payload.conversationId === await directConversationId(this.local.nodeId, message.author)) {
      const participants = [this.local.nodeId, message.author].sort(); conversation = { id: message.payload.conversationId, participants, kind: 'direct', createdAt: message.createdAt };
    }
    if (!conversation) return;
    const preview = message.deleted ? 'Message deleted' : message.payload.kind === 'reaction' ? message.payload.emoji : message.payload.kind === 'attachment' ? (message.payload.text || `${message.payload.attachments.length} attachment(s)`) : message.payload.text;
    await this.storage.saveConversation({ ...conversation, lastMessageId: message.id, lastMessageAt: message.createdAt, lastMessagePreview: preview, ...(remote && message.author !== this.local.nodeId ? { unreadCount: (conversation.unreadCount ?? 0) + 1 } : {}) });
  }
  private updateTyping(conversationId: string | undefined, peer: NodeId, isTyping: boolean): void {
    if (!conversationId) return; let peers = this.typing.get(conversationId); if (!peers) { peers = new Map(); this.typing.set(conversationId, peers); }
    const previous = peers.get(peer); if (previous) clearTimeout(previous); if (!isTyping) { peers.delete(peer); if (!peers.size) this.typing.delete(conversationId); return; }
    peers.set(peer, setTimeout(() => { peers?.delete(peer); if (peers && !peers.size) this.typing.delete(conversationId); this.emit({ kind: 'typing', peer, conversationId, isTyping: false }); }, 8_000));
  }
  private contact(peer: NodeId): SocialContact { const contact = this.contacts.get(peer); if (!contact) throw new Error('Unknown social identity'); return contact; }
  private emit(event: DirectMessageEvent): void { this.listeners.forEach(listener => listener(event)); }
}

/** Application encryption is required because optional relays only protect each Noise hop. */
export interface DirectMessageCipher { encrypt(value: string, senderPrivateKey: string, recipientPublicKey: string): Promise<EncryptedDirectPayload>; decrypt(value: unknown, recipientPrivateKey: string, senderPublicKey: string): Promise<string>; }
export interface EncryptedDirectPayload { algorithm: 'xsalsa20poly1305'; nonce: string; ciphertext: string; }
export class SodiumDirectMessageCipher implements DirectMessageCipher {
  private readonly ready = import('libsodium-wrappers').then(async ({ default: sodium }) => { await sodium.ready; return sodium; });
  async encrypt(value: string, senderPrivateKey: string, recipientPublicKey: string): Promise<EncryptedDirectPayload> { const s = await this.ready; const nonce = s.randombytes_buf(s.crypto_box_NONCEBYTES); const cipher = s.crypto_box_easy(s.from_string(value), nonce, s.from_base64(recipientPublicKey, s.base64_variants.URLSAFE_NO_PADDING), s.from_base64(senderPrivateKey, s.base64_variants.URLSAFE_NO_PADDING)); return { algorithm: 'xsalsa20poly1305', nonce: s.to_base64(nonce, s.base64_variants.URLSAFE_NO_PADDING), ciphertext: s.to_base64(cipher, s.base64_variants.URLSAFE_NO_PADDING) }; }
  async decrypt(value: unknown, recipientPrivateKey: string, senderPublicKey: string): Promise<string> { const s = await this.ready; if (!value || typeof value !== 'object') throw new Error('Invalid encrypted payload'); const payload = value as Partial<EncryptedDirectPayload>; if (payload.algorithm !== 'xsalsa20poly1305' || typeof payload.nonce !== 'string' || typeof payload.ciphertext !== 'string') throw new Error('Invalid encrypted payload'); const plain = s.crypto_box_open_easy(s.from_base64(payload.ciphertext, s.base64_variants.URLSAFE_NO_PADDING), s.from_base64(payload.nonce, s.base64_variants.URLSAFE_NO_PADDING), s.from_base64(senderPublicKey, s.base64_variants.URLSAFE_NO_PADDING), s.from_base64(recipientPrivateKey, s.base64_variants.URLSAFE_NO_PADDING)); return s.to_string(plain); }
}
/** Verifies contact envelopes using the existing device Ed25519 key material. */
export class ContactEnvelopeSecurity implements EnvelopeSecurity {
  private readonly ready = import('libsodium-wrappers').then(async ({ default: sodium }) => { await sodium.ready; return sodium; }); private readonly keys = new Map<NodeId, string>();
  constructor(private readonly local: DeviceSessionKeys, contacts: readonly SocialContact[]) { this.keys.set(local.nodeId, local.publicKey); contacts.forEach(contact => this.keys.set(contact.nodeId, contact.signingPublicKey)); }
  async sign(envelope: UnsignedEnvelope): Promise<string> { if (envelope.sender !== this.local.nodeId) throw new Error('Cannot sign for another identity'); const s = await this.ready; return s.to_base64(s.crypto_sign_detached(s.from_string(canonicalJson(envelope)), s.from_base64(this.local.privateKey, s.base64_variants.URLSAFE_NO_PADDING)), s.base64_variants.URLSAFE_NO_PADDING); }
  async verify(envelope: Envelope): Promise<boolean> { const key = this.keys.get(envelope.sender); if (!key || !envelope.signature) return false; const s = await this.ready; try { const { signature: _signature, ...unsigned } = envelope; return s.crypto_sign_verify_detached(s.from_base64(envelope.signature, s.base64_variants.URLSAFE_NO_PADDING), s.from_string(canonicalJson(unsigned)), s.from_base64(key, s.base64_variants.URLSAFE_NO_PADDING)); } catch { return false; } }
}
export async function directConversationId(a: NodeId, b: NodeId): Promise<string> { const material = `keystone:direct-conversation:v1:${[a, b].sort().join(':')}`; const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material)); return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join(''); }
/** Deterministic group identity: membership, not a mutable title, defines the conversation. */
export async function groupConversationId(members: readonly NodeId[]): Promise<string> { const normalized = [...new Set(members)].sort(); if (normalized.length < 2) throw new Error('A group needs at least two members'); const material = `keystone:group-conversation:v1:${normalized.join(':')}`; const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material)); return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join(''); }
function retryDelay(attempts: number): number { return Math.min(60_000, 1_000 * 2 ** Math.min(attempts, 6)); }
function compareMessages(a: MessageObject, b: MessageObject): number { return a.payload.logicalClock - b.payload.logicalClock || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id); }
function hasBoundedCiphertext(value: unknown): value is EncryptedDirectPayload { return !!value && typeof value === 'object' && (value as Partial<EncryptedDirectPayload>).algorithm === 'xsalsa20poly1305' && typeof (value as Partial<EncryptedDirectPayload>).nonce === 'string' && typeof (value as Partial<EncryptedDirectPayload>).ciphertext === 'string' && (value as Partial<EncryptedDirectPayload>).ciphertext!.length <= MAX_CIPHERTEXT_BYTES; }
function ciphertextBytes(value: unknown): number { try { return new TextEncoder().encode(JSON.stringify(value)).byteLength; } catch { return Number.MAX_SAFE_INTEGER; } }
function uniquePeers(peers: readonly NodeId[], local: NodeId): NodeId[] { return [...new Set(peers)].filter(peer => peer !== local); }
