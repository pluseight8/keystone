# Fuzzing протокола

`ProtocolFuzzHarness` и `HostilePeerHarness` генерируют empty/truncated/oversized frames, duplicate keys, deep nesting, huge arrays, invalid enums, replay и случайные bytes. Проверяется отсутствие crash, unchecked allocation, privileged unlock, Safety bypass и capability creation.

Property-проверки покрывают domain-separated signatures, mutation invalidation, idempotent replay, stale revisions и bounded parser/resource state. Отдельный real-process regression через Hyperswarm/Noise отправляет forged SAFE object и absurd declared length, пока легитимные peers продолжают работать.
