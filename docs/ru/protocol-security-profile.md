# Профиль безопасности протокола

`ProtocolSecurityProfile` задаёт minimum для envelope versions, crypto suites, Ed25519 signatures, replay protection, monotonic revisions, schema/decompression limits и quotas.

`keystone-protocol-security-v1` использует envelope v1, Ed25519, X25519/XChaCha20-Poly1305 или XSalsa20-Poly1305, обязательные replay windows и monotonic revisions. Compression отключён до появления bounded decompression adapter.

Negotiation пересекает limits и выбирает только режим не слабее local и remote minimum. Legacy/compatibility claim не может ослабить MandatoryPolicyRoot.
