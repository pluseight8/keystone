# Plugin Update Security

Updates follow receive, quarantine, validation, provenance, dependency and capability review before staging. New revisions receive fresh sandbox sessions. Capability expansion requires owner review; revoked/security-quarantined revisions cannot be restored by rollback.

## Invariants

- No sandbox session means no executable plugin authority.
- Capability grants are scoped to plugin, revision and sandbox session and are revocable.
- Raw secrets, identity keys, process APIs, arbitrary filesystem and anonymous mesh topology never cross the host boundary.
- Shared/public output still passes the Core Content Safety gate.
- Internet availability is optional; plugins fail closed when a capability is unavailable.
