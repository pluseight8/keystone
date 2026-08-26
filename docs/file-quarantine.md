# File quarantine

All received FileObjects, browser downloads and completed P2P transfers must cross a `FileContainmentService`/typed host boundary before normal file release. It records source identity, object/transfer IDs, hash, declared metadata, generated quarantine path and a `ContentProvenanceChain`.

The state machine is fail-closed:

`RECEIVING → QUARANTINED → INSPECTING → INSPECTED → PREVIEW_ELIGIBLE → OWNER_RELEASED`

Failures remain `TRANSFER_FAILED`, `INSPECTION_FAILED`, `BLOCKED` or `KNOWN_MALICIOUS`. Restart never converts an in-progress scan to clean. A release requires a fresh `OwnerRequestedFileReleaseIntent` bound to the exact object ID and content hash, a live expiry, owner identity and risk acknowledgement for executable/high-risk content. Agents, Skills and plugins cannot release it.

`UserReleasedFileObject.executableAuthority` is always false. A future native launcher would need a separate explicit host capability and confirmation boundary.

The containment facade exposes an owner release service only when the native
host binds the current owner Identity ID at construction time. A caller cannot
turn an arbitrary `ownerIdentityId` field into release authority.

The real Hyperswarm suite includes a synthetic malicious peer that signs an image-labelled PE fixture. Bob receives the same FileObject ID, verifies the content hash, keeps the bytes quarantined, classifies the mismatch as critical and produces no preview. No executable or exploit payload is used.
