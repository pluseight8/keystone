import { useEffect, useState } from 'react';
import { Button, Text, View } from 'react-native';
import * as Linking from 'expo-linking';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { PermissionChecklist, type PermissionChoice } from '@keystone/ui';

export default function PairScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState<string>();
  const [role, setRole] = useState('friend');
  const [rights, setRights] = useState<PermissionChoice[]>([]);
  useEffect(() => { const handle = (url: string) => { if (url.startsWith('keystone://pair')) setScanned(url); }; Linking.getInitialURL().then(url => url && handle(url)); const sub = Linking.addEventListener('url', e => handle(e.url)); return () => sub.remove(); }, []);
  if (!permission?.granted) return <View style={{ flex:1, alignItems:'center', justifyContent:'center', padding:24, gap:12 }}><Text>Для связывания нужен доступ к камере.</Text><Button title="Разрешить камеру" onPress={requestPermission}/></View>;
  return <View style={{ flex:1, padding:20, gap:16 }}>{!scanned ? <CameraView style={{ flex:1 }} barcodeScannerSettings={{ barcodeTypes:['qr'] }} onBarcodeScanned={e => setScanned(e.data)} /> : <><Text accessibilityRole="header" style={{ fontSize:28, fontWeight:'800' }}>Настройка прав</Text><Text>URI: {scanned}</Text><Text>Роль: {role}</Text><View style={{ flexDirection:'row', gap:8 }}>{['family','friend','trusted_device'].map(x => <Button key={x} title={x} onPress={() => setRole(x)}/>)}</View><PermissionChecklist value={rights} onChange={setRights}/><Button title="Связать узел" onPress={() => {}}/></>}</View>;
}
