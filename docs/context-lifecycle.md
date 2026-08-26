# Context lifecycle and eviction

`SessionContextState` is a bounded runtime index keyed by `(agentId, sessionId)`. It is not a replacement for AgentRuntime or Memory.

## Lifecycle

1. A host registers/ensures a session.
2. The scheduler grants a `ModelLease`.
3. The cache manager restores HOT/WARM KV when available, or builds from snapshot/history/allowed sources.
4. Inference runs with a session-specific plan.
5. Release keeps interactive context HOT when policy allows, otherwise moves it to WARM or COLD.
6. Idle sweeps and memory pressure enforce budgets.

Changing models invalidates backend KV and rebuilds from the model-independent snapshot. Restart, unload and crash recovery therefore preserve agent identity and permissions.

## Budgets and modes

Policies bound total KV RAM/VRAM, per-session KV, HOT/WARM counts and snapshot size. `PERFORMANCE` keeps more recent contexts; `BALANCED` is moderate; `GAMING` retains the current interactive context and evicts background caches; `BATTERY` minimizes retention and quickly moves inactive contexts to COLD. A COLD entry that remains unused for the configured frozen interval becomes FROZEN while retaining its durable snapshot.

Eviction order is WARM → COLD, followed by old inactive HOT entries. Active inference is never evicted by ordinary pressure. A user can explicitly clear runtime cache without deleting durable state.

## Summaries and trust

Long sessions are compacted locally or on trusted personal compute. The summary keeps source turn IDs and data-class provenance. Untrusted remote-agent, webpage and file content remains marked untrusted and is never interpreted as system instructions or capability grants.

## Recovery contract

The only required restore data is the durable `ContextSnapshot` plus the existing AgentRuntime history and capability-filtered ContextBuilder sources. Portable raw KV is optional and disposable. A COLD restore can therefore survive model changes, runtime unloads, process restarts and loss of GPU memory.
