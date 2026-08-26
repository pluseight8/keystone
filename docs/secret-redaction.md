# Secret redaction

`SecretRedactionPolicy` performs schema/type-aware redaction for managed secret handles and secret-shaped fields such as private keys, recovery material, access tokens, passwords and provider credentials. It is applied at AI egress, ToolResult, AgentRun/session persistence, Memory, RAG, transport rejection, logs and crash reports.

Redaction is not a privacy permission. External AI is still denied for `SECRET` and private Keystone context; a redacted value cannot be used as an automatic fallback. Local/trusted AI also never receives raw system key material.

`CrashReportRedactor` is the explicit crash boundary, and `SecureClipboardBoundary` requires an owner-confirmed, bounded copy intent; clipboard content is never persisted as a secret.
