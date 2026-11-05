# Linux secure storage

Linux production secure storage is implemented through the desktop Secret
Service (`secret-tool`) when a user session exposes it. `LinuxSecretToolStorage`
uses opaque random item IDs and base64 only for the binary-safe Secret Service
stdin protocol. Handles expose metadata and an irrevocable exportable=false
contract; raw bytes are never returned by the API.

The adapter probes the backend before reporting physical evidence. Revoke
deletes the keyring item. A missing/failed keyring is a hard failure for
security-sensitive operations, never a reason to fall back to a local key,
environment variable, JSON file or test store. Secret Service availability is
not evidence of a hardware secure enclave.

## Known gap: Desktop identity keys

The rule above describes the `native-host` adapter. The Tauri Desktop host does
not use it yet: `desktop_identity_*` commands keep device identity seeds in
`identity-keys.json` in the app-data directory, protected only by `0600` file
permissions (created owner-only and flushed before an atomic rename). Any
process running as the same user can read them. Moving these seeds to Secret
Service is an open security task, not current behavior.
