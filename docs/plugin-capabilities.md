# Plugin capabilities

Manifest requests are not grants. The host authorizes each operation against a
revision-bound, scoped, revocable grant. There is no `ALL`, `ADMIN` or
`FULL_ACCESS` capability. Network, external links, event subscriptions,
background execution, storage, provider registration and shared publication are
all separate boundaries.

## Files boundary

Plugins never receive an ambient filesystem path or a shared-folder authority.
A plugin may participate only through a separately granted, owner-scoped
projection or picker result. Folder membership, epochs, revision writes,
Drop-Zone upload policy, content authorization, device placement and
filesystem binding remain Core/NativeHost decisions. A content hash, webpage,
enclosure or plugin manifest cannot grant access, trigger a scan, execute a
file, extract an archive, feed AI/memory, publish content or create a Drop Zone.

## Contacts boundary

Plugins have no ambient Contacts capability and cannot enumerate the personal
address book. A separate owner-approved, bounded projection or card field
selection is required; private notes, unselected fields, Identity keys and
source authority stay in Core. Contact groups are not plugin permissions,
folder authorization or Space membership. Plugin requests cannot auto-create,
auto-merge, link or trust a Contact, invoke geocoding, infer relationships or
pass Contact data to external AI.
