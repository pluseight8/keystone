# Общие календари

Общий календарь — обычный Calendar object с подписанными membership. Участник получает только выданные permissions и disclosure. `VIEW_FREE_BUSY` не раскрывает название события; для деталей нужен `VIEW_EVENTS`.

Приглашение — подписанный объект, адресованный invitee, и может доставляться до появления membership через существующую P2P replication. Принятие создаёт membership и реплицирует новую ревизию календаря. Удалённый участник больше не может писать; delayed события не должны вернуть его доступ.

Shared calendar не превращается в private Community, Message group, Shared Space или Agent room. У этих систем свои permissions и encryption. Attachment остаётся ссылкой и не даёт доступа к файлу. Ссылки на Space/Workboard/WorkItem снова проходят permissions исходного объекта.

Production доставка использует Hyperswarm/Noise через `CalendarReplicationService`; controlled transport остаётся для deterministic fault tests. Все identity IDs и количество участников произвольны, а не зашиты в код.
