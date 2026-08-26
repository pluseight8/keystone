# ToolFlow Security

ToolFlow is a capability-bearing program, not a second authorization system. Its grant is always a subset of the caller's grant and is checked before and during execution.

## Preflight checks

- creator is an `AgentRun` or `WorkerRun` and the flow is revisioned, expiring and integrity checked;
- each operation is on the fixed allow-list;
- every tool and skill exists, is explicitly allowed, and declares exactly the registered capabilities;
- every tool result class fits an explicitly declared data scope;
- variables are typed references, not executable code;
- static cost (steps, calls, parallelism, expansion and bytes) fits the budget;
- cycles, recursion, dynamic self-modification and forbidden fields (`shell`, `eval`, scripts, commands) are rejected.

## Runtime checks

`CALL_TOOL` creates a fresh opaque `ToolIntent` with `ToolRegistry` and invokes only `ToolExecutor`. `ToolPolicy` and its confirmation boundary therefore remain authoritative for writes, network sends, device actions, destructive actions and security-sensitive actions. A failed tool may continue only when the step explicitly opts into a bounded partial result. Retries consume the flow retry/call budget.

The executor checks cancellation, expiry/runtime, step count, iteration count, fan-out, intermediate bytes and trace size at checkpoints. Parallel work is bounded and deterministic output order is retained. No worker, tool output or browser page can rewrite the program or grant new capabilities.

## Privacy boundary

Each intermediate value has a data class and provenance envelope. Combining values keeps the most restrictive class. A private/secret value cannot be downgraded by `TRANSFORM`, `SELECT`, an artifact, a retry or a child branch. External execution is rejected; private and secret artifacts cannot be prepared for an external provider. Traces contain only IDs, classifications, sizes, status and timing metadata.

Browser flows use the existing runtime's untrusted page context, semantic element revisions, origin allow-list, explicit upload and download quarantine. The adapter has no arbitrary selector, credential, cookie, filesystem or evaluation API.
