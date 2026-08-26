import { Tabs } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, TextInput } from 'react-native';
import { useFonts } from 'expo-font';
import { downloadSecurityPatchInBackground } from '../src/updates';
import { i18n } from '@keystone/core';
import { getMobileSocialGraphRuntime, subscribeMobileSocialGraphRuntime } from '../src/socialGraphRuntime';
import { getMobileMessagingRuntime, subscribeMobileMessagingRuntime } from '../src/socialRuntime';
import { getMobileInboxRuntime, subscribeMobileInboxRuntime } from '../src/inboxRuntime';
import { getMobileSubscriptionsRuntime, subscribeMobileSubscriptionsRuntime } from '../src/subscriptionsRuntime';

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
  const [inboxUnread, setInboxUnread] = useState(0);
  const [subscriptionsUnread, setSubscriptionsUnread] = useState(0);
  useEffect(() => { void downloadSecurityPatchInBackground(); }, []);
  useEffect(() => i18n.subscribe(setLocale), []);
  useEffect(() => { const refresh = () => { const runtime = getMobileSocialGraphRuntime(); if (runtime) void runtime.notifications.unreadCount().then(setUnread); else setUnread(0); const messaging = getMobileMessagingRuntime(); if (messaging) void Promise.all([messaging.messaging.conversations(), messaging.groups?.list() ?? Promise.resolve([])]).then(([direct, groups]) => setChatUnread([...direct, ...groups].reduce((total, value) => total + (value.unreadCount ?? 0), 0))); else setChatUnread(0); const inbox = getMobileInboxRuntime(); if (inbox) void inbox.inbox.list({ view: 'UNREAD', limit: 1 }).then(value => setInboxUnread(value.total)); else setInboxUnread(0); const subscriptions = getMobileSubscriptionsRuntime(); if (subscriptions) void subscriptions.listEntries({ readState: 'UNREAD', limit: 1 }).then(value => setSubscriptionsUnread(value.total)); else setSubscriptionsUnread(0); }; refresh(); const socialUnsubscribe = subscribeMobileSocialGraphRuntime(refresh); const messagingUnsubscribe = subscribeMobileMessagingRuntime(refresh); const inboxUnsubscribe = subscribeMobileInboxRuntime(refresh); const subscriptionsUnsubscribe = subscribeMobileSubscriptionsRuntime(refresh); const timer = setInterval(refresh, 2_000); return () => { socialUnsubscribe(); messagingUnsubscribe(); inboxUnsubscribe(); subscriptionsUnsubscribe(); clearInterval(timer); }; }, []);
  const title = locale === 'ru' ? { overview: 'Главная', following: 'Подписки', explore: 'Поиск', profile: 'Профиль', notifications: 'Уведомления', messages: 'Сообщения', communities: 'Сообщества', spaces: 'Пространства', files: 'Файлы', documents: 'Документы', photos: 'Фотографии', vault: 'Хранилище', graph: 'Граф Vault', canvas: 'Canvas', collaboration: 'Совместная работа', continuity: 'Continuity устройств', calendar: 'Календарь', contacts: 'Контакты', maps: 'Карты', music: 'Музыка', video: 'Видео', shorts: 'Shorts', live: 'Эфир', publication: 'Публикация', calls: 'Звонки', nodes: 'Узлы', pair: 'Связать', browser: 'Браузер', webLibrary: 'Web Library', settings: 'Настройки', safety: 'Безопасность', securityCore: 'Целостность core', secrets: 'Секреты и ключи', ai: 'AI', resources: 'AI-ресурсы', context: 'AI-контекст', contexts: 'Кэши AI-контекстов', automations: 'Автоматизации', memory: 'Память', visits: 'Визиты агентов', agentSocial: 'Социальные агенты', negotiations: 'Переговоры агентов', agentProfiles: 'Профили агентов', agentPresence: 'Присутствие агента', skills: 'Skills', daily: 'Ежедневные заметки', templates: 'Шаблоны', bookmarks: 'Закладки Vault', views: 'Представления Vault', tasks: 'Задачи Vault', sharedVaults: 'Общие Vault' } : { overview: 'Home', following: 'Following', explore: 'Explore', profile: 'Profile', notifications: 'Notifications', messages: 'Messages', communities: 'Communities', spaces: 'Spaces', files: 'Files', documents: 'Documents', photos: 'Photos', vault: 'Vault', graph: 'Vault Graph', canvas: 'Canvas', collaboration: 'Collaboration', continuity: 'Device Continuity', calendar: 'Calendar', contacts: 'Contacts', maps: 'Maps', music: 'Music', video: 'Video', shorts: 'Shorts', live: 'Live', publication: 'Publication', calls: 'Calls', nodes: 'Nodes', pair: 'Pair', browser: 'Browser', webLibrary: 'Web Library', settings: 'Settings', safety: 'Safety', securityCore: 'Build integrity', secrets: 'Secrets & keys', ai: 'AI', resources: 'AI Resources', context: 'AI context', contexts: 'AI context caches', automations: 'Automations', memory: 'Memory', visits: 'Agent visits', agentSocial: 'Agent Social', negotiations: 'Agent Negotiations', agentProfiles: 'Agent Profiles', agentPresence: 'Agent Presence', skills: 'Skills', daily: 'Daily Notes', templates: 'Templates', bookmarks: 'Vault Bookmarks', views: 'Vault Views', tasks: 'Vault Tasks', sharedVaults: 'Shared Vaults' };
  if (!fontsLoaded) return null;
  return <Tabs screenOptions={{ headerShown: false, tabBarHideOnKeyboard: true, animation: 'none', tabBarLabelStyle: rubikStyle }}>
    <Tabs.Screen name="index" options={{ title: title.overview }} />
    <Tabs.Screen name="following" options={{ title: title.following }} />
    <Tabs.Screen name="explore" options={{ title: title.explore }} />
    <Tabs.Screen name="profile" options={{ title: title.profile }} />
    <Tabs.Screen name="notifications" options={{ title: title.notifications, tabBarBadge: unread > 0 ? (unread > 99 ? '99+' : unread) : undefined }} />
    <Tabs.Screen name="inbox" options={{ title: locale === 'ru' ? 'Входящие' : 'Inbox', tabBarBadge: inboxUnread > 0 ? (inboxUnread > 99 ? '99+' : inboxUnread) : undefined }} />
    <Tabs.Screen name="subscriptions" options={{ title: locale === 'ru' ? 'Подписки' : 'Subscriptions', tabBarBadge: subscriptionsUnread > 0 ? (subscriptionsUnread > 99 ? '99+' : subscriptionsUnread) : undefined }} />
    <Tabs.Screen name="messages" options={{ title: title.messages, tabBarBadge: chatUnread > 0 ? (chatUnread > 99 ? '99+' : chatUnread) : undefined }} />
    <Tabs.Screen name="communities" options={{ title: title.communities }} />
    <Tabs.Screen name="spaces" options={{ title: title.spaces }} />
    <Tabs.Screen name="files" options={{ title: title.files }} />
    <Tabs.Screen name="capture" options={{ title: locale === 'ru' ? 'Быстрый захват' : 'Quick Capture' }} />
    <Tabs.Screen name="documents" options={{ title: title.documents }} />
    <Tabs.Screen name="photos" options={{ title: title.photos }} />
    <Tabs.Screen name="vault" options={{ title: title.vault }} />
    <Tabs.Screen name="vault-graph" options={{ title: title.graph }} />
    <Tabs.Screen name="vault-canvas" options={{ title: title.canvas }} />
    <Tabs.Screen name="collaboration" options={{ title: title.collaboration }} />
    <Tabs.Screen name="continuity" options={{ title: title.continuity }} />
    <Tabs.Screen name="nearby" options={{ title: locale === 'ru' ? 'Обмен рядом' : 'Nearby Exchange' }} />
    <Tabs.Screen name="vault-daily" options={{ title: title.daily }} />
    <Tabs.Screen name="vault-templates" options={{ title: title.templates }} />
    <Tabs.Screen name="vault-bookmarks" options={{ title: title.bookmarks }} />
    <Tabs.Screen name="vault-views" options={{ title: title.views }} />
    <Tabs.Screen name="vault-tasks" options={{ href: null, title: title.tasks }} />
    <Tabs.Screen name="shared-vaults" options={{ title: title.sharedVaults }} />
    <Tabs.Screen name="calendar" options={{ title: title.calendar }} />
    <Tabs.Screen name="tasks" options={{ title: locale === 'ru' ? 'Задачи' : 'Tasks' }} />
    <Tabs.Screen name="contacts" options={{ title: title.contacts }} />
    <Tabs.Screen name="maps" options={{ title: title.maps }} />
    <Tabs.Screen name="mail" options={{ title: locale === 'ru' ? 'Внешняя почта' : 'External Email' }} />
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
    <Tabs.Screen name="publication" options={{ title: title.publication }} />
    <Tabs.Screen name="video" options={{ title: title.video }} />
    <Tabs.Screen name="shorts" options={{ title: title.shorts }} />
    <Tabs.Screen name="live" options={{ title: title.live }} />
    <Tabs.Screen name="nodes" options={{ title: title.nodes }} />
    <Tabs.Screen name="pair" options={{ title: title.pair }} />
    <Tabs.Screen name="voice" options={{ href: null }} />
    <Tabs.Screen name="calls" options={{ title: title.calls }} />
    <Tabs.Screen name="browser" options={{ title: title.browser }} />
    <Tabs.Screen name="web-library" options={{ title: title.webLibrary }} />
    <Tabs.Screen name="settings" options={{ title: title.settings }} />
    <Tabs.Screen name="safety" options={{ title: title.safety }} />
    <Tabs.Screen name="security-core" options={{ title: title.securityCore }} />
    <Tabs.Screen name="secrets" options={{ title: title.secrets }} />
    <Tabs.Screen name="ai" options={{ title: title.ai }} />
    <Tabs.Screen name="ai-resources" options={{ title: title.resources }} />
    <Tabs.Screen name="ai-context" options={{ title: title.context }} />
    <Tabs.Screen name="ai-contexts" options={{ title: title.contexts }} />
    <Tabs.Screen name="agents" options={{ href: null }} />
    <Tabs.Screen name="automations" options={{ title: title.automations }} />
    <Tabs.Screen name="memory" options={{ title: title.memory }} />
    <Tabs.Screen name="agent-visits" options={{ title: title.visits }} />
    <Tabs.Screen name="agent-social" options={{ title: title.agentSocial }} />
    <Tabs.Screen name="negotiations" options={{ title: title.negotiations }} />
    <Tabs.Screen name="agent-profiles" options={{ title: title.agentProfiles }} />
    <Tabs.Screen name="agent-presence" options={{ title: title.agentPresence }} />
    <Tabs.Screen name="skills" options={{ title: title.skills }} />
    <Tabs.Screen name="plugins" options={{ title: locale === 'ru' ? 'Плагины' : 'Plugins' }} />
  </Tabs>;
}
