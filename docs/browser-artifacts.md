# Browser Artifacts

Browser extraction is represented by one `BrowserArtifact`, not a copied
browser-specific content database. An artifact records:

- source URL and origin;
- bounded extracted data and optional citations;
- timestamp and page revision;
- optional screenshot/file references;
- session/tab/owner/execution provenance;
- SHA-256 integrity metadata;
- data class and `UNTRUSTED` trust marker.

The artifact keeps the source page untrusted. Citations are references to the
observed page, not claims that the page is authoritative. A later task or
analysis must apply its own permissions and should re-verify a page when the
revision changes.

`BrowserArtifactTaskGraphAdapter` converts a verified artifact into the
existing structured TaskGraph artifact format. It preserves the browser
artifact ID, file references, data class, source kind, integrity, and
provenance. Private external artifacts are rejected; no raw private page data
is sent to an external model. Research, Analysis, and Agent Bot therefore
receive a bounded, auditable hand-off through the existing Task Graph rather
than a new browser protocol.

Screenshots and downloaded files are references only. The Desktop Shell does
not persist page text or secret data in workspace records. File availability,
pinning, quota, and content verification continue to be handled by Keystone's
existing content/file layers.
