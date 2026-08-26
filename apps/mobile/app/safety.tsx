import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { i18n, type SafetyCategory, type SafetyRuntime } from '@keystone/core';
import { tokens } from '@keystone/theme';
import { Label, Surface } from '@keystone/ui';
import { getMobileSettingsRuntime, subscribeMobileSettingsRuntime } from '../src/settingsRuntime';

export default function SafetyScreen() {
  const [settings, setSettings] = useState(getMobileSettingsRuntime);
  const [locale, setLocale] = useState(i18n.getLocale());
  const [strict, setStrict] = useState<readonly SafetyCategory[]>([]);
  const runtime = settings?.safety as SafetyRuntime | undefined;
  useEffect(() => subscribeMobileSettingsRuntime(() => setSettings(getMobileSettingsRuntime())), []);
  useEffect(() => i18n.subscribe(setLocale), []);
  useEffect(() => { if (runtime) setStrict(runtime.policy.preferencesSnapshot().stricterCategories); }, [runtime]);
  const ru = locale === 'ru';
  const metrics = runtime?.metrics();
  const toggle = async (category: SafetyCategory) => {
    if (!runtime) return;
    const next = strict.includes(category) ? strict.filter(value => value !== category) : [...strict, category];
    try { runtime.policy.applyPreferences({ stricterCategories: next }, { version: 1, explicitOwnerRequest: true, source: 'OWNER', requestId: `settings-${Date.now()}`, requestedAt: new Date().toISOString(), fields: ['stricterCategories'] }); setStrict(next); } catch { /* core remains fail-closed */ }
  };
  return <View style={styles.screen}><View style={styles.header}><Label>{ru ? 'Безопасность контента' : 'Content Safety'}</Label><Text style={styles.muted}>{ru ? 'Личная копия сохраняется; публикация проходит обязательную проверку.' : 'Personal copies remain intact; sharing passes the mandatory preflight.'}</Text></View><ScrollView contentContainerStyle={styles.list}><Surface style={styles.card}><Text style={styles.title}>Safety Runtime</Text><Text style={styles.muted}>{runtime ? `${ru ? 'Активен' : 'Active'} · ${runtime.status()}` : (ru ? 'Host adapter не подключён; защищённые поверхности остаются fail-closed.' : 'Host adapter not connected; protected surfaces remain fail-closed.')}</Text>{metrics && <Text style={styles.muted}>{metrics.evaluated} {ru ? 'проверок' : 'evaluations'} · {metrics.cacheHits} {ru ? 'из кэша' : 'cache hits'} · {metrics.quarantined} {ru ? 'в quarantine' : 'quarantined'}</Text>}</Surface><Surface style={styles.card}><Text style={styles.title}>{ru ? 'Строже для меня' : 'Stricter for me'}</Text>{(['ADULT_SEXUAL', 'GRAPHIC_VIOLENCE', 'DISTURBING_CONTENT', 'POLITICAL_CONTENT'] as const).map(category => <Pressable key={category} onPress={() => void toggle(category)} style={styles.row}><Text style={styles.muted}>{category}</Text><Text style={styles.toggle}>{strict.includes(category) ? '✓' : '○'}</Text></Pressable>)}</Surface><Surface style={styles.card}><Text style={styles.muted}>{ru ? 'Mandatory policy нельзя изменить через AI, Skill, plugin или remote Agent. Local AI — только дополнительная локальная проверка неоднозначного контента.' : 'Mandatory policy cannot be changed by AI, Skills, plugins or remote Agents. Local AI is only an optional local review for ambiguous content.'}</Text></Surface></ScrollView></View>;
}
const styles = { screen: { flex: 1, padding: 16, gap: 12, backgroundColor: tokens.colors.background }, header: { gap: 4 }, list: { gap: 8 }, card: { padding: 12, gap: 8 }, title: { color: tokens.colors.text, fontWeight: '600' as const }, muted: { color: tokens.colors.muted }, row: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, paddingVertical: 8 }, toggle: { color: tokens.colors.text } };
