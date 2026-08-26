# Archive security

Archives are inspected before any extraction plan is created. The mandatory defaults bound entry count, expanded bytes, single-entry size, compression ratio, nesting depth and path length. User settings can only make these limits stricter.

ZIP central-directory and TAR headers are parsed without unbounded expansion. Absolute paths, drive/UNC paths, `..`, special device paths, duplicate/case-folded/confusable names, symlinks and hard-link-like entries are rejected. Extraction plans use a generated destination ID and normalized paths; callers must not pass archive names to `extract()` or an OS path.

Nested archives preserve a `ContentProvenanceChain`. Bombs, malformed headers, recursive loops and budget violations remain quarantined. No archive member is executed or installed automatically.
