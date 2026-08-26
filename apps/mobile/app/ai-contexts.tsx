import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { i18n, type AIContextCacheManager, type ContextTier, type SessionContextState } from '@keystone/core';
import { tokens } from '@keystone/theme';
import { KeystoneButton, Label, Surface } from '@keystone/ui';
import { getMobileSettingsRuntime, subscribeMobileSettingsRuntime } from '../src/settingsRuntime';

const tierOrder: readonly ContextTier[] = ['HOT', 'WARM', 'COLD', 'FROZEN'];

/** Runtime-only context inspection. Evicting here never removes durable
 * conversation history, Memory, Identity or permissions. */
export default function AIContextsScreen() {
  const [runtime, setRuntime] = useState(getMobileSettingsRuntime); const [locale, setLocale] = useState(i18n.getLocale); const [sessions, setSessions] = useState<readonly SessionContextState[]>([]);
  const ru = locale === 'ru'; const cache = runtime?.contextCache as AIContextCacheManager | undefined;
  const refresh = () => setSessions(cache?.listSessions() ?? []);
  useEffect(() => subscribeMobileSettingsRuntime(() => setRuntime(getMobileSettingsRuntime())), []);
  useEffect(() => i18n.subscribe(setLocale), []);
  useEffect(() => { if (!cache) { refresh(); return; } void cache.ready().then(refresh); const timer = setInterval(refresh, 1_000); return () => clearInterval(timer); }, [cache]);
  if (!cache) return <View style={styles.empty}><Label>{ru ? 'Кэш контекстов не настроен' : 'Context cache is not configured'}</Label><Text style={styles.muted}>{ru ? 'Native host должен подключить AIContextCacheManager.' : 'The native host must connect AIContextCacheManager.'}</Text></View>;
  const label = (tier: ContextTier) => ru ? ({ HOT: 'ГОРЯЧИЙ', WARM: 'ТЁПЛЫЙ', COLD: 'ХОЛОДНЫЙ', FROZEN: 'ЗАМОРОЖЕННЫЙ' }[tier]) : tier;
  const formatBytes = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
  const evict = async (state: SessionContextState) => { await cache.evictSession(state); refresh(); };
  return <ScrollView contentContainerStyle={styles.screen}><Surface style={styles.card}><Label>{ru ? 'AI Resources → Contexts' : 'AI Resources → Contexts'}</Label><Text style={styles.muted}>{ru ? 'KV-кэш — временная оптимизация. Durable session, Memory и Identity не удаляются.' : 'KV cache is a disposable optimization. Durable sessions, Memory and Identity are never removed.'}</Text><Text style={styles.text}>{ru ? `Сессий: ${sessions.length}` : `Sessions: ${sessions.length}`}</Text></Surface>{tierOrder.map(tier => { const values = sessions.filter(state => state.tier === tier); if (!values.length) return null; return <Surface key={tier} style={styles.card}><Label>{label(tier)} · {values.length}</Label>{values.map(state => <View key={`${state.agentId}:${state.sessionId}`} style={styles.item}><Text style={styles.text}>{state.agentId} · {state.sessionId}</Text><Text style={styles.muted}>{state.namespace}</Text><Text style={styles.muted}>{ru ? `Контекст ${state.estimatedContextTokens} токенов · KV RAM ${formatBytes(state.estimatedKvRamBytes)} · VRAM ${formatBytes(state.estimatedKvVramBytes)}` : `${state.estimatedContextTokens} context tokens · KV RAM ${formatBytes(state.estimatedKvRamBytes)} · VRAM ${formatBytes(state.estimatedKvVramBytes)}`}</Text><Text style={styles.muted}>{state.lastUsedAt ? (ru ? `Последний запуск: ${new Date(state.lastUsedAt).toLocaleString()}` : `Last used: ${new Date(state.lastUsedAt).toLocaleString()}`) : (ru ? 'Ещё не запускалась' : 'Not used yet')}</Text><View style={styles.row}><KeystoneButton onPress={() => void evict(state)}>{ru ? 'Очистить runtime-кэш' : 'Clear runtime cache'}</KeystoneButton><Pressable onPress={() => void cache.clearRuntimeCache(state).then(refresh)}><Text style={styles.link}>{ru ? 'Эвиктировать' : 'Evict'}</Text></Pressable></View></View>)}</Surface>; })}</ScrollView>;
}

const styles = { screen: { padding: 16, gap: 12, backgroundColor: tokens.colors.background }, empty: { flex: 1, justifyContent: 'center' as const, padding: 24, gap: 8, backgroundColor: tokens.colors.background }, card: { padding: 14, gap: 10 }, item: { borderTopWidth: 1, borderTopColor: tokens.colors.border, paddingTop: 10, gap: 4 }, row: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10 }, text: { color: tokens.colors.text }, muted: { color: tokens.colors.muted }, link: { color: tokens.colors.accent, fontWeight: '600' as const } };
