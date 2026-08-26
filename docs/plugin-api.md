# Plugin API

Keystone Plugin API v1 is a stable, typed contract independent of Keystone release versions. Plugins communicate through `PluginHost`, the sandbox, and registered extension surfaces; Core internals are not API.

## Contracts

`PluginApiRegistry` exposes version/features (`ui.*.v1`, tools, skills, models, context, search, media, calendar, files, objects, agents, events, connectivity and external links). A plugin declares a minimum/maximum/preferred API range and requested features. Unsupported ranges fail closed; there is no silent compatibility mode.

`PluginExtensionRegistry` validates a namespaced `plugin:<pluginId>:...` id, binds registration to plugin, immutable revision hash and sandbox session, checks capabilities, bounds payload/quota and stores metadata only. Executable callbacks are re-registered after restart.

## Trust

A provider is untrusted compute/content. OwnerAuthority, ToolPolicy, SafetySurfaceGate, secret isolation, protocol policy and PluginSandbox remain Core-owned. Shared output without a host safety decision is rejected.

## Limits

Provider output, tool input/output, pages, events, storage, UI labels and streams are bounded and cancellable. Disabled, stale, quarantined or revoked registrations cannot execute.

See [versioning](plugin-api-versioning.md), [extension surfaces](plugin-extension-surfaces.md) and the provider-specific contracts.

## Distribution API boundary

Extension APIs may expose package references and bounded discovery metadata, but only Core `PluginDistributionService` can acquire, quarantine, verify or hand a package to the installer. A source provider cannot install, enable, grant capabilities or bypass Safety, Secrets, Sandbox or OwnerAuthority boundaries.
