import { useEffect, useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { tokens } from '@keystone/theme';
import { KeystoneButton, Label, Surface } from '@keystone/ui';
import { useMobileLocale } from '../src/i18n';
import { getMobileWebLibraryRuntime, subscribeMobileWebLibraryRuntime, type MobileWebLibraryEntry, type MobileWebLibraryReader, type MobileWebLibraryRuntime } from '../src/webLibraryRuntime';

export default function WebLibraryScreen() {
  const locale = useMobileLocale();
  const ru = locale === 'ru';
  const copy = ru ? russian : english;
  const [runtime, setRuntime] = useState<MobileWebLibraryRuntime | undefined>(getMobileWebLibraryRuntime);
  const [entries, setEntries] = useState<readonly MobileWebLibraryEntry[]>([]);
  const [collections, setCollections] = useState<readonly { id: string; name: string; isSystem: boolean }[]>([]);
  const [selected, setSelected] = useState<MobileWebLibraryEntry>();
  const [reader, setReader] = useState<MobileWebLibraryReader>();
  const [query, setQuery] = useState('');
  const [collectionId, setCollectionId] = useState('');
  const [note, setNote] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => subscribeMobileWebLibraryRuntime(() => setRuntime(getMobileWebLibraryRuntime())), []);
  const refresh = async () => {
    if (!runtime) return;
    try {
      const [nextEntries, nextCollections] = await Promise.all([query.trim() ? runtime.search(query.trim()) : runtime.list(collectionId ? { collectionId } : undefined), runtime.collections()]);
      setEntries(nextEntries); setCollections(nextCollections); setSelected(current => current && nextEntries.some(entry => entry.id === current.id) ? current : nextEntries[0]);
    } catch { setNotice(copy.boundary); }
  };
  useEffect(() => { void refresh(); }, [runtime, query, collectionId]);
  useEffect(() => runtime?.subscribe?.(() => { void refresh(); }), [runtime]);
  useEffect(() => { if (!runtime || !selected) { setReader(undefined); return; } void runtime.reader(selected.id).then(setReader).catch(() => setReader(undefined)); }, [runtime, selected]);

  const choose = async (entry: MobileWebLibraryEntry) => { setSelected(entry); if (runtime) setReader(await runtime.reader(entry.id)); };
  const markRead = async () => { if (!runtime?.setReadState || !selected) return; await runtime.setReadState(selected.id, selected.readState === 'READ' ? 'UNREAD' : 'READ'); await refresh(); };
  const favorite = async () => { if (!runtime?.setFavorite || !selected) return; await runtime.setFavorite(selected.id, !selected.favorite); await refresh(); };
  const addNote = async () => { if (!runtime?.addNote || !selected || !reader?.revision || !note.trim()) { setNotice(copy.boundary); return; } await runtime.addNote({ entryId: selected.id, revisionId: reader.revision.id, body: note.trim() }); setNote(''); setNotice(copy.saved); };
  const share = async () => { if (!runtime?.shareArchive || !selected || !reader?.revision) { setNotice(copy.boundary); return; } await runtime.shareArchive(selected.id, reader.revision.id); setNotice(copy.shared); };

  if (!runtime) return <View style={styles.empty}><Label>{copy.unavailable}</Label><Text style={styles.muted}>{copy.boundary}</Text></View>;
  return <ScrollView contentContainerStyle={styles.screen}><View style={styles.header}><View><Label>{copy.title}</Label><Text style={styles.muted}>{copy.subtitle}</Text></View><KeystoneButton onPress={() => void refresh()}>{copy.refresh}</KeystoneButton></View><View style={styles.search}><TextInput value={query} onChangeText={setQuery} placeholder={copy.search} placeholderTextColor={tokens.colors.muted} style={styles.input}/></View><View style={styles.actions}><KeystoneButton onPress={() => setCollectionId('')}>{copy.all}</KeystoneButton><KeystoneButton onPress={() => setCollectionId('read-later')}>{copy.later}</KeystoneButton>{collections.filter(collection => !collection.isSystem).slice(0, 4).map(collection => <KeystoneButton key={collection.id} onPress={() => setCollectionId(collection.id)}>{collection.name}</KeystoneButton>)}</View><View style={styles.list}>{entries.length ? entries.map(entry => <Surface key={entry.id} style={[styles.card, selected?.id === entry.id && styles.selected]}><Text style={styles.title}>{entry.favorite ? '★ ' : ''}{entry.title}</Text><Text style={styles.muted}>{entry.kind === 'ARCHIVE' ? copy.offline : copy.bookmark} · {entry.readState === 'READ' ? copy.read : copy.unread}</Text><Text style={styles.muted}>{entry.sourceUrl}</Text><KeystoneButton onPress={() => void choose(entry)}>{copy.open}</KeystoneButton></Surface>) : <Text style={styles.muted}>{copy.empty}</Text>}</View>{selected && reader ? <Surface style={styles.reader}><Label>{reader.revision ? copy.reader : copy.bookmark}</Label><Text style={styles.title}>{selected.title}</Text>{reader.revision && <Text style={styles.proof}>{copy.offline} · {reader.externalRequestCount} requests · {reader.scriptsExecuted} scripts · {reader.formsSubmitted} forms</Text>}<Text style={styles.readerText}>{reader.text || copy.bookmark}</Text><View style={styles.actions}><KeystoneButton onPress={() => void markRead()}>{selected.readState === 'READ' ? copy.markUnread : copy.markRead}</KeystoneButton><KeystoneButton onPress={() => void favorite()}>{selected.favorite ? copy.removeFavorite : copy.favorite}</KeystoneButton><KeystoneButton onPress={() => void share()}>{copy.share}</KeystoneButton></View>{reader.revision && <><TextInput value={note} onChangeText={setNote} placeholder={copy.note} placeholderTextColor={tokens.colors.muted} style={styles.input}/><View style={styles.actions}><KeystoneButton onPress={() => void addNote()}>{copy.addNote}</KeystoneButton></View></>}</Surface> : <Surface style={styles.card}><Text style={styles.muted}>{copy.choose}</Text></Surface>}{notice ? <Text style={styles.notice}>{notice}</Text> : null}</ScrollView>;
}

const english = { title: 'Web Library', subtitle: 'Local saved pages and offline reader', search: 'Search saved pages', all: 'All', later: 'Read Later', offline: 'Available offline', bookmark: 'Bookmark only', read: 'Read', unread: 'Unread', markRead: 'Mark read', markUnread: 'Mark unread', favorite: 'Favorite', removeFavorite: 'Remove favorite', reader: 'Reader', note: 'Private note', addNote: 'Add note', share: 'Share copy', open: 'Open', choose: 'Choose a saved item', empty: 'Nothing saved yet', refresh: 'Refresh', saved: 'Saved locally', shared: 'Archive share prepared', unavailable: 'Web Library host is not connected', boundary: 'Connect the typed WebLibraryService host adapter. Origin pages are never loaded by this screen.' };
const russian: typeof english = { title: 'Web Library', subtitle: 'Локальные сохранённые страницы и offline reader', search: 'Поиск сохранённых страниц', all: 'Все', later: 'Read Later', offline: 'Доступно offline', bookmark: 'Только bookmark', read: 'Прочитано', unread: 'Непрочитано', markRead: 'Отметить прочитанным', markUnread: 'Отметить непрочитанным', favorite: 'В избранное', removeFavorite: 'Убрать из избранного', reader: 'Reader', note: 'Приватная заметка', addNote: 'Добавить заметку', share: 'Поделиться копией', open: 'Открыть', choose: 'Выберите сохранённый элемент', empty: 'Пока ничего не сохранено', refresh: 'Обновить', saved: 'Сохранено локально', shared: 'Копия архива подготовлена', unavailable: 'Web Library host не подключён', boundary: 'Подключите typed WebLibraryService host adapter. Этот экран никогда не загружает origin.' };
const styles = { screen: { padding: 16, gap: 12, paddingBottom: 42, backgroundColor: tokens.colors.background }, header: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, alignItems: 'flex-start' as const, gap: 10 }, search: { flexDirection: 'row' as const, gap: 7 }, input: { flex: 1, minHeight: 44, borderWidth: 1, borderColor: tokens.colors.border, borderRadius: tokens.radii.md, padding: 10, color: tokens.colors.text }, actions: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 7 }, list: { gap: 9 }, card: { padding: 12, gap: 6 }, selected: { borderColor: tokens.colors.accent }, reader: { padding: 14, gap: 8, borderColor: tokens.colors.accent }, title: { color: tokens.colors.text, fontWeight: '600' as const }, muted: { color: tokens.colors.muted, lineHeight: 18 }, proof: { color: '#65c898', fontSize: 11 }, readerText: { color: tokens.colors.text, lineHeight: 20 }, notice: { color: '#d5a55c', lineHeight: 18 }, empty: { flex: 1, justifyContent: 'center' as const, padding: 24, gap: 8, backgroundColor: tokens.colors.background } };
