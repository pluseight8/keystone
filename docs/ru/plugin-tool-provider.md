# Plugin ToolProvider

ToolProvider объявляет input/output schema, риск, capability и timeout. Вызов идёт `ToolRegistry → ToolPolicy → подтверждение владельца → PluginSandbox → provider`; прямой обход невозможен. Input/output валидируются, ограничиваются по размеру/времени, результат помечается `UNTRUSTED` и provenance. Отмена обязательна.
