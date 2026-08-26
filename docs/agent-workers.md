# Ephemeral Agent Workers

The worker service provides temporary workers for the existing local-first Agent Bot. A
worker is an executor for one bounded task; it is not a new human account,
cryptographic identity, AgentProfile, or permanent AgentSession. The parent
Agent Bot remains the owner of the task and the only component that can
explicitly promote a completed worker.

## Shared runtime

`EphemeralAgentWorkerService` submits every worker to the existing
`AIResourceScheduler`. Workers use the same provider/model runtime and
`ModelLease` machinery as AgentRuntime, Research, Browser, automation, and
Memory jobs. Model weights are therefore loaded once per provider/model pair.
Workers are scheduler background work; `USER_INTERACTIVE` and `ACTIVE_AGENT`
requests retain priority, so a fan-out cannot make the user wait forever.

The service accepts an optional `AIContextCacheManager`. The worker session is
namespaced as `worker:<worker-id>` and receives a separate cache lease. On
completion, cancellation, failure, or destruction the lease is released and
runtime cache is cleared. A worker's KV cache is never Identity, Memory,
conversation history, or permission state.

## Profiles and lifecycle

The built-in profiles are `Research`, `Browser`, `Coding`, `Planning`,
`Summarization`, and `Analysis`. A profile supplies a description, scheduler
metadata, and a conservative default `WorkerBudget`; it does not grant data or
tools. The host can override the budget only within the service limits.

The durable lifecycle is:

```text
CREATED → QUEUED → RUNNING ⇄ WAITING_FOR_TOOL/PAUSED
        → COMPLETED | FAILED | CANCELLED → DESTROYED
```

`WAITING_FOR_TOOL` is entered while a typed `ToolIntent` is executing. Pause
and resume are cooperative scheduler operations. A result stores bounded text,
source references, tools used, data classes, confidence, status, and a result
generation. Durable worker metadata intentionally omits task context and
capability payloads; after restart an interrupted worker is fail-closed rather
than silently resumed with stale authority. Completed result metadata can be
restored without private context.

## Explicit grants

`WorkerCapabilityGrant` is issued by the parent Agent Bot and contains:

- exact tool and skill IDs;
- declared `ToolCapability` values;
- allowed data classes and optional source/object scopes;
- expiry, maximum uses, and maximum runtime;
- an explicit `canSpawnWorkers` flag and bounded depth.

The worker receives no automatic inheritance from the parent. `ToolExecutor`
and `ToolPolicy` remain the final authorization boundary. The service checks
the grant before executing a tool and checks the tool result class before the
result enters worker context. Unknown tools, undeclared capabilities, expired
or exhausted grants, and external-origin intents fail closed. A webpage, file,
remote agent, or model response is untrusted data and cannot change a grant.

By default a worker cannot create another worker and the maximum depth is one.
Parent fan-out is bounded (four by default, configurable up to five); duplicate
subtasks use a deterministic fingerprint and are rejected. Runtime, model-call,
tool-call, retry, context-token, and queue budgets bound worker storms and
infinite loops.

## Privacy and execution

`local` and `personal_trusted` workers may receive private context only when
the explicit data scope allows it. `external` workers are accepted only with a
host `externalExecutor` that represents the existing AI orchestrator and
egress firewall. Private/secret context is rejected before scheduling, and the
payload is filtered to `PUBLIC`/`USER_EXPLICIT`; external workers cannot execute
local tools. A private task therefore has no automatic cloud fallback.

Every result carries source IDs and data-class provenance. The parent can
verify a result against the worker ID, task ID, and generation before using it,
which prevents stale or spoofed results from being applied.

## Cleanup and promotion

On terminal completion the service releases the scheduler/context-cache state,
clears temporary tool state, and persists only bounded result/audit metadata.
`promoteToAgent(workerId, { confirmed: true })` is a separate explicit action;
the host must provide the callback that creates a real Agent/AgentProfile. A
worker is never promoted implicitly by a long-running task or restart.

The mobile Agents screen shows the parent Agent Bot, worker type, objective,
grant tools, state, model/tool calls, wait/inference timing, result preview, and
a stop action. It does not expose a separate social surface or identity for a
worker.

## Validation

`packages/core/src/ai/workers.test.ts` covers shared model loading, scoped
grants, private/external isolation, cancellation and cache cleanup, fan-out and
recursion limits, promotion confirmation, result verification, and durable
bounded restore. The benchmark creates Research, Browser, Coding, and Planning
workers against one instrumented runtime and asserts one model load with
isolated contexts. Network tests remain the existing production Hyperswarm/
Noise suite; no worker-specific transport or central worker service is added.

Keystone remains non-commercial: this layer adds no payments, ads,
marketplace, telemetry, or hosted compute.
