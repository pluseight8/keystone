# Безопасность Browser Agent

Web-контент всегда имеет статус `UNTRUSTED`. Prompt injection может быть
сигналом, но не является границей безопасности. Граница — типизированные
intents, ограниченный context, BrowserPolicy, проверки revision и существующие
capability/confirmation policy Keystone.

`BrowserContextExtractor` передаёт только URL/origin/title, ограниченный
видимый текст, accessibility snapshot, semantic controls и необязательную
ссылку на screenshot. Полного DOM dump нет. Страница не может изменить
system policy, capabilities, ToolPolicy или confirmation state.

External execution отклоняется для страниц, artifacts и private FileObject с
классами `PRIVATE`/`SECRET`. Local и trusted-personal execution подчиняются
обычным permissions. Memory, DMs, private Communities, файлы, identity,
cookies, tokens и сохранённые пароли не попадают в browser context автоматически.

Host может выполнить одобренный пользователем autofill, но модель не видит
credential и его значение. Password field нельзя использовать как target для
model typing. Upload требует явного разрешённого FileObject; worker не ищет
private файлы локально.

Разрешены только HTTP(S) URL. Credentials в URL, `javascript:`/file URL и
опасные redirects отклоняются. Лимиты origins/tabs/navigation/actions/downloads
и runtime проверяются до вызова host. Для чувствительных действий отсутствие
подтверждения возвращает `NEEDS_CONFIRMATION` и host не вызывается.

Downloads проверяются по MIME/размеру, получают SHA-256 и возвращаются как
метаданные карантина `UNTRUSTED`. Произвольного JavaScript/eval escape hatch нет.
# Browser downloads и недоверенные файлы

Browser downloads сначала проходят typed `BrowserDownloadBoundary`  и остаются `UNTRUSTED` quarantine artifacts. Если host boundary недоступна, download завершается fail-closed. Browser Agent не может открыть, установить или выполнить download. Native host подключает его к `FileContainmentService` через `createBrowserDownloadContainmentBoundary`.
