# Private negotiation model

Private negotiation is a local computation protocol, not shared scheduling
data. Each participant evaluates the same explicit options against its own
constraints. The only shared fact is the smallest result needed by the chosen
strategy.

Example: Alice proposes `fri-18` and `sat-18` to Bob and Charlie. Bob may
inspect his local schedule and send only `{ available: true, selected: [sat-18] }`.
Alice never receives Bob's schedule; she receives a signed boolean/score and
can derive the common option. A participant can abstain or reject without
explaining a private reason.

## Disclosure levels

`EXACT` is allowed only when the evaluator intentionally produces a public or
explicitly shared value. `RANGE`, `BOOLEAN`, `SCORE` and `REDACTED` are useful
for availability, preference and ranking without exposing source facts. The
default is `REDACTED`; callers should choose the least revealing level that
solves the task.

The service rejects `PRIVATE`/`SECRET` response data, oversized derived values,
unknown option IDs, invalid signatures, expired payloads and repeated votes.
An external model is not involved in this path. If an agent wants assistance,
the existing local/trusted orchestration boundary must first produce a safe
derived result.

## Approval and lifecycle

`ASK_EVERY_TIME` stores an incoming session as `pending` until the owner calls
`approveSession` or `rejectSession`. Safe modes can accept sessions from known
contacts, while `DENY` rejects them before persistence. Any participant may
leave; the host may cancel or finalize. `sweep()` marks expired sessions and
does not select an option implicitly.

The audit log includes negotiation ID, peer, strategy, counts, status and
disclosure only. Source schedules, Memory entries, files, message bodies and
tool results are intentionally absent. Shared Agent Rooms can carry a session
reference, but membership does not broaden the negotiation's data scope.
