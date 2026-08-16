# Agent visits

Phase 36 adds a small, additive visit protocol over the existing signed
Keystone `Transport` (Hyperswarm/Noise in production). It is not a new agent
runtime, relay or server. `AgentVisitService` owns only the visit lifecycle and
the capability boundary; a host can adapt its existing `AgentRuntime` and
`ToolPolicy` through `onGuestRequest`.

## Lifecycle

1. A visitor signs an `AgentInvitation` for one host agent and a bounded list of
   requested capabilities.
2. The host explicitly accepts it and returns a signed `AgentVisit` plus an
   `AgentDelegationToken`.
3. Every request carries the signed visit and token, a request id and an
   untrusted input. The host checks identity, expiry, replay, capability,
   approval mode and the local session before invoking its host callback.
4. The callback may return only a bounded `PUBLIC` or `USER_EXPLICIT`
   `AgentVisitResult`. Private/secret data, plaintext Memory and unrestricted
   tools have no representation in this result type.
5. The host can revoke or end the visit. Revocation is signed, persisted and
   rejects pending and subsequent requests. Expiry is fail-closed.

Supported capabilities are `talk_to_host_agent`, `read_shared_context`,
`write_shared_workspace`, `search_public_objects` and an explicitly named
`use_specific_tool`. The latter still goes through the existing ToolPolicy and
confirmation boundary; this protocol never calls a tool directly.

Approval modes are `ASK_EVERY_TIME`, `ALLOW_THIS_VISIT`, `ALLOW_THIS_AGENT` and
`DENY`. Sensitive operations remain subject to the host's confirmation and
double-confirmation policy. Grants have a scope, expiry and `maxUses` and are
consumed only after a safe host result is produced.

## Security boundary

The remote agent is `untrusted: true`. It cannot request `read_private_memory`,
smuggle a private data class, replay a request, forge another identity's
invitation/token, or escalate a grant. The host callback is deliberately the
only place where local Memory, RAG, files or tools could be considered, and it
must return a safe summary rather than the private source. No Memory service is
imported by the visit layer.

Outer messages use the existing `EnvelopeSecurity`; invitations, visits,
tokens and room objects are independently signed and bound to the sender,
agent ids and identities. Duplicate ids/nonces are bounded by a durable replay
set. Durable state contains metadata, not private prompt/result plaintext.

## Production transport

The real-network suite starts independent Keystone processes. It verifies an
Alice agent invitation and request to Bob over Hyperswarm/Noise, private-memory
denial, Mallory's forged invitation rejection, Bob's revocation, restart
persistence and a multi-member Agent Room. Controlled Transport remains useful
for deterministic fault tests; it is not used to claim the production visit
path passed.
