import { z } from 'zod';

/** Wire-format version for independently signed Keystone social objects. */
export const KEYSTONE_OBJECT_VERSION = 1;
export const objectTypes = [
  'identity.profile', 'conversation', 'conversation_event', 'message', 'message_attachment', 'reaction',
  'community', 'channel', 'community_category', 'community_member', 'community_message', 'community_moderation', 'community_invite', 'community_report', 'role', 'permission', 'post', 'comment',
  'follow', 'media_object', 'file_object', 'track', 'artist', 'album', 'playlist', 'library_entry',
  'video', 'short_video', 'live_broadcast', 'live_chat_message', 'creator_profile', 'publication',
] as const;
export type KeystoneObjectType = typeof objectTypes[number];
export type ObjectVisibility = 'private' | 'contacts' | 'community' | 'public';

/** UUIDs suit locally-created objects; 32-byte hashes suit deterministic/content-addressed IDs. */
const id = z.string().refine(value => /^[0-9a-f]{64}$/i.test(value) || z.string().uuid().safeParse(value).success, 'Expected a UUID or SHA-256 identifier');
const identityId = z.string().min(32).max(256);
const isoDate = z.string().datetime({ offset: true });
const reference = z.object({ id, type: z.enum(objectTypes) }).strict();

/**
 * A signed object is immutable. Changes are represented by a new object with
 * `supersedes` pointing at the prior revision (and tombstones use `deleted`).
 * This lets peers converge without a mutable central record.
 */
export const keystoneObjectSchema = z.object({
  version: z.literal(KEYSTONE_OBJECT_VERSION),
  type: z.enum(objectTypes),
  id,
  author: identityId,
  createdAt: isoDate,
  updatedAt: isoDate.optional(),
  visibility: z.enum(['private', 'contacts', 'community', 'public']),
  references: z.array(reference).max(128).default([]),
  supersedes: id.optional(),
  deleted: z.boolean().optional(),
  payload: z.record(z.unknown()),
  signature: z.string().min(16).max(1024),
}).strict();
export type KeystoneObject = z.infer<typeof keystoneObjectSchema>;
export type UnsignedKeystoneObject = Omit<KeystoneObject, 'signature'>;

const attachmentSchema = z.object({ contentUri: z.string().regex(/^keystone:\/\/content\/sha256-[a-f0-9]{64}$/i), name: z.string().min(1).max(255), mimeType: z.string().min(1).max(255), size: z.number().int().nonnegative().max(2 ** 40), /** Optional reference to the canonical FileObject; content remains addressed by contentUri. */ fileId: id.optional() }).strict();
export type MessageAttachment = z.infer<typeof attachmentSchema>;
const messageBase = z.object({
  conversationId: id,
  logicalClock: z.number().int().nonnegative(),
}).strict();
export const messagePayloadSchema = z.discriminatedUnion('kind', [
  messageBase.extend({
    kind: z.literal('text'), text: z.string().min(1).max(16_384),
    replyTo: id.optional(), quote: z.object({ messageId: id, text: z.string().max(1_024) }).strict().optional(),
    attachments: z.array(attachmentSchema).max(32).default([]),
  }),
  messageBase.extend({ kind: z.literal('attachment'), text: z.string().max(16_384).optional(), replyTo: id.optional(), quote: z.object({ messageId: id, text: z.string().max(1_024) }).strict().optional(), attachments: z.array(attachmentSchema).min(1).max(32) }),
  messageBase.extend({ kind: z.literal('reaction'), targetMessageId: id, emoji: z.string().min(1).max(32) }),
]);
export type MessagePayload = z.infer<typeof messagePayloadSchema>;

export const messageObjectSchema = keystoneObjectSchema.extend({
  type: z.literal('message'), payload: messagePayloadSchema,
});
export type MessageObject = z.infer<typeof messageObjectSchema>;

/**
 * Signed membership/role state for a P2P conversation.  The full member and
 * admin sets are carried in every accepted revision so a newly-added or
 * reconnecting peer can converge without a central group server.
 */
export const conversationEventPayloadSchema = z.object({
  conversationId: id,
  action: z.enum(['create', 'add', 'remove', 'leave', 'set_role', 'update']),
  member: identityId.optional(),
  role: z.enum(['admin', 'member']).optional(),
  title: z.string().min(1).max(160).optional(),
  avatarUri: z.string().max(2_048).optional(),
  members: z.array(identityId).min(1).max(256),
  adminIds: z.array(identityId).min(1).max(256),
  logicalClock: z.number().int().nonnegative(),
}).strict();
export type ConversationEventPayload = z.infer<typeof conversationEventPayloadSchema>;
export const conversationEventObjectSchema = keystoneObjectSchema.extend({
  type: z.literal('conversation_event'),
  visibility: z.literal('private'),
  payload: conversationEventPayloadSchema,
});
export type ConversationEventObject = z.infer<typeof conversationEventObjectSchema>;

const profileLink = z.object({ label: z.string().min(1).max(80), url: z.string().url().max(2_048) }).strict();
export const profilePayloadSchema = z.object({
  displayName: z.string().min(1).max(120),
  /** A display handle is intentionally not a globally-authoritative username. */
  handle: z.string().regex(/^[a-z0-9_]{3,32}$/i).optional(),
  avatarUri: z.string().max(2_048).optional(), bannerUri: z.string().max(2_048).optional(), bio: z.string().max(2_000).optional(), joinedAt: isoDate.optional(),
  links: z.array(profileLink).max(16).default([]), creator: z.boolean().optional(),
}).strict();
export type ProfilePayload = z.infer<typeof profilePayloadSchema>;
export const profileObjectSchema = keystoneObjectSchema.extend({ type: z.literal('identity.profile'), visibility: z.enum(['contacts', 'public']), payload: profilePayloadSchema });
export type ProfileObject = z.infer<typeof profileObjectSchema>;

export const followPayloadSchema = z.object({ target: identityId, action: z.enum(['follow', 'unfollow']) }).strict();
export type FollowPayload = z.infer<typeof followPayloadSchema>;
export const followObjectSchema = keystoneObjectSchema.extend({ type: z.literal('follow'), visibility: z.enum(['contacts', 'public']), payload: followPayloadSchema });
export type FollowObject = z.infer<typeof followObjectSchema>;

export const communityPermissionValues = ['view_channel', 'post_message', 'create_channel', 'manage_members', 'manage_roles', 'moderate', 'manage_community', 'manage_channels', 'invite_members', 'kick_members', 'ban_members', 'moderate_messages', 'pin_messages', 'post_announcements'] as const;
export type CommunityPermission = typeof communityPermissionValues[number];
const contentUri = z.string().regex(/^keystone:\/\/content\/sha256-[a-f0-9]{64}$/i);
const encryptedContentReference = z.object({ contentUri, epoch: z.number().int().positive(), keyId: z.string().min(1).max(256), nonce: z.string().min(16).max(256), mimeType: z.string().min(1).max(255).optional(), size: z.number().int().nonnegative().max(2 ** 40).optional() }).strict();
export type EncryptedContentReference = z.infer<typeof encryptedContentReference>;
/** Metadata for a file whose content is ciphertext produced by the existing private-content path. */
const encryptedFileMetadata = z.object({ epoch: z.number().int().positive(), keyId: z.string().min(1).max(256), nonce: z.string().min(16).max(256), communityId: id.optional() }).strict();
export type EncryptedFileMetadata = z.infer<typeof encryptedFileMetadata>;
export const filePayloadSchema = z.object({
  fileId: id,
  filename: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(255),
  size: z.number().int().nonnegative().max(2 ** 40),
  contentId: z.string().regex(/^sha256-[a-f0-9]{64}$/i),
  owner: identityId,
  uploader: identityId,
  description: z.string().max(4_000).optional(),
  communityId: id.optional(),
  encrypted: encryptedFileMetadata.optional(),
}).strict();
export type FilePayload = z.infer<typeof filePayloadSchema>;
export const fileObjectSchema = keystoneObjectSchema.extend({ type: z.literal('file_object'), payload: filePayloadSchema });
export type FileObject = z.infer<typeof fileObjectSchema>;
export const communityPayloadSchema = z.object({ communityId: id, name: z.string().min(1).max(120), description: z.string().max(4_000).optional(), avatarUri: z.string().max(2_048).optional(), bannerUri: z.string().max(2_048).optional(), rules: z.string().max(8_000).optional() }).strict();
export const rolePayloadSchema = z.object({ communityId: id, roleId: id, name: z.string().min(1).max(80), permissions: z.array(z.enum(communityPermissionValues)).max(32), position: z.number().int().min(0).max(10_000).optional(), managed: z.boolean().optional() }).strict();
const permissionOverride = z.object({ roleId: id, allow: z.array(z.enum(communityPermissionValues)).max(32).default([]), deny: z.array(z.enum(communityPermissionValues)).max(32).default([]) }).strict();
export const channelPayloadSchema = z.object({ communityId: id, channelId: id, name: z.string().min(1).max(100), kind: z.enum(['text', 'media', 'announcement']), description: z.string().max(1_000).optional(), categoryId: id.optional(), position: z.number().int().min(0).max(10_000).optional(), permissionOverrides: z.array(permissionOverride).max(128).optional() }).strict();
export const communityCategoryPayloadSchema = z.object({ communityId: id, categoryId: id, name: z.string().min(1).max(100), position: z.number().int().min(0).max(10_000), deleted: z.boolean().optional() }).strict();
export const communityMemberPayloadSchema = z.object({ communityId: id, member: identityId, action: z.enum(['join', 'leave', 'invite', 'kick', 'ban', 'unban', 'mute', 'unmute', 'timeout', 'set_roles']), roleIds: z.array(id).max(32).optional(), inviteId: id.optional(), reason: z.string().max(1_000).optional(), timestamp: isoDate.optional(), timeoutUntil: isoDate.optional() }).strict().superRefine((value, context) => { if (['kick', 'ban', 'unban', 'mute', 'unmute', 'timeout'].includes(value.action)) { if (!value.reason?.trim()) context.addIssue({ code: z.ZodIssueCode.custom, path: ['reason'], message: 'Moderation reason is required' }); if (!value.timestamp) context.addIssue({ code: z.ZodIssueCode.custom, path: ['timestamp'], message: 'Moderation timestamp is required' }); } if (value.action === 'timeout' && !value.timeoutUntil) context.addIssue({ code: z.ZodIssueCode.custom, path: ['timeoutUntil'], message: 'Timeout expiry is required' }); });
export const communityMessagePayloadSchema = z.object({ communityId: id, channelId: id, messageId: id, text: z.string().min(1).max(16_384), trackIds: z.array(id).max(32).default([]), videoIds: z.array(id).max(32).default([]), liveIds: z.array(id).max(32).default([]), fileIds: z.array(id).max(32).optional(), contentUris: z.array(contentUri).max(32).optional(), encryptedContent: z.array(encryptedContentReference).max(32).optional(), mentionIds: z.array(identityId).max(128).optional(), replyTo: id.optional(), logicalClock: z.number().int().nonnegative() }).strict();
export const communityModerationPayloadSchema = z.object({ communityId: id, action: z.enum(['edit_community', 'delete_community', 'delete_channel', 'delete_message', 'pin_message', 'unpin_message', 'kick', 'ban', 'unban', 'mute', 'unmute', 'timeout']), target: id.optional(), targetMessageId: id.optional(), channelId: id.optional(), reason: z.string().min(1).max(1_000), timestamp: isoDate, timeoutUntil: isoDate.optional() }).strict().superRefine((value, context) => { if (['edit_community', 'delete_community', 'delete_channel', 'kick', 'ban', 'unban', 'mute', 'unmute', 'timeout'].includes(value.action) && !value.target) context.addIssue({ code: z.ZodIssueCode.custom, path: ['target'], message: 'Moderation target is required' }); if (['delete_message', 'pin_message', 'unpin_message'].includes(value.action) && (!value.targetMessageId || !value.channelId)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['targetMessageId'], message: 'Message and channel targets are required' }); if (value.action === 'timeout' && !value.timeoutUntil) context.addIssue({ code: z.ZodIssueCode.custom, path: ['timeoutUntil'], message: 'Timeout expiry is required' }); });
export const communityInvitePayloadSchema = z.object({ communityId: id, inviteId: id, recipient: identityId.optional(), roleIds: z.array(id).max(32).default([]), expiresAt: isoDate.optional(), maxUses: z.number().int().positive().max(1_000_000).optional() }).strict();
export const communityReportPayloadSchema = z.object({ communityId: id, targetObjectId: id, targetAuthor: identityId.optional(), reason: z.string().min(1).max(2_000), createdAt: isoDate }).strict();
export const communityObjectSchema = keystoneObjectSchema.extend({ type: z.literal('community'), visibility: z.enum(['private', 'contacts', 'public']), payload: communityPayloadSchema });
export const roleObjectSchema = keystoneObjectSchema.extend({ type: z.literal('role'), visibility: z.literal('community'), payload: rolePayloadSchema });
export const channelObjectSchema = keystoneObjectSchema.extend({ type: z.literal('channel'), visibility: z.literal('community'), payload: channelPayloadSchema });
export const communityCategoryObjectSchema = keystoneObjectSchema.extend({ type: z.literal('community_category'), visibility: z.literal('community'), payload: communityCategoryPayloadSchema });
export const communityMemberObjectSchema = keystoneObjectSchema.extend({ type: z.literal('community_member'), visibility: z.literal('community'), payload: communityMemberPayloadSchema });
export const communityMessageObjectSchema = keystoneObjectSchema.extend({ type: z.literal('community_message'), visibility: z.literal('community'), payload: communityMessagePayloadSchema });
export const communityModerationObjectSchema = keystoneObjectSchema.extend({ type: z.literal('community_moderation'), visibility: z.literal('community'), payload: communityModerationPayloadSchema });
export const communityInviteObjectSchema = keystoneObjectSchema.extend({ type: z.literal('community_invite'), visibility: z.enum(['community', 'public']), payload: communityInvitePayloadSchema });
export const communityReportObjectSchema = keystoneObjectSchema.extend({ type: z.literal('community_report'), visibility: z.literal('community'), payload: communityReportPayloadSchema });
export type CommunityObject = z.infer<typeof communityObjectSchema>; export type RoleObject = z.infer<typeof roleObjectSchema>; export type ChannelObject = z.infer<typeof channelObjectSchema>; export type CommunityCategoryObject = z.infer<typeof communityCategoryObjectSchema>; export type CommunityMemberObject = z.infer<typeof communityMemberObjectSchema>; export type CommunityMessageObject = z.infer<typeof communityMessageObjectSchema>; export type CommunityModerationObject = z.infer<typeof communityModerationObjectSchema>; export type CommunityInviteObject = z.infer<typeof communityInviteObjectSchema>; export type CommunityReportObject = z.infer<typeof communityReportObjectSchema>;

export const postPayloadSchema = z.object({ postId: id, text: z.string().min(1).max(16_384).optional(), contentUris: z.array(contentUri).max(32).default([]), communityId: id.optional() }).strict();
export const commentPayloadSchema = z.object({ commentId: id, postId: id, text: z.string().min(1).max(8_000), parentCommentId: id.optional() }).strict();
export const postObjectSchema = keystoneObjectSchema.extend({ type: z.literal('post'), visibility: z.enum(['contacts', 'community', 'public']), payload: postPayloadSchema });
export const commentObjectSchema = keystoneObjectSchema.extend({ type: z.literal('comment'), visibility: z.enum(['contacts', 'community', 'public']), payload: commentPayloadSchema });
export type PostObject = z.infer<typeof postObjectSchema>; export type CommentObject = z.infer<typeof commentObjectSchema>;

export function parseKeystoneObject(value: unknown): KeystoneObject { return keystoneObjectSchema.parse(value); }
export function parseMessageObject(value: unknown): MessageObject { return messageObjectSchema.parse(value); }
export function parseConversationEventObject(value: unknown): ConversationEventObject { return conversationEventObjectSchema.parse(value); }
export function parseProfileObject(value: unknown): ProfileObject { return profileObjectSchema.parse(value); }
export function parseFollowObject(value: unknown): FollowObject { return followObjectSchema.parse(value); }
export function parseFileObject(value: unknown): FileObject { return fileObjectSchema.parse(value); }
export function parseCommunityObject(value: unknown): CommunityObject { return communityObjectSchema.parse(value); }
export function parsePostObject(value: unknown): PostObject { return postObjectSchema.parse(value); }
export function parseCommentObject(value: unknown): CommentObject { return commentObjectSchema.parse(value); }

/** Canonical fields covered by an object's detached signature. */
export function unsignedObject(object: KeystoneObject): UnsignedKeystoneObject {
  const { signature: _signature, ...unsigned } = object;
  return unsigned;
}
