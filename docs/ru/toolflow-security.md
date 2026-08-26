# Безопасность ToolFlow

ToolFlow не заменяет authorization: это программа с grant, всегда являющимся подмножеством grant вызывающего агента.

До запуска проверяются creator, revision/expiry/integrity, allow-list операций, наличие tool/skill, точные capabilities, data scopes, typed references, статическая стоимость, циклы и forbidden dynamic fields (`shell`, `eval`, scripts, commands).

Во время запуска каждый `CALL_TOOL` создаёт новый opaque `ToolIntent` через `ToolRegistry` и вызывает только `ToolExecutor`. Поэтому существующие ToolPolicy, подтверждения и double confirmation остаются обязательными. Retry явный и ограниченный; partial failure возможен только при `continueOnError`.

На checkpoint проверяются cancellation, runtime/expiry, steps, iterations, fan-out, intermediate bytes и размер trace. Parallel сохраняет порядок результата и не создаёт неограниченную работу. Tool output, browser page и remote content не могут изменить программу или повысить capabilities.

Класс данных и provenance переносятся через каждый intermediate value. Объединение значений сохраняет самый строгий класс; PRIVATE/SECRET нельзя понизить через TRANSFORM, SELECT, branch, retry или artifact. External execution отклоняется, а private/secret artifact нельзя подготовить для внешнего provider. Trace содержит только IDs, classification, размеры, статусы и время.
