# Расширенный Vault

В  Markdown остаётся переносимым источником истины. `DailyNoteService`,
`VaultTemplateService`, `VaultBookmarksService`, `VaultQuickSwitcherService` и
`VaultTaskIndexService` работают поверх существующего `VaultService`; sidecar-
индексы производны и могут шифроваться host-ом.

Ежедневные заметки поддерживают папку, формат даты/имени и Markdown-шаблон.
Ссылки на календарь, задачи и активность остаются обычным Markdown.
Шаблоны расширяют только объявленные строковые переменные — без JavaScript,
shell, произвольной файловой системы и вызова tools.

Закладка — это ссылка, а не разрешение: заметка, heading, block, поиск,
графовый запрос, Canvas, папка или Keystone object. Quick Switcher ограниченно
ищет по локальному индексу. Задачи — Markdown-чекбоксы; превращение в WorkItem
только явно.
