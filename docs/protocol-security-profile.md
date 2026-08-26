# Protocol Security Profile

`ProtocolSecurityProfile` is the typed minimum negotiated by Keystone. It declares envelope versions, cryptographic suites, Ed25519 signature requirements, replay protection, monotonic revision semantics, schema/decompression limits and connection/resource quotas.

The default profile is `keystone-protocol-security-v1`:

- envelope version 1;
- Ed25519 signatures with X25519/XChaCha20-Poly1305 or XSalsa20-Poly1305 application protection;
- replay windows and monotonic revisions required;
- compression disabled until a bounded decompression adapter exists.

Negotiation intersects limits and selects the strongest common mode at or above both local and remote minimums. A remote legacy/compatibility claim cannot weaken the local MandatoryPolicyRoot. Production hosts may provide a stricter profile, never a weaker one.
