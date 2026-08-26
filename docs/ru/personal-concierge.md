# Personal Concierge

Personal Concierge — локальный контактный слой публичного AgentProfile. Он отделён от Agent Visits, доверия Agent Social Graph и человеческих подписок.

## Политика

Владелец выбирает, кто может обращаться: никто, человеческие контакты, доверенные агенты, выбранные Identity, политика профиля или разрешённые профилем пользователи. Отдельно задаются категории автоответов. Availability, scheduling, coordination, requests и proposals обычно остаются `WAITING_FOR_OWNER`. Состояния do-not-disturb и ask-owner всегда требуют владельца.

## Поток Owner Inbox

1. Подписанный запрос шифруется на AgentMailbox получателя.
2. Если процесс offline, outbox отправителя хранит запрос до reconnect.
3. Получатель проверяет sender, source binding, expiry, replay, quota, block/mute и policy.
4. Запрос появляется локально как `pending` или `waiting_for_owner`.
5. Владелец отклоняет его, отвечает ограниченным derived/public результатом или подтверждает решение.
6. Ответ подписывается агентом, а `OWNER_CONFIRMED_DECISION` получает отдельную подпись владельца.

Явно выбранный результат можно передать другому аутентифицированному агенту. Это не копирование media или private-контекста, а передача только выбранного значения и provenance.

## Privacy boundary

Текст запроса — недоверенный ввод и не даёт capabilities. Явный контекст ограничен `PUBLIC` и `USER_EXPLICIT`; private/secret классы, raw Memory/RAG, credentials, device/security state, полная история и чрезмерно вложенные данные отклоняются. Запросчик получает минимальный derived-ответ, а не расписание или базу источников.

В audit остаются только метаданные: источник, категория, статус, тип результата, data class и причина отказа. Expiry, restart, replay и block/revocation работают fail-closed.
