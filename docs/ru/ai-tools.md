# AI-инструменты и capability policy

AI-инструменты предоставляют типизированную границу действий между AI-моделью и
Keystone. Она дополняет `AIOrchestrator`, `AIEgressFirewall` и Personal AI
Mesh и не заменяет их.

## Контракт

`Tool<I, O>` содержит входную `zod`-схему, выходную схему, список capability и
класс данных результата. Только `ToolRegistry` выдаёт непрозрачный одноразовый
`ToolIntent`. Модель не вызывает handler напрямую. `ToolExecutor` проверяет
intent, включённый `Skill`, `ToolPolicy`, а затем вызывает именованный host
adapter.

Базовые adapters: поиск `searchMemory`, `searchMessages`, `searchFiles`,
`searchMusic`, `searchVideos`, `searchCommunities`; чтение разрешённого
`FileObject` через `readAllowedFile`; `searchLocalContent` и
`openKeystoneObject`; действия `sendMessage`, `createGroup`,
`createCommunityPost`; воспроизведение `playTrack`/`openVideo`; управление
плейлистом `managePlaylist` и локальные напоминания `createReminder`.
Отсутствующий host callback означает, что tool не регистрируется. Вход и
выход проверяются схемой. Произвольные shell, eval, filesystem и network API в
core не предоставляются.

## Capability и приватность

Доступны `READ_PRIVATE`, `WRITE_PRIVATE`, `NETWORK_SEND`, `DEVICE_ACTION`,
`DESTRUCTIVE`, `SECURITY_SENSITIVE`. `READ_PRIVATE` разрешён только для
`local` или `personal_trusted`. `external` intent должен быть создан
`AIOrchestrator`, но private tool и результат `PRIVATE`/`SECRET` всё равно
запрещены.

Изменения, отправка и device actions проходят существующую Keystone policy и
подтверждение. `DESTRUCTIVE` и `SECURITY_SENSITIVE` требуют двух подтверждений.
Отмена происходит до handler, поэтому side effect не возникает.

`ToolResult` всегда содержит `AIDataClass` и не отправляется provider
автоматически. `prepareToolResultForExternal` отклоняет `PRIVATE`/`SECRET`;
public result можно передать наружу только явным вызовом.

`ToolAuditLog` хранит ограниченные metadata: model, source, skill, tool,
capability, policy, confirmation и класс результата. Prompt, аргументы,
имена файлов и значения результатов не записываются. Forged/replayed intent
отклоняется до запуска handler.
