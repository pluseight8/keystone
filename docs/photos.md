# Photos & Personal Media Library

Photos is Keystone's private, local-first library for owner-selected images
and videos. It is a metadata index and policy surface over the existing
content-addressed storage boundary. It is not a cloud photo service, a second
blob store, an automatic camera-roll uploader, or a public media cache.

The current implementation is part of Release 0. The canonical code surface is
[`packages/core/src/media-library.ts`](../packages/core/src/media-library.ts).
The desktop and mobile surfaces are typed host projections:
[`desktop-photos-runtime.ts`](../apps/desktop/src/desktop-photos-runtime.ts) and
[`photosRuntime.ts`](../apps/mobile/src/photosRuntime.ts).

## Product contract

The owner can explicitly select files, a folder, a mobile camera-roll scope, or
an optional watched-folder scope. Imports are bounded, resumable at the job
boundary, and reported per item. An import is not visible as an asset until
its signature, metadata, content hash and content manifest have been verified.
Folder failures do not roll back successful items and do not hide the failure.

The library provides:

- a paginated, virtualizable timeline grouped by year/month/day;
- private albums containing media references, favorites, tags, captions and
  local search over filename, title, caption, tags, date, kind and basic camera
  metadata;
- bounded thumbnails, previews, video frames and edit renditions;
- metadata/EXIF display and an explicit embedded-GPS map projection;
- device placement with metadata-first, thumbnail, and explicit-original modes;
- explicit sharing to Messages, Contacts, Spaces, Nearby, an owned device or
  Personal Web;
- trash, restore and owner-confirmed permanent deletion with tombstones; and
- optional non-destructive image recipes such as rotate and crop.

Albums are references, not copies. Shared-album state may carry references and
comments through the existing collaboration boundary, but image/video bytes do
not enter CRDT state. A public publication is a separate explicit action and must
use an intentional rendition.

## Storage and identity

`MediaAsset` contains a `ContentId`, bounded metadata, filename, local state,
tags and source-selection identifier. It never stores original bytes, absolute
paths, camera-roll handles or a `hidden` boolean. Original bytes are imported
through the existing `ContentManifest`/content store with the private
cache policy `PRIVATE_NO_STRANGER_CACHE`.

Exact SHA-256 content identity is the duplicate key. Renaming or selecting the
same bytes again produces `DUPLICATE`; perceptual similarity is not silently
treated as a duplicate. Derivatives have their own content identity and are
keyed by source content hash, derivative kind, recipe version and recipe hash.
They are bounded and disposable: a missing or corrupt derivative is
regenerated, while the original remains unchanged.

The state store persists assets, import jobs, albums, derivatives, placements,
watched-folder state and deletion tombstones. Hydration validates schema and
limits before accepting records. Non-terminal jobs are recovered as failed;
no half-imported asset is exposed. A tombstone prevents stale device metadata
or a delayed content message from resurrecting permanently deleted media.

## Host and import boundary

The host owns the native picker and creates a scoped `MediaImportSource` only
after an owner action. `NativeFileSystem` handles are read through typed
capabilities; filesystem paths do not cross the core/UI projection. A watched
folder is an explicit opt-in and can be stopped without deleting imported
assets. Keystone never scans the home directory, a disk, or a complete camera
roll without a concrete owner-selected scope.

The mobile camera-roll boundary is typed and explicit. There is no background
camera-roll upload. Browser downloads, Files actions, drag-and-drop, mail
attachments and Nearby objects enter the library only through an explicit
owner action. A host may report camera import as unavailable without changing
the private core contract.

## Metadata and location privacy

Embedded EXIF/container metadata is untrusted and bounded. The safe probe may
record dimensions, duration, orientation, capture time, camera make/model and
embedded coordinates. GPS stays in media metadata; it is not passed to
`LocationService`, route scoring, movement history, Home/Work inference or a
routine profile. No external reverse geocoder is implicit.

Reading metadata locally does not require a location permission. Showing a map
projection is a separate explicit owner action. Before sharing media with
embedded GPS, the destination must receive a separate location decision. A
metadata-stripped export is an optional derivative/copy; the original and its
embedded metadata remain preserved locally. Search, ordinary thumbnails and
notifications omit Vault-locked media until the existing Vault policy allows
visibility.

There is no face/person recognition, automatic captioning, OCR requirement,
nostalgia notification, movement inference or silent AI processing. If a future
Local AI adapter is enabled, it may operate only on explicitly selected local
data and may not publish, share, delete, change privacy, identify a person or
call an external provider implicitly.

## Derivatives and editing

There is one production decoder path: `MediaLibraryService` uses the typed
`MediaDecoder` contract, `NativeHostMediaDecoderAdapter` requests the scoped
`media.decode` capability, and `NativeHost.media()` owns the platform runtime.
On the current Omarchy (Arch Linux-based distribution) host,
`LinuxNativeMediaHost` invokes already available `identify`/ImageMagick and
`ffprobe`/`ffmpeg` processes directly with structured arguments, stdin bytes,
`shell:false`, bounded input/output, timeout, cancellation and a bounded
process queue. Core imports none of those tools and no decoder path makes a
network request.

Image metadata and PNG thumbnail/preview generation, plus MP4/WebM metadata
and one PNG video frame, are runtime-verified through the production adapter.
Generated output is reopened and checked for type, size and dimensions before
it enters the canonical private content store. The original is read-only
and remains byte-for-byte unchanged. Unsupported hosts preserve the original
and return an honest unavailable/unsupported result; the deterministic adapter
in core is an explicit controlled-test input and is never a production
fallback.

Image editing is recipe-based and non-destructive. A recipe is versioned and
can be reverted by selecting the original; an edited export is new content.
The Release 0 minimum is rotate/crop where the host tooling supports it.
Destructive writes to the original are not part of the contract. Video editing
is not required for this release.

## Devices, sharing and publication

Placement reuses Personal Device Mesh, Distributed Content and Continuity.
Metadata and a thumbnail may arrive before the original.
Original transfer is explicit, reports `PENDING`/`UNAVAILABLE` honestly, and
must not silently start a large transfer over a metered route. Revocation and
offline state are host/runtime decisions, not an excuse to show an original as
available.

Copy, album/reference access, owned-device placement and publication are
different operations. Messages, Nearby, Contacts and Spaces receive only the
selected asset after owner confirmation. Personal Web accepts only an
intentional non-original rendition and only that rendition may carry
`PUBLIC_CACHEABLE`; a private original is never made public by its hash.
External copies already delivered to another person or device are not erased
by local trash or permanent deletion.

## Security boundary

The import and decoder boundary rejects fake extensions, signature/MIME
mismatches, truncated headers, malformed metadata, path traversal names,
symlink/path leakage, giant dimensions, metadata bombs, invalid coordinates,
polyglot-like ambiguity and corrupt derivative output. Content and chunk hashes
are checked by Distributed Content before a remote original is accepted. A content hash is an
identity/integrity value, not authorization.

Private originals cannot enter a stranger/public cache. A remote metadata
projection cannot create a blob, bypass Vault visibility, enumerate pages,
revive a tombstoned item, or grant a plugin, browser page, agent or external AI
access. Plugins may provide a narrow picker/decoder/provider capability only
when the owner enables it; they do not receive the full library or arbitrary
filesystem access.

## Validation and evidence

The dedicated media gate is:

```sh
pnpm test:media
```

The scale suite covers 100,000 metadata records, large album references,
bounded search and derivative state. Integration covers two same-owner service
instances, metadata-first placement, preview/original fetch, offline state,
revocation and explicit Messages/Nearby/owned-device/Personal Web selection.
The broader `test:network` gate continues to exercise the real
Hyperswarm/Noise/Fabric foundations; the media-specific service integration is
controlled/hybrid evidence and is not mislabeled as a physical second-device
media proof.

Evidence uses these meanings:

| Surface | Current evidence | Classification |
| --- | --- | --- |
| Safe signature/metadata probe | Core implementation and tests | `IMPLEMENTED` |
| Host small image/video tools | `identify` and `ffmpeg`/`ffprobe` passed on the current host | `RUNTIME_DETECTED` |
| Production Keystone decoder adapter | `MediaDecoder` → `NativeHost.media()` → bounded Linux process adapter | `IMPLEMENTED` |
| Real PNG/JPEG metadata and image derivatives | Production `MediaLibraryService` path; derivative reopened and validated; original hashes unchanged | `PHYSICALLY_VERIFIED` (same-host runtime) |
| Real MP4/WebM probe and video frame | Production `MediaLibraryService` path; duration/dimensions/frame verified; original hashes unchanged | `PHYSICALLY_VERIFIED` (same-host runtime) |
| Android/iOS camera-roll hardware | Not attached to this validation workspace | `UNAVAILABLE` |
| Public/private publication boundary | Controlled rendition proof and policy tests | `IMPLEMENTED` |

The current development/validation distribution is **Omarchy (Arch
Linux-based distribution)** with Node v22.23.2, pnpm 9.15.0 and package engine
`>=22 <23`. Platform-specific package or desktop assumptions are not inferred
from this host; Keystone remains platform-neutral. Production release checks
still require owner-supplied updater and Expo credentials where applicable.
