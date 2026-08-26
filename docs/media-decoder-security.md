# Media and document decoder boundary

Images, audio, video, PDF, HTML and SVG are untrusted bytes. `SandboxedMediaDecoder` and `DocumentPreviewHost` are typed host boundaries. Core applies limits for dimensions/pixel count, frames, duration, metadata, memory and nesting before asking a decoder to work.

Decoder output is `UNTRUSTED_DERIVED`, not a trusted prompt or executable object. Preview generation samples bounded data; it does not decode a complete video/audio stream or fetch external resources. Document previews disable macros, scripts, external commands and automatic network fetches. Markup is sanitized into a non-active representation.

Photos originals and derivatives use the separate canonical `MediaDecoder` →
`NativeHost.media()` boundary documented in `docs/photos.md`. The existing
`SandboxedMediaDecoder` remains the bounded quarantine/preview safety surface;
neither boundary grants publication, location, AI or arbitrary filesystem
authority.
