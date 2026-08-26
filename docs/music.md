# Music

Русский обзор: [музыка, видео и короткие видео](ru/social-media.md#музыка-видео-и-короткие-видео).

`Artist`, `Track`, `Album`, `Playlist`, and `library_entry` are signed Keystone objects. A Track references one immutable `keystone://content/...` audio object and artist/album object IDs; sending, saving, or placing it in a playlist does not duplicate the audio.

Track metadata includes duration, codec, release data, explicit flag, optional ISRC, and declared rights. Uploader identity and a rights declaration are deliberately separate: Keystone does not infer that an uploader owns the work.

`MusicService.importTrack` imports local bytes into a content-addressed `LocalContentStore` and creates a deterministic Track ID from the immutable audio reference and canonical metadata. Re-importing the same input returns that exact Track object. A regular manually-created Track remains supported when deterministic import is not appropriate.

Direct messages and community messages carry only the Track ID. `MusicReplicationService` transfers the original independently signed public Music object over the existing signed transport; it does not create a chat, community, or library copy. Private/contacts music replication is intentionally fail-closed until an encrypted generic-object protocol exists.

`StreamingPlaybackSource` verifies and fetches only the chunk required at the requested position, so playback can begin without a complete download. It validates every chunk hash before caching, uses already verified chunks after an interruption or seek, and leaves quota/pinning/eviction decisions to `ContentCache`. `PlaybackController` owns local queue, seek, repeat, and play/pause state but delegates audible output to a native `AudioPlaybackAdapter`.

`PersistentMusicStorage` is a separately namespaced encrypted durable-storage boundary for Track, Library, Album and Playlist state. Native hosts must provide the encrypted backend, P2P content directory/providers, and audio adapter; no central music server, cloud account, or recommendation backend is part of this design.
