import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { i18n } from '@keystone/core';
import { tokens } from '@keystone/theme';
import { Label, Surface } from '@keystone/ui';
import { getMobileSettingsRuntime, subscribeMobileSettingsRuntime } from '../src/settingsRuntime';

export default function SkillsScreen() {
  const [runtime, setRuntime] = useState(getMobileSettingsRuntime());
  const [locale, setLocale] = useState(i18n.getLocale());
  const [items, setItems] = useState<readonly { id: string; label: string; version: string; enabled: boolean; capabilities: readonly string[] }[]>([]);
  const copy = locale === 'ru' ? russian : english;
  useEffect(() => subscribeMobileSettingsRuntime(() => setRuntime(getMobileSettingsRuntime())), []);
  useEffect(() => i18n.subscribe(setLocale), []);
  const refresh = () => { const skills = runtime?.skills; if (!skills) { setItems([]); return; } void skills.listInstalledPackages().then(values => setItems(values.map(value => ({ id: value.skillId, label: value.skillId, version: value.packageVersion, enabled: value.enabled, capabilities: value.approvedCapabilities })))).catch(() => setItems([])); };
  useEffect(() => { refresh(); }, [runtime]);
  const toggle = (item: typeof items[number]) => { const action = item.enabled ? runtime?.skills?.disablePackage(item.id) : runtime?.skills?.enablePackage(item.id); if (action) void action.then(refresh).catch(() => undefined); };
  return <View style={styles.screen}><View style={styles.header}><View><Label>{copy.title}</Label><Text style={styles.muted}>{copy.subtitle}</Text></View></View><ScrollView contentContainerStyle={styles.list}>{runtime?.skills ? items.length ? items.map(item => <Pressable key={item.id} onPress={() => toggle(item)}><Surface style={styles.card}><Text style={styles.title}>{item.label}</Text><Text style={styles.muted}>v{item.version} · {item.enabled ? copy.enabled : copy.disabled}</Text><Text style={styles.muted}>{item.capabilities.length ? item.capabilities.join(', ') : copy.noCapabilities}</Text></Surface></Pressable>) : <Text style={styles.muted}>{copy.empty}</Text> : <Text style={styles.muted}>{copy.host}</Text>}</ScrollView></View>;
}
const english = { title: 'Skills', subtitle: 'Declarative procedures · explicit permissions', enabled: 'Enabled', disabled: 'Disabled', noCapabilities: 'No approved capabilities', empty: 'No installed Skills', host: 'Skill host is not connected' } as const;
const russian = { title: 'Skills', subtitle: 'Декларативные процедуры · явные разрешения', enabled: 'Включён', disabled: 'Отключён', noCapabilities: 'Нет одобренных capabilities', empty: 'Нет установленных Skills', host: 'Skill host не подключён' } as const;
const styles = { screen: { flex: 1, padding: 16, gap: 12, backgroundColor: tokens.colors.background }, header: { gap: 4 }, list: { gap: 8 }, card: { padding: 12, gap: 4 }, title: { color: tokens.colors.text, fontWeight: '600' as const }, muted: { color: tokens.colors.muted } };
