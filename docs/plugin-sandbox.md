# Plugin Sandbox

Executable Plugins run through a host-owned isolated runtime profile. The core process never imports plugin code. Network, filesystem, process, native, secret and mesh access are denied unless a typed capability is granted. The host-owned native process bridge now provides a real Linux process boundary with sanitized environment, bounded lifetime/output and explicit termination. Full seccomp/namespace isolation remains platform-specific and is not claimed unless verified.

## Invariants

- No sandbox session means no executable plugin authority.
- Capability grants are scoped to plugin, revision and sandbox session and are revocable.
- Raw secrets, identity keys, process APIs, arbitrary filesystem and anonymous mesh topology never cross the host boundary.
- Shared/public output still passes the Core Content Safety gate.
- Internet availability is optional; plugins fail closed when a capability is unavailable.
