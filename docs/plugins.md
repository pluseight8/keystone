# Plugins

Plugins are optional, untrusted extensions for explicitly supported Keystone
surfaces. They are not part of the core product, do not inherit the owner's
authority and do not make a provider a Keystone service. The shared core,
native host and security policy remain in control.

## Plugin, Skill and core boundaries

Core owns major product behavior, identity, authorization, Files, Tasks,
Contacts, Calendar, Messages, the Keystone Network and their source data.
Plugins are appropriate for narrow provider integrations, tools, renderers and
other extension points. A Skill is a versioned declarative procedure; it is not
an executable plugin and cannot register a tool or run code.

Provider integrations such as CalDAV, CardDAV, external calendar/contact
bridges and similar interoperability belong in a plugin or provider boundary
when they are not required by Keystone's core model. This does not move
core-owned product surfaces into plugins.

## Capability model

A manifest declares what a plugin would like to use; the declaration is not a
grant. Each operation is checked against a revision-bound, owner-approved,
scoped and revocable capability. There is no `ALL`, `ADMIN` or `FULL_ACCESS`
capability.

Capability examples include:

- a schema-constrained AI request through the host model path;
- a host-filtered projection of selected Life Map or product data;
- one bounded P2P request;
- a provider registration for a declared extension point.

The user sees the data, consequence, scope and duration before a sensitive
operation. A plugin cannot use a Contact, content hash, path, web page, feed
enclosure or captured item as permission. It cannot enumerate private Contacts,
Files, Vault, Memory, Mail, Location or Capture data without a separate
explicit capability and source-owner decision.

Technical capability IDs belong in the [Plugin API](plugin-api.md) and
[capability reference](plugin-capabilities.md), not in ordinary product copy.

## Runtime and NativeHost boundary

Plugins run outside the main React, Expo or Tauri renderer. A production host
must provide an isolated runtime, deny Node/process/shell/socket access,
validate a safe entrypoint and signed or integrity-checked bundle, and enforce
CPU, memory, storage, output and wall-clock limits. Host handlers receive
copied, validated data rather than raw Core objects, CRDT documents, native
handles, credentials or unrestricted `fetch`.

The native host owns platform-specific isolation and permission prompts. Core
still validates the principal, capability, operation, scope, revision and
expiry before dispatch. A crash, timeout, malformed response or missing host
adapter stops the operation and cannot restart or weaken Core.

## Distribution and lifecycle

Acquisition is transport-neutral and source metadata is provenance, not trust.
Received bytes remain quarantined until the host validates the manifest,
entrypoint, size, integrity, signature/provenance where required,
compatibility and dependencies. Review is required before install; install and
enable are separate actions.

Updates are staged. A new or broader permission cannot appear silently, and a
verified previous revision is the rollback target. Disable, quarantine,
uninstall or revocation removes active registrations; executable providers
must register again after restart. Unknown package objects remain opaque and
cannot execute.

See [Plugin security model](plugin-security-model.md), [Plugin distribution](plugin-distribution.md),
[Plugin sandbox](plugin-sandbox.md), [Plugin providers](plugin-providers.md),
[Skill packages](skill-packages.md) and [Security](security.md) for technical
contracts.

## Provider integrations

Provider output is untrusted, bounded and attributable. It cannot write a
canonical object directly, change a source's authorization, publish without
the relevant policy, or send private data to an external model. External media
providers remain visibly external and are not copied into a Keystone CDN or
private library automatically.

Plugins may request a narrow projection or an owner-selected picker result.
They do not receive identity keys, recovery material, provider credentials,
filesystem paths, raw transport topology, exact location or browser session
secrets. A plugin's presence does not turn a nearby endpoint into a Contact or
a provider into a social authority.
