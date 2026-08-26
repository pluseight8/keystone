# Redaction секретов

`SecretRedactionPolicy` удаляет managed handles и secret-shaped поля: private keys, recovery material, access tokens, passwords и provider credentials. Политика применяется на AI egress, ToolResult, Agent persistence, Memory, RAG, transport, log и crash boundaries.

Redaction не является разрешением на передачу данных. External AI всё равно fail closed для `SECRET` и private Keystone context; redacted value не может стать fallback. Local/trusted AI также не получает raw key material.

`CrashReportRedactor` — явная crash-граница, а `SecureClipboardBoundary` требует owner-confirmed и ограниченный intent копирования; clipboard не сохраняется как secret.
