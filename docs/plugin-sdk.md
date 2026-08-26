# Plugin SDK

Import `@keystone/addons/sdk` for the public developer contract. It exports
version/feature types, manifest and provider schemas, extension contribution
types, provenance models, validators and the `PluginTestHost`,
`PluginFixtureBuilder` and `ProviderTestHarness` utilities.

The SDK is not a Core backdoor. It deliberately does not export the production
PluginRegistry, SecretStore, Identity keys, OwnerAuthority root, Safety tokens,
raw files, route metadata or a shell. The test host is marked
`DEVELOPMENT_TEST` and cannot masquerade as a production host. Provider output
is always bounded, attributable and untrusted. Host-side aggregation helpers
require explicit owner source selection and preserve provider attribution;
executable providers are never serialized.
