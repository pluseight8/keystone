# Integrity root

`IntegrityRoot`/`ReleaseTrustRoot` is a host boundary, not a mutable application setting. It contains only the release public key, key id, environment and a verifier callback. The production release signing key is held by release infrastructure and is never generated or stored by this repository.

The manifest signature covers canonical JSON of every manifest field except `signatureMetadata`. Every required critical entry is read through a host `IntegrityFileReader`, hashed with SHA-256 and checked for declared size. Policy and protocol maps must resolve to the corresponding manifest entries; when a `MandatoryPolicyRoot` is supplied, its immutable references must match the manifest.

Trust classes are explicit:

- `IMMUTABLE_CORE` and `TRUSTED_RUNTIME` — release-signed security components;
- `SANDBOXED_EXTENSION` — separately reviewed package boundary;
- `USER_CONTENT` — mutable owner data;
- `UNTRUSTED_REMOTE_DATA` and `UNTRUSTED_MODEL` — never authority.

Recovery may inspect failure metadata, verify again, repair the host, or verify an authenticated recovery artifact. There is intentionally no ignore/continue path.
