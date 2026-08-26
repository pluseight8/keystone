# Политика обновлений плагинов

Владелец выбирает `NOTIFY_ONLY`, `DOWNLOAD_ONLY` или `AUTO_APPLY_SAFE_COMPATIBLE`, channel и allowlist источников. Auto-apply fail-closed: не выдаёт новые capabilities, не доверяет ranking source, не игнорирует revocation и не меняет publisher/dependency authority. Offline request сохраняется и возобновляется после разрешённого подключения, но review остаётся обязательным.
