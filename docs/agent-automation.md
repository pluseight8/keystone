# Agent Automation

Keystone automations are a local-first adapter above `AgentRuntime` and
`Chronos`. They schedule an existing Agent session or react to a typed local
event; a trigger never grants a tool, skill, context source, or capability.

The core contract is `AgentAutomationService` in
`packages/core/src/ai/automation.ts`:

- `AgentAutomation` is durable configuration: agent/session, instruction,
  trigger, approved tool/skill allowlists, privacy class, and execution budget.
- `AgentTrigger` is either a five-field cron schedule or an allowlisted event
  (`dm.received`, `community.mention`, `file.created`, `track.created`,
  `video.created`, `live.started`, `device.security`, or `system.local`).
- `AgentJob` and `AgentJobRun` are durable state machines. Jobs can be queued,
  paused, resumed, retried, cancelled, or held at `waiting_for_approval`.
- `AgentAutomationStateStore` is an explicit host boundary. The in-memory store
  is useful for tests; desktop/mobile hosts should provide encrypted durable
  storage.

## Safety boundaries

The service captures the session's tool, skill, and context allowlists when an
automation is created. Before every run it verifies that tools are still
registered and that each skill is enabled and still approves the tool's
capabilities. Revoking a tool or skill therefore stops future runs without
waiting for a restart.

Any `WRITE_PRIVATE`, `NETWORK_SEND`, `DEVICE_ACTION`, `DESTRUCTIVE`, or
`SECURITY_SENSITIVE` capability puts the job behind the existing confirmation
boundary. If the user is away, the job remains `waiting_for_approval`; it is
never silently approved. Private Agents configured for external fallback are
rejected at creation and update time (`PRIVATE_EXTERNAL_FALLBACK_DENIED`).

`PRIVATE` and `SECRET` event payloads are not copied into audit records. An
event may be exposed to an Agent only as an attachment when the session already
has the `ATTACHMENTS` context capability, and it still passes the normal
ContextBuilder data-class filter. The service never grants `READ_PRIVATE` to a
trigger.

## Budgets and recovery

Each automation has limits for runtime, model calls, tool calls, retries,
retry backoff, daily local resource units, and service-wide concurrent/pending
jobs. Duplicate event IDs are ignored. A per-minute event budget bounds trigger
storms. Causal automation IDs and a bounded causal depth prevent A → B → A
recursion. Job IDs and run IDs are deterministic for event/schedule occurrences
and attempts, which makes replay safe.

On startup, queued jobs are resumed, interrupted runs become `CRASHED` and are
retried only within the configured budget, and retry timers are re-armed.
Missed schedules follow `run_once` (default) or `skip`. `pause`, `resume`,
`disable`, and `remove` cancel active runs/timers without deleting user-owned
Agent or content data.

## Host events

Hosts publish an `AgentTriggerEvent` through the typed event adapter. The
adapter maps product events to the stable event type and data class; it cannot
change an automation's capabilities. The adapter should authenticate events,
provide a stable event ID, and keep private payloads local. Public discovery is
not required for local automation.

```ts
await automations.publishEvent({
  id: 'file-created:abc123',
  eventType: 'file.created',
  occurredAt: new Date().toISOString(),
  dataClass: 'PRIVATE',
  payload: { fileId: 'file-abc123' },
});
```

## Examples

The same API supports “each morning summarize unread Communities”, “when a file
arrives classify it locally”, “when a followed creator starts Live create a
local notification”, and “each evening create a local daily summary”. These
examples use existing typed tools and Chronos; they do not add a cloud
scheduler, shell access, marketplace, advertising, payments, or monetization.

The mobile `Automations` screen is host-neutral: it shows configuration, next
run, job history, enabled state, and pending approvals. Durable execution and
policy remain in core.
