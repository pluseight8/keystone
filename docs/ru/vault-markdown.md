# Markdown-формат Vault

Keystone читает обычный UTF-8 Markdown и сохраняет неизвестный пользователю текст. Поддерживаются typed frontmatter properties: `string`, `number`, `boolean`, `date`, `datetime`, списки, `tags`, `links`, а также aliases и inline `#tags`/`@mentions`. При необходимости writer добавляет `keystone_id`, не конвертируя каталог.

Malformed frontmatter становится diagnostic, но тело остаётся читаемым. Большие заметки ограниченно индексируются. Attachments остаются обычными файлами и не загружаются целиком в AI-контекст.

Desktop/mobile используют host adapter для source editor, preview, outline, properties, backlinks, create/rename/move/delete и debounced atomic save. Существующий Markdown-каталог можно подключить напрямую; `.keystone` sidecar можно удалить и восстановить.
