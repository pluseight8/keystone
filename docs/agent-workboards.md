# Agent Workboards

Agent Workboards provide a durable Workboard around the existing AgentRuntime, TaskGraph,
ToolFlow, worker and AIResourceScheduler boundaries. A Workboard is a local-
first queue of long-running `WorkItem` objects; it is not a second scheduler,
model runtime, identity system or content store.

## Model and lifecycle

`AgentWorkboardService` exposes `Workboard`, `WorkItem`, `WorkItemClaim`,
`WorkItemDependency`, `WorkItemComment`, `WorkItemArtifact` and signed
`WorkboardActivity` records. Work items distinguish human, Agent and ephemeral
worker actors and retain creator/assignee provenance. Statuses are:

```text
BACKLOG → TODO → READY → RUNNING → REVIEW → DONE
                    ↘ BLOCKED / NEEDS_USER / PAUSED / FAILED / CANCELLED
```

The exact transition is policy checked. A dependency is a signed revisioned
edge in a DAG; cycles are rejected, incomplete prerequisites block a claim, and
failed required prerequisites block descendants. Completing a prerequisite
automatically moves eligible blocked descendants to `READY`.

Claims are expiring leases, not permanent ownership. Heartbeats and renewals
extend a bounded lease. `recoverStaleClaims()` marks abandoned claims stale,
clears execution ownership, and returns the item to `READY` or `BLOCKED`. An
`executionKey` is durable and deduplicated, so a reconnect or retry cannot run
the same execution twice.

`NEEDS_USER` is a hard stop. The item creates an Owner Inbox entry and remains
there across restart/offline periods until the board owner responds. A response
returns the item to `READY`; there is no implicit approval or autonomous bypass.

## Execution boundaries

TaskGraph, ToolFlow, Agent and worker work is delegated through typed host
adapters. Workboard does not invoke shell, arbitrary JavaScript, a new model, or
another scheduler. When an `AIResourceScheduler` is attached, its existing
priority and resource mode remain authoritative: interactive work wins,
background work yields in GAMING/BATTERY, and no private item falls back to an
external provider.

Chronos/Automation calls `triggerFromAutomation()` or
`handleAutomationEvent()`; the Workboard only persists and deduplicates the
event. It does not create a competing clock or scheduler.

## Privacy, grants and Shared Spaces

Every item declares capabilities and data scopes. A grant must be a subset of
the board policy and a private/secret artifact is rejected unless the item
scope explicitly permits it. External execution cannot declare private scope.
`SHARED_SPACE` boards require a Space reference and the existing Space policy
callback; an Agent Visit or trust relationship does not grant Workboard access.
Remote Agents and workers need explicit board membership/grants. Human and
Agent/worker actors are kept distinct in comments, activity and artifacts.

Artifacts are bounded, integrity-labelled references. They store object IDs and
provenance rather than copying media. Private values remain local to the
authorized board and are never added to public discovery.

## Durable recovery and transport

`WorkboardStateStore` persists board, item, claim, dependency, inbox, comment,
artifact and bounded activity state. Revision checks, signed events and replay
dedup handle concurrent updates. `WorkboardTransportReplication` wraps the
existing authenticated `Transport`/`EnvelopeSecurity` path; it adds no new
wire protocol. Offline delivery is handled by the existing transport/provider
reconnect path, while stale leases remain fail-closed until recovered.

## Desktop surface and checks

The desktop Workboard tab provides Board/List/Activity entry points, status
columns and an Owner Inbox affordance. It is a host adapter surface: the core
service remains the authority for drag/status, assignment, retry, pause/cancel,
artifact and comment actions. UI labels are available in English and Russian.

Focused coverage is in `packages/core/src/ai/workboards.test.ts`: durable
restart, leases/stale recovery, dependency blocking/unblocking/cycles,
TaskGraph/ToolFlow adapters, NEEDS_USER, private artifact scope, offline
replication and forged-event rejection. The existing integration and real
Hyperswarm/Noise suites remain the production transport validation; no
commercial, advertising, payment or marketplace behavior is introduced.
