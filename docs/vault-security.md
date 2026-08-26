# Vault security

Vaults fail closed. The selected root is a host capability, not an authorization grant. `VaultPermissionBoundary` checks the local identity for every operation. Private Vault metadata is excluded from public discovery, search projections and external AI payloads.

The core rejects path traversal, absolute paths, drive-letter paths, control characters and unsafe IDs. Hosts should make an explicit symlink decision; the default indexer skips symlinks. Invalid filenames, MIME mismatches, malformed frontmatter, oversized notes, unsafe links and corrupted sidecars produce bounded diagnostics rather than destructive repair.

Markdown, attachments, remote agent text and web content are untrusted input. They cannot alter tool capabilities, system instructions, permissions or egress policy. External AI receives no Vault record, filename, path or attachment by default. Private context can only be used by Local or explicitly authorized Personal Trusted Compute through the existing AI policy boundary.

History and index corruption are isolated. Recovery rebuilds from the current Markdown directory; history corruption only removes recoverable revisions. Atomic writes and revision checks protect concurrent edits. User-owned source files and pinned attachments are never ordinary cache eviction targets.
