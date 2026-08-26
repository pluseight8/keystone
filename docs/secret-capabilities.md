# Secret capabilities

`SecretCapabilityService` issues opaque, short-lived grants. Each grant names one handle, caller, scope, operation set, optional target, expiry and maximum uses. Unknown, replayed, expired, exhausted or revoked grants are rejected.

Typed signing, derivation, encryption/decryption, provider authorization and browser autofill use separate operations. Sensitive export requires a fresh owner-confirmed `RecoveryExportIntent`; recovery phrases and private keys never enter model prompts, tool results, agent history, URLs, clipboard or regular persistence.

Skills and tools receive only declared capabilities. A provider adapter may receive a short-lived credential capability for its own authorization header, while the model receives neither the credential nor the handle value.

Export policy is explicit: identity/device/provider material is `NON_EXPORTABLE` or `SCOPED_USE_ONLY`; only recovery flows can opt into `OWNER_EXPORT_WITH_STRONG_CONFIRMATION`. Recovery import and export intents are one-use, expiring and owner-bound.
