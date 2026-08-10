<p align="center"><img src="../branding/logos/logo+text-of-logo.png" alt="Keystone" width="420"></p>

# Protocol (v0)

Messages are versioned envelopes: `{version, type, id, sender, recipient, nonce, expiresAt, body, signature}`. `body` is canonical JSON. Unknown fields are ignored; unknown versions are rejected. Never send raw PII outside an approved disclosure envelope.

Hyperswarm topic для identity-discovery — SHA-256 публичного ключа узла. Прямое соединение дополнительно использует Noise public key Hyperswarm; peer id хранится в hex/base64url. Фрейминг транспорта: 4-byte big-endian длина JSON envelope + UTF-8 body, лимит 16 MiB.

## Personal Ecosystem (Self devices)

`IdentityManager` keeps a 32-byte Master Seed in platform secure storage. A pairing QR is a `keystone://add-device?data=<base64url-json>` URI containing the seed only for the local, out-of-band transfer. Every device derives an Ed25519 signing key and a Curve25519 encryption key with libsodium's deterministic seed APIs using the domain-separated device id. The private swarm topic is `BLAKE2b-256("keystone:self-swarm:v1", MasterSeed)`; `HyperswarmTransport.joinSelfSwarm` accepts only a `Self` capability and the topic is never published.

`CrdtSyncAdapter` binds a `Y.Doc` to `Transport`: local Yjs updates are sent as `crdt.update`, and a new peer requests a state-vector diff with `crdt.sync.request`. Remote updates are applied with the adapter as origin, preventing echo loops. `DeviceSync` uses the same authenticated envelopes for clipboard, `browser_tab`, file offers, and file chunks. Both adapters enforce an explicit Self peer allow-list, expiry, nonce replay protection, and optional `SelfEnvelopeSecurity` signatures.

Self data-plane actions are implicitly trusted but audited. OS automation and external side effects remain double-confirmation actions and must be approved on the target screen.
