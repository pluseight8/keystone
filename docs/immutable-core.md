# Immutable Core and trusted startup

Keystone verifies its release-signed security core before any privileged runtime starts. The immutable boundary covers the integrity bootstrap, release/update verifier, MandatoryPolicyRoot, Safety/ToolPolicy roots, AI egress constraints, protocol validators, crypto profile, capability enforcement, sandbox boundary, quarantine enforcement and settings authority.

The host supplies a `ReleaseTrustRoot` containing a key identifier and public verification material. Release private keys are never bundled in Keystone. A typed `IntegrityManifest` records release/build/platform/architecture, creation time, minimum policy epoch, security profile, verifier version, policy/protocol references and per-file hash/size/trust class/required entries.

The immutable boundary also locks the secret policy: no secret export,
private-key unlock, provider credential use or typed signing is available while
the core is in lockdown. Model/Skill/plugin claims cannot open the secret host.

Startup is monotonic:

`UNVERIFIED → MANIFEST_VERIFIED → CORE_FILES_VERIFIED → POLICY_VERIFIED → ROLLBACK_VERIFIED → TRUSTED_CORE_READY → PRIVILEGED_RUNTIME_READY`.

Missing trust material, an invalid signature, critical hash/size mismatch, policy/protocol mismatch, incompatible security profile or rollback rejection enters `SecurityLockdown`. Mutable user state (Vault, chats, calendar, files, agents, Skills, plugins, models and caches) is not part of the release manifest unless a separately signed package explicitly says so.

The software rollback store is integrity checked but is not claimed to be tamper-proof. Production hosts should implement the optional secure monotonic `seal`/`verify` boundary and set `requireSecureMonotonicStorage` where rollback resistance is required.

Development builds must explicitly use development mode and are shown as `DEVELOPMENT_BUILD`; they are never treated as `OFFICIAL_VERIFIED`. A peer's `official=true` field or claimed build signature has no authority over local protocol or security decisions.

`IdentitySecretAccess` exposes only a typed signing capability after `TRUSTED_CORE_READY`; private key material is not returned to agents, models, Skills or plugins. Tool execution can also be bound to the immutable core and is denied while the core is locked.
