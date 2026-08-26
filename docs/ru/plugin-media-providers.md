# Plugin media providers

Video/Music/Live providers добавляют внешние typed sources. `MediaAttribution` всегда показывает provider/creator/source; выдавать внешний контент за Keystone нельзя. Core агрегирует owner-enabled источники, проверяет metadata и Safety, показывает badges и возвращает partial results при offline/timeout. Private Memory/Vault/DM/calendar/location/relay identity провайдеру не передаются.

## Граница личной медиатеки

External providers и plugins не получают private Photos library, original
bytes, EXIF GPS, Vault state, albums или page-enumeration authority. Owner может
явно выдать narrow picker/import/decoder/export capability через typed host
boundary. Она ограничена выбранными items и operation: full-library scan,
background Camera Roll upload, public publication, deletion и second blob store
не разрешаются. Plugin rendition остаётся untrusted derived content и проходит
те же size, MIME, Content Safety, privacy и publication checks.
