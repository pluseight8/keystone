# Memory Consolidation

Consolidation is an opt-in local job that turns recent observations into durable memories:

`recent events → candidate memories → provenance/privacy validation → deduplication and conflict detection → durable entries`

## Model boundary

`MemoryModelGateway` declares its execution as `local`, `personal_trusted`, or `external`. `MemoryService.consolidate()` accepts only the first two. An external gateway is rejected before `propose()` is called, so an external model cannot read private observations or write private memory. There is no automatic external fallback when a local model is unavailable.

Candidate output is untrusted data. Keystone validates the kind, assertion, source references, IDs, timestamps, bounds, and value size before persistence. Candidate sources must be a subset of the observations supplied to the local gateway. Model-provided `explicit`/`pinned` claims are ignored. Source privacy is the lower bound: the resulting classification is the most restrictive class among its sources and candidate declaration.

Prompt injection in a message, file, or community object is treated as ordinary observation text. It cannot grant capabilities, change provenance, mark a memory explicit, or make private data public.

## Deduplication and conflicts

The stable fingerprint uses kind, assertion, normalized subject/predicate, summary, and value. Equivalent candidates merge provenance and confidence instead of creating copies. Candidates with the same subject and predicate but different values remain as conflicting entries. A stronger candidate records `supersedes`/`supersededBy`; both entries and their source chains remain inspectable.

## Chronos integration

`LocalMemoryConsolidationRunner` is a bounded adapter for an existing Chronos host. It reads a host-provided `MemoryObservationSource`, runs one local consolidation, and returns metadata-only status. Chronos owns scheduling, pause/disable, and audit policy; no cloud scheduler or mandatory nightly job is created. If automatic memory is disabled, the runner returns `disabled` without invoking a model.

Hosts that compose several Chronos workflow handlers can use `createMemoryChronosWorkflow()` and the typed `memoryConsolidationInstruction()` prefix. The adapter handles only its own instruction and leaves every existing Chronos action untouched.

## Deletion and recovery

Source forgetting updates all linked entries according to `MemoryForgetPolicy`. Deleting a source does not silently leave stale provenance. Durable snapshots include only memory records and settings; embedding vectors are reconstructed locally after restart.
