import React from 'react';
import {
  ActivityBarItem,
  ContextProviderRegistry,
  DesktopShellController,
  DesktopTab,
  KeystoneObjectReference,
  PaneNode,
  ShellCommand,
  createDefaultContextRegistry,
  defaultShellCommands,
  isPrimaryModifier,
  objectTitle,
  resolveOmniboxInput,
} from './desktop-shell-model';
import './desktop-shell.css';
import './desktop-shell-overrides.css';
import { getDesktopCalendarRuntime, subscribeDesktopCalendarRuntime, type DesktopCalendarEvent, type DesktopCalendarRuntime } from './desktop-calendar-runtime';
import { getDesktopVaultRuntime, subscribeDesktopVaultRuntime, type DesktopVaultCanvasDocument, type DesktopVaultGraphProjection, type DesktopVaultNote, type DesktopVaultRuntime } from './desktop-vault-runtime';
import { getDesktopSkillRuntime, subscribeDesktopSkillRuntime, type DesktopSkillRuntime } from './desktop-skill-runtime';
import { getDesktopSafetyRuntime, subscribeDesktopSafetyRuntime, type DesktopSafetyRuntime } from './desktop-safety-runtime';
import { getDesktopIntegrityRuntime, subscribeDesktopIntegrityRuntime, type DesktopIntegrityRuntime } from './desktop-integrity-runtime';
import { getDesktopDailyRuntime, subscribeDesktopDailyRuntime, type DesktopDailyBrief, type DesktopDailyItem, type DesktopDailyRuntime } from './desktop-daily-runtime';
import { getDesktopCallsRuntime, subscribeDesktopCallsRuntime, type DesktopCallsRuntime } from './desktop-calls-runtime';
import { getDesktopPublicationRuntime, subscribeDesktopPublicationRuntime, type DesktopPublicationRuntime, type DesktopPublicationState, type DesktopPublicationVisibility } from './desktop-publication-runtime';
import { getDesktopCollaborationRuntime, subscribeDesktopCollaborationRuntime, type DesktopCollaborationRuntime } from './desktop-collaboration-runtime';
import { getDesktopMapsRuntime, subscribeDesktopMapsRuntime, type DesktopMapPlace, type DesktopMapRender, type DesktopMapRoute, type DesktopMapsRuntime, type DesktopMapsSurfaceState } from './desktop-maps-runtime';
import { getDesktopMailRuntime, subscribeDesktopMailRuntime, type DesktopMailAccount, type DesktopMailAddress, type DesktopMailDraft, type DesktopMailFolder, type DesktopMailMessage, type DesktopMailOutboxEntry, type DesktopMailRuntime } from './desktop-mail-runtime';
import { getDesktopContinuityRuntime, subscribeDesktopContinuityRuntime, type DesktopContinuityDevice, type DesktopContinuityItem, type DesktopContinuityObjectType, type DesktopContinuityRuntime } from './desktop-continuity-runtime';
import { getDesktopNearbyExchangeRuntime, subscribeDesktopNearbyExchangeRuntime, type DesktopNearbyEndpoint, type DesktopNearbyExchangeRuntime, type DesktopNearbyOffer, type DesktopNearbyTransfer } from './desktop-nearby-exchange-runtime';
import { getDesktopPhotosRuntime, subscribeDesktopPhotosRuntime, type DesktopPhotoAlbum, type DesktopPhotoAsset, type DesktopPhotosRuntime } from './desktop-photos-runtime';
import { getDesktopWebLibraryRuntime, subscribeDesktopWebLibraryRuntime, type DesktopWebLibraryEntry, type DesktopWebLibraryReader, type DesktopWebLibraryRuntime } from './desktop-web-library-runtime';
import { getDesktopSubscriptionsRuntime, subscribeDesktopSubscriptionsRuntime, type DesktopSubscriptionEntry, type DesktopSubscriptionReader, type DesktopSubscriptionsRuntime } from './desktop-subscriptions-runtime';
import { getDesktopTasksRuntime, subscribeDesktopTasksRuntime, type DesktopTask, type DesktopTaskRuntime } from './desktop-tasks-runtime';
import { getDesktopContactsRuntime, subscribeDesktopContactsRuntime, type DesktopContact, type DesktopContactsRuntime } from './desktop-contacts-runtime';
import { getDesktopInboxRuntime, subscribeDesktopInboxRuntime, type DesktopInboxRuntime } from './desktop-inbox-runtime';
import { getDesktopFilesRuntime, subscribeDesktopFilesRuntime, type DesktopFileFolder, type DesktopFileProjection, type DesktopFilesRuntime } from './desktop-files-runtime';
import { getDesktopDocumentsRuntime, subscribeDesktopDocumentsRuntime, type DesktopDocumentsRuntime } from './desktop-documents-runtime';
import { getDesktopCaptureRuntime, subscribeDesktopCaptureRuntime, type DesktopCaptureRuntime } from './desktop-capture-runtime';
import type { CaptureDestinationKind } from '@keystone/core';

type Locale = 'en' | 'ru';

const copy = {
  en: {
    capture: 'Quick Capture', captureHint: 'Save text, links, files and references to your private tray.', capturePlaceholder: 'Paste text or an https:// URL…', captureClipboard: 'Capture clipboard once', captureBrowser: 'Capture current page', captureSelection: 'Capture selection', captureDrop: 'Drop a file or folder here', captureTray: 'Private Capture Tray', captureNoRuntime: 'Capture host is unavailable; text input still works locally.', captureNoItems: 'Nothing captured yet.', captureRoute: 'Route', captureDismiss: 'Dismiss', captureRestore: 'Restore', capturePreview: 'Preview destination', captureConfirm: 'Confirm route', captureSource: 'Source', captureState: 'State', captureSuggestions: 'Suggestions', captureUnsafe: 'Only safe HTTP(S) links and typed references are accepted.',
    inbox: 'Inbox',
    subscriptions: 'Subscriptions',
    nearby: 'Nearby Exchange',
    nearbyTitle: 'Nearby Exchange', nearbyBoundary: 'Anonymous one-hop discovery. The native/core adapter owns E2E protection, Fabric routing and bounded transfer state.', nearbyUnavailable: 'Nearby Exchange host is not connected.', nearbyReceive: 'Receive nearby', nearbyStop: 'Stop receiving', nearbyQr: 'Show Receive QR', nearbyRefresh: 'Refresh nearby', nearbyNoEndpoints: 'No anonymous nearby endpoints are visible.', nearbyOffers: 'Incoming offers', nearbyNoOffers: 'No offers awaiting consent.', nearbyAccept: 'Accept', nearbyReject: 'Reject', nearbyCancel: 'Cancel', nearbyResume: 'Resume', nearbyDisclosure: 'Identity is anonymous until you explicitly choose fields to disclose.', nearbyAddContact: 'Add Contact after disclosure', nearbyAnonymity: 'No GPS, RSSI distance, encounter history or automatic contact creation.', nearbyReceived: 'Received', nearbyShareQr: 'Receive QR is short-lived and scoped to Nearby Exchange only.',
    home: 'Home', search: 'Search', agent: 'Agent Bot', askAgent: 'Ask Agent Bot…', messages: 'Messages', spaces: 'Spaces', vault: 'Vault', calendar: 'Calendar', contacts: 'Contacts', maps: 'Maps', files: 'Files', documents: 'Documents', media: 'Media', photos: 'Photos', calls: 'Calls', workboard: 'Workboard', webLibrary: 'Web Library', webLibraryDescription: 'Saved pages, Read Later and immutable offline revisions. External origins are never used by the reader.', collaboration: 'Collaboration', continuity: 'Continuity', plugins: 'Plugins', settings: 'Settings', localeUnavailable: 'Calls are not configured on this host.', callBoundary: 'The native host must provide authenticated signaling and a WebRTC media adapter. Calls never record automatically.', callMediaReady: 'media adapter ready', callMediaUnavailable: 'media adapter unavailable', noActiveCall: 'No active call.', callHistory: 'Call history', acceptCall: 'Accept', rejectCall: 'Reject', mute: 'Mute', unmute: 'Unmute', cameraOn: 'Enable camera', cameraOff: 'Disable camera', screenOn: 'Share screen', screenOff: 'Stop screen share', endCall: 'End call',
    back: 'Back', forward: 'Forward', omnibox: 'Search objects, commands, links, or ask Agent Bot…', command: 'Command palette', new: 'New', workspace: 'Workspace', context: 'Context', agentScope: 'Current object scope', ask: 'Ask Agent Bot', close: 'Close', duplicate: 'Duplicate', pin: 'Pin tab', unpin: 'Unpin tab', splitHorizontal: 'Split horizontally', splitVertical: 'Split vertically', restore: 'Reopen closed tab', customize: 'Customize activity bar', hide: 'Hide', show: 'Show', moveUp: 'Move up', moveDown: 'Move down', empty: 'Open an object to begin', open: 'Open', openInTab: 'Open in new tab', local: 'Local-first', privacy: 'Private context stays on this device', placeholder: 'Placeholder / host adapter', placeholderBody: 'This surface is ready for the existing Keystone subsystem. No business logic is invented in the shell.', references: 'Typed references', drop: 'Drop a reference here', related: 'Related objects', properties: 'Properties', links: 'Links', activity: 'Activity', searchHint: 'Search is local and permission-aware.', agentHint: 'Only the active object is in scope. Keystone does not send the whole workspace automatically.', send: 'Run locally', noObject: 'No object selected', browserPrivacy: 'Browser pages do not receive Keystone private context automatically.', currentWorkspace: 'Current workspace', newWorkspace: 'New workspace', rename: 'Rename', delete: 'Delete', switcher: 'Switch workspace', done: 'Done', reset: 'Reset', add: 'Add', objectId: 'Object ID', commandHint: 'Type to filter commands…', noCommands: 'No matching commands', quickActions: 'Quick actions', message: 'Message', group: 'Group', space: 'Space', note: 'Note', canvas: 'Canvas', event: 'Calendar event', task: 'Task', file: 'File', community: 'Community', saved: 'Saved locally', mode: 'Balanced', status: 'Ready', locked: 'Permission required', openBob: 'Open Bob profile', openChat: 'Open chat', openFile: 'Open trip file', openSpace: 'Open Trip space', askAbout: 'Ask about this object', configure: 'Configure', language: 'Language', english: 'English', russian: 'Русский', extensionSlot: 'Extension slot — no plugin runs without permission', needsUser: 'Needs owner input', board: 'Board', list: 'List', pause: 'Pause', cancel: 'Cancel', retry: 'Retry', assign: 'Assign', priority: 'Priority', publication: 'Publication', publicationAdapter: 'Publication controls require a host adapter backed by PublicationService.', publicationDisclosure: 'Drafts stay local until the owner explicitly publishes them. Public content may be cached; unlisted is not secret.', visibility: 'Visibility', public: 'Public', unlisted: 'By link', scoped: 'Scoped', draft: 'Draft', revision: 'Revision', preview: 'Preview', publish: 'Publish', unpublish: 'Unpublish', publishConfirm: 'Publish this content with the selected visibility?', shareLink: 'Keystone link', noPreview: 'No preview available.', continuityTitle: 'Device Continuity', sendToDevice: 'Send to Device', continueOnDevice: 'Continue on Device', deviceInbox: 'Device Inbox', devices: 'Devices', noContinuityRuntime: 'Device Continuity host is not connected.', noDevices: 'No trusted devices are available.', noInbox: 'No incoming handoffs.', chooseDevice: 'Choose a trusted device', sendWorkspace: 'Send current workspace', continueWorkspace: 'Continue current workspace', refresh: 'Refresh', flush: 'Try delivery', delivered: 'Delivered to device', opened: 'Opened', accepted: 'Accepted', queued: 'Queued', sending: 'Sending', failed: 'Failed', expired: 'Expired', cancelled: 'Cancelled', offline: 'Offline or waiting for a route', available: 'Available', recentlyAvailable: 'Recently available', notAvailable: 'Not available', automaticClipboard: 'Automatic clipboard continuity', automaticClipboardWarning: 'Off by default. Enabling requires explicit owner confirmation and never auto-pastes.', clipboardExplicit: 'Clipboard is explicit-only; no auto-paste or clipboard history is stored.', handoffBoundary: 'The native host supplies the trusted-device and encrypted delivery adapters. The shell receives references only.',
  },
  ru: {
    capture: 'Быстрый захват', captureHint: 'Сохраняйте текст, ссылки, файлы и ссылки на объекты в приватный Tray.', capturePlaceholder: 'Вставьте текст или URL https://…', captureClipboard: 'Захватить clipboard один раз', captureBrowser: 'Захватить текущую страницу', captureSelection: 'Захватить выделение', captureDrop: 'Перетащите сюда файл или папку', captureTray: 'Приватный Capture Tray', captureNoRuntime: 'Capture host недоступен; текст всё равно сохраняется локально.', captureNoItems: 'Пока ничего не захвачено.', captureRoute: 'Маршрутизировать', captureDismiss: 'Скрыть', captureRestore: 'Восстановить', capturePreview: 'Предпросмотр назначения', captureConfirm: 'Подтвердить маршрут', captureSource: 'Источник', captureState: 'Состояние', captureSuggestions: 'Предложения', captureUnsafe: 'Принимаются только безопасные HTTP(S)-ссылки и типизированные ссылки.',
    inbox: 'Входящие',
    subscriptions: 'Подписки',
    nearby: 'Обмен рядом',
    nearbyTitle: 'Обмен рядом', nearbyBoundary: 'Анонимное обнаружение на один переход. Native/core adapter владеет E2E, Fabric-маршрутизацией и bounded transfer state.', nearbyUnavailable: 'Nearby Exchange host не подключён.', nearbyReceive: 'Принимать рядом', nearbyStop: 'Остановить приём', nearbyQr: 'Показать Receive QR', nearbyRefresh: 'Обновить nearby', nearbyNoEndpoints: 'Анонимных nearby endpoints не видно.', nearbyOffers: 'Входящие предложения', nearbyNoOffers: 'Нет предложений, ожидающих согласия.', nearbyAccept: 'Принять', nearbyReject: 'Отклонить', nearbyCancel: 'Отменить', nearbyResume: 'Продолжить', nearbyDisclosure: 'Личность анонимна, пока вы явно не выберете поля для раскрытия.', nearbyAddContact: 'Добавить Contact после раскрытия', nearbyAnonymity: 'Нет GPS, расстояния по RSSI, истории встреч и автоматического создания Contact.', nearbyReceived: 'Получено', nearbyShareQr: 'Receive QR короткоживущий и scoped только для Nearby Exchange.',
    home: 'Главная', search: 'Поиск', agent: 'Agent Bot', askAgent: 'Спросить Agent Bot…', messages: 'Сообщения', spaces: 'Пространства', vault: 'Хранилище', calendar: 'Календарь', contacts: 'Контакты', maps: 'Карты', files: 'Файлы', documents: 'Документы', media: 'Медиа', photos: 'Фотографии', calls: 'Звонки', workboard: 'Рабочая доска', webLibrary: 'Web Library', webLibraryDescription: 'Сохранённые страницы, Read Later и неизменяемые offline-версии. Reader не обращается к внешнему origin.', collaboration: 'Совместная работа', continuity: 'Continuity устройств', plugins: 'Плагины', settings: 'Настройки', localeUnavailable: 'Звонки не настроены на этом host.', callBoundary: 'Нативный host должен предоставить аутентифицированный signaling и WebRTC media adapter. Звонки не записываются автоматически.', callMediaReady: 'media adapter готов', callMediaUnavailable: 'media adapter недоступен', noActiveCall: 'Активного звонка нет.', callHistory: 'История звонков', acceptCall: 'Принять', rejectCall: 'Отклонить', mute: 'Выключить микрофон', unmute: 'Включить микрофон', cameraOn: 'Включить камеру', cameraOff: 'Выключить камеру', screenOn: 'Показать экран', screenOff: 'Остановить показ экрана', endCall: 'Завершить звонок',
    back: 'Назад', forward: 'Вперёд', omnibox: 'Поиск объектов, команд, ссылок или вопрос Agent Bot…', command: 'Палитра команд', new: 'Новое', workspace: 'Рабочее пространство', context: 'Контекст', agentScope: 'Текущий объект в области видимости', ask: 'Спросить Agent Bot', close: 'Закрыть', duplicate: 'Дублировать', pin: 'Закрепить вкладку', unpin: 'Открепить вкладку', splitHorizontal: 'Разделить горизонтально', splitVertical: 'Разделить вертикально', restore: 'Открыть закрытую вкладку', customize: 'Настроить панель действий', hide: 'Скрыть', show: 'Показать', moveUp: 'Вверх', moveDown: 'Вниз', empty: 'Откройте объект, чтобы начать', open: 'Открыть', openInTab: 'Открыть в новой вкладке', local: 'Сначала локально', privacy: 'Приватный контекст остаётся на устройстве', placeholder: 'Заглушка / host adapter', placeholderBody: 'Поверхность готова для существующей подсистемы Keystone. Shell не придумывает бизнес-логику.', references: 'Типизированные ссылки', drop: 'Перетащите ссылку сюда', related: 'Связанные объекты', properties: 'Свойства', links: 'Связи', activity: 'Активность', searchHint: 'Поиск локальный и проверяет разрешения.', agentHint: 'В область видимости попадает только активный объект. Весь workspace не передаётся автоматически.', send: 'Выполнить локально', noObject: 'Объект не выбран', browserPrivacy: 'Страницы браузера не получают приватный контекст Keystone автоматически.', currentWorkspace: 'Текущее пространство', newWorkspace: 'Новое пространство', rename: 'Переименовать', delete: 'Удалить', switcher: 'Сменить рабочее пространство', done: 'Готово', reset: 'Сбросить', add: 'Добавить', objectId: 'ID объекта', commandHint: 'Введите для фильтрации команд…', noCommands: 'Команды не найдены', quickActions: 'Быстрые действия', message: 'Сообщение', group: 'Группа', space: 'Пространство', note: 'Заметка', canvas: 'Холст', event: 'Событие календаря', task: 'Задача', file: 'Файл', community: 'Сообщество', saved: 'Сохранено локально', mode: 'Сбалансированный', status: 'Готов', locked: 'Требуется разрешение', openBob: 'Открыть профиль Боба', openChat: 'Открыть чат', openFile: 'Открыть файл поездки', openSpace: 'Открыть пространство поездки', askAbout: 'Спросить об этом объекте', configure: 'Настроить', language: 'Язык', english: 'English', russian: 'Русский', extensionSlot: 'Слот расширения — плагины не запускаются без разрешения', needsUser: 'Нужен ответ владельца', board: 'Доска', list: 'Список', pause: 'Пауза', cancel: 'Отменить', retry: 'Повторить', assign: 'Назначить', priority: 'Приоритет', publication: 'Публикация', publicationAdapter: 'Управление публикацией требует host adapter на основе PublicationService.', publicationDisclosure: 'Черновики остаются локальными, пока владелец явно не опубликует их. Публичные данные могут кэшироваться; «по ссылке» — не секрет.', visibility: 'Видимость', public: 'Публично', unlisted: 'По ссылке', scoped: 'Ограниченная', draft: 'Черновик', revision: 'Версия', preview: 'Предпросмотр', publish: 'Опубликовать', unpublish: 'Снять с публикации', publishConfirm: 'Опубликовать содержимое с выбранной видимостью?', shareLink: 'Ссылка Keystone', noPreview: 'Предпросмотр недоступен.', continuityTitle: 'Continuity устройств', sendToDevice: 'Отправить на устройство', continueOnDevice: 'Продолжить на устройстве', deviceInbox: 'Входящие устройства', devices: 'Устройства', noContinuityRuntime: 'Continuity host не подключён.', noDevices: 'Нет доступных доверенных устройств.', noInbox: 'Входящих handoff нет.', chooseDevice: 'Выберите доверенное устройство', sendWorkspace: 'Отправить текущее пространство', continueWorkspace: 'Продолжить текущее пространство', refresh: 'Обновить', flush: 'Попробовать доставить', delivered: 'Доставлено на устройство', opened: 'Открыто', accepted: 'Принято', queued: 'В очереди', sending: 'Отправляется', failed: 'Ошибка', expired: 'Истёк срок', cancelled: 'Отменено', offline: 'Офлайн или нет маршрута', available: 'Доступно', recentlyAvailable: 'Недавно доступно', notAvailable: 'Недоступно', automaticClipboard: 'Автоматическая Continuity буфера обмена', automaticClipboardWarning: 'Выключено по умолчанию. Включение требует явного подтверждения владельца и не вставляет текст автоматически.', clipboardExplicit: 'Буфер обмена работает только явно: auto-paste и история буфера не используются.', handoffBoundary: 'Нативный host предоставляет adapters доверенных устройств и зашифрованной доставки. Shell получает только references.',
  },
} as const;

type Copy = { [K in keyof typeof copy.en]: string };

function useShell(): [DesktopShellController, () => void] {
  const controller = React.useRef<DesktopShellController>();
  controller.current ??= new DesktopShellController({ canOpen: ref => ref.visibility !== 'private' || ref.id !== 'revoked' });
  const [, redraw] = React.useReducer(value => value + 1, 0);
  React.useEffect(() => controller.current?.subscribe(redraw), []);
  return [controller.current, redraw];
}

export interface DesktopShellProps {
  initialLocale?: Locale;
  onLocaleChange?: (locale: Locale) => void;
}

export default function DesktopShell({ initialLocale = 'ru', onLocaleChange }: DesktopShellProps) {
  const [shell] = useShell();
  const [locale, setLocaleState] = React.useState<Locale>(() => (localStorage.getItem('keystone.locale') as Locale) || initialLocale);
  const t: Copy = copy[locale];
  const [omnibox, setOmnibox] = React.useState('');
  const [omniboxOpen, setOmniboxOpen] = React.useState(false);
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [quickActionsOpen, setQuickActionsOpen] = React.useState(false);
  const [workspaceOpen, setWorkspaceOpen] = React.useState(false);
  const [activityEditorOpen, setActivityEditorOpen] = React.useState(false);
  const [draggedRef, setDraggedRef] = React.useState<KeystoneObjectReference>();
  const [agentPrefill, setAgentPrefill] = React.useState('');
  const omniboxRef = React.useRef<HTMLInputElement>(null);
  const commands = React.useMemo(() => defaultShellCommands(locale), [locale]);
  const contextRegistry = React.useMemo(() => createDefaultContextRegistry(locale), [locale]);
  const snapshot = shell.getSnapshot();
  const currentTab = shell.currentTab;

  const setLocale = (next: Locale) => { setLocaleState(next); localStorage.setItem('keystone.locale', next); onLocaleChange?.(next); };

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const primary = isPrimaryModifier(event);
      if (primary && (event.key.toLowerCase() === 'k' || event.key.toLowerCase() === 'p')) { event.preventDefault(); setPaletteOpen(true); return; }
      if (primary && event.key.toLowerCase() === 'l') { event.preventDefault(); omniboxRef.current?.focus(); omniboxRef.current?.select(); setOmniboxOpen(true); return; }
      if (primary && event.shiftKey && event.key.toLowerCase() === 't') { event.preventDefault(); shell.reopenClosedTab(); return; }
      if (primary && event.key.toLowerCase() === 't') { event.preventDefault(); shell.openReference({ kind: 'home', id: 'new-tab', label: t.home }, { allowDuplicate: true }); return; }
      if (primary && event.key.toLowerCase() === 'w') { event.preventDefault(); shell.closeActiveTab(); return; }
      if (primary && event.key === '\\') { event.preventDefault(); shell.splitPane('vertical'); return; }
      if (primary && event.key === 'Tab') { event.preventDefault(); shell.nextTab(event.shiftKey ? -1 : 1); return; }
      if (primary && event.shiftKey && event.code === 'Space') { event.preventDefault(); shell.openReference({ kind: 'capture', id: 'capture', label: t.capture }, { allowDuplicate: true }); return; }
      if (primary && event.code === 'Space') { event.preventDefault(); shell.toggleAgentPanel(true); return; }
      if (event.key === 'Escape') { setPaletteOpen(false); setQuickActionsOpen(false); setWorkspaceOpen(false); setActivityEditorOpen(false); setOmniboxOpen(false); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [shell, t.capture, t.home]);

  const runCommand = (command: ShellCommand) => { setPaletteOpen(false); command.run(shell); };
  const submitOmnibox = (event: React.FormEvent) => {
    event.preventDefault();
    const input = omnibox.trim();
    if (!input) return;
    if (/^keystone:\/\/capture(?:[/?]|$)/i.test(input)) {
      const captureRuntime = getDesktopCaptureRuntime();
      if (captureRuntime) void captureRuntime.captureDeepLink(input).then(() => { shell.openReference({ kind: 'capture', id: 'capture', label: t.capture }, { allowDuplicate: true }); }).catch(error => shell.setNotice(error instanceof Error ? error.message : t.captureUnsafe));
      else shell.setNotice(t.captureNoRuntime);
      setOmnibox(''); setOmniboxOpen(false); return;
    }
    const mailInput = parseDesktopMailInput(input);
    if (mailInput) {
      shell.openReference({ kind: 'mail', id: mailInput.type === 'COMPOSE' ? 'compose' : 'mail', label: t.home === 'Главная' ? 'Внешняя почта' : 'External Email' }, { allowDuplicate: mailInput.type === 'COMPOSE' });
      const mailRuntime = getDesktopMailRuntime();
      if (mailInput.type === 'SEARCH' && mailRuntime?.search) void Promise.resolve(mailRuntime.search(mailInput.query, { limit: 30 })).then(value => shell.setNotice((t.home === 'Главная' ? 'Почта: ' : 'Mail: ') + value.length)).catch(() => shell.setNotice(t.home === 'Главная' ? 'Почта недоступна' : 'Mail unavailable'));
      else if (mailInput.type === 'REFRESH' && mailRuntime?.refresh) void Promise.resolve(mailRuntime.accounts()).then(value => value[0]?.id ? mailRuntime.refresh?.(value[0].id) : undefined).then(() => shell.setNotice(t.home === 'Главная' ? 'Почта обновлена' : 'Mail refreshed')).catch(() => shell.setNotice(t.home === 'Главная' ? 'Почта недоступна' : 'Mail unavailable'));
      setOmnibox(''); setOmniboxOpen(false); return;
    }
    const mapsInput = parseDesktopMapsInput(input);
    if (mapsInput) {
      shell.openReference({ kind: 'map', id: 'map', label: t.maps });
      const mapsRuntime = getDesktopMapsRuntime();
      if (mapsInput.type === 'SEARCH_PLACE' && mapsRuntime) void mapsRuntime.search({ query: mapsInput.query, limit: 50 }).then(value => shell.setNotice(`${t.maps}: ${value.length}`)).catch(() => shell.setNotice(t.maps));
      else if (mapsInput.type === 'SHOW_MY_LOCATION' && mapsRuntime?.showMyLocation) void mapsRuntime.showMyLocation().then(value => shell.setNotice(`${t.maps}: ${value.precision}`)).catch(() => shell.setNotice(t.maps));
      else shell.setNotice(t.maps);
      setOmnibox(''); setOmniboxOpen(false); return;
    }
    const result = resolveOmniboxInput(input, shell.router);
    if (result.type === 'object' && result.ref) shell.openReference(result.ref);
    else if (result.type === 'web' && result.url) shell.openBrowser(result.url);
    else if (result.type === 'command' && result.command) {
      const command = findCommand(commands, result.command);
      if (command) runCommand(command); else shell.setNotice(`${t.command}: ${result.command}`);
    } else if (result.type === 'agent-query') { setAgentPrefill(input); shell.toggleAgentPanel(true); shell.setNotice(`${t.agentScope}: ${currentTab?.title ?? t.noObject}`); }
    else if (result.type === 'search') shell.setNotice(`${t.search}: ${input}`);
    setOmnibox(''); setOmniboxOpen(false);
  };

  const activeRef = currentTab?.object;
  const browserPage = currentTab?.kind === 'browser' ? shell.browserPage(currentTab.id) : undefined;
  const context = contextRegistry.resolve(activeRef, browserPage);
  const visibleActivity = shell.chromeState.activityBar.filter(item => item.visible);
  const openActivity = (item: ActivityBarItem) => {
    if (item.kind === 'search') { omniboxRef.current?.focus(); setOmniboxOpen(true); return; }
    if (item.kind === 'plugins') { shell.openReference({ kind: 'settings', id: 'plugins', label: t.plugins }); return; }
    if (item.id === 'inbox') { shell.openReference({ kind: 'inbox', id: 'inbox', label: t.inbox }); return; }
    if (item.id === 'continuity') { shell.openReference({ kind: 'settings', id: 'continuity', label: t.continuity }); return; }
    if (item.id === 'nearby') { shell.openReference({ kind: 'settings', id: 'nearby', label: t.nearby }); return; }
    if (item.id === 'web-library') { shell.openReference({ kind: 'web-library', id: 'web-library', label: t.webLibrary }); return; }
    if (item.id === 'capture') { shell.openReference({ kind: 'capture', id: 'capture', label: t.capture }, { allowDuplicate: true }); return; }
    shell.openReference({ kind: item.kind, id: item.id === 'calls' ? 'calls' : item.kind, label: item.label });
  };

  return <div className="desktop-shell" data-locale={locale}>
    <ActivityBar items={visibleActivity} t={t} onOpen={openActivity} onCustomize={() => setActivityEditorOpen(value => !value)} />
    <div className="desktop-environment">
      <header className="desktop-header">
        <div className="desktop-brand"><span className="brand-glyph">✦</span><span>Keystone</span><span className="brand-channel">/ DESKTOP</span></div>
        <div className="history-controls"><button className="icon-control" onClick={() => shell.goBack()} aria-label={t.back}>‹</button><button className="icon-control" onClick={() => shell.goForward()} aria-label={t.forward}>›</button></div>
        <form className="omnibox" onSubmit={submitOmnibox}>
          <span className="omnibox-symbol" aria-hidden>⌕</span><input ref={omniboxRef} value={omnibox} onFocus={() => setOmniboxOpen(true)} onChange={event => setOmnibox(event.target.value)} placeholder={t.omnibox} aria-label={t.omnibox}/><kbd>{isMac() ? '⌘' : 'Ctrl'} L</kbd>
          {omniboxOpen && <OmniboxMenu value={omnibox} t={t} onChoose={value => { setOmnibox(value); omniboxRef.current?.focus(); }} />}
        </form>
        <div className="header-actions">
          <button className="quiet-button capture-header-button" onClick={() => shell.openReference({ kind: 'capture', id: 'capture', label: t.capture }, { allowDuplicate: true })} title={`${t.capture} · ${isMac() ? '⌘' : 'Ctrl'} ⇧ Space`}><span>＋</span><span>{t.capture}</span></button>
          <button className="quiet-button" onClick={() => setPaletteOpen(true)} title={t.command}><span>⌘</span><span>{t.command}</span></button>
          <button className="primary-button" onClick={() => setQuickActionsOpen(value => !value)} aria-expanded={quickActionsOpen}><span>+</span>{t.new}</button>
          <select className="locale-select" value={locale} onChange={event => setLocale(event.target.value as Locale)} aria-label={t.language}><option value="en">{t.english}</option><option value="ru">{t.russian}</option></select>
          <button className="avatar-button" onClick={() => shell.openReference({ kind: 'settings', id: 'settings', label: t.settings })} aria-label={t.settings}>MK</button>
        </div>
        {quickActionsOpen && <QuickActions t={t} onChoose={action => { setQuickActionsOpen(false); shell.openReference(action, { allowDuplicate: true }); }} />}
      </header>
      <div className="workspace-toolbar">
        <button className="workspace-switcher" onClick={() => setWorkspaceOpen(value => !value)} aria-expanded={workspaceOpen}><span className="workspace-dot"/><span>{snapshot.workspace.name}</span><span className="chevron">⌄</span></button>
        <div className="toolbar-path">{currentTab?.object ? <><span>{currentTab.object.kind}</span><b>›</b><strong>{currentTab.title}</strong></> : <span>{t.home}</span>}</div>
        <div className="toolbar-actions"><span className="privacy-mark">◉ {t.local}</span><button className="toolbar-button" onClick={() => shell.toggleContextSidebar()}>{t.context}</button><button className="toolbar-button" onClick={() => shell.toggleAgentPanel()}>{t.agent}</button></div>
        {workspaceOpen && <WorkspaceMenu shell={shell} t={t} onClose={() => setWorkspaceOpen(false)} />}
      </div>
      <TabStrip shell={shell} tabs={snapshot.workspace.tabs} currentTab={currentTab} t={t} />
      <div className="desktop-body" style={{ gridTemplateColumns: `${shell.chromeState.contextSidebarOpen ? 'minmax(0, 1fr)' : 'minmax(0, 1fr)'}${shell.chromeState.contextSidebarOpen ? ' minmax(220px, ' + shell.chromeState.contextSidebarWidth + 'px)' : ''}${shell.chromeState.agentPanelOpen ? ' minmax(300px, ' + shell.chromeState.agentPanelWidth + 'px)' : ''}` }}>
        <main className="pane-host" aria-label={t.workspace} onDragOver={event => event.preventDefault()} onDrop={event => handleDrop(event, shell, draggedRef, shell.currentPaneId)}>
          <PaneTree node={snapshot.workspace.paneTree} shell={shell} t={t} contextRegistry={contextRegistry} onDragRef={setDraggedRef} />
        </main>
        {shell.chromeState.contextSidebarOpen && <ContextSidebar data={context} t={t} />}
        {shell.chromeState.agentPanelOpen && <AgentBotPanel shell={shell} t={t} activeTab={currentTab} prefill={agentPrefill} onClose={() => shell.toggleAgentPanel(false)} />}
      </div>
      <footer className="status-bar"><span><i className="status-light"/> {t.status}</span><span>{t.saved}</span><span>AI · {t.mode}</span><span className="status-spacer"/><button onClick={() => shell.toggleContextSidebar()}>{shell.chromeState.contextSidebarOpen ? '▣' : '□'} {t.context}</button><button onClick={() => shell.toggleAgentPanel()}>{shell.chromeState.agentPanelOpen ? '✦' : '✧'} {t.agent}</button></footer>
      {activityEditorOpen && <ActivityEditor shell={shell} t={t} onClose={() => setActivityEditorOpen(false)} />}
    </div>
    {paletteOpen && <CommandPalette commands={commands} t={t} onRun={runCommand} onClose={() => setPaletteOpen(false)} />}
  </div>;
}

function isMac(): boolean { return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform); }

function findCommand(commands: ShellCommand[], input: string): ShellCommand | undefined {
  const normalized = input.trim().toLowerCase();
  return commands.find(command => command.id === normalized || command.label.toLowerCase() === normalized || command.keywords?.some(keyword => keyword === normalized));
}

type DesktopMailInput = { readonly type: 'OPEN' | 'COMPOSE' | 'REFRESH' } | { readonly type: 'SEARCH'; readonly query: string };
function parseDesktopMailInput(value: string): DesktopMailInput | undefined {
  if (/^(?:open|открыть)\s+(?:external\s+)?(?:mail|email|почту|письма)$/i.test(value)) return { type: 'OPEN' };
  if (/^(?:compose|write|написать)\s+(?:external\s+)?(?:mail|email|письмо)$/i.test(value)) return { type: 'COMPOSE' };
  if (/^(?:refresh|sync|обновить|синхронизировать)\s+(?:external\s+)?(?:mail|email|почту)$/i.test(value)) return { type: 'REFRESH' };
  const search = value.match(/^(?:mail|email|почта|письма)\s+(?:search|find|найти)?\s*(.+)$/i);
  return search?.[1]?.trim() ? { type: 'SEARCH', query: search[1].trim() } : undefined;
}

type DesktopMapsInput = { readonly type: 'OPEN_MAP' | 'SHOW_MY_LOCATION' | 'PLAN_ROUTE'; readonly query?: string } | { readonly type: 'SEARCH_PLACE'; readonly query: string };
function parseDesktopMapsInput(value: string): DesktopMapsInput | undefined {
  if (/^(?:open|открыть)\s+(?:the\s+)?(?:map|maps|карту|карты)$/i.test(value)) return { type: 'OPEN_MAP' };
  if (/^(?:show|показать)\s+(?:my\s+)?(?:location|position|геопозицию|мою геопозицию)$/i.test(value)) return { type: 'SHOW_MY_LOCATION' };
  const search = value.match(/^(?:find|search|найти|поиск(?:\s+мест)?)\s+(.+)$/i);
  if (search?.[1]) return { type: 'SEARCH_PLACE', query: search[1].trim() };
  const route = value.match(/^(?:route|directions|маршрут|построить маршрут(?:\s+до)?)\s+(.+)$/i);
  if (route?.[1]) return { type: 'PLAN_ROUTE', query: route[1].trim() };
  return undefined;
}

function ActivityBar({ items, t, onOpen, onCustomize }: { items: ActivityBarItem[]; t: Copy; onOpen: (item: ActivityBarItem) => void; onCustomize: () => void }) {
  return <aside className="activity-bar" aria-label={t.workspace}><div className="activity-logo">✦</div><nav>{items.map(item => <button key={item.id} className="activity-item" onClick={() => onOpen(item)} title={item.extensionSlot ? t.extensionSlot : item.label}><span className="activity-icon">{item.icon}</span><span>{item.label}</span></button>)}</nav><div className="activity-bottom"><button className="activity-item subtle" onClick={onCustomize} title={t.customize}><span className="activity-icon">⋯</span><span>{t.configure}</span></button></div></aside>;
}

function TabStrip({ shell, tabs, currentTab, t }: { shell: DesktopShellController; tabs: DesktopTab[]; currentTab?: DesktopTab; t: Copy }) {
  return <div className="tab-strip" role="tablist" aria-label="Keystone tabs">{tabs.map(tab => <div key={tab.id} className={`tab${currentTab?.id === tab.id ? ' active' : ''}${tab.pinned ? ' pinned' : ''}${tab.dirty ? ' dirty' : ''}${tab.locked ? ' locked' : ''}`} role="tab" aria-selected={currentTab?.id === tab.id} draggable onDragStart={event => event.dataTransfer.setData('application/x-keystone-tab', tab.id)} onClick={() => shell.selectTab(shell.currentPaneId, tab.id)}><span className="tab-kind">{tabIcon(tab.kind)}</span><span className="tab-title">{tab.title}</span>{tab.locked && <span className="tab-lock">!</span>}{tab.dirty && <span className="tab-dirty">•</span>}<button className="tab-menu-button" onClick={event => { event.stopPropagation(); shell.closeTab(tab.id, true); }} aria-label={`${t.close}: ${tab.title}`}>×</button></div>)}<button className="tab-add" onClick={() => shell.openReference({ kind: 'home', id: 'new-tab', label: t.home }, { allowDuplicate: true })} aria-label={t.open}>+</button><div className="tab-spacer"/><button className="tab-action" onClick={() => shell.reopenClosedTab()} title={t.restore}>↶</button><button className="tab-action" onClick={() => shell.pinTab()} title={currentTab?.pinned ? t.unpin : t.pin}>{currentTab?.pinned ? '★' : '☆'}</button></div>;
}

function PaneTree({ node, shell, t, contextRegistry, onDragRef }: { node: PaneNode; shell: DesktopShellController; t: Copy; contextRegistry: ContextProviderRegistry; onDragRef: (ref?: KeystoneObjectReference) => void }) {
  if (node.type === 'leaf') return <PaneView node={node} shell={shell} t={t} contextRegistry={contextRegistry} onDragRef={onDragRef} />;
  return <div className={`pane-split ${node.orientation}`} style={{ ['--split-ratio' as string]: node.ratio }}><div className="pane-child"><PaneTree node={node.first} shell={shell} t={t} contextRegistry={contextRegistry} onDragRef={onDragRef} /></div><SplitDivider node={node} shell={shell} /><div className="pane-child"><PaneTree node={node.second} shell={shell} t={t} contextRegistry={contextRegistry} onDragRef={onDragRef} /></div></div>;
}

function SplitDivider({ node, shell }: { node: Extract<PaneNode, { type: 'split' }>; shell: DesktopShellController }) {
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const host = event.currentTarget.parentElement;
    if (!host) return;
    const bounds = host.getBoundingClientRect();
    const update = (move: PointerEvent) => {
      const ratio = node.orientation === 'vertical' ? (move.clientX - bounds.left) / Math.max(1, bounds.width) : (move.clientY - bounds.top) / Math.max(1, bounds.height);
      shell.resizePane(node.id, ratio);
    };
    const stop = () => { window.removeEventListener('pointermove', update); window.removeEventListener('pointerup', stop); };
    window.addEventListener('pointermove', update);
    window.addEventListener('pointerup', stop, { once: true });
  };
  return <div className="split-divider" role="separator" aria-orientation={node.orientation === 'vertical' ? 'vertical' : 'horizontal'} aria-label="Resize pane" onPointerDown={onPointerDown} />;
}

function PaneView({ node, shell, t, contextRegistry, onDragRef }: { node: Extract<PaneNode, { type: 'leaf' }>; shell: DesktopShellController; t: Copy; contextRegistry: ContextProviderRegistry; onDragRef: (ref?: KeystoneObjectReference) => void }) {
  const tabs = node.tabIds.flatMap(tabId => { const tab = shell.tabs.get(tabId); return tab ? [tab] : []; });
  const active = node.activeTabId ? shell.tabs.get(node.activeTabId) : tabs[0];
  return <section className={`pane-view${shell.currentPaneId === node.id ? ' focused' : ''}`} onClick={() => shell.focusPane(node.id)} onDragOver={event => event.preventDefault()} onDrop={event => handleDrop(event, shell, undefined, node.id)}>
    <div className="pane-toolbar"><div className="pane-tab-labels">{tabs.map(tab => <button key={tab.id} className={active?.id === tab.id ? 'pane-tab active' : 'pane-tab'} onClick={event => { event.stopPropagation(); shell.selectTab(node.id, tab.id); }}>{tabIcon(tab.kind)} {tab.title}</button>)}</div><div className="pane-actions"><button onClick={event => { event.stopPropagation(); shell.splitPane('horizontal', node.id); }} title={t.splitHorizontal}>↕</button><button onClick={event => { event.stopPropagation(); shell.splitPane('vertical', node.id); }} title={t.splitVertical}>↔</button><button onClick={event => { event.stopPropagation(); shell.closePane(node.id); }} title={t.close}>×</button></div></div>
    <div className="pane-content">{active ? <TabSurface tab={active} shell={shell} t={t} contextRegistry={contextRegistry} onDragRef={onDragRef} /> : <EmptyPane t={t} shell={shell} />}</div>
  </section>;
}

function TabSurface({ tab, shell, t, contextRegistry, onDragRef }: { tab: DesktopTab; shell: DesktopShellController; t: Copy; contextRegistry: ContextProviderRegistry; onDragRef: (ref?: KeystoneObjectReference) => void }) {
  const ref = tab.object;
  const dragRef = ref ? { onDragStart: (event: React.DragEvent) => { event.dataTransfer.setData('application/x-keystone-ref', JSON.stringify(ref)); onDragRef(ref); } } : undefined;
  if (tab.locked) return <div className="locked-surface"><span className="locked-icon">⌁</span><h2>{t.locked}</h2><p>{t.privacy}</p><button className="secondary-button" onClick={() => shell.closeTab(tab.id, true)}>{t.close}</button></div>;
  if (tab.kind === 'home') return <HomeSurface shell={shell} t={t} />;
  if (tab.kind === 'inbox') return <InboxSurface t={t} />;
  if (tab.kind === 'capture') return <CaptureSurface shell={shell} t={t} />;
  if (tab.kind === 'agent') return <AgentSurface shell={shell} t={t} />;
  if (tab.kind === 'browser') return <BrowserSurface tab={tab} shell={shell} t={t} />;
  if (tab.kind === 'subscriptions') return <SubscriptionsSurface tab={tab} shell={shell} t={t} />;
  if (tab.kind === 'web-library') return <WebLibrarySurface tab={tab} shell={shell} t={t} />;
  if (tab.kind === 'workboard') return <WorkboardSurface tab={tab} shell={shell} t={t} />;
  if (tab.kind === 'tasks') return <TasksSurface tab={tab} shell={shell} t={t} />;
  if (tab.kind === 'contacts') return <ContactsSurface tab={tab} shell={shell} t={t} />;
  if (tab.kind === 'space' && tab.object?.id === 'collaboration') return <CollaborationSurface tab={tab} shell={shell} t={t} />;
  if (tab.kind === 'settings') return tab.object?.id === 'skills' ? <SkillsSurface shell={shell} t={t} /> : tab.object?.id === 'plugins' ? <PluginsSurface t={t} /> : tab.object?.id === 'continuity' ? <ContinuitySurface shell={shell} t={t} /> : tab.object?.id === 'nearby' ? <NearbyExchangeSurface shell={shell} t={t} /> : <SettingsSurface shell={shell} t={t} />;
  if (tab.kind === 'vault') return <VaultSurface tab={tab} shell={shell} t={t} />;
  if (tab.kind === 'graph') return <VaultGraphSurface tab={tab} shell={shell} t={t} />;
  if (tab.kind === 'canvas') return <VaultCanvasSurface tab={tab} shell={shell} t={t} />;
  if (tab.kind === 'calendar') return <CalendarSurface tab={tab} shell={shell} t={t} />;
  if (tab.kind === 'map') return <MapsSurface tab={tab} shell={shell} t={t} />;
  if (tab.kind === 'mail') return <MailSurface tab={tab} shell={shell} t={t} />;
  if (tab.kind === 'file') return <FilesSurface tab={tab} shell={shell} t={t} />;
  if (tab.kind === 'document') return <DocumentsSurface tab={tab} shell={shell} t={t} />;
  if (tab.kind === 'publication') return <PublicationSurface tab={tab} shell={shell} t={t} />;
  if (tab.kind === 'media' && tab.object?.id === 'calls') return <CallsSurface t={t} />;
  if (tab.kind === 'media') return <PhotosSurface tab={tab} shell={shell} t={t} />;
  return <div className="object-surface" draggable={Boolean(ref)} {...dragRef}>
    <div className="surface-kicker"><span className="surface-icon">{tabIcon(tab.kind)}</span><span>{tab.kind}</span><span className="surface-badge">{t.local}</span></div>
    <h1>{tab.title}</h1>
    <p className="surface-description">{descriptionFor(tab, t)}</p>
    {ref && <div className="object-id"><span>{t.objectId}</span><code>{ref.id}</code></div>}
    <div className="surface-grid"><button className="surface-card" onClick={() => shell.toggleAgentPanel(true)}><span>✦</span><strong>{t.askAbout}</strong><small>{t.agentHint}</small></button><button className="surface-card" onClick={() => shell.setNotice(`${t.references}: ${tab.title}`)}><span>↗</span><strong>{t.references}</strong><small>{t.related}</small></button></div>
    <TypedReferenceDock tab={tab} shell={shell} t={t} />
  </div>;
}

type DesktopFilesPage = Awaited<ReturnType<DesktopFilesRuntime['listFiles']>>;

function FilesSurface({ tab, shell, t }: { tab: DesktopTab; shell: DesktopShellController; t: Copy }) {
  const [runtime, setRuntime] = React.useState<DesktopFilesRuntime | undefined>(getDesktopFilesRuntime);
  const [folders, setFolders] = React.useState<readonly DesktopFileFolder[]>([]);
  const [selectedFolderId, setSelectedFolderId] = React.useState<string>();
  const [page, setPage] = React.useState<DesktopFilesPage>();
  const [conflicts, setConflicts] = React.useState<Awaited<ReturnType<DesktopFilesRuntime['conflicts']>>>([]);
  const [query, setQuery] = React.useState('');
  const [searchResults, setSearchResults] = React.useState<Awaited<ReturnType<DesktopFilesRuntime['search']>>>([]);
  const [error, setError] = React.useState('');
  const [version, setVersion] = React.useState(0);
  const ru = t.files === 'Файлы';

  React.useEffect(() => subscribeDesktopFilesRuntime(() => setRuntime(getDesktopFilesRuntime())), []);
  React.useEffect(() => {
    if (!runtime) return undefined;
    const unsubscribe = runtime.subscribe?.(() => setVersion(value => value + 1));
    setVersion(value => value + 1);
    return unsubscribe;
  }, [runtime]);
  React.useEffect(() => {
    if (!runtime) { setFolders([]); setSelectedFolderId(undefined); return; }
    const next = runtime.folders();
    setFolders(next);
    const tabFolderId = tab.object?.id && next.some(folder => folder.id === tab.object?.id) ? tab.object.id : undefined;
    setSelectedFolderId(current => tabFolderId ?? (current && next.some(folder => folder.id === current) ? current : next[0]?.id));
  }, [runtime, tab.object?.id, version]);
  React.useEffect(() => {
    if (!runtime || !selectedFolderId) { setPage(undefined); setConflicts([]); return undefined; }
    let active = true;
    void Promise.all([
      runtime.listFiles(selectedFolderId as DesktopFileFolder['id'], { limit: 128 }),
      runtime.conflicts(selectedFolderId as DesktopFileFolder['id']),
    ]).then(([nextPage, nextConflicts]) => { if (active) { setPage(nextPage); setConflicts(nextConflicts); setError(''); } }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { active = false; };
  }, [runtime, selectedFolderId, version]);
  React.useEffect(() => {
    if (!runtime || !query.trim()) { setSearchResults([]); return undefined; }
    let active = true;
    void runtime.search(query.trim(), { limit: 64 }).then(result => { if (active) setSearchResults(result); }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { active = false; };
  }, [runtime, query, version]);

  const run = async (operation: () => Promise<unknown>) => {
    try { await operation(); setError(''); setVersion(value => value + 1); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const createFolder = async () => {
    if (!runtime?.createFolder) return;
    const name = window.prompt(ru ? 'Имя новой папки' : 'New folder name');
    if (!name?.trim()) return;
    await run(async () => { await runtime.createFolder!({ name: name.trim(), ...(selectedFolderId ? { parentFolderId: selectedFolderId as DesktopFileFolder['id'] } : {}) }); });
  };
  const selectedFolder = folders.find(folder => folder.id === selectedFolderId);
  if (!runtime) return <div className="object-surface"><div className="surface-kicker"><span className="surface-icon">▣</span><span>{t.files}</span><span className="surface-badge">HOST ADAPTER</span></div><h1>{t.files}</h1><p className="surface-description">{ru ? 'Files host adapter ещё не подключён.' : 'The Files host adapter is not connected.'}</p><div className="adapter-note"><span>⌁</span><div><strong>{ru ? 'Явное подключение локальной папки' : 'Explicit local-folder binding'}</strong><small>{ru ? 'Desktop получает только bounded binding от native host; произвольный scan home не выполняется.' : 'Desktop receives only a bounded binding from the native host; Keystone never scans the home directory implicitly.'}</small></div></div></div>;

  return <div className="object-surface">
    <div className="surface-kicker"><span className="surface-icon">▣</span><span>{t.files}</span><span className="surface-badge">LOCAL-FIRST</span></div>
    <div className="web-library-heading"><div><h1>{t.files}</h1><p className="surface-description">{ru ? 'Общие папки, версии и on-demand content через существующий content-addressed слой.' : 'Shared folders, revisions and on-demand content over the existing content-addressed layer.'}</p></div><div className="web-library-actions"><button className="secondary-button" onClick={() => setVersion(value => value + 1)}>{t.refresh}</button><button className="primary-button" onClick={() => void createFolder()}>＋ {ru ? 'Папка' : 'Folder'}</button></div></div>
    <div className="web-library-toolbar"><input value={query} onChange={event => setQuery(event.target.value)} placeholder={ru ? 'Искать по именам файлов и папок…' : 'Search file and folder names…'} aria-label={ru ? 'Поиск файлов' : 'File search'} /><span>{ru ? `${folders.length} папок` : `${folders.length} folders`}</span></div>
    {error ? <span className="maps-notice">{error}</span> : null}
    {query.trim() ? <div className="web-library-layout"><div className="web-library-list"><span className="section-label">{ru ? 'Результаты поиска' : 'Search results'}</span>{searchResults.length ? searchResults.map(result => <button key={result.entry.id} className="web-library-entry" onClick={() => setSelectedFolderId(result.folder.id)}><strong>{result.entry.name}</strong><small>{result.folder.name} · {Math.round(result.score * 100)}%</small></button>) : <div className="web-library-empty">{ru ? 'Совпадений нет.' : 'No matches.'}</div>}</div><div className="web-library-reader"><div className="web-library-reader-empty"><div><span>⌕</span><p>{ru ? 'Выберите папку, чтобы открыть локальный список.' : 'Choose a folder to open its local listing.'}</p></div></div></div></div> : <div className="web-library-layout"><div className="web-library-list"><span className="section-label">{ru ? 'Папки' : 'Folders'}</span>{folders.length ? folders.map(folder => <button key={folder.id} className={`web-library-entry${folder.id === selectedFolderId ? ' active' : ''}`} onClick={() => setSelectedFolderId(folder.id)}><strong>{folder.name}</strong><small>{folder.scope} · epoch {folder.epoch}</small></button>) : <div className="web-library-empty">{ru ? 'Папок пока нет.' : 'No folders yet.'}</div>}<div className="adapter-note"><span>⌁</span><div><strong>{ru ? 'Filesystem binding' : 'Filesystem binding'}</strong><small>{ru ? 'Подключается только явным действием владельца через native host.' : 'Attached only by an explicit owner action through the native host.'}</small></div></div></div><div className="web-library-reader">{selectedFolder ? <><div className="web-library-reader-heading"><div><h2>{selectedFolder.name}</h2><p>{selectedFolder.scope} · {selectedFolder.revision} metadata revision · epoch {selectedFolder.epoch}</p></div>{runtime.filesystemStatus?.(selectedFolder.id) ? <span className="surface-badge">{runtime.filesystemStatus(selectedFolder.id)?.state}</span> : null}</div><div className="web-library-entry-list">{page?.items.length ? page.items.map(file => <div key={file.fileId} className="surface-card"><strong>{file.entry.name}</strong><small>{file.revision.mimeType} · {formatDesktopBytes(file.revision.size)} · {file.revisionCount} {ru ? 'версий' : 'revisions'}</small><small>{ru ? 'Доступность' : 'Availability'}: {file.availability} · {file.revision.contentId}</small><div className="web-library-actions">{runtime.keepOnDevice ? <button className="secondary-button" onClick={() => void run(() => runtime.keepOnDevice!(selectedFolder.id, file.fileId))}>{ru ? 'Хранить на устройстве' : 'Keep on device'}</button> : null}{runtime.trash ? <button className="secondary-button" onClick={() => void run(() => runtime.trash!(file.entry.id, true))}>{ru ? 'В корзину' : 'Move to trash'}</button> : null}</div></div>) : <div className="web-library-empty">{ru ? 'Файлов в этой папке нет.' : 'No files in this folder.'}</div>}</div>{page && page.total > page.items.length ? <p className="web-library-notice">{ru ? `Показана первая страница из ${page.total} записей.` : `Showing the first page of ${page.total} entries.`}</p> : null}{conflicts.length ? <div className="adapter-note"><span>!</span><div><strong>{ru ? `Открытых конфликтов: ${conflicts.length}` : `${conflicts.length} open conflicts`}</strong><small>{conflicts.slice(0, 3).map(conflict => `${conflict.kind}: ${conflict.details}`).join(' · ')}</small></div></div> : null}</> : <div className="web-library-reader-empty"><div><span>▣</span><p>{ru ? 'Создайте или выберите папку.' : 'Create or choose a folder.'}</p></div></div>}</div></div>}
    <TypedReferenceDock tab={tab} shell={shell} t={t} />
  </div>;
}

function formatDesktopBytes(value: number): string { if (value < 1024) return `${value} B`; if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`; if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`; return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`; }

type DesktopDocumentFile = Awaited<ReturnType<DesktopDocumentsRuntime['listSupportedFiles']>>[number];
type DesktopDocumentReader = Awaited<ReturnType<DesktopDocumentsRuntime['open']>>;
type DesktopDocumentRenderedPage = Awaited<ReturnType<DesktopDocumentReader['renderPage']>>;
type DesktopDocumentSearchResult = Awaited<ReturnType<DesktopDocumentsRuntime['search']>>[number];
type DesktopDocumentAnnotation = Awaited<ReturnType<DesktopDocumentsRuntime['listAnnotations']>>[number];

function DocumentsSurface({ tab, shell, t }: { tab: DesktopTab; shell: DesktopShellController; t: Copy }) {
  const [runtime, setRuntime] = React.useState<DesktopDocumentsRuntime | undefined>(getDesktopDocumentsRuntime);
  const [files, setFiles] = React.useState<readonly DesktopDocumentFile[]>([]);
  const [recent, setRecent] = React.useState<readonly Awaited<ReturnType<DesktopDocumentsRuntime['recent']>>[number][]>([]);
  const [selectedFileId, setSelectedFileId] = React.useState<string>();
  const [reader, setReader] = React.useState<DesktopDocumentReader>();
  const [pageNumber, setPageNumber] = React.useState(1);
  const [rendered, setRendered] = React.useState<DesktopDocumentRenderedPage>();
  const [imageUrl, setImageUrl] = React.useState<string>();
  const [query, setQuery] = React.useState('');
  const [results, setResults] = React.useState<readonly DesktopDocumentSearchResult[]>([]);
  const [annotations, setAnnotations] = React.useState<readonly DesktopDocumentAnnotation[]>([]);
  const [ocr, setOcr] = React.useState<Awaited<ReturnType<DesktopDocumentsRuntime['recognizePage']>>>();
  const [ocrJob, setOcrJob] = React.useState<Awaited<ReturnType<DesktopDocumentsRuntime['recognizeDocument']>>>();
  const [note, setNote] = React.useState('');
  const [notice, setNotice] = React.useState('');
  const ru = t.documents === 'Документы';
  const labels = ru
    ? { subtitle: 'PDF, EPUB, Markdown и текст поверх канонических Files · offline-first', search: 'Искать в документах', open: 'Открыть', previous: 'Назад', next: 'Далее', bookmark: 'Закладка', addNote: 'Сохранить заметку', note: 'Приватная заметка к странице', ocrPage: 'Распознать страницу', ocrDocument: 'Распознать документ', outline: 'Оглавление', annotations: 'Аннотации', recent: 'Недавние', files: 'Доступные Files', noFiles: 'Поддерживаемых документов нет.', choose: 'Выберите документ для чтения.', noRuntime: 'Documents host adapter не подключён.', boundary: 'Подключите DocumentService через native host. Источник остаётся в canonical Files; внешняя OCR/AI загрузка не выполняется.', page: 'Страница', chapter: 'Глав', safe: 'STATIC_SAFE', raster: 'RASTER', saved: 'Сохранено локально', noResults: 'Совпадений нет.', ocrDone: 'OCR сохранена локально.' }
    : { subtitle: 'PDF, EPUB, Markdown and text over canonical Files · offline-first', search: 'Search documents', open: 'Open', previous: 'Previous', next: 'Next', bookmark: 'Bookmark', addNote: 'Save note', note: 'Private page note', ocrPage: 'Recognize page', ocrDocument: 'Recognize document', outline: 'Outline', annotations: 'Annotations', recent: 'Recent', files: 'Available Files', noFiles: 'No supported documents.', choose: 'Choose a document to read.', noRuntime: 'Documents host adapter is not connected.', boundary: 'Connect DocumentService through the native host. The source remains in canonical Files; no external OCR/AI upload is performed.', page: 'Page', chapter: 'chapters', safe: 'STATIC_SAFE', raster: 'RASTER', saved: 'Saved locally', noResults: 'No matches.', ocrDone: 'OCR saved locally.' };

  React.useEffect(() => subscribeDesktopDocumentsRuntime(() => setRuntime(getDesktopDocumentsRuntime())), []);
  const refresh = React.useCallback(async () => {
    if (!runtime) { setFiles([]); setRecent([]); return; }
    try {
      const [nextFiles, nextRecent] = await Promise.all([runtime.listSupportedFiles(), runtime.recent()]);
      setFiles(nextFiles); setRecent(nextRecent);
      setSelectedFileId(current => tab.object?.id && nextFiles.some(file => file.fileId === tab.object?.id) ? tab.object.id : current && nextFiles.some(file => file.fileId === current) ? current : nextFiles[0]?.fileId);
      setNotice('');
    } catch (reason) { setNotice(reason instanceof Error ? reason.message : String(reason)); }
  }, [runtime, tab.object?.id]);
  React.useEffect(() => { void refresh(); return () => { reader?.close(); }; }, [refresh]);
  React.useEffect(() => {
    if (!runtime) return undefined;
    const unsubscribe = runtime.subscribe?.(() => { void refresh(); });
    return unsubscribe;
  }, [refresh, runtime]);
  React.useEffect(() => {
    if (!reader || !reader.pages.length) { setRendered(undefined); setImageUrl(undefined); return undefined; }
    const page = Math.max(1, Math.min(pageNumber, reader.pages.length));
    if (page !== pageNumber) { setPageNumber(page); return undefined; }
    let active = true;
    void reader.renderPage(page, { scale: 1 }).then(value => { if (active) { setRendered(value); setImageUrl(value.imageBytes && value.mimeType ? documentBytesToDataUrl(value.imageBytes, value.mimeType) : undefined); } }).catch(reason => { if (active) setNotice(reason instanceof Error ? reason.message : String(reason)); });
    return () => { active = false; };
  }, [reader, pageNumber]);

  const openFile = async (fileId: string) => {
    if (!runtime) return;
    try {
      const nextReader = await runtime.open(fileId);
      const [nextProgress, nextAnnotations] = await Promise.all([runtime.progress(nextReader.document.documentId), runtime.listAnnotations(nextReader.document.documentId)]);
      reader?.close(); setReader(nextReader); setAnnotations(nextAnnotations); setOcr(undefined); setOcrJob(undefined);
      const chapterIndex = nextProgress?.locator.chapterId ? nextReader.pages.findIndex(page => page.locator.chapterId === nextProgress.locator.chapterId) : -1;
      setPageNumber(Math.max(1, Math.min(nextReader.pages.length, nextProgress?.locator.page ?? (chapterIndex >= 0 ? chapterIndex + 1 : 1)))); setNotice('');
    } catch (reason) { setNotice(reason instanceof Error ? reason.message : String(reason)); }
  };
  const currentPage = reader?.pages[pageNumber - 1];
  const saveProgress = async () => { if (!runtime || !reader || !currentPage) return; try { await runtime.saveProgress(reader.document.documentId, currentPage.locator); setNotice(labels.saved); } catch (reason) { setNotice(reason instanceof Error ? reason.message : String(reason)); } };
  const addBookmark = async () => { if (!runtime || !reader || !currentPage) return; try { const value = await runtime.addBookmark({ documentId: reader.document.documentId, locator: currentPage.locator, label: currentPage.text.slice(0, 80) }); setAnnotations(current => [...current.filter(item => item.id !== value.id), value]); setNotice(labels.saved); } catch (reason) { setNotice(reason instanceof Error ? reason.message : String(reason)); } };
  const addNote = async () => { if (!runtime || !reader || !currentPage || !note.trim()) return; try { const value = await runtime.addNote({ documentId: reader.document.documentId, locator: currentPage.locator, body: note.trim() }); setAnnotations(current => [...current.filter(item => item.id !== value.id), value]); setNote(''); setNotice(labels.saved); } catch (reason) { setNotice(reason instanceof Error ? reason.message : String(reason)); } };
  const runSearch = async (event: React.FormEvent) => { event.preventDefault(); if (!runtime || !query.trim()) { setResults([]); return; } try { setResults(reader ? await reader.search(query.trim(), { limit: 64 }) : await runtime.search(query.trim(), { limit: 64 })); } catch (reason) { setNotice(reason instanceof Error ? reason.message : String(reason)); } };
  const recognizePage = async () => { if (!runtime || !reader || !currentPage) return; try { setOcr(await runtime.recognizePage(reader.document.documentId, pageNumber)); setNotice(labels.ocrDone); } catch (reason) { setNotice(reason instanceof Error ? reason.message : String(reason)); } };
  const recognizeDocument = async () => { if (!runtime || !reader) return; try { const value = await runtime.recognizeDocument(reader.document.documentId, { onProgress: setOcrJob }); setOcrJob(value); setNotice(labels.ocrDone); } catch (reason) { setNotice(reason instanceof Error ? reason.message : String(reason)); } };

  if (!runtime) return <div className="object-surface"><div className="surface-kicker"><span className="surface-icon">▥</span><span>{t.documents}</span><span className="surface-badge">HOST ADAPTER</span></div><h1>{t.documents}</h1><p className="surface-description">{labels.noRuntime}</p><div className="adapter-note"><span>⌁</span><div><strong>{ru ? 'Безопасная граница Reader' : 'Safe Reader boundary'}</strong><small>{labels.boundary}</small></div></div></div>;

  return <div className="object-surface documents-surface">
    <div className="surface-kicker"><span className="surface-icon">▥</span><span>{t.documents}</span><span className="surface-badge">LOCAL-FIRST</span></div>
    <div className="web-library-heading"><div><h1>{reader?.document.title ?? t.documents}</h1><p className="surface-description">{labels.subtitle}</p></div><button className="secondary-button" onClick={() => void refresh()}>{t.refresh}</button></div>
    <form className="web-library-toolbar" onSubmit={runSearch}><input value={query} onChange={event => setQuery(event.target.value)} placeholder={labels.search} aria-label={labels.search}/><button className="primary-button" type="submit">⌕</button><span>{files.length} · {recent.length} {labels.recent.toLowerCase()}</span></form>
    {notice ? <p className="web-library-notice">{notice}</p> : null}
    <div className="web-library-layout documents-layout">
      <div className="web-library-list"><span className="section-label">{labels.files}</span>{files.length ? files.map(file => <button key={file.fileId} className={`web-library-entry${file.fileId === selectedFileId ? ' active' : ''}`} onClick={() => { setSelectedFileId(file.fileId); void openFile(file.fileId); }}><strong>{file.filename}</strong><small>{file.mimeType} · {formatDesktopBytes(file.size)}</small></button>) : <div className="web-library-empty">{labels.noFiles}</div>}{recent.length ? <><span className="section-label">{labels.recent}</span>{recent.slice(0, 8).map(item => <button key={item.documentId} className="web-library-entry" onClick={() => void openFile(item.file.fileId)}><strong>{item.title}</strong><small>{item.format} · {item.pageCount} {labels.page.toLowerCase()}</small></button>)}</> : null}<div className="adapter-note"><span>⌁</span><div><strong>{ru ? 'Приватные данные' : 'Private data'}</strong><small>{ru ? 'Progress и annotations принадлежат владельцу устройства и синхронизируются только по explicit own-device пути.' : 'Progress and annotations belong to the device owner and sync only through an explicit own-device path.'}</small></div></div></div>
      <div className="web-library-reader">{reader && currentPage ? <><div className="web-library-reader-heading"><div><h2>{reader.document.title}</h2><p>{reader.document.format} · {reader.document.pageCount} {labels.page.toLowerCase()} · {reader.document.chapterCount} {labels.chapter}</p></div><span className="surface-badge">{rendered?.mode === 'RASTER' ? labels.raster : labels.safe}</span></div><div className="web-library-reader-footer"><div className="web-library-actions"><button className="secondary-button" disabled={pageNumber <= 1} onClick={() => setPageNumber(value => Math.max(1, value - 1))}>{labels.previous}</button><span className="surface-badge">{labels.page} {pageNumber}/{reader.pages.length}</span><button className="secondary-button" disabled={pageNumber >= reader.pages.length} onClick={() => setPageNumber(value => Math.min(reader.pages.length, value + 1))}>{labels.next}</button><button className="secondary-button" onClick={() => void saveProgress()}>↧</button><button className="secondary-button" onClick={() => void addBookmark()}>☆ {labels.bookmark}</button></div><code>{reader.document.revision.revisionId}</code></div>{imageUrl ? <img className="document-reader-image" src={imageUrl} alt={`${reader.document.title} ${labels.page} ${pageNumber}`} /> : null}<div className="web-library-reader-content document-reader-content"><pre>{currentPage.text || (ru ? 'Текстовый слой отсутствует; используйте локальный OCR.' : 'No text layer; use local OCR.')}</pre></div>{ocr ? <div className="adapter-note"><span>⌁</span><div><strong>OCR · {ocr.engine}</strong><small>{ocr.text || (ru ? 'Текст не распознан.' : 'No text recognized.')}</small></div></div> : null}<div className="web-library-actions"><button className="secondary-button" onClick={() => void recognizePage()} disabled={currentPage.textLayer === 'EXTRACTED'}>{labels.ocrPage}</button><button className="secondary-button" onClick={() => void recognizeDocument()}>{labels.ocrDocument}</button>{ocrJob ? <span className="surface-badge">{ocrJob.state} · {ocrJob.completedPages}/{ocrJob.totalPages}</span> : null}</div><div className="document-note-row"><input value={note} onChange={event => setNote(event.target.value)} placeholder={labels.note}/><button className="primary-button" onClick={() => void addNote()} disabled={!note.trim()}>{labels.addNote}</button></div>{reader.outline.length ? <section className="document-section"><span className="section-label">{labels.outline}</span>{reader.outline.slice(0, 64).map(entry => <button className="document-outline-entry" key={entry.id} onClick={() => { if (entry.page) setPageNumber(entry.page); }}>{entry.title}{entry.page ? ` · ${labels.page} ${entry.page}` : ''}</button>)}</section> : null}<section className="document-section"><span className="section-label">{labels.annotations} · {annotations.length}</span>{annotations.slice(0, 32).map(annotation => <div className="document-annotation" key={annotation.id}><strong>{annotation.kind}</strong><span>{annotation.selectedText ?? annotation.body ?? annotation.label ?? ''}</span></div>)}</section></> : <div className="web-library-reader-empty"><div><span>▥</span><p>{labels.choose}</p></div></div>}</div>
    </div>
    {results.length ? <section className="document-search-results"><span className="section-label">{labels.search}</span>{results.map(result => <button key={`${result.documentId}:${result.locator.page ?? result.locator.chapterId ?? result.snippet}`} onClick={() => { if (result.locator.page) setPageNumber(result.locator.page); }}>{result.title} · {result.source} · {result.snippet}</button>)}</section> : query.trim() ? <p className="web-library-notice">{labels.noResults}</p> : null}
    <TypedReferenceDock tab={tab} shell={shell} t={t} />
  </div>;
}

function documentBytesToDataUrl(bytes: Uint8Array, mimeType: string): string | undefined {
  if (typeof btoa !== 'function') return undefined;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)));
  return `data:${mimeType};base64,${btoa(binary)}`;
}

type DesktopInboxView = 'ALL' | 'UNREAD' | 'NEEDS_ACTION' | 'SNOOZED' | 'ARCHIVE';
type DesktopInboxResult = Awaited<ReturnType<DesktopInboxRuntime['inbox']['list']>>;

function InboxSurface({ t }: { t: Copy }) {
  const [runtime, setRuntime] = React.useState<DesktopInboxRuntime | undefined>(getDesktopInboxRuntime);
  const [view, setView] = React.useState<DesktopInboxView>('ALL');
  const [query, setQuery] = React.useState('');
  const [result, setResult] = React.useState<DesktopInboxResult>();
  const [error, setError] = React.useState('');
  const ru = t.inbox === 'Входящие';
  const refresh = React.useCallback(async () => {
    if (!runtime) { setResult(undefined); return; }
    try { setResult(await runtime.inbox.list({ view, query: query.trim() || undefined, limit: 64 })); setError(''); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  }, [runtime, view, query]);
  React.useEffect(() => subscribeDesktopInboxRuntime(() => setRuntime(getDesktopInboxRuntime())), []);
  React.useEffect(() => { if (!runtime) return undefined; const unsubscribe = runtime.inbox.subscribe(() => { void refresh(); }); void refresh(); const timer = window.setInterval(() => { void refresh(); }, 4_000); return () => { unsubscribe(); window.clearInterval(timer); }; }, [runtime, refresh]);
  const local = async (action: 'read' | 'archive' | 'restore' | 'pin' | 'save', item: DesktopInboxResult['items'][number]) => {
    if (!runtime) return;
    try { if (action === 'read') await runtime.inbox.markRead(item.id, !item.organization.read); else if (action === 'archive') await runtime.inbox.archive(item.id); else if (action === 'restore') await runtime.inbox.restore(item.id); else if (action === 'pin') await runtime.inbox.pin(item.id, !item.organization.pinned); else await runtime.inbox.save(item.id, !item.organization.saved); await refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const runSourceAction = async (item: DesktopInboxResult['items'][number], action: DesktopInboxResult['items'][number]['actions'][number]) => {
    if (!runtime) return;
    try { await runtime.inbox.executeAction({ itemId: item.id, action: action.kind, ownerConfirmed: true, send: false }); await refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  if (!runtime) return <div className="object-surface"><div className="surface-kicker"><span className="surface-icon">✉</span><span>{t.inbox}</span><span className="surface-badge">HOST ADAPTER</span></div><h1>{t.inbox}</h1><p className="surface-description">{ru ? 'Universal Inbox host adapter ещё не подключён.' : 'The Universal Inbox host adapter is not connected.'}</p></div>;
  return <div className="object-surface inbox-surface">
    <div className="surface-kicker"><span className="surface-icon">✉</span><span>{t.inbox}</span><span className="surface-badge">LOCAL PROJECTION</span></div>
    <div className="surface-heading"><div><h1>{t.inbox}</h1><p className="surface-description">{ru ? 'Единая локальная проекция: источники остаются authoritative, организация — на этом устройстве.' : 'One local projection: source systems remain authoritative, organization stays on this device.'}</p></div><span className="surface-badge">{result?.unreadCount ?? 0} {ru ? 'непрочитано' : 'unread'}</span></div>
    <div className="surface-toolbar"><input value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void refresh(); }} placeholder={ru ? 'Поиск по локальной проекции' : 'Search local projection'} aria-label={ru ? 'Поиск Inbox' : 'Search Inbox'} /><button className="secondary-button" onClick={() => void refresh()}>{ru ? 'Обновить' : 'Refresh'}</button>{(['ALL', 'UNREAD', 'NEEDS_ACTION', 'SNOOZED', 'ARCHIVE'] as const).map(value => <button key={value} className={view === value ? 'primary-button' : 'secondary-button'} onClick={() => setView(value)}>{value === 'ALL' ? (ru ? 'Все' : 'All') : value === 'UNREAD' ? (ru ? 'Непрочитанные' : 'Unread') : value === 'NEEDS_ACTION' ? (ru ? 'Нужно действие' : 'Needs action') : value === 'SNOOZED' ? (ru ? 'Отложенные' : 'Snoozed') : (ru ? 'Архив' : 'Archive')}</button>)}</div>
    {error ? <p className="surface-error">{error}</p> : null}
    <div className="surface-grid inbox-grid">{result?.items.length ? result.items.map(item => <article className={`surface-card inbox-card${item.organization.read ? '' : ' unread'}`} key={item.id}><div className="inbox-card-heading"><span className="surface-badge">{item.presentation.badge.label}</span><time>{new Date(item.presentation.receivedAt).toLocaleString()}</time></div><h2>{item.presentation.title}</h2>{item.presentation.sender ? <small>{item.presentation.sender}</small> : null}{item.presentation.snippet ? <p>{item.presentation.snippet}</p> : null}<small>{item.presentation.reasons.join(' · ')}</small><div className="surface-actions"><button className="secondary-button" onClick={() => void local('read', item)}>{item.organization.read ? (ru ? 'Непрочитано' : 'Unread') : (ru ? 'Прочитано' : 'Read')}</button><button className="secondary-button" onClick={() => void local(item.organization.archived ? 'restore' : 'archive', item)}>{item.organization.archived ? (ru ? 'Восстановить' : 'Restore') : (ru ? 'Архив' : 'Archive')}</button><button className="secondary-button" onClick={() => void local('pin', item)}>{item.organization.pinned ? '★' : '☆'}</button>{item.actions.map(action => <button key={action.id} className={action.requiresOwnerConfirmation ? 'primary-button' : 'secondary-button'} onClick={() => void (action.kind === 'OPEN_SOURCE' ? runtime.inbox.openSource(item.id).then(() => undefined).catch(reason => setError(reason instanceof Error ? reason.message : String(reason))) : runSourceAction(item, action))}>{action.label}</button>)}</div></article>) : <div className="surface-card"><p>{ru ? 'Inbox пока пуст.' : 'Inbox is empty.'}</p></div>}</div>
  </div>;
}

function PhotosSurface({ tab, shell, t }: { tab: DesktopTab; shell: DesktopShellController; t: Copy }) {
  const [runtime, setRuntime] = React.useState<DesktopPhotosRuntime | undefined>(getDesktopPhotosRuntime);
  const [state, setState] = React.useState<Awaited<ReturnType<DesktopPhotosRuntime['open']>>>();
  const [timeline, setTimeline] = React.useState<Awaited<ReturnType<DesktopPhotosRuntime['timeline']>>>();
  const [albums, setAlbums] = React.useState<readonly DesktopPhotoAlbum[]>([]);
  const [selected, setSelected] = React.useState<DesktopPhotoAsset>();
  const [viewer, setViewer] = React.useState<Awaited<ReturnType<DesktopPhotosRuntime['viewer']>>>();
  const [query, setQuery] = React.useState('');
  const [notice, setNotice] = React.useState('');
  const [mode, setMode] = React.useState<'TIMELINE' | 'ALBUMS' | 'TRASH'>('TIMELINE');
  const ru = t.photos === 'Фотографии';
  const labels = ru ? { subtitle: 'Личная медиатека local-first · оригиналы остаются в content storage', unavailable: 'Photos host ещё не подключён', boundary: 'Подключите MediaLibraryService через typed host adapter. Shell не читает пути и не загружает camera roll автоматически.', timeline: 'Лента', albums: 'Альбомы', favorites: 'Избранное', search: 'Поиск', import: 'Импортировать выбранное', file: 'Выбрать файл', folder: 'Выбрать папку', camera: 'Выбрать Camera Roll', trash: 'Корзина', empty: 'Медиа пока нет', viewer: 'Просмотр', metadata: 'Метаданные', share: 'Поделиться явно', device: 'На устройство', map: 'Карта GPS', restore: 'Восстановить', remove: 'В корзину', local: 'Только локально', selected: 'Выбрано', noLocation: 'GPS не извлечён', locationWarning: 'Перед sharing координаты embedded GPS требуют отдельного решения владельца.', imported: 'Импорт завершён', noAlbums: 'Альбомов нет', refresh: 'Обновить' } : { subtitle: 'Private local-first library · originals remain in content storage', unavailable: 'Photos host is not connected', boundary: 'Connect MediaLibraryService through the typed host adapter. The shell never reads paths and never auto-uploads camera roll.', timeline: 'Timeline', albums: 'Albums', favorites: 'Favorites', search: 'Search', import: 'Import selected', file: 'Choose file', folder: 'Choose folder', camera: 'Choose Camera Roll', trash: 'Trash', empty: 'No media yet', viewer: 'Viewer', metadata: 'Metadata', share: 'Share explicitly', device: 'Send to device', map: 'GPS map', restore: 'Restore', remove: 'Move to trash', local: 'Local only', selected: 'Selected', noLocation: 'No embedded GPS', locationWarning: 'Embedded GPS needs a separate owner decision before sharing.', imported: 'Import complete', noAlbums: 'No albums', refresh: 'Refresh' };

  React.useEffect(() => subscribeDesktopPhotosRuntime(() => setRuntime(getDesktopPhotosRuntime())), []);
  const refresh = React.useCallback(async () => {
    if (!runtime) return;
    try { const [nextState, nextTimeline, nextAlbums] = await Promise.all([runtime.open(), runtime.timeline({ limit: 120, includeTrash: mode === 'TRASH' }), runtime.albums()]); setState(nextState); setTimeline(nextTimeline); setAlbums(nextAlbums); setSelected(current => current && nextTimeline.items.some(item => item.mediaId === current.mediaId) ? current : nextTimeline.items[0]); } catch { setNotice(labels.boundary); }
  }, [labels.boundary, mode, runtime]);
  React.useEffect(() => { void refresh(); }, [refresh]);
  React.useEffect(() => runtime?.subscribe?.(() => { void refresh(); }), [refresh, runtime]);
  const search = async (event: React.FormEvent) => { event.preventDefault(); if (!runtime || !query.trim()) { await refresh(); return; } try { const items = await runtime.search({ query: query.trim(), limit: 120 }); setTimeline({ items, total: items.length, groups: [] }); setNotice(''); } catch { setNotice(labels.boundary); } };
  const select = async (asset: DesktopPhotoAsset) => { setSelected(asset); if (!runtime) return; try { setViewer(await runtime.viewer(asset.mediaId)); } catch { setViewer(undefined); } };
  const importSelected = async (kind: 'SELECTED_FILE' | 'SELECTED_FOLDER' | 'CAMERA_ROLL') => { if (!runtime?.importSelected) { setNotice(labels.boundary); return; } try { const result = await runtime.importSelected({ kind }); setNotice(`${labels.imported}: ${result.imported} · ${result.duplicates} duplicate · ${result.failed} failed`); await refresh(); } catch { setNotice(labels.boundary); } };
  const share = async () => { if (!runtime?.share || !selected) { setNotice(labels.boundary); return; } if (selected.hasEmbeddedLocation && !window.confirm(labels.locationWarning)) return; try { const result = await runtime.share({ mediaId: selected.mediaId, destination: 'MESSAGES', mode: 'COPY', ownerConfirmed: true, ...(selected.hasEmbeddedLocation ? { locationConfirmed: true } : {}) }); setNotice(`${labels.share}: ${result.status}`); } catch { setNotice(labels.boundary); } };
  const map = async () => { if (!runtime?.map) { setNotice(labels.boundary); return; } try { const points = await runtime.map({ ownerConfirmed: true }); setNotice(`${labels.map}: ${points.length}`); } catch { setNotice(labels.boundary); } };
  const changeTrash = async () => { if (!runtime || !selected) return; try { if (mode === 'TRASH' && runtime.restore) await runtime.restore(selected.mediaId); else if (runtime.trash) await runtime.trash(selected.mediaId); await refresh(); } catch { setNotice(labels.boundary); } };

  if (!runtime) return <div className="object-surface photos-surface"><div className="surface-kicker"><span className="surface-icon">▧</span><span>{t.photos}</span><span className="surface-badge">HOST ADAPTER</span></div><h1>{t.photos}</h1><p className="surface-description">{labels.unavailable}</p><div className="adapter-note"><span>◌</span><div><strong>{t.photos}</strong><small>{labels.boundary}</small></div></div></div>;
  const items = timeline?.items ?? [];
  return <div className="object-surface photos-surface" data-photos-tab={tab.object?.id ?? tab.id}>
    <div className="surface-kicker"><span className="surface-icon">▧</span><span>{t.photos}</span><span className="surface-badge">{labels.local}</span></div>
    <div className="surface-heading"><div><h1>{tab.title === 'Media' || tab.title === 'Медиа' ? t.photos : tab.title}</h1><p className="surface-description">{labels.subtitle}</p></div><button className="secondary-button" onClick={() => void refresh()}>{labels.refresh}</button></div>
    <div className="surface-grid"><div className="surface-card"><strong>{labels.timeline}</strong><small>{state?.total ?? 0} · {state?.favorites ?? 0} {labels.favorites}</small></div><div className="surface-card"><strong>{labels.albums}</strong><small>{state?.albums ?? albums.length}</small></div><div className="surface-card"><strong>{labels.trash}</strong><small>{state?.trashed ?? 0}</small></div><div className="surface-card"><strong>{labels.local}</strong><small>{state?.cameraRoll.replace(/_/g, ' ')}</small></div></div>
    <div className="surface-grid"><button className={mode === 'TIMELINE' ? 'primary-button' : 'secondary-button'} onClick={() => { setMode('TIMELINE'); void refresh(); }}>{labels.timeline}</button><button className={mode === 'ALBUMS' ? 'primary-button' : 'secondary-button'} onClick={() => setMode('ALBUMS')}>{labels.albums}</button><button className={mode === 'TRASH' ? 'primary-button' : 'secondary-button'} onClick={() => setMode('TRASH')}>{labels.trash}</button><button className="secondary-button" onClick={() => void importSelected('SELECTED_FILE')}>{labels.file}</button><button className="secondary-button" onClick={() => void importSelected('SELECTED_FOLDER')}>{labels.folder}</button><button className="secondary-button" onClick={() => void importSelected('CAMERA_ROLL')}>{labels.camera}</button><button className="secondary-button" onClick={() => void map()}>{labels.map}</button></div>
    <form className="maps-search" onSubmit={search}><input value={query} onChange={event => setQuery(event.target.value)} placeholder={labels.search} aria-label={labels.search}/><button className="primary-button" disabled={!query.trim()}>{labels.search}</button></form>
    {mode === 'ALBUMS' ? <div className="surface-grid">{albums.length ? albums.map(album => <button className="surface-card" key={album.id} onClick={() => void runtime.album(album.id).then(values => { setTimeline({ items: values, total: values.length, groups: [] }); setMode('TIMELINE'); }).catch(() => setNotice(labels.boundary))}><strong>{album.name}</strong><small>{album.count} · {album.sharing}</small></button>) : <div className="adapter-note"><span>◌</span><div><strong>{labels.noAlbums}</strong><small>{labels.boundary}</small></div></div>}</div> : <div className="surface-grid">{items.length ? items.map(asset => <button className={`surface-card${selected?.mediaId === asset.mediaId ? ' active' : ''}`} key={asset.mediaId} onClick={() => void select(asset)}><strong>{asset.kind === 'VIDEO' ? '▶' : '▧'} {asset.filename}</strong><small>{asset.width && asset.height ? `${asset.width}×${asset.height} · ` : ''}{asset.capturedAt ?? labels.local}{asset.hasEmbeddedLocation ? ' · GPS' : ''}</small><small>{asset.tags.join(' · ') || labels.noLocation}</small></button>) : <div className="adapter-note"><span>◌</span><div><strong>{labels.empty}</strong><small>{labels.boundary}</small></div></div>}</div>}
    {selected && <div className="surface-grid"><div className="surface-card"><strong>{labels.selected}: {selected.filename}</strong><small>{viewer?.metadata ? Object.entries(viewer.metadata).filter(([, value]) => value !== undefined).map(([key, value]) => `${key}: ${value}`).join(' · ') : labels.metadata}</small><small>{viewer?.original ?? '—'} · {viewer?.thumbnail ?? '—'}</small></div><button className="primary-button" onClick={() => void share()}>{labels.share}</button><button className="secondary-button" onClick={() => setNotice(labels.device)}>{labels.device}</button><button className="secondary-button" onClick={() => void changeTrash()}>{mode === 'TRASH' ? labels.restore : labels.remove}</button></div>}
    {notice && <small className="maps-notice">{notice}</small>}
  </div>;
}

function CallsSurface({ t }: { t: Copy }) {
  const [runtime, setRuntime] = React.useState<DesktopCallsRuntime | undefined>(getDesktopCallsRuntime);
  const [, redraw] = React.useReducer(value => value + 1, 0);
  React.useEffect(() => subscribeDesktopCallsRuntime(() => setRuntime(getDesktopCallsRuntime())), []);
  React.useEffect(() => runtime?.calls.subscribe(() => redraw()), [runtime]);
  if (!runtime) return <div className="object-surface"><div className="surface-kicker"><span className="surface-icon">☎</span><span>{t.calls}</span><span className="surface-badge">HOST ADAPTER</span></div><h1>{t.calls}</h1><p className="surface-description">{t.localeUnavailable}</p><div className="adapter-note"><span>◌</span><div><strong>{t.calls}</strong><small>{t.callBoundary}</small></div></div></div>;
  const active = runtime.calls.current()[0];
  const history = runtime.calls.history().slice().reverse().slice(0, 20);
  return <div className="object-surface"><div className="surface-kicker"><span className="surface-icon">☎</span><span>{t.calls}</span><span className="surface-badge">{t.local}</span></div><h1>{t.calls}</h1>{active ? <div className="surface-card"><strong>{active.peerId}</strong><small>{active.mode} · {active.state} · {runtime.localMediaAvailable ? t.callMediaReady : t.callMediaUnavailable}</small><div className="surface-grid">{active.state === 'RINGING' ? <><button className="surface-card" onClick={() => void runtime.calls.accept(active.callId)}>{t.acceptCall}</button><button className="surface-card" onClick={() => void runtime.calls.reject(active.callId)}>{t.rejectCall}</button></> : <><button className="surface-card" onClick={() => void runtime.calls.setMuted(active.callId, active.localMicrophone === 'enabled')}>{active.localMicrophone === 'enabled' ? t.unmute : t.mute}</button><button className="surface-card" onClick={() => void runtime.calls.setCamera(active.callId, active.localCamera !== 'enabled')}>{active.localCamera === 'enabled' ? t.cameraOff : t.cameraOn}</button><button className="surface-card" onClick={() => void (active.localScreen === 'enabled' ? runtime.calls.stopScreenShare(active.callId) : runtime.calls.startScreenShare(active.callId))}>{active.localScreen === 'enabled' ? t.screenOff : t.screenOn}</button><button className="surface-card" onClick={() => void runtime.calls.hangup(active.callId)}>{t.endCall}</button></>}</div></div> : <p className="surface-description">{t.noActiveCall}</p>}{history.length > 0 && <><span className="section-label">{t.callHistory}</span>{history.map(entry => <div className="object-id" key={entry.sessionId}><span>{entry.participant} · {entry.mode}</span><code>{entry.outcome}</code></div>)}</>}</div>;
}

function PublicationSurface({ tab, shell, t }: { tab: DesktopTab; shell: DesktopShellController; t: Copy }) {
  const [runtime, setRuntime] = React.useState<DesktopPublicationRuntime | undefined>(getDesktopPublicationRuntime);
  const [state, setState] = React.useState<DesktopPublicationState | undefined>();
  const [visibility, setVisibility] = React.useState<DesktopPublicationVisibility>('PUBLIC');
  const [preview, setPreview] = React.useState<string>();
  const [busy, setBusy] = React.useState(false);
  const publicationId = tab.object?.id ?? tab.id;
  React.useEffect(() => subscribeDesktopPublicationRuntime(() => setRuntime(getDesktopPublicationRuntime())), []);
  React.useEffect(() => { if (!runtime) return; void runtime.state(publicationId).then(value => { setState(value); if (value) setVisibility(value.visibility); }); }, [runtime, publicationId]);
  const run = async (action: () => Promise<DesktopPublicationState | undefined>) => { setBusy(true); try { const next = await action(); if (next) { setState(next); setVisibility(next.visibility); } } catch { shell.setNotice(t.locked); } finally { setBusy(false); } };
  if (!runtime) return <div className="object-surface"><div className="surface-kicker"><span className="surface-icon">✎</span><span>{t.publication}</span><span className="surface-badge">HOST ADAPTER</span></div><h1>{tab.title}</h1><p className="surface-description">{t.publicationAdapter}</p><div className="adapter-note"><span>◌</span><div><strong>{t.publication}</strong><small>{t.publicationAdapter}</small></div></div></div>;
  const current = state;
  return <div className="object-surface"><div className="surface-kicker"><span className="surface-icon">✎</span><span>{t.publication}</span><span className="surface-badge">{current?.status ?? 'DRAFT'}</span></div><h1>{current?.title ?? tab.title}</h1><p className="surface-description">{t.publicationDisclosure}</p><div className="surface-grid"><div className="surface-card"><strong>{t.status}</strong><small>{current?.status ?? 'DRAFT'} · {current?.revisionNumber ? `${t.revision} ${current.revisionNumber}` : t.draft}</small></div><div className="surface-card"><strong>{t.visibility}</strong><select value={visibility} disabled={busy || current?.status === 'PUBLISHED'} onChange={event => setVisibility(event.target.value as DesktopPublicationVisibility)}><option value="PUBLIC">{t.public}</option><option value="UNLISTED">{t.unlisted}</option><option value="CONTACTS">{t.scoped}</option><option value="FOLLOWERS">{t.scoped}</option><option value="SELECTED_IDENTITIES">{t.scoped}</option><option value="SPACE">{t.scoped}</option></select></div></div><div className="surface-grid"><button className="secondary-button" disabled={busy} onClick={() => void runtime.preview(publicationId).then(value => setPreview(value ? `${value.title} · ${value.publisherIdentity}` : t.noPreview))}>{t.preview}</button>{current?.status === 'PUBLISHED' ? <button className="secondary-button" disabled={busy} onClick={() => void run(() => runtime.unpublish(publicationId))}>{t.unpublish}</button> : <button className="primary-button" disabled={busy} onClick={() => { if (typeof window !== 'undefined' && !window.confirm(t.publishConfirm)) return; void run(() => runtime.publish(publicationId, { visibility, ownerConfirmed: true })); }}>{t.publish}</button>}</div>{preview && <div className="adapter-note"><span>✓</span><div><strong>{t.preview}</strong><small>{preview}</small></div></div>}{current?.link && <div className="object-id"><span>{t.shareLink}</span><code>{current.link}</code></div>}</div>;
}

function PluginsSurface({ t }: { t: Copy }) {
  const [count] = React.useState(0);
  const ru = t.plugins === 'Плагины';
  return <div className="object-surface" data-plugin-surface="true"><div className="surface-kicker"><span className="surface-icon">⊞</span><span>{t.plugins}</span><span className="surface-badge">TRUST BOUNDARY</span></div><h1>{t.plugins}</h1><p className="surface-description">{ru ? 'Плагины расширяют Keystone через capability-filtered PluginHost. Исполняемый код не становится Core и не получает owner authority.' : 'Plugins extend Keystone through the capability-filtered PluginHost. Executable code does not become Core or inherit owner authority.'}</p><div className="surface-grid"><div className="surface-card"><strong>{ru ? 'Установлено' : 'Installed'}</strong><small>{count}</small></div><div className="surface-card"><strong>{ru ? 'Обзор / источники' : 'Discover / Sources'}</strong><small>{ru ? 'Local · File · URL · P2P · USB · Personal Device' : 'Local · File · URL · P2P · USB · Personal Device'}</small></div><div className="surface-card"><strong>{ru ? 'Обновления' : 'Updates'}</strong><small>{ru ? 'Скачивание ≠ применение; расширение capabilities требует review' : 'Downloaded ≠ applied; capability expansion requires review'}</small></div><div className="surface-card"><strong>{ru ? 'Восстановление' : 'Recovery'}</strong><small>{ru ? 'Repair только по exact content address' : 'Repair only by exact content address'}</small></div><div className="surface-card"><strong>{ru ? 'Безопасность' : 'Safety'}</strong><small>{ru ? 'Shared/public output требует SafetySurfaceGate' : 'Shared/public output requires SafetySurfaceGate'}</small></div></div><p className="surface-description">{ru ? 'Источник — provenance, а не authority. Получен ≠ установлен ≠ ��ключён.' : 'A source is provenance, not authority. Received ≠ installed ≠ enabled.'}</p></div>;
}

function HomeSurface({ shell, t }: { shell: DesktopShellController; t: Copy }) {
  const [runtime, setRuntime] = React.useState<DesktopDailyRuntime | undefined>(getDesktopDailyRuntime);
  const [brief, setBrief] = React.useState<DesktopDailyBrief>();
  React.useEffect(() => subscribeDesktopDailyRuntime(() => setRuntime(getDesktopDailyRuntime())), []);
  React.useEffect(() => { if (runtime) void runtime.brief().then(setBrief).catch(() => setBrief(undefined)); }, [runtime]);
  const openDailyItem = (item: DesktopDailyItem) => {
    const type = item.canonicalRef.type.toLowerCase();
    const kind: KeystoneObjectReference['kind'] = type.includes('message') || type === 'conversation' ? 'chat' : type.includes('calendar') || type === 'event' ? 'calendar' : type.includes('file') ? 'file' : type.includes('workboard') || type.includes('task') ? 'workboard' : type.includes('video') ? 'video' : 'unknown';
    shell.openReference({ kind, id: item.canonicalRef.id, label: item.title });
    void runtime?.markSeen?.(item.id);
  };
  return <div className="home-surface"><div className="surface-kicker"><span className="surface-icon">✦</span><span>{t.local}</span><span className="surface-badge">{t.privacy}</span></div><h1>{t.home}</h1><p className="surface-description">A single local-first environment for Keystone objects, workspaces and bounded AI.</p>{runtime && brief && <section className="home-daily" aria-label="Daily Layer"><div className="home-daily-heading"><span className="section-label">{brief.hasRelevantChanges ? 'Daily Layer' : 'Quiet'}</span>{brief.hasRelevantChanges && <button className="secondary-button" onClick={() => void runtime.refresh?.().then(setBrief)}>Refresh</button>}</div>{brief.sections.map(section => <div className="home-daily-section" key={section.id}><h2>{section.title}</h2>{section.items.slice(0, 5).map(item => <button className="home-daily-item" key={item.id} onClick={() => openDailyItem(item)}><span><strong>{item.title}</strong>{item.reason && <small>{item.reason}</small>}</span><b>›</b></button>)}{section.remaining > 0 && <small>{section.remaining} more</small>}</div>)}</section>}<div className="home-grid"><button className="home-card featured" onClick={() => shell.toggleAgentPanel(true)}><span className="card-symbol">✦</span><strong>{t.agent}</strong><small>{t.agentHint}</small><b>Ctrl + Space</b></button><button className="home-card" onClick={() => shell.openReference({ kind: 'profile', id: 'profile-bob', label: 'Bob' })}><span className="card-symbol">◎</span><strong>{t.openBob}</strong><small>{t.openInTab}</small></button><button className="home-card" onClick={() => shell.openReference({ kind: 'chat', id: 'chat-bob', label: 'Chat · Bob' })}><span className="card-symbol">◌</span><strong>{t.openChat}</strong><small>{t.messages}</small></button><button className="home-card" onClick={() => shell.openReference({ kind: 'file', id: 'file-trip-plan', label: 'Trip plan.pdf' })}><span className="card-symbol">▤</span><strong>{t.openFile}</strong><small>{t.files}</small></button><button className="home-card" onClick={() => shell.openReference({ kind: 'space', id: 'collaboration', label: t.collaboration })}><span className="card-symbol">⇄</span><strong>{t.collaboration}</strong><small>{t.local}</small></button></div><div className="home-lower"><div><span className="section-label">{t.workspace}</span><h2>Social · Research · Planning</h2><p>{t.saved}</p></div><button className="secondary-button" onClick={() => shell.openReference({ kind: 'space', id: 'space-trip', label: 'Trip' })}>{t.openSpace}</button></div></div>;
}

function AgentSurface({ shell, t }: { shell: DesktopShellController; t: Copy }) {
  return <div className="agent-surface"><div className="agent-orbit">✦</div><span className="surface-kicker">{t.agent} · {t.local}</span><h1>One assistant, many bounded contexts.</h1><p>{t.agentHint}</p><button className="primary-button" onClick={() => shell.toggleAgentPanel(true)}>{t.ask}</button><div className="agent-rules"><span>✓ {t.privacy}</span><span>✓ No unrestricted tools</span><span>✓ Current object scope only</span></div></div>;
}

function WorkboardSurface({ tab, shell, t }: { tab: DesktopTab; shell: DesktopShellController; t: Copy }) {
  const ru = t.workboard.startsWith('Рабочая');
  const columns = ru ? ['BACKLOG', 'READY', 'RUNNING', 'BLOCKED', 'NEEDS_USER', 'DONE'] : ['BACKLOG', 'READY', 'RUNNING', 'BLOCKED', 'NEEDS_USER', 'DONE'];
  const note = ru ? 'Состояние загружается через AgentWorkboardService host adapter. Shell не дублирует WorkItem и не меняет permissions.' : 'State is supplied by the AgentWorkboardService host adapter. The shell does not copy WorkItems or bypass permissions.';
  return <div className="workboard-surface" data-workboard-id={tab.object?.id ?? tab.id}>
    <div className="surface-kicker"><span className="surface-icon">▥</span><span>{t.workboard}</span><span className="surface-badge">{t.local}</span></div>
    <div className="workboard-heading"><div><h1>{tab.title}</h1><p className="surface-description">{note}</p></div><div className="workboard-actions"><button className="secondary-button" onClick={() => shell.setNotice(`${t.list}: ${tab.title}`)}>{t.list}</button><button className="secondary-button" onClick={() => shell.setNotice(`${t.activity}: ${tab.title}`)}>{t.activity}</button><button className="primary-button" onClick={() => shell.toggleAgentPanel(true)}>{t.agent}</button></div></div>
    <div className="workboard-columns">{columns.map(status => <section className="workboard-column" key={status}><header><strong>{status}</strong><span>0</span></header>{status === 'NEEDS_USER' && <button className="workboard-empty-action" onClick={() => shell.setNotice(t.needsUser)}>{t.needsUser}</button>}<p>{ru ? 'Нет локально загруженных элементов' : 'No locally loaded items'}</p></section>)}</div>
  </div>;
}

type DesktopContactView = 'ALL' | 'FAVORITES' | 'TRASH' | 'ORGANIZATIONS' | 'PEOPLE';

function ContactsSurface({ tab, shell, t }: { tab: DesktopTab; shell: DesktopShellController; t: Copy }) {
  const [runtime, setRuntime] = React.useState<DesktopContactsRuntime | undefined>(getDesktopContactsRuntime);
  const [view, setView] = React.useState<DesktopContactView>('ALL');
  const [query, setQuery] = React.useState('');
  const [page, setPage] = React.useState<{ readonly items: readonly DesktopContact[]; readonly total: number }>();
  const [groups, setGroups] = React.useState<readonly { readonly id: string; readonly name: string; readonly contactCount: number }[]>([]);
  const [selectedId, setSelectedId] = React.useState<string>();
  const [newName, setNewName] = React.useState('');
  const [newEmail, setNewEmail] = React.useState('');
  const [notice, setNotice] = React.useState('');
  const ru = t.home === 'Главная';
  const labels = ru
    ? { title: 'Контакты', subtitle: 'Личная адресная книга · local-first', search: 'Поиск контактов…', all: 'Все', favorites: 'Избранные', people: 'Люди', organizations: 'Организации', trash: 'Корзина', add: 'Добавить контакт', name: 'Имя', email: 'Электронная почта', create: 'Создать', empty: 'Контактов нет', unavailable: 'ContactService host ещё не подключён', boundary: 'Подключите существующий ContactService через typed host adapter. Приватные заметки не попадают в renderer projection.', favorite: 'Избранное', identity: 'Связанные Identity', noIdentity: 'Явная ссылка на Identity не добавлена', trashAction: 'В корзину', restore: 'Восстановить', groups: 'Группы', noGroups: 'Групп нет' }
    : { title: 'Contacts', subtitle: 'Personal address book · local-first', search: 'Search contacts…', all: 'All', favorites: 'Favorites', people: 'People', organizations: 'Organizations', trash: 'Trash', add: 'Add contact', name: 'Name', email: 'Email', create: 'Create', empty: 'No contacts', unavailable: 'ContactService host is not connected', boundary: 'Connect the existing ContactService through the typed host adapter. Private notes never enter the renderer projection.', favorite: 'Favorite', identity: 'Linked Identities', noIdentity: 'No explicit Identity link', trashAction: 'Move to trash', restore: 'Restore', groups: 'Groups', noGroups: 'No groups' };
  const refresh = React.useCallback(async () => {
    if (!runtime) { setPage(undefined); setGroups([]); return; }
    try {
      const [nextPage, nextGroups] = await Promise.all([
        runtime.contacts({ view, query: query.trim() || undefined, includePrivateNotes: false, limit: 128 }),
        runtime.groups(),
      ]);
      setPage(nextPage); setGroups(nextGroups); setSelectedId(current => current && nextPage.items.some(contact => contact.id === current) ? current : nextPage.items[0]?.id); setNotice('');
    } catch (error) { setNotice(error instanceof Error ? error.message : labels.unavailable); }
  }, [labels.unavailable, query, runtime, view]);
  React.useEffect(() => subscribeDesktopContactsRuntime(() => setRuntime(getDesktopContactsRuntime())), []);
  React.useEffect(() => { if (!runtime?.subscribe) return undefined; return runtime.subscribe(() => void refresh()); }, [refresh, runtime]);
  React.useEffect(() => { void refresh(); }, [refresh]);
  const run = async (action: () => Promise<unknown>) => { try { await action(); await refresh(); } catch (error) { setNotice(error instanceof Error ? error.message : labels.unavailable); } };
  const create = async (event: React.FormEvent) => { event.preventDefault(); if (!runtime || !newName.trim()) return; await run(() => runtime.create({ displayName: newName.trim(), ...(newEmail.trim() ? { emails: [{ value: newEmail.trim(), preferred: true }] } : {}) })); setNewName(''); setNewEmail(''); };
  const selected = page?.items.find(contact => contact.id === selectedId);
  const views: readonly [DesktopContactView, string][] = [['ALL', labels.all], ['FAVORITES', labels.favorites], ['PEOPLE', labels.people], ['ORGANIZATIONS', labels.organizations], ['TRASH', labels.trash]];
  if (!runtime) return <div className="object-surface"><div className="surface-kicker"><span className="surface-icon">◎</span><span>{labels.title}</span><span className="surface-badge">HOST ADAPTER</span></div><h1>{tab.title || labels.title}</h1><p className="surface-description">{labels.unavailable}</p><div className="adapter-note"><span>⌁</span><div><strong>{labels.title}</strong><small>{labels.boundary}</small></div></div></div>;
  return <div className="contacts-surface">
    <div className="surface-kicker"><span className="surface-icon">◎</span><span>{labels.title}</span><span className="surface-badge">{labels.subtitle}</span></div>
    <div className="surface-heading"><div><h1>{tab.title === 'Contacts' || tab.title === 'Контакты' ? labels.title : tab.title}</h1><p className="surface-description">{labels.subtitle}</p></div><button className="primary-button" onClick={() => shell.toggleAgentPanel(true)}>{t.agent}</button></div>
    <div className="tasks-toolbar"><div className="tasks-view-switcher">{views.map(([value, label]) => <button key={value} className={view === value ? 'active' : ''} onClick={() => setView(value)}>{label}</button>)}</div><span>{page?.total ?? 0}</span></div>
    <div className="tasks-quick-add"><input value={query} onChange={event => setQuery(event.target.value)} placeholder={labels.search} aria-label={labels.search}/></div>
    <form className="contacts-create" onSubmit={create}><input value={newName} onChange={event => setNewName(event.target.value)} placeholder={labels.name} aria-label={labels.name}/><input type="email" value={newEmail} onChange={event => setNewEmail(event.target.value)} placeholder={labels.email} aria-label={labels.email}/><button className="primary-button" type="submit">{labels.create}</button></form>
    {notice && <div className="tasks-notice">{notice}</div>}
    <div className="tasks-layout"><main className="tasks-list">{page?.items.length ? page.items.map(contact => <article className={contact.id === selectedId ? 'tasks-row active' : 'tasks-row'} key={contact.id} onClick={() => setSelectedId(contact.id)}><button className="tasks-check" aria-label={labels.favorite} onClick={event => { event.stopPropagation(); void run(() => runtime.favorite(contact.id, !contact.favorite)); }}>{contact.favorite ? '★' : '☆'}</button><div className="tasks-row-copy"><strong>{contact.displayName}</strong><small>{contact.emails[0]?.value ?? contact.phones[0]?.value ?? contact.organization?.name ?? ''}{contact.tags.length ? ` · ${contact.tags.join(', ')}` : ''}</small></div><button className="secondary-button" onClick={event => { event.stopPropagation(); void run(() => view === 'TRASH' ? runtime.restore(contact.id) : runtime.trash(contact.id)); }}>{view === 'TRASH' ? labels.restore : labels.trashAction}</button></article>) : <div className="adapter-note"><span>◎</span><div><strong>{labels.empty}</strong><small>{labels.boundary}</small></div></div>}</main><aside className="tasks-detail">{selected ? <><span className="section-label">{selected.kind === 'ORGANIZATION' ? labels.organizations : labels.people}</span><h2>{selected.displayName}</h2>{selected.organization && <p>{[selected.organization.name, selected.organization.jobTitle, selected.organization.department].filter(Boolean).join(' · ')}</p>}{selected.emails.map(email => <small key={email.id}>{email.label ? `${email.label}: ` : ''}{email.value}</small>)}{selected.phones.map(phone => <small key={phone.id}>{phone.label ? `${phone.label}: ` : ''}{phone.value}</small>)}<span className="section-label">{labels.identity}</span>{selected.linkedIdentityIds.length ? selected.linkedIdentityIds.map(identityId => <small key={identityId}>{identityId}</small>) : <small>{labels.noIdentity}</small>}<span className="section-label">{labels.groups}</span>{selected.groupIds.length ? selected.groupIds.map(groupId => <small key={groupId}>{groups.find(group => group.id === groupId)?.name ?? groupId}</small>) : <small>{labels.noGroups}</small>}</> : <div className="tasks-detail-empty">{labels.empty}</div>}</aside></div>
  </div>;
}

type DesktopTaskView = 'INBOX' | 'TODAY' | 'UPCOMING' | 'ALL' | 'COMPLETED' | 'OVERDUE' | 'SOMEDAY' | 'ASSIGNED_TO_ME' | 'SHARED' | 'TRASH';

function TasksSurface({ tab, shell, t }: { tab: DesktopTab; shell: DesktopShellController; t: Copy }) {
  const [runtime, setRuntime] = React.useState<DesktopTaskRuntime | undefined>(getDesktopTasksRuntime);
  const [view, setView] = React.useState<DesktopTaskView>(tab.object?.id === 'today' ? 'TODAY' : tab.object?.id === 'overdue' ? 'OVERDUE' : 'INBOX');
  const [page, setPage] = React.useState<{ readonly items: readonly DesktopTask[]; readonly total: number }>();
  const [lists, setLists] = React.useState<readonly { readonly id: string; readonly name: string; readonly scope: string; readonly memberCount: number }[]>([]);
  const [query, setQuery] = React.useState('');
  const [quick, setQuick] = React.useState('');
  const [preview, setPreview] = React.useState<ReturnType<DesktopTaskRuntime['previewQuickCapture']>>();
  const [selectedId, setSelectedId] = React.useState<string>();
  const [notice, setNotice] = React.useState('');
  const ru = t.home === 'Главная';
  const labels = ru
    ? { title: 'Задачи', subtitle: 'Личные планы, сроки и напоминания · local-first', inbox: 'Входящие', today: 'Сегодня', upcoming: 'Предстоящие', all: 'Все', completed: 'Завершённые', overdue: 'Просроченные', someday: 'Когда-нибудь', shared: 'Общие', trash: 'Корзина', search: 'Поиск задач…', add: 'Добавить задачу', preview: 'Предпросмотр', empty: 'Задач нет', unavailable: 'TaskService host ещё не подключён', boundary: 'Подключите существующий TaskService через typed host adapter. Shell не создаёт второй store, календарь или scheduler.', complete: 'Готово', reopen: 'Открыть снова', trashAction: 'В корзину', local: 'Сначала локально', list: 'список', due: 'Срок', ambiguous: 'Дата неоднозначна' }
    : { title: 'Tasks', subtitle: 'Personal planning, due dates and reminders · local-first', inbox: 'Inbox', today: 'Today', upcoming: 'Upcoming', all: 'All', completed: 'Completed', overdue: 'Overdue', someday: 'Someday', shared: 'Shared', trash: 'Trash', search: 'Search tasks…', add: 'Add task', preview: 'Preview', empty: 'No tasks', unavailable: 'TaskService host is not connected', boundary: 'Connect the existing TaskService through the typed host adapter. The shell never creates a second store, calendar or scheduler.', complete: 'Complete', reopen: 'Reopen', trashAction: 'Move to trash', local: 'Local-first', list: 'list', due: 'Due', ambiguous: 'Ambiguous date' };
  const refresh = React.useCallback(async () => {
    if (!runtime) { setPage(undefined); setLists([]); return; }
    try {
      const [nextPage, nextLists] = await Promise.all([runtime.tasks({ view, query: query.trim() || undefined, includeTrash: view === 'TRASH', limit: 128 }), runtime.lists()]);
      setPage(nextPage); setLists(nextLists); setSelectedId(current => current && nextPage.items.some(task => task.id === current) ? current : nextPage.items[0]?.id); setNotice('');
    } catch (error) { setNotice(error instanceof Error ? error.message : labels.unavailable); }
  }, [labels.unavailable, query, runtime, view]);
  React.useEffect(() => subscribeDesktopTasksRuntime(() => setRuntime(getDesktopTasksRuntime())), []);
  React.useEffect(() => { if (!runtime?.subscribe) return undefined; const unsubscribe = runtime.subscribe(() => void refresh()); return unsubscribe; }, [refresh, runtime]);
  React.useEffect(() => { void refresh(); }, [refresh]);
  React.useEffect(() => { if (!quick.trim() || !runtime) { setPreview(undefined); return; } try { setPreview(runtime.previewQuickCapture(quick, { locale: ru ? 'ru' : 'en' })); } catch { setPreview(undefined); } }, [quick, ru, runtime]);

  const run = async (action: () => Promise<unknown>) => { try { await action(); await refresh(); } catch (error) { setNotice(error instanceof Error ? error.message : labels.unavailable); } };
  const add = async (event: React.FormEvent) => { event.preventDefault(); if (!runtime || !quick.trim()) return; await run(() => runtime.quickCapture(quick.trim(), { locale: ru ? 'ru' : 'en' })); setQuick(''); setPreview(undefined); };
  const selected = page?.items.find(task => task.id === selectedId);
  const views: readonly [DesktopTaskView, string][] = [['INBOX', labels.inbox], ['TODAY', labels.today], ['UPCOMING', labels.upcoming], ['ALL', labels.all], ['COMPLETED', labels.completed], ['OVERDUE', labels.overdue], ['SOMEDAY', labels.someday], ['SHARED', labels.shared], ['TRASH', labels.trash]];
  if (!runtime) return <div className="object-surface"><div className="surface-kicker"><span className="surface-icon">✓</span><span>{labels.title}</span><span className="surface-badge">HOST ADAPTER</span></div><h1>{tab.title || labels.title}</h1><p className="surface-description">{labels.unavailable}</p><div className="adapter-note"><span>⌁</span><div><strong>{labels.title}</strong><small>{labels.boundary}</small></div></div></div>;
  return <div className="tasks-surface">
    <div className="surface-kicker"><span className="surface-icon">✓</span><span>{labels.title}</span><span className="surface-badge">{labels.local}</span></div>
    <div className="surface-heading"><div><h1>{tab.title === 'Tasks' || tab.title === 'Задачи' ? labels.title : tab.title}</h1><p className="surface-description">{labels.subtitle}</p></div><button className="primary-button" onClick={() => shell.toggleAgentPanel(true)}>{t.agent}</button></div>
    <div className="tasks-toolbar"><div className="tasks-view-switcher">{views.map(([value, label]) => <button key={value} className={view === value ? 'active' : ''} onClick={() => setView(value)}>{label}</button>)}</div><span>{page?.total ?? 0} · {lists.length} {labels.list}</span></div>
    <form className="tasks-quick-add" onSubmit={add}><input value={quick} onChange={event => setQuick(event.target.value)} placeholder={labels.add} aria-label={labels.add}/><button className="primary-button" type="submit">＋</button></form>
    {preview && <div className="tasks-preview"><span>{labels.preview}</span><strong>{preview.title}</strong>{preview.due && <small>{labels.due}: {preview.due.value}{preview.ambiguous ? ` · ${labels.ambiguous}` : ''}</small>}</div>}
    {notice && <div className="tasks-notice">{notice}</div>}
    <div className="tasks-layout"><main className="tasks-list">{page?.items.length ? page.items.map(task => <article className={task.id === selectedId ? 'tasks-row active' : 'tasks-row'} key={task.id} onClick={() => setSelectedId(task.id)}><button className="tasks-check" aria-label={task.status === 'COMPLETED' ? labels.reopen : labels.complete} onClick={event => { event.stopPropagation(); void run(() => task.status === 'COMPLETED' ? runtime.reopen(task.id) : runtime.complete(task.id)); }}>{task.status === 'COMPLETED' ? '✓' : '○'}</button><div className="tasks-row-copy"><strong>{task.title}</strong><small>{task.priority !== 'NONE' ? task.priority : ''}{task.due ? ` · ${labels.due} ${task.due.value}` : ''}{task.tags.length ? ` · ${task.tags.join(', ')}` : ''}</small></div><button className="secondary-button" onClick={event => { event.stopPropagation(); void run(() => runtime.trash(task.id)); }}>{labels.trashAction}</button></article>) : <div className="adapter-note"><span>✓</span><div><strong>{labels.empty}</strong><small>{labels.boundary}</small></div></div>}</main><aside className="tasks-detail">{selected ? <><span className="section-label">{labels.title}</span><h2>{selected.title}</h2><p>{selected.note ?? labels.empty}</p><small>{selected.listId} · {selected.status} · r{selected.updatedAt}</small>{selected.parentId && <small>Parent: {selected.parentId}</small>}{selected.reminders.length > 0 && <div className="surface-card"><strong>Reminders</strong>{selected.reminders.map(reminder => <small key={reminder.id}>{reminder.kind} · {reminder.at?.value ?? reminder.minutesBefore ?? ''}</small>)}</div>}</> : <div className="tasks-detail-empty">{labels.empty}</div>}</aside></div>
  </div>;
}

function CollaborationSurface({ tab, shell, t }: { tab: DesktopTab; shell: DesktopShellController; t: Copy }) {
  const [runtime, setRuntime] = React.useState<DesktopCollaborationRuntime | undefined>(getDesktopCollaborationRuntime);
  const [objects, setObjects] = React.useState<ReturnType<DesktopCollaborationRuntime['collaboration']['listObjects']>>([]);
  const [selectedId, setSelectedId] = React.useState<string>();
  const ru = t.collaboration.startsWith('Совмест');
  const labels = ru ? { unavailable: 'Collaboration host ещё не подключён', boundary: 'Подключите CollaborationService через typed host adapter. Shell не создаёт shared state сам.', empty: 'Нет shared objects', refresh: 'Обновить', participants: 'Участники', invitations: 'Приглашения', pending: 'В очереди', epoch: 'Epoch', local: 'Сначала локально' } : { unavailable: 'Collaboration host is not connected', boundary: 'Connect CollaborationService through the typed host adapter. The shell never invents shared state.', empty: 'No shared objects', refresh: 'Refresh', participants: 'Participants', invitations: 'Invitations', pending: 'Pending', epoch: 'Epoch', local: 'Local-first' };
  const refresh = React.useCallback(() => { if (!runtime) return; const next = runtime.collaboration.listObjects(); setObjects(next); setSelectedId(value => value && next.some(object => object.id === value) ? value : next[0]?.id); }, [runtime]);
  React.useEffect(() => subscribeDesktopCollaborationRuntime(() => setRuntime(getDesktopCollaborationRuntime())), []);
  React.useEffect(() => { refresh(); if (!runtime) return; return runtime.collaboration.subscribe(refresh); }, [refresh, runtime]);
  const selected = objects.find(object => object.id === selectedId);
  if (!runtime) return <div className="object-surface"><div className="surface-kicker"><span className="surface-icon">⇄</span><span>{t.collaboration}</span><span className="surface-badge">HOST ADAPTER</span></div><h1>{tab.title}</h1><p className="surface-description">{labels.unavailable}</p><div className="adapter-note"><span>◌</span><div><strong>{t.collaboration}</strong><small>{labels.boundary}</small></div></div></div>;
  return <div className="object-surface" data-collaboration-surface="true"><div className="surface-kicker"><span className="surface-icon">⇄</span><span>{t.collaboration}</span><span className="surface-badge">{labels.local}</span></div><div className="surface-heading"><div><h1>{tab.title}</h1><p className="surface-description">Yjs state-vector deltas, scoped roles and expiring presence. Presence never enters durable history.</p></div><button className="secondary-button" onClick={refresh}>{labels.refresh}</button></div><div className="surface-grid">{objects.length ? objects.map(object => <button className={`surface-card${object.id === selectedId ? ' active' : ''}`} key={object.id} onClick={() => setSelectedId(object.id)}><strong>{object.kind} · {object.id}</strong><small>{labels.epoch} {object.epoch} · {object.participants.length} {labels.participants} · {object.pendingUpdates} {labels.pending}</small></button>) : <div className="adapter-note"><span>◌</span><div><strong>{labels.empty}</strong><small>{labels.boundary}</small></div></div>}</div>{selected && <div className="surface-grid"><div className="surface-card"><strong>{labels.participants}</strong>{selected.participants.map(participant => <small key={participant.identityId}>{participant.identityId} · {participant.role} · {participant.status}</small>)}</div><div className="surface-card"><strong>{labels.invitations}</strong>{selected.invitations.length ? selected.invitations.map(invitation => <small key={invitation.id}>{invitation.invitee} · {invitation.role} · {invitation.status}</small>) : <small>{labels.empty}</small>}</div></div>}{selected && <button className="primary-button" onClick={() => shell.setNotice(`${t.collaboration}: ${selected.id}`)}>{t.askAbout}</button>}</div>;
}

function BrowserSurface({ tab, shell, t }: { tab: DesktopTab; shell: DesktopShellController; t: Copy }) {
  const [webLibraryRuntime, setWebLibraryRuntime] = React.useState<DesktopWebLibraryRuntime | undefined>(getDesktopWebLibraryRuntime);
  const state = shell.browserState(tab.id);
  const page = state?.page;
  const activity = state?.activity ?? tab.browserActivity ?? 'IDLE';
  const ru = t.browserPrivacy.startsWith('Страницы');
  const pageLabel = ru ? 'Страница браузера' : 'Browser page';
  const takeControl = ru ? 'Взять управление' : 'Take control';
  const resumeAgent = ru ? 'Продолжить агента' : 'Resume agent';
  const manualHint = ru ? 'Ручное действие делает старые ссылки страницы недействительными.' : 'Manual actions invalidate stale page references.';
  const resumeHint = ru ? 'Typed intents остаются ограниченными BrowserPolicy.' : 'Typed intents remain bounded by BrowserPolicy.';
  React.useEffect(() => subscribeDesktopWebLibraryRuntime(() => setWebLibraryRuntime(getDesktopWebLibraryRuntime())), []);
  const savePage = async (mode: 'READER_SNAPSHOT' | 'SAFE_PAGE_ARCHIVE') => { if (!page?.url || !webLibraryRuntime?.captureFromBrowser) { shell.setNotice(ru ? 'Web Library host не подключён.' : 'Web Library host is not connected.'); return; } try { await webLibraryRuntime.captureFromBrowser({ url: page.url, title: page.title, mode }); shell.setNotice(ru ? 'Страница сохранена локально.' : 'Page saved locally.'); } catch { shell.setNotice(ru ? 'Не удалось сохранить страницу.' : 'Page could not be saved.'); } };
  return <div className="browser-surface"><div className="browser-toolbar"><span className="browser-lock">⌁</span><code>{page?.url ?? tab.url ?? 'about:blank'}</code><span className="surface-badge">SANDBOX</span><span className="surface-badge">{activity}</span></div>{page ? <div className="browser-page-preview"><div className="surface-kicker"><span className="surface-icon">◎</span><span>{pageLabel}</span><span className="surface-badge">{page.dataClass}</span></div><h1>{page.title || pageLabel}</h1><p className="surface-description">{t.browserPrivacy}</p><div className="object-id"><span>{ru ? 'Origin · revision' : 'Origin · revision'}</span><code>{page.origin} · {page.pageRevision}</code></div><p className="browser-untrusted">{ru ? 'UNTRUSTED-КОНТЕНТ СТРАНИЦЫ' : 'UNTRUSTED PAGE CONTENT'} · {page.interactiveCount ?? 0} {ru ? 'семантических элементов' : 'semantic controls'}</p><div className="surface-grid"><button className="surface-card" onClick={() => void savePage('READER_SNAPSHOT')}><span>▤</span><strong>{ru ? 'Сохранить Reader' : 'Save Reader snapshot'}</strong><small>{ru ? 'Явное сохранение в Web Library' : 'Explicit save to Web Library'}</small></button><button className="surface-card" onClick={() => void savePage('SAFE_PAGE_ARCHIVE')}><span>▣</span><strong>{ru ? 'Сохранить offline' : 'Save safe archive'}</strong><small>{ru ? 'Статическая копия без JS и форм' : 'Static copy without JS or forms'}</small></button><button className="surface-card" onClick={() => shell.toggleAgentPanel(true)}><span>✦</span><strong>{t.agent}</strong><small>{t.agentHint}</small></button><button className="surface-card" onClick={() => { shell.setBrowserActivity(tab.id, 'PAUSED', true); shell.setNotice(ru ? 'Browser agent приостановлен для ручного управления.' : 'Browser agent paused for human takeover.'); }}><span>Ⅱ</span><strong>{takeControl}</strong><small>{manualHint}</small></button><button className="surface-card" onClick={() => { shell.setBrowserActivity(tab.id, 'IDLE', false); shell.setNotice(ru ? 'Browser agent может продолжить через host adapter.' : 'Browser agent may resume through the host adapter.'); }}><span>▶</span><strong>{resumeAgent}</strong><small>{resumeHint}</small></button></div></div> : <div className="browser-empty"><span className="browser-globe">◎</span><h1>{ru ? 'Поверхность браузера' : 'Browser surface'}</h1><p>{t.browserPrivacy}</p><small>{t.placeholder}</small></div>}</div>;
}

function SubscriptionsSurface({ tab, shell, t }: { tab: DesktopTab; shell: DesktopShellController; t: Copy }) {
  const [runtime, setRuntime] = React.useState<DesktopSubscriptionsRuntime | undefined>(getDesktopSubscriptionsRuntime);
  const [subscriptions, setSubscriptions] = React.useState<readonly { readonly id: string; readonly title: string; readonly hostname: string; readonly unreadCount: number; readonly state: string }[]>([]);
  const [folders, setFolders] = React.useState<readonly { readonly id: string; readonly name: string; readonly subscriptionCount: number }[]>([]);
  const [entries, setEntries] = React.useState<readonly DesktopSubscriptionEntry[]>([]);
  const [selectedId, setSelectedId] = React.useState(tab.object?.id !== 'subscriptions' ? tab.object?.id : undefined);
  const [reader, setReader] = React.useState<DesktopSubscriptionReader>();
  const [query, setQuery] = React.useState('');
  const [filter, setFilter] = React.useState<'ALL' | 'UNREAD' | 'FAVORITES' | 'PODCASTS'>('ALL');
  const [folderId, setFolderId] = React.useState('');
  const [notice, setNotice] = React.useState('');
  const ru = t.home === 'Главная';
  const labels = ru
    ? { title: 'Подписки', subtitle: 'Локальные RSS, Atom, JSON Feed и подкасты', all: 'Все', unread: 'Непрочитанные', favorites: 'Избранное', podcasts: 'Подкасты', search: 'Поиск по подпискам', add: 'Добавить URL', refresh: 'Обновить', read: 'Прочитано', unreadAction: 'Непрочитано', favorite: 'В избранное', unfavorite: 'Убрать из избранного', open: 'Открыть оригинал', share: 'Поделиться ссылкой', save: 'Сохранить в Web Library', continue: 'Продолжить на устройстве', download: 'Скачать явно', play: 'Воспроизвести', noReader: 'Выберите элемент', empty: 'Нет материалов', unavailable: 'Subscriptions host ещё не подключён', boundary: 'Подключите SubscriptionService через typed host adapter. Origin и enclosure storage не читаются shell напрямую.', noFolders: 'Без папки', safe: 'Sanitized local reader · 0 external requests', noRuntime: 'Хост подписок недоступен' }
    : { title: 'Subscriptions', subtitle: 'Local RSS, Atom, JSON Feed and podcasts', all: 'All', unread: 'Unread', favorites: 'Favorites', podcasts: 'Podcasts', search: 'Search subscriptions', add: 'Add URL', refresh: 'Refresh', read: 'Read', unreadAction: 'Unread', favorite: 'Favorite', unfavorite: 'Remove favorite', open: 'Open original', share: 'Share link', save: 'Save to Web Library', continue: 'Continue on device', download: 'Download explicitly', play: 'Play', noReader: 'Choose an item', empty: 'No feed items', unavailable: 'Subscriptions host is not connected', boundary: 'Connect SubscriptionService through a typed host adapter. The shell never reads origins or enclosure storage directly.', noFolders: 'Unfiled', safe: 'Sanitized local reader · 0 external requests', noRuntime: 'Subscriptions host unavailable' };

  React.useEffect(() => subscribeDesktopSubscriptionsRuntime(() => setRuntime(getDesktopSubscriptionsRuntime())), []);
  const refresh = React.useCallback(async () => {
    if (!runtime) { setSubscriptions([]); setFolders([]); setEntries([]); setReader(undefined); return; }
    try {
      const [nextSubscriptions, nextFolders, page] = await Promise.all([
        runtime.listSubscriptions(), runtime.listFolders(), runtime.listEntries({ ...(filter === 'UNREAD' ? { readState: 'UNREAD' as const } : {}), ...(filter === 'FAVORITES' ? { favorite: true } : {}), ...(filter === 'PODCASTS' ? { podcastsOnly: true } : {}), ...(query.trim() ? { query: query.trim() } : {}), ...(folderId ? { folderId } : {}), limit: 128 }),
      ]);
      setSubscriptions(nextSubscriptions); setFolders(nextFolders); setEntries(page.items);
      setSelectedId(current => current && page.items.some(entry => entry.id === current) ? current : page.items[0]?.id);
      setNotice('');
    } catch { setNotice(labels.unavailable); }
  }, [filter, folderId, labels.unavailable, query, runtime]);
  React.useEffect(() => { void refresh(); }, [refresh]);
  React.useEffect(() => { if (!runtime?.subscribe) return; const unsubscribe = runtime.subscribe(() => void refresh()); return unsubscribe; }, [refresh, runtime]);
  React.useEffect(() => { if (!runtime || !selectedId) { setReader(undefined); return; } void runtime.reader(selectedId).then(setReader).catch(() => setReader(undefined)); }, [runtime, selectedId]);

  const selected = entries.find(entry => entry.id === selectedId);
  const run = async (action: () => Promise<unknown>) => { try { await action(); await refresh(); } catch (error) { setNotice(error instanceof Error ? error.message : labels.unavailable); } };
  const addSubscription = async () => { if (!runtime?.add) { setNotice(labels.unavailable); return; } const url = window.prompt(labels.add, 'https://'); if (!url?.trim()) return; await run(() => runtime.add!({ url: url.trim(), ownerConfirmed: true })); };
  const toggleRead = () => selected && runtime?.markRead ? void run(() => runtime.markRead!(selected.id, selected.readState !== 'READ')) : undefined;
  const toggleFavorite = () => selected && runtime?.setFavorite ? void run(() => runtime.setFavorite!(selected.id, !selected.favorite)) : undefined;
  const refreshSelected = () => { const subscriptionId = selected?.subscriptionId; if (subscriptionId && runtime?.refresh) void run(() => runtime.refresh!(subscriptionId)); else void refresh(); };
  const openOriginal = () => selected && runtime?.openOriginal ? void run(() => runtime.openOriginal!(selected.id)) : setNotice(labels.unavailable);
  const shareEntry = () => selected && runtime?.shareEntry ? void run(() => runtime.shareEntry!(selected.id)) : setNotice(labels.unavailable);
  const saveArticle = () => selected && runtime?.saveArticle ? void run(() => runtime.saveArticle!(selected.id)) : setNotice(labels.unavailable);
  const continueEntry = () => selected && runtime?.continueEntry ? void run(() => runtime.continueEntry!(selected.id, { kind: selected.enclosures.length ? 'PODCAST' : 'ARTICLE', ...(selected.enclosures[0] ? { enclosureId: selected.enclosures[0].id } : {}) })) : setNotice(labels.unavailable);
  const download = (enclosureId: string) => selected && runtime?.downloadEnclosure ? void run(() => runtime.downloadEnclosure!(selected.id, enclosureId)) : setNotice(labels.unavailable);
  const play = (enclosureId: string) => selected && runtime?.playEnclosure ? void run(() => runtime.playEnclosure!(selected.id, enclosureId)) : setNotice(labels.unavailable);

  if (!runtime) return <div className="object-surface"><div className="surface-kicker"><span className="surface-icon">◴</span><span>{t.subscriptions}</span><span className="surface-badge">{t.local}</span></div><h1>{labels.title}</h1><p className="surface-description">{labels.unavailable}</p><div className="adapter-note"><span>◌</span><div><strong>{labels.noRuntime}</strong><small>{labels.boundary}</small></div></div></div>;
  return <div className="subscriptions-surface" data-subscriptions-surface="true"><div className="surface-kicker"><span className="surface-icon">◴</span><span>{t.subscriptions}</span><span className="surface-badge">{t.local}</span></div><div className="surface-heading"><div><h1>{labels.title}</h1><p className="surface-description">{labels.subtitle}</p></div><div className="surface-actions"><button className="secondary-button" onClick={refreshSelected}>{labels.refresh}</button><button className="primary-button" onClick={() => void addSubscription()}>+ {labels.add}</button></div></div><div className="web-library-toolbar"><input value={query} onChange={event => setQuery(event.target.value)} placeholder={labels.search} aria-label={labels.search}/><select value={folderId} onChange={event => setFolderId(event.target.value)} aria-label={labels.noFolders}><option value="">{labels.noFolders}</option>{folders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select><span>{entries.length} · {subscriptions.reduce((sum, item) => sum + item.unreadCount, 0)} {labels.unread.toLocaleLowerCase()}</span></div><div className="subscriptions-layout"><aside className="web-library-list"><button className={filter === 'ALL' ? 'web-library-filter active' : 'web-library-filter'} onClick={() => setFilter('ALL')}>{labels.all}</button><button className={filter === 'UNREAD' ? 'web-library-filter active' : 'web-library-filter'} onClick={() => setFilter('UNREAD')}>{labels.unread}</button><button className={filter === 'FAVORITES' ? 'web-library-filter active' : 'web-library-filter'} onClick={() => setFilter('FAVORITES')}>{labels.favorites}</button><button className={filter === 'PODCASTS' ? 'web-library-filter active' : 'web-library-filter'} onClick={() => setFilter('PODCASTS')}>{labels.podcasts}</button><span className="section-label">{labels.title}</span>{subscriptions.map(subscription => <button key={subscription.id} className="web-library-filter" onClick={() => setFolderId('')}>{subscription.title}<small>{subscription.unreadCount} · {subscription.hostname}</small></button>)}<div className="web-library-entry-list">{entries.map(entry => <button key={entry.id} className={entry.id === selectedId ? 'web-library-entry active' : 'web-library-entry'} onClick={() => setSelectedId(entry.id)}><strong>{entry.favorite ? '★ ' : ''}{entry.title}</strong><small>{entry.subscriptionTitle} · {entry.readState === 'READ' ? labels.read : labels.unread}{entry.enclosures.length ? ' · ◉' : ''}</small><span>{entry.author ?? entry.contentText.slice(0, 120)}</span></button>)}{!entries.length && <p className="web-library-empty">{labels.empty}</p>}</div></aside><main className="web-library-reader">{selected && reader ? <><div className="web-library-reader-heading"><div><h2>{reader.entry.title}</h2><p>{reader.entry.subscriptionTitle} · {reader.entry.publishedAt ?? reader.entry.firstSeenAt}</p></div><div className="web-library-reader-actions"><button className="secondary-button" onClick={toggleRead}>{selected.readState === 'READ' ? labels.unreadAction : labels.read}</button><button className="secondary-button" onClick={toggleFavorite}>{selected.favorite ? labels.unfavorite : labels.favorite}</button></div></div><div className="web-library-proof-row"><span>{labels.safe}</span><span>{reader.scriptsExecuted} scripts</span><span>{reader.formsSubmitted} forms</span></div><article className="web-library-reader-content" dangerouslySetInnerHTML={{ __html: reader.safeHtml }}/><div className="web-library-reader-footer"><code>{selected.url ?? labels.noReader}</code><div><button className="secondary-button" onClick={openOriginal}>{labels.open}</button><button className="secondary-button" onClick={shareEntry}>{labels.share}</button><button className="secondary-button" onClick={saveArticle}>{labels.save}</button><button className="secondary-button" onClick={continueEntry}>{labels.continue}</button></div></div>{selected.enclosures.length ? <div className="surface-grid">{selected.enclosures.map(enclosure => <div className="surface-card" key={enclosure.id}><strong>{enclosure.title ?? enclosure.mimeType ?? labels.podcasts}</strong><small>{enclosure.download?.state ?? labels.download}</small><div className="surface-actions"><button className="secondary-button" onClick={() => download(enclosure.id)}>{labels.download}</button><button className="secondary-button" disabled={enclosure.download?.state !== 'DOWNLOADED'} onClick={() => play(enclosure.id)}>{labels.play}</button></div></div>)}</div> : null}</> : <div className="web-library-reader-empty"><span>◴</span><p>{labels.noReader}</p></div>}</main></div>{notice && <div className="web-library-notice">{notice}</div>}</div>;
}

function WebLibrarySurface({ tab, shell, t }: { tab: DesktopTab; shell: DesktopShellController; t: Copy }) {
  const [runtime, setRuntime] = React.useState<DesktopWebLibraryRuntime | undefined>(getDesktopWebLibraryRuntime);
  const [entries, setEntries] = React.useState<readonly DesktopWebLibraryEntry[]>([]);
  const [collections, setCollections] = React.useState<readonly { id: string; name: string; isSystem: boolean }[]>([]);
  const [selectedId, setSelectedId] = React.useState(tab.object?.id !== 'web-library' ? tab.object?.id : undefined);
  const [reader, setReader] = React.useState<DesktopWebLibraryReader>();
  const [query, setQuery] = React.useState('');
  const [collectionId, setCollectionId] = React.useState('');
  const [notice, setNotice] = React.useState('');
  const ru = t.home === 'Главная';
  const labels = ru
    ? { saved: 'Сохранённые страницы', later: 'Read Later', all: 'Все', search: 'Поиск по Web Library', collections: 'Коллекции', revisions: 'Версии', source: 'Источник', offline: 'Доступно offline', bookmark: 'Только bookmark', partial: 'Частично сохранено', read: 'Прочитано', unread: 'Непрочитано', favorite: 'Избранное', markRead: 'Отметить прочитанным', markUnread: 'Отметить непрочитанным', removeFavorite: 'Убрать из избранного', addFavorite: 'В избранное', note: 'Добавить заметку', highlight: 'Выделить фрагмент', share: 'Поделиться копией', continue: 'Продолжить на устройстве', vault: 'Экспортировать в Vault', noReader: 'Выберите сохранённый элемент', empty: 'Пока ничего не сохранено', unavailable: 'Web Library host ещё не подключён', boundary: 'Подключите WebLibraryService через typed host adapter. Shell не читает archive storage и не обращается к origin.', refresh: 'Обновить' }
    : { saved: 'Saved pages', later: 'Read Later', all: 'All', search: 'Search Web Library', collections: 'Collections', revisions: 'Revisions', source: 'Source', offline: 'Available offline', bookmark: 'Bookmark only', partial: 'Partially saved', read: 'Read', unread: 'Unread', favorite: 'Favorite', markRead: 'Mark read', markUnread: 'Mark unread', removeFavorite: 'Remove favorite', addFavorite: 'Add favorite', note: 'Add note', highlight: 'Highlight', share: 'Share copy', continue: 'Continue on device', vault: 'Export to Vault', noReader: 'Choose a saved item', empty: 'Nothing saved yet', unavailable: 'Web Library host is not connected', boundary: 'Connect WebLibraryService through a typed host adapter. The shell never reads archive storage or contacts an origin.', refresh: 'Refresh' };

  React.useEffect(() => subscribeDesktopWebLibraryRuntime(() => setRuntime(getDesktopWebLibraryRuntime())), []);
  const refresh = React.useCallback(async () => {
    if (!runtime) { setEntries([]); setCollections([]); setReader(undefined); return; }
    try {
      const [nextEntries, nextCollections] = await Promise.all([query.trim() ? runtime.search(query.trim()).then(results => results.map(result => result.entry)) : runtime.list(collectionId ? { collectionId } : undefined), runtime.collections()]);
      setEntries(nextEntries); setCollections(nextCollections);
      setSelectedId(current => current && nextEntries.some(entry => entry.id === current) ? current : nextEntries[0]?.id);
      setNotice('');
    } catch { setNotice(labels.unavailable); }
  }, [collectionId, labels.unavailable, query, runtime]);
  React.useEffect(() => { void refresh(); }, [refresh]);
  React.useEffect(() => { if (!runtime?.subscribe) return; const subscribe = runtime.subscribe; return subscribe(() => void refresh()); }, [refresh, runtime]);
  React.useEffect(() => { if (!runtime || !selectedId) { setReader(undefined); return; } void runtime.reader(selectedId).then(setReader).catch(() => setReader(undefined)); }, [runtime, selectedId]);

  const selected = entries.find(entry => entry.id === selectedId);
  const setRead = async () => { if (!runtime?.setReadState || !selected) return; await runtime.setReadState(selected.id, selected.readState === 'READ' ? 'UNREAD' : 'READ'); await refresh(); };
  const setFavorite = async () => { if (!runtime?.setFavorite || !selected) return; await runtime.setFavorite(selected.id, !selected.favorite); await refresh(); };
  const addNote = async () => { if (!runtime?.addNote || !selected || !reader?.revision) { setNotice(labels.unavailable); return; } const body = window.prompt(labels.note); if (body?.trim()) { await runtime.addNote({ entryId: selected.id, revisionId: reader.revision.id, body: body.trim() }); setNotice(t.saved); } };
  const highlight = async () => { if (!runtime?.addHighlight || !selected || !reader?.revision) { setNotice(labels.unavailable); return; } const quote = window.prompt(labels.highlight); const start = quote ? reader.text.indexOf(quote) : -1; if (quote && start >= 0) { await runtime.addHighlight({ entryId: selected.id, revisionId: reader.revision.id, start, end: start + quote.length, quote }); setNotice(t.saved); } else if (quote) setNotice(ru ? 'Фрагмент не найден в этой версии.' : 'The fragment is not present in this revision.'); };
  const openBookmark = async () => { if (!runtime?.saveBookmark) { setNotice(labels.unavailable); return; } const url = window.prompt(labels.source, 'https://'); if (!url?.trim()) return; await runtime.saveBookmark({ url: url.trim() }); await refresh(); };

  if (!runtime) return <div className="web-library-surface"><div className="surface-kicker"><span className="surface-icon">▤</span><span>{t.webLibrary}</span><span className="surface-badge">{t.local}</span></div><h1>{t.webLibrary}</h1><p className="surface-description">{labels.unavailable}</p><div className="adapter-note"><span>◌</span><div><strong>{t.webLibrary}</strong><small>{labels.boundary}</small></div></div></div>;
  return <div className="web-library-surface" data-web-library-id={tab.object?.id ?? tab.id}>
    <div className="surface-kicker"><span className="surface-icon">▤</span><span>{t.webLibrary}</span><span className="surface-badge">{t.local}</span></div>
    <div className="web-library-heading"><div><h1>{labels.saved}</h1><p className="surface-description">{t.webLibraryDescription}</p></div><div className="web-library-actions"><button className="secondary-button" onClick={() => void refresh()}>{labels.refresh}</button><button className="primary-button" onClick={() => void openBookmark()}>+ {ru ? 'Сохранить URL' : 'Save URL'}</button></div></div>
    <div className="web-library-toolbar"><input value={query} onChange={event => setQuery(event.target.value)} placeholder={labels.search} aria-label={labels.search}/><select value={collectionId} onChange={event => setCollectionId(event.target.value)} aria-label={labels.collections}><option value="">{labels.all}</option>{collections.map(collection => <option key={collection.id} value={collection.id}>{collection.name}</option>)}</select><span>{entries.length} · {t.local}</span></div>
    <div className="web-library-layout"><aside className="web-library-list"><button className={!collectionId ? 'web-library-filter active' : 'web-library-filter'} onClick={() => setCollectionId('')}>{labels.all}</button><button className={collectionId === 'read-later' ? 'web-library-filter active' : 'web-library-filter'} onClick={() => setCollectionId('read-later')}>{labels.later}</button><span className="section-label">{labels.collections}</span>{collections.map(collection => <button key={collection.id} className={collectionId === collection.id ? 'web-library-filter active' : 'web-library-filter'} onClick={() => setCollectionId(collection.id)}>{collection.name}</button>)}<div className="web-library-entry-list">{entries.map(entry => <button key={entry.id} className={entry.id === selectedId ? 'web-library-entry active' : 'web-library-entry'} onClick={() => setSelectedId(entry.id)}><strong>{entry.favorite ? '★ ' : ''}{entry.title}</strong><small>{entry.kind === 'ARCHIVE' ? labels.offline : labels.bookmark} · {entry.readState === 'READ' ? labels.read : labels.unread}</small><span>{entry.sourceUrl}</span></button>)}{!entries.length && <p className="web-library-empty">{labels.empty}</p>}</div></aside><main className="web-library-reader">{selected && reader ? <><div className="web-library-reader-heading"><div><h2>{reader.entry.title}</h2><p>{reader.revision ? `${labels.offline} · ${reader.revision.title} · ${reader.revision.capturedAt}` : labels.bookmark}</p></div><div className="web-library-reader-actions"><button className="secondary-button" onClick={() => void setRead()}>{selected.readState === 'READ' ? labels.markUnread : labels.markRead}</button><button className="secondary-button" onClick={() => void setFavorite()}>{selected.favorite ? labels.removeFavorite : labels.addFavorite}</button></div></div>{reader.revision ? <><div className="web-library-proof-row"><span>{labels.offline}</span><span>{reader.externalRequestCount} requests</span><span>{reader.scriptsExecuted} scripts</span><span>{reader.formsSubmitted} forms</span><span>{reader.missingResources} missing assets</span></div><article className="web-library-reader-content"><pre>{reader.text}</pre></article><div className="web-library-reader-footer"><code>{labels.source}: {reader.revision.sourceUrl}</code><div><button className="secondary-button" onClick={() => void highlight()}>{labels.highlight}</button><button className="secondary-button" onClick={() => void addNote()}>{labels.note}</button><button className="secondary-button" onClick={() => void runtime.shareArchive?.(selected.id, reader.revision?.id)}>{labels.share}</button><button className="secondary-button" onClick={() => void runtime.continueOnDevice?.(selected.id, reader.revision?.id)}>{labels.continue}</button><button className="secondary-button" onClick={() => void runtime.exportToVault?.(selected.id, reader.revision?.id)}>{labels.vault}</button></div></div></> : <div className="web-library-bookmark"><p>{labels.bookmark}</p><a href={selected.sourceUrl} target="_blank" rel="noreferrer">{selected.sourceUrl}</a></div>}</> : <div className="web-library-reader-empty"><span>▤</span><p>{labels.noReader}</p></div>}</main></div>{notice && <div className="web-library-notice">{notice}</div>}
  </div>;
}

function ContinuitySurface({ shell, t }: { shell: DesktopShellController; t: Copy }) {
  const [runtime, setRuntime] = React.useState<DesktopContinuityRuntime | undefined>(getDesktopContinuityRuntime);
  const [devices, setDevices] = React.useState<readonly DesktopContinuityDevice[]>([]);
  const [inbox, setInbox] = React.useState<readonly DesktopContinuityItem[]>([]);
  const [outbox, setOutbox] = React.useState<readonly DesktopContinuityItem[]>([]);
  const [selectedDevice, setSelectedDevice] = React.useState('');
  const [automaticClipboard, setAutomaticClipboard] = React.useState(false);
  const [notice, setNotice] = React.useState('');
  const ru = t.continuity.startsWith('Continuity устройств');

  React.useEffect(() => subscribeDesktopContinuityRuntime(() => setRuntime(getDesktopContinuityRuntime())), []);
  const refresh = React.useCallback(async () => {
    if (!runtime) { setDevices([]); setInbox([]); setOutbox([]); return; }
    try {
      const [nextDevices, nextInbox, nextOutbox, clipboard] = await Promise.all([runtime.devices(), runtime.inbox(), runtime.outbox(), runtime.automaticClipboardContinuityEnabled()]);
      setDevices(nextDevices); setInbox(nextInbox); setOutbox(nextOutbox); setAutomaticClipboard(clipboard);
      setSelectedDevice(current => current && nextDevices.some(device => device.deviceId === current) ? current : nextDevices.find(device => !device.isCurrent && device.trustState === 'TRUSTED' && device.availability !== 'OFFLINE')?.deviceId ?? nextDevices.find(device => !device.isCurrent && device.trustState === 'TRUSTED')?.deviceId ?? '');
    } catch { setNotice(t.noContinuityRuntime); }
  }, [runtime, t.noContinuityRuntime]);
  React.useEffect(() => { void refresh(); }, [refresh]);
  React.useEffect(() => { if (!runtime?.subscribe) return; return runtime.subscribe(() => { void refresh(); }); }, [refresh, runtime]);

  const statusLabel = (status: DesktopContinuityItem['status']) => ({ QUEUED: t.queued, SENDING: t.sending, DELIVERED_TO_DEVICE: t.delivered, ACCEPTED: t.accepted, OPENED: t.opened, FAILED: t.failed, EXPIRED: t.expired, CANCELLED: t.cancelled }[status]);
  const availabilityLabel = (device: DesktopContinuityDevice) => device.availability === 'AVAILABLE' ? t.available : device.availability === 'RECENTLY_AVAILABLE' ? t.recentlyAvailable : t.notAvailable;
  const supportedTabType = (tab: DesktopTab): DesktopContinuityObjectType | undefined => ({ file: 'file', vault: 'vault', browser: 'browser', map: 'place', mail: 'mail', publication: 'publication', space: 'collaboration', chat: 'messaging', canvas: 'document', workboard: 'collaboration', calendar: 'document', tasks: 'document' } as Partial<Record<DesktopTab['kind'], DesktopContinuityObjectType>>)[tab.kind];
  const workspaceReference = () => {
    const snapshot = shell.getSnapshot();
    const tabs = snapshot.workspace.tabs.flatMap(tab => { const type = supportedTabType(tab); const objectId = tab.object?.id ?? tab.id; if (!type || !objectId || type === 'clipboard' || type === 'workspace') return []; return [{ id: tab.id, type, objectId, ...(tab.object?.label ? { title: tab.object.label } : { title: tab.title }), ...(tab.url ? { url: tab.url } : {}) }]; }).slice(0, 32);
    const activeTabId = snapshot.workspace.tabs.find(tab => supportedTabType(tab) && tab.id === shell.currentTab?.id)?.id;
    return { kind: 'workspace' as const, objectId: snapshot.workspace.id, workspaceId: snapshot.workspace.id, label: snapshot.workspace.name, tabs, ...(activeTabId ? { activeTabId } : {}) };
  };
  const sendWorkspace = async (action: 'OPEN' | 'CONTINUE') => {
    if (!runtime || !selectedDevice) { setNotice(t.chooseDevice); return; }
    try {
      const input = { targetDeviceId: selectedDevice, type: 'workspace' as const, reference: workspaceReference() };
      const item = action === 'CONTINUE' ? await runtime.continueOnDevice(input) : await runtime.sendToDevice(input);
      setNotice(`${action === 'CONTINUE' ? t.continueOnDevice : t.sendToDevice}: ${statusLabel(item.status)}`); await refresh();
    } catch (error) { setNotice(error instanceof Error ? error.message : t.offline); }
  };
  const openItem = async (requestId: string) => { if (!runtime) return; try { const item = await runtime.openIncoming(requestId); setNotice(`${t.open}: ${statusLabel(item.status)}`); await refresh(); } catch { setNotice(t.noInbox); } };
  const cancelItem = async (requestId: string) => { if (!runtime) return; try { await runtime.cancel(requestId); await refresh(); } catch { setNotice(t.offline); } };
  const flush = async () => { if (!runtime) return; try { const result = await runtime.flush(selectedDevice || undefined); setNotice(`${t.flush}: ${result.delivered}/${result.attempted}`); await refresh(); } catch { setNotice(t.offline); } };
  const toggleClipboard = async (enabled: boolean) => {
    if (!runtime) return;
    try {
      if (enabled && !window.confirm(t.automaticClipboardWarning)) return;
      await runtime.setAutomaticClipboardContinuity(enabled, enabled);
      setAutomaticClipboard(enabled);
    } catch { setNotice(t.automaticClipboardWarning); }
  };

  if (!runtime) return <div className="settings-surface continuity-surface"><div className="surface-kicker"><span className="surface-icon">⇆</span><span>{t.continuityTitle}</span><span className="surface-badge">HOST ADAPTER</span></div><h1>{t.continuityTitle}</h1><p className="surface-description">{t.noContinuityRuntime}</p><div className="adapter-note"><span>◌</span><div><strong>{t.continuityTitle}</strong><small>{t.handoffBoundary}</small></div></div></div>;
  const trustedDevices = devices.filter(device => !device.isCurrent && device.trustState === 'TRUSTED');
  return <div className="settings-surface continuity-surface"><div className="surface-kicker"><span className="surface-icon">⇆</span><span>{t.continuityTitle}</span><span className="surface-badge">{t.local}</span></div><div className="continuity-heading"><div><h1>{t.continuityTitle}</h1><p className="surface-description">{t.handoffBoundary}</p></div><button className="secondary-button" onClick={() => void refresh()}>{t.refresh}</button></div>
    <div className="continuity-layout"><section><span className="section-label">{t.chooseDevice}</span><div className="continuity-devices">{trustedDevices.length ? trustedDevices.map(device => <button key={device.deviceId} className={`continuity-device${selectedDevice === device.deviceId ? ' active' : ''}`} onClick={() => setSelectedDevice(device.deviceId)}><span><strong>{device.label}</strong><small>{device.platform} · {availabilityLabel(device)}</small></span><small>{device.capabilities.length} capabilities</small></button>) : <div className="adapter-note"><span>◌</span><div><strong>{t.noDevices}</strong><small>{t.offline}</small></div></div>}</div><div className="continuity-actions"><button className="primary-button" disabled={!selectedDevice} onClick={() => void sendWorkspace('OPEN')}>{t.sendWorkspace}</button><button className="secondary-button" disabled={!selectedDevice} onClick={() => void sendWorkspace('CONTINUE')}>{t.continueWorkspace}</button><button className="secondary-button" disabled={!selectedDevice} onClick={() => void flush()}>{t.flush}</button></div></section><section className="continuity-policy"><span className="section-label">{t.automaticClipboard}</span><div className="settings-row"><span><strong>{t.automaticClipboard}</strong><small>{t.automaticClipboardWarning}</small></span><input type="checkbox" checked={automaticClipboard} onChange={event => void toggleClipboard(event.target.checked)} /></div><p>{t.clipboardExplicit}</p></section></div>
    <section className="continuity-list"><div className="continuity-list-heading"><span className="section-label">{t.deviceInbox}</span><small>{inbox.length} · {outbox.length}</small></div>{inbox.length ? inbox.map(item => <ContinuityItemRow key={item.requestId} item={item} t={t} statusLabel={statusLabel} onOpen={() => void openItem(item.requestId)} onCancel={() => void cancelItem(item.requestId)} incoming />) : <p className="continuity-empty">{t.noInbox}</p>}{outbox.length > 0 && <><span className="section-label continuity-outbox-label">{t.sendToDevice}</span>{outbox.slice(0, 32).map(item => <ContinuityItemRow key={item.requestId} item={item} t={t} statusLabel={statusLabel} onCancel={() => void cancelItem(item.requestId)} />)}</>}{notice && <small className="continuity-notice">{notice}</small>}</section>
  </div>;
}

function ContinuityItemRow({ item, t, statusLabel, onOpen, onCancel, incoming = false }: { item: DesktopContinuityItem; t: Copy; statusLabel: (status: DesktopContinuityItem['status']) => string; onOpen?: () => void; onCancel?: () => void; incoming?: boolean }) {
  const canCancel = ['QUEUED', 'SENDING', 'DELIVERED_TO_DEVICE'].includes(item.status);
  return <div className="continuity-item"><div className="continuity-item-copy"><strong>{item.title || item.type}</strong><small>{item.type} · {item.action} · {statusLabel(item.status)}</small><code>{item.requestId.slice(0, 12)} · {new Date(item.updatedAt).toLocaleString()}</code>{item.lastError && <small className="continuity-error">{item.lastError}</small>}</div><div className="continuity-item-actions">{incoming && onOpen && !['OPENED', 'ACCEPTED', 'CANCELLED', 'EXPIRED'].includes(item.status) && <button className="secondary-button" onClick={onOpen}>{t.open}</button>}{canCancel && onCancel && <button className="secondary-button" onClick={onCancel}>{t.cancel}</button>}</div></div>;
}

function NearbyExchangeSurface({ shell, t }: { shell: DesktopShellController; t: Copy }) {
  const [runtime, setRuntime] = React.useState<DesktopNearbyExchangeRuntime | undefined>(getDesktopNearbyExchangeRuntime);
  const [endpoints, setEndpoints] = React.useState<readonly DesktopNearbyEndpoint[]>([]);
  const [offers, setOffers] = React.useState<readonly DesktopNearbyOffer[]>([]);
  const [transfers, setTransfers] = React.useState<readonly DesktopNearbyTransfer[]>([]);
  const [mode, setMode] = React.useState<{ policy: 'NOT_ACCEPTING' | 'CONTACTS_ONLY' | 'TEMPORARILY_VISIBLE' | 'ASK_EVERY_TIME'; active: boolean; until?: string }>({ policy: 'NOT_ACCEPTING', active: false });
  const [qr, setQr] = React.useState('');
  const [notice, setNotice] = React.useState('');
  const ru = t.nearbyTitle.startsWith('Обмен');
  const refresh = React.useCallback(async () => {
    if (!runtime) { setEndpoints([]); setOffers([]); setTransfers([]); return; }
    try {
      const [nextEndpoints, nextMode, incoming, outgoing, nextTransfers] = await Promise.all([runtime.listNearby(), runtime.receiveMode(), runtime.incomingOffers(), runtime.outgoingOffers(), runtime.transfers()]);
      setEndpoints(nextEndpoints); setMode(nextMode); setOffers([...incoming, ...outgoing]); setTransfers(nextTransfers);
    } catch { setNotice(t.nearbyUnavailable); }
  }, [runtime, t.nearbyUnavailable]);
  React.useEffect(() => subscribeDesktopNearbyExchangeRuntime(() => setRuntime(getDesktopNearbyExchangeRuntime())), []);
  React.useEffect(() => { void refresh(); return runtime?.subscribe?.(() => { void refresh(); }); }, [refresh, runtime]);
  const run = async (action: () => Promise<unknown>, success?: string) => { try { await action(); if (success) setNotice(success); await refresh(); } catch { setNotice(t.nearbyBoundary); } };
  const accept = (offerId: string) => void run(() => runtime!.accept(offerId), t.nearbyReceived);
  const reject = (offerId: string) => void run(() => runtime!.reject(offerId), t.nearbyReject);
  const cancel = (id: string) => void run(() => runtime!.cancel(id), t.nearbyCancel);
  const resume = (id: string) => void run(() => runtime!.resume(id), t.nearbyResume);
  const disclose = (endpointId: string) => void run(() => runtime!.discloseIdentity ? runtime!.discloseIdentity(endpointId, ['displayName']) : Promise.reject(new Error('Disclosure adapter unavailable')), t.nearbyDisclosure);
  const addContact = (endpointId: string) => void run(() => runtime!.addContact ? runtime!.addContact(endpointId) : Promise.reject(new Error('Contact adapter unavailable')), t.nearbyAddContact);
  if (!runtime) return <div className="settings-surface nearby-surface"><div className="surface-kicker"><span className="surface-icon">⇄</span><span>{t.nearbyTitle}</span><span className="surface-badge">HOST ADAPTER</span></div><h1>{t.nearbyTitle}</h1><p className="surface-description">{t.nearbyUnavailable}</p><div className="adapter-note"><span>◌</span><div><strong>{t.nearbyTitle}</strong><small>{t.nearbyBoundary}</small></div></div></div>;
  return <div className="settings-surface nearby-surface" data-nearby-exchange-surface="true">
    <div className="surface-kicker"><span className="surface-icon">⇄</span><span>{t.nearbyTitle}</span><span className="surface-badge">{t.local}</span></div>
    <div className="continuity-heading"><div><h1>{t.nearbyTitle}</h1><p className="surface-description">{t.nearbyBoundary}</p></div><button className="secondary-button" onClick={() => void refresh()}>{t.nearbyRefresh}</button></div>
    <div className="surface-grid"><div className="surface-card"><strong>{t.nearbyReceive}</strong><small>{mode.active ? `${mode.policy}${mode.until ? ` · ${new Date(mode.until).toLocaleTimeString()}` : ''}` : t.nearbyStop}</small><div className="surface-grid"><button className="primary-button" onClick={() => void run(() => runtime.startReceive({ policy: 'ASK_EVERY_TIME' }), t.nearbyReceive)}>{t.nearbyReceive}</button><button className="secondary-button" onClick={() => void run(() => runtime.stopReceive(), t.nearbyStop)}>{t.nearbyStop}</button><button className="secondary-button" onClick={() => void run(async () => setQr(await runtime.createReceiveQr()), t.nearbyShareQr)}>{t.nearbyQr}</button></div></div><div className="surface-card"><strong>{t.nearbyAnonymity}</strong><small>{t.nearbyDisclosure}</small></div></div>
    {qr && <div className="adapter-note"><span>▣</span><div><strong>{t.nearbyQr}</strong><small>{t.nearbyShareQr}</small><code className="nearby-qr-code">{qr}</code></div></div>}
    <span className="section-label">{t.nearbyTitle} · {endpoints.length}</span>
    <div className="surface-grid">{endpoints.length ? endpoints.map(endpoint => <div className="surface-card" key={endpoint.endpointId}><strong>{endpoint.alias}</strong><small>{endpoint.socialState} · {endpoint.capabilities.join(', ')}</small><code>{endpoint.verificationCode}</code><div className="surface-grid"><button className="secondary-button" onClick={() => disclose(endpoint.endpointId)} disabled={!runtime.discloseIdentity}>{t.nearbyDisclosure}</button><button className="secondary-button" onClick={() => addContact(endpoint.endpointId)} disabled={!runtime.addContact}>{t.nearbyAddContact}</button></div></div>) : <div className="adapter-note"><span>◌</span><div><strong>{t.nearbyNoEndpoints}</strong><small>{t.nearbyAnonymity}</small></div></div>}</div>
    <span className="section-label">{t.nearbyOffers}</span>
    <div className="surface-grid">{offers.filter(offer => offer.direction === 'INCOMING' && offer.status === 'OFFERED').length ? offers.filter(offer => offer.direction === 'INCOMING' && offer.status === 'OFFERED').map(offer => <div className="surface-card" key={offer.offerId}><strong>{offer.title}</strong><small>{offer.objectType}{offer.subtitle ? ` · ${offer.subtitle}` : ''}{offer.byteLength ? ` · ${offer.byteLength} B` : ''}</small><code>{offer.verificationCode}</code><div className="surface-grid"><button className="primary-button" onClick={() => accept(offer.offerId)}>{t.nearbyAccept}</button><button className="secondary-button" onClick={() => reject(offer.offerId)}>{t.nearbyReject}</button></div></div>) : <div className="adapter-note"><span>◌</span><div><strong>{t.nearbyNoOffers}</strong><small>{t.nearbyDisclosure}</small></div></div>}</div>
    {transfers.length > 0 && <><span className="section-label">{t.nearbyReceived}</span><div className="continuity-list">{transfers.slice(-32).reverse().map(transfer => <div className="continuity-item" key={transfer.transferId}><div className="continuity-item-copy"><strong>{transfer.objectType} · {Math.round(transfer.progress * 100)}%</strong><small>{transfer.status} · {transfer.completedBytes}{transfer.totalBytes ? `/${transfer.totalBytes} B` : ''}</small>{transfer.lastError && <small className="continuity-error">{transfer.lastError}</small>}</div><div className="continuity-item-actions">{['OFFERED', 'ACCEPTED', 'TRANSFERRING'].includes(transfer.status) && <button className="secondary-button" onClick={() => cancel(transfer.transferId)}>{t.nearbyCancel}</button>}{transfer.status === 'PAUSED_WAITING_ROUTE' && <button className="secondary-button" onClick={() => resume(transfer.transferId)}>{t.nearbyResume}</button>}</div></div>)}</div></>}
    {notice && <small className="continuity-notice">{notice}</small>}
  </div>;
}

function SettingsSurface({ shell, t }: { shell: DesktopShellController; t: Copy }) {
  const [safety, setSafety] = React.useState<DesktopSafetyRuntime | undefined>(getDesktopSafetyRuntime);
  const [integrity, setIntegrity] = React.useState<DesktopIntegrityRuntime | undefined>(getDesktopIntegrityRuntime);
  const ru = t.settings.startsWith('Наст');
  React.useEffect(() => subscribeDesktopSafetyRuntime(() => setSafety(getDesktopSafetyRuntime())), []);
  React.useEffect(() => safety?.subscribe?.(() => setSafety(getDesktopSafetyRuntime())), [safety]);
  React.useEffect(() => subscribeDesktopIntegrityRuntime(() => setIntegrity(getDesktopIntegrityRuntime())), []);
  React.useEffect(() => integrity?.subscribe?.(() => setIntegrity(getDesktopIntegrityRuntime())), [integrity]);
  const status = safety?.runtime.status(); const metrics = safety?.runtime.metrics();
  const core = integrity?.core; const snapshot = integrity?.snapshot?.() ?? core?.snapshot(); const locked = snapshot?.locked === true || snapshot?.stage === 'LOCKDOWN';
  return <div className="settings-surface"><div className="surface-kicker"><span className="surface-icon">⚙</span><span>{t.settings}</span></div><h1>{t.settings}</h1><p className="surface-description">{ru ? 'Локальные настройки и безопасность. Mandatory policy нельзя отключить.' : 'Local settings and safety. Mandatory policy cannot be disabled.'}</p><div className="settings-list"><button onClick={() => shell.setNotice(`${t.mode}: ${t.local}`)}><span>AI resources</span><strong>{t.mode}</strong></button><button onClick={() => shell.toggleContextSidebar()}><span>{t.context}</span><strong>{shell.chromeState.contextSidebarOpen ? t.show : t.hide}</strong></button><button onClick={() => shell.toggleAgentPanel()}><span>{t.agent}</span><strong>{shell.chromeState.agentPanelOpen ? t.show : t.hide}</strong></button><button onClick={() => shell.setNotice(t.privacy)}><span>{t.privacy}</span><strong>{t.configure}</strong></button><div className="settings-row"><span><strong>{ru ? 'Safety Runtime' : 'Safety Runtime'}</strong><small>{status ?? (ru ? 'Host adapter не подключён' : 'Host adapter not connected')} · {ru ? 'Mandatory policy активна' : 'Mandatory policy active'}</small></span><strong>{metrics ? `${metrics.evaluated} ${ru ? 'проверок' : 'evaluations'} · ${metrics.quarantined} ${ru ? 'quarantine' : 'quarantined'}` : '—'}</strong></div><div className="settings-row"><span><strong>{ru ? 'Целостность core' : 'Build integrity'}</strong><small>{snapshot ? `${snapshot.officialStatus} · ${snapshot.stage}` : (ru ? 'Host verifier не подключён' : 'Host verifier not connected')}</small></span><strong className={locked ? 'settings-danger' : undefined}>{locked ? 'LOCKDOWN' : (ru ? 'Готово' : 'Ready')}</strong></div>{locked && <div className="settings-recovery"><strong>{ru ? 'Критические файлы изменены или повреждены' : 'Security-critical files were modified or corrupted'}</strong><small>{snapshot?.failure?.category ?? '—'} · {snapshot?.failure?.componentId ?? snapshot?.failure?.path ?? 'core'}</small><div className="settings-actions"><button onClick={() => void integrity?.verifyAgain?.()}>{ru ? 'Проверить ещё раз' : 'Verify again'}</button><button onClick={() => void integrity?.repairHost?.()}>{ru ? 'Восстановить host' : 'Repair host'}</button><button onClick={() => void integrity?.verifyRecoveryArtifact?.()}>{ru ? 'Проверить artifact' : 'Verify artifact'}</button></div></div>}</div></div>;
}

function SkillsSurface({ shell, t }: { shell: DesktopShellController; t: Copy }) {
  const [runtime, setRuntime] = React.useState<DesktopSkillRuntime | undefined>(getDesktopSkillRuntime);
  const [skills, setSkills] = React.useState<readonly { skillId: string; name: string; version: string; enabled: boolean; integrity: string; capabilities: readonly string[] }[]>([]);
  const [candidates, setCandidates] = React.useState<readonly { candidateId: string; title: string; status: string; evidenceCount: number }[]>([]);
  const ru = t.settings.startsWith('Наст');
  React.useEffect(() => subscribeDesktopSkillRuntime(() => setRuntime(getDesktopSkillRuntime())), []);
  const refresh = React.useCallback(() => { if (!runtime) return; void runtime.list().then(setSkills).catch(() => setSkills([])); if (runtime.candidates) void runtime.candidates().then(setCandidates).catch(() => setCandidates([])); }, [runtime]);
  React.useEffect(() => { refresh(); return runtime?.subscribe?.(refresh); }, [refresh, runtime]);
  return <div className="settings-surface"><div className="surface-kicker"><span className="surface-icon">✦</span><span>{ru ? 'Skills' : 'Skills'}</span><span className="surface-badge">{t.local}</span></div><h1>{ru ? 'Skills' : 'Skills'}</h1><p className="surface-description">{ru ? 'Декларативные процедуры. Permissions и ToolPolicy остаются в core.' : 'Declarative procedures. Permissions and ToolPolicy stay in core.'}</p>{runtime ? <><div className="settings-list">{skills.map(skill => <div key={skill.skillId} className="settings-row"><span><strong>{skill.name}</strong><small>{skill.skillId} · v{skill.version} · {skill.integrity}</small></span><button className="secondary-button" onClick={() => { if (skill.enabled) void runtime.disable?.(skill.skillId).then(refresh); else void runtime.enable?.(skill.skillId).then(refresh); }}>{skill.enabled ? (ru ? 'Отключить' : 'Disable') : (ru ? 'Включить' : 'Enable')}</button></div>)}</div><h2>{ru ? 'Кандидаты' : 'Candidates'}</h2><div className="settings-list">{candidates.map(candidate => <div key={candidate.candidateId} className="settings-row"><span><strong>{candidate.title}</strong><small>{candidate.status} · {candidate.evidenceCount} {ru ? 'подтверждений' : 'successful runs'}</small></span><button className="secondary-button" onClick={() => shell.setNotice(ru ? 'Кандидат требует явного review.' : 'Candidate requires explicit review.')}>{ru ? 'Review' : 'Review'}</button></div>)}</div></> : <div className="placeholder-surface"><span className="placeholder-icon">✦</span><h2>{ru ? 'Skill host не подключён' : 'Skill host is not connected'}</h2><p>{ru ? 'Подключите SkillPackageRegistry через typed host adapter.' : 'Connect SkillPackageRegistry through the typed host adapter.'}</p></div>}</div>;
}

function VaultSurface({ tab, shell, t }: { tab: DesktopTab; shell: DesktopShellController; t: Copy }) {
  const [runtime, setRuntime] = React.useState<DesktopVaultRuntime | undefined>(getDesktopVaultRuntime);
  const [vaultId, setVaultId] = React.useState(tab.object?.vaultId ?? (tab.object?.id && tab.object.id !== 'new-note' ? tab.object.id : ''));
  const [vaults, setVaults] = React.useState<readonly { id: string; name: string; visibility: string }[]>([]);
  const [notes, setNotes] = React.useState<readonly Pick<DesktopVaultNote, 'id' | 'path' | 'title' | 'modifiedAt'>[]>([]);
  const [selectedId, setSelectedId] = React.useState(tab.object?.id && tab.object.id !== 'new-note' ? tab.object.id : '');
  const [note, setNote] = React.useState<DesktopVaultNote>();
  const [draft, setDraft] = React.useState('');
  const [query, setQuery] = React.useState('');
  const [results, setResults] = React.useState<readonly { note: Pick<DesktopVaultNote, 'id' | 'path' | 'title' | 'modifiedAt'>; score: number; snippet: string }[]>([]);
  const [backlinks, setBacklinks] = React.useState<readonly { sourceNoteId: string; sourcePath: string; target: string }[]>([]);
  const [notice, setNotice] = React.useState('');
  const [preview, setPreview] = React.useState<string>();
  const [showPreview, setShowPreview] = React.useState(false);
  const ru = t.vault.startsWith('Х');
  const labels = ru ? { unavailable: 'Vault host ещё не подключён', boundary: 'Установите VaultService через typed host adapter; shell не читает файловую систему напрямую.', notes: 'Заметки', search: 'Поиск по Vault', create: 'Новая заметка', folder: 'Новая папка', save: 'Сохранить', rename: 'Переименовать', remove: 'Удалить', links: 'Обратные ссылки', outline: 'Структура', properties: 'Свойства', empty: 'Выберите заметку', saved: 'Сохранено локально', readonly: 'Только чтение: host adapter не установлен', source: 'Источник', preview: 'Предпросмотр', graph: 'Локальный граф' } : { unavailable: 'Vault host is not connected', boundary: 'Install VaultService through the typed host adapter; the shell never reads the filesystem directly.', notes: 'Notes', search: 'Search Vault', create: 'New note', folder: 'New folder', save: 'Save', rename: 'Rename', remove: 'Delete', links: 'Backlinks', outline: 'Outline', properties: 'Properties', empty: 'Select a note', saved: 'Saved locally', readonly: 'Read-only: no host adapter installed', source: 'Source', preview: 'Preview', graph: 'Local graph' };
  React.useEffect(() => subscribeDesktopVaultRuntime(() => setRuntime(getDesktopVaultRuntime())), []);
  const refresh = React.useCallback(async () => {
    if (!runtime) return;
    const nextVaults = await runtime.listVaults(); setVaults(nextVaults);
    const selectedVault = vaultId || nextVaults[0]?.id; if (!selectedVault) return; if (!vaultId) setVaultId(selectedVault);
    const nextNotes = (await runtime.listNotes(selectedVault)).slice().sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt)); setNotes(nextNotes);
    const nextId = selectedId && nextNotes.some(value => value.id === selectedId) ? selectedId : nextNotes[0]?.id; if (!nextId) { setNote(undefined); return; }
    setSelectedId(nextId); const loaded = await runtime.getNote(selectedVault, nextId); setNote(loaded); setDraft(loaded?.content ?? ''); if (runtime.backlinks) setBacklinks(await runtime.backlinks(selectedVault, nextId));
  }, [runtime, selectedId, vaultId]);
  React.useEffect(() => { void refresh(); }, [refresh]);
  React.useEffect(() => { if (!runtime?.subscribe) return; return runtime.subscribe(() => void refresh()); }, [runtime, refresh]);
  React.useEffect(() => { if (!runtime || !vaultId || !query.trim()) { setResults([]); return; } const timer = window.setTimeout(() => { void runtime.search(vaultId, query).then(setResults).catch(() => setResults([])); }, 220); return () => window.clearTimeout(timer); }, [runtime, vaultId, query]);
  React.useEffect(() => { if (!runtime?.updateNote || !vaultId || !note || draft === note.content) return; const timer = window.setTimeout(() => { void runtime.updateNote!(vaultId, note.id, { content: draft, baseRevision: note.revision }).then(updated => { setNote(updated); setDraft(updated.content); setNotice(labels.saved); }).catch(() => setNotice(labels.readonly)); }, 900); return () => window.clearTimeout(timer); }, [draft, labels.saved, labels.readonly, note, runtime, vaultId]);
  React.useEffect(() => { if (!runtime?.renderTransclusion || !vaultId || !note) { setPreview(undefined); return; } void runtime.renderTransclusion(vaultId, note.id).then(value => setPreview(value.rendered)).catch(() => setPreview(undefined)); }, [note?.id, note?.revision, runtime, vaultId]);
  const choose = async (id: string) => { setSelectedId(id); if (!runtime || !vaultId) return; const loaded = await runtime.getNote(vaultId, id); setNote(loaded); setDraft(loaded?.content ?? ''); if (runtime.backlinks) setBacklinks(await runtime.backlinks(vaultId, id)); };
  const create = async () => { if (!runtime?.createNote || !vaultId) { setNotice(labels.boundary); return; } const created = await runtime.createNote(vaultId, { path: `New note ${new Date().toISOString().slice(0, 10)}.md`, title: ru ? 'Новая заметка' : 'New note', content: '' }); setSelectedId(created.id); setNote(created); setDraft(created.content); setNotice(labels.saved); await refresh(); };
  const createFolder = async () => { if (!runtime?.createFolder || !vaultId) { setNotice(labels.boundary); return; } const path = window.prompt(labels.folder, 'New folder'); if (path) { await runtime.createFolder(vaultId, path); await refresh(); } };
  const save = async () => { if (!runtime?.updateNote || !vaultId || !note) { setNotice(labels.readonly); return; } const updated = await runtime.updateNote(vaultId, note.id, { content: draft, baseRevision: note.revision }); setNote(updated); setDraft(updated.content); setNotice(labels.saved); await refresh(); };
  const rename = async () => { if (!runtime?.renameNote || !vaultId || !note) { setNotice(labels.readonly); return; } const path = window.prompt(labels.rename, note.path); if (!path) return; const updated = await runtime.renameNote(vaultId, note.id, path); setNote(updated); setDraft(updated.content); await refresh(); };
  const remove = async () => { if (!runtime?.deleteNote || !vaultId || !note || !window.confirm(labels.remove)) { if (!runtime?.deleteNote) setNotice(labels.readonly); return; } await runtime.deleteNote(vaultId, note.id); setNote(undefined); setDraft(''); await refresh(); };
  return <div className="vault-surface" data-vault-id={vaultId || tab.id}>
    <div className="surface-kicker"><span className="surface-icon">▱</span><span>{t.vault}</span><span className="surface-badge">{t.local}</span></div>
    <div className="vault-heading"><div><h1>{vaults.find(value => value.id === vaultId)?.name ?? tab.title}</h1><p className="surface-description">{runtime ? `${notes.length} ${labels.notes} · ${t.privacy}` : labels.unavailable}</p></div><div className="vault-actions"><button className="secondary-button" onClick={() => note && shell.openReference({ kind: 'graph', id: note.id, vaultId, label: labels.graph })} disabled={!note}>{labels.graph}</button><button className="secondary-button" onClick={() => void createFolder()}>{labels.folder}</button><button className="secondary-button" onClick={() => void create()}>{labels.create}</button><button className="primary-button" onClick={() => void save()} disabled={!note}>{labels.save}</button></div></div>
    {!runtime && <div className="adapter-note"><span>◌</span><div><strong>{labels.unavailable}</strong><small>{labels.boundary}</small></div></div>}
    <div className="vault-layout"><aside className="vault-tree"><label className="section-label">{labels.search}<input value={query} onChange={event => setQuery(event.target.value)} placeholder={labels.search}/></label>{query && <div className="vault-search-results">{results.map(result => <button key={result.note.id} onClick={() => void choose(result.note.id)}><strong>{result.note.title}</strong><small>{result.note.path}</small><span>{result.snippet}</span></button>)}</div>}<span className="section-label">{labels.notes}</span><div className="vault-note-list">{notes.map(value => <button key={value.id} className={value.id === selectedId ? 'active' : ''} onClick={() => void choose(value.id)}><strong>{value.title}</strong><small>{value.path}</small></button>)}</div></aside><main className="vault-editor">{note ? <><div className="vault-editor-toolbar"><span>{note.path} · r{note.revision}</span><div><button className="secondary-button" onClick={() => setShowPreview(value => !value)}>{showPreview ? labels.source : labels.preview}</button><button className="secondary-button" onClick={() => void rename()}>{labels.rename}</button><button className="secondary-button danger" onClick={() => void remove()}>{labels.remove}</button></div></div>{showPreview ? <pre className="vault-preview" aria-label={labels.preview}>{preview ?? draft}</pre> : <textarea value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'b') { event.preventDefault(); const start = event.currentTarget.selectionStart; const end = event.currentTarget.selectionEnd; setDraft(`${draft.slice(0, start)}**${draft.slice(start, end)}**${draft.slice(end)}`); } else if (event.key === 'Tab') { event.preventDefault(); const start = event.currentTarget.selectionStart; setDraft(`${draft.slice(0, start)}  ${draft.slice(event.currentTarget.selectionEnd)}`); } }} aria-label={note.title} spellCheck={false}/>}<small className="untrusted-note">UNTRUSTED MARKDOWN · {labels.source}</small>{notice && <small className="vault-notice">{notice}</small>}</> : <div className="vault-empty"><span>▱</span><p>{runtime ? labels.empty : labels.readonly}</p></div>}</main><aside className="vault-inspector"><span className="section-label">{labels.outline}</span>{note?.headings.map(heading => <div key={`${heading.id}-${heading.line}`} className={`vault-heading-level-${heading.level}`}>{heading.text}</div>)}<span className="section-label">{labels.links}</span>{backlinks.map(link => <button key={`${link.sourceNoteId}-${link.sourcePath}`} onClick={() => void choose(link.sourceNoteId)}>{link.sourcePath}</button>)}<span className="section-label">{labels.properties}</span>{note && Object.entries(note.properties).map(([key, value]) => <div className="vault-property" key={key}><strong>{key}</strong><span>{Array.isArray(value.value) ? value.value.join(', ') : String(value.value)}</span></div>)}</aside></div>
  </div>;
}

function VaultGraphSurface({ tab, shell, t }: { tab: DesktopTab; shell: DesktopShellController; t: Copy }) {
  const [runtime, setRuntime] = React.useState<DesktopVaultRuntime | undefined>(getDesktopVaultRuntime);
  const [projection, setProjection] = React.useState<DesktopVaultGraphProjection>();
  const [query, setQuery] = React.useState('');
  const [local, setLocal] = React.useState(tab.object?.id === 'local');
  const [depth, setDepth] = React.useState(1);
  const [includeUnresolved, setIncludeUnresolved] = React.useState(true);
  const [notice, setNotice] = React.useState('');
  const vaultId = tab.object?.vaultId ?? (tab.object?.id && tab.object.id !== 'local' ? tab.object.id : '');
  const ru = t.vault.startsWith('Х');
  const labels = ru ? { title: 'Граф Vault', local: 'Локальный граф', global: 'Глобальный граф', search: 'Фильтр по графу', depth: 'Глубина', unresolved: 'Неразрешённые', open: 'Открыть', orphans: 'Без связей', empty: 'Graph host ещё не подключён', boundary: 'Установите VaultGraphService через typed host adapter. Граф строится из VaultLinkIndex и не заменяет Markdown.', nodes: 'узлов', edges: 'связей', truncated: 'Показ ограничен viewport/bounds.' } : { title: 'Vault Graph', local: 'Local graph', global: 'Global graph', search: 'Filter graph', depth: 'Depth', unresolved: 'Unresolved', open: 'Open', orphans: 'Orphans', empty: 'Graph host is not connected', boundary: 'Install VaultGraphService through the typed host adapter. The graph derives from VaultLinkIndex and never replaces Markdown.', nodes: 'nodes', edges: 'edges', truncated: 'Viewport/bounds limit the rendered projection.' };
  React.useEffect(() => subscribeDesktopVaultRuntime(() => setRuntime(getDesktopVaultRuntime())), []);
  const refresh = React.useCallback(async () => { if (!runtime?.graph || !vaultId) return; try { const next = local && runtime.graph.local && tab.object?.id && tab.object.id !== 'local' ? await runtime.graph.local(vaultId, tab.object.id, depth) : await runtime.graph.global(vaultId, { text: query || undefined, depth, limitNodes: 240, limitEdges: 480, includeUnresolved }); setProjection(next); setNotice(''); } catch { setNotice(labels.empty); } }, [depth, includeUnresolved, labels.empty, local, query, runtime, tab.object?.id, vaultId]);
  React.useEffect(() => { void refresh(); }, [refresh]);
  const openNode = (node: DesktopVaultGraphProjection['nodes'][number]) => { if (node.kind === 'NOTE' && !node.unresolved) shell.openReference({ kind: 'vault', id: node.id, vaultId, label: node.label }); else if (node.kind === 'ATTACHMENT') shell.openReference({ kind: 'file', id: node.id, vaultId, label: node.label }); else setNotice(node.unresolved ? `${labels.unresolved}: ${node.label}` : node.label); };
  const orphans = projection?.orphanNodeIds.length ?? 0;
  return <div className="vault-graph-surface" data-vault-id={vaultId || tab.id}>
    <div className="surface-kicker"><span className="surface-icon">⌘</span><span>{local ? labels.local : labels.title}</span><span className="surface-badge">{t.local}</span></div>
    <div className="graph-heading"><div><h1>{local ? labels.local : labels.title}</h1><p className="surface-description">{runtime?.graph ? `${projection?.nodes.length ?? 0} ${labels.nodes} · ${projection?.edges.length ?? 0} ${labels.edges}` : labels.empty}</p></div><div className="graph-actions"><button className={local ? 'secondary-button' : 'primary-button'} onClick={() => setLocal(false)}>{labels.global}</button><button className={!local ? 'secondary-button' : 'primary-button'} onClick={() => setLocal(true)}>{labels.local}</button><button className="secondary-button" onClick={() => setNotice(`${labels.orphans}: ${orphans}`)}>{labels.orphans} · {orphans}</button></div></div>
    {!runtime?.graph && <div className="adapter-note"><span>◌</span><div><strong>{labels.empty}</strong><small>{labels.boundary}</small></div></div>}
    <div className="graph-toolbar"><label>{labels.search}<input value={query} onChange={event => setQuery(event.target.value)} placeholder={labels.search}/></label><label>{labels.depth}<input type="number" min={0} max={8} value={depth} onChange={event => setDepth(Math.max(0, Math.min(8, Number(event.target.value) || 0)))}/></label><label className="graph-check"><input type="checkbox" checked={includeUnresolved} onChange={event => setIncludeUnresolved(event.target.checked)}/>{labels.unresolved}</label><button className="secondary-button" onClick={() => void refresh()}>{t.reset}</button></div>
    {projection && <div className="graph-layout" aria-label={labels.title}><section className="graph-node-list" aria-label={labels.nodes}>{projection.nodes.slice(0, 240).map(node => <button key={node.id} className={`graph-node graph-node-${node.kind.toLowerCase()}${node.unresolved ? ' unresolved' : ''}`} onDoubleClick={() => openNode(node)} onKeyDown={event => { if (event.key === 'Enter') openNode(node); }}><span className="graph-node-kind">{node.kind}</span><strong>{node.label}</strong><small>{node.path ?? (node.unresolved ? labels.unresolved : '')}</small></button>)}</section><section className="graph-edge-list" aria-label={labels.edges}>{projection.edges.slice(0, 480).map(edge => <div key={edge.id} className="graph-edge"><span>{edge.kind}</span><strong>{projection.nodes.find(node => node.id === edge.source)?.label ?? edge.source}</strong><b>→</b><strong>{projection.nodes.find(node => node.id === edge.target)?.label ?? edge.target}</strong></div>)}{projection.truncated && <p className="graph-truncated">{labels.truncated}</p>}</section></div>}
    {notice && <small className="vault-notice">{notice}</small>}
  </div>;
}

function VaultCanvasSurface({ tab, shell, t }: { tab: DesktopTab; shell: DesktopShellController; t: Copy }) {
  const [runtime, setRuntime] = React.useState<DesktopVaultRuntime | undefined>(getDesktopVaultRuntime);
  const [canvases, setCanvases] = React.useState<readonly Pick<DesktopVaultCanvasDocument, 'id' | 'revision' | 'metadata'>[]>([]);
  const [document, setDocument] = React.useState<DesktopVaultCanvasDocument>();
  const [selected, setSelected] = React.useState<string[]>([]);
  const [notice, setNotice] = React.useState('');
  const vaultId = tab.object?.vaultId ?? 'vault';
  const canvasId = tab.object?.id ?? '';
  const ru = t.vault.startsWith('Х');
  const labels = ru ? { title: 'Canvas', empty: 'Canvas host ещё не подключён', boundary: 'Установите CanvasService через typed storage/permission adapter. Документ остаётся structured JSON.', create: 'Новый Canvas', nodes: 'карточек', addText: 'Добавить текст', move: 'Сдвинуть', connect: 'Соединить', undo: 'Отменить', redo: 'Повторить', select: 'Выберите карточки', open: 'Открыть источник', permission: 'Ссылка недоступна по текущим разрешениям', saved: 'Canvas сохранён' } : { title: 'Canvas', empty: 'Canvas host is not connected', boundary: 'Install CanvasService through the typed storage/permission adapter. The document remains structured JSON.', create: 'New Canvas', nodes: 'cards', addText: 'Add text', move: 'Move', connect: 'Connect', undo: 'Undo', redo: 'Redo', select: 'Select cards', open: 'Open source', permission: 'Reference is unavailable under current permissions', saved: 'Canvas saved' };
  React.useEffect(() => subscribeDesktopVaultRuntime(() => setRuntime(getDesktopVaultRuntime())), []);
  const refresh = React.useCallback(async () => { if (!runtime?.canvas) return; try { const next = await runtime.canvas.list(vaultId); setCanvases(next); const id = canvasId && next.some(value => value.id === canvasId) ? canvasId : next[0]?.id; if (id) setDocument(await runtime.canvas.open(vaultId, id)); } catch { setNotice(labels.empty); } }, [canvasId, labels.empty, runtime, vaultId]);
  React.useEffect(() => { void refresh(); }, [refresh]);
  const choose = async (id: string) => { if (!runtime?.canvas) return; const next = await runtime.canvas.open(vaultId, id); setDocument(next); setSelected([]); };
  const create = async () => { if (!runtime?.canvas?.create) { setNotice(labels.empty); return; } const next = await runtime.canvas.create(vaultId, labels.title); setDocument(next); setCanvases(await runtime.canvas.list(vaultId)); };
  const mutate = async (mutation: unknown) => { if (!runtime?.canvas?.mutate || !document) { setNotice(labels.empty); return; } try { setDocument(await runtime.canvas.mutate(vaultId, document.id, mutation)); setNotice(labels.saved); } catch { setNotice(labels.permission); } };
  const openSelected = () => { const node = document?.nodes.find(value => selected.includes(value.id)); const ref = node?.reference; if (!ref) { setNotice(labels.permission); return; } const objectId = typeof ref.objectId === 'string' ? ref.objectId : typeof ref.noteId === 'string' ? ref.noteId : typeof ref.attachmentId === 'string' ? ref.attachmentId : undefined; if (objectId) shell.openReference({ kind: ref.kind === 'vault_note' || ref.kind === 'note' ? 'vault' : ref.kind === 'vault_attachment' || ref.kind === 'file' ? 'file' : 'unknown', id: objectId, vaultId }); else setNotice(labels.permission); };
  return <div className="vault-canvas-surface" data-canvas-id={document?.id ?? canvasId}>
    <div className="surface-kicker"><span className="surface-icon">□</span><span>{labels.title}</span><span className="surface-badge">{t.local}</span></div>
    <div className="canvas-heading"><div><h1>{document?.metadata.title ?? labels.title}</h1><p className="surface-description">{document ? `${document.nodes.length} ${labels.nodes} · r${document.revision}` : labels.empty}</p></div><div className="canvas-actions"><button className="secondary-button" onClick={() => void create()}>{labels.create}</button><button className="secondary-button" onClick={() => { if (document && runtime?.canvas?.undo) void runtime.canvas.undo(vaultId, document.id).then(setDocument); }}>{labels.undo}</button><button className="secondary-button" onClick={() => { if (document && runtime?.canvas?.redo) void runtime.canvas.redo(vaultId, document.id).then(setDocument); }}>{labels.redo}</button></div></div>
    {!runtime?.canvas && <div className="adapter-note"><span>◌</span><div><strong>{labels.empty}</strong><small>{labels.boundary}</small></div></div>}
    <div className="canvas-layout"><aside className="canvas-list" aria-label={labels.title}>{canvases.map(value => <button key={value.id} className={document?.id === value.id ? 'active' : ''} onClick={() => void choose(value.id)}><strong>{value.metadata.title}</strong><small>r{value.revision}</small></button>)}</aside><main className="canvas-workspace" tabIndex={0} aria-label={labels.title}><div className="canvas-viewport" style={{ transform: document ? `translate(${document.viewport.x}px, ${document.viewport.y}px) scale(${document.viewport.zoom})` : undefined }}>{document?.nodes.slice(0, 300).map(node => <button key={node.id} className={`canvas-card canvas-card-${node.kind.toLowerCase()}${selected.includes(node.id) ? ' selected' : ''}`} style={{ left: node.x, top: node.y, width: node.width, height: node.height }} onClick={() => setSelected(current => current.includes(node.id) ? current.filter(id => id !== node.id) : [...current, node.id])} onDoubleClick={openSelected}><span>{node.kind}</span><strong>{node.title ?? node.text ?? (node.reference ? String(node.reference.kind) : node.id)}</strong><small>{node.reference ? '↗ reference' : ''}</small></button>)}</div>{document && <div className="canvas-toolbar"><button className="secondary-button" onClick={() => void mutate({ type: 'create_node', node: { id: `text-${Date.now()}`, kind: 'TEXT_CARD', x: 40, y: 40, width: 220, height: 120, text: labels.addText } })}>{labels.addText}</button><button className="secondary-button" disabled={!selected.length} onClick={() => void mutate({ type: 'move', nodeIds: selected, dx: 24, dy: 24 })}>{labels.move}</button><button className="secondary-button" disabled={selected.length !== 2} onClick={() => void mutate({ type: 'connect', edge: { id: `edge-${Date.now()}`, sourceNodeId: selected[0], targetNodeId: selected[1], directed: false } })}>{labels.connect}</button><button className="secondary-button" disabled={!selected.length} onClick={openSelected}>{labels.open}</button></div>}</main></div>
    {notice && <small className="vault-notice">{notice}</small>}
  </div>;
}

function MapsSurface({ tab, t }: { tab: DesktopTab; shell: DesktopShellController; t: Copy }) {
  const [runtime, setRuntime] = React.useState<DesktopMapsRuntime | undefined>(getDesktopMapsRuntime);
  const [state, setState] = React.useState<DesktopMapsSurfaceState>();
  const [render, setRender] = React.useState<DesktopMapRender>();
  const [results, setResults] = React.useState<readonly DesktopMapPlace[]>([]);
  const [saved, setSaved] = React.useState<readonly DesktopMapPlace[]>([]);
  const [offline, setOffline] = React.useState<readonly { id: string; providerId: string; name: string; sizeBytes: number; contentHash: string }[]>([]);
  const [query, setQuery] = React.useState('');
  const [from, setFrom] = React.useState('');
  const [to, setTo] = React.useState('');
  const [mode, setMode] = React.useState<'WALKING' | 'DRIVING' | 'CYCLING'>('WALKING');
  const [route, setRoute] = React.useState<DesktopMapRoute>();
  const [locationViewport, setLocationViewport] = React.useState<DesktopMapsSurfaceState['viewport']>();
  const [locationPrecision, setLocationPrecision] = React.useState<'APPROXIMATE' | 'PRECISE'>();
  const [notice, setNotice] = React.useState('');
  const ru = t.maps === 'Карты';
  const labels = ru ? {
    subtitle: 'Места и маршруты local-first. Геопозиция не запрашивается автоматически.', unavailable: 'Maps host ещё не подключён', boundary: 'Подключите MapsService через typed host adapter. Shell не получает координаты сам.', search: 'Найти место', searchPlaceholder: 'Название, адрес или категория', showLocation: 'Показать мою геопозицию', locationDone: 'Геопозиция показана однократно', locationUnavailable: 'Одноразовая геопозиция недоступна', results: 'Результаты', saved: 'Сохранённые места', providers: 'Провайдеры', offline: 'Офлайн-пакеты', route: 'Маршрут', from: 'Откуда', to: 'Куда', mode: 'Режим', walking: 'Пешком', driving: 'Авто', cycling: 'Велосипед', plan: 'Построить маршрут', noResults: 'Ничего не найдено локально.', noSaved: 'Сохранённых мест нет.', noOffline: 'Офлайн-пакетов нет.', providerBoundary: 'Внешний провайдер включается только явной privacy policy.', oneShot: 'Только один запрос · без истории перемещений', estimated: 'Оценочный маршрут', steps: 'Шаги', km: 'км', min: 'мин', noRoute: 'Маршрут через host adapter недоступен.'
  } : {
    subtitle: 'Local-first places and routes. Location is never requested automatically.', unavailable: 'Maps host is not connected', boundary: 'Install MapsService through a typed host adapter. The shell never reads coordinates itself.', search: 'Search places', searchPlaceholder: 'Name, address or category', showLocation: 'Show my location', locationDone: 'Location shown once', locationUnavailable: 'One-shot location is unavailable', results: 'Results', saved: 'Saved places', providers: 'Providers', offline: 'Offline packages', route: 'Route', from: 'From', to: 'To', mode: 'Mode', walking: 'Walking', driving: 'Driving', cycling: 'Cycling', plan: 'Plan route', noResults: 'No local results.', noSaved: 'No saved places.', noOffline: 'No offline packages.', providerBoundary: 'External providers are enabled only by explicit privacy policy.', oneShot: 'One request only · no movement history', estimated: 'Estimated route', steps: 'Steps', km: 'km', min: 'min', noRoute: 'Routing host adapter is unavailable.'
  };

  React.useEffect(() => subscribeDesktopMapsRuntime(() => setRuntime(getDesktopMapsRuntime())), []);
  const refresh = React.useCallback(async () => {
    if (!runtime) return;
    try {
      const next = await runtime.open();
      setState(next);
      if (runtime.render) setRender(await runtime.render({ viewport: locationViewport ?? next.viewport }));
      if (runtime.saved) setSaved(await runtime.saved(50)); else setSaved([]);
      if (runtime.offline) setOffline(await runtime.offline()); else setOffline([]);
    } catch { setNotice(labels.boundary); }
  }, [labels.boundary, locationViewport, runtime]);
  React.useEffect(() => { void refresh(); }, [refresh]);
  React.useEffect(() => runtime?.subscribe?.(() => { void refresh(); }), [refresh, runtime]);

  const search = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!runtime || !query.trim()) return;
    try { setResults(await runtime.search({ query: query.trim(), limit: 50 })); setNotice(''); } catch { setNotice(labels.boundary); }
  };
  const showLocation = async () => {
    if (!runtime?.showMyLocation) { setNotice(labels.boundary); return; }
    try {
      const value = await runtime.showMyLocation();
      setLocationViewport(value.viewport); setLocationPrecision(value.precision); setNotice(labels.locationDone);
      if (runtime.render) setRender(await runtime.render({ viewport: value.viewport }));
    } catch { setNotice(labels.locationUnavailable); }
  };
  const plan = async () => {
    if (!runtime?.planRoute || !from.trim() || !to.trim()) { setNotice(labels.noRoute); return; }
    try { setRoute(await runtime.planRoute({ origin: from.trim(), destination: to.trim(), mode })); setNotice(''); } catch { setNotice(labels.noRoute); }
  };
  const center = locationViewport?.center ?? state?.viewport.center;
  if (!runtime) return <div className="object-surface"><div className="surface-kicker"><span className="surface-icon">⌖</span><span>{t.maps}</span><span className="surface-badge">HOST ADAPTER</span></div><h1>{t.maps}</h1><p className="surface-description">{labels.unavailable}</p><div className="adapter-note"><span>◌</span><div><strong>{t.maps}</strong><small>{labels.boundary}</small></div></div></div>;

  return <div className="maps-surface" data-map-tab={tab.object?.id ?? tab.id}>
    <div className="surface-kicker"><span className="surface-icon">⌖</span><span>{t.maps}</span><span className="surface-badge">{state?.location ?? 'HOST'}</span></div>
    <div className="maps-heading"><div><h1>{tab.title}</h1><p className="surface-description">{labels.subtitle}</p></div><button className="secondary-button" onClick={() => void showLocation()}>⌖ {labels.showLocation}</button></div>
    <div className="maps-toolbar"><form className="maps-search" onSubmit={search}><input value={query} onChange={event => setQuery(event.target.value)} placeholder={labels.searchPlaceholder} aria-label={labels.searchPlaceholder}/><button className="primary-button" disabled={!query.trim()}>{labels.search}</button></form>{locationPrecision && <span className="maps-location-state">{locationPrecision} · {labels.oneShot}</span>}</div>
    <div className="maps-layout">
      <main className="maps-main">
        <section className="maps-canvas" aria-label={t.maps}>
          <div className="maps-grid" aria-hidden="true"/><div className="maps-road maps-road-one" aria-hidden="true"/><div className="maps-road maps-road-two" aria-hidden="true"/>
          <span className="maps-canvas-center">{center ? `${center.latitude.toFixed(3)}, ${center.longitude.toFixed(3)}` : '—'}</span>
          {render?.features.slice(0, 40).map((feature, index) => <span className="maps-feature" key={feature.id} style={{ left: `${12 + (index * 17) % 76}%`, top: `${18 + (index * 29) % 62}%` }} title={feature.label ?? feature.kind}>•</span>)}
          <div className="maps-canvas-footer"><span>{render?.layer ?? 'SCHEMATIC'} · {render?.offline ? 'OFFLINE' : (render?.providerId ?? 'LOCAL')}</span><span>{render?.attribution ?? ''}</span></div>
        </section>
        <section className="maps-panel"><div className="maps-panel-heading"><span className="section-label">{labels.results}</span><small>{results.length}</small></div>{results.length ? results.map(placeValue => <button className="maps-place" key={placeValue.placeId} onClick={() => setTo(placeValue.displayName)}><span className="maps-place-glyph">⌖</span><span><strong>{placeValue.displayName}</strong><small>{placeValue.address ?? placeValue.approximateRegion ?? placeValue.category ?? placeValue.provenance} · {placeValue.uri}</small></span></button>) : <p className="maps-empty">{labels.noResults}</p>}</section>
      </main>
      <aside className="maps-side">
        <section className="maps-panel"><div className="maps-panel-heading"><span className="section-label">{labels.route}</span><span>↗</span></div><label>{labels.from}<input value={from} onChange={event => setFrom(event.target.value)} placeholder={labels.from}/></label><label>{labels.to}<input value={to} onChange={event => setTo(event.target.value)} placeholder={labels.to}/></label><label>{labels.mode}<select value={mode} onChange={event => setMode(event.target.value as typeof mode)}><option value="WALKING">{labels.walking}</option><option value="DRIVING">{labels.driving}</option><option value="CYCLING">{labels.cycling}</option></select></label><button className="primary-button maps-full-button" onClick={() => void plan()} disabled={!from.trim() || !to.trim()}>{labels.plan}</button>{route && <div className="maps-route-summary"><strong>{labels.estimated}</strong><span>{(route.distanceMeters / 1000).toFixed(1)} {labels.km} · {Math.round(route.durationSeconds / 60)} {labels.min}</span><span>{labels.steps}: {route.steps.length} · {route.providerId}</span></div>}</section>
        <section className="maps-panel"><span className="section-label">{labels.saved}</span>{saved.length ? saved.slice(0, 8).map(placeValue => <button className="maps-compact-place" key={placeValue.placeId} onClick={() => setTo(placeValue.displayName)}><strong>{placeValue.displayName}</strong><small>{placeValue.category ?? placeValue.provenance}</small></button>) : <p className="maps-empty">{labels.noSaved}</p>}</section>
        <section className="maps-panel"><span className="section-label">{labels.providers}</span>{state?.providers.map(provider => <div className="maps-provider" key={provider.id}><strong>{provider.name}</strong><small>{provider.class} · {provider.operations.join(' · ')}</small></div>)}<p className="maps-disclosure">{labels.providerBoundary}</p></section>
        <section className="maps-panel"><span className="section-label">{labels.offline}</span>{offline.length ? offline.map(packageValue => <div className="maps-provider" key={packageValue.id}><strong>{packageValue.name}</strong><small>{packageValue.providerId} · {formatBytes(packageValue.sizeBytes)} · {packageValue.contentHash.slice(0, 18)}</small></div>) : <p className="maps-empty">{labels.noOffline}</p>}</section>
      </aside>
    </div>
    {notice && <small className="maps-notice">{notice}</small>}
  </div>;
}

function formatBytes(value: number): string { if (value < 1_024) return `${value} B`; if (value < 1_048_576) return `${Math.round(value / 1_024)} KB`; return `${(value / 1_048_576).toFixed(1)} MB`; }

function MailSurface({ tab, shell, t }: { tab: DesktopTab; shell: DesktopShellController; t: Copy }) {
  const [runtime, setRuntime] = React.useState<DesktopMailRuntime | undefined>(getDesktopMailRuntime);
  const [accounts, setAccounts] = React.useState<readonly DesktopMailAccount[]>([]);
  const [folders, setFolders] = React.useState<readonly DesktopMailFolder[]>([]);
  const [messages, setMessages] = React.useState<readonly DesktopMailMessage[]>([]);
  const [outbox, setOutbox] = React.useState<readonly DesktopMailOutboxEntry[]>([]);
  const [selectedAccount, setSelectedAccount] = React.useState<string>();
  const [selectedFolder, setSelectedFolder] = React.useState<string>();
  const [selectedMessage, setSelectedMessage] = React.useState<DesktopMailMessage>();
  const [rendered, setRendered] = React.useState<{ mode: 'TEXT' | 'SANITIZED_HTML'; value: string; blockedExternalImages: readonly string[]; safeLinks: readonly { url: string; label: string }[] }>();
  const [draft, setDraft] = React.useState<DesktopMailDraft>();
  const [query, setQuery] = React.useState('');
  const [results, setResults] = React.useState<readonly { readonly id: string; readonly kind: 'mail' | 'mail-thread'; readonly title: string; readonly snippet: string }[]>([]);
  const [notice, setNotice] = React.useState('');
  const ru = t.home === 'Главная';
  const labels = ru ? { title: 'Внешняя почта', subtitle: 'External Email · локальный кэш и ваш настроенный provider', inbox: 'Входящие', compose: 'Написать', reply: 'Ответить', replyAll: 'Ответить всем', forward: 'Переслать', send: 'Отправить внешне', refresh: 'Обновить', search: 'Поиск почты', offline: 'Офлайн-кэш', provider: 'Внешний provider', noRuntime: 'Mail host adapter не подключён.', noMessages: 'Кэшированных писем нет.', select: 'Выберите письмо', noAccount: 'Добавьте внешний mail account в Settings.', images: 'Внешние изображения заблокированы по умолчанию.', attachments: 'Вложения', download: 'Скачать', saveAttachment: 'Сохранить приватно', markRead: 'Пометить прочитанным', star: 'Звезда', move: 'Переместить', delete: 'Удалить', draft: 'Черновик', outbox: 'Исходящие', sent: 'Отправлено', unread: 'Непрочитанные', bodyUnavailable: 'Тело письма ещё не закэшировано.', recipient: 'Получатели через запятую', subject: 'Тема', body: 'Текст письма', save: 'Сохранить черновик', sendNotice: 'Отправка проходит через настроенного внешнего provider.', external: 'External Email', host: 'HOST ADAPTER' } : { title: 'External Email', subtitle: 'External Email · local cache and your configured provider', inbox: 'Inbox', compose: 'Compose', reply: 'Reply', replyAll: 'Reply all', forward: 'Forward', send: 'Send externally', refresh: 'Refresh', search: 'Search mail', offline: 'Offline local cache', provider: 'External provider', noRuntime: 'Mail host adapter is not connected.', noMessages: 'No cached messages.', select: 'Select a message', noAccount: 'Add an external mail account in Settings.', images: 'External images are blocked by default.', attachments: 'Attachments', download: 'Download', saveAttachment: 'Save privately', markRead: 'Mark read', star: 'Star', move: 'Move', delete: 'Delete', draft: 'Draft', outbox: 'Outbox', sent: 'Sent', unread: 'Unread', bodyUnavailable: 'Body is not cached yet.', recipient: 'Recipients, comma separated', subject: 'Subject', body: 'Message body', save: 'Save draft', sendNotice: 'Sending leaves Keystone through your configured external provider.', external: 'External Email', host: 'HOST ADAPTER' };

  React.useEffect(() => subscribeDesktopMailRuntime(() => setRuntime(getDesktopMailRuntime())), []);
  const refresh = React.useCallback(async () => {
    if (!runtime) return;
    try {
      const nextAccounts = await Promise.resolve(runtime.accounts());
      setAccounts(nextAccounts);
      const accountId = selectedAccount && nextAccounts.some(value => value.id === selectedAccount) ? selectedAccount : nextAccounts[0]?.id;
      setSelectedAccount(accountId);
      if (!accountId) { setFolders([]); setMessages([]); setOutbox([]); return; }
      const nextFolders = await Promise.resolve(runtime.folders(accountId));
      setFolders(nextFolders);
      const folderId = selectedFolder && nextFolders.some(value => value.id === selectedFolder) ? selectedFolder : nextFolders.find(value => value.role === 'INBOX')?.id ?? nextFolders[0]?.id;
      setSelectedFolder(folderId);
      setMessages(await runtime.messages({ accountId, folderId, limit: 100 }));
      if (runtime.outbox) setOutbox(await Promise.resolve(runtime.outbox(accountId))); else setOutbox([]);
    } catch { setNotice(labels.noRuntime); }
  }, [labels.noRuntime, runtime, selectedAccount, selectedFolder]);
  React.useEffect(() => { void refresh(); }, [refresh]);
  React.useEffect(() => runtime?.subscribe?.(() => { void refresh(); }), [refresh, runtime]);

  const openMessage = (message: DesktopMailMessage) => { setSelectedMessage(message); setDraft(undefined); setRendered(runtime?.render ? runtime.render(message.id) : { mode: 'TEXT', value: message.bodyText ?? message.snippet, blockedExternalImages: message.externalImageUrls, safeLinks: [] }); if (runtime?.markRead && !message.flags.includes('SEEN')) void runtime.markRead(message.id).then(() => refresh()).catch(() => undefined); };
  const compose = async (next?: DesktopMailDraft) => { if (next) { setDraft(next); setSelectedMessage(undefined); return; } if (!runtime?.createDraft || !selectedAccount) { setNotice(labels.noAccount); return; } try { setDraft(await runtime.createDraft({ accountId: selectedAccount })); setSelectedMessage(undefined); } catch { setNotice(labels.noRuntime); } };
  const saveDraft = async () => { if (!draft || !runtime?.updateDraft) return; try { setDraft(await runtime.updateDraft(draft.id, { to: draft.to, cc: draft.cc, bcc: draft.bcc, subject: draft.subject, bodyText: draft.bodyText })); setNotice(labels.save); } catch { setNotice(labels.noRuntime); } };
  const sendDraft = async () => { if (!draft || !runtime?.send) { setNotice(labels.noRuntime); return; } try { await saveDraft(); const entry = await runtime.send(draft.id, true); setOutbox(current => [entry, ...current.filter(value => value.id !== entry.id)]); setNotice(entry.state === 'UNKNOWN' ? labels.outbox : labels.sendNotice); await refresh(); } catch { setNotice(labels.noRuntime); } };
  const runSearch = async (event: React.FormEvent) => { event.preventDefault(); if (!runtime?.search || !query.trim()) { setResults([]); return; } try { setResults(await Promise.resolve(runtime.search(query.trim(), { accountId: selectedAccount, limit: 30 }))); } catch { setNotice(labels.noRuntime); } };
  const openSearchResult = async (id: string) => { const direct = messages.find(value => value.id === id); if (direct) { openMessage(direct); return; } if (!runtime || !selectedAccount) return; try { const all = await runtime.messages({ accountId: selectedAccount, limit: 100 }); const found = all.find(value => value.id === id); setMessages(all); if (found) openMessage(found); } catch { setNotice(labels.noRuntime); } };
  const updateDraft = (patch: Partial<DesktopMailDraft>) => setDraft(current => current ? { ...current, ...patch } : current);
  const addresses = (value: readonly DesktopMailAddress[]) => value.map(item => item.name ? item.name + ' <' + item.address + '>' : item.address).join(', ');
  const attachmentAction = async (messageId: string, attachmentId: string, save: boolean) => { if (!runtime) return; try { if (save && runtime.saveAttachment) setNotice((await runtime.saveAttachment(messageId, attachmentId)).fileId); else if (!save && runtime.downloadAttachment) setNotice((await runtime.downloadAttachment(messageId, attachmentId)).filename); } catch { setNotice(labels.noRuntime); } };

  if (!runtime) return <div className="object-surface"><div className="surface-kicker"><span className="surface-icon">✉</span><span>{labels.external}</span><span className="surface-badge">{labels.host}</span></div><h1>{labels.title}</h1><p className="surface-description">{labels.noRuntime}</p><div className="adapter-note"><span>◌</span><div><strong>{labels.provider}</strong><small>{labels.noAccount}</small></div></div></div>;
  const currentAccount = accounts.find(value => value.id === selectedAccount);
  const currentFolder = folders.find(value => value.id === selectedFolder);
  const messageBody = rendered ?? (selectedMessage ? { mode: 'TEXT' as const, value: selectedMessage.bodyText ?? selectedMessage.snippet, blockedExternalImages: selectedMessage.externalImageUrls, safeLinks: [] } : undefined);
  return <div className="mail-surface">
    <div className="surface-kicker"><span className="surface-icon">✉</span><span>{labels.external}</span><span className="surface-badge">{currentAccount?.providerKind ?? labels.provider}</span></div>
    <div className="mail-heading"><div><h1>{labels.title}</h1><p className="surface-description">{labels.subtitle}</p></div><div className="mail-actions"><button className="secondary-button" onClick={() => void refresh()}>{labels.refresh}</button><button className="primary-button" onClick={() => void compose()}>{labels.compose}</button></div></div>
    {currentAccount && <div className="mail-account"><strong>{currentAccount.label}</strong><span>{currentAccount.address.address}</span><small>{currentAccount.enabled ? labels.offline : labels.noAccount}{currentAccount.attention ? ' · ' + currentAccount.attention : ''}</small></div>}
    {!accounts.length && <div className="adapter-note"><span>◌</span><div><strong>{labels.noAccount}</strong><small>{labels.noRuntime}</small></div></div>}
    <div className="mail-layout">
      <aside className="mail-sidebar"><span className="section-label">{labels.provider}</span>{folders.map(folder => <button key={folder.id} className={folder.id === selectedFolder ? 'mail-folder active' : 'mail-folder'} onClick={() => { setSelectedFolder(folder.id); setSelectedMessage(undefined); }}>{folder.name}<small>{folder.unreadCount ?? ''}</small></button>)}<span className="section-label mail-section-label">{labels.outbox}</span>{outbox.slice(0, 12).map(entry => <div className="mail-outbox-row" key={entry.id}><span>{entry.state}</span><small>{entry.lastError ?? entry.stableMessageId.slice(0, 18)}</small></div>)}</aside>
      <main className="mail-main"><form className="mail-search" onSubmit={runSearch}><input value={query} onChange={event => setQuery(event.target.value)} placeholder={labels.search} aria-label={labels.search}/><button className="secondary-button">{labels.search}</button></form>{results.length > 0 && <div className="mail-search-results">{results.map(result => <button key={result.id} onClick={() => void openSearchResult(result.id)}><strong>{result.title}</strong><small>{result.kind} · {result.snippet}</small></button>)}</div>}{messages.length ? <div className="mail-message-list">{messages.map(message => <button key={message.id} className={'mail-message-row' + (selectedMessage?.id === message.id ? ' active' : '') + (!message.flags.includes('SEEN') ? ' unread' : '')} onClick={() => openMessage(message)}><span className="mail-message-dot">{message.flags.includes('STARRED') ? '★' : '·'}</span><span className="mail-message-copy"><strong>{message.from.name ?? message.from.address}</strong><b>{message.subject || labels.noMessages}</b><small>{message.snippet}</small></span><time>{new Date(message.receivedAt).toLocaleDateString()}</time></button>)}</div> : <div className="mail-empty"><span>✉</span><p>{selectedAccount ? labels.noMessages : labels.noAccount}</p></div>}</main>
      <section className="mail-reader">{draft ? <div className="mail-compose"><div className="mail-reader-heading"><span className="section-label">{labels.draft}</span><button className="secondary-button" onClick={() => setDraft(undefined)}>×</button></div><label>{labels.recipient}<input value={addresses(draft.to)} onChange={event => updateDraft({ to: parseDesktopMailAddresses(event.target.value) })}/></label><label>{labels.subject}<input value={draft.subject} onChange={event => updateDraft({ subject: event.target.value })}/></label><label>{labels.body}<textarea value={draft.bodyText} onChange={event => updateDraft({ bodyText: event.target.value })}/></label><div className="mail-compose-actions"><button className="secondary-button" onClick={() => void saveDraft()}>{labels.save}</button><button className="primary-button" onClick={() => void sendDraft()}>{labels.send}</button></div><small className="mail-disclosure">{labels.sendNotice}</small></div> : selectedMessage ? <><div className="mail-reader-heading"><div><span className="section-label">{currentFolder?.name ?? labels.external}</span><h2>{selectedMessage.subject || labels.noMessages}</h2><small>{addresses([selectedMessage.from])} · {new Date(selectedMessage.receivedAt).toLocaleString()}</small></div><div className="mail-reader-actions"><button className="secondary-button" onClick={() => void runtime.reply?.(selectedMessage.id).then(value => compose(value))}>{labels.reply}</button><button className="secondary-button" onClick={() => void runtime.reply?.(selectedMessage.id, true).then(value => compose(value))}>{labels.replyAll}</button><button className="secondary-button" onClick={() => void runtime.forward?.(selectedMessage.id).then(value => compose(value))}>{labels.forward}</button></div></div><div className="mail-policy-note">{labels.images}</div>{messageBody?.mode === 'SANITIZED_HTML' ? <div className="mail-body" onClick={event => { const target = event.target as HTMLElement; const anchor = target.closest('a'); if (anchor?.href) { event.preventDefault(); void runtime.openExternal?.(anchor.href); } }} dangerouslySetInnerHTML={{ __html: messageBody.value }} /> : <pre className="mail-body mail-body-text">{messageBody?.value ?? labels.bodyUnavailable}</pre>}{messageBody?.blockedExternalImages.length ? <small className="mail-blocked-images">{messageBody.blockedExternalImages.length} blocked remote image(s)</small> : null}{selectedMessage.attachments.length > 0 && <div className="mail-attachments"><span className="section-label">{labels.attachments}</span>{selectedMessage.attachments.map(attachment => <div className="mail-attachment" key={attachment.id}><span>▤</span><strong>{attachment.filename}</strong><small>{formatBytes(attachment.sizeBytes)} · {attachment.contentAvailable ? 'cached' : 'lazy/private'}</small><button className="secondary-button" onClick={() => void attachmentAction(selectedMessage.id, attachment.id, false)}>{labels.download}</button><button className="secondary-button" onClick={() => void attachmentAction(selectedMessage.id, attachment.id, true)}>{labels.saveAttachment}</button></div>)}</div>}<div className="mail-reader-footer"><button className="secondary-button" onClick={() => void runtime.markRead?.(selectedMessage.id, !selectedMessage.flags.includes('SEEN'))}>{labels.markRead}</button><button className="secondary-button" onClick={() => void runtime.setStarred?.(selectedMessage.id, !selectedMessage.flags.includes('STARRED'))}>★ {labels.star}</button><button className="secondary-button" onClick={() => void runtime.delete?.(selectedMessage.id)}>{labels.delete}</button></div></> : <div className="mail-empty"><span>⌁</span><p>{labels.select}</p></div>}</section>
    </div>
    {notice && <small className="mail-notice">{notice}</small>}
  </div>;
}

function parseDesktopMailAddresses(value: string): readonly DesktopMailAddress[] { return value.split(',').map(item => item.trim()).filter(Boolean).map(address => ({ address })); }

type CalendarView = 'DAY' | 'WEEK' | 'MONTH' | 'AGENDA';

function CalendarSurface({ tab, shell, t }: { tab: DesktopTab; shell: DesktopShellController; t: Copy }) {
  const [runtime, setRuntime] = React.useState<DesktopCalendarRuntime | undefined>(getDesktopCalendarRuntime);
  const [view, setView] = React.useState<CalendarView>('WEEK');
  const [calendars, setCalendars] = React.useState<readonly { id: string; name: string; timezone: string; visibility: string }[]>([]);
  const [events, setEvents] = React.useState<readonly DesktopCalendarEvent[]>([]);
  const [selectedCalendar, setSelectedCalendar] = React.useState<string>();
  const [notice, setNotice] = React.useState('');
  const ru = t.calendar.startsWith('К');
  const labels = ru ? { unavailable: 'Calendar host ещё не подключён', boundary: 'Подключите существующий CalendarService через host adapter; shell не создаёт события сам.', today: 'Сегодня', previous: 'Назад', next: 'Вперёд', timezone: 'Часовой пояс', shared: 'Общие календари', create: 'Новое событие', free: 'Найти свободное время', empty: 'Нет событий в выбранном диапазоне', day: 'День', week: 'Неделя', month: 'Месяц', agenda: 'Повестка', side: 'Свойства и ссылки', newEvent: 'Событие создано через CalendarService' } : { unavailable: 'Calendar host is not connected', boundary: 'Install the existing CalendarService through a host adapter; the shell never creates fake events.', today: 'Today', previous: 'Previous', next: 'Next', timezone: 'Timezone', shared: 'Shared calendars', create: 'New event', free: 'Find free time', empty: 'No events in the selected range', day: 'Day', week: 'Week', month: 'Month', agenda: 'Agenda', side: 'Properties and links', newEvent: 'Event created through CalendarService' };
  React.useEffect(() => subscribeDesktopCalendarRuntime(() => setRuntime(getDesktopCalendarRuntime())), []);
  const refresh = React.useCallback(async () => { if (!runtime) return; const nextCalendars = await runtime.calendars(); setCalendars(nextCalendars); const calendarId = selectedCalendar ?? nextCalendars[0]?.id; setSelectedCalendar(calendarId); if (calendarId) setEvents(await runtime.events({ calendarId, expand: view !== 'AGENDA' })); }, [runtime, selectedCalendar, view]);
  React.useEffect(() => { void refresh(); }, [refresh]);
  const create = async () => { if (!runtime?.createEvent || !selectedCalendar) { setNotice(labels.boundary); return; } const start = new Date(Date.now() + 60 * 60_000); start.setMinutes(0, 0, 0); const end = new Date(start.getTime() + 60 * 60_000); await runtime.createEvent({ calendarId: selectedCalendar, title: labels.create, start: start.toISOString(), end: end.toISOString() }); setNotice(labels.newEvent); await refresh(); };
  return <div className="calendar-surface" data-calendar-id={tab.object?.id ?? tab.id}>
    <div className="surface-kicker"><span className="surface-icon">□</span><span>{t.calendar}</span><span className="surface-badge">{t.local}</span></div>
    <div className="calendar-heading"><div><h1>{tab.title}</h1><p className="surface-description">{runtime ? `${calendars.length} ${labels.shared} · ${calendars.find(value => value.id === selectedCalendar)?.timezone ?? 'UTC'}` : labels.unavailable}</p></div><div className="calendar-actions"><button className="secondary-button" onClick={() => setNotice(labels.boundary)}>{labels.today}</button><button className="primary-button" onClick={() => void create()}>{labels.create}</button></div></div>
    <div className="calendar-toolbar"><div className="calendar-view-switcher">{([['DAY', labels.day], ['WEEK', labels.week], ['MONTH', labels.month], ['AGENDA', labels.agenda]] as const).map(([value, label]) => <button key={value} className={view === value ? 'active' : ''} onClick={() => setView(value)}>{label}</button>)}</div><div className="calendar-nav"><button onClick={() => setNotice(labels.previous)}>‹</button><button onClick={() => setNotice(labels.today)}>{labels.today}</button><button onClick={() => setNotice(labels.next)}>›</button></div>{calendars.length > 0 && <select value={selectedCalendar} onChange={event => setSelectedCalendar(event.target.value)} aria-label={labels.shared}>{calendars.map(calendar => <option key={calendar.id} value={calendar.id}>{calendar.name} · {calendar.visibility}</option>)}</select>}</div>
    <div className="calendar-layout"><main className="calendar-grid">{events.length ? events.map(event => <article key={event.id} className="calendar-event"><time>{formatCalendarTime(event.start)}–{formatCalendarTime(event.end)}</time><strong>{event.title || 'BUSY'}</strong><small>{event.timezone}</small></article>) : <div className="calendar-empty"><span>□</span><p>{runtime ? labels.empty : labels.boundary}</p></div>}</main><aside className="calendar-side"><span className="section-label">{labels.side}</span><p>{labels.timezone}: {calendars.find(value => value.id === selectedCalendar)?.timezone ?? 'UTC'}</p><p>{labels.shared}: {calendars.length}</p><button className="secondary-button" onClick={() => { if (runtime?.findCommonTime) void runtime.findCommonTime().then(value => setNotice(value[0] ? `${value[0].start} – ${value[0].end}` : labels.empty)); else setNotice(labels.boundary); }}>{labels.free}</button>{notice && <small>{notice}</small>}</aside></div>
  </div>;
}

function formatCalendarTime(value: string): string { const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'; }

function PlaceholderSurface({ tab, t }: { tab: DesktopTab; t: Copy }) {
  return <div className="placeholder-surface"><span className="placeholder-icon">{tabIcon(tab.kind)}</span><span className="surface-kicker">{t.placeholder}</span><h1>{tab.title}</h1><p>{t.placeholderBody}</p><div className="adapter-note"><span>◌</span><div><strong>Host-provided adapter boundary</strong><small>Existing subsystem can attach here without changing the desktop shell.</small></div></div></div>;
}

function EmptyPane({ shell, t }: { shell: DesktopShellController; t: Copy }) { return <div className="empty-pane"><span>⌘</span><p>{t.empty}</p><button className="secondary-button" onClick={() => shell.openReference({ kind: 'home', id: 'home', label: t.home })}>{t.open}</button></div>; }

function CaptureSurface({ shell, t }: { shell: DesktopShellController; t: Copy }) {
  const [runtime, setRuntime] = React.useState<DesktopCaptureRuntime | undefined>(getDesktopCaptureRuntime);
  const [page, setPage] = React.useState<Awaited<ReturnType<DesktopCaptureRuntime['list']>>>({ items: [], total: 0 });
  const [value, setValue] = React.useState(''); const [query, setQuery] = React.useState(''); const [selectedId, setSelectedId] = React.useState(''); const [suggestions, setSuggestions] = React.useState<Awaited<ReturnType<DesktopCaptureRuntime['suggestions']>>>([]); const [destination, setDestination] = React.useState<CaptureDestinationKind>('VAULT'); const [preview, setPreview] = React.useState<Awaited<ReturnType<DesktopCaptureRuntime['preview']>>>(); const [notice, setNotice] = React.useState(''); const fileInput = React.useRef<HTMLInputElement>(null); const ru = t.home === 'Главная';
  const refresh = React.useCallback(async () => { if (!runtime) return; try { const next = await runtime.list({ query: query.trim() || undefined, limit: 64 }); setPage(next); if (selectedId && !next.items.some(item => item.id === selectedId)) setSelectedId(''); setNotice(''); } catch { setNotice(t.captureNoRuntime); } }, [query, runtime, selectedId, t.captureNoRuntime]);
  React.useEffect(() => subscribeDesktopCaptureRuntime(() => setRuntime(getDesktopCaptureRuntime())), []);
  React.useEffect(() => { void refresh(); }, [refresh]);
  React.useEffect(() => { if (!runtime?.subscribe) return; return runtime.subscribe(() => void refresh()); }, [refresh, runtime]);
  const select = async (item: Awaited<ReturnType<DesktopCaptureRuntime['list']>>['items'][number]) => { setSelectedId(item.id); setPreview(undefined); try { setSuggestions(await runtime!.suggestions(item.id)); } catch { setSuggestions([]); } };
  const capture = async () => { if (!runtime || !value.trim()) return; try { const item = /^https?:\/\//i.test(value.trim()) ? await runtime.captureUrl(value.trim()) : await runtime.captureText(value); setValue(''); await refresh(); await select(item); } catch (error) { setNotice(error instanceof Error ? error.message : t.captureUnsafe); } };
  const captureClipboard = async () => { if (!runtime) return; try { const item = await runtime.captureClipboard({ ownerConfirmed: true }); await refresh(); await select(item); } catch (error) { setNotice(error instanceof Error ? error.message : t.captureNoRuntime); } };
  const captureFile = async (file: File) => { if (!runtime) return; try { const item = await runtime.captureFile({ name: file.name, mimeType: file.type || 'application/octet-stream', size: file.size, read: async () => new Uint8Array(await file.arrayBuffer()), source: { kind: 'FILE_DROP', label: file.name } }); await refresh(); await select(item); } catch (error) { setNotice(error instanceof Error ? error.message : t.captureNoRuntime); } };
  const route = async () => { if (!runtime || !selectedId) return; try { if (!preview) { setPreview(await runtime.preview(selectedId, destination)); return; } await runtime.route(selectedId, destination); setNotice(ru ? 'Маршрут выполнен.' : 'Capture routed.'); setPreview(undefined); await refresh(); } catch (error) { setNotice(error instanceof Error ? error.message : t.captureNoRuntime); } };
  const selected = page.items.find(item => item.id === selectedId);
  return <div className="capture-surface" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); const files = [...event.dataTransfer.files].slice(0, 32); if (files.length) { void Promise.all(files.map(captureFile)); return; } const raw = event.dataTransfer.getData('application/x-keystone-ref'); if (raw && runtime) { try { const ref = JSON.parse(raw) as { type: string; id: string; label?: string; dataClass?: 'PUBLIC' | 'USER_EXPLICIT' | 'PRIVATE' | 'SECRET' }; void runtime.capture.captureReference({ reference: { type: ref.type, id: ref.id, label: ref.label, dataClass: ref.dataClass ?? 'USER_EXPLICIT' }, source: { kind: 'KEYSTONE_OBJECT', label: ref.label } }).then(item => { void refresh(); void select(item); }); } catch { setNotice(t.captureUnsafe); } } }}>
    <div className="surface-kicker"><span className="surface-icon">＋</span><span>{t.capture}</span><span className="surface-badge">{runtime?.hostConnected ? 'HOST' : t.local}</span></div>
    <div className="capture-heading"><div><h1>{t.capture}</h1><p className="surface-description">{t.captureHint}</p></div><kbd>{isMac() ? '⌘' : 'Ctrl'} ⇧ Space</kbd></div>
    {!runtime?.hostConnected && <div className="adapter-note"><span>◌</span><div><strong>{t.captureNoRuntime}</strong><small>{t.captureUnsafe}</small></div></div>}
    <div className="capture-composer"><textarea value={value} onChange={event => setValue(event.target.value)} placeholder={t.capturePlaceholder} aria-label={t.capturePlaceholder} onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); void capture(); } }} /><div className="capture-actions"><button className="primary-button" onClick={() => void capture()} disabled={!value.trim()}>{t.capture}</button><button className="secondary-button" onClick={() => void captureClipboard()}>{t.captureClipboard}</button><button className="secondary-button" onClick={() => fileInput.current?.click()}>{t.files}</button><button className="secondary-button" onClick={() => { if (!runtime) { setNotice(t.captureNoRuntime); return; } void runtime.captureBrowserPage({ ownerConfirmed: true }).then(item => { void refresh(); void select(item); }).catch(error => setNotice(error instanceof Error ? error.message : t.captureNoRuntime)); }}>{t.captureBrowser}</button><button className="secondary-button" onClick={() => { if (!runtime) { setNotice(t.captureNoRuntime); return; } void runtime.captureBrowserSelection({ ownerConfirmed: true }).then(item => { void refresh(); void select(item); }).catch(error => setNotice(error instanceof Error ? error.message : t.captureNoRuntime)); }}>{t.captureSelection}</button><input ref={fileInput} type="file" hidden multiple onChange={event => { const files = [...(event.target.files ?? [])]; void Promise.all(files.slice(0, 32).map(captureFile)); event.currentTarget.value = ''; }} /></div></div>
    <div className="capture-toolbar"><input value={query} onChange={event => setQuery(event.target.value)} placeholder={ru ? 'Поиск Tray' : 'Search tray'} aria-label={ru ? 'Поиск Tray' : 'Search tray'} /><span>{page.total} · {t.captureTray}</span><button className="secondary-button" onClick={() => void refresh()}>{t.refresh}</button></div>
    <div className="capture-layout"><div className="capture-list"><span className="section-label">{t.captureTray}</span>{page.items.length ? page.items.map(item => <button key={item.id} className={`capture-item${item.id === selectedId ? ' active' : ''}`} onClick={() => void select(item)}><span className="capture-item-icon">{item.payload.kind === 'URL' || item.payload.kind === 'BROWSER_PAGE' ? '↗' : item.payload.kind === 'FILE' || item.payload.kind === 'IMAGE' || item.payload.kind === 'DOCUMENT' ? '▤' : '＋'}</span><span><strong>{item.title}</strong><small>{item.provenance.source.kind} · {item.state}</small></span></button>) : <div className="adapter-note"><span>＋</span><div><strong>{t.captureNoItems}</strong><small>{t.captureDrop}</small></div></div>}</div><div className="capture-detail">{selected ? <><span className="section-label">{t.captureSource}</span><h2>{selected.title}</h2><p className="capture-preview-text">{capturePreviewText(selected)}</p><small>{selected.provenance.source.kind} · {selected.state} · {selected.provenance.dataClass}</small><div className="capture-suggestions"><span className="section-label">{t.captureSuggestions}</span>{suggestions.map(item => <button key={item.destination} className={destination === item.destination ? 'selected' : ''} onClick={() => { setDestination(item.destination); setPreview(undefined); }}><strong>{item.destination}</strong><small>{item.reason}</small></button>)}</div><div className="capture-route"><select value={destination} onChange={event => { setDestination(event.target.value as CaptureDestinationKind); setPreview(undefined); }}><option value="TASK">TASK</option><option value="VAULT">VAULT</option><option value="WEB_LIBRARY">WEB_LIBRARY</option><option value="FILES">FILES</option><option value="PHOTOS">PHOTOS</option><option value="DOCUMENTS">DOCUMENTS</option><option value="CONTACTS">CONTACTS</option><option value="CALENDAR">CALENDAR</option><option value="WORKBOARD">WORKBOARD</option><option value="SHARED_FOLDER">SHARED_FOLDER</option></select><button className="primary-button" onClick={() => void route()}>{preview ? t.captureConfirm : t.capturePreview}</button><button className="secondary-button" onClick={() => { void runtime!.dismiss(selected.id).then(() => refresh()); }}>{t.captureDismiss}</button></div>{preview && <div className="capture-consequence"><strong>{preview.title}</strong><small>{preview.summary}</small><small>{preview.disclosure} · {preview.warnings.join(' ') || t.privacy}</small></div>}</> : <div className="placeholder-surface"><span className="placeholder-icon">＋</span><h2>{t.captureTray}</h2><p>{t.captureDrop}</p></div>}</div></div>{notice && <small className="continuity-notice">{notice}</small>}
  </div>;
}

function capturePreviewText(item: Awaited<ReturnType<DesktopCaptureRuntime['list']>>['items'][number]): string { const payload = item.payload; if (payload.kind === 'TEXT') return payload.text; if (payload.kind === 'URL') return payload.url; if (payload.kind === 'BROWSER_PAGE') return `${payload.url}\n${payload.excerpt ?? ''}`; if (payload.kind === 'BROWSER_SELECTION') return payload.selectedText; if (payload.kind === 'REFERENCE') return `${payload.reference.type} · ${payload.reference.id}`; if (payload.kind === 'CONTACT_CARD') return payload.vCard; if (payload.kind === 'MULTI') return `${payload.items.length} items`; return `${payload.file.name} · ${payload.file.size} B`;
}

function TypedReferenceDock({ tab, shell, t }: { tab: DesktopTab; shell: DesktopShellController; t: Copy }) {
  const suggestions: KeystoneObjectReference[] = tab.kind === 'profile' ? [{ kind: 'chat', id: 'chat-bob', label: 'Chat · Bob' }, { kind: 'agent', id: 'agent-orbit', label: 'Orbit' }] : tab.kind === 'chat' ? [{ kind: 'file', id: 'file-shared', label: 'Shared file' }, { kind: 'space', id: 'space-chat', label: 'Related space' }] : tab.kind === 'file' ? [{ kind: 'chat', id: 'chat-file', label: 'Share in chat' }, { kind: 'space', id: 'space-file', label: 'Attach to Space' }] : tab.kind === 'music' ? [{ kind: 'playlist', id: 'playlist-current', label: 'Add to Playlist' }, { kind: 'profile', id: 'artist-profile', label: 'Artist profile' }] : tab.kind === 'vault' ? [{ kind: 'space', id: 'space-note', label: 'Share with Space' }] : [];
  if (!suggestions.length) return null;
  return <div className="reference-dock"><span className="section-label">{t.references}</span><div>{suggestions.map(ref => <button key={`${ref.kind}:${ref.id}`} draggable onDragStart={event => event.dataTransfer.setData('application/x-keystone-ref', JSON.stringify(ref))} onClick={() => shell.openReference(ref)}><span>{tabIcon(ref.kind)}</span>{ref.label}</button>)}</div></div>;
}

function ContextSidebar({ data, t }: { data: ReturnType<ContextProviderRegistry['resolve']>; t: Copy }) {
  return <aside className="context-sidebar" aria-label={t.context}><div className="sidebar-heading"><div><span className="section-label">{t.context}</span><h2>{data.title}</h2></div><span className="sidebar-dots">⋯</span></div>{data.sections.map(section => <section className="context-section" key={section.id}><h3>{section.title}</h3>{section.items.map(item => <p key={item}>{item}</p>)}</section>)}<div className="sidebar-footer"><span className="status-light"/> {t.privacy}</div></aside>;
}

function AgentBotPanel({ shell, t, activeTab, prefill, onClose }: { shell: DesktopShellController; t: Copy; activeTab?: DesktopTab; prefill?: string; onClose: () => void }) {
  const [prompt, setPrompt] = React.useState(prefill ?? '');
  const [messages, setMessages] = React.useState<string[]>([]);
  const browserPage = activeTab?.kind === 'browser' ? shell.browserPage(activeTab.id) : undefined;
  const scope = browserPage ? `${activeTab?.title ?? 'Browser'} · ${browserPage.origin} · revision ${browserPage.pageRevision}` : activeTab?.object ? `${activeTab.title} · ${activeTab.object.id}` : t.noObject;
  React.useEffect(() => { if (prefill) setPrompt(prefill); }, [prefill]);
  const submit = (event: React.FormEvent) => { event.preventDefault(); const value = prompt.trim(); if (!value) return; setMessages(current => [...current, value]); setPrompt(''); shell.setNotice(`${t.agentScope}: ${scope}`); };
  const toolFlow = shell.toolFlowState();
  return <aside className="agent-panel" aria-label={t.agent}><div className="agent-panel-heading"><div><span className="section-label">{t.agent}</span><h2>{t.local}</h2></div><button onClick={onClose} aria-label={t.close}>×</button></div><div className="agent-scope"><span className="scope-dot"/><div><small>{t.agentScope}</small><strong>{scope}</strong></div></div>{toolFlow && <section className="toolflow-card" aria-label="ToolFlow"><div className="toolflow-heading"><div><span className="section-label">ToolFlow</span><strong>{toolFlow.status}</strong></div><span className="privacy-mark">{toolFlow.privacyClass}</span></div><div className="toolflow-sequence">{toolFlow.steps.map((step, index) => <React.Fragment key={step.id}><span className={`toolflow-step ${step.status}`}><i/>{step.label}</span>{index < toolFlow.steps.length - 1 && <span className="toolflow-arrow">→</span>}</React.Fragment>)}</div><div className="toolflow-meta"><span>{toolFlow.sourceCount} {toolFlow.sourceCount === 1 ? 'source' : 'sources'}</span><span>{toolFlow.executionId.slice(0, 18)}</span></div>{(toolFlow.status === 'running' || toolFlow.status === 'paused') && <div className="toolflow-actions"><button className="secondary-button" onClick={() => toolFlow.status === 'paused' ? shell.resumeToolFlow() : shell.pauseToolFlow()}>{toolFlow.status === 'paused' ? 'Resume' : 'Pause'}</button><button className="secondary-button" onClick={() => shell.cancelToolFlow()}>Cancel</button></div>}</section>}<div className="agent-messages">{messages.length === 0 ? <div className="agent-empty"><span>✦</span><p>{t.agentHint}</p></div> : messages.map((message, index) => <div className="agent-message" key={`${message}-${index}`}><span>you</span><p>{message}</p></div>)}</div><form className="agent-composer" onSubmit={submit}><textarea value={prompt} onChange={event => setPrompt(event.target.value)} placeholder={t.askAgent} aria-label={t.askAgent} rows={3}/><div><span>{t.local}</span><button className="primary-button" disabled={!prompt.trim()}>{t.send}</button></div></form></aside>;
}

function ActivityEditor({ shell, t, onClose }: { shell: DesktopShellController; t: Copy; onClose: () => void }) {
  const items = shell.chromeState.activityBar;
  return <div className="floating-editor activity-editor"><div className="editor-heading"><div><span className="section-label">{t.customize}</span><h2>{t.workspace}</h2></div><button onClick={onClose}>×</button></div><p>{t.extensionSlot}</p>{items.map((item, index) => <div className="activity-edit-row" key={item.id}><span className="drag-handle">⋮⋮</span><span className="edit-icon">{item.icon}</span><strong>{item.label}</strong><button onClick={() => shell.setActivityVisible(item.id, !item.visible)}>{item.visible ? t.hide : t.show}</button><button onClick={() => shell.setActivityPinned(item.id, !item.pinned)}>{item.pinned ? '★' : '☆'}</button><button onClick={() => index > 0 && shell.reorderActivity(item.id, index - 1)} disabled={index === 0}>↑</button><button onClick={() => index < items.length - 1 && shell.reorderActivity(item.id, index + 1)} disabled={index === items.length - 1}>↓</button></div>)}<button className="secondary-button editor-done" onClick={onClose}>{t.done}</button></div>;
}

function WorkspaceMenu({ shell, t, onClose }: { shell: DesktopShellController; t: Copy; onClose: () => void }) {
  const [newName, setNewName] = React.useState('');
  const records = shell.listWorkspaces();
  return <div className="floating-menu workspace-menu"><span className="section-label">{t.switcher}</span>{records.map(record => <button key={record.id} className={record.id === shell.getSnapshot().workspace.id ? 'workspace-option active' : 'workspace-option'} onClick={() => { shell.switchWorkspace(record.id); onClose(); }}><span className="workspace-dot"/><span>{record.name}</span><small>{record.tabs.length} tabs</small></button>)}<div className="workspace-create"><input value={newName} onChange={event => setNewName(event.target.value)} placeholder={t.newWorkspace} onKeyDown={event => { if (event.key === 'Enter' && newName.trim()) { shell.createWorkspace(newName); setNewName(''); onClose(); } }}/><button onClick={() => { if (newName.trim()) { shell.createWorkspace(newName); setNewName(''); onClose(); } }}>+</button></div><div className="workspace-menu-actions"><button onClick={() => { shell.renameWorkspace(window.prompt(t.rename, shell.getSnapshot().workspace.name) ?? shell.getSnapshot().workspace.name); onClose(); }}>{t.rename}</button><button onClick={() => { shell.removeWorkspace(); onClose(); }}>{t.delete}</button></div></div>;
}

function CommandPalette({ commands, t, onRun, onClose }: { commands: ShellCommand[]; t: Copy; onRun: (command: ShellCommand) => void; onClose: () => void }) {
  const [query, setQuery] = React.useState('');
  const inputRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => inputRef.current?.focus(), []);
  const filtered = commands.filter(command => `${command.label} ${command.description ?? ''} ${(command.keywords ?? []).join(' ')}`.toLowerCase().includes(query.toLowerCase())).slice(0, 20);
  return <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.currentTarget === event.target) onClose(); }}><section className="command-palette" role="dialog" aria-modal="true" aria-label={t.command}><div className="palette-input"><span>⌘</span><input ref={inputRef} value={query} onChange={event => setQuery(event.target.value)} placeholder={t.commandHint}/><kbd>ESC</kbd></div><div className="palette-list">{filtered.length ? filtered.map((command, index) => <button key={command.id} className={index === 0 ? 'palette-command selected' : 'palette-command'} onClick={() => onRun(command)}><span className="command-symbol">{command.id === 'ask-agent' ? '✦' : '›'}</span><span><strong>{command.label}</strong>{command.description && <small>{command.description}</small>}</span><kbd>{command.id === 'split-pane' ? 'Ctrl \\' : index < 9 ? `${index + 1}` : ''}</kbd></button>) : <div className="palette-empty">{t.noCommands}</div>}</div><footer><span>{t.local}</span><span>↑↓ navigate · Enter run</span></footer></section></div>;
}

function OmniboxMenu({ value, t, onChoose }: { value: string; t: Copy; onChoose: (value: string) => void }) {
  const suggestions = value.trim() ? [value.startsWith('http') ? value : `keystone://profile/${value}`, value.includes(' ') ? value : `>${value}`] : ['Bob', 'calendar tomorrow', 'what changed today?'];
  return <div className="omnibox-menu">{suggestions.map((suggestion, index) => <button key={`${suggestion}-${index}`} onMouseDown={event => event.preventDefault()} onClick={() => onChoose(suggestion)}><span>{index === 0 ? '⌕' : index === 1 ? '›' : '✦'}</span><span>{suggestion}</span><small>{index === 0 ? t.search : index === 1 ? t.command : t.agent}</small></button>)}</div>;
}

function QuickActions({ t, onChoose }: { t: Copy; onChoose: (ref: KeystoneObjectReference) => void }) {
  const actions: Array<[keyof Copy, KeystoneObjectReference, string]> = [
    ['capture', { kind: 'capture', id: 'capture', label: t.capture }, '＋'], ['message', { kind: 'chat', id: 'new-message', label: t.message }, '◌'], ['group', { kind: 'chat', id: 'new-group', label: t.group }, '◎'], ['space', { kind: 'space', id: 'new-space', label: t.space }, '▦'], ['note', { kind: 'vault', id: 'new-note', label: t.note }, '▱'], ['canvas', { kind: 'canvas', id: 'new-canvas', vaultId: 'vault', label: t.canvas }, '□'], ['event', { kind: 'calendar', id: 'new-event', label: t.event }, '□'], ['task', { kind: 'tasks', id: 'new-task', label: t.task }, '✓'], ['file', { kind: 'file', id: 'new-file', label: t.file }, '▤'], ['agent', { kind: 'agent', id: 'new-agent', label: t.agent }, '✦'], ['community', { kind: 'community', id: 'new-community', label: t.community }, '◈'],
  ];
  return <div className="floating-menu quick-actions"><span className="section-label">{t.quickActions}</span><div className="quick-grid">{actions.map(([label, ref, icon]) => <button key={label} onClick={() => onChoose(ref)}><span>{icon}</span>{t[label]}</button>)}</div></div>;
}

function handleDrop(event: React.DragEvent, shell: DesktopShellController, fallback?: KeystoneObjectReference, paneId = shell.currentPaneId) {
  event.preventDefault();
  const droppedFiles = [...event.dataTransfer.files].slice(0, 32);
  if (droppedFiles.length) {
    const runtime = getDesktopCaptureRuntime();
    if (!runtime) { shell.setNotice('Capture host is unavailable.'); return; }
    void Promise.all(droppedFiles.map(file => runtime.captureFile({ name: file.name, mimeType: file.type || 'application/octet-stream', size: file.size, read: async () => new Uint8Array(await file.arrayBuffer()), source: { kind: 'FILE_DROP', label: file.name } }))).then(() => { shell.openReference({ kind: 'capture', id: 'capture', label: 'Quick Capture' }, { paneId, allowDuplicate: true }); }).catch(() => shell.setNotice('Capture file import failed.'));
    return;
  }
  const raw = event.dataTransfer.getData('application/x-keystone-ref');
  if (raw) {
    try { const ref = JSON.parse(raw) as KeystoneObjectReference; if (ref.kind && ref.id) shell.openReference(ref, { paneId }); } catch { shell.setNotice('Invalid Keystone reference.'); }
  } else {
    const tabId = event.dataTransfer.getData('application/x-keystone-tab');
    if (tabId) shell.moveTab(tabId, paneId);
    else if (fallback) shell.openReference(fallback, { paneId });
  }
}

function descriptionFor(tab: DesktopTab, t: Copy): string {
  if (tab.kind === 'inbox') return t.inbox === 'Входящие' ? 'Universal Inbox: локальная проекция сообщений, почты, звонков, collaboration и owned-device событий.' : 'Universal Inbox: a local projection of messages, mail, calls, collaboration and owned-device events.';
  if (tab.kind === 'tasks') return t.home === 'Главная' ? 'Личные задачи, списки, подзадачи, сроки и напоминания через существующий TaskService.' : 'Personal tasks, lists, subtasks, due dates and reminders through the existing TaskService.';
  if (tab.kind === 'contacts') return t.home === 'Главная' ? 'Личная адресная книга: контакты, группы, дубликаты и явные ссылки на Identity.' : 'Personal address book: contacts, groups, duplicate review and explicit Identity links.';
  if (tab.kind === 'publication') return t.publicationDisclosure;
  if (tab.kind === 'web-library') return t.webLibraryDescription;
  if (tab.kind === 'map') return t.maps;
  if (tab.kind === 'mail') return t.home === 'Главная' ? 'Внешняя почта: локальный кэш, IMAP/SMTP/JMAP provider boundary и явная отправка.' : 'External Email: local cache, IMAP/SMTP/JMAP provider boundary and explicit sending.';
  if (tab.kind === 'profile') return `${tab.title} · Profile object. Follow, public media and agent references remain permission-aware.`;
  if (tab.kind === 'chat') return 'Conversation surface. Attachments and Keystone objects are references, not duplicated media.';
  if (tab.kind === 'community') return 'Community surface. Roles and moderation remain enforced by the existing core.';
  if (tab.kind === 'space') return 'Shared Space surface. CRDT state and encrypted content remain in the existing subsystem.';
  if (tab.kind === 'file') return `${t.files} · content-addressed object reference with provider availability handled by the existing storage layer.`;
  if (tab.kind === 'document') return t.documents === 'Документы' ? 'Документы и безопасный Reader поверх canonical Files: PDF, EPUB, Markdown, аннотации и локальный OCR.' : 'Documents and a safe Reader over canonical Files: PDF, EPUB, Markdown, annotations and local OCR.';
  if (tab.kind === 'capture') return t.captureHint;
  if (tab.kind === 'media') return `${t.photos} · private timeline, albums, metadata and explicit sharing through typed host adapters.`;
  if (tab.kind === 'music' || tab.kind === 'video') return `${t.media} · the same Keystone object can be opened from chat, community and library.`;
  return t.placeholderBody;
}

function tabIcon(kind: DesktopTab['kind']): string {
  return ({ home: '⌂', inbox: '✉', agent: '✦', chat: '◌', profile: '◎', community: '◈', space: '▦', vault: '▱', graph: '⌘', canvas: '□', calendar: '□', tasks: '✓', contacts: '◎', map: '⌖', mail: '✉', file: '▤', document: '▥', music: '♪', playlist: '≡', video: '▶', publication: '✎', workboard: '▥', subscriptions: '◴', 'web-library': '▤', settings: '⚙', browser: '◎', media: '▧', capture: '＋', unknown: '◇' })[kind];
}

// Named exports make the host extension boundary explicit.  The shell owns
// composition, while each surface remains replaceable by a typed host adapter.
export { DesktopShell, ActivityBar, ContextSidebar, AgentBotPanel, CommandPalette, QuickActions, OmniboxMenu as Omnibox };
