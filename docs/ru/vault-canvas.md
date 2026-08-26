# Vault Canvas

Canvas — structured first-class сущность Vault, сохраняемая как versioned JSON через `CanvasStorageAdapter`. Документ имеет стабильный ID, Vault ID, revision, timestamps, viewport, selection, metadata, typed nodes и edges. Это не screenshot и не копия содержимого заметок/файлов.

Поддерживаются `NOTE_CARD`, `TEXT_CARD`, `FILE_CARD`, `IMAGE_CARD`, `WEB_CARD`, `GROUP`, `KEYSTONE_OBJECT_CARD`. Карточки хранят ссылки; открытие проходит существующие permission boundaries. `Convert to Note` явно превращает Text Card в Markdown note.

Typed mutations покрывают create/move/resize/update/duplicate/delete/copy-paste/connect/disconnect/group/ungroup, viewport и selection. Есть revision conflict checks, bounded undo/redo/history. Corrupt Canvas JSON изолирован и не повреждает заметки или attachments. Desktop — основной редактор; mobile даёт bounded просмотр, pan/zoom и переход по карточкам.
