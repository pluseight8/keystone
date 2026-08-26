import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { i18n, type DocumentDescriptor, type DocumentFileRef, type DocumentReaderHandle } from '@keystone/core';
import { tokens } from '@keystone/theme';
import { KeystoneButton, Label, Surface } from '@keystone/ui';
import { useMobileLocale } from '../src/i18n';
import { getMobileDocumentsRuntime, subscribeMobileDocumentsRuntime, type MobileDocumentsRuntime } from '../src/documentsRuntime';

type MobileDocumentSearchResult = Awaited<ReturnType<MobileDocumentsRuntime['search']>>[number];
type MobileDocumentAnnotation = Awaited<ReturnType<MobileDocumentsRuntime['listAnnotations']>>[number];
type MobileDocumentOcr = Awaited<ReturnType<MobileDocumentsRuntime['recognizePage']>>;
type MobileDocumentJob = Awaited<ReturnType<MobileDocumentsRuntime['recognizeDocument']>>;

export default function DocumentsScreen() {
  const locale = useMobileLocale();
  const ru = locale === 'ru';
  const copy = ru ? russian : english;
  const [runtime, setRuntime] = useState<MobileDocumentsRuntime | undefined>(getMobileDocumentsRuntime);
  const [files, setFiles] = useState<readonly DocumentFileRef[]>([]);
  const [recent, setRecent] = useState<readonly DocumentDescriptor[]>([]);
  const [selectedFileId, setSelectedFileId] = useState<string>();
  const [reader, setReader] = useState<DocumentReaderHandle>();
  const [pageNumber, setPageNumber] = useState(1);
  const [renderInfo, setRenderInfo] = useState<{ mode: string; width?: number; height?: number }>();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<readonly MobileDocumentSearchResult[]>([]);
  const [annotations, setAnnotations] = useState<readonly MobileDocumentAnnotation[]>([]);
  const [ocr, setOcr] = useState<MobileDocumentOcr>();
  const [ocrJob, setOcrJob] = useState<MobileDocumentJob>();
  const [note, setNote] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => subscribeMobileDocumentsRuntime(() => setRuntime(getMobileDocumentsRuntime())), []);
  const refresh = useCallback(async () => {
    if (!runtime) { setFiles([]); setRecent([]); return; }
    try {
      const [nextFiles, nextRecent] = await Promise.all([runtime.listSupportedFiles(), runtime.recent()]);
      setFiles(nextFiles); setRecent(nextRecent);
      setSelectedFileId(current => current && nextFiles.some(file => file.fileId === current) ? current : nextFiles[0]?.fileId);
      setNotice('');
    } catch (reason) { setNotice(reason instanceof Error ? reason.message : String(reason)); }
  }, [runtime]);
  useEffect(() => { void refresh(); return () => reader?.close(); }, [reader, refresh]);
  useEffect(() => {
    if (!runtime) return undefined;
    const unsubscribe = runtime.subscribe?.(() => { void refresh(); });
    return unsubscribe;
  }, [refresh, runtime]);
  useEffect(() => {
    if (!reader || !reader.pages.length) { setRenderInfo(undefined); return undefined; }
    const page = Math.max(1, Math.min(pageNumber, reader.pages.length));
    if (page !== pageNumber) { setPageNumber(page); return undefined; }
    let active = true;
    void reader.renderPage(page).then(value => { if (active) setRenderInfo({ mode: value.mode, ...(value.width ? { width: value.width } : {}), ...(value.height ? { height: value.height } : {}) }); }).catch(reason => { if (active) setNotice(reason instanceof Error ? reason.message : String(reason)); });
    return () => { active = false; };
  }, [reader, pageNumber]);

  const openDocument = async (fileId: string) => {
    if (!runtime) return;
    try {
      const nextReader = await runtime.open(fileId);
      const [progress, nextAnnotations] = await Promise.all([runtime.progress(nextReader.document.documentId), runtime.listAnnotations(nextReader.document.documentId)]);
      reader?.close(); setReader(nextReader); setAnnotations(nextAnnotations); setOcr(undefined); setOcrJob(undefined);
      const chapterIndex = progress?.locator.chapterId ? nextReader.pages.findIndex(page => page.locator.chapterId === progress.locator.chapterId) : -1;
      setPageNumber(Math.max(1, Math.min(nextReader.pages.length, progress?.locator.page ?? (chapterIndex >= 0 ? chapterIndex + 1 : 1)))); setNotice('');
    } catch (reason) { setNotice(reason instanceof Error ? reason.message : String(reason)); }
  };
  const currentPage = reader?.pages[pageNumber - 1];
  const saveProgress = async () => { if (!runtime || !reader || !currentPage) return; try { await runtime.saveProgress(reader.document.documentId, currentPage.locator); setNotice(copy.saved); } catch (reason) { setNotice(reason instanceof Error ? reason.message : String(reason)); } };
  const addBookmark = async () => { if (!runtime || !reader || !currentPage) return; try { const value = await runtime.addBookmark({ documentId: reader.document.documentId, locator: currentPage.locator, label: currentPage.text.slice(0, 80) }); setAnnotations(current => [...current.filter(item => item.id !== value.id), value]); setNotice(copy.saved); } catch (reason) { setNotice(reason instanceof Error ? reason.message : String(reason)); } };
  const addNote = async () => { if (!runtime || !reader || !currentPage || !note.trim()) return; try { const value = await runtime.addNote({ documentId: reader.document.documentId, locator: currentPage.locator, body: note.trim() }); setAnnotations(current => [...current.filter(item => item.id !== value.id), value]); setNote(''); setNotice(copy.saved); } catch (reason) { setNotice(reason instanceof Error ? reason.message : String(reason)); } };
  const search = async () => { if (!runtime || !query.trim()) { setResults([]); return; } try { setResults(reader ? await reader.search(query.trim(), { limit: 32 }) : await runtime.search(query.trim(), { limit: 32 })); setNotice(''); } catch (reason) { setNotice(reason instanceof Error ? reason.message : String(reason)); } };
  const recognizePage = async () => { if (!runtime || !reader || !currentPage) return; try { setOcr(await runtime.recognizePage(reader.document.documentId, pageNumber)); setNotice(copy.ocrDone); } catch (reason) { setNotice(reason instanceof Error ? reason.message : String(reason)); } };
  const recognizeDocument = async () => { if (!runtime || !reader) return; try { const value = await runtime.recognizeDocument(reader.document.documentId, { onProgress: setOcrJob }); setOcrJob(value); setNotice(copy.ocrDone); } catch (reason) { setNotice(reason instanceof Error ? reason.message : String(reason)); } };

  if (!runtime) return <View style={styles.empty}><Text style={styles.emptyIcon}>▥</Text><Label>{copy.title}</Label><Text style={styles.muted}>{copy.unavailable}</Text><Text style={styles.detail}>{copy.boundary}</Text></View>;
  return <View style={styles.screen}><ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled"><View style={styles.header}><View><Label>{reader?.document.title ?? copy.title}</Label><Text style={styles.muted}>{copy.subtitle}</Text></View><KeystoneButton onPress={() => void refresh()}>{copy.refresh}</KeystoneButton></View><View style={styles.searchRow}><TextInput value={query} onChangeText={setQuery} onSubmitEditing={() => void search()} placeholder={copy.search} placeholderTextColor={tokens.colors.muted} style={styles.input}/><KeystoneButton onPress={() => void search()}>{copy.find}</KeystoneButton></View>{notice ? <Text style={styles.notice}>{notice}</Text> : null}<Surface style={styles.boundary}><Text style={styles.title}>{copy.privacy}</Text><Text style={styles.muted}>{copy.boundary}</Text></Surface><Text style={styles.section}>{copy.files}</Text>{files.length ? files.map(file => <Pressable key={file.fileId} onPress={() => { setSelectedFileId(file.fileId); void openDocument(file.fileId); }}><Surface style={[styles.card, selectedFileId === file.fileId && styles.selected]}><Text style={styles.title}>{file.filename}</Text><Text style={styles.muted}>{file.mimeType} · {formatBytes(file.size)}</Text></Surface></Pressable>) : <Text style={styles.muted}>{copy.noFiles}</Text>}{recent.length ? <><Text style={styles.section}>{copy.recent}</Text>{recent.slice(0, 8).map(item => <Pressable key={item.documentId} onPress={() => void openDocument(item.file.fileId)}><Surface style={styles.card}><Text style={styles.title}>{item.title}</Text><Text style={styles.muted}>{item.format} · {item.pageCount} {copy.pages}</Text></Surface></Pressable>)}</> : null}{reader && currentPage ? <Surface style={styles.reader}><Text style={styles.title}>{reader.document.format} · {copy.page} {pageNumber}/{reader.pages.length}</Text><Text style={styles.muted}>{renderInfo ? `${renderInfo.mode}${renderInfo.width && renderInfo.height ? ` · ${renderInfo.width}×${renderInfo.height}` : ''}` : copy.loading}</Text><Text style={styles.readerText}>{currentPage.text || copy.noText}</Text><View style={styles.actions}><KeystoneButton onPress={() => setPageNumber(value => Math.max(1, value - 1))}>{copy.previous}</KeystoneButton><KeystoneButton onPress={() => setPageNumber(value => Math.min(reader.pages.length, value + 1))}>{copy.next}</KeystoneButton><KeystoneButton onPress={() => void saveProgress()}>{copy.saveProgress}</KeystoneButton><KeystoneButton onPress={() => void addBookmark()}>{copy.bookmark}</KeystoneButton></View><View style={styles.actions}><KeystoneButton onPress={() => void recognizePage()} disabled={currentPage.textLayer === 'EXTRACTED'}>{copy.ocrPage}</KeystoneButton><KeystoneButton onPress={() => void recognizeDocument()}>{copy.ocrDocument}</KeystoneButton>{ocrJob ? <Text style={styles.muted}>{ocrJob.state} · {ocrJob.completedPages}/{ocrJob.totalPages}</Text> : null}</View>{ocr ? <Text style={styles.ocr}>{copy.ocr}: {ocr.text || copy.noText}</Text> : null}<View style={styles.noteRow}><TextInput value={note} onChangeText={setNote} placeholder={copy.note} placeholderTextColor={tokens.colors.muted} style={[styles.input, styles.noteInput]}/><KeystoneButton onPress={() => void addNote()}>{copy.addNote}</KeystoneButton></View>{reader.outline.length ? <><Text style={styles.section}>{copy.outline}</Text>{reader.outline.slice(0, 32).map(entry => <Pressable key={entry.id} onPress={() => { if (entry.page) setPageNumber(entry.page); }}><Text style={styles.outline}>{entry.title}{entry.page ? ` · ${copy.page} ${entry.page}` : ''}</Text></Pressable>)}</> : null}<Text style={styles.section}>{copy.annotations} · {annotations.length}</Text>{annotations.slice(0, 24).map(annotation => <Text style={styles.annotation} key={annotation.id}>{annotation.kind}: {annotation.selectedText ?? annotation.body ?? annotation.label ?? ''}</Text>)}</Surface> : <Surface style={styles.card}><Text style={styles.muted}>{copy.choose}</Text></Surface>}{results.length ? <><Text style={styles.section}>{copy.results}</Text>{results.map(result => <Pressable key={`${result.documentId}:${result.locator.page ?? result.locator.chapterId ?? result.snippet}`} onPress={() => { if (result.locator.page) setPageNumber(result.locator.page); }}><Text style={styles.result}>{result.title} · {result.source} · {result.snippet}</Text></Pressable>)}</> : query.trim() ? <Text style={styles.muted}>{copy.noResults}</Text> : null}</ScrollView></View>;
}

function formatBytes(value: number): string { if (value < 1_024) return `${value} B`; if (value < 1_048_576) return `${Math.round(value / 1_024)} KB`; return `${(value / 1_048_576).toFixed(1)} MB`; }

const english = { title: 'Documents', subtitle: 'Safe Reader over canonical Files · offline-first', search: 'Search documents', find: 'Find', files: 'Available Files', recent: 'Recent', pages: 'pages', page: 'Page', previous: 'Previous', next: 'Next', saveProgress: 'Save position', bookmark: 'Bookmark', note: 'Private page note', addNote: 'Save note', outline: 'Outline', annotations: 'Annotations', results: 'Search results', choose: 'Choose a document to read.', noFiles: 'No supported documents.', loading: 'Rendering…', noText: 'No text layer; use local OCR.', ocr: 'OCR', ocrPage: 'Recognize page', ocrDocument: 'Recognize document', ocrDone: 'OCR saved locally.', saved: 'Saved locally', privacy: 'Private Reader boundary', unavailable: 'Documents host is not connected.', boundary: 'Connect DocumentService through the native host. Sources remain in canonical Files; progress and annotations sync only through an explicit own-device path.', refresh: 'Refresh', noResults: 'No matches.' } as const;
const russian = { title: 'Документы', subtitle: 'Безопасный Reader поверх canonical Files · offline-first', search: 'Поиск документов', find: 'Найти', files: 'Доступные Files', recent: 'Недавние', pages: 'страниц', page: 'Страница', previous: 'Назад', next: 'Далее', saveProgress: 'Сохранить позицию', bookmark: 'Закладка', note: 'Приватная заметка к странице', addNote: 'Сохранить заметку', outline: 'Оглавление', annotations: 'Аннотации', results: 'Результаты поиска', choose: 'Выберите документ для чтения.', noFiles: 'Поддерживаемых документов нет.', loading: 'Рендеринг…', noText: 'Текстового слоя нет; используйте локальный OCR.', ocr: 'OCR', ocrPage: 'Распознать страницу', ocrDocument: 'Распознать документ', ocrDone: 'OCR сохранена локально.', saved: 'Сохранено локально', privacy: 'Приватная граница Reader', unavailable: 'Documents host не подключён.', boundary: 'Подключите DocumentService через native host. Источники остаются в canonical Files; progress и annotations синхронизируются только явным own-device путём.', refresh: 'Обновить', noResults: 'Совпадений нет.' } as const;
const styles = { screen: { flex: 1, backgroundColor: tokens.colors.background }, content: { padding: 16, gap: 10, paddingBottom: 44 }, header: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, gap: 10 }, searchRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8 }, input: { minHeight: 42, flex: 1, paddingHorizontal: 11, borderWidth: 1, borderColor: tokens.colors.border, borderRadius: 8, color: tokens.colors.text, backgroundColor: tokens.colors.surface }, noteInput: { minWidth: 120 }, actions: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, alignItems: 'center' as const, gap: 7 }, title: { color: tokens.colors.text, fontWeight: '600' as const }, muted: { color: tokens.colors.muted, lineHeight: 18 }, detail: { color: tokens.colors.muted, lineHeight: 19 }, notice: { color: '#d5a55c', lineHeight: 18 }, boundary: { padding: 12, gap: 5, borderColor: tokens.colors.accent }, section: { color: tokens.colors.text, fontWeight: '600' as const, marginTop: 6 }, card: { padding: 12, gap: 4 }, selected: { borderColor: tokens.colors.accent }, reader: { padding: 13, gap: 9, borderColor: tokens.colors.accent }, readerText: { color: tokens.colors.text, lineHeight: 21 }, ocr: { color: '#65c898', lineHeight: 19 }, noteRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 7 }, outline: { color: tokens.colors.accent, paddingVertical: 5 }, annotation: { color: tokens.colors.muted, lineHeight: 18 }, result: { color: tokens.colors.text, lineHeight: 19, paddingVertical: 5 }, empty: { flex: 1, justifyContent: 'center' as const, padding: 24, gap: 9, backgroundColor: tokens.colors.background }, emptyIcon: { color: tokens.colors.accent, fontSize: 34 } };
