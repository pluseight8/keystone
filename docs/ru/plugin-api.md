# Plugin API

Plugin API v1 — стабильный типизированный контракт, независимый от версии Keystone. Плагины работают через `PluginHost`, sandbox и зарегистрированные поверхности; внутренние сервисы Core не являются API.

`PluginApiRegistry` согласует диапазон версии и feature IDs. `PluginExtensionRegistry` проверяет namespace `plugin:<pluginId>:...`, capability, revision hash и sandbox session, ограничивает quota и хранит только метаданные. После restart исполняемый код регистрируется заново.

Провайдер — недоверенный compute/content. OwnerAuthority, ToolPolicy, SafetySurfaceGate, секреты, протокол и PluginSandbox остаются под контролем Core. Shared output без решения Safety отклоняется.

## API distribution

Extension API может передавать package references и bounded discovery metadata, но только Core `PluginDistributionService` получает, quarantines, verifies и передаёт package installer. Source provider не может install, enable, grant capabilities или обходить Safety, Secrets, Sandbox и OwnerAuthority.
