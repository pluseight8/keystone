# Unified AI Resource Scheduler

Keystone treats models as compute resources and agents as identities with their own state, context and capabilities. `AIResourceScheduler` is the local host-neutral coordination layer for Personal AI, Browser work, Research/Coding workers, Agent Social, Automations, Recommendations and Memory jobs.

## Shared runtime

Jobs address a `provider/model` reference and receive a short-lived `ModelLease`. The scheduler keeps one `AIModelRuntime` per model reference, loads it once, and lets independent jobs use it concurrently within the resource budget. Context is never assembled or merged by the scheduler: each handler receives its own `agentId`/`sessionId` and remains responsible for the existing capability and privacy boundaries.

The model lifecycle is `UNLOADED → LOADING → READY → BUSY → IDLE → UNLOADING`; failures become `FAILED` and can be recovered by the host adapter. Unloading the runtime does not delete `AgentSession`, `Memory`, `Identity` or any other durable state.

## Queue and fairness

The bounded priority queue supports:

- `USER_INTERACTIVE`, `ACTIVE_AGENT`, `BROWSER`, `AGENT_SOCIAL`, `AUTOMATION`, `RECOMMENDATION`, `MEMORY_CONSOLIDATION`, `BACKGROUND`;
- per-agent active/queued quotas;
- max queued jobs and per-job timeout;
- cooperative `checkpoint()`/`yieldIfNeeded()` preemption;
- cancellation, pause/resume, bounded concurrency and age-based starvation protection;
- local metadata-only metrics (no telemetry).

When an interactive job arrives, lower-priority work is asked to yield at its next checkpoint. The foreground job receives the released slot; a paused handler resumes with the same job/session identity after the owner explicitly resumes it.

`InferenceJob` persistence contains only scheduling metadata. Prompt, context, tool results and model output are not written to the scheduler store. A process restart converts persisted running jobs to queued crash-recovery jobs; the host reattaches a typed handler before execution.

## Resource modes

| Mode | Behaviour |
| --- | --- |
| `PERFORMANCE` | More concurrency; background work is allowed. |
| `BALANCED` | Bounded foreground and one background slot by default. |
| `GAMING` | Foreground work is allowed, normal background inference is paused; only jobs marked `cheap` in the Recommendation class may run. |
| `BATTERY` | The model may unload while idle; expensive proactive/background jobs are paused. |

Host adapters provide normalized RAM/VRAM pressure, CPU/GPU utilization, battery/charging, thermal state and foreground-heavy-app signals. Platform APIs remain outside `@keystone/core`.

## Host integration

Native hosts register one `AIModelRuntime` (or a `runtimeFactory`) and can wrap existing `AgentModelGateway`/`AIProvider` instances with `ScheduledAgentModelGateway` or `ScheduledAIProvider`. This preserves the existing `AgentRuntime`, `AIOrchestrator`, `ToolPolicy` and `Memory` boundaries while making their model calls share a runtime.

The mobile `AI Resources` surface shows the loaded model, lifecycle, queue, active/paused jobs, selected mode and local resource metrics. It can pause/resume background work or request model unload; it cannot expose private prompts or model weights.
