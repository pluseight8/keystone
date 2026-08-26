# Plugin Resource Security

Plugin resource budgets bound storage, IPC/events, network, registrations and runtime lifecycle. The host must enforce hard CPU/memory limits where its platform permits and must report limitations rather than overclaiming. Infinite-loop and memory-bomb tests require a real process adapter.

## Invariants

- No sandbox session means no executable plugin authority.
- Capability grants are scoped to plugin, revision and sandbox session and are revocable.
- Raw secrets, identity keys, process APIs, arbitrary filesystem and anonymous mesh topology never cross the host boundary.
- Shared/public output still passes the Core Content Safety gate.
- Internet availability is optional; plugins fail closed when a capability is unavailable.
