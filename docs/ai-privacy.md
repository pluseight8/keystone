# AI privacy boundary

External AI is an untrusted egress. Every remote request is constructed by
`AIEgressFirewall`; provider adapters cannot opt out of it.

| Class | External provider |
| --- | --- |
| `PUBLIC` | allowed |
| `USER_EXPLICIT` | allowed |
| `PRIVATE` | removed by default |
| `SECRET` | always denied |

The current text explicitly entered by the user is `USER_EXPLICIT`. Context,
history, attachments, nested-agent results and tool arguments must carry a
class. Private RAG, Life Map, DMs, private Communities, files and filenames,
contacts/social graph, Identity/device data, notifications, location,
watch/listen/search history and private tool results are therefore not present
in a default external payload. If private context is attached to a public
request it is redacted and the audit records the class; it is never serialized
to the provider. A task marked `private` is rejected for every remote model.

The firewall also replaces non-public system material with a safe system prompt,
limits sizes, removes private nested/tool-intent values and runs again for each
fallback candidate. Provider fallback, plugins, attachments and agent chaining
cannot create a second egress path. A remote model can only propose a tool
intent. Keystone policy decides whether a local tool runs, and a private tool
result is not automatically fed back to the remote model.

`AIAuditLog` stores provider/model, local/remote scope, data classes, requested
tool names and allow/redact/deny decisions. Prompt text, context values, API
keys and recovery material are intentionally absent. The log is bounded and
local.

## Host responsibilities

Hosts should classify data at the boundary, keep API credentials in a secure
secret store, and expose only existing capability-scoped services to local AI.
They should not put private values in a `PUBLIC` system prompt. `SECRET` values
remain local only, and a missing local runtime is a fail-closed condition for a
private task. Keystone has no central AI server, mandatory cloud, telemetry,
advertising, payments or monetization path.

