# Граница media/document decoder

Image, audio, video, PDF, HTML и SVG — недоверенные bytes. `SandboxedMediaDecoder` и `DocumentPreviewHost` — typed host boundaries. До decoder применяются лимиты dimensions/pixels, frames, duration, metadata, memory и nesting.

Decoder output имеет `UNTRUSTED_DERIVED`, а не trusted prompt/executable status. Preview не декодирует весь поток и не загружает external resources. Document previews отключают macros, scripts, external commands и automatic network fetch; markup становится non-active representation.

Originals и derivatives Photos используют отдельную canonical boundary
`MediaDecoder` → `NativeHost.media()`, описанную в `docs/ru/photos.md`.
Существующий `SandboxedMediaDecoder` остаётся bounded quarantine/preview
safety surface; ни одна граница не выдаёт publication, location, AI или
произвольную filesystem authority.
