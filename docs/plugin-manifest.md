# Plugin manifest

`PluginManifest` is untrusted input. It carries a stable reverse-domain
`id`, semver `version`, bounded entrypoint, requested capabilities, typed
extension points, exact dependency identities, API/platform compatibility,
payload integrity hashes and optional author provenance. Display name and author
are not security identities. Integrity covers the canonical manifest and all
executable/resources/schemas; any mismatch rejects the package.
