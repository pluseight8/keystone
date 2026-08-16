# Проверка реальной P2P сети

`pnpm test:network` запускает Alice, Bob и Mallory как независимые Node/Vitest
processes с отдельными identity, durable state directory и production
`HyperswarmTransport`. Временный локальный HyperDHT bootstrapper изолирует test
от public DHT, а соединение peer-to-peer остаётся реальным Noise-encrypted
Hyperswarm stream.

Suite проверяет signed/encrypted direct messages, discovery, disconnect и
reconnect, offline outbox, replay deduplication, durable restart, изоляцию трёх
peers, signed public-community replication, а также public-fixture content
transfer с interruption/resume через production `ContentFetcher`, manifest и
chunk hashes. Typed WebRTC offer проходит через production
`HyperswarmSignalingChannel`.

Content request/response framing существует только в test process: production
content contract намеренно оставляет provider/network selection host-слою, это
не новый blob-transfer protocol. Node не имеет native `RTCPeerConnection`,
поэтому проверяется реальный signaling, но не media negotiation и не
audio/video transport. Controlled transport остаётся каноническим deterministic
fault suite.

CI запускает отдельный job `Real P2P network`. При успехе или ошибке suite
закрывает каждый peer process, listener, Hyperswarm/DHT instance, connection и
temporary directory.
