# Делегирование worker-задач

Delegation — это явная передача ограниченных прав от постоянного Agent Bot
одному `EphemeralAgentWorker`. Это не наследование capabilities и не новая
trust relationship.

`WorkerTask` содержит bounded objective, type, parent Agent/run IDs, явно
переданный context, object references, execution/privacy class, timestamp и
canonical fingerprint. Повтор того же subtask у одного parent отклоняется до
запуска модели.

`WorkerCapabilityGrant` отдельно от task и проверяется по `ToolRegistry`:

```text
Agent Bot → WorkerTask + WorkerCapabilityGrant
              ├─ tool/skill IDs и capabilities
              ├─ data classes + source/object scope
              ├─ expiry / maxUses / maxRuntimeMs
              └─ canSpawnWorkers=false по умолчанию, depth≤1
```

Worker, model, webpage, attachment или tool result не могут расширить grant.
`READ_PRIVATE` действует только при совпадении явного data scope. Destructive,
network, device и security-sensitive действия сохраняют существующий
confirmation/double-confirmation boundary.

Основной loop:

```text
model → ToolIntent → grant check → ToolPolicy/ToolExecutor
      → result-class check → scoped context → следующий model call
```

Browser/Coding worker не получают автоматически Memory, DMs, private Files,
social graph, device/security state или shell. Их нужно передать отдельно и
разрешить policy.

`WorkerResult` хранит worker/task IDs, status, bounded output, source IDs/types,
tools, data classes, confidence и generation. Родитель должен вызвать
`verifyResult`; подделанный или устаревший result отклоняется.

External worker — только adapter  orchestrator/firewall. PRIVATE/SECRET
не покидают Keystone, external tool intents запрещены, а без firewall adapter
создание worker fail-closed. Все workers идут как `BACKGROUND`, поэтому
интерактивный Agent Bot не блокируется.

После completion/cancel/failure/destroy cache lease освобождается, KV
очищается, а restart восстанавливает только bounded terminal metadata. Нужен
отдельный confirmation и host callback для Promote to Agent. Worker IDs не
публикуются в discovery и не становятся AgentProfile.
