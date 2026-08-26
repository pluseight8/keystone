# Plugin Supply Chain

Packages are received into quarantine, integrity checked, bounded, dependency-locked and reviewed before install. A signed package remains executable untrusted code. Publisher provenance, integrity and security approval are separate evidence classes.

## Invariants

- No sandbox session means no executable plugin authority.
- Capability grants are scoped to plugin, revision and sandbox session and are revocable.
- Raw secrets, identity keys, process APIs, arbitrary filesystem and anonymous mesh topology never cross the host boundary.
- Shared/public output still passes the Core Content Safety gate.
- Internet availability is optional; plugins fail closed when a capability is unavailable.

## Distribution and recovery

Content-addressed package acquisition is bounded, resumable and source-independent. Corrupt chunks, mismatched same-version revisions, revoked publisher/revision identities and dependency substitutions are rejected before install. Repair reacquires the exact immutable revision and repeats the complete security lifecycle; rollback never restores revoked authority.
