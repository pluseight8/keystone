# Plugin API versioning

The API version is a protocol contract, currently `1`, not the app/package version. Manifests and extension registrations declare `minimum`, `maximum`, optional `preferred`, and feature versions such as `search.v1`.

`PluginApiRegistry.negotiate()` returns a selected version or a structured incompatibility result. Unknown/unavailable features and ranges outside the host version prevent registration. Stable host features cannot be overwritten by a plugin. Revision updates re-negotiate and stale sessions are invalidated.
