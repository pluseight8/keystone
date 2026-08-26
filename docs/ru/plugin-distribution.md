# Распространение плагинов

Keystone рассматривает пакет плагина как content-addressed объект. `PluginDistributionService` умеет искать и получать пакеты из независимых локальных, файловых, URL, P2P, content-address, trusted-index, USB, development, community и личных устройств источников. Центральный Store, аккаунт, CDN и постоянный Internet не обязательны.

Источник — только происхождение, а не доверие. Полученный пакет остаётся untrusted; получение ограничивает transfer, проверяет hash/integrity и supply-chain, затем передаёт пакет в quarantine. `prepareInstall` лишь отдаёт проверенный пакет существующему owner-review installer и приводит к `INSTALLED_DISABLED`; enable/execute не выполняются автоматически.
