# Multi-Agent Task Graphs

The task-graph service provides a bounded DAG coordinator for the persistent Agent Bot. It
composes the existing `EphemeralAgentWorkerService`, `AIResourceScheduler`,
`AIContextCacheManager`, `AgentRuntime`, and `ToolPolicy`; it does not add a
second model runtime, transport, identity, or storage protocol.

## Graph model

`AgentTaskGraph` contains a goal, owner Agent/run reference, explicit
capability and data-scope policy, budgets, revision, and `TaskNode` records.
Each node has an objective, worker or Agent assignment, dependencies, input and
output references, priority metadata, timeout, retry policy, and lifecycle
status. The planner normalizes IDs and scopes, rejects duplicate/missing
dependencies, self-edges, cycles, impossible artifact references, excessive
fan-out/depth/size, and undeclared capabilities before execution.

Graph lifecycle is:

```text
PLANNING → READY → RUNNING ⇄ WAITING/PAUSED
                   → COMPLETED | PARTIAL | FAILED | CANCELLED
```

Independent ready nodes can run concurrently up to `maxConcurrentNodes`.
Workers remain scheduler background work, so interactive AgentRuntime work
keeps priority. The graph executor never creates a model per node.

## Least-context artifacts

Nodes receive their own explicit context plus verified artifacts from required
predecessors. A `TaskArtifact` is typed as text, structured data, object
references, citations, file reference, or error. It records the producer node,
worker/result provenance, graph and node revision, source IDs, data class,
scope, creation time, bounded size, and an integrity digest. A downstream node
must declare a compatible scope; private or secret artifacts cannot cross an
external execution boundary. Artifact IDs and Keystone object references are
passed by reference rather than copied media/content.

The executor verifies integrity before propagation and rejects stale revisions.
Artifact and context budgets are enforced before a node is scheduled. A failed
branch blocks required descendants while independent branches may complete,
producing a `PARTIAL` result with completed, failed, skipped, and artifact IDs.

## Budgets, retry, and replanning

Graphs bound nodes, concurrent nodes, depth, fan-out, inference jobs, tool
calls, retries, runtime, context tokens, generated artifacts, and artifact
bytes. Retry attempts use a new worker task fingerprint and remain inside the
graph retry/inference budgets. Scheduler priority is not downgraded by graph
metadata, and external private work fails closed rather than falling back to a
remote provider.

`replan` and `changeGoal` create a new graph revision. Changed nodes and their
descendants become `STALE`, old artifacts are invalidated, and in-flight
results are discarded by revision checks. Adding capabilities or broader data
scopes requires the host policy callback and explicit approval; content or a
worker cannot expand authority. User controls include pause, resume, stop,
skip, retry, remove pending node, and change goal.

State persistence stores graph metadata, node status, bounded artifacts, and
counters. A restart recovers running/waiting graphs as `PAUSED`; no in-flight
worker or private context is silently revived with stale authority. The
executor can be attached to a durable `TaskGraphStateStore`.

## UI and validation

The mobile Agents screen shows graph goal, lifecycle, revision, node progress,
artifact count, and pause/resume/stop controls. It is a compact list, not a new
social surface. `packages/core/src/ai/task-graphs.test.ts` covers sequential and
parallel DAGs, cycle/dependency validation, partial failures, retry, pause,
cancellation, revision invalidation, scope isolation, external denial, and
artifact tamper detection. Existing Hyperswarm/Noise tests remain the
production transport suite; task graphs reuse that transport through existing
Agent/worker paths and add no new network protocol.

Keystone remains non-commercial: no payments, ads, marketplace, monetization,
telemetry, or hosted task-graph service is introduced.
