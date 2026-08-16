# Backup and recovery

Keystone backup is a local, encrypted export for recovering an installation without a central account or cloud service. It is a portability boundary, not a network sync protocol.

## Container

The Phase 28 container is `keystone.backup` version 2. The outer manifest contains only:

- format/version;
- creation time;
- approximate encrypted payload size;
- included section names;
- whether cache was included.

The manifest is authenticated as AEAD associated data. The payload is encrypted with libsodium XChaCha20-Poly1305-IETF. A recovery secret is supplied through the host’s explicit recovery boundary and is never written to the backup, manifest, logs, or inspection result. Identity master-seed material is present only inside the authenticated ciphertext so a restored installation can derive the same Identity.

Wrong secrets, modified manifests/ciphertext, invalid versions, and truncated files fail before a restore target is touched. Restore targets stage into temporary state and commit atomically.

## Sections and policy

The default policy includes identity/security, application state, user-owned media metadata/references, settings, social graph, conversations, Communities, private-Community encrypted state, media metadata, library/playlists, notifications, and pinned/storage references. Temporary cache/chunks are excluded by default because they can be fetched again through the content-addressed P2P layer.

Hosts may select four independent policy switches:

| Policy | Meaning |
| --- | --- |
| `identitySecurity` | Identity seed (inside ciphertext), trusted devices and security events |
| `applicationState` | Settings and durable social/application stores |
| `userOwnedMedia` | User-owned files and media references |
| `cache` | Temporary cache/chunks; opt in only when useful |

Private-Community state is exported as the existing encrypted-at-rest records. No plaintext group key is added to the backup API. Recovery does not publish local read/unread state, settings, or cache to peers.

## Recovery flow

1. The host asks the user to create or enter the recovery secret in a secure boundary.
2. The host writes/reads the `.keystone` bytes using a user-selected local destination.
3. Keystone inspects the manifest without revealing private content.
4. Restore decrypts and validates all sections, then stages an empty profile.
5. The host commits the staged state and derives the existing Identity from the recovered seed.

The old installation should be revoked from the recovered device list after the new installation has connected. A lost device is not automatically erased by a backup operation; device revocation remains an explicit signed Devices action.

## Non-goals

There is no mandatory cloud backup, central account recovery, telemetry, payment, advertising, marketplace, or server-side media cache. Media bytes are optional user-owned data; excluding cache does not remove the content-addressed references needed to retrieve them over P2P.

The core implementation is `packages/core/src/sync/backup-recovery.ts`. The older cold-backup API remains unchanged for existing Yjs/config archives.
