# Shared Spaces

Shared Spaces are local-first P2P workspaces built on the existing Keystone transport, identity and Yjs CRDT primitives. A space has one signed `SharedSpace` object and one durable Yjs document; documents, notes, task lists/tasks, file references, links, comments and explicit shared context are maps in that document. Chat, Communities and Agent Rooms can reference the same object IDs without copying media or private Memory.

## Membership and agents

Membership and role changes are signed by the space owner and checked in core. Built-in roles are owner, admin, editor, commenter, viewer and agent, with granular permissions. An Agent Visit or Agent Room never grants workspace access. A host must issue a separate `SpaceAgentGrant` with an expiry, use limit and explicit permissions; revocation is checked on every operation.

## Offline and restart

Typed mutations update Yjs locally, queue signed updates when a peer is offline, and flush them after reconnect. Sync requests exchange a state vector/update, so independent peers converge without a central server. Snapshots contain the Yjs state, signed-space metadata, replay markers and bounded pending queue. `PersistentSharedSpaceStateStore` encrypts the snapshot at rest with the local device encryption key.

## Private spaces

Private spaces use recipient-wrapped libsodium `crypto_box` epoch keys and XChaCha20-Poly1305 ciphertext for metadata and CRDT updates. Join, leave, kick, ban or device revocation rotates the epoch. A removed device receives no new key; old ciphertext is not re-labelled as forward secrecy. Private metadata is not sent through public discovery. The protocol is deliberately not called MLS, Double Ratchet or forward secrecy.

## Explicit sharing

`shareWithSpace` accepts only `PUBLIC` or `USER_EXPLICIT` data classes and records a source ID/provenance. `PRIVATE` and `SECRET` are rejected before serialization. Memory, DMs, files and social graph state are never read implicitly by this layer. A file attachment is a `WorkspaceFileReference` to an existing `FileObject`/content URI, not a new media copy.

The mobile Spaces screen is a host-neutral projection of the service. Native hosts install the authenticated transport, encrypted durable store and policy boundary; the UI does not handle keys or infer private context.
