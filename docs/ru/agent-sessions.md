# Сессии и запуски агентов

`AgentSession` — durable изолированный контейнер одного агента: title,
allowlist tools/skills/context, bounded history и последовательность запусков.
Сессии не смешивают history или source requests.

`AgentRun` получает id из session id и sequence, поэтому после restart можно
обратиться к тому же запуску. Состояния:

```text
queued -> running -> completed / cancelled / failed
                    crashed -> queued (recover)
running <-> paused
```

`stream()` выдаёт state, token, assistant, tool и error события. Cancellation
прерывает provider/tool signal. Pause срабатывает на checkpoint, resume
освобождает запуск. Versioned `AgentStateStore` восстанавливает snapshot;
queued/running после старта помечаются `crashed`, а recovery не дублирует
user message.

`delegate()` создаёт отдельную child session. Родитель явно перечисляет каждый
tool, skill и context capability; наследование по умолчанию запрещено.
Глубина, retries, runtime и tool loop bounded.
