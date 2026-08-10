import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

export type KnowledgeFolderStatus = 'idle' | 'indexing' | 'watching' | 'error';
export interface KnowledgeFolder {
  id: string; path: string; status: KnowledgeFolderStatus;
  indexedFiles: number; totalFiles: number; error?: string;
}
export interface KnowledgeIndexLog { id: string; path: string; timestamp: number; result?: 'indexed' | 'skipped' | 'error'; }

export function KnowledgeSettings({ folders, logs, onAddFolder, onRemoveFolder }: {
  folders: KnowledgeFolder[];
  logs: KnowledgeIndexLog[];
  onAddFolder: () => void | Promise<void>;
  onRemoveFolder?: (id: string) => void;
}) {
  return <View style={s.section}>
    <View style={s.header}><View style={s.heading}><Text style={s.eyebrow}>LOCAL RAG / INDEXES</Text><Text style={s.title}>Knowledge Base &amp; Files</Text><Text style={s.description}>Selected files stay on this device and are vectorized by the local model.</Text></View><Pressable accessibilityRole="button" onPress={onAddFolder} style={({ pressed }) => [s.add, pressed && s.pressed]}><Text style={s.addText}>+ ADD LOCAL FOLDER</Text></Pressable></View>
    <View style={s.list}>
      {folders.length === 0 ? <View style={s.empty}><Text style={s.muted}>NO LOCAL FOLDERS CONNECTED</Text><Text style={s.emptyHelp}>Add a folder to make its documents available to Keystone.</Text></View> : folders.map(folder => <FolderRow key={folder.id} folder={folder} onRemove={onRemoveFolder ? () => onRemoveFolder(folder.id) : undefined}/>)}
    </View>
    <View style={s.terminal}><View style={s.terminalHeader}><Text style={s.terminalTitle}>INDEX LOG</Text><Text style={s.live}>● LOCAL ONLY</Text></View><ScrollView style={s.logScroll} contentContainerStyle={s.logs}>{logs.slice(-12).reverse().map(item => <View key={item.id} style={s.logRow}><Text style={s.timestamp}>{formatTime(item.timestamp)}</Text><Text numberOfLines={1} ellipsizeMode="middle" style={s.path}>{truncatePath(item.path)}</Text><Text style={[s.result, item.result === 'error' && s.error]}>{(item.result ?? 'indexed').toUpperCase()}</Text></View>)}{!logs.length && <Text style={s.muted}>$ waiting for file events_</Text>}</ScrollView></View>
  </View>;
}

function FolderRow({ folder, onRemove }: { folder: KnowledgeFolder; onRemove?: () => void }) {
  const ratio = folder.totalFiles ? Math.min(1, folder.indexedFiles / folder.totalFiles) : 0;
  const label = folder.status === 'indexing' ? `Индексируется: ${folder.indexedFiles}/${folder.totalFiles} файлов` : folder.status === 'watching' ? `${folder.totalFiles} файлов · наблюдение включено` : folder.status === 'error' ? (folder.error ?? 'Ошибка индексации') : 'Ожидает индексации';
  return <View style={s.row}><View style={s.rowTop}><View style={s.folderText}><Text numberOfLines={1} ellipsizeMode="middle" style={s.folderPath}>{folder.path}</Text><Text accessibilityLiveRegion="polite" style={[s.status, folder.status === 'error' && s.error]}>{label}</Text></View>{onRemove && <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${folder.path}`} onPress={onRemove} style={({ pressed }) => [s.remove, pressed && s.pressed]}><Text style={s.removeText}>REMOVE</Text></Pressable>}</View><View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(ratio * 100) }} style={s.progress}><View style={[s.progressFill, { width: `${ratio * 100}%` }]}/></View></View>;
}

function truncatePath(path: string): string { return path.length <= 72 ? path : `…${path.slice(-71)}`; }
function formatTime(value: number): string { return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }

const s = StyleSheet.create({
  section:{width:'100%',maxWidth:920,alignSelf:'center',backgroundColor:'#000000',borderWidth:1,borderColor:'#2a2a2a',padding:20,gap:24},
  header:{flexDirection:'row',alignItems:'flex-start',justifyContent:'space-between',gap:24,flexWrap:'wrap'},heading:{flex:1,minWidth:260,gap:6},eyebrow:{color:'#990000',fontFamily:'monospace',fontSize:10,fontWeight:'800',letterSpacing:1.6},title:{color:'#ffffff',fontSize:24,fontWeight:'800'},description:{color:'#999999',fontSize:13,lineHeight:19,maxWidth:560},
  add:{minHeight:44,paddingHorizontal:16,borderWidth:1,borderColor:'#990000',backgroundColor:'#000000',alignItems:'center',justifyContent:'center'},addText:{color:'#ffffff',fontFamily:'monospace',fontSize:11,fontWeight:'800'},pressed:{opacity:.72,transform:[{scale:.96}]},
  list:{borderWidth:1,borderColor:'#2a2a2a'},empty:{padding:24,gap:6},muted:{color:'#777777',fontFamily:'monospace',fontSize:11},emptyHelp:{color:'#999999',fontSize:12},row:{padding:16,borderBottomWidth:1,borderBottomColor:'#2a2a2a',gap:14},rowTop:{flexDirection:'row',alignItems:'center',gap:12},folderText:{flex:1,gap:5},folderPath:{color:'#ffffff',fontFamily:'monospace',fontSize:13},status:{color:'#999999',fontSize:11},remove:{minHeight:44,paddingHorizontal:10,alignItems:'center',justifyContent:'center'},removeText:{color:'#777777',fontFamily:'monospace',fontSize:10},progress:{height:2,backgroundColor:'#1a1a1a',overflow:'hidden'},progressFill:{height:2,backgroundColor:'#990000'},error:{color:'#ff6666'},
  terminal:{borderWidth:1,borderColor:'#2a2a2a',backgroundColor:'#050505'},terminalHeader:{minHeight:36,paddingHorizontal:12,flexDirection:'row',alignItems:'center',justifyContent:'space-between',borderBottomWidth:1,borderBottomColor:'#2a2a2a'},terminalTitle:{color:'#ffffff',fontFamily:'monospace',fontSize:10,fontWeight:'800',letterSpacing:1.2},live:{color:'#990000',fontFamily:'monospace',fontSize:9},logScroll:{maxHeight:220},logs:{padding:12,gap:8},logRow:{flexDirection:'row',alignItems:'center',gap:10},timestamp:{width:64,color:'#666666',fontFamily:'monospace',fontSize:10},path:{flex:1,color:'#bdbdbd',fontFamily:'monospace',fontSize:10},result:{color:'#777777',fontFamily:'monospace',fontSize:9},
});
