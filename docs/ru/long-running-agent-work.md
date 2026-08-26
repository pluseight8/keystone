# Долгая работа агентов

TaskGraph описывает один bounded execution plan. Workboard нужен, когда работа
должна пережить AgentRun и хранить ownership, dependencies, claim leases,
human approval, artifacts, activity и restart/offline recovery.

Рекомендуемый порядок:

1. Создать `PERSONAL` board либо `SHARED_SPACE` с явным Space grant.
2. Объявить только необходимые capabilities и data scopes.
3. Создать WorkItem со стабильным ID для повторяемого события.
4. Добавить prerequisites без циклов.
5. Взять item в claim с уникальным execution key и отправлять heartbeat.
6. Завершить, освободить, поставить на паузу или дождаться stale recovery.
7. Вернуть bounded artifact/comment с provenance и data class.
8. Для решения пользователя перейти в `NEEDS_USER` и ждать Owner Inbox.

Сбой executor, подписи, revision, scope, artifact или private external path —
явный fail-closed. Stale claim никогда не остаётся `RUNNING`; terminal item
повторяется только явно. Snapshot не содержит KV cache и нерелевантную private
database.

Workboard использует существующий AIResourceScheduler и не создаёт второй
scheduler. `USER_INTERACTIVE` получает приоритет; GAMING паузит фон, BATTERY
откладывает дорогую работу, PERFORMANCE может использовать допустимую
concurrency. Chronos/Automation остаются источником расписаний и событий.

Членство человека, Agent и worker — отдельные grants. Agent Visit или trust не
дают доступ к доске. Worker получает только явный grant и не может расширить
tools/data. `NEEDS_USER` нельзя обходить автоматизацией.

Перед выпуском запускайте `pnpm test`, `pnpm test:integration`,
`pnpm test:network`, `pnpm build`, `pnpm release:check` и `git diff --check`.
Проект некоммерческий: без платежей, рекламы, подписок, marketplace и
центрального Workboard-сервиса.
