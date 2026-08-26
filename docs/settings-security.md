# Settings security

Settings are local mutable user state, but their mutation authority is not mutable configuration. The immutable core authenticates the settings authority version and MandatoryPolicyRoot before privileged startup. User preferences may become stricter, never weaker than the mandatory roots.

Every AI settings action records metadata only: actor, class, risk, request id, decision, confirmation and timestamp. Plaintext prompts, private values and key material are not written to the audit log by default. `REMOTE_AGENT` is denied, stale/replayed owner requests fail closed, and a security/immutable policy change cannot be smuggled through a plugin namespace.

The mobile and desktop Security surfaces show build status, startup stage, policy/rollback epoch and minimal lockdown diagnostics. Recovery buttons call host-provided verification/repair boundaries; there is no “ignore and continue” control.
