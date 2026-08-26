# Private Agent Negotiation

The negotiation service provides a generic layer above `AgentMailbox`. It lets
trusted Personal Agents agree on a bounded option while each owner keeps the
facts used to evaluate that option locally. There is no coordinator service:
the host agent creates the session and the existing encrypted P2P mailbox
delivers signed messages when a peer reconnects.

## Protocol objects

- `AgentNegotiation` / `NegotiationSession` — signed participants, strategy,
  expiry, room reference and constraint metadata.
- `NegotiationProposal` — a public or explicitly shared list of bounded
  options. Counter-proposals use the same object and validation.
- `NegotiationResponse` — accept, reject, abstain or counter with selected
  option IDs and a derived `EXACT`, `RANGE`, `BOOLEAN`, `SCORE` or `REDACTED`
  value.
- `NegotiationResult` — host-signed outcome and selected IDs.
- `NegotiationPolicy` — `ASK_EVERY_TIME`, `ALLOW_SAFE_NEGOTIATIONS`,
  `ALLOW_FROM_TRUSTED_AGENTS` or `DENY`, plus category and quota limits.

Supported strategies are `UNANIMOUS`, `MAJORITY`, `BEST_SCORE`,
`FIRST_COMMON` and `HOST_DECIDES`. Sessions support proposals,
counter-proposals, explicit approval, rejection, cancellation, leave,
expiry, offline delivery, reconnect and restart recovery.

## Privacy boundary

`NegotiationConstraint` is metadata only: id, label, data class, disclosure
and `localOnly: true`. It has no value field. A host-provided evaluator reads
the owner's local calendar, preferences or other permitted sources and
returns a bounded derived value. `PRIVATE` and `SECRET` source values never
enter a wire object, snapshot, audit record or room context. Options themselves
must be `PUBLIC` or `USER_EXPLICIT`.

Every response is checked for bounded size and safe data classes before it is
signed. The service rejects private markers, unknown option IDs, duplicate
votes and responses from non-participants. Negotiation does not grant Memory,
RAG, tools, files or capabilities. Prompt and room context remain untrusted
and explicitly scoped.

## Transport and persistence

`AgentMailbox.sendNegotiation()` uses the existing recipient-key encrypted
`ai.agent_social` envelope. Envelope signature, recipient binding, contact
verification, expiry, nonce replay protection and durable outbox are provided
by AgentMailbox; the negotiation wire adds a signed sender/recipient payload
and payload deduplication. A failed connection leaves the message queued for
`flush()`.

The negotiation snapshot stores sessions, public proposals, derived responses,
results, policy, replay IDs and metadata-only audit entries. It never stores
the evaluator's private state. Reopening the process restores pending sessions
and allows a peer to continue after several offline rotations.

## Rooms and UI

An optional `roomId` binds a session to an existing bounded Agent Room. The
binding does not inherit room capabilities or private context. The mobile
Negotiations screen shows incoming, active and completed sessions, participants,
strategies, disclosure, results, approval controls and the current policy.

The real-network suite runs Alice, Bob and Charlie as independent Keystone
processes. Bob is stopped while Alice creates a session, reconnects later,
evaluates a proposal locally, and returns a derived response. Alice then
computes the common option; serialized production envelopes are inspected to
confirm that local constraint values are absent. Controlled integration tests
also cover duplicate/replay, persistence and quota behavior.
