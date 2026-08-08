import React from 'react';
import {
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
} from 'react-native';
import type { ThemeTokens } from '@keystone/theme';
import QRCode from 'react-native-qrcode-svg';
import { KeystoneButton, Label, Surface, useKeystoneTheme } from './index';

/** The canonical public Life Map shape stored in `PersonalEcosystemDocument.lifeMap`. */
export type LifeMapNodeType = 'goal' | 'project' | 'person' | 'decision' | 'file';
export type LifeMapPosition = { x: number; y: number };
export interface LifeMapNode {
  id: string;
  type: LifeMapNodeType;
  title: string;
  summary?: string;
  position: LifeMapPosition;
  /** Only public fields are exported into a capsule. */
  public?: boolean;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}
export interface LifeMapEdge { id: string; source: string; target: string; label?: string; public?: boolean; [key: string]: unknown }
export interface LifeMapData { nodes: LifeMapNode[]; edges: LifeMapEdge[] }

/** Small Y.Map-compatible surface. Y.Map<unknown> satisfies this interface. */
export interface LifeMapBinding {
  get(key: string): unknown;
  set(key: string, value: unknown): unknown;
  delete?(key: string): unknown;
  forEach?(callback: (value: unknown, key: string) => void): void;
  observe?(listener: (...args: any[]) => void): void;
  unobserve?(listener: (...args: any[]) => void): void;
  observeDeep?(listener: (...args: any[]) => void): void;
  unobserveDeep?(listener: (...args: any[]) => void): void;
}
export type LifeMapCrdtSource = LifeMapBinding | { lifeMap: LifeMapBinding; notes?: LifeMapBinding; contextCapsules?: LifeMapBinding };

function mapFrom(source?: LifeMapCrdtSource): LifeMapBinding | undefined {
  if (!source) return undefined;
  return 'lifeMap' in source ? source.lifeMap : source;
}
function readData(source?: LifeMapCrdtSource, fallback: LifeMapData = { nodes: [], edges: [] }): LifeMapData {
  const map = mapFrom(source);
  if (!map) return fallback;
  const nodes = map.get('nodes');
  const edges = map.get('edges');
  return {
    nodes: readCollection<LifeMapNode>(nodes) ?? fallback.nodes,
    edges: readCollection<LifeMapEdge>(edges) ?? fallback.edges,
  };
}
function readCollection<T>(value: unknown): T[] | undefined {
  if (Array.isArray(value)) return value as T[];
  if (!value || typeof value !== 'object' || !('forEach' in value)) return undefined;
  const items: T[] = [];
  (value as LifeMapBinding).forEach?.(item => items.push(item as T));
  return items;
}
function writeCollection<T extends { id: string }>(value: unknown, items: T[]): boolean {
  if (!value || typeof value !== 'object' || !('set' in value) || !('forEach' in value)) return false;
  const collection = value as LifeMapBinding;
  const live = new Set(items.map(item => item.id));
  collection.forEach?.((_item, id) => { if (!live.has(id)) collection.delete?.(id); });
  items.forEach(item => collection.set(item.id, item));
  return true;
}
function writeData(source: LifeMapCrdtSource | undefined, data: LifeMapData): void {
  const map = mapFrom(source);
  if (!map) return;
  if (!writeCollection(map.get('nodes'), data.nodes)) map.set('nodes', data.nodes);
  if (!writeCollection(map.get('edges'), data.edges)) map.set('edges', data.edges);
}
function readNotes(source?: LifeMapCrdtSource): Array<Record<string, unknown>> {
  if (!source || !('lifeMap' in source)) return [];
  const notesMap = source.notes;
  if (!notesMap?.forEach) return [];
  const notes: Array<Record<string, unknown>> = [];
  notesMap.forEach(value => {
    if (value && typeof value === 'object') notes.push(value as Record<string, unknown>);
  });
  return notes;
}
function writeCapsule(source: LifeMapCrdtSource | undefined, manifest: CapsuleManifest): void {
  if (!source || !('lifeMap' in source) || !source.contextCapsules) return;
  source.contextCapsules.set(manifest.id, manifest);
}

const PRIVATE_KEYS = /^(private|secret|token|password|credential|owner|acl|device|internal|createdBy|updatedBy)/i;
function publicFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(publicFields);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !PRIVATE_KEYS.test(key) && key !== 'metadata')
    .map(([key, child]) => [key, publicFields(child)]));
}
function capsuleId(data: LifeMapData): string {
  const text = JSON.stringify(data);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return `cap-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
export interface CapsuleManifest {
  schema: 'keystone.capsule.v1'; id: string; createdAt: string;
  nodes: LifeMapNode[]; edges: LifeMapEdge[]; notes: Array<Record<string, unknown>>;
}
export function createCapsuleManifest(data: LifeMapData, selectedIds: readonly string[], notes: readonly Record<string, unknown>[] = [], now = new Date()): CapsuleManifest {
  const selected = new Set(selectedIds);
  const nodes = data.nodes.filter(node => selected.has(node.id) && node.public !== false).map(node => publicFields(node) as LifeMapNode);
  const edges = data.edges.filter(edge => selected.has(edge.source) && selected.has(edge.target) && edge.public !== false).map(edge => publicFields(edge) as LifeMapEdge);
  const selectedNotes = notes.filter(note => selected.has(String(note.nodeId ?? note.node ?? '')) && note.public !== false).map(note => publicFields(note) as Record<string, unknown>);
  const payload = { nodes, edges, notes: selectedNotes };
  return { schema: 'keystone.capsule.v1', id: capsuleId(payload), createdAt: now.toISOString(), ...payload };
}
export function capsuleLink(manifest: Pick<CapsuleManifest, 'id'>): string { return `keystone://capsule?id=${encodeURIComponent(manifest.id)}`; }

const NODE_COLORS: Record<LifeMapNodeType, { bg: string; accent: string; glyph: string }> = {
  goal: { bg: '#f5e8d8', accent: '#bd7c32', glyph: '◎' }, project: { bg: '#dcecf3', accent: '#287e9b', glyph: '◆' },
  person: { bg: '#e7ddf2', accent: '#765d92', glyph: '●' }, decision: { bg: '#f4dfdf', accent: '#af5d65', glyph: '◇' }, file: { bg: '#dcecdf', accent: '#4f875e', glyph: '▤' },
};
const nodeSize = { width: 190, height: 92 };

export interface LifeMapCanvasProps { data?: LifeMapData; notes?: readonly Record<string, unknown>[]; onChange?: (data: LifeMapData) => void; crdt?: LifeMapCrdtSource; selectedIds?: string[]; onSelectionChange?: (ids: string[]) => void; onPack?: (manifest: CapsuleManifest) => void; analyze?: (data: LifeMapData) => AIInsight[] | Promise<AIInsight[]>; onContextAction?: (action: 'summary' | 'similar', node: LifeMapNode) => void; style?: React.ComponentProps<typeof View>['style'] }
export function LifeMapCanvas({ data: controlledData, notes: suppliedNotes, onChange, crdt, selectedIds: controlledSelection, onSelectionChange, onPack, analyze = generateInsights, onContextAction, style }: LifeMapCanvasProps) {
  const theme = useKeystoneTheme();
  const notes = suppliedNotes ?? readNotes(crdt);
  const [data, setData] = React.useState<LifeMapData>(() => readData(crdt, controlledData));
  const [selection, setSelection] = React.useState<string[]>(controlledSelection ?? []);
  const [multiSelect, setMultiSelect] = React.useState(false);
  const [menu, setMenu] = React.useState<{ node: LifeMapNode; x: number; y: number }>();
  const [connectFrom, setConnectFrom] = React.useState<string>();
  const [insights, setInsights] = React.useState<AIInsight[]>([]);
  const update = React.useCallback((next: LifeMapData) => { setData(next); writeData(crdt, next); onChange?.(next); }, [crdt, onChange]);
  React.useEffect(() => { if (!controlledData) return; setData(controlledData); }, [controlledData]);
  React.useEffect(() => { if (controlledSelection) setSelection(controlledSelection); }, [controlledSelection]);
  React.useEffect(() => {
    const map = mapFrom(crdt); if (!map) return undefined;
    const notesMap = crdt && 'lifeMap' in crdt ? crdt.notes : undefined;
    const candidates: Array<LifeMapBinding | undefined> = [map, notesMap];
    const observed = candidates.filter((value, index, all): value is LifeMapBinding => Boolean(value) && all.indexOf(value) === index);
    const listener = () => setData(readData(crdt));
    const deep = observed.filter(value => value.observeDeep);
    const shallow = observed.filter(value => !value.observeDeep && value.observe);
    // Nested Y.Maps contain the actual node records. Deep observation is what
    // makes a remote drag (or an edge edit) repaint this canvas immediately.
    deep.forEach(value => value.observeDeep?.(listener));
    shallow.forEach(value => value.observe?.(listener));
    return () => {
      deep.forEach(value => value.unobserveDeep?.(listener));
      shallow.forEach(value => value.unobserve?.(listener));
    };
  }, [crdt]);
  const select = (id: string, additive: boolean) => { const next = additive ? (selection.includes(id) ? selection.filter(item => item !== id) : [...selection, id]) : [id]; setSelection(next); onSelectionChange?.(next); };
  const moveNode = (id: string, position: LifeMapPosition) => update({ ...data, nodes: data.nodes.map(node => node.id === id ? { ...node, position } : node) });
  const addEdge = (target: string) => { if (!connectFrom || connectFrom === target) { setConnectFrom(undefined); return; } const id = `${connectFrom}-${target}`; if (!data.edges.some(edge => edge.source === connectFrom && edge.target === target)) update({ ...data, edges: [...data.edges, { id, source: connectFrom, target, public: true }] }); setConnectFrom(undefined); };
  const pack = () => { if (!selection.length) return; const manifest = createCapsuleManifest(data, selection, notes); writeCapsule(crdt, manifest); onPack?.(manifest); };
  return <View style={[styles.canvas, { backgroundColor: theme.colors.background }, style]} accessibilityLabel="Life Map canvas">
    <View pointerEvents="none" style={StyleSheet.absoluteFill}><EdgeLayer data={data} theme={theme} /></View>
    {data.nodes.map(node => <DraggableNode key={node.id} node={node} selected={selection.includes(node.id)} highlighted={insights.some(insight => insight.nodeIds.includes(node.id))} connecting={connectFrom === node.id} theme={theme} onMove={moveNode} onPress={(event) => { if (connectFrom) addEdge(node.id); else { const nativeEvent = event.nativeEvent as GestureResponderEvent['nativeEvent'] & { shiftKey?: boolean }; select(node.id, Boolean(nativeEvent.shiftKey) || multiSelect); } }} onLongPress={(x, y) => setMenu({ node, x, y })} />)}
    <View style={styles.canvasToolbar}><View style={styles.toolbarGroup}><Text style={{ color: theme.colors.muted, fontSize: 12 }}>{selection.length ? `${selection.length} выбрано` : 'Выберите узлы карты'}</Text><Pressable accessibilityRole="checkbox" accessibilityState={{ checked: multiSelect }} onPress={() => setMultiSelect(value => !value)} style={[styles.multiSelectToggle, multiSelect && { backgroundColor: theme.colors.accent }]}><Text style={{ color: multiSelect ? '#fff' : theme.colors.muted, fontSize: 12 }}>Мультивыбор</Text></Pressable></View><KeystoneButton onPress={pack} disabled={!selection.length}>Упаковать в Context Capsule</KeystoneButton></View>
    <AIInsightsPanel insights={insights} onAnalyze={async () => setInsights(await analyze(data))} onInsightPress={(id) => select(id, false)} />
    {connectFrom && <Pressable style={styles.connectHint} onPress={() => setConnectFrom(undefined)}><Text style={{ color: theme.colors.text }}>Выберите второй узел для связи · Отмена</Text></Pressable>}
    {menu && <NodeContextMenu menu={menu} theme={theme} onClose={() => setMenu(undefined)} onConnect={() => { setConnectFrom(menu.node.id); setMenu(undefined); }} onAction={(action) => { onContextAction?.(action, menu.node); setMenu(undefined); }} />}
  </View>;
}

function EdgeLayer({ data, theme }: { data: LifeMapData; theme: ThemeTokens }) { return <View style={StyleSheet.absoluteFill}>{data.edges.map(edge => { const source = data.nodes.find(node => node.id === edge.source); const target = data.nodes.find(node => node.id === edge.target); if (!source || !target) return null; const x1 = source.position.x + nodeSize.width / 2; const y1 = source.position.y + nodeSize.height / 2; const dx = target.position.x + nodeSize.width / 2 - x1; const dy = target.position.y + nodeSize.height / 2 - y1; const length = Math.sqrt(dx * dx + dy * dy); const angle = `${Math.atan2(dy, dx)}rad`; return <View key={edge.id} pointerEvents="none" style={{ position: 'absolute', left: x1, top: y1, width: Math.max(1, length), height: 2, backgroundColor: theme.colors.border, transform: [{ rotate: angle }], transformOrigin: 'left center' } as never} />; })}</View>; }

function DraggableNode({ node, selected, highlighted, connecting, theme, onMove, onPress, onLongPress }: { node: LifeMapNode; selected: boolean; highlighted: boolean; connecting: boolean; theme: ThemeTokens; onMove: (id: string, position: LifeMapPosition) => void; onPress: (event: GestureResponderEvent) => void; onLongPress: (x: number, y: number) => void }) {
  const start = React.useRef(node.position); const color = NODE_COLORS[node.type];
  const responder = React.useMemo(() => PanResponder.create({ onStartShouldSetPanResponder: () => false, onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) + Math.abs(gesture.dy) > 4, onPanResponderGrant: () => { start.current = node.position; }, onPanResponderMove: (_, gesture) => onMove(node.id, { x: Math.max(8, start.current.x + gesture.dx), y: Math.max(56, start.current.y + gesture.dy) }), onPanResponderRelease: () => undefined }), [node.id, node.position, onMove]);
  return <Pressable {...responder.panHandlers} onPress={onPress} onLongPress={(event) => onLongPress(event.nativeEvent.pageX, event.nativeEvent.pageY)} delayLongPress={480} accessibilityRole="button" accessibilityLabel={`${node.type}: ${node.title}`} style={[styles.node, { left: node.position.x, top: node.position.y, backgroundColor: theme.colors.surface, borderColor: selected || connecting || highlighted ? color.accent : theme.colors.border, shadowColor: color.accent }, highlighted && styles.highlightedNode, selected && styles.selectedNode]}>
    <View style={[styles.nodeGlyph, { backgroundColor: color.bg }]}><Text style={{ color: color.accent, fontWeight: '700' }}>{color.glyph}</Text></View><View style={{ flex: 1 }}><Text numberOfLines={1} style={{ color: theme.colors.text, fontWeight: '700', fontSize: 13 }}>{node.title}</Text><Text numberOfLines={2} style={{ color: theme.colors.muted, fontSize: 11, marginTop: 3 }}>{node.summary ?? node.type}</Text></View>
  </Pressable>;
}

export interface AIInsight { id: string; text: string; nodeIds: string[]; kind: 'connection' | 'stale' | 'document' }
export function generateInsights(data: LifeMapData): AIInsight[] { const people = data.nodes.filter(node => node.type === 'person'); const projects = data.nodes.filter(node => node.type === 'project' || node.type === 'goal'); const result: AIInsight[] = []; if (people[0] && projects[0] && !data.edges.some(edge => edge.source === people[0].id && edge.target === projects[0].id)) result.push({ id: 'person-project', kind: 'connection', nodeIds: [people[0].id, projects[0].id], text: `${people[0].title} может быть связан с задачей «${projects[0].title}»` }); const stale = data.nodes.find(node => /отлож|later|stale/i.test(String(node.summary))); if (stale) result.push({ id: 'stale', kind: 'stale', nodeIds: [stale.id], text: `«${stale.title}» давно не обновлялся — вернуть в фокус?` }); if (!result.length && data.nodes.length) result.push({ id: 'explore', kind: 'document', nodeIds: [data.nodes[0].id], text: 'Локальная модель готова найти похожие документы для этой области' }); return result; }
export function AIInsightsPanel({ insights, onAnalyze, onInsightPress }: { insights: AIInsight[]; onAnalyze: () => void | Promise<void>; onInsightPress: (nodeId: string) => void }) { const theme = useKeystoneTheme(); const [busy, setBusy] = React.useState(false); const run = async () => { setBusy(true); try { await onAnalyze(); } finally { setBusy(false); } }; return <Surface style={styles.insights}><View style={styles.rowBetween}><Label>AI Insights</Label><Pressable disabled={busy} onPress={() => { void run(); }}><Text style={{ color: theme.colors.accent, fontSize: 12 }}>{busy ? 'Анализ…' : 'Анализировать'}</Text></Pressable></View>{insights.length ? insights.map(insight => <Pressable key={insight.id} onPress={() => onInsightPress(insight.nodeIds[0])} style={styles.insightRow}><Text style={{ color: theme.colors.accent }}>✦</Text><Text style={{ color: theme.colors.text, fontSize: 12, flex: 1 }}>{insight.text}</Text></Pressable>) : <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 8 }}>Связи анализируются локально на этом устройстве.</Text>}</Surface>; }

function NodeContextMenu({ menu, theme, onClose, onConnect, onAction }: { menu: { node: LifeMapNode; x: number; y: number }; theme: ThemeTokens; onClose: () => void; onConnect: () => void; onAction: (action: 'summary' | 'similar') => void }) { return <Modal transparent visible animationType="fade" onRequestClose={onClose}><Pressable style={styles.menuBackdrop} onPress={onClose}><Surface style={[styles.contextMenu, { left: Math.min(menu.x, 280), top: Math.min(menu.y, 420) }]}><Label>{menu.node.title}</Label><Pressable style={styles.menuItem} onPress={() => onAction('summary')}><Text style={{ color: theme.colors.text }}>Создать summary</Text></Pressable><Pressable style={styles.menuItem} onPress={() => onAction('similar')}><Text style={{ color: theme.colors.text }}>Найти похожие документы</Text></Pressable><Pressable style={styles.menuItem} onPress={onConnect}><Text style={{ color: theme.colors.accent }}>Создать связь</Text></Pressable></Surface></Pressable></Modal>; }

export function CapsuleShareDialog({ manifest, visible, onClose, onCopyLink }: { manifest?: CapsuleManifest; visible: boolean; onClose: () => void; onCopyLink?: (link: string) => void | Promise<void> }) { const theme = useKeystoneTheme(); const [copied, setCopied] = React.useState(false); React.useEffect(() => { setCopied(false); }, [manifest?.id]); if (!manifest) return null; const link = capsuleLink(manifest); return <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}><View style={styles.modalBackdrop}><Surface style={styles.dialog}><View style={styles.rowBetween}><Label>Context Capsule</Label><Pressable onPress={onClose} accessibilityLabel="Закрыть"><Text style={{ color: theme.colors.muted, fontSize: 22 }}>×</Text></Pressable></View><Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 4 }}>{manifest.nodes.length} узлов · публичный слепок без приватных метаданных</Text><View accessibilityLabel="QR-код Context Capsule" style={styles.qr}><QRCode value={link} size={176} color={theme.colors.text} backgroundColor="#fff" /></View><Text selectable style={{ color: theme.colors.text, fontSize: 12, padding: 10, backgroundColor: theme.colors.background, borderRadius: theme.radii.sm }}>{link}</Text><KeystoneButton onPress={() => { setCopied(true); void onCopyLink?.(link); const clipboard = (globalThis as { navigator?: { clipboard?: { writeText?: (text: string) => Promise<void> } } }).navigator?.clipboard; void clipboard?.writeText?.(link); }}>{copied ? 'Скопировано' : 'Копировать Keystone Link'}</KeystoneButton></Surface></View></Modal>; }

const styles = StyleSheet.create({ canvas: { minHeight: 560, overflow: 'hidden', borderRadius: 16, borderWidth: 1 }, node: { position: 'absolute', width: nodeSize.width, height: nodeSize.height, borderWidth: 1, borderRadius: 14, padding: 12, flexDirection: 'row', gap: 9, shadowOpacity: .12, shadowRadius: 10, shadowOffset: { width: 2, height: 4 }, elevation: 3 }, highlightedNode: { shadowOpacity: .28, shadowRadius: 18 }, selectedNode: { borderWidth: 2 }, nodeGlyph: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' }, canvasToolbar: { position: 'absolute', left: 14, right: 14, bottom: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }, toolbarGroup: { flexDirection: 'row', alignItems: 'center', gap: 8 }, multiSelectToggle: { minHeight: 36, justifyContent: 'center', paddingHorizontal: 10, borderRadius: 9, borderWidth: 1, borderColor: 'rgba(127,127,127,.3)' }, insights: { position: 'absolute', right: 14, top: 14, width: 270, padding: 14, gap: 8 }, rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }, insightRow: { flexDirection: 'row', gap: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: 'rgba(127,127,127,.15)' }, connectHint: { position: 'absolute', top: 14, left: 14, padding: 9, borderRadius: 9, backgroundColor: 'rgba(255,255,255,.9)' }, menuBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,.12)' }, contextMenu: { position: 'absolute', width: 250, padding: 12, gap: 2 }, menuItem: { minHeight: 42, justifyContent: 'center', paddingHorizontal: 4 }, modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,.42)', justifyContent: 'center', alignItems: 'center', padding: 20 }, dialog: { width: '100%', maxWidth: 420, padding: 20, gap: 12 }, qr: { width: 192, height: 192, padding: 8, alignSelf: 'center', alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' }, });

export type LifeMapStorageSchema = { lifeMap: { nodes: Record<string, LifeMapNode>; edges: Record<string, LifeMapEdge> }; notes: Record<string, Record<string, unknown>>; contextCapsules: Record<string, CapsuleManifest> };
export const LIFE_MAP_SCHEMA = { schema: 'keystone.life-map.v1', yjs: { lifeMap: 'Y.Map', nodes: 'Y.Map<LifeMapNode>', edges: 'Y.Map<LifeMapEdge>', notes: 'Y.Map', contextCapsules: 'Y.Map<CapsuleManifest>', aiChat: 'Y.Array' } } as const;
