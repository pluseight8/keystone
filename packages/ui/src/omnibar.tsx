import React from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { create, insertMultiple, search, type AnyOrama } from '@orama/orama';

export type OmnibarItemKind = 'node' | 'setting' | 'action';
export interface OmnibarItem {
  id: string;
  kind: OmnibarItemKind;
  title: string;
  subtitle?: string;
  /** Extra phrases such as "mute", "microphone", or a project summary. */
  keywords?: readonly string[];
  onSelect: () => void | Promise<void>;
}
export interface OmnibarProps {
  items: readonly OmnibarItem[];
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  placeholder?: string;
  maxResults?: number;
}

type SearchDocument = { id: string; title: string; subtitle: string; keywords: string };

/** Global, keyboard-first command surface. Mount once near the application root. */
export function Omnibar({ items, open: controlledOpen, onOpenChange, placeholder = 'Search nodes, settings and actions…', maxResults = 9 }: OmnibarProps) {
  const [localOpen, setLocalOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [active, setActive] = React.useState(0);
  const [matches, setMatches] = React.useState<readonly OmnibarItem[]>(items.slice(0, maxResults));
  const input = React.useRef<TextInput>(null);
  const index = React.useRef<AnyOrama>();
  const version = React.useRef(0);
  const isOpen = controlledOpen ?? localOpen;
  const setOpen = React.useCallback((next: boolean) => {
    if (controlledOpen === undefined) setLocalOpen(next);
    onOpenChange?.(next);
    if (!next) { setQuery(''); setActive(0); }
  }, [controlledOpen, onOpenChange]);
  const choose = React.useCallback(async (item: OmnibarItem) => { setOpen(false); await item.onSelect(); }, [setOpen]);

  React.useEffect(() => {
    const database = create({ schema: { id: 'string', title: 'string', subtitle: 'string', keywords: 'string' } });
    index.current = database;
    void insertMultiple(database, items.map<SearchDocument>(item => ({ id: `${item.kind}:${item.id}`, title: item.title, subtitle: item.subtitle ?? '', keywords: item.keywords?.join(' ') ?? '' })));
    setMatches(items.slice(0, maxResults));
  }, [items, maxResults]);

  React.useEffect(() => {
    if (!query.trim() || !index.current) { setMatches(items.slice(0, maxResults)); setActive(0); return; }
    const request = ++version.current;
    void Promise.resolve(search(index.current, { term: query, properties: ['title', 'subtitle', 'keywords'], tolerance: 1, boost: { title: 2.2, keywords: 1.4 }, limit: maxResults }))
      .then(result => { if (request === version.current) { const byId = new Map(items.map(item => [`${item.kind}:${item.id}`, item])); setMatches(result.hits.flatMap(hit => byId.get(hit.id) ?? [])); setActive(0); } });
  }, [items, maxResults, query]);

  React.useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setOpen(!isOpen); return; }
      if (!isOpen) return;
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false); }
      if (event.key === 'ArrowDown') { event.preventDefault(); setActive(value => matches.length ? (value + 1) % matches.length : 0); }
      if (event.key === 'ArrowUp') { event.preventDefault(); setActive(value => matches.length ? (value - 1 + matches.length) % matches.length : 0); }
      if (event.key === 'Enter' && matches[active]) { event.preventDefault(); void choose(matches[active]); }
    };
    if (Platform.OS === 'web') globalThis.addEventListener?.('keydown', keyboard as EventListener);
    return () => globalThis.removeEventListener?.('keydown', keyboard as EventListener);
  }, [active, choose, isOpen, matches, setOpen]);

  React.useEffect(() => { if (isOpen) requestAnimationFrame(() => input.current?.focus()); }, [isOpen]);

  return <Modal visible={isOpen} transparent animationType="fade" onRequestClose={() => setOpen(false)} accessibilityViewIsModal>
    <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
      <Pressable accessibilityRole="menu" accessibilityLabel="Keystone Omnibar" style={styles.palette} onPress={event => event.stopPropagation()}>
        <View style={styles.searchRow}><Text style={styles.prompt}>›</Text><TextInput ref={input} value={query} onChangeText={setQuery} placeholder={placeholder} placeholderTextColor="#666666" accessibilityLabel="Omnibar search" autoCapitalize="none" autoCorrect={false} style={styles.input}/><Text style={styles.shortcut}>{Platform.OS === 'macos' ? '⌘ K' : 'CTRL K'}</Text></View>
        <ScrollView keyboardShouldPersistTaps="always" style={styles.results}>
          {matches.map((item, position) => <Pressable key={`${item.kind}:${item.id}`} accessibilityRole="menuitem" accessibilityState={{ selected: position === active }} onHoverIn={() => setActive(position)} onPress={() => void choose(item)} style={({ pressed }) => [styles.item, position === active && styles.selected, pressed && styles.pressed]}>
            <Text style={styles.glyph}>{GLYPHS[item.kind]}</Text><View style={styles.itemCopy}><Text numberOfLines={1} style={styles.title}>{item.title}</Text>{item.subtitle && <Text numberOfLines={1} style={styles.subtitle}>{item.subtitle}</Text>}</View><Text style={styles.kind}>{item.kind.toUpperCase()}</Text>
          </Pressable>)}
          {!matches.length && <View style={styles.empty}><Text style={styles.emptyText}>NO MATCHES</Text><Text style={styles.emptyHint}>Try a node, command, or setting name.</Text></View>}
        </ScrollView>
        <View style={styles.footer}><Text style={styles.footerText}>↑↓ NAVIGATE</Text><Text style={styles.footerText}>↵ OPEN</Text><Text style={styles.footerText}>ESC CLOSE</Text></View>
      </Pressable>
    </Pressable>
  </Modal>;
}

const GLYPHS: Record<OmnibarItemKind, string> = { node: '◇', setting: '≡', action: '+' };
const styles = StyleSheet.create({
  backdrop:{flex:1,alignItems:'center',justifyContent:'center',padding:20,backgroundColor:'rgba(0,0,0,.74)'},palette:{width:'100%',maxWidth:680,maxHeight:'72%',backgroundColor:'#121212',borderWidth:1,borderColor:'#2a2a2a',shadowColor:'#000000',shadowOpacity:.55,shadowRadius:32,shadowOffset:{width:0,height:18}},searchRow:{minHeight:62,flexDirection:'row',alignItems:'center',paddingHorizontal:16,borderBottomWidth:1,borderBottomColor:'#2a2a2a'},prompt:{color:'#990000',fontFamily:'monospace',fontSize:24,marginRight:10},input:{flex:1,minHeight:60,color:'#ffffff',fontFamily:'monospace',fontSize:16,outlineStyle:'none'} as never,shortcut:{color:'#777777',fontFamily:'monospace',fontSize:9,borderWidth:1,borderColor:'#2a2a2a',paddingHorizontal:7,paddingVertical:4},results:{maxHeight:430,paddingVertical:6},item:{minHeight:56,marginHorizontal:6,paddingHorizontal:12,flexDirection:'row',alignItems:'center',gap:12,borderLeftWidth:2,borderLeftColor:'transparent'},selected:{backgroundColor:'#990000',borderLeftColor:'#d00000'},pressed:{opacity:.72,transform:[{scale:.96}]},glyph:{width:22,color:'#a0a0a0',fontFamily:'monospace',fontSize:17,textAlign:'center'},itemCopy:{flex:1,minWidth:0},title:{color:'#f5f5f5',fontSize:14,fontWeight:'600'},subtitle:{color:'#8c8c8c',fontSize:11,marginTop:3},kind:{color:'#777777',fontFamily:'monospace',fontSize:9,letterSpacing:1},empty:{padding:30,alignItems:'center',gap:6},emptyText:{color:'#777777',fontFamily:'monospace',fontSize:11,letterSpacing:1.2},emptyHint:{color:'#666666',fontSize:12},footer:{minHeight:38,paddingHorizontal:14,flexDirection:'row',alignItems:'center',justifyContent:'flex-end',gap:16,borderTopWidth:1,borderTopColor:'#2a2a2a'},footerText:{color:'#666666',fontFamily:'monospace',fontSize:8,letterSpacing:.7},
});
