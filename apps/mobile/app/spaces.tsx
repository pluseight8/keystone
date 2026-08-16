import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { i18n, type SharedSpace } from '@keystone/core';
import { tokens } from '@keystone/theme';
import { KeystoneButton, Label, Surface } from '@keystone/ui';
import { getMobileSettingsRuntime, subscribeMobileSettingsRuntime } from '../src/settingsRuntime';

/**
 * Host-neutral Shared Spaces surface.  Identity keys, transport and the
 * encrypted store stay in the native runtime; this screen only projects the
 * signed CRDT service and never imports Memory or private chat context.
 */
export default function SpacesScreen() {
  const [runtime, setRuntime] = useState(getMobileSettingsRuntime);
  const [locale, setLocale] = useState(i18n.getLocale);
  const [spaces, setSpaces] = useState<readonly SharedSpace[]>([]);
  const [selected, setSelected] = useState<string>();
  const ru = locale === 'ru';
  const service = runtime?.spaces;
  const refresh = () => { if (!service) { setSpaces([]); return; } setSpaces(service.listSpaces()); };
  useEffect(() => subscribeMobileSettingsRuntime(() => setRuntime(getMobileSettingsRuntime())), []);
  useEffect(() => i18n.subscribe(setLocale), []);
  useEffect(() => { refresh(); }, [runtime]);
  const active = spaces.find(space => space.id === selected) ?? spaces[0];
  if (!service) return <View style={styles.empty}><Label>{ru ? 'Shared Spaces недоступны' : 'Shared Spaces are not configured'}</Label><Text style={styles.muted}>{ru ? 'Native host должен установить signed SharedSpaceService и encrypted durable store.' : 'The native host must install the signed SharedSpaceService and encrypted durable store.'}</Text></View>;
  return <ScrollView contentContainerStyle={styles.screen}>
    <View style={styles.header}><Label>{ru ? 'Пространства' : 'Spaces'}</Label><Text style={styles.muted}>{ru ? 'P2P-рабочие пространства используют один durable CRDT. Private Memory не становится контекстом автоматически.' : 'P2P workspaces use one durable CRDT. Private Memory is never added as context automatically.'}</Text></View>
    <Surface style={styles.card}><Label>{ru ? 'Доступные пространства' : 'Available Spaces'}</Label>{spaces.length ? spaces.map(space => <View key={space.id} style={styles.item}><View style={styles.row}><Text style={styles.text}>{space.title}</Text><Text style={styles.badge}>{space.visibility}</Text></View><Text style={styles.muted}>{ru ? 'Участники' : 'Members'}: {space.members.filter(value => !value.removedAt).length} · {ru ? 'ревизия' : 'revision'} {space.revision}</Text><KeystoneButton onPress={() => { setSelected(space.id); refresh(); }}>{active?.id === space.id ? (ru ? 'Открыто' : 'Open') : (ru ? 'Открыть' : 'Open')}</KeystoneButton></View>) : <Text style={styles.muted}>{ru ? 'Пространств пока нет.' : 'No spaces yet.'}</Text>}</Surface>
    {active ? <Surface style={styles.card}><View style={styles.row}><Label>{active.title}</Label><Text style={styles.badge}>{active.visibility}</Text></View><Text style={styles.muted}>{active.description || (ru ? 'Без описания' : 'No description')}</Text><Text style={styles.section}>{ru ? 'Документы' : 'Documents'} · {service.listDocuments(active.id).length}</Text>{service.listDocuments(active.id).map(document => <View key={document.id} style={styles.item}><Text style={styles.text}>{document.title}</Text><Text style={styles.muted}>{document.body}</Text></View>)}<Text style={styles.section}>{ru ? 'Заметки' : 'Notes'} · {service.listNotes(active.id).length}</Text><Text style={styles.section}>{ru ? 'Задачи' : 'Tasks'} · {service.listTasks(active.id).length} / {service.listTaskLists(active.id).length} {ru ? 'списков' : 'lists'}</Text><Text style={styles.section}>{ru ? 'Файлы' : 'Files'} · {service.listFileReferences(active.id).length}</Text><Text style={styles.section}>{ru ? 'Комментарии' : 'Comments'} · {service.listComments(active.id).length}</Text><Text style={styles.section}>{ru ? 'Участники и агенты' : 'Members & Agents'} · {active.members.length} / {active.agentGrants.filter(value => !value.revoked).length}</Text><Text style={styles.section}>{ru ? 'Активность' : 'Activity'} · {service.listActivities(active.id).length}</Text><Text style={styles.muted}>{ru ? 'Share with Space принимает только PUBLIC или USER_EXPLICIT.' : 'Share with Space accepts only PUBLIC or USER_EXPLICIT context.'}</Text></Surface> : null}
  </ScrollView>;
}

const styles = { screen: { padding: 16, gap: 12, backgroundColor: tokens.colors.background }, header: { gap: 6 }, card: { padding: 14, gap: 10 }, item: { borderWidth: 1, borderColor: tokens.colors.border, padding: 12, gap: 6 }, row: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, gap: 8 }, text: { color: tokens.colors.text, flex: 1 }, muted: { color: tokens.colors.muted }, badge: { color: tokens.colors.accent, fontSize: 12 }, section: { color: tokens.colors.text, fontWeight: '700' as const }, empty: { flex: 1, justifyContent: 'center' as const, padding: 24, gap: 8, backgroundColor: tokens.colors.background } };
