# Safety Invariants

The `pnpm test:security` suite establishes the first system-wide invariants:

- unclassified shared/public content cannot enter a protected surface;
- sender-provided `SAFE` claims cannot override recipient policy;
- safety decisions never destroy personal data;
- no generative model is required for baseline safety;
- local AI, remote Agents and Skills cannot disable mandatory policy;
- blocked content cannot reappear through a protected index;
- a safety token grants no capability;
- changing content bytes invalidates a previous token.

Malformed classifications, Unicode/zero-width input, forged attestations, stale tokens, oversized data, replayed behavior and prompt-injection-like content are rejected or quarantined without uncontrolled exceptions.

The mandatory local boundary before privileged runtime is the release-signed Immutable Core. No trusted startup stage or privileged operation exists without a verified manifest, critical-file hashes, mandatory policy references and rollback decision. A critical mismatch enters SecurityLockdown; mutable user data is intentionally outside the release integrity root.

The zero-trust protocol boundary ensures that remote bytes are bounded and schema-validated before any consumer sees an envelope; signatures are domain-separated; replay, stale revisions, tombstones, epochs and state transitions are monotonic; protocol/crypto downgrade is rejected; and the local NetworkResourceGovernor bounds unknown-peer impact. Protocol validation never replaces the mandatory SafetySurfaceGate.

The malware/untrusted-content boundary ensures that incoming bytes are bounded and quarantined before materialization; actual type evidence is checked independently of extension/MIME; archives have expansion, path, symlink and recursion limits; media/document decoders are typed host boundaries; scanner/parser failures remain unknown/quarantined; previews are derived non-active artifacts; and only a fresh explicit owner intent can release an exact hash. `CLEAN` never grants execution authority, and no received content is opened, installed or executed automatically.
