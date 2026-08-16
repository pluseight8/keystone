import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { tokens } from '@keystone/theme';
import { Label, Surface } from '@keystone/ui';
import { i18n, type MessageObject } from '@keystone/core';
import { getMobileMessagingRuntime, subscribeMobileMessagingRuntime } from '../src/socialRuntime';

export default function MediaFiles() {
  const { id } = useLocalSearchParams<{ id: string }>(); const [runtime, setRuntime] = useState(getMobileMessagingRuntime); const [items, setItems] = useState<readonly MessageObject[]>([]); const [locale, setLocale] = useState(i18n.getLocale); const copy = locale === 'ru' ? russian : english;
  useEffect(() => subscribeMobileMessagingRuntime(() => setRuntime(getMobileMessagingRuntime())), []); useEffect(() => i18n.subscribe(setLocale), []); useEffect(() => { if (!runtime || !id) return; const load = async () => { const group = runtime.groups ? await runtime.groups.get(String(id)) : undefined; const values = group ? await runtime.groups!.history(group.id, { limit: 500 }) : await runtime.messaging.history(String(id), { limit: 500 }); setItems(values.filter(item => item.payload.kind === 'attachment' || item.references.length)); }; void load(); }, [runtime, id]);
  if (!runtime) return <View style={styles.empty}><Label>{copy.unavailable}</Label></View>;
  return <ScrollView contentContainerStyle={styles.screen}><Label>{copy.title}</Label>{items.length ? items.map(item => <Surface key={item.id} style={styles.card}><Text style={styles.text}>{item.payload.kind === 'attachment' ? item.payload.attachments.map(value => value.name).join(', ') : copy.reference}</Text><Text style={styles.muted}>{item.references.map(value => `${value.type}: ${value.id}`).join(' · ')}</Text></Surface>) : <Text style={styles.muted}>{copy.empty}</Text>}</ScrollView>;
}
const english = { title: 'Media and files', reference: 'Keystone object reference', empty: 'No media or files in this conversation.', unavailable: 'Conversation unavailable' };
const russian: typeof english = { title: 'Медиа и файлы', reference: 'Ссылка на объект Keystone', empty: 'Медиа и файлов в этом разговоре нет.', unavailable: 'Разговор недоступен' };
const styles = { screen: { padding: 18, gap: 10, backgroundColor: tokens.colors.background }, card: { padding: 12, gap: 4 }, text: { color: tokens.colors.text }, muted: { color: tokens.colors.muted }, empty: { flex: 1, justifyContent: 'center' as const, padding: 24, backgroundColor: tokens.colors.background } };
