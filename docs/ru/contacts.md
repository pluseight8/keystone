# Люди, контакты и личная адресная книга

Каноническая local-first личная адресная книга реализована через
[`ContactService`](../../packages/core/src/contacts.ts) в
`packages/core`. Это private owner data layer, отдельный от Keystone Identity,
Profile, Mail accounts, Messages, ACL и membership общих Spaces.

## Каноническая модель

У Contact есть стабильный branded ID, revision, timestamps и tombstone. Запись
поддерживает structured given/family/middle name, nickname и prefix/suffix;
несколько email, phone, postal address и безопасных HTTP(S) website на
уровне отдельных items; organization/department/job title; yearless birthday
и другие даты; private notes; tags; groups; favorite; bounded avatar или
content reference; optional explicit Profile reference; явные Identity links
с состоянием проверки; external handles и imported source UID.

Email, phone и display name никогда не становятся Identity. Contact group — это
организационная metadata, а не ACL, permission папки, Space membership или
security group. Identity/Profile link создаётся только явным действием owner
или после validated verified exchange. Разрешение отправителя Mail,
message/call recipient и Inbox filter — typed exact lookup: они не создают
Contact и не выдают trust.

Сервис использует bounded local indexes для search, normalized exact lookup по
email/phone и lookup по linked Identity. Глобальные поверхности ищут без
текста private notes. Нет listener или timer на каждый Contact.

## Duplicates, переносимость и sharing

Duplicate candidates строятся детерминированно и bounded: exact email, phone,
linked Identity или source UID, затем ограниченные кандидаты по name и
organization. Merge требует явного owner confirmation и сначала отдаёт
preview с proposed record и conflicts. Surviving record сохраняет item-level
значения обеих сторон, absorbed record становится tombstone с durable redirect.
Нет social graph, relationship inference, communication score, face matching
или automatic merge.

Импорт vCard 3.0/4.0 — preview-first, с ограничениями на bytes, cards, lines,
properties и values; `SOURCE` и remote `PHOTO` URI никогда не загружаются.
Нужна явная confirmation. Поля сохраняют provenance `IMPORTED_VCARD` или
`IMPORTED_CSV`, а vCard `UID` остаётся data, не authority. Доступны vCard
export и bounded CSV codec; private notes исключены, пока owner явно не
включит их.

Contact card — selective field disclosure. Private notes по умолчанию не
попадают в card и требуют отдельной явной опции. Received card можно сначала
просмотреть, затем явно добавить как новый Contact или применить к existing
Contact; private notes остаются исключёнными, пока owner отдельно не включит
их, и automatic merge отсутствует. Nearby и Messages используют narrow typed
card adapters и не превращают endpoint или message address в Contact/Identity.

## Offline ownership и integrations

Store может использовать owner-local persistent state adapter. Optional
owner-device replication передаёт versioned, optionally signed events и
отклоняет cross-owner, replay, revoked-device и unauthorized events.
Независимые scalar fields и multi-value items сходятся через field/item
versions; stale delete не воскресит данные. Device revocation требует явной
owner confirmation. Это adapter над существующей доставкой, а не central
Contacts server или новый cloud protocol.

Остальные домены получают только narrow typed adapters:

- Calendar получает yearless birthday projection без выдуманного года; Maps —
  явно выбранный address; Continuity — явно выбранный Contact или website.
- Mail может искать Contact email recipients и явно связать известный Mail
  address. Messages, Calls, Shared Folders и Spaces требуют explicit Identity
  link; состояние verification отдельно, один Contact не является recipient
  authority.
- Tasks и Universal Inbox получают typed references или exact filters. Group
  не авторизует tasks, folders, spaces или Inbox actions.
- Photos может передать явно выбранный avatar content reference. Web Library,
  Subscriptions, Agents и Plugins не получают ambient Contacts access.
  Agent/AI context, memory ingestion, webpage enumeration и plugin access
  требуют существующих explicit capability boundaries.

## Host surfaces

Desktop предоставляет optional typed
[`DesktopContactsRuntime`](../../apps/desktop/src/desktop-contacts-runtime.ts) и
first-class Contacts tab. Mobile предоставляет
[`contactsRuntime`](../../apps/mobile/src/contactsRuntime.ts) и `/contacts`.
Обе поверхности показывают bounded non-private data, поддерживают search,
groups, favorite/trash и explicit card/import flows и не создают второй store.
Они не предполагают GNOME, Flatpak или platform-specific contacts database.

## Validation и non-goals

Focused validation доступна через `pnpm test:contacts`; Contacts security,
integration и 100,000-record scale checks включены также в существующие
`test:security`, `test:integration` и `test:performance`. Core, desktop и
mobile TypeScript checks покрывают host boundary.

Заявленная development/validation environment — **Omarchy (Arch Linux-based
distribution)**, Node `v22.23.2`, pnpm `9.15.0`, package engine `>=22 <23`.
Системные пакеты не требуются и не изменяются. Keystone остаётся
platform-neutral; Omarchy не является обязательной dependency.

Не входят hosted address-book provider, CardDAV/CalDAV server,
automatic sender import, ambient location или geocoding, social/relationship
inference, face recognition, background surveillance, automatic sharing,
automatic merge и external-AI enumeration.
