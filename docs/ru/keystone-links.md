# Keystone Links

Keystone Links — типизированные ссылки, а не bearer capabilities.

```text
keystone://profile/<object-id>
keystone://chat/<object-id>
keystone://space/<object-id>
keystone://file/<object-id>
keystone://agent/<object-id>
keystone://media/<object-id>
```

Одна ссылка может быть открыта из Chat, Community, Home, pane или workspace и
везде указывает на один объект. `KeystoneLinkRouter` проверяет схему, kind,
ограниченный ID и host permission callback. Private/revoked/deleted объект
становится locked или отклоняется. Наличие ссылки не раскрывает объект и не
обходит права Conversation, Community, File или Identity.

Web URL открывается в Browser surface и не получает автоматический доступ к
Memory, File, chats, private context или tools Keystone.

Drag & drop передаёт только минимальный `application/x-keystone-ref`; данные
проходят тот же router и permission boundary. Workspace snapshot сохраняет
только kind, ID, label и visibility. Credentials, prompts, private payload,
recovery material и private keys в ссылках не сохраняются.
