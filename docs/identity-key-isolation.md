# Identity and key isolation

Identity private keys stay in the trusted identity/crypto host. New callers use `IdentitySigningCapability` with typed operations: `signIdentityObject`, `signProtocolEnvelope` and `signOwnerIntent`. There is no generic model/tool signing API. Existing raw `DeviceSessionKeys` access is a legacy compatibility boundary and must not be passed to AI, agents, Skills, plugins, browser code, renderers, peers, logs or UI.

Signing domains are separated (`KEYSTONE_IDENTITY_PROFILE`, `KEYSTONE_MESSAGE`, `KEYSTONE_OWNER_INTENT`, `KEYSTONE_DEVICE`, `KEYSTONE_SHARED_VAULT`, `KEYSTONE_WORKBOARD`, `KEYSTONE_SAFETY_ATTESTATION`, and protocol-specific domains). A signature from one domain cannot authorize another operation.

Identity and device keys are distinct. Device trust/revocation is checked before privileged events, and private-community/vault epochs are monotonic: removed members cannot access future epochs and stale ciphertext cannot roll state back.
