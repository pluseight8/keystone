# Приватность календаря

Раскрытие календаря fail-closed. Private calendar виден владельцу, пока явное membership/permission не выдаст более узкий доступ. Private event при `FREE_BUSY` превращается в `BUSY`: удаляются description, location, identities участников, recurrence, related refs и attachments. `TITLE_ONLY` сохраняет только разрешённый title. Outsider не может искать private events.

Availability возвращает только подписанные производные интервалы (`FREE_BUSY`, `derivedOnly: true`) в ограниченном диапазоне. Названия и места никогда не попадают в common-time результат. Search локальный и permission-aware; private objects не становятся public из-за replication.

Attachment IDs — ссылки. Calendar обращается к существующей File/Content policy, а недоступный или private файл остаётся locked. Membership не даёт доступ к Messages, Memory, Space, devices или Agent state.

Agent получает только разрешённую производную availability. External AI не получает данные Calendar; remote subtask проходит существующий egress firewall и может содержать только явно public обезличенный контекст.
