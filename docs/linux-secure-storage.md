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

## Desktop identity keys

The Tauri Desktop host stores device identity seeds in the same Secret Service
through `secret-tool` (`service=keystone-desktop-identity`, one item per
device). Seeds travel over stdin only, never command-line arguments or logs.

- A new identity on Linux fails closed when no Secret Service answers a
  store/lookup probe; there is no silent fallback to a file.
- Seeds from the older owner-only `identity-keys.json` file are migrated on
  first use. A seed leaves the file only after the Secret Service returned the
  identical value, so an interrupted migration resumes on the next access.
  If the two copies differ, both are kept and the operation fails instead of
  choosing one.
- An existing file seed stays usable while no Secret Service is reachable, so
  the owner is not locked out of an existing identity.
- macOS and Windows still use the `0600` file until Keychain / Credential
  Manager are integrated; any process running as the same user can read it.
