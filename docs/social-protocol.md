# Social graph and profiles (Phase 3)

Русский обзор: [социальный граф](ru/social-media.md#социальный-граф).

Profiles and follows are versioned, immutable Keystone objects; they are not rows in a service-owned account database.

`identity.profile` is authored and signed by the existing Keystone device identity. Its `handle` is a display handle only. Clients show it together with the cryptographic identity/fingerprint and must not claim global uniqueness or depend on a central registry. Later revisions use `supersedes` and the newest valid signed revision wins deterministically.

`follow` objects contain a target identity and a `follow` or `unfollow` action. Peers can exchange public/contacts-visible objects using a future social discovery channel, cache them offline, and derive followers/following locally. Incoming objects are schema-validated and verified against the author's existing Ed25519 identity; malformed, self-follow, or invalid-signature objects are discarded.

Block, mute, and trust are local policy records. They are intentionally neither advertised nor accepted from remote peers, avoiding a hidden global social score or a remote peer changing a user's safety choices.
