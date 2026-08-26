# Безопасность

Это каноническая высокоуровневая модель безопасности Keystone. Она описывает
границы, которые должны сохранять продукт и adapters; это не независимый
penetration test и не обещание пригодности ранней development-сборки для
критичных production-сценариев.

## Принципы

- Злоумышленник может управлять своим Keystone, но никогда не должен
  управлять вашим.
- Models, plugins, remote peers, browser content, imported files, ответы
  providers и пользовательский текст — недоверенные входы, пока их не
  проверит policy конкретной операции.
- Transport даёт доступность, но не даёт trust, Identity, authorization или
  confidentiality.
- Path не является authority. Content hash проверяет целостность, но не даёт
  доступа. Relay не является collaborator. Contact не является субъектом
  authorization.
- Security — ограничение, а не компромисс ради route score. Быстрый небезопасный
  путь не может заменить медленный защищённый.
- Transport может меняться, а Identity, authorization и конфиденциальность
  приложения — нет.
- При отсутствии verifier, capability, permission или host adapter система
  отказывает безопасно. Лимиты ресурсов — часть security boundary.

## Identity и доверие к устройству

Каждая Keystone Identity имеет криптографические ключи подписи и шифрования.
Устройство становится частью личной системы владельца только через явный
trusted-device flow. Device claims ограничены scope, привязаны к epoch и могут
быть отозваны. Отзыв блокирует новые операции и устаревшее состояние, но не
притворяется удалением bytes, которые другое устройство уже получило.

Contacts, Profiles, email, телефоны, nearby endpoints, relay peers,
collaborators и собственные устройства — разные понятия. Contact помогает
организовать и разрешить человека, но не выдаёт trust. Связь Contact с
Identity создаётся явно, а её проверка остаётся отдельной от записи Contact.

## OwnerAuthority и согласие

Чувствительное действие проверяется по владельцу, target, fields, purpose, data
class, capability, expiry и текущей policy. Раскрытие и внешнее последствие
используют Double Confirmation:

```text
scoped request → владелец проверяет раскрытие → одобряет
              → проверяет точное последствие → действие выполняется
```

Одобрение связано с точным action hash, audience, nonce и expiry. Новый
destination, более широкий набор полей, изменённый URL или side effect требуют
нового решения. Чтение projection, deep link или possession reference — не
одобрение.

## Transport и E2E-защита

[Сеть Keystone](connectivity.md) переносит подписанные зашифрованные
transport-independent envelopes. Fabric и providers могут кадрировать,
фрагментировать, повторять и маршрутизировать opaque data, но не могут
расшифровать его или изменить authorization. Application acknowledgement
отличается от local/provider acceptance: «отправлено» не означает автоматически
«доставлено».

Private conversations, shared objects и device handoffs используют protection,
привязанную к получателю или membership. Shared membership проверяется по role,
invitation и epoch для каждой записи и remote change. Yjs согласует разрешённые
конкурирующие изменения, но не обходит ACL. Shared object не становится public
из-за одного стабильного ID.

Relay и anonymous forwarding peers могут видеть неизбежные timing, примерный
размер traffic и endpoint metadata. Anonymous transport plane использует
rotating ephemeral transport identities, минимум routing metadata и opaque
payload, но Keystone не обещает абсолютную анонимность или отсутствие
метаданных. Unknown peer может ограниченно ретранслировать traffic, не
становясь Contact, человеком в каталоге или trusted collaborator.

## Secrets и NativeHost

Identity seeds, device keys, recovery phrases, provider credentials, browser
cookies/tokens и signing keys остаются за границами secure storage host. Они не
попадают в prompts, URLs, logs, обычное state, plugin context, remote envelopes
или test reports. NativeHost получает одну scoped operation и снова проверяет
principal, capability, arguments и expiry.

Renderer и mobile UI не получают raw filesystem paths, process handles,
transport handles, secret-store handles или unrestricted shell/input. Выбранные
владельцем file roots используют opaque handles, bounded relative operations,
проверку traversal/symlink и atomic writes. OS permissions, battery, thermal и
background limits окончательны; Keystone их не обходит.

## Недоверенный content и media

Imported files, PDF, EPUB, HTML, SVG, image/audio/video, MIME metadata,
archive names, OCR output, feed entries, Mail bodies и browser pages — данные,
а не программы или policy. Parsers и decoders ограничивают size, nesting,
memory, dimensions, duration, paths, decompression и timeout. Preview — это
производное неактивное представление.

Reader не исполняет PDF/EPUB scripts, macros, launch actions, forms, embedded
commands или automatic external fetch. Mail и feed HTML sanitizes; remote images
и tracking resources по умолчанию не загружаются. Photos хранит originals
отдельно от thumbnails и renditions. Capture сохраняет bounded metadata или
opaque file handle, а не произвольные bytes. См. [Documents](documents.md),
[Photos](photos.md), [Mail](mail.md) и [Capture](capture.md).

## Links, Browser и external providers

External links проходят через typed `ExternalLinkGateway`. URL, deep link, feed
origin или provider response не могут вызвать команду, открыть credential,
получить private-network target или выдать plugin capability. Browser Companion
принимает только ограниченный loopback protocol и не передаёт Core cookies,
authorization headers или произвольный JavaScript.

Mail, feeds, Web origins и optional media providers сохраняют собственные
server/provider authority. Keystone не превращает ConnectivityFabric в HTTP
proxy, mail server, generic cloud backend или источник provider credentials.
Provider data имеет явный источник и не попадает автоматически в Memory, Vault,
Contacts, Tasks или External AI.

## Plugins, Skills и AI

Plugins — недоверенный code за изолированным host runtime. Manifest request не
является grant; capabilities узкие, scoped, revocable и reviewed. Plugin не
получает Identity/device/recovery secrets, raw transport, filesystem paths,
arbitrary network или Core database. Output, provider registrations и Skills
подчиняются OwnerAuthority, ToolPolicy, SafetySurfaceGate и egress policy.
Подробности — в [Plugins](plugins.md).

Skills — декларативные инструкции, а не executable authority. Их текст,
примеры и dependencies недоверны; install, update, enable и новые permissions
требуют явного review.

Local AI необязателен и всегда является untrusted compute. Он получает только
выбранный bounded context, разрешённый permission и data class. External AI —
явный egress и не получает неявно приватные Vault, Memory, Contacts, Mail,
Tasks, Documents, Capture, Location или Files. Models propose; policy decides;
user authorizes consequences. Remote content не расширяет tools или permissions.
См. [ИИ](ai.md).

## Приватность Location

Location — private typed capability от OS/native provider. Feature запрашивает
just-in-time scope: one-shot, foreground или явно подтверждённый background,
с approximate или precise resolution. Отказ показывается как unavailable. Нет
fallback через IP, Wi‑Fi fingerprint, Contact, Maps, Task, Document, Capture
или relay metadata; history перемещений по умолчанию не создаётся.

Place и geographic route в Maps не доказывают, где человек был, живёт или
работает. Geographic route не является route Сети Keystone.

## Состояние для пользователя

Security Center должен показывать последствия: что private, чем поделились,
какое устройство или provider участвует, какого permission не хватает и что
будет дальше. Raw capability IDs, route scores, peer topology и internal error
codes относятся к developer diagnostics. Отсутствующая capability — честное
blocked/unavailable состояние, а не сымитированный успех.

Технические ссылки на protocol, immutable policy, secrets, hostile input и
NativeHost собраны в [Архитектуре](architecture.md), [Разработке](development.md)
и [Threat model](threat-model.md).
