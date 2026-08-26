# Безопасность Graph, Canvas и visual слоя

- Markdown и attachments остаются source of truth; graph/index/history/Canvas — производные и изолированные структуры.
- Любое чтение Vault/note/attachment проходит `VaultPermissionBoundary`.
- Object card требует отдельного object permission adapter и сама не выдаёт доступ к underlying object.
- Web Card принимает только `http`/`https` без credentials, не хранит session data и не запускает браузер скрыто.
- Canvas IDs, nodes, edges, text, coordinates и nesting bounded; malformed schema, duplicate IDs и stale revision fail closed.
- Unresolved links, recursive embeds и missing attachments — безопасные отображаемые состояния.
- Untrusted note/file/web content не меняет AI policy, capabilities, Memory или Agent permissions.
- Graph/Canvas AI context требует explicit local/trusted scope; `AIEgressFirewall` блокирует private данные для external providers.
- Corrupt cache/history/Canvas JSON не удаляет Markdown, пользовательские файлы или Keystone objects.
