# Plugin Supply Chain (RU)

Исполняемые плагины работают только через границу sandbox, которой владеет Core. Сеть, файловая система, процессы, native API, секреты и анонимная mesh-топология закрыты по умолчанию и открываются только типизированными capability. Подпись подтверждает происхождение и целостность, но не безопасность и не права владельца.

## Инварианты

- Без sandbox-сессии у плагина нет исполняемой authority.
- Capability привязана к плагину, revision и сессии и может быть отозвана.
- Сырые секреты, ключи Identity, process API и произвольная файловая система не передаются через IPC.
- Shared/public output всегда проходит Core Content Safety gate.
- При недоступной capability плагин завершается fail-closed.

## Distribution и recovery

Content-addressed acquisition bounded, resumable и независим от источника. Corrupt chunks, конфликтующие revision одной версии, revoked publisher/revision и dependency substitution отклоняются до install. Repair получает exact immutable revision и повторяет полный security lifecycle; rollback не возвращает revoked authority.
