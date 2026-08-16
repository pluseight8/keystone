# Messaging attachments (Phase 6)

Русский обзор: [контент и вложения](ru/social-media.md#контент-и-вложения).

An attachment message contains signed metadata only: a `keystone://content/sha256-…` URI, name, claimed MIME type, byte length and, for Phase 26 files, the canonical `file_object` ID. The URI points to the single generic content object from Phase 5, so sending the same file in several chats or communities does not create copies of the blob or a feature-specific transfer protocol.

`AttachmentTransferController` resolves a manifest and voluntary providers through an injected directory, then delegates to the verified resumable `ContentFetcher`. It emits `idle`, `downloading`, `complete`, `cancelled`, and `failed` states for host UI; retry restarts from verified cache chunks. The message envelope itself only holds encrypted metadata and never carries file bytes.

The current mobile renderer displays attachment metadata. Native host composition must inject the provider directory and cache policy before exposing download/cancel/retry controls. MIME data remains untrusted and no received file is executed. See [Files](files.md) and [Storage](storage.md) for FileObject lifecycle, provider availability and quota/pinning policy.
