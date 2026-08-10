import React from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View, type GestureResponderEvent } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import type { CapsuleCursor } from '@keystone/core';
import { LifeMapCanvas, type LifeMapCanvasProps } from './life-map';

const CRIMSON = '#990000'; const BLACK = '#050505'; const WHITE = '#f4f4f4'; const MUTED = '#8b8b8b';

export interface MultiplayerCursor extends CapsuleCursor {}
export interface CapsuleCanvasProps extends Omit<LifeMapCanvasProps, 'selectedIds' | 'onSelectionChange'> {
  cursors: readonly MultiplayerCursor[];
  localParticipantId: string;
  sharedNodeIds: readonly string[];
  onCursorMove?: (position: { x: number; y: number }) => void;
  onCreateInvitation: (selectedNodeIds: readonly string[]) => string | Promise<string>;
  onArchitect: (goal: string) => void | Promise<void>;
}

/** Multiplayer composition for LifeMapCanvas; presence never enters persisted CRDT state. */
export function CapsuleCanvas({ cursors, localParticipantId, sharedNodeIds, onCursorMove, onCreateInvitation, onArchitect, ...canvasProps }: CapsuleCanvasProps) {
  const [selection, setSelection] = React.useState<string[]>([]); const [shareLink, setShareLink] = React.useState<string>();
  const move = React.useCallback((event: GestureResponderEvent) => { const { locationX: x, locationY: y } = event.nativeEvent; onCursorMove?.({ x, y }); }, [onCursorMove]);
  const share = async () => { const token = await onCreateInvitation(selection); setShareLink(`keystone://capsule/join/${encodeURIComponent(token)}`); };
  return <View style={styles.root} onTouchMove={move}>
    <LifeMapCanvas {...canvasProps} selectedIds={selection} onSelectionChange={setSelection} sharedNodeIds={sharedNodeIds} style={[styles.canvas, canvasProps.style]} />
    <ArchitectPanel onArchitect={onArchitect} />
    <Pressable accessibilityRole="button" accessibilityLabel="Share Capsule" disabled={!selection.length} onPress={() => { void share(); }} style={({ pressed }) => [styles.share, (!selection.length || pressed) && styles.dim]}><Text style={styles.buttonText}>Share Capsule</Text></Pressable>
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>{cursors.filter(cursor => cursor.participantId !== localParticipantId).map(cursor => <RemoteCursor key={cursor.participantId} cursor={cursor} />)}</View>
    <ShareDialog link={shareLink} onClose={() => setShareLink(undefined)} />
  </View>;
}

export function RemoteCursor({ cursor }: { cursor: MultiplayerCursor }) { return <View pointerEvents="none" accessibilityLabel={`${cursor.name} cursor`} style={[styles.cursor, { left: cursor.x, top: cursor.y }]}><View style={styles.triangle} /><Text numberOfLines={1} style={styles.cursorName}>{cursor.name}</Text></View>; }

export function ArchitectPanel({ onArchitect }: { onArchitect: (goal: string) => void | Promise<void> }) {
  const [goal, setGoal] = React.useState(''); const [busy, setBusy] = React.useState(false); const [error, setError] = React.useState<string>();
  const run = async () => { const request = goal.trim(); if (!request || busy) return; setBusy(true); setError(undefined); try { await onArchitect(request); setGoal(''); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Architect failed'); } finally { setBusy(false); } };
  return <View style={styles.architect}><Text style={styles.eyebrow}>AI PROJECT ARCHITECT</Text><TextInput value={goal} onChangeText={setGoal} editable={!busy} placeholder="Опишите глобальную цель…" placeholderTextColor={MUTED} accessibilityLabel="Глобальная цель" onSubmitEditing={() => { void run(); }} style={styles.input} />{busy ? <View accessibilityLabel="AI строит проект" style={styles.skeletonGroup}><View style={[styles.skeleton, { width: '92%' }]} /><View style={[styles.skeleton, { width: '72%' }]} /><View style={[styles.skeleton, { width: '82%' }]} /></View> : <Pressable accessibilityRole="button" disabled={!goal.trim()} onPress={() => { void run(); }} style={({ pressed }) => [styles.architectButton, (!goal.trim() || pressed) && styles.dim]}><Text style={styles.buttonText}>BUILD PROJECT</Text></Pressable>}{error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}</View>;
}

function ShareDialog({ link, onClose }: { link?: string; onClose: () => void }) {
  if (!link) return null; const copy = () => { const clipboard = (globalThis as { navigator?: { clipboard?: { writeText?: (text: string) => Promise<void> } } }).navigator?.clipboard; void clipboard?.writeText?.(link); };
  return <Modal visible transparent animationType="fade" onRequestClose={onClose}><View style={styles.backdrop}><View style={styles.dialog}><View style={styles.dialogHeader}><Text style={styles.title}>CONTEXT CAPSULE</Text><Pressable onPress={onClose} accessibilityLabel="Close"><Text style={styles.close}>×</Text></Pressable></View><View style={styles.qr}><QRCode value={link} size={184} color={BLACK} backgroundColor={WHITE} /></View><Text selectable style={styles.link}>{link}</Text><Pressable accessibilityRole="button" onPress={copy} style={styles.copy}><Text style={styles.buttonText}>COPY LINK</Text></Pressable><Text style={styles.warning}>Only crimson-marked nodes are visible to capsule participants.</Text></View></View></Modal>;
}

const styles = StyleSheet.create({ root: { position: 'relative', backgroundColor: BLACK }, canvas: { borderColor: '#242424', backgroundColor: BLACK }, architect: { position: 'absolute', left: 14, top: 14, width: 280, padding: 14, backgroundColor: '#090909', borderWidth: 1, borderColor: '#272727', gap: 9 }, eyebrow: { color: CRIMSON, fontSize: 10, fontWeight: '800', letterSpacing: 1.7 }, input: { minHeight: 44, paddingHorizontal: 11, color: WHITE, backgroundColor: BLACK, borderWidth: 1, borderColor: '#333' }, architectButton: { minHeight: 38, alignItems: 'center', justifyContent: 'center', backgroundColor: CRIMSON }, buttonText: { color: WHITE, fontWeight: '800', fontSize: 11, letterSpacing: 1 }, skeletonGroup: { gap: 7, paddingVertical: 6 }, skeleton: { height: 9, backgroundColor: '#281010' }, error: { color: '#d15c5c', fontSize: 11 }, share: { position: 'absolute', right: 14, bottom: 72, minHeight: 42, paddingHorizontal: 16, justifyContent: 'center', backgroundColor: CRIMSON, borderWidth: 1, borderColor: CRIMSON }, dim: { opacity: .42 }, cursor: { position: 'absolute', flexDirection: 'row', alignItems: 'flex-start' }, triangle: { width: 0, height: 0, borderTopWidth: 0, borderBottomWidth: 16, borderLeftWidth: 0, borderRightWidth: 11, borderBottomColor: CRIMSON, borderRightColor: 'transparent' }, cursorName: { marginLeft: 3, marginTop: 10, maxWidth: 120, paddingHorizontal: 5, paddingVertical: 2, color: WHITE, backgroundColor: CRIMSON, fontSize: 10, fontWeight: '700' }, backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,.84)', alignItems: 'center', justifyContent: 'center', padding: 20 }, dialog: { width: '100%', maxWidth: 420, padding: 20, gap: 14, backgroundColor: BLACK, borderWidth: 1, borderColor: CRIMSON }, dialogHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, title: { color: WHITE, fontSize: 13, fontWeight: '800', letterSpacing: 1.4 }, close: { color: MUTED, fontSize: 24 }, qr: { alignSelf: 'center', padding: 10, backgroundColor: WHITE }, link: { padding: 10, color: WHITE, backgroundColor: '#101010', borderWidth: 1, borderColor: '#292929', fontSize: 11 }, copy: { minHeight: 42, alignItems: 'center', justifyContent: 'center', backgroundColor: CRIMSON }, warning: { color: MUTED, fontSize: 10 } });
