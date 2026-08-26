# Private AI orchestration

Keystone keeps the assistant local-first. `AIOrchestrator` can use a local
runtime or a trusted device from the Personal AI Mesh to plan, read private
context and assemble the final answer. External providers are optional
workers for isolated public subtasks; they are not a personal-data backend.

## Delegation contract

`DelegationPlan` contains a bounded list of `AISubtask` values. A subtask has a
neutral `objective`, source identifiers and an explicit `safeForExternal`
attestation. It never contains the original user prompt. Before every external
subtask, `SafeDelegationService`:

1. rejects an unattested task, `PRIVATE`/`SECRET` context, private system data,
   private tools, or accidental overlap with private source values;
2. calls `AIEgressFirewall.assert('remote', ...)` itself;
3. sends the resulting payload through the explicitly selected remote model;
4. rejects external tool intents instead of executing or forwarding them.

Redaction is not treated as consent. If a neutral public formulation is not
possible, the task remains local/trusted or fails closed. Remote provider
fallbacks cannot turn a private task into an external request.

`delegateMany` uses bounded workers, cancellation and per-request timeouts.
The orchestrator always performs final synthesis on local or
`PERSONAL_TRUSTED_COMPUTE` execution. External results are data, not authority.

## Modes and provenance

- **Private only** — no external delegation.
- **Balanced** — safe, explicitly isolated public subtasks may use an external
  provider; private context and final synthesis stay local/trusted.
- **Local preferred** — local/trusted execution is preferred, with the same
  safe-delegation boundary as Balanced when an isolated public subtask is
  useful.

Every result carries metadata-only provenance: local context, planning,
delegation, external result and final synthesis. It contains source IDs and
data classes, never prompt values or private tool output. The UI exposes
`Processed privately` or `External AI used for an isolated subtask`.

The feature uses configured provider adapters and the existing Hyperswarm/
Noise Personal AI Mesh. It adds no central Keystone AI service, telemetry or
public compute sharing.
