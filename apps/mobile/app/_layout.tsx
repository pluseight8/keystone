import { Tabs } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, TextInput } from 'react-native';
import { useFonts } from 'expo-font';
import { downloadSecurityPatchInBackground } from '../src/updates';
import { i18n } from '@keystone/core';
import { getMobileSocialGraphRuntime, subscribeMobileSocialGraphRuntime } from '../src/socialGraphRuntime';
import { getMobileMessagingRuntime, subscribeMobileMessagingRuntime } from '../src/socialRuntime';

const rubikStyle = { fontFamily: 'Rubik' };
for (const Component of [Text, TextInput]) {
  const target = Component as typeof Component & { defaultProps?: { style?: unknown } };
  target.defaultProps = { ...target.defaultProps, style: [rubikStyle, target.defaultProps?.style] };
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({ Rubik: require('../../../branding/fonts/Rubik/Rubik-VariableFont_wght.ttf') });
  const [locale, setLocale] = useState(i18n.getLocale);
  const [unread, setUnread] = useState(0);
  const [chatUnread, setChatUnread] = useState(0);
  useEffect(() => { void downloadSecurityPatchInBackground(); }, []);
  useEffect(() => i18n.subscribe(setLocale), []);
  useEffect(() => { const refresh = () => { const runtime = getMobileSocialGraphRuntime(); if (runtime) void runtime.notifications.unreadCount().then(setUnread); else setUnread(0); const messaging = getMobileMessagingRuntime(); if (messaging) void Promise.all([messaging.messaging.conversations(), messaging.groups?.list() ?? Promise.resolve([])]).then(([direct, groups]) => setChatUnread([...direct, ...groups].reduce((total, value) => total + (value.unreadCount ?? 0), 0))); else setChatUnread(0); }; refresh(); const socialUnsubscribe = subscribeMobileSocialGraphRuntime(refresh); const messagingUnsubscribe = subscribeMobileMessagingRuntime(refresh); const timer = setInterval(refresh, 2_000); return () => { socialUnsubscribe(); messagingUnsubscribe(); clearInterval(timer); }; }, []);
  const title = locale === 'ru' ? { overview: 'Главная', following: 'Подписки', explore: 'Поиск', profile: 'Профиль', notifications: 'Уведомления', messages: 'Сообщения', communities: 'Сообщества', spaces: 'Пространства', files: 'Файлы', music: 'Музыка', video: 'Видео', shorts: 'Shorts', live: 'Эфир', nodes: 'Узлы', pair: 'Связать', browser: 'Браузер', settings: 'Настройки', ai: 'AI', context: 'AI-контекст', automations: 'Автоматизации', memory: 'Память', visits: 'Визиты агентов', agentSocial: 'Социальные агенты' } : { overview: 'Home', following: 'Following', explore: 'Explore', profile: 'Profile', notifications: 'Notifications', messages: 'Messages', communities: 'Communities', spaces: 'Spaces', files: 'Files', music: 'Music', video: 'Video', shorts: 'Shorts', live: 'Live', nodes: 'Nodes', pair: 'Pair', browser: 'Browser', settings: 'Settings', ai: 'AI', context: 'AI context', automations: 'Automations', memory: 'Memory', visits: 'Agent visits', agentSocial: 'Agent Social' };
  if (!fontsLoaded) return null;
  return <Tabs screenOptions={{ headerShown: false, tabBarHideOnKeyboard: true, animation: 'none', tabBarLabelStyle: rubikStyle }}>
    <Tabs.Screen name="index" options={{ title: title.overview }} />
    <Tabs.Screen name="following" options={{ title: title.following }} />
    <Tabs.Screen name="explore" options={{ title: title.explore }} />
    <Tabs.Screen name="profile" options={{ title: title.profile }} />
    <Tabs.Screen name="notifications" options={{ title: title.notifications, tabBarBadge: unread > 0 ? (unread > 99 ? '99+' : unread) : undefined }} />
    <Tabs.Screen name="messages" options={{ title: title.messages, tabBarBadge: chatUnread > 0 ? (chatUnread > 99 ? '99+' : chatUnread) : undefined }} />
    <Tabs.Screen name="communities" options={{ title: title.communities }} />
    <Tabs.Screen name="spaces" options={{ title: title.spaces }} />
    <Tabs.Screen name="files" options={{ title: title.files }} />
    <Tabs.Screen name="conversation" options={{ href: null }} />
    <Tabs.Screen name="new-chat" options={{ href: null }} />
    <Tabs.Screen name="new-group" options={{ href: null }} />
    <Tabs.Screen name="group-info" options={{ href: null }} />
    <Tabs.Screen name="members" options={{ href: null }} />
    <Tabs.Screen name="media-files" options={{ href: null }} />
    <Tabs.Screen name="community" options={{ href: null }} />
    <Tabs.Screen name="community-channel" options={{ href: null }} />
    <Tabs.Screen name="community-members" options={{ href: null }} />
    <Tabs.Screen name="community-roles" options={{ href: null }} />
    <Tabs.Screen name="community-invites" options={{ href: null }} />
    <Tabs.Screen name="community-moderation" options={{ href: null }} />
    <Tabs.Screen name="community-settings" options={{ href: null }} />
    <Tabs.Screen name="music" options={{ title: title.music }} />
    <Tabs.Screen name="video" options={{ title: title.video }} />
    <Tabs.Screen name="shorts" options={{ title: title.shorts }} />
    <Tabs.Screen name="live" options={{ title: title.live }} />
    <Tabs.Screen name="nodes" options={{ title: title.nodes }} />
    <Tabs.Screen name="pair" options={{ title: title.pair }} />
    <Tabs.Screen name="voice" options={{ href: null }} />
    <Tabs.Screen name="browser" options={{ title: title.browser }} />
    <Tabs.Screen name="settings" options={{ title: title.settings }} />
    <Tabs.Screen name="ai" options={{ title: title.ai }} />
    <Tabs.Screen name="ai-context" options={{ title: title.context }} />
    <Tabs.Screen name="agents" options={{ href: null }} />
    <Tabs.Screen name="automations" options={{ title: title.automations }} />
    <Tabs.Screen name="memory" options={{ title: title.memory }} />
    <Tabs.Screen name="agent-visits" options={{ title: title.visits }} />
    <Tabs.Screen name="agent-social" options={{ title: title.agentSocial }} />
  </Tabs>;
}
