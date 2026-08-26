# Разработка

Keystone разрабатывается как platform-neutral Core с узкими host adapters.
Разработка и проверка должны сохранять подписи, authorization, E2E-шифрование,
durable state, replay protection и границу доставки [Сети Keystone](connectivity.md).
Ускорение недопустимо, если оно ослабляет безопасность или жизненный цикл.

## Проверенное окружение

Текущая development/validation distribution — **Omarchy (Arch Linux-based
distribution)**. Проверенный runtime: Node `v22.23.2`, pnpm `9.15.0`, package
engine `>=22 <23`.

Omarchy не является dependency Keystone. Перед platform-specific проверкой
нужно изучить реальный host. Не следует предполагать GNOME, Flatpak, apt или
dnf. Project gate не устанавливает и не изменяет системные packages. Poppler,
Tesseract, ImageMagick, ffmpeg, Wayland clipboard utilities и другие optional
tools обнаруживаются при запуске; отсутствие даёт честный статус unavailable
или blocked.

## Установка и основные команды

```bash
corepack enable
corepack prepare pnpm@9.15.0 --activate
pnpm install --frozen-lockfile

pnpm dev
pnpm tsc
pnpm test
pnpm build
pnpm docs:check
```

Web-shell — самый быстрый цикл UI-разработки. Для Desktop нужны Rust и
предпосылки Tauri. Mobile использует development/production build, потому что
custom native modules недоступны в Expo Go; для Android нужны SDK/JDK, для iOS
— macOS/Xcode.

## Слои проверок

Для работы над отдельной областью используйте focused checks:

| Область | Команда |
| --- | --- |
| Photos и media decoders | `pnpm test:media` |
| Web Library | `pnpm test:web-library` |
| Universal Inbox | `pnpm test:inbox` |
| Feeds и podcasts | `pnpm test:subscriptions` |
| Files и Shared Folders | `pnpm test:files` |
| Tasks | `pnpm test:tasks` |
| Contacts | `pnpm test:contacts` |
| Documents и scanner | `pnpm test:documents` |
| Capture | `pnpm test:capture` |

Полный набор: `pnpm test:integration`, `pnpm test:network`,
`pnpm test:performance`, `pnpm test:security`, `pnpm build` и
`pnpm release:check`. `pnpm test:network` использует независимые процессы и
реальный путь Hyperswarm/Noise, если это позволяет host. Это не доказательство
физического radio или любого mobile lifecycle.

Термины evidence принадлежат [Релизу и доказательствам](release.md):
`DECLARED`, `IMPLEMENTED`, `RUNTIME_DETECTED`, `PHYSICALLY_VERIFIED`,
`BLOCKED_BY_ENVIRONMENT`, `UNAVAILABLE` и `UNSUPPORTED`. Runtime detection,
controlled fixture и loopback proof нельзя повышать до physical evidence.

## Runtime и ресурсы

- Background и BULK-работа не должна вытеснять interactive и security-control.
- Offline-операция сохраняет durable work и не ждёт discovery синхронно. Retry
  использует bounded backoff и восстанавливается после restart.
- Cache модели/KV/decoder можно удалить. Identity, sessions, permissions,
  Memory и authoritative user data не являются cache.
- Relay, route, replay, public-cache, watcher, parser и diagnostic state имеют
  лимиты, TTL и cleanup. Private plaintext не хранится в общем performance
  cache.
- У timer, listener, child process и native session есть owner и shutdown path.
- Performance tests используют synthetic data и стабильные seeds; важны bounds,
  cleanup и isolation, а не красивое число после ослабления timeout.

## Host boundaries

Core получает interfaces для secure persistence, clocks, notifications,
clipboard, media, browser, files, model execution и transport. Host выдаёт
только typed scoped operations и повторно проверяет principal, capability,
arguments и expiry на native boundary.

Native host должен сообщать об отсутствии permissions, tools, background
execution, decoders или radios, а не подменять их успешным fixture. Core
остаётся platform-neutral. Web/PWA не является стратегией iOS, а Desktop-проверка
не доказывает поведение Android или iOS.

## Документационный workflow

У каждого устойчивого понятия есть одна owner page. Product behavior находится
в [Продукте](product.md), дизайн и boundaries — в [Архитектуре](architecture.md),
сеть — в [Сети Keystone](connectivity.md), security rules — в
[Безопасности](security.md), AI и egress — в [ИИ](ai.md), plugin behavior — в
[Plugins](plugins.md), status и readiness — в [Релизе и доказательствах](release.md).
Subsystem pages ссылаются на владельцев, а не копируют их политику.

После перемещения страницы запускайте `pnpm docs:check`. Проверка работает
без сети и зависимостей и ищет local Markdown links, обязательные EN/RU пары,
phase-style filenames и запрещённую русскую формулировку для mesh network.

## Передача в релиз

`pnpm release:check` — preflight, а не операция подписи. Владелец передаёт
updater, signing, store и optional provider credentials через release
environment. Ожидаемые credential blockers собраны в [Релизе и
доказательствах](release.md), а не в документах отдельных подсистем.
