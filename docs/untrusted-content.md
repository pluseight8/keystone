# Untrusted content containment

Keystone treats bytes received from P2P peers, browser downloads, shared spaces, communities and packages as data. The lifecycle is:

`RemoteFileDescriptor → BoundedIncomingTransfer → QuarantinedBlob → StructurallyInspectedBlob → ClassifiedFileObject → SafePreviewObject → UserReleasedFileObject`.

No state before an explicit owner release has executable authority. A filename, sender MIME type, HTTP `Content-Type`, signature or scanner result is evidence only. A `CLEAN` malware result never means “run this file”. The core never invokes a shell, interpreter, OS association, macro, package installer, startup hook or protocol handler for received content.

Private/local content remains available to its owner. Network and shared content is quarantined first; encrypted ciphertext is retained as ciphertext and is inspected only after an authorized decrypt/materialization step. Content Safety and Malware Safety are separate decision domains.

The host may provide a sandboxed decoder, document preview host, encrypted persistence and local scanner through typed adapters. Adapter failure is `UNKNOWN`, `SCAN_FAILED` or `INSPECTION_FAILED`, never `SAFE`. Preview artifacts are bounded, derived and carry the source hash/provenance chain. HTML/SVG previews remove scripts, event handlers, active embeds and automatic external fetches.

The `QuarantineStore` uses generated paths, bounded global/per-peer/per-transfer budgets, content hashes, restart-safe metadata and stale incomplete-transfer eviction. The remote filename is metadata only. Saving outside Keystone requires a host file picker and an explicit non-overwriting export operation.
