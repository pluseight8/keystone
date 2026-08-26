# Recovery security

Cold backups are authenticated and encrypted with libsodium. Backup metadata may expose version, date and approximate size, but never a recovery phrase, plaintext key, adjacent encryption key or secret-bearing audit record. Restore stages into a transaction and commits only after authentication and schema validation.

Recovery export/import is an explicit owner action with expiry, nonce/replay protection and strong confirmation. Wrong phrases, tampering, truncation, unsupported versions and replayed intents fail cleanly without touching live state. Cache is optional and can be recovered from P2P; identity/security state is handled by the trusted secret boundary.
