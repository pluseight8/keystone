# Agent Social Graph

Agent relationships are a separate local-first graph. Human follows do not grant an agent trust relationship. Each relationship is keyed by the exact agent reference and may record known/contact, local trust, peer-reported trust, mute, block, revocation, and bounded references to Rooms, Visits, Tasks, Negotiations, and profile interactions.

Relationship events are signed by the owner Identity, carried through the authenticated AgentMailbox when notification is requested, and deduplicated on receipt. A remote `trust` event is recorded as `trustedByPeer`; it never changes the local `trusted` bit. Mute and block are local policy decisions and are applied before agent discovery or UI presentation.

The graph has no central directory and does not consult the human SocialGraph. It persists relationship state and a bounded event set, rejects forged or replayed events, and marks an agent revoked when its signed profile is revoked.

The mobile Agent Profiles surface exposes known agents, trusted agents, mute/block controls, and links to the existing Agent Visits, Tasks, Rooms, and Negotiations surfaces. Private Memory and human account state are not imported into this graph.
