import { useState } from 'react';
import { FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { tokens } from '@keystone/theme';
import { KeystoneButton, Label, Surface } from '@keystone/ui';
type Message = { id: string; kind: 'user' | 'assistant' | 'system'; text: string };

export default function Messages() {
  const [draft, setDraft] = useState('');
  const [recording, setRecording] = useState(false);
  const [messages, setMessages] = useState<Message[]>([{ id: 'welcome', kind: 'assistant', text: 'Чем помочь? Я запрошу подтверждение перед передачей данных или автоматизацией.' }]);
  const send = (text = draft) => { if (!text.trim()) return; setDraft(''); setMessages(current => [...current, { id: `${Date.now()}u`, kind: 'user', text }, { id: `${Date.now()}s`, kind: 'system', text: 'Запрашиваю данные у узла…' }, { id: `${Date.now()}c`, kind: 'system', text: 'Ожидание двойного подтверждения…' }]); };
  return <View style={{ flex: 1, backgroundColor: tokens.colors.background }}><FlatList contentContainerStyle={{ padding: 20, gap: 10 }} data={messages} keyExtractor={item => item.id} renderItem={({ item }) => <Surface style={{ padding: 14, alignSelf: item.kind === 'user' ? 'flex-end' : 'flex-start', maxWidth: '88%', backgroundColor: item.kind === 'user' ? tokens.colors.accentSoft : tokens.colors.surface }}><Text style={{ color: tokens.colors.text }}>{item.text}</Text></Surface>} /><View style={{ padding: 12, gap: 8 }}><TextInput value={draft} onChangeText={setDraft} placeholder="Напишите команду…" placeholderTextColor={tokens.colors.muted} style={{ minHeight: 48, borderWidth: 1, borderColor: tokens.colors.border, borderRadius: tokens.radii.md, padding: 12, color: tokens.colors.text, fontSize: 16 }} /><View style={{ flexDirection: 'row', gap: 8 }}><Pressable accessibilityRole="button" accessibilityLabel={recording ? 'Остановить запись' : 'Удерживайте для записи'} onPressIn={() => setRecording(true)} onPressOut={() => { setRecording(false); send('Голосовая команда'); }} style={{ flex: 1, minHeight: 48, borderRadius: tokens.radii.md, backgroundColor: recording ? tokens.colors.accent : tokens.colors.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: tokens.colors.border }}><Label>{recording ? '● Запись…' : '🎙 Голос'}</Label></Pressable><KeystoneButton onPress={() => send()}>Отправить</KeystoneButton></View></View></View>;
}
