# Social graph

Keystone's social graph is a local projection of signed objects. The canonical identity is the cryptographic Identity ID; a profile handle is only a display hint and is never allocated by a central registry.

## Profiles

`identity.profile` is signed by its author and may contain a display name, optional handle, avatar/banner URI, bio, links, creator metadata, and a stable `joinedAt` date. Follower/following counts are computed from events known to the local device. Public Track, Video, Short, Live and Community references retain their original object IDs.

## Follow events

`follow` objects contain `{ target, action: follow | unfollow }`, are signed by the actor, and are delivered through the existing authenticated Hyperswarm/Noise transport (`social.graph_object`). Receivers validate the object schema, author signature, envelope signature, expiry, nonce replay, and local block policy. Storage deduplicates object IDs and survives restart. No global username or follower database exists.

`SocialGraphService` exposes following, followers, mutuals, relationship, block, mute and trust projections. Blocking is applied before application results and notifications; mutes keep the object available but hide it according to local policy. The controlled transport harness remains available for deterministic fault tests, while the real-network suite exercises independent processes over production transport.

## Privacy and boundaries

Private profiles and private social objects are not sent to public discovery. Read state and notification settings are local-only. Native push delivery, if added later, must implement `NotificationDeliveryAdapter`; the core does not depend on Firebase, APNs, or a central service.
