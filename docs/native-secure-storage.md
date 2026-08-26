# Native secure storage / Защищённое хранилище

`NativeSecureStorage` exposes metadata and opaque `NativeSecretHandle`; bytes cannot be read or serialized by Core/Plugin/AI. Production Linux currently reports `UNAVAILABLE` until an OS-backed adapter is installed. The test adapter is memory-only and explicitly marked `TEST_MEMORY`; it is never selected by production detection. No hardware-backed claim is made.

Sign/decrypt are bounded operations; caller capability and owner/core provenance are checked. LegacySecretCompatibilityBoundary and raw private-key APIs are not reachable from this package.

# Защищённое храни��ище

`NativeSecureStorage` exposes metadata and opaque `NativeSecretHandle`; bytes cannot be read or serialized by Core/Plugin/AI. Production Linux currently reports `UNAVAILABLE` until an OS-backed adapter is installed. The test adapter is memory-only and explicitly marked `TEST_MEMORY`; it is never selected by production detection. No hardware-backed claim is made.

Sign/decrypt are bounded operations; caller capability and owner/core provenance are checked. LegacySecretCompatibilityBoundary and raw private-key APIs are not reachable from this package.
