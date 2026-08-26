import { useCallback, useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import type { DailyBrief, DailyContextItem } from '@keystone/core';
import { i18n } from '@keystone/core';
import { tokens } from '@keystone/theme';
import { KeystoneButton, Label, Surface } from '@keystone/ui';
import { getMobileSettingsRuntime, subscribeMobileSettingsRuntime } from './settingsRuntime';

/** Compact, non-blocking Home projection. Canonical objects remain in Core. */
export function DailyHomeScreen() {
  const router = useRouter();
  const [runtime, setRuntime] = useState(getMobileSettingsRuntime);
  const [brief, setBrief] = useState<DailyBrief>();
  const [enabled, setEnabled] = useState(true);
  const [locale, setLocale] = useState(i18n.getLocale);
  const ru = locale === 'ru';
  const refresh = useCallback(async () => {
    const daily = runtime?.daily;
    if (!daily) return;
    try { const configured = runtime?.settings.snapshot().daily.enabled !== false; setEnabled(configured); if (!configured) { setBrief(undefined); return; } await daily.ready(); setBrief(await daily.generateBrief({ notify: true })); } catch { setBrief(undefined); }
  }, [runtime]);
  useEffect(() => subscribeMobileSettingsRuntime(() => setRuntime(getMobileSettingsRuntime())), []);
  useEffect(() => i18n.subscribe(setLocale), []);
  useEffect(() => { void refresh(); }, [refresh]);
  const open = (item: DailyContextItem) => {
    const type = item.canonicalRef.type.toLowerCase();
    if (type.includes('message') || type === 'chat' || type === 'conversation') router.push('/messages');
    else if (type.includes('calendar') || type === 'event') router.push('/calendar');
    else if (type.includes('file')) router.push('/files');
    else if (type.includes('task') || type.includes('workboard')) router.push('/spaces');
    else if (type.includes('video')) router.push('/video');
    else router.push('/explore');
  };
  const title = ru ? 'Главная' : 'Home';
  const empty = ru ? 'Сейчас ничего важного нет.' : 'Nothing important right now.';
  const subtitle = ru ? 'Локальная сводка. Она не требует сети или AI.' : 'Local context. No network or AI required.';
  return <ScrollView contentContainerStyle={styles.screen}><View style={styles.header}><Label>{title}</Label><Text style={styles.muted}>{subtitle}</Text></View>{!enabled ? <Surface style={styles.card}><Label>{ru ? 'Ежедневная сводка выключена' : 'Daily Layer is disabled'}</Label><Text style={styles.muted}>{ru ? 'Исходные Calendar, Messages и Tasks продолжают работать отдельно.' : 'Calendar, Messages and Tasks continue to work independently.'}</Text></Surface> : brief?.sections.length ? brief.sections.map(section => <Surface key={section.id} style={styles.card}><Label>{section.title}</Label>{section.items.slice(0, 5).map(item => <View key={item.id} style={styles.item}><View style={styles.itemText}><Text style={styles.itemTitle}>{item.title}</Text>{item.reason ? <Text style={styles.muted}>{item.reason}</Text> : null}</View><KeystoneButton onPress={() => void open(item)}>{ru ? 'Открыть' : 'Open'}</KeystoneButton></View>)}{section.remaining > 0 ? <Text style={styles.muted}>{ru ? `Ещё ${section.remaining}` : `${section.remaining} more`}</Text> : null}</Surface>) : <Surface style={styles.card}><Label>{empty}</Label><Text style={styles.muted}>{ru ? 'Календарь, задачи и локальная работа появятся здесь, когда в них будет значимое изменение.' : 'Calendar, tasks and local work appear here when there is a meaningful change.'}</Text></Surface>}<View style={styles.actions}><KeystoneButton onPress={() => router.push('/calendar')}>{ru ? 'Календарь' : 'Calendar'}</KeystoneButton><KeystoneButton onPress={() => router.push('/spaces')}>{ru ? 'Задачи' : 'Tasks'}</KeystoneButton><KeystoneButton onPress={() => router.push('/messages')}>{ru ? 'Сообщения' : 'Messages'}</KeystoneButton><KeystoneButton onPress={() => void refresh()}>{ru ? 'Обновить' : 'Refresh'}</KeystoneButton></View></ScrollView>;
}

const styles = { screen: { padding: 16, gap: 12, backgroundColor: tokens.colors.background }, header: { gap: 6 }, card: { padding: 14, gap: 10 }, item: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, gap: 10, borderTopWidth: 1, borderTopColor: tokens.colors.border, paddingTop: 9 }, itemText: { flex: 1, gap: 3 }, itemTitle: { color: tokens.colors.text, fontWeight: '600' as const }, muted: { color: tokens.colors.muted }, actions: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8 } };
