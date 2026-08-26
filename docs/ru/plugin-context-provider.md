# Plugin ContextProvider

Провайдер получает только явно выданный bounded scope и возвращает ContextObject с source, privacy, expiry, trust и provenance. Нет `getAllContext()` и полного Memory. Plugin context считается untrusted: prompt injection не меняет policy/capabilities.
