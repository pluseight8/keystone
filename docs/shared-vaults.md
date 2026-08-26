# Shared Vaults

`SharedVaultService` reuses `VaultService`, Yjs and the existing authenticated
Transport. A Shared Vault has generic identity/device membership and scoped
permissions: VIEW, EDIT, CREATE_NOTE, DELETE_OWN, DELETE_ALL, MOVE,
MANAGE_ATTACHMENTS, MANAGE_CANVAS, INVITE, REMOVE_MEMBER and
MANAGE_PERMISSIONS.

Private/contacts content is encrypted before replication. Membership changes
advance a `SharedVaultKeyEpoch`; stale epochs, revoked identities, malformed
objects, replayed events and oversized payloads fail closed. `CURRENT_STATE_ONLY`
is the default history policy. `SHARED_HISTORY` is rejected unless the host
provides an authenticated encrypted persistence boundary.

On join/leave/kick/ban/device revocation, the next epoch key is wrapped to each
currently authorized device with its encryption public key. A member without a
known device key cannot trigger private replication; this is fail-closed. The
membership record and epoch are signed, and revoked members receive neither the
new key nor future encrypted updates. Pending authenticated envelopes are kept
for reconnect and deduplicated on receipt.

Only notes explicitly created or received through a given Shared Vault are
indexed for that Vault. A local note from another Vault cannot leak through the
Shared Vault or UnifiedContext adapter. Shared Canvas projections use the
existing typed `CanvasMutation` model and are persisted as bounded derived
state; the Markdown/Vault files remain the recovery anchor.

Attachment sharing is reference-based. Public Vaults may carry a normal
content reference; private Vaults require an explicitly encrypted/opaque
content ID before the reference can leave the local process. The plaintext
content hash is not substituted into private replication.

Shared Vault does not publish private metadata to public discovery, Memory,
messages, Files, Calendar, Spaces or Agents. Agents can receive only explicit
shared references through existing ToolPolicy/confirmation boundaries.
