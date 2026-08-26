# Модель враждебного клиента

Удалённый клиент может быть изменённым, нестандартным или злонамеренным: replay, reorder, duplicate, downgrade, flood, spoof names, malformed crypto и разрывы соединения считаются нормальными угрозами.

Правило Keystone: злонамеренный пользователь может управлять своим Keystone, но не вашим. Remote Agents не получают owner permissions и не могут создать `OWNER_CONFIRMED_DECISION`. Блокировки, revoke, tombstone и private epochs монотонны: stale state не воскресит удалённого участника, capability, AgentProfile или старый ключ.

Ошибки криптографии и протокола приводят к reject/disconnect/quarantine без plaintext fallback, отключения проверки или раскрытия существования private object. Unknown peers получают только локальные bounded quotas; Sybil не трактуется как «одна identity = один человек».
