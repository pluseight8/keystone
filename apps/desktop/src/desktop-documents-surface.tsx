import React from 'react';
import type { DocumentLocator, DocumentRevisionRef } from '@keystone/core';
import type { DesktopShellController, DesktopTab } from './desktop-shell-model';
import { getDesktopDocumentsRuntime, subscribeDesktopDocumentsRuntime, type DesktopDocumentsRuntime } from './desktop-documents-runtime';
import type { DesktopLocalDocumentsRuntime } from './desktop-local-runtime';
import { pickDesktopFile } from './desktop-host-bridge';
import { errorText, formatBytes } from './desktop-format';
import { Icon } from './desktop-icons';
import { TypedReferenceDock } from './desktop-reference-dock';

interface DocumentsCopy {
  readonly documents: string;
  readonly refresh: string;
  readonly home: string;
  readonly links: string;
  readonly shareLink: string;
  readonly openInTab: string;
}

interface DocumentDraft {
  readonly base?: { readonly fileId: string; readonly revision: DocumentRevisionRef['revisionId'] };
  readonly filename: string;
  readonly content: string;
}

function newDraft(ru: boolean): DocumentDraft {
  return {
    filename: `${ru ? 'Документ' : 'Untitled'}-${new Date().toISOString().slice(0, 10)}.md`,
    content: ru ? '# Новый документ\n\n' : '# New document\n\n',
  };
}

type DesktopDocumentFile = Awaited<ReturnType<DesktopDocumentsRuntime['listSupportedFiles']>>[number];
type DesktopDocumentReader = Awaited<ReturnType<DesktopDocumentsRuntime['open']>>;
type DesktopDocumentRenderedPage = Awaited<ReturnType<DesktopDocumentReader['renderPage']>>;
type DesktopDocumentSearchResult = Awaited<ReturnType<DesktopDocumentsRuntime['search']>>[number];
type DesktopDocumentAnnotation = Awaited<ReturnType<DesktopDocumentsRuntime['listAnnotations']>>[number];

export function DocumentsSurface({ tab, shell, t }: { tab: DesktopTab; shell: DesktopShellController; t: DocumentsCopy }) {
  const ru = t.documents === 'Документы';
  const [runtime, setRuntime] = React.useState<DesktopDocumentsRuntime | undefined>(getDesktopDocumentsRuntime);
  const [files, setFiles] = React.useState<readonly DesktopDocumentFile[]>([]);
  const [recent, setRecent] = React.useState<readonly Awaited<ReturnType<DesktopDocumentsRuntime['recent']>>[number][]>([]);
  const [reader, setReader] = React.useState<DesktopDocumentReader>();
  const readerRef = React.useRef<DesktopDocumentReader>();
  const openSequence = React.useRef(0);
  const openTarget = React.useRef<string>();
  const [pageNumber, setPageNumber] = React.useState(1);
  const [rendered, setRendered] = React.useState<DesktopDocumentRenderedPage>();
  const [imageUrl, setImageUrl] = React.useState<string>();
  const [query, setQuery] = React.useState('');
  const [results, setResults] = React.useState<readonly DesktopDocumentSearchResult[]>([]);
  const [annotations, setAnnotations] = React.useState<readonly DesktopDocumentAnnotation[]>([]);
  const [ocr, setOcr] = React.useState<Awaited<ReturnType<DesktopDocumentsRuntime['recognizePage']>>>();
  const [ocrJob, setOcrJob] = React.useState<Awaited<ReturnType<DesktopDocumentsRuntime['recognizeDocument']>>>();
  const [note, setNote] = React.useState('');
  const [draft, setDraft] = React.useState<DocumentDraft | undefined>(() => tab.object?.id === 'new-document' ? newDraft(ru) : undefined);
  const [saving, setSaving] = React.useState(false);
  const savingRef = React.useRef(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [notice, setNotice] = React.useState('');
  const labels = ru
    ? { subtitle: 'PDF, EPUB, Markdown и текст · локальная работа без сети', search: 'Искать в документах', open: 'Открыть', previous: 'Назад', next: 'Далее', bookmark: 'Закладка', addNote: 'Сохранить заметку', note: 'Приватная заметка к странице', ocrPage: 'Распознать страницу', ocrDocument: 'Распознать документ', outline: 'Оглавление', annotations: 'Аннотации', recent: 'Недавние', files: 'Доступные файлы', noFiles: 'Поддерживаемых документов нет.', choose: 'Выберите документ для чтения.', noRuntime: 'Просмотрщик пока недоступен.', boundary: 'Выберите документ в локальном хранилище. Внешнее распознавание и загрузка в AI не выполняются.', page: 'Страница', chapter: 'Глав', safe: 'БЕЗОПАСНЫЙ ТЕКСТ', raster: 'ИЗОБРАЖЕНИЕ', saved: 'Сохранено локально', noResults: 'Совпадений нет.', ocrDone: 'Распознавание сохранено локально.' }
    : { subtitle: 'PDF, EPUB, Markdown and text · works offline', search: 'Search documents', open: 'Open', previous: 'Previous', next: 'Next', bookmark: 'Bookmark', addNote: 'Save note', note: 'Private page note', ocrPage: 'Recognize page', ocrDocument: 'Recognize document', outline: 'Outline', annotations: 'Annotations', recent: 'Recent', files: 'Available files', noFiles: 'No supported documents.', choose: 'Choose a document to read.', noRuntime: 'Reader is not available yet.', boundary: 'Choose a document from local storage. External OCR and AI uploads are not used.', page: 'Page', chapter: 'chapters', safe: 'SAFE TEXT', raster: 'IMAGE', saved: 'Saved locally', noResults: 'No matches.', ocrDone: 'OCR saved locally.' };
  if (ru) {
    labels.noRuntime = 'Просмотрщик пока недоступен.';
    labels.boundary = 'Выберите документ в локальном хранилище. Внешнее распознавание и загрузка в AI не используются.';
    labels.safe = 'БЕЗОПАСНЫЙ ТЕКСТ';
    labels.raster = 'ИЗОБРАЖЕНИЕ';
  }

  React.useEffect(() => subscribeDesktopDocumentsRuntime(() => setRuntime(getDesktopDocumentsRuntime())), []);
  const refresh = React.useCallback(async () => {
    if (!runtime) { setFiles([]); setRecent([]); return; }
    try {
      const [nextFiles, nextRecent] = await Promise.all([runtime.listSupportedFiles(), runtime.recent()]);
      setFiles(nextFiles); setRecent(nextRecent);
    } catch (reason) { setNotice(reason instanceof Error ? reason.message : String(reason)); }
  }, [runtime]);
  React.useEffect(() => { void refresh(); }, [refresh]);
  React.useEffect(() => () => {
    openSequence.current += 1;
    openTarget.current = undefined;
    readerRef.current?.close();
    readerRef.current = undefined;
  }, []);
  React.useEffect(() => {
    if (!runtime) return undefined;
    const unsubscribe = runtime.subscribe?.(() => { void refresh(); });
    return unsubscribe;
  }, [refresh, runtime]);
  React.useEffect(() => {
    if (!reader || !reader.pages.length) { setRendered(undefined); setImageUrl(undefined); return undefined; }
    const page = Math.max(1, Math.min(pageNumber, reader.pages.length));
    if (page !== pageNumber) { setPageNumber(page); return undefined; }
    let active = true;
    void reader.renderPage(page, { scale: 1 }).then(value => { if (active) { setRendered(value); setImageUrl(value.imageBytes && value.mimeType ? documentBytesToDataUrl(value.imageBytes, value.mimeType) : undefined); } }).catch(reason => { if (active) setNotice(reason instanceof Error ? reason.message : String(reason)); });
    return () => { active = false; };
  }, [reader, pageNumber]);

  const openFile = React.useCallback(async (fileId: string, locator?: DocumentLocator) => {
    if (!runtime) return;
    const sequence = ++openSequence.current;
    openTarget.current = fileId;
    let nextReader: DesktopDocumentReader | undefined;
    try {
      nextReader = await runtime.open(fileId);
      const [progress, nextAnnotations] = await Promise.all([
        runtime.progress(nextReader.document.documentId),
        runtime.listAnnotations(nextReader.document.documentId),
      ]);
      if (sequence !== openSequence.current) return;
      const oldReader = readerRef.current;
      if (oldReader && oldReader.document.documentId !== nextReader.document.documentId) oldReader.close();
      readerRef.current = nextReader;
      setReader(nextReader);
      setAnnotations(nextAnnotations);
      setOcr(undefined);
      setOcrJob(undefined);
      setConfirmDelete(false);
      setImageUrl(undefined);
      setRendered(undefined);
      const location = locator ?? progress?.locator;
      const chapterIndex = nextReader.pages.findIndex(page => location?.chapterId && page.locator.chapterId === location.chapterId);
      setPageNumber(Math.max(1, Math.min(nextReader.pages.length, location?.page ?? chapterIndex + 1)));
      setNotice('');
    } catch (reason) {
      if (sequence === openSequence.current) setNotice(errorText(reason, ru ? 'Не удалось открыть документ.' : 'Could not open the document.'));
    } finally {
      if (nextReader && nextReader.document.documentId !== readerRef.current?.document.documentId
        && (sequence === openSequence.current || openTarget.current !== fileId)) nextReader.close();
    }
  }, [runtime, ru]);

  const requestedFileId = tab.object?.id;
  React.useEffect(() => {
    if (requestedFileId && requestedFileId !== 'documents' && requestedFileId !== 'document' && requestedFileId !== 'new-document') {
      void openFile(requestedFileId);
    }
  }, [openFile, requestedFileId]);

  const localRuntime = runtime as Partial<DesktopLocalDocumentsRuntime> | undefined;
  const startEditing = async () => {
    if (!reader || !localRuntime?.readText) return;
    try {
      const content = await localRuntime.readText(reader.document.file.fileId);
      if (reader !== readerRef.current) return;
      if (content === undefined) throw new Error(ru ? 'Этот документ нельзя редактировать.' : 'This document cannot be edited.');
      setDraft({
        base: { fileId: reader.document.file.fileId, revision: reader.document.revision.revisionId },
        filename: reader.document.filename,
        content,
      });
      setConfirmDelete(false);
      setNotice('');
    } catch (reason) { setNotice(errorText(reason, ru ? 'Операция с документом не завершилась.' : 'The document operation failed.')); }
  };

  const saveDraft = async () => {
    if (!draft || !localRuntime || savingRef.current) return;
    const filename = draft.filename.trim();
    if (!filename) return;
    savingRef.current = true;
    setSaving(true);
    setNotice('');
    try {
      const input = { filename, content: draft.content };
      const ref = draft.base
        ? await localRuntime.updateText?.({ ...input, fileId: draft.base.fileId, baseRevision: draft.base.revision })
        : await localRuntime.createText?.(input);
      if (!ref) throw new Error(labels.noRuntime);
      setDraft(undefined);
      setResults([]);
      await openFile(ref.fileId);
      await refresh();
    } catch (reason) {
      setNotice(errorText(reason, ru ? 'Операция с документом не завершилась.' : 'The document operation failed.'));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const deleteDocument = async () => {
    if (!reader || !localRuntime?.deleteFile) return;
    if (!confirmDelete) { setConfirmDelete(true); return; }
    try {
      await localRuntime.deleteFile(reader.document.file.fileId);
      reader.close();
      readerRef.current = undefined;
      setReader(undefined);
      setConfirmDelete(false);
      await refresh();
      setNotice(ru ? 'Документ удалён с этого устройства.' : 'Document deleted from this device.');
    } catch (reason) { setNotice(reason instanceof Error ? reason.message : String(reason)); }
  };
  const importLocalDocument = async (file: { readonly name: string; readonly mimeType: string; readonly bytes: Uint8Array }) => {
    if (!localRuntime?.importFile) { setNotice(labels.noRuntime); return; }
    try {
      const ref = await localRuntime.importFile({ filename: file.name, mimeType: file.mimeType || 'application/octet-stream', bytes: file.bytes });
      await openFile(ref.fileId);
      await refresh();
    } catch (reason) { setNotice(reason instanceof Error ? reason.message : String(reason)); }
  };
  const pickDocument = async () => {
    try { const file = await pickDesktopFile('document'); if (file) await importLocalDocument(file); }
    catch (reason) { setNotice(reason instanceof Error ? reason.message : String(reason)); }
  };
  const dropDocument = async (file: File) => importLocalDocument({ name: file.name, mimeType: file.type || 'application/octet-stream', bytes: new Uint8Array(await file.arrayBuffer()) });
  const currentPage = reader?.pages[pageNumber - 1];
  const hasDocuments = files.length > 0 || Boolean(reader || draft);
  const saveProgress = async () => { if (!runtime || !reader || !currentPage) return; try { await runtime.saveProgress(reader.document.documentId, currentPage.locator); setNotice(labels.saved); } catch (reason) { setNotice(reason instanceof Error ? reason.message : String(reason)); } };
  const addBookmark = async () => { if (!runtime || !reader || !currentPage) return; try { const value = await runtime.addBookmark({ documentId: reader.document.documentId, locator: currentPage.locator, label: currentPage.text.slice(0, 80) }); setAnnotations(current => [...current.filter(item => item.id !== value.id), value]); setNotice(labels.saved); } catch (reason) { setNotice(reason instanceof Error ? reason.message : String(reason)); } };
  const addNote = async () => { if (!runtime || !reader || !currentPage || !note.trim()) return; try { const value = await runtime.addNote({ documentId: reader.document.documentId, locator: currentPage.locator, body: note.trim() }); setAnnotations(current => [...current.filter(item => item.id !== value.id), value]); setNote(''); setNotice(labels.saved); } catch (reason) { setNotice(reason instanceof Error ? reason.message : String(reason)); } };
  const runSearch = async (event: React.FormEvent) => { event.preventDefault(); if (!runtime || !query.trim()) { setResults([]); return; } try { setResults(await runtime.search(query.trim(), { limit: 64 })); } catch (reason) { setNotice(reason instanceof Error ? reason.message : String(reason)); } };
  const recognizePage = async () => { if (!runtime || !reader || !currentPage) return; try { setOcr(await runtime.recognizePage(reader.document.documentId, pageNumber)); setNotice(labels.ocrDone); } catch (reason) { setNotice(reason instanceof Error ? reason.message : String(reason)); } };
  const recognizeDocument = async () => { if (!runtime || !reader) return; try { const value = await runtime.recognizeDocument(reader.document.documentId, { onProgress: setOcrJob }); setOcrJob(value); setNotice(labels.ocrDone); } catch (reason) { setNotice(reason instanceof Error ? reason.message : String(reason)); } };

  if (!runtime) return <div className="object-surface"><div className="surface-kicker"><span className="surface-icon"><Icon name="document" size={15} /></span><span>{t.documents}</span><span className="surface-badge">{ru ? 'НЕ ПОДКЛЮЧЕНО' : 'NOT CONNECTED'}</span></div><h1>{t.documents}</h1><p className="surface-description">{labels.noRuntime}</p><div className="adapter-note"><span><Icon name="info" size={17} /></span><div><strong>{ru ? 'Просмотрщик пока недоступен' : 'Reader is not available yet'}</strong><small>{labels.boundary}</small></div></div></div>;

  return <div className="object-surface documents-surface" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); event.stopPropagation(); const file = event.dataTransfer.files[0]; if (file && !draft) void dropDocument(file); }}>
    <div className="surface-kicker"><span className="surface-icon"><Icon name="document" size={15} /></span><span>{t.documents}</span><span className="surface-badge">{ru ? 'ЛОКАЛЬНО' : 'LOCAL-FIRST'}</span></div>
    <div className="web-library-heading"><div><h1>{reader?.document.title ?? t.documents}</h1><p className="surface-description">{labels.subtitle}</p></div><div className="web-library-actions"><button className="secondary-button" type="button" onClick={() => void refresh()}><Icon name="refresh" size={14} /> {t.refresh}</button><button className="primary-button" type="button" onClick={() => { setNotice(''); setDraft(newDraft(ru)); }} disabled={!localRuntime?.createText || Boolean(draft)}><Icon name="plus" size={14} /> {ru ? 'Новый Markdown' : 'New Markdown'}</button><button className="secondary-button" type="button" onClick={() => void pickDocument()} disabled={!localRuntime?.importFile || Boolean(draft)}><Icon name="upload" size={14} /> {ru ? 'Импортировать' : 'Import'}</button></div></div>
    <form className="web-library-toolbar" onSubmit={runSearch}><input value={query} onChange={event => setQuery(event.target.value)} placeholder={labels.search} aria-label={labels.search}/><button className="primary-button" type="submit" aria-label={labels.search}><Icon name="search" size={14} /></button><span>{files.length} · {recent.length} {labels.recent.toLowerCase()}</span></form>
    {notice ? <p className="web-library-notice" role="status">{notice}</p> : null}
    {hasDocuments ? <div className="web-library-layout documents-layout">
      <div className="web-library-list">
        <span className="section-label">{labels.files}</span>
        {files.map(file => <button
          type="button"
          key={file.fileId}
          className={file.fileId === reader?.document.file.fileId ? 'web-library-entry active' : 'web-library-entry'}
          aria-current={file.fileId === reader?.document.file.fileId ? 'true' : undefined}
          onClick={() => void openFile(file.fileId)}
          disabled={Boolean(draft)}
        ><strong>{file.filename}</strong><small>{file.mimeType} · {formatBytes(file.size)}</small></button>)}
        {recent.length > 0 && <>
          <span className="section-label">{labels.recent}</span>
          {recent.slice(0, 8).map(item => <button type="button" key={item.documentId} className="web-library-entry" onClick={() => void openFile(item.file.fileId)} disabled={Boolean(draft)}>
            <strong>{item.title}</strong><small>{item.format} · {item.pageCount} {labels.page.toLowerCase()}</small>
          </button>)}
        </>}
      </div>
      <div className="web-library-reader">
        {draft ? <form
          className="document-editor"
          onSubmit={event => { event.preventDefault(); void saveDraft(); }}
          onKeyDown={event => {
            if (event.nativeEvent.isComposing) return;
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
              event.preventDefault();
              void saveDraft();
            }
            if (event.key === 'Escape' && !saving) setDraft(undefined);
          }}
        >
          <label><span>{ru ? 'Имя файла' : 'File name'}</span>
            <input value={draft.filename} maxLength={255} required onChange={event => setDraft({ ...draft, filename: event.target.value })} disabled={saving} />
          </label>
          <label><span>{ru ? 'Текст' : 'Text'}</span>
            <textarea autoFocus value={draft.content} onChange={event => setDraft({ ...draft, content: event.target.value })} spellCheck disabled={saving} />
          </label>
          <div className="web-library-actions">
            <button className="primary-button" type="submit" disabled={saving || !draft.filename.trim()}>{saving ? (ru ? 'Сохраняем…' : 'Saving…') : (ru ? 'Сохранить' : 'Save')}</button>
            <button className="quiet-button" type="button" onClick={() => setDraft(undefined)} disabled={saving}>{ru ? 'Отмена' : 'Cancel'}</button>
            <small>Ctrl+S · Esc</small>
          </div>
        </form> : reader && currentPage ? <>
          <div className="web-library-reader-heading">
            <div><h2>{reader.document.title}</h2><p>{reader.document.format} · {reader.document.pageCount} {labels.page.toLowerCase()}</p></div>
            <div className="web-library-actions">
              {localRuntime?.updateText && reader.document.mimeType.startsWith('text/') && <button className="secondary-button" type="button" onClick={() => void startEditing()}>{ru ? 'Изменить' : 'Edit'}</button>}
              {localRuntime?.deleteFile && <button className="quiet-button" type="button" onClick={() => void deleteDocument()} onBlur={() => setConfirmDelete(false)}>
                {confirmDelete ? (ru ? 'Удалить безвозвратно?' : 'Delete permanently?') : (ru ? 'Удалить' : 'Delete')}
              </button>}
              <span className="surface-badge">{rendered?.mode === 'RASTER' ? labels.raster : labels.safe}</span>
            </div>
          </div>
          <div className="web-library-reader-footer"><div className="web-library-actions">
            <button className="secondary-button" disabled={pageNumber <= 1} onClick={() => setPageNumber(value => value - 1)}>{labels.previous}</button>
            <span className="surface-badge">{labels.page} {pageNumber}/{reader.pages.length}</span>
            <button className="secondary-button" disabled={pageNumber >= reader.pages.length} onClick={() => setPageNumber(value => value + 1)}>{labels.next}</button>
            <button className="secondary-button" onClick={() => void saveProgress()} aria-label={ru ? 'Запомнить место чтения' : 'Remember reading position'}>↧</button>
            <button className="secondary-button" onClick={() => void addBookmark()}>☆ {labels.bookmark}</button>
          </div></div>
          {imageUrl && <img className="document-reader-image" src={imageUrl} alt={`${reader.document.title} ${labels.page} ${pageNumber}`} />}
          <div className="web-library-reader-content document-reader-content"><pre>{currentPage.text || (ru ? 'Текстовый слой отсутствует.' : 'No text layer.')}</pre></div>
          {ocr && <div className="adapter-note"><div><strong>OCR · {ocr.engine}</strong><small>{ocr.text || (ru ? 'Текст не распознан.' : 'No text recognized.')}</small></div></div>}
          <div className="web-library-actions">
            <button className="secondary-button" onClick={() => void recognizePage()} disabled={currentPage.textLayer === 'EXTRACTED'}>{labels.ocrPage}</button>
            <button className="secondary-button" onClick={() => void recognizeDocument()}>{labels.ocrDocument}</button>
            {ocrJob && <span role="status">{ocrJob.state} · {ocrJob.completedPages}/{ocrJob.totalPages}</span>}
          </div>
          <div className="document-note-row">
            <input value={note} onChange={event => setNote(event.target.value)} placeholder={labels.note} aria-label={labels.note} />
            <button className="primary-button" onClick={() => void addNote()} disabled={!note.trim()}>{labels.addNote}</button>
          </div>
          {reader.outline.length > 0 && <section className="document-section"><span className="section-label">{labels.outline}</span>
            {reader.outline.slice(0, 64).map(entry => <button type="button" className="document-outline-entry" key={entry.id} onClick={() => { if (entry.page) setPageNumber(entry.page); }}>{entry.title}{entry.page ? ` · ${labels.page} ${entry.page}` : ''}</button>)}
          </section>}
          {annotations.length > 0 && <section className="document-section"><span className="section-label">{labels.annotations} · {annotations.length}</span>
            {annotations.slice(0, 32).map(annotation => <div className="document-annotation" key={annotation.id}><strong>{annotation.kind}</strong><span>{annotation.selectedText ?? annotation.body ?? annotation.label ?? ''}</span></div>)}
          </section>}
        </> : <div className="web-library-reader-empty"><p>{labels.choose}</p></div>}
      </div>
    </div> : <div className="document-empty-state"><Icon name="document" size={22} /><strong>{labels.noFiles}</strong><p>{ru ? 'Создайте заметку или импортируйте PDF, EPUB, Markdown или текстовый файл, чтобы начать чтение.' : 'Create a note or import a PDF, EPUB, Markdown, or text file to start reading.'}</p></div>}
    {results.length ? <section className="document-search-results"><span className="section-label">{labels.search}</span>{results.map(result => <button key={`${result.documentId}:${result.locator.page ?? result.locator.chapterId ?? result.snippet}`} type="button" disabled={Boolean(draft)} onClick={() => void openFile(result.fileId, result.locator)}>{result.title} · {result.source} · {result.snippet}</button>)}</section> : query.trim() ? <p className="web-library-notice">{labels.noResults}</p> : null}
    {reader && !draft && <TypedReferenceDock tab={{ ...tab, object: { kind: 'document', id: reader.document.file.fileId, label: reader.document.title } }} shell={shell} t={t} />}
  </div>;
}

function documentBytesToDataUrl(bytes: Uint8Array, mimeType: string): string | undefined {
  if (typeof btoa !== 'function') return undefined;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)));
  return `data:${mimeType};base64,${btoa(binary)}`;
}
