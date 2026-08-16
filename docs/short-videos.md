# Short videos (Phase 9)

Русский обзор: [музыка, видео и короткие видео](ru/social-media.md#музыка-видео-и-короткие-видео).

`ShortVideo` is a signed vertical-video object, not a separate media backend. It references an existing Video identity, generic content URI, and optionally the original Track object used as audio. A client can therefore open the Track from a short and later find shorts through graph indexing without duplicating the media.

`ShortFeedController` uses the existing range-aware Video stream adapter to buffer the current short and prefetch the next one. Feed ranking, reactions/comments UI, and public discovery remain later graph/discovery work; the controller has no recommendation server dependency.
