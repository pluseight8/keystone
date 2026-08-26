# Transclusion в Vault

`VaultTransclusionService` рендерит `![[Note]]`, `![[Note#Heading]]`, `![[Note#^block-id]]`, относительные image/file embeds и обычные Markdown image links. Markdown остаётся единственным редактируемым источником; каждый fragment содержит provenance Vault/note/path/heading/block.

Embedded note читается read-through. Действие **Edit source** вызывает обычный `VaultService.updateNote` с revision boundary. Неоднозначные inline edits не выполняются.

Глубина и размер результата ограничены. Циклы A↔B и длинные циклы дают безопасный placeholder, missing note/heading/block/attachment — явное состояние. Бинарные attachments не загружаются целиком в render prompt.

Note/File/Web content считается untrusted и не получает AI/browser/capabilities. External AI не видит private transcluded context.
