<p align="center"><img src="../branding/logos/logo+text-of-logo.png" alt="Keystone" width="420"></p>

# Protocol (v0)

Messages are versioned envelopes: `{version, type, id, sender, recipient, nonce, expiresAt, body, signature}`. `body` is canonical JSON. Unknown fields are ignored; unknown versions are rejected. Never send raw PII outside an approved disclosure envelope.

## Social protocol foundation (v1)

Social objects are separate from UI state and documented in [`object-model.md`](object-model.md). Direct messaging uses the existing signed transport envelope and existing device key material, but encrypts `social.message`, acknowledgement, and typing payloads for the final contact. A recipient rejects expired, replayed, oversized, malformed, unsigned, unknown-contact, or blocked-peer traffic before persisting it. Private social data is not synchronized through the Self Yjs document and is never published for discovery. See [`messaging.md`](messaging.md).

Profiles and public/contacts-visible follow events use the same signed object contract. They may be cached and exchanged over future social discovery/gossip routes, but do not require a Keystone username authority. See [`social-protocol.md`](social-protocol.md).

Communities add signed roles, channels, membership, and moderation events. A client stores only schema-valid, signature-valid objects and derives their effects locally from the event order and permission projection. See [`communities.md`](communities.md).

Large content uses a separate bounded chunk protocol rather than the general envelope payload. See [`content-addressing.md`](content-addressing.md) and [`media-p2p.md`](media-p2p.md).

Message attachments carry only signed content references and metadata; their bytes are fetched through the chunk layer. See [`attachments.md`](attachments.md).

Live broadcasts use signed immutable `scheduled`, `live`, and `ended` revisions, plus independently signed live-chat objects. WebRTC signalling stays in the transport boundary; viewers use a bounded peer-assisted tree rather than a mandatory streaming service. See [`streams.md`](streams.md).

Posts and comments form signed references over the existing object graph. Feed/search works on objects already locally known and validated; public discovery only advertises minimal metadata through an opt-in transport adapter. See [`discovery.md`](discovery.md).

Hyperswarm topic для identity-discovery — SHA-256 публичного ключа узла. Прямое соединение дополнительно использует Noise public key Hyperswarm; peer id хранится в hex/base64url. Фрейминг транспорта: 4-byte big-endian длина JSON envelope + UTF-8 body, лимит 16 MiB.

## Personal Ecosystem (Self devices)

`IdentityManager` keeps a 32-byte Master Seed in platform secure storage. A pairing QR is a `keystone://add-device?data=<base64url-json>` URI containing the seed only for the local, out-of-band transfer. Every device derives an Ed25519 signing key and a Curve25519 encryption key with libsodium's deterministic seed APIs using the domain-separated device id. The private swarm topic is `BLAKE2b-256("keystone:self-swarm:v1", MasterSeed)`; `HyperswarmTransport.joinSelfSwarm` accepts only a `Self` capability and the topic is never published.

`CrdtSyncAdapter` binds a `Y.Doc` to `Transport`: local Yjs updates are sent as `crdt.update`, and a new peer requests a state-vector diff with `crdt.sync.request`. Remote updates are applied with the adapter as origin, preventing echo loops. `DeviceSync` uses the same authenticated envelopes for clipboard, `browser_tab`, file offers, and file chunks. Both adapters enforce an explicit Self peer allow-list, expiry, nonce replay protection, and optional `SelfEnvelopeSecurity` signatures.

Self data-plane actions are implicitly trusted but audited. OS automation and external side effects remain double-confirmation actions and must be approved on the target screen.
