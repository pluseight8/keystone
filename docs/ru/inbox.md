# Универсальные входящие, Communications Hub и Action Center

Universal Inbox — это first-class local projection без central notification server,
нового message transport и второй authoritative source store.
`UniversalInboxService` — bounded local projection поверх typed adapters.
Исходная подсистема остаётся authority для content, permissions, delivery,
invites, approvals и source mutations.

## Contract и semantics

Канонический contract находится в
[`packages/core/src/inbox.ts`](../../packages/core/src/inbox.ts).
`InboxSourceRef` — discriminated canonical reference; arbitrary JSON pointer,
serialized callback и source-owned action code запрещены. Registry/adapters
проектируют bounded text preview, trusted source badge и typed action hints.

Источник может быть Keystone Messages/notifications, external Mail, missed
Calls, Collaboration, Continuity, Nearby, Agents, Approvals, Automation,
Calendar, Workboard, Security/System и Personal Web archive.

`read`, `archive`, `dismiss`, `pin`, `save`, `snooze` — это только local
organization state. Они не помечают Mail read, не отправляют Keystone receipt,
не удаляют source object, не принимают invite и не approve Agent. Snooze
использует один durable wake index, без timer на каждый item.

Source action сначала заново refresh/reproject-ит canonical reference и
allow-list. Stale/revoked invite или approval fail closed. Mail reply создаёт
draft через `MailService`, а explicit Send требует owner action, exact account
и существующий idempotent outbox. Call-back не выдаёт media permission; Nearby
остаётся anonymous до отдельного consent flow.

OS notifications — отдельная ephemeral boundary, а durable Inbox — локальная
проекция. Daily Layer получает bounded Inbox source и не сканирует source DB.

## Offline, device и privacy

Offline доступны просмотр, локальный search/filter/group, read/archive,
pin/save/snooze кэшированных metadata. Source actions сохраняют live/queued
семантику исходной службы. Owned-device sync может передавать только
organization state (`read`, `archive`, `snooze`, `pin`, `save`) с device/revision
tie-break; content и source authority не реплицируются.

Preview — bounded text. HTML, scripts, prompt injection, giant title,
control characters, forged badges и arbitrary action descriptors не получают
execution authority. External AI не получает implicit Inbox context; local-AI
selection возможен только после explicit owner action. Memory ingestion не
происходит автоматически.

Desktop и mobile показывают first-class Inbox с source badges, фильтрами All,
Unread, Needs action, Snoozed, Archive и явными source actions. Host получает
typed projections, а не credentials, filesystem paths или browser sessions.

Текущая validation environment: **Omarchy (Arch Linux-based distribution)**,
Node v22.23.2, pnpm 9.15.0, engine `>=22 <23`. Это development/validation
context, а не обязательная dependency Keystone; GNOME, Flatpak, apt и dnf не
предполагаются.

## Не входит в Universal Inbox

Central notification server, unified messaging transport/trust semantics,
automatic source read/delete/accept/reply, AI auto-reply/approve,
external-AI ingestion, engagement ranking/attention score/ads/social graph
здесь не реализуются.

## Optional Feeds source

Inbox может зарегистрировать typed `subscriptions` adapter. Он показывает
только unread items subscriptions, для которых владелец включил
`notifyOnNewItems`, использует `FEED_ITEM` source badge и даёт только
navigation. Он не превращает каждый feed entry в Inbox event, не меняет feed
read state и не fetch-ит origin/не хранит enclosure bytes. При выключенной
policy source отсутствует, а не создаёт шум.
