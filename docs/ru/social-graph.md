# Социальный граф

Социальный граф Keystone — локальная проекция подписанных объектов. Каноническая идентичность — криптографический Identity ID; handle профиля является только подсказкой для отображения и не выдаётся центральным реестром.

## Профили

`identity.profile` подписывается автором и может содержать отображаемое имя, необязательный handle, URI аватара/баннера, описание, ссылки, признак автора и стабильную дату `joinedAt`. Публичные Track, Video, Short, Live и Community остаются ссылками на исходные object ID.

## Подписки

Объекты `follow` содержат `{ target, action: follow | unfollow }`, подписаны актором и передаются через существующий аутентифицированный Hyperswarm/Noise transport (`social.graph_object`). Получатель проверяет схему, подпись автора, подпись envelope, срок действия, replay по nonce и локальную block-политику. Хранилище дедуплицирует object ID и переживает restart. Глобального username или follower database нет.

`SocialGraphService` предоставляет локальные проекции following, followers, mutuals, relationship, block, mute и trust. Block применяется до выдачи состояния приложения и уведомлений; mute сохраняет доступность объекта, но скрывает его по локальной политике. Controlled transport остаётся для детерминированных fault-тестов, а real-network suite проверяет независимые процессы на production transport.

## Приватность и границы

Приватные профили и социальные объекты не отправляются в public discovery. Read state и настройки уведомлений остаются локальными. Если позже понадобится native push, host реализует `NotificationDeliveryAdapter`; core не зависит от Firebase, APNs или центрального сервиса.
