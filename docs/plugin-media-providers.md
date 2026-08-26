# Plugin media providers

VideoProvider, MusicProvider and LiveProvider contribute typed external sources. `MediaAttribution` always identifies provider, creator and optional source link; a plugin cannot impersonate Keystone-native content. Playback uses a provider descriptor/adapter and does not require Keystone to rehost media.

Core aggregates enabled owner-selected sources, validates metadata, applies privacy and Content Safety, preserves badges and returns partial results when a provider is offline/slow. Provider search receives no Memory, Vault, DMs, calendar, location or relay identity.

## Personal library boundary

External media providers and plugins do not receive the private Photos library,
original bytes, EXIF GPS, Vault state, albums or page-enumeration authority.
An owner may explicitly grant a narrow picker, import, decoder or export
capability through the typed host boundary. The capability is bounded to the
selected items and operation; it does not authorize a full-library scan,
background camera-roll upload, public publication, deletion or a second blob
store. A plugin-produced rendition remains untrusted derived content and must
pass the same size, MIME, content-safety, privacy and publication checks.
