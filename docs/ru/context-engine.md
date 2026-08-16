# Context Engine агента

Только `ContextBuilder` получает Memory/RAG, Life Map, chats, files, social
graph, Communities, local search, history и explicit attachments. Host
реализует `AgentContextSource.read()` и маркирует каждый item capability,
source и `AIDataClass`.

Builder запрашивает лишь allowlist текущей сессии и отклоняет malformed ids,
`SECRET`, shell/filesystem sources и классы вне policy. `ContextBudget`
оценивает tokens (примерно четыре символа на token), учитывает explicit,
priority, relevance и recency, deduplicate по id и выбирает/обрезает до
лимита. History и attachments включаются только при соответствующих
capabilities.

Внешний AI остаётся за существующим orchestrator/firewall: private/secret
данные не попадают в прямой external gateway payload. Prompt injection из
файла, сообщения или remote object — это только данные и не может добавить
tools, skills или capabilities.
