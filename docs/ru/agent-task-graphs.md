# Multi-Agent Task Graphs

Сервис task graph предоставляет bounded DAG-координатор для постоянного Agent Bot. Он
собирает уже существующие `EphemeralAgentWorkerService`,
`AIResourceScheduler`, `AIContextCacheManager`, `AgentRuntime` и `ToolPolicy`.
Нового model runtime, transport, Identity или storage-протокола нет.

`AgentTaskGraph` хранит goal, владельца Agent/run, явные capabilities и data
scopes, budgets, revision и `TaskNode`. Planner нормализует IDs/scopes и до
запуска отклоняет duplicate/missing dependencies, self-edge, cycles,
невозможные artifact references, слишком большой fan-out/depth/size и
undeclared capabilities.

Lifecycle:

```text
PLANNING → READY → RUNNING ⇄ WAITING/PAUSED
                   → COMPLETED | PARTIAL | FAILED | CANCELLED
```

Независимые ready nodes запускаются параллельно только в пределах
`maxConcurrentNodes`. Workers остаются background-задачами scheduler, поэтому
интерактивные запросы AgentRuntime имеют приоритет. Для каждого node не
загружается отдельная модель.

## Least-context и artifacts

Node получает свой явный context и проверенные artifacts обязательных
предшественников. `TaskArtifact` бывает text, structured, object references,
citations, file reference или error и хранит producer, worker/result
provenance, graph/node revision, source IDs, data class, scope, размер, время и
integrity digest. Private/secret artifact не пересекает external boundary.
IDs и ссылки на Keystone objects передаются по ссылке, без копирования media.

Integrity проверяется до propagation, stale revision отклоняется. Ошибка одной
ветви блокирует обязательных descendants, но независимые ветви завершаются;
результат получает lifecycle `PARTIAL` и списки completed/failed/skipped nodes.

## Budgets, retry и replan

Ограничиваются nodes, concurrency, depth, fan-out, inference jobs, tool calls,
retries, runtime, context tokens, количество и bytes artifacts. Retry создаёт
новый worker fingerprint и не выходит за общий budget. Private graph node не
делает fallback во внешний AI.

`replan`/`changeGoal` создают новую revision: изменённые nodes и descendants
становятся `STALE`, старые artifacts инвалидируются, late results отбрасываются.
Расширение capabilities или scope требует host policy callback и explicit
approval. Доступны pause/resume/stop/skip/retry/remove pending node/change goal.

Durable store сохраняет graph metadata, node states, bounded artifacts и
counters. После restart RUNNING/WAITING восстанавливаются как `PAUSED`; stale
private context не возобновляется автоматически.

Mobile Agents screen показывает goal, lifecycle, revision, прогресс nodes,
число artifacts и pause/resume/stop. Тесты  проверяют sequential и
parallel DAG, cycles/dependencies, partial failure, retry, pause/cancel,
revision, scope isolation, external denial и tamper detection. Production
Hyperswarm/Noise suite остаётся прежним; нового network protocol нет.

Keystone остаётся некоммерческим: без payments, рекламы, marketplace,
monetization, telemetry и hosted graph service.
