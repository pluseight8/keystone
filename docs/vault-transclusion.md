# Vault Transclusion

`VaultTransclusionService` renders `![[Note]]`, `![[Note#Heading]]`, `![[Note#^block-id]]`, relative image/file embeds and ordinary Markdown image links. The source Markdown remains the only editable content; rendered fragments carry Vault/note/path/heading/block provenance.

Embedded notes are read-through. A user can choose **Edit source**, which calls the normal `VaultService.updateNote` mutation and revision boundary. Inline editing never guesses which source should receive a write.

Rendering is bounded by maximum depth and output characters. A↔B and longer cycles produce safe placeholders with diagnostics; missing notes, headings, blocks and attachments produce explicit missing states. Attachments are represented by MIME/size/path metadata and are not read into the render prompt as giant binary content.

Notes and file embeds are untrusted context. Canvas placement, transclusion or a web card never grants Vault, browser or AI capabilities. External AI cannot receive private transcluded context through the Unified Context resolver.
