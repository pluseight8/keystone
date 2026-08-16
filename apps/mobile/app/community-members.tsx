import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { i18n, type CommunityProjection } from '@keystone/core';
import { tokens } from '@keystone/theme';
import { KeystoneButton, Label, Surface } from '@keystone/ui';
import { getMobileCommunityRuntime, subscribeMobileCommunityRuntime } from '../src/communityRuntime';

export default function CommunityMembers() {
  const { id } = useLocalSearchParams<{ id: string }>(); const communityId = String(id ?? ''); const [runtime, setRuntime] = useState(getMobileCommunityRuntime); const [projection, setProjection] = useState<CommunityProjection>(); const [locale, setLocale] = useState(i18n.getLocale); const [error, setError] = useState(''); const ru = locale === 'ru'; const copy = ru ? russian : english;
  useEffect(() => subscribeMobileCommunityRuntime(() => setRuntime(getMobileCommunityRuntime)), []); useEffect(() => i18n.subscribe(setLocale), []); useEffect(() => { if (runtime) void runtime.communities.projection(communityId).then(setProjection).catch(reason => setError(String(reason))); }, [runtime, communityId]);
  const members = projection ? [...projection.members.values()].sort((a, b) => Number(b.active) - Number(a.active) || a.identity.localeCompare(b.identity)) : [];
  if (!runtime || !projection) return <View style={styles.empty}><Label>{copy.unavailable}</Label><Text style={styles.muted}>{error}</Text></View>;
  return <ScrollView contentContainerStyle={styles.screen}><KeystoneButton onPress={() => router.back()}>{copy.back}</KeystoneButton><Label>{copy.title}</Label><Text style={styles.muted}>{members.length} {copy.members}</Text>{members.map(member => <Pressable key={member.identity} onPress={() => runtime.openObject?.(member.identity, 'identity.profile')}><Surface style={styles.card}><Text style={styles.identity}>{member.identity}</Text><Text style={member.active ? styles.active : styles.muted}>{member.active ? copy.active : copy.inactive}{member.banned ? ` · ${copy.banned}` : ''}{member.muted ? ` · ${copy.muted}` : ''}</Text><Text style={styles.meta}>{member.roleIds.map(roleId => projection.roles.get(roleId)?.payload.name ?? roleId).join(', ') || copy.member}</Text></Surface></Pressable>)}{error ? <Text style={styles.error}>{error}</Text> : null}</ScrollView>;
}
const english = { title: 'Community members', members: 'members', member: 'Member', active: 'Active', inactive: 'Inactive', banned: 'banned', muted: 'muted', back: 'Back', unavailable: 'Members unavailable' };
const russian: typeof english = { title: 'Участники сообщества', members: 'участников', member: 'Участник', active: 'Активен', inactive: 'Неактивен', banned: 'заблокирован', muted: 'ограничен', back: 'Назад', unavailable: 'Участники недоступны' };
const styles = { screen: { padding: 16, gap: 10, backgroundColor: tokens.colors.background }, card: { padding: 12, gap: 5 }, identity: { color: tokens.colors.text, fontWeight: '600' as const }, active: { color: tokens.colors.accent }, muted: { color: tokens.colors.muted }, meta: { color: tokens.colors.muted, fontSize: 12 }, error: { color: '#dc143c' }, empty: { flex: 1, justifyContent: 'center' as const, padding: 24, backgroundColor: tokens.colors.background, gap: 8 } };
