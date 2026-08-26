# Среда Browser Agent

Среда предоставляет типизированную границу браузера для единого Desktop
Shell. Браузер остаётся обычной вкладкой `browser` внутри pane/workspace;​
второго интерфейса браузера и отдельного хранилища объектов нет.

```text
вкладка браузера Desktop
  -> ограниченный BrowserPageState
  -> BrowserContextExtractor (только текущая страница)
  -> Browser Worker / Agent Bot
  -> типизированный BrowserIntent
  -> BrowserPolicy (scope, приватность, подтверждение, лимиты)
  -> host BrowserHostAdapter
  -> BrowserActionResult
```

`@keystone/browser-engine` экспортирует `BrowserAgentRuntime`,
`BrowserSession`, `BrowserPageState`, `BrowserIntent`, `BrowserActionResult`,
`BrowserContextExtractor`, `BrowserPermissionScope` и `BrowserArtifact`.
Host adapter не принимает JavaScript, CSS/XPath-селекторы, cookies, пароли или
произвольные пути файловой системы.

Поддерживаются навигация, история, ограниченные вкладки, semantic
click/type/select/scroll/submit, поиск/извлечение, screenshot, ограниченный
download, явная загрузка FileObject и ожидание состояния. Semantic-ссылка
несёт `pageRevision` и `elementRevision`; устаревшая ссылка отклоняется.

Автоматический сценарий работает как `OBSERVE -> PLAN -> ACT -> VERIFY` с
лимитами шагов, вкладок, навигаций, ошибок, downloads и времени. Pause/Take
Control при ручном действии повышает revision страницы, поэтому старый план
нельзя безопасно продолжить.

В workspace сохраняются только безопасные метаданные вкладки: очищенный URL,
session ID, origin, revision, data class и activity. Текст страницы,
скриншоты, cookies и credentials Desktop Shell не сохраняет.

Native Chromium/WebView/Gecko остаётся host boundary. Node test adapter нужен
только для детерминированных policy-тестов и не выдаётся за настоящий native
browser runtime.
