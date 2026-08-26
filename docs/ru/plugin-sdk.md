# Plugin SDK

`@keystone/addons/sdk` экспортирует публичный developer contract: version/feature
types, manifest/provider schemas, UI contributions, provenance, validators и
`PluginTestHost`, `PluginFixtureBuilder`, `ProviderTestHarness`.

SDK не является backdoor в Core: production PluginRegistry, SecretStore, ключи
Identity, OwnerAuthority root, Safety tokens, raw files, route metadata и shell
не экспортируются. Test host помечен `DEVELOPMENT_TEST` и не может выдавать себя
за production host. Результат provider всегда bounded, attributable и untrusted.
Host-side aggregation требует явного выбора источника владельцем; executable
providers никогда не сериализуются.
