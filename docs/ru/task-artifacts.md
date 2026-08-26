# Task Artifacts

`TaskArtifact` — единственный bounded hand-off между nodes Multi-Agent Task
Graph. Это typed reference, а не вторая копия media или private state.

Поддерживаются `text`, `structured`, `object_references`, `citations`,
`file_reference` и `error`. Artifact получает graph-local ID, producer node,
graph/node revision, data class, явный scope, citations, provenance, размер,
timestamp и integrity digest. Producer не может опубликовать data class вне
своего scope; consumer получает artifact только по dependency/inputRefs и при
совместимом scope.

Перед использованием artifact проверяется. Изменение value, scope, producer,
revision или timestamp отклоняется. При новой revision старые artifacts
инвалидируются, поэтому поздний worker/retry не меняет новый план. Count/bytes
и serialized context ограничены budgets.

Private/secret artifacts остаются в local/trusted-personal execution. Внешняя
AI firewall отклоняет node с external execution, если context или scope
содержит `PRIVATE`/`SECRET`. ToolPolicy остаётся обязательной границей; tool
result не становится artifact автоматически.

Используйте IDs и citations для Track, Video, File, Message, Space и других
Keystone objects. Не копируйте content между Chat, Community, Library или UI.
File reference не обещает доступность: действуют обычные integrity, pinning,
quota и privacy правила content layer.

Mobile Agents показывает количество artifacts и прогресс nodes, но не раскрывает
private plaintext по умолчанию. Audit хранит metadata без telemetry и
центрального artifact service.
