# Граница приватности AI

External AI считается недоверенным egress. Каждый remote request строится
через `AIEgressFirewall`; provider adapter не может обойти firewall.

| Класс | External provider |
| --- | --- |
| `PUBLIC` | разрешён |
| `USER_EXPLICIT` | разрешён |
| `PRIVATE` | по умолчанию удаляется |
| `SECRET` | всегда запрещён |

Текущий текст, который пользователь явно отправил AI, имеет класс
`USER_EXPLICIT`. Context, history, attachments, nested-agent results и tool
arguments должны иметь класс. Поэтому private RAG, Life Map, DMs, private
Communities, files и filenames, contacts/social graph, Identity/device data,
notifications, location, watch/listen/search history и private tool results не
попадают в обычный external payload. Если private context приложен к public
request, он удаляется, а класс записывается в audit; в provider он не
сериализуется. Task с классом `private` отклоняется для любого remote model.

Firewall заменяет непубличный system material на safe system prompt, ограничивает
размеры, удаляет private nested/tool-intent values и запускается заново для
каждого fallback candidate. Provider fallback, plugins, attachments и agent
chaining не создают обходного egress. Remote model может только предложить
tool intent. Решение о локальном выполнении принимает Keystone policy; private
tool result не возвращается remote model автоматически.

`AIAuditLog` хранит provider/model, local/remote scope, data classes, названия
requested tools и решения allow/redact/deny. Тексты prompt, values context,
API keys и recovery material намеренно не сохраняются. Log ограничен по размеру
и остаётся локальным.

## Обязанности host

Host должен классифицировать данные на boundary, хранить credentials в secure
secret store и выдавать local AI только существующие capability-scoped services.
Private values нельзя помещать в `PUBLIC` system prompt. `SECRET` остаётся
только локальным; отсутствие local runtime для private task означает fail
closed. В Keystone нет central AI server, обязательного cloud, telemetry,
рекламы, платежей или monetization.

