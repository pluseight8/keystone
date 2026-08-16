# Real P2P network validation

`pnpm test:network` starts Alice, Bob, and Mallory as independent Node/Vitest
processes. They use separate identities, durable state directories and
production `HyperswarmTransport` instances. A temporary local HyperDHT
bootstrapper makes discovery deterministic and isolated from public DHT nodes;
the peer connection itself is a real Noise-encrypted Hyperswarm stream.

The suite verifies signed, encrypted direct messages; discovery, disconnect and
reconnect; offline outbox delivery; replay deduplication; restart persistence;
three-peer isolation; signed public-community replication; and a public-fixture
content transfer that resumes after interruption using the production
`ContentFetcher`, manifest and chunk hashes. It also sends a typed WebRTC offer
through the production `HyperswarmSignalingChannel`.

The content request/response framing exists only in the test process. Keystone's
production content contract deliberately leaves provider/network selection to
the host, so this is not a new blob-transfer protocol. Likewise, Node has no
native `RTCPeerConnection`: this proves real production signaling, not media
negotiation or audio/video transport. The controlled transport harness remains
the canonical deterministic fault suite.

CI runs this as the separate `Real P2P network` job. The suite cleans every
peer process, listener, Hyperswarm instance, DHT instance, connection and
temporary directory even on failure.
