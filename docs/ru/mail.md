# Внешняя почта и communications bridge

Keystone Mail — first-class поверхность для внешней почты. Это local-first
проекция и transport adapter для mailbox, которым владелец уже управляет, а
не Keystone mailbox, account, hosted mail service или relay.

## Граница и provider model

Mail account отделён от Keystone Identity. Email address не является Keystone
Identity, TLS не является application-level E2E Keystone, а настроенный
внешний provider видит содержание письма и свою metadata. Keystone не создаёт
central mail server/cloud mailbox, не требует Gmail/Microsoft, не делает
stranger relay и не превращает Gateway/Fabric в общий IMAP/SMTP proxy.

Стабильный core contract — MailProviderAdapter:

- ImapSmtpMailAdapter даёт IMAP receive/sync и SMTP submission через host-owned
  session factories;
- JmapMailAdapter опционален и определяется capability;
- ControlledMailProvider предназначен только для deterministic test/local
  fixture.

Hostname и endpoint provider — untrusted input. Для внешних endpoint требуются
TLS или STARTTLS; private/LAN endpoint допускается только после явного решения
владельца и не сканируется автоматически. Ошибки provider, auth, timeout и
неопределённое принятие submission имеют разные состояния.

## Local-first state

Host предоставляет encrypted/authenticated MailStateStore. В projection
сохраняются account config, folder/message metadata, ограниченный cached body,
drafts, sync cursors и durable outbox/mutation state. Байты provider secret
там отсутствуют. Provider остаётся authority, кроме pending local operations,
которые видны как queued/pending/conflict.

Bound включают 20 accounts, 512 folders на sync projection, 100 000 cached
messages, ограниченные MIME depth/parts, 2 048 outbox entries и 4 096 pending
mutations. Sync использует incremental UID/highest-UID или provider state;
изменение IMAP UIDVALIDITY приводит к безопасной re-identification/reset.
Background/IDLE capability показывается честно и не обещается UI без host
поддержки.

Offline read, local search, folders, threads и drafts работают по encrypted
local projection. External Email не смешивается с Keystone Messages и
Keystone objects.

## Credentials и отправка

Provider credentials проходят только через существующую secret
isolation (SecureMailCredentialBoundary и
SecureSecretHost.readForScopedAdapter). В Mail state хранится только opaque
MailCredentialReference; secret не попадает в DB/state, logs, URLs,
telemetry, AI/plugin context и remote peers.

Каждая отправка требует явного действия владельца. Outbox использует стабильный
outbound Message-ID и bounded retries. Timeout или неясное принятие provider
показываются как UNKNOWN/needs review, без слепого повтора. QUEUED, SENDING,
SENT, FAILED и UNKNOWN различаются. AI proposal, draft, retry и repair outbox
не являются разрешением отправить письмо.

Reply/reply-all/forward сохраняют threading и исключают собственные адреса
владельца там, где это нужно. Bcc — private envelope field; он не переносится
в обычное отображение входящего письма и serialized headers.

## MIME, links и attachments

MIME parser ограничен по bytes, headers, depth и parts. Display surface удаляет
script, iframe, active objects, forms, CSS/event handlers, опасные URL schemes
и tracking-capable remote resources. External images по умолчанию blocked и
включаются только отдельной видимой policy; sanitizer ничего не загружает.
Внешние ссылки проходят через typed ExternalLinkGateway.

Attachments — untrusted, lazy и private by default. Имена нормализуются против
path traversal, count/size ограничены, auto-run/auto-extract отсутствуют, а
сохранение в Files проходит через private attachment boundary.

## Ограниченные интеграции

- Contacts даёт только local recipient suggestions; mail не импортирует и не
  создаёт contacts автоматически.
- Search ищет local mail projection и помечает результат как external mail;
  содержимое mailbox не загружается.
- Daily/Notifications получают bounded sensitive reference на unread mail и
  failed/ambiguous outbox, а не credentials/full bodies.
- Files получает attachment только по отдельному действию владельца.
- Calendar, Maps, Calls, Browser и Keystone objects — typed references; mail не
  выводит из письма travel, attendance, identity или call authority.
- AI может читать/summarize или предложить draft только после явного local
  selected/open context action. Remote mail — untrusted data, не инструкция.
  AI, agents, plugins и tools не могут отправить письмо без того же явного
  owner-controlled action.

## Host/UI boundary

Desktop/mobile получают только structural mail runtime interfaces. Shell не
открывает provider sockets, не держит credentials и не превращает HTML в
browser capability. UI показывает external-provider disclosure, offline state,
blocked-images policy, private attachment, message/thread и честный outbox
state.

Development/validation host — Omarchy (Arch Linux-based distribution).
Omarchy не является Keystone dependency; Keystone остаётся platform-neutral и
не выводит Windows/macOS/Android/iOS support из distro host.

## Evidence

- packages/core/src/mail.test.ts — service/provider, offline outbox, restart,
  credentials, MIME, hostile HTML, reply/all/forward, mutations и endpoint
  policy;
- packages/core/src/mail-architecture.test.ts — guards против relay/raw
  transport, secret leakage, active content и implicit integrations;
- packages/core/src/testing/mail-real-protocol.test.ts — local
  standards-shaped IMAP/SMTP receive, mutation и submission proof с redacted
  transcript;
- packages/core/src/testing/mail-scale.test.ts — incremental sync 10 000
  message metadata, 100 threads, offline search и bounded outbox.

Production credentials/provider setup и native host adapters остаются deployment
configuration и не являются частью обычного локального mail state.
