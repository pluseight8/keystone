# ToolFlow Runtime

ToolFlow is Keystone's bounded, data-only workflow runtime. An Agent Bot or ephemeral worker may propose one program for mechanical work, after which Keystone validates it and executes typed tools without an LLM round trip between every simple step.

The normal path is:

`model proposes → ToolFlowCompiler/Validator checks → ToolFlowExecutor runs → Agent receives a ToolFlowArtifact → final inference`

The runtime is local-first and uses the existing `ToolRegistry`, `ToolPolicy`, `ToolExecutor`, `AIResourceScheduler`, `TaskGraphExecutor`, `EphemeralAgentWorkerService` and `BrowserAgentRuntime`. It does not add a transport, model, cloud service or commerce feature.

## Program shape

A flow has a signed-by-integrity (revisioned deterministic digest) program header, an `AgentRun`/`WorkerRun` creator, explicit tool IDs, capabilities, data scopes, expiry and a `ToolFlowBudget`. Its tree contains only:

`CALL_TOOL`, `MAP`, `FILTER`, `SORT`, `LIMIT`, `SELECT`, `TRANSFORM`, `IF`, `FOREACH`, `PARALLEL`, `JOIN`, `ASSERT`, and `RETURN`.

Expressions are literals or typed references (`{ ref: "items" }`, `{ path: "title", from: { ref: "item" } }`). There is no JavaScript/Python/shell/eval/dynamic flow operation. Tool inputs and outputs are still validated by the registered Zod schemas through `ToolExecutor`.

Static validation rejects unknown tools/skills/operations, invalid references, cycles, recursive or excessive expansion, capability or scope escalation, expired/tampered programs, and a cost estimate above the declared budget. Runtime budgets additionally bound steps, iterations, calls, parallelism, runtime, intermediate bytes, retries and trace entries.

`ToolFlowExecutor` supports cooperative `pause`, `resume` and `cancel`. A `CALL_TOOL` that mutates data still enters the existing confirmation/double-confirmation boundary; hiding it in a flow does not grant approval. Retries are explicit and bounded.

## Artifacts and privacy

Every result carries a `ToolFlowArtifact` with source tool-call metadata, object citations, provenance, privacy scope, integrity and a trace reference. Trace entries never contain raw arguments, tool results or secrets. Data classes propagate monotonically: `PRIVATE` stays private and `SECRET` never becomes public automatically. `prepareToolFlowArtifactForExternal` rejects private/secret artifacts, and external AI cannot execute a ToolFlow loop.

## Integrations

Task graph nodes may provide `toolFlow`; the graph checks the flow grant against its own capability/data-scope grant and converts the verified artifact into the existing task-artifact protocol. Workers may likewise receive a bounded flow; the worker grant remains the upper bound.

`BrowserToolFlowAdapter` exposes only typed `browser.openTab`, `browser.observe`, `browser.navigate` and `browser.createArtifact` tools. All origin, revision, download, privacy and host checks remain in `BrowserAgentRuntime`; arbitrary browser evaluation is not exposed.

See [ToolFlow Security](toolflow-security.md) and [ToolFlow Language](toolflow-language.md) for the validation and DSL details.

## Measured benchmark (local)

The checked-in `toolflow-benchmark.test.ts` ran on 2026-08-17 with eight deterministic echo calls. The repeated model/tool shape made 8 model round trips and 8 tool calls; `LLM → ToolFlow → tools → LLM` made 1 model round trip and the same 8 tool calls. One isolated invocation measured 0.974 ms versus 1.925 ms; a full-suite invocation measured 1.803 ms versus 4.800 ms. These runs therefore make **no** wall-clock speedup claim (flow validation/interpretation overhead is visible on this tiny local workload). The measured, portable result is the reduction in model round trips; real model latency must be benchmarked with the host runtime.
