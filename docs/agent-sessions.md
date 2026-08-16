# Agent sessions and runs

An `AgentSession` is the durable, isolated conversation container for one
`Agent`. It owns its title, policy-narrowed tool/skill/context allowlists,
bounded history and monotonic run sequence. Different sessions never share
history or source requests.

An `AgentRun` is one user request. Its deterministic id is derived from the
session id and sequence, so restart/recovery can address the same run. The
state machine is:

```text
queued -> running -> completed
                    cancelled
                    failed
                    crashed -> queued (recover)
running <-> paused
```

`stream()` and `streamRun()` yield state changes, bounded token chunks,
assistant output, tool calls/results and errors. `cancelRun()` aborts the
provider/tool signal and closes the event stream. `pauseRun()` takes effect at
the next checkpoint; `resumeRun()` releases it.

The store is intentionally host-provided. A host can implement an encrypted
durable store, while tests use `InMemoryAgentStateStore`. Snapshots are
versioned and reference-check sessions, agents and runs before hydration.

## Child agents

`delegate()` creates a separate child session. The caller must name every
child tool, skill and context capability. The intersection with the parent
session and child profile is enforced; capabilities are not inherited by
default. Child depth, repeated calls, runtime and tool loops remain bounded.
Child output is not automatically forwarded to an external model.

For UI, the mobile Agents screen shows profiles, privacy badges, sessions,
run state, pause/resume and stop controls. Native hosts can add confirmation
surfaces without changing the core state machine.
