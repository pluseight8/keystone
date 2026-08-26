# Единый desktop shell

Keystone Desktop теперь использует единую среду в стиле browser/workspace.
Shell отвечает только за навигацию и раскладку поверх существующих Identity,
content, transport, social, storage и AI-сервисов.

## Архитектура

`DesktopShellController` объединяет bounded-компоненты:

- `TabManager` — открытие, закрытие, дублирование, закрепление, порядок,
  dirty/locked-состояние и ограниченный стек закрытых вкладок;
- `PaneManager` — горизонтальные/вертикальные вложенные split (максимум три
  уровня), фокус, resize и перенос типизированных вкладок;
- `WorkspaceManager` — имена workspace, tabs, pane tree, активная pane,
  порядок Activity Bar и размеры панелей;
- `DesktopNavigation` — Back/Forward для Keystone-объектов и web-страниц;
- `KeystoneLinkRouter` — проверка разрешений для `keystone://` и web URL;
- `ContextProviderRegistry` — типизированные провайдеры правого Context Sidebar.

Вкладка хранит только `KeystoneObjectReference` (`kind`, `id`, visibility и
короткий label). Она не копирует Track, File, сообщение, Memory или media.
Доменный сервис остаётся источником данных и авторизации.

## Поверхности

Есть Activity Bar, toolbar/Omnibox, верхняя полоса вкладок, bounded pane tree,
необязательный Context Sidebar, Agent Bot panel и небольшой status area.
Доступны Home, Agent Bot, Chat, Profile, Community, Space, Vault, Calendar,
Maps, File, Music/Media, Video, Settings и Browser. Maps — host-adapter
поверхность: она может показывать local/offline providers, искать Places,
строить manual route и вызвать явное one-shot location action, но shell
не читает ambient location и не придумывает provider data. Ссылка
`keystone://place/<id>` открывает Maps как typed Place reference.

Quick Actions маршрутизирует Message, Group, Space, Note, Canvas, Calendar
Event, Task, File, Agent и Community в типизированные object references.
Перетаскивание File из Chat в Space передаёт ссылку, а не создаёт копию.

## Граница Agent Bot

Agent Bot доступен из любой вкладки (Ctrl/Cmd+Space). На панели явно показан
активный объект и его ID. Для Browser вкладки scope ограничен origin/revision
текущей страницы; содержимое считается untrusted и приходит через
`BrowserContextExtractor`. Открытие панели не добавляет весь workspace,
private history, соседние panes, cookies или credentials. Реальный
AgentRuntime подключается через существующие capability и egress policies.

Browser вкладка принимает `DesktopBrowserRuntimeState` и
`applyBrowserActionResult` от host adapter. При restore сохраняются только
безопасные session ID, origin, revision, data class и activity; текст страницы
и секреты не сохраняются. Подробности — в [Browser Agent Runtime](browser-agent-runtime.md)
и [Browser Security](browser-security.md).

## Persistence и безопасность

Раскладка хранится локально в versioned keys
`keystone.desktop.workspaces.v1` и `keystone.desktop.current-workspace.v1`.
Повреждённое состояние заменяется безопасным Personal workspace. Перед
сохранением URL удаляются credentials, hash и common secret query parameters
(`token`, `secret`, `password`, `key`, `auth`). Prompt, private payload и
private key shell не сохраняет.

После revoke объектная вкладка становится locked или закрывается; restore не
выдаёт новое permission. `keystone://` — это ссылка, а не токен авторизации.

## Старт, команды и workspace

Стартовая поверхность — локальная настройка. Host может открыть последний
объект после повторной проверки permission, Home, Feed, Video, Messages,
Storage или выбранный workspace. Если сохранённый объект исчез или больше не
разрешён, открывается безопасная fallback-поверхность.

Omnibox принимает типизированные `keystone://` references, HTTP(S)-URLs,
ограниченный local search и небольшой набор команд (`> Open…`, `new message`,
`split pane`, `settings`). Вопрос на естественном языке открывает Agent Bot
только с scope активного объекта. Неизвестные схемы, виды объектов и
некорректные ID отклоняются; navigation URL никогда не выдаёт permission.

Command Palette содержит Open, New message, New Space, New note, Calendar
Event, Search, Ask Agent Bot, Settings, sidebar, pane, tab и workspace actions.
Команды расширений остаются неактивными, пока их не разрешит plugin policy.
Workspace — локальная запись раскладки: она хранит ссылки вкладок, bounded
pane tree, состояние sidebar и порядок Activity Bar, но не вторую копию объекта.

История навигации ограничена 100 записями. Back и Forward используют
существующую вкладку или тот же permission-checked object router; перед
сохранением из web URL удаляются credentials, secret query parameters и
fragments.

Model/integration tests находятся в
`apps/desktop/src/desktop-shell-model.test.ts`. Mobile navigation сохраняется
отдельной.
