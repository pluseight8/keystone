import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { tokens } from '@keystone/theme';
import { KeystoneButton, Label, Surface } from '@keystone/ui';
import { i18n, type QuarantineEntry } from '@keystone/core';
import { getMobileFilesRuntime, subscribeMobileFilesRuntime } from '../src/filesRuntime';

/** Quarantine is deliberately a review surface: it has no Run/Open-anyway action. */
export default function Quarantine() {
  const [runtime, setRuntime] = useState(getMobileFilesRuntime); const [items, setItems] = useState<readonly QuarantineEntry[]>([]); const [locale, setLocale] = useState(i18n.getLocale); const ru = locale === 'ru';
  const refresh = () => { const containment = runtime?.containment; if (containment) void containment.store.list().then(setItems); };
  useEffect(() => subscribeMobileFilesRuntime(() => setRuntime(getMobileFilesRuntime())), []); useEffect(() => i18n.subscribe(setLocale), []); useEffect(refresh, [runtime]);
  if (!runtime?.containment) return <View style={styles.empty}><Label>{ru ? 'Quarantine недоступен' : 'Quarantine unavailable'}</Label><Text style={styles.muted}>{ru ? 'Native host должен подключить FileContainmentService.' : 'The native host must install FileContainmentService.'}</Text></View>;
  return <ScrollView contentContainerStyle={styles.screen}><View style={styles.header}><Label>{ru ? 'Недоверенные файлы' : 'Untrusted files'}</Label><KeystoneButton onPress={refresh}>{ru ? 'Обновить' : 'Refresh'}</KeystoneButton></View>{items.length ? items.map(entry => <Surface key={entry.metadata.entryId} style={styles.card}><Text style={styles.title}>{entry.metadata.originalFilename ?? entry.metadata.entryId}</Text><Text style={styles.muted}>{entry.inspection?.typeEvidence.detectedType ?? 'UNINSPECTED'} · {entry.state}</Text><Text style={styles.muted}>{ru ? 'Источник' : 'Source'}: {entry.metadata.sourceIdentity} · {entry.bytes.byteLength} B</Text><Text style={styles.muted}>{entry.inspection?.reason ?? (ru ? 'Ожидает проверки' : 'Awaiting inspection')}</Text><View style={styles.actions}><KeystoneButton onPress={() => void runtime.containment!.inspect(entry.metadata.entryId).then(refresh)}>{ru ? 'Проверить' : 'Inspect'}</KeystoneButton><KeystoneButton onPress={() => void runtime.containment!.store.delete(entry.metadata.entryId).then(refresh)}>{ru ? 'Удалить' : 'Delete'}</KeystoneButton></View></Surface>) : <Text style={styles.muted}>{ru ? 'Quarantine пуста.' : 'Quarantine is empty.'}</Text>}</ScrollView>;
}
const styles = { screen: { padding: 18, gap: 12, backgroundColor: tokens.colors.background }, header: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, alignItems: 'center' as const }, card: { padding: 12, gap: 6 }, title: { color: tokens.colors.text, fontSize: 16, fontWeight: '600' as const }, muted: { color: tokens.colors.muted }, actions: { flexDirection: 'row' as const, gap: 10 }, empty: { flex: 1, justifyContent: 'center' as const, padding: 24, backgroundColor: tokens.colors.background } };
