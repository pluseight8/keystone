# Shorts

Shorts are not a second media system. `ShortVideoService` creates a normal signed `Video` object with a small `shortForm` payload (`caption`, `aspectRatio: 9:16`). The Video ID, media URI, manifest, cache entry and durable Video state are shared by feed, chat, communities and the Video page.

`buildShortFeed` is a local deterministic projection over already-known public Videos. It filters private videos and blocked creators, then ranks by follows, joined-community relevance, local interactions and recency. There is no central recommendation, analytics or ranking service. A host can later replace this scorer with a local model without changing object or transport contracts. `ShortVideoService.forTrack` finds public Shorts using the same Track ID, and opening a Short can open that shared Track without copying media.

`ShortFeedController` owns one bounded playback lifecycle. It pauses when a short leaves the viewport, prefetches at most the next two ranges through the existing `VideoPlaybackAdapter`, and invalidates pending work on swipe/reset/close. Chunk integrity and cache quota/pinning remain the generic content layer's responsibility. Watch progress and bookmarks stay local.

The mobile screen is a minimal full-screen vertical surface with autoplay, swipe navigation, creator/caption, Track link, reaction/comment placeholders, share and follow actions. Native hosts provide the decoder-backed adapter and social graph callbacks. Native hosts own decoding and storage boundaries; no central CDN, analytics or recommendation backend is introduced.
