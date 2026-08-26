# Архитектура секретов

Системные секреты Keystone являются capability, а не данными приложения. `SecretClass`, риск, срок жизни, область, источник и политика экспорта описываются явно. `SecretHandle` непрозрачен и не содержит байтов ключа.

Единственная граница для создания, хранения, ротации, отзыва, derivation и шифрования — `SecureSecretHost`/`SecureSecretStore`. Уровень защиты сообщается честно: `HARDWARE_BACKED`, `OS_PROTECTED`, `APPLICATION_ENCRYPTED`, `MEMORY_ONLY` или `UNAVAILABLE`; test/development host сообщает `MEMORY_ONLY`.

Capability ограничена caller, операцией, target, сроком и числом использований. Redaction применяется к логам, audit, crash reports, Agent history, ToolResult, Memory, RAG и AI state. Raw system secret не является shared/public content.

`CrashReportRedactor`, `SecureLoggerBoundary` и типизированный `SecureClipboardBoundary` — host-границы: clipboard требует нового owner-confirmed intent и, при необходимости, ограниченного auto-clear; clipboard не является хранилищем secrets. `SecretInventory` показывает только метаданные и доступные операции. Для устройств используется отдельная область `DeviceKeyHandle`/`DeviceSigningCapability`.
