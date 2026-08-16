import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { tokens } from '@keystone/theme';
import { Label, Surface } from '@keystone/ui';
import { i18n, type DirectConversation } from '@keystone/core';
import { getMobileMessagingRuntime, subscribeMobileMessagingRuntime } from '../src/socialRuntime';

export default function Members() {
  const { id } = useLocalSearchParams<{ id: string }>(); const [runtime, setRuntime] = useState(getMobileMessagingRuntime); const [group, setGroup] = useState<DirectConversation>(); const [locale, setLocale] = useState(i18n.getLocale); const copy = locale === 'ru' ? russian : english;
  useEffect(() => subscribeMobileMessagingRuntime(() => setRuntime(getMobileMessagingRuntime())), []); useEffect(() => i18n.subscribe(setLocale), []); useEffect(() => { if (runtime?.groups) void runtime.groups.get(String(id ?? '')).then(setGroup); }, [runtime, id]);
  if (!group) return <View style={styles.empty}><Label>{copy.unavailable}</Label></View>;
  return <ScrollView contentContainerStyle={styles.screen}><Label>{group.title ?? copy.title}</Label>{(group.members ?? []).map(member => <Surface key={member} style={styles.card}><Text style={styles.text}>{member}</Text><Text style={styles.muted}>{group.adminIds?.includes(member) ? copy.admin : copy.member}</Text></Surface>)}</ScrollView>;
}
const english = { title: 'Members', admin: 'Administrator', member: 'Member', unavailable: 'Members unavailable' };
const russian: typeof english = { title: 'Участники', admin: 'Администратор', member: 'Участник', unavailable: 'Участники недоступны' };
const styles = { screen: { padding: 18, gap: 10, backgroundColor: tokens.colors.background }, card: { padding: 12, gap: 4 }, text: { color: tokens.colors.text }, muted: { color: tokens.colors.muted }, empty: { flex: 1, justifyContent: 'center' as const, padding: 24, backgroundColor: tokens.colors.background } };
