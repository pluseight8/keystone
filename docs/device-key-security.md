# Device key security

A device key authenticates one trusted device; it is not the owner identity key. Pairing, authorization, revocation and privileged-device events use the typed device signing domain where available and retain legacy verification compatibility during migration.

Revocation is durable and propagated through the existing signed device/Noise transport. A revoked device cannot request privileged operations or AI compute. Device loss is handled by revoking the device and rotating affected group/community/vault epochs.
