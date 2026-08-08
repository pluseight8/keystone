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
