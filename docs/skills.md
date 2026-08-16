# AI skills

A Keystone `Skill` is a source-available, integrity-checked manifest. It is a
limited list of registered typed tools plus instructions and a capability
manifest. It is not a plugin runtime and contains no executable JavaScript.

## Manifest and approval

Each skill has an id, package version, instructions, tool ids, declared
capabilities, source (`builtin` or `local`) and a SHA-256 integrity hash over
the canonical immutable manifest. `SkillRegistry` verifies the hash before
installation. Mutable state (`enabled` and approved capabilities) is kept
separately from the hash, and any approval embedded in a package is ignored;
only the user-facing policy can pass approval to the registry.

The built-in `keystone-search` and `keystone-actions` manifests are provided by
the core and start with their capabilities unapproved. The user reviews and
approves capabilities in Mobile → AI → Skills. A skill can receive only
capabilities it declared and the user approved. Disabling a skill or revoking a
capability is checked on every execution and takes effect immediately.

Local skill packages may describe and compose already registered host tools,
but they cannot add a handler through this manifest API. There is deliberately
no arbitrary shell, eval, raw filesystem, unrestricted network, payment,
advertising or marketplace capability. A future explicitly dangerous boundary
would need a separately reviewed capability and would remain off by default.

## Execution flow

```text
model / local planner
        │ typed proposal
        ▼
ToolRegistry.issueIntent (zod + capability match)
        │ one-use opaque intent
        ▼
ToolPolicy (source, skill, existing host policy)
        │ confirmation / double confirmation
        ▼
ToolExecutor → named Keystone host adapter → typed ToolResult
```

External providers can only propose an intent through the existing
`AIOrchestrator`; they never receive private tool definitions or private
results. `ToolExecutor` is the sole execution path, and its metadata-only
audit is visible in the Skills screen.
