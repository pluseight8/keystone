# Agents

The agent runtime provides a local-first layer on top of the existing AI
orchestrator, privacy firewall, Personal AI Mesh and typed tool boundary. It
does not provide a new provider, transport or permission system.

## Profiles

`Personal`, `Research`, `Coding`, `Automation` and `Minimal` are policy
presets. A profile fixes its model policy, context capabilities, enabled tool
and skill allowlists, privacy class, runtime limit, tool-iteration limit,
repeated-call limit, child-agent depth and approval requirement. A session may
only narrow those values.

The Personal profile is private and selects this device or a trusted personal
AI node. It never falls back to an external provider for private work. A
profile that permits external work still reaches it only through
`AIOrchestrator`/`AIEgressFirewall`; the agent runtime never sends private
context to a model adapter directly.

## Run boundary

The model returns text and typed `AgentToolProposal` values. Keystone then
performs the bounded sequence:

```text
model -> ToolRegistry.issueIntent -> ToolPolicy/approval -> ToolExecutor -> ToolResult
```

Tool ids, skill ids and context capabilities are allowlisted in the session.
Content supplied by files, messages or web adapters is untrusted data and
cannot grant a capability or spawn an unrestricted child agent. There is no
shell, arbitrary eval or unrestricted filesystem/network tool.

Runs have deterministic ids (`session id + sequence`), bounded runtime,
maximum model/tool iterations, repeated-intent detection and a finite child
depth. Streaming tokens are exposed as run events. Cancellation uses the run
`AbortSignal`; pause/resume waits at a checkpoint without dropping the
session.

## Durable state

`AgentStateStore` persists versioned agents, sessions, bounded message history
and run metadata. On startup a stored `queued` or `running` run is marked
`crashed`; the host can call `recoverRun`/`resumeRun`. Recovery reuses the
original run id and input/attachments and does not duplicate the user message.

Sensitive values are not written to the runtime audit by default. Tool result
classification remains attached to session history so a local/trusted host
can apply the same privacy policy on the next turn.

See [agent sessions](agent-sessions.md) and [context engine](context-engine.md).
