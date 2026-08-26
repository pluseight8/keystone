# Визиты AI-агентов

Визиты агентов используют небольшой протокол поверх существующего подписанного
`Transport` Keystone (в production — Hyperswarm/Noise). Это не новый runtime,
relay или сервер. `AgentVisitService` управляет только lifecycle и capability
boundary; host может подключить существующие `AgentRuntime` и `ToolPolicy`
через `onGuestRequest`.

Посетитель подписывает `AgentInvitation` для конкретного host-агента и
ограниченного списка capabilities. Host явно принимает приглашение и выдаёт
подписанные `AgentVisit` и `AgentDelegationToken`. Каждый запрос повторно
проверяет identity, expiry, replay, capability, approval и локальную session.
Host callback может вернуть только ограниченный результат класса `PUBLIC` или
`USER_EXPLICIT`. Private/secret Memory и unrestricted tools в типе результата
отсутствуют.

Поддерживаются `talk_to_host_agent`, `read_shared_context`,
`write_shared_workspace`, `search_public_objects` и явно названный
`use_specific_tool`. Последний всё равно проходит обычные ToolPolicy и
подтверждение; протокол визита сам инструменты не запускает.

Режимы подтверждения: `ASK_EVERY_TIME`, `ALLOW_THIS_VISIT`,
`ALLOW_THIS_AGENT`, `DENY`. Grant имеет scope, expiry и `maxUses` и расходуется
только после безопасного host result. Отзыв подписывается, сохраняется и сразу
закрывает pending и новые запросы; expiry работает fail-closed.

Remote agent помечен как `untrusted: true`. Он не может запросить
`read_private_memory`, передать private data class, повторить request, подделать
чужое приглашение/token или повысить capability. Слой визитов не импортирует
Memory и не передаёт plaintext private audit. Реальный network suite проверяет
Alice → Bob через Hyperswarm/Noise, отказ private Memory, forged invite Mallory,
revoke и restart.
