# Безопасность credential провайдера

Credential провайдера — это `PROVIDER_CREDENTIAL` в отдельном namespace. `OpenAICompatibleAIProvider` может использовать typed `ProviderCredentialCapability`; только adapter получает authorization header. Model payload, AI audit, Agent history, ToolFlow, Memory, RAG и Search credential не видят.

Legacy `apiKey`/token callbacks оставлены для совместимости и принадлежат host. Новые интеграции должны использовать capability и не хранить credential в settings JSON, URL, clipboard, renderer или plugin namespace.
