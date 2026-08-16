# Центр настроек

Phase 27 добавляет единый локальный центр настроек: приватность, сеть, хранилище, уведомления, локальный AI и язык/внешний вид. Настройки имеют версию и сохраняются через предоставленный host-ом `SettingsStorage`; они не попадают в public discovery и общий CRDT.

`SettingsService.bind()` связывает переключатели с работающими core-сервисами. Настройки управляют public discovery, локальной историей, typing/presence/read receipts, media policy, уведомлениями, параллельностью и bandwidth передач, offline-режимом Transport и quota storage. Host должен установить зашифрованное durable-хранилище и binding при bootstrap.

Mobile UI поддерживает English и Русский. Fallback runtime в памяти предназначен только для разработки; production host должен установить durable adapter.

Настройки не включают платежи, рекламу, telemetry, центральный аккаунт, cloud backup или recommendation service.
