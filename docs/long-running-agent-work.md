# Long-running Agent Work

Workboards are Keystone's durable boundary for work that outlives one AgentRun.
Use a TaskGraph for one bounded execution plan; use a Workboard when the plan
needs ownership, dependencies, claims, human approval, artifacts, activity and
restart/offline recovery.

## Recommended flow

1. Create a `PERSONAL` Workboard (or a `SHARED_SPACE` board with an explicit
   Space grant) and declare the smallest capabilities/data scopes.
2. Create `WorkItem` records with a deterministic application ID when an
   upstream event can be replayed.
3. Add prerequisite edges. Do not encode a cycle; the service rejects it.
4. Let the assigned Agent/worker claim an item with a unique execution key.
5. Heartbeat while running, release as completed/retryable/paused, or let stale
   recovery reclaim an abandoned lease.
6. Return bounded artifacts/comments with source and data-class provenance.
7. Return `NEEDS_USER` whenever an owner decision or confirmation is required.
8. Resume only after `respondToUser()` or an explicit retry/pause action.

## Failure semantics

The service is deliberately conservative. A missing executor, invalid signature,
revision conflict, expired grant, failed dependency, corrupt artifact or
external private scope is an explicit failure. A stale claim never remains
`RUNNING`; it becomes `READY` or `BLOCKED`. A terminal item must be retried
explicitly. Original artifacts and activity are bounded by board policy, and
the durable snapshot contains no model KV cache or unrelated private database.

## Scheduling and automation

Workboard execution is submitted to the existing AIResourceScheduler when a
runtime is needed. `USER_INTERACTIVE`/`ACTIVE_AGENT` traffic keeps priority over
background board work. GAMING pauses background work, BATTERY defers expensive
work, and PERFORMANCE may use the configured board concurrency. Chronos and
AgentAutomation remain the source of scheduled/event triggers; Workboard only
deduplicates and persists triggered items.

## Shared work and agents

Human membership, Agent membership and ephemeral-worker assignment are separate
records. Agent Visit, Agent Social Graph trust, or a Shared Space membership by
itself does not grant a Workboard capability. A worker receives only the
explicit WorkItem grant and cannot enlarge its tools or data scope. Comments and
activity identify whether the author was a human, Agent or worker.

## Operations checklist

- Keep claim lease/heartbeat windows bounded and call stale recovery on startup.
- Give every retried or externally-triggered item a stable execution key.
- Keep private artifacts on private boards and reference Keystone objects by ID.
- Surface `NEEDS_USER` in the Owner Inbox; never auto-confirm in a background job.
- Use existing production transport and security adapters for replication.
- Exercise `pnpm test`, `pnpm test:integration`, `pnpm test:network`, `pnpm build`,
  and `pnpm release:check` before shipping.

Workboards are local-first infrastructure. Keystone remains non-commercial:
there are no payments, ads, subscriptions, marketplace flows, telemetry or
central workboard service.
