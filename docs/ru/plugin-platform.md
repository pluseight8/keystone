# Платформа плагинов и аддонов

Плагины — отдельный класс доверия, не Keystone Core. Они расширяют только явно поддержанные точки через `PluginHost`; исполняемый код не является полномочием и установленный пакет не наследует права владельца.

Полученный пакет считается недоверенным и проходит quarantine, проверку манифеста, хешей, совместимости и зависимостей. Установка требует явного подтверждения владельца и завершается состоянием `INSTALLED_DISABLED`; включение — отдельное действие. `PluginRuntime` является границей адаптера, а production-адаптер должен быть изолированным runtime.

`PluginHost` — единственная граница Plugin ↔ Keystone. Capability объявляется в манифесте, но не выдаётся автоматически; grant привязан к версии/хешу, scope и владельцу и может быть отозван. Нет доступа к Core container, базам, ключам Identity, recovery material, SecretStore, shell, процессам, raw sockets и неограниченной шине событий. Shared/public публикация проходит `surface.publish` и SafetySurfaceGate; без gate — fail closed.

## Стабильный API

`PluginApiRegistry` согласует стабильные API/features независимо от версии релиза Keystone. `PluginExtensionRegistry` проверяет namespace, immutable revision hash, sandbox session, capabilities, compatibility и quotas. Stop/disable/quarantine/uninstall деактивируют registrations; сохраняются только метаданные, executable providers регистрируются заново после restart.

Typed surfaces: Tool, Skill, Model, Context, Search, Video, Music, Live, Calendar, File Handler, Object Renderer, Agent Capability, notifications, declarative UI и events. Тип provider не выдаёт доступ к данным. Output остаётся untrusted, bounded и attributable и проходит Core privacy, permissions, ranking, external-link policy и SafetySurfaceGate. External/hybrid models проходят AIEgressFirewall. Внешнее media всегда имеет source attribution, а native Keystone media остаётся независимым.

Публичный SDK (`@keystone/addons/sdk`) экспортирует только контракты, validators и `DEVELOPMENT_TEST` host, без Core containers и secrets. Connectivity для плагина — только coarse state/quality/delivery; relay identity, route, hops, IP и location недоступны.

Ошибки runtime изолированы crash boundary; provider timeout/crash возвращает typed health и не ломает native surface. Storage, pages, events, UI, tool output и streams ограничены и cancellable. Неизвестный Plugin object сохраняется opaque с пометкой «требуется add-on».

## Граница распространения

`PluginDistributionService` и `PluginSourceRegistry` поддерживают независимые источники без центрального registry. Acquisition content-addressed и transport-neutral; source metadata — только provenance. Получение никогда не означает install, enable или execute. Integrity, quarantine, supply-chain и owner review обязательны.
