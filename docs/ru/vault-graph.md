# Граф Vault

Vault Graph — ограниченная и перестраиваемая проекция Markdown-first Vault. Источником истины остаются `VaultService` и Markdown-файлы; граф не становится второй базой содержимого заметок.

`VaultGraphService` строит узлы NOTE, HEADING, BLOCK, ATTACHMENT, TAG, CANVAS и typed Keystone references из `VaultIndex`/`VaultLinkIndex`. Рёбра включают wikilinks, Markdown links, embeds/transclusion, ссылки на heading/block, связи тегов и явные связи Canvas. Неразрешённые и неоднозначные цели отображаются отдельными узлами.

Global и Local Graph используют bounded queries, фильтры папок/тегов/properties/date/types, orphan/minimum-degree, поиск, depth и пагинацию. Corrupt/stale graph cache безопасно удаляется и строится заново из индексов. Zoom, pan, selection, filters и FORCE/RADIAL/GRID — состояние workspace, а не Markdown. Для доступности есть клавиатурный список узлов и рёбер.

AI получает graph context только явно и только локально/trusted. Suggestion отношения не становится знанием без пользовательского подтверждения.
