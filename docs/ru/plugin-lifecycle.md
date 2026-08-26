# Жизненный цикл плагина

Install, enable, start, stop, disable, update, rollback, quarantine, recover и uninstall — явные проверяемые переходы. Пакет устанавливается выключенным; запуск до enable запрещён. Новые права при update требуют review.

## Distribution и recovery

Lifecycle: `DISCOVER → RECEIVE → VERIFY → REVIEW → INSTALL_DISABLED → ENABLE → APPLY/HEALTH_CHECK → ACTIVE`, с deterministic repair, quarantine, rollback и remove. Исчезновение source не ломает проверенный offline plugin. Recovery не является обходом policy.
