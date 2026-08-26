# Shorts

Shorts не создают вторую media-систему. `ShortVideoService` создаёт обычный подписанный `Video` с небольшим `shortForm` payload (`caption`, `aspectRatio: 9:16`). Video ID, media URI, manifest, cache и durable state общие для feed, chat, community и Video page.

`buildShortFeed` — локальная детерминированная проекция уже известных public Video. Private videos и заблокированные creators отфильтровываются; затем применяются follows, релевантность joined Communities, локальные interactions и recency. Центрального recommendation/analytics backend нет. `ShortVideoService.forTrack` находит public Shorts по тому же Track ID.

`ShortFeedController` управляет одним ограниченным playback lifecycle: ставит на паузу Short вне viewport, prefetch-ит не более двух следующих range через существующий `VideoPlaybackAdapter` и отменяет pending work при swipe/reset/close. Integrity chunks и cache quota/pinning остаются в общем content layer. Watch progress и bookmark локальны.

Mobile UI содержит full-screen vertical surface, autoplay, swipe, creator/caption, Track link, reaction/comment placeholders, share и follow. Decoder и social graph callbacks предоставляет host; central CDN, analytics и recommendation backend не требуются.
