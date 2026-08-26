<p align="center"><img src="../branding/logos/logo+text-of-logo.png" alt="Keystone" width="420"></p>

# Threat model

Assets: identity keys, contact data, browser sessions, automation capabilities. Threats: malicious peer, compromised renderer, replay, confused deputy, malicious theme, metadata leakage. Mitigations: signed capabilities, double confirmation, nonce/TTL, origin allow-list, CSP, sandboxed themes, append-only audit log, encrypted transport.

The threat model includes a dedicated secret asset class. System-managed identity/device keys,
group epochs, recovery material and provider credentials are never ordinary
application objects: only a trusted `SecureSecretHost` can use them through a
scoped handle/capability. AI, agents, Skills, plugins, browser renderers,
parsers, peers and logs receive no raw key bytes. Transport rejects inbound
secret-shaped system payloads before handlers.

Hyperswarm's Noise encryption protects transport confidentiality, but an inbound
envelope's claimed Ed25519 identity is not trusted until its application-level
signature is verified. Production hosts must persist consumed nonce/token IDs
in an encrypted database so a process restart cannot reopen the replay window.

The public rendezvous relay terminates a Noise connection from each client and
therefore protects each hop, not the complete client-to-client path. Relay
envelopes carrying private data must additionally use recipient-key
application-level encryption. The relay still observes source/target timing and
volume metadata; clients should prefer direct Hyperswarm connections.

Direct social messages add final-recipient public-key encryption and enforce bounded ciphertext before decryption. Their persistent nonce replay set, block list, and outbox belong in encrypted local storage; a process-local implementation is only acceptable in tests.

Live sessions expose timing, participant, and traffic-volume metadata to their selected upstreams. The client must validate signed lifecycle and chat objects, cap downstream forwarding, and not treat optional signalling/relay infrastructure as a trusted moderator, membership authority, or recording host.

Search and feed history are private local state. Public discovery adapters must never receive direct-message bodies, live-chat objects, private/contact/community content, or local ranking signals; remote discovery responses remain untrusted until their owning object service verifies schema and signature.

Local safety policy is loaded fail-closed before discovery is displayed. Per-peer ingress limits and malformed-packet penalties reduce local resource exhaustion but do not claim Sybil-proof identity or financial-grade abuse prevention; users and hosts retain control of all block, report, and export choices.

## Plugin distribution threats

Malicious sources/peers can equivocate versions, stall, flood metadata or corrupt chunks. Mitigations are bounded indexes/transfers, timeout and concurrency limits, per-chunk and final content-address verification, source/transport separation, quarantine and explicit owner review. Relay identities and routes are not exposed to Plugin Distribution or UI.

## Composed-connectivity red team

The connectivity layers are adversarially composed in deterministic
tests and a bounded two-process Hyperswarm/Noise proof. Security eligibility is
checked before route scoring; relay custody, gateway acceptance, cache/hash
knowledge, reachability and an enrolled-device connection never become
application authorization. Replay/dedup state is bounded and keyed to the
protected operation, concurrent device-sync duplicates are serialized before
application effects, and stale authenticated Noise-socket replacement is
covered by a regression test. Gateway result/replay state is bounded and the
gateway remains an opaque Keystone-frame bridge rather than an open proxy.

These controls do not claim formal verification or anonymity from a global
observer. Intermediaries may still observe timing, approximate sizes, encounter
timing, RF/network proximity and transport endpoint metadata. Physical Bluetooth
evidence remains host-dependent, and local persisted-state rollback protection
depends on the host's authenticated/secure storage boundary.
