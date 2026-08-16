# Видео (Phase 18)

`Video` — единый подписанный Keystone object с названием, описанием, ссылкой на Profile автора, thumbnail/cover, длительностью, размерами, codec/container/audio metadata, временем публикации, visibility и content-addressed URI. Chat, Community, Profile, Feed, comments и reactions ссылаются на один Video ID, не создавая копий медиа.

`VideoService.import` сохраняет локальные bytes в `VideoContentStore`, создаёт manifest и детерминированный Video ID. Повторный импорт тех же данных возвращает тот же объект. В DM и Community передаётся только Video ID, а `VideoReplicationService` доставляет исходный signed public Video поверх существующего P2P transport.

`VideoPlaybackSource` получает и проверяет только chunk, нужный для старта или seek. Это даёт playback до полного download, resume после прерывания и rejection corrupt chunks. `ContentCache` сохраняет quota/pinning, а progress, last position, completed и bookmark остаются локальными и не реплицируются.

`VideoProcessingAdapter` — local-first граница нативного host для подготовки/транскодирования. Metadata поддерживает source, 1080p, 720p, 480p и custom renditions, но Phase 18 не добавляет encoder, central server, CDN, DRM, ads, payments, analytics или recommendation backend.
