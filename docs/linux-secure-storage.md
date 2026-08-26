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
