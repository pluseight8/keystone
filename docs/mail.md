# External Mail and Communications Bridge

Keystone Mail is a first-class external communications surface. It is a
local-first projection and transport adapter for mailboxes that the owner
already controls; it is not a Keystone mailbox, account, relay, or hosted
message service.

## Boundary and provider model

Mail accounts are separate from Keystone Identity. An email address is not a
Keystone identity, TLS is not Keystone application E2E, and the configured
provider remains able to see message content and provider metadata. Keystone
does not create a central mail server, cloud mailbox, mandatory Gmail or
Microsoft account, stranger relay, or generic Gateway/Fabric IMAP/SMTP
proxy.

The core provider contract is MailProviderAdapter:

- ImapSmtpMailAdapter provides IMAP receive/sync and SMTP submission through
  host-owned session factories.
- JmapMailAdapter is optional and capability-detected.
- ControlledMailProvider is a deterministic test/local fixture only.

Provider hostname and endpoint configuration are untrusted input. TLS or
STARTTLS is required for external endpoints; private/LAN endpoints require an
explicit owner decision and are not discovered or scanned. Provider failure,
authentication failure, timeout, and ambiguous acceptance are separate
states.

## Local-first state

The host supplies an encrypted, authenticated MailStateStore. The persisted
projection contains account configuration, folder/message metadata, bounded
cached bodies, drafts, sync cursors, and durable outbox/mutation state. It does
not contain provider secret bytes. The provider remains authoritative except
for pending local operations, which are visible as pending/queued/conflict
state.

The current bounds include 20 accounts, 512 folders per sync projection,
100,000 cached messages, bounded MIME depth/parts, 2,048 outbox entries and
4,096 pending mutations. Sync uses incremental UID/highest-UID or provider
state; IMAP UIDVALIDITY changes cause a safe re-identification/reset path.
Background/IDLE capabilities are reported honestly and are not silently
claimed by the UI.

Offline read, local search, folder navigation, thread grouping and draft
editing remain available from the encrypted local projection. External Email
is kept distinct from Keystone Messages and shared/private Keystone objects.

## Credentials and sending

Provider credentials cross the boundary only through the existing secret
isolation path (SecureMailCredentialBoundary and
SecureSecretHost.readForScopedAdapter). Mail stores only an opaque
MailCredentialReference; secrets are not written to DB/state, logs, URLs,
telemetry, AI context, plugin context, or remote peers.

Every send requires an explicit owner action. The outbox uses a stable
outbound Message-ID and bounded retries. A provider timeout or uncertain
acceptance is shown as UNKNOWN/needs review rather than blindly resending.
QUEUED, SENDING, SENT, FAILED, and UNKNOWN are distinct honest states. Draft
body generation, local AI proposals, retry, and outbox repair never imply
permission to send.

Reply, reply-all and forward preserve message threading and exclude the
owner's own addresses where appropriate. Bcc is a private envelope field and
is not copied to normal received-message display or serialized headers.

## MIME, links and attachments

Mail MIME is parsed with byte, header, depth and part bounds. The display
surface removes scripts, iframes, active objects, forms, CSS/event handlers,
unsafe URL schemes and tracking-capable remote resources. External images are
blocked by default and only become an explicit, visible policy choice; the
sanitizer never fetches them. External links are handed to the host's typed
ExternalLinkGateway.

Attachments are untrusted, lazy and private by default. Names are normalized
against path traversal, size/count are bounded, no attachment is executed or
auto-extracted, and saving to Files uses the private attachment boundary.

## Bounded integrations

- Contacts supplies local recipient suggestions only; mail does not silently
  import, create, or merge contacts.
- Search indexes local mail projection data and labels results as external
  mail; it does not upload mailbox content.
- Daily and Notifications receive bounded sensitive references to unread mail
  and failed/ambiguous outbox work, not provider credentials or full bodies.
- Files can receive an owner-selected private attachment save operation.
- Calendar, Maps, Calls, Browser and Keystone objects are typed references;
  mail does not infer travel, attendance, identity, or call authority.
- AI may read/summarize or propose a draft only after an explicit local
  selected/open context action. Remote mail is untrusted data, not an
  instruction. AI, agents, plugins and tools cannot send without the same
  owner-controlled mail action.

## Host/UI boundary

Desktop and mobile expose only structural mail runtime interfaces. The shell
does not open provider sockets, handle credentials, or turn HTML into a
browser capability. It shows the external-provider disclosure, offline state,
blocked-image policy, attachment privacy, thread/message state and honest
outbox status.

Development validation runs on Omarchy (Arch Linux-based distribution).
Omarchy is a development/validation host, not a Keystone dependency; Keystone
remains platform-neutral and does not infer Windows/macOS/Android/iOS support
from the host distro.

## Evidence

- packages/core/src/mail.test.ts: provider/service, offline outbox, restart,
  credentials, MIME, hostile HTML, reply/all/forward, mutations and
  endpoint-policy coverage.
- packages/core/src/mail-architecture.test.ts: central-relay, raw transport,
  secret, active-content and implicit-integration guards.
- packages/core/src/testing/mail-real-protocol.test.ts: local
  standards-shaped IMAP/SMTP receive, mutation and submission proof with a
  redacted transcript.
- packages/core/src/testing/mail-scale.test.ts: incremental 10,000-message
  metadata sync, 100 bounded threads, offline search and queued outbox proof.

Production credentials, provider account setup and native host adapters remain
deployment configuration. They are release concerns, not part of the Mail
domain contract.
