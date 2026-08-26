# Provider credential security

Provider credentials are `PROVIDER_CREDENTIAL` secrets in a provider-scoped namespace. `OpenAICompatibleAIProvider` may use a typed `ProviderCredentialCapability`; the adapter obtains an authorization header only at the network boundary. The model payload, AI audit, agent history, ToolFlow artifacts, Memory, RAG and Search never receive the credential.

Legacy `apiKey`/token callbacks remain for compatibility and are host-owned. New integrations should use the capability form and must not put credentials into settings JSON, URLs, clipboard, renderer state or plugin namespaces.
