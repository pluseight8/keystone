import { useEffect, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { tokens } from '@keystone/theme';
import { KeystoneButton, Label } from '@keystone/ui';
import { i18n } from '@keystone/core';
import { getMobileMessagingRuntime, subscribeMobileMessagingRuntime } from '../src/socialRuntime';

export default function NewChat() {
  const [runtime, setRuntime] = useState(getMobileMessagingRuntime); const [peer, setPeer] = useState(''); const [locale, setLocale] = useState(i18n.getLocale); const [error, setError] = useState(''); const copy = locale === 'ru' ? russian : english;
  useEffect(() => subscribeMobileMessagingRuntime(() => setRuntime(getMobileMessagingRuntime())), []); useEffect(() => i18n.subscribe(setLocale), []); useEffect(() => { if (runtime?.peer) setPeer(runtime.peer); }, [runtime]);
  const open = async () => { if (!runtime || !peer.trim()) return; try { const conversation = await runtime.messaging.createConversation(peer.trim()); router.replace({ pathname: '/conversation', params: { id: conversation.id, peer: peer.trim() } }); } catch (reason) { setError(reason instanceof Error ? reason.message : copy.error); } };
  if (!runtime) return <View style={styles.empty}><Label>{copy.notConfigured}</Label></View>;
  return <View style={styles.screen}><Label>{copy.title}</Label><Text style={styles.muted}>{copy.detail}</Text><TextInput value={peer} onChangeText={setPeer} autoCapitalize="none" placeholder={copy.placeholder} placeholderTextColor={tokens.colors.muted} style={styles.input} /><KeystoneButton onPress={() => void open()}>{copy.open}</KeystoneButton>{error ? <Text style={styles.error}>{error}</Text> : null}</View>;
}
const english = { title: 'New chat', detail: 'Use a verified cryptographic Identity ID.', placeholder: 'Peer Identity ID', open: 'Open encrypted chat', notConfigured: 'Messaging is not configured.', error: 'Unable to open chat' };
const russian: typeof english = { title: 'Новый чат', detail: 'Используйте проверенный криптографический Identity ID.', placeholder: 'Identity ID собеседника', open: 'Открыть зашифрованный чат', notConfigured: 'Обмен сообщениями не настроен.', error: 'Не удалось открыть чат' };
const styles = { screen: { flex: 1, backgroundColor: tokens.colors.background, padding: 20, gap: 12 }, input: { minHeight: 48, borderWidth: 1, borderColor: tokens.colors.border, borderRadius: tokens.radii.md, padding: 12, color: tokens.colors.text }, muted: { color: tokens.colors.muted }, error: { color: '#dc143c' }, empty: { flex: 1, justifyContent: 'center' as const, padding: 24, backgroundColor: tokens.colors.background } };
