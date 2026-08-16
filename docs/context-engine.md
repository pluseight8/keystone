# Agent context engine

`ContextBuilder` is the only path by which an agent obtains Memory/RAG, Life
Map, chats, files, social graph, Communities, local search, history or
explicit attachments. A host implements `AgentContextSource.read()` and must
label each candidate with its capability, source and `AIDataClass`.

The builder rejects malformed ids, `SECRET` data, shell/filesystem sources,
and data classes outside the session policy. It requests only the session's
allowlisted capabilities, in parallel, with the session id included in every
request. Source failures fail closed for that source; cancellation propagates.

`ContextBudget` estimates tokens deterministically (approximately four
characters per token), scores explicit attachments, priority, relevance and
recency, deduplicates by id, then selects/truncates until the configured
budget and reserve are reached. The result records selected, omitted and
truncated ids for diagnostics. History is included only when `HISTORY` is an
enabled capability, and attachments only when `ATTACHMENTS` is enabled.

The model receives a bounded context and a separate bounded history view. No
agent turn copies the complete durable database into a prompt. External
execution is still subject to the existing orchestrator/firewall; private or
secret context is never placed in a direct external gateway request.

Context source adapters should apply object-level permissions before returning
items. A prompt injection in a file, message or remote object is data, not a
policy instruction, and cannot add capabilities, tools or skills.
