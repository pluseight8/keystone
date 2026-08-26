# Video

Русский обзор: [музыка, видео и короткие видео](ru/social-media.md#музыка-видео-и-короткие-видео).

`Video` is one signed Keystone object with title, description, creator Profile reference, thumbnail/cover, duration, dimensions, container/codec/audio stream metadata, publication time, visibility, generic content URI, and optional Track/Community references. Chat, Community, Profile, Feed, comments and reactions refer to this same Video ID; they never create media copies.

`VideoService.import` writes local bytes to `VideoContentStore`, creates a content manifest and a deterministic Video ID from canonical metadata and the media URI. Re-importing identical input returns the original object. `VideoReplicationService` sends public, independently signed Video objects over the existing signed transport. Direct messages and community posts carry only the Video ID. Contacts/private replication remains fail-closed until encrypted generic-object replication exists.

`VideoPlaybackSource` verifies and fetches only the time/range-relevant manifest chunk, allowing a decoder to start before complete download, resume after interruption, and seek without trusting provider bytes. `ContentCache` provides quota, pinning and verified reuse. `VideoPlaybackController` stores progress, last position, completion and bookmark state only locally; this data is never replicated.

`VideoProcessingAdapter` is a local-first host boundary for preparation/transcoding. Renditions may be described as `source`, `1080p`, `720p`, `480p` or `custom`; preparation remains host-provided and no central transcoding or recommendation backend is required. Native/browser decoders remain responsible for MIME/container safety.

Views, reactions, comments, follow-based discovery, adaptive rendition selection, and publish UI remain subsequent slices. Rendering and MIME/container decoding are native/browser trust boundaries and must validate received media independently.
