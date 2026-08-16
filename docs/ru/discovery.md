# Единая главная, discovery и ранжирование (Phase 21)

`UnifiedDiscoveryService` использует один локальный граф объектов для Home, Following, Communities, Search, ссылок в чате и ссылок в сообществах. Один ID Track/Video/Short/Live не дублируется между поверхностями. Short — это Video с `shortForm.aspectRatio === "9:16"`.

По умолчанию работает детерминированный `RankingProvider`: подписки, релевантность сообществ, давность, локальные реакции, история просмотра/прослушивания, сохранения, интересы и локальные trust hints. Провайдер можно заменить локальным AI без изменения media/P2P протокола. AI-индикатор сверху мобильного Home — только граница локального провайдера.

Состояние discovery, подписки и локальные interaction signals хранятся в отдельном зашифрованном host storage. История не публикуется и не отправляется peers без явного разрешения пользователя.

## Области

- **Local Search** — известные устройству Profiles, Communities, Tracks, Albums, Playlists, Videos/Shorts, Live, Posts и доступные сообщения.
- **Social Discovery** — опциональные trusted peers; каждый объект проходит проверку схемы, подписи и permissions.
- **Public P2P Discovery** — подписанный `social.discovery_object` поверх существующего Transport/Hyperswarm. В envelope идут метаданные объекта, а не media chunks.

Private DM, live-chat, contacts-only/community-only, blocked и malformed objects не попадают в public discovery. Центрального индекса, recommendation backend, analytics и глобального search server нет.
