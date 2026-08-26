# Capability для секретов

`SecretCapabilityService` выдаёт opaque grant с handle, caller, scope, операциями, target, сроком и максимумом использований. Неизвестный, просроченный, исчерпанный, replayed или revoked grant отклоняется.

Подпись, derivation, encrypt/decrypt, provider authorization и browser autofill — разные операции. Экспорт recovery требует нового owner-confirmed intent. Recovery phrase и private keys не попадают в prompt, ToolResult, Agent history, URL, clipboard и обычное хранилище.

Политика экспорта явная: identity/device/provider material имеет `NON_EXPORTABLE` или `SCOPED_USE_ONLY`; только recovery-flow может выбрать `OWNER_EXPORT_WITH_STRONG_CONFIRMATION`. Recovery import/export intents одноразовые, ограничены сроком и владельцем.
