# Plugin security model

Trust is layered: received ≠ installed ≠ enabled ≠ trusted ≠ unlimited. Plugins
cannot access identity/device/recovery secrets, forge owner intents, mutate
immutable security roots, bypass ToolPolicy or SafetySurfaceGate, expose
anonymous mesh topology, or open external links directly. Runtime crash counts,
resource budgets, registration quotas, package quarantine, exact dependency
resolution and revision-bound permissions provide bounded failure behavior.

The current model includes the versioned API/extension registry, typed provider fan-out and
developer test kit. It does not weaken the production sandbox: executable
providers still cross PluginHost/PluginSandbox, and registrations are
revision/session-bound. Provider failures, offline state and large outputs are
isolated by bounded pagination/timeouts. Remaining platform-specific process
isolation is reported by the selected host adapter rather than implied by the
API.

## Lifecycle security

Discovery and source trust are never package authority. Downloaded bytes remain quarantined until exact integrity, signature/provenance, compatibility, dependency and owner-review checks complete. Updates are staged and permission-expanding updates stop at explicit review. Offline/local/P2P delivery uses the same checks.
