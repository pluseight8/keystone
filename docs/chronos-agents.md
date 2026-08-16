# Chronos and Agents

`AgentAutomationService` integrates Agents with the existing Chronos scheduler
without replacing Chronos' core. It stores one validated `ChronosRule` per
automation. Schedule rules use the existing cron timer; event rules use the
additive `system` trigger and the existing `ChronosEventSource` subscription.

The `ai.workflow` action contains only an opaque automation ID. Chronos does
not receive the Agent instruction, private context, tool arguments, or event
payload. The automation service resolves that ID, reconstructs a job from
durable state, and calls `AgentRuntime.startRun` with the captured session
policy.

Chronos audit entries include optional non-sensitive metadata:
`automationId`, `agentId`, trigger label, tool IDs, result status, and approval
state. Plaintext prompts, private payloads, and tool results are deliberately
excluded. Existing file and Wi-Fi triggers remain available to host workflows.

## Lifecycle

1. Host constructs `AgentAutomationService` with `AgentRuntime`, registries,
   an encrypted `AgentAutomationStateStore`, and (optionally) a typed event
   adapter.
2. `create` validates the agent policy, captures its session allowlists, and
   writes a Chronos rule.
3. Chronos dispatches a schedule or authenticated system event.
4. The service deduplicates the event, applies budgets/recursion checks,
   creates a durable `AgentJob`, and runs the existing Agent model →
   `ToolIntent` → `ToolPolicy` → `ToolExecutor` loop.
5. Sensitive jobs wait for explicit approval. Completion, retry, cancellation,
   or failure is written to both automation state and the Chronos audit.

`start()` is safe to call after restart. It rehydrates rules/jobs, repairs
interrupted runs, resumes queued work, and re-arms retry timers. `stop()` removes
the Chronos listener and timers; host adapters should call it during shutdown.

## Typed local system adapter

Chronos' additive event shape is:

```ts
{
  type: 'system',
  eventType: 'device.security',
  eventId: 'security-event:42',
  dataClass: 'PRIVATE',
  occurredAt: new Date().toISOString(),
}
```

`eventType` is validated against a conservative identifier grammar and the
automation layer additionally allowlists product event types. Unknown or
malformed events are rejected. A host-specific adapter can implement
`AgentAutomationEventSource`, but it must preserve authenticated IDs and must
not use an event to widen capabilities.

Chronos remains useful for deterministic schedule tests and existing native
file/Wi-Fi integrations. Agents add no central scheduler and no remote
automation service.
