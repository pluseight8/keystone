import { type CryptoProvider, signCanonical } from '../crypto.js';
import type { DeviceSessionKeys } from '../identity.js';
import type { NodeId } from '../types.js';
import {
  KEYSTONE_OBJECT_VERSION,
  conversationEventObjectSchema,
  type ConversationEventObject,
  type FileObject,
  type MessageAttachment,
  type MessageObject,
  type MessagePayload,
  unsignedObject,
} from './object-model.js';
import { contentUri } from './content.js';
import {
  DirectMessageService,
  directConversationId,
  groupConversationId,
  type DirectConversation,
  type SendAttachmentOptions,
  type SendTextOptions,
  type SocialStorage,
} from './messaging.js';
import { MandatorySafetySurfaceRegistry } from '../security/safety-surfaces.js';
import { SafetyRuntime, SafetySurfaceGate } from '../security/content-safety.js';

export interface GroupCreateOptions { title: string; members: readonly NodeId[]; avatarUri?: string; }
export interface GroupMessageOptions extends SendTextOptions {}
export interface GroupStats { acceptedEvents: number; rejectedEvents: number; members: number; }

/**
 * Group conversations are a projection of signed membership events plus the
 * existing encrypted message service. There is no group server or group
 * transport: each event/message is encrypted and sent to every current member.
 */
export class GroupConversationService {
  private readonly unsubscribe: () => void;
  private acceptedEvents = 0;
  private rejectedEvents = 0;

  constructor(
    private readonly messages: DirectMessageService,
    private readonly storage: SocialStorage,
    private readonly crypto: CryptoProvider,
    private readonly local: DeviceSessionKeys,
    private readonly now: () => number = () => Date.now(),
    private readonly protectedSurfaces = new MandatorySafetySurfaceRegistry(new SafetySurfaceGate(new SafetyRuntime())),
  ) {
    this.messages.setConversationPolicy((conversationId, sender) => this.authorizeMessage(conversationId, sender));
    this.unsubscribe = this.messages.subscribe(event => {
      if (event.kind === 'conversation' && event.conversation) void this.applyEvent(event.conversation);
    });
  }

  close(): void { this.unsubscribe(); this.messages.setConversationPolicy(undefined); }
  get localNodeId(): NodeId { return this.local.nodeId; }
  async list(): Promise<readonly DirectConversation[]> { const values = (await this.storage.listConversations()).filter(value => value.kind === 'group'); return (await Promise.all(values.map(async value => await this.eligible(value) ? value : undefined))).filter((value): value is DirectConversation => !!value); }
  async conversations(): Promise<readonly DirectConversation[]> { return this.list(); }
  async get(conversationId: string): Promise<DirectConversation | undefined> { const value = await this.storage.getConversation(conversationId); return value?.kind === 'group' && await this.eligible(value) ? value : undefined; }
  async getConversation(conversationId: string): Promise<DirectConversation | undefined> { return this.get(conversationId); }
  async stats(conversationId?: string): Promise<GroupStats> { const conversation = conversationId ? await this.get(conversationId) : undefined; return { acceptedEvents: this.acceptedEvents, rejectedEvents: this.rejectedEvents, members: conversation?.members?.length ?? 0 }; }

  async create(options: GroupCreateOptions): Promise<DirectConversation> {
    const title = options.title.trim(); if (!title || title.length > 160) throw new Error('Invalid group title');
    const members = uniqueMembers([this.local.nodeId, ...options.members]); if (members.length < 2) throw new Error('A group needs at least two members');
    const id = await groupConversationId(members); const existing = await this.get(id); if (existing) return existing;
    const conversation: DirectConversation = { id, participants: members, members, adminIds: [this.local.nodeId], kind: 'group', title, ...(options.avatarUri ? { avatarUri: options.avatarUri } : {}), createdAt: new Date(this.now()).toISOString(), revision: 1, unreadCount: 0 };
    if (!(await this.eligible(conversation))) throw new Error('Group conversation failed mandatory SafetySurfaceGate'); await this.storage.saveConversation(conversation);
    const event = await this.event({ conversationId: id, action: 'create', title, ...(options.avatarUri ? { avatarUri: options.avatarUri } : {}), members, adminIds: [this.local.nodeId] });
    await this.storage.markSeenObject(event.id); await this.broadcast(event, members); return conversation;
  }
  async createGroup(options: GroupCreateOptions): Promise<DirectConversation> { return this.create(options); }

  async addMember(conversationId: string, member: NodeId): Promise<DirectConversation> {
    const current = await this.requireAdmin(conversationId); if (current.members?.includes(member)) return current;
    const members = uniqueMembers([...(current.members ?? current.participants), member]); const next = await this.saveState(current, members, current.adminIds ?? [this.local.nodeId]);
    await this.broadcast(await this.event({ conversationId, action: 'add', member, members, adminIds: [...(next.adminIds ?? [this.local.nodeId])], ...(next.title ? { title: next.title } : {}), ...(next.avatarUri ? { avatarUri: next.avatarUri } : {}) }), members); return next;
  }

  async removeMember(conversationId: string, member: NodeId): Promise<DirectConversation> {
    const current = await this.requireAdmin(conversationId); if (member === this.local.nodeId) throw new Error('Use leave() to remove yourself'); if (!(current.members ?? []).includes(member)) return current;
    const members = (current.members ?? current.participants).filter(value => value !== member); if (members.length < 2) throw new Error('A group needs at least two members'); const admins = (current.adminIds ?? [this.local.nodeId]).filter(value => value !== member); if (!admins.length) throw new Error('A group needs an administrator');
    const next = await this.saveState(current, members, admins); await this.broadcast(await this.event({ conversationId, action: 'remove', member, members, adminIds: admins, ...(next.title ? { title: next.title } : {}), ...(next.avatarUri ? { avatarUri: next.avatarUri } : {}) }), uniqueMembers([...(current.members ?? []), ...members])); return next;
  }

  async leave(conversationId: string): Promise<DirectConversation> {
    const current = await this.requireMember(conversationId); if (current.members?.length === 2) throw new Error('The last member cannot leave a two-member group');
    const members = (current.members ?? current.participants).filter(value => value !== this.local.nodeId); const admins = (current.adminIds ?? []).filter(value => value !== this.local.nodeId); if (!admins.length) admins.push(members[0]!);
    const next = await this.saveState(current, members, admins); await this.broadcast(await this.event({ conversationId, action: 'leave', member: this.local.nodeId, members, adminIds: admins, ...(next.title ? { title: next.title } : {}), ...(next.avatarUri ? { avatarUri: next.avatarUri } : {}) }), uniqueMembers([...(current.members ?? []), ...members])); return next;
  }

  async setRole(conversationId: string, member: NodeId, role: 'admin' | 'member'): Promise<DirectConversation> {
    const current = await this.requireAdmin(conversationId); if (!(current.members ?? []).includes(member)) throw new Error('Unknown group member'); let admins = [...(current.adminIds ?? [])]; admins = role === 'admin' ? uniqueMembers([...admins, member]) : admins.filter(value => value !== member); if (!admins.length) throw new Error('A group needs an administrator');
    const next = await this.saveState(current, current.members ?? current.participants, admins); await this.broadcast(await this.event({ conversationId, action: 'set_role', member, role, members: [...(next.members ?? [])], adminIds: admins, ...(next.title ? { title: next.title } : {}), ...(next.avatarUri ? { avatarUri: next.avatarUri } : {}) }), next.members ?? []); return next;
  }

  async rename(conversationId: string, title: string, avatarUri?: string): Promise<DirectConversation> {
    const current = await this.requireAdmin(conversationId); title = title.trim(); if (!title || title.length > 160) throw new Error('Invalid group title'); const next = { ...current, title, ...(avatarUri === undefined ? {} : { avatarUri }), revision: (current.revision ?? 0) + 1 };
    if (!(await this.eligible(next))) throw new Error('Group conversation failed mandatory SafetySurfaceGate'); await this.storage.saveConversation(next); await this.broadcast(await this.event({ conversationId, action: 'update', title, ...(avatarUri ? { avatarUri } : {}), members: [...(next.members ?? next.participants)], adminIds: [...(next.adminIds ?? [this.local.nodeId])] }), next.members ?? next.participants); return next;
  }

  async sendText(conversationId: string, text: string, options: GroupMessageOptions = {}): Promise<MessageObject> {
    const conversation = await this.requireMember(conversationId); if (!text.trim() || text.length > 16_384) throw new Error('Invalid message text'); if (options.replyTo) await this.assertMessage(conversationId, options.replyTo);
    return this.messages.sendConversationMessage(conversationId, conversation.members ?? conversation.participants, { conversationId, kind: 'text', text, logicalClock: await this.storage.nextLogicalClock(conversationId), ...options, attachments: [] }, {}, []);
  }
  async sendMessage(conversationId: string, text: string, options: GroupMessageOptions = {}): Promise<MessageObject> { return this.sendText(conversationId, text, options); }
  async sendGroupMessage(conversationId: string, text: string, options: GroupMessageOptions = {}): Promise<MessageObject> { return this.sendText(conversationId, text, options); }

  async sendAttachments(conversationId: string, attachments: readonly MessageAttachment[], options: SendAttachmentOptions = {}): Promise<MessageObject> {
    const conversation = await this.requireMember(conversationId); if (!attachments.length || attachments.length > 32 || attachments.some(value => !/^keystone:\/\/content\/sha256-[a-f0-9]{64}$/i.test(value.contentUri))) throw new Error('Invalid message attachments'); if (options.replyTo) await this.assertMessage(conversationId, options.replyTo);
    return this.messages.sendConversationMessage(conversationId, conversation.members ?? conversation.participants, { conversationId, kind: 'attachment', attachments: [...attachments], logicalClock: await this.storage.nextLogicalClock(conversationId), ...(options.caption ? { text: options.caption } : {}), ...(options.replyTo ? { replyTo: options.replyTo } : {}), ...(options.quote ? { quote: options.quote } : {}) });
  }
  /** Sends the same FileObject ID used by Library, Community and Profile surfaces. */
  async sendFile(conversationId: string, file: Pick<FileObject, 'id' | 'payload'>, caption = ''): Promise<MessageObject> {
    const conversation = await this.requireMember(conversationId); const attachment: MessageAttachment = { fileId: file.id, contentUri: contentUri(file.payload.contentId as `sha256-${string}`), name: file.payload.filename, mimeType: file.payload.mimeType, size: file.payload.size };
    return this.messages.sendConversationMessage(conversationId, conversation.members ?? conversation.participants, { conversationId, kind: 'attachment', attachments: [attachment], logicalClock: await this.storage.nextLogicalClock(conversationId), ...(caption ? { text: caption } : {}) }, {}, [{ id: file.id, type: 'file_object' }]);
  }

  async sendReference(conversationId: string, id: string, title: string, type: MessageObject['references'][number]['type']): Promise<MessageObject> {
    const conversation = await this.requireMember(conversationId); if (!/^[0-9a-f]{64}$/i.test(id) && !/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Invalid object reference'); return this.messages.sendConversationMessage(conversationId, conversation.members ?? conversation.participants, { conversationId, kind: 'text', text: title.trim() || type, logicalClock: await this.storage.nextLogicalClock(conversationId), attachments: [] }, {}, [{ id, type }]);
  }
  async sendTrack(conversationId: string, id: string, title: string): Promise<MessageObject> { return this.sendReference(conversationId, id, title, 'track'); }
  async sendVideo(conversationId: string, id: string, title: string): Promise<MessageObject> { return this.sendReference(conversationId, id, title, 'video'); }
  async sendShort(conversationId: string, id: string, title: string): Promise<MessageObject> { return this.sendReference(conversationId, id, title, 'short_video'); }
  async sendProfile(conversationId: string, id: string, title: string): Promise<MessageObject> { return this.sendReference(conversationId, id, title, 'identity.profile'); }
  async sendCommunity(conversationId: string, id: string, title: string): Promise<MessageObject> { return this.sendReference(conversationId, id, title, 'community'); }
  async sendLive(conversationId: string, id: string, title: string): Promise<MessageObject> { return this.sendReference(conversationId, id, title, 'live_broadcast'); }
  async react(conversationId: string, targetMessageId: string, emoji: string): Promise<MessageObject> { const conversation = await this.requireMember(conversationId); await this.assertMessage(conversationId, targetMessageId); if (!emoji || emoji.length > 32) throw new Error('Invalid reaction'); return this.messages.sendConversationMessage(conversationId, conversation.members ?? conversation.participants, { conversationId, kind: 'reaction', targetMessageId, emoji, logicalClock: await this.storage.nextLogicalClock(conversationId) }); }
  async editText(conversationId: string, messageId: string, text: string): Promise<MessageObject> { const current = await this.requireMember(conversationId); const original = await this.ownText(messageId, conversationId); return this.messages.sendConversationMessage(conversationId, current.members ?? current.participants, { ...original.payload, text, logicalClock: await this.storage.nextLogicalClock(conversationId) }, { supersedes: original.id, updatedAt: new Date(this.now()).toISOString() }); }
  async deleteMessage(conversationId: string, messageId: string): Promise<MessageObject> { const current = await this.requireMember(conversationId); const original = await this.ownText(messageId, conversationId); return this.messages.sendConversationMessage(conversationId, current.members ?? current.participants, { ...original.payload, logicalClock: await this.storage.nextLogicalClock(conversationId) }, { supersedes: original.id, deleted: true, updatedAt: new Date(this.now()).toISOString() }); }
  async history(conversationId: string, options: { limit?: number; before?: string } = {}): Promise<readonly MessageObject[]> { await this.requireMember(conversationId); return this.messages.history(conversationId, options); }
  async search(query: string, conversationId?: string): Promise<readonly MessageObject[]> { return this.messages.searchMessages(query, conversationId); }
  async markRead(conversationId: string, messageId?: string): Promise<void> { const current = await this.requireMember(conversationId); const latest = messageId ?? (await this.messages.history(conversationId, { limit: 1 })).at(-1)?.id; await this.messages.markConversationRead(conversationId); if (!latest) return; const message = await this.assertMessage(conversationId, latest); for (const peer of (current.members ?? current.participants)) if (peer !== this.local.nodeId) { await this.messages.sendConversationRead(conversationId, peer, message.id); } }
  async typing(conversationId: string, isTyping: boolean): Promise<void> { const current = await this.requireMember(conversationId); await this.messages.sendConversationTyping(conversationId, current.members ?? current.participants, isTyping); }
  async presence(conversationId: string, state: 'online' | 'offline'): Promise<void> { const current = await this.requireMember(conversationId); for (const peer of current.members ?? current.participants) if (peer !== this.local.nodeId) await this.messages.sendPresence(peer, state); }
  async setPinned(conversationId: string, value: boolean): Promise<DirectConversation> { return this.messages.setConversationFlag(conversationId, 'pinned', value); }
  async setArchived(conversationId: string, value: boolean): Promise<DirectConversation> { return this.messages.setConversationFlag(conversationId, 'archived', value); }
  async setMuted(conversationId: string, value: boolean): Promise<DirectConversation> { return this.messages.setConversationFlag(conversationId, 'muted', value); }
  async setDraft(conversationId: string, draft: string): Promise<DirectConversation> { await this.requireMember(conversationId); return this.messages.setDraft(conversationId, draft); }
  async isMember(conversationId: string, member: NodeId): Promise<boolean> { const value = await this.get(conversationId); return !!value?.members?.includes(member); }
  async isAdmin(conversationId: string, member = this.local.nodeId): Promise<boolean> { const value = await this.get(conversationId); return !!value?.adminIds?.includes(member); }

  private async authorizeMessage(conversationId: string, sender: NodeId): Promise<boolean> { const value = await this.storage.getConversation(conversationId); if (!value) return conversationId === await directConversationId(this.local.nodeId, sender); if (value.kind !== 'group') return value.participants.includes(sender); return (value.members ?? value.participants).includes(sender); }
  private async applyEvent(event: ConversationEventObject): Promise<boolean> {
    try {
      const payload = event.payload; const members = uniqueMembers(payload.members); const admins = uniqueMembers(payload.adminIds); if (!members.includes(event.author) || admins.some(value => !members.includes(value))) throw new Error('Invalid membership state'); const current = await this.storage.getConversation(payload.conversationId);
      if (!current) { const bootstrap = payload.action === 'create' || (payload.action === 'add' && payload.member === this.local.nodeId); if (!bootstrap || !admins.includes(event.author) || !members.includes(this.local.nodeId)) throw new Error('Unknown conversation'); }
      else if (current.kind !== 'group' || !this.authorizedEvent(current, event)) throw new Error('Unauthorized conversation event');
      const next: DirectConversation = { id: payload.conversationId, participants: members, members, adminIds: admins, kind: 'group', createdAt: current?.createdAt ?? event.createdAt, ...(payload.title ?? current?.title ? { title: payload.title ?? current?.title } : {}), ...(payload.avatarUri ?? current?.avatarUri ? { avatarUri: payload.avatarUri ?? current?.avatarUri } : {}), unreadCount: current?.unreadCount ?? 0, lastMessageId: current?.lastMessageId, lastMessageAt: current?.lastMessageAt, lastMessagePreview: current?.lastMessagePreview, pinned: current?.pinned, archived: current?.archived, muted: current?.muted, draft: current?.draft, revision: (current?.revision ?? 0) + 1, lastEventId: event.id };
      if (!(await this.eligible(next)) || !(await this.eligible(event))) throw new Error('Group conversation event failed mandatory SafetySurfaceGate'); await this.storage.saveConversation(next); this.acceptedEvents++; return true;
    } catch { this.rejectedEvents++; return false; }
  }
  private authorizedEvent(current: DirectConversation, event: ConversationEventObject): boolean {
    const actor = event.author; const members = current.members ?? current.participants; if (event.payload.action === 'leave') return event.payload.member === actor && members.includes(actor); if (event.payload.action === 'create') return false; return (current.adminIds ?? []).includes(actor);
  }
  private async event(payload: Omit<ConversationEventObject['payload'], 'logicalClock'>): Promise<ConversationEventObject> {
    const unsigned = { version: KEYSTONE_OBJECT_VERSION as 1, type: 'conversation_event' as const, id: crypto.randomUUID(), author: this.local.nodeId, createdAt: new Date(this.now()).toISOString(), visibility: 'private' as const, references: [{ id: payload.conversationId, type: 'conversation' as const }], payload: { ...payload, logicalClock: await this.storage.nextLogicalClock(payload.conversationId) } };
    const event = conversationEventObjectSchema.parse({ ...unsigned, signature: await signCanonical(unsigned, canonicalBytes => this.crypto.sign(canonicalBytes, this.local.privateKey)) }); if (!(await this.eligible(event))) throw new Error('Group conversation event failed mandatory SafetySurfaceGate'); return event;
  }
  private async broadcast(event: ConversationEventObject, recipients: readonly NodeId[]): Promise<void> { await this.messages.sendConversationEvent(uniqueMembers(recipients), event); }
  private async saveState(current: DirectConversation, members: readonly NodeId[], adminIds: readonly NodeId[]): Promise<DirectConversation> { const next = { ...current, participants: [...members], members: [...members], adminIds: [...adminIds], revision: (current.revision ?? 0) + 1 }; if (!(await this.eligible(next))) throw new Error('Group conversation failed mandatory SafetySurfaceGate'); await this.storage.saveConversation(next); return next; }
  private async requireMember(conversationId: string): Promise<DirectConversation> { const value = await this.get(conversationId); if (!value || !(value.members ?? value.participants).includes(this.local.nodeId)) throw new Error('Not a conversation member'); return value; }
  private async requireAdmin(conversationId: string): Promise<DirectConversation> { const value = await this.requireMember(conversationId); if (!(value.adminIds ?? []).includes(this.local.nodeId)) throw new Error('Administrator role required'); return value; }
  private async assertMessage(conversationId: string, id: string): Promise<MessageObject> { const value = await this.storage.getMessage(id); if (!value || value.payload.conversationId !== conversationId) throw new Error('Unknown conversation message'); return value; }
  private async ownText(id: string, conversationId: string): Promise<MessageObject & { payload: Extract<MessagePayload, { kind: 'text' }> }> { const value = await this.assertMessage(conversationId, id); if (value.author !== this.local.nodeId || value.payload.kind !== 'text' || value.deleted) throw new Error('Message cannot be changed'); return value as MessageObject & { payload: Extract<MessagePayload, { kind: 'text' }> }; }
  private async eligible(value: unknown): Promise<boolean> { const objectId = typeof value === 'object' && value && 'id' in value && typeof (value as { id?: unknown }).id === 'string' ? (value as { id: string }).id : `group:${String((value as { conversationId?: unknown })?.conversationId ?? '')}`; return (await this.protectedSurfaces.evaluate('GROUP_CHAT', { objectId, value, content: value, text: JSON.stringify(value), domain: 'GROUP_SHARED', sourceType: 'group', verified: true, authorized: true, sharing: true })) !== undefined; }
}

/** Naming alias for hosts that use the broader conversation terminology. */
export const ConversationService = GroupConversationService;

function uniqueMembers(values: readonly NodeId[]): NodeId[] { return [...new Set(values)].sort(); }
