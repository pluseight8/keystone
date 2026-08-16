# Keystone Live (Эфиры)

Keystone Live — минимальный local-first слой прямых эфиров. `LiveBroadcastObject` — обычный подписанный объект Keystone со стабильным `broadcastId`; один и тот же объект можно ссылать из личного сообщения и сообщения сообщества (`live_broadcast`). Ревизии проходят `scheduled → live → ended` и содержат автора/профиль, видимость, необязательные Community и Track, URI записи и возможности источников.

## Транспорт и топология

Публичные объекты жизненного цикла, чата и реакций передаются в подписанных envelope `social.live_object` через существующий Transport. Эфиры только для контактов блокируются до появления group-encrypted object path. Для видимости Community обязательна ссылка на Community. Центрального stream-сервера, CDN, реестра аккаунтов, монетизации, рекламы и аналитического сервиса нет.

Сигналинг WebRTC использует существующий `HyperswarmSignalingChannel` и подписанный Noise envelope. `LiveSessionController` поддерживает ограниченное дерево: у зрителя один upstream, у forwarder конечное число дочерних peers. Локально обрабатываются duplicate join, block, reconnect, удаление поддерева при disconnect, stale cleanup и остановка broadcaster. В будущем host сможет заменить политику дерева на peer-assisted relay; новый media-протокол не добавляется.

## Граница host media

`LiveWebRtcMediaAdapter` — типизированная граница для native/browser `RTCPeerConnection`. Host предоставляет захват, decoder, ICE и WebRTC lifecycle; core предоставляет подписанные объекты, сигналинг, права доступа и ограниченное состояние сессии. `LiveRecordingAdapter` может вернуть обычный `VideoObject` после записи host. Node/Linux CI проверяет production Hyperswarm discovery, подписанную репликацию lifecycle и signaling, но не объявляет native WebRTC playback пройденным, если `RTCPeerConnection` недоступен.

## Mobile UI

В мобильной вкладке Live есть список, страница эфира, host-provided player surface, локальная приблизительная статистика зрителей, чат, реакции, sharing, ссылка на Track now-playing и start/stop. Экран показывает только установленный runtime и не подменяет P2P-путь центральным URL. Чат использует единые social objects.

`PersistentLiveStorage` сохраняет принятые ревизии lifecycle и чата в предоставленной host локальной зашифрованной state boundary; `InMemoryLiveStorage` используется только в точечных тестах.

## Проверка

Controlled integration tests проверяют подписи, visibility, duplicate/block/stale cleanup, ограниченный reconnect и распространение ended. Real network suite запускает независимые процессы Alice, Bob и Charlie на локальном HyperDHT bootstrap, передаёт подписанный Live object, live chat и offer/answer/end через Hyperswarm/Noise. Это считается проверкой production signaling; native WebRTC media явно **не тестируется**, пока host не предоставит настоящий peer connection.
