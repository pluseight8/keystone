# AI Skills

`Skill` в Keystone — source-available manifest с проверкой целостности. Это
ограниченный список зарегистрированных typed tools, инструкции и capability
manifest, а не runtime для произвольного кода.

## Manifest и одобрение

Skill содержит id, версию пакета, инструкции, tool ids, объявленные
capabilities, источник (`builtin` или `local`) и SHA-256 canonical manifest.
`SkillRegistry` проверяет hash при установке. Состояния `enabled` и одобренные
capabilities изменяемы отдельно; approval, вложенный в package, игнорируется —
одобрение передаёт только пользовательская policy.

Встроенные `keystone-search` и `keystone-actions` начинаются без одобренных
capabilities. Пользователь просматривает и разрешает их в Mobile → AI →
Skills. Skill получает только объявленные и одобренные capabilities. Disable и
revoke проверяются при каждом запуске и действуют сразу.

Local skill package может ссылаться только на уже зарегистрированные host
tools; этот manifest API не добавляет исполняемый handler. Нет произвольных
shell, eval, raw filesystem, unrestricted network, платежей, рекламы или
marketplace. Опасная возможность в будущем потребует отдельного reviewed
capability и по умолчанию останется выключенной.

## Поток выполнения

```text
model / local planner
        │ typed proposal
        ▼
ToolRegistry.issueIntent (zod + capability)
        │ одноразовый opaque intent
        ▼
ToolPolicy (source, skill, host policy)
        │ confirmation / double confirmation
        ▼
ToolExecutor → именованный Keystone host adapter → ToolResult
```

External provider может только предложить intent через существующий
`AIOrchestrator`; private tools и private results ему не передаются.
Единственный путь выполнения — `ToolExecutor`, а metadata-only audit виден на
экране Skills.
