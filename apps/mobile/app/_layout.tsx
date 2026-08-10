import { Tabs } from 'expo-router';
import { useEffect } from 'react';
import { Text, TextInput } from 'react-native';
import { useFonts } from 'expo-font';
import { downloadSecurityPatchInBackground } from '../src/updates';

const rubikStyle = { fontFamily: 'Rubik' };
for (const Component of [Text, TextInput]) {
  const target = Component as typeof Component & { defaultProps?: { style?: unknown } };
  target.defaultProps = { ...target.defaultProps, style: [rubikStyle, target.defaultProps?.style] };
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({ Rubik: require('../../../branding/fonts/Rubik/Rubik-VariableFont_wght.ttf') });
  useEffect(() => { void downloadSecurityPatchInBackground(); }, []);
  if (!fontsLoaded) return null;
  return <Tabs screenOptions={{ headerShown: false, tabBarHideOnKeyboard: true, animation: 'none', tabBarLabelStyle: rubikStyle }}>
    <Tabs.Screen name="index" options={{ title: 'Overview' }} />
    <Tabs.Screen name="messages" options={{ title: 'Messages' }} />
    <Tabs.Screen name="nodes" options={{ title: 'Nodes' }} />
    <Tabs.Screen name="pair" options={{ title: 'Pair' }} />
    <Tabs.Screen name="voice" options={{ href: null }} />
    <Tabs.Screen name="browser" options={{ title: 'Browser' }} />
  </Tabs>;
}
