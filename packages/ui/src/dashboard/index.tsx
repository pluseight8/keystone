import React from 'react';
import {
  KeyboardAvoidingView,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { tokens } from '@keystone/theme';
import { LifeMapCanvas, type LifeMapCanvasProps } from '../life-map';
import { useTranslation } from '../i18n';

export type DashboardActivity = 'idle' | 'active';
export interface DashboardStatuses {
  p2p: { peers: number; activity?: DashboardActivity };
  rag: { indexed: number; total: number; activity?: DashboardActivity };
  model: { label: string; ramGb?: number; vramGb?: number; activity?: DashboardActivity };
  chronos: { activeTasks: number; activity?: DashboardActivity };
}
export interface DashboardMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
}
export interface UnifiedDashboardProps {
  statuses: DashboardStatuses;
  messages?: readonly DashboardMessage[];
  lifeMapProps?: LifeMapCanvasProps;
  isRecording?: boolean;
  isGenerating?: boolean;
  onSendMessage?: (text: string) => void | Promise<void>;
  onToggleRecording?: () => void;
  ecoMode?: boolean;
}

const DESKTOP_MIN = 840;
const CHAT_MIN = 280;
const CHAT_MAX = 520;

/** GUI-first home surface combining Life Map, local AI chat and live system health. */
export function UnifiedDashboard({
  statuses,
  messages = [],
  lifeMapProps,
  isRecording = false,
  isGenerating = false,
  onSendMessage,
  onToggleRecording,
  ecoMode = false,
}: UnifiedDashboardProps) {
  const { width } = useWindowDimensions();
  const { t } = useTranslation();
  const desktop = width >= DESKTOP_MIN;
  const [chatWidth, setChatWidth] = React.useState(360);
  const [resizing, setResizing] = React.useState(false);
  const [dividerHovered, setDividerHovered] = React.useState(false);
  const [mobileTab, setMobileTab] = React.useState<'map' | 'chat'>('map');
  const dragStart = React.useRef(chatWidth);
  const maxChat = Math.max(CHAT_MIN, Math.min(CHAT_MAX, width - 420));

  React.useEffect(() => setChatWidth(value => Math.min(value, maxChat)), [maxChat]);
  const resize = React.useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => { dragStart.current = chatWidth; setResizing(true); },
    onPanResponderMove: (_event, gesture) => setChatWidth(Math.max(CHAT_MIN, Math.min(maxChat, dragStart.current + gesture.dx))),
    onPanResponderRelease: () => setResizing(false),
    onPanResponderTerminate: () => setResizing(false),
  }), [chatWidth, maxChat]);

  return <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    {desktop && <StatusBar statuses={statuses} generating={isGenerating} recording={isRecording} ecoMode={ecoMode} />}
    {desktop ? <View style={styles.desktopBody}>
      <View style={[styles.chatPane, { width: chatWidth }]}><ChatPanel messages={messages} generating={isGenerating} recording={isRecording} onSend={onSendMessage} onToggleRecording={onToggleRecording} /></View>
      <Pressable {...resize.panHandlers} onHoverIn={() => setDividerHovered(true)} onHoverOut={() => setDividerHovered(false)} accessibilityRole="adjustable" accessibilityLabel={t('dashboard.chat')} accessibilityValue={{ min: CHAT_MIN, max: maxChat, now: Math.round(chatWidth) }} style={styles.dividerHitArea}><View style={[styles.dividerLine, (resizing || dividerHovered) && styles.dividerLineActive]} /></Pressable>
      <View style={styles.mapPane}><LifeMapCanvas {...lifeMapProps} style={[styles.lifeMap, lifeMapProps?.style]} /></View>
    </View> : <View style={styles.mobileBody}>
      <View style={styles.mobileTabs} accessibilityRole="tablist">
        <MobileTab label={t('dashboard.life_map')} selected={mobileTab === 'map'} onPress={() => setMobileTab('map')} />
        <MobileTab label={t('dashboard.chat')} selected={mobileTab === 'chat'} onPress={() => setMobileTab('chat')} active={isGenerating || isRecording} />
      </View>
      <View style={styles.mobileContent}>{mobileTab === 'map' ? <LifeMapCanvas {...lifeMapProps} style={[styles.lifeMap, lifeMapProps?.style]} /> : <View style={styles.mobileSheet}><View style={styles.sheetHandle} /><ChatPanel messages={messages} generating={isGenerating} recording={isRecording} onSend={onSendMessage} onToggleRecording={onToggleRecording} /></View>}</View>
      <StatusBar statuses={statuses} generating={isGenerating} recording={isRecording} ecoMode={ecoMode} compact />
    </View>}
  </KeyboardAvoidingView>;
}

function MobileTab({ label, selected, active, onPress }: { label: string; selected: boolean; active?: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="tab" accessibilityState={{ selected }} onPress={onPress} style={[styles.mobileTab, selected && styles.mobileTabSelected]}><Text style={[styles.tabText, (selected || active) && styles.activeText]}>{label}</Text></Pressable>;
}

function ChatPanel({ messages, generating, recording, onSend, onToggleRecording }: { messages: readonly DashboardMessage[]; generating: boolean; recording: boolean; onSend?: UnifiedDashboardProps['onSendMessage']; onToggleRecording?: () => void }) {
  const { t } = useTranslation();
  const [draft, setDraft] = React.useState('');
  const submit = () => { const value = draft.trim(); if (!value || generating) return; setDraft(''); void onSend?.(value); };
  return <View style={styles.chat}>
    <View style={styles.panelHeader}><View><Text style={styles.eyebrow}>{t('dashboard.communication_ai')}</Text><Text style={styles.panelTitle}>{t('dashboard.local_dialogue')}</Text></View>{generating && <Text accessibilityLiveRegion="polite" style={styles.activeText}>{t('dashboard.generation')}</Text>}</View>
    <ScrollView style={styles.messages} contentContainerStyle={styles.messageContent} keyboardShouldPersistTaps="handled">
      {messages.length ? messages.map(message => <View key={message.id} style={[styles.message, message.role === 'user' && styles.userMessage]}><Text style={styles.messageRole}>{message.role === 'user' ? t('dashboard.you') : t('dashboard.keystone')}</Text><Text selectable style={styles.messageText}>{message.text}</Text></View>) : <Text style={styles.emptyText}>{t('dashboard.empty')}</Text>}
      {generating && <Text accessibilityLiveRegion="polite" style={styles.generating}>{t('dashboard.ai_response')}</Text>}
    </ScrollView>
    <View style={styles.composer}>
      <TextInput accessibilityLabel={t('dashboard.placeholder')} placeholder={t('dashboard.placeholder')} placeholderTextColor="#707070" value={draft} onChangeText={setDraft} onSubmitEditing={submit} returnKeyType="send" multiline style={styles.input} />
      <Pressable accessibilityRole="button" accessibilityLabel={recording ? t('dashboard.record_stop') : t('dashboard.record_start')} accessibilityState={{ selected: recording }} onPress={onToggleRecording} style={[styles.iconButton, recording && styles.activeButton]}><Text style={styles.iconText}>{recording ? '■' : '●'}</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={t('dashboard.send')} disabled={!draft.trim() || generating} onPress={submit} style={({ pressed }) => [styles.sendButton, (!draft.trim() || generating) && styles.disabled, pressed && styles.pressed]}><Text style={styles.sendText}>↑</Text></Pressable>
    </View>
  </View>;
}

function StatusBar({ statuses, generating, recording, ecoMode, compact = false }: { statuses: DashboardStatuses; generating: boolean; recording: boolean; ecoMode: boolean; compact?: boolean }) {
  const { t } = useTranslation();
  const ragPercent = statuses.rag.total ? Math.min(100, Math.round(statuses.rag.indexed / statuses.rag.total * 100)) : 0;
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} style={[styles.statusBar, compact && styles.statusBarCompact]} contentContainerStyle={styles.statusContent} accessibilityLabel={t('dashboard.system_status')}>
    <StatusItem label="P2P" value={t('dashboard.nodes', { count: statuses.p2p.peers })} active={statuses.p2p.activity === 'active'} />
    <StatusItem label="RAG" value={`${ragPercent}%`} active={statuses.rag.activity === 'active'} />
    <StatusItem label="MODEL" value={[statuses.model.label, statuses.model.ramGb != null && `RAM ${statuses.model.ramGb}G`, statuses.model.vramGb != null && `VRAM ${statuses.model.vramGb}G`].filter(Boolean).join(' · ')} active={statuses.model.activity === 'active' || generating} />
    <StatusItem label="CHRONOS" value={t('dashboard.tasks', { count: statuses.chronos.activeTasks })} active={statuses.chronos.activity === 'active'} />
    {ecoMode && <StatusItem label="ECO MODE" value="Battery aware" muted />}
    {(recording || generating) && <StatusItem label="ACTIVE" value={recording ? t('dashboard.voice_recording') : t('dashboard.ai_response')} active />}
  </ScrollView>;
}

function StatusItem({ label, value, active, muted }: { label: string; value: string; active?: boolean; muted?: boolean }) {
  return <View style={[styles.statusItem, muted && styles.ecoItem]}><View style={[styles.statusMark, active && styles.statusMarkActive]} /><Text style={styles.statusLabel}>{label}</Text><Text numberOfLines={1} style={[styles.statusValue, active && styles.activeText, muted && styles.ecoText]}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 560, backgroundColor: '#000000' },
  desktopBody: { flex: 1, flexDirection: 'row', minHeight: 0 },
  chatPane: { backgroundColor: '#121212' },
  mapPane: { flex: 1, padding: 12, backgroundColor: '#000000' },
  lifeMap: { flex: 1, minHeight: 0, borderRadius: 0 },
  dividerHitArea: { width: 9, marginHorizontal: -4, zIndex: 2, alignItems: 'center', backgroundColor: 'transparent', cursor: 'col-resize' } as never,
  dividerLine: { width: 1, height: '100%', backgroundColor: '#2a2a2a' },
  dividerLineActive: { backgroundColor: '#990000' },
  mobileBody: { flex: 1 },
  mobileTabs: { minHeight: 49, flexDirection: 'row', backgroundColor: '#121212', borderBottomWidth: 1, borderBottomColor: '#2a2a2a' },
  mobileTab: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 1, borderBottomColor: 'transparent' },
  mobileTabSelected: { borderBottomColor: '#990000' },
  tabText: { color: '#8c8c8c', fontSize: 13, fontWeight: '600' },
  mobileContent: { flex: 1, minHeight: 0, padding: 8 },
  mobileSheet: { flex: 1, overflow: 'hidden', backgroundColor: '#121212', borderTopWidth: 1, borderTopColor: '#2a2a2a' },
  sheetHandle: { width: 36, height: 2, marginTop: 8, alignSelf: 'center', backgroundColor: '#555555' },
  chat: { flex: 1, minHeight: 0, backgroundColor: '#121212' },
  panelHeader: { minHeight: 70, paddingHorizontal: 16, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: '#2a2a2a', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  eyebrow: { color: '#777777', fontSize: 10, letterSpacing: 1.1, fontWeight: '700' },
  panelTitle: { color: '#f5f5f5', fontSize: 16, fontWeight: '600', marginTop: 4 },
  messages: { flex: 1 },
  messageContent: { padding: 16, gap: 18 },
  message: { maxWidth: '94%', alignSelf: 'flex-start' },
  userMessage: { alignSelf: 'flex-end' },
  messageRole: { color: '#777777', fontSize: 9, letterSpacing: 1, marginBottom: 5 },
  messageText: { color: '#e8e8e8', fontSize: 14, lineHeight: 20 },
  emptyText: { color: '#8c8c8c', fontSize: 14, lineHeight: 21 },
  generating: { color: '#990000', fontSize: 12 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 12, borderTopWidth: 1, borderTopColor: '#2a2a2a' },
  input: { flex: 1, minHeight: 44, maxHeight: 120, paddingHorizontal: 12, paddingVertical: 10, color: '#f5f5f5', fontSize: 16, backgroundColor: '#000000', borderWidth: 1, borderColor: '#2a2a2a', borderRadius: 2 },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#2a2a2a', backgroundColor: '#121212' },
  activeButton: { borderColor: '#990000', backgroundColor: '#3d0000' },
  iconText: { color: '#d0d0d0', fontSize: 13 },
  sendButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: '#990000' },
  sendText: { color: '#ffffff', fontSize: 22 },
  disabled: { opacity: 0.38 },
  pressed: { opacity: 0.72 },
  statusBar: { flexGrow: 0, height: 42, backgroundColor: '#121212', borderBottomWidth: 1, borderBottomColor: '#2a2a2a' },
  statusBarCompact: { borderBottomWidth: 0, borderTopWidth: 1, borderTopColor: '#2a2a2a' },
  statusContent: { minHeight: 41, alignItems: 'center', paddingHorizontal: 12, gap: 20 },
  statusItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusMark: { width: 5, height: 5, backgroundColor: '#777777' },
  statusMarkActive: { backgroundColor: '#990000' },
  statusLabel: { color: '#777777', fontSize: 9, letterSpacing: .8, fontWeight: '700' },
  statusValue: { color: '#d0d0d0', fontSize: 11 },
  activeText: { color: '#b30000' },
  ecoItem: { opacity: .62 },
  ecoText: { color: '#777777' },
});

export default UnifiedDashboard;
