# People, Contacts and Personal Address Book

The canonical local-first personal address book is implemented by
[`ContactService`](../packages/core/src/contacts.ts) in `packages/core`; it
is a private owner data layer and remains separate from Keystone Identity,
Profile, Mail accounts, Messages, ACLs and shared-space membership.

## Canonical model

Contacts have stable branded IDs, revisions, timestamps and tombstones. A
record can contain structured given/family/middle names, nickname and
prefix/suffix; multiple item-level emails, phones, postal addresses and safe
HTTP(S) websites; organization/department/job title; yearless birthdays and
other dates; private notes; tags; groups; favorite state; bounded avatar data
or content references; an optional explicit Profile reference; explicit
Identity links with verification state; external handles; and imported source
UIDs.

An email address, phone number or display name is never an Identity. A Contact
group is organization metadata, not an ACL, folder permission, Space member
list or security group. Identity/Profile links are created only by an explicit
owner action or a validated verified exchange. Mail sender resolution,
message/call resolution and Inbox filtering are exact typed lookups; they do
not create Contacts or grant trust.

The service uses bounded local indexes for search, normalized exact email/phone
lookups and linked Identity lookup. Search used by global surfaces excludes
private note text. There is one service subscription set and no listener or
timer per Contact.

## Duplicates, portability and sharing

Duplicate candidates are deterministic and bounded. They use exact email,
phone, linked Identity or source UID matches, followed by bounded name and
organization candidates. A merge requires explicit owner confirmation and
first returns a preview containing the proposed record and conflicts. The
surviving record keeps item-level values from both sides; the absorbed record
becomes a tombstone with a durable redirect, so references do not silently
split. There is no social graph, relationship inference, communication score,
face matching or automatic merge.

vCard 3.0/4.0 import is preview-first, bounded by bytes, cards, lines,
properties and values, and never fetches a `SOURCE` or remote `PHOTO` URI.
Import requires explicit confirmation. Imported fields retain
`IMPORTED_VCARD` or `IMPORTED_CSV` provenance and vCard `UID` values remain
data, not authority. vCard export and a bounded CSV codec are available;
private notes are excluded unless the owner explicitly opts in.

Contact cards are selective field disclosures. Private notes are excluded by
default and require a separate explicit option. A received card can be
previewed and then explicitly added as a new Contact or applied to an existing
Contact; private notes remain excluded unless the owner opts in, and the card
is never auto-merged. Nearby and Messages use narrow typed card adapters; they
do not turn a nearby endpoint or a message address into a Contact or Identity.

## Offline ownership and integrations

The store can be backed by an owner-local persistent state adapter. Optional
owner-device replication carries versioned, optionally signed events and
rejects cross-owner, replayed, revoked-device and unauthorized events.
Independent scalar fields and multi-value items converge through field/item
versions; stale deletes do not resurrect data. Device revocation requires
explicit owner confirmation. This is an adapter over existing delivery, not a
central Contacts server or a new cloud protocol.

Other domains consume narrow typed adapters:

- Calendar receives yearless birthday projections without inventing a birth
  year; Maps receives an explicitly selected address; Continuity opens an
  explicitly selected Contact or website.
- Mail can search Contact email recipients and explicitly link a known Mail
  address. Messages, Calls, Shared Folders and Spaces require an explicit
  Identity link; its verification state is separate and a Contact alone is not
  a recipient authority.
- Tasks and Universal Inbox receive typed references or exact filters. Groups
  do not authorize tasks, folders, spaces or Inbox actions.
- Photos may supply an explicitly selected avatar content reference. Web
  Library, Subscriptions, Agents and Plugins have no ambient Contacts access.
  Agent/AI context, memory ingestion, webpage enumeration and plugin access
  require their existing explicit capability boundaries.

## Host surfaces

Desktop exposes the optional typed
[`DesktopContactsRuntime`](../apps/desktop/src/desktop-contacts-runtime.ts) and
a first-class Contacts tab. Mobile exposes
[`contactsRuntime`](../apps/mobile/src/contactsRuntime.ts) and `/contacts`.
Both surfaces project bounded non-private data, support search, groups,
favorite/trash actions and explicit card/import flows without creating a
second store. They do not assume GNOME, Flatpak or a platform-specific
contacts database.

## Validation and non-goals

Focused validation is available through `pnpm test:contacts`; the Contacts
security, integration and 100,000-record scale checks are also included in the
existing `test:security`, `test:integration` and `test:performance` scripts.
Core, desktop and mobile TypeScript checks cover the host boundary.

The declared development/validation environment is **Omarchy (Arch Linux-based
distribution)** with Node `v22.23.2`, pnpm `9.15.0` and package engine
`>=22 <23`. No system packages are required or changed. Keystone remains
platform-neutral; Omarchy is not a required dependency.

The service does not add a hosted address-book provider, CardDAV/CalDAV server,
automatic sender import, ambient location or geocoding, social/relationship
inference, face recognition, background contact surveillance, automatic
sharing, automatic merging or external-AI enumeration.
