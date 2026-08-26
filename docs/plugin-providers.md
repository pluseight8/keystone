# Plugin providers

Provider registration is typed, namespaced and sandbox-session bound. Supported
surfaces are Tool, Skill, Model, Context, Search, Video, Music, Live, Calendar,
File Handler, Object Renderer, Agent Capability, UI, Notifications and Events.
Executable providers are registered only through the sandbox-bound provider
registry; functions are never persisted.

Providers contribute through Core aggregation and normal privacy, permission,
attribution, ranking and SafetySurfaceGate checks; they do not replace Keystone
surfaces or become authority. External models pass AIEgressFirewall and
credentials remain opaque SecretHandles. Provider crashes/timeouts and offline
state are typed and isolated from native surfaces.
