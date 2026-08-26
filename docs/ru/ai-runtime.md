# AI runtime

AI runtime предоставляет единый host-neutral слой поверх существующих локальных
RAG, capability policy и model adapters. Модель адресуется как
`provider/model`. Host регистрирует `AIProvider`, его `AIModel` и `AIRouter`;
router никогда не передаёт provider необработанный запрос приложения.

## Providers и lifecycle

- `AdapterAIProvider` оборачивает local text/stream adapter, включая имеющийся
  bridge llama.cpp.
- `OpenAICompatibleAIProvider` работает с OpenAI-compatible endpoint. Local
  provider принимается только для `localhost`, `127.0.0.1` или `::1`.
- `OllamaAIProvider` использует локальные `/api/chat` и `/api/tags`.
- Host может добавить LM Studio, другой localhost runtime или provider plugin.
  Регистрация не выдаёт plugin никаких Keystone capabilities.

`AIRuntime` даёт detect, health, start/load, streaming, unload, idle shutdown и
ограниченный crash recovery для local provider. Файлы моделей остаются в
существующем `LocalModelManager`/native boundary. Core не запускает shell и не
имеет unrestricted filesystem access.

## Routing

`AIRouter` выбирает default или fallback model. `private` task всегда local-only,
даже если выбран remote model или local model упала. Public/general task может
использовать local или external model. `AISettingsService` умеет полностью
отключить remote candidates.

`AISettingsService` сохраняет descriptors моделей, default/fallback refs,
context limits и переключатель external providers. API keys и OAuth tokens
передаются host через `getApiKey`/`getAccessToken`; они не попадают в settings
или audit.

Inference на доверенном личном устройстве описан в
[`personal-ai-mesh.md`](personal-ai-mesh.md). Это путь
`PERSONAL_TRUSTED_COMPUTE` через authenticated Keystone P2P, а не external
provider и не public AI-сервис; model weights остаются на host-устройстве.

## Tools и контекст Keystone

Модель возвращает только предложения `AIToolIntent`. `AIRouter.executeToolIntents`
спрашивает host `AIExecutionPolicy`, который отдельно разрешает и выполняет
каждое intent. Автоматического выполнения нет. Local context приходит как
классифицированные `AIContextItem` из RAG/Memory, Life Map, chats, files,
Communities, social graph, local search, Chronos и media objects.
`LocalAIContextPolicy` явно блокирует shell и raw filesystem.
