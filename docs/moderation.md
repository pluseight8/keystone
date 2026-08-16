# Community moderation

Moderation is local-first and signed. There is no central moderation backend, global report queue, advertising, payment or monetization path.

`CommunityService` enforces owner/admin/mod/member permissions in core. Actions such as kick, ban, unban, mute, timeout, message deletion and pinning carry an actor (object author), target, reason and immutable timestamp. The owner cannot be removed or banned. An ordinary member cannot grant a role, invite, manage channels, pin, announce or moderate by constructing a UI request or replaying another event.

The local projection applies block and mute before rendering. A blocked actor's community events are ignored locally; a muted actor remains in durable storage but is hidden by the local policy. Timeout is bounded by an ISO expiry. Removed/banned members lose posting authorization immediately in the derived projection. A signed tombstone hides a deleted message/channel/community without erasing the evidence object.

Audit entries are derived from accepted moderation/report events and are stored in the encrypted community namespace. Reports are optional local objects and are never automatically uploaded. Notification settings, read state and local reports are device-local.

The production replication boundary accepts only `public` community objects. Private and contacts moderation content is not transmitted until group encryption and membership-key rotation exist. Tests cover malformed signatures, replay/dedup, owner protection, role inheritance and overrides, delayed/offline convergence, restart persistence, and independent Alice/Bob/Charlie/Mallory processes over Hyperswarm/Noise.
