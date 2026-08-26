# Keystone product

Keystone is your personal internet: a local-first product for identity, data,
social computing and personal AI. It brings the things you do, know, create
and share together without making a Keystone-operated cloud the owner of your
life.

You do not move your life into Keystone. Keystone forms around your life. Local
work continues without the Internet; external providers are used only where a
feature genuinely needs one.

## One product, many surfaces

Keystone is organised around canonical objects and actions rather than a set of
isolated mini-applications. The same File, Task, Document, Contact, Place,
Message or publication can be opened from Search, Daily Layer, a workspace,
another device or an explicit sharing flow. A projection shows an object; it
does not create a second copy or a new authority.

| Area | What it is for |
| --- | --- |
| Home / Daily Layer | A short, optional view of what changed and where to continue. |
| Messages and Calls | Private Keystone conversations and real-time voice/video between authorized identities. |
| Mail | A local projection and sending bridge for mailboxes the owner already controls. |
| People / Contacts | The owner's address book, separate from Keystone Identity and trust. |
| Calendar | Time that is scheduled or reserved. |
| Tasks | Work the owner needs to do. |
| Workboards | How project work is arranged across lists, cards and collaboration. |
| Universal Inbox | One local attention and action surface over several source systems. |
| Files / Shared Folders | Canonical file storage, plus explicit authorization and sync for shared folders. |
| Vault | Markdown-first personal knowledge and notes. |
| Documents | A Reader, OCR and annotation view over File revisions. |
| Photos | A personal media library over image/video content and derived previews. |
| Browser / Web Library | Browsing plus explicitly saved, static offline web content. |
| Subscriptions / Podcasts | Owner-selected external feeds and explicitly downloaded media. |
| Maps | Places, offline map data and manually started geographic navigation. |
| Personal Web / Spaces | Explicitly shared publications and shared contexts. |
| Capture | A quick intake tray for deciding what something should become later. |
| Search | Local navigation across permitted canonical objects. |
| Agents, Skills and Memory | Optional personal assistance, declarative procedures and explicitly managed context. |
| Devices, Continuity and Nearby Exchange | Moving references or copies across trusted devices or nearby endpoints. |

The relevant subsystem page explains the durable contract; [Architecture](architecture.md)
explains how those surfaces compose.

## The product model

The natural flow is:

```text
capture → work with data → organize it → find it → use it across devices
       → optionally share or collaborate → optionally use local AI
```

For example, a quick thought can stay in [Capture](capture.md), become a
[Task](tasks.md), be scheduled in [Calendar](calendar.md), attached to a
[File](files.md), read as a [Document](documents.md), kept as a [Vault](vaults.md)
note and found again through [Search](search.md). These are connected choices,
not competing stores.

## Useful on your own

Keystone is useful before anyone else joins. One owner can use Personal AI,
Memory, Vault, Browser, Web Library, Capture, Calendar, Tasks, Workboards,
Files, Documents, Photos, Contacts, Mail, Subscriptions, Maps and Search
offline or against selected external sources. Shared Folders can keep an
owner's devices aligned without turning the product into a hosted drive.

Agents, Skills, automation and device continuity remain useful as personal
tools. Local AI is optional: the product has deterministic and non-generative
paths for core workflows.

## With other people and devices

Additional value appears when the owner explicitly connects another identity or
trusted device:

- Messages and Calls provide private communication between authorized
  Keystone identities.
- Shared Folders and Spaces expose only the objects and permissions the owner
  chooses; collaboration supports concurrent work without a central social
  registrar.
- Nearby Exchange sends a reviewed copy or reference to an anonymous nearby
  endpoint. Receiving something does not make the sender a Contact,
  collaborator or trusted device.
- Continuity sends a bounded reference and optional continuation context to an
  already trusted device. It is not a full machine-state clone.
- Personal Agents can interact through explicit, scoped requests. A Contact,
  relay peer, profile or nearby endpoint is not automatically an Agent or an
  authorization principal.

The social network is an optional multiplier, not an onboarding prerequisite.

## Clear boundaries between similar things

### Files, Documents, Photos, Web Library and Capture

- **Files** are the canonical general file and revision model.
- **Shared Folders** add membership, authorization and distributed sync around
  Files; a shared-folder member is not an owned device.
- **Documents** are a Reader/OCR/annotation layer over File revisions. A
  Reader view and annotation do not rewrite the source File.
- **Photos** are a private media index over image/video content. Originals stay
  original; thumbnails, frames and edits are derived content.
- **Web Library** stores an explicit bookmark or static archive of web content;
  an archive is not a live webpage and does not run its scripts or tracking.
- **Capture** is intake. It receives a deliberate item, shows a destination
  proposal and routes only after confirmation. It is not another Inbox, Files
  store, Vault or Web Library.

See [Files](files.md), [Documents](documents.md), [Photos](photos.md),
[Web Library](web-library.md) and [Capture](capture.md) for their owner
documents.

### Tasks, Workboards, Calendar and Automation

| Surface | Question it answers |
| --- | --- |
| Tasks | What do I need to do? |
| Workboards | How is project work organised? |
| Calendar | When is time scheduled or reserved? |
| Reminders | When should I be notified about a task? |
| Automation / Chronos | When should an approved automated or scheduled effect happen? |

A reminder is a notification, not task execution. Task text is data and does
not become an automation merely because an Agent or model read it. See
[Tasks](tasks.md) and [Calendar](calendar.md).

### Contacts, identity and profiles

A Contact is a private record used to organise people and resolve selected
addresses. A Keystone Identity is a cryptographic principal. A Profile is a
published or shared view of an identity. Email, phone number, display name,
group membership and profile data are not authorization.

Linking a Contact to an Identity is explicit and can be verified. Contacts do
not infer relationships, create trust, perform face recognition or authorize a
message, folder, Space or device. See [Contacts](contacts.md) and
[Security](security.md).

### The different inboxes

- **Universal Inbox** is a cross-source attention and action projection.
- **Task Inbox** is the default uncategorized Task list.
- **Capture Tray** contains unprocessed owner intake.
- **Mail Inbox** is a folder in an external mailbox.

They can link to one another, but each source remains authoritative. Reading
the Universal Inbox is not a mail read receipt or a task completion.

## Home and startup

The owner chooses the startup surface: Last opened, Home, Feed, Video,
Messages, Vault, Maps, Mail, Photos, Tasks or another supported workspace. Last
opened restores the exact permission-checked working context when it still
exists. Home is not mandatory.

The optional Daily Layer can sit above the chosen surface and briefly show
changes from Calendar, Tasks, Workboards, Messages, Spaces, Files, Devices,
Agents, approvals, Mail and other explicitly enabled sources. It stores
references and presentation state, not a second copy of source data. If nothing
needs attention, silence is a valid result. It never calculates productivity,
wellness, engagement or location scores.

## AI and authority

Keystone works fully without generative local AI. A compatible local model is
optional but recommended for richer assistance. Models may be built in or
provided by llama.cpp, Ollama, LM Studio, a localhost OpenAI-compatible server
or a custom local runtime. Compatibility is not an allowlist or a trust claim:
the model is always untrusted compute.

Models propose. Policy decides. The user authorizes consequences. Remote pages,
mail, messages, documents, OCR text, feed items, filenames, task text and
captured content are data, not instructions or authority. External AI never
receives Vault, Memory, Contacts, Mail, Tasks, Documents, Capture, Location or
private Files implicitly. See [AI](ai.md).

## Network and external providers

The [Keystone Network](connectivity.md) is the product-wide network. It can
use local, nearby, direct, delayed or provider-assisted paths, while
applications remain independent of the transport selected. The Internet helps
Keystone; Keystone does not depend on it.

External Mail, RSS/Atom/JSON Feed sources, web origins and media providers keep
their own authority and network boundaries. Keystone does not become a generic
HTTP proxy, central mailbox, cloud drive, recommendation service, payment
ledger or analytics system. External integrations are explicit and narrow.

## Safety and privacy in the product

Every source is treated according to its authority and data class. Imported
content is bounded and untrusted. Sharing, publication, provider disclosure,
device placement, contact linking, external AI use and tool execution are
separate owner decisions. A content hash identifies bytes; it does not grant
access. A path identifies a location; it does not grant authority. A relay
provides reachability; it is not a collaborator.

The [Security](security.md) document is the canonical high-level model, and
[Release and evidence](release.md) records what has actually been validated on
each host.
