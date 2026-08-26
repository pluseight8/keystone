# Безопасность протокола

Каждый удалённый peer считается враждебной реализацией. Поля `official`, `admin`, `trusted` и `SAFE` сами по себе не дают полномочий.

Фиксированный pipeline: `bytes → bounded frame → bounded parse → signature → replay → protocol state → authorization → subsystem validation`. До JSON-парсинга проверяется длина frame; JSON ограничен по глубине, коллекциям, строкам, узлам и duplicate keys.

`ProtocolSecurityProfile` запрещает downgrade версий, crypto suites, подписей, replay protection и monotonic revisions. Подписи имеют domain separation по типу объекта и версии протокола. Авторизация использует cryptographic Identity ID, а не имя или роль из payload.

`ReplayWindow`, `MonotonicStateGuard` и `ProtocolStateMachineGuard` защищают replay, stale revisions, tombstones, revocations и epochs. `NetworkResourceGovernor` ограничивает соединения, frames, bytes, objects, pending requests и transfers; неизвестные identities не создают бесконечное состояние.

Protocol validation и обязательный `SafetySurfaceGate` остаются разными слоями. Ciphertext не передаётся plaintext safety classifier.
