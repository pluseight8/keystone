# Plugin distribution

Keystone treats a plugin package as a content-addressed object. `PluginDistributionService` can discover and acquire packages from independent local, file, URL, P2P, content-address, trusted-index, USB, development, community and owned-device sources. No central store, account, CDN or always-on Internet is required.

Distribution is deliberately separate from authority: source metadata is provenance, not trust; received packages remain untrusted; acquisition performs bounded transfer, exact hash/integrity and supply-chain verification, then quarantine. `prepareInstall` only hands the verified package to the existing owner-review installer and results in `INSTALLED_DISABLED`; it never enables or executes code.

Package identity is `pluginId + version + sha256:<packageHash>`. The source path and transport do not alter it. Anonymous relay identities and routes are never recorded or shown.
