# Единый поиск

Search — локальный first слой над объектами, уже известными устройству. Keystone не изображает существование глобального поискового индекса.

`UnifiedDiscoveryService.search()` поддерживает Profiles, Communities, Tracks, Albums, Playlists, Videos, Shorts, Live, Posts и разрешённые локальным caller сообщения. Private message может быть добавлен только в Local Search уже авторизованным caller; он не попадает в discovery index, durable snapshot, advertisement или P2P envelope. Перед выдачей применяются visibility, блокировки автора/сообщества и `canView`. Запрос ограничен 1–128 символами, выдача — 1–100 результатов с cursor pagination.

Результаты используют исходный Keystone object ID. Track в DM, Community, Home и Search — один объект; Short не создаёт отдельную копию Video. Public P2P replication принимает только public schema-valid objects с действительной подписью и защищённым envelope. Expired/replayed/malformed/spoofed objects отклоняются.

Home, Following и Communities используют общий `RankingProvider`. Локальный AI можно подключить позже; cloud recommendation backend, central analytics, ads, payments и monetization отсутствуют.
