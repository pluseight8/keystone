import { Text, View } from 'react-native';
import { useMobileLocale } from '../src/i18n';
export default function Browser() { const ru = useMobileLocale() === 'ru'; return <View style={{flex:1,padding:20}}><Text accessibilityRole="header" style={{fontSize:28,fontWeight:'800'}}>{ru ? 'Браузер' : 'Browser'}</Text><Text>{ru ? 'Безопасная автоматизация запускается после двойного подтверждения.' : 'Secure automation opens after double confirmation.'}</Text></View>; }
