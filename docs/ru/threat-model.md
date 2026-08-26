
## Угрозы Plugin Distribution

Malicious source/peer может подменять версии, stall, flood metadata или портить chunks. Защита: bounded index/transfer, timeout/concurrency limits, per-chunk и final content-address verification, разделение source/transport, quarantine и owner review. Relay identities/routes не раскрываются Distribution или UI.

## Составной red-team connectivity gate

Слои – атакуются вместе в deterministic тестах и ограниченном
двухпроцессном доказательстве Hyperswarm/Noise. Security eligibility проверяется
до route scoring; relay custody, gateway acceptance, знание hash/cache,
reachability и соединение enrolled device не становятся application
authorization. Replay/dedup state ограничено и привязано к защищённой операции,
параллельные duplicate device-sync сериализуются до application effect, а
замена authenticated Noise socket покрыта regression test. Gateway result/replay
state ограничено, а gateway остаётся bridge только opaque Keystone frames, не
open proxy.

Эти меры не являются формальной верификацией и не обещают анонимность от
глобального наблюдателя. Посредники могут видеть timing, примерные размеры,
время встреч, RF/network proximity и transport endpoint metadata. Физическое
Bluetooth-доказательство зависит от хоста, а защита от rollback локального
состояния зависит от authenticated/secure storage boundary хоста.
