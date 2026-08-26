# Документы, Reader, аннотации и локальное сканирование

`DocumentService` — first-class Reader projection над каноническим слоем
Files. Он хранит только bounded derived metadata, progress, annotations, OCR
results и локальный search index; второй byte store не создаётся. Identity
документа — canonical File ID и immutable File content revision. Поддержаны
PDF, EPUB, Markdown и plain text без изменения модели FileObject.

## Канонический источник и offline

`ContentCacheDocumentFileSource` получает metadata через существующий
`FileService`, а bytes — через существующий `ContentCache`. Shared-folder,
mail-attachment и другие hosts могут дать `StaticDocumentFileSource`, но
Reader всё равно получает `DocumentFileRef` и bounded byte stream, а не
ambient path. Перед открытием проверяются размер и content hash. Поэтому
Reader работает offline, если authorized File content уже есть локально;
cloud, central document server и обязательная сеть не нужны.

Сгенерированный scanner PDF записывается обратно через
`FileServiceDocumentWriter`. Writer не меняет исходный Photo/File и требует
переданные caller-ом encrypted content metadata для private File import.
Шифрование и ownership остаются в существующей File/host boundary, новая
криптосистема не добавляется.

## Adapters и безопасный render

`DocumentAdapterRegistry` выбирает adapter по проверенному MIME/extension.
Встроенные adapters дают:

- PDF page text, locators, metadata, outline hints и отчёт hostile actions;
- EPUB container/spine chapters и navigation/TOC;
- Markdown headings, lists, code, blockquotes, links и static images;
- bounded plain-text pages.

PDF и EPUB — data, а не authority. PDF JavaScript, launch, remote navigation,
form submission, imports, embedded files и privileged URI блокируются или
отмечаются; ничего не исполняется. EPUB ZIP отвергает traversal, malformed
entries, excessive entries, compression expansion, CRC errors и неподдержанные
методы. EPUB scripts, forms, external fetches и unsafe links не исполняются.
Text, metadata, labels и links остаются untrusted source material и не могут
авторизовать Keystone tools.

Core `PdfRuntimeAdapter` — узкая production boundary. На текущем host
`LinuxPdfRuntimeAdapter` использует найденные runtime команды Poppler
`pdfinfo`, `pdftotext`, `pdftoppm`/`pdftocairo` через bounded non-shell
processes. В Core/UI проходят только page text и raster bytes; executable
paths, temporary paths и child processes не проходят. Если production runtime
недоступен, bounded static PDF adapter всё ещё открывает безопасный text, а
raster-only операции завершаются fail-closed.

## Reading state и annotations

Progress привязан к revision документа и typed `DocumentLocator` (page,
chapter или text range). Highlights, notes и bookmarks несут ту же exact
revision, quote/context если доступны, owner ID и version. Обновления bounded,
tombstoned и mergeable. `exportPrivateSync`/`mergePrivateSync` ограничены
owner; другая Identity не может импортировать private progress или
annotations. Никакой progress, note или highlight автоматически не
публикуется, не попадает в Memory, external AI или Task.

Document-local search работает по open model. Global search использует bounded
local index с OCR и annotation projections и перед выдачей заново проверяет
текущие File authorization и revision. Search snippets — presentation data,
не action grant.

## OCR и scanner capture

`OCRService` ограничивает workers, queue, image bytes, text и region output,
поддерживает cancellation и принимает только явный local adapter. Текущий
Linux production adapter — `LinuxNativeOcrAdapter` на обнаруженном
`tesseract` с фиксированными аргументами и `shell: false`. Language packs
проверяются runtime, stdin/stdout/stderr и timeout bounded, page images и OCR
text никуда не upload-ятся. Project gate не устанавливает системные пакеты.

`DocumentCaptureService` держит bounded in-memory draft выбранных image pages.
Crop, rotate и reorder создают новый PDF; исходный Photo/File остаётся
неизменным. `PdfExportService` проверяет размеры PNG/JPEG, декодирует bounded
PNG filters, очищает JPEG metadata в generated output и создаёт новый PDF.
Реальный host proof проходит image capture → PDF → Poppler rasterization →
Tesseract OCR → local document search по scanned page.

## Интеграции и host surfaces

Vault, Tasks, Workboard, Share, Continuity, Nearby и local AI — explicit typed
adapters. Выбранная цитата может попасть только в local AI после явного scope
и bounded text. Создание Vault note, Task, Workboard card, share или device
transfer остаётся explicit owner action с source locator. External-AI adapter в
document service отсутствует.

Desktop использует `desktop-documents-runtime.ts`, Mobile —
`documentsRuntime.ts`. Обе поверхности получают только metadata, safe page
models, bounded search и explicit action results. Native host подключается
опционально; без него UI показывает host-adapter state и fail-closed. Реализация
platform-neutral. Текущая development/validation environment —
**Omarchy (Arch Linux-based distribution)**, Node v22.23.2, pnpm 9.15.0,
package engine `>=22 <23`; Omarchy не становится Keystone dependency и из неё
не выводится Windows/macOS/Android/iOS support.

## Validation

Focused gate: `pnpm test:documents`. Он покрывает PDF/EPUB/text Reader, TOC и
safe rendering, progress и ownership annotations, private own-device sync,
capture/export immutability, hostile PDF/EPUB input, bounded OCR queues,
canonical FileService/content-cache integration, реальный Linux
Poppler/Tesseract scanner proof и scale bounds для search/render cache. Native
test также проверяет настоящий PDF inspect/rasterization и local OCR. Document
integration, performance и security tests включены в соответствующие Core
scripts; обычные TypeScript, unit, integration, network, performance,
security, build и release проверки остаются общими project gates.
