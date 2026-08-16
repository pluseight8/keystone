# Personal AI context

Keystone's `UnifiedContextResolver` is a local-first read boundary over the existing object services. It does not create a second search index or copy media objects. Host adapters project verified Memory, messages, Communities, Shared Spaces, Files, Music, Video/Shorts, Live and notifications into bounded records.

## Contract

`ContextQuery` carries the natural-language query, scope, local timezone, optional object/time bounds and a token limit. `ContextResult` contains an extractive answer and `ContextCitation` entries with the real object ID, source type, author, timestamp, permission scope and references. If nothing visible matches, the answer is explicitly “No permitted Keystone objects found.”

The resolver filters blocked, deleted, revoked and unauthorized records before lexical matching, reference expansion or budgeting. Private records require `accessibleTo` to contain the current Identity. Public-only scope accepts only public/PUBLIC records. `current-space`, `current-chat`, `communities` and `files` are narrow filters, not hints to bypass access control.

Cross-object expansion follows existing references (for example Message → File → Space/Task or Track → Short) and deduplicates by the canonical Keystone object ID. It never creates a media copy. Temporal words use the supplied IANA timezone: `yesterday` means the previous local calendar day, `last week` is the preceding seven days, and `month ago` is the preceding 30 days. Explicit ISO bounds and `afterObjectId`/`beforeObjectId` are also supported.

`ContextBudget` bounds the records sent to a local/trusted agent. Omitted and truncated IDs are returned for UI transparency. Citation validation rejects IDs or excerpts that did not come from the resolver result.

## Privacy boundary

`local` and `personal_trusted` execution may receive the returned `AIContextItem` values after the normal capability policy. `external` execution returns `blocked_external` and no records. The items carry the `keystone-unified-context` source marker; `AIEgressFirewall` rejects that marker even if an object is public. External orchestration must instead formulate a non-personalised task locally. There is no central AI index, cloud memory or telemetry path.

Hosts should install the service adapters through `createUnifiedContextSources`, provide an encrypted `ContextStateStore` when durable local snapshots are wanted, and keep object verification upstream of `recordFromObject`/`ingestObject`.
