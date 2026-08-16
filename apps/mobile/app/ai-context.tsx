import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { i18n, type ContextResult, type ContextScope } from '@keystone/core';
import { tokens } from '@keystone/theme';
import { KeystoneButton, Label, Surface } from '@keystone/ui';
import { getMobileSettingsRuntime, subscribeMobileSettingsRuntime } from '../src/settingsRuntime';

const scopes: readonly { value: ContextScope; en: string; ru: string }[] = [
  { value: 'all-private', en: 'ALL PRIVATE DATA', ru: 'ВСЕ ПРИВАТНЫЕ ДАННЫЕ' },
  { value: 'current-space', en: 'CURRENT SPACE', ru: 'ТЕКУЩЕЕ ПРОСТРАНСТВО' },
  { value: 'current-chat', en: 'CURRENT CHAT', ru: 'ТЕКУЩИЙ ЧАТ' },
  { value: 'communities', en: 'COMMUNITIES', ru: 'СООБЩЕСТВА' },
  { value: 'files', en: 'FILES', ru: 'ФАЙЛЫ' },
  { value: 'public-only', en: 'PUBLIC ONLY', ru: 'ТОЛЬКО PUBLIC' },
];

/** Minimal host-neutral surface. Native hosts install the resolver and can
 * replace object navigation with their typed deep-link router. */
export default function AIContextScreen() {
  const router = useRouter();
  const [runtime, setRuntime] = useState(getMobileSettingsRuntime); const [locale, setLocale] = useState(i18n.getLocale);
  const [query, setQuery] = useState(''); const [scope, setScope] = useState<ContextScope>('all-private'); const [result, setResult] = useState<ContextResult>(); const [expanded, setExpanded] = useState(false); const [busy, setBusy] = useState(false);
  const ru = locale === 'ru';
  useEffect(() => subscribeMobileSettingsRuntime(() => setRuntime(getMobileSettingsRuntime())), []);
  useEffect(() => i18n.subscribe(setLocale), []);
  const resolver = runtime?.context;
  const run = async () => { if (!resolver || !query.trim()) return; setBusy(true); try { setResult(await resolver.resolve({ text: query.trim(), scope, execution: 'local' })); } finally { setBusy(false); } };
  if (!resolver) return <View style={styles.empty}><Label>{ru ? 'AI-контекст не настроен' : 'AI context is not configured'}</Label><Text style={styles.muted}>{ru ? 'Native host должен установить UnifiedContextResolver.' : 'The native host must install UnifiedContextResolver.'}</Text></View>;
  return <ScrollView contentContainerStyle={styles.screen}><View style={styles.header}><Label>{ru ? 'Личный AI-контекст' : 'Personal AI context'}</Label><Text style={styles.muted}>{ru ? 'Поиск только по разрешённым локальным объектам Keystone.' : 'Searches only permitted local Keystone objects.'}</Text></View><Surface style={styles.card}><TextInput value={query} onChangeText={setQuery} placeholder={ru ? 'Спросите о чатах, файлах, Spaces…' : 'Ask about chats, files, Spaces…'} placeholderTextColor={tokens.colors.muted} style={styles.input} multiline /><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scopeRow}>{scopes.map(item => <Pressable key={item.value} onPress={() => setScope(item.value)} style={[styles.scope, scope === item.value && styles.selected]}><Text style={styles.scopeText}>{ru ? item.ru : item.en}</Text></Pressable>)}</ScrollView><KeystoneButton onPress={() => void run()}>{busy ? (ru ? 'Ищу…' : 'Searching…') : (ru ? 'Найти в Keystone' : 'Search Keystone')}</KeystoneButton></Surface>{result ? <Surface style={styles.card}><View style={styles.resultHeader}><Label>{ru ? 'Ответ' : 'Answer'}</Label><Text style={styles.badge}>{result.privacy === 'local' ? (ru ? 'Приватно' : 'Processed privately') : result.privacy}</Text></View><Text style={styles.answer}>{result.answer}</Text><Pressable onPress={() => setExpanded(value => !value)}><Text style={styles.link}>{expanded ? (ru ? 'Скрыть источники' : 'Hide sources') : (ru ? `Источники (${result.citations.length})` : `Sources (${result.citations.length})`)}</Text></Pressable>{expanded && result.citations.map(citation => <View key={citation.objectId} style={styles.citation}><Text style={styles.citationTitle}>{citation.sourceType} · {citation.objectId}</Text><Text style={styles.muted}>{citation.excerpt}</Text><Text style={styles.muted}>{citation.author} · {new Date(citation.timestamp).toLocaleString()}</Text><KeystoneButton onPress={() => router.push({ pathname: '/explore', params: { query: citation.objectId } })}>{ru ? 'Открыть объект' : 'Open original object'}</KeystoneButton></View>)}</Surface> : null}</ScrollView>;
}

const styles = { screen: { padding: 16, gap: 12, backgroundColor: tokens.colors.background }, empty: { flex: 1, justifyContent: 'center' as const, padding: 24, gap: 8, backgroundColor: tokens.colors.background }, header: { gap: 6 }, card: { padding: 14, gap: 10 }, input: { minHeight: 80, borderWidth: 1, borderColor: tokens.colors.border, color: tokens.colors.text, padding: 10, textAlignVertical: 'top' as const }, scopeRow: { gap: 8 }, scope: { borderWidth: 1, borderColor: tokens.colors.border, paddingHorizontal: 8, paddingVertical: 6 }, selected: { borderColor: tokens.colors.accent, backgroundColor: tokens.colors.surface }, scopeText: { color: tokens.colors.text, fontSize: 11 }, resultHeader: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, alignItems: 'center' as const }, badge: { color: tokens.colors.accent, fontSize: 12 }, answer: { color: tokens.colors.text, lineHeight: 20 }, muted: { color: tokens.colors.muted }, link: { color: tokens.colors.accent, fontWeight: '600' as const }, citation: { borderTopWidth: 1, borderTopColor: tokens.colors.border, paddingTop: 10, gap: 6 }, citationTitle: { color: tokens.colors.text, fontWeight: '600' as const } };
