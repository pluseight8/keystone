# Messaging and group conversations

Русский обзор: [сообщения](ru/messaging.md).

The messaging layer is framework-independent and lives in `@keystone/core/social/messaging` plus `social/conversations`.

1. A peer is added explicitly as a `SocialContact`, containing its existing Keystone device node ID and public signing/encryption keys. No server-side contact or username registry exists.
2. `DirectMessageService` derives a deterministic conversation ID from the two identity IDs, persists the signed `message` object through a host-provided `SocialStorage`, and queues a signed `social.message` envelope.
3. The envelope payload is authenticated public-key encryption (`crypto_box` / XSalsa20-Poly1305) for the final recipient. This additional layer is required when a HyperDHT relay carries the frame, because relay Noise protects a hop rather than the final recipient.
4. The receiver enforces recipient, expiry, bounded ciphertext, known-contact, block-list, envelope-signature, replay-nonce, JSON schema, and object-signature checks before storage. A delivery acknowledgement removes the sender's outbox record.

`SocialStorage` is intentionally injected. Production desktop/mobile hosts must implement it with encrypted, crash-safe local storage and migrations; `InMemorySocialStorage` is test/dev-only. Private conversation data must not be placed in Yjs state or public discovery indexes.

The direct slice implements text, reply/quote references, reactions, immutable edit revisions, delete tombstones, deterministic ordering, durable storage, offline outbox/retry, delivery/read acknowledgements, bounded ephemeral typing/presence, blocking, search and pagination, and replay/dedup defenses. Conversations are indexed from durable metadata (`lastMessagePreview`, unread count, pin/archive/mute flags and drafts), so an incoming direct message also creates its deterministic local chat entry.

`GroupConversationService` uses the same `DirectMessageService` and transport. A group ID is `SHA-256("keystone:group-conversation:v1:" + sorted member IDs)`, so Alice, Bob and Charlie independently derive one Conversation ID. Membership and role changes are `conversation_event` objects signed by the actor, encrypted per recipient, and carry the complete member/admin projection for restart and offline convergence. Only current admins may add/remove members, change roles or rename a group; ordinary members cannot perform those actions. A removed member can no longer send or read group history through the core policy.

Group text, replies, reactions, edits, tombstones, and attachments fan out as one signed `message` object to current members. Track, Video, Short, Profile, Community and Live shares are references to the original Keystone object ID. No media bytes or per-surface copies enter the message envelope. `AttachmentTransferController` handles content-addressed manifests, verified chunks, progress, cancel, retry and resume under the existing cache quota/pinning policy.

Typing and presence are intentionally ephemeral and bounded in memory; they are never written to durable social history. Read/delivery acknowledgements are scoped to the conversation participants and remain local state. The mobile Chats/Conversation/New Chat/New Group/Group Info/Members/Media-Files routes are thin adapters over an explicitly installed runtime; they contain no demo messages or fake server. The native bootstrap supplies an initialized identity, verified contacts, `DirectMessageService`, optional `GroupConversationService`, and encrypted storage backend.

Controlled transport tests remain deterministic fault tests. `pnpm test:network` additionally runs Alice/Bob/Charlie/Mallory as independent processes over production Hyperswarm/Noise, covering group creation, shared ID, offline Charlie/reconnect, reply/reaction/edit/delete, attachment reference, replay/role rejection and member removal.

Generic content-addressed attachments are now supported as signed metadata and use the resumable transfer controller documented in [`attachments.md`](attachments.md). Group conversations, unread/mute projections, and contact discovery remain later work and must use the same object/envelope boundary.
