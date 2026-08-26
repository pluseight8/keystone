# Plugin / Add-on Platform

Plugins are a separate trust class from Keystone Core. They extend explicitly
supported extension points through `PluginHost`; executable code is never
authority and an installed package never inherits the owner's permissions.

## Package and install boundary

Received packages are untrusted and are retained only as package metadata until
the host validates the bounded manifest, payload hashes, compatibility and
dependencies. The required lifecycle is:

`RECEIVED → QUARANTINED → PARSED → VALIDATED → REVIEW_REQUIRED → INSTALLED_DISABLED → ENABLED_STOPPED → RUNNING`.

There is no download-to-execute path. Owner approval is required for install,
and enablement is a separate explicit action. `PluginRuntime` is an adapter
boundary; production adapters must provide an isolated runtime.

## Host and capabilities

`PluginHost` is the only supported Plugin ↔ Keystone boundary. Capabilities are
granular, declared in the manifest, independently reviewed and revocable.
Plugins have no Core container, raw database, identity key, recovery material,
SecretStore, shell, process API, raw socket or unrestricted event bus.

Shared/public output must call `surface.publish` and then the host-owned
SafetySurfaceGate. Without a safety adapter the operation fails closed. Plugin
Tools remain subject to ToolPolicy.

## Stable API and extension surfaces

`PluginApiRegistry` negotiates a stable API/feature version independently of
Keystone release versions. `PluginExtensionRegistry` validates namespaced IDs,
immutable revision hashes, sandbox sessions, capabilities, compatibility and
quotas. Stop, disable, quarantine and uninstall deactivate registrations; only
metadata is durable and executable providers re-register after restart.

Typed provider surfaces include Tool, Skill, Model, Context, Search, Video,
Music, Live, Calendar, File Handler, Object Renderer, Agent Capability,
notifications, declarative UI and events. Provider type does not imply data
permission. Provider output is untrusted, bounded, attributable and filtered by
Core privacy, permissions, ranking, external-link policy and SafetySurfaceGate.
External/hybrid models pass AIEgressFirewall. Media remains visibly attributed
to its external source and Core native media remains first-class.

The public SDK (`@keystone/addons/sdk`) exports contracts, validators and a
`DEVELOPMENT_TEST` host, never Core containers or secrets. Connectivity is only
coarse state/quality/delivery; relay identities, routes, hops, IPs and locations
are unavailable to Plugins.

## Reliability and removal

Runtime failures are recorded behind a crash boundary. Repeated failures stop
and quarantine a Plugin after a bounded count; Keystone Core is not restarted.
Provider crashes/timeouts return typed health and do not break native surfaces.
Storage, pages, events, UI, tool output and streams are bounded and cancellable.
Unknown Plugin objects remain opaque and can degrade to “requires add-on”.

## Distribution boundary

`PluginDistributionService` and `PluginSourceRegistry` support independent sources without a central registry. Acquisition is content-addressed and transport-neutral; source metadata is provenance only. Receiving a package never installs, enables or executes it. Exact package integrity, quarantine, supply-chain checks and owner review remain mandatory.
