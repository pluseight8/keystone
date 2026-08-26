# Files

Keystone files are signed `file_object` objects backed by the existing content-addressed manifest/chunk protocol. A FileObject contains filename, MIME type, byte size, ciphertext/content ID, owner, uploader, optional description and visibility. `owner` and `uploader` are deliberately separate: importing on a device does not rewrite declared ownership.

The object is the canonical reference. Direct messages, group conversations, Communities, Profiles and share actions carry the same `file_object` ID (and, where an attachment is needed, the same ID alongside its `keystone://content/...` URI). They never create media copies. `FileReplicationService` exchanges the signed object only; bytes remain in the generic provider layer.

## Import and transfer

`FileService.import` writes bytes once to a host-provided `WritableFileContentStore`, creates a manifest and derives a deterministic FileObject ID from canonical metadata. Re-importing identical bytes and metadata returns the same ID. `FileTransferManager` and the generic `DistributedContentService` resume from verified cached chunks, use bounded workers, ask the provider directory again on each chunk, and reject a chunk unless its SHA-256 matches the manifest. A provider can disappear between chunks without invalidating already verified data; the high-level delivery still goes through ConnectivityFabric.

The UI can observe `idle`, `downloading`, `paused`, `complete`, `cancelled` and `failed`, plus progress, provider IDs and the availability state:

- `AVAILABLE LOCAL` — every manifest chunk is present and verified locally;
- `AVAILABLE REMOTE` — no local chunk, but at least one provider is currently known;
- `PARTIALLY AVAILABLE` — some chunks are local and providers are known;
- `UNAVAILABLE` — the manifest is known but no provider is currently available;
- `DOWNLOADING` — an active bounded transfer is running.

These are observations, not a promise that a peer will remain online. Pause/cancel retain verified chunks; resume/retry uses the same FileObject and content ID. Multiple providers may be used per file and per chunk. Corrupt data is discarded and another provider is tried.

## Private files

Private/community files must be encrypted before import. `FileEncryptionAdapter`
is the host boundary for `PrivateCommunityService.encryptAttachment`; Keystone
stores and transfers ciphertext with epoch/key/nonce metadata and never
publishes private FileObjects through public discovery. A plaintext hash is
therefore not used as the public content ID. Decryption stays in the existing
private-content path; this layer does not implement a second cryptosystem.

No central file server or cloud requirement is involved. Native file previews/decoders remain host boundaries and must validate MIME/container data independently.
## File containment

Network/browser/shared bytes are quarantined before a FileObject is materialized as a user file. See `untrusted-content.md`, `file-quarantine.md` and `file-risk-model.md` for the bounded lifecycle and owner-release boundary.

## Device handoff

Device Continuity sends a bounded FileObject/content reference, filename and
safe metadata only. It never embeds file bytes, executable paths or an
unbounded serialized file. The receiving host resolves the reference through
the existing permission and `DistributedContentService` boundaries;
content availability remains a local observation and a handoff does not grant
file access by itself.

## Shared Folders and distributed drive

`SharedFolderService` is the local-first canonical state machine for folders,
entries, revisions, memberships, invitations, Drop Zones and conflicts. Folder,
entry, file and revision IDs are stable references; rename and move do not
change identity. Revisions are immutable and retained so offline edits can be
compared and restored instead of being silently last-write-wins.

Shared Folders do not introduce Drive, a central file server, S3, IPFS, a global
metadata service or a second content store. `ContentCacheFolderContentStore`
wraps the existing `ContentCache`; `DistributedContentFolderDelivery`
uses manifest/chunk delivery for authorized on-demand reads. A content
hash/content ID is an integrity locator only: it never grants authorization.
Folder membership, signed changes and the current epoch remain the authority.

Roles are explicit: VIEWER reads, CONTRIBUTOR creates/uploads, EDITOR also
edits, and OWNER manages membership and destructive actions. A Drop Zone is
upload-only; an uploader receives a bounded receipt and cannot enumerate the
folder or discover the resulting private file ID. Private content is not
stranger-cacheable merely because a hash is known. Personal Device Mesh
placement is a separate owner-device authority from social collaborator
sharing. Metadata-first, on-demand and explicit Keep on device are the normal
placement modes. Revocation blocks future authorized retrieval after the new
epoch is observed; bytes already downloaded are not falsely wiped.

Desktop filesystem sync is an explicit owner-selected native binding. The
NativeHost exposes only relative, bounded operations and coalesced watcher
events; it does not expose an absolute path to Core/UI, scan a home directory,
follow symlinks, or turn a path into authority. Initial import, materialization,
local-delete propagation and baseline conflict detection are explicit. Mobile
uses a document picker or app storage and does not promise an arbitrary
background folder watcher on iOS/Android. Files are data: no auto-run, extract,
AI/memory ingestion, publication or plugin execution is implied.

## Documents and Reader

`DocumentService` is a projection over this canonical File layer. PDF, EPUB,
Markdown and plain text readers use the FileObject ID and immutable content
revision; `ContentCacheDocumentFileSource` reads bytes from the existing
ContentCache. Document metadata, progress, annotations, OCR results and search
indexes are bounded derived state and never a second byte store. Scanner export
creates a new private File through `FileServiceDocumentWriter` and never
mutates the source Photo/File; private writes require caller-provided encrypted
content metadata.

The Reader verifies size and content hash before opening. It can read an
authorized locally cached File offline, without a cloud or central document
server. Desktop and Mobile receive only typed document projections and safe
render results; paths and ambient filesystem access remain outside the UI. See
[Documents and Reader](documents.md).
