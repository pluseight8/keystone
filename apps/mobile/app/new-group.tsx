import { useEffect, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { tokens } from '@keystone/theme';
import { KeystoneButton, Label } from '@keystone/ui';
import { i18n } from '@keystone/core';
import { getMobileMessagingRuntime, subscribeMobileMessagingRuntime } from '../src/socialRuntime';

export default function NewGroup() {
  const [runtime, setRuntime] = useState(getMobileMessagingRuntime); const [title, setTitle] = useState(''); const [members, setMembers] = useState(''); const [locale, setLocale] = useState(i18n.getLocale); const [error, setError] = useState(''); const copy = locale === 'ru' ? russian : english;
  useEffect(() => subscribeMobileMessagingRuntime(() => setRuntime(getMobileMessagingRuntime())), []); useEffect(() => i18n.subscribe(setLocale), []);
  const create = async () => { if (!runtime?.groups) { setError(copy.notConfigured); return; } try { const group = await runtime.groups.create({ title, members: members.split(',').map(value => value.trim()).filter(Boolean) }); router.replace({ pathname: '/conversation', params: { id: group.id } }); } catch (reason) { setError(reason instanceof Error ? reason.message : copy.error); } };
  return <View style={styles.screen}><Label>{copy.title}</Label><Text style={styles.muted}>{copy.detail}</Text><TextInput value={title} onChangeText={setTitle} placeholder={copy.titlePlaceholder} placeholderTextColor={tokens.colors.muted} style={styles.input} /><TextInput value={members} onChangeText={setMembers} autoCapitalize="none" placeholder={copy.membersPlaceholder} placeholderTextColor={tokens.colors.muted} style={styles.input} /><KeystoneButton onPress={() => void create()}>{copy.create}</KeystoneButton>{error ? <Text style={styles.error}>{error}</Text> : null}</View>;
}
const english = { title: 'New group', detail: 'Members are verified Identity IDs. The creator is the first administrator.', titlePlaceholder: 'Group title', membersPlaceholder: 'Member IDs, comma separated', create: 'Create signed group', notConfigured: 'Group messaging is not installed.', error: 'Unable to create group' };
const russian: typeof english = { title: 'Новая группа', detail: 'Участники — проверенные Identity ID. Создатель становится первым администратором.', titlePlaceholder: 'Название группы', membersPlaceholder: 'ID участников через запятую', create: 'Создать подписанную группу', notConfigured: 'Групповые чаты не установлены.', error: 'Не удалось создать группу' };
const styles = { screen: { flex: 1, backgroundColor: tokens.colors.background, padding: 20, gap: 12 }, input: { minHeight: 48, borderWidth: 1, borderColor: tokens.colors.border, borderRadius: tokens.radii.md, padding: 12, color: tokens.colors.text }, muted: { color: tokens.colors.muted }, error: { color: '#dc143c' } };
