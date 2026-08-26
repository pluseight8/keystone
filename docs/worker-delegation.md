# Worker Delegation Contract

Worker delegation is an explicit capability hand-off from a persistent Agent
Bot to one `EphemeralAgentWorker`. It is not capability inheritance and it is
not a new trust relationship.

## Task envelope

`WorkerTask` carries a bounded objective, worker type, parent Agent/run IDs,
explicit context items, object references, execution class, privacy class, a
creation timestamp, and a canonical fingerprint. The fingerprint covers the
parent, objective, type, and object references, so replaying the same subtask
under one parent is rejected before a model is scheduled.

`WorkerCapabilityGrant` is separate from the task. Its exact allowlists are
validated against the registered `ToolRegistry`:

```text
parent Agent Bot
  └─ WorkerTask + WorkerCapabilityGrant
       ├─ tool IDs / skill IDs
       ├─ capabilities
       ├─ data classes + source/object scope
       ├─ expiresAt / maxUses / maxRuntimeMs
       └─ canSpawnWorkers=false (default), depth≤1
```

A grant cannot be widened by the worker, a model, a tool result, a webpage, or
an attachment. `READ_PRIVATE` is useful only when the parent explicitly gives
the matching data scope. Destructive, network, device, and security-sensitive
tools still use the existing confirmation/double-confirmation policy.

## Tool and context flow

The bounded loop is:

```text
model → ToolIntent → grant check → ToolPolicy/ToolExecutor
      → result-class check → scoped context → next model call
```

The service limits repeated calls and total calls. A private tool result cannot
be sent to an external worker. Source/object scope and data class are checked
again when a result is appended to context, which protects against a tool that
returns more data than its declaration promised.

Browser and Coding workers therefore start with no Memory, DMs, private files,
social graph, device/security state, or unrestricted shell authority. Those
sources must be supplied as explicit, policy-approved context and grants.

## Result provenance

`WorkerResult` records worker/task IDs, status, bounded output, source IDs and
source types, tools used, data classes, confidence, completion time, and a
monotonic result generation. The parent should call `verifyResult` before
merging a result. A copied result with a different ID, task, or generation is
rejected as stale/spoofed.

## External boundary

External execution is an adapter to the orchestrator/firewall, never a
direct Ollama/OpenAI/network call. Private or secret context rejects worker
creation for `external`; public/user-explicit items are the only payload that
can reach the adapter. External tool intents are denied because local ToolPolicy
must execute tools. If no firewall adapter is installed, external worker
creation fails closed.

## Budgets, recovery, and cleanup

The service bounds fan-out, depth, model/tool calls, retries, runtime, context
tokens, grant uses, and scheduler queue work. Workers run with scheduler
priority `BACKGROUND`, leaving user-interactive and active-agent jobs ahead of
them. The worker profile's descriptive priority remains visible for UI and
audit, but sibling workers cannot deadlock by pre-empting one another.

Context cache leases are isolated by worker ID. Completion, cancellation,
failure, and destruction release the lease and clear runtime KV. A restart
hydrates only bounded terminal metadata; private task context and grants are
not reconstructed. Promotion requires an explicit confirmation and a host
callback that creates a durable Agent.

## Host checklist

Hosts should install `EphemeralAgentWorkerService` through the existing AI
runtime boundary, provide encrypted `WorkerStateStore` storage, pass the same
`AIResourceScheduler`/`AIContextCacheManager` used by AgentRuntime, and expose
the worker list in the Agents screen. Do not publish worker IDs in public
discovery, create worker AgentProfiles, or treat a worker result as an owner
decision without the parent Agent's existing approval policy.
