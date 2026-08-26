# Изоляция недоверенного контента

Keystone считает данными любые байты из P2P, browser downloads, shared spaces, communities и packages. Жизненный цикл:

`RemoteFileDescriptor → BoundedIncomingTransfer → QuarantinedBlob → StructurallyInspectedBlob → ClassifiedFileObject → SafePreviewObject → UserReleasedFileObject`.

До явного действия владельца у объекта нет executable authority. Имя, MIME отправителя, HTTP `Content-Type`, подпись и результат scanner — только evidence. `CLEAN` не означает «можно запустить». Core не вызывает shell/interpreter, OS association, macro, installer, startup hook или protocol handler для полученных данных.

Локальные личные данные остаются доступны владельцу. Сетевой и shared content сначала попадает в quarantine; ciphertext не классифицируется как plaintext до разрешённой materialization. Content Safety и Malware Safety — разные decision domains.

Host может предоставить typed sandboxed decoder, document preview host, encrypted persistence и local scanner. Ошибка boundary даёт `UNKNOWN`, `SCAN_FAILED` или `INSPECTION_FAILED`, но не `SAFE`. Preview ограничен, derived и сохраняет source hash/provenance. HTML/SVG очищаются от scripts, event handlers, embeds и автоматических external fetches.
