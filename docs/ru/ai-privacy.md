# Граница приватности AI

External AI считается недоверенным egress. Каждый remote request строится
через `AIEgressFirewall`; provider adapter не может обойти firewall.

Managed `SecretHandle`, credential capability и key-shaped поля отклоняются
даже при ошибочной маркировке PUBLIC. Ни local/trusted model, ни external
provider не получают raw key material; credential используется только внутри
adapter authorization и не попадает в history, RAG или audit.

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
closed. В Keystone нет central AI server, обязательного cloud, telemetry или
центрального account path.

## Граница Photos и Local AI

Photos metadata, originals, thumbnails, EXIF GPS, Vault state, albums, captions
и search results private by default. Local AI adapter может работать только с
явно выбранным локальным media и bounded local runtime. Это untrusted compute:
он не может publish/share/delete, менять visibility, unlock Vault, infer/name a
person, создавать movement/Home/Work history или превращать GPS в location
profile.

External AI не получает Photos implicit. Любой будущий export проходит
`AIEgressFirewall`, explicit owner action и data-class rules; private original и
embedded GPS запрещены без intentional safe metadata-stripped derivative. Нет
обязательных OCR, face recognition, automatic captioning, nostalgia
notification или background media indexing.

Сохранённые Web Library страницы — untrusted source material, а не instructions.
Capture и offline rendering не вызывают Agent, Browser, Plugin или NativeHost
capabilities. Будущий AI summary/search обязан быть explicit, bounded,
provenance-bearing и пройти `AIEgressFirewall`; private archive text не
передаётся external provider автоматически. Link, note или reader block не
разрешают publication, form submit, credential use, origin fetch или tool
execution.

## Universal Inbox и AI

Inbox не становится automatic AI context. Explicit owner action может выбрать
bounded local-AI projection с presentation text и source labels, но не с
credentials, arbitrary source body или action callback. External AI не получает
Inbox implicit; модель не создаёт и не approve-ит source actions. Prompt
injection остаётся untrusted text, а automatic memory ingestion отсутствует.
