# P2P media transfer ( foundation)

Русский обзор: [контент и вложения](ru/social-media.md#контент-и-вложения).

Media transfer requests are chunk-oriented, not message envelopes containing a whole file. A client obtains an already validated manifest, asks one or more voluntary `ContentProvider`s for missing chunk indexes, validates the reply, and commits it to its local cache. Interrupted work is resumed without re-downloading verified chunks.

The current core contains no global provider index and does not turn cache users into automatic seeders. Hosts must expose cache quota, pinning, download cancellation, and any upload/bandwidth policy explicitly. Later messaging attachments, Tracks, Videos, and community media will carry only a content URI plus signed metadata.
