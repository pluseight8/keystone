# Plugin Signatures

Signatures use a domain-separated Keystone plugin payload containing plugin ID, version, manifest, integrity tree, entrypoint, requested capabilities and dependencies. A signature authenticates provenance only; it never grants permissions or owner authority.

## Invariants

- No sandbox session means no executable plugin authority.
- Capability grants are scoped to plugin, revision and sandbox session and are revocable.
- Raw secrets, identity keys, process APIs, arbitrary filesystem and anonymous mesh topology never cross the host boundary.
- Shared/public output still passes the Core Content Safety gate.
- Internet availability is optional; plugins fail closed when a capability is unavailable.
