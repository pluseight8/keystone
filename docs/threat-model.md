<p align="center"><img src="../branding/logos/logo+text-of-logo.png" alt="Keystone" width="420"></p>

# Threat model

Assets: identity keys, contact data, browser sessions, automation capabilities. Threats: malicious peer, compromised renderer, replay, confused deputy, malicious theme, metadata leakage. Mitigations: signed capabilities, double confirmation, nonce/TTL, origin allow-list, CSP, sandboxed themes, append-only audit log, encrypted transport.

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
