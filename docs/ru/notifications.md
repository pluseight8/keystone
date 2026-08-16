# Локальные уведомления

Уведомления — ограниченная по размеру сохраняемая локальная проекция уже аутентифицированных Keystone objects. Каждая запись ссылается на исходные object ID и type; отдельная копия metadata контента не создаётся.

Поддерживаются direct messages, replies, reactions, follows, приглашения/упоминания в Community, новые Track, Video, Short, Live и comments. Сервис проверяет подписанный объект, отбрасывает собственные события, применяет block/mute/category/community policies, дедуплицирует по category/object/actor и хранит ограниченную историю (по умолчанию 200 записей).

Локальный API поддерживает unread count, mark-read, mark-all-read, mute категории/пользователя/сообщества, persistence после restart и необязательный `NotificationDeliveryAdapter`. Read status не публикуется peers. Block фильтруется повторно при чтении истории, поэтому последующий block убирает источник из представления приложения.

DM и media/community replication вызывают ту же проекцию после успешного аутентифицированного ingest. Исходный Chat, Community, Track, Video, Short или Live остаётся целью навигации.
