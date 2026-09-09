# Ссылки Keystone

Keystone Links — типизированные ссылки, а не bearer capabilities. Они
указывают на объект или стабильную поверхность приложения и не содержат
credentials, приватные payload или material разрешений.

## Канонические маршруты

```text
keystone://home
keystone://search
keystone://settings
keystone://music
keystone://video
keystone://shorts
keystone://files
keystone://documents
keystone://tasks
keystone://capture
keystone://ai
keystone://devices
keystone://network
```

## Канонические объекты

```text
keystone://file/<id>
keystone://document/<id>
keystone://task/<id>
keystone://capture/<id>
keystone://media/<id>
keystone://conversation/<id>
```

`task` и `conversation` — пользовательские aliases для типизированных
объектов shell `tasks` и `chat`. Для Vault notes, publication revisions, Maps
и других typed objects сохраняются расширенные формы, например
`keystone://vault/<vault-id>/note/<note-id>`.

Ссылку можно скопировать из вкладки или секции «Связи», вставить в omnibox,
выбрать в локальном Search или нажать в поддерживаемом Markdown preview.
Открытие ссылки создаёт либо активирует вкладку и выполняет обычную проверку
прав. Missing, deleted или больше не разрешённый объект показывается как
недоступный; Keystone не подменяет его другим объектом молча.

`KeystoneLinkRouter` проверяет схему, известный kind, ограниченный ID и
permission callback host. Наличие ссылки не раскрывает объект и не обходит
права Conversation, Community, File или Identity. Внешние HTTP(S)-URL
открываются в Browser surface и не получают приватный контекст Keystone
автоматически.

Drag & drop передаёт только минимальный `application/x-keystone-ref`; данные
проходят тот же router и permission boundary. Workspace snapshot сохраняет
только kind, ID, label и visibility. Credentials, prompts, private payload,
recovery material и private keys в ссылках не сохраняются.
