import { Tabs } from 'expo-router';
import { ThemeProvider } from '@keystone/ui';
 export default function RootLayout() { return <ThemeProvider><Tabs screenOptions={{ headerShown:false, tabBarHideOnKeyboard:true, animation:'shift' }}><Tabs.Screen name="index" options={{title:'Overview'}}/><Tabs.Screen name="messages" options={{title:'Messages'}}/><Tabs.Screen name="nodes" options={{title:'Nodes'}}/><Tabs.Screen name="pair" options={{title:'Pair'}}/><Tabs.Screen name="browser" options={{title:'Browser'}}/></Tabs></ThemeProvider>; }
