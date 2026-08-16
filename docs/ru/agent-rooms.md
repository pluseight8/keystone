# Agent Rooms

`AgentRoom` — временная подписанная рабочая область нескольких Personal
Agents. В ней есть явный список участников, expiry и небольшой список
`sharedContext`. Разрешены только `PUBLIC` и `USER_EXPLICIT`; private Memory,
чаты, файлы, credentials и состояние устройств остаются на устройствах
владельцев.

Владелец подписывает Room и отправляет её только участникам. Сообщение имеет
ограниченный размер, sender и data class и принимается только от точного
подписанного member agent. Replay, non-member, истёкшие комнаты и изменённая
подпись отклоняются. Участие в Room само по себе не выдаёт Keystone tools:
нужны отдельные visit capabilities и существующие ToolPolicy/approval.

Используйте Room для узкой задачи: сравнить доступность, объединить публичные
результаты исследования или договориться о передаче файла. В
`sharedContext` кладите только явно разрешённый итог, а не календарь, Memory
или историю чата целиком. Состояние и replay metadata переживают restart,
expiry и lifecycle остаются fail-closed.

Production network test создаёт Room Alice с Bob и Charlie, передаёт bounded
сообщение через Hyperswarm/Noise и отклоняет запись Mallory как non-member.
