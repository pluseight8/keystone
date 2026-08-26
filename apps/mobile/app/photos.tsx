import { useEffect, useState } from 'react';
import { Alert, ScrollView, Text, TextInput, View } from 'react-native';
import { tokens } from '@keystone/theme';
import { KeystoneButton, Label, Surface } from '@keystone/ui';
import { getMobilePhotosRuntime, subscribeMobilePhotosRuntime, type MobilePhotoAlbum, type MobilePhotoAsset, type MobilePhotosRuntime } from '../src/photosRuntime';
import { useMobileLocale } from '../src/i18n';

export default function PhotosScreen() {
  const locale = useMobileLocale();
  const copy = locale === 'ru' ? russian : english;
  const [runtime, setRuntime] = useState<MobilePhotosRuntime | undefined>(getMobilePhotosRuntime);
  const [state, setState] = useState<Awaited<ReturnType<MobilePhotosRuntime['open']>>>();
  const [items, setItems] = useState<readonly MobilePhotoAsset[]>([]);
  const [albums, setAlbums] = useState<readonly MobilePhotoAlbum[]>([]);
  const [selected, setSelected] = useState<MobilePhotoAsset>();
  const [viewer, setViewer] = useState<Awaited<ReturnType<MobilePhotosRuntime['viewer']>>>();
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState('');
  const [showAlbums, setShowAlbums] = useState(false);
  const [showTrash, setShowTrash] = useState(false);

  useEffect(() => subscribeMobilePhotosRuntime(() => setRuntime(getMobilePhotosRuntime())), []);
  const refresh = async () => {
    if (!runtime) return;
    try {
      const result = await Promise.all([runtime.open(), runtime.timeline({ limit: 80, includeTrash: showTrash }), runtime.albums()]);
      setState(result[0]); setItems(result[1].items); setAlbums(result[2]);
      setSelected(value => value && result[1].items.some(item => item.mediaId === value.mediaId) ? value : result[1].items[0]);
    } catch { setNotice(copy.boundary); }
  };
  useEffect(() => { void refresh(); }, [runtime, showTrash]);
  useEffect(() => runtime?.subscribe?.(() => { void refresh(); }), [runtime]);

  const choose = async (asset: MobilePhotoAsset) => { setSelected(asset); if (runtime) try { setViewer(await runtime.viewer(asset.mediaId)); } catch { setViewer(undefined); } };
  const search = async () => { if (!runtime) return; if (!query.trim()) { await refresh(); return; } try { setItems(await runtime.search({ query: query.trim(), limit: 80, includeTrash: showTrash })); } catch { setNotice(copy.boundary); } };
  const importSelected = async (kind: 'SELECTED_FILE' | 'SELECTED_FOLDER' | 'CAMERA_ROLL') => { if (!runtime?.importSelected) { setNotice(copy.boundary); return; } try { const result = await runtime.importSelected({ kind }); setNotice(copy.imported + ': ' + result.imported + ' · ' + result.duplicates + ' duplicate · ' + result.failed + ' failed'); await refresh(); } catch { setNotice(copy.boundary); } };
  const share = async () => {
    if (!runtime?.share || !selected) { setNotice(copy.boundary); return; }
    const send = async (locationConfirmed?: boolean) => { try { const result = await runtime.share!({ mediaId: selected.mediaId, destination: 'MESSAGES', mode: 'COPY', ownerConfirmed: true, ...(locationConfirmed !== undefined ? { locationConfirmed } : {}) }); setNotice(copy.shared + ': ' + result.status); } catch { setNotice(copy.boundary); } };
    if (selected.hasEmbeddedLocation) { Alert.alert(copy.locationTitle, copy.locationWarning, [{ text: copy.cancel, style: 'cancel' }, { text: copy.share, onPress: () => { void send(true); } }]); return; }
    await send();
  };
  const showMap = async () => { if (!runtime?.map) { setNotice(copy.boundary); return; } try { setNotice(copy.map + ': ' + (await runtime.map({ ownerConfirmed: true })).length); } catch { setNotice(copy.boundary); } };
  const changeTrash = async () => { if (!runtime || !selected) return; try { if (showTrash && runtime.restore) await runtime.restore(selected.mediaId); else if (runtime.trash) await runtime.trash(selected.mediaId); await refresh(); } catch { setNotice(copy.boundary); } };

  if (!runtime) return <View style={styles.empty}><Label>{copy.unavailable}</Label><Text style={styles.muted}>{copy.boundary}</Text></View>;
  return <ScrollView contentContainerStyle={styles.screen}>
    <View style={styles.header}><View><Label>{copy.title}</Label><Text style={styles.muted}>{copy.subtitle}</Text></View><KeystoneButton onPress={() => void refresh()}>{copy.refresh}</KeystoneButton></View>
    <Surface style={styles.stats}><Text style={styles.text}>{copy.items}: {state?.total ?? 0}</Text><Text style={styles.text}>{copy.albums}: {state?.albums ?? albums.length}</Text><Text style={styles.text}>{copy.favorites}: {state?.favorites ?? 0}</Text><Text style={styles.muted}>{state?.cameraRoll.replace(/_/g, ' ')}</Text></Surface>
    <View style={styles.actions}><KeystoneButton onPress={() => void importSelected('SELECTED_FILE')}>{copy.file}</KeystoneButton><KeystoneButton onPress={() => void importSelected('SELECTED_FOLDER')}>{copy.folder}</KeystoneButton><KeystoneButton onPress={() => void importSelected('CAMERA_ROLL')}>{copy.camera}</KeystoneButton><KeystoneButton onPress={() => { setShowAlbums(value => !value); setShowTrash(false); }}>{copy.albums}</KeystoneButton><KeystoneButton onPress={() => { setShowTrash(value => !value); setShowAlbums(false); }}>{showTrash ? copy.timeline : copy.trashView}</KeystoneButton><KeystoneButton onPress={() => void showMap()}>{copy.map}</KeystoneButton></View>
    <View style={styles.search}><TextInput value={query} onChangeText={setQuery} onSubmitEditing={() => void search()} placeholder={copy.search} placeholderTextColor={tokens.colors.muted} style={styles.input}/><KeystoneButton onPress={() => void search()}>{copy.searchShort}</KeystoneButton></View>
    {showAlbums ? <View style={styles.list}>{albums.length ? albums.map(album => <Surface key={album.id} style={styles.card}><Text style={styles.title}>{album.name}</Text><Text style={styles.muted}>{album.count} · {album.sharing}</Text><KeystoneButton onPress={() => void runtime.album(album.id).then(setItems).catch(() => setNotice(copy.boundary))}>{copy.open}</KeystoneButton></Surface>) : <Text style={styles.muted}>{copy.noAlbums}</Text>}</View> : <View style={styles.list}>{items.length ? items.map(asset => <Surface key={asset.mediaId} style={styles.card}><View style={styles.row}><Text style={styles.title}>{asset.kind === 'VIDEO' ? '▶' : '▧'} {asset.filename}</Text><Text style={styles.badge}>{asset.favorite ? '★' : ''}</Text></View><Text style={styles.muted}>{asset.width && asset.height ? String(asset.width) + '×' + String(asset.height) + ' · ' : ''}{asset.capturedAt ?? copy.local}{asset.hasEmbeddedLocation ? ' · GPS' : ''}</Text><Text style={styles.muted}>{asset.tags.join(' · ') || copy.noTags}</Text><KeystoneButton onPress={() => void choose(asset)}>{copy.open}</KeystoneButton></Surface>) : <Text style={styles.muted}>{copy.empty}</Text>}</View>}
    {selected && <Surface style={styles.viewer}><Label>{copy.viewer}</Label><Text style={styles.title}>{selected.filename}</Text><Text style={styles.muted}>{viewer?.original ?? '—'} · {viewer?.thumbnail ?? '—'}</Text><Text style={styles.muted}>{viewer?.metadata ? Object.entries(viewer.metadata).filter(([, value]) => value !== undefined).map(([key, value]) => key + ': ' + String(value)).join(' · ') : copy.metadata}</Text><View style={styles.actions}><KeystoneButton onPress={() => void share()}>{copy.share}</KeystoneButton><KeystoneButton onPress={() => void changeTrash()}>{showTrash ? copy.restore : copy.trash}</KeystoneButton></View></Surface>}
    {notice ? <Text style={styles.notice}>{notice}</Text> : null}
  </ScrollView>;
}

const english = { title: 'Photos', subtitle: 'Private local-first media library', items: 'Items', albums: 'Albums', favorites: 'Favorites', file: 'Choose file', folder: 'Choose folder', camera: 'Choose Camera Roll', map: 'GPS map', search: 'Search filename, tags or date', searchShort: 'Find', open: 'Open', viewer: 'Viewer', metadata: 'Metadata', share: 'Share explicitly', trash: 'Move to trash', trashView: 'Trash', timeline: 'Timeline', restore: 'Restore', cancel: 'Cancel', locationTitle: 'Embedded location', locationWarning: 'This media contains embedded GPS. Confirm sharing its location with the recipient.', local: 'Local', noTags: 'No tags', noAlbums: 'No albums', empty: 'No media yet', refresh: 'Refresh', imported: 'Import', shared: 'Shared', unavailable: 'Photos host is not connected', boundary: 'Connect the typed MediaLibrary host adapter. Camera roll is never uploaded automatically.' };
const russian: typeof english = { title: 'Фотографии', subtitle: 'Приватная local-first медиатека', items: 'Элементы', albums: 'Альбомы', favorites: 'Избранное', file: 'Выбрать файл', folder: 'Выбрать папку', camera: 'Выбрать Camera Roll', map: 'Карта GPS', search: 'Поиск имени, тегов или даты', searchShort: 'Найти', open: 'Открыть', viewer: 'Просмотр', metadata: 'Метаданные', share: 'Поделиться явно', trash: 'В корзину', trashView: 'Корзина', timeline: 'Лента', restore: 'Восстановить', cancel: 'Отмена', locationTitle: 'Встроенная геопозиция', locationWarning: 'В этом медиа есть embedded GPS. Подтвердите передачу координат получателю.', local: 'Локально', noTags: 'Нет тегов', noAlbums: 'Альбомов нет', empty: 'Медиа пока нет', refresh: 'Обновить', imported: 'Импорт', shared: 'Отправлено', unavailable: 'Photos host не подключён', boundary: 'Подключите typed MediaLibrary host adapter. Camera Roll никогда не загружается автоматически.' };
const styles = { screen: { padding: 16, gap: 12, paddingBottom: 42, backgroundColor: tokens.colors.background }, header: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, alignItems: 'flex-start' as const, gap: 10 }, stats: { padding: 13, gap: 5 }, actions: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 7 }, search: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 7 }, input: { flex: 1, minHeight: 44, borderWidth: 1, borderColor: tokens.colors.border, borderRadius: tokens.radii.md, padding: 10, color: tokens.colors.text }, list: { gap: 9 }, card: { padding: 12, gap: 6 }, viewer: { padding: 13, gap: 7, borderColor: tokens.colors.accent }, row: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, alignItems: 'center' as const, gap: 8 }, text: { color: tokens.colors.text }, title: { color: tokens.colors.text, fontWeight: '600' as const }, muted: { color: tokens.colors.muted, lineHeight: 18 }, badge: { color: tokens.colors.accent }, notice: { color: '#d5a55c', lineHeight: 18 }, empty: { flex: 1, justifyContent: 'center' as const, padding: 24, gap: 8, backgroundColor: tokens.colors.background } };
