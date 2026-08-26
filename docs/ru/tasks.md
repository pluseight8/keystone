# Задачи, напоминания и личное планирование

Каноническая personal-planning подсистема — `TaskService` в
`packages/core/src/tasks.ts`. Она local-first,
permission-aware и platform-neutral. Это не второй Workboard, Calendar или
Chronos store.

## Каноническая модель

`TaskService` владеет bounded `TaskList` и `Task` records. У каждой записи есть
branded stable ID, revision, timestamps и tombstone state. Встроенный приватный
`task-list:inbox` нельзя удалить. Tasks поддерживают title/note, tags,
priority, start/due dates, typed references, assignee, stable fractional order
и bounded subtasks (максимальная глубина 8). Local search использует индекс;
bounded pagination даёт Inbox, Today, Upcoming, Overdue, Completed, Someday,
Assigned to me, Shared и Trash views.

`TaskDate` различает date-only и timed values. Date-only сохраняет календарную
семантику timezone владельца и не превращается молча в полночь UTC. Quick
capture — deterministic English/Russian parsing с preview и ambiguity marker;
AI не требуется, а текст задачи никогда не исполняется.

## Recurrence и напоминания

Recurrence хранится на одной задаче, без бесконечной materialization будущих
копий. Fixed и completion-relative rules поддерживают bounded daily, weekly,
monthly и yearly расписания, occurrence history, end date/count. Complete или
skip occurrence продвигает ту же задачу.

Delivery напоминаний — typed `TaskReminderScheduler` adapter над существующим
Chronos host. `TaskService` владеет reminder records и reconciliation, Chronos
владеет durable wake-up/delivery scheduling. Per-task timers нет. Delivery
idempotent по task/reminder/revision IDs, не завершает задачу автоматически,
missed reminders bounded/coalesced. Действия уведомления явные: complete,
snooze, open. Для SECRET references используется generic notification copy.

## Sharing и own-device sync

Private lists доступны только владельцу. Shared lists используют роли OWNER,
EDITOR, VIEWER, явные invitations, bounded expiry, membership epochs и
revocation. Typed replication events (опционально signed) проверяют actor,
list, revision, epoch, invitation и identity scope. Stale epochs, replay IDs,
cross-list payloads и unauthorized actors дают fail-closed.

Тот же replication adapter может доставлять события на
`ownerDeviceRecipients` — другие устройства того же владельца. Это optional
transport boundary, а не cloud dependency или новый device-mesh protocol.
Offline state остаётся usable, peers догоняют через существующий delivery
механизм. Shared Yjs collaboration подключается через bounded collaboration adapter и
не дублирует collaboration authority.

## References, projections и integrations

Tasks хранят typed references на существующие Keystone objects (`file`,
`vault`, `web-library`, `mail`, `message`, `place`, `calendar-event`,
`work-item` и другие). Reference — provenance, а не permission:
`openReference` делегирует availability/authorization source resolver, SECRET
references остаются private.

Calendar получает projections и явное создание time block через существующий
adapter. Workboards получают явное создание card; Workboard item можно
импортировать как Task с typed `work-item` reference. Daily Layer получает
bounded private Tasks source. Universal Inbox получает только открытые tasks,
assigned текущему владельцу; личные Tasks не становятся второй Inbox feed.

Agent/AI не получает task context автоматически. Нужен owner selection,
source permissions сохраняются, task text всегда data. Нет automatic
extraction из документов, mail, pages или AI output, location reminders и
productivity scores/streaks.

## Host surfaces

Desktop получил `desktop-tasks-runtime.ts` и first-class Tasks tab,
quick-capture preview, smart views, completion/trash actions и detail
projection. Mobile получил `tasksRuntime.ts` и `/tasks`; compatibility route
`/vault-tasks` указывает на ту же каноническую surface. Renderers — optional
host projections и показывают adapter boundary, если `TaskService` не
установлен. Они не создают store, timer, calendar event или replication
transport.

## Validation

Focused checks доступны через `pnpm test:tasks`; Tasks включены также в
`test:integration`, `test:network`, `test:performance` и `test:security`.
Отдельно проверяются core lint и desktop/mobile lint.

Заявленная development/validation environment — **Omarchy (Arch Linux-based
distribution)**, Node v22.23.2, pnpm 9.15.0, package engine `>=22 <23`.
Keystone остаётся platform-neutral, Omarchy не является обязательной
dependency.
