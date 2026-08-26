# Модель безопасности плагинов

Получен ≠ установлен ≠ включён ≠ доверен ≠ неограничен. Плагин не получает секреты, owner authority, обход ToolPolicy/Safety, mesh topology или raw external links. Текущая модель включает версионируемый API, реестр расширений и типизированные provider-поверхности, не ослабляя sandbox: исполняемый provider привязан к revision/session и проходит через PluginSandbox. Сбои, offline и большие ответы изолируются timeout/pagination; platform-specific гарантии сообщает host adapter.

## Безопасность lifecycle

Discovery и source trust не являются package authority. Downloaded bytes остаются quarantined до integrity, signature/provenance, compatibility, dependency и owner review. Updates staged; permission expansion останавливается на явном review. Offline/local/P2P используют те же проверки.
