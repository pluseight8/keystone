# Local notifications

Notifications are a bounded, durable local projection of already authenticated Keystone objects. Each record links to the original object ID and type; content metadata is never copied into a notification-specific store.

Supported categories include direct messages, replies, reactions, follows, community invites/mentions, new Tracks, Videos, Shorts, Live broadcasts, and comments. The service validates the signed object, rejects self-generated events, applies block/mute/category/community policies, deduplicates by category/object/actor, and keeps a configurable bounded history (200 by default).

The local API supports unread counts, mark-read, mark-all-read, category/user/community mute, restart persistence, and optional `NotificationDeliveryAdapter`. Read status is not published to peers. Block filtering is re-applied when listing history so a later block removes the source from the application view.

DM and media/community replication services call the same notification projection after successful authenticated ingestion. The original Chat, Community, Track, Video, Short or Live object remains the navigation target.
