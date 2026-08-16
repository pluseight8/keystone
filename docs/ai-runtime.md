# AI runtime

Phase 29 adds one host-neutral AI layer on top of Keystone's existing local
RAG, capability policy and model adapters. A model is addressed as
`provider/model`. Hosts register an `AIProvider`, its `AIModel` descriptors and
an `AIRouter`; the router never hands a raw application request directly to a
provider.

## Providers and lifecycle

- `AdapterAIProvider` wraps a host-provided local text/stream adapter, including
  the existing llama.cpp bridge.
- `OpenAICompatibleAIProvider` supports an OpenAI-compatible endpoint. A local
  provider is accepted only when its endpoint resolves to `localhost`,
  `127.0.0.1` or `::1`.
- `OllamaAIProvider` speaks Ollama's local `/api/chat` and `/api/tags` API.
- A host may implement `AIProvider` for LM Studio, another localhost runtime,
  or a provider plugin. Registration does not grant the plugin any Keystone
  capability.

`AIRuntime` supplies detect, health, start/load, streaming, unload, idle
shutdown and bounded crash recovery around a local provider. Model files remain
under the host's existing `LocalModelManager`/native boundary. The core does
not execute shell commands or access an unrestricted filesystem.

## Routing

`AIRouter` selects a configured default or fallback model. A `private` task is
local-only, even when a remote model is explicitly selected or the local model
fails. A general/public task may use local or external models. Disabling
external providers in `AISettingsService` removes remote candidates entirely.

`AISettingsService` persists model descriptors, default/fallback references,
context limits and the external-provider switch. API keys and OAuth tokens are
host secrets and are supplied through `getApiKey`/`getAccessToken`; they are not
settings or audit data.

Trusted personal-device inference is documented in
[`personal-ai-mesh.md`](personal-ai-mesh.md). It is a
`PERSONAL_TRUSTED_COMPUTE` path over authenticated Keystone P2P, not an
external provider or a public AI service; model weights remain on the host.

## Tools and existing Keystone context

The model returns `AIToolIntent` proposals. `AIRouter.executeToolIntents` asks a
host `AIExecutionPolicy` to authorize and execute each intent. Execution is not
automatic. Local context is supplied as classified `AIContextItem` values from
RAG/Memory, Life Map, chats, files, Communities, social graph, local search,
Chronos and media objects. `LocalAIContextPolicy` explicitly excludes shell and
raw-filesystem sources.

Streaming is available through `AIRouter.stream`, `AIProvider.stream` and the
existing llama.cpp/Ollama boundaries. Native hosts own process startup,
hardware selection, model downloads and OS permissions.
