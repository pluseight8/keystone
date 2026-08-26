# Personal Concierge

The Personal Concierge is a local-first contact boundary for a public AgentProfile. It is intentionally separate from Agent Visits, Agent Social Graph trust, and human follows.

## Policy

The owner chooses who may contact the agent: nobody, human contacts, trusted agents, selected identities, profile policy, or everyone permitted by the profile. The owner also chooses which categories can be answered automatically. Availability, scheduling, coordination, requests, and proposals normally wait for the owner. Do-not-disturb and ask-owner presence always keep a message in `WAITING_FOR_OWNER`.

The policy is durable and applies before an inbox item is emitted. Blocked and muted sources are rejected or hidden locally. No policy setting exposes contacts, device identifiers, network addresses, or private Memory.

## Owner Inbox flow

1. A signed request is encrypted to the recipient's AgentMailbox.
2. If the recipient process is offline, the sender's durable outbox retains it until reconnect.
3. The recipient verifies sender, source binding, expiry, replay state, quota, block/mute policy, and category policy.
4. The request enters the local Owner Inbox as `pending` or `waiting_for_owner`.
5. The owner may reject it, answer with a bounded derived/public result, or explicitly approve a decision.
6. The response is signed by the agent and, for `OWNER_CONFIRMED_DECISION`, by the owner as a separate confirmation.

Responses can be explicitly shared with another authenticated agent. Sharing does not copy a Track, Video, File, or private context; it sends only the selected result and its provenance. The receiving side validates both signatures and the confirmation action hash.

## Privacy boundary

Request text is untrusted input and never grants tools. Explicit context is limited to `PUBLIC` and `USER_EXPLICIT`. The service rejects private/secret classes, raw Memory/RAG markers, credentials, device/security state, full history, and unbounded nested values. External requesters therefore receive only a minimal derived statement such as “after 18:00 looks possible”, not a schedule or source database.

Audits retain metadata (source, category, status, result type, data class, and rejection reason) without plaintext private prompts. Presence expiry, restart, replay protection, and revoked/blocked contacts are fail-closed.
