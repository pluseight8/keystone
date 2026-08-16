# Agent Mailbox

`AgentMailbox` is Keystone's local-first asynchronous delivery service.

```ts
const task = await mailbox.createTask({
  recipient: { identityId: bobIdentity, agentId: 'bob-agent' },
  taskType: 'availability',
  prompt: 'Can you be available tomorrow?',
  explicitContext: [{
    id: 'window', label: 'Explicit time window',
    value: 'tomorrow 10:00', dataClass: 'USER_EXPLICIT',
  }],
});
await mailbox.flush(bobIdentity);
```

The sender may be offline after queueing. The receiver later calls
`acceptTask(taskId)` (or uses a policy-approved auto-accept type), and the
response is queued until the sender reconnects. Use `snapshot()` for a durable
view of inbox, sent tasks, responses, receipts, rooms, and outbox state.

Trust policy is local and fail-closed. `deny`, `contacts-only`,
`trusted-only`, `ask`, and `auto` are available; `ask` requires an explicit
approval boundary. Blocked identities, per-sender pending/rate limits, mailbox
quota, expiry, replay IDs, and delegation-chain bounds are checked in core.

An `AgentTaskCapability` is signed by its issuer and includes scope, task type,
subject, expiry, and `maxUses`. The receiver verifies the issuer, subject,
scope, expiry, revocation, and usage count before invoking the host executor.
Private/secret tool results cannot be returned as a task response.

`AgentPresence` is a short-lived, authenticated hint (`available`, `busy`,
`offline`, or `do_not_disturb`) and is never a public discovery record.
Asynchronous rooms use signed membership and bounded explicit contributions;
they are not a second private-memory or tool-sharing protocol.

For production, provide an encrypted `AgentMailboxStateStore`. The core keeps
the outbox and replay state durable but never handles a recovery phrase or
private identity key as application data.
