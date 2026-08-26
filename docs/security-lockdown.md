# Security Lockdown

`SecurityLockdown` is the explicit fail-closed state for uncertain integrity. It denies identity signing, P2P networking, privileged agent execution, plugin runtime, security-sensitive settings changes, secret export, trusted-update mutation and normal private-key unlock. It keeps only bounded technical failure metadata: category, component/path, expected/actual hash, policy epoch and timestamp. User content, secrets and recovery phrases are never included.

The UI offers only `INSPECT_FAILURE`, `VERIFY_AGAIN`, `REPAIR_HOST` and `VERIFY_RECOVERY_ARTIFACT`. A successful fresh verification clears the state; a button or remote claim cannot bypass it. If the core is unavailable, shared/public surfaces and privileged operations remain unavailable rather than falling back to best effort.

Hosts should provide secure file and monotonic-storage adapters. A software-only rollback store is reported as such and must not be presented as hardware-backed protection.
