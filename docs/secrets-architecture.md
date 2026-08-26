# Secrets architecture

Keystone treats system-managed secrets as capabilities, never as application data. `SecretClass`, risk, lifetime, scope, origin, access mode and export policy are explicit metadata. A `SecretHandle` is opaque and contains no key bytes.

`SecureSecretHost`/`SecureSecretStore` are the only boundaries allowed to generate, persist, rotate, revoke, derive, encrypt or decrypt secret material. Platform adapters must report their actual level (`HARDWARE_BACKED`, `OS_PROTECTED`, `APPLICATION_ENCRYPTED`, `MEMORY_ONLY` or `UNAVAILABLE`); the test/development host reports `MEMORY_ONLY` and is not evidence of hardware protection.

Capabilities are caller-, operation-, target-, expiry- and use-scoped. Revocation and expiry fail closed. `SecretRedactionPolicy` is applied before logs, audits, crash reports, agent history, tool results, Memory, RAG and persisted AI state. Raw system secrets are not valid shared/public content.

`CrashReportRedactor`, `SecureLoggerBoundary` and the typed `SecureClipboardBoundary` are host boundaries: clipboard writes require a fresh owner-confirmed intent and optional bounded auto-clear; clipboard is never a secret store. `SecretInventory` exposes metadata and currently allowed operations only. Device signing uses a separate `DeviceKeyHandle`/`DeviceSigningCapability` target scope.

User-created files that happen to contain a secret are ordinary private content and remain subject to the existing content/privacy policy; they are not silently promoted into the system secret store.
