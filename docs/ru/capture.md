# Universal Capture, Share-In и Quick Capture

Universal Capture — явная граница intake. Она принимает bounded payload,
выбранный пользователем, и помещает его в приватный локальный Capture Tray.
Tray не является вторым Universal Inbox, Task Inbox, Files store, Vault,
Web Library, Photos или Documents database. Каноническими остаются уже
существующие сервисы.

## Контракт

`packages/core/src/capture.ts` предоставляет `CaptureService`, typed source
provenance, bounded payloads, deterministic suggestions, destination previews,
idempotent routing, undo при поддержке destination, local search и private
own-device sync envelopes. Большие файлы представлены opaque handle и bounded
metadata; bytes читаются только выбранным destination adapter. Состояние
Capture local-first и безопасно переживает restart.

Состояния: `DRAFT`, `READY`, `PROCESSING`, `ROUTED`, `FAILED`, `DISMISSED`.
Каждый item хранит source kind, optional typed source reference, время,
data class и result references. Source reference — data, а не authorization
grant.

## Источники

Core boundary поддерживает manual text, safe HTTP(S) URLs, одноразовое чтение
clipboard, явные files/images/documents, drag/drop metadata, browser page или
selection projections, OS Share-In payloads, contact cards, mail/message и
другие Keystone references, places/routes, calendar/task/workboard references,
Nearby/Continuity proposals и `keystone://capture` proposals. UI предлагает
только те inputs, для которых host имеет typed capability.

Clipboard доступен только явно. Нет clipboard watcher, history, background
polling или automatic paste. Browser capture получает bounded page/selection
projection и не получает credentials или ambient Keystone context. OS Share-In
является untrusted proposal: он не открывает URL, не запускает command и не
маршрутизируется сам.

`keystone://capture` принимает только bounded `text`, safe `url` или typed
`type`/`id` proposal. Action, command, destination, executable, privileged и
arbitrary `file://` fields отвергаются. Deep-link создаёт Tray item, а не
privileged action.

## Tray и маршрутизация

Capture использует bounded metadata pagination и local search, deterministic
fingerprint deduplication, bulk intake, dismiss/restore, explicit cleanup и
crash recovery. Registry содержит typed adapters для Tasks, Vault, Web Library,
Files, Photos, Documents, Contacts, Calendar, Workboard и Shared Folders.

Routing всегда двухшаговый:

1. adapter возвращает preview с destination, summary, disclosure class,
   warnings и требованием owner confirmation;
2. owner подтверждает выбранный destination, после чего Keystone вызывает
   adapter со стабильным item/destination idempotency key.

Operation сохраняется до выполнения. Завершённый receipt возвращается при
retry вместо повторной canonical write. Прерванные операции восстанавливаются
как `FAILED` и требуют явного retry; startup не создаёт повторно Tasks,
Contacts, events, files или shares.

Private destinations остаются private. Preview Shared Folder явно сообщает,
что выбранный payload станет shared. Publication, external mail, social
sharing, public Web Library publication, Memory writes и agent/tool execution
не являются Capture destinations и не происходят неявно.

## Canonical integrations

Adapters вызывают существующие service boundaries. Task creation использует
`TaskService`; Vault пишет Markdown через `VaultService`; Web Library — свой
bookmark/archive contract; Files и Shared Folders — canonical
content-addressed storage; Photos и Documents — существующие import services;
Contacts и Calendar требуют их explicit owner actions. Capture не копирует
canonical bytes во второе хранилище.

References из Mail, Messages, Contacts, Maps, Calendar, Tasks, Workboard,
Nearby, Continuity и collaboration остаются reference-only, пока owner не
выберет совместимый destination. Remote data не выдаёт permissions, не
создаёт identity, не принимает share и не вызывает command.

## Desktop и mobile

Desktop предоставляет Quick Capture через activity bar, header, Quick Actions,
shortcut `Ctrl/Cmd+Shift+Space` и typed drag/drop boundary. Text и URL работают
через local fallback до native bootstrap. При отсутствии adapter clipboard,
browser и file actions показывают unavailable host boundary.

Mobile предоставляет in-app Quick Capture с local text/URL fallback, Tray
search, suggestions и preview/confirm routing. Android `ACTION_SEND` /
`ACTION_SEND_MULTIPLE` и iOS Share Extension представлены через
`MobileShareInBoundary`; platform adapter передаёт typed payload и explicit
acceptance. Предположений о PWA или background clipboard нет.

## Privacy и resource safety

Text, URLs, HTML-derived clipboard text, titles, references и errors bounded и
normalized. HTML превращается в text, scripts/styles удаляются. Принимаются
только credential-free HTTP(S) URLs. File bytes остаются за opaque selected
handle и читаются при route с size bound. Нет directory scan, arbitrary path
access, automatic archive/plugin execution, external fetch, remote command
execution или implicit external AI.

Own-device Continuity и sync передают только private bounded metadata и typed
references. Sync envelope scoped к owner и может быть ограничен trusted device
set. Sync merge никогда не replay-ит destination operation.

## Validation

Focused checks запускаются с Node v22.23.2, pnpm 9.15.0 и package engine
`>=22 <23`:

- `pnpm test:capture` — core unit/security/integration/controlled-runtime/
  scale tests и native clipboard command-boundary tests;
- `pnpm tsc`, `pnpm test`, `pnpm test:integration`, `pnpm test:network`,
  `pnpm test:performance`, `pnpm test:security`, `pnpm build` и
  `pnpm release:check` — существующие release gates с Capture;
- `git diff --check` — проверка whitespace.

Текущий development/validation distro — **Omarchy (Arch Linux-based
distribution)**. Native evidence классифицируется по реальному host.
Wayland clipboard adapter использует fixed `wl-paste` argv с `shell: false`;
отсутствие compositor/clipboard session сообщается как unavailable и не
подменяется test adapter. System packages не устанавливаются и не меняются.
Physical-evidence probe сообщает `RUNTIME_DETECTED`/`SAME_HOST` для
доступной команды `wl-paste`, не читая и не логируя clipboard владельца; это
не является physical clipboard verification.

Наличие этой проверки не расширяет заявленные platform support claims.
