# Безопасность device keys

Device key аутентифицирует конкретное trusted device и не заменяет owner Identity key. Pairing, authorization, revoke и privileged events используют typed device signing domain, сохраняя legacy verification для миграции.

Revocation durable и распространяется через signed device/Noise transport. Revoked device не может выполнять privileged operation или AI compute. При потере устройства его revoke сопровождается rotation соответствующих community/vault epochs.
