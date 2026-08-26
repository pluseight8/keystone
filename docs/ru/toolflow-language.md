# Язык ToolFlow

ToolFlow — небольшой JSON/TypeScript data language, намеренно менее выразительный, чем общий язык программирования. Благодаря этому bounds можно проверить до запуска.

- `CALL_TOOL` вызывает один зарегистрированный typed Tool.
- `MAP`/`FOREACH` обрабатывают ограниченный массив с `itemVar`/`indexVar`.
- `FILTER`, `SORT`, `LIMIT`, `SELECT` делают детерминированные операции над коллекциями.
- `TRANSFORM` вычисляет data expression или bounded child sequence.
- `IF`, `PARALLEL`, `JOIN`, `ASSERT`, `RETURN` задают ветвление, bounded fan-out и итог.

Ссылки имеют вид `{ ref: "name" }`, `{ var: "name" }` или `{ path: "field.name", from: { ref: "item" } }`. Built-ins: `input`, `last`, `item`, `index`. Literal с ключом `ref` нужно оборачивать в `{ literal: ... }`.

Используйте `ToolFlowCompiler` с настоящими `ToolRegistry`/`SkillRegistry`, затем `ToolFlowExecutor`. В пользовательском UI показывайте компактную последовательность (Search → Extract → Filter → Done), а не внутренний DSL; подробности доступны в inspect/audit.
