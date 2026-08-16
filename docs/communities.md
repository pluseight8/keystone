# Communities

Russian overview: [сообщества](ru/communities.md).

Community state is an append-only set of individually signed Keystone objects. A `community` revision is the stable community ID; edits use `supersedes`, and deletion is a signed tombstone. There is no central registry. Peers exchange objects over the existing `CommunityReplicationService`, then derive a deterministic local projection. The projector orders authority-bearing events before dependent channel, moderation and message events, so delayed delivery converges without trusting UI state.

## Visibility and replication

`public` communities replicate over the production signed Hyperswarm/Noise transport. `private` and `contacts` objects are intentionally blocked by the replication boundary: Keystone does not pretend that a signed cleartext envelope is group encryption. They remain local until a generic group-encryption protocol with membership key rotation is available. A private/contacts join also requires a locally-known invite; an unknown invitation cannot silently make private content public.

## Roles, channels and permissions

The owner is the community creator and cannot be removed or banned. Signed `role` objects carry a position, optional managed flag and explicit granular permissions. The core checks `manage_community`, `manage_channels`, `manage_roles`, `invite_members`, `kick_members`, `ban_members`, `moderate_messages`, `pin_messages`, `post_announcements`, `post_message` and `view_channel`; a legacy `moderate` permission remains accepted for compatibility. Role managers cannot assign, delete or moderate above their highest role position. Custom roles are not global usernames and are scoped to one community.

Channels are signed `channel` objects with `text`, `media` or `announcement` kind, position, optional category and role-specific allow/deny overrides. Categories are signed objects as well. Channel ordering is local deterministic ordering by position, name and ID. A member needs an active role and the channel permission; deny overrides win over allows (except the owner, who remains protected from accidental lockout).

## Membership and moderation

`community_member` events cover join, leave, invite acceptance, role assignment, kick, ban/unban, mute/unmute and timeout. Each event is signed by its actor; `createdAt` is the immutable event timestamp, `member` is the target, and moderation reasons are retained. `community_moderation` is available for message/channel pin and tombstone audit events and carries an explicit `timestamp`, target, reason and action. Replay is harmless: object IDs are deduplicated by encrypted community storage and envelope nonces are bounded by the replication service.

Message, mention, reply and attachment references keep the original Keystone object IDs. `postMessage` validates the channel, membership, mute/timeout state, announcement permission and referenced object IDs in core. Pinned messages and moderation actions are projected into a signed audit log. Reports are local objects only; no report is sent to a central Keystone service. Local block/mute filters apply before a community object is shown or searched.

`CommunityService` is the authority boundary for every mutation. A signed but unauthorized object may be retained as evidence, but it never changes the visible projection. This is tested with out-of-order role delivery, replay, malformed/signature-spoofed events, concurrent delayed updates, restart persistence and a real multi-process Hyperswarm scenario.
