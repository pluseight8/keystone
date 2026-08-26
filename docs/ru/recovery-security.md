# Безопасность recovery

Cold backup аутентифицирован и зашифрован libsodium. Метаданные могут содержать версию, дату и примерный размер, но не recovery phrase, plaintext key или соседний encryption key. Restore сначала проходит проверку и staging, затем атомарный commit.

Неверный phrase, tampering, truncation, неподдерживаемая версия и replay intent завершаются чистой ошибкой без изменения live state. Cache можно восстановить через P2P; identity/security state обслуживается trusted secret boundary.
