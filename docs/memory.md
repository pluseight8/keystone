# Personal Memory

Keystone Personal Memory is a local-first, user-visible layer above RAG. RAG indexes material for bounded retrieval; `MemoryService` stores durable `MemoryEntry` records that explain why a fact was remembered and which Keystone objects support it.

## Memory entries

Entries are typed as `episodic`, `semantic`, `preference`, `relationship`, or `project`, and distinguish `fact`, `assumption`, and `preference`. Every entry has confidence, importance, privacy classification, timestamps, and provenance references. A reference may point to a Message, File, Community object, Track, Video, Agent session, or an explicit user statement.

Automatic entries are never marked explicit or pinned by a model. Explicit memories are created by the user and can be edited, pinned, marked incorrect, or deleted. Conflicting entries retain both provenance chains; a stronger/newer entry may supersede an older one without erasing its history.

## Privacy boundary

Memory is device-local durable state. A local model or a trusted personal compute device may consolidate observations according to Keystone policy. An external provider is rejected before it can receive observations or write candidates. `PRIVATE` and `SECRET` memory are never placed in an external provider payload; the existing AI egress firewall remains the final outbound boundary.

Privacy can only become stricter during consolidation: a candidate derived from a private source cannot be downgraded to `PUBLIC`. Private or blocked sources are not published through discovery and are not converted into public memory.

## Retrieval

`MemoryService.search()` ranks bounded results by semantic similarity, recency, importance, and source trust. `MemoryService.context()` applies the existing `ContextBudget`, so a prompt receives only the selected entries rather than the whole memory database. `MemoryContextSource` exposes that bounded result through the existing `MEMORY` capability used by `ContextBuilder`.

The default embedder is deterministic and local (`LocalHashEmbeddingProvider`). A host may provide another local embedder, but an external embedding endpoint must not be used for private memory.

## Forgetting and controls

Hosts should expose the following local controls:

- search by text, category, source, or privacy class;
- inspect “Why remembered” and provenance;
- edit, pin/unpin, mark incorrect, and delete an entry;
- disable automatic memory;
- forget a message/conversation or other source;
- clear a category.

Forgetting a source removes automatic memories that depend only on that source and removes the source from multi-source memories. Explicit user memories survive by default with a local “source forgotten” provenance marker; a caller can opt into removing them too.

## Durable state

`MemoryService` persists a versioned `MemorySnapshot` containing settings and entries through a host-provided `MemoryStateStore`. Cache/index data is rebuildable and is not required for recovery. State validation is fail-closed on unknown versions, invalid IDs, invalid privacy classes, or malformed provenance.

