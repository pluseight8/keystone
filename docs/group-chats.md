# Group chats

Group chats are local-first projections over Keystone's existing identity, encrypted messaging and content-addressed storage primitives. There is no central message server or cloud push requirement.

## Identity and membership

`groupConversationId(members)` deterministically hashes the sorted cryptographic Identity IDs. The title and avatar are mutable signed metadata; changing them never creates a second conversation. The creator is the initial admin. `conversation_event` objects contain `create`, `add`, `remove`, `leave`, `set_role` or `update`, the complete member set and the complete admin set. Every event is author-signed, envelope-authenticated and replay-deduplicated by both envelope nonce and object ID.

Each event and message is encrypted separately for every recipient with the existing application cipher. Offline members retain encrypted outbox entries and receive the same object after reconnect. A core conversation policy rejects group messages from identities that are not in the current member projection; blocked identities are rejected before application handling.

## Daily chat behavior

The durable conversation record stores title/avatar, members/admins, last-message preview, unread count, last-read time, pin/archive/mute flags, and a draft. Messages support text, reply/quote, reactions, immutable edits and tombstones, attachments, and references to Track, Video, Short, Profile, Community and Live objects. History supports bounded pagination and local message search. Typing and online approximation are ephemeral and bounded; they do not become social history. Delivery/read state is limited to the conversation participants.

Attachments contain only `keystone://content/sha256-*` references. Hosts use `AttachmentTransferController` with `ContentFetcher`, verified manifests/chunks, cache quota and pinning. A cancelled transfer can retry and resume from verified chunks; corrupted chunks are rejected.

## Verification

The controlled integration suite covers deterministic ordering, offline outbox, restart persistence, role enforcement, unread/read state, typing cleanup and attachment references. The real-network suite starts four independent processes and validates production Hyperswarm/Noise delivery for a three-member group, offline reconnect, replies/reactions/edits/tombstones, replay rejection and member removal. WebRTC is not used for messaging.
