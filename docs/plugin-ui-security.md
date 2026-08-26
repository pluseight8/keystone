# Plugin UI Security

Plugin UI is declarative and untrusted. Core owns confirmation, recovery, secret, safety, security-lockdown and external-link warning surfaces. Plugins cannot inject arbitrary HTML into the trusted root or cover protected controls.

## Invariants

- No sandbox session means no executable plugin authority.
- Capability grants are scoped to plugin, revision and sandbox session and are revocable.
- Raw secrets, identity keys, process APIs, arbitrary filesystem and anonymous mesh topology never cross the host boundary.
- Shared/public output still passes the Core Content Safety gate.
- Internet availability is optional; plugins fail closed when a capability is unavailable.
