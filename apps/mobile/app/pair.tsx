import { useEffect, useState } from 'react';
import { Button, Text, View } from 'react-native';
import * as Linking from 'expo-linking';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { PermissionChecklist, type PermissionChoice } from '@keystone/ui';
import { useMobileLocale } from '../src/i18n';

export default function PairScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState<string>();
  const [role, setRole] = useState('friend');
  const [rights, setRights] = useState<PermissionChoice[]>([]);
  const ru = useMobileLocale() === 'ru';
  const t = ru ? { camera: 'Для связывания нужен доступ к камере.', allow: 'Разрешить камеру', rights: 'Настройка прав', role: 'Роль', pair: 'Связать узел' } : { camera: 'Camera access is required to pair.', allow: 'Allow camera', rights: 'Configure permissions', role: 'Role', pair: 'Pair node' };
  useEffect(() => { const handle = (url: string) => { if (url.startsWith('keystone://pair')) setScanned(url); }; Linking.getInitialURL().then(url => url && handle(url)); const sub = Linking.addEventListener('url', e => handle(e.url)); return () => sub.remove(); }, []);
  if (!permission?.granted) return <View style={{ flex:1, alignItems:'center', justifyContent:'center', padding:24, gap:12 }}><Text>{t.camera}</Text><Button title={t.allow} onPress={requestPermission}/></View>;
  return <View style={{ flex:1, padding:20, gap:16 }}>{!scanned ? <CameraView style={{ flex:1 }} barcodeScannerSettings={{ barcodeTypes:['qr'] }} onBarcodeScanned={e => setScanned(e.data)} /> : <><Text accessibilityRole="header" style={{ fontSize:28, fontWeight:'800' }}>{t.rights}</Text><Text>URI: {scanned}</Text><Text>{t.role}: {role}</Text><View style={{ flexDirection:'row', gap:8 }}>{['family','friend','trusted_device'].map(x => <Button key={x} title={x} onPress={() => setRole(x)}/>)}</View><PermissionChecklist value={rights} onChange={setRights}/><Button title={t.pair} onPress={() => {}}/></>}</View>;
}
