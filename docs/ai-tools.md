# AI tools and capability policy

Phase 32 adds a typed action boundary between an AI model and Keystone. The
boundary is additive to `AIOrchestrator`, `AIEgressFirewall` and the Personal
AI Mesh; it does not replace any of them.

## Contract

`Tool<I, O>` contains an input `zod` schema, an output schema, a declared
capability list and a data classification for its result. `ToolRegistry` is
the only issuer of an opaque, one-use `ToolIntent`. A model cannot call a
handler directly. `ToolExecutor` validates the intent, resolves the enabled
`Skill`, asks `ToolPolicy` and then invokes the named host adapter.

The built-in adapters are:

| Tool | Capability | Host boundary |
| --- | --- | --- |
| `searchMemory`, `searchMessages`, `searchFiles`, `searchMusic`, `searchVideos`, `searchCommunities` | `READ_PRIVATE` | Existing local indexes and permission checks |
| `readAllowedFile` | `READ_PRIVATE` | `FileObject`/content policy, never a filesystem path |
| `searchLocalContent`, `openKeystoneObject` | `READ_PRIVATE` | Unified local object/search policy |
| `sendMessage`, `createGroup`, `createCommunityPost` | `WRITE_PRIVATE`, `NETWORK_SEND` | Existing messaging/community authorization |
| `playTrack`, `openVideo` | `DEVICE_ACTION` | Host media adapter |
| `managePlaylist`, `createReminder` | `WRITE_PRIVATE` | Library/Chronos host boundary |

The adapters are optional host callbacks. An absent callback means that tool
is not registered. Tool input and output are schema-checked at both issuance
and execution. The core does not expose arbitrary shell, JavaScript eval,
filesystem or unrestricted network capabilities.

## Capability and privacy rules

The available capability identifiers are `READ_PRIVATE`, `WRITE_PRIVATE`,
`NETWORK_SEND`, `DEVICE_ACTION`, `DESTRUCTIVE` and `SECURITY_SENSITIVE`.
`READ_PRIVATE` is allowed only for `local` or `personal_trusted` execution.
An `external` intent must be explicitly created by the Phase 31 orchestrator,
but it still cannot use a private tool or return a `PRIVATE`/`SECRET` result.

Mutating, sending and device actions require a host `ToolPolicy` adapter and a
visible confirmation. `DESTRUCTIVE` and `SECURITY_SENSITIVE` actions require
two confirmations. A cancelled confirmation stops before the handler, so no
side effect occurs. Existing Keystone authorization remains authoritative;
the tool layer is not an alternate permission system.

`ToolResult` always carries an `AIDataClass`. Results are not automatically
added to a provider request. `prepareToolResultForExternal` rejects
`PRIVATE`/`SECRET`; only an explicit caller may convert a public result to an
external `AIContextItem`.

## Audit and replay protection

`ToolAuditLog` stores bounded metadata only: model, source, skill, tool,
requested capabilities, policy decision, confirmation state and result class.
Arguments, prompts, file names and result values are not written. Intents are
opaque object references issued by the registry and can be claimed once;
forged or replayed objects are rejected before a handler runs.

See [skills](skills.md) for manifest integrity and user approval.

