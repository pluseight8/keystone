# ToolFlow Language

ToolFlow is a small JSON/TypeScript data language. It is intentionally less expressive than a general programming language so that Keystone can prove bounds before running it.

## Operations

- `CALL_TOOL`: `{ toolId, skillId, args, as }` invokes one registered typed Tool.
- `MAP` / `FOREACH`: iterate a bounded array with `itemVar`/`indexVar` and optional child steps.
- `FILTER`: keep items whose `predicate` (or child result) is truthy.
- `SORT`: stable sort by a field/path or expression; `direction` is `asc`/`desc`.
- `LIMIT`: retain at most the bounded `count`/`limit`.
- `SELECT`: select a path or a fixed list of fields.
- `TRANSFORM`: evaluate a data expression or bounded child sequence.
- `IF`: run one of `then`/`else` sequences.
- `PARALLEL`: run explicitly listed branches with bounded concurrency.
- `JOIN`: join strings or flatten branch results.
- `ASSERT`: fail closed when a condition is false.
- `RETURN`: produce the compact result for the Agent/Worker.

References use `{ ref: "name" }`, `{ var: "name" }` or `{ path: "field.name", from: { ref: "item" } }`. Built-ins are `input`, `last`, `item` and `index`. A literal containing an object with a `ref` key must use `{ literal: ... }` so it cannot be confused with a variable reference.

Use `ToolFlowCompiler` with the real `ToolRegistry` and `SkillRegistry`, then pass the compiled program to `ToolFlowExecutor`. A flow should include only the tools and data scopes required for its task and a short expiry. Keep the user-facing UI as a compact sequence; inspect the full DSL only from a developer/audit surface.
