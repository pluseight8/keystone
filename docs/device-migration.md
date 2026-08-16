# Device migration

Device migration is an explicit local workflow:

`Old installation → encrypted Keystone backup → New installation → revoke old device`

The new installation starts with an empty durable profile. It imports the backup through the RecoverySecretBoundary, validates the authenticated manifest/payload, stages the stores, then commits them. The recovered master seed is used by the existing IdentityManager; no new user Identity is created.

Restored state includes the profile/security identity, trusted-device records according to the host policy, settings, social graph, direct/group conversations, Communities, private-Community encrypted records, media metadata, playlists/library, local notifications/read state, and pinned/user-owned content references. Temporary cache and partial chunks are normally omitted and can be reacquired from P2P providers.

After the first successful connection, the owner signs a device revocation for the old installation. A revoked device cannot submit privileged events; peers continue to verify signatures and device authorization in the existing Devices service.

The recovery path does not copy private keys into an inspection manifest, does not upload backups to a server, and does not publish local settings/read state. The recovery secret is handled only by the host UI/keychain boundary and is never serialized into the backup.

The production network suite covers this sequence with independent Alice/Bob processes: the old Alice process is stopped, its durable directory is moved aside, a fresh Alice process restores from the encrypted bytes, sends a new signed message to Bob under the same Identity, restores private-Community epoch state/settings, and rejects a privileged event from the revoked device.
