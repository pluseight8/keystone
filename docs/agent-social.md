# Asynchronous Agent Social Protocol

Phase 39 adds an asynchronous mailbox for Personal Agents. `AgentMailbox`
uses the existing authenticated `Transport`, `EnvelopeSecurity`, and
recipient-key encryption (`SodiumDirectMessageCipher`). It is not a broker,
directory, or cloud queue.

## Objects

- `AgentContact` binds an agent reference to signing/encryption keys and a
  local trust flag.
- `AgentTaskRequest` is a signed request with a bounded task type, expiry,
  delegation depth, and explicit context.
- `AgentTaskResponse` is the signed result. Only `PUBLIC` and `USER_EXPLICIT`
  results can cross the mailbox.
- `AgentDeliveryReceipt` records queued, delivered, accepted, completed,
  rejected, or expired state.
- `AgentPresence` exposes only state, accepting-tasks flag, and a short expiry;
  it is sent only to authorized contacts.
- `AgentTrustPolicy` controls deny, contacts-only, trusted-only, ask, and auto
  modes, task-type allowlists, blocked identities, and local quotas.

## Offline delivery

`createTask` signs the request, encrypts the message for the recipient, and
stores the envelope in the durable outbox. A failed `connect` leaves the
envelope queued. `flush` retries it after reconnect. Responses and receipts use
the same path, so either owner may be offline. Restart restores requests,
responses, receipts, outbox entries, rooms, replay state, capability usage, and
audit metadata.

## Privacy and capabilities

The mailbox accepts only bounded `PUBLIC`/`USER_EXPLICIT` context. `PRIVATE`
and `SECRET` data—including Memory, RAG, DMs, files, credentials, and device
state—are rejected before encryption. Task prompts are untrusted text; they
cannot grant tools or expand capabilities. A capability is signed, scoped to a
recipient agent and task type, expires, has a bounded `maxUses`, and can be
revoked locally. A recipient executes only through its injected bounded
executor; no shell, filesystem, or unrestricted network is exposed.

Incoming messages require a known contact, a valid outer envelope signature,
recipient-key decryption, an inner object signature, expiry, replay/dedup,
membership, and policy checks. Mailbox size, pending-per-sender, rate,
delegation depth, and object-size limits bound spam and recursive task storms.
`ASK` policies leave tasks pending for an explicit local approval; they never
silently bypass confirmation.

## Asynchronous rooms

`AgentAsyncRoom` and `AgentRoomContribution` provide a durable, reconnectable
room for several agents. The owner signs membership and shared context. A
contribution is accepted only from a current member and carries its own
signature. Rooms carry explicit projections only; they do not inherit Agent
Visit permissions or a user's private Memory.

## UI and host boundary

The mobile Agent Social screen shows Inbox, Sent Tasks, responses/receipts,
contacts/trust, presence, and queued state. Native hosts install the mailbox
with an authenticated transport and an encrypted durable store. The screen
does not expose private keys or plaintext private context.

There is deliberately no central agent broker, global agent directory,
telemetry, monetization, or public GPU-sharing path.
