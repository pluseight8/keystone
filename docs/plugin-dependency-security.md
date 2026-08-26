# Plugin Dependency Security

Dependencies are exact identities with resolved versions and integrity values. Dependency locks are checked before install/update. Display names cannot substitute for IDs, transitive code does not inherit host capabilities, and native payloads are rejected by default.

## Invariants

- No sandbox session means no executable plugin authority.
- Capability grants are scoped to plugin, revision and sandbox session and are revocable.
- Raw secrets, identity keys, process APIs, arbitrary filesystem and anonymous mesh topology never cross the host boundary.
- Shared/public output still passes the Core Content Safety gate.
- Internet availability is optional; plugins fail closed when a capability is unavailable.
