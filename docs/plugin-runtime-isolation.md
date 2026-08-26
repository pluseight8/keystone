# Plugin Runtime Isolation

Production executable Plugins require an isolated runtime adapter. Development adapters are not accepted in production mode. The host owns lifecycle, crash containment, session revocation and bounded IPC. Linux process/WASM bridges can provide stronger isolation; Windows, macOS and mobile adapters must report their actual host guarantees.

## Invariants

- No sandbox session means no executable plugin authority.
- Capability grants are scoped to plugin, revision and sandbox session and are revocable.
- Raw secrets, identity keys, process APIs, arbitrary filesystem and anonymous mesh topology never cross the host boundary.
- Shared/public output still passes the Core Content Safety gate.
- Internet availability is optional; plugins fail closed when a capability is unavailable.
