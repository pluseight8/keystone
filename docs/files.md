# Files (Phase 26)

Keystone files are signed `file_object` objects backed by the existing content-addressed manifest/chunk protocol. A FileObject contains filename, MIME type, byte size, ciphertext/content ID, owner, uploader, optional description and visibility. `owner` and `uploader` are deliberately separate: importing on a device does not rewrite declared ownership.

The object is the canonical reference. Direct messages, group conversations, Communities, Profiles and share actions carry the same `file_object` ID (and, where an attachment is needed, the same ID alongside its `keystone://content/...` URI). They never create media copies. `FileReplicationService` exchanges the signed object only; bytes remain in the generic provider layer.

## Import and transfer

`FileService.import` writes bytes once to a host-provided `WritableFileContentStore`, creates a manifest and derives a deterministic FileObject ID from canonical metadata. Re-importing identical bytes and metadata returns the same ID. `FileTransferManager` resumes from verified cached chunks, uses at most the configured worker count (default three), asks the provider directory again on each chunk, and rejects a chunk unless its SHA-256 matches the manifest. A provider can disappear between chunks without invalidating already verified data.

The UI can observe `idle`, `downloading`, `paused`, `complete`, `cancelled` and `failed`, plus progress, provider IDs and the availability state:

- `AVAILABLE LOCAL` — every manifest chunk is present and verified locally;
- `AVAILABLE REMOTE` — no local chunk, but at least one provider is currently known;
- `PARTIALLY AVAILABLE` — some chunks are local and providers are known;
- `UNAVAILABLE` — the manifest is known but no provider is currently available;
- `DOWNLOADING` — an active bounded transfer is running.

These are observations, not a promise that a peer will remain online. Pause/cancel retain verified chunks; resume/retry uses the same FileObject and content ID. Multiple providers may be used per file and per chunk. Corrupt data is discarded and another provider is tried.

## Private files

Private/community files must be encrypted before import. `FileEncryptionAdapter` is the host boundary for Phase 25's `PrivateCommunityService.encryptAttachment`; Keystone stores and transfers ciphertext, with epoch/key/nonce metadata, and never publishes private FileObjects through public discovery. A plaintext hash is therefore not used as the public content ID. Decryption stays in the existing private-content path; this layer does not implement a second cryptosystem.

No central file server, CDN, cloud requirement, DRM, advertising, payment or marketplace is involved. Native file previews/decoders remain host boundaries and must validate MIME/container data independently.
