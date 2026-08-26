# Фотографии и личная медиатека

Photos — приватная local-first медиатека Keystone для явно выбранных владельцем
изображений и видео. Это metadata index и policy-поверхность над существующей
content-addressed границей. Это не cloud Photos, не второй blob store, не
автоматическая загрузка Camera Roll и не публичный media cache.

Канонический код: [`packages/core/src/media-library.ts`](../../packages/core/src/media-library.ts).
Typed host projections: [`desktop-photos-runtime.ts`](../../apps/desktop/src/desktop-photos-runtime.ts)
и [`photosRuntime.ts`](../../apps/mobile/src/photosRuntime.ts).

## Product contract

Владелец явно выбирает файл, папку, scope Camera Roll на mobile или optional
watched-folder scope. Импорт ограничен и сообщает результат по каждому item.
Asset появляется в библиотеке только после проверки signature, metadata,
content hash и content manifest. Ошибка одного элемента папки не откатывает
успешные элементы и не скрывает ошибку.

Поддерживаются:

- paginated/virtualizable timeline с группами year/month/day;
- private albums со ссылками на media, favorites, tags, captions и local
  search по filename, title, caption, tags, date, kind и basic camera metadata;
- bounded thumbnails, previews, video frames и edit renditions;
- просмотр EXIF/metadata и явная map projection для embedded GPS;
- placement на device: metadata, thumbnail и явно подтверждённый original;
- явная передача в Messages, Contacts, Spaces, Nearby, own device или
  Personal Web;
- trash, restore и owner-confirmed permanent delete с tombstones;
- non-destructive image recipes, включая rotate/crop.

Album — это reference, а не копия bytes. Shared album может использовать
существующую collaboration boundary для references/comments, но bytes не входят
в CRDT. Публичная публикация — отдельное явное действие и использует намеренно
созданную rendition.

## Storage и identity

`MediaAsset` хранит `ContentId`, ограниченные metadata, filename, local state,
tags и идентификатор выбора источника. Он не хранит original bytes, абсолютный
path, camera-roll handle или `hidden` flag. Original импортируется через
существующие `ContentManifest`/content store с policy
`PRIVATE_NO_STRANGER_CACHE`.

Exact SHA-256 content identity — ключ duplicate. Повторный выбор тех же bytes
даёт `DUPLICATE`, даже если filename изменился. Perceptual similarity не
подменяет exact identity. Derivative имеет собственную identity и ключуется
source content hash, kind, recipe version и recipe hash. Corrupt/missing
derivative regenerates; original не меняется.

State store сохраняет assets, import jobs, albums, derivatives, placements,
watched-folder state и deletion tombstones. При hydration схема и limits
проверяются до принятия record. Non-terminal job восстанавливается как failed;
half-imported asset не показывается. Tombstone не позволяет delayed metadata или
content message воскресить permanent delete.

## Host и import boundary

Host владеет native picker и создаёт scoped `MediaImportSource` только после
owner action. `NativeFileSystem` handles читаются через typed capabilities;
filesystem paths не проходят в core/UI projection. Watched folder — explicit
opt-in и может быть остановлен без удаления уже импортированных assets.
Полного scan home directory, disk или Camera Roll без concrete owner scope нет.

Mobile camera-roll boundary typed и explicit. Background auto-upload отсутствует.
Browser downloads, Files, drag-and-drop, mail attachments и Nearby objects
попадают в library только после явного действия. Host может сообщить
`UNAVAILABLE`, не меняя private core contract.

## Metadata и privacy location

Embedded EXIF/container metadata — untrusted и bounded. Safe probe может
сохранить dimensions, duration, orientation, capture time, camera make/model и
embedded coordinates. GPS остаётся media metadata: оно не передаётся в
`LocationService`, route scoring, movement history, Home/Work inference или
routine profile. External reverse geocoder не включается молча.

Локальное чтение metadata не требует location permission. Map projection —
отдельное explicit owner action. Перед sharing media с embedded GPS destination
должен получить отдельное решение о координатах. Metadata-stripped export —
optional derivative/copy; original и его metadata сохраняются. Locked Vault
media исключается из обычного search, thumbnails и notifications до разрешения
существующей Vault policy.

Нет face/person recognition, automatic captions, обязательного OCR, nostalgia
notifications, movement inference или silent AI. Если включён Local AI adapter,
он работает только с явно выбранными локальными данными и не может сам
publish/share/delete, менять privacy, identify person или вызывать external AI.

## Derivatives и editing

Production path один: `MediaLibraryService` использует typed `MediaDecoder`,
`NativeHostMediaDecoderAdapter` запрашивает scoped capability `media.decode`, а
`NativeHost.media()` владеет platform runtime. На текущем Omarchy (Arch
Linux-based distribution) `LinuxNativeMediaHost` напрямую запускает уже
доступные `identify`/ImageMagick и `ffprobe`/`ffmpeg` через structured args,
stdin bytes, `shell:false`, bounded input/output, timeout, cancellation и
bounded process queue. Core не импортирует эти tools, decoder не делает
внешних network requests.

Image metadata и PNG thumbnail/preview, а также MP4/WebM metadata и один PNG
video frame прошли runtime verification через production adapter. Output
заново открывается и проверяется по type, size и dimensions до помещения в
canonical private content store. Original read-only и byte-for-byte не
меняется. На unsupported host original сохраняется, а результат честно
остаётся unavailable/unsupported; deterministic adapter core — только явный
controlled-test input и никогда не production fallback.

Editing recipe non-destructive и versioned. Rotate/crop — Release 0 minimum,
если host tooling это поддерживает. Edited export — новый content; destructive
write original и обязательный video editing отсутствуют.

## Devices, sharing и publication

Placement переиспользует Personal Device Mesh, Distributed Content и Continuity.
Metadata и thumbnail могут прийти раньше original. Original
transfer explicit, сообщает `PENDING`/`UNAVAILABLE` честно и не начинает
большую передачу молча на metered route. Offline/revocation не превращаются в
ложное `available`.

Copy, album/reference access, own-device placement и publication — разные
операции. Messages, Nearby, Contacts и Spaces получают только выбранный asset
после owner confirmation. Personal Web принимает только intentional
non-original rendition; только она может иметь `PUBLIC_CACHEABLE`. Hash private
original не даёт публичного cache. Уже доставленная внешняя копия не удаляется
локальным trash/permanent delete.

## Security boundary

Import/decoder boundary отклоняет fake extension, signature/MIME mismatch,
truncated header, malformed metadata, path traversal, path leakage, giant
dimensions, metadata bomb, invalid coordinates, polyglot ambiguity и corrupt
derivative. Distributed Content проверяет content/chunk hashes перед remote original.
Content hash — identity/integrity, не authorization.

Private original не попадает в stranger/public cache. Remote metadata projection
не создаёт blob, не обходит Vault visibility, не перечисляет pages, не оживляет
tombstone и не выдаёт plugin/browser/agent/external AI доступ ко всей library.
Plugin может дать узкий picker/decoder/provider capability только после owner
enable; произвольный filesystem и full library недоступны.

## Validation и evidence

Dedicated media gate:

```sh
pnpm test:media
```

Scale suite проверяет 100 000 metadata records, большие album references,
bounded search и derivative state. Integration проверяет два same-owner service
instances, metadata-first placement, preview/original fetch, offline,
revocation и explicit selection для Messages/Nearby/own-device/Personal Web.
Более широкий `test:network` продолжает проверять реальные
Hyperswarm/Noise/Fabric foundations; media-specific integration остаётся
controlled/hybrid evidence и не называется physical second-device proof.

| Surface | Текущее evidence | Classification |
| --- | --- | --- |
| Safe signature/metadata probe | Core implementation и tests | `IMPLEMENTED` |
| Host small image/video tools | `identify` и `ffmpeg`/`ffprobe` прошли на текущем host | `RUNTIME_DETECTED` |
| Production Keystone decoder adapter | `MediaDecoder` → `NativeHost.media()` → bounded Linux process adapter | `IMPLEMENTED` |
| Real PNG/JPEG metadata и image derivatives | Production `MediaLibraryService`; derivative reopened/validated; original hash unchanged | `PHYSICALLY_VERIFIED` (same-host runtime) |
| Real MP4/WebM probe и video frame | Production `MediaLibraryService`; duration/dimensions/frame verified; original hash unchanged | `PHYSICALLY_VERIFIED` (same-host runtime) |
| Android/iOS camera-roll hardware | Физические устройства не подключены | `UNAVAILABLE` |
| Public/private publication boundary | Controlled rendition proof и policy tests | `IMPLEMENTED` |

Текущий development/validation distribution — **Omarchy (Arch Linux-based
distribution)**; Node v22.23.2, pnpm 9.15.0, package engine `>=22 <23`.
Platform-specific package или desktop assumptions не выводятся из этого host;
Keystone остаётся platform-neutral. Production release checks всё ещё требуют
owner-supplied updater и Expo credentials, где они нужны.
