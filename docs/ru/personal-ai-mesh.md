# Personal AI Mesh

Phase 30 добавляет приватную compute-возможность для доверенных устройств
Keystone. Модель физически остаётся на host (например, Ollama, LM Studio или
llama.cpp), а телефон или планшет получают только metadata модели и подписанный
поток результата inference.

## Граница безопасности

`PersonalAIHost`, `RemoteLocalAIRuntime`, `AIComputeAdvertisement`,
`AIInferenceSession` и `AIComputeRouter` используют существующий подписанный
envelope `Transport`. Discovery — это прямой запрос известному trusted device;
нет public AI-topic, глобального registry, LAN-порта или cloud relay.
Host проверяет trusted-device state и revocation для каждого запроса и во время
streaming. После revoke устройство не может продолжить активную сессию.

Класс personal-device — `PERSONAL_TRUSTED_COMPUTE`, а не `EXTERNAL`.
`PersonalAIContextPolicy` собирает request локально и разрешает только
одобренный policy контекст классов `PUBLIC`, `USER_EXPLICIT` и `PRIVATE`.
`SECRET`, recovery material, identity keys, shell/filesystem sources и чужая
database state отклоняются. Внешний `AIEgressFirewall` не изменён: private task
никогда не переключается на OpenAI-compatible provider.

## Host и routing

Advertisement содержит только device identity, capability `AI_COMPUTE`, ссылки
на модели, context limits, признаки vision/tools, online/busy state, queue length
и expiry. В нём нет model weights, prompt, context, API keys или private database
записей. Host может загружать/выгружать модель через локальную provider boundary;
клиент не вызывает Ollama/LM Studio напрямую.

`AIComputeRouter` поддерживает `this-device`, конкретное trusted device и
`automatic`. Automatic учитывает наличие модели, online state, очередь и
настройку предпочтительного устройства. Private task может перейти только на
другой trusted personal node (или это устройство); если trusted/local node нет,
запрос завершается fail-closed.

`AIInferenceSession` даёт request IDs, bounded deduplication, bounded queue и
concurrency на host, streaming tokens, cancel, timeout, reconnect/replay и
восстановление после restart host. Stream events — подписанные envelopes с
монотонными sequence numbers.

## Host adapter

Host получает `AIProvider` (или `AIRuntime`) через `PersonalAIHost`. Та же
граница подходит для Ollama, LM Studio, llama.cpp и deterministic fake provider
в integration tests. Product code не открывает localhost API provider для других
устройств.

В мобильном AI settings экран разделяет:

- `LOCAL` — это устройство;
- `MY DEVICES` — `Trusted Personal Device`, найденные через Keystone P2P;
- `EXTERNAL` — providers без доступа к private Keystone context.

В этот слой не входят payments, ads, marketplace, compute economy, telemetry,
обязательный cloud или доступ посторонних к GPU пользователя.
