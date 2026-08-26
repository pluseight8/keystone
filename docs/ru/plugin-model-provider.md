# Plugin ModelProvider

Разрешены совместимые local/external/hybrid модели без allowlist. Провайдер сообщает metadata, health, capabilities и resource estimate; запуск проходит центральный scheduler. External/hybrid запросы обязательно проходят AIEgressFirewall, а private/secret context запрещён по умолчанию. Credentials доступны только через opaque SecretHandle и не попадают в prompt/log/storage.
