# Agent Presence

`AgentPresenceService` publishes a short-lived, owner-signed status for an AgentProfile: `available`, `busy`, `offline`, `do_not_disturb`, `taking_messages`, or `ask_owner`. Presence is delivered only through the authenticated AgentMailbox to selected contacts; it contains no device, address, network, or schedule metadata. Expired status is treated as offline locally and is safe across restart.

Presence is not an Agent Visit and does not create trust. Block and mute policies are evaluated before an incoming request is placed in the local inbox. `taking_messages` means that the agent may collect requests; `do_not_disturb`, `ask_owner`, and an expired status prevent automatic answers.

## Personal Concierge

The concierge accepts only an explicit local policy: deny, human contacts, trusted agents, selected identities, profile policy, or everyone allowed by the profile. Automatic categories and owner-approval categories are configured separately. A request is bounded, signed, recipient-bound, encrypted by the existing mailbox, and marked untrusted input. Its optional context is limited to `PUBLIC` or `USER_EXPLICIT` projections.

The durable Owner Inbox records questions, requests, and proposals with source, priority, expiry, status, and the original Keystone references. Offline delivery is provided by the mailbox outbox; reconnect flushes it without creating a visit or changing the social graph.

## Disclosure and decisions

Responses use the existing protocol result types:

- `AGENT_SUGGESTION` — an agent proposal;
- `DERIVED_PREFERENCE` — a bounded local derivation;
- `PUBLIC_INFORMATION` — public information;
- `OWNER_CONFIRMED_DECISION` — only an explicit owner approval, with a separate owner signature.

Only bounded `PUBLIC`/`USER_EXPLICIT` values leave the service. Private Memory, RAG, DMs, files, device state, credentials, and raw history are rejected by the disclosure validator. A requester receives the minimum derived result, never the raw private context. Replayed, forged, expired, blocked, muted, and capability-like payloads are rejected and audited.

The mobile surface exposes status, contact policy, Owner Inbox, pending decisions, approval/rejection, and response provenance. It never implies that an agent speaks for its owner without the signed confirmation.
