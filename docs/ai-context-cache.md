# AI Context & KV Cache

AI Context Cache keeps model weights shared while making runtime context disposable. `AIContextCacheManager` owns only session-local runtime state; `AgentSession`, Identity, Memory, permissions and durable history remain in their existing stores.

## Tiers

- **HOT** — the session is actively using a `KVCacheLease`; interactive work is protected.
- **WARM** — recently used context may be retained by an optional portable backend.
- **COLD** — no KV is retained. The model-independent `ContextSnapshot` and durable AgentSession are enough to rebuild the prompt.
- **FROZEN** — an explicitly inactive session with only durable structured state.

RAM/VRAM budgets are bounded globally and per session. Pressure evicts WARM before inactive HOT sessions; interactive inference is not evicted. Gaming and Battery modes aggressively clear background runtime caches. `clearRuntimeCache` and the mobile Evict action never delete conversation history, Memory, Identity or tool permissions.

## Model-independent snapshots

`ContextSnapshot` contains the session/agent namespace, generation, compact summary, recent `user`/`assistant`/`tool` turns, referenced Memory/object IDs, tool-state references and provenance. It deliberately has no system-policy or capability field, so webpage, file and remote-agent content cannot become policy through a saved summary. Backend-specific KV persistence is an optional optimization; it is never the recovery format.

Private summaries run only through local or trusted personal compute. External summarizers are rejected for PRIVATE/SECRET turns. Original durable history is retained, and a summary is not automatically a new Memory entry.

## Rebuilding COLD sessions

The manager reserves output and tool-schema tokens, then calls the existing capability-aware `ContextBuilder` when installed. Otherwise it selects explicit attachments, recent turns and retrieved items by priority. The current user prompt is carried separately and is never dropped; low-priority retrieval is omitted first. The resulting `ContextRestorePlan` records dropped IDs, references, untrusted sources and whether reconstruction occurred.

`runWithScheduler` is the integration boundary:

```text
AIResourceScheduler ModelLease
        ↓
AIContextCacheManager.acquire / ContextRestorePlan
        ↓
one shared model runtime inference
        ↓
release → HOT/WARM/COLD + durable snapshot
```

Agent/session IDs are mandatory on acquisition, preventing contexts from being mixed between Eight, Research, Browser or any other agent.

## Host integration

Install `AIContextCacheManager` through the native `MobileSettingsRuntime.contextCache` boundary. The `AI Resources → Contexts` screen shows tier, token estimate, RAM/VRAM estimate and last use. Hosts can provide a durable `ContextCacheStateStore`, a local/trusted `ContextSummarizer`, and an optional portable KV backend.

No KV cache is published to peers, discovery, external AI or backup as identity state. A restart hydrates snapshots and restores every runtime entry as COLD.
