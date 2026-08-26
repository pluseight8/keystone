# Documents, Reader, Annotations and Local Scanning

`DocumentService` is a first-class Reader projection over the canonical Files
layer. It stores bounded derived metadata, reading progress, annotations, OCR
results and a local search index; it does not become a second byte store. A
document identity is the canonical File ID plus its immutable File content
revision. PDF, EPUB, Markdown and plain text are supported without changing
the FileObject model.

## Canonical source and offline behavior

`ContentCacheDocumentFileSource` reads File metadata through the existing
`FileService` and bytes through the existing `ContentCache`. Shared-folder,
mail-attachment and other hosts may provide a `StaticDocumentFileSource`, but
the Reader still receives a `DocumentFileRef` and a bounded byte stream rather
than an ambient path. Source bytes are size- and content-hash-checked before
opening. The Reader can therefore work offline whenever the authorized File
content is already available locally; no cloud, central document server or
mandatory network is required.

Generated scanner PDFs are written back through `FileServiceDocumentWriter`.
The writer never mutates the source Photo/File and requires caller-provided
encrypted content metadata for a private File import. This keeps encryption
and ownership in the existing File/host boundary rather than adding a second
cryptosystem.

## Adapters and safe rendering

`DocumentAdapterRegistry` resolves by validated MIME/extension. The built-in
adapters provide:

- PDF page text, page locators, metadata, outline hints and hostile-action
  reporting;
- EPUB container/spine chapters and navigation/TOC;
- Markdown headings, lists, code, blockquotes, links and static images;
- bounded plain-text pages.

PDF and EPUB content is data, not authority. PDF JavaScript, launch actions,
remote navigation, form submission, imports, embedded files and privileged
URIs are reported or blocked; no action is executed. EPUB ZIP paths reject
traversal, malformed entries, excessive entry counts, compression expansion,
CRC failures and unsupported methods. EPUB scripts, forms, external fetches
and unsafe links never execute. Text, metadata, labels and links remain
untrusted source material and cannot authorize Keystone tools.

The core `PdfRuntimeAdapter` is a narrow production boundary. On the current
host, `LinuxPdfRuntimeAdapter` uses the runtime-discovered Poppler commands
`pdfinfo`, `pdftotext` and `pdftoppm`/`pdftocairo` through non-shell bounded
processes. It returns page text and raster bytes only; executable paths,
temporary paths and child processes do not cross into Core or UI. If the
production runtime is unavailable, the bounded static PDF adapter can still
open safe text, while raster-only operations fail closed.

## Reading state and annotations

Progress is keyed by document revision and a typed `DocumentLocator` (page,
chapter or text range). Highlights, notes and bookmarks carry the same exact
revision, quote/context where available, owner ID and version. Annotation
updates are bounded, tombstoned and mergeable. `exportPrivateSync` and
`mergePrivateSync` are owner-scoped; another identity cannot import private
progress or annotations. No progress, note or highlight is published,
memorized, sent to external AI or turned into a Task automatically.

Document-local search uses the open model. Global search uses a bounded local
index plus OCR and annotation projections, and re-checks current File
authorization and revision before returning a result. Search snippets are
presentation data and never an action grant.

## OCR and scanner capture

`OCRService` limits workers, queue length, image bytes, text and region output,
supports cancellation and accepts only an explicit local adapter. The current
Linux production adapter is `LinuxNativeOcrAdapter`, backed by the discovered
`tesseract` executable and fixed `shell: false` arguments. It probes installed
language packs at runtime, bounds stdin/stdout/stderr and timeout, and never
uploads page images or OCR text. There is no system-package installation in
the project gate.

`DocumentCaptureService` keeps a bounded in-memory draft of selected image
pages. Crop, rotate and reorder create a new PDF; the source Photo/File stays
unchanged. `PdfExportService` validates PNG/JPEG dimensions, decodes bounded
PNG filters, strips JPEG metadata for generated output and writes a fresh
PDF. The real host proof exercises image capture → PDF → Poppler rasterization
→ Tesseract OCR → local document search on a scanned page.

## Integrations and host surfaces

Vault, Tasks, Workboard, Share, Continuity, Nearby and local AI are explicit
typed adapters. A selected quote can be sent to local AI only with an explicit
scope and bounded text. Creating a Vault note, Task, Workboard card, share or
device transfer remains an explicit owner action with the source locator.
There is no external-AI adapter in the document service.

Desktop uses `desktop-documents-runtime.ts`; Mobile uses
`documentsRuntime.ts`. Both surfaces receive metadata, safe page models,
bounded search and explicit action results only. Native host installation is
optional and the UI fails closed with a host-adapter state when absent. The
implementation is platform-neutral. The current development/validation
environment is **Omarchy (Arch Linux-based distribution)** with Node
v22.23.2, pnpm 9.15.0 and package engine `>=22 <23`; this does not make
Omarchy a Keystone dependency or imply Windows/macOS/Android/iOS support.

## Validation

Focused document validation is `pnpm test:documents`. It covers PDF/EPUB/text
Reader behavior, TOC and safe rendering, progress and annotation ownership,
private own-device sync, capture/export immutability, hostile PDF/EPUB input,
bounded OCR queues, canonical FileService/content-cache integration, the real
Linux Poppler/Tesseract scanner proof and scale bounds for search/render
caches. The native test also verifies real PDF inspection/rasterization and
local OCR. Document integration, performance and security tests are included
in their corresponding Core scripts; the regular TypeScript, unit,
integration, network, performance, security, build and release checks remain
the project gates.
