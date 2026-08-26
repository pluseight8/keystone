# Private Communities and group encryption

The private-community implementation adds an encrypted path for `private` and
`contacts` Communities. The existing public Community path and Hyperswarm/Noise
transport are unchanged. Public replication continues to reject non-public
Communities unless this private protocol is explicitly used.

## Protocol boundary

Private Community payloads use libsodium's XChaCha20-Poly1305-IETF AEAD. Every ciphertext authenticates the protocol name, Community ID, epoch and key ID as additional data. Per-device epoch keys are wrapped with libsodium `crypto_box` using the existing Identity device encryption keys. Community objects, membership objects and transport envelopes retain Keystone's Ed25519 signatures and canonical JSON validation.

This is an explicit Keystone group-key protocol. It is not MLS, Double Ratchet, or a claim of forward secrecy. A single symmetric key is active for one epoch; the owner creates a fresh random key on every membership/device change. Old keys are discarded from the durable state once the next epoch is installed. A compromised active member can still read data that was sent while that member was authorized; the protocol does not make that trust assumption disappear.

## Epoch and membership rules

- Epochs start at 1 and advance exactly one step for join, leave, kick, ban, unban and device revocation.
- A key update is signed by the Community owner, contains the previous epoch, the complete active device set and one recipient-bound encrypted key.
- A receiver rejects gaps, replays, old epochs, unknown actors, changed device encryption keys and invalid signatures.
- A new member receives the current epoch only (`historyPolicy: current-only`); old message ciphertexts are not sent in the bootstrap.
- A removed or revoked device receives no new key update and therefore cannot decrypt later epochs. It may retain data it already decrypted before removal.
- A member-authored leave is a signed leave event delivered directly to the owner; the leaving device locally revokes its private state and the owner rotates the next epoch.
- Device identities are the existing cryptographic `NodeId` values. Multiple devices can be members independently and each receives its own wrapped key.

Invites and join requests are encrypted directly to the named device and carry only the minimum bootstrap (signed Community/invite/configuration objects). They are not indexed by public discovery. Private Communities are excluded by the existing discovery, search and RAG visibility filters.

## Messages and attachments

Community events are signed Keystone objects inside an AEAD payload. The outer envelope is still authenticated by the normal transport security layer, but a relay sees only ciphertext, epoch/key metadata and unavoidable network metadata. A duplicate nonce is durably rejected.

Attachments are encrypted before `ContentManifest` creation. The content-addressed ID and chunk hashes therefore identify ciphertext, not plaintext. An `encryptedContent` message reference carries the epoch/key ID and nonce needed by an authorized device; corruption or a mismatched ciphertext hash fails closed.

Private state is stored through the host `EncryptedSocialStateStore` and encrypted again with a key derived from the local device encryption key. Losing that key material makes the private state intentionally unreadable; there is no plaintext fallback or central recovery service.

## Limitations and privacy

The protocol provides authenticated membership changes and current-epoch confidentiality, not a central membership registry, cloud backup or analytics service. Network peers can still observe normal routing metadata. Private Community metadata is never sent through the public Community replication or public discovery protocols. Contacts-only support uses the same encrypted path; public Communities retain their existing clear signed-object behavior without unnecessary encryption overhead.
