# Изоляция Identity и ключей

Приватные ключи Identity остаются в доверенном identity/crypto host. Новые вызовы используют typed `IdentitySigningCapability`: `signIdentityObject`, `signProtocolEnvelope`, `signOwnerIntent`. Универсального API подписи для модели или tools нет. Legacy `DeviceSessionKeys` сохраняется только для совместимости и не передаётся AI, Agent, Skill, plugin, browser, renderer, peer, log или UI.

Домены подписи разделены: профиль, сообщение, owner intent, device, Shared Vault, Workboard, Safety и protocol. Подпись одного домена нельзя использовать для другой операции. Identity key и device key различаются; revoke и epoch rotation монотонны.
