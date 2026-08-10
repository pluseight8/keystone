import React from 'react';
import {
  Animated,
  Easing,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import type { AmbientScribe, MeetingInsights, ScribeState } from '@keystone/core';

const BLACK = '#000000';
const CRIMSON = '#990000';
const WHITE = '#ffffff';
const BORDER = '#2a2a2a';
const MUTED = 'rgba(255,255,255,.58)';

export interface ScribeScreenProps {
  scribe: AmbientScribe;
  insights?: MeetingInsights;
  isGenerating?: boolean;
  error?: string;
  capsuleActive?: boolean;
  onGenerate: (transcript: string) => void | Promise<void>;
  /** The host calls MeetingDistillationEngine/integration here; capsule sharing then happens through its live CRDT. */
  onAddToLifeMapAndShare: (insights: MeetingInsights) => void | Promise<void>;
  onClose?: () => void;
}

/** Full-screen, host-neutral recorder for React Native mobile and react-native-web desktop. */
export function ScribeScreen(props: ScribeScreenProps) {
  const { width } = useWindowDimensions();
  const compact = width < 680;
  const [state, setState] = React.useState<ScribeState>(props.scribe.state);
  const [transcript, setTranscript] = React.useState(props.scribe.transcript);
  const [partial, setPartial] = React.useState('');
  const [level, setLevel] = React.useState(0);
  const [busy, setBusy] = React.useState(false);
  const scroll = React.useRef<ScrollView>(null);

  React.useEffect(() => props.scribe.subscribe(event => {
    if (event.type === 'state') setState(event.state);
    if (event.type === 'paragraph') { setTranscript(event.transcript); setPartial(''); }
    if (event.type === 'partial') setPartial(event.text);
    if (event.type === 'level') setLevel(event.level);
  }), [props.scribe]);

  React.useEffect(() => { scroll.current?.scrollToEnd({ animated: state === 'recording' }); }, [transcript, partial, state]);

  const begin = async () => { setBusy(true); try { await props.scribe.restore(); setTranscript(props.scribe.transcript); await props.scribe.start(); } finally { setBusy(false); } };
  const stop = async () => { setBusy(true); try { const text = await props.scribe.stop(); setTranscript(text); await props.onGenerate(text); } finally { setBusy(false); } };
  const generate = async () => { setBusy(true); try { await props.onGenerate(transcript); } finally { setBusy(false); } };
  const add = async () => { if (!props.insights) return; setBusy(true); try { await props.onAddToLifeMapAndShare(props.insights); } finally { setBusy(false); } };
  const recording = state === 'recording' || state === 'stopping';
  const showInsights = Boolean(props.insights) || props.isGenerating;

  return <View style={[styles.screen, compact && styles.screenCompact]}>
    <View style={styles.header}>
      <View><Text style={styles.eyebrow}>AMBIENT SCRIBE</Text><Text style={styles.privacy}>LOCAL · OFFLINE · {recording ? 'LISTENING' : 'PRIVATE'}</Text></View>
      {props.onClose && <Pressable accessibilityRole="button" accessibilityLabel="Close Ambient Scribe" onPress={props.onClose} style={({ pressed }) => [styles.close, pressed && styles.pressed]}><Text style={styles.closeText}>CLOSE</Text></Pressable>}
    </View>

    <View style={[styles.body, compact && styles.bodyCompact]}>
      {!showInsights ? <>
        <View style={styles.visualizerRegion}>
          <AudioVisualizer level={level} active={recording} />
          <Text accessibilityLiveRegion="polite" style={styles.status}>{statusLabel(state)}</Text>
          <Text style={styles.timerHint}>{recording ? 'Speak naturally. Pauses become paragraphs.' : 'Your transcript never leaves this device.'}</Text>
        </View>
        <TerminalLog ref={scroll} transcript={transcript} partial={partial} />
      </> : <MeetingInsightsCard insights={props.insights} loading={Boolean(props.isGenerating)} capsuleActive={props.capsuleActive} onAdd={() => { void add(); }} disabled={busy} />}
    </View>

    <View style={[styles.footer, compact && styles.footerCompact]}>
      <Text style={styles.transcriptMeta}>{wordCount(transcript)} WORDS · CRDT RECOVERY ON</Text>
      {!recording && !showInsights && <LineButton label="START RECORDING" onPress={() => { void begin(); }} disabled={busy} primary />}
      {recording && <LineButton label={state === 'stopping' ? 'FINISHING…' : 'STOP & DISTILL'} onPress={() => { void stop(); }} disabled={busy || state === 'stopping'} primary />}
      {!recording && transcript && !showInsights && <LineButton label="GENERATE INSIGHTS" onPress={() => { void generate(); }} disabled={busy} />}
      {props.error && <Text accessibilityLiveRegion="assertive" style={styles.error}>{props.error}</Text>}
    </View>
  </View>;
}

const TerminalLog = React.forwardRef<ScrollView, { transcript: string; partial: string }>(({ transcript, partial }, ref) => (
  <View style={styles.logShell}>
    <View style={styles.logHeader}><Text style={styles.logTitle}>LIVE TRANSCRIPT</Text><View style={styles.liveDot} /><Text style={styles.logState}>REC</Text></View>
    <ScrollView ref={ref} style={styles.log} contentContainerStyle={styles.logContent} keyboardShouldPersistTaps="handled">
      <Text selectable accessibilityLiveRegion="polite" style={styles.transcript}>{transcript || 'Waiting for speech…'}{partial ? <Text style={styles.partial}>{transcript ? '\n\n' : ''}{partial}</Text> : null}</Text>
    </ScrollView>
  </View>
));
TerminalLog.displayName = 'TerminalLog';

function AudioVisualizer({ level, active }: { level: number; active: boolean }) {
  const pulse = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    if (!active) { pulse.stopAnimation(); pulse.setValue(0); return undefined; }
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 720, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 720, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    animation.start(); return () => animation.stop();
  }, [active, pulse]);
  const bars = Array.from({ length: 31 }, (_, index) => {
    const distance = Math.abs(index - 15) / 15;
    const energy = active ? Math.max(.12, level) : .06;
    const height = 4 + energy * (1 - distance * .62) * (index % 3 === 0 ? 72 : index % 2 === 0 ? 50 : 34);
    return <Animated.View key={index} style={[styles.bar, { height, opacity: active ? pulse.interpolate({ inputRange: [0, 1], outputRange: [.55, 1] }) : .28 }]} />;
  });
  return <View accessible accessibilityRole="image" accessibilityLabel={active ? 'Live audio waveform' : 'Audio waveform idle'} style={styles.wave}>{bars}</View>;
}

function MeetingInsightsCard({ insights, loading, capsuleActive, onAdd, disabled }: { insights?: MeetingInsights; loading: boolean; capsuleActive?: boolean; onAdd: () => void; disabled: boolean }) {
  if (loading || !insights) return <View style={styles.insights}><Text style={styles.eyebrow}>MEETING INSIGHTS</Text><Text accessibilityLiveRegion="polite" style={styles.insightTitle}>Distilling locally…</Text><View style={styles.progressLine} /></View>;
  return <ScrollView style={styles.insights} contentContainerStyle={styles.insightsContent}>
    <Text style={styles.eyebrow}>MEETING INSIGHTS</Text>
    <Text style={styles.insightTitle}>{insights.topic}</Text>
    <Text style={styles.sectionLabel}>SUMMARY</Text><Text style={styles.summary}>{insights.summary}</Text>
    <Text style={styles.sectionLabel}>DECISIONS · {insights.decisions.length}</Text>
    {insights.decisions.length ? insights.decisions.map((decision, index) => <View key={`${index}-${decision}`} style={styles.row}><Text style={styles.marker}>—</Text><Text style={styles.rowText}>{decision}</Text></View>) : <Text style={styles.empty}>No explicit decisions detected.</Text>}
    <Text style={styles.sectionLabel}>ACTION ITEMS · {insights.action_items.length}</Text>
    {insights.action_items.map((item, index) => <View key={`${index}-${item.task}`} style={styles.task}>
      <Text style={styles.taskIndex}>{String(index + 1).padStart(2, '0')}</Text><View style={styles.taskBody}><Text style={styles.taskTitle}>{item.task}</Text><Text style={styles.taskMeta}>{item.owner}{item.due_at ? ` · ${item.due_at}` : ''}</Text></View>
    </View>)}
    <View style={styles.shareNotice}><Text style={styles.shareNoticeText}>{capsuleActive ? 'ACTIVE CAPSULE · TASKS WILL SYNC TO ALL PARTICIPANTS' : 'PRIVATE LIFE MAP · NO ACTIVE CAPSULE'}</Text></View>
    <LineButton label="ADD TO LIFE MAP & SHARE" onPress={onAdd} disabled={disabled} primary />
  </ScrollView>;
}

function LineButton({ label, onPress, disabled, primary }: { label: string; onPress: () => void; disabled?: boolean; primary?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.button, primary && styles.buttonPrimary, pressed && !disabled && styles.pressed, disabled && styles.disabled]}><Text style={styles.buttonText}>{label}</Text><Text aria-hidden style={styles.arrow}>→</Text></Pressable>;
}

function statusLabel(state: ScribeState): string { return ({ idle: 'READY', recording: 'LISTENING', stopping: 'PROCESSING AUDIO', stopped: 'RECORDING COMPLETE', error: 'CAPTURE ERROR' })[state]; }
function wordCount(value: string): number { return value.trim() ? value.trim().split(/\s+/).length : 0; }

const mono = Platform.select({ ios: 'Menlo', android: 'monospace', web: 'ui-monospace, SFMono-Regular, Menlo, monospace', default: 'monospace' });
const styles = StyleSheet.create({
  screen: { flex: 1, minHeight: 620, backgroundColor: BLACK, paddingTop: 28, paddingBottom: 24, paddingHorizontal: 32 },
  screenCompact: { paddingTop: 20, paddingBottom: 16, paddingHorizontal: 16 },
  header: { minHeight: 54, flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: BORDER },
  eyebrow: { color: CRIMSON, fontSize: 11, fontWeight: '800', letterSpacing: 2.2 }, privacy: { color: MUTED, fontFamily: mono, fontSize: 9, letterSpacing: 1.1, marginTop: 7 },
  close: { minWidth: 44, minHeight: 44, alignItems: 'flex-end', justifyContent: 'flex-start' }, closeText: { color: MUTED, fontSize: 10, letterSpacing: 1.3 },
  body: { flex: 1, width: '100%', maxWidth: 1120, alignSelf: 'center', paddingVertical: 28, gap: 24 }, bodyCompact: { paddingVertical: 18, gap: 16 },
  visualizerRegion: { minHeight: 220, flex: 1, alignItems: 'center', justifyContent: 'center' }, wave: { minHeight: 104, width: '100%', maxWidth: 620, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 }, bar: { width: 2, minHeight: 4, backgroundColor: CRIMSON },
  status: { color: WHITE, fontSize: 12, fontWeight: '700', letterSpacing: 2, marginTop: 18 }, timerHint: { color: MUTED, fontSize: 11, marginTop: 8 },
  logShell: { minHeight: 190, maxHeight: 280, borderWidth: 1, borderColor: BORDER }, logHeader: { height: 34, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: BORDER }, logTitle: { flex: 1, color: MUTED, fontFamily: mono, fontSize: 9, letterSpacing: 1.2 }, liveDot: { width: 5, height: 5, backgroundColor: CRIMSON, marginRight: 6 }, logState: { color: CRIMSON, fontFamily: mono, fontSize: 9 }, log: { flex: 1 }, logContent: { padding: 16 }, transcript: { color: 'rgba(255,255,255,.8)', fontFamily: mono, fontSize: 14, lineHeight: 23 }, partial: { color: 'rgba(255,255,255,.4)' },
  footer: { minHeight: 60, borderTopWidth: 1, borderTopColor: BORDER, paddingTop: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 12, flexWrap: 'wrap' }, footerCompact: { alignItems: 'stretch' }, transcriptMeta: { color: MUTED, fontFamily: mono, fontSize: 9, letterSpacing: 1, marginRight: 'auto' },
  button: { minHeight: 44, minWidth: 220, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: BORDER, backgroundColor: BLACK }, buttonPrimary: { borderColor: CRIMSON, backgroundColor: CRIMSON }, buttonText: { color: WHITE, fontSize: 10, fontWeight: '800', letterSpacing: 1.4 }, arrow: { color: WHITE, fontSize: 18 }, pressed: { opacity: .74, transform: [{ scale: .96 }] }, disabled: { opacity: .38 }, error: { width: '100%', color: '#ef7777', fontSize: 11 },
  insights: { flex: 1, width: '100%', maxWidth: 820, alignSelf: 'center', borderWidth: 1, borderColor: BORDER, padding: 24 }, insightsContent: { paddingBottom: 8 }, insightTitle: { color: WHITE, fontSize: 30, lineHeight: 37, fontWeight: '600', marginTop: 14, marginBottom: 30 }, sectionLabel: { color: MUTED, fontFamily: mono, fontSize: 9, letterSpacing: 1.6, marginTop: 24, marginBottom: 12 }, summary: { color: 'rgba(255,255,255,.8)', fontSize: 14, lineHeight: 23, maxWidth: 720 }, row: { flexDirection: 'row', gap: 12, paddingVertical: 9 }, marker: { color: CRIMSON }, rowText: { flex: 1, color: 'rgba(255,255,255,.8)', fontSize: 14, lineHeight: 21 }, empty: { color: MUTED, fontSize: 13 }, task: { flexDirection: 'row', gap: 16, paddingVertical: 14, borderTopWidth: 1, borderTopColor: BORDER }, taskIndex: { color: CRIMSON, fontFamily: mono, fontSize: 10 }, taskBody: { flex: 1 }, taskTitle: { color: WHITE, fontSize: 14, lineHeight: 20 }, taskMeta: { color: MUTED, fontSize: 11, marginTop: 5 }, shareNotice: { paddingVertical: 14, marginVertical: 20, borderTopWidth: 1, borderBottomWidth: 1, borderColor: BORDER }, shareNoticeText: { color: MUTED, fontFamily: mono, fontSize: 9, letterSpacing: 1 }, progressLine: { height: 1, width: '42%', marginTop: 24, backgroundColor: CRIMSON },
});
