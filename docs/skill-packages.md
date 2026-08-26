# Skill packages

Keystone Skills are installable, versioned, declarative procedure packages. A package contains a normalized manifest, bounded instructions, optional declarative examples/tests, source provenance, and integrity metadata. A stable `skillId` is independent of its display name.

The package layer is deliberately separate from the Plugin/Add-on runtime. A Skill is not executable code: it cannot register a tool, execute JavaScript or shell commands, install another package, or change Keystone policy. Typed Tools remain the only executable capability and still pass `ToolIntent → ToolPolicy → confirmation → ToolExecutor`.

## Manifest and provenance

`SkillManifest` records the author identity/reference, semantic version, format version, entrypoint label, instructions, tags, required/optional Tools and capabilities, data scopes, dependencies, compatibility, timestamps, SHA-256 manifest/content hashes, and an optional author signature. A display name is never treated as authority. Imported, URL, and P2P packages are marked untrusted even after normalization.

`SkillIntegrityVerifier` authenticates the canonical manifest/content payload and can use a host-provided identity signature verifier. Unsigned packages can be allowed by policy, but the UI exposes them as unsigned/unverified. A changed package with an old hash or signature is rejected.

## Installation lifecycle

Sources are explicit host boundaries: local package, FileObject, URL/download, P2P reference, or compatible imported format. The flow is:

`parse → validate → integrity → dependencies → static evaluation → user review → install disabled/enabled explicitly`.

The review shows author/source, version, requested Tools, capabilities, data scopes, dependencies, compatibility warnings, and integrity state. Lifecycle operations are `INSTALL`, `ENABLE`, `DISABLE`, `UPDATE`, `ROLLBACK`, and `UNINSTALL`. Updates and revision acceptance never silently add permissions; a capability expansion requires a new review. Rollback selects a previous verified revision.

`SkillPackageRegistry` has a bounded durable state adapter. Receiving or attaching a package through Chat, Space, or a FileObject does not install it.

## Progressive disclosure

The registry exposes a lightweight index containing name, description, tags, capability/tool summaries, scopes, source, and enabled state. `SkillResolver` ranks this index with bounded results and only loads full instructions for selected, enabled Skills. `SkillContextSource` is a `ContextBuilder` adapter; its output is bounded, marked as untrusted instruction data, and consumes the existing context budget. Five hundred installed Skills therefore do not become five hundred full prompts.

## Runtime boundary

`SkillRuntime` opens only an enabled revision inside the current capability/data-scope grant. It can issue an intent only for manifest-declared Tools and delegates execution to the existing `ToolExecutor`. Hidden sensitive actions cannot skip confirmation, and external model requests remain subject to the existing egress firewall.

Plugin dependencies are reported as unresolved here; executable plugin runtime
behavior is owned by the Plugin contracts.

## Capture and extension boundary

Capture is not an ambient extension hook. A Skill, plugin, agent or webpage
cannot subscribe to clipboard history, enumerate private tray contents, claim
an OS Share-In payload, or route a captured item without an explicit typed
adapter, current capability grant and owner confirmation. Capture provenance
is untrusted data; it does not grant execution authority. Any future capture
extension must remain bounded, preview-first and subject to the same egress,
data-class, confirmation and audit rules.
