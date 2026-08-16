# Агенты

Phase 33 добавляет local-first runtime поверх существующих
`AIOrchestrator`, privacy firewall, Personal AI Mesh и типизированных Tools.
Новый provider, transport или отдельная permission-система не создаются.

Профили `Personal`, `Research`, `Coding`, `Automation` и `Minimal` задают
model policy, context capabilities, allowlist tools/skills, privacy class,
лимиты времени/итераций/повторов, глубину child-agent и подтверждения.
Сессия может только сузить эти значения.

Personal — приватный профиль: выбирается это устройство или trusted personal
AI node. Для private-задач external fallback запрещён. Любой внешний вызов
проходит только через `AIOrchestrator`/`AIEgressFirewall`; runtime агента не
отправляет private context напрямую model adapter.

Цепочка действий строго типизирована:

```text
model -> ToolRegistry.issueIntent -> ToolPolicy/approval -> ToolExecutor -> ToolResult
```

Контент файлов и сообщений считается недоверенным и не может расширить
capabilities. Shell, eval и unrestricted filesystem/network отсутствуют.
Run имеет deterministic id, bounded runtime/iterations, защиту от повторов и
ограниченную глубину child-agent. Состояние и recovery описаны в
[сессиях](agent-sessions.md), контекст — в [Context Engine](context-engine.md).
