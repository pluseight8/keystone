# Unified Keystone object model (implemented foundation)

Русский обзор: [социальная и медиа-подсистема](ru/social-media.md#общие-принципы).

`@keystone/core/social/object-model` defines the v1 envelope shared by future social features. It deliberately has no React, database, or network dependency.

Every distributed object has a protocol `version`, typed stable ID, author identity, creation timestamp, visibility, typed references, payload, and detached Ed25519 signature. A revision is a new immutable object whose `supersedes` field points to the earlier object; deletion is a signed tombstone (`deleted: true`). UUIDs identify locally authored objects and SHA-256 identifiers are accepted where deterministic or content-addressed identity is needed.

The v1 registry reserves the following object types: `identity.profile`, `conversation`, `conversation_event`, `message`, `message_attachment`, `reaction`, `community`, `channel`, `community_member`, `role`, `permission`, `post`, `comment`, `follow`, `media_object`, `file_object`, `track`, `artist`, `album`, `playlist`, `video`, `short_video`, `live_broadcast`, `live_chat_message`, and `creator_profile`.

Reservation is a compatibility contract, not a claim that every feature is implemented. Currently, `message` has an implemented schema and direct/group encrypted transport, while `conversation_event` carries signed group membership and role projections. Text, reaction, revision, and tombstone variants are represented as immutable signed message objects. Receivers reject unknown fields and unsupported versions. Future additive v1 payload fields must be optional; a wire-incompatible change requires a new object version and explicit migration at the local-storage boundary.

Private objects are never candidates for public CRDT replication or discovery. Object schema validation happens before a remote value enters storage, and a signature must be verified using the author identity before the object is acted on.
