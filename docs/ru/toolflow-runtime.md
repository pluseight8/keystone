# ToolFlow Runtime

ToolFlow — ограниченный data-only runtime для механических цепочек Agent Bot и временных workers. Модель предлагает одну программу, Keystone проверяет её, а затем выполняет typed tools без возврата к LLM после каждого простого шага.

Путь выполнения: `предложение модели → Compiler/Validator → ToolFlowExecutor → ToolFlowArtifact → итоговый inference`.

Flow переиспользует существующие `ToolRegistry`, `ToolPolicy`, `ToolExecutor`, `AIResourceScheduler`, `TaskGraphExecutor`, `EphemeralAgentWorkerService` и `BrowserAgentRuntime`. Новый transport, облачный сервис или коммерческая функция не добавляются.

Программа содержит creator (`AgentRun` или `WorkerRun`), явные tools/capabilities/data scopes, expiry, revision, integrity и `ToolFlowBudget`. Разрешены только `CALL_TOOL`, `MAP`, `FILTER`, `SORT`, `LIMIT`, `SELECT`, `TRANSFORM`, `IF`, `FOREACH`, `PARALLEL`, `JOIN`, `ASSERT`, `RETURN`.

Compiler заранее отклоняет неизвестные tools/skills/операции, плохие ссылки и циклы, рекурсию, чрезмерное расширение, escalation capabilities/scope, истёкшие или изменённые программы. Runtime ограничивает steps, iterations, calls, parallelism, runtime, bytes, retries и trace. Нет arbitrary JavaScript/Python/shell/eval.

`CALL_TOOL` всегда проходит существующий `ToolExecutor` и `ToolPolicy`; confirmation/double-confirmation для действия нельзя спрятать внутри flow. `pause`, `resume` и `cancel` кооперативные и bounded.

`ToolFlowArtifact` содержит только provenance, citations, privacy scope, integrity и ссылку на trace. Trace не хранит plaintext аргументов, результатов или секретов. PRIVATE остаётся PRIVATE, SECRET никогда автоматически не становится публичным. External AI не исполняет flow и не получает private intermediate state.

TaskGraph node и worker могут использовать ограниченный ToolFlow с grant, не превышающим их собственный. `BrowserToolFlowAdapter` оставляет только typed open/observe/navigate/createArtifact поверх всех существующих browser policy, origin, revision и privacy checks.

## Измеренный benchmark

Проверка `toolflow-benchmark.test.ts` выполнена 17.08.2026 на восьми детерминированных echo-вызовах: повторяющаяся схема сделала 8 model round trips и 8 tool calls, а схема `LLM → ToolFlow → tools → LLM` — 1 model round trip и те же 8 tool calls. Изолированный запуск дал 0,974 мс против 1,925 мс, полный suite — 1,803 мс против 4,800 мс. Это не заявление об ускорении: на маленьком тесте виден overhead валидации/interpreter. Переносимый результат — сокращение model round trips; настоящую latency нужно измерять на host runtime.
