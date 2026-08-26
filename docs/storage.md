# Storage and provider availability

`ContentCache` enforces a byte quota and evicts least-recently-used unprotected content. `FileStorageManager` records the local policy for each FileObject:

- `user-owned` — imported or explicitly owned local data;
- `pinned` — retained for offline use;
- `cache` — reproducible remote data that may be evicted;
- `temporary` — partial or explicitly deleted local material.

User-owned and pinned content is pinned in the underlying content cache and is never removed by ordinary cache eviction. `deleteLocalCopy` is an explicit user action: it removes local chunks and clears the local protection flags without tombstoning or deleting the signed FileObject. The object can become `AVAILABLE REMOTE` or `UNAVAILABLE` afterwards.

Storage usage reports used, quota and free bytes. Temporary chunks are bounded by the same quota; `FileTransferManager` limits concurrent workers and requests chunks with `AbortSignal` support so hosts can apply backpressure. A host that needs disk-backed restart resume can implement `WritableFileContentStore`/`ContentCache` persistence; the core policy does not claim permanent availability.

Provider directories are dynamic. They may return Alice, Charlie or any other authorized provider for each request. `DistributedContentService` assigns independent missing chunks across a bounded source set and uses the existing Fabric route optimizer for the path to each source. A provider outage, reconnect, network partition or corrupt response changes availability but cannot bypass manifest verification. Duplicate content IDs deduplicate manifests and verified chunks locally.

Private ciphertext may exist in the generic P2P content layer, but private metadata is not inserted into public Discovery/Search and the plaintext content ID is not advertised. Relay peers see only the ciphertext and unavoidable transport metadata.
